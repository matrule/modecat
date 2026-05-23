# Briefing: Redesign SampleEditor.tsx for ModeCat

## Your task

You are going to redesign and rewrite a single React component file: `src/components/SampleEditor.tsx`.

**Deliverable:** A complete replacement `SampleEditor.tsx` — self-contained, same props, same store API, same CSS conventions. Hand it back as a full file. Do not modify any other file. The integrating thread will drop it in and run `tsc --noEmit --skipLibCheck` to verify.

---

## What is ModeCat?

ModeCat is a browser-based music tracker — think FastTracker / OctaMED from the Amiga era, rebuilt in React + TypeScript. It has:

- A **sequencer grid** (notes entered into rows × channel columns, like a spreadsheet)
- An **instrument list** (slots 0–31, each can be Sample / MIDI / Synth / Hybrid / Empty)
- A **song editor** (arranges blocks/patterns into a song sequence)
- **MDI windows** that float over the main layout — the Sample Editor is one of these

The aesthetic is deliberately retro: dark blue backgrounds (`#000022`, `#001133`), cyan/orange text, monospace font (`var(--font-mono)`), chunky button rows. It should feel like OctaMED Pro running on a Workbench 3.1 screen.

---

## Current SampleEditor — full source

The current file is 1,333 lines. Key structural sections:

```
PCM helper functions (clamp1, copyPcm, spliceOut, spliceIn, applyEcho, applyChangeVolume, lastNonSilent, firstNonSilent)
BPM detection (detectBpm — onset-strength peak-picking, returns 60–180 BPM)
Module-level audio state (_previewCtx, _previewSrc, playhead tracking vars)
playPcmLooping / playPcmPreview / playPcmAtPitch / stopPcmPreview
ZoomGadget sub-component (Amiga-style nested-box SVG icon)
SampleEditor main component:
  - derives `sample` from store (works for both kind='sample' and kind='hybrid')
  - waveform canvas rendering (useEffect draws waveform + selection + loop markers + beat grid)
  - playhead animation loop (rAF, saves/restores ImageData, draws white line)
  - canvas mouse interaction (selection drag, loop marker drag with beat-snap)
  - zoom/scroll helpers (zoomIn, zoomOut, showAll, scrollLeft/Right, goToStart/End)
  - PCM operations (opErase, opCut, opCopy, opPaste, opReverse, opTrim, opTrimToLoop, opExpand, opEcho, opChangeVolume)
  - Non-sample early returns (empty slot, midi, synth — MIDI and Synth render their own UI or delegate)
  - JSX layout:
      1. Title bar (slot name, [HYB] badge, ZoomGadget)
      2. Name + base note + volume + SEQ LOOP row
      3. Transport row (PLAY, LOOP, STOP, LIVE, zoom buttons, Library…, Load WAV…, Clear)
      4. Waveform canvas (height 160px normal / 280px expanded)
      5. Loop info bar (IN/OUT times, loop length, bar count, total sample count)
      6. Four-column panel: TIMING | TUNE | ENVELOPE | INFO (InfoPanel component)
      7. Edit buttons row (SEL All/Desel, Erase/Copy/Cut/Paste/Reverse, Trim Silence, Trim to Loop, Echo, Change Vol, Expand)
         + inline advanced dialogs (echo params, change volume with sliders, expand buffer)
         + range info line
  - `expanded` state: when true, the whole component fixed-positions over the sequencer (Amiga zoom-gadget behaviour)
```

The TIMING panel includes BPM detection, a beat grid overlay, bar-snap buttons, NOTE LEN (rows), and a "FIT PITCH" suggestion when sample BPM ≠ song BPM. The TUNE panel has transpose/finetune nudge inputs, a pitch test button, and a BPM-target section that computes the pitch shift to match a target BPM.

---

## Store API — what the component reads and writes

```typescript
// Reads
const idx           = useStore((s) => s.selectedInstrument);   // number (0-based slot index)
const inst          = useStore((s) => s.instruments[idx]);      // Instrument | undefined
const songBpm       = useStore((s) => s.transport.bpm);         // number

// Writes
const setInstrument = useStore((s) => s.setInstrument);
// signature: setInstrument(idx: number, newInst: Instrument) => void
// Used to update any field: pcm, loopStart, loopEnd, transpose, finetune, volume, name, etc.
```

