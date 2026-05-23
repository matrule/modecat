/**
 * InstParamsDialog — Instrument Parameters floating window.
 *
 * Opened by double-clicking an instrument slot in InstrumentList.
 * Matches ModeCat V5 "Instrument Parameters" window behaviour:
 *   - Type selector at top (Empty / Sample / MIDI / Synth)
 *   - Name field
 *   - Common fields: Transpose, Finetune, Default Pitch, Suppress NoteOff,
 *     Length (rows)
 *   - Type-specific section below
 *
 * Changes are applied immediately (live preview while open).
 * Close: OK button, Escape key, or clicking the backdrop.
 */

import { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import {
  defaultWaveform,
  type Instrument,
  type SampleInstrument,
  type MidiInstrument,
  type SynthInstrument,
  type HybridInstrument,
} from '../state/types';

// ── Note name helper ──────────────────────────────────────────────────────────

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function noteName(n: number): string {
  return NOTE_NAMES[n % 12]! + Math.floor(n / 12 - 1);
}

// ── MIDI channel / program label helpers ─────────────────────────────────────

const GM_PROGRAMS: Record<number, string> = {
  0:'Acoustic Grand Piano', 4:'Electric Piano 1', 24:'Acoustic Guitar (nylon)',
  25:'Acoustic Guitar (steel)', 30:'Distortion Guitar', 32:'Acoustic Bass',
  33:'Electric Bass (finger)', 38:'Synth Bass 1', 40:'Violin', 48:'String Ensemble 1',
  56:'Trumpet', 57:'Trombone', 60:'French Horn', 61:'Brass Section',
  71:'Clarinet', 73:'Flute', 80:'Square Lead', 81:'Saw Lead',
  88:'New Age Pad', 98:'FX 3 (crystal)', 112:'Tinkle Bell', 114:'Steel Drums',
  118:'Synth Drum', 119:'Reverse Cymbal',
};

// ── Defaults when switching type ──────────────────────────────────────────────

function defaultMidi(idx: number, name: string): MidiInstrument {
  return {
    kind: 'midi', name,
    channel: 0, program: -1, velocity: 100, lengthRows: 4,
    transpose: 0, finetune: 0, defaultPitch: 60, suppressNoteOff: false,
  };
}

function defaultSample(name: string): SampleInstrument {
  return {
    kind: 'sample', name,
    pcm: null, sampleRate: 44100, baseNote: 60,
    loopEnabled: false, loopStart: 0, loopEnd: 0, volume: 100,
    transpose: 0, finetune: 0, defaultPitch: 60, suppressNoteOff: false,
    attackMs: 5, decayMs: 0, sustain: 1, releaseMs: 110, lengthRows: 0,
  };
}

function defaultSynth(name: string): SynthInstrument {
  return {
    kind: 'synth', name,
    waveforms: [defaultWaveform()], pitchProg: [], waveSpeed: 1, volProg: [],
    attackMs: 5, decayMs: 120, sustain: 0.7, releaseMs: 90,
    volume: 100, baseNote: 60, lengthRows: 4,
    transpose: 0, finetune: 0, defaultPitch: 60, suppressNoteOff: false,
  };
}

function defaultHybrid(name: string): HybridInstrument {
  return {
    kind: 'hybrid', name,
    pcm: null, sampleRate: 44100, baseNote: 60,
    loopEnabled: false, loopStart: 0, loopEnd: 0,
    volume: 100, transpose: 0, finetune: 0, defaultPitch: 60, suppressNoteOff: false,
    pitchProg: [], volProg: [],
    attackMs: 5, decayMs: 120, sustain: 0.7, releaseMs: 90,
    lengthRows: 4, waveSpeed: 1,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  instIdx: number;
  onClose: () => void;
}

export function InstParamsDialog({ instIdx, onClose }: Props) {
  const inst = useStore((s) => s.instruments[instIdx]);
  const setInstrument = useStore((s) => s.setInstrument);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!inst) return null;

  // ── Type change ─────────────────────────────────────────────────────────────

  function changeType(newKind: Instrument['kind']) {
    if (!inst || newKind === inst.kind) return;
    const name = inst.name === '--' ? `INST ${String(instIdx).padStart(2,'0')}` : inst.name;
    if (newKind === 'empty') {
      setInstrument(instIdx, { kind: 'empty', name: '--' });
    } else if (newKind === 'midi') {
      setInstrument(instIdx, defaultMidi(instIdx, name));
    } else if (newKind === 'sample') {
      // SMP ← HYB: carry over PCM + shared sample fields, drop synth-only fields.
      if (inst.kind === 'hybrid') {
        const h = inst as HybridInstrument;
        setInstrument(instIdx, {
          ...defaultSample(name),
          pcm: h.pcm, sampleRate: h.sampleRate, baseNote: h.baseNote,
          loopEnabled: h.loopEnabled, loopStart: h.loopStart, loopEnd: h.loopEnd,
          volume: h.volume, transpose: h.transpose, finetune: h.finetune,
          defaultPitch: h.defaultPitch, suppressNoteOff: h.suppressNoteOff,
          attackMs: h.attackMs, decayMs: h.decayMs, sustain: h.sustain, releaseMs: h.releaseMs,
        });
      } else {
        setInstrument(instIdx, defaultSample(name));
      }
    } else if (newKind === 'synth') {
      setInstrument(instIdx, defaultSynth(name));
    } else if (newKind === 'hybrid') {
      // HYB ← SMP: carry over PCM + shared sample fields, add synth defaults.
      if (inst.kind === 'sample') {
        const s = inst as SampleInstrument;
        setInstrument(instIdx, {
          ...defaultHybrid(name),
          pcm: s.pcm, sampleRate: s.sampleRate, baseNote: s.baseNote,
          loopEnabled: s.loopEnabled, loopStart: s.loopStart, loopEnd: s.loopEnd,
          volume: s.volume, transpose: s.transpose, finetune: s.finetune,
          defaultPitch: s.defaultPitch, suppressNoteOff: s.suppressNoteOff,
          attackMs: s.attackMs, decayMs: s.decayMs, sustain: s.sustain, releaseMs: s.releaseMs,
        });
      } else {
        setInstrument(instIdx, defaultHybrid(name));
      }
    }
  }

  // ── Field helpers ───────────────────────────────────────────────────────────

  function patch(delta: Partial<Instrument>) {
    if (!inst) return;
    setInstrument(instIdx, { ...inst, ...delta } as Instrument);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="ip-backdrop" onMouseDown={onClose}>
      <div className="ip-dialog" onMouseDown={(e) => e.stopPropagation()}>

        {/* Title bar */}
        <div className="ip-titlebar">
          <span>Instrument Parameters — {String(instIdx).padStart(2,'0')}</span>
          <button className="ip-close" type="button" onClick={onClose}>✕</button>
        </div>

        <div className="ip-body">

          {/* Type selector */}
          <div className="ip-row">
            <label className="ip-label">Type</label>
            <div className="ip-type-btns">
              {(['empty','sample','midi','synth','hybrid'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`btn ip-type-btn${inst.kind === k ? ' is-active' : ''}`}
                  onClick={() => changeType(k)}
                >
                  {k === 'empty' ? '—' : k.charAt(0).toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div className="ip-row">
            <label className="ip-label">Name</label>
            <input
              className="ip-input ip-input--wide"
              type="text"
              maxLength={24}
              value={inst.name}
              disabled={inst.kind === 'empty'}
              onChange={(e) => patch({ name: e.target.value } as Partial<Instrument>)}
            />
          </div>

          {inst.kind !== 'empty' && (
            <>
              {/* Common fields */}
              <div className="ip-section-title">Common</div>

              <div className="ip-row">
                <label className="ip-label">Transpose</label>
                <input
                  className="ip-input ip-input--sm"
                  type="number" min={-36} max={36}
                  value={inst.transpose}
                  onChange={(e) => patch({ transpose: Number(e.target.value) } as Partial<Instrument>)}
                />
                <span className="ip-unit">semitones</span>
              </div>

              <div className="ip-row">
                <label className="ip-label">Finetune</label>
                <input
                  className="ip-input ip-input--sm"
                  type="number" min={-8} max={7}
                  value={inst.finetune}
                  onChange={(e) => patch({ finetune: Number(e.target.value) } as Partial<Instrument>)}
                />
                <span className="ip-unit">−8..+7</span>
              </div>

              <div className="ip-row">
                <label className="ip-label">Default Pitch</label>
                <input
                  className="ip-input ip-input--sm"
                  type="number" min={0} max={127}
                  value={inst.defaultPitch}
                  onChange={(e) => patch({ defaultPitch: Number(e.target.value) } as Partial<Instrument>)}
                />
                <span className="ip-unit">{noteName(inst.defaultPitch)}</span>
              </div>

              <div className="ip-row">
                <label className="ip-label">Suppress NoteOff</label>
                <input
                  type="checkbox"
                  checked={inst.suppressNoteOff}
                  onChange={(e) => patch({ suppressNoteOff: e.target.checked } as Partial<Instrument>)}
                />
                <span className="ip-unit">one-shot / percussion</span>
              </div>

              {/* Type-specific sections */}
              {inst.kind === 'midi' && <MidiSection inst={inst} patch={patch} />}
              {inst.kind === 'sample' && <SampleSection inst={inst} patch={patch} />}
              {inst.kind === 'synth' && <SynthSection inst={inst} patch={patch} />}
              {inst.kind === 'hybrid' && <HybridSection inst={inst} patch={patch} />}
            </>
          )}
        </div>

        <div className="ip-footer">
          <button className="btn" type="button" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ── MIDI section ──────────────────────────────────────────────────────────────

function MidiSection({ inst, patch }: { inst: MidiInstrument; patch: (d: Partial<Instrument>) => void }) {
  const gmName = inst.program >= 0 ? GM_PROGRAMS[inst.program] ?? '' : '';
  return (
    <>
      <div className="ip-section-title">MIDI</div>

      <div className="ip-row">
        <label className="ip-label">Channel</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={1} max={16}
          value={inst.channel + 1}
          onChange={(e) => patch({ channel: Math.max(0, Math.min(15, Number(e.target.value) - 1)) })}
        />
        <span className="ip-unit">{inst.channel === 9 ? 'Drums (GM 10)' : `CH ${inst.channel + 1}`}</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Program</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={-1} max={127}
          value={inst.program}
          onChange={(e) => patch({ program: Math.max(-1, Math.min(127, Number(e.target.value))) })}
        />
        <span className="ip-unit">{inst.program < 0 ? 'no change' : gmName || `PC ${inst.program + 1}`}</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Velocity</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={1} max={127}
          value={inst.velocity}
          onChange={(e) => patch({ velocity: Math.max(1, Math.min(127, Number(e.target.value))) })}
        />
      </div>

      <div className="ip-row">
        <label className="ip-label">Note Length</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={1} max={64}
          value={inst.lengthRows}
          onChange={(e) => patch({ lengthRows: Math.max(1, Number(e.target.value)) })}
        />
        <span className="ip-unit">rows</span>
      </div>
    </>
  );
}

// ── Sample section ────────────────────────────────────────────────────────────

function SampleSection({ inst, patch }: { inst: SampleInstrument; patch: (d: Partial<Instrument>) => void }) {
  const hasPcm = inst.pcm !== null && inst.pcm.length > 0;
  return (
    <>
      <div className="ip-section-title">Sample</div>

      <div className="ip-row">
        <label className="ip-label">PCM</label>
        <span className="ip-unit" style={{ color: hasPcm ? 'var(--wb-orange)' : 'rgba(255,255,255,0.4)' }}>
          {hasPcm ? `${inst.pcm!.length} samples @ ${inst.sampleRate} Hz` : 'no sample loaded'}
        </span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Base Note</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={0} max={127}
          value={inst.baseNote}
          onChange={(e) => patch({ baseNote: Number(e.target.value) })}
        />
        <span className="ip-unit">{noteName(inst.baseNote)}</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Volume</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={0} max={127}
          value={inst.volume}
          onChange={(e) => patch({ volume: Number(e.target.value) })}
        />
        <span className="ip-unit">0–127</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Loop On</label>
        <input
          type="checkbox"
          checked={inst.loopEnabled}
          onChange={(e) => patch({ loopEnabled: e.target.checked })}
        />
        <span className="ip-unit">loop between Start and End</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Loop Start</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={0}
          value={inst.loopStart}
          disabled={!inst.loopEnabled}
          onChange={(e) => patch({ loopStart: Math.max(0, Number(e.target.value)) })}
        />
        <span className="ip-unit">samples</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Loop End</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={0}
          value={inst.loopEnd}
          disabled={!inst.loopEnabled}
          onChange={(e) => patch({ loopEnd: Math.max(0, Number(e.target.value)) })}
        />
        <span className="ip-unit">0 = end of sample</span>
      </div>

      <div className="ip-section-title" style={{ marginTop: '0.5rem' }}>Envelope</div>

      <div className="ip-row">
        <label className="ip-label">Note Length</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={0} max={256}
          value={inst.lengthRows ?? 0}
          onChange={(e) => patch({ lengthRows: Math.max(0, Number(e.target.value)) })}
        />
        <span className="ip-unit">rows (0 = play to end)</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Attack</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={0} max={2000}
          value={inst.attackMs ?? 0}
          onChange={(e) => patch({ attackMs: Math.max(0, Number(e.target.value)) })}
        />
        <span className="ip-unit">ms</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Decay</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={0} max={2000}
          value={inst.decayMs ?? 0}
          onChange={(e) => patch({ decayMs: Math.max(0, Number(e.target.value)) })}
        />
        <span className="ip-unit">ms</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Sustain</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={0} max={127}
          value={Math.round((inst.sustain ?? 1) * 127)}
          onChange={(e) => patch({ sustain: Math.max(0, Math.min(127, Number(e.target.value))) / 127 })}
        />
        <span className="ip-unit">0–127</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Release</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={0} max={4000}
          value={inst.releaseMs ?? 0}
          onChange={(e) => patch({ releaseMs: Math.max(0, Number(e.target.value)) })}
        />
        <span className="ip-unit">ms</span>
      </div>
    </>
  );
}

// ── Hybrid section ────────────────────────────────────────────────────────────

function HybridSection({ inst, patch }: { inst: HybridInstrument; patch: (d: Partial<Instrument>) => void }) {
  const hasPcm = inst.pcm !== null && inst.pcm.length > 0;
  return (
    <>
      <div className="ip-section-title">Sample (Hybrid)</div>

      <div className="ip-row">
        <label className="ip-label">PCM</label>
        <span className="ip-unit" style={{ color: hasPcm ? 'var(--wb-orange)' : 'rgba(255,255,255,0.4)' }}>
          {hasPcm ? `${inst.pcm!.length} samples @ ${inst.sampleRate} Hz` : 'no sample loaded'}
        </span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Base Note</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={0} max={127}
          value={inst.baseNote}
          onChange={(e) => patch({ baseNote: Number(e.target.value) })}
        />
        <span className="ip-unit">{noteName(inst.baseNote)}</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Volume</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={0} max={127}
          value={inst.volume}
          onChange={(e) => patch({ volume: Number(e.target.value) })}
        />
        <span className="ip-unit">0–127</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Loop On</label>
        <input
          type="checkbox"
          checked={inst.loopEnabled}
          onChange={(e) => patch({ loopEnabled: e.target.checked })}
        />
        <span className="ip-unit">loop between Start and End</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Loop Start</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={0}
          value={inst.loopStart}
          disabled={!inst.loopEnabled}
          onChange={(e) => patch({ loopStart: Math.max(0, Number(e.target.value)) })}
        />
        <span className="ip-unit">samples</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Loop End</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={0}
          value={inst.loopEnd}
          disabled={!inst.loopEnabled}
          onChange={(e) => patch({ loopEnd: Math.max(0, Number(e.target.value)) })}
        />
        <span className="ip-unit">0 = end of sample</span>
      </div>

      <div className="ip-section-title">Envelope (Hybrid)</div>

      <div className="ip-row">
        <label className="ip-label">Note Length</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={1} max={64}
          value={inst.lengthRows}
          onChange={(e) => patch({ lengthRows: Math.max(1, Number(e.target.value)) })}
        />
        <span className="ip-unit">rows</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Attack</label>
        <input className="ip-input ip-input--sm" type="number" min={0} max={5000}
          value={inst.attackMs}
          onChange={(e) => patch({ attackMs: Number(e.target.value) })} />
        <span className="ip-unit">ms</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Decay</label>
        <input className="ip-input ip-input--sm" type="number" min={0} max={5000}
          value={inst.decayMs}
          onChange={(e) => patch({ decayMs: Number(e.target.value) })} />
        <span className="ip-unit">ms</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Sustain</label>
        <input className="ip-input ip-input--sm" type="number" min={0} max={1} step={0.05}
          value={inst.sustain}
          onChange={(e) => patch({ sustain: Number(e.target.value) })} />
        <span className="ip-unit">0–1</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Release</label>
        <input className="ip-input ip-input--sm" type="number" min={0} max={5000}
          value={inst.releaseMs}
          onChange={(e) => patch({ releaseMs: Number(e.target.value) })} />
        <span className="ip-unit">ms</span>
      </div>
    </>
  );
}

// ── Synth section ─────────────────────────────────────────────────────────────

function SynthSection({ inst, patch }: { inst: SynthInstrument; patch: (d: Partial<Instrument>) => void }) {
  return (
    <>
      <div className="ip-section-title">Synth</div>

      <div className="ip-row">
        <label className="ip-label">Waveforms</label>
        <span className="ip-unit">{inst.waveforms.length} slot{inst.waveforms.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Base Note</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={0} max={127}
          value={inst.baseNote}
          onChange={(e) => patch({ baseNote: Number(e.target.value) })}
        />
        <span className="ip-unit">{noteName(inst.baseNote)}</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Volume</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={0} max={127}
          value={inst.volume}
          onChange={(e) => patch({ volume: Number(e.target.value) })}
        />
      </div>

      <div className="ip-row">
        <label className="ip-label">Note Length</label>
        <input
          className="ip-input ip-input--sm"
          type="number" min={1} max={64}
          value={inst.lengthRows}
          onChange={(e) => patch({ lengthRows: Math.max(1, Number(e.target.value)) })}
        />
        <span className="ip-unit">rows</span>
      </div>

      <div className="ip-section-title">AHDSR (fallback)</div>

      <div className="ip-row">
        <label className="ip-label">Attack</label>
        <input className="ip-input ip-input--sm" type="number" min={0} max={5000}
          value={inst.attackMs}
          onChange={(e) => patch({ attackMs: Number(e.target.value) })} />
        <span className="ip-unit">ms</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Decay</label>
        <input className="ip-input ip-input--sm" type="number" min={0} max={5000}
          value={inst.decayMs}
          onChange={(e) => patch({ decayMs: Number(e.target.value) })} />
        <span className="ip-unit">ms</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Sustain</label>
        <input className="ip-input ip-input--sm" type="number" min={0} max={1} step={0.05}
          value={inst.sustain}
          onChange={(e) => patch({ sustain: Number(e.target.value) })} />
        <span className="ip-unit">0–1</span>
      </div>

      <div className="ip-row">
        <label className="ip-label">Release</label>
        <input className="ip-input ip-input--sm" type="number" min={0} max={5000}
          value={inst.releaseMs}
          onChange={(e) => patch({ releaseMs: Number(e.target.value) })} />
        <span className="ip-unit">ms</span>
      </div>
    </>
  );
}
