// Typed envelopes and payloads for the local bridge protocol.
// Mirrors BRIDGE_API.md exactly. If you change anything here, update the spec.

export const PROTOCOL_VERSION = 1 as const;
export const SUBPROTOCOL = 'modecat.bridge.v1';
export const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:38010/midi';

// ---------- Client -> Server ----------

export interface HelloMsg {
  type: 'hello';
  payload: {
    client: 'modecat';
    clientVersion: string;
    wants: string[];
  };
}

export interface ListDevicesMsg {
  type: 'list_devices';
  payload: Record<string, never>;
}

export interface OpenPortMsg {
  type: 'open_port';
  payload: { portId: string; direction: 'in' | 'out' };
}

export interface ClosePortMsg {
  type: 'close_port';
  payload: { portId: string };
}

export type MidiOutEvent =
  | { at?: number; bytes: number[] }
  | { at?: number; type: 'note_on';  channel: number; note: number; velocity: number }
  | { at?: number; type: 'note_off'; channel: number; note: number; velocity?: number }
  | { at?: number; type: 'cc';       channel: number; controller: number; value: number }
  | { at?: number; type: 'program';  channel: number; program: number }
  | { at?: number; type: 'pitchbend';channel: number; value: number }
  | { at?: number; type: 'aftertouch';      channel: number; note: number; pressure: number }
  | { at?: number; type: 'channel_pressure'; channel: number; pressure: number }
  | { at?: number; type: 'sysex';   bytes: number[] };

export interface MidiOutMsg {
  type: 'midi_out';
  payload: { portId: string; events: MidiOutEvent[] };
}

export interface PanicMsg {
  type: 'panic';
  payload: { portId?: string };
}

export interface SubscribeClockMsg {
  type: 'subscribe_clock';
  payload: { portId: string };
}
export interface UnsubscribeClockMsg {
  type: 'unsubscribe_clock';
  payload: Record<string, never>;
}

export type ClientMessage =
  | HelloMsg
  | ListDevicesMsg
  | OpenPortMsg
  | ClosePortMsg
  | MidiOutMsg
  | PanicMsg
  | SubscribeClockMsg
  | UnsubscribeClockMsg;

// ---------- Server -> Client ----------

export interface HelloAckMsg {
  type: 'hello_ack';
  payload: {
    server: string;
    serverVersion: string;
    supports: string[];
    schedulingResolutionMs: number;
  };
}

export interface DevicesMsg {
  type: 'devices';
  payload: {
    ports: Array<{
      id: string;
      name: string;
      manufacturer?: string;
      direction: 'in' | 'out';
      isOpen: boolean;
    }>;
  };
}

export interface PortOpenedMsg {
  type: 'port_opened';
  payload: { portId: string; direction: 'in' | 'out' };
}

export interface PortClosedMsg {
  type: 'port_closed';
  payload: { portId: string };
}

export interface MidiInMsg {
  type: 'midi_in';
  payload:
    | { portId: string; ts: number; bytes: number[] }
    | { portId: string; events: Array<{ ts: number; bytes: number[] }> };
}

export interface ClockTickMsg {
  type: 'clock_tick';
  payload: { portId: string; ts: number; kind: 'tick' | 'start' | 'continue' | 'stop' };
}

export interface OkMsg {
  type: 'ok';
  payload: Record<string, never>;
}

export interface ErrorMsg {
  type: 'error';
  payload: {
    code:
      | 'PORT_NOT_FOUND'
      | 'PORT_NOT_OPEN'
      | 'PORT_BUSY'
      | 'INVALID_MESSAGE'
      | 'INVALID_MIDI'
      | 'SCHEDULER_OVERLOAD'
      | 'INTERNAL';
    message: string;
    retryable: boolean;
  };
}

export type ServerMessage =
  | HelloAckMsg
  | DevicesMsg
  | PortOpenedMsg
  | PortClosedMsg
  | MidiInMsg
  | ClockTickMsg
  | OkMsg
  | ErrorMsg;

// ---------- Envelope ----------

export interface Envelope<T> {
  v: 1;
  type: T extends { type: infer K } ? K : string;
  id?: number;
  replyTo?: number;
  ts?: number;
  payload: T extends { payload: infer P } ? P : unknown;
}
