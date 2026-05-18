# Octomed Web — backlog & handover

This file is a handover snapshot from the initial build. A new
session (e.g. Sonnet) should be able to read this plus `README.md` and pick up
without re-deriving context.

---

## What's already built

A web-based ModeCat-style tracker, React + Vite + TS, in this folder. See
`README.md` for the full feature set and run instructions. In short:

- 16-track pattern editor with sticky header, mute/solo, keyboard-driven
  cursor, horizontal scroll
- Song / playlist mode (named patterns, position list, Loop / Pattern Loop)
- Three instrument kinds: sample, MIDI, synth (32-step waveform + AHDSR)
- Sequencer with lookahead scheduling, song advancement, panic, FFF / FFE /
  F00 handling, volume command `0Cxy` rescaled 0–64 hex → MIDI 0–127
- Range selection (shift-click) + Cut/Copy/Paste/Clear, Transpose ½/Octave,
  Vol Fade, Echo
- Block ops: Split at cursor
- Global instrument swap: Change / Exchange / Delete
- Chord-mode toggle (notes advance horizontally instead of vertically)
- JSON save / load with base64-encoded PCM and synth waveforms
- WebSocket bridge protocol spec for the local MIDI bridge (see
  `BRIDGE_API.md`); web app runs in silent-MIDI fallback when no bridge is
  connected

Workbench-1.x palette (`#0055AA` / `#FFFFFF` / `#FF8800` / black), VT323
pixel font, chunky bevel borders.

---

## UAT results so far

Two UAT rounds were run against the ModeCat manual, and one round against
the Amiga Format "ModeCat" tutorial series (Ed Wiles, 4 parts) at
`outputs/afmedtut.txt`.

### Manual UAT — keystroke level (10 scenarios)

1 pass on first read, 9 fixed in-pass, 1 deferred (2-digit command schema).

### Manual UAT — workflow level (10 scenarios)

2 pass on first read, 6 fixed in-pass (range ops, transpose, fade, echo,
split block, chord toggle, global instrument swap), 1 deferred (auto-slide,
because it needs effect `03` running in the sequencer).

### Tutorial UAT (10 scenarios from AFmedtut)

| # | Scenario                                        | Verdict   | Blocked by    |
|---|-------------------------------------------------|-----------|---------------|
| 1 | Enter notes via keyboard + Edit mode            | ✅ Pass   |               |
| 2 | Copy-paste a block, chain into Play Sequence    | ✅ Pass   | —             |
| 3 | Space Mode auto-skip every 2nd row              | ✅ Pass   | —             |
| 4 | Manage sample directory via Sample List Editor  | ❌ Fail   | #44           |
| 5 | Set per-instrument Default Pitch, enter via F   | ✅ Pass   |               |
| 6 | Enter `0FFF` stop-note effect                   | ✅ Pass   |               |
| 7 | Enter `0452` vibrato                            | ✅ Pass   |               |
| 8 | Pitch Slide → Type 1 auto-creates `03xx` cells  | ✅ Pass   |               |
| 9 | Mark range on sample waveform, play just range  | ❌ Fail   | #34           |
| 10| Build synthsound, add `CHD 03` volume program   | ✅ Pass   |               |

