import { useMemo } from 'react';
import { useStore, useActivePattern } from '../state/store';
import type { SampleInstrument, HybridInstrument } from '../state/types';

/** MIDI note number → note name (C-4 = 60) */
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function noteName(midi: number): string {
  const oct = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[midi % 12]}-${oct}`;
}

/** Format seconds to "m:ss.d" or "ss.dd s" */
function fmtSecs(s: number): string {
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const rem = (s % 60).toFixed(1).padStart(4, '0');
    return `${m}:${rem}`;
  }
  return `${s.toFixed(3)}s`;
}

/** Format rows to nearest integer, with fractional bar indicator */
function fmtRows(rows: number): string {
  const r = Math.round(rows);
  return r.toString();
}

interface RowCalc {
  label: string;  // e.g. "16/bar"
  rowsPerBar: number;
  rows: number;
  bars: number;
  nearestRows: number; // snapped to next whole bar
}

function calcRows(durationSecs: number, bpm: number): RowCalc[] {
  const grids = [
    { label: '16/bar', rowsPerBar: 16 },
    { label: '12/bar', rowsPerBar: 12 },
    { label: ' 8/bar', rowsPerBar: 8 },
  ];
  return grids.map(({ label, rowsPerBar }) => {
    // seconds per row = 240 / (bpm * rowsPerBar)
    const rows = durationSecs * bpm * rowsPerBar / 240;
    const bars = rows / rowsPerBar;
    const nearestRows = Math.round(bars) * rowsPerBar;
    return { label, rowsPerBar, rows, bars, nearestRows };
  });
}

export function InfoPanel() {
  // Subscribe directly to the selected instrument in one selector so there's
  // no intermediate render step where instruments and selectedInstrument could
  // be out of sync (e.g. after a cut/trim the memo would see the old PCM length).
  const inst     = useStore((s) => s.instruments[s.selectedInstrument]);
  const selected = useStore((s) => s.selectedInstrument);
  const bpm      = useStore((s) => s.transport.bpm);
  const activePattern = useActivePattern();

  // Sample duration
  const sampleInfo = useMemo(() => {
    if (!inst || (inst.kind !== 'sample' && inst.kind !== 'hybrid')) return null;
    const s = inst as SampleInstrument | HybridInstrument;
    if (!s.pcm || s.pcm.length === 0) return null;
    const sr = s.sampleRate || 44100;
    const durationSecs = s.pcm.length / sr;
    const rowCalcs = calcRows(durationSecs, bpm);
    return { durationSecs, rowCalcs, loopEnabled: s.loopEnabled };
  }, [inst, bpm]);

  // Pattern info
  const patternInfo = useMemo(() => {
    if (!activePattern) return null;
    const rows = activePattern.rows.length;
    const durationSecs = rows * 240 / (bpm * 16); // assume 16/bar baseline
    const bars16 = rows / 16;
    const bars12 = rows / 12;
    return { rows, durationSecs, bars16, bars12 };
  }, [activePattern, bpm]);

  const kindLabel: Record<string, string> = {
    sample: 'SAMPLE',
    midi:   'MIDI',
    synth:  'SYNTH',
    hybrid: 'HYBRID',
    empty:  'EMPTY',
  };

  return (
    <div className="info-panel">
      {/* ── Instrument ─────────────────────────────── */}
      <div className="info-section">
        <div className="info-section__title">INSTRUMENT</div>
        {inst && inst.kind !== 'empty' ? (
          <>
            <div className="info-row">
              <span className="info-label">SLOT</span>
              <span className="info-value info-value--hi">
                {selected.toString(16).toUpperCase().padStart(2, '0')}
              </span>
            </div>
            <div className="info-row info-row--name" title={inst.name}>
              <span className="info-value info-value--name">{inst.name || '—'}</span>
            </div>
            <div className="info-row">
              <span className="info-label">KIND</span>
              <span className="info-value info-value--kind">{kindLabel[inst.kind]}</span>
            </div>
            {(inst.kind === 'sample' || inst.kind === 'hybrid' || inst.kind === 'midi' || inst.kind === 'synth') && (
              <div className="info-row">
                <span className="info-label">BASE</span>
                <span className="info-value">
                  {noteName((inst as SampleInstrument).baseNote ?? 60)}
                  {' '}
                  <span className="info-dim">({(inst as SampleInstrument).baseNote ?? 60})</span>
                </span>
              </div>
            )}
            {(inst.kind === 'sample' || inst.kind === 'hybrid') && (
              <div className="info-row">
                <span className="info-label">LOOP</span>
                <span className={`info-value ${(inst as SampleInstrument).loopEnabled ? 'info-value--on' : 'info-value--off'}`}>
                  {(inst as SampleInstrument).loopEnabled ? 'ON' : 'OFF'}
                </span>
              </div>
            )}
            {(inst.kind === 'sample' || inst.kind === 'hybrid') && (
              <div className="info-row">
                <span className="info-label">VOL</span>
                <span className="info-value">{(inst as SampleInstrument).volume}</span>
              </div>
            )}
          </>
        ) : (
          <div className="info-empty">No instrument</div>
        )}
      </div>

      {/* ── Sample length ──────────────────────────── */}
      {sampleInfo && (
        <div className="info-section">
          <div className="info-section__title">SAMPLE LEN</div>
          <div className="info-row">
            <span className="info-label">TIME</span>
            <span className="info-value info-value--hi">{fmtSecs(sampleInfo.durationSecs)}</span>
          </div>
          <div className="info-row info-row--subhead">
            <span className="info-dim">grid</span>
            <span className="info-dim">rows</span>
            <span className="info-dim">bars</span>
          </div>
          {sampleInfo.rowCalcs.map((c) => {
            const isWhole = Math.abs(c.bars - Math.round(c.bars)) < 0.02;
            return (
              <div key={c.label} className="info-row info-row--calc">
                <span className="info-label">{c.label}</span>
                <span className={`info-value ${isWhole ? 'info-value--exact' : 'info-value--frac'}`}>
                  {fmtRows(c.rows)}
                </span>
                <span className={`info-value ${isWhole ? 'info-value--exact' : 'info-value--frac'}`}>
                  {c.bars.toFixed(2)}
                </span>
              </div>
            );
          })}
          <div className="info-row info-row--hint">
            <span className="info-dim info-dim--hint">
              {(() => {
                const c16 = sampleInfo.rowCalcs[0]!;
                const isWhole = Math.abs(c16.bars - Math.round(c16.bars)) < 0.02;
                if (isWhole) return `✓ fits ${Math.round(c16.bars)} bars at 16/bar`;
                const snap = Math.round(c16.bars) * 16;
                return `set pattern → ${snap} rows`;
              })()}
            </span>
          </div>
        </div>
      )}

      {/* ── Pattern ────────────────────────────────── */}
      {patternInfo && (
        <div className="info-section">
          <div className="info-section__title">PATTERN</div>
          <div className="info-row">
            <span className="info-label">ROWS</span>
            <span className="info-value info-value--hi">{patternInfo.rows}</span>
          </div>
          <div className="info-row">
            <span className="info-label">@16/b</span>
            <span className="info-value">{patternInfo.bars16.toFixed(2)} bars</span>
          </div>
          <div className="info-row">
            <span className="info-label">@12/b</span>
            <span className="info-value">{patternInfo.bars12.toFixed(2)} bars</span>
          </div>
          <div className="info-row">
            <span className="info-label">TIME</span>
            <span className="info-value">{fmtSecs(patternInfo.durationSecs)}</span>
          </div>
        </div>
      )}

      {/* ── Transport ──────────────────────────────── */}
      <div className="info-section">
        <div className="info-section__title">TRANSPORT</div>
        <div className="info-row">
          <span className="info-label">BPM</span>
          <span className="info-value info-value--hi">{bpm}</span>
        </div>
      </div>
    </div>
  );
}
