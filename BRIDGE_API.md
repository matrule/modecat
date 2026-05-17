# Octomed-Web ↔ Local Bridge API

This document specifies the WebSocket protocol the web app uses to talk to a
local "bridge" process that owns the host's MIDI subsystem. The web app does
**not** speak MIDI directly — every MIDI byte that leaves the user's machine
flows through the bridge.

The bridge is responsible for:

- Enumerating MIDI input/output ports on the host OS.
- Opening/closing those ports on behalf of the web app.
- Receiving structured MIDI messages from the web app and forwarding them as
  raw bytes to the chosen output port at the requested time.
- Receiving raw MIDI bytes from input ports and forwarding them, parsed, back
  to the web app.

The bridge is **not** responsible for:

- Sequencer logic (timing of rows, effect commands, etc.) — the web app does
  all of that and just instructs the bridge "send these bytes now (or at time
  T)".
- Audio playback of samples — the web app handles sample playback in the
  browser via Web Audio.
- Project storage — the web app stores songs in browser storage / file I/O.

---

## 1. Transport

- Protocol: WebSocket
- Default URL: `ws://127.0.0.1:38010/midi`
- Sub-protocol identifier: `modecat.bridge.v1`
- Message framing: one JSON object per WebSocket text frame.
- All numeric IDs (`requestId`, `portId`, etc.) are stable for the duration of
  a single connection.

The web app reconnects with exponential backoff (250 ms → 8 s, jittered) if
the socket drops.

### 1.1 Why WebSocket and not Web MIDI?

The native Web MIDI API does not expose all platform MIDI graphs (e.g. virtual
ports on macOS / IAC, Windows loopMIDI, ALSA sequencer clients on Linux), has
inconsistent SysEx support, and is unsupported on Safari/iOS. A local bridge
gives us a stable, cross-browser, cross-OS surface.

---

## 2. Message envelope

Every frame in either direction looks like:

```json
{
  "v": 1,
  "type": "<message_type>",
  "id": 42,
  "ts": 1715444444444,
  "payload": { ... }
}
```

| Field     | Required | Notes                                                                                                       |
|-----------|----------|-------------------------------------------------------------------------------------------------------------|
| `v`       | yes      | Protocol version. Currently `1`.                                                                            |
| `type`    | yes      | One of the message types in §3–§4.                                                                          |
| `id`      | optional | Client-assigned correlation ID for request/response. Echoed back by the server in its reply (`replyTo`).    |
| `replyTo` | optional | Set by the server when replying to a client request — equals the client's `id`.                             |
| `ts`      | optional | Sender wall-clock timestamp in ms since Unix epoch. Informational only; do **not** use for scheduling.     |
| `payload` | varies   | Type-specific body. See per-message docs below.                                                             |

For one-way notifications (e.g. `midi_in`), `id`/`replyTo` are omitted.

---

## 3. Client → Server messages

### 3.1 `hello`

First message after socket open. Negotiates capabilities.

```json
{
  "v": 1, "type": "hello", "id": 1,
  "payload": {
    "client": "modecat",
    "clientVersion": "0.1.0",
    "wants": ["midi_out", "midi_in", "scheduling", "sysex"]
  }
}
```

Server replies with `hello_ack` (§4.1).

### 3.2 `list_devices`

Ask for the current MIDI port inventory. The server **must** also push a
`devices` (§4.2) message any time the inventory changes (hotplug, port
opened/closed by another app).

```json
{ "v": 1, "type": "list_devices", "id": 2, "payload": {} }
```

### 3.3 `open_port`

Open a port for I/O. The web app cannot send `midi_out` to a port that has not
been opened, and will not receive `midi_in` from one either.

```json
{
  "v": 1, "type": "open_port", "id": 3,
  "payload": {
    "portId": "out:CoreMIDI:IAC Driver:Bus 1",
    "direction": "out"
  }
}
```

`direction` is `"in"` or `"out"`. The server replies with `port_opened` (§4.3)
or `error` (§4.7).

### 3.4 `close_port`

```json
{
  "v": 1, "type": "close_port", "id": 4,
  "payload": { "portId": "out:CoreMIDI:IAC Driver:Bus 1" }
}
```

Server replies with `port_closed` (§4.4) or `error`.

### 3.5 `midi_out`

The workhorse. Send one or more MIDI events to an open output port.

```json
{
  "v": 1, "type": "midi_out",
  "payload": {
    "portId": "out:CoreMIDI:IAC Driver:Bus 1",
    "events": [
      { "at": 0,   "bytes": [0x90, 60, 100] },
      { "at": 250, "bytes": [0x80, 60, 0] }
    ]
  }
}
```

