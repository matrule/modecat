/**
 * MidiImportDialog — shown after a MIDI file has been parsed.
 *
 * Layout:
 *   Top half  — Amiga-style terminal log (green-on-black CRT panel)
 *   Bottom    — Detected info, quantization, destination, track→channel mapping
 */

import { useEffect, useRef, useState } from 'react';
import type { ImportResult } from '../engine/midiImport';
import { CHANNELS } from '../state/types';

/** Rows-per-bar presets shown in the import dialog.
 *  Common values: 4=quarter, 8=8th, 12=8th-triplet, 16=16th, 24=16th-triplet, 32=32nd */
const RPB_OPTIONS = [4, 8, 12, 16, 24, 32, 48] as const;

interface TrackRow {
  trackIdx: number;
  name: string;
  noteCount: number;
  filteredCount: number;
  /** ModeCat channel (0-based) or -1 = skip */
  ch: number;
  /** ModeCat instrument slot (1-based) */
  inst: number;
}

export interface MidiImportSettings {
  /** Rows per bar (= rpb × beatsPerBar).  16 for 4/4 16th-note grid, 12 for 4/4 triplet grid. */
  rowsPerBar: number;
  overwrite: boolean;
  trackMapping: Map<number, number>;
  instrumentBase: Map<number, number>;
  totalRows: number;
  bpm: number;
}

interface Props {
  result: ImportResult;
  onReparse: (rpb: number) => void;
  onImport: (settings: MidiImportSettings) => void;
  onClose: () => void;
}

// ── Amiga log panel ──────────────────────────────────────────────────────────

