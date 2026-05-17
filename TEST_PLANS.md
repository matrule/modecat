# Octomed Web — Tutorial Test Plans

Derived from the *Amiga Format* OctaMED tutorial series (Ed Wiles, 4 parts) as
identified during the previous UAT pass. Each plan maps to one tutorial
scenario and can be run independently against the running web app
(`npm run dev` → `http://localhost:5173`).

Status column reflects the **current** build state (May 2026):

| ID  | Scenario                                       | Status    | Blocking ticket(s) |
|-----|------------------------------------------------|-----------|--------------------|
| T01 | Enter notes via keyboard + Edit mode           | ✅ Pass   | —                  |
| T02 | Copy-paste a block, chain into Play Sequence   | ✅ Pass   | —                  |
| T03 | Space Mode auto-skip every Nth row             | ❌ Fail   | #45                |
| T04 | Manage sample directory via Sample List Editor | ❌ Fail   | #44                |
| T05 | Per-instrument Default Pitch, enter via F      | ❌ Fail   | #31                |
| T06 | Enter `0FFF` stop-note effect                  | ✅ Pass   | —                  |
| T07 | Enter `0452` vibrato effect (visual + audio)   | ⚠ Partial | #29 (audio only)   |
| T08 | Pitch Slide — Type 1 auto-creates `03xx` cells | ✅ Pass   | —                  |
| T09 | Mark range on sample waveform, play range      | ❌ Fail   | #34                |
| T10 | Build synthsound with `CHD 03` volume program  | ❌ Fail   | #33                |

---

## Conventions

- **Cursor field positions** in the pattern editor (left → right per cell):
  `0` Note · `1` Instrument hi-nibble · `2` Instrument lo-nibble ·
  `3` Command nibble · `4` Data hi-nibble · `5` Data lo-nibble
- **Edit mode** must be active (orange cursor) for note/effect entry.
  Toggle with **Enter** or **Esc** (Esc also clears an active range).
- All key names are unmodified unless stated (e.g. `Shift+click`).
- Default app state = fresh load, no saved file, one empty pattern (`PAT 00`),
  instruments 1–4 populated with empty slots.

---

## T01 — Enter notes via keyboard + Edit mode

**Tutorial reference:** Part 1 — "Your First Tune"

### Status: ✅ Pass

### Preconditions
- App loaded at `localhost:5173`.
- Pattern editor visible with at least one empty pattern.
- No existing notes in track 1.

### Steps

1. Click any cell in row 00, track 1 (channel 1) to place the cursor there.
2. Verify cursor is **not** in Edit mode (cursor outline, not filled orange).
3. Press **Enter** to activate Edit mode. Cursor should turn solid orange.
4. Press **A** on the keyboard. Expect: note `C-3` entered in the note field,
   cursor advances one row down automatically.
5. Press **W** → expect `C#3`. Press **S** → expect `D-3`. Continue down the
   chromatic row: `E`=`D#3`, `D`=`E-3`, `F`=`F-3`, `T`=`F#3`, `G`=`G-3`,
   `Y`=`G#3`, `H`=`A-3`, `U`=`A#3`, `J`=`B-3`, `K`=`C-4`.
6. Press **Octave +** button (or `F2` if mapped) to raise octave to 4.
   Verify the octave indicator in the status panel changes.
7. Press **A** again — expect `C-4` (octave 4).
8. Navigate back up with **Arrow Up** keys to row 00.
9. Press **Enter** to exit Edit mode. Verify cursor outline returns.
10. Press **Space** to start playback. Verify the playhead scrolls through the
    entered notes and the pattern loops.
11. Press **Space** again to stop.

### Expected results
- Each keypress enters the correct note in the note field.
- Cursor advances one row after each note entry.
- Octave change is reflected immediately in subsequent entries.
- Playback scrolls the playhead and loops (`Pat Loop` mode).

### Pass criteria
All 11 steps complete without errors and notes sound during playback.

---

## T02 — Copy-paste a block, chain into Play Sequence

**Tutorial reference:** Part 1 — "Building a Song"

### Status: ⚠ Partial (paste works; whole-block Copy/Paste via Block Panel not yet implemented — #47)

### Preconditions
- T01 completed: pattern `PAT 00` has notes in rows 00–11, track 1.
- Song editor panel visible (left sidebar).

### Steps — Range copy/paste (currently working)

1. Click the cell at row 00, track 1.
2. `Shift+click` the cell at row 07, track 1 to define a range (rows 0–7,
   channels 1–1). The **RangeBar** should appear above the pattern editor
   showing `r00–07·c1–1·8×1`.
3. Click **Copy** in the RangeBar.
4. Navigate cursor to row 16, track 1 (below the existing notes).
5. Click **Paste** in the RangeBar. Expect rows 16–23 in track 1 to receive
   copies of rows 0–7.
