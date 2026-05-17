# ModeCat — v1.0

A browser-based music tracker inspired by OctaMED on the Amiga. Built with React, TypeScript, Vite, and Zustand. Runs entirely in the browser — no server required.

```
┌────────────────────────────┐    WebSocket     ┌────────────────────────┐
│  ModeCat (this repo)       │ ───────────────▶ │  Local bridge process  │
│  React / Vite / TS         │  ws://127:38010  │  (optional)            │
│  song · 16 tracks · synths │ ◀─────────────── │  CoreMIDI / WinMM /    │
│  · samples · pattern grid  │   midi_in events │  ALSA → real devices   │
└────────────────────────────┘                  └────────────────────────┘
```

The bridge is optional — ModeCat is fully usable without it. When a bridge connects, the **MIDI** indicator in the info bar turns on and real MIDI output is available.

## Run

```bash
cd modecat
npm install
npm run dev
```

Then open <http://127.0.0.1:5173>.

## Features

- **16-channel pattern sequencer** with 64 rows per block, virtualised rendering
- **Song editor** — block playlist with section markers, copy/paste, right-click context menu
- **32 instrument slots** — Sample, MIDI, Synth, and Hybrid types
- **Sample editor** — waveform display, draggable loop markers, beat grid overlay, playhead animation, BPM detection, bar-snap, trim to loop
- **Synth editor** — 32-step single-cycle waveform + AHDSR envelope
- **Volume mixer** — per-channel faders
- **MDI windows** — Volume Mixer, Notation Editor, Sample Library, Script Editor
- **Oscilloscope** visualiser
- **ARexx-compatible scripting** engine
- **MIDI import** — SMF type 0/1 with grid analysis and import log
- **Sample Library** — browse and extract samples from WAV, MOD, and XM files
- **Web Audio API** sequencer engine with full effect command support
- **Range operations** — cut/copy/paste, transpose, vol fade, echo, pitch slide fill, note change/exchange, spread, command fill

## Project layout

```
src/
├── App.tsx
├── main.tsx
├── styles/modecat.css
├── components/
│   ├── TitleBar.tsx
│   ├── MenuBar.tsx
│   ├── TransportBar.tsx
│   ├── InfoBar.tsx
│   ├── ModeBar.tsx
│   ├── RangeBar.tsx
│   ├── PatternEditor.tsx
│   ├── SongEditor.tsx
│   ├── InstrumentList.tsx
│   ├── SampleEditor.tsx
│   ├── SynthEditor.tsx
│   ├── VolumeMixer.tsx
│   ├── NotationEditor.tsx
│   ├── SampleBrowser.tsx
│   ├── ScriptEditor.tsx
│   ├── Oscilloscope.tsx
│   └── SaveLoadBar.tsx
├── state/
│   ├── types.ts
│   ├── store.ts
│   ├── initial.ts
│   └── persist.ts
├── engine/
│   ├── notes.ts
│   ├── sequencer.ts
│   ├── midiImport.ts
│   ├── modParser.ts
│   ├── arexx.ts
│   └── kitLoader.ts
└── bridge/
    ├── protocol.ts
    └── client.ts
```

## Keyboard shortcuts

| Keys | Action |
|------|--------|
| `Z S X D C V G B H N J M` | Lower octave (C–B) |
| `Q 2 W 3 E R 5 T 6 Y 7 U` | Upper octave |
| `↑ ↓ ← →` | Move cursor |
| `Tab` / `Shift+Tab` | Next / previous channel |
| `Space` | Play / stop |
| `Esc` / `Return` | Toggle edit mode |
| `Del` / `Backspace` | Clear current cell |
| `0–9`, `A–F` | Hex entry in inst/cmd fields |
| `+` / `-` | Octave up / down |
| `F1–F5` | Set octave pair |
| `F6–F10` | Block jump |
| `PgUp / PgDn` | Scroll 16 rows |
| `Home / End` | First / last row |

## Effect commands

| Code | Name | Notes |
|------|------|-------|
| `00` | Arpeggio | `xy` = +x / +y semitones per tick |
| `01` | Slide up | `xx` = speed |
| `02` | Slide down | `xx` = speed |
| `03` | Portamento | `xx` = speed toward target note |
| `04` | Vibrato | `x` = speed, `y` = depth |
| `05` | Portamento + vol slide | |
| `06` | Tremolo | `x` = speed, `y` = depth |
| `0A` | Volume slide | `x` = up, `y` = down |
| `0B` | Position jump | `xx` = song position |
| `0C` | Set volume | `00`–`64` |
| `0D` | Volume slide (alt) | `x` = up, `y` = down |
| `0F` | Misc | `01`–`1F` = speed · `20`–`F0` = BPM · `FE` = stop · `FF` = cut |
| `10` | MIDI send | `xx` = slot |
| `11` | Note up | `xx` semitones, one-shot |
| `12` | Note down | `xx` semitones, one-shot |
| `16` | Loop | `00` = set start, `nn` = repeat n times |
| `18` | Note cut | after `xx` ticks |
| `19` | Sample offset | `xx` × 256 samples |
| `1A` | Vol slide up (fine) | |
| `1B` | Vol slide down (fine) | |
| `1C` | MIDI program change | `xx` = slot |
| `1D` | Block break to row | `xx` = row |
| `1E` | Line repeat | `xx` times |

## File format (`*.modecat.json`)

```jsonc
{
  "format": "modecat",
  "version": 2,
  "meta":    { "title": "...", "author": "..." },
  "song":    { "positions": [1, 2, 2], "sectionMarkers": [] },
  "patterns":[{ "id": 1, "name": "INTRO", "rows": [[/* cells × 16 */], ...] }],
  "instruments": [
    { "kind": "empty",  "name": "--" },
    { "kind": "midi",   "name": "...", "channel": 0, "program": -1, "velocity": 100, "lengthRows": 4 },
    { "kind": "synth",  "name": "...", "waveform": "<base64 Float32Array>", "attackMs": 5 },
    { "kind": "sample", "name": "...", "pcm": "<base64 Float32Array>", "sampleRate": 44100,
      "loopEnabled": false, "loopStart": 0, "loopEnd": 0 }
  ],
  "transport": { "bpm": 125, "speed": 6 },
  "mutes": [false, false, "...×16"]
}
```

## Bridge

The optional local bridge handles real MIDI I/O. Protocol details in `BRIDGE_API.md`. Connect a WebSocket client to `ws://127.0.0.1:38010` using sub-protocol `modecat.bridge.v1`.