Tutorial score (original): 1 clean pass / 2 partials / 7 fails.
Updated (after #47): 2 clean passes / 1 partial / 7 fails.
Updated (after #29+#31): 7 clean passes / 0 partials / 3 fails (#33 partial / #34 / #44)

---

## Backlog (priority order)

The numbers are the task IDs from the previous session's TaskList. They
don't need to be preserved as IDs — what matters is the order.

### Tier 1 — workflow blockers

1. ~~**#27 — Cell schema upgrade.**~~ ✅ **Done.** `PatternCell.cmd` widened
   to a byte; cursor field 6 added; column template 11→12ch; JSON bumped
   to `version: 2` with v1 load compatibility in `persist.ts`.
2. ~~**#28 — 1x effect family in sequencer.**~~ ✅ **Done.** `16` Loop,
   `18` Stop Note at pulse (Web Audio precise), `19` Sample offset,
   `1A`/`1B` one-shot volume slides, `1C` MIDI preset change, `1D`
   Jump-to-next-block-at-line, `1E` Play-line-N-times, `11`/`12` one-shot
   pitch shifts. `1F` (delay+retrigger) and `15` (finetune) stubbed pending
   #29/#31.
3. ~~**#29 — Tone portamento + vibrato + tremolo (`03` / `04` / `05` / `06` /
   `07`).**~~ ✅ **Done.** Fully implemented in `sequencer.ts`: `attachPitchLFO`
   (OscillatorNode → playbackRate) for 04/06 vibrato; `attachVolumeLFO` for 07
   tremolo; `portaActive`/`portaTarget`/`portaDir` per-channel state for 03/05
   portamento in `playSample`, `playSynth`, and sustaining path; combined 05/06
   volume-slide + portamento/vibrato in sustaining and note-trigger paths. MIDI
   portamento via CC#65 + CC#5.
4. ~~**#30 — Auto-slide tools.**~~ ✅ **Done.** RangeBar now has a **Slide**
   section: **Spd** input (1–255) + **Slide▲** (01xx) / **Slide▼** (02xx) /
   **Porta** (03xx) buttons that fill intermediate cells between the first and
   last note in the selected range. Sequencer: `01`/`02` ramp `playbackRate`
   (or synth rate) over each row's duration for both sustaining and note-trigger
   cells; `tStart` hoisted to function scope in `triggerSampleSource` to
   eliminate the scoping conflict.
5. ~~**#31 — Per-instrument Transpose / Finetune / Default Pitch.**~~ ✅ **Done.**
   Added `transpose` (semitones, confirmed as "0/0" display in Instrument Parameters
   screenshot) and `finetune` (-8..+7) per instrument slot for all three kinds
   (sample/MIDI/synth), plus a `defaultPitch` field (0..127) and a **Suppress NoteOff**
   checkbox — when enabled, the instrument ignores note-off events and plays to
   completion (essential for one-shot percussion; confirmed in Instrument Parameters
   screenshot). Sequencer applies `transpose + finetune/8` to all three instrument
   kinds at note-on; `suppressNoteOff` skips the note-off event for MIDI and the
   `cutChannel` call for sample/synth playback. All fields persisted in JSON v2.

### Tier 2 — productivity / composition velocity

6. ~~**#34 — Sample editor: PCM edit operations.**~~ ✅ **Done (core ops).**
   Click+drag on the waveform canvas to mark a range (orange highlight). Toolbar:
   **Erase** (zero-fill), **Cut** (splice to clipboard, buffer shrinks), **Copy**,
   **Paste** (insert clipboard at sel start, buffer grows), **Reverse**, **Trim**
   (strip trailing silence). **Expand** appends N zero-samples. **Echo** mixes
   N decaying copies of the selection at `rate`-sample stride (Vol−% per copy).
   Remaining from original ticket scope (deferred): Change Volume dialog (Fade
   In/Out/Halve/Double), Change Pitch, Sample↔Buffer scratch pair, loop-mode
   controls (Loop Point / fine-nudge markers).
7. ~~**#33 (core) — Multi-waveform synth + pitch program.**~~ ✅ **Done (B07).**
   - `SynthInstrument.waveforms: Float32Array[]` replaces old single `waveform`.
   - `SynthInstrument.pitchProg: PitchProgLine[]` + `waveSpeed: number` added.
   - `parsePitchProg` / `pitchProgToText` helpers in `types.ts`.
   - `renderSynthBuffer` pre-renders a finite buffer from the pitch program
     simulation (`simulatePitchProg`), replacing the old looping single-waveform
     approach. Handles `wave`, `jmp`, `end`; skips unknown ops.
   - `SynthEditor.tsx` rewritten: waveform bank nav (◀ NN/MM ▶, +/−), presets
     (Saw/Sqr/Sin/Tri/Nse) per slot, linear **Do Transform** (fills in-between
     slots), pitch program textarea, waveSpeed input.
   - `InstrumentList.tsx` double-click creates synth with `waveforms: [defaultWaveform()]`.
   - JSON persisted via `persist.ts` (already done; back-compat for old `waveform`
     single field).

   **Remaining #33 scope (deferred to later tickets):**
   - ~~Volume program (CHU/CHD/WAI/JMP/HLT per tick).~~ ✅ Done (B08). `volProg: PitchProgLine[]`
     on `SynthInstrument`; `simulateVolProg` pre-renders a per-tick gain curve (0–64 ModeCat scale);
     `playSynth` schedules `setValueAtTime` when volProg non-empty, falls back to AHDSR otherwise.
     `SynthEditor` exposes a green **VOL PROG** textarea (placeholder shows the B08 swell example).
   - Independent per-program speed gadgets (`Volume [N]` vs `Wave [N]`).
   - ~~ARP / ARE arpeggio in pitch program (B10).~~ ✅ Done. `inst.pitchProg` is scanned in
     `playSynth` for `arp` ops; offsets are scheduled as tick-stepped `setValueAtTime` calls on
     `src.playbackRate` over the full note duration (does not conflict with cmd 00xx arpeggio).
   - ~~VBD / VBS vibrato in pitch program (B09).~~ ✅ Done. `playSynth` scans `inst.pitchProg`
     for `vbd`/`vbs` ops; if both are non-zero and cmd 04/06 is not in use, calls `attachPitchLFO`
     using the program-defined depth and speed. Command vibrato (04/06) takes priority.
   - ~~Synth waveform range Cut/Copy/Paste/Clear, Double, Reverse.~~ ✅ Done. `SynthEditor` now
     has a **WAVE:** operations row below the preset buttons: **Cut** (copy + zero-fill), **Copy**,
     **Paste** (disabled when clipboard empty), **Clear** (zero-fill), **Double** (insert duplicate
     slot after current), **Reverse** (flip sample order). Internal `waveClip: Float32Array | null`
     state; no store changes needed.
   - `< Mix` / `< Add` (scratch waveform operations) — still open.
8. ~~**#32 — Programmable Keys editor.**~~ ✅ **Done.** 10-slot table
   (Shift+0..9) in `ProgKeysDialog.tsx`. Each slot stores note, instrument,
   cmd, data. Shift+digit in the pattern editor (field 0) inserts the
   programmed values at the cursor. `progKeys` array and `setProgKey` action
   added to store. Dialog opened from Settings → Programmable Keys….
9. ~~**#36 — Rest of the Range Panel.**~~ ✅ **Done.** Added:
   - **Paste+Ch** — paste with a channel offset (Ch± input) via
     `rangePasteChOffset` store action.
   - **Spread ×2/3/4** — distributes triggered notes in the range cyclically
     across N adjacent channels starting from `range.startCh`, via
     `rangeSpread` store action.
10. ~~**#37 / #47 — Block Panel finish.**~~ ✅ **Done.** `Copy Blk` / `Paste Blk`
    buttons in SongEditor copy/paste all rows × channels of the active pattern.
    Track copy/paste via right-click on channel headers (per-channel clipboard,
    independent of block clipboard). `+ Pos` now inserts the *current* pattern
    id rather than always defaulting to pattern 0. Remaining from original
    ticket scope: `NEW HERE` (insert block at cursor position in sequence),
    `JOIN` (merge two adjacent blocks), named blocks with section markers
    (#51). These can be addressed incrementally.
11. ~~**#35 — Variable block size.**~~ ✅ **Done.** `pattern.rows.length` is
    now the sole source of truth for block length (1..3200). A **Len** number
    input in the Block panel edits the active pattern's length; the Patterns
    list shows each pattern's row count as a read-only badge. `splitBlockAt`,
    `pasteBlock`, cursor navigation (End/F7-F10/field-6 wrap), and the sequencer
    row-advancement all use `pattern.rows.length`. `ROWS_PER_PATTERN` (64)
    retained as the default only.
12. ~~**#48 — Synth waveform presets.**~~ ✅ **Done.** Saw/Sqr/Sin/Tri/Nse
    one-click preset buttons already live in `SynthEditor.tsx` via `makePreset`
    + `applyPreset`.
13. ~~**#49 — Synth waveform transformation (morph).**~~ ✅ **Done.** `xformFrom`
    / `xformTo` inputs + Do Transform button using `lerpWaveform` already
    implemented in `SynthEditor.tsx`.
14. ~~**#50 — Instrument-level sample loop controls.**~~ ✅ **Done.**
    Added `loopEnabled: boolean` to `SampleInstrument` in `types.ts`.
    Sequencer `playSample` sets `src.loop`, `src.loopStart`, `src.loopEnd`
    (in seconds) when `loopEnabled` is true. `InstParamsDialog` `SampleSection`
    exposes a Loop On checkbox and greys out Start/End inputs when off.
    `persist.ts` defaults `loopEnabled` to false for older saves.

### Tier 3 — coverage / parity / niceties

15. ~~**#38 — Hybrid instrument type.**~~ ✅ **Done.** `HybridInstrument`
    type added to `types.ts` (sample PCM + synth AHDSR/pitchProg/volProg).
    `persist.ts` serialises/deserialises hybrid instruments. Sequencer
    `playHybrid()` plays the PCM buffer pitched at `cell.note` with gain
    shaped by `volProg` or AHDSR envelope; pitchProg VBD/VBS vibrato applied.
    `InstParamsDialog` exposes a Hybrid section (sample fields + envelope);
    `InstrumentList` shows `HYB` badge. Portamento continuation guards updated.
16. ~~**#39 — TRANSPOSE PANEL globals.**~~ ✅ **Done.**
    `playTranspose: number` field added to the store; the sequencer snapshots
    it each tick and applies a clamped semitone offset in `triggerCell` before
    dispatching to playMidi/playSample/playSynth/playHybrid — entirely
    non-destructive. `ModeBar` exposes a `Trnsp=` −/value/+ cluster (orange
    when non-zero, click value to reset). `RangeBar` gains a Note section with
    From/To MIDI inputs and **Change→** / **Exchange↔** buttons
    (`rangeNoteChange` / `rangeNoteExchange` store actions) for destructive
    note-pitch replacement within the active range or full pattern.
17. ~~**#40 — MIDI Messages store + Input Map.**~~ ✅ **Done (phase 1).**
    `MidiMessage { name, bytes }` type added to `types.ts`; 16-slot
    `midiMessages` array in the store with `setMidiMessage` action. Effect
    command **10xx** (xx = slot 0–F) fires the raw byte sequence via the
    bridge during playback. `MidiMessagesDialog` (Instrument → MIDI Message
    Editor…) lets the user name each slot and enter bytes as space-separated
    hex with a human-readable preview (Note On/Off, CC, PitchBend, SysEx…).
    `midiMessages` serialised to SongFile v2; missing on load defaults to
    the 16 named-but-empty stubs. MIDI Input Map (#40 phase 2) deferred.
18. ~~**#44 — Sample List Editor (directory browser).**~~ ✅ **Done.**
    `SampleListEditor` dialog (Instrument → Sample List Editor…). Primary
    path uses File System Access API (`showDirectoryPicker`) — available in
    Chrome/Edge — to enumerate a folder and list all recognised audio files
    (WAV, AIFF, MP3, OGG, FLAC…). Fallback uses `<input webkitdirectory>`
    for Firefox. Each file has a **→ slot** button that decodes via
    `AudioContext.decodeAudioData` (stereo-mixed to mono if needed) and
    writes a `SampleInstrument` into the chosen slot; the target slot
    auto-advances after each load for fast sequential batch-loading.
    Source/status displayed in the toolbar; dialog integrated with MenuBar
    `onSampleList` prop and rendered from App.tsx.
19. ~~**#45 — Auto-space entry `SPC=N`.**~~ ✅ **Done.** Configurable cursor advance N
    (1..16) after entering a note. Spc= input in ModeBar; store field `spcN`; sequencer and
    PatternEditor both honour it. Confirmed working.
20. ~~**#46 — Save without instruments.**~~ ✅ **Done.** An **Incl. samples**
    checkbox in SaveLoadBar (defaults on) controls whether PCM blobs are included
    in the exported JSON. When off, sample instruments save with `pcm: null` (all
    other metadata preserved); synth waveforms are always saved (32 floats).
    Parallel of `MOD1(NO INSTR)` in the manual.
21. ~~**#51 — Playing Sequence sections.**~~ ✅ **Done.** `SectionMarker { beforePos, name }`
    added to `Song` type. Store actions: `insertSection`, `deleteSection`, `renameSection`.
    `insertSongPosition` / `removeSongPosition` / `splitBlockAt` all update marker indices
    correctly. `SongEditor` renders markers as dark-blue labelled bars interleaved in the
    position list; inline rename input in-place. Three buttons: **New Sec** (before current pos),
    **New Sec End** (after all positions), **Del Sec** (removes marker above current pos).
    Backward-compat: old saves without `sectionMarkers` default to `[]` on load. TypeScript clean.
22. ~~**#41 — Multi-Song Module.**~~ Deferred — out of scope for web build. One file
    containing several songs; no clear web-native equivalent without full project management UI.
23. ~~**#42 — Graphic Notation Editor.**~~ **DONE** — VexFlow SVG-backend
    treble-clef notation in an MDI floating window. Per-channel channel
    toggles (click=solo, Shift+click=multi), configurable rows/bar time
    signature, quarter-note/rest rendering, channel labels. Opened via
    "Notation…" button in TransportBar.
24. ~~**#43 — Notation Editor note entry.**~~ **DONE** — Left-click a staff
    position to place a note (MIDI pitch derived from diatonic Y position
    relative to treble-clef top staff line). Right-click to erase. Both
    sync instantly to the tracker grid via the Zustand store. Cursor overlay
    (orange vertical bar) tracks the current pattern row. Edit mode must be
    active (Ins key in tracker). Tested via `npm test`.
25. ~~**#43b — MIDI import notation rendering fix.**~~ **DONE** — Three bugs
    fixed: (1) Time signature showed `rowsPerBar/4` (e.g. 24/4) instead of
    musical `beatsPerBar/4` (4/4). Fixed by separating `beatsPerBar` state
    (from MIDI timeSigNum) from `rowsPerBar` (rpb × beatsPerBar). (2) VexFlow
    Voice `numBeats/beatValue` now derived from RPB: RPB=1→q(4/4), RPB=2→8(8/8),
    RPB≤4→16(16/16), RPB≥5→32(32/32); strict=false handles triplet RPBs (3,6,12)
    where notes don't sum exactly to one bar. (3) Rendering 133+ bars for a
    3200-row pattern was freezing the browser. Added `MAX_DISPLAY_BARS=64` cap
    with an amber warning banner: "Showing first 64 bars — pattern has more rows
    than the notation view can display." Hit-map capped to match. TypeScript clean.

26. ~~**#43c — MIDI import 16/12 grid analysis + notation UX improvements.**~~ **DONE.**
    - **midiImport.ts**: Replaced `suggestRpb` with `suggestGrid(cleanTicks, ppq,
      timeSigNum)`. Collects all note-on ticks across all tracks, checks each
      against 16th-note grid (step = PPQ/4) and 8th-triplet grid (step = PPQ/3)
      with a tolerance of max(1, PPQ/192). If > 5% of ticks fit the triplet grid
      exclusively → recommends 12 rows/bar (rpb=3); otherwise → 16 rows/bar (rpb=4).
      Warns in the import log when time signature or BPM is missing and defaults
      to 4/4 / 120 BPM. Added `suggestedRowsPerBar: number` to `ImportResult`
      (= rpb × timeSigNum).
    - **MidiImportDialog.tsx**: Quantize dropdown now shows rows/bar values
      `[4, 8, 12, 16, 24, 32, 48]` (was rows/beat). State and settings renamed
      from `rpb` to `rowsPerBar` throughout. Conversion `onReparse(v / timeSigNum)`
      at the call boundary (parseMidiFile still accepts rows/beat internally).
      Import log shows "16 rows/bar" or "12 rows/bar" recommendation.
    - **NotationEditor.tsx**: Added **[16]** and **[12]** quick-preset buttons to
      the notation header; active state highlighted when rowsPerBar matches.
      Channel switcher changed from shift-click multi-select to **single-select
      only** — one channel displayed at a time for clarity. `handleMidiImport`
      now reads `rowsPerBar` directly from settings (no more rpb→rows conversion
      at the call site). TypeScript clean.

27. ~~**Performance & audio quality — scheduler and PatternEditor fixes.**~~ **DONE.**

    **Root causes identified (via code audit):**
    - `PatternEditor` subscribed to `transport` (entire object), causing `rows.map` to
      re-render all rows on every `transport.row` change — 40 full re-renders/sec at
      120 BPM, with a 3200-row pattern × 16 channels = 51,200 CellView nodes reconciled
      each time. This saturated the main thread and caused the audio scheduler's
      `setInterval` to fire late, dropping notes.
    - `tick()` called `useStore.getState()` on every iteration of the 80ms lookahead
      while-loop, plus 16 more calls inside `scheduleRow` via `isAudible(ch)`, plus
      an O(n) `patterns.find()` per iteration.
    - Sample/synth note-on had no attack envelope: `gain.gain.value = v64` is an
      instantaneous step from 0 → volume, producing a Dirac impulse (broadband click).
      `cutChannel` called `source.stop()` abruptly, clicking on note-off too.

    **Fixes applied:**

    *sequencer.ts — click elimination:*
    - **3ms linear attack ramp** on sample note-on: `gain.gain.setValueAtTime(0, tStart)`
      → `gain.gain.linearRampToValueAtTime(v64, tStart + 0.003)`. Volume slide
      automation continues the ramp curve naturally.
    - **10ms exponential release** on `cutChannel`: `gain.gain.setTargetAtTime(0, now,
      0.002)` then `source.stop(now + 0.020)` — prevents click on note cut. Synth
      notes already had AHDSR envelope starting at 0, so no change needed there.

    *sequencer.ts — scheduler efficiency:*
    - `useStore.getState()` snapshotted once per `tick()` call; `patterns` built into
      a `Map<id, Pattern>` for O(1) lookup; `isAudible` pre-computed as a `boolean[]`.
    - Inside the while-loop only `transport` is re-read (so live BPM/speed changes
      from Fxx effect commands are still picked up).
    - `scheduleRow` accepts `isAudible: boolean[]` parameter; no longer reads from
      store per-channel.

    *PatternEditor.tsx — playhead decoupled from React render cycle:*
    - `transport` subscription narrowed to `transport.playing` only (boolean).
      `transport.row` changes **no longer trigger React re-renders**.
    - `useStore.subscribe((state, prev) => {...})` (non-hook Zustand API) listens for
      `transport.row` / `transport.playing` changes and directly calls
      `el.classList.add/remove('is-playhead')` + `scrollIntoView` on the DOM node.
      Zero React reconciliation per row tick during playback.
    - `useLayoutEffect` (no deps) re-applies the class after any React render that
      would otherwise overwrite it (e.g. cell edit during playback).
    - `rows.map` className no longer includes `is-playhead`; comment documents intent.

    **Now fixed — see #48 below.**

28. **#48 — PatternEditor row virtualisation** ✅ **Done.**

    `PatternEditor` now renders only the rows currently visible in the scroll
    viewport plus a configurable overscan buffer (12 rows above/below). Top and
    bottom `<div>` spacers carry the full scroll height so the scrollbar behaves
    correctly for patterns with thousands of rows.

    Key details:
    - `ROW_H = 18` (matches CSS `.pattern__row { height: 18px }`).
    - `OVERSCAN = 12` — rendered window is `viewport rows + 24`.
    - `visWindow` React state `{ start, end }` only updates when the boundaries
      actually change, so scrolling through a large pattern generates at most
      one `setState` call per window shift rather than one per pixel.
    - Playhead DOM mutation still works: if the target row is outside the rendered
      window, `scrollContainerToRow()` imperatively scrolls the container, which
      fires `handleScroll → setVisWindow → re-render`. A `pendingPlayheadRef`
      stores the target row and `useLayoutEffect` applies `is-playhead` once the
      row div appears in the DOM.
    - Cursor keyboard navigation (Home/End/PageUp/PageDown) also uses
      `scrollContainerToRow()` as fallback when the target row isn't rendered.
    - Pattern switch (`songPos` change) resets `scrollTop` and `visWindow` to
      avoid stale window coordinates.

    **Required change:** Replace `pattern.rows.map(...)` with a windowed renderer:
    - Fixed row height (CSS `--row-h`); outer div has `overflow: auto` + total height
      `numRows × ROW_H` (so the scrollbar is correct).
    - `onScroll` computes `startIdx = Math.floor(scrollTop / ROW_H)`.
    - Only render rows in `[startIdx - BUFFER … startIdx + viewportRows + BUFFER]`.
    - Pad above with `<div style={{ height: startIdx * ROW_H }}/>` and below with
      a matching bottom spacer.
    - Playhead DOM mutation subscribe still works — `querySelector('[data-row="N"]')`
      will return null for off-screen rows; `scrollIntoView` then brings the row into
      the viewport, the scroll handler fires, and the row renders and gets the class
      applied by the `useLayoutEffect`.

24. **#62 — Sample Editor: Resample (speed/pitch change).** ModeCat's
    "Resample" operation resamples the PCM to a new sample count via linear
    (or cubic) interpolation — shorter = higher pitched + faster, longer =
    lower + slower. Like varispeed on a tape machine; pitch and speed change
    together. Implementation: new dialog panel in `SampleEditor.tsx` alongside
    Echo / Change Volume / Expand, with two input modes: (a) target sample
    count, (b) percentage of current length (e.g. 50% = half the samples = one
    octave up). Apply to selection if active, otherwise whole sample. No
    external dependencies — pure typed-array math.

### Tier 4 — V5 UI alignment (new tier, agreed with user May 2026)

The overall goal is to align the layout and chrome with ModeCat V5.0 as
documented in the manual and the ModeCat Basics Part 1 tutorial. The user
wants to keep 16-track layout and the MDI expand behaviour on the Sample
Editor; everything else should move toward V5 conventions.

Reference: `Octamed 5 - Manual-ENG.pdf` (uploaded), especially the full
menu documentation (Project / Display / Song / Block / Track / Edit /
Instrument / MIDI / Settings menus) and the upper-screen layout described
throughout the manual.

24. ~~**#52 — Amiga-style menu bar.**~~ ✅ **Done.** `MenuBar.tsx` replaces
    `TitleBar`. Nine dropdown menus (Project / Display / Song / Block / Track /
    Edit / Instrument / MIDI / Settings) with Workbench 1.x styling (white on
    blue bar, inverted highlight on hover, bevel-shadow dropdown). All live
    actions wired; future items stubbed with `alert()`. `modecat.css` updated
    with `.menubar` / `.menubar__dropdown` / `.menubar__item` / `.menubar__sep`
    rule-sets. TypeScript clean (tsc --noEmit). Menus and their items (sourced from V5 manual):

    - **Project:** New, Open…, Save, Save without instruments, About
    - **Display:** Tracker Editor, Synth Editor…, Sample Editor…,
      Sample List Editor… (#44)
    - **Song:** Playing Sequence…, Set Options…, Set Volumes…,
      Set Annotation (title/author)
    - **Block:** New/Insert, New/Append, Set Properties…, Block List…,
      Cut/Copy/Paste/Swap, Insert Line, Delete Line, Expand/Shrink,
      Split At Cursor, Join With Next (#51)
    - **Track:** Cut, Copy, Paste, Swap w/Buff, Insert Empty, Delete
    - **Edit:** Cut/Copy/Paste/Erase Range, Transpose…, Pitch Slide
      (Type 1 / Type 2), Spread Notes…, Note Echo…, Generic Slide…
    - **Instrument:** Set Parameters…, Load Instrument(s)…, Save
      Instrument, Flush Current, Flush All Unused
    - **MIDI:** MIDI Active (toggle bridge), Input Channel…, Send MIDI
      Reset (Panic), Ext Sync / Send Sync
    - **Settings:** Keyboard Options…, Programmable Keys… (#32),
      Display Max Tracks (4/8/16), H→B note-naming toggle

25. ~~**#53 — Transport row restructure.**~~ ✅ **Done.** `TransportBar.tsx`
    added directly below the MenuBar. Left cluster: Play Song / Cont Song /
    Play Block / Cont Block / ■ Stop. Middle: MIDI status indicator box (M
    flag, orange when bridge connected) + Edit / Chord / Spc toggles. Right:
    Edit SynthS… / Edit Sample… (switch right panel for now; MDI in #55) +
    Panic. Footer reduced to SaveLoadBar only. `ButtonCluster` removed from
    App layout. Play Block sets `patternLoop: true` + resets row to 0;
    Cont Block sets `patternLoop: true` + resumes from cursor row. TypeScript
    clean.

26. ~~**#54 — Status + position row.**~~ ✅ **Done.** `InfoBar.tsx` replaces
    `StatusPanel`. Two-sub-row layout: Row 1 shows ■ STOP / ▶ PLAY indicator,
    POS/PAT/ROW pills, SPD/BPM/SPC editable inputs, OCT pill, EDIT LED, and
    MIDI port selector. Row 2 shows read-only Sg (song pos) / Sc (sequence
    length) / B (active block id) / Trks (always 16). CSS: `.info-bar`,
    `.info-bar__row`, `.info-bar__row--secondary`. TypeScript clean.

27. ~~**#55 — MDI floating windows for SynthEditor and SampleEditor.**~~ ✅ **Done.**
    `MdiWindow.tsx` — generic draggable floating window with Amiga-style title bar
    (depth gadget, title, close ✕ gadget), drag-to-move via title bar, z-index
    focus management (click to bring to front), scrollable content area, MDI CSS.
    `SynthEditorMdi` wrapper added to `SynthEditor.tsx` — reads `selectedInstrument`
    from store, renders `SynthEditor` for synth slots, placeholder for others.
    `TransportBar` gains `onEditSynth` / `onEditSample` props (replaces old
    `setRightPanel('detail')` calls). `App.tsx` manages `synthMdi` / `sampleMdi`
    state with `nextZ` ref for z-ordering; `InstrumentList` is now the permanent
    right panel (tab toggle removed). `SampleEditor` expand-mode `top` corrected
    from `32 → 62` to account for MenuBar + TransportBar height. TypeScript clean.

28. ~~**Sequencer cmd 0D/0A — volume slide bug.**~~ ✅ **Done.**
    `processEffect()` incorrectly treated `0x0D` as a ProTracker Pattern Break
    (breaking songs that use `0D` for crescendo/decrescendo). Fixed by removing the
    wrong `case 0x0d` and routing `0D`/`0A` through the existing
    `applySustainingVolSlide()` path (sustaining notes) and through the note-trigger
    volume ramp in both `playSample()` and `playSynth()`. Both now treat `0D` and
    `0A` identically to `05` (volume slide nibbles: hi = up, lo = down, per tick).
    `0A` is ModeCat's alias for `0D`. TypeScript clean.

28a. ~~**Hold symbol (-|-).**~~ ✅ **Done.**
    ModeCat note value `0xFE` (254) represents "hold" — sustain the previous note
    without retriggering. Implemented across three layers:
    - `src/engine/notes.ts`: `NOTE_HOLD = 254` constant exported; `formatNote(254)`
      returns `'-|-'` (displayed in the pattern grid).
    - `src/components/PatternEditor.tsx`: `'A'` key in field 0 writes `NOTE_HOLD`
      to the cell and advances the cursor (chord-mode aware). `NOTE_HOLD` imported
      from `notes.ts`.
    - `src/engine/sequencer.ts`: `NOTE_HOLD` imported; the sustaining-effects gate
      `if (cell.note === 0)` extended to `if (cell.note === 0 || cell.note === NOTE_HOLD)`
      so hold cells apply effects (vol slide, vibrato, etc.) without triggering a
      new note. TypeScript clean.

28b. ~~**#56 — On/Off mute row above the pattern grid + mode toggles.**~~ ✅ **Done.**
    `ModeBar.tsx` created and inserted in `App.tsx` between `<InfoBar />` and
    `<RangeBar />`. Left cluster: **EDIT** toggle (orange text when on), **CHORD**
    toggle, **Spc=** numeric input (0–16). Spacer. Right cluster: 16 On/Off buttons
    aligned to pattern columns via `3.5ch` gutter + `12ch`-wide buttons matching
    `COL_WIDTH_CH`. Click = `toggleMute(i)`; Shift+click = `toggleSolo(i)`. Muted
    buttons show `OFF` with strikethrough; solo buttons get orange background;
    non-solo channels in solo-active state are dimmed. CSS: `.mode-bar`,
    `.mode-bar__toggle`, `.mode-bar__spc-label`, `.mode-bar__onoff-row`,
    `.mode-bar__gutter`, `.mode-bar__ch-btn`, `.is-muted`, `.is-solo`, `.is-dimmed`.
    TypeScript clean. Also closes Bug A of #60 — EDIT is now a large prominent
    button rather than a small LED indicator.

29. ~~**#60 — ⚠️ Instrument field cell editing: UX bugs.**~~ ✅ **Done (Bug B).**

    **Bug B — Hex entry vs decimal instrument list mismatch — FIXED.**
    `InstrumentList.tsx` now displays slot numbers as uppercase hex (`01`…`1F`)
    matching the two-nibble hex entry in the pattern cell instrument field.
    `idx.toString(16).toUpperCase().padStart(2, '0')` replaces the old decimal
    `String(idx).padStart(2, '0')`. TypeScript clean.

    **Bug A — Edit mode gate not obvious — still open.**  
    The entire hex-entry block is gated by `if (!cursor.editMode) return` (line 112
    in `PatternEditor.tsx`). If Edit mode is off, typing any digit in the instrument
    field silently does nothing. Fix: ensure the Edit mode indicator is obvious
    (bright LED or highlighted label in the InfoBar / ModeBar), and consider showing
    a brief tooltip or status message when a digit key is pressed outside edit mode.
    This will be fully resolved when ModeBar (#56) is built with a prominent EDIT
    button.

29. ~~**#61 — ⚠️ SampleEditor: Freehand drawing always-on + single-point noise bugs.**~~ ✅ **Done.**
    Both fixes were already applied: `loopMode` initialised to `true` (Bug A),
    and `lastDrawRef` + linear interpolation in `onCanvasMove` (Bug B).

29. ~~**#57 — Song Options window.**~~ **DONE** — `SongOptionsDialog`
    component: title, author (24-char max), BPM (20–255), Speed (1–15),
    Loop Song and Pattern Loop flags. Opened from Song → Set Options… in the
    menu bar. Enter confirms, Escape cancels.

30. ~~**#58 — Block Properties window.**~~ **DONE** — `BlockPropsDialog`
    component: pattern name (16-char max) and row count (1–3200). Opened
    from Block → Set Properties… in the menu bar or the Props… button in
    SongEditor. Enter confirms, Escape cancels. `setPatternLength` trims or
    pads rows in place.

31. ~~**#59 — Oscilloscope / bar displays.**~~ ✅ **Done.**
    - One `AnalyserNode` per channel (fftSize=256, smoothing=0.6) created
      alongside the `AudioContext` in `Sequencer.start()`. Connected to
      `ctx.destination` as a pass-through; all sample and synth note triggers
      now route through `analysers[ch]` instead of directly to destination.
      `getAnalysers()` getter exposes the array to the UI.
    - `Oscilloscope.tsx` — 40px strip below the PatternEditor; 3.5ch gutter
      (matching ModeBar / PatternEditor alignment) + a flex canvas that fills
      the 16-channel width. A single `requestAnimationFrame` loop calls
      `getByteTimeDomainData` on each analyser and draws into the canvas.
    - **Scope mode** (`~` button): phosphor-green waveform trace per channel,
      subtle horizontal centre-line, vertical channel separators.
    - **Bar mode** (`▌` button): peak VU bars from bottom; amber clip indicator
      (2px top stripe + bar colour change) when peak > 92%.
    - Muted channels dim to 20% opacity (reads `trackFlags[ch].mute` from store).
    - `ResizeObserver` keeps canvas pixel width == CSS layout width (no blurring).
    - Animation loop cancels when `transport.playing` goes false; last frame
      persists as a "decay" snapshot. Loop restarts on next play via effect.
    - CSS: `.oscilloscope`, `.oscilloscope__gutter`, `.oscilloscope__mode-btn`,
      `.oscilloscope__canvas` in `modecat.css`. TypeScript clean.

### Open bugs — awaiting reproduction info

- **⚠️ Audio clicking / polyphony bleed.** Intermittent clicks are still
  audible, less frequent than before the AHDSR + release-tail fixes but not
  gone. Suspected causes (to confirm with user-provided repro):
  - Multiple voices playing simultaneously on the same channel without the
    previous voice being cut — if `ActiveNote` for a channel is not being
    found correctly (e.g. key mismatch between synth/sample paths), the old
    source keeps running underneath the new one, and both play until their
    natural end, causing comb-filter beating and eventual click when the old
    source does stop.
  - Release tail from a prior note overlapping the attack of the next note at
    a gain that sums > 1.0 (inter-note clipping).
  - `cancelAndHoldAtTime` not being supported in all browsers (Firefox has
    partial support); fallback path may hard-cut instead of fading.
  - Synth notes: `renderSynthBuffer` pre-renders to a finite buffer; if the
    buffer end is not zero-padded, the AudioBufferSourceNode will click at
    the end of the buffer when loop=false.
  **Awaiting:** user repro steps — which instrument type clicks (sample /
  synth / hybrid), BPM, pattern, and whether it happens on a single channel
  or multiple. Also useful: browser + OS. Log here when info is received.

### Deferred — design decision needed

- **Per-track volume controls.** Two options under consideration:
  (a) A small scrollable vol number (0–64) embedded in each channel header
  directly below the CH01 label — compact, no extra window, scroll-wheel to
  nudge, very ModeCat-y.
  (b) A separate MDI mixer window with 16 horizontal sliders — more visual,
  closer to a DAW mixer, but takes up screen real estate.
  Option (a) is the current preference. Needs a decision before implementation.
  Would feed into the sequencer as a per-track gain multiplier applied in
  `triggerCell` alongside `playTranspose`.

### Future / exploratory

#### Clip system (reusable pattern regions)

A clip is a named, reusable block of pattern data covering a channel range and a number of rows. Clips are independent objects — not owned by any block. Placements are references. Editing the clip updates all placements instantly.

**Creating a clip**
- Lasso a channel+row region in the pattern editor, right-click → "Save as Clip"
- The selected cells immediately become a tinted, read-only clip placement
- Clip appears in the Clip Palette panel (left panel, tabbed alongside Instruments)

**Placing a clip**
- Drag from palette onto the pattern grid
- If the target cells already contain data → prompt: "Overwrite / Cancel" (like Excel drag-drop)
- Clip renders as a coloured tinted region with a visible bounding box
- A drag handle at the bottom edge lets the user extend the clip — extension tiles the clip content to fill (loops it)
- Shortcut key to fill-to-end-of-block

**Channel masking on placement**
- When placing, the user can choose which channels from the clip to include
- Masked channels appear empty in that placement but remain in the master clip
- Useful for "use the drums clip but skip the toms here"

**Editing a clip**
- Double-click any tinted cell → opens the clip in a dedicated MDI window (mini pattern editor showing only that clip's channels and rows)
- Changes propagate to all placements in real time
- The MDI window title shows the clip name and usage count

**Unlinking a clip**
- Right-click a placement → "Unlink" — severs the reference and converts the cells back to plain editable pattern data
- The user can then lasso the result and save it as a new clip if they want a variant
- Unlink affects only that placement — other blocks still reference the original clip

**Clip palette panel**
- Shows all clips with name, channel width, row count, and colour swatch
- Actions per clip: **Edit** (opens MDI window), **Copy** (creates a new independent copy of the clip — editing one does not affect the other), **Delete**
- **Clip info** — shows which blocks the clip is used in, or flags it as "unused" so the user knows it's safe to delete
- Delete is blocked (or prompts) if the clip has active placements — show the block list first

**Data model sketch**
```typescript
interface Clip {
  id: string;
  name: string;
  color: string;        // hex tint colour
  channelCount: number;
  rows: PatternCell[][]; // [row][channel]
}

interface ClipPlacement {
  clipId: string;
  startCh: number;
  startRow: number;
  channelMask: boolean[]; // which clip channels are active
  tileRows: number;       // how many rows to fill (may be > clip.rows.length, tiled)
}

// Pattern gains:
clipPlacements: ClipPlacement[];
```

**Sequencer reads clips transparently** — for each cell, check if it falls within a clip placement; if so, read from the clip (respecting channel mask and tiling), otherwise read from the block's own data. No other engine changes needed.

**Limitations vs Renoise matrix (accepted)**
- Blocks are still the atomic song unit — you can't have ch1-5 and ch6-10 advancing through the song at truly independent rates across block boundaries
- Within a block, clips of different lengths loop independently (covers 95% of real use — a 16-row drum clip loops 4× in a 64-row block naturally)
- Placing clips in each block is still manual — but editing the master updates everywhere, which is the key win

#### ARexx enhancements

- **ARexx plugin system — Level 1 (GETWAVE/SETWAVE).** Add `GETWAVE inst` / `SETWAVE inst s0 s1 … s31` commands to read/write synth instrument waveform arrays from ARexx. Enables fully scripted additive synthesis, FM, wavetable generation etc. Low effort — store access already exists.

- **ARexx plugin system — Level 2 (declarative MDI windows).** Scripts declare a window layout (`CREATEWINDOW`, `ADDSLIDER`, `ADDBUTTON` etc); ModeCat renders it as an MDI window; user interactions trigger a re-run of a named script handler. Would unlock user-built tools — FM designers, arpeggiators, generative composition — without touching the source.

- **ARexx plugin system — Level 3 (persistent event-driven plugins).** Scripts that stay running and respond asynchronously to sequencer events (note triggers, transport, UI). Full plugin host — significant infrastructure work, design decision needed first.

#### Arpeggiator

- **Arpeggiator (tracker-native approach).** Keep this firmly in tracker territory — not a real-time MIDI effect. Two complementary implementations:
  1. **ARexx script** — a bundled `arpeggio.mcat` script that takes a chord (notes + instrument) and a mode (Up/Down/UpDown/Random/As-played) and writes the resulting note sequence into the current pattern. Uses existing ARexx commands, no engine changes needed.
  2. **Dedicated effect command** — a new `20xx` command (or repurpose an unused slot) that triggers an arp pattern at runtime, similar to how `00xy` does 2-step arpeggio but with a stored pattern. Research: Roland Juno-60, Korg Poly-61, Oberheim OB-Xa, Novation Bass Station (1993), Korg Prophecy (1995). Modes to support: Up, Down, Up+Down, Random, As-played, Chord.

#### Effects (staying within tracker paradigm)

- **Per-instrument resonant filter with envelope.** Precedent: Impulse Tracker (1995) added a resonant lowpass filter per channel with envelope control and still considered itself a tracker. Implementation: add `filterCutoff`, `filterResonance`, and a filter envelope (attack/decay/sustain/release + depth) to `SampleInstrument` and `SynthInstrument`. Sequencer routes audio through a `BiquadFilterNode` per channel. Per-cell filter cutoff offset via a new effect command. Keeps modulation in the per-cell/per-instrument model rather than adding automation lanes.

- **Per-instrument LFO.** A single LFO per instrument slot (rate, depth, target: pitch / volume / filter cutoff, waveform: sine/square/saw/random). Distinct from the per-cell vibrato (04) and tremolo (06) commands — this runs continuously for the life of the note without needing an effect column entry. Tracker-appropriate because it lives on the instrument, not as a routable modulation matrix.

- **Chorus / ensemble effect on master output.** A single send-level chorus on the master mix (not per-channel inserts). Precedent: several late-90s trackers added a global chorus. Simple to implement with Web Audio (`DelayNode` + slight detune). One knob, no routing — keeps it simple and non-DAW-like.

- **BPM detection improvement.** The `DETECT` button in the Sample Editor currently halves the BPM for some loops (detected 63 instead of 126 in testing). Improve the detection algorithm to handle octave errors — after initial detection, check if `bpm × 2` or `bpm / 2` gives a better fit against the loop length and auto-correct.

#### Docs

- **Docs screenshots.** Capture UI screenshots (Sample Editor, Pattern Grid, Song Editor, etc.) and embed them in the VitePress docs. Use Claude in Chrome against a running dev server to automate capture into `modecat-docs/docs/public/`.

#### Formats — decided against

MOD/MED/MMD/IFF full import and MOD export are **not worth building**. The sample extraction from MOD/XM files already in the Sample Browser is sufficient. The format constraints (4 channels, Amiga period table) make MOD export actively lossy for a 16-channel ModeCat song. Revisit only if user demand appears.

### Out of scope on purpose

Amiga channel splitting (4–8 channel modes), the hardware audio filter,
`MED_Paths` lookup, IFF-vs-RAW format choices, printing — these don't
translate to a web build with unlimited Web Audio polyphony.

---

## Recommended order of pickup

If the new session has a short window, the most leverage per hour is:

1. **#52** — menu bar. Pure UI shell with stubs; immediately makes the app
   look like ModeCat and gives a home for every future action.
2. **#53** — transport row. Moves play controls to the top; high visual
   impact, one afternoon.
3. **#54** — status + position row. Elevates SPD/BPM/elapsed to first-class.
4. **#55** — MDI windows for SynthEditor + SampleEditor. Removes the tab
   toggle and gives both editors proper floating behaviour.
5. **#56** — permanent instrument list + On/Off row. Completes the V5
   layout.

Doing 1–5 in that order produces a UI that looks and feels like ModeCat V5.

---

## Key files to read first

- `README.md` — feature set, run instructions, file format, known gaps
- `BRIDGE_API.md` — WebSocket protocol the local MIDI bridge implements
- `src/state/types.ts` — domain model (`PatternCell`, `Instrument`,
  `Pattern`, `Song`, `RangeSel`)
- `src/state/store.ts` — Zustand store, all actions
- `src/engine/sequencer.ts` — playback engine, lookahead scheduler,
  per-channel triggering, effect handling
- `src/components/PatternEditor.tsx` — 16-track grid + keyboard cursor
- `src/components/RangeBar.tsx` — range ops surface
- `outputs/octamed_v4_manual.txt` — extracted text of the user-uploaded
  ModeCat V4 manual (image-text only; references are by page number)
- `outputs/afmedtut.txt` — OCR'd Amiga Format tutorial series (4 parts)
- `uploads/Octamed 5 - Manual-ENG.pdf` — full V5 manual (199 pages); menu
  documentation starts around character offset 30682 in the extracted text;
  Project / Display / Song / Block / Track / Edit / Instrument / MIDI /
  Settings menus are all fully documented with keyboard shortcuts