- `bytes` is the literal MIDI message, exactly as it would appear on the wire
  (status byte + data bytes). 0x90–0xEF status bytes are channel-voice
  messages where the low nibble of the status byte encodes the MIDI channel.
- `at` is **relative scheduling, in milliseconds**, measured from the moment
  the bridge receives the message. The bridge SHOULD use a high-resolution
  timer (e.g. `clock_gettime(CLOCK_MONOTONIC)`) and dispatch each event when
  its `at` deadline arrives. `at` may be `0` (send immediately) or omitted
  (treated as `0`). Negative values are clamped to `0`.
- A single `midi_out` may carry up to **256** events.
- The bridge MUST NOT reorder events that share the same `at`; they are sent
  in array order.
- The bridge SHOULD coalesce running status when forwarding to physical ports
  if the underlying API benefits from it, but this is opaque to the client.

There is no per-event ack. Failure to deliver (e.g. port closed mid-flight)
produces an `error` (§4.7) referencing the original `id` if one was set.

#### Convenience event shapes

For ergonomics, the bridge MUST also accept structured events (instead of raw
bytes) and encode them server-side. A single `events` array MAY mix raw and
structured entries.

```json
{ "at": 0,  "type": "note_on",  "channel": 0, "note": 60, "velocity": 100 }
{ "at": 50, "type": "note_off", "channel": 0, "note": 60, "velocity": 0   }
{ "at": 0,  "type": "cc",       "channel": 0, "controller": 1, "value": 64 }
{ "at": 0,  "type": "program",  "channel": 0, "program": 12 }
{ "at": 0,  "type": "pitchbend","channel": 0, "value": 8192 }
{ "at": 0,  "type": "aftertouch","channel": 0, "note": 60, "pressure": 64 }
{ "at": 0,  "type": "channel_pressure","channel": 0, "pressure": 64 }
{ "at": 0,  "type": "sysex",    "bytes": [0x7E, 0x7F, 0x06, 0x01] }
```

`channel` is 0-indexed (0–15). The bridge encodes the status byte itself.

### 3.6 `panic`

All notes off + reset on a port (or all open output ports if `portId` is
omitted). Sends CC 123 (All Notes Off) and CC 120 (All Sound Off) on every
channel 0–15, then optionally MIDI Reset (0xFF).

```json
{
  "v": 1, "type": "panic", "id": 5,
  "payload": { "portId": "out:CoreMIDI:IAC Driver:Bus 1" }
}
```

Server replies with `ok` (§4.6).

### 3.7 `subscribe_clock`

Optional. Asks the bridge to start emitting `clock_tick` (§4.5) notifications
derived from MIDI Clock messages on a given input port. The web app uses these
to sync its sequencer to an external clock source.

```json
{
  "v": 1, "type": "subscribe_clock", "id": 6,
  "payload": { "portId": "in:CoreMIDI:Elektron Digitakt" }
}
```

### 3.8 `unsubscribe_clock`

```json
{ "v": 1, "type": "unsubscribe_clock", "id": 7, "payload": {} }
```

---

## 4. Server → Client messages

### 4.1 `hello_ack`

```json
{
  "v": 1, "type": "hello_ack", "replyTo": 1,
  "payload": {
    "server": "modecat-bridge",
    "serverVersion": "0.1.0",
    "supports": ["midi_out", "midi_in", "scheduling", "sysex", "clock"],
    "schedulingResolutionMs": 1
  }
}
```

`schedulingResolutionMs` advertises the worst-case jitter the bridge expects
its scheduler to deliver. The web app uses this to decide how far ahead to
schedule (a sequencer lookahead of `max(25 ms, 5 × resolution)` is reasonable).

### 4.2 `devices`

Sent in reply to `list_devices` AND unsolicited whenever the inventory
changes.

```json
{
  "v": 1, "type": "devices", "replyTo": 2,
  "payload": {
    "ports": [
      {
        "id": "out:CoreMIDI:IAC Driver:Bus 1",
        "name": "IAC Driver Bus 1",
        "manufacturer": "Apple",
        "direction": "out",
        "isOpen": false
      },
      {
        "id": "in:CoreMIDI:Elektron Digitakt",
        "name": "Elektron Digitakt",
        "manufacturer": "Elektron",
        "direction": "in",
        "isOpen": false
      }
    ]
  }
}
```

`id` is opaque and stable for the duration of the connection. Names are for
display only.

### 4.3 `port_opened`