`useStore` is from `'../state/store'`. The `useActivePattern` hook is NOT used in this component.

---

## SampleInstrument type (from `../state/types`)

```typescript
export interface SampleInstrument {
  kind: 'sample';
  name: string;
  pcm: Float32Array | null;
  sampleRate: number;
  baseNote: number;           // MIDI note at which sample plays at natural speed (0–127)
  loopEnabled: boolean;       // true = sequencer loops between loopStart..loopEnd
  loopStart: number;          // loop start offset in samples
  loopEnd: number;            // loop end offset in samples
  volume: number;             // 0..127
  transpose: number;          // semitone offset
  finetune: number;           // -8..+7 (1/8-semitone units)
  defaultPitch: number;       // 0..127 (default entry pitch for F-key shortcut)
  suppressNoteOff: boolean;   // one-shot: ignore note-off
  attackMs:   number;         // AHDSR, 0..2000 ms
  decayMs:    number;         // 0..2000 ms
  sustain:    number;         // 0..1
  releaseMs:  number;         // 0..4000 ms
  lengthRows: number;         // 0 = play until next note; N = stop after N rows
}
```

`HybridInstrument` has the same PCM fields — the component casts it to `SampleInstrument` and mutates it with spread so hybrid-specific fields survive.

---

## Props

```typescript
interface SampleEditorProps {
  onOpenLibrary?: () => void;  // called when user clicks "Library…" button
}
export function SampleEditor({ onOpenLibrary }: SampleEditorProps = {}) { ... }
```

---

## CSS / styling conventions

ModeCat uses global CSS with these patterns:

```css
/* CSS variables */
--wb-blue: #0055AA          /* title bars, menu bar, status bar */
--wb-black: #000000
--wb-orange: #FF8800
--font-mono: "VT323", "Courier New", monospace

/* Utility classes */
.btn          /* small retro button */
.field-row    /* label + input pair, display:flex, align-items:center, gap */
.panel        /* column flex container with padding */
.panel__title /* orange all-caps section header */
.upper        /* font-variant: small-caps or text-transform: uppercase */
.muted        /* reduced opacity */
.ip-backdrop  /* fixed full-screen overlay, rgba dark */
.ip-dialog    /* centered dialog box */
.ip-titlebar  /* blue title bar */
.ip-body, .ip-footer, .ip-label, .ip-input /* dialog layout */
.wb-dialog, .wb-dialog__body, .wb-dialog__footer, .wb-dialog__btn, .wb-dialog__btn--ok, .wb-dialog__btn--danger
```

Inline styles are fine and common (the current file uses them heavily). Use `var(--wb-blue)`, `var(--font-mono)` etc. everywhere rather than hard-coded values where possible. For title bars and section headers, `background: '#0055AA'`, `color: '#FFFFFF'` is the pattern. Waveform canvas background is `#000000`. Body/panel backgrounds are `#000022` or `#001133`.

---

## Other components you can import

```typescript
import { SynthEditor } from './SynthEditor';   // renders synth instrument UI
import { InfoPanel } from './InfoPanel';        // read-only info panel (renders itself from store)
```

You must NOT import anything that doesn't already exist. Do not create new files. Do not import from paths that don't exist. The existing WbDialog hook is available if you need it:

```typescript
import { useWbDialog } from './WbDialog';
// const { wbPrompt, wbConfirm, wbAlert, dialogEl } = useWbDialog();
// render {dialogEl} in JSX
// const name = await wbPrompt('Title', { label: 'Name', defaultValue: '' })
// const ok   = await wbConfirm('Are you sure?', { danger: true })
```

---

## What to redesign / improve

The current implementation works but is cramped and hard to navigate in practice. The user wants the Sample Editor to feel more like OctaMED Pro's sample editing screen — professional, spacious when expanded, and fast to use.

**Goals for the redesign:**

1. **Better layout organisation.** The current four-column TIMING / TUNE / ENVELOPE / INFO grid is hard to read at smaller sizes. Consider whether collapsible sections, tabs, or a two-row layout would work better. The INFO panel (which renders itself) should still have a visible slot.

