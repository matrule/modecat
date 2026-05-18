/**
 * ClipEditor — in-place grid editor for a single Clip.
 *
 * Works on a local copy of the clip's rows. Hitting Save calls onSave(rows),
 * which the caller passes to store.updateClip() so every placement updates.
 *
 * Supports the same note-entry keys as PatternEditor (keyboard + backspace to
 * clear), cursor nav with arrow keys, and a simple cell renderer matching the
 * tracker grid look. No virtualisation needed — clips are typically small.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  formatNote,
  hex2,
  hexCharToValue,
  KEYMAP_LOWER,
  KEYMAP_UPPER,
  NOTE_HOLD,
} from '../engine/notes';
import type { Clip, PatternCell } from '../state/types';
import { emptyCell } from '../state/types';
import { useStore } from '../state/store';

interface Props {
  clip: Clip;
  onSave: (rows: PatternCell[][]) => void;
  onClose: () => void;
}

// Deep-clone rows so edits don't mutate the store directly.
function cloneRows(rows: PatternCell[][]): PatternCell[][] {
  return rows.map((r) => r.map((c) => ({ ...c })));
}

export function ClipEditor({ clip, onSave, onClose }: Props) {
  const [rows, setRows]   = useState<PatternCell[][]>(() => cloneRows(clip.rows));
  const [curRow, setCurRow] = useState(0);
  const [curCh,  setCurCh]  = useState(0);
  const [curField, setCurField] = useState<0|1|2|3|4|5|6>(0);
  const [octave, setOctave]   = useState(4);

  const selectedInstrument = useStore((s) => s.selectedInstrument);

  const rowCount  = rows.length;
  const chanCount = rows[0]?.length ?? 0;

  // Keep edit state in a ref so the keydown handler doesn't go stale.
  const stateRef = useRef({ curRow, curCh, curField, octave, rows });
  stateRef.current = { curRow, curCh, curField, octave, rows };

  function setCell(row: number, ch: number, patch: Partial<PatternCell>) {
    setRows((prev) => {
      const next = prev.map((r, ri) =>
        ri !== row ? r : r.map((c, ci) => ci !== ch ? c : { ...c, ...patch })
      );
      return next;
    });
  }

  function clearCell(row: number, ch: number) {
    setCell(row, ch, emptyCell());
  }

  function moveCursor(dRow: number, dCh: number) {
    const { curRow: r, curCh: c, rows } = stateRef.current;
    const rows_ = rows.length;
    const chans = rows[0]?.length ?? 0;
    const nr = Math.max(0, Math.min(rows_ - 1, r + dRow));
    const nc = Math.max(0, Math.min(chans - 1, c + dCh));
    setCurRow(nr);
    setCurCh(nc);
    setCurField(0);
  }

  const onKey = useCallback((e: KeyboardEvent) => {
    // Don't capture if focus is inside an input elsewhere
    if ((e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'SELECT') return;

    const { curRow: row, curCh: ch, curField: field, octave: oct, rows } = stateRef.current;
    const cell = rows[row]?.[ch] ?? emptyCell();

    // Navigation
    if (e.key === 'ArrowUp')    { e.preventDefault(); moveCursor(-1, 0); return; }
    if (e.key === 'ArrowDown')  { e.preventDefault(); moveCursor( 1, 0); return; }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); moveCursor( 0,-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); moveCursor( 0, 1); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      moveCursor(0, e.shiftKey ? -1 : 1);
      return;
    }

    // Octave adjust
    if (e.key === 'F1') { e.preventDefault(); setOctave((o) => Math.max(0, o - 1)); return; }
    if (e.key === 'F2') { e.preventDefault(); setOctave((o) => Math.min(8, o + 1)); return; }

    // Backspace = clear current field / cell
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      if (field === 0) {
        clearCell(row, ch);
      } else if (field <= 2) {
        setCell(row, ch, { instrument: 0 });
      } else {
        setCell(row, ch, { cmd: 0, data: 0 });
      }
      return;
    }

    // Note entry (field 0)
    if (field === 0) {
      const upper = e.key.toUpperCase();
      if (upper === 'CAPSLOCK' || upper === 'SHIFT' || upper === 'CONTROL' || upper === 'ALT') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Hold note (backquote / ~)
      if (e.key === '`' || e.key === '~') {
        e.preventDefault();
        setCell(row, ch, { note: NOTE_HOLD, instrument: selectedInstrument });
        moveCursor(1, 0);
        return;
      }

      const noteMap = oct >= 2 ? KEYMAP_UPPER : KEYMAP_LOWER;
      const noteOffset = noteMap[e.key];
      if (noteOffset !== undefined) {
        e.preventDefault();
        const note = Math.max(1, Math.min(127, oct * 12 + noteOffset));
        setCell(row, ch, { note, instrument: selectedInstrument });
        moveCursor(1, 0);
        return;
      }
    }

    // Hex entry (instrument / cmd / data fields)
    if (field >= 1) {
      const hv = hexCharToValue(e.key);
      if (hv === -1) return;
      e.preventDefault();
      switch (field) {
        case 1: {
          const v = ((hv << 4) | (cell.instrument & 0x0f)) & 0xff;
          setCell(row, ch, { instrument: v });
          setCurField(2);
          return;
        }
        case 2: {
          const v = ((cell.instrument & 0xf0) | hv) & 0xff;
          setCell(row, ch, { instrument: v });
          moveCursor(1, 0);
          setCurField(0);
          return;
        }
        case 3: {
          const v = ((hv << 4) | (cell.cmd & 0x0f)) & 0xff;
          setCell(row, ch, { cmd: v });
          setCurField(4);
          return;
        }
        case 4: {
          const v = ((cell.cmd & 0xf0) | hv) & 0xff;
          setCell(row, ch, { cmd: v });
          setCurField(5);
          return;
        }
        case 5: {
          const v = ((hv << 4) | (cell.data & 0x0f)) & 0xff;
          setCell(row, ch, { data: v });
          setCurField(6);
          return;
        }
        case 6: {
          const v = ((cell.data & 0xf0) | hv) & 0xff;
          setCell(row, ch, { data: v });
          moveCursor(1, 0);
          setCurField(0);
          return;
        }
      }
    }

    // Field switch: Space cycles note→inst→cmd
    if (e.key === ' ') {
      e.preventDefault();
      setCurField((f) => (f === 0 ? 1 : f === 2 ? 3 : 0) as 0|1|2|3|4|5|6);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInstrument]);

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  const chanCount_ = chanCount;

  return (
    <div className="clip-editor">
      {/* Toolbar */}
      <div className="clip-editor__toolbar">
        <span className="upper" style={{ marginRight: '0.5rem' }}>Oct</span>
        <button className="btn" type="button" onClick={() => setOctave((o) => Math.max(0, o - 1))}>▼</button>
        <span style={{ padding: '0 0.4rem', fontVariantNumeric: 'tabular-nums' }}>{octave}</span>
        <button className="btn" type="button" onClick={() => setOctave((o) => Math.min(8, o + 1))}>▲</button>
        <span className="sep" style={{ margin: '0 0.5rem' }} />
        <span className="muted" style={{ fontSize: '0.78em' }}>
          {rowCount}r × {chanCount_}ch
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn" type="button" onClick={onClose} style={{ marginRight: '0.3rem' }}>
          Cancel
        </button>
        <button
          className="btn"
          type="button"
          style={{ background: 'var(--wb-orange)', color: 'var(--wb-blue)', fontWeight: 'bold' }}
          onClick={() => onSave(rows)}
        >
          Save
        </button>
      </div>

      {/* Channel headers */}
      <div
        className="clip-editor__header"
        style={{ gridTemplateColumns: `2.5ch repeat(${chanCount_}, 12ch)` }}
      >
        <div className="num" />
        {Array.from({ length: chanCount_ }, (_, i) => (
          <div
            key={i}
            className={`ch${i === curCh ? ' is-current' : ''}`}
            onClick={() => setCurCh(i)}
          >
            CH{String(i + 1).padStart(2, '0')}
          </div>
        ))}
      </div>

      {/* Rows */}
      <div className="clip-editor__scroll">
        {rows.map((rowCells, r) => {
          const isCurrent = r === curRow;
          const isBeat    = r % 4 === 0;
          return (
            <div
              key={r}
              className={[
                'pattern__row',
                isBeat    ? 'is-beat'    : '',
                isCurrent ? 'is-current' : '',
              ].filter(Boolean).join(' ')}
              style={{ gridTemplateColumns: `2.5ch repeat(${chanCount_}, 12ch)` }}
              onClick={() => setCurRow(r)}
            >
              <div className="num">{String(r).padStart(2, '0')}</div>
              {rowCells.map((cell, c) => {
                const isCursorCell = isCurrent && c === curCh;
                const noteEmpty = cell.note === 0;
                const instEmpty = cell.instrument === 0;
                const cmdEmpty  = cell.cmd === 0 && cell.data === 0;
                const instActive = isCursorCell && (curField === 1 || curField === 2);
                const cmdActive  = isCursorCell && curField >= 3;
                return (
                  <div
                    key={c}
                    className="cell"
                    onClick={(e) => { e.stopPropagation(); setCurRow(r); setCurCh(c); setCurField(0); }}
                  >
                    <span className={`note seg${noteEmpty ? ' is-empty' : ''}${isCursorCell && curField === 0 ? ' is-cursor' : ''}`}>
                      {formatNote(cell.note)}
                    </span>
                    <span> </span>
                    <span className={`inst${instEmpty ? ' is-empty' : ''}${instActive ? ' is-active' : ''}`}>
                      <span className={`seg${isCursorCell && curField === 1 ? ' is-cursor' : ''}`}>{hex2(cell.instrument)[0]}</span>
                      <span className={`seg${isCursorCell && curField === 2 ? ' is-cursor' : ''}`}>{hex2(cell.instrument)[1]}</span>
                    </span>
                    <span> </span>
                    <span className={`cmd${cmdEmpty ? ' is-empty' : ''}${cmdActive ? ' is-active' : ''}`}>
                      <span className={`seg${isCursorCell && curField === 3 ? ' is-cursor' : ''}`}>{hex2(cell.cmd)[0]}</span>
                      <span className={`seg${isCursorCell && curField === 4 ? ' is-cursor' : ''}`}>{hex2(cell.cmd)[1]}</span>
                      <span className={`seg${isCursorCell && curField === 5 ? ' is-cursor' : ''}`}>{hex2(cell.data)[0]}</span>
                      <span className={`seg${isCursorCell && curField === 6 ? ' is-cursor' : ''}`}>{hex2(cell.data)[1]}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