6. Press **Esc** to dismiss the range selection.

### Steps — Song position chaining

7. In the Song panel (left), verify position `00` shows `PAT 00`.
8. Click **+** (insert position) below position `00`. A new position `01`
   should appear.
9. In the dropdown for position `01`, select `PAT 00` (same pattern, or a
   second pattern if you add one via **Add** in the Pattern Bank).
10. Ensure the **Loop** checkbox is unchecked (song plays straight through).
11. Press **Space** to start playback. Verify the sequencer plays position 00,
    then advances to position 01, then stops (or loops if Loop is on).

### Known gap — Block Panel (#47)
The tutorial describes using dedicated Copy Block / Paste Block buttons that
copy an *entire* named pattern in one click. These are not yet present in the
Block Panel section of the UI. Log as blocked by #47.

### Expected results
- Range copy/paste populates rows 16–23 correctly.
- Song sequences through two positions in order.

---

## T03 — Space Mode auto-skip every Nth row

**Tutorial reference:** Part 2 — "Efficient Entry with SPC=N"

### Status: ❌ Fail — feature not implemented (#45)

### Preconditions
- App loaded, edit mode off.

### Steps

1. Look for a **SPC** or **Space Mode** control anywhere in the UI
   (StatusPanel, TitleBar, toolbar area).
   - *Expected (not yet present):* an input labelled `SPC=` accepting values
     1–16 (default 1).
2. If found: set `SPC=2`.
3. Enter Edit mode and press a note key.
4. Verify the cursor advances **2 rows** instead of 1.
5. Set `SPC=4` and verify cursor advances 4 rows per note.
6. Set `SPC=1` to restore default.

### Failure mode
No SPC control exists in the current build. The cursor always advances exactly
1 row. Test **fails at step 1**.

### Acceptance criteria for #45
- A numeric SPC input (1–16) is visible in the status/toolbar area.
- Cursor advances exactly SPC rows after each note entry in Edit mode.
- Default value is 1 (unchanged from current behaviour).

---

## T04 — Manage sample directory via Sample List Editor

**Tutorial reference:** Part 2 — "Loading Samples"

### Status: ❌ Fail — feature not implemented (#44)

### Preconditions
- A folder of `.wav` files accessible to the browser (via File System Access
  API or drag-and-drop).

### Steps

1. Open the **Instrument List** panel and select an empty instrument slot (e.g.
   slot 1, kind = Sample).
2. Look for a **Sample List** or **Browse** button/panel that allows navigating
   a directory of samples.
   - *Expected (not yet present):* a list of `.wav` / `.iff` filenames from a
     chosen folder, with Add Dir / Remove Dir controls.
3. If found: click **Add Dir** and choose a folder containing WAV files.
4. Verify filenames appear in the sample list.
5. Double-click a filename to load it into the currently selected instrument
   slot.
6. Verify the instrument name updates and a waveform appears in the Sample
   Editor.
7. Enter Edit mode and press a note key in the pattern editor to audition the
   sample.

### Failure mode
No Sample List Editor exists. The only way to load a sample is via the per-slot
file picker button (drag-drop or `<input type="file">`), which lacks directory
browsing. Test **fails at step 2**.

### Acceptance criteria for #44
- A directory browser panel is accessible from the instrument area.
- User can select a folder (File System Access API `showDirectoryPicker()` or
  folder drag-drop).
- Filenames are listed; double-click (or "Load") assigns the file to the active
  instrument slot.

---

## T05 — Per-instrument Default Pitch, enter via F key

**Tutorial reference:** Part 2 — "Default Pitch Setting"

### Status: ❌ Fail — feature not implemented (#31)

### Preconditions
- Instrument slot 1 has a sample loaded (follow T04 or use the file picker).

### Steps

1. Select instrument slot 1 in the Instrument List.
2. Look for a **Default Pitch** (or **Transpose / Finetune**) control on the
   instrument detail panel.
   - *Expected (not yet present):* a note picker (e.g. `C-3`) labelled
     "Default Pitch" and semitone/finetune sliders.
