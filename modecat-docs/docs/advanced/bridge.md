# MIDI Bridge

ModeCat is fully usable without any external hardware — all audio is synthesised in the browser via the Web Audio API. However, if you want to drive real MIDI devices (hardware synths, drum machines, studio gear), you can run the optional local **bridge** process alongside ModeCat.

When a bridge connects, the **MIDI** indicator in the info bar turns on and instrument slots set to **MIDI** type will route their notes out to your hardware.

## How it works

```
┌──────────────────┐    WebSocket     ┌────────────────────────┐
│  ModeCat         │ ───────────────▶ │  Local bridge process  │
│  (browser)       │  ws://127:38010  │                        │
│                  │ ◀─────────────── │  CoreMIDI / WinMM /    │
│                  │   midi_in events │  ALSA → real devices   │
└──────────────────┘                  └────────────────────────┘
```

The bridge is a small native process you run on your machine. It owns the MIDI subsystem, enumerates your ports, and acts as a relay. The sequencer logic, timing, and audio all stay inside the browser.

## Starting the bridge

The bridge is a separate executable (not included in this repo — check the [ModeCat GitHub](https://github.com/matrule/modecat) releases). Run it before opening ModeCat:

```bash
./modecat-bridge
```

It listens on `ws://127.0.0.1:38010` by default. ModeCat will detect the connection automatically and show **MIDI** active in the info bar.

## Selecting a MIDI output port

Once the bridge is connected:

1. Open an instrument slot and set its type to **MIDI**
2. The MIDI instrument panel shows a **Port** dropdown populated with the bridge's detected outputs
3. Select your device and set the MIDI channel, program, and velocity as needed

## Security

The bridge only listens on loopback (`127.0.0.1`) and will never accept connections from remote addresses. On first use from a new origin it may prompt for permission via a native OS dialog.

---

## WebSocket protocol

The following is a technical reference for developers building their own bridge implementation or integrating ModeCat with other software.

### Transport

- **URL:** `ws://127.0.0.1:38010/midi`
- **Sub-protocol:** `modecat.bridge.v1`
- **Framing:** one JSON object per WebSocket text frame

### Message envelope

Every frame in either direction:

```json
{
  "v": 1,
  "type": "<message_type>",
  "id": 42,
  "ts": 1715444444444,
  "payload": { ... }
}
```

| Field | Notes |
|-------|-------|
| `v` | Protocol version. Currently `1`. |
| `type` | Message type (see below). |
| `id` | Client-assigned correlation ID, echoed back as `replyTo`. |
| `replyTo` | Server's reply to a client `id`. |
| `ts` | Sender wall-clock ms. Informational only — do not use for scheduling. |
| `payload` | Type-specific body. |

### Handshake

```json
// Client → Server
{ "v": 1, "type": "hello", "id": 1,
  "payload": { "client": "modecat", "clientVersion": "1.0.0",
               "wants": ["midi_out", "midi_in", "scheduling", "sysex"] } }

// Server → Client
{ "v": 1, "type": "hello_ack", "replyTo": 1,
  "payload": { "server": "modecat-bridge", "serverVersion": "0.1.0",
               "supports": ["midi_out", "midi_in", "scheduling", "sysex", "clock"],
               "schedulingResolutionMs": 1 } }
```

### Device enumeration

```json
// Client: list ports
{ "v": 1, "type": "list_devices", "id": 2, "payload": {} }

// Server: port inventory (also sent unsolicited on hotplug)
{ "v": 1, "type": "devices", "replyTo": 2,
  "payload": { "ports": [
    { "id": "out:CoreMIDI:IAC Driver:Bus 1", "name": "IAC Driver Bus 1",
      "direction": "out", "isOpen": false },
    { "id": "in:CoreMIDI:Elektron Digitakt", "name": "Elektron Digitakt",
      "direction": "in", "isOpen": false }
  ] } }
```

### Sending MIDI

```json
{ "v": 1, "type": "midi_out",
  "payload": {
    "portId": "out:CoreMIDI:IAC Driver:Bus 1",
    "events": [
      { "at": 0,   "type": "note_on",  "channel": 0, "note": 60, "velocity": 100 },
      { "at": 250, "type": "note_off", "channel": 0, "note": 60, "velocity": 0   }
    ]
  } }
```

`at` is relative scheduling in milliseconds from when the bridge receives the message. Raw byte arrays (`"bytes": [0x90, 60, 100]`) are also accepted and can be mixed with structured events in the same array.

### Other client messages

| Type | Purpose |
|------|---------|
| `open_port` | Open a port before sending/receiving |
| `close_port` | Close a port |
| `panic` | All Notes Off + All Sound Off on all channels |
| `subscribe_clock` | Receive MIDI Clock ticks from an input port |
| `unsubscribe_clock` | Stop clock subscription |

### Server error codes

| Code | Meaning |
|------|---------|
| `PORT_NOT_FOUND` | `portId` doesn't match any known port |
| `PORT_NOT_OPEN` | Tried to send to a closed port |
| `PORT_BUSY` | Port opened exclusively by another process |
| `INVALID_MESSAGE` | Schema validation failure |
| `INVALID_MIDI` | Bad MIDI byte sequence |
| `SCHEDULER_OVERLOAD` | Bridge dropped events — queue overflowed |
| `INTERNAL` | Catch-all |

### Timing contract

The sequencer runs a ~25 ms lookahead loop, tagging each event with a relative `at` offset so the bridge can dispatch at the precise moment. ModeCat uses a lookahead of `max(25 ms, 5 × schedulingResolutionMs)`.
