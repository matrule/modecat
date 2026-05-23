// SampleEditor — ModeCat-style waveform display + PCM editing.
//
// Redesigned layout (OctaMED Pro feel):
//   • Title bar with Amiga zoom gadget
//   • Name / volume / SEQ LOOP row
//   • Transport row: PLAY · LOOP · STOP · LIVE · METRO · zoom · Library / Load / Save WAV / Clear
//   • Waveform canvas — the hero element; overlaid with a transpose-aware SONG GRID
//   • Loop info bar with numeric IN/OUT nudge inputs + loop-seam indicator
//   • 2×2 panel grid: RECORDED | TUNE / ENVELOPE | INFO  (wraps to 1 column when narrow)
//   • Edit buttons row + inline advanced dialogs + rich range info
//
// Pitch model:
//   RECORDED panel = what the sample IS  (recorded BPM + recorded key / baseNote).
//   TUNE panel     = how it FITS the song. Three modes via a segmented selector:
//     • BY BPM  — recorded BPM → target BPM, computes the semitone shift.
//     • BY BARS — pitches the loop so it spans an exact number of song bars.
//     • BY PITCH— free manual transpose / finetune.
//   playbackRate = 2^((transpose + finetune/8) / 12); the song grid is spaced by it,
//   so pitching up squeezes the sample into fewer song bars and down stretches it.
//
// Keyboard: Space play/stop · L loop · A select all · Del erase · Z/X zoom · M metro · Esc close.
//
// NOTE — two fields are read/written through a cast because they are not yet on the
// SampleInstrument type: `recordedBpm` (number) and `ignorePitch` (boolean). They
// persist in the store object via object spread (same mechanism that preserves
// hybrid-only fields). See the accompanying types.ts diff + engine note.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { Instrument, SampleInstrument, SynthInstrument, MidiInstrument } from '../state/types';
import { SynthEditor } from './SynthEditor';
import { addSampleToLibrary } from './SampleBrowser';
// InfoPanel not used here — the INFO slot uses a compact inline block instead.

// ── PCM helpers ──────────────────────────────────────────────────────────────

function clamp1(v: number) { return Math.max(-1, Math.min(1, v)); }
function copyPcm(pcm: Float32Array): Float32Array { const o = new Float32Array(pcm.length); o.set(pcm); return o; }

function spliceOut(pcm: Float32Array, a: number, b: number): Float32Array {
  const out = new Float32Array(pcm.length - (b - a + 1));
  out.set(pcm.subarray(0, a), 0);
  out.set(pcm.subarray(b + 1), a);
  return out;
}

function spliceIn(pcm: Float32Array, pos: number, clip: Float32Array): Float32Array {
  const p = Math.max(0, Math.min(pcm.length, pos));
  const out = new Float32Array(pcm.length + clip.length);
  out.set(pcm.subarray(0, p), 0);
  out.set(clip, p);
  out.set(pcm.subarray(p), p + clip.length);
  return out;
}

function applyEcho(
  pcm: Float32Array, a: number, b: number,
  rateSmps: number, count: number, volDecPct: number
): Float32Array {
  const maxTail = b + count * rateSmps + 1;
  const out = new Float32Array(Math.max(pcm.length, maxTail));
  out.set(pcm);
  const atten = 1 - Math.max(0, Math.min(100, volDecPct)) / 100;
  for (let i = 1; i <= count; i++) {
    const vol = Math.pow(atten, i);
    for (let j = a; j <= b; j++) {
      const dst = j + i * rateSmps;
      if (dst < out.length) out[dst] = clamp1(out[dst]! + (pcm[j] ?? 0) * vol);
    }
  }
  return out;
}

function applyChangeVolume(
  pcm: Float32Array, a: number, b: number,
  startPct: number, endPct: number, dontClip: boolean
): Float32Array {
  const out = copyPcm(pcm);
  const len = b - a + 1;
  for (let i = a; i <= b; i++) {
    const t = len > 1 ? (i - a) / (len - 1) : 0;
    const scale = (startPct * (1 - t) + endPct * t) / 100;
    const v = (pcm[i] ?? 0) * scale;
    out[i] = dontClip ? clamp1(v) : v;
  }
  return out;
}

function lastNonSilent(pcm: Float32Array, thr = 0.001): number {
  for (let i = pcm.length - 1; i >= 0; i--) if (Math.abs(pcm[i]!) > thr) return i;
  return 0;
}
function firstNonSilent(pcm: Float32Array, thr = 0.001): number {
  for (let i = 0; i < pcm.length; i++) if (Math.abs(pcm[i]!) > thr) return i;
  return 0;
}

// Nearest zero-crossing to a sample position — used for click-free loop snapping.
function nearestZeroCrossing(pcm: Float32Array, pos: number, maxSearch = 8192): number {
  const p = Math.max(0, Math.min(pcm.length - 1, Math.round(pos)));
  for (let d = 0; d < maxSearch; d++) {
    const a = p + d;
    if (a > 0 && a < pcm.length && (pcm[a - 1]! <= 0) !== (pcm[a]! <= 0)) return a;
    const b = p - d;
    if (b > 0 && b < pcm.length && (pcm[b - 1]! <= 0) !== (pcm[b]! <= 0)) return b;
  }
  return p;
}

// MIDI note name for pitch display
function noteName(n: number): string {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const i = ((Math.round(n) % 12) + 12) % 12;
  return `${names[i]}-${Math.floor(Math.round(n) / 12) - 1}`;
}

// Convert a semitone shift to a (transpose, finetune) pair. finetune is in
// 1/8-semitone units, clamped to -8..+7; a rounded +8/8 carries into transpose.
function semisToTune(semis: number): { transpose: number; finetune: number } {
  let tr = Math.trunc(semis);
  let fn = Math.round((semis - tr) * 8);
  if (fn > 7)  { fn -= 8; tr += 1; }
  if (fn < -8) { fn += 8; tr -= 1; }
  return {
    transpose: Math.max(-48, Math.min(48, tr)),
    finetune:  Math.max(-8,  Math.min(7,  fn)),
  };
}

// ── WAV export ────────────────────────────────────────────────────────────────

/** Encode mono Float32 PCM to a 16-bit WAV byte stream (44-byte header). */
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

/** Encode PCM and trigger a browser download. */
function downloadWav(pcm: Float32Array, sampleRate: number, filename: string) {
  const bytes = encodePcmToWav(pcm, sampleRate);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── Audio playback ────────────────────────────────────────────────────────────

// Play PCM (or a sub-range) via Web Audio.
// Module-level state so stop() can reach across renders.
let _previewCtx: AudioContext | null = null;
let _previewSrc: AudioBufferSourceNode | null = null;

// Playhead tracking — written by play functions, read by the animation loop.
let _phCtxTime0  = 0;       // AudioContext.currentTime when play started
let _phSmpStart  = 0;       // sample frame where play position began
let _phSmpRate   = 44100;
let _phLoopStart = 0;
let _phLoopEnd   = 0;
let _phIsLoop    = false;

// Metronome — independent module-level state so it survives re-renders.
let _metroCtx: AudioContext | null = null;
let _metroTimer: number | null = null;

function stopPcmPreview() {
  if (_previewSrc) { try { _previewSrc.stop(); } catch {} _previewSrc = null; }
  if (_previewCtx) { try { _previewCtx.close(); } catch {} _previewCtx = null; }
}

function playPcmLooping(pcm: Float32Array, sampleRate: number, loopStart: number, loopEnd: number) {
  stopPcmPreview();
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  _previewCtx = ctx;
  const plain = new Float32Array(pcm.length);
  plain.set(pcm);
  const buf = ctx.createBuffer(1, plain.length, sampleRate);
  buf.copyToChannel(plain, 0);
  const src = ctx.createBufferSource();
  _previewSrc = src;
  src.buffer = buf;
  src.loop = true;
  src.loopStart = Math.max(0, loopStart) / sampleRate;
  src.loopEnd   = Math.min(pcm.length, loopEnd) / sampleRate;
  src.connect(ctx.destination);
  // Start playback FROM the loop start point, not the beginning of the buffer
  src.start(0, src.loopStart);
  // Record playhead tracking info
  _phCtxTime0  = ctx.currentTime;
  _phSmpStart  = loopStart;
  _phSmpRate   = sampleRate;
  _phLoopStart = loopStart;
  _phLoopEnd   = loopEnd;
  _phIsLoop    = true;
  src.onended = () => {
    if (_previewSrc === src) _previewSrc = null;
    if (_previewCtx === ctx) { _previewCtx = null; try { ctx.close(); } catch {} }
  };
}

function playPcmPreview(pcm: Float32Array, sampleRate: number, a?: number, b?: number) {
  stopPcmPreview();
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  _previewCtx = ctx;
  const s = a ?? 0;
  const e = b ?? pcm.length - 1;
  const slice = pcm.slice(s, e + 1);
  const buf = ctx.createBuffer(1, slice.length, sampleRate);
  buf.copyToChannel(new Float32Array(slice), 0);
  const src = ctx.createBufferSource();
  _previewSrc = src;
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  // Record playhead tracking info (buffer starts at sample s)
  _phCtxTime0  = ctx.currentTime;
  _phSmpStart  = s;
  _phSmpRate   = sampleRate;
  _phLoopStart = s;
  _phLoopEnd   = e;
  _phIsLoop    = false;
  src.onended = () => {
    if (_previewSrc === src) { _previewSrc = null; }
    if (_previewCtx === ctx) { _previewCtx = null; try { ctx.close(); } catch {} }
  };
}

/**
 * Play PCM with pitch applied via AudioBufferSourceNode.playbackRate.
 * transpose = semitone offset; finetune = 1/8-semitone units (–8..7).
 * The sample is treated as if its baseNote is its natural pitch — transposing
 * by N semitones plays it at 2^(N/12) × normal speed.
 */
function playPcmAtPitch(pcm: Float32Array, sampleRate: number, transpose: number, finetune: number) {
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  const buf = ctx.createBuffer(1, pcm.length, sampleRate);
  const plain = new Float32Array(pcm.length);
  plain.set(pcm);
  buf.copyToChannel(plain, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  // Total semitones = transpose + finetune/8
  src.playbackRate.value = Math.pow(2, (transpose + finetune / 8) / 12);
  src.connect(ctx.destination);
  src.start();
  src.onended = () => { try { ctx.close(); } catch {} };
}

// ── Metronome ─────────────────────────────────────────────────────────────────

function stopMetronome() {
  if (_metroTimer != null) { clearInterval(_metroTimer); _metroTimer = null; }
  if (_metroCtx) { try { _metroCtx.close(); } catch {} _metroCtx = null; }
}

/** Start a 4/4 click track at the given BPM. Accents the first beat of each bar. */
function startMetronome(bpm: number) {
  stopMetronome();
  const safeBpm = Math.max(20, Math.min(400, bpm));
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  _metroCtx = ctx;
  const click = (accent: boolean) => {
    if (_metroCtx !== ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = accent ? 1600 : 900;
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.09);
  };
  let beat = 0;
  click(true);
  _metroTimer = window.setInterval(() => {
    beat = (beat + 1) % 4;
    click(beat === 0);
  }, (60 / safeBpm) * 1000);
}

// ── BPM detection ─────────────────────────────────────────────────────────────

/**
 * Estimate the tempo of a PCM sample via onset-strength peak-picking.
 *
 * Strategy:
 *  1. Compute RMS energy in overlapping 50ms windows (10ms hop).
 *  2. Onset strength = positive energy flux between adjacent frames.
 *  3. Find local peaks above an adaptive threshold.
 *  4. Collect inter-peak intervals, convert to BPM, fold into 60–180 range.
 *  5. Return the BPM that accumulated the most votes.
 *
 * Works well on drums/breaks; less reliable on melodic/ambient material.
 * Returns 120 as a safe fallback if detection fails.
 */
function detectBpm(pcm: Float32Array, sampleRate: number): number {
  const WIN   = Math.round(sampleRate * 0.05);  // 50ms energy window
  const HOP   = Math.round(sampleRate * 0.01);  // 10ms hop

  // --- energy envelope ---
  const frames: number[] = [];
  for (let i = 0; i + WIN < pcm.length; i += HOP) {
    let e = 0;
    for (let j = i; j < i + WIN; j++) e += pcm[j]! * pcm[j]!;
    frames.push(e / WIN);
  }
  if (frames.length < 4) return 120;

  // --- onset strength: positive energy flux ---
  const onset: number[] = [0];
  for (let i = 1; i < frames.length; i++) {
    onset.push(Math.max(0, frames[i]! - frames[i - 1]!));
  }

  // --- adaptive peak picking ---
  const WIN_FRAMES = Math.round(0.25 * sampleRate / HOP); // 250ms local window
  const peaks: number[] = []; // peak times in seconds
  for (let i = 1; i < onset.length - 1; i++) {
    const v = onset[i]!;
    if (v <= onset[i - 1]! || v <= onset[i + 1]!) continue; // not a local max
    const s = Math.max(0, i - WIN_FRAMES);
    const e = Math.min(onset.length, i + WIN_FRAMES);
    let mean = 0;
    for (let k = s; k < e; k++) mean += onset[k]!;
    mean /= (e - s);
    if (v > mean * 1.4) peaks.push((i * HOP) / sampleRate);
  }
  if (peaks.length < 2) return 120;

  // --- inter-onset intervals → BPM votes ---
  const votes = new Map<number, number>();
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < Math.min(peaks.length, i + 10); j++) {
      const interval = peaks[j]! - peaks[i]!;
      if (interval < 0.2 || interval > 2.5) continue; // 24..300 BPM raw
      let bpm = 60 / interval;
      // Fold into 60–180 range
      while (bpm < 60)  bpm *= 2;
      while (bpm > 180) bpm /= 2;
      const r = Math.round(bpm);
      votes.set(r, (votes.get(r) ?? 0) + 1);
    }
  }
  if (votes.size === 0) return 120;

  // --- pick winner ---
  let bestBpm = 120, bestVotes = 0;
  for (const [bpm, v] of votes) {
    if (v > bestVotes) { bestVotes = v; bestBpm = bpm; }
  }
  return bestBpm;
}