```json
{
  "v": 1, "type": "port_opened", "replyTo": 3,
  "payload": { "portId": "out:CoreMIDI:IAC Driver:Bus 1", "direction": "out" }
}
```

### 4.4 `port_closed`

```json
{
  "v": 1, "type": "port_closed", "replyTo": 4,
  "payload": { "portId": "out:CoreMIDI:IAC Driver:Bus 1" }
}
```

May also be sent unsolicited if the OS-level port disappears (device
unplugged).

### 4.5 `midi_in`

Bridge → web app. One MIDI message received on an open input port.

```json
{
  "v": 1, "type": "midi_in",
  "payload": {
    "portId": "in:CoreMIDI:Elektron Digitakt",
    "ts": 173824.512,
    "bytes": [0x90, 60, 100]
  }
}
```

`ts` is the bridge's monotonic timestamp in ms (same clock used for `at`
scheduling). The bridge MAY batch multiple events into one frame using
`events: [...]` instead of a single `bytes`/`ts`; clients MUST handle both.

`clock_tick` is a specialization triggered only by `subscribe_clock`:

```json
{
  "v": 1, "type": "clock_tick",
  "payload": {
    "portId": "in:CoreMIDI:Elektron Digitakt",
    "ts": 173824.512,
    "kind": "tick"
  }
}
```

`kind` ∈ `tick` (0xF8), `start` (0xFA), `continue` (0xFB), `stop` (0xFC).

### 4.6 `ok`

Generic acknowledgement for requests that have no payload.

```json
{ "v": 1, "type": "ok", "replyTo": 5, "payload": {} }
```

### 4.7 `error`

```json
{
  "v": 1, "type": "error", "replyTo": 3,
  "payload": {
    "code": "PORT_NOT_FOUND",
    "message": "No such port: out:CoreMIDI:Missing",
    "retryable": false
  }
}
```

Defined codes:

| Code                    | Meaning                                                            |
|-------------------------|--------------------------------------------------------------------|
| `PORT_NOT_FOUND`        | `portId` doesn't match any known port.                             |
| `PORT_NOT_OPEN`         | Asked to send/receive on a port that is closed.                    |
| `PORT_BUSY`             | Port is opened exclusively by another process.                     |
| `INVALID_MESSAGE`       | Envelope failed schema validation.                                 |
| `INVALID_MIDI`          | One of the events failed MIDI byte validation.                     |
| `SCHEDULER_OVERLOAD`    | The bridge dropped events because its outgoing queue overflowed.  |
| `INTERNAL`              | Catch-all. `retryable` indicates whether the client should retry. |

---

## 5. Timing & scheduling contract

The sequencer in the web app runs a **lookahead loop**: every ~25 ms it walks
forward over upcoming rows and emits all events that will fire in the next
~100 ms, each tagged with a relative `at`. The bridge is responsible for
dispatching at exactly `now_when_received + at`.

Implementation hints for the bridge:

- Maintain a small priority queue keyed by `(deadline, sequence_number)`.
- Use a busy-wait + sleep hybrid for sub-ms accuracy on the final stretch.
- On macOS, `mach_absolute_time` / `CAClock` work. On Windows, multimedia
  timers (`timeBeginPeriod(1)` + `QueryPerformanceCounter`) work. On Linux,
  ALSA's sequencer queue does this natively.
- If the queue gets behind realtime by more than `100 ms`, drop pending events
  for the affected port and emit a `SCHEDULER_OVERLOAD` error.

---

## 6. Security

The bridge listens on **loopback only** (`127.0.0.1` or `::1`). It MUST reject
connections from non-loopback addresses.

On first connection from a new origin, the bridge SHOULD prompt the user
(native OS dialog) for permission. The user's choice is remembered per-origin.

Recommended default allowlist: `http://localhost:*`, `http://127.0.0.1:*`,
plus whatever origin the user has chosen to deploy the web app at.

---

## 7. Reference flow (full session)

```
ws  ← open
→ hello {wants: [...]}
← hello_ack {supports: [...], schedulingResolutionMs: 1}
→ list_devices
← devices {ports: [...]}
→ open_port {portId: "out:...:Bus 1", direction: "out"}
← port_opened
... user presses Play in the web app ...
→ midi_out {portId, events:[{at:0,type:note_on,...},{at:250,type:note_off,...}, ...]}
→ midi_out {portId, events:[...]}      // every ~25 ms lookahead tick
... user presses Stop ...
→ panic {portId}
← ok
→ close_port {portId}
← port_closed
ws  ← close
```
