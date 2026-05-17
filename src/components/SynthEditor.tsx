// SynthEditor: multi-waveform synth instrument editor.
//
//  ┌─────────────────────────────────────────────────────────────────┐
//  │ Waveform bank nav  [◀ 01/04 ▶] [+] [–]   presets: Saw Sqr … │
//  │ Canvas: 32-bar waveform display — click/drag to draw           │
//  │ Transformation: From[N] To[N] [Do Transform]                   │
//  │ Pitch program textarea  + waveSpeed input                      │
//  │ AHDSR + base note + volume + len rows                          │
//  └─────────────────────────────────────────────────────────────────┘

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  pitchProgToText,
  parsePitchProg,
  defaultWaveform,
  type SynthInstrument,
} from '../state/types';

const STEPS = 32;

type PresetName = 'saw' | 'square' | 'sine' | 'triangle' | 'noise';

function makePreset(name: PresetName): Float32Array {
  const w = new Float32Array(STEPS);
  for (let i = 0; i < STEPS; i++) {
    const t = i / STEPS;
    switch (name) {
      case 'saw':      w[i] = 1 - 2 * t; break;
      case 'square':   w[i] = t < 0.5 ? 1 : -1; break;
      case 'sine':     w[i] = Math.sin(2 * Math.PI * t); break;
      case 'triangle': w[i] = t < 0.5 ? -1 + 4 * t : 3 - 4 * t; break;
      case 'noise':    w[i] = Math.random() * 2 - 1; break;
    }
  }
  return w;
}

/** Linear-interpolate a waveform from `a` to `b` at fraction `t` (0..1). */
function lerpWaveform(a: Float32Array, b: Float32Array, t: number): Float32Array {
  const out = new Float32Array(STEPS);
  for (let i = 0; i < STEPS; i++) {
    out[i] = (a[i] ?? 0) * (1 - t) + (b[i] ?? 0) * t;
  }
  return out;
}

