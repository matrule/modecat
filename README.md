# Octomed Web — v4

A web tracker inspired by the OctaMED line of Amiga trackers (Teijo
Kinnunen). The web app talks to a small **local bridge** process over
WebSocket; the bridge owns all real MIDI I/O on the host.

```
┌────────────────────────────┐    WebSocket     ┌────────────────────────┐
│  Web app (this repo)       │ ───────────────▶ │  Local bridge process  │
│  React / Vite / TS         │  ws://127:38010  │  (you implement this)  │
│  song · 16 tracks · synths │ ◀─────────────── │  CoreMIDI / WinMM /    │
│  · samples · pattern grid  │   midi_in events │  ALSA → real devices   │
└────────────────────────────┘                  └────────────────────────┘
```

The web app is fully usable without a bridge — it falls back to silent MIDI
mode so you can still edit patterns, draw synth waveforms, manage the song,
and see playback move. When a bridge connects, the **MIDI** indicator in the
status panel turns orange.

## What's in v4 (vs the v1 build)

- **Song / playlist mode** — a vertical list of song positions, each one
  pointing at a pattern in the bank. You can add/remove positions, rename or
  delete patterns, and toggle Loop / Pattern Loop.
- **16 tracks** per pattern — the grid scrolls horizontally when it
  exceeds the viewport. Click a track header to mute; shift-click to solo.
- **Synth instruments** — a third instrument kind alongside sample and MIDI.
  Each synth has a 32-step single-cycle waveform (click/drag the canvas to
  draw it) and a 4-stage AHDSR envelope. Playable via Web Audio.
- **Save / Load** — songs round-trip to JSON. Sample PCM and synth
  waveforms are base64-encoded inside the JSON; everything else is plain
  text. Drop the file back in via the **Load…** button.
- **Title / author metadata** — shown in the title bar and saved in the
  song file.

## Run

```bash
cd octomed-web
npm install
npm run dev
```

Then open <http://127.0.0.1:5173>.

## Bridge

The bridge protocol is specified in `BRIDGE_API.md`. None of v4's changes
touched the wire format — the new features (song mode, mute/solo, synth)
all live on the client side. A bridge that satisfies v1 of the protocol
works unchanged.

## Project layout

```
src/
├── App.tsx                       Top-level: 3-col body + footer
├── main.tsx
├── styles/octomed.css            Workbench palette, bevels, pixel font
├── components/
│   ├── TitleBar.tsx
│   ├── PatternEditor.tsx         16-track grid, mute/solo headers
│   ├── StatusPanel.tsx           POS · PAT · ROW · SPD · BPM · OCT · MIDI
│   ├── ButtonCluster.tsx
│   ├── SongEditor.tsx            song positions + pattern bank
│   ├── InstrumentList.tsx
│   ├── SampleEditor.tsx          dispatches sample/midi/synth detail views
│   ├── SynthEditor.tsx           32-step waveform + AHDSR
│   └── SaveLoadBar.tsx
├── state/
│   ├── types.ts                  + SynthInstrument, Song, TrackFlags
│   ├── store.ts                  Zustand store (now with song actions)
│   ├── initial.ts                two demo patterns + a starter synth
│   └── persist.ts                JSON save/load helpers
├── engine/
│   ├── notes.ts
│   └── sequencer.ts              song advancement + mute/solo + synth voice
└── bridge/
    ├── protocol.ts
    └── client.ts                 unchanged from v1
```

## Keyboard (pattern editor)

| Keys                              | Action                                   |
|-----------------------------------|------------------------------------------|
| `Z S X D C V G B H N J M`         | Lower octave (C through B)               |
| `Q 2 W 3 E R 5 T 6 Y 7 U`         | Upper octave                             |
| `↑ ↓ ← →`                         | Move cursor                              |
| `Tab` / `Shift+Tab`               | Next / previous channel                  |
| `Space`                           | Play / stop                              |
| `Esc` / `Return`                  | Toggle edit mode                         |
| `Del` / `Backspace`               | Clear current cell                       |
| `0–9`, `A–F` (in inst/cmd fields) | Hex entry                                |
| `+` / `-`                         | Octave up / down                         |
| `F1 F2 F3 F4 F5`                  | Set octave pair 1+2 / 2+3 / 3+4 / 4+5 / 5+6 |
| `F6 F7 F8 F9 F10`                 | Block jump: first / quarter / middle / 3-qtr / last |
| `PgUp / PgDn`                     | Scroll by 16 rows                        |
| `Home / End`                      | First / last row of pattern              |

## Effect commands supported

The cell's command field is currently a single hex nibble (0–F) plus a 1-byte
argument. Commands in the 10–FF range from the OctaMED manual aren't yet
representable; see "Known gaps" below.