function AmigaLog({ lines }: { lines: string[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  // Colour each line based on prefix
  function lineClass(line: string): string {
    if (line.startsWith('> WARNING') || line.includes('CORRUPT') || line.includes('***')) return 'amiga-log__warn';
    if (line.startsWith('> Done'))    return 'amiga-log__ok';
    if (line.startsWith('  !'))       return 'amiga-log__strip';
    if (line.startsWith('  >'))       return 'amiga-log__note';
    if (line.startsWith('>'))         return 'amiga-log__head';
    return 'amiga-log__body';
  }

  return (
    <div className="amiga-log">
      {lines.map((line, i) => (
        <div key={i} className={`amiga-log__line ${lineClass(line)}`}>
          {line}
        </div>
      ))}
      <div ref={bottomRef} className="amiga-log__cursor">█</div>
    </div>
  );
}

// ── Main dialog ──────────────────────────────────────────────────────────────

export function MidiImportDialog({ result, onReparse, onImport, onClose }: Props) {
  // Dialog works in rows/bar throughout.  Conversion to rows/beat happens only
  // at the onReparse call boundary (parseMidiFile expects rows/beat).
  const [rowsPerBar, setRowsPerBar] = useState<number>(result.suggestedRowsPerBar);
  const [overwrite, setOverwrite] = useState(true);

  const [trackRows, setTrackRows] = useState<TrackRow[]>(() =>
    result.tracks.map((t, i) => ({
      trackIdx: t.index,
      name: t.name,
      noteCount: t.notes.length,
      filteredCount: t.filteredCount,
      ch: i < CHANNELS ? i : -1,
      inst: i + 1,
    }))
  );

  useEffect(() => {
    setTrackRows((prev) =>
      result.tracks.map((t, i) => {
        const existing = prev.find((r) => r.trackIdx === t.index);
        return {
          trackIdx: t.index,
          name: t.name,
          noteCount: t.notes.length,
          filteredCount: t.filteredCount,
          ch: existing?.ch ?? (i < CHANNELS ? i : -1),
          inst: existing?.inst ?? i + 1,
        };
      })
    );
    setRowsPerBar(result.suggestedRowsPerBar);
  }, [result]);

  const prevRowsPerBar = useRef(rowsPerBar);

  function handleRowsPerBarChange(v: number) {
    setRowsPerBar(v);
    if (v !== prevRowsPerBar.current) {
      prevRowsPerBar.current = v;
      // parseMidiFile expects rows/beat; convert from rows/bar
      onReparse(Math.round(v / result.timeSigNum));
    }
  }

  const bars = Math.ceil(result.totalRows / rowsPerBar);
  const totalCorrupt = result.tracks.reduce((s, t) => s + t.filteredCount, 0);

  /** ModeCat pattern row limit — anything above this gets capped on import. */
  const MAX_ROWS = 3200;
  const willBeCapped = result.totalRows > MAX_ROWS;

  function handleOk() {
    const trackMapping = new Map<number, number>();
    const instrumentBase = new Map<number, number>();
    for (const row of trackRows) {
      if (row.ch >= 0) {
        trackMapping.set(row.trackIdx, row.ch);
        instrumentBase.set(row.trackIdx, row.inst);
      }
    }
    onImport({ rowsPerBar, overwrite, trackMapping, instrumentBase, totalRows: result.totalRows, bpm: result.bpm });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'Enter')  { e.preventDefault(); handleOk(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackRows, rowsPerBar, overwrite]);

  function updateRow(trackIdx: number, patch: Partial<TrackRow>) {
    setTrackRows((prev) =>
      prev.map((r) => (r.trackIdx === trackIdx ? { ...r, ...patch } : r))
    );
  }

  return (
    <div className="ip-backdrop" onMouseDown={onClose}>
      <div
        className="ip-dialog midi-import-dialog"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="ip-titlebar">
          <span>Import MIDI File</span>
          <button className="ip-close" type="button" onClick={onClose} tabIndex={-1}>✕</button>
        </div>

        <div className="ip-body" style={{ padding: 0 }}>
          {/* ── Amiga log panel ─────────────────────────────────────────── */}
          <div className="amiga-log__wrapper">
            <div className="amiga-log__titlebar">
              <span>IMPORT LOG</span>
              {totalCorrupt > 0 && (
                <span className="amiga-log__warn" style={{ fontSize: '0.75em' }}>
                  ⚠ {totalCorrupt} CORRUPT NOTE(S) DISCARDED
                </span>
              )}
            </div>
            <AmigaLog lines={result.log} />
          </div>

          {/* ── Settings panel ──────────────────────────────────────────── */}
          <div style={{ padding: '0.5rem 0.75rem' }}>

            {/* Detected info + quantize side by side */}
            <div className="midi-import__top-row">
              <div>
                <div className="ip-section-title">DETECTED</div>
                <div className="midi-import__info-grid">
                  <span className="upper" style={{ opacity: 0.6 }}>BPM</span>
                  <span className="midi-import__val">{result.bpm}</span>
                  <span className="upper" style={{ opacity: 0.6 }}>Time Sig</span>
                  <span className="midi-import__val">{result.timeSigNum}/{result.timeSigDen}</span>
                  <span className="upper" style={{ opacity: 0.6 }}>Tracks</span>
                  <span className="midi-import__val">{result.tracks.length}</span>
                  <span className="upper" style={{ opacity: 0.6 }}>Bars</span>
                  <span className="midi-import__val">{bars}</span>
                </div>
              </div>

              <div>
                <div className="ip-section-title">QUANTIZE</div>
                <div className="ip-row" style={{ gap: '0.4rem' }}>
                  <label className="ip-label" style={{ width: 'auto' }} htmlFor="mi-rpb">Rows/bar</label>
                  <select
                    id="mi-rpb"
                    className="ip-input"
                    value={rowsPerBar}
                    onChange={(e) => handleRowsPerBarChange(Number(e.target.value))}
                  >
                    {RPB_OPTIONS.map((v) => (
                      <option key={v} value={v}>{v} rows/bar</option>
                    ))}
                  </select>
                </div>
                <div style={{ opacity: 0.5, fontSize: '0.75em', marginTop: '0.2rem' }}>
                  {result.totalRows} rows · {bars} bar{bars !== 1 ? 's' : ''}
                </div>
                <div className="ip-row" style={{ marginTop: '0.4rem', gap: '0.4rem' }}>
                  <label style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center', cursor: 'pointer', fontSize: '0.85em' }}>
                    <input
                      type="checkbox"
                      checked={overwrite}
                      onChange={(e) => setOverwrite(e.target.checked)}
                    />
                    Overwrite current pattern
                  </label>
                </div>
              </div>
            </div>

            {/* Row-cap warning */}
            {willBeCapped && (
              <div style={{
                marginTop: '0.4rem',
                padding: '0.3rem 0.5rem',
                background: 'rgba(255,68,0,0.15)',
                border: '1px solid var(--wb-orange)',
                borderRadius: '3px',
                fontSize: '0.78em',
                color: 'var(--wb-orange)',
              }}>
                ⚠ File has {result.totalRows} rows — will be capped at {MAX_ROWS} (ModeCat limit).
                Only the first {MAX_ROWS} rows will be imported.
              </div>
            )}

            {/* Track mapping */}
            <div className="ip-section-title" style={{ marginTop: '0.5rem' }}>TRACKS → CHANNELS</div>
            <div className="midi-import__track-table">
              <div className="midi-import__track-head">
                <span>Track</span>
                <span style={{ textAlign: 'right' }}>Notes</span>
                <span style={{ textAlign: 'right' }}>Disc.</span>
                <span>→ Ch</span>
                <span>Inst</span>
              </div>
              {trackRows.map((row) => (
                <div
                  key={row.trackIdx}
                  className={`midi-import__track-row${row.filteredCount > 0 ? ' has-corrupt' : ''}`}
                >
                  <span
                    className="upper"
                    style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={row.name}
                  >
                    {row.name}
                  </span>
                  <span style={{ textAlign: 'right', opacity: 0.7 }}>{row.noteCount}</span>
                  <span style={{ textAlign: 'right', color: row.filteredCount > 0 ? 'var(--wb-orange)' : 'transparent' }}>
                    {row.filteredCount > 0 ? row.filteredCount : '–'}
                  </span>
                  <select
                    className="ip-input"
                    value={row.ch}
                    onChange={(e) => updateRow(row.trackIdx, { ch: Number(e.target.value) })}
                    style={{ padding: '1px 2px' }}
                  >
                    <option value={-1}>Skip</option>
                    {Array.from({ length: CHANNELS }, (_, i) => (
                      <option key={i} value={i}>{i + 1}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    className="ip-input"
                    min={1}
                    max={64}
                    value={row.inst}
                    onChange={(e) => updateRow(row.trackIdx, { inst: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    style={{ width: '3.5ch', textAlign: 'right' }}
                    disabled={row.ch < 0}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="ip-footer">
          <button className="btn" type="button" onClick={handleOk}>Import</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