2. **Waveform canvas should be the hero.** It should be larger by default and grow properly when expanded. The current 160px height feels insufficient for a pro tool.

3. **Loop point workflow.** The drag-to-move loop markers (current: mousedown on canvas near the green IN / orange OUT handles) should be the primary interaction. Consider adding numeric nudge inputs directly on the loop info bar so the user can enter exact sample positions.

4. **Selection info.** The range info currently shows `Range: 12345–67890 (55546 smp)` at the bottom. It should also show time in seconds and, when BPM is set, bars/beats.

5. **BPM / timing panel.** The current DETECT, GRID, bar-snap buttons are functional but dense. Consider whether the timing controls could be better organised or have more visual breathing room.

6. **Keyboard shortcuts.** The editor should respond to at least: Space = play/stop, L = toggle loop, A = select all, Delete = erase selection, Z/X = zoom in/out, Escape = close expanded view.

7. **WAV export.** Add a "Save WAV…" button alongside "Load WAV…" that encodes the current PCM (or selection) to a WAV file and triggers a browser download. WAV encoding can be done inline — 16-bit PCM, standard 44-byte header.

8. **Visual polish.** The expanded mode currently overlays a semi-transparent backdrop and positions the editor fixed on the right. This is fine — just make sure the expanded canvas fills the available space vertically, and the layout adapts gracefully.

**Keep working as-is:**
- All PCM operations (cut/copy/paste/reverse/trim/echo/changevol/expand)
- BPM detection algorithm (detectBpm — no changes needed)
- Playhead animation (rAF + ImageData snapshot approach is correct)
- Beat grid overlay on the canvas
- Loop marker drag with beat-snap (Shift bypasses snap)
- ZoomGadget icon (keep the Amiga nested-box SVG)
- Non-sample early returns (empty slot → plain message; midi → MIDI params; synth → `<SynthEditor>`)
- Hybrid instrument support (cast to SampleInstrument, preserve extra fields on spread)
- `suppressNoteOff` (ONE-SHOT checkbox in ENVELOPE panel)

---

## Constraints

- **TypeScript.** Strict mode is on. No `any` unless you have to cast (use `as SampleInstrument` where the current code does).
- **React hooks only.** No class components. `useState`, `useEffect`, `useRef`, `useCallback`, `useMemo` — all fine.
- **No new dependencies.** Web Audio API is available natively. No npm packages.
- **Single file.** Everything in `SampleEditor.tsx`. No new files.
- **Exports.** The default export must be named `SampleEditor`. Keep all existing module-level audio state variables so stop() still works across renders.
- **No native dialogs.** Use `useWbDialog` instead of `window.prompt`, `window.confirm`, `window.alert`.

---

## WAV export helper (if you add it)

```typescript
function encodePcmToWav(pcm: Float32Array, sampleRate: number): Uint8Array {
  const numSamples = pcm.length;
  const byteRate = sampleRate * 2; // 16-bit mono
  const buf = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);        // chunk size
  view.setUint16(20, 1, true);         // PCM
  view.setUint16(22, 1, true);         // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true);         // block align
  view.setUint16(34, 16, true);        // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Uint8Array(buf);
}

function downloadWav(pcm: Float32Array, sampleRate: number, filename: string) {
  const bytes = encodePcmToWav(pcm, sampleRate);
  const blob = new Blob([bytes], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
```

---

## Final checklist before handing back

- [ ] `tsc --noEmit --skipLibCheck` passes (no type errors)
- [ ] All existing PCM operations preserved
- [ ] Props unchanged: `{ onOpenLibrary?: () => void }`
- [ ] Store reads: `selectedInstrument`, `instruments[idx]`, `transport.bpm`, `setInstrument`
- [ ] Handles all instrument kinds: empty → message, midi → MIDI params, synth → `<SynthEditor>`, sample/hybrid → full editor
- [ ] `SampleEditor` is a named export
- [ ] No imports from non-existent files
- [ ] No native browser prompt/confirm/alert calls
- [ ] No new files created

Hand back: the complete replacement `SampleEditor.tsx` only.
