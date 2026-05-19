/**
 * DrumEditor — TR-909-style step sequencer for ModeCat.
 *
 * Voices map directly to tracker channels 8–15 (configurable via DrumConfig).
 * Steps are stored as ordinary PatternCell rows in any pattern — the drum editor
 * is just a grid view on top of the existing data model.
 *
 * Layout:
 *   ┌───────────────────────────────────────────────────────────┐
 *   │  DRUMS header bar  (step count / swing / block selector)  │
 *   ├────────────────┬──────────────────────────────────────────┤
 *   │  Block list    │  Voice grid (voice rows × step columns)  │
 *   └────────────────┴──────────────────────────────────────────┘
 *
 * Writing steps: uses store.setPatCell / store.clearPatCell so the data ends
 * up in the ordinary pattern bank (and the main tracker shows it).
 */

import { useCallback, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { DrumVoice } from '../state/types';
import { DRUM_KITS } from '../data/drumkits';
import { loadKit } from '../engine/kitLoader';

// ── constants ─────────────────────────────────────────────────────────────────

// Groups for the 16-step grid: 4 groups of 4, matching TR-909 LED clusters.
const GROUP_SIZE = 4;

// ── helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ── Block list panel ──────────────────────────────────────────────────────────

interface BlockListProps {
  selectedId: number | null;
  onSelect: (id: number) => void;
}

function BlockList({ selectedId, onSelect }: BlockListProps) {
  const patterns = useStore((s) => s.patterns);
  return (
    <div className="drum-editor__block-list">
      <div className="drum-editor__block-list-header">BLOCKS</div>
      <div className="drum-editor__block-list-inner">
        {patterns.map((pat) => (
          <button
            key={pat.id}
            className={`drum-editor__block-item${pat.id === selectedId ? ' is-active' : ''}`}
            type="button"
            onClick={() => onSelect(pat.id)}
          >
            <span className="drum-editor__block-id">{String(pat.id).padStart(2, '0')}</span>
            <span className="drum-editor__block-name">{pat.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Voice row ─────────────────────────────────────────────────────────────────

interface VoiceRowProps {
  voice: DrumVoice;
  voiceIdx: number;
  patId: number | null;
  stepCount: 16 | 32;
}

function VoiceRow({ voice, voiceIdx, patId, stepCount }: VoiceRowProps) {
  const pattern            = useStore((s) => s.patterns.find((p) => p.id === patId));
  const setDrumVoice       = useStore((s) => s.setDrumVoice);
  const setPatCell         = useStore((s) => s.setPatCell);
  const clearPatCell       = useStore((s) => s.clearPatCell);
  const instruments        = useStore((s) => s.instruments);
  const selectedInstrument = useStore((s) => s.selectedInstrument);

  const [editingName, setEditingName] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Determine which steps are active (note != 0 in that row × channel).
  const activeSteps = new Array(stepCount).fill(false);
  if (pattern) {
    for (let step = 0; step < stepCount && step < pattern.rows.length; step++) {
      const cell = pattern.rows[step]?.[voice.channel];
      if (cell && cell.note !== 0) activeSteps[step] = true;
    }
  }

  function toggleStep(step: number) {
    if (patId == null) return;
    if (activeSteps[step]) {
      clearPatCell(patId, step, voice.channel);
    } else {
      // Use the voice's assigned instrument if set; otherwise fall back to the
      // currently selected instrument in the tracker (so the user can pick an
      // instrument in the list and use it immediately without configuring each voice).
      const instSlot = voice.instrument > 0 ? voice.instrument : selectedInstrument;
      // Also auto-assign it to the voice so subsequent steps use the same one.
      if (voice.instrument === 0 && instSlot > 0) {
        setDrumVoice(voiceIdx, { instrument: instSlot });
      }
      setPatCell(patId, step, voice.channel, {
        note: voice.defaultNote,
        instrument: instSlot,
        cmd: 0,
        data: 0,
      });
    }
  }

  function handleNameCommit(val: string) {
    setEditingName(false);
    setDrumVoice(voiceIdx, { name: val.trim() || voice.name });
  }

  function cycleInstrument(delta: 1 | -1) {
    const next = clamp(voice.instrument + delta, 0, 32);
    setDrumVoice(voiceIdx, { instrument: next });
  }

  const instName = voice.instrument > 0
    ? instruments[voice.instrument]?.name ?? `INST ${voice.instrument}`
    : '—';

  // Build step buttons, grouped into clusters of 4.
  const stepGroups: number[][] = [];
  for (let g = 0; g < stepCount / GROUP_SIZE; g++) {
    stepGroups.push(
      Array.from({ length: GROUP_SIZE }, (_, i) => g * GROUP_SIZE + i)
    );
  }

  return (
    <div className="drum-editor__voice-row">
      {/* ── Voice controls (left) ── */}
      <div className="drum-editor__voice-controls">
        <button
          className={`drum-editor__ms-btn${voice.mute ? ' is-mute' : ''}`}
          type="button"
          title="Mute"
          onClick={() => setDrumVoice(voiceIdx, { mute: !voice.mute })}
        >
          M
        </button>
        <button
          className={`drum-editor__ms-btn${voice.solo ? ' is-solo' : ''}`}
          type="button"
          title="Solo"
          onClick={() => setDrumVoice(voiceIdx, { solo: !voice.solo })}
        >
          S
        </button>

        {editingName ? (
          <input
            ref={nameRef}
            className="drum-editor__voice-name-input"
            defaultValue={voice.name}
            autoFocus
            onBlur={(e) => handleNameCommit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNameCommit((e.target as HTMLInputElement).value);
              if (e.key === 'Escape') setEditingName(false);
            }}
            maxLength={12}
          />
        ) : (
          <div
            className="drum-editor__voice-name"
            title="Double-click to rename"
            onDoubleClick={() => setEditingName(true)}
          >
            {voice.name}
          </div>
        )}

        {/* Instrument slot */}
        <div className="drum-editor__voice-inst" title={instName}>
          <button
            className="drum-editor__inst-arrow"
            type="button"
            onClick={() => cycleInstrument(-1)}
          >
            ◀
          </button>
          <span className="drum-editor__inst-label">
            {voice.instrument > 0 ? String(voice.instrument).padStart(2, '0') : '--'}
          </span>
          <button
            className="drum-editor__inst-arrow"
            type="button"
            onClick={() => cycleInstrument(1)}
          >
            ▶
          </button>
        </div>
      </div>

      {/* ── Step grid ── */}
      <div className="drum-editor__steps">
        {stepGroups.map((group, gi) => (
          <div key={gi} className="drum-editor__step-group">
            {group.map((step) => (
              <button
                key={step}
                className={`drum-editor__step${activeSteps[step] ? ' is-active' : ''}${patId == null ? ' is-disabled' : ''}`}
                type="button"
                onClick={() => toggleStep(step)}
                disabled={patId == null}
                title={`Step ${step + 1}`}
              />
            ))}
          </div>
        ))}
      </div>

      {/* ── Per-voice params (right) ── */}
      <div className="drum-editor__voice-params">
        <label className="drum-editor__param-label">
          LVL
          <input
            className="drum-editor__param-input"
            type="number"
            min={0}
            max={127}
            value={voice.level}
            onChange={(e) => setDrumVoice(voiceIdx, { level: clamp(Number(e.target.value), 0, 127) })}
          />
        </label>
        <label className="drum-editor__param-label">
          TUN
          <input
            className="drum-editor__param-input"
            type="number"
            min={-24}
            max={24}
            value={voice.tune}
            onChange={(e) => setDrumVoice(voiceIdx, { tune: clamp(Number(e.target.value), -24, 24) })}
          />
        </label>
      </div>
    </div>
  );
}

// ── Step ruler ────────────────────────────────────────────────────────────────

function StepRuler({ stepCount }: { stepCount: 16 | 32 }) {
  const groups: number[][] = [];
  for (let g = 0; g < stepCount / GROUP_SIZE; g++) {
    groups.push(Array.from({ length: GROUP_SIZE }, (_, i) => g * GROUP_SIZE + i + 1));
  }
  return (
    <div className="drum-editor__voice-row drum-editor__voice-row--ruler">
      <div className="drum-editor__voice-controls" />
      <div className="drum-editor__steps">
        {groups.map((group, gi) => (
          <div key={gi} className="drum-editor__step-group">
            {group.map((n) => (
              <div key={n} className="drum-editor__step-num">
                {n}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="drum-editor__voice-params" />
    </div>
  );
}

// ── DrumEditor root ───────────────────────────────────────────────────────────

export function DrumEditor() {
  const drumConfig    = useStore((s) => s.drumConfig);
  const setDrumConfig = useStore((s) => s.setDrumConfig);
  const patterns      = useStore((s) => s.patterns);

  // The block currently being edited in the drum grid.
  const [selectedPatId, setSelectedPatId] = useState<number | null>(
    () => patterns[0]?.id ?? null
  );

  // Kit loading state.
  const [kitLoading, setKitLoading] = useState(false);
  const [kitStatus, setKitStatus] = useState<string>('');
  const [kitMenuOpen, setKitMenuOpen] = useState(false);

  // Ensure selectedPatId stays valid when patterns change.
  const safePatId = patterns.find((p) => p.id === selectedPatId)?.id ?? patterns[0]?.id ?? null;

  const handleSelectBlock = useCallback((id: number) => {
    setSelectedPatId(id);
  }, []);

  function toggleStepCount() {
    setDrumConfig({ ...drumConfig, stepCount: drumConfig.stepCount === 16 ? 32 : 16 });
  }

  function setSwing(val: number) {
    setDrumConfig({ ...drumConfig, swing: clamp(val, 0, 100) });
  }

  async function handleLoadKit(kitId: string) {
    setKitMenuOpen(false);
    const kit = DRUM_KITS.find((k) => k.id === kitId);
    if (!kit) return;
    setKitLoading(true);
    setKitStatus(`Loading ${kit.name}…`);
    try {
      const result = await loadKit(kit, {
        onProgress: (loaded, total, name) => {
          setKitStatus(name ? `Loading ${name} (${loaded}/${total})` : `Loading ${kit.name}…`);
        },
      });
      if (result.error) {
        setKitStatus(`⚠ ${result.error}`);
      } else {
        setKitStatus(`✓ ${kit.name} loaded — ${result.loaded} voices`);
      }
    } catch (e) {
      setKitStatus(`⚠ Load failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setKitLoading(false);
      setTimeout(() => setKitStatus(''), 4000);
    }
  }

  const selectedPat = patterns.find((p) => p.id === safePatId);

  return (
    <div className="drum-editor">
      {/* ── Global header bar ── */}
      <div className="drum-editor__header">
        <span className="drum-editor__title">DRUMS</span>

        <div className="drum-editor__header-controls">
          <button
            className="drum-editor__step-toggle btn"
            type="button"
            onClick={toggleStepCount}
          >
            {drumConfig.stepCount} STEPS
          </button>

          <label className="drum-editor__swing-label">
            SWING
            <input
              className="drum-editor__swing-input"
              type="range"
              min={0}
              max={100}
              value={drumConfig.swing}
              onChange={(e) => setSwing(Number(e.target.value))}
            />
            <span className="drum-editor__swing-val">
              {drumConfig.swing === 50 ? 'STR' : `${drumConfig.swing}`}
            </span>
          </label>

          {/* Kit loader */}
          <div className="drum-editor__kit-wrap">
            <button
              className="drum-editor__kit-btn btn"
              type="button"
              disabled={kitLoading}
              onClick={() => setKitMenuOpen((o) => !o)}
            >
              {kitLoading ? '⟳ LOADING…' : 'LOAD KIT ▾'}
            </button>
            {kitMenuOpen && (
              <div className="drum-editor__kit-menu">
                {DRUM_KITS.map((kit) => (
                  <button
                    key={kit.id}
                    className="drum-editor__kit-item"
                    type="button"
                    onClick={() => handleLoadKit(kit.id)}
                  >
                    <span className="drum-editor__kit-name">{kit.name}</span>
                    <span className="drum-editor__kit-credit">{kit.credit}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {kitStatus && (
            <span className="drum-editor__kit-status">{kitStatus}</span>
          )}
        </div>

        {selectedPat && (
          <div className="drum-editor__block-tag">
            BLOCK: <strong>{selectedPat.name}</strong>
          </div>
        )}
      </div>

      <div className="drum-editor__body">
        {/* ── Block list ── */}
        <BlockList selectedId={safePatId} onSelect={handleSelectBlock} />

        {/* ── Voice grid ── */}
        <div className="drum-editor__grid">
          <StepRuler stepCount={drumConfig.stepCount} />
          {drumConfig.voices.map((voice, vi) => (
            <VoiceRow
              key={vi}
              voice={voice}
              voiceIdx={vi}
              patId={safePatId}
              stepCount={drumConfig.stepCount}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