3. If found: set Default Pitch to `E-3`.
4. Navigate to an empty cell in the pattern editor.
5. Enter Edit mode. Press **F** on the keyboard (not a note key — should insert
   a note at the instrument's Default Pitch).
6. Verify the cell shows `E-3` (or whatever Default Pitch was set).
7. Change Default Pitch to `A-4` and press **F** again on a new row. Verify
   `A-4` is inserted.

### Failure mode
No Default Pitch field exists on instrument detail. The F key has no special
binding in the current `PatternEditor.tsx` keymap. Test **fails at step 2**.

### Acceptance criteria for #31
- `transpose` (semitones, integer) and `finetune` (-8..+7) fields added to
  instrument detail for sample and synth slots.
- A "Default Pitch" note selector stored per instrument.
- In Edit mode, pressing **F** inserts the instrument's Default Pitch note
  in the current cell (same cursor advance as a normal note entry).

---

## T06 — Enter `0FFF` stop-note effect

**Tutorial reference:** Part 3 — "Effects: The Stop Note"

### Status: ✅ Pass

### Preconditions
- A pattern with at least one note already entered (e.g. T01 result).

### Steps

1. Navigate the cursor to the cell in the row immediately after a note entry
   (e.g. row 01, track 1 if a note is at row 00).
2. Verify cursor is in Edit mode.
3. Move cursor field to position `3` (command nibble) using **Arrow Right**.
4. Press **F** to type the hex digit `F` in the command field. Verify the
   command field shows `F`.
5. Move to field `4` (data hi-nibble). Press **F** → shows `F`.
6. Move to field `5` (data lo-nibble). Press **F** → shows `F`.
7. Verify the full cell displays `---- -- FF F FF` (or equivalent rendering
   for effect `0FFF`).
8. Press **Space** to play. Verify the note at row 00 begins, then silences
   abruptly at row 01 (no gradual fade — hard stop).
9. Press **Space** to stop.

### Expected results
- Effect nibble `F` is accepted and rendered in the command/data columns.
- Playback triggers a hard note-off at the `0FFF` row.

---

## T07 — Enter `0452` vibrato effect (visual + audio)

**Tutorial reference:** Part 3 — "Effects: Vibrato"

### Status: ⚠ Partial (cell entry works; audio vibrato not yet modulated — #29)

### Preconditions
- Edit mode active, cursor on an empty cell after a note row.

### Steps — Cell entry (currently working)

1. Enter a note (e.g. `C-3`) on row 00, track 1.
2. Move to row 01, track 1. Navigate to the command field (field 3).
3. Type **4** → command nibble = `4`.
4. Move to field 4. Type **5** → data hi = `5`.
5. Move to field 5. Type **2** → data lo = `2`.
6. Verify cell at row 01 reads something like `---- -- 04 5 02`.
7. Press **Space** to play.
8. Observe whether the pitch of the C-3 note oscillates (vibrato).

### Expected audio result (currently failing — #29)
Vibrato effect `04` (speed=5, depth=2) should modulate pitch ±2 semitones at
speed 5 on every tick while the note is held. This requires per-tick
`playbackRate` ramping in `sequencer.ts`. Currently the note plays flat with
no modulation.

### Visual pass criteria (currently passing)
- The command/data columns accept hex digits and display `04 52` correctly.

### Audio pass criteria (blocked by #29)
- Audible pitch oscillation during playback matching vibrato parameters.

---

## T08 — Pitch Slide — Type 1 auto-creates `03xx` cells

**Tutorial reference:** Part 3 — "Auto-Slide Tools"

### Status: ❌ Fail — auto-slide UI and audio not implemented (#29 + #30)

### Preconditions
- Two notes entered in the same track, separated by several empty rows
  (e.g. `C-3` at row 00 and `G-3` at row 08, track 1).

### Steps

1. Select the range rows 00–08, track 1 (click row 00, then `Shift+click`
   row 08).
2. Look for a **Slide** button or **SLIDE: 1** / **SLIDE: 2** control in the
   RangeBar or Block Panel.
   - *Expected (not yet present):* a "Slide" button that fills the intermediate
     rows with `03xx` portamento effect cells interpolated between the two
     endpoint notes.
3. If found: click **Slide (Type 1)**.
4. Verify rows 01–07 each have a `03xx` cell inserted (command `03`, data
   calculated to slide from `C-3` to `G-3` over 7 rows).
5. Press **Space** to play. Verify smooth pitch glide from C-3 to G-3.

### Failure mode
No Slide button in RangeBar. Test **fails at step 2**.

### Acceptance criteria for #30
- A **Slide** (Type 1 = `03xx`, Type 2 = `01xx`/`02xx`) button appears in the
  RangeBar when a range spanning ≥2 rows is selected.
- Clicking it fills intermediate rows with correctly calculated effect values.
- Depends on #29 (portamento audio) for the slide to actually sound.

---

## T09 — Mark range on sample waveform, play just range

**Tutorial reference:** Part 2 — "Sample Editor: Range Playback"

### Status: ❌ Fail — sample range selection not implemented (#34)

### Preconditions
- Instrument slot 1 has a `.wav` sample loaded (via file picker).
- Sample Editor panel is visible (click the instrument with kind=Sample and
  look for waveform display).

### Steps

1. Select a sample instrument in the Instrument List.
2. Switch to the Sample Editor view (click the instrument name / detail area).
3. Verify a waveform canvas is visible.
4. **Click and drag** across a portion of the waveform to mark a range
   (start and end points).
   - *Expected (not yet present):* a highlighted selection region on the
     waveform, with Loop Start / Loop End markers set to the selection.
5. If found: press a "Play Range" or "Preview" button.
6. Verify only the selected portion of the sample plays back (not the whole
   sample).
7. Look for loop mode controls: **Forward**, **Ping-Pong**, **One-Shot**.
8. Set **Ping-Pong** mode and trigger playback; verify the sample bounces
   back and forth within the marked range.

### Failure mode
The current `SampleEditor.tsx` shows a basic waveform display and file-load
button but lacks click-drag range selection and loop mode controls. Test
**fails at step 4**.

### Acceptance criteria for #34
- Click-drag on the waveform canvas sets `loopStart` / `loopEnd` in the
  instrument's sample data.
- A "Play Range" button triggers a Web Audio buffer source scoped to
  [loopStart, loopEnd].
- Loop mode selector: Forward / Ping-Pong / One-Shot — updates the
  `AudioBufferSourceNode.loop` and playback direction accordingly.
- Cut / Copy / Paste / Reverse / Fade operations on the selected region.

---

## T10 — Build synthsound with `CHD 03` volume program

**Tutorial reference:** Part 4 — "The Synth Editor & Volume Programs"

### Status: ❌ Fail — full synth command script not implemented (#33)

### Preconditions
- An instrument slot configured as kind = **Synth**.
- Synth Editor panel visible (32-step waveform canvas + AHDSR inputs).

### Steps — Waveform drawing (currently working)

1. Select an empty instrument slot and change its kind to **Synth** in the
   Instrument List.
2. In the Synth Editor, click and drag on the 32-step waveform canvas to draw
   a custom waveform shape (e.g. sawtooth: drag from top-left to
   bottom-right).
3. Verify the waveform canvas updates in real-time as you draw.
4. Adjust AHDSR sliders (Attack, Decay, Sustain, Release) and verify numeric
   values change.

### Steps — Volume program / command script (currently failing)

5. Look for a **Volume Program** or **Command Script** editor tab in the Synth
   Editor.
   - *Expected (not yet present):* a multi-line script editor with commands
     `CHU` (volume up), `CHD` (volume down), `WAI` (wait), `JMP` (jump),
     `HLT` (halt), `SPD` (set speed), etc.
6. If found: enter the following script:
   ```
   CHD 03
   WAI 04
   CHD 03
   HLT
   ```
7. Verify the script editor accepts the entries without error.
8. Enter the synth instrument into the pattern editor and play a note.
9. Verify the volume dips in two steps as the command script executes
   (a staircase volume envelope audible during playback).

### Failure mode
No command script editor exists in `SynthEditor.tsx`. The current synth uses
only an AHDSR envelope. Test **fails at step 5**.

### Acceptance criteria for #33
- A programmable script panel replaces or supplements the AHDSR envelope.
- Commands: `CHU n` / `CHD n` (change volume ±n), `WAI n` (wait n ticks),
  `JMP n` (jump to script line n), `JWS n` (jump when silent),
  `HLT` (stop script), `SPD n` (set script speed), `EN1..EN4` (envelope
  presets), `VBD n` / `VBS n` (vibrato depth/speed).
- Script executes per-tick during synth note playback.
- Depends on no other ticket but is a large build (~#33).

---

## Regression suite — features already passing

These scenarios passed in the previous UAT and should continue to pass. Run
them after any refactor to guard against regressions.

### R01 — Range operations (Cut / Copy / Paste / Clear / Transpose / Fade / Echo)

1. Enter notes in rows 00–07, tracks 1–4.
2. `Shift+click` from (row 00, track 1) to (row 07, track 4) to define an
   8×4 range. Verify RangeBar appears.
3. **Copy** → navigate cursor to row 16, track 1 → **Paste**.
   Verify rows 16–23, tracks 1–4 contain copies.
4. Select rows 00–07, track 1 only. Click **½▲** (Transpose +1 semitone).
   Verify all notes in selection shift up by one semitone.
5. Click **Oct▼** (Transpose -12). Verify notes shift down one octave.
6. Add `0C` volume commands to row 00 (max, `0C40`) and row 07 (zero, `0C00`).
   Select that range. Click **Vol Fade**. Verify rows 01–06 have linearly
   interpolated `0C` values.
7. Set Echo Dist=2, Min=1. Click **Echo Apply**. Verify rows 02, 04, 06
   contain attenuated echoes of the original notes.
8. Click **Clear** on the selection. Verify all cells return to empty.

### R02 — Mute / Solo

1. Enter a note in track 1 and a note in track 2.
2. Click the **M** (Mute) button for track 1. Play. Verify track 2 sounds,
   track 1 is silent.
3. Click the **S** (Solo) button for track 2. Play. Verify only track 2 sounds
   (all other tracks muted).
4. Click S again to clear solo. Verify all tracks audible.

### R03 — Save and Load

1. Enter a tune, set BPM to 135.
2. Click **Save** in the SaveLoadBar. Verify a `.json` file downloads.
3. Reload the page (fresh state).
4. Click **Load** and select the saved file. Verify all notes, BPM, and
   instrument definitions are restored exactly.

### R04 — Chord Mode

1. Enter Edit mode. Press the **CHRD** button (or keyboard shortcut if mapped)
   to enable chord mode.
2. Press a note key. Verify the note is entered and the cursor advances **right**
   (next channel, same row) rather than down.
3. Enter four notes across tracks 1–4 on the same row.
4. Press **Space** to play; verify all four notes sound simultaneously.
5. Disable chord mode; verify cursor returns to advancing downward.

### R05 — Synth waveform entry (no command script)

1. Add a Synth instrument.
2. Draw a waveform in the 32-step canvas using click-drag.
3. Adjust AHDSR parameters.
4. Enter the synth instrument in the pattern editor and play a note.
5. Verify the tone reflects the drawn waveform shape and AHDSR envelope.

---

---

## Broader scenarios — OctaMED Pro 5 reference

Derived from *OctaMED_Tutorial_Reference.docx* (paraphrase of the five-part
Ed Wiles series published in Amiga Format). These scenarios extend the T-series
by covering full workflows, deeper sample-editor operations, and richer synth
scripting. They are numbered B01–B10 so they can be tracked independently.

| ID  | Scenario                                              | Status    | Blocking ticket(s) |
|-----|-------------------------------------------------------|-----------|--------------------|
| B01 | End-to-end song: drums + bass + melody + sequence     | ✅ Pass   | —                  |
| B02 | Variable block length (32-line block)                 | ✅ Pass   | —                  |
| B03 | Save module without instruments                       | ✅ Pass   | —                  |
| B04 | Track copy / paste across blocks                      | ✅ Pass   | —                  |
| B05 | Pitch Slide Type 2 (01xx / 02xx commands)             | ✅ Pass   | —                  |
| B06 | Sample Editor — cut / paste / echo within waveform    | ✅ Pass   | —                  |
| B07 | Synthsound waveform transformation + JMP loop         | ✅ Pass   | —                  |
| B08 | Synthsound soft-start swell (CHU + WAI + CHD)         | ✅ Pass   | —                  |
| B09 | Synthsound VBD / VBS vibrato in pitch program         | ❌ Fail   | #33                |
| B10 | Synthsound ARP arpeggio                               | ❌ Fail   | #33                |

---

## B01 — End-to-end song: drums + bass + melody + Playing Sequence

**Tutorial reference:** OctaMED Pro 5, Part 1 (complete)

### Status: ⚠ Partial (note entry + playback work; whole-block Copy/Paste and Sequence edit blocked by #47)

### Goal
Verify the entire vertical slice from empty state through a four-block song with
drums, bass and melody, ending with the song sequenced and playing in order.

### Preconditions
- Fresh app load. No saved file.
- At least four instrument slots defined (e.g. two percussion, one bass, one melody).

### Steps

**Block 0 — drum pattern**

1. Navigate to the pattern editor, row 00, channel 1. Enter Edit mode.
2. Enter alternating percussion notes (instrument 1 and 2) every four rows
   down to row 60 (16 repetitions). Use `Delete` to fix any mistakes.
3. Move to channel 2. Enter a hi-hat note (instrument 3) every other row
   using SPC=2 (set via the SPC field in the status bar).
4. Press **Space** to play the block. Verify two-tone drum pattern with hi-hats.

**Block 1 — copy block and add bass**

5. Add a second pattern (Block 1) via the **Add** button in the pattern bank / song panel.
6. Verify: *(blocked by #47 if no Block Copy)* copy Block 0's full contents into Block 1
   using Block Panel Copy/Paste. Workaround: manually re-enter or use range copy.
7. Move to Block 1, channel 3 (bass track). Enter bass notes down 16 rows using
   the upper keyboard row (instrument 3, Space Mode on, SPC=2).
8. Play Block 1. Verify drums + bass together.

**Blocks 2 & 3 — melody**

9. Create Blocks 2 and 3 (Append). Copy Block 1 into both if block copy is available.
10. On Block 2, channel 4, enter the first half of a melody (instrument 4).
11. On Block 3, channel 4, enter the second half.

**Playing Sequence**

12. Open the song position list. Build the sequence: `0 1 2 3 2 3`.
13. Press **Play Song**. Verify each block plays in order, the song loops, and
    the playhead tracks the current block in the position list.

### Pass criteria
- Note entry, cursor advance, SPC=N, and per-block playback all work (Tier 1 pass).
- Song sequence plays through all six positions in order.
- Whole-block copy/paste via Block Panel: blocked by #47.

---

## B02 — Variable block length (32-line block)

**Tutorial reference:** Part 2, Step 7 — "Add a new 32-line Block"

### Status: ✅ Pass (#35 implemented)

### Preconditions
- App loaded. At least one pattern exists.

### Steps

1. Find the **Len** numeric input in the Block panel row (next to Split / Copy Blk).
   It shows the active pattern's current row count (default 64).
2. Add a new pattern via **+ Pat** and set **Len** to 32 by editing the number field.
3. Enter notes in rows 0–30 of the new pattern; verify row 31 is the last row
   (End / F10 keys jump there, cursor wraps from row 31 back to 0).
4. Play the block and confirm it loops every 32 rows (not 64).
5. Set another pattern to 128 rows. Verify the pattern editor scrolls through 128 rows
   and the playhead advances through all 128 before moving to the next song position.
6. Confirm the Patterns list shows each pattern's row count as a read-only badge.
7. `splitBlockAt(cursor)` on a 32-row pattern produces two 32-row halves; the bottom
   half starts at cursor row with the remainder zero-padded.

### Acceptance criteria for #35 ✅ all met
- Per-pattern `length` field (1..3200) editable via **Len** input in the Block panel.
- Pattern editor displays exactly `length` rows; End/F7-F10 and field-6 wrap use `rows.length`.
- Sequencer advances rows `0..length-1` then loops or advances song position.
- `splitBlockAt` and `pasteBlock` respect the source pattern's row count.
- `ROWS_PER_PATTERN` constant retained as default only; not hardcoded in runtime paths.

---

## B03 — Save module without instruments

**Tutorial reference:** Part 2, Step 14 — "Save the song without its instruments"

### Status: ✅ Pass (#46 implemented)

### Preconditions
- At least one instrument slot has PCM sample data loaded.
- Song has notes in the pattern editor.

### Steps

1. In the SaveLoadBar (top toolbar), locate the **Incl. samples** checkbox to the
   left of the Save button. It defaults to **checked** (include PCM data).
2. Uncheck **Incl. samples** and click **Save**. Verify the downloaded JSON is
   significantly smaller — no `"pcm": "…base64…"` blob; sample instruments have
   `"pcm": null` instead. All other instrument metadata (name, kind, sampleRate,
   baseNote, loopStart, loopEnd, volume) is present.
3. Load the saved file. Verify the pattern data, BPM, and song structure restore
   correctly. Sample instrument slots show `pcm: null` (silent but their name and
   settings are intact). Synth and MIDI instruments are fully restored.
4. Re-enable **Incl. samples**, save again. Load that file — instruments are
   audible and PCM data is present.

### Acceptance criteria for #46 ✅ all met
- **Incl. samples** checkbox in SaveLoadBar; defaults to on.
- When unchecked, `pcm` is `null` for sample instruments; synth waveforms are always
  saved (they are tiny — 32 floats).
- Loading a no-PCM file restores all pattern/song/instrument-metadata; sample slots
  are silent (pcm null) but otherwise intact.

---

## B04 — Track copy / paste across blocks

**Tutorial reference:** Part 3, Step 4 — "Copy track 2 to Blocks 006–009"

### Status: ✅ Pass (#47 implemented)

### Preconditions
- At least two blocks (Block 0 and Block 1) exist.
- Block 0, channel 2 has a bass-line pattern (see B01 or T01).

### Steps

1. Navigate to Block 0 in the song editor; make sure it is the active pattern.
2. **Right-click** the channel 2 header in the pattern editor. A context menu appears
   with "Copy Track CH02" and a greyed-out "Paste Track Here".
3. Click **Copy Track CH02**. The paste option becomes enabled.
4. Navigate to Block 1 (click its position in the song editor).
5. Right-click the channel 2 header and choose **Paste Track Here**.
6. Verify Block 1, channel 2 now contains the same notes and effects as Block 0, channel 2.
7. Navigate to Block 2 and repeat step 5. Verify same result.

### Acceptance criteria for #47 ✅ all met
- Right-click on any channel header shows Copy / Paste Track context menu.
- Copy stores all rows of that channel (independent `trackClipboard`).
- Paste writes them into any channel on any block; row count clips/pads to target length.
- The track clipboard is independent of the block clipboard.

---

## B05 — Pitch Slide Type 2 (01xx / 02xx commands)

**Tutorial reference:** Part 3, Step 8 — "Type 2 pitch slide"

### Status: ✅ Pass (#30 implemented)

### Preconditions
- Two notes in the same channel, 4–8 rows apart (e.g. `E-2` at row 0, `D-2` at row 8).

### Steps

1. Select the range covering both notes (Shift-click from row 0 to row 8, channel).
2. In the RangeBar, find the **Slide** section: **Spd** number input (default 4) plus
   **Slide▲**, **Slide▼**, and **Porta** buttons.
3. Click **Slide▼** (Type 2, 02xx). Verify rows 1–7 are filled with `02 04` effect
   cells (cmd=02, data=current speed). The first and last note rows are untouched.
4. Click **Slide▲** on a different range with ascending notes. Verify `01 xx` cells.
5. Click **Porta** on a range with two notes. Verify intermediate rows get `03 xx`
   (portamento), and the last note row gets `03 xx` carrying the target note.
6. Play all three. Verify audibly distinct behaviour:
   - **Slide▲/▼**: fixed-rate continuous pitch drift, ignores the next note.
   - **Porta**: accelerates toward the target note, stops when reached.

### Acceptance criteria for #30 ✅ all met
- **Slide▲** fills intermediate cells with `01 xx`; **Slide▼** with `02 xx`; **Porta** with `03 xx`.
- Speed value (1–255, in 1/16-semitone units per tick) is user-configurable via the Spd field.
- Sequencer: `01`/`02` on a note-trigger or sustaining cell ramps `playbackRate` over the row
  duration (samples and synths); each row's ramp starts from the current rate so slides chain.
- `03xx` portamento was already implemented (#29); now also has a UI entry point.

---

## B06 — Sample Editor: cut / paste / echo within waveform

**Tutorial reference:** Part 4, Steps 5–8

### Status: ✅ Pass (#34 implemented)

### Preconditions
- Instrument slot with a `.wav` sample loaded (≥ 10,000 bytes recommended).
- Sample Editor panel visible with waveform canvas.

### Steps — Erase a section (Part 4 step 5)

1. In the Sample Editor, click and drag on the waveform to mark a range
   covering roughly the middle third of the sample.
2. Click **Erase** (or Delete) to remove the selected bytes.
3. Press a keyboard note to audition the sample. Verify the erased section
   is gone (sample sounds shorter / different).

### Steps — Cut and paste to reorder (Part 4 step 6)

4. Mark a range covering the last third of the waveform.
5. Click **Cut** to move it to the copy buffer.
6. Set Range Start = 0 (type into the Range Start input) and click **Paste**.
7. Verify the cut section now appears at the start of the waveform, and the
   original start is pushed back. Audition to confirm reordering.

### Steps — Echo effect (Part 4 steps 7–8)

8. Increase the sample buffer size to allow an echo tail (look for a **Buffsize**
   input or **Expand** button; add ~30% extra space).
9. Mark a range starting at roughly two-thirds through the sample, extending
   to the very end (including blank tail).
10. Open **Effects → Echo** (or an Echo panel). Set Echo Rate to a large value
    (e.g. 6000 bytes) and Number of Echoes to 3–5. Click **Apply**.
11. Audition the sample. Verify audible decaying echoes.
12. Find **Remove Unused Space** (or **Trim**) and apply it. Verify the sample
    length shortens to remove trailing silence.

### Steps — Reverse (Part 4 sidebar)

13. Mark any range and click **Reverse**. Audition — the selected section should
    play backwards.

### Failure mode
Current sample editor shows waveform display only; no edit operations. **Fails at step 2**.

### Acceptance criteria for #34
- Erase, Cut, Copy, Paste (at Range Start position) operate on the raw PCM buffer.
- Buffsize / Expand grows the buffer with zero padding.
- Echo: apply N decaying copies of the range at each stride of `rate` bytes.
- Trim / Remove Unused Space strips trailing silence.
- Reverse: invert the byte order of the selected range.

---

## B07 — Synthsound waveform transformation + JMP loop

**Tutorial reference:** Part 5, Steps 8–9

### Status: ✅ Pass — multi-waveform synth bank + pitch program editor + Do Transform + pre-rendered playback (#33 core)

### Preconditions
- Synth instrument slot selected.
- #33 implemented: multi-waveform support + pitch program editor.

### Steps

1. Open the Synth Editor. Create a new synthsound with 11 waveforms.
2. Set waveform 0 to a **Triangle** shape (via a Presets dropdown).
3. Navigate to waveform 10 and set it to a **Pulse** shape.
4. Trigger **Start Transformation** on waveform 0 (menu or button).
5. Navigate back to waveform 0 and trigger **Do Transformation**.
6. Step through waveforms 1–9 and verify each is a smooth morph between
   triangle and pulse.
7. In the pitch program, enter play instructions for waveforms 0 through 10
   (hex: `00` through `0A`). Use a **Transition** helper button to fill them
   automatically, then add a transition from `0A` back to `01`.
8. Add a `JMP` to make the pitch program loop (move to the final `END`, add `JMP 00`).
9. Play a note. Verify the timbre morphs continuously in a loop.

### Acceptance criteria for #33 (multi-waveform detail)
- The synth stores N waveforms (1..N configurable).
- The pitch program accepts `00`–`NN` (hex waveform index) play instructions.
- Transformation creates interpolated in-between waveforms.
- `JMP n` in the pitch program loops back to line n.
- `Transition` helper auto-fills sequential waveform indices between two entries.

---

## B08 — Synthsound soft-start swell (CHU + WAI + CHD)

**Tutorial reference:** Part 5, Step 7

### Status: ✅ Pass — volume program textarea (VOL PROG) implemented; simulateVolProg drives per-tick GainNode scheduling

### Preconditions
- Synth instrument with a volume program containing at least `CHD 03`.
- (#33 implemented for basic CHD; this test extends it.)

### Steps

1. Open the volume program editor for a synth instrument.
2. Set the initial volume instruction to `10` (quarter volume, decimal 16).
3. Insert `CHU 03` (change volume up at speed 3) before the existing `CHD`.
4. Insert `WAI 20` (wait 32 ticks) between `CHU 03` and `CHD 03`.
5. The volume program should read:
   ```
   10       ← set volume = 0x10
   CHU 03   ← swell up
   WAI 20   ← hold at peak
   CHD 03   ← fade out
   HLT
   ```
6. Enter the synth in the pattern editor and play a note (sustain for several seconds).
7. Verify the volume starts quietly, swells, holds briefly, then fades.

### Additional acceptance criteria for #33
- `CHU n` / `CHD n`: increment / decrement volume register by `n` per tick.
- `WAI n`: pause the volume program for `n` ticks.
- Initial volume instruction is a bare hex number (set volume level directly).
- Program halts on `HLT`; note continues at zero volume until note-off.

---

## B09 — Synthsound VBD / VBS vibrato in pitch program

**Tutorial reference:** Part 5, Step 6

### Status: ❌ Fail — synth command script not implemented (#33)

### Preconditions
- Synth instrument with at least one waveform.
- Pitch program editor accessible (#33).

### Steps

1. Open the pitch program. Delete any existing CHD instructions.
2. Enter `VBD 04` (vibrato depth = 4).
3. Enter `VBS 32` (vibrato speed = 0x32 = 50 decimal).
4. Keep the `JMP` to loop (or ensure the pitch program loops automatically).
5. Play a note. Verify audible pitch oscillation (vibrato) on the synth tone.
6. Change `VBD` to `08` and replay. Verify deeper / wider pitch modulation.
7. Change `VBS 32` to `VBS 08` (slower). Verify slower oscillation.

### Additional acceptance criteria for #33
- `VBD n`: set LFO amplitude in internal pitch units (maps to semitone-fraction).
- `VBS n`: set LFO frequency (Hz or ticks-per-cycle).
- Vibrato in the pitch program is independent of the sample vibrato command `04`;
  both can coexist (synth pitch program + pattern-level command).

---

## B10 — Synthsound ARP arpeggio

**Tutorial reference:** Part 5, sidebar — "ARP arpeggio"

### Status: ❌ Fail — synth command script not implemented (#33)

### Preconditions
- Synth instrument with at least one waveform.
- Pitch program editor accessible (#33).

### Steps

1. Open the pitch program for a synth instrument.
2. Enter an ARP sequence for a **major arpeggio**: `ARP 00 04 07 ARE`
   (root, major-third +4 semitones, perfect-fifth +7 semitones).
3. Play a note. Verify the pitch rapidly cycles through the three intervals
   (root → +4 semitones → +7 semitones → root …).
4. Replace with a **minor arpeggio**: `ARP 00 03 07 ARE`. Replay and verify
   the middle interval is now a minor third (+3).
5. Add `JMP` to loop the pitch program if it doesn't loop by default.

### Additional acceptance criteria for #33
- `ARP p1 p2 … ARE`: list of pitch offsets (semitones from base, hex values).
  On each pitch-program tick, advance to the next pitch in the list.
- `ARE`: end of arpeggio list (wraps back to `p1` on the next tick).
- Pitches are additive offsets from the note's base pitch, not absolute values.
- ARP entries in the pitch program can coexist with waveform-play instructions
  on different lines.

---

## Running the tests

```bash
# Start the dev server
cd /path/to/modecat
npm run dev

# Open http://localhost:5173 in a browser
# Run each test plan manually, noting Pass / Partial / Fail
# Log any new failures as backlog tickets
```

There is no automated test harness yet. A Playwright scaffold would be the
natural next step once the T03 / T05 gaps (pure UI state) are filled, as those
are the easiest to assert programmatically.