| Code  | Name              | Notes                                              |
|-------|-------------------|----------------------------------------------------|
| `0B`  | Position jump     | `Bxx` jumps to song position `xx`                  |
| `0C`  | Set volume        | `Cxy` in 0–40 hex (0–64 dec), rescaled to MIDI 0–127 |
| `0D`  | Pattern break     | `Dxx` jumps to row `xx` of next song position      |
| `0F`  | Miscellaneous     | `F00` jump to next block · `F01–F1F` set speed · `F20–FF0` set BPM · `FFE` stop song · `FFF` stop note on track |

## Composition workflows

These are the higher-level moves the OctaMED manual centres a composer
around. The keystroke list above is just the surface — the workflow
features below are the real interface for writing a song.

### Range selection and clipboard (manual §RANGE PANEL p. 61)

Shift-click any cell to extend a rectangular selection from the cursor. The
**RangeBar** appears above the pattern grid with:

- **Cut / Copy / Paste / Clear** — `Cut` copies + clears, `Paste` anchors
  the buffer at the cursor's row / channel.
- **Transpose ½▼ / ½▲ / Oct▼ / Oct▲** — shift every note in the range by
  one semitone or one octave.
- **Vol Fade** — linearly interpolates a `0C` volume slide between the
  first and last `0C`-bearing rows inside the range (manual §"Creating
  volume slides" p. 64).
- **Echo** — writes decreasing-volume `0C` copies of each note across the
  range at the configured `Dist` and `Min` (manual §"ECHO EFFECTS" p. 65).
  Only fills empty cells, matching the manual's behaviour.

`Esc` clears the active range.

### Block ops (manual §BLOCK PANEL p. 36)

- **Split** in the Song panel divides the current pattern at the cursor
  row. The bottom half becomes a brand-new pattern (named `<orig>+`),
  inserted immediately after the current song position.

### Chord mode (manual §CHORD ENTERING AID p. 64)

Click the **Chord** button in the footer cluster. With it on, typing a note
places it at the current cell and advances **horizontally** (next channel,
same row) instead of vertically. Lay down a triad by typing 3 keys in a
row; turn Chord off to resume normal entry.

### Global instrument swap (manual §"INSTRUMENT DELETION, EXCHANGING AND CHANGING" p. 59-60)

The right-side **Instrument Swap** panel takes two slot numbers (`From`,
`To`) and applies one of:

- **Change →** — replace every occurrence of `From` with `To`.
- **Exchange ↔** — swap every `From` and `To` reference simultaneously.
- **Delete** — remove every note that uses `From`, leaving silence.

These rewrite all patterns in the song.

## Known gaps

The manual's 2-character command codes — e.g. `16` (Loop), `18` (Stop Note at
pulse), `1D` (Jump to Next Block at line), `1E` (Play Line ×n), `1F` (Delay +
Retrigger), `11`/`12` (one-shot pitch slides), `14` (fine vibrato), `15` (set
finetune), `19` (sample start offset), `1A`/`1B` (one-shot volume slide),
`1C` (change MIDI preset) — need a structural change to the cell schema
(cmd byte instead of nibble, plus one extra cursor field in the pattern
editor) and aren't supported yet.

Auto-slide (`SLIDE: 1` / `SLIDE: 2` from the manual's TRANSPOSE PANEL
p. 63) is **not** wired up: the range tool would write `03xx` cells, but
the sequencer doesn't yet implement effect `03` (tone portamento) — pitch
glide for samples and synths would require sub-row pitch modulation, and
for MIDI a continuous pitch-bend stream. Filed as a follow-up.

Per-instrument **Transpose** / **Finetune** (manual p. 29), the
**Programmable Keys** on `Shift+0..9` and `L.ALT`/`R.ALT` (p. 40), the
auto-space-after-Return setting `SPC=N` (p. 39), block sizes > 64 lines
(p. 69), the **Hybrid** instrument type (p. 28), and the **Graphic
Notation Editor** (p. 72) are not yet built.

## File format (`*.octomed.json`)

```jsonc
{
  "format": "octomed-web",
  "version": 1,
  "meta":    { "title": "...", "author": "..." },
  "song":    { "positions": [1, 2, 2] },
  "patterns":[{ "id": 1, "name": "INTRO", "rows": [[/* cells × 16 */], ...] }],
  "instruments": [
    { "kind": "empty", "name": "--" },
    { "kind": "midi",  "name": "...", "channel": 0, "program": -1, "velocity": 100, "lengthRows": 4 },
    { "kind": "synth", "name": "...", "waveform": "<base64 Float32Array>", "attackMs": 5, /* ... */ },
    { "kind": "sample","name": "...", "pcm": "<base64 Float32Array>", "sampleRate": 44100, /* ... */ }
  ],
  "transport": { "bpm": 125, "speed": 6, "loopSong": true },
  "mutes": [false, false, ...],
  "solos": [false, false, ...]
}
```
