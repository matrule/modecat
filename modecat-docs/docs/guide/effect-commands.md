# Effect Commands

Effect commands are two-byte hex codes entered in each cell's `CMD` and `DATA` fields. They modify note playback during that row and, in some cases, continue to affect subsequent rows until a new command overrides them.

## Entering a command

In the pattern grid, navigate to a cell and press `Tab` to move the cursor to the `CMD` field. Type the two-character hex code (e.g. `0C`), then type the two-character data value. Use `--` in either field for "none/zero."

## Command reference

| Code | Name | Data (`xx`) |
|------|------|-------------|
| `00` | Arpeggio | High nibble `x` = +x semitones, low nibble `y` = +y semitones per tick |
| `01` | Slide up | Speed — pitch rises by `xx` units per tick |
| `02` | Slide down | Speed — pitch falls by `xx` units per tick |
| `03` | Portamento | Speed toward target note; target is the note in the same cell |
| `04` | Vibrato | High nibble = speed, low nibble = depth |
| `05` | Portamento + vol slide | Continues portamento while sliding volume |
| `06` | Tremolo | High nibble = speed, low nibble = depth |
| `0A` | Volume slide | High nibble = up speed, low nibble = down speed |
| `0B` | Position jump | Jump to song position `xx` |
| `0C` | Set volume | `00`–`64` (100 = full) |
| `0D` | Volume slide (alt) | High nibble = up, low nibble = down |
| `0F` | Misc | `01`–`1F` = ticks-per-row · `20`–`F0` = BPM · `FE` = stop · `FF` = cut note |
| `10` | MIDI send | Send MIDI program change to slot `xx` |
| `11` | Note up | Shift note up `xx` semitones, one-shot |
| `12` | Note down | Shift note down `xx` semitones, one-shot |
| `16` | Pattern loop | `00` = set loop start; `nn` = jump back to start and repeat `n` times |
| `18` | Note cut | Cut note after `xx` ticks |
| `19` | Sample offset | Start sample playback at `xx` × 256 samples from the beginning |
| `1A` | Vol slide up (fine) | Precise per-row upward volume nudge |
| `1B` | Vol slide down (fine) | Precise per-row downward volume nudge |
| `1C` | MIDI program change | Send program change on channel of instrument slot `xx` |
| `1D` | Block break to row | End block early; next block starts at row `xx` |
| `1E` | Line repeat | Repeat current row `xx` times before advancing |

## Notes

- **`0F` — Misc**: Values `01`–`1F` change the tick rate (lower = faster). Values `20`–`F0` set the BPM directly. `FE` stops playback; `FF` cuts the current note.
- **`03` Portamento**: You need a note in the same cell to set the target pitch. Put the note in the note field, leave the instrument field empty (or the same instrument), and the effect will glide from the previous pitch.
- **`16` Pattern loop**: Place `16 00` at the row you want to jump back to, then `16 nn` (where `nn` > 0) at the row where you want the loop to fire. This is a within-block loop, not a song-level loop.
- **`19` Sample offset**: The playback position in samples is `xx` × 256. Useful for jumping to the second half of a long sample or triggering a specific hit within a layered drum one-shot.
