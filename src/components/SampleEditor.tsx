// SampleEditor — ModeCat-style waveform display + PCM editing.
//
// Layout matches ModeCat Pro V5 screenshot:
//   • Info bar: Display / Buffsize / Range Start / Range End
//   • Waveform canvas (blue, zoomable)
//   • Button rows: Play Display | Zoom | Show All | Paste | Reverse …
//   • Loop row: Freehand | Loop | Loop Point | Start | < | > | <0 | 0>
//   • Echo dialog panel
//   • Change Volume dialog panel (Fade In/Out, Halve, Double)
//   • Instrument params below

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { SampleInstrument, SynthInstrument, MidiInstrument } from '../state/types';
import { SynthEditor } from './SynthEditor';

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

// MIDI note name for pitch display
function noteName(n: number): string {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return `${names[n % 12]}-${Math.floor(n / 12) - 1}`;
}

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

// ── Tiny dialog-panel style ───────────────────────────────────────────────────

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

  // Selection (sample-frame indices, inclusive). null = no selection.
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd,   setSelEnd]   = useState<number | null>(null);
  const dragRef = useRef<{ startSmp: number } | null>(null);
  const draggingMarkerRef = useRef<'start' | 'end' | null>(null);
  const [canvasCursor, setCanvasCursor] = useState<string>('crosshair');

  // Zoom: which portion of the buffer is visible. null = show all.
  const [viewStart, setViewStart] = useState<number | null>(null);
  const [viewEnd,   setViewEnd]   = useState<number | null>(null);

  // Playback loop toggle: when true, Play button loops between S/E markers.
  const [playLooping, setPlayLooping] = useState(false);

  // Clipboard.
  const [clipboard, setClipboard] = useState<Float32Array | null>(null);

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

  // Which dialog is open (null | 'echo' | 'changevol' | 'expand').
  const [dialog, setDialog] = useState<null | 'echo' | 'changevol' | 'expand'>(null);

  // Amiga zoom: whether the editor is expanded over the sequencer.
  const [expanded, setExpanded] = useState(false);

  // BPM fit panel state.
  const [sampleBpmStr, setSampleBpmStr] = useState('');
  const [bpmDetecting, setBpmDetecting] = useState(false);

  // Close on Escape when expanded.
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [expanded]);

  // Cancel animation on unmount.
  useEffect(() => () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); }, []);

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

    // Selection highlight (orange tint)
    if (sel) {
      const sx = Math.floor(((sel.a - vStart) / visible) * cssW);
      const ex = Math.ceil(((sel.b - vStart) / visible) * cssW);
      ctx2d.fillStyle = 'rgba(255,136,0,0.18)';
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

    // Beat grid overlay — draw when sample BPM is set
    const sampleBpmNum = parseFloat(sampleBpmStr);
    if (!isNaN(sampleBpmNum) && sampleBpmNum > 0 && sample.sampleRate > 0) {
      const beatSamples = (sample.sampleRate * 60) / sampleBpmNum;
      const firstBeat = Math.ceil(vStart / beatSamples);
      const lastBeat  = Math.floor(vEnd   / beatSamples);
      ctx2d.font = `9px "VT323", monospace`;
      for (let beat = firstBeat; beat <= lastBeat; beat++) {
        const smpPos = beat * beatSamples;
        const x = Math.floor(((smpPos - vStart) / visible) * cssW);
        const isBar = beat % 4 === 0;
        ctx2d.fillStyle = isBar ? 'rgba(255,210,0,0.28)' : 'rgba(255,210,0,0.10)';
        ctx2d.fillRect(x, 0, 1, cssH);
        if (isBar && beat > 0) {
          ctx2d.fillStyle = 'rgba(255,210,0,0.7)';
          ctx2d.fillText(`${beat / 4 + 1}`, x + 2, 10);
        }
      }
    }

    // Loop markers (cyan) with drag handles at top
    if (sample.loopEnd > sample.loopStart) {
      const lsx = Math.floor(((sample.loopStart - vStart) / visible) * cssW);
      const lex = Math.floor(((sample.loopEnd   - vStart) / visible) * cssW);
      const HANDLE = 10;
      ctx2d.fillStyle = '#00CCFF';
      // Start marker — line + right-pointing handle
      ctx2d.fillRect(lsx, 0, 1, cssH);
      ctx2d.beginPath();
      ctx2d.moveTo(lsx, 0);
      ctx2d.lineTo(lsx + HANDLE, 0);
      ctx2d.lineTo(lsx, HANDLE);
      ctx2d.fill();
      // End marker — line + left-pointing handle
      ctx2d.fillRect(lex, 0, 1, cssH);
      ctx2d.beginPath();
      ctx2d.moveTo(lex, 0);
      ctx2d.lineTo(lex - HANDLE, 0);
      ctx2d.lineTo(lex, HANDLE);
      ctx2d.fill();
      // Labels
      ctx2d.font = '9px "VT323", monospace';
      ctx2d.fillStyle = '#00CCFF';
      ctx2d.fillText('S', lsx + 2, 20);
      ctx2d.fillText('E', lex - 10, 20);
    }
    // Save the rendered waveform so the playhead animation can restore it each frame
    waveformImageRef.current = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
  }, [sample, sel, vStart, vEnd, expanded, sampleBpmStr]);

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

  // Snap a sample position to the nearest beat when grid BPM is active.
  function snapToBeat(smp: number): number {
    if (!sample) return smp;
    const gridBpm = parseFloat(sampleBpmStr);
    if (!isFinite(gridBpm) || gridBpm <= 0 || sample.sampleRate <= 0) return smp;
    const beatSmp = (sample.sampleRate * 60) / gridBpm;
    return Math.round(smp / beatSmp) * beatSmp;
  }

  function onCanvasMove(e: React.MouseEvent<HTMLCanvasElement>) {
    // Dragging a loop marker — update S/E in real time, snapping to beat if grid is active
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
      <div className="panel col">
        <div className="panel__title">Slot {String(idx).padStart(2, '0')} — MIDI</div>
        <div className="field-row"><label>NAME</label>
          <input type="text" value={midi.name} onChange={(e) => setInstrument(idx, { ...midi, name: e.target.value })} /></div>
        <div className="field-row"><label>CHANNEL</label>
          <input type="number" min={1} max={16} value={midi.channel + 1}
            onChange={(e) => setInstrument(idx, { ...midi, channel: Math.max(0, Math.min(15, Number(e.target.value) - 1)) })} /></div>
        <div className="field-row"><label>PROGRAM</label>
          <input type="number" min={-1} max={127} value={midi.program}
            onChange={(e) => setInstrument(idx, { ...midi, program: Math.max(-1, Math.min(127, Number(e.target.value))) })} /></div>
        <div className="field-row"><label>VEL</label>
          <input type="number" min={1} max={127} value={midi.velocity}
            onChange={(e) => setInstrument(idx, { ...midi, velocity: Math.max(1, Math.min(127, Number(e.target.value))) })} /></div>
        <div className="field-row"><label>LEN ROWS</label>
          <input type="number" min={1} max={64} value={midi.lengthRows}
            onChange={(e) => setInstrument(idx, { ...midi, lengthRows: Math.max(1, Math.min(64, Number(e.target.value))) })} /></div>
        <div className="hr" />
        <div className="field-row"><label>TRANSPOSE</label>
          <input type="number" min={-48} max={48} value={midi.transpose}
            onChange={(e) => setInstrument(idx, { ...midi, transpose: Math.max(-48, Math.min(48, Number(e.target.value))) })}
            style={{ width: '6ch' }} /></div>
        <div className="field-row"><label>FINETUNE</label>
          <input type="number" min={-8} max={7} value={midi.finetune}
            onChange={(e) => setInstrument(idx, { ...midi, finetune: Math.max(-8, Math.min(7, Number(e.target.value))) })}
            style={{ width: '5ch' }} /></div>
        <div className="field-row"><label>DEF PITCH</label>
          <input type="number" min={0} max={127} value={midi.defaultPitch}
            onChange={(e) => setInstrument(idx, { ...midi, defaultPitch: Math.max(0, Math.min(127, Number(e.target.value))) })}
            style={{ width: '5ch' }} /></div>
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

  // When expanded: fixed overlay covering the main + right panels, leaving TitleBar + Footer visible.
  const containerStyle: React.CSSProperties = expanded
    ? {
        position: 'fixed',
        top: 62,         // below MenuBar (~26px) + TransportBar (~36px)
        left: '18%',     // leave SongEditor visible on the left
        right: 0,
        bottom: 36,      // above SaveLoadBar footer
        zIndex: 500,     // above MDI windows
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
        padding: 0,
        background: '#000022',
        borderLeft: '3px solid #0055AA',
        boxShadow: '-12px 0 40px rgba(0,0,119,0.7)',
      }
    : { gap: 0, padding: 0 };

  const canvasH = expanded ? 260 : 120;

  return (
    <>
    {/* Dim backdrop — clicking it collapses the editor */}
    {expanded && (
      <div
        onClick={() => setExpanded(false)}
        style={{
          position: 'fixed', inset: 0, zIndex: 199,
          background: 'rgba(0,0,30,0.55)',
          pointerEvents: 'auto',
        }}
      />
    )}
    <div className={expanded ? '' : 'panel col'} style={containerStyle}>

      {/* ── Title bar ──────────────────────────────────────────────────────── */}
      <div style={{
        background: '#0055AA', color: '#FFFFFF', padding: '0.15rem 0.4rem 0.15rem 0.5rem',
        fontFamily: 'var(--font-mono)', fontSize: '0.78rem',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: '0.5rem', flexShrink: 0,
      }}>
        <span>Sample Editor</span>
        <span style={{ fontSize: '0.7rem', color: '#AADDFF', flex: 1 }}>
          Slot {String(idx).padStart(2, '0')} — {sample.name || 'unnamed'}
          {inst.kind === 'hybrid' && (
            <span style={{ marginLeft: '0.5rem', color: 'var(--wb-orange)', fontSize: '0.65rem' }}>[HYB]</span>
          )}
        </span>
        <ZoomGadget expanded={expanded} onToggle={() => setExpanded((e) => !e)} />
      </div>

      {/* ── Info bar ───────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: '1rem', padding: '0.2rem 0.5rem',
        background: '#001133', fontFamily: 'var(--font-mono)', fontSize: '0.72rem',
        color: '#AADDFF', flexWrap: 'wrap', alignItems: 'center',
      }}>
        <span>Display: <b>{String(vStart).padStart(7, '0')}</b></span>
        <span>Buffsize: <b>{String(pcmLen).padStart(7, '0')}</b></span>
        <span>Range Start: <b>{sel ? String(sel.a).padStart(7, '0') : '0000000'}</b></span>
        <span>Range End: <b>{sel ? String(sel.b).padStart(7, '0') : '0000000'}</b></span>
        {sample.pcm && (
          <span style={{ marginLeft: 'auto', color: '#88BBFF' }}>
            Pitch: <b>{sample.baseNote}</b> &nbsp; <b>{noteName(sample.baseNote)}</b>
          </span>
        )}
      </div>

      {/* ── Waveform canvas ─────────────────────────────────────────────────── */}
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: canvasH, cursor: canvasCursor, display: 'block', background: '#000', flexShrink: 0 }}
        onMouseDown={onCanvasDown}
        onMouseMove={onCanvasMove}
        onMouseUp={onCanvasUp}
        onMouseLeave={onCanvasUp}
      />

      {/* ── Button row 1 — Playback ─────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: '0.3rem', padding: '0.25rem 0.4rem',
        background: '#000022', flexWrap: 'wrap', alignItems: 'center',
        borderTop: '1px solid #003366',
      }}>
        <button className="btn" type="button"
          disabled={!sample.pcm}
          onClick={() => {
            if (!sample.pcm) return;
            if (playLooping && sample.loopEnd > sample.loopStart) {
              playPcmLooping(sample.pcm, sample.sampleRate, sample.loopStart, sample.loopEnd);
            } else {
              playPcmPreview(sample.pcm, sample.sampleRate, sel?.a, sel?.b);
            }
            startPlayheadAnim();
          }}
          title={playLooping
            ? 'Loop between S/E markers (Loop is ON)'
            : 'Play selection once, or full sample if no selection'}
          style={{ fontWeight: 'bold' }}>
          ▶ Play
        </button>
        <button className="btn" type="button"
          onClick={() => setPlayLooping((v) => !v)}
          title={playLooping
            ? 'Loop ON — Play will loop between S/E markers. Click to turn off.'
            : 'Loop OFF — Play will play once. Click to turn on looping.'}
          style={{
            color: playLooping ? '#00CCFF' : undefined,
            fontWeight: playLooping ? 'bold' : undefined,
            outline: playLooping ? '1px solid #00CCFF' : undefined,
          }}>
          ⟳ Loop
        </button>
        <button className="btn" type="button"
          onClick={() => { stopPcmPreview(); stopPlayheadAnim(); }}
          title="Stop preview playback">
          ■ Stop
        </button>

        <div style={{ width: '1px', background: '#0055AA', alignSelf: 'stretch', margin: '0 0.2rem' }} />

        <button className="btn" type="button" disabled={!pcmLen} onClick={zoomIn} title="Zoom in">Zoom+</button>
        <button className="btn" type="button" disabled={!pcmLen} onClick={showAll} title="Show whole sample">Show All</button>
        <button className="btn" type="button" disabled={!pcmLen} onClick={zoomOut} title="Zoom out">Zoom−</button>
        <button className="btn" type="button" disabled={!pcmLen} onClick={goToStart} title="Scroll to start">|◄</button>
        <button className="btn" type="button" disabled={!pcmLen} onClick={scrollLeft} title="Scroll left">◄</button>
        <button className="btn" type="button" disabled={!pcmLen} onClick={scrollRight} title="Scroll right">►</button>
        <button className="btn" type="button" disabled={!pcmLen} onClick={goToEnd} title="Scroll to end">►|</button>
      </div>

      {/* ── Button row 2 — Edit selection ────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: '0.3rem', padding: '0.2rem 0.4rem',
        background: '#000022', flexWrap: 'wrap', alignItems: 'center',
        borderTop: '1px solid #003366',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#556688', marginRight: '0.2rem' }}>EDIT</span>
        <button className="btn" type="button" disabled={!pcmLen}
          onClick={() => { setSelStart(0); setSelEnd(pcmLen - 1); }}
          title="Select entire sample">Sel All</button>
        <button className="btn" type="button" disabled={!sel}
          onClick={() => { setSelStart(null); setSelEnd(null); }}
          title="Clear selection (or single-click on waveform)">Desel</button>

        <div style={{ width: '1px', background: '#0055AA', alignSelf: 'stretch', margin: '0 0.2rem' }} />

        <button className="btn" type="button" disabled={!sel || !sample.pcm} onClick={opErase}
          title="Zero-fill selected range">Erase</button>
        <button className="btn" type="button" disabled={!sel} onClick={opCopy}>Copy</button>
        <button className="btn" type="button" disabled={!sel} onClick={opCut}>Cut</button>
        <button className="btn" type="button" disabled={!hasClip} onClick={opPaste}
          title={hasClip ? `Paste (${clipboard!.length} smp)` : 'Paste'}>Paste</button>
        <button className="btn" type="button" disabled={!sel} onClick={opReverse}>Reverse</button>

        <div style={{ width: '1px', background: '#0055AA', alignSelf: 'stretch', margin: '0 0.2rem' }} />

        <button className="btn" type="button"
          onClick={() => setDialog(dialog === 'echo' ? null : 'echo')}
          style={{ color: dialog === 'echo' ? '#FF8800' : undefined }}>Echo</button>
        <button className="btn" type="button"
          onClick={() => setDialog(dialog === 'changevol' ? null : 'changevol')}
          style={{ color: dialog === 'changevol' ? '#FF8800' : undefined }}>Change Vol</button>
        <button className="btn" type="button"
          onClick={() => setDialog(dialog === 'expand' ? null : 'expand')}
          style={{ color: dialog === 'expand' ? '#FF8800' : undefined }}>Expand</button>
        <button className="btn" type="button" disabled={!sample.pcm} onClick={opTrim}
          title="Strip leading and trailing silence from sample">Trim Silence</button>
      </div>

      {/* ── Button row 3 — Loop markers + file ───────────────────────────────── */}
      <div style={{
        display: 'flex', gap: '0.3rem', padding: '0.2rem 0.4rem',
        background: '#000022', flexWrap: 'wrap', alignItems: 'center',
        borderTop: '1px solid #003366',
      }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#00CCFF', marginRight: '0.2rem' }}>LOOP</span>
        <button className="btn" type="button" disabled={!sel}
          onClick={() => {
            if (!sel) return;
            setInstrument(idx, { ...sample, loopStart: sel.a, loopEnd: sel.b } as SampleInstrument);
          }}
          title="Snap S/E loop markers to current selection">
          Set from Sel
        </button>
        <button className="btn" type="button"
          disabled={!sample.pcm || sample.loopEnd <= sample.loopStart}
          onClick={opTrimToLoop}
          title="Crop sample to S→E region, then reset markers to cover full sample"
          style={{ color: sample.pcm && sample.loopEnd > sample.loopStart ? '#00CCFF' : undefined }}>
          Trim to Loop
        </button>
        {/* Loop-enabled toggle for sequencer (separate from preview looping) */}
        <label style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center', cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: '0.72rem',
          color: sample.loopEnabled ? '#00CCFF' : '#556688' }}
          title="When ON, sequencer loops this sample between S/E points during note playback">
          <input type="checkbox" checked={sample.loopEnabled}
            onChange={(e) => setInstrument(idx, { ...sample, loopEnabled: e.target.checked } as SampleInstrument)} />
          Seq Loop
        </label>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          {onOpenLibrary && (
            <button className="btn" type="button" onClick={onOpenLibrary}
              style={{ fontFamily: 'var(--font-mono)' }}
              title="Open Sample Library (Alt+B)">
              Library…
            </button>
          )}
          <label className="btn" style={{ cursor: 'pointer', fontFamily: 'var(--font-mono)' }} title="Load WAV file">
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
                  setInstrument(idx, {
                    ...sample, pcm, sampleRate: audio.sampleRate,
                    name: f.name.replace(/\.[^.]+$/, '').slice(0, 20),
                    loopStart: 0,
                    loopEnd: pcm.length - 1,
                  } as SampleInstrument);
                  setSelStart(null); setSelEnd(null); showAll();
                } finally { actx.close(); }
              }}
            />
          </label>
          <button className="btn" type="button"
            onClick={() => {
              stopPcmPreview();
              setInstrument(idx, { ...sample, pcm: null, loopStart: 0, loopEnd: 0 } as SampleInstrument);
              setSelStart(null); setSelEnd(null); showAll();
            }}>
            Clear
          </button>
        </div>
      </div>

      {/* ── Dialog panels ─────────────────────────────────────────────────── */}
      {dialog && (
        <div style={{ display: 'flex', gap: '0.4rem', padding: '0.4rem', background: '#000022', flexWrap: 'wrap', borderTop: '1px solid #003366' }}>

          {/* Echo dialog */}
          {dialog === 'echo' && (
            <div style={dialogStyle}>
              <div style={dialogTitleStyle}>Echo</div>
              <div style={dialogBodyStyle}>
                <div className="field-row">
                  <label>Echo Rate</label>
                  <input type="number" min={1} max={1000000} value={echoRate}
                    onChange={(e) => setEchoRate(Math.max(1, Number(e.target.value)))}
                    style={{ width: '7ch' }} />
                </div>
                <div className="field-row">
                  <label>Volume Decrease</label>
                  <input type="number" min={0} max={100} value={echoVolDec}
                    onChange={(e) => setEchoVolDec(Math.max(0, Math.min(100, Number(e.target.value))))}
                    style={{ width: '5ch' }} />
                </div>
                <div className="field-row">
                  <label>Number of Echoes</label>
                  <input type="number" min={1} max={32} value={echoCount}
                    onChange={(e) => setEchoCount(Math.max(1, Math.min(32, Number(e.target.value))))}
                    style={{ width: '4ch' }} />
                </div>
                <div className="row" style={{ gap: '0.4rem' }}>
                  <button className="btn" type="button" disabled={!sel} onClick={opEcho}>Do Echo</button>
                  <button className="btn" type="button" onClick={() => setDialog(null)}>Exit</button>
                </div>
              </div>
            </div>
          )}

          {/* Change Volume dialog */}
          {dialog === 'changevol' && (
            <div style={dialogStyle}>
              <div style={dialogTitleStyle}>Change Volume</div>
              <div style={dialogBodyStyle}>
                <div className="field-row">
                  <label>Start %</label>
                  <input type="range" min={0} max={400} step={1} value={cvStart}
                    onChange={(e) => setCvStart(Number(e.target.value))}
                    style={{ flex: 1 }} />
                  <input type="number" min={0} max={400} value={cvStart}
                    onChange={(e) => setCvStart(Math.max(0, Math.min(400, Number(e.target.value))))}
                    style={{ width: '5ch' }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#AADDFF' }}>%</span>
                </div>
                <div className="field-row">
                  <label>End %</label>
                  <input type="range" min={0} max={400} step={1} value={cvEnd}
                    onChange={(e) => setCvEnd(Number(e.target.value))}
                    style={{ flex: 1 }} />
                  <input type="number" min={0} max={400} value={cvEnd}
                    onChange={(e) => setCvEnd(Math.max(0, Math.min(400, Number(e.target.value))))}
                    style={{ width: '5ch' }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: '#AADDFF' }}>%</span>
                </div>
                <div className="row" style={{ gap: '0.3rem', flexWrap: 'wrap' }}>
                  <button className="btn" type="button"
                    disabled={!sample.pcm}
                    onClick={() => opChangeVolume(cvStart, cvEnd)}
                    title="Apply custom start/end volume to selection (or full buffer)">
                    CHANGE VOLUME
                  </button>
                </div>
                <div className="row" style={{ gap: '0.3rem', flexWrap: 'wrap' }}>
                  <button className="btn" type="button" disabled={!sample.pcm}
                    onClick={() => { setCvStart(0); setCvEnd(100); opChangeVolume(0, 100); }}
                    title="Fade In: 0% → 100%">Fade In</button>
                  <button className="btn" type="button" disabled={!sample.pcm}
                    onClick={() => { setCvStart(100); setCvEnd(0); opChangeVolume(100, 0); }}
                    title="Fade Out: 100% → 0%">Fade Out</button>
                  <button className="btn" type="button" disabled={!sample.pcm}
                    onClick={() => { setCvStart(50); setCvEnd(50); opChangeVolume(50, 50); }}
                    title="Halve amplitude">Halve</button>
                  <button className="btn" type="button" disabled={!sample.pcm}
                    onClick={() => { setCvStart(200); setCvEnd(200); opChangeVolume(200, 200); }}
                    title="Double amplitude">Double</button>
                </div>
                <div className="row" style={{ gap: '0.4rem', alignItems: 'center' }}>
                  <label style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" checked={dontClip}
                      onChange={(e) => setDontClip(e.target.checked)} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>Don't Clip</span>
                  </label>
                  <button className="btn" type="button" style={{ marginLeft: 'auto' }} onClick={() => setDialog(null)}>Exit</button>
                </div>
              </div>
            </div>
          )}

          {/* Expand dialog */}
          {dialog === 'expand' && (
            <div style={dialogStyle}>
              <div style={dialogTitleStyle}>Expand Buffer</div>
              <div style={dialogBodyStyle}>
                <div className="field-row">
                  <label>Add (smp)</label>
                  <input type="number" min={1} max={1000000} value={expandN}
                    onChange={(e) => setExpandN(Math.max(1, Number(e.target.value)))}
                    style={{ width: '9ch' }} />
                </div>
                <div className="row" style={{ gap: '0.4rem' }}>
                  <button className="btn" type="button" disabled={!sample.pcm} onClick={opExpand}>Add Silence</button>
                  <button className="btn" type="button" onClick={() => setDialog(null)}>Exit</button>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── Bottom status bar ───────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: '1rem', padding: '0.15rem 0.5rem',
        background: '#000011', fontFamily: 'var(--font-mono)', fontSize: '0.7rem',
        color: '#556688', flexWrap: 'wrap', alignItems: 'center',
        borderTop: '1px solid #003366',
      }}>
        <span>Samples: <span style={{ color: '#88BBFF' }}>{pcmLen.toLocaleString()}</span></span>
        <span>Rate: <span style={{ color: '#88BBFF' }}>{sample.pcm ? `${sample.sampleRate} Hz` : '—'}</span></span>
        <span>— {sample.pcm ? 'Ready' : 'Stopped'} —</span>
        {sel && (
          <span style={{ color: '#FF8800' }}>
            Range: {sel.a}–{sel.b} ({(sel.b - sel.a + 1).toLocaleString()} smp)
          </span>
        )}
      </div>

      {/* ── Instrument parameters ────────────────────────────────────────────── */}
      <div style={{ padding: '0.4rem', background: '#000022', borderTop: '1px solid #003366', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>

        {/* Name */}
        <div className="field-row">
          <label>NAME</label>
          <input type="text" value={sample.name}
            onChange={(e) => setInstrument(idx, { ...sample, name: e.target.value } as SampleInstrument)} />
        </div>

        {/* Basic params row */}
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="field-row">
            <label title="MIDI note at which sample plays at natural speed">BASE</label>
            <input type="number" min={0} max={127} value={sample.baseNote}
              onChange={(e) => setInstrument(idx, { ...sample, baseNote: Math.max(0, Math.min(127, Number(e.target.value))) } as SampleInstrument)}
              style={{ width: '4ch' }} />
            <span style={{ color: '#556688', fontSize: '0.8em', marginLeft: '0.2rem' }}>{noteName(sample.baseNote)}</span>
          </div>
          <div className="field-row">
            <label>VOL</label>
            <input type="number" min={0} max={127} value={sample.volume}
              onChange={(e) => setInstrument(idx, { ...sample, volume: Math.max(0, Math.min(127, Number(e.target.value))) } as SampleInstrument)}
              style={{ width: '4ch' }} />
          </div>
          <div className="field-row">
            <label>LOOP IN</label>
            <input type="number" min={0} max={pcmLen} value={sample.loopStart}
              onChange={(e) => setInstrument(idx, { ...sample, loopStart: Math.max(0, Number(e.target.value)) } as SampleInstrument)}
              style={{ width: '7ch' }} />
          </div>
          <div className="field-row">
            <label>LOOP OUT</label>
            <input type="number" min={0} max={pcmLen} value={sample.loopEnd}
              onChange={(e) => setInstrument(idx, { ...sample, loopEnd: Math.max(0, Number(e.target.value)) } as SampleInstrument)}
              style={{ width: '7ch' }} />
          </div>
          <div className="field-row" style={{ alignItems: 'center' }}>
            <label>SUP.OFF</label>
            <input type="checkbox" checked={sample.suppressNoteOff}
              onChange={(e) => setInstrument(idx, { ...sample, suppressNoteOff: e.target.checked } as SampleInstrument)}
              title="Ignore note-off (one-shot percussion)" />
          </div>
        </div>

        {/* Pitch row — transpose + finetune + live pitch preview */}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="field-row" style={{ alignItems: 'center', gap: '0.15rem' }}>
            <label title="Semitone transpose applied at playback (-48..+48)">TRANS</label>
            <button className="btn" type="button" style={{ padding: '0 0.3rem', minWidth: 0 }}
              onClick={() => setInstrument(idx, { ...sample, transpose: Math.max(-48, sample.transpose - 1) } as SampleInstrument)}>−</button>
            <input type="number" min={-48} max={48} value={sample.transpose}
              onChange={(e) => setInstrument(idx, { ...sample, transpose: Math.max(-48, Math.min(48, Number(e.target.value))) } as SampleInstrument)}
              style={{ width: '4ch', textAlign: 'center' }} />
            <button className="btn" type="button" style={{ padding: '0 0.3rem', minWidth: 0 }}
              onClick={() => setInstrument(idx, { ...sample, transpose: Math.min(48, sample.transpose + 1) } as SampleInstrument)}>+</button>
          </div>
          <div className="field-row">
            <label title="Fine-tune: ±1 semitone in 1/8 steps (−8..+7)">FINE</label>
            <input type="number" min={-8} max={7} value={sample.finetune}
              onChange={(e) => setInstrument(idx, { ...sample, finetune: Math.max(-8, Math.min(7, Number(e.target.value))) } as SampleInstrument)}
              style={{ width: '3ch', textAlign: 'center' }} />
          </div>
          <div className="field-row">
            <label title="Default entry pitch for F-key shortcut">DEF♪</label>
            <input type="number" min={0} max={127} value={sample.defaultPitch}
              onChange={(e) => setInstrument(idx, { ...sample, defaultPitch: Math.max(0, Math.min(127, Number(e.target.value))) } as SampleInstrument)}
              style={{ width: '4ch' }} />
          </div>
          {/* Effective pitch display + test button */}
          <span style={{ color: '#556688', fontSize: '0.8em' }}>→</span>
          <span style={{ color: '#88BBFF', fontSize: '0.9em', fontFamily: 'var(--font-mono)', minWidth: '3.5ch' }}
            title={`Sounds at: base ${noteName(sample.baseNote)} + ${sample.transpose}st + ${sample.finetune}/8st`}>
            {noteName(Math.max(0, Math.min(127, sample.baseNote + sample.transpose)))}
          </span>
          <button className="btn" type="button"
            disabled={!sample.pcm}
            onClick={() => {
              if (!sample.pcm) return;
              playPcmAtPitch(sample.pcm, sample.sampleRate, sample.transpose, sample.finetune);
            }}
            title="Play sample at current transpose + finetune pitch">
            ▶ TEST
          </button>
        </div>

        {/* BPM / Beat grid row */}
        {(() => {
          const sampleBpm = parseFloat(sampleBpmStr);
          const bpmValid  = isFinite(sampleBpm) && sampleBpm > 20 && sampleBpm < 400;
          // Total semitones needed: 12 * log2(songBpm / sampleBpm)
          const totalSt   = bpmValid ? 12 * Math.log2(songBpm / sampleBpm) : 0;
          const trans     = bpmValid ? Math.trunc(totalSt) : 0;
          const fine      = bpmValid ? Math.round((totalSt - trans) * 8) : 0;
          // Samples per beat / bar at current grid BPM (used by bar-snap buttons)
          const beatSamples = bpmValid && sample.sampleRate > 0
            ? (sample.sampleRate * 60) / sampleBpm
            : 0;
          const barSamples  = beatSamples * 4;
          return (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="field-row">
                <label title="Grid BPM — sets the yellow beat-grid overlay on the waveform">GRID BPM</label>
                <input
                  type="number" min={20} max={400} step={0.5}
                  value={sampleBpmStr}
                  onChange={(e) => setSampleBpmStr(e.target.value)}
                  style={{ width: '6ch', textAlign: 'center' }}
                  placeholder="—"
                />
              </div>
              {/* One-click: use the current song BPM as the grid */}
              <button className="btn" type="button"
                onClick={() => setSampleBpmStr(String(songBpm))}
                title={`Show beat grid at song BPM (${songBpm})`}
                style={{ color: sampleBpmStr === String(songBpm) ? '#FFD700' : undefined }}>
                Use Song ({songBpm})
              </button>
              <button className="btn" type="button"
                disabled={!sample.pcm || bpmDetecting}
                title="Auto-detect BPM from sample waveform"
                onClick={() => {
                  if (!sample.pcm) return;
                  setBpmDetecting(true);
                  setTimeout(() => {
                    const result = detectBpm(sample.pcm!, sample.sampleRate);
                    setSampleBpmStr(String(result));
                    setBpmDetecting(false);
                  }, 0);
                }}
              >
                {bpmDetecting ? '…' : 'Detect'}
              </button>

              {/* Bar-snap buttons: set loop to exactly N bars at grid BPM */}
              {bpmValid && barSamples > 0 && (
                <>
                  <div style={{ width: '1px', background: '#0055AA', alignSelf: 'stretch' }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: '#FFD700' }}>Snap loop:</span>
                  {([1, 2, 4, 8] as const).map((n) => {
                    const end = Math.round(sample.loopStart + n * barSamples) - 1;
                    return (
                      <button key={n} className="btn" type="button"
                        disabled={!sample.pcm || end >= pcmLen}
                        title={`Set loop end to exactly ${n} bar${n > 1 ? 's' : ''} (${Math.round(n * barSamples)} smp) from loop start`}
                        onClick={() => setInstrument(idx, {
                          ...sample, loopEnd: Math.min(pcmLen - 1, end),
                        } as SampleInstrument)}
                        style={{ color: '#FFD700' }}>
                        {n}bar
                      </button>
                    );
                  })}
                </>
              )}

              {/* BPM-pitch fit (when sample BPM differs from song BPM) */}
              {bpmValid && Math.abs(sampleBpm - songBpm) > 0.5 && (
                <>
                  <div style={{ width: '1px', background: '#0055AA', alignSelf: 'stretch' }} />
                  <span style={{ color: '#6699BB', fontSize: '0.8em', fontFamily: 'var(--font-mono)' }}>
                    pitch fit: {trans > 0 ? '+' : ''}{trans}st {fine > 0 ? '+' : ''}{fine}/8
                  </span>
                  <button className="btn" type="button"
                    title={`Pitch-shift sample to match song BPM: TRANS=${trans} FINE=${fine}`}
                    onClick={() => setInstrument(idx, { ...sample, transpose: trans, finetune: fine } as SampleInstrument)}
                  >
                    Fit Pitch
                  </button>
                </>
              )}
            </div>
          );
        })()}

        {/* Envelope row — ADSR */}
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="field-row">
            <label title="Attack time in ms (0 = instant)">ATK ms</label>
            <input type="number" min={0} max={5000} value={sample.attackMs}
              onChange={(e) => setInstrument(idx, { ...sample, attackMs: Math.max(0, Math.min(5000, Number(e.target.value))) } as SampleInstrument)}
              style={{ width: '5ch' }} />
          </div>
          <div className="field-row">
            <label title="Decay time in ms after peak">DEC ms</label>
            <input type="number" min={0} max={5000} value={sample.decayMs}
              onChange={(e) => setInstrument(idx, { ...sample, decayMs: Math.max(0, Math.min(5000, Number(e.target.value))) } as SampleInstrument)}
              style={{ width: '5ch' }} />
          </div>
          <div className="field-row">
            <label title="Sustain level 0–1 (held while note is on)">SUS</label>
            <input type="number" min={0} max={1} step={0.05} value={sample.sustain}
              onChange={(e) => setInstrument(idx, { ...sample, sustain: Math.max(0, Math.min(1, Number(e.target.value))) } as SampleInstrument)}
              style={{ width: '4ch' }} />
          </div>
          <div className="field-row">
            <label title="Release time in ms after note-off">REL ms</label>
            <input type="number" min={0} max={5000} value={sample.releaseMs}
              onChange={(e) => setInstrument(idx, { ...sample, releaseMs: Math.max(0, Math.min(5000, Number(e.target.value))) } as SampleInstrument)}
              style={{ width: '5ch' }} />
          </div>
          <div className="field-row">
            <label title="Hold note for N rows (0 = until next note-off)">LEN rows</label>
            <input type="number" min={0} max={512} value={sample.lengthRows}
              onChange={(e) => setInstrument(idx, { ...sample, lengthRows: Math.max(0, Math.min(512, Number(e.target.value))) } as SampleInstrument)}
              style={{ width: '4ch' }} />
          </div>
        </div>

      </div>

    </div>
    </>
  );
}
