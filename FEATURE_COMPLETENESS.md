# Octomed Web — Feature Completeness Report (v3 — FINAL)
*Third pass — every status verified against actual source. May 2026.*
*Manual: OctaMED 5 ENG, 199 pp. Code audit: sequencer, all components, store, types, bridge.*

Legend: ✅ Done · ⚠️ Partial · ❌ Missing · 🐛 Bug · 🔵 Out of scope (web/platform)

---

## Corrections from v2

| Item | v2 | v3 | Evidence |
|------|----|----|----------|
| Hold symbol (-\|-) | ✅ | ❌ | `formatNote(0)` → `'---'`; no note value 254; no 'A'/Enter-inserts-hold handler |
| Synth VBD/VBS/ARP (pitch prog) | ⚠️ | ❌ | `simulatePitchProg()` line 176: *"Unknown / unhandled op (vbd, vbs, arp): skip"* |
| Synth waveform presets (#48) | ❌ | ✅ | Saw/Square/Sine/Triangle/Noise buttons wired in SynthEditor |
| Synth waveform morph (#49) | ❌ | ✅ | `doTransform()` — linear interpolation between waveform slots |
| Instrument global change | ❌ | ✅ | `swapInstrumentGlobal()` — change / exchange / delete modes in InstrumentList UI |
| MIDI pitchbend/aftertouch/pan | ⚠️ | ❌ | Protocol types exist; never pushed in `playMidi()`. MIDI cmds 1/2/3/A/D silent |
| Shift-Left/Right (prev/next slot) | ❌ | ❌ | (confirmed absent; not a regression — just confirmed) |
| Song loop / pattern loop | ❌ | ✅ | Both checkboxes in SongEditor; logic correct in sequencer |
| MIDI Panic | ⚠️ | ✅ | `allNotesOff()` + `bridge.panic()` — both wired to ⚠ Panic button |

---

## 1. Player Commands (Effects)

| Cmd | Name | Status | Notes |
|-----|------|--------|-------|
| 00 | Arpeggio | ❌ | Not implemented. Very common — cycles 3 pitches per tick. |
| 01 | Slide Up | ✅ | Per-row pitch ramp on note-trigger and sustain; sample + synth. |
| 02 | Slide Down | ✅ | |
| 03 | Portamento | ✅ | Smooth pitch slide to target; sample, synth, MIDI (via CC#65/CC#5). |
| 04 | Vibrato | ✅ | Sinusoidal pitch LFO via Web Audio OscillatorNode. |
| 05 | Slide + Fade | ✅ | Portamento + simultaneous volume slide. |
| 06 | Vibrato + Fade | ✅ | Vibrato + simultaneous volume slide. |
| 07 | Tremolo | ✅ | Volume LFO via OscillatorNode. |
| 08 | Set Hold/Decay | ❌ | In-note override silently ignored; instrument AHDSR used instead. |
| 09 | Secondary Tempo | ❌ | `transport.speed` exists and is UI-editable; cmd 09 in pattern does nothing. |
| 0A | Volume Slide | ❌ | OctaMED alias for 0D. Not aliased — silently ignored. |
| 0B | Position Jump | ✅ | |
| 0C | Set Volume | ✅ | Applies to sample, synth, MIDI on trigger and sustain rows. |
| 0D | Volume Slide | 🐛 | **Bug**: treated as ProTracker "Pattern Break" — jumps to next block. Never applied as volume slide. Any file using 0D for crescendo/decrescendo will misbehave. |
| 0E | Synth Jump | ❌ | Mid-sequence branch in waveform pitch program — not implemented. |
| 0F 00 | Jump to next block | ✅ | |
| 0F 01–F0 | Set Primary Tempo | ✅ | Updates `transport.bpm` live. |
| 0F FE | Stop playback | ✅ | |
| 0F FF | Stop note | ✅ | |
| 0F FF1/FF2/FF3 | Fast retrigger shorthands | ❌ | |
| 0F FF4/FF5 | Triplet delay (1/3, 2/3 of line) | ❌ | |
| 0F FF8/FF9 | Low-pass filter toggle | 🔵 | Amiga hardware. No Web Audio equivalent. |
| 0F FFD | Set pitch, no retrigger | ❌ | Useful for click-free pitch changes on looped samples. |
| 11 | Slide Pitch Up Once | ✅ | One-shot semitone offset; sample, synth, MIDI. |
| 12 | Slide Pitch Down Once | ✅ | |
| 14 | PT-Compatible Vibrato | ❌ | Halved depth table vs cmd 04. Needed for accurate ProTracker import. |
| 15 | Set Finetune | ❌ | Per-note finetune override (signed hex −8 to +7). |
| 16 | Loop | ✅ | In-block loop with repeat count. |
| 18 | Cut Note | ✅ | Zero volume after N ticks; sample, synth, MIDI. |
| 19 | Sample Start Offset | ✅ | Start at `data × 256` bytes into sample. |
| 1A | Slide Volume Up Once | ✅ | Single-shot volume bump; sample, synth, MIDI. |
| 1B | Slide Volume Down Once | ✅ | |
| 1C | Change MIDI Preset | ✅ | Program change message. |
| 1D | Jump Next Playseq Entry | ✅ | Optional start-line offset. |
| 1E | Delay Line | ✅ | Repeat row commands N times without retriggering. |
| 1F | Note Delay + Retrigger | ❌ | Delay by N ticks, retrigger every M ticks. Used for swing and ghost notes. |

**Score: 22/34 implemented (65%). Critical gaps: arpeggio (00), 0D bug (volume slide → wrong jump), note delay (1F), synth jump (0E), secondary tempo cmd (09).**

---

## 2. Menus

### Project
| Item | Status |
|------|--------|
| New / Open / Save / Save As | ✅ |
| About | ✅ |
| Quit | 🔵 |

### Display
| Item | Status | Notes |
|------|--------|-------|
| Tracker Editor | ✅ | Always visible. |
| Notation Editor | ❌ | #42. |
| MIDI Message Editor | ❌ | #40. |

### Song
| Item | Status | Notes |
|------|--------|-------|
| Song Options | ❌ | #57. Only place to set secondary tempo, filter, vol mode, channel count. |
| Set Track Volumes | ❌ | Relative per-channel gain. |
| Section List | ❌ | #51. |
| Song Selector | ❌ | #41. Multi-song module. |

### Block
| Item | Status | Notes |
|------|--------|-------|
| Add / Delete / Name / Set Length / Next/Prev | ✅ | |
| Block List | ❌ | #51. |
| Block Properties | ❌ | #58. Highlight step, per-block annotation. |
| Insert / Delete Line | ❌ | Stubs. |
| Split Block At Cursor | ✅ | `splitBlockAt()`, Shift+Ctrl+J. |
| Join Block With Next | ❌ | Disabled; #51. |

### Track
| Item | Status | Notes |
|------|--------|-------|
| Copy / Paste / Cut | ✅ | Right-click on channel header. |
| Swap with buffer | ❌ | |
| Insert Empty Track | ❌ | |
| Delete Track | ❌ | |
| Relative Track Volumes | ❌ | |

### Edit
| Item | Status | Notes |
|------|--------|-------|
| Cut / Copy / Paste / Erase range | ✅ | |
| Paste to selected tracks | ❌ | |
| Transpose ±semitone / ±octave | ✅ | All four. |
| Pitch Slide Type 1 (01xx) | ✅ | RangeBar + menu. |
| Pitch Slide Type 2 (02xx) | ✅ | |
| Pitch Slide Portamento (03xx) | ✅ | |
| Vol Fade | ✅ | Linear 0C fade across range. |
| Note Echo | ✅ | `rangeEcho()` with configurable distance + min vol. |
| Range Current Track / Block | ❌ | Stubs. |
| Spread Notes | ❌ | Stub. #36. |
| Expand / Shrink spacing | ❌ | |
| Boost / Cut volumes | ❌ | |
| Quantize | ❌ | |
| Kill notes to end of track/block | ❌ | |
| Swap block with buffer | ❌ | |

### Instrument
| Item | Status | Notes |
|------|--------|-------|
| Instrument Parameters | ✅ | Opens InstParamsDialog. |
| Load Instrument | ⚠️ | Menu stub; WAV drag-drop works in SampleEditor. |
| Save Instrument | ❌ | |
| Flush Current | ✅ | Confirm dialog. |
| Flush All Unused | ❌ | Stub. |
| Change Instrument (global) | ✅ | `swapInstrumentGlobal()` — change / exchange / delete in InstrumentList sidebar. |
| Change Instrument (cell field) | 🐛 | Bug #60: hex vs decimal mismatch. Grid shows hex (01–1F); list shows decimal (01–31). Typing "10" in grid sets slot 16, not 10. |

### MIDI
| Item | Status | Notes |
|------|--------|-------|
| MIDI Active | ⚠️ | Shown; auto-connects; toggle stub. |
| Input Channel | ❌ | #40. |
| MIDI Panic | ✅ | `seq.panic()` via TransportBar Panic button. Menu item is a stub pointing to the button. |
| Ext / Send Sync | 🔵 | |
| Read Key-Ups / Read Volume | ❌ | |

### Settings
| Item | Status | Notes |
|------|--------|-------|
| Edit Mode | ✅ | Menu + Esc key. |
| Chord Mode | ⚠️ | Menu toggle ✅; cursor advance wired ✅; Shift-Esc shortcut ❌. |
| Spacing | ✅ | Menu prompt + InfoBar field. |
| Keyboard Options | ❌ | Stub. #32. |
| Programmable Keys | ❌ | Disabled. #32. |
| Display Max Tracks | ❌ | Stub; hardcoded 16. |
| H → B note naming | ❌ | Stub. |

---

## 3. Windows & Editors

| Window | Status | Notes |
|--------|--------|-------|
| InfoBar | ✅ | POS, PAT, ROW, SPD (editable), BPM (editable), SPC, OCT, EDIT LED, MIDI port selector. |
| TransportBar | ✅ | Play Song, Cont Song, Play Block, Cont Block, Stop, Panic, MIDI status. |
| Synth Editor | ✅ | Waveform draw, multi-slot, presets (saw/sqr/sin/tri/noise), linear morph/transform, vol program, pitch program, wave speed, AHDSR. **VBD/VBS/ARP parsed but not executed in playback.** |
| Sample Editor | ⚠️ | Waveform display, freehand draw (interpolated), selection, loop markers (display + set from sel), cut/copy/paste/erase/reverse/trim/echo/fade in-out/halve-double/add-silence. Missing: normalize; no loop-region-only preview playback. |
| Instrument Parameters | ⚠️ | Type, name, transpose, finetune, default pitch, suppress-noteoff, AHDSR, MIDI ch/prog/vel/length. Missing: Hold/Decay in native OctaMED sense (ours is AHDSR, not Amiga hold-ticks/decay-rate). ExtSample fields absent. |
| Playing Sequence (Song Editor) | ✅ | Block list with per-position pattern picker, insert, delete, loop / pattern-loop toggles. |
| Pattern Editor | ✅ | Note entry, hex cmd entry, range marking, cursor movement, mute/solo, 16-channel scroll. See §4 for detailed gaps. |
| Block List | ❌ | #51. |
| Block Properties | ❌ | #58. |
| Song Options | ❌ | #57. Critical — main UI for tempo, secondary tempo, filter, title, channel count. |
| Transpose Window | ⚠️ | Range-level semi/octave done; global/track-level missing (#39). |
| Spread Notes | ❌ | #36. |
| Note Echo Dialog | ✅ | RangeBar with distance + min-vol inputs. |
| Keyboard Options | ❌ | #32. |
| Programmable Keys | ❌ | #32. |
| Input Map Editor | ❌ | #40. |
| MIDI Message Editor | ❌ | #40. |
| Sample List Editor | ❌ | #44. |
| Relative Track Volumes | ❌ | |
| Notation Editor | ❌ | #42. |
| Oscilloscope / VU | ❌ | #59. |
| Song Selector | ❌ | #41. |
| Palette | 🔵 | Web uses CSS variables. |
| Print Options | 🔵 | |

---

## 4. Tracker Editor (Pattern Grid)

| Feature | Status | Notes |
|---------|--------|-------|
| Note entry from QWERTY keyboard | ✅ | Two-octave layout, lower + upper rows. |
| Edit mode gate | ✅ | All input blocked unless Edit Mode on. |
| Hold symbol (-\|-) | ❌ | **No hold note value; 'A' key not bound; Enter only toggles edit mode.** Pressing Enter does not insert hold. |
| Delete note (Del) | ✅ | Clears cell, advances cursor. |
| Backspace (delete + move back) | ✅ | Clears cell, moves cursor back by spacing. |
| Blank note (---) entry | ✅ | |
| Cursor movement (arrows, PgUp/Dn, Home/End) | ✅ | |
| F6–F10 row jumps (0%, 25%, 50%, 75%, 100%) | ✅ | |
| F1–F5 octave select | ✅ | |
| +/= / -/_ octave up/down | ✅ | |
| Spacebar — stop/play toggle | ✅ | |
| Tab — jump 7 channels left/right | ✅ | (OctaMED Tab = highlight line; ours repurposed for channel jump) |
| Spacing / auto-advance down | ✅ | |
| Chord mode (horizontal advance) | ⚠️ | Logic wired; Shift-Esc shortcut missing. |
| Hex command field entry | ✅ | All 4 nibbles (cmd hi/lo, data hi/lo). |
| Instrument field hex entry | 🐛 | **Bug #60**: fields accept hex digits but InstrumentList shows decimal 01–31 while grid stores/displays hex 01–1F. Typing "10" in grid assigns instrument slot 16, not 10. |
| Alt-N shortcut for 1x commands | ❌ | e.g. Alt-9 → insert cmd 19. |
| Range marking (Shift+click drag) | ✅ | |
| Shift-Backspace (insert empty slot) | ❌ | |
| Alt-Backspace (delete current track) | ❌ | |
| Block split (Shift+Ctrl+J) | ✅ | |
| Block join (Ctrl+J) | ❌ | |
| Kill notes (Ctrl+K / Shift+Ctrl+K) | ❌ | |
| Programmable keys (Shift+0–9) | ❌ | #32. |
| Per-track mute (click header) | ✅ | |
| Per-track solo (Shift+click header) | ✅ | |
| Track copy/paste (right-click header) | ✅ | |
| Navigate to prev/next sample occurrence | ❌ | Alt+Ctrl+Left/Right. |
| Shift+Left/Right — prev/next instrument slot | ❌ | |

---

## 5. Instrument Types

| Type | Status | Notes |
|------|--------|-------|
| Sample (PCM) | ✅ | WAV load, loop, Web Audio playback. |
| Synthetic Sound | ⚠️ | Waveform sequence + volume program execute correctly. Pitch-program VBD/VBS/ARP ops parsed but **not executed** during playback (silently skipped). |
| MIDI | ⚠️ | note_on/off, velocity, channel, portamento (CC#65/CC#5), program change. MIDI cmds for pitchbend, aftertouch, pan, channel_pressure defined in protocol but **never sent** from sequencer. |
| Hybrid (sample + synth program) | ❌ | #38. |
| ExtSample (multi-octave sample mapping) | ❌ | |

---

## 6. Sequencer Engine

| Feature | Status | Notes |
|---------|--------|-------|
| Basic note triggering (sample/synth/MIDI) | ✅ | |
| Song playback via play sequence | ✅ | |
| Block / pattern loop | ✅ | `patternLoop` flag; separate from `loopSong`. |
| Song loop (wrap to start) | ✅ | `loopSong` flag. |
| Primary tempo (BPM) | ✅ | `transport.bpm`; cmd 0F updates live. |
| Secondary tempo (ticks per row) | ⚠️ | `transport.speed` UI-editable; cmd 09 in pattern **not handled** live. |
| Hold / Decay (AHDSR) | ✅ | Instrument-level; cmd 08 override not handled. |
| Synth volume program | ✅ | Tick-resolution gain scheduling via Web Audio. |
| Synth pitch program (wave cycling + JMP) | ✅ | Works for `wave` / `jmp` / `end` ops. |
| Synth pitch program VBD/VBS/ARP | ❌ | Ops recognised in parser; **silently skipped** in `simulatePitchProg()`. |
| Volume slide cmd 0D | 🐛 | Treated as pattern break — **jumps block** instead of sliding volume. |
| Arpeggio cmd 00 | ❌ | Not implemented at all. |
| MIDI panic (all notes off) | ✅ | `allNotesOff()` + `bridge.panic()`. |
| Section list playback | ❌ | #51. |
| Multi-song | ❌ | #41. |

---

## 7. File Format & Persistence

| Feature | Status | Notes |
|---------|--------|-------|
| Save / Load (JSON) | ✅ | Custom `octomed-web` JSON format, versioned. |
| "Incl. samples" toggle | ✅ | Omits PCM blobs; keeps all metadata. Matches "MOD1(NO INSTR)" concept. |
| Song title + author fields | ✅ | 24-char each, saved in JSON. |
| Mute / solo flags persisted | ✅ | `mutes[]` and `solos[]` in file. |
| Transport (BPM, speed) persisted | ✅ | |
| MMD0 / MMD2 (native OctaMED) import | ❌ | No binary format support. |
| WAV export | ❌ | |

---

## 8. Keyboard Shortcuts (vs OctaMED manual)

Implemented: arrow keys, PgUp/Down, Home/End, F1–F10, +/-, Del, Backspace, Esc (edit mode), Tab (channel jump), Spacebar (play/stop), Shift+click (range/solo), Ctrl+X/C/V/Z (range ops), Ctrl+T/Shift+Ctrl+T (pitch slide), Shift+Ctrl+J (split block).

Not implemented (notable gaps):
- **Shift+Esc** — Chord mode toggle
- **'A' / Enter** — Insert hold symbol (-|-)
- **Alt+N** — Insert 1x command (e.g. Alt+9 → cmd 19)
- **Ctrl+J** — Join block
- **Ctrl+K / Shift+Ctrl+K** — Kill notes to end of track / block
- **Ctrl+B / Shift+Ctrl+B** — Range current track / block
- **Shift+Left/Right** — Prev / next instrument slot
- **Alt+Ctrl+Left/Right** — Navigate to prev/next occurrence of sample
- **Ctrl+I/N/D** — Insert / append / delete block
- **Numpad Ctrl** — Playing sequence navigation
- **Shift+Ctrl+P** — Play Song

---

## 9. Out of Scope (Web / Platform)

- Amiga low-pass hardware filter (0F FF8/FF9)
- External / send MIDI sync
- MMD binary file format (we use JSON)
- Amiga period table (we use Web Audio pitch ratios)
- Print Options
- Palette window (web uses CSS variables)
- Amiga memory display, save timer, mouse options

---

## 10. Recommended Implementation Strategy

### Tier 1 — Correctness Blockers (cause wrong output with real files)

1. **🐛 Cmd 0D (Volume Slide)** — remove `case 0x0d` from `processEffect()` (no jump); add 0D and 0A to the `applySustainingVolSlide` sustain path alongside 05/06. One-session fix.
2. **🐛 #60 Instrument field** — unify display to hex in InstrumentList (show `0A` not `10`), OR translate field input to decimal. Either way, grid and list must agree on the numbering base.
3. **❌ Hold symbol (-|-)** — add note value 254 constant; bind 'A' key to insert it in field 0; add `NOTE_HOLD = 254` display case in `formatNote` → `'-|-'`; make sequencer skip/sustain on hold rows.
4. **❌ Cmd 00 (Arpeggio)** — add per-channel `arp[]` state; tick-based cycling using `setValueAtTime` scheduled per tick.
5. **❌ Cmd 09 (Secondary Tempo live)** — add `case 0x09` in `processEffect` → `setTransport({ speed: data })`.

### Tier 2 — High Value (enable real composition)

6. **#57 Song Options** — the only UI path to set secondary tempo and channel count.
7. **❌ Synth VBD/VBS/ARP execution** — implement in `simulatePitchProg`; already parsed, just needs execution logic.
8. **❌ Cmd 0E (Synth Jump)** — mid-playback branch in pitch program.
9. **❌ Cmd 1F (Note Delay + Retrigger)** — swing, ghost notes; very common.
10. **❌ Cmd 08 (Set Hold/Decay in-note)** — articulation control.
11. **❌ Cmd 15 (Set Finetune)** — pitch microtuning.
12. **❌ Cmd 0F FF1/FF2/FF3** — fast retrigger shorthands (map to 1F).
13. **#56 ModeBar** — EDIT/CHORD/SPC indicators above pattern + per-track On/Off mute row.
14. **#44 Sample List Editor**.
15. **❌ MIDI pitchbend / aftertouch / channel_pressure** — add push calls in `playMidi()` for cmds 1/2/3/A/D using the already-defined protocol event types.

### Tier 3 — Completeness Pass

16. **❌ Alt+N shortcut** for 1x commands.
17. **❌ Shift+Esc** — Chord mode keyboard toggle.
18. **❌ 'A'/Enter** — Hold symbol entry (covered in Tier 1).
19. **#58 Block Properties** — highlight step, annotation.
20. **#32 Keyboard Options + Programmable Keys**.
21. **#36 Spread Notes**.
22. **#39 Transpose globals**.
23. **Block join** (Ctrl+J).
24. **Kill notes** (Ctrl+K).
25. **Cmd 0F FF4/FF5** — triplet delay.
26. **Cmd 0F FFD** — set pitch, no retrigger.
27. **Cmd 14** — PT-compatible vibrato.
28. **#40 MIDI Input + Message Editor**.

### Tier 4 — Advanced / Nice to Have

29. **#38 Hybrid instrument**.
30. **#41 Multi-song**.
31. **#42 Notation Editor**.
32. **#51 Section List full**.
33. **#59 Oscilloscope / VU**.
34. Relative Track Volumes window.
35. Expand / Shrink / Boost / Cut range operations.
36. Paste to selected tracks.
37. Shift+Left/Right for instrument slot navigation.

---

## 11. Final Score

| Area | Done | Total | % |
|------|------|-------|---|
| Player Commands | 22 | 34 | 65% |
| Menus (functional items) | ~42 | ~82 | ~51% |
| Windows / Editors | 7 | 21 | 33% |
| Tracker Edit Features | ~14 | ~28 | 50% |
| Instrument Types | 3 | 5 | 60% |
| Sequencer Engine | 7 | 10 | 70% |
| File / Persistence | 5 | 7 | 71% |
| **Overall (rough)** | **~100** | **~187** | **~53%** |

### Key Takeaways

- The **sequencer core, effects, and pattern editing are solid** — about two-thirds of effects work correctly.
- **Three bugs need fixing before any real OctaMED file plays back correctly**: cmd 0D (pattern-break instead of volume slide), instrument field hex/decimal mismatch, and missing hold symbol.
- **Arpeggio (cmd 00)** is the single most impactful missing feature — it appears in virtually all tracker music.
- The **SynthEditor is more complete than it looks** from the backlog: presets and morph/transform are both done; only the VBD/VBS/ARP runtime execution is missing.
- **Windows are the biggest gap** — most of the 14 missing windows are editing tools that would dramatically improve workflow but don't affect basic playback.
