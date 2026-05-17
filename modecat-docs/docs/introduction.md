# Introduction

ModeCat is a browser-based music tracker inspired by OctaMED on the Amiga. It runs entirely in your browser with no installation required, using the Web Audio API for synthesis and sample playback.

## What is a tracker?

A tracker is a type of music sequencer where notes are arranged in vertical columns (channels) and rows (time steps). Each cell in the grid can contain a note, an instrument number, and an effect command. Time advances row by row at a speed set by the BPM and tick rate.

This approach — pioneered on the Amiga in the late 1980s — is still widely used today, particularly in chiptune, electronic, and sample-based music.

## ModeCat concepts

| Term | Meaning |
|------|---------|
| **Block** | A pattern of up to 64 rows × 16 channels. The core unit of composition. |
| **Song** | A playlist of blocks played in sequence. The same block can appear multiple times. |
| **Channel** | One vertical column in a block. Each channel plays one note at a time. |
| **Instrument** | A sound source — Sample, Synth, or MIDI. Up to 32 slots. |
| **Effect command** | A two-digit hex code in a cell that modifies playback (pitch slide, volume, etc). |

## Next steps

- [Quick Start](/quick-start) — get ModeCat running in two minutes
- [The Interface](/guide/interface) — a tour of the layout
- [Pattern Entry](/guide/pattern-entry) — how to enter notes