// ── Key (pitch) detection ─────────────────────────────────────────────────────

/**
 * Estimate the musical key of a PCM sample as a MIDI note number, using the
 * McLeod Pitch Method (normalized square-difference function + key-maximum
 * picking). Reliable on tonal / sustained / looping material; unreliable on
 * drums or noise — callers should treat the result as a suggestion.
 *
 * Returns -1 when no confident pitch is found.
 */
function detectKey(pcm: Float32Array, sampleRate: number, from = 0): number {
  const N = Math.min(8192, pcm.length - from);
  if (N < 2048) return -1;
  const x = pcm.subarray(from, from + N);

  const minTau = Math.max(2, Math.floor(sampleRate / 1100)); // ~1100 Hz ceiling
  const maxTau = Math.min(N - 2, Math.floor(sampleRate / 50)); // ~50 Hz floor
  if (maxTau <= minTau) return -1;

  // Normalized square-difference function.
  const nsdf = new Float32Array(maxTau + 1);
  for (let tau = minTau; tau <= maxTau; tau++) {
    let acf = 0, div = 0;
    for (let j = 0; j + tau < N; j++) {
      const a = x[j]!, b = x[j + tau]!;
      acf += a * b;
      div += a * a + b * b;
    }
    nsdf[tau] = div > 0 ? (2 * acf) / div : 0;
  }

  // Key maxima: the peak value between successive positive-going zero crossings.
  const peaks: Array<{ tau: number; val: number }> = [];
  let bestVal = 0;
  let curTau = -1, curVal = -Infinity, positive = false;
  for (let tau = minTau; tau <= maxTau; tau++) {
    const v = nsdf[tau]!;
    if (!positive) {
      if (v > 0) { positive = true; curTau = tau; curVal = v; }
    } else if (v <= 0) {
      if (curTau >= 0) { peaks.push({ tau: curTau, val: curVal }); if (curVal > bestVal) bestVal = curVal; }
      positive = false; curTau = -1; curVal = -Infinity;
    } else if (v > curVal) {
      curVal = v; curTau = tau;
    }
  }
  if (positive && curTau >= 0) {
    peaks.push({ tau: curTau, val: curVal });
    if (curVal > bestVal) bestVal = curVal;
  }
  if (bestVal < 0.5) return -1; // not tonal enough to trust

  // First key maximum within 90% of the strongest — MPM's clarity rule.
  const thresh = bestVal * 0.9;
  let chosen = -1;
  for (const p of peaks) { if (p.val >= thresh) { chosen = p.tau; break; } }
  if (chosen < minTau) return -1;

  const freq = sampleRate / chosen;
  const midi = Math.round(69 + 12 * Math.log2(freq / 440));
  return Math.max(0, Math.min(127, midi));
}

// ── Shared retro styles ───────────────────────────────────────────────────────

// Hide the native number-input spin buttons inside the editor — the −/+ nudge
// buttons replace them, and they clip 3-digit values. Scoped to `.se-root`.
const NUM_FIELD_CSS =
  '.se-root input[type=number]{-moz-appearance:textfield;appearance:textfield;}' +
  '.se-root input[type=number]::-webkit-outer-spin-button,' +
  '.se-root input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}' +
  '.se-root .field-row{display:flex;flex-wrap:wrap;align-items:center;gap:0.2rem 0.3rem;}' +
  '.se-root .field-row>label{width:auto;min-width:4ch;flex-shrink:0;}';

const dialogStyle: React.CSSProperties = {
  background: '#000055',
  border: '2px outset #0055AA',
  padding: '0',
  minWidth: 0,
  flex: '1 1 220px',
};
const dialogTitleStyle: React.CSSProperties = {
  background: '#0055AA',
  color: '#FFFFFF',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.75rem',
  padding: '0.15rem 0.4rem',
  userSelect: 'none',
};
const dialogBodyStyle: React.CSSProperties = {
  padding: '0.4rem 0.5rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
};

// 2×2 panel grid — each panel takes half width, collapsing to full width when
// the container is narrower than ~2× the min-width (graceful wrap to 1 column).
const panelStyle: React.CSSProperties = {
  flex: '1 1 calc(50% - 1px)',
  minWidth: 270,
  boxSizing: 'border-box',
  background: '#000022',
  padding: '0.45rem 0.6rem',
};
const panelTitleStyle: React.CSSProperties = {
  color: '#FF8800',
  fontSize: '0.74rem',
  letterSpacing: '0.08em',
  borderBottom: '1px solid rgba(255,136,0,0.3)',
  marginBottom: '0.4rem',
  paddingBottom: '0.15rem',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
};
const panelHintStyle: React.CSSProperties = { color: '#44566a', fontSize: '0.62rem', letterSpacing: 0 };

const nudgeStyle: React.CSSProperties = { padding: '0 0.3rem', minWidth: '1.4rem', fontSize: '0.8rem', lineHeight: '1' };

// Number-input widths — spin buttons are hidden, so these size to content only.
const numXS:   React.CSSProperties = { width: '3.6ch', textAlign: 'center' }; // 1–2 chars (finetune)
const numS:    React.CSSProperties = { width: '5ch',   textAlign: 'center' }; // up to 3 chars / "-48"
const numBpm:  React.CSSProperties = { width: '6.5ch', textAlign: 'center' }; // "138.5" / "400"
const numEnv:  React.CSSProperties = { width: '6ch',   textAlign: 'center' }; // envelope values
const numWide: React.CSSProperties = { width: '9.5ch', textAlign: 'center' }; // sample-position / large counts
const numName: React.CSSProperties = { minWidth: '10ch' };

// ── Amiga-style zoom gadget ───────────────────────────────────────────────────