export function SynthEditor({ idx, inst }: { idx: number; inst: SynthInstrument }) {
  const setInstrument = useStore((s) => s.setInstrument);

  // Which waveform slot is being edited (0-based).
  const [waveIdx, setWaveIdx] = useState(0);
  // Waveform clipboard for Cut/Copy/Paste ops.
  const [waveClip, setWaveClip] = useState<Float32Array | null>(null);
  // Transformation endpoints.
  const [xformFrom, setXformFrom] = useState(0);
  const [xformTo, setXformTo]   = useState(1);
  // Pitch-program textarea local text (synced from inst on mount/slot change).
  const [progText, setProgText] = useState(() => pitchProgToText(inst.pitchProg));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing  = useRef(false);

  // Clamp waveIdx if the waveform bank shrinks.
  const clampedWaveIdx = Math.min(waveIdx, inst.waveforms.length - 1);

  // Volume program textarea local text.
  const [volProgText, setVolProgText] = useState(() => pitchProgToText(inst.volProg));

  // Keep progText in sync when waveIdx changes or inst loaded externally.
  const lastProgRef = useRef(inst.pitchProg);
  if (lastProgRef.current !== inst.pitchProg) {
    lastProgRef.current = inst.pitchProg;
    // Avoid calling setState during render — update after.
  }
  useEffect(() => {
    setProgText(pitchProgToText(inst.pitchProg));
  }, [inst.pitchProg]);

  useEffect(() => {
    setVolProgText(pitchProgToText(inst.volProg));
  }, [inst.volProg]);

  // Redraw canvas whenever the active waveform changes.
  const activeWave = inst.waveforms[clampedWaveIdx] ?? defaultWaveform();
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr  = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    canvas.width  = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Background
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, cssW, cssH);
    // Grid lines
    ctx.fillStyle = '#003F80';
    for (let i = 1; i < STEPS; i++) {
      const x = Math.floor((i / STEPS) * cssW);
      ctx.fillRect(x, 0, 1, cssH);
    }
    // Center line
    ctx.fillStyle = '#0055AA';
    ctx.fillRect(0, Math.floor(cssH / 2), cssW, 1);
    // Bars
    const stepW = cssW / STEPS;
    for (let i = 0; i < STEPS; i++) {
      const v   = activeWave[i] ?? 0;
      const y   = Math.floor((1 - (v + 1) / 2) * cssH);
      const mid = Math.floor(cssH / 2);
      ctx.fillStyle = '#FF8800';
      if (v >= 0) ctx.fillRect(i * stepW + 1, y,   Math.max(1, stepW - 2), mid - y);
      else        ctx.fillRect(i * stepW + 1, mid,  Math.max(1, stepW - 2), y - mid);
    }
  }, [activeWave]);

  // ── helpers ───────────────────────────────────────────────────────────────

  function updateWave(newWave: Float32Array) {
    const next = inst.waveforms.slice();
    next[clampedWaveIdx] = newWave;
    setInstrument(idx, { ...inst, waveforms: next });
  }

  function pickSample(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const i = Math.max(0, Math.min(STEPS - 1, Math.floor((x / rect.width) * STEPS)));
    const v = Math.max(-1, Math.min(1, 1 - (y / rect.height) * 2));
    const next = new Float32Array(activeWave);
    next[i] = v;
    updateWave(next);
  }

  function applyPreset(name: PresetName) {
    updateWave(makePreset(name));
  }

  // ── Waveform range operations ─────────────────────────────────────────────

  /** Copy the active waveform to the internal clipboard. */
  function copyWave() {
    setWaveClip(new Float32Array(activeWave));
  }

  /** Cut: copy to clipboard, then zero-fill the slot. */
  function cutWave() {
    setWaveClip(new Float32Array(activeWave));
    updateWave(new Float32Array(STEPS));
  }

  /** Paste: replace the active slot with clipboard contents. */
  function pasteWave() {
    if (!waveClip) return;
    updateWave(new Float32Array(waveClip));
  }

  /** Clear: zero-fill the active waveform slot. */
  function clearWave() {
    updateWave(new Float32Array(STEPS));
  }

  /** Double: insert a duplicate of the active slot immediately after it. */
  function doubleWave() {
    const next = inst.waveforms.slice();
    next.splice(clampedWaveIdx + 1, 0, new Float32Array(activeWave));
    setInstrument(idx, { ...inst, waveforms: next });
    setWaveIdx(clampedWaveIdx + 1);
  }

  /** Reverse: flip the sample order of the active waveform. */
  function reverseWave() {
    updateWave(new Float32Array(activeWave).reverse());
  }

  function addWaveform() {
    const next = [...inst.waveforms, defaultWaveform()];
    setInstrument(idx, { ...inst, waveforms: next });
    setWaveIdx(next.length - 1);
  }

  function removeWaveform() {
    if (inst.waveforms.length <= 1) return; // must keep at least one
    const next = inst.waveforms.filter((_, i) => i !== clampedWaveIdx);
    setInstrument(idx, { ...inst, waveforms: next });
    setWaveIdx(Math.max(0, clampedWaveIdx - 1));
  }

  /**
   * Do Transformation: fill waveform slots [xformFrom+1 .. xformTo-1] with
   * linearly-interpolated waveforms between waveforms[xformFrom] and
   * waveforms[xformTo].
   */
  function doTransform() {
    const from = Math.max(0, Math.min(inst.waveforms.length - 1, xformFrom));
    const to   = Math.max(0, Math.min(inst.waveforms.length - 1, xformTo));
    if (from >= to) return;
    const steps = to - from;
    const wA = inst.waveforms[from] ?? defaultWaveform();
    const wB = inst.waveforms[to]   ?? defaultWaveform();
    const next = inst.waveforms.slice();
    for (let s = 1; s < steps; s++) {
      next[from + s] = lerpWaveform(wA, wB, s / steps);
    }
    setInstrument(idx, { ...inst, waveforms: next });
  }

  function commitProgText(text: string) {
    const parsed = parsePitchProg(text);
    setInstrument(idx, { ...inst, pitchProg: parsed });
    setProgText(pitchProgToText(parsed));
  }

  function commitVolProgText(text: string) {
    const parsed = parsePitchProg(text);
    setInstrument(idx, { ...inst, volProg: parsed });
    setVolProgText(pitchProgToText(parsed));
  }

  // ── render ────────────────────────────────────────────────────────────────

  const numWaves = inst.waveforms.length;

  return (
    <div className="panel col">
      <div className="panel__title">Slot {String(idx).padStart(2, '0')} — Synth</div>

      {/* Name */}
      <div className="field-row">
        <label>NAME</label>
        <input
          type="text"
          value={inst.name}
          onChange={(e) => setInstrument(idx, { ...inst, name: e.target.value })}
        />
      </div>

      <div className="hr" />

      {/* Waveform bank navigation */}
      <div className="row" style={{ alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>WAVE</span>
        <button
          className="btn"
          type="button"
          disabled={clampedWaveIdx === 0}
          onClick={() => setWaveIdx(clampedWaveIdx - 1)}
        >◀</button>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', minWidth: '4ch', textAlign: 'center' }}>
          {String(clampedWaveIdx + 1).padStart(2, '0')}/{String(numWaves).padStart(2, '0')}
        </span>
        <button
          className="btn"
          type="button"
          disabled={clampedWaveIdx >= numWaves - 1}
          onClick={() => setWaveIdx(clampedWaveIdx + 1)}
        >▶</button>
        <button className="btn" type="button" title="Add waveform slot" onClick={addWaveform}>+</button>
        <button className="btn" type="button" title="Remove this waveform slot" onClick={removeWaveform} disabled={numWaves <= 1}>−</button>
      </div>

      {/* Waveform canvas */}
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 120, cursor: 'crosshair', display: 'block' }}
        onPointerDown={(e) => {
          drawing.current = true;
          pickSample(e);
          (e.target as Element).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => { if (drawing.current) pickSample(e); }}
        onPointerUp={() => { drawing.current = false; }}
        onPointerLeave={() => { drawing.current = false; }}
      />

      {/* Presets */}
      <div className="row" style={{ flexWrap: 'wrap', gap: '0.3rem' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', alignSelf: 'center' }}>PRESET:</span>
        {(['saw', 'square', 'sine', 'triangle', 'noise'] as PresetName[]).map((p) => (
          <button key={p} className="btn" type="button" onClick={() => applyPreset(p)}>
            {p === 'saw' ? 'Saw' : p === 'square' ? 'Sqr' : p === 'sine' ? 'Sin' : p === 'triangle' ? 'Tri' : 'Nse'}
          </button>
        ))}
      </div>

      {/* Waveform range operations */}
      <div className="row" style={{ flexWrap: 'wrap', gap: '0.3rem' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', alignSelf: 'center' }}>WAVE:</span>
        <button className="btn" type="button" title="Cut: copy waveform to clipboard and zero-fill" onClick={cutWave}>Cut</button>
        <button className="btn" type="button" title="Copy waveform to clipboard" onClick={copyWave}>Copy</button>
        <button className="btn" type="button" title="Paste waveform from clipboard" onClick={pasteWave} disabled={!waveClip}>Paste</button>
        <button className="btn" type="button" title="Clear: zero-fill this waveform slot" onClick={clearWave}>Clear</button>
        <button className="btn" type="button" title="Double: insert a duplicate of this slot after it" onClick={doubleWave}>Double</button>
        <button className="btn" type="button" title="Reverse sample order of this waveform" onClick={reverseWave}>Reverse</button>
      </div>

      <div className="hr" />

      {/* Transformation */}
      <div className="row" style={{ alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
        <span>XFORM</span>
        <label>From</label>
        <input
          type="number" min={0} max={numWaves - 1}
          value={xformFrom}
          style={{ width: '4ch' }}
          onChange={(e) => setXformFrom(Math.max(0, Math.min(numWaves - 1, Number(e.target.value))))}
        />
        <label>To</label>
        <input
          type="number" min={0} max={numWaves - 1}
          value={xformTo}
          style={{ width: '4ch' }}
          onChange={(e) => setXformTo(Math.max(0, Math.min(numWaves - 1, Number(e.target.value))))}
        />
        <button className="btn" type="button" onClick={doTransform} title="Linear-interpolate in-between waveform slots">
          Do Transform
        </button>
      </div>

      <div className="hr" />

      {/* Volume program */}
      <div className="field-row" style={{ alignItems: 'flex-start' }}>
        <label style={{ paddingTop: '0.25rem' }}>VOL PROG</label>
        <textarea
          rows={5}
          style={{
            flex: 1,
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            background: '#000',
            color: '#00FF88',
            border: '2px inset #555',
            resize: 'vertical',
            padding: '0.2rem',
          }}
          value={volProgText}
          onChange={(e) => setVolProgText(e.target.value)}
          onBlur={(e) => commitVolProgText(e.target.value)}
          placeholder={'10\nCHU 03\nWAI 20\nCHD 03\nHLT\n; hex: 00=silent, 40=full'}
          spellCheck={false}
        />
      </div>

      {/* Pitch program */}
      <div className="field-row" style={{ alignItems: 'flex-start' }}>
        <label style={{ paddingTop: '0.25rem' }}>PITCH PROG</label>
        <textarea
          rows={6}
          style={{
            flex: 1,
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            background: '#000',
            color: '#FF8800',
            border: '2px inset #555',
            resize: 'vertical',
            padding: '0.2rem',
          }}
          value={progText}
          onChange={(e) => setProgText(e.target.value)}
          onBlur={(e) => commitProgText(e.target.value)}
          placeholder={'00\nJMP 00\n; wave idx then JMP to loop'}
          spellCheck={false}
        />
      </div>
      <div className="field-row">
        <label>WAVE SPD</label>
        <input
          type="number" min={1} max={255}
          value={inst.waveSpeed}
          onChange={(e) => setInstrument(idx, { ...inst, waveSpeed: Math.max(1, Math.min(255, Number(e.target.value))) })}
          title="Waveform cycles between each pitch-program step advance"
        />
      </div>

      <div className="hr" />

      {/* AHDSR envelope */}
      <div className="field-row">
        <label>ATTACK MS</label>
        <input
          type="number" min={0} max={5000}
          value={inst.attackMs}
          onChange={(e) => setInstrument(idx, { ...inst, attackMs: Math.max(0, Math.min(5000, Number(e.target.value))) })}
        />
      </div>
      <div className="field-row">
        <label>DECAY MS</label>
        <input
          type="number" min={0} max={5000}
          value={inst.decayMs}
          onChange={(e) => setInstrument(idx, { ...inst, decayMs: Math.max(0, Math.min(5000, Number(e.target.value))) })}
        />
      </div>
      <div className="field-row">
        <label>SUSTAIN</label>
        <input
          type="number" min={0} max={1} step={0.05}
          value={inst.sustain}
          onChange={(e) => setInstrument(idx, { ...inst, sustain: Math.max(0, Math.min(1, Number(e.target.value))) })}
        />
      </div>
      <div className="field-row">
        <label>RELEASE MS</label>
        <input
          type="number" min={0} max={5000}
          value={inst.releaseMs}
          onChange={(e) => setInstrument(idx, { ...inst, releaseMs: Math.max(0, Math.min(5000, Number(e.target.value))) })}
        />
      </div>

      <div className="hr" />

      <div className="field-row">
        <label>BASE NOTE</label>
        <input
          type="number" min={0} max={127}
          value={inst.baseNote}
          onChange={(e) => setInstrument(idx, { ...inst, baseNote: Math.max(0, Math.min(127, Number(e.target.value))) })}
        />
      </div>
      <div className="field-row">
        <label>VOL</label>
        <input
          type="number" min={0} max={127}
          value={inst.volume}
          onChange={(e) => setInstrument(idx, { ...inst, volume: Math.max(0, Math.min(127, Number(e.target.value))) })}
        />
      </div>
      <div className="field-row">
        <label>LEN ROWS</label>
        <input
          type="number" min={1} max={64}
          value={inst.lengthRows}
          onChange={(e) => setInstrument(idx, { ...inst, lengthRows: Math.max(1, Math.min(64, Number(e.target.value))) })}
        />
      </div>

      <div className="hr" />

      <div className="field-row">
        <label>TRANSPOSE</label>
        <input
          type="number" min={-48} max={48}
          value={inst.transpose}
          onChange={(e) => setInstrument(idx, { ...inst, transpose: Math.max(-48, Math.min(48, Number(e.target.value))) })}
          style={{ width: '6ch' }}
          title="Semitone transpose offset (-48..+48)"
        />
      </div>
      <div className="field-row">
        <label>FINETUNE</label>
        <input
          type="number" min={-8} max={7}
          value={inst.finetune}
          onChange={(e) => setInstrument(idx, { ...inst, finetune: Math.max(-8, Math.min(7, Number(e.target.value))) })}
          style={{ width: '5ch' }}
          title="Finetune in 1/8-semitone units (-8..+7)"
        />
      </div>
      <div className="field-row">
        <label>DEF PITCH</label>
        <input
          type="number" min={0} max={127}
          value={inst.defaultPitch}
          onChange={(e) => setInstrument(idx, { ...inst, defaultPitch: Math.max(0, Math.min(127, Number(e.target.value))) })}
          style={{ width: '5ch' }}
          title="Default entry pitch for F-key shortcut"
        />
      </div>
      <div className="field-row">
        <label>SUPPRESS OFF</label>
        <input
          type="checkbox" checked={inst.suppressNoteOff}
          onChange={(e) => setInstrument(idx, { ...inst, suppressNoteOff: e.target.checked })}
          title="When on, ignore note-off events (for one-shot/percussive sounds)"
        />
        <span style={{ fontSize: '0.7rem' }} className="upper muted">ignore note-off</span>
      </div>
    </div>
  );
}

/**
 * SynthEditorMdi — MDI wrapper: reads selectedInstrument from the store and
 * renders SynthEditor when the selection is a synth instrument, or shows a
 * placeholder otherwise.
 */
export function SynthEditorMdi() {
  const idx  = useStore((s) => s.selectedInstrument);
  const inst = useStore((s) => s.instruments[idx]);

  if (!inst || inst.kind !== 'synth') {
    return (
      <div style={{
        padding: '1.2rem',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.8rem',
        color: '#556688',
        background: '#000022',
        minHeight: 80,
      }}>
        No synth instrument selected.
        <br />
        <span style={{ color: '#AADDFF' }}>
          Select a Synth slot in the instrument list, then re-open this window.
        </span>
      </div>
    );
  }

  return <SynthEditor idx={idx} inst={inst as SynthInstrument} />;
}
