# Sample Editor

The Sample Editor lets you load and edit PCM audio for use as a sample instrument.

## Loading a sample

Click **Load WAV…** to open a file picker. ModeCat accepts WAV and most common audio formats. Stereo files are mixed to mono on import.

## Waveform display

The waveform canvas shows the full sample. You can:
- **Drag** to create a selection (orange region) for editing operations
- **Zoom in/out** with Zoom+ / Zoom− or Show All
- **Scroll** with the ◄ / ► buttons

## Loop markers

The cyan **S** (start) and **E** (end) markers define the loop region. When Loop is active and you press Play, playback loops continuously between them.

- **Drag** either marker to reposition it — the cursor changes to a resize arrow when you hover near one
- **Set from Sel** — snaps markers to the current selection
- When the beat grid is active, markers snap to the nearest beat (hold Shift to drag freely)

## Beat grid & BPM alignment

Click **Use Song (BPM)** to overlay a yellow beat grid on the waveform at the current song tempo. Bar numbers appear along the top.

Use the **1bar / 2bar / 4bar / 8bar** buttons to snap the loop end to exactly that many bars from the loop start.

## Playback controls

| Button | Action |
|--------|--------|
| **▶ Play** | Plays the selection once (or full sample if no selection). If Loop is ON and markers are set, loops between S/E. |
| **⟳ Loop** | Toggles playback looping. Highlighted cyan when on. |
| **■ Stop** | Stops playback and clears the playhead. |

## Edit operations

All edit operations work on the current **selection** (orange region).

| Button | Action |
|--------|--------|
| **Erase** | Zero-fills the selection |
| **Copy / Cut / Paste** | Clipboard operations |
| **Reverse** | Reverses the selection |
| **Trim Silence** | Removes trailing silence from the end of the sample |
| **Trim to Loop** | Crops the sample to the S→E region and resets markers to cover the whole new sample |

## Instrument parameters

Below the waveform, per-instrument settings include:

- **BASE** — the MIDI note at which the sample plays at its natural pitch
- **VOL** — default volume (0–127)
- **LOOP IN / OUT** — loop start and end in samples (editable numerically)
- **TRANS / FINE** — semitone transpose and finetune (±1/8 semitone steps)
- **Seq Loop** — when checked, the sequencer loops this sample between S/E during note playback
- **ATK / DEC / SUS / REL** — AHDSR envelope in milliseconds