/** The classic Amiga window zoom/size gadget: a nested-box icon. */
function ZoomGadget({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={expanded ? 'Restore (zoom out)' : 'Expand over sequencer (zoom in)'}
      style={{
        background: '#0066CC',
        border: '2px outset #3399FF',
        padding: '0',
        width: 18,
        height: 16,
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      {/* Amiga-style nested-box icon */}
      <svg width="12" height="10" viewBox="0 0 12 10" style={{ display: 'block' }}>
        {expanded ? (
          // Restore: outer box + inner box bottom-right
          <>
            <rect x="0" y="0" width="9" height="8" fill="none" stroke="#FFFFFF" strokeWidth="1.5" />
            <rect x="3" y="3" width="8" height="6" fill="#0055AA" stroke="#FFFFFF" strokeWidth="1.5" />
          </>
        ) : (
          // Expand: small box + arrow to top-right corner
          <>
            <rect x="0" y="2" width="9" height="8" fill="none" stroke="#FFFFFF" strokeWidth="1.5" />
            <polyline points="5,0 12,0 12,6" fill="none" stroke="#FFFFFF" strokeWidth="1.5" />
            <line x1="5" y1="5" x2="11" y2="0" stroke="#FFFFFF" strokeWidth="1.5" />
          </>
        )}
      </svg>
    </button>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

interface SampleEditorProps {
  /** Called when the user clicks "Library…" — opens the Sample Library MDI. */
  onOpenLibrary?: () => void;
}

type TuneMode = 'bpm' | 'bars' | 'pitch';

export function SampleEditor({ onOpenLibrary }: SampleEditorProps = {}) {
  const idx           = useStore((s) => s.selectedInstrument);
  const inst          = useStore((s) => s.instruments[idx]);
  const setInstrument = useStore((s) => s.setInstrument);
  const songBpm       = useStore((s) => s.transport.bpm);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Saved waveform pixels — animation loop restores this before drawing the playhead
  const waveformImageRef = useRef<ImageData | null>(null);
  const animFrameRef = useRef<number | null>(null);
  // Always-current view window — read by the animation loop without stale closures
  const viewRef = useRef({ vStart: 0, vEnd: 0 });

  // Dragging loop marker
  const draggingMarkerRef = useRef<'start' | 'end' | null>(null);

  // Selection (sample-frame indices, inclusive). null = no selection.
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd,   setSelEnd]   = useState<number | null>(null);
  const dragRef = useRef<{ startSmp: number } | null>(null);
  const [canvasCursor, setCanvasCursor] = useState<string>('crosshair');

  // Zoom: which portion of the buffer is visible. null = show all.
  const [viewStart, setViewStart] = useState<number | null>(null);
  const [viewEnd,   setViewEnd]   = useState<number | null>(null);

  // Playback loop toggle: when true, Play button loops between S/E markers.
  const [playLooping, setPlayLooping] = useState(false);

  // Clipboard.
  const [clipboard, setClipboard] = useState<Float32Array | null>(null);

  // Detection in-progress flags.
  const [bpmDetecting, setBpmDetecting] = useState(false);
  const [keyDetecting, setKeyDetecting] = useState(false);

  // Amiga zoom: whether the editor is expanded over the sequencer.
  const [expanded, setExpanded] = useState(false);

  // Echo params.
  const [echoRate,   setEchoRate]   = useState(6000);
  const [echoCount,  setEchoCount]  = useState(3);
  const [echoVolDec, setEchoVolDec] = useState(0);

  // Change Volume params.
  const [cvStart,    setCvStart]    = useState(100);
  const [cvEnd,      setCvEnd]      = useState(100);
  const [dontClip,   setDontClip]   = useState(false);

  // Expand.
  const [expandN, setExpandN] = useState(10000);

  // Toggles.
  const [liveLoop,    setLiveLoop]    = useState(false);
  const [songGridOn,  setSongGridOn]  = useState(true);
  const [metroOn,     setMetroOn]     = useState(false);
  const [advDialog,   setAdvDialog]   = useState<null | 'echo' | 'changevol' | 'expand'>(null);

  // TUNE section: which fit mode is active.
  const [tuneMode,  setTuneMode]  = useState<TuneMode>('bars');
  // Recorded BPM is edited as a string (smooth decimal typing) and mirrored to
  // the instrument's `recordedBpm` field. targetBpm likewise for BY-BPM mode.
  const [recBpmStr,    setRecBpmStr]    = useState('');
  const [targetBpmStr, setTargetBpmStr] = useState('');
  const [targetBars,   setTargetBars]   = useState(4);

  // Bumped on window resize so the canvas re-measures itself (matters in expanded mode).
  const [resizeTick, setResizeTick] = useState(0);

  // Cancel animation + metronome on unmount.
  useEffect(() => () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    stopMetronome();
  }, []);

  // Metronome: runs at the song BPM while toggled on.
  useEffect(() => {
    if (metroOn) startMetronome(songBpm);
    else stopMetronome();
    return () => stopMetronome();
  }, [metroOn, songBpm]);

  // Re-measure canvas on window resize.
  useEffect(() => {
    const onResize = () => setResizeTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ── Playhead animation ─────────────────────────────────────────────────────
  // Uses a single canvas: saves the waveform pixels after each render,
  // then each animation frame restores them and overdraws just the playhead.

  function stopPlayheadAnim() {
    if (animFrameRef.current) { cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null; }
    // Restore clean waveform (no playhead line)
    const canvas = canvasRef.current;
    const img = waveformImageRef.current;
    if (canvas && img) {
      const ctx2d = canvas.getContext('2d');
      ctx2d?.putImageData(img, 0, 0);
    }
  }

  function startPlayheadAnim() {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    const tick = () => {
      const canvas = canvasRef.current;
      const img    = waveformImageRef.current;
      if (!canvas || !img || !_previewCtx) { stopPlayheadAnim(); return; }

      // Restore the clean waveform snapshot
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) { animFrameRef.current = requestAnimationFrame(tick); return; }
      ctx2d.putImageData(img, 0, 0);

      // Compute playhead sample position
      const elapsed = _previewCtx.currentTime - _phCtxTime0;
      let pos = _phSmpStart + elapsed * _phSmpRate;
      if (_phIsLoop && _phLoopEnd > _phLoopStart) {
        const span = _phLoopEnd - _phLoopStart;
        pos = _phLoopStart + ((pos - _phLoopStart) % span);
      }

      // Draw the playhead line in canvas pixel space
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      const { vStart: vs, vEnd: ve } = viewRef.current;
      const visible = ve - vs + 1;
      const cssW = canvas.clientWidth || 400;
      const cssH = canvas.clientHeight || 100;
      const x = Math.floor(((pos - vs) / visible) * cssW);
      if (x >= 0 && x <= cssW) {
        ctx2d.save();
        ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx2d.fillStyle = 'rgba(255,255,255,0.9)';
        ctx2d.fillRect(x, 0, 1, cssH);
        ctx2d.fillStyle = '#FFFFFF';
        ctx2d.beginPath();
        ctx2d.moveTo(x - 4, 0);
        ctx2d.lineTo(x + 5, 0);
        ctx2d.lineTo(x + 0.5, 7);
        ctx2d.fill();
        ctx2d.restore();
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  // HybridInstrument shares all PCM fields with SampleInstrument — treat it
  // identically here so the waveform display and edit tools work for both.
  // Mutations spread the full original object, so hybrid-specific fields
  // (pitchProg, volProg, AHDSR…) are preserved at runtime despite the cast.
  const sample  = (inst?.kind === 'sample' || inst?.kind === 'hybrid')
    ? (inst as SampleInstrument)
    : null;
  const pcmLen  = sample?.pcm?.length ?? 0;
  const vStart  = viewStart ?? 0;
  const vEnd    = viewEnd ?? Math.max(0, pcmLen - 1);
  // Keep animation loop current — ref write is safe during render (no re-render triggered)
  viewRef.current = { vStart, vEnd };
  const sel     = (selStart != null && selEnd != null && selStart < selEnd)
    ? { a: selStart, b: selEnd }
    : null;
  const hasClip = clipboard != null;

  // Fields not yet on the SampleInstrument type — read through a cast. They
  // persist on the stored object via object spread (see types.ts diff).
  const recordedBpm = sample
    ? ((sample as unknown as { recordedBpm?: number }).recordedBpm ?? 0)
    : 0;
  const ignorePitch = sample
    ? ((sample as unknown as { ignorePitch?: boolean }).ignorePitch ?? false)
    : false;

  // Re-sync the editable recorded-BPM string when the selected slot changes.
  useEffect(() => {
    setRecBpmStr(recordedBpm > 0 ? String(recordedBpm) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  // Playback rate implied by the current transpose/finetune.
  const playbackRate = sample
    ? Math.pow(2, (sample.transpose + sample.finetune / 8) / 12)
    : 1;
  // Song grid: how many sample-frames one song beat / bar occupies at this rate.
  const songBeatSamples = sample && songBpm > 0
    ? (playbackRate * sample.sampleRate * 60) / songBpm
    : 0;
  const songBarSamples  = songBeatSamples * 4;
  const loopLenSamples  = sample ? Math.max(0, sample.loopEnd - sample.loopStart) : 0;
  const loopSongBars    = songBarSamples > 0 ? loopLenSamples / songBarSamples : 0;

  // Loop seam: amplitude jump between loopEnd and loopStart — predicts a loop click.
  const loopSeam = (sample?.pcm && sample.loopEnd > sample.loopStart)
    ? Math.abs((sample.pcm[sample.loopEnd] ?? 0) - (sample.pcm[sample.loopStart] ?? 0))
    : 0;
  const seamClean  = loopSeam < 0.02;
  const seamSlight = loopSeam < 0.1;
  const seamColor  = seamClean ? '#00FF88' : seamSlight ? '#FFD700' : '#FF5555';
  const seamLabel  = seamClean ? 'clean loop' : seamSlight ? 'slight seam' : 'audible click';

  function smpToSecs(smp: number): string {
    if (!sample?.sampleRate) return '0.000s';
    return (smp / sample.sampleRate).toFixed(3) + 's';
  }
  function smpToBarBeat(smp: number): string {
    if (songBarSamples <= 0) return '—';
    const bar  = Math.floor(smp / songBarSamples) + 1;
    const beat = Math.floor((smp % songBarSamples) / songBeatSamples) + 1;
    return `${bar}.${beat}`;
  }

  // ── Canvas rendering ───────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    const dpr  = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const cssW = canvas.clientWidth  || 400;
    const cssH = canvas.clientHeight || 100;
    canvas.width  = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx2d.fillStyle = '#000000';
    ctx2d.fillRect(0, 0, cssW, cssH);

    // Center line
    ctx2d.fillStyle = '#003366';
    ctx2d.fillRect(0, Math.floor(cssH / 2), cssW, 1);

    if (!sample?.pcm) {
      ctx2d.fillStyle = '#5588CC';
      ctx2d.font = `12px "VT323", monospace`;
      ctx2d.fillText('NO SAMPLE LOADED — use Load WAV… below', 8, 18);
      return;
    }

    const pcm = sample.pcm;
    const visible = vEnd - vStart + 1;
    const step = Math.max(1, visible / cssW);

    // Selection highlight (blue tint)
    if (sel) {
      const sx = Math.floor(((sel.a - vStart) / visible) * cssW);
      const ex = Math.ceil(((sel.b - vStart) / visible) * cssW);
      ctx2d.fillStyle = 'rgba(100,160,255,0.18)';
      ctx2d.fillRect(sx, 0, Math.max(1, ex - sx), cssH);
    }

    // Waveform (blue, like ModeCat)
    ctx2d.strokeStyle = '#88BBFF';
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    for (let x = 0; x < cssW; x++) {
      const s0 = vStart + Math.floor(x * step);
      const s1 = vStart + Math.min(visible - 1, Math.floor((x + 1) * step));
      let mn = 1.0, mx = -1.0;
      for (let i = s0; i <= s1 && i < pcm.length; i++) {
        const v = pcm[i]!;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      const y1 = Math.floor((1 - (mx + 1) / 2) * cssH);
      const y2 = Math.floor((1 - (mn + 1) / 2) * cssH);
      ctx2d.moveTo(x + 0.5, y1);
      ctx2d.lineTo(x + 0.5, Math.max(y1 + 1, y2));
    }
    ctx2d.stroke();

    // Selection boundary lines
    if (sel) {
      const sx = Math.floor(((sel.a - vStart) / visible) * cssW);
      const ex = Math.ceil(((sel.b - vStart)  / visible) * cssW);
      ctx2d.fillStyle = '#FF8800';
      ctx2d.fillRect(sx, 0, 1, cssH);
      ctx2d.fillRect(ex, 0, 1, cssH);
    }

    // ── Song grid ─────────────────────────────────────────────────────────────
    // Tracker bars, spaced by the current playback rate. As the sample is
    // pitched up the bars pull in (it occupies fewer song bars — "squeezed");
    // pitched down they spread out ("stretched"). This shows, at a glance,
    // how the sample will sit against the pattern grid.
    if (songGridOn && songBeatSamples > 2) {
      const firstBeat = Math.ceil(vStart / songBeatSamples);
      const lastBeat  = Math.floor(vEnd   / songBeatSamples);
      ctx2d.font = `11px "VT323", monospace`;
      for (let beat = firstBeat; beat <= lastBeat; beat++) {
        const x = Math.floor(((beat * songBeatSamples - vStart) / visible) * cssW);
        const isBar = beat % 4 === 0;
        ctx2d.fillStyle = isBar ? 'rgba(255,210,0,0.30)' : 'rgba(255,210,0,0.10)';
        ctx2d.fillRect(x, 0, 1, cssH);
        if (isBar && beat >= 0) {
          ctx2d.fillStyle = 'rgba(255,210,0,0.80)';
          ctx2d.fillText(`BAR ${beat / 4 + 1}`, x + 3, 11);
        }
      }
      const tag = playbackRate > 1.001 ? '▲ squeezed'
                : playbackRate < 0.999 ? '▼ stretched'
                : 'native';
      ctx2d.fillStyle = 'rgba(255,210,0,0.85)';
      ctx2d.fillText(
        `SONG GRID ${songBpm} BPM  ×${playbackRate.toFixed(3)}  ${tag}`,
        6, cssH - 7,
      );
    }

    // ── Loop markers ──────────────────────────────────────────────────────────
    if (sample.loopEnd > sample.loopStart) {
      const HANDLE = 14;
      const lsx = Math.floor(((sample.loopStart - vStart) / visible) * cssW);
      const lex = Math.floor(((sample.loopEnd   - vStart) / visible) * cssW);

      // Region tint
      ctx2d.fillStyle = 'rgba(0, 255, 136, 0.07)';
      ctx2d.fillRect(lsx, 0, Math.max(0, lex - lsx), cssH);

      // IN marker — green
      ctx2d.fillStyle = '#00FF88';
      ctx2d.fillRect(lsx, 0, 2, cssH);
      ctx2d.beginPath();
      ctx2d.moveTo(lsx, 0);
      ctx2d.lineTo(lsx + HANDLE, 0);
      ctx2d.lineTo(lsx, HANDLE);
      ctx2d.fill();
      ctx2d.font = '9px "VT323", monospace';
      ctx2d.fillText('IN', lsx + 2, 22);

      // OUT marker — orange
      ctx2d.fillStyle = '#FF8800';
      ctx2d.fillRect(lex, 0, 2, cssH);
      ctx2d.beginPath();
      ctx2d.moveTo(lex + 2, 0);
      ctx2d.lineTo(lex + 2 - HANDLE, 0);
      ctx2d.lineTo(lex + 2, HANDLE);
      ctx2d.fill();
      ctx2d.fillText('OUT', lex - 22, 22);
    }

    // Save the rendered waveform so the playhead animation can restore it each frame
    waveformImageRef.current = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
  }, [sample, sel, vStart, vEnd, expanded, songGridOn, songBpm, playbackRate, songBeatSamples, resizeTick]);

  // ── Transport actions (shared by buttons + keyboard) ───────────────────────

  function doPlay() {
    if (!sample?.pcm) return;
    if (playLooping && sample.loopEnd > sample.loopStart) {
      playPcmLooping(sample.pcm, sample.sampleRate, sample.loopStart, sample.loopEnd);
    } else {
      playPcmPreview(sample.pcm, sample.sampleRate, sel?.a, sel?.b);
    }
    startPlayheadAnim();
  }
  function doStop() { stopPcmPreview(); stopPlayheadAnim(); }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  // Space play/stop · L loop · A select all · Del erase · Z/X zoom · M metro · Esc close.

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (e.key === 'Escape') { if (expanded) setExpanded(false); return; }
      if (typing) return;
      if (!sample) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (_previewCtx) doStop(); else doPlay();
          break;
        case 'l': case 'L':
          setPlayLooping((v) => !v);
          break;
        case 'a': case 'A':
          if (pcmLen) { setSelStart(0); setSelEnd(pcmLen - 1); }
          break;
        case 'Delete': case 'Backspace':
          if (sel) { e.preventDefault(); opErase(); }
          break;
        case 'z': case 'Z':
          zoomIn();
          break;
        case 'x': case 'X':
          zoomOut();
          break;
        case 'm': case 'M':
          setMetroOn((v) => !v);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sample, sel, pcmLen, playLooping, expanded, viewStart, viewEnd]);

  // ── Canvas interaction ─────────────────────────────────────────────────────

  function pixToSmp(clientX: number): number {
    const canvas = canvasRef.current;
    if (!canvas || !sample?.pcm) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const visible = vEnd - vStart + 1;
    return Math.max(0, Math.min(pcmLen - 1, vStart + Math.floor((x / rect.width) * visible)));
  }

  function smpToPixel(smp: number): number {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const visible = vEnd - vStart + 1;
    return ((smp - vStart) / visible) * rect.width;
  }

  const MARKER_HIT_PX = 10;
  function hitTestMarker(clientX: number): 'start' | 'end' | null {
    if (!sample || sample.loopEnd <= sample.loopStart) return null;
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const lsx = smpToPixel(sample.loopStart);
    const lex = smpToPixel(sample.loopEnd);
    if (Math.abs(x - lsx) <= MARKER_HIT_PX) return 'start';
    if (Math.abs(x - lex) <= MARKER_HIT_PX) return 'end';
    return null;
  }

  function onCanvasDown(e: React.MouseEvent<HTMLCanvasElement>) {
    // Loop marker drag takes priority
    const markerHit = hitTestMarker(e.clientX);
    if (markerHit) {
      draggingMarkerRef.current = markerHit;
      return;
    }
    // Otherwise start a selection drag
    const smp = pixToSmp(e.clientX);
    dragRef.current = { startSmp: smp };
    setSelStart(smp); setSelEnd(smp);
  }

  // Snap a sample position to the nearest song-grid beat (the grid shown on the
  // canvas). Holding Shift bypasses the snap.
  function snapToBeat(smp: number): number {
    if (songBeatSamples <= 0) return smp;
    return Math.round(smp / songBeatSamples) * songBeatSamples;
  }

  function onCanvasMove(e: React.MouseEvent<HTMLCanvasElement>) {
    // Dragging a loop marker — update S/E in real time, snapping to the song grid
    if (draggingMarkerRef.current && sample) {
      const raw = pixToSmp(e.clientX);
      const smp = e.shiftKey ? raw : snapToBeat(raw); // hold Shift to bypass snap
      if (draggingMarkerRef.current === 'start') {
        const newStart = Math.min(smp, sample.loopEnd - 1);
        setInstrument(idx, { ...sample, loopStart: Math.max(0, newStart) } as SampleInstrument);
      } else {
        const newEnd = Math.max(smp, sample.loopStart + 1);
        setInstrument(idx, { ...sample, loopEnd: Math.min(pcmLen - 1, newEnd) } as SampleInstrument);
      }
      return;
    }
    // Cursor hint: col-resize when hovering near a marker
    const hit = hitTestMarker(e.clientX);
    setCanvasCursor(hit ? 'col-resize' : 'crosshair');
    // Selection drag
    if (!dragRef.current) return;
    const smp = pixToSmp(e.clientX);
    setSelStart(Math.min(dragRef.current.startSmp, smp));
    setSelEnd(Math.max(dragRef.current.startSmp, smp));
  }

  function onCanvasUp(e: React.MouseEvent<HTMLCanvasElement>) {
    // Release loop marker drag
    if (draggingMarkerRef.current) {
      if (liveLoop && playLooping && sample?.pcm) {
        const fresh = useStore.getState().instruments[idx] as SampleInstrument;
        if (fresh?.pcm && fresh.loopEnd > fresh.loopStart) {
          playPcmLooping(fresh.pcm, fresh.sampleRate, fresh.loopStart, fresh.loopEnd);
          startPlayheadAnim();
        }
      }
      draggingMarkerRef.current = null;
      return;
    }
    const smp = pixToSmp(e.clientX);
    if (dragRef.current) {
      const a = Math.min(dragRef.current.startSmp, smp);
      const b = Math.max(dragRef.current.startSmp, smp);
      if (b === a) {
        // Single click — clear selection
        setSelStart(null); setSelEnd(null);
      } else {
        setSelStart(a); setSelEnd(b);
      }
    }
    dragRef.current = null;
  }

  // ── Zoom helpers ───────────────────────────────────────────────────────────

  function showAll() { setViewStart(null); setViewEnd(null); }

  function zoomIn() {
    if (!pcmLen) return;
    const centre = sel ? Math.floor((sel.a + sel.b) / 2) : Math.floor((vStart + vEnd) / 2);
    const half   = Math.max(16, Math.floor((vEnd - vStart) / 4));
    setViewStart(Math.max(0, centre - half));
    setViewEnd(Math.min(pcmLen - 1, centre + half));
  }

  function zoomOut() {
    if (!pcmLen) return;
    const centre = Math.floor((vStart + vEnd) / 2);
    const half   = Math.min(pcmLen, (vEnd - vStart + 1));
    setViewStart(Math.max(0, centre - half));
    setViewEnd(Math.min(pcmLen - 1, centre + half));
  }

  function scrollLeft() {
    const span = vEnd - vStart;
    const step = Math.max(1, Math.floor(span / 8));
    const ns = Math.max(0, vStart - step);
    setViewStart(ns); setViewEnd(ns + span);
  }

  function scrollRight() {
    const span = vEnd - vStart;
    const step = Math.max(1, Math.floor(span / 8));
    const ne = Math.min(pcmLen - 1, vEnd + step);
    setViewStart(ne - span); setViewEnd(ne);
  }

  function goToStart() { const span = vEnd - vStart; setViewStart(0); setViewEnd(span); }
  function goToEnd()   {
    const span = vEnd - vStart;
    setViewStart(Math.max(0, pcmLen - 1 - span));
    setViewEnd(pcmLen - 1);
  }

  // ── Loop point editing ─────────────────────────────────────────────────────

  function setLoopStart(v: number) {
    if (!sample) return;
    const ns = Math.max(0, Math.min(Math.round(v), sample.loopEnd - 1));
    setInstrument(idx, { ...sample, loopStart: ns } as SampleInstrument);
  }
  function setLoopEnd(v: number) {
    if (!sample) return;
    const ne = Math.min(pcmLen - 1, Math.max(Math.round(v), sample.loopStart + 1));
    setInstrument(idx, { ...sample, loopEnd: ne } as SampleInstrument);
  }
  /** Snap both loop points to the nearest zero-crossing — removes loop clicks. */
  function snapLoopToZeroCross() {
    if (!sample?.pcm) return;
    const ns = nearestZeroCrossing(sample.pcm, sample.loopStart);
    const ne = nearestZeroCrossing(sample.pcm, sample.loopEnd);
    setInstrument(idx, {
      ...sample,
      loopStart: Math.max(0, Math.min(ns, ne - 1)),
      loopEnd:   Math.min(pcmLen - 1, Math.max(ne, ns + 1)),
    } as SampleInstrument);
  }
  /** Resize the loop so it spans exactly `bars` of the current song grid. */
  function snapLoopToBars(bars: number) {
    if (!sample?.pcm || songBarSamples <= 0) return;
    const end = Math.round(sample.loopStart + bars * songBarSamples) - 1;
    setInstrument(idx, { ...sample, loopEnd: Math.min(pcmLen - 1, Math.max(sample.loopStart + 1, end)) } as SampleInstrument);
  }

  // ── Recorded properties + tuning ───────────────────────────────────────────

  function commitRecBpm(str: string) {
    setRecBpmStr(str);
    if (!sample) return;
    const v = parseFloat(str);
    const bpm = isFinite(v) && v > 0 ? Math.min(400, v) : 0;
    setInstrument(idx, { ...sample, recordedBpm: bpm } as SampleInstrument);
  }
  function setBaseNote(n: number) {
    if (!sample) return;
    setInstrument(idx, { ...sample, baseNote: Math.max(0, Math.min(127, Math.round(n))) } as SampleInstrument);
  }
  function setIgnorePitch(v: boolean) {
    if (!sample) return;
    setInstrument(idx, { ...sample, ignorePitch: v } as SampleInstrument);
  }
  /** Write a transpose/finetune pair (the output of any TUNE mode). */
  function applyTune(transpose: number, finetune: number) {
    if (!sample) return;
    setInstrument(idx, {
      ...sample,
      transpose: Math.max(-48, Math.min(48, transpose)),
      finetune:  Math.max(-8,  Math.min(7,  finetune)),
    } as SampleInstrument);
  }
  function detectRecBpm() {
    if (!sample?.pcm) return;
    setBpmDetecting(true);
    setTimeout(() => {
      const r = detectBpm(sample.pcm!, sample.sampleRate);
      commitRecBpm(String(r));
      setBpmDetecting(false);
    }, 0);
  }
  function detectRecKey() {
    if (!sample?.pcm) return;
    setKeyDetecting(true);
    setTimeout(() => {
      const pcm = sample.pcm!;
      const from = sample.loopEnd > sample.loopStart ? sample.loopStart : firstNonSilent(pcm);
      const k = detectKey(pcm, sample.sampleRate, from);
      if (k >= 0) setBaseNote(k);
      setKeyDetecting(false);
    }, 0);
  }

  // ── PCM operations ─────────────────────────────────────────────────────────

  function withPcm(fn: (pcm: Float32Array) => Float32Array | void) {
    if (!sample?.pcm) return;
    const next = fn(sample.pcm);
    if (next) setInstrument(idx, { ...sample, pcm: next } as SampleInstrument);
  }

  function opErase() {
    if (!sel) return;
    withPcm((pcm) => { const o = copyPcm(pcm); o.fill(0, sel.a, sel.b + 1); return o; });
  }
  function opCut() {
    if (!sel || !sample?.pcm) return;
    setClipboard(sample.pcm.slice(sel.a, sel.b + 1));
    setInstrument(idx, { ...sample, pcm: spliceOut(sample.pcm, sel.a, sel.b) } as SampleInstrument);
    setSelStart(sel.a); setSelEnd(sel.a);
  }
  function opCopy() {
    if (!sel || !sample?.pcm) return;
    setClipboard(sample.pcm.slice(sel.a, sel.b + 1));
  }
  function opPaste() {
    if (!clipboard || !sample?.pcm) return;
    const pos = sel?.a ?? sample.pcm.length;
    const next = spliceIn(sample.pcm, pos, clipboard);
    setInstrument(idx, { ...sample, pcm: next } as SampleInstrument);
    setSelStart(pos); setSelEnd(pos + clipboard.length - 1);
  }
  function opReverse() {
    if (!sel) return;
    withPcm((pcm) => {
      const o = copyPcm(pcm);
      for (let i = sel.a, j = sel.b; i < j; i++, j--) {
        const t = o[i]!; o[i] = o[j]!; o[j] = t;
      }
      return o;
    });
  }
  function opTrim() {
    if (!sample?.pcm) return;
    const first = firstNonSilent(sample.pcm);
    const last = lastNonSilent(sample.pcm);
    const cropped = sample.pcm.slice(first, last + 1);
    const newLen = cropped.length;
    // Shift loop markers to account for trimmed start
    const newLoopStart = Math.max(0, sample.loopStart - first);
    const newLoopEnd = Math.min(newLen - 1, sample.loopEnd - first);
    setInstrument(idx, {
      ...sample,
      pcm: cropped,
      loopStart: newLoopStart,
      loopEnd: newLoopEnd,
    } as SampleInstrument);
    setSelStart(null); setSelEnd(null); showAll();
  }

  function opTrimToLoop() {
    if (!sample?.pcm || sample.loopEnd <= sample.loopStart) return;
    const cropped = sample.pcm.slice(sample.loopStart, sample.loopEnd + 1);
    const newLen = cropped.length;
    setInstrument(idx, {
      ...sample,
      pcm: cropped,
      loopStart: 0,
      loopEnd: newLen - 1,
    } as SampleInstrument);
    setSelStart(null); setSelEnd(null); showAll();
    stopPcmPreview();
  }
  function opExpand() {
    if (!sample?.pcm) return;
    const n = Math.max(1, Math.min(1_000_000, expandN));
    const out = new Float32Array(sample.pcm.length + n);
    out.set(sample.pcm);
    setInstrument(idx, { ...sample, pcm: out } as SampleInstrument);
  }
  function opEcho() {
    if (!sel || !sample?.pcm) return;
    const next = applyEcho(sample.pcm, sel.a, sel.b, Math.max(1, echoRate), Math.max(1, Math.min(32, echoCount)), echoVolDec);
    setInstrument(idx, { ...sample, pcm: next } as SampleInstrument);
  }
  function opChangeVolume(startPct: number, endPct: number) {
    if (!sample?.pcm) return;
    const a = sel?.a ?? 0;
    const b = sel?.b ?? sample.pcm.length - 1;
    const next = applyChangeVolume(sample.pcm, a, b, startPct, endPct, dontClip);
    setInstrument(idx, { ...sample, pcm: next } as SampleInstrument);
  }

  /** Export the current selection (if any) or the whole sample as a WAV download. */
  function opSaveWav() {
    if (!sample?.pcm) return;
    const src = sel ? sample.pcm.slice(sel.a, sel.b + 1) : sample.pcm;
    const base = (sample.name || 'sample').replace(/[^\w.\-]+/g, '_').slice(0, 24) || 'sample';
    downloadWav(src instanceof Float32Array ? src : new Float32Array(src), sample.sampleRate, `${base}${sel ? '_sel' : ''}.wav`);
  }

  // ── Non-sample renders ─────────────────────────────────────────────────────

  if (!inst) return <div className="panel">Select an instrument slot.</div>;

  if (inst.kind === 'empty') {
    return (
      <div className="panel">
        <div className="panel__title">Slot {String(idx).padStart(2, '0')}</div>
        <div className="upper muted">Empty slot. Double-click the list to cycle to MIDI / Synth / Sample.</div>
      </div>
    );
  }
  if (inst.kind === 'synth') return <SynthEditor idx={idx} inst={inst as SynthInstrument} />;

  if (inst.kind === 'midi') {
    const midi = inst as MidiInstrument;
    return (
      <div className="se-root panel col">
        <style>{NUM_FIELD_CSS}</style>
        <div className="panel__title">Slot {String(idx).padStart(2, '0')} — MIDI</div>
        <div className="field-row"><label>NAME</label>
          <input type="text" value={midi.name} onChange={(e) => setInstrument(idx, { ...midi, name: e.target.value })} /></div>
        <div className="field-row"><label>CHANNEL</label>
          <input type="number" min={1} max={16} value={midi.channel + 1} style={numS}
            onChange={(e) => setInstrument(idx, { ...midi, channel: Math.max(0, Math.min(15, Number(e.target.value) - 1)) })} /></div>
        <div className="field-row"><label>PROGRAM</label>
          <input type="number" min={-1} max={127} value={midi.program} style={numS}
            onChange={(e) => setInstrument(idx, { ...midi, program: Math.max(-1, Math.min(127, Number(e.target.value))) })} /></div>
        <div className="field-row"><label>VEL</label>
          <input type="number" min={1} max={127} value={midi.velocity} style={numS}
            onChange={(e) => setInstrument(idx, { ...midi, velocity: Math.max(1, Math.min(127, Number(e.target.value))) })} /></div>
        <div className="field-row"><label>LEN ROWS</label>
          <input type="number" min={1} max={64} value={midi.lengthRows} style={numS}
            onChange={(e) => setInstrument(idx, { ...midi, lengthRows: Math.max(1, Math.min(64, Number(e.target.value))) })} /></div>
        <div className="hr" />
        <div className="field-row"><label>TRANSPOSE</label>
          <input type="number" min={-48} max={48} value={midi.transpose} style={numS}
            onChange={(e) => setInstrument(idx, { ...midi, transpose: Math.max(-48, Math.min(48, Number(e.target.value))) })} /></div>
        <div className="field-row"><label>FINETUNE</label>
          <input type="number" min={-8} max={7} value={midi.finetune} style={numXS}
            onChange={(e) => setInstrument(idx, { ...midi, finetune: Math.max(-8, Math.min(7, Number(e.target.value))) })} /></div>
        <div className="field-row"><label>DEF PITCH</label>
          <input type="number" min={0} max={127} value={midi.defaultPitch} style={numS}
            onChange={(e) => setInstrument(idx, { ...midi, defaultPitch: Math.max(0, Math.min(127, Number(e.target.value))) })} /></div>
        <div className="field-row">
          <label>SUPPRESS OFF</label>
          <input type="checkbox" checked={midi.suppressNoteOff}
            onChange={(e) => setInstrument(idx, { ...midi, suppressNoteOff: e.target.checked })} />
        </div>
      </div>
    );
  }

  // ── Sample instrument ──────────────────────────────────────────────────────

  if (!sample) return null;

  // Canvas: the hero element. Large by default; in expanded mode it flex-grows
  // to fill the available vertical space.
  const canvasStyle: React.CSSProperties = expanded
    ? { width: '100%', flex: '1 1 260px', minHeight: 260, cursor: canvasCursor, display: 'block', background: '#000' }
    : { width: '100%', height: 260, cursor: canvasCursor, display: 'block', background: '#000', flexShrink: 0 };

  const containerStyle: React.CSSProperties = expanded
    ? { position: 'fixed', top: 62, left: '18%', right: 0, bottom: 36, zIndex: 500, overflow: 'auto', display: 'flex', flexDirection: 'column', background: '#000022', borderLeft: '3px solid #0055AA' }
    : { gap: 0, padding: 0 };

  // Recorded-BPM parse (for BY-BPM mode).
  const recBpmNum   = parseFloat(recBpmStr);
  const recBpmValid = isFinite(recBpmNum) && recBpmNum > 20 && recBpmNum < 400;

  // BY BPM — pitch shift to play the recorded tempo at a target tempo.
  const targetBpmNum   = parseFloat(targetBpmStr || String(songBpm));
  const targetBpmValid = isFinite(targetBpmNum) && targetBpmNum > 20 && targetBpmNum < 400;
  const bpmSemis = recBpmValid && targetBpmValid ? 12 * Math.log2(targetBpmNum / recBpmNum) : 0;
  const bpmFit   = semisToTune(bpmSemis);
  const bpmRate  = recBpmValid && targetBpmValid ? targetBpmNum / recBpmNum : 1;

  // BY BARS — pitch shift so the loop spans exactly `targetBars` song bars.
  const barsRate  = (loopLenSamples > 0 && songBpm > 0)
    ? loopLenSamples / ((sample.sampleRate * 240 / songBpm) * targetBars)
    : 1;
  const barsSemis = barsRate > 0 ? 12 * Math.log2(barsRate) : 0;
  const barsFit   = semisToTune(barsSemis);

  // Segmented selector button style.
  const segBtn = (active: boolean): React.CSSProperties => ({
    flex: 1,
    background: active ? '#1a4a78' : '#0a2240',
    border: active ? '2px inset #2a6bb0' : '2px outset #2a6bb0',
    color: active ? '#FFD700' : '#7799bb',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.74rem',
    padding: '0.1rem 0',
    cursor: 'pointer',
  });
  const modeBoxStyle: React.CSSProperties = {
    background: '#000a1e', border: '1px solid #0a3a6a', padding: '0.4rem 0.45rem', marginBottom: '0.4rem',
  };

  return (
    <>
      {expanded && <div onClick={() => setExpanded(false)} style={{ position: 'fixed', inset: 0, zIndex: 199, background: 'rgba(0,0,30,0.55)' }} />}
      <div className={expanded ? 'se-root' : 'se-root panel col'} style={containerStyle}>
        <style>{NUM_FIELD_CSS}</style>

        {/* 1. Title bar — only shown in expanded (full-screen) mode; MdiWindow provides the title bar otherwise */}
        {expanded && (
          <div style={{ background: '#0055AA', color: '#FFFFFF', padding: '0.15rem 0.4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
            <span>Sample Editor</span>
            <span style={{ fontSize: '0.7rem', color: '#AADDFF', flex: 1 }}>
              Slot {String(idx).padStart(2, '0')} — {sample.name || 'unnamed'}
              {inst.kind === 'hybrid' && <span style={{ marginLeft: '0.5rem', color: 'var(--wb-orange)', fontSize: '0.65rem' }}>[HYB]</span>}
              <span style={{ marginLeft: '0.5rem', color: '#6688AA' }}>· song {songBpm} BPM</span>
            </span>
            <ZoomGadget expanded={expanded} onToggle={() => setExpanded((e) => !e)} />
          </div>
        )}

        {/* 2. Name + volume row — ZoomGadget lives here when not expanded */}
        <div style={{ display: 'flex', gap: '0.5rem', padding: '0.2rem 0.5rem', background: '#001133', borderBottom: '1px solid #003366', flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
          <div className="field-row">
            <label>NAME</label>
            <input type="text" value={sample.name} onChange={(e) => setInstrument(idx, { ...sample, name: e.target.value } as SampleInstrument)} style={numName} />
          </div>
          <div className="field-row">
            <label>VOL</label>
            <input type="number" min={0} max={127} value={sample.volume} style={numS}
              onChange={(e) => setInstrument(idx, { ...sample, volume: Math.max(0, Math.min(127, Number(e.target.value))) } as SampleInstrument)} />
          </div>
          <label style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: sample.loopEnabled ? '#00CCFF' : '#556688', marginLeft: '0.5rem' }} title="When ON, sequencer loops this sample between IN/OUT during note playback">
            <input type="checkbox" checked={sample.loopEnabled} onChange={(e) => setInstrument(idx, { ...sample, loopEnabled: e.target.checked } as SampleInstrument)} />
            SEQ LOOP
          </label>
          {!expanded && (
            <>
              <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#AADDFF' }}>
                Slot {String(idx).padStart(2, '0')}
                {inst.kind === 'hybrid' && <span style={{ color: 'var(--wb-orange)', fontSize: '0.65rem', marginLeft: '0.3rem' }}>[HYB]</span>}
                <span style={{ marginLeft: '0.4rem', color: '#6688AA' }}>· {songBpm} BPM</span>
              </span>
              <ZoomGadget expanded={expanded} onToggle={() => setExpanded((e) => !e)} />
            </>
          )}
        </div>

        {/* 3. Transport row */}
        <div style={{ display: 'flex', gap: '0.3rem', padding: '0.2rem 0.4rem', background: '#000022', flexWrap: 'wrap', alignItems: 'center', borderBottom: '2px solid #000', flexShrink: 0 }}>
          <button className="btn" type="button" disabled={!sample.pcm} style={{ fontWeight: 'bold' }} onClick={doPlay}>▶ PLAY</button>
          <button className="btn" type="button"
            onClick={() => setPlayLooping((v) => !v)}
            style={{ color: playLooping ? '#00CCFF' : undefined, outline: playLooping ? '1px solid #00CCFF' : undefined }}>
            ↺ LOOP
          </button>
          <button className="btn" type="button" onClick={doStop}>■ STOP</button>

          <div style={{ width: '1px', background: '#0055AA', alignSelf: 'stretch', margin: '0 0.2rem' }} />

          <label style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}
            title="Live Loop: when ON, loop restarts automatically after each marker drag">
            <input type="checkbox" checked={liveLoop} onChange={(e) => setLiveLoop(e.target.checked)} />
            <span style={{ color: liveLoop ? '#00FF88' : '#556688' }}>LIVE</span>
          </label>
          <label style={{ display: 'inline-flex', gap: '0.25rem', alignItems: 'center', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}
            title={`Metronome: click track at the song tempo (${songBpm} BPM) — check the loop sits in time`}>
            <input type="checkbox" checked={metroOn} onChange={(e) => setMetroOn(e.target.checked)} />
            <span style={{ color: metroOn ? '#00FF88' : '#556688' }}>METRO</span>
          </label>

          <div style={{ width: '1px', background: '#0055AA', alignSelf: 'stretch', margin: '0 0.2rem' }} />

          <button className="btn" type="button" disabled={!pcmLen} onClick={zoomIn}>ZOOM+</button>
          <button className="btn" type="button" disabled={!pcmLen} onClick={showAll}>FIT</button>
          <button className="btn" type="button" disabled={!pcmLen} onClick={zoomOut}>ZOOM−</button>
          <button className="btn" type="button" disabled={!pcmLen} onClick={goToStart}>|◄</button>
          <button className="btn" type="button" disabled={!pcmLen} onClick={scrollLeft}>◄</button>
          <button className="btn" type="button" disabled={!pcmLen} onClick={scrollRight}>►</button>
          <button className="btn" type="button" disabled={!pcmLen} onClick={goToEnd}>►|</button>

          <div style={{ width: '1px', background: '#0055AA', alignSelf: 'stretch', margin: '0 0.2rem' }} />

          {onOpenLibrary && <button className="btn" type="button" onClick={onOpenLibrary}>Library…</button>}
          <label className="btn" style={{ cursor: 'pointer' }} title="Load WAV file">
            Load WAV…
            <input type="file" accept="audio/wav,audio/*" style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const buf = await f.arrayBuffer();
                const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
                const actx = new Ctor();
                try {
                  const audio = await actx.decodeAudioData(buf.slice(0));
                  const ch0 = audio.getChannelData(0);
                  let pcm: Float32Array;
                  if (audio.numberOfChannels > 1) {
                    pcm = new Float32Array(ch0.length);
                    const ch1 = audio.getChannelData(1);
                    for (let i = 0; i < ch0.length; i++) pcm[i] = (ch0[i]! + ch1[i]!) * 0.5;
                  } else {
                    pcm = new Float32Array(ch0);
                  }
                  // Fresh WAV — preserve kind ('sample' or 'hybrid') so a hybrid
                  // instrument does not silently downgrade to sample on load.
                  setInstrument(idx, { ...sample, kind: inst!.kind, pcm, sampleRate: audio.sampleRate, name: f.name.replace(/\.[^.]+$/, '').slice(0, 20), loopStart: 0, loopEnd: pcm.length - 1, recordedBpm: 0 } as unknown as Instrument);
                  setRecBpmStr('');
                  setSelStart(null); setSelEnd(null); showAll();
                } finally { actx.close(); }
              }} />
          </label>
          <button className="btn" type="button" disabled={!sample.pcm} onClick={opSaveWav}
            title={sel ? 'Save the current selection as a WAV file' : 'Save the whole sample as a WAV file'}>
            Save WAV…
          </button>
          <button
            className="btn"
            type="button"
            disabled={!sample.pcm}
            title="Save to My Library — downloads WAV and adds to the Sample Browser's Saved category for this session"
            onClick={() => {
              if (!sample.pcm) return;
              const src = sel ? sample.pcm.slice(sel.a, sel.b + 1) : sample.pcm;
              const name = (sample.name || 'sample').replace(/[^\w.\-]+/g, '_').slice(0, 24) || 'sample';
              // Download the WAV so it lands in their files
              downloadWav(src instanceof Float32Array ? src : new Float32Array(src), sample.sampleRate, `${name}.wav`);
              // Also add to the in-memory MY LIBRARY session so it shows in the browser immediately
              addSampleToLibrary(name, src instanceof Float32Array ? src : new Float32Array(src), sample.sampleRate);
            }}
          >
            → Library
          </button>
          <button className="btn" type="button" onClick={() => { stopPcmPreview(); setInstrument(idx, { ...sample, pcm: null, loopStart: 0, loopEnd: 0 } as SampleInstrument); setSelStart(null); setSelEnd(null); showAll(); }}>Clear</button>
        </div>

        {/* 4. Waveform canvas — the hero */}
        <canvas ref={canvasRef} style={canvasStyle}
          onMouseDown={onCanvasDown} onMouseMove={onCanvasMove} onMouseUp={onCanvasUp} onMouseLeave={onCanvasUp} />

        {/* 5. Loop info bar — drag markers OR enter exact sample positions */}
        <div style={{ display: 'flex', gap: '0.8rem', padding: '0.2rem 0.5rem', background: '#001133', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: '#AADDFF', flexWrap: 'wrap', alignItems: 'center', borderBottom: '2px solid #000', flexShrink: 0 }}>
          {/* IN */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
            <span style={{ color: '#00FF88' }}>●</span>
            <span style={{ color: '#00FF88' }}>IN</span>
            <button className="btn" type="button" style={nudgeStyle} disabled={!sample.pcm} onClick={() => setLoopStart(sample.loopStart - 1)}>−</button>
            <input type="number" min={0} max={Math.max(0, pcmLen - 1)} value={sample.loopStart}
              disabled={!sample.pcm} style={numWide}
              onChange={(e) => setLoopStart(Number(e.target.value))} />
            <button className="btn" type="button" style={nudgeStyle} disabled={!sample.pcm} onClick={() => setLoopStart(sample.loopStart + 1)}>+</button>
            <span style={{ color: '#557799' }}>{smpToSecs(sample.loopStart)} / {smpToBarBeat(sample.loopStart)}</span>
          </div>
          {/* OUT */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
            <span style={{ color: '#FF8800' }}>●</span>
            <span style={{ color: '#FF8800' }}>OUT</span>
            <button className="btn" type="button" style={nudgeStyle} disabled={!sample.pcm} onClick={() => setLoopEnd(sample.loopEnd - 1)}>−</button>
            <input type="number" min={0} max={Math.max(0, pcmLen - 1)} value={sample.loopEnd}
              disabled={!sample.pcm} style={numWide}
              onChange={(e) => setLoopEnd(Number(e.target.value))} />
            <button className="btn" type="button" style={nudgeStyle} disabled={!sample.pcm} onClick={() => setLoopEnd(sample.loopEnd + 1)}>+</button>
            <span style={{ color: '#557799' }}>{smpToSecs(sample.loopEnd)} / {smpToBarBeat(sample.loopEnd)}</span>
          </div>
          {sample.sampleRate > 0 && sample.loopEnd > sample.loopStart && (
            <span style={{ color: '#556688' }}>
              len: {(loopLenSamples / sample.sampleRate).toFixed(3)}s
              {songBarSamples > 0 && ` · ${loopSongBars.toFixed(2)} song bars`}
            </span>
          )}
          {/* Loop seam quality indicator + zero-crossing snap */}
          {sample.pcm && sample.loopEnd > sample.loopStart && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ color: seamColor }}>● {seamLabel}</span>
              <button className="btn" type="button" style={{ fontSize: '0.7rem', padding: '0 0.3rem' }}
                onClick={snapLoopToZeroCross} title="Snap IN/OUT to the nearest zero-crossings to remove loop clicks">
                SNAP 0✕
              </button>
            </span>
          )}
          <span style={{ marginLeft: 'auto', color: '#334455' }}>{pcmLen.toLocaleString()} smp · {sample.pcm ? `${sample.sampleRate} Hz` : '—'}</span>
        </div>

        {/* 6. 2×2 panel grid: RECORDED | TUNE / ENVELOPE | INFO — wraps to 1 column when narrow */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px', background: '#000000', borderBottom: '2px solid #000', flexShrink: 0 }}>

          {/* RECORDED panel — what the sample is */}
          <div style={panelStyle}>
            <div style={panelTitleStyle}><span>RECORDED</span><span style={panelHintStyle}>what the sample is</span></div>
            {/* Recorded BPM */}
            <div className="field-row" style={{ marginBottom: '0.3rem' }}>
              <label style={{ color: '#AADDFF' }} title="The tempo the sample was recorded / looped at — needed for BY-BPM tuning">REC BPM</label>
              <button className="btn" type="button" style={nudgeStyle}
                onClick={() => { const v = parseFloat(recBpmStr); commitRecBpm(String(Math.max(20, (isFinite(v) ? v : songBpm) - 1))); }}>−</button>
              <input type="number" min={20} max={400} step={0.5} value={recBpmStr} placeholder="—"
                onChange={(e) => commitRecBpm(e.target.value)} style={numBpm} />
              <button className="btn" type="button" style={nudgeStyle}
                onClick={() => { const v = parseFloat(recBpmStr); commitRecBpm(String(Math.min(400, (isFinite(v) ? v : songBpm) + 1))); }}>+</button>
              <button className="btn" type="button" disabled={!sample.pcm || bpmDetecting}
                onClick={detectRecBpm} style={{ color: '#FFD700', fontSize: '0.72rem' }}>{bpmDetecting ? '…' : 'DETECT'}</button>
              <button className="btn" type="button" onClick={() => commitRecBpm(String(songBpm))}
                title="The sample is already at the song tempo"
                style={{ color: recBpmStr === String(songBpm) ? '#FFD700' : undefined, fontSize: '0.72rem' }}>={songBpm}</button>
            </div>
            {/* Recorded key */}
            <div className="field-row" style={{ marginBottom: '0.2rem' }}>
              <label style={{ color: '#AADDFF' }} title="The musical key the sample was recorded at — its native pitch (baseNote)">REC KEY</label>
              <button className="btn" type="button" style={nudgeStyle} onClick={() => setBaseNote(sample.baseNote - 1)}>−</button>
              <input type="number" min={0} max={127} value={sample.baseNote} style={numS}
                onChange={(e) => setBaseNote(Number(e.target.value))} />
              <button className="btn" type="button" style={nudgeStyle} onClick={() => setBaseNote(sample.baseNote + 1)}>+</button>
              <span style={{ color: '#FF8800', fontSize: '0.85em' }}>{noteName(sample.baseNote)}</span>
              <button className="btn" type="button" disabled={!sample.pcm || keyDetecting}
                onClick={detectRecKey} style={{ color: '#FFD700', fontSize: '0.72rem' }}>{keyDetecting ? '…' : 'DETECT'}</button>
            </div>
            <div style={{ color: '#44566a', fontSize: '0.66rem', marginBottom: '0.4rem' }}>
              Placed at <span style={{ color: '#FF8800' }}>{noteName(sample.baseNote)}</span> in the tracker, the sample plays at its native pitch.
            </div>
            {/* Default entry pitch */}
            <div className="field-row" style={{ marginBottom: '0.3rem' }}>
              <label style={{ color: '#AADDFF' }} title="Default entry pitch for the sample's F-key shortcut">DEF ♪</label>
              <input type="number" min={0} max={127} value={sample.defaultPitch} style={numS}
                onChange={(e) => setInstrument(idx, { ...sample, defaultPitch: Math.max(0, Math.min(127, Number(e.target.value))) } as SampleInstrument)} />
              <span style={{ color: '#88BBFF', fontSize: '0.85em' }}>{noteName(sample.defaultPitch)}</span>
            </div>
            {/* Grid + note length */}
            <div className="field-row" style={{ marginBottom: '0.3rem' }}>
              <label style={{ display: 'inline-flex', gap: '0.2rem', alignItems: 'center', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
                <input type="checkbox" checked={songGridOn} onChange={(e) => setSongGridOn(e.target.checked)} />
                <span style={{ color: songGridOn ? '#FFD700' : '#556688' }}>SONG GRID</span>
              </label>
              <label style={{ color: '#AADDFF', fontSize: '0.7rem', marginLeft: '0.6rem' }} title="Stop sample after N pattern rows (0 = play until next note)">NOTE LEN</label>
              <input type="number" min={0} max={512} value={sample.lengthRows} style={numS}
                onChange={(e) => setInstrument(idx, { ...sample, lengthRows: Math.max(0, Math.min(512, Number(e.target.value))) } as SampleInstrument)} />
              <span style={{ color: '#334455', fontSize: '0.7rem' }}>rows</span>
            </div>
            {/* Snap to bars */}
            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ color: '#FFD700', fontSize: '0.7rem' }}>Snap to bars:</span>
              {([1, 2, 4, 8] as const).map((n) => {
                const end = Math.round(sample.loopStart + n * songBarSamples) - 1;
                return (
                  <button key={n} className="btn" type="button"
                    disabled={!sample.pcm || songBarSamples <= 0 || end >= pcmLen}
                    onClick={() => snapLoopToBars(n)}
                    title={`Resize the loop to exactly ${n} song bar${n > 1 ? 's' : ''}`}
                    style={{ color: '#FFD700', fontSize: '0.72rem', padding: '0 0.3rem' }}>
                    {n}
                  </button>
                );
              })}
              <span style={{ color: '#334455', fontSize: '0.66rem' }}>resize loop to N song bars</span>
            </div>
          </div>

          {/* TUNE panel — fit to song */}
          <div style={panelStyle}>
            <div style={panelTitleStyle}><span>TUNE</span><span style={panelHintStyle}>fit to song</span></div>

            {/* Segmented mode selector */}
            <div style={{ display: 'flex', marginBottom: '0.4rem' }}>
              <button type="button" style={segBtn(tuneMode === 'bpm')}  onClick={() => setTuneMode('bpm')}>BY BPM</button>
              <button type="button" style={segBtn(tuneMode === 'bars')} onClick={() => setTuneMode('bars')}>BY BARS</button>
              <button type="button" style={segBtn(tuneMode === 'pitch')} onClick={() => setTuneMode('pitch')}>BY PITCH</button>
            </div>

            {/* BY BPM */}
            {tuneMode === 'bpm' && (
              <div style={modeBoxStyle}>
                <div className="field-row" style={{ marginBottom: '0.3rem' }}>
                  <span style={{ color: '#556688', fontSize: '0.7rem' }}>recorded {recBpmValid ? recBpmNum : '—'}</span>
                  <span style={{ color: '#FF8800' }}>→</span>
                  <label style={{ color: '#AADDFF', fontSize: '0.7rem' }}>target</label>
                  <input type="number" min={20} max={400} step={0.5}
                    value={targetBpmStr || String(songBpm)} style={numBpm}
                    onChange={(e) => setTargetBpmStr(e.target.value)} />
                  <span style={{ color: '#556688', fontSize: '0.7rem' }}>BPM</span>
                  <button className="btn" type="button" style={{ fontSize: '0.68rem' }}
                    onClick={() => setTargetBpmStr(String(songBpm))}>=song</button>
                </div>
                {recBpmValid ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <span style={{ color: '#88BBFF', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
                      result: {bpmFit.transpose >= 0 ? '+' : ''}{bpmFit.transpose}st {bpmFit.finetune >= 0 ? '+' : ''}{bpmFit.finetune}/8 · ×{bpmRate.toFixed(3)}
                    </span>
                    <button className="btn" type="button" style={{ marginLeft: 'auto', color: '#FFD700', fontSize: '0.72rem' }}
                      disabled={!targetBpmValid}
                      onClick={() => applyTune(bpmFit.transpose, bpmFit.finetune)}>APPLY</button>
                  </div>
                ) : (
                  <div style={{ color: '#FF8800', fontSize: '0.7rem' }}>Set REC BPM first (RECORDED panel).</div>
                )}
              </div>
            )}

            {/* BY BARS */}
            {tuneMode === 'bars' && (
              <div style={modeBoxStyle}>
                <div className="field-row" style={{ marginBottom: '0.3rem' }}>
                  <span style={{ color: '#556688', fontSize: '0.7rem' }}>
                    loop spans <b style={{ color: '#00CCFF' }}>{loopSongBars.toFixed(2)}</b> bars
                  </span>
                  <span style={{ color: '#FF8800' }}>→</span>
                  <label style={{ color: '#AADDFF', fontSize: '0.7rem' }}>fit to</label>
                  <select value={targetBars} onChange={(e) => setTargetBars(Number(e.target.value))}
                    style={{ background: '#000a1e', border: '2px inset #0a3a6a', color: '#00CCFF', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                    {[1, 2, 4, 8, 16].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                  <span style={{ color: '#556688', fontSize: '0.7rem' }}>bars</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <span style={{ color: '#88BBFF', fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }}>
                    result: {barsFit.transpose >= 0 ? '+' : ''}{barsFit.transpose}st {barsFit.finetune >= 0 ? '+' : ''}{barsFit.finetune}/8
                  </span>
                  <button className="btn" type="button" style={{ marginLeft: 'auto', color: '#FFD700', fontSize: '0.72rem' }}
                    disabled={loopLenSamples <= 0}
                    onClick={() => applyTune(barsFit.transpose, barsFit.finetune)}>APPLY</button>
                </div>
              </div>
            )}

            {/* BY PITCH */}
            {tuneMode === 'pitch' && (
              <div style={modeBoxStyle}>
                <div className="field-row" style={{ marginBottom: '0.2rem' }}>
                  <label style={{ color: '#AADDFF' }}>TRANS</label>
                  <button className="btn" type="button" style={nudgeStyle}
                    onClick={() => applyTune(sample.transpose - 1, sample.finetune)}>−</button>
                  <input type="number" min={-48} max={48} value={sample.transpose} style={numS}
                    onChange={(e) => applyTune(Number(e.target.value), sample.finetune)} />
                  <button className="btn" type="button" style={nudgeStyle}
                    onClick={() => applyTune(sample.transpose + 1, sample.finetune)}>+</button>
                  <label style={{ color: '#AADDFF', marginLeft: '0.5rem' }}>FINE</label>
                  <button className="btn" type="button" style={nudgeStyle}
                    onClick={() => applyTune(sample.transpose, sample.finetune - 1)}>−</button>
                  <input type="number" min={-8} max={7} value={sample.finetune} style={numXS}
                    onChange={(e) => applyTune(sample.transpose, Number(e.target.value))} />
                  <button className="btn" type="button" style={nudgeStyle}
                    onClick={() => applyTune(sample.transpose, sample.finetune + 1)}>+</button>
                </div>
                <div style={{ color: '#6699BB', fontSize: '0.66rem' }}>
                  Nudge the pitch and watch the song grid stretch / squeeze to fit.
                </div>
              </div>
            )}

            {/* TUNE footer — common to all modes */}
            <div style={{ borderTop: '1px solid #2a3a4a', paddingTop: '0.3rem', fontSize: '0.7rem', color: '#88AACC', fontFamily: 'var(--font-mono)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
                <span>now <b style={{ color: '#00CCFF' }}>{sample.transpose >= 0 ? '+' : ''}{sample.transpose}st {sample.finetune >= 0 ? '+' : ''}{sample.finetune}/8</b></span>
                <span>· rate <b style={{ color: '#00CCFF' }}>×{playbackRate.toFixed(3)}</b></span>
                <span style={{ color: '#556688' }}>· loop {loopSongBars.toFixed(2)} bars</span>
                <button className="btn" type="button" disabled={!sample.pcm} style={{ marginLeft: 'auto' }}
                  onClick={() => { if (sample.pcm) playPcmAtPitch(sample.pcm, sample.sampleRate, sample.transpose, sample.finetune); }}>▶ TEST</button>
                <button className="btn" type="button" onClick={() => applyTune(0, 0)}>RESET</button>
              </div>
              <label style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center', cursor: 'pointer', marginTop: '0.3rem' }}
                title="When ON, the sequencer ignores the entered note's pitch — the fitted loop plays identically on every row.">
                <input type="checkbox" checked={ignorePitch} onChange={(e) => setIgnorePitch(e.target.checked)} />
                <span style={{ color: ignorePitch ? '#FF8800' : '#AADDFF' }}>IGNORE PITCH</span>
                <span style={{ color: '#44566a', fontSize: '0.66rem' }}>
                  {ignorePitch ? '— plays the fitted loop on any note row' : '— note row sets pitch normally'}
                </span>
              </label>
            </div>
          </div>

          {/* ENVELOPE panel */}
          <div style={panelStyle}>
            <div style={panelTitleStyle}><span>ENVELOPE</span><span style={panelHintStyle}>AHDSR</span></div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.1rem 0.8rem' }}>
              {([
                { key: 'attackMs',  label: 'ATK', unit: 'ms', min: 0, max: 5000, step: 1 },
                { key: 'decayMs',   label: 'DEC', unit: 'ms', min: 0, max: 5000, step: 1 },
                { key: 'sustain',   label: 'SUS', unit: '',   min: 0, max: 1,    step: 0.05 },
                { key: 'releaseMs', label: 'REL', unit: 'ms', min: 0, max: 5000, step: 1 },
              ] as const).map(({ key, label, unit, min, max, step }) => (
                <div key={key} className="field-row" style={{ marginBottom: '0.25rem' }}>
                  <label style={{ color: '#AADDFF' }}>{label}</label>
                  <input type="number" min={min} max={max} step={step}
                    value={(sample as unknown as Record<string, number>)[key]}
                    onChange={(e) => setInstrument(idx, { ...sample, [key]: Math.max(min, Math.min(max, Number(e.target.value))) } as SampleInstrument)}
                    style={numEnv} />
                  {unit && <span style={{ color: '#556688', fontSize: '0.7rem' }}>{unit}</span>}
                </div>
              ))}
            </div>
            <div style={{ borderTop: '1px solid #223', paddingTop: '0.3rem', marginTop: '0.1rem' }}>
              <label style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}
                title="Ignore note-off — sample plays to its end regardless of note length (for percussion one-shots)">
                <input type="checkbox" checked={sample.suppressNoteOff}
                  onChange={(e) => setInstrument(idx, { ...sample, suppressNoteOff: e.target.checked } as SampleInstrument)} />
                <span style={{ color: sample.suppressNoteOff ? '#FF8800' : '#AADDFF' }}>ONE-SHOT</span>
                <span style={{ color: '#44566a', fontSize: '0.66rem' }}>ignore note-off</span>
              </label>
            </div>
          </div>

          {/* INFO panel — compact read-only sample metadata */}
          {(() => {
            const pcm = sample.pcm;
            const sr  = sample.sampleRate || 44100;
            const lenSecs = pcm ? (pcm.length / sr).toFixed(2) + 's' : '—';
            let peakStr = '—';
            if (pcm && pcm.length > 0) {
              let peak = 0;
              for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]!); if (a > peak) peak = a; }
              peakStr = peak > 0 ? (20 * Math.log10(peak)).toFixed(1) + ' dB' : '-∞ dB';
            }
            const recBpmDisplay = recordedBpm > 0 ? `${recordedBpm} BPM` : '—';
            const rows: [string, string][] = [
              ['Length',  lenSecs],
              ['Rate',    pcm ? `${sr} Hz · mono` : '—'],
              ['Peak',    peakStr],
              ['Rec key', `${sample.baseNote} (${noteName(sample.baseNote)})`],
              ['Rec BPM', recBpmDisplay],
            ];
            const labelStyle: React.CSSProperties = { color: '#7799bb', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', minWidth: '5.5ch', flexShrink: 0 };
            const valueStyle: React.CSSProperties = { color: '#00CCFF', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' };
            return (
              <div style={panelStyle}>
                <div style={panelTitleStyle}><span>INFO</span></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {rows.map(([label, value]) => (
                    <div key={label} style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                      <span style={labelStyle}>{label}</span>
                      <span style={valueStyle}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        {/* 7. Edit buttons — always visible */}
        <div style={{ borderTop: '2px solid #000', background: '#000022', padding: '0.25rem 0.4rem' }}>
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.25rem' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#556688' }}>SEL</span>
            <button className="btn" type="button" disabled={!pcmLen} onClick={() => { setSelStart(0); setSelEnd(pcmLen - 1); }}>All</button>
            <button className="btn" type="button" disabled={!sel} onClick={() => { setSelStart(null); setSelEnd(null); }}>Desel</button>
            <div style={{ width: '1px', background: '#0055AA', alignSelf: 'stretch' }} />
            <button className="btn" type="button" disabled={!sel || !sample.pcm} onClick={opErase}>Erase</button>
            <button className="btn" type="button" disabled={!sel} onClick={opCopy}>Copy</button>
            <button className="btn" type="button" disabled={!sel} onClick={opCut}>Cut</button>
            <button className="btn" type="button" disabled={!hasClip} onClick={opPaste}>Paste</button>
            <button className="btn" type="button" disabled={!sel} onClick={opReverse}>Reverse</button>
            <div style={{ width: '1px', background: '#0055AA', alignSelf: 'stretch' }} />
            <button className="btn" type="button" disabled={!sample.pcm} onClick={opTrim}>Trim Silence</button>
            <button className="btn" type="button" disabled={!sample.pcm || sample.loopEnd <= sample.loopStart} onClick={opTrimToLoop}
              style={{ color: sample.pcm && sample.loopEnd > sample.loopStart ? '#00CCFF' : undefined }}>Trim to Loop</button>
            <button className="btn" type="button"
              onClick={() => setAdvDialog(advDialog === 'echo' ? null : 'echo')}
              style={{ color: advDialog === 'echo' ? '#FF8800' : undefined }}>Echo</button>
            <button className="btn" type="button"
              onClick={() => setAdvDialog(advDialog === 'changevol' ? null : 'changevol')}
              style={{ color: advDialog === 'changevol' ? '#FF8800' : undefined }}>Change Vol</button>
            <button className="btn" type="button"
              onClick={() => setAdvDialog(advDialog === 'expand' ? null : 'expand')}
              style={{ color: advDialog === 'expand' ? '#FF8800' : undefined }}>Expand</button>
          </div>
          {/* Advanced dialogs (echo / changevol / expand) */}
          {advDialog && (
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {advDialog === 'echo' && (
                <div style={dialogStyle}>
                  <div style={dialogTitleStyle}>Echo</div>
                  <div style={dialogBodyStyle}>
                    <div className="field-row"><label>Echo Rate</label><input type="number" min={1} max={1000000} value={echoRate} onChange={(e) => setEchoRate(Math.max(1, Number(e.target.value)))} style={numWide} /></div>
                    <div className="field-row"><label>Vol Decrease %</label><input type="number" min={0} max={100} value={echoVolDec} onChange={(e) => setEchoVolDec(Math.max(0, Math.min(100, Number(e.target.value))))} style={numS} /></div>
                    <div className="field-row"><label>Count</label><input type="number" min={1} max={32} value={echoCount} onChange={(e) => setEchoCount(Math.max(1, Math.min(32, Number(e.target.value))))} style={numS} /></div>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button className="btn" type="button" disabled={!sel} onClick={opEcho}>Do Echo</button>
                      <button className="btn" type="button" onClick={() => setAdvDialog(null)}>Exit</button>
                    </div>
                  </div>
                </div>
              )}
              {advDialog === 'changevol' && (
                <div style={dialogStyle}>
                  <div style={dialogTitleStyle}>Change Volume</div>
                  <div style={dialogBodyStyle}>
                    <div className="field-row"><label>Start %</label><input type="range" min={0} max={400} step={1} value={cvStart} onChange={(e) => setCvStart(Number(e.target.value))} style={{ flex: 1 }} /><input type="number" min={0} max={400} value={cvStart} onChange={(e) => setCvStart(Math.max(0, Math.min(400, Number(e.target.value))))} style={numS} /></div>
                    <div className="field-row"><label>End %</label><input type="range" min={0} max={400} step={1} value={cvEnd} onChange={(e) => setCvEnd(Number(e.target.value))} style={{ flex: 1 }} /><input type="number" min={0} max={400} value={cvEnd} onChange={(e) => setCvEnd(Math.max(0, Math.min(400, Number(e.target.value))))} style={numS} /></div>
                    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
                      <button className="btn" type="button" disabled={!sample.pcm} onClick={() => opChangeVolume(cvStart, cvEnd)}>CHANGE VOL</button>
                      <button className="btn" type="button" disabled={!sample.pcm} onClick={() => { setCvStart(0); setCvEnd(100); opChangeVolume(0, 100); }}>Fade In</button>
                      <button className="btn" type="button" disabled={!sample.pcm} onClick={() => { setCvStart(100); setCvEnd(0); opChangeVolume(100, 0); }}>Fade Out</button>
                      <button className="btn" type="button" disabled={!sample.pcm} onClick={() => { setCvStart(50); setCvEnd(50); opChangeVolume(50, 50); }}>Halve</button>
                      <button className="btn" type="button" disabled={!sample.pcm} onClick={() => { setCvStart(200); setCvEnd(200); opChangeVolume(200, 200); }}>Double</button>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                      <label style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', cursor: 'pointer' }}><input type="checkbox" checked={dontClip} onChange={(e) => setDontClip(e.target.checked)} /><span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>Don't Clip</span></label>
                      <button className="btn" type="button" style={{ marginLeft: 'auto' }} onClick={() => setAdvDialog(null)}>Exit</button>
                    </div>
                  </div>
                </div>
              )}
              {advDialog === 'expand' && (
                <div style={dialogStyle}>
                  <div style={dialogTitleStyle}>Expand Buffer</div>
                  <div style={dialogBodyStyle}>
                    <div className="field-row"><label>Add (smp)</label><input type="number" min={1} max={1000000} value={expandN} onChange={(e) => setExpandN(Math.max(1, Number(e.target.value)))} style={numWide} /></div>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      <button className="btn" type="button" disabled={!sample.pcm} onClick={opExpand}>Add Silence</button>
                      <button className="btn" type="button" onClick={() => setAdvDialog(null)}>Exit</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Range info — samples, seconds, and song bars */}
          {sel ? (
            <div style={{ marginTop: '0.25rem', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#FF8800' }}>
              Range: {sel.a.toLocaleString()}–{sel.b.toLocaleString()} · {(sel.b - sel.a + 1).toLocaleString()} smp
              {sample.sampleRate > 0 && ` · ${((sel.b - sel.a + 1) / sample.sampleRate).toFixed(3)}s`}
              {songBarSamples > 0 &&
                ` · ${((sel.b - sel.a + 1) / songBarSamples).toFixed(2)} song bars (${smpToBarBeat(sel.a)} → ${smpToBarBeat(sel.b)})`}
            </div>
          ) : (
            <div style={{ marginTop: '0.25rem', fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: '#44556a' }}>
              No selection — drag on the waveform to select · Space play · L loop · A all · Del erase · Z/X zoom · M metro
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default SampleEditor;
