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

  // BPM fit panel state.
  const [sampleBpmStr, setSampleBpmStr] = useState('');
  const [bpmDetecting, setBpmDetecting] = useState(false);

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

  // New state variables
  const [liveLoop,      setLiveLoop]      = useState(false);
  const [beatGridOn,    setBeatGridOn]    = useState(true);
  const [showAdvanced,  setShowAdvanced]  = useState(false);
  const [advDialog,     setAdvDialog]     = useState<null | 'echo' | 'changevol' | 'expand'>(null);

  // BPM-based pitch target
  const [targetBpmStr, setTargetBpmStr] = useState<string>('');

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

  // Additional derived helpers
  const sampleBpm = parseFloat(sampleBpmStr);
  const bpmValid  = isFinite(sampleBpm) && sampleBpm > 20 && sampleBpm < 400;
  const beatSamplesVal = bpmValid && sample?.sampleRate ? (sample.sampleRate * 60) / sampleBpm : 0;
  const barSamplesVal  = beatSamplesVal * 4;

  function smpToSecs(smp: number): string {
    if (!sample?.sampleRate) return '0.000s';
    return (smp / sample.sampleRate).toFixed(3) + 's';
  }
  function smpToBarBeat(smp: number): string {
    if (!sample?.sampleRate || !bpmValid || beatSamplesVal <= 0) return '—';
    const secs     = smp / sample.sampleRate;
    const beatSecs = 60 / sampleBpm;
    const barSecs  = beatSecs * 4;
    const bar  = Math.floor(secs / barSecs) + 1;
    const beat = Math.floor((secs % barSecs) / beatSecs) + 1;
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

    // Beat grid overlay — draw when beatGridOn is true and sample BPM is set
    const sampleBpmNum = parseFloat(sampleBpmStr);
    if (beatGridOn && !isNaN(sampleBpmNum) && sampleBpmNum > 0 && sample.sampleRate > 0) {
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
  }, [sample, sel, vStart, vEnd, expanded, sampleBpmStr, beatGridOn]);

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

  const canvasH = expanded ? 280 : 160;
  const containerStyle: React.CSSProperties = expanded ? { position:'fixed', top:62, left:'18%', right:0, bottom:36, zIndex:500, overflow:'auto', display:'flex', flexDirection:'column', background:'#000022', borderLeft:'3px solid #0055AA' } : { gap:0, padding:0 };

  return (
    <>
      {expanded && <div onClick={() => setExpanded(false)} style={{ position:'fixed', inset:0, zIndex:199, background:'rgba(0,0,30,0.55)' }} />}
      <div className={expanded ? '' : 'panel col'} style={containerStyle}>

        {/* 1. Title bar */}
        <div style={{ background:'#0055AA', color:'#FFFFFF', padding:'0.15rem 0.4rem', display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem', flexShrink:0, fontFamily:'var(--font-mono)', fontSize:'0.78rem' }}>
          <span>Sample Editor</span>
          <span style={{ fontSize:'0.7rem', color:'#AADDFF', flex:1 }}>
            Slot {String(idx).padStart(2,'0')} — {sample.name || 'unnamed'}
            {inst.kind === 'hybrid' && <span style={{ marginLeft:'0.5rem', color:'var(--wb-orange)', fontSize:'0.65rem' }}>[HYB]</span>}
          </span>
          <ZoomGadget expanded={expanded} onToggle={() => setExpanded(e => !e)} />
        </div>

        {/* 2. Name + base note row */}
        <div style={{ display:'flex', gap:'0.5rem', padding:'0.2rem 0.5rem', background:'#001133', borderBottom:'1px solid #003366', flexWrap:'wrap', alignItems:'center' }}>
          <div className="field-row">
            <label>NAME</label>
            <input type="text" value={sample.name} onChange={e => setInstrument(idx, { ...sample, name: e.target.value } as SampleInstrument)} style={{ minWidth:'10ch' }} />
          </div>
          <div className="field-row">
            <label title="MIDI note at which sample plays at natural speed">BASE</label>
            <input type="number" min={0} max={127} value={sample.baseNote}
              onChange={e => setInstrument(idx, { ...sample, baseNote: Math.max(0,Math.min(127,Number(e.target.value))) } as SampleInstrument)}
              style={{ width:'4ch' }} />
            <span style={{ color:'#FF8800', fontSize:'0.85em', marginLeft:'0.2rem' }}>{noteName(sample.baseNote)}</span>
          </div>
          <div className="field-row">
            <label>VOL</label>
            <input type="number" min={0} max={127} value={sample.volume}
              onChange={e => setInstrument(idx, { ...sample, volume: Math.max(0,Math.min(127,Number(e.target.value))) } as SampleInstrument)}
              style={{ width:'4ch' }} />
          </div>
          <label style={{ display:'inline-flex', gap:'0.3rem', alignItems:'center', cursor:'pointer', fontFamily:'var(--font-mono)', fontSize:'0.72rem', color: sample.loopEnabled ? '#00CCFF' : '#556688', marginLeft:'0.5rem' }} title="When ON, sequencer loops this sample between IN/OUT during note playback">
            <input type="checkbox" checked={sample.loopEnabled} onChange={e => setInstrument(idx, { ...sample, loopEnabled: e.target.checked } as SampleInstrument)} />
            SEQ LOOP
          </label>
        </div>

        {/* 3. Transport row */}
        <div style={{ display:'flex', gap:'0.3rem', padding:'0.2rem 0.4rem', background:'#000022', flexWrap:'wrap', alignItems:'center', borderBottom:'2px solid #000' }}>
          <button className="btn" type="button" disabled={!sample.pcm} style={{ fontWeight:'bold' }}
            onClick={() => {
              if (!sample.pcm) return;
              if (playLooping && sample.loopEnd > sample.loopStart) {
                playPcmLooping(sample.pcm, sample.sampleRate, sample.loopStart, sample.loopEnd);
              } else {
                playPcmPreview(sample.pcm, sample.sampleRate, sel?.a, sel?.b);
              }
              startPlayheadAnim();
            }}>▶ PLAY</button>
          <button className="btn" type="button"
            onClick={() => setPlayLooping(v => !v)}
            style={{ color: playLooping ? '#00CCFF' : undefined, outline: playLooping ? '1px solid #00CCFF' : undefined }}>
            ↺ LOOP
          </button>
          <button className="btn" type="button" onClick={() => { stopPcmPreview(); stopPlayheadAnim(); }}>■ STOP</button>

          <div style={{ width:'1px', background:'#0055AA', alignSelf:'stretch', margin:'0 0.2rem' }} />

          <label style={{ display:'inline-flex', gap:'0.25rem', alignItems:'center', cursor:'pointer', fontFamily:'var(--font-mono)', fontSize:'0.72rem' }}
            title="Live Loop: when ON, loop restarts automatically after each marker drag">
            <input type="checkbox" checked={liveLoop} onChange={e => setLiveLoop(e.target.checked)} />
            <span style={{ color: liveLoop ? '#00FF88' : '#556688' }}>LIVE</span>
          </label>

          <div style={{ width:'1px', background:'#0055AA', alignSelf:'stretch', margin:'0 0.2rem' }} />

          <button className="btn" type="button" disabled={!pcmLen} onClick={zoomIn}>ZOOM+</button>
          <button className="btn" type="button" disabled={!pcmLen} onClick={showAll}>FIT</button>
          <button className="btn" type="button" disabled={!pcmLen} onClick={zoomOut}>ZOOM−</button>
          <button className="btn" type="button" disabled={!pcmLen} onClick={goToStart}>|◄</button>
          <button className="btn" type="button" disabled={!pcmLen} onClick={scrollLeft}>◄</button>
          <button className="btn" type="button" disabled={!pcmLen} onClick={scrollRight}>►</button>
          <button className="btn" type="button" disabled={!pcmLen} onClick={goToEnd}>►|</button>

          <div style={{ width:'1px', background:'#0055AA', alignSelf:'stretch', margin:'0 0.2rem' }} />

          {onOpenLibrary && <button className="btn" type="button" onClick={onOpenLibrary}>Library…</button>}
          <label className="btn" style={{ cursor:'pointer' }} title="Load WAV file">
            Load WAV…
            <input type="file" accept="audio/wav,audio/*" style={{ display:'none' }}
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
                  setInstrument(idx, { ...sample, pcm, sampleRate: audio.sampleRate, name: f.name.replace(/\.[^.]+$/, '').slice(0,20), loopStart: 0, loopEnd: pcm.length - 1 } as SampleInstrument);
                  setSelStart(null); setSelEnd(null); showAll();
                } finally { actx.close(); }
              }} />
          </label>
          <button className="btn" type="button" onClick={() => { stopPcmPreview(); setInstrument(idx, { ...sample, pcm: null, loopStart: 0, loopEnd: 0 } as SampleInstrument); setSelStart(null); setSelEnd(null); showAll(); }}>Clear</button>
        </div>

        {/* 4. Waveform canvas */}
        <canvas ref={canvasRef} style={{ width:'100%', height:canvasH, cursor:canvasCursor, display:'block', background:'#000', flexShrink:0 }}
          onMouseDown={onCanvasDown} onMouseMove={onCanvasMove} onMouseUp={onCanvasUp} onMouseLeave={onCanvasUp} />

        {/* 5. Loop info bar */}
        <div style={{ display:'flex', gap:'1rem', padding:'0.2rem 0.5rem', background:'#001133', fontFamily:'var(--font-mono)', fontSize:'0.72rem', color:'#AADDFF', flexWrap:'wrap', alignItems:'center', borderBottom:'2px solid #000' }}>
          <span><span style={{ color:'#00FF88' }}>●</span> IN: <b style={{ color:'#00FF88' }}>{smpToSecs(sample.loopStart)}</b> / {smpToBarBeat(sample.loopStart)}</span>
          <span><span style={{ color:'#FF8800' }}>●</span> OUT: <b style={{ color:'#FF8800' }}>{smpToSecs(sample.loopEnd)}</b> / {smpToBarBeat(sample.loopEnd)}</span>
          {sample.sampleRate > 0 && sample.loopEnd > sample.loopStart && (
            <span style={{ color:'#556688' }}>
              len: {((sample.loopEnd - sample.loopStart) / sample.sampleRate).toFixed(3)}s
              {bpmValid && beatSamplesVal > 0 && ` · ${((sample.loopEnd - sample.loopStart) / barSamplesVal).toFixed(2)} bars @ ${sampleBpm} BPM`}
            </span>
          )}
          <span style={{ marginLeft:'auto', color:'#334455' }}>{pcmLen.toLocaleString()} smp · {sample.pcm ? `${sample.sampleRate} Hz` : '—'}</span>
        </div>

        {/* 6. Three panels: TIMING | TUNE | SHAPE */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', background:'#000022' }}>

          {/* TIMING panel */}
          {(() => {
            const totalSt = bpmValid ? 12 * Math.log2(songBpm / sampleBpm) : 0;
            const fitTrans = bpmValid ? Math.trunc(totalSt) : 0;
            const fitFine  = bpmValid ? Math.round((totalSt - fitTrans) * 8) : 0;
            return (
              <div style={{ padding:'0.4rem 0.5rem', borderRight:'2px solid #000' }}>
                <div style={{ color:'#FF8800', fontSize:'0.72rem', letterSpacing:'0.08em', borderBottom:'1px solid rgba(255,136,0,0.3)', marginBottom:'0.4rem', paddingBottom:'0.15rem' }}>TIMING</div>
                <div className="field-row" style={{ marginBottom:'0.3rem' }}>
                  <label style={{ color:'#AADDFF' }}>BPM</label>
                  <button className="btn" type="button" style={{ padding:'0 0.3rem', minWidth:0 }}
                    onClick={() => { const v = parseFloat(sampleBpmStr); if (!isNaN(v)) setSampleBpmStr(String(Math.max(20, v - 1))); }}>−</button>
                  <input type="number" min={20} max={400} step={0.5} value={sampleBpmStr} placeholder="—"
                    onChange={e => setSampleBpmStr(e.target.value)}
                    style={{ width:'6ch', textAlign:'center' }} />
                  <button className="btn" type="button" style={{ padding:'0 0.3rem', minWidth:0 }}
                    onClick={() => { const v = parseFloat(sampleBpmStr); if (!isNaN(v)) setSampleBpmStr(String(Math.min(400, v + 1))); }}>+</button>
                  <button className="btn" type="button"
                    disabled={!sample.pcm || bpmDetecting}
                    onClick={() => { if (!sample.pcm) return; setBpmDetecting(true); setTimeout(() => { const r = detectBpm(sample.pcm!, sample.sampleRate); setSampleBpmStr(String(r)); setBpmDetecting(false); }, 0); }}
                    style={{ color:'#FFD700' }}>{bpmDetecting ? '…' : 'DETECT'}</button>
                </div>
                <div className="field-row" style={{ marginBottom:'0.3rem' }}>
                  <button className="btn" type="button" onClick={() => setSampleBpmStr(String(songBpm))}
                    style={{ color: sampleBpmStr === String(songBpm) ? '#FFD700' : undefined, fontSize:'0.72rem' }}>
                    USE SONG ({songBpm})
                  </button>
                  <label style={{ display:'inline-flex', gap:'0.25rem', alignItems:'center', cursor:'pointer', fontFamily:'var(--font-mono)', fontSize:'0.72rem', marginLeft:'0.4rem' }}>
                    <input type="checkbox" checked={beatGridOn} onChange={e => setBeatGridOn(e.target.checked)} />
                    <span style={{ color: beatGridOn ? '#FFD700' : '#556688' }}>GRID</span>
                  </label>
                </div>
                {bpmValid && barSamplesVal > 0 && (
                  <div style={{ display:'flex', gap:'0.25rem', flexWrap:'wrap', marginBottom:'0.3rem' }}>
                    <span style={{ color:'#FFD700', fontSize:'0.7rem', alignSelf:'center' }}>Snap:</span>
                    {([1,2,4,8] as const).map(n => {
                      const end = Math.round(sample.loopStart + n * barSamplesVal) - 1;
                      return (
                        <button key={n} className="btn" type="button"
                          disabled={!sample.pcm || end >= pcmLen}
                          onClick={() => setInstrument(idx, { ...sample, loopEnd: Math.min(pcmLen-1, end) } as SampleInstrument)}
                          style={{ color:'#FFD700', fontSize:'0.72rem', padding:'0 0.3rem' }}>
                          {n}bar
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="field-row">
                  <label style={{ color:'#AADDFF' }} title="Auto-stop sample after N rows (0 = play until note-off)">LEN ROWS</label>
                  <input type="number" min={0} max={512} value={sample.lengthRows}
                    onChange={e => setInstrument(idx, { ...sample, lengthRows: Math.max(0,Math.min(512,Number(e.target.value))) } as SampleInstrument)}
                    style={{ width:'4ch' }} />
                </div>
                {bpmValid && Math.abs(sampleBpm - songBpm) > 0.5 && (
                  <div style={{ marginTop:'0.3rem', display:'flex', gap:'0.3rem', alignItems:'center' }}>
                    <span style={{ color:'#6699BB', fontSize:'0.72rem', fontFamily:'var(--font-mono)' }}>
                      fit: {fitTrans > 0 ? '+' : ''}{fitTrans}st {fitFine > 0 ? '+' : ''}{fitFine}/8
                    </span>
                    <button className="btn" type="button" style={{ fontSize:'0.72rem', color:'#FFD700' }}
                      onClick={() => setInstrument(idx, { ...sample, transpose: fitTrans, finetune: fitFine } as SampleInstrument)}>
                      FIT PITCH
                    </button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* TUNE panel */}
          <div style={{ padding:'0.4rem 0.5rem', borderRight:'2px solid #000' }}>
            <div style={{ color:'#FF8800', fontSize:'0.72rem', letterSpacing:'0.08em', borderBottom:'1px solid rgba(255,136,0,0.3)', marginBottom:'0.4rem', paddingBottom:'0.15rem' }}>TUNE</div>
            <div className="field-row" style={{ marginBottom:'0.3rem' }}>
              <label style={{ color:'#AADDFF' }} title="Semitone transpose (-48..+48)">TRANS</label>
              <button className="btn" type="button" style={{ padding:'0 0.3rem', minWidth:0 }}
                onClick={() => setInstrument(idx, { ...sample, transpose: Math.max(-48, sample.transpose - 1) } as SampleInstrument)}>−</button>
              <input type="number" min={-48} max={48} value={sample.transpose}
                onChange={e => setInstrument(idx, { ...sample, transpose: Math.max(-48,Math.min(48,Number(e.target.value))) } as SampleInstrument)}
                style={{ width:'4ch', textAlign:'center' }} />
              <button className="btn" type="button" style={{ padding:'0 0.3rem', minWidth:0 }}
                onClick={() => setInstrument(idx, { ...sample, transpose: Math.min(48, sample.transpose + 1) } as SampleInstrument)}>+</button>
            </div>
            <div className="field-row" style={{ marginBottom:'0.3rem' }}>
              <label style={{ color:'#AADDFF' }} title="Fine-tune: -8..+7 (1/8 semitone steps)">FINE</label>
              <input type="number" min={-8} max={7} value={sample.finetune}
                onChange={e => setInstrument(idx, { ...sample, finetune: Math.max(-8,Math.min(7,Number(e.target.value))) } as SampleInstrument)}
                style={{ width:'3ch', textAlign:'center' }} />
            </div>
            <div className="field-row" style={{ marginBottom:'0.3rem' }}>
              <label style={{ color:'#AADDFF' }} title="Default entry pitch for F-key shortcut">DEF ♪</label>
              <input type="number" min={0} max={127} value={sample.defaultPitch}
                onChange={e => setInstrument(idx, { ...sample, defaultPitch: Math.max(0,Math.min(127,Number(e.target.value))) } as SampleInstrument)}
                style={{ width:'4ch' }} />
              <span style={{ color:'#556688', fontSize:'0.8em', margin:'0 0.2rem' }}>→</span>
              <span style={{ color:'#88BBFF', fontFamily:'var(--font-mono)', fontSize:'0.85em' }}
                title={`Plays at: base ${noteName(sample.baseNote)} + ${sample.transpose}st + ${sample.finetune}/8st`}>
                {noteName(Math.max(0,Math.min(127, sample.baseNote + sample.transpose)))}
              </span>
            </div>
            <div className="field-row" style={{ marginBottom:'0.4rem' }}>
              <button className="btn" type="button" disabled={!sample.pcm}
                onClick={() => { if (sample.pcm) playPcmAtPitch(sample.pcm, sample.sampleRate, sample.transpose, sample.finetune); }}
                style={{ fontFamily:'var(--font-mono)' }}>▶ TEST</button>
            </div>
            {/* BPM-based pitch targeting — shown when sample BPM is known */}
            {bpmValid && (() => {
              const targetBpm = parseFloat(targetBpmStr || String(songBpm));
              const tgtValid  = isFinite(targetBpm) && targetBpm > 20 && targetBpm < 400;
              const totalSt   = tgtValid ? 12 * Math.log2(targetBpm / sampleBpm) : 0;
              const fitTrans  = Math.trunc(totalSt);
              const fitFine   = Math.round((totalSt - fitTrans) * 8);
              const displayTgt = targetBpmStr || String(songBpm);
              return (
                <div style={{ borderTop:'1px solid #334', paddingTop:'0.35rem', marginTop:'0.2rem' }}>
                  <div style={{ color:'#FFD700', fontSize:'0.68rem', letterSpacing:'0.06em', marginBottom:'0.3rem', fontFamily:'var(--font-mono)' }}>
                    BPM TARGET
                  </div>
                  <div className="field-row" style={{ marginBottom:'0.25rem' }}>
                    <label style={{ color:'#AADDFF', fontSize:'0.7rem' }} title={`Pitch this ${sampleBpm} BPM sample to a target BPM`}>TO</label>
                    <button className="btn" type="button" style={{ padding:'0 0.3rem', minWidth:0 }}
                      onClick={() => {
                        const v = parseFloat(displayTgt);
                        if (!isNaN(v)) setTargetBpmStr(String(Math.max(20, Math.round((v - 1) * 10) / 10)));
                      }}>−</button>
                    <input type="number" min={20} max={400} step={0.5}
                      value={displayTgt}
                      onChange={e => setTargetBpmStr(e.target.value)}
                      style={{ width:'6ch', textAlign:'center' }} />
                    <button className="btn" type="button" style={{ padding:'0 0.3rem', minWidth:0 }}
                      onClick={() => {
                        const v = parseFloat(displayTgt);
                        if (!isNaN(v)) setTargetBpmStr(String(Math.min(400, Math.round((v + 1) * 10) / 10)));
                      }}>+</button>
                  </div>
                  {tgtValid && (
                    <div style={{ display:'flex', gap:'0.35rem', alignItems:'center', flexWrap:'wrap' }}>
                      <span style={{ fontFamily:'var(--font-mono)', fontSize:'0.7rem', color: Math.abs(totalSt) < 0.05 ? '#556688' : '#88BBFF' }}>
                        {fitTrans > 0 ? '+' : ''}{fitTrans}st {fitFine > 0 ? '+' : ''}{fitFine}/8
                      </span>
                      <button className="btn" type="button"
                        disabled={Math.abs(totalSt) < 0.05}
                        style={{ fontSize:'0.72rem', color:'#FFD700', padding:'0 0.4rem' }}
                        onClick={() => setInstrument(idx, { ...sample, transpose: fitTrans, finetune: fitFine } as SampleInstrument)}>
                        APPLY
                      </button>
                      <button className="btn" type="button"
                        style={{ fontSize:'0.7rem', color:'#556688', padding:'0 0.3rem' }}
                        title={`Reset to song BPM (${songBpm})`}
                        onClick={() => setTargetBpmStr(String(songBpm))}>
                        ={songBpm}
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}
            <div style={{ borderTop:'1px solid #223', paddingTop:'0.3rem', marginTop:'0.3rem' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', opacity:0.4 }} title="Planned: pitch shift without speed change (phase vocoder)">
                <span style={{ color:'#AADDFF', fontSize:'0.72rem', fontFamily:'var(--font-mono)' }}>PITCH ONLY</span>
                <span style={{ background:'#007733', color:'#88FF99', fontSize:'0.65rem', padding:'0 0.3rem' }}>future</span>
                <button className="btn" type="button" disabled style={{ fontSize:'0.72rem' }}>OFF</button>
              </div>
            </div>
          </div>

          {/* SHAPE (Envelope) panel */}
          <div style={{ padding:'0.4rem 0.5rem' }}>
            <div style={{ color:'#FF8800', fontSize:'0.72rem', letterSpacing:'0.08em', borderBottom:'1px solid rgba(255,136,0,0.3)', marginBottom:'0.4rem', paddingBottom:'0.15rem' }}>ENVELOPE</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:'0.25rem', marginBottom:'0.4rem' }}>
              {([
                { key:'attackMs',  label:'ATK', unit:'ms',  min:0, max:5000, step:1 },
                { key:'decayMs',   label:'DEC', unit:'ms',  min:0, max:5000, step:1 },
                { key:'sustain',   label:'SUS', unit:'0-1', min:0, max:1,    step:0.05 },
                { key:'releaseMs', label:'REL', unit:'ms',  min:0, max:5000, step:1 },
              ] as const).map(({ key, label, unit, min, max, step }) => (
                <div key={key} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:'2px' }}>
                  <span style={{ color:'#AADDFF', fontSize:'0.65rem', fontFamily:'var(--font-mono)' }}>{label}</span>
                  <input type="number" min={min} max={max} step={step}
                    value={(sample as unknown as Record<string, number>)[key]}
                    onChange={e => setInstrument(idx, { ...sample, [key]: Math.max(min,Math.min(max,Number(e.target.value))) } as SampleInstrument)}
                    style={{ width:'100%', textAlign:'center', fontFamily:'var(--font-mono)', fontSize:'0.75rem' }} />
                  <span style={{ color:'#334455', fontSize:'0.6rem' }}>{unit}</span>
                </div>
              ))}
            </div>
            <div style={{ borderTop:'1px solid #223', paddingTop:'0.3rem' }}>
              <label style={{ display:'inline-flex', gap:'0.3rem', alignItems:'center', cursor:'pointer', fontFamily:'var(--font-mono)', fontSize:'0.72rem' }}
                title="Ignore note-off — sample plays to its end regardless of note length (for percussion one-shots)">
                <input type="checkbox" checked={sample.suppressNoteOff}
                  onChange={e => setInstrument(idx, { ...sample, suppressNoteOff: e.target.checked } as SampleInstrument)} />
                <span style={{ color: sample.suppressNoteOff ? '#FF8800' : '#AADDFF' }}>SUP.OFF</span>
              </label>
              <div style={{ color:'#334455', fontSize:'0.65rem', fontFamily:'var(--font-mono)', marginTop:'0.25rem', lineHeight:1.3 }}>
                Enable for cymbals / one-shots: plays to end regardless of note length
              </div>
            </div>
          </div>
        </div>

        {/* 7. Advanced edit section (collapsible) */}
        <div style={{ borderTop:'2px solid #000', background:'#000011' }}>
          <button type="button"
            onClick={() => setShowAdvanced(v => !v)}
            style={{ width:'100%', padding:'0.2rem 0.5rem', background:'transparent', border:'none', color:'#445566', fontFamily:'var(--font-mono)', fontSize:'0.72rem', textAlign:'left', cursor:'pointer', letterSpacing:'0.05em' }}>
            {showAdvanced ? '▾' : '▸'} ADVANCED EDIT — cut / copy / paste / reverse / echo / vol / trim
          </button>
          {showAdvanced && (
            <div style={{ padding:'0.25rem 0.4rem', background:'#000022' }}>
              {/* Edit selection row */}
              <div style={{ display:'flex', gap:'0.3rem', flexWrap:'wrap', alignItems:'center', marginBottom:'0.25rem' }}>
                <span style={{ fontFamily:'var(--font-mono)', fontSize:'0.7rem', color:'#556688' }}>SEL</span>
                <button className="btn" type="button" disabled={!pcmLen} onClick={() => { setSelStart(0); setSelEnd(pcmLen-1); }}>All</button>
                <button className="btn" type="button" disabled={!sel} onClick={() => { setSelStart(null); setSelEnd(null); }}>Desel</button>
                <div style={{ width:'1px', background:'#0055AA', alignSelf:'stretch' }} />
                <button className="btn" type="button" disabled={!sel || !sample.pcm} onClick={opErase}>Erase</button>
                <button className="btn" type="button" disabled={!sel} onClick={opCopy}>Copy</button>
                <button className="btn" type="button" disabled={!sel} onClick={opCut}>Cut</button>
                <button className="btn" type="button" disabled={!hasClip} onClick={opPaste}>Paste</button>
                <button className="btn" type="button" disabled={!sel} onClick={opReverse}>Reverse</button>
                <div style={{ width:'1px', background:'#0055AA', alignSelf:'stretch' }} />
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
                <div style={{ display:'flex', gap:'0.4rem', flexWrap:'wrap' }}>
                  {advDialog === 'echo' && (
                    <div style={dialogStyle}>
                      <div style={dialogTitleStyle}>Echo</div>
                      <div style={dialogBodyStyle}>
                        <div className="field-row"><label>Echo Rate</label><input type="number" min={1} max={1000000} value={echoRate} onChange={e => setEchoRate(Math.max(1,Number(e.target.value)))} style={{ width:'7ch' }} /></div>
                        <div className="field-row"><label>Vol Decrease %</label><input type="number" min={0} max={100} value={echoVolDec} onChange={e => setEchoVolDec(Math.max(0,Math.min(100,Number(e.target.value))))} style={{ width:'5ch' }} /></div>
                        <div className="field-row"><label>Count</label><input type="number" min={1} max={32} value={echoCount} onChange={e => setEchoCount(Math.max(1,Math.min(32,Number(e.target.value))))} style={{ width:'4ch' }} /></div>
                        <div style={{ display:'flex', gap:'0.4rem' }}>
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
                        <div className="field-row"><label>Start %</label><input type="range" min={0} max={400} step={1} value={cvStart} onChange={e => setCvStart(Number(e.target.value))} style={{ flex:1 }} /><input type="number" min={0} max={400} value={cvStart} onChange={e => setCvStart(Math.max(0,Math.min(400,Number(e.target.value))))} style={{ width:'5ch' }} /></div>
                        <div className="field-row"><label>End %</label><input type="range" min={0} max={400} step={1} value={cvEnd} onChange={e => setCvEnd(Number(e.target.value))} style={{ flex:1 }} /><input type="number" min={0} max={400} value={cvEnd} onChange={e => setCvEnd(Math.max(0,Math.min(400,Number(e.target.value))))} style={{ width:'5ch' }} /></div>
                        <div style={{ display:'flex', gap:'0.3rem', flexWrap:'wrap' }}>
                          <button className="btn" type="button" disabled={!sample.pcm} onClick={() => opChangeVolume(cvStart, cvEnd)}>CHANGE VOL</button>
                          <button className="btn" type="button" disabled={!sample.pcm} onClick={() => { setCvStart(0); setCvEnd(100); opChangeVolume(0,100); }}>Fade In</button>
                          <button className="btn" type="button" disabled={!sample.pcm} onClick={() => { setCvStart(100); setCvEnd(0); opChangeVolume(100,0); }}>Fade Out</button>
                          <button className="btn" type="button" disabled={!sample.pcm} onClick={() => { setCvStart(50); setCvEnd(50); opChangeVolume(50,50); }}>Halve</button>
                          <button className="btn" type="button" disabled={!sample.pcm} onClick={() => { setCvStart(200); setCvEnd(200); opChangeVolume(200,200); }}>Double</button>
                        </div>
                        <div style={{ display:'flex', gap:'0.4rem', alignItems:'center' }}>
                          <label style={{ display:'flex', gap:'0.3rem', alignItems:'center', cursor:'pointer' }}><input type="checkbox" checked={dontClip} onChange={e => setDontClip(e.target.checked)} /><span style={{ fontFamily:'var(--font-mono)', fontSize:'0.75rem' }}>Don't Clip</span></label>
                          <button className="btn" type="button" style={{ marginLeft:'auto' }} onClick={() => setAdvDialog(null)}>Exit</button>
                        </div>
                      </div>
                    </div>
                  )}
                  {advDialog === 'expand' && (
                    <div style={dialogStyle}>
                      <div style={dialogTitleStyle}>Expand Buffer</div>
                      <div style={dialogBodyStyle}>
                        <div className="field-row"><label>Add (smp)</label><input type="number" min={1} max={1000000} value={expandN} onChange={e => setExpandN(Math.max(1,Number(e.target.value)))} style={{ width:'9ch' }} /></div>
                        <div style={{ display:'flex', gap:'0.4rem' }}>
                          <button className="btn" type="button" disabled={!sample.pcm} onClick={opExpand}>Add Silence</button>
                          <button className="btn" type="button" onClick={() => setAdvDialog(null)}>Exit</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {/* Range info */}
              {sel && (
                <div style={{ marginTop:'0.25rem', fontFamily:'var(--font-mono)', fontSize:'0.7rem', color:'#FF8800' }}>
                  Range: {sel.a}–{sel.b} ({(sel.b - sel.a + 1).toLocaleString()} smp)
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </>
  );
}
