// WebSocket client for the local MIDI bridge.
//
// - Auto-reconnects with exponential backoff (250 ms .. 8 s, jittered).
// - Performs the `hello` handshake on every (re)connect.
// - Exposes a simple request/response API plus subscribe-style hooks for
//   `devices` and `midi_in`.
// - Falls back gracefully when no bridge is present — all `send*` methods
//   become no-ops, and the app remains usable in "silent" mode.
//
// Wiring into the Zustand store is done in App.tsx via `attachBridge()`.

import {
  DEFAULT_BRIDGE_URL,
  PROTOCOL_VERSION,
  SUBPROTOCOL,
  type ClientMessage,
  type Envelope,
  type ErrorMsg,
  type MidiOutEvent,
  type ServerMessage,
} from './protocol';

type ServerEnvelope = Envelope<ServerMessage>;

export interface BridgeEvents {
  onStatus?: (s: { connected: boolean; serverVersion?: string; schedulingResolutionMs?: number; error?: string }) => void;
  onDevices?: (ports: Array<{ id: string; name: string; direction: 'in' | 'out'; isOpen: boolean }>) => void;
  onMidiIn?: (e: { portId: string; ts: number; bytes: number[] }) => void;
  onError?: (e: ErrorMsg['payload']) => void;
}

export class BridgeClient {
  private url: string;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, (msg: ServerEnvelope) => void>();
  private reconnectAttempts = 0;
  private reconnectTimer: number | null = null;
  private shuttingDown = false;

  constructor(private events: BridgeEvents, url = DEFAULT_BRIDGE_URL) {
    this.url = url;
  }

  // ---------- lifecycle ----------

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    try {
      this.ws = new WebSocket(this.url, SUBPROTOCOL);
    } catch (err) {
      this.scheduleReconnect();
      this.events.onStatus?.({ connected: false, error: String(err) });
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      // hello handshake
      this.request({
        type: 'hello',
        payload: {
          client: 'modecat',
          clientVersion: '0.1.0',
          wants: ['midi_out', 'midi_in', 'scheduling', 'sysex'],
        },
      }).then(
        (ack) => {
          if (ack.type !== 'hello_ack') return;
          this.events.onStatus?.({
            connected: true,
            serverVersion: ack.payload.serverVersion,
            schedulingResolutionMs: ack.payload.schedulingResolutionMs,
          });
          // ask for initial inventory
          this.request({ type: 'list_devices', payload: {} }).catch(() => {});
        },
        (err) => this.events.onStatus?.({ connected: false, error: String(err) })
      );
    };

    this.ws.onmessage = (ev) => {
      let msg: ServerEnvelope;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return; // ignore garbage
      }
      this.dispatch(msg);
    };

    this.ws.onclose = () => {
      this.events.onStatus?.({ connected: false });
      this.failAllPending('socket closed');
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // We rely on onclose to trigger reconnect; just log.
    };
  }

  close() {
    this.shuttingDown = true;
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect() {
    if (this.shuttingDown) return;
    const base = Math.min(8000, 250 * Math.pow(2, this.reconnectAttempts++));
    const jitter = Math.random() * 250;
    this.reconnectTimer = window.setTimeout(() => this.connect(), base + jitter);
  }

  private failAllPending(reason: string) {
    for (const [id, resolve] of this.pending) {
      // Reply with a synthetic error so awaiters unblock
      resolve({
        v: PROTOCOL_VERSION,
        type: 'error',
        replyTo: id,
        payload: { code: 'INTERNAL', message: reason, retryable: true },
      });
    }
    this.pending.clear();
  }

  // ---------- send ----------

  private send(env: Envelope<ClientMessage>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(env));
    return true;
  }

  /** Send a request and await a single matching reply (`replyTo === id`). */
  request<M extends ClientMessage>(msg: M, timeoutMs = 3000): Promise<ServerMessage> {
    const id = this.nextId++;
    const env: Envelope<ClientMessage> = {
      v: PROTOCOL_VERSION,
      type: msg.type as Envelope<ClientMessage>['type'],
      id,
      ts: Date.now(),
      payload: msg.payload as Envelope<ClientMessage>['payload'],
    };

    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('bridge request timed out'));
      }, timeoutMs);

      this.pending.set(id, (reply) => {
        window.clearTimeout(timer);
        resolve({ type: reply.type, payload: reply.payload } as ServerMessage);
      });

      if (!this.send(env)) {
        // Not connected — fail silently (no bridge available).
        this.pending.delete(id);
        window.clearTimeout(timer);
        reject(new Error('bridge not connected'));
      }
    });
  }

  /** Fire-and-forget. Used in the sequencer hot path for `midi_out`. */
  sendOneWay(msg: ClientMessage) {
    this.send({
      v: PROTOCOL_VERSION,
      type: msg.type as Envelope<ClientMessage>['type'],
      payload: msg.payload as Envelope<ClientMessage>['payload'],
    });
  }

  // ---------- high-level helpers ----------

  openPort(portId: string, direction: 'in' | 'out' = 'out') {
    return this.request({ type: 'open_port', payload: { portId, direction } });
  }
  closePort(portId: string) {
    return this.request({ type: 'close_port', payload: { portId } });
  }
  listDevices() {
    return this.request({ type: 'list_devices', payload: {} });
  }
  midiOut(portId: string, events: MidiOutEvent[]) {
    if (events.length === 0) return;
    this.sendOneWay({ type: 'midi_out', payload: { portId, events } });
  }
  panic(portId?: string) {
    this.sendOneWay({ type: 'panic', payload: portId ? { portId } : {} });
  }

  // ---------- inbound dispatch ----------

  private dispatch(msg: ServerEnvelope) {
    // 1) request/response correlation
    if (msg.replyTo != null) {
      const cb = this.pending.get(msg.replyTo);
      if (cb) {
        this.pending.delete(msg.replyTo);
        cb(msg);
        // The handler also wants to see the broadcast for `devices` etc.
      }
    }

    // 2) broadcasts / unsolicited
    switch (msg.type) {
      case 'devices':
        this.events.onDevices?.((msg.payload as DevicesPayload).ports);
        break;
      case 'midi_in':
        this.handleMidiIn(msg.payload as MidiInPayload);
        break;
      case 'port_opened':
      case 'port_closed':
        // Re-fetch the inventory so isOpen flags stay in sync.
        this.request({ type: 'list_devices', payload: {} }).catch(() => {});
        break;
      case 'error':
        this.events.onError?.((msg.payload as ErrorMsg['payload']));
        break;
      default:
        break;
    }
  }

  private handleMidiIn(p: MidiInPayload) {
    if ('events' in p) {
      for (const e of p.events) {
        this.events.onMidiIn?.({ portId: p.portId, ts: e.ts, bytes: e.bytes });
      }
    } else {
      this.events.onMidiIn?.({ portId: p.portId, ts: p.ts, bytes: p.bytes });
    }
  }
}

// Local helper types to avoid wide imports above
type DevicesPayload = {
  ports: Array<{ id: string; name: string; direction: 'in' | 'out'; isOpen: boolean }>;
};
type MidiInPayload =
  | { portId: string; ts: number; bytes: number[] }
  | { portId: string; events: Array<{ ts: number; bytes: number[] }> };
