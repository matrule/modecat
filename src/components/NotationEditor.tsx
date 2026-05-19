/**
 * NotationEditor — Graphic Notation view + note-entry for the active pattern (#42 / #43).
 *
 * VIEWING: Shows one or more pattern channels as western staff notation via VexFlow.
 * EDITING: Click anywhere on a staff to place a note (requires Edit mode).
 *   - X position → row (linear subdivision of each bar into rowsPerBar slots)
 *   - Y position → diatonic pitch (treble-clef geometry, F5 at top staff line)
 *   - Right-click → clear the cell at that position
 *
 * Controls:
 *   Channel buttons   — toggle which channels appear
 *   Rows/bar input    — how many pattern rows equal one bar (default 4)
 *   Edit mode (from tracker EDIT toggle) gates note writing
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Accidental,
  Dot,
} from 'vexflow';
import { useStore, useActivePattern } from '../state/store';
import { CHANNELS } from '../state/types';
import { NOTE_HOLD } from '../engine/notes';

// ── MIDI ↔ VexFlow ────────────────────────────────────────────────────────────

const _NOTE_NAMES  = ['c','c','d','d','e','f','f','g','g','a','a','b'] as const;
const _ACCIDENTALS = [null,'#',null,'#',null,null,'#',null,'#',null,'#',null] as const;

function midiToVex(midi: number): { key: string; accidental: '#' | null } {
  const octave = Math.max(0, Math.floor(midi / 12) - 1);
  const idx    = ((midi % 12) + 12) % 12;
  return {
    key:        `${_NOTE_NAMES[idx]}/${octave}`,
    accidental: _ACCIDENTALS[idx] as '#' | null,
  };
}

/**
 * Map a staff position (diatonic steps from the top staff line) to a MIDI note.
 *
 * Treble clef reference:
 *   pos  0 → F5 (77)   top staff line
 *   pos  2 → D5 (74)
 *   pos  4 → B4 (71)   middle line
 *   pos  6 → G4 (67)
 *   pos  8 → E4 (64)   bottom staff line
 * Negative positions extend upward (above the staff).
 */
const TREBLE_DIATONIC: readonly number[] = [
  77, 76, 74, 72, 71, 69, 67, 65, 64, 62, 60, 59, 57, 55, 53, 52, 50, 48, 47, 45, 43,
];
const TREBLE_ABOVE: readonly number[] = [
  77, 79, 81, 83, 84, 86, 88, 89, 91, 93, 95,
];

function staffPosToMidi(pos: number): number {
  if (pos < 0) {
    const idx = Math.min(-pos, TREBLE_ABOVE.length - 1);
    return TREBLE_ABOVE[idx]!;
  }
  return TREBLE_DIATONIC[Math.min(pos, TREBLE_DIATONIC.length - 1)]!;
}

// ── Layout constants ──────────────────────────────────────────────────────────

const CH_LABEL_W    = 44;   // px: space for "Ch 16" label on left
const STAVE_W       = 155;  // px: width of each bar's stave
const STAVE_H       = 100;  // px: vertical space per channel per system row
const BARS_PER_SYS  = 4;    // bars per system (line)
const SYSTEM_GAP    = 24;   // extra px gap between systems
const TOP_MARGIN    = 20;   // px from top of SVG to first stave

// VexFlow draws its top staff line at (staveY + STAFF_Y_OFFSET) in the default
// configuration (space_above_staff_ln = 4, line_spacing = 10 → 4 × 10 = 40 px).
const STAFF_Y_OFFSET  = 40;  // px from chY to top staff line
const PX_PER_STEP     = 5;   // px per diatonic half-step on the staff

const NOTE_PADDING  = 36;   // px subtracted from STAVE_W for Formatter budget

// ── Hit-map (click → row + channel) ──────────────────────────────────────────

interface HitEntry {
  ch:       number;   // pattern channel index
  x:        number;   // stave left edge (px)
  y:        number;   // stave top (chY, px)
  startRow: number;   // first pattern row this bar maps to
}

/** Build a lookup table for click-hit detection from the same params as render. */
function buildHitMap(
  numRows: number,
  selectedChannels: number[],
  rowsPerBar: number
): HitEntry[] {
  const hits: HitEntry[] = [];
  const numBars    = Math.ceil(numRows / rowsPerBar);
  const numSystems = Math.ceil(numBars / BARS_PER_SYS);
  const numCh      = selectedChannels.length;

  for (let sysIdx = 0; sysIdx < numSystems; sysIdx++) {
    const sysY = TOP_MARGIN + sysIdx * (numCh * STAVE_H + SYSTEM_GAP);
    for (let chPos = 0; chPos < numCh; chPos++) {
      const ch  = selectedChannels[chPos]!;
      const chY = sysY + chPos * STAVE_H;
      for (let barInSys = 0; barInSys < BARS_PER_SYS; barInSys++) {
        const barIdx = sysIdx * BARS_PER_SYS + barInSys;
        if (barIdx >= numBars) break;
        hits.push({
          ch, y: chY,
          x:        CH_LABEL_W + barInSys * STAVE_W,
          startRow: barIdx * rowsPerBar,
        });
      }
    }
  }
  return hits;
}

// ── Cursor row → SVG overlay position ────────────────────────────────────────

interface CursorOverlay {
  x: number;
  y: number;
  h: number;
}

function cursorOverlayPos(
  cursorRow: number,
  selectedChannels: number[],
  rowsPerBar: number,
  numRows: number
): CursorOverlay | null {
  const numBars    = Math.ceil(numRows / rowsPerBar);
  const numSystems = Math.ceil(numBars / BARS_PER_SYS);
  const numCh      = selectedChannels.length;

  const barIdx  = Math.floor(cursorRow / rowsPerBar);
  const beat    = cursorRow % rowsPerBar;
  const sysIdx  = Math.floor(barIdx / BARS_PER_SYS);
  const barInSys = barIdx % BARS_PER_SYS;

  if (sysIdx >= numSystems || barIdx >= numBars) return null;

  const sysY = TOP_MARGIN + sysIdx * (numCh * STAVE_H + SYSTEM_GAP);
  const staveX = CH_LABEL_W + barInSys * STAVE_W;

  // Linear beat position within the bar
  const beatFrac = (beat + 0.5) / rowsPerBar;
  const x = staveX + beatFrac * STAVE_W;
  const y = sysY;
  const h = numCh * STAVE_H;

  return { x, y, h };
}

// ── Duration helpers ──────────────────────────────────────────────────────────

/**
 * Standard note durations in 4/4 beats, ordered largest → smallest.
 * Each entry: [beats, vexDuration, isDotted]
 */
const STD_DURS: ReadonlyArray<[number, string, boolean]> = [
  [4,     'w',  false],
  [3,     'h',  true ],
  [2,     'h',  false],
  [1.5,   'q',  true ],
  [1,     'q',  false],
  [0.75,  '8',  true ],
  [0.5,   '8',  false],
  [0.375, '16', true ],
  [0.25,  '16', false],
  [0.125, '32', false],
];

/**
 * Greedily decompose a row-span into one or more VexFlow StaveNotes or rests.
 * `pitch` = null means rest.  Notes spanning non-standard values are split into
 * the largest standard duration that fits, followed by smaller durations.
 */
function addSpanToBar(
  out: InstanceType<typeof StaveNote>[],
  pitch: { key: string; accidental: '#' | null } | null,
  spanRows: number,
  rowsPerBar: number
): void {
  const beatsPerRow = 4 / rowsPerBar;
  let remaining = spanRows * beatsPerRow;

  while (remaining > 0.001) {
    let chosen: [number, string, boolean] | null = null;
    for (const candidate of STD_DURS) {
      if (candidate[0] <= remaining + 0.001) { chosen = candidate; break; }
    }
    if (!chosen) break;

    const [beatVal, dur, dotted] = chosen;
    if (pitch) {
      const sn = new StaveNote({ keys: [pitch.key], duration: dur, autoStem: true });
      if (pitch.accidental) sn.addModifier(new Accidental(pitch.accidental), 0);
      if (dotted) sn.addModifier(new Dot(), 0);
      out.push(sn);
    } else {
      const rest = new StaveNote({ keys: ['b/4'], duration: dur + 'r' });
      if (dotted) rest.addModifier(new Dot(), 0);
      out.push(rest);
    }
    remaining -= beatVal;
  }
}

/**
 * Build the note/rest list for one bar of one channel.
 * Scans ahead from each row to count hold cells (real note duration) and
 * consecutive empty cells (rest duration), then calls addSpanToBar for each.
 */
function buildBarNotes(
  rows: (Record<string, unknown> | undefined)[][],
  ch: number,
  startRow: number,
  rowsPerBar: number,
  numRows: number
): InstanceType<typeof StaveNote>[] {
  const out: InstanceType<typeof StaveNote>[] = [];
  let beat = 0;

  while (beat < rowsPerBar) {
    const rowIdx = startRow + beat;
    const cell   = rowIdx < numRows ? (rows[rowIdx]?.[ch] as { note?: number } | undefined) : undefined;
    const noteVal = cell?.note ?? 0;

    if (noteVal === NOTE_HOLD) {
      // Orphaned hold (note started in previous bar) — treat as a single rest.
      addSpanToBar(out, null, 1, rowsPerBar);
      beat++;
      continue;
    }

    if (!noteVal || noteVal > 127) {
      // Rest — coalesce consecutive empty rows (stop at note or hold).
      let span = 1;
      while (beat + span < rowsPerBar) {
        const ni = startRow + beat + span;
        const nv = ni < numRows ? ((rows[ni]?.[ch] as { note?: number } | undefined)?.note ?? 0) : 0;
        if (!nv || nv > 127) span++;
        else break;
      }
      addSpanToBar(out, null, span, rowsPerBar);
      beat += span;
      continue;
    }

    // Real note — count consecutive hold rows within this bar.
    let span = 1;
    while (beat + span < rowsPerBar) {
      const ni = startRow + beat + span;
      const nv = ni < numRows ? ((rows[ni]?.[ch] as { note?: number } | undefined)?.note ?? 0) : 0;
      if (nv === NOTE_HOLD) span++;
      else break;
    }

    const { key, accidental } = midiToVex(noteVal);
    addSpanToBar(out, { key, accidental }, span, rowsPerBar);
    beat += span;
  }

  return out;
}

// ── Render function ───────────────────────────────────────────────────────────

/**
 * Maximum bars rendered at once.  Beyond this the SVG gets huge and the
 * browser stalls — especially after a MIDI import with thousands of rows.
 * The tracker grid below always shows the full pattern; the notation view
 * is a musical preview, not a complete score.
 */
const MAX_DISPLAY_BARS = 64;

/**
 * @param rowsPerBar  Total tracker rows per musical bar (= rpb × beatsPerBar)
 * @param beatsPerBar Musical beats per bar (time-signature numerator, e.g. 4 for 4/4)
 * @returns [hitEntries, truncated] — truncated=true when the pattern has more than MAX_DISPLAY_BARS bars
 */
function renderNotation(
  container: HTMLElement,
  rows: (Record<string, unknown> | undefined)[][],
  selectedChannels: number[],
  rowsPerBar: number,
  beatsPerBar: number
): [HitEntry[], boolean] {
  container.innerHTML = '';

  const numRows = rows.length;
  const numCh   = selectedChannels.length;
  if (numCh === 0 || numRows === 0) return [[], false];

  // Voice numBeats/beatValue match the time signature; strict=false handles
  // bars whose note-list doesn't sum exactly (cross-bar holds, triplet grids).
  const numBeats  = beatsPerBar;
  const beatValue = 4;

  const totalBars = Math.ceil(numRows / rowsPerBar);
  const numBars   = Math.min(totalBars, MAX_DISPLAY_BARS);
  const truncated = totalBars > MAX_DISPLAY_BARS;

  const numSystems = Math.ceil(numBars / BARS_PER_SYS);

  const svgW = CH_LABEL_W + BARS_PER_SYS * STAVE_W + 12;
  const svgH = numSystems * (numCh * STAVE_H + SYSTEM_GAP) + TOP_MARGIN + 20;

  const renderer = new Renderer(container as HTMLDivElement, Renderer.Backends.SVG);
  renderer.resize(svgW, svgH);
  const ctx = renderer.getContext();

  for (let sysIdx = 0; sysIdx < numSystems; sysIdx++) {
    const sysY = TOP_MARGIN + sysIdx * (numCh * STAVE_H + SYSTEM_GAP);

    for (let chPos = 0; chPos < numCh; chPos++) {
      const ch  = selectedChannels[chPos]!;
      const chY = sysY + chPos * STAVE_H;

      for (let barInSys = 0; barInSys < BARS_PER_SYS; barInSys++) {
        const barIdx = sysIdx * BARS_PER_SYS + barInSys;
        if (barIdx >= numBars) break;

        const staveX = CH_LABEL_W + barInSys * STAVE_W;
        const stave  = new Stave(staveX, chY, STAVE_W);

        if (barInSys === 0) {
          stave.addClef('treble');
          if (sysIdx === 0 && chPos === 0) {
            // Use musical beat count, not tracker row count, for the time signature.
            stave.addTimeSignature(`${beatsPerBar}/4`);
          }
        }

        stave.setContext(ctx).draw();

        const startRow = barIdx * rowsPerBar;
        const barNotes = buildBarNotes(rows, ch, startRow, rowsPerBar, numRows);

        try {
          // numBeats/beatValue match the note duration so the voice fills
          // exactly one bar for power-of-2 RPBs.  For triplet RPBs (3,6,12)
          // the actual note count won't match; strict=false lets VexFlow
          // format them anyway — the formatter distributes within the given
          // pixel width regardless.
          const voice = new Voice({ numBeats, beatValue });
          voice.setStrict(false);
          voice.addTickables(barNotes);
          new Formatter()
            .joinVoices([voice])
            .format([voice], STAVE_W - NOTE_PADDING);
          voice.draw(ctx, stave);
        } catch (e) {
          console.warn(`Notation: bar ${barIdx} ch ${ch}`, e);
        }
      }
    }
  }

  // Channel labels
  const svg = container.querySelector('svg');
  if (svg) {
    for (let sysIdx = 0; sysIdx < numSystems; sysIdx++) {
      const sysY = TOP_MARGIN + sysIdx * (numCh * STAVE_H + SYSTEM_GAP);
      for (let chPos = 0; chPos < numCh; chPos++) {
        const ch  = selectedChannels[chPos]!;
        const y   = sysY + chPos * STAVE_H + STAVE_H * 0.45;
        const el  = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        el.setAttribute('x', '2');
        el.setAttribute('y', String(Math.round(y)));
        el.setAttribute('fill', '#ff8800');
        el.setAttribute('font-family', 'monospace');
        el.setAttribute('font-size', '10');
        el.setAttribute('font-weight', 'bold');
        el.textContent = `Ch${ch + 1}`;
        svg.appendChild(el);
      }
    }
  }

  // Only build hit-map for the displayed bars; clicks outside are ignored.
  const displayedRows = numBars * rowsPerBar;
  return [buildHitMap(displayedRows, selectedChannels, rowsPerBar), truncated];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function NotationEditor() {
  const cursor       = useStore((s) => s.cursor);
  const setCell      = useStore((s) => s.setCell);
  const clearCell    = useStore((s) => s.clearCell);
  const setCursor    = useStore((s) => s.setCursor);
  const setTransport = useStore((s) => s.setTransport);
  const addPattern   = useStore((s) => s.addPattern);
  const insertSongPosition = useStore((s) => s.insertSongPosition);
  const replacePatternRows = useStore((s) => s.replacePatternRows);
  const setPatternLength   = useStore((s) => s.setPatternLength);
  const selectedInstrument = useStore((s) => s.selectedInstrument);

  const activePattern = useActivePattern();
  const patName = activePattern
    ? `BLK ${String(activePattern.id).padStart(2, '0')} ${activePattern.name}`
    : '—';

  const [selectedChannels, setSelectedChannels] = useState<number[]>([0]);
  const [rowsPerBar, setRowsPerBar]             = useState(4);
  /**
   * Musical beats per bar — drives the VexFlow time signature and Voice numBeats.
   * Defaults to 4 (4/4 time).  Updated from the MIDI file's time-signature event.
   */
  const [beatsPerBar, setBeatsPerBar]           = useState(4);

  const containerRef  = useRef<HTMLDivElement>(null);
  const hitMapRef     = useRef<HitEntry[]>([]);
  const [notationTruncated, setNotationTruncated] = useState(false);

  // Re-render whenever pattern data, selection, or rows-per-bar changes.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !activePattern) {
      if (el) el.innerHTML = '';
      hitMapRef.current = [];
      return;
    }
    const rows = activePattern.rows as unknown as (Record<string, unknown> | undefined)[][];
    const [hits, truncated] = renderNotation(el, rows, selectedChannels, rowsPerBar, beatsPerBar);
    hitMapRef.current = hits;
    setNotationTruncated(truncated);
  }, [activePattern, selectedChannels, rowsPerBar, beatsPerBar]);

  // Cursor overlay position — computed without re-rendering VexFlow.
  const overlay = useMemo(() => {
    if (!activePattern) return null;
    return cursorOverlayPos(cursor.row, selectedChannels, rowsPerBar, activePattern.rows.length);
  }, [cursor.row, selectedChannels, rowsPerBar, activePattern]);

  function toggleChannel(i: number) {
    setSelectedChannels([i]);
  }

  /** Handle click or right-click on the notation area. */
  function handleStaffClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!activePattern || !cursor.editMode) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Find the stave hit
    const hit = hitMapRef.current.find(
      (h) => clickX >= h.x && clickX < h.x + STAVE_W &&
             clickY >= h.y && clickY < h.y + STAVE_H
    );
    if (!hit) return;

    // X → beat within bar → row
    const xInBar = clickX - hit.x;
    const beat   = Math.min(rowsPerBar - 1, Math.max(0, Math.floor((xInBar / STAVE_W) * rowsPerBar)));
    const row    = Math.min(activePattern.rows.length - 1, hit.startRow + beat);

    if (e.type === 'contextmenu') {
      e.preventDefault();
      clearCell(row, hit.ch);
      setCursor({ row, channel: hit.ch, field: 0 });
      return;
    }

    // Y → diatonic staff position → MIDI pitch
    const yInStave = clickY - hit.y;
    const staffPos = Math.round((yInStave - STAFF_Y_OFFSET) / PX_PER_STEP);
    const note     = staffPosToMidi(staffPos);

    setCell(row, hit.ch, { note, instrument: selectedInstrument });
    setCursor({ row, channel: hit.ch, field: 0 });
  }

  // ── MIDI import handlers ───────────────────────────────────────────────────

  const editCursor = cursor.editMode ? 'crosshair' : 'default';

  return (
    <div className="notation-editor">

      {/* Header */}
      <div className="notation-editor__header">
        <span className="notation-editor__pat-label">{patName}</span>

        <label className="notation-editor__rpb-label" title="Block rows per bar">
          Rows/bar
          <input
            type="number"
            min={1}
            max={64}
            value={rowsPerBar}
            onChange={(e) => setRowsPerBar(Math.max(1, Math.min(64, Number(e.target.value))))}
            className="notation-editor__rpb-input"
          />
        </label>

        {/* Quick-set presets — 16 rows/bar (4/4 16th-note grid) and 12 rows/bar (triplet grid) */}
        <button
          type="button"
          className={`btn${rowsPerBar === 16 ? ' is-active' : ''}`}
          style={{ padding: '2px 6px' }}
          onClick={() => setRowsPerBar(16)}
          title="16 rows/bar — 4/4 at 16th-note resolution"
        >
          [16]
        </button>
        <button
          type="button"
          className={`btn${rowsPerBar === 12 ? ' is-active' : ''}`}
          style={{ padding: '2px 6px' }}
          onClick={() => setRowsPerBar(12)}
          title="12 rows/bar — 4/4 at 8th-note triplet resolution"
        >
          [12]
        </button>

        <span className="notation-editor__hint">
          {cursor.editMode
            ? 'Click: place note · Right-click: erase'
            : 'Read-only — enable EDIT to place notes'}
        </span>
      </div>

      {/* Truncation notice — shown when the pattern has more than MAX_DISPLAY_BARS bars */}
      {notationTruncated && (
        <div style={{
          padding: '2px 8px',
          background: 'rgba(255,136,0,0.15)',
          borderBottom: '1px solid var(--wb-orange)',
          fontSize: '0.75em',
          color: 'var(--wb-orange)',
        }}>
          ⚠ Showing first {MAX_DISPLAY_BARS} bars — block has more rows than the notation view can display.
        </div>
      )}

      {/* Channel toggles */}
      <div className="notation-editor__channels">
        {Array.from({ length: CHANNELS }, (_, i) => (
          <button
            key={i}
            type="button"
            className={[
              'btn notation-editor__ch-btn',
              selectedChannels.includes(i) ? 'is-active' : '',
            ].join(' ')}
            onClick={() => toggleChannel(i)}
            title={`Channel ${i + 1}`}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {/* Staff area with click-to-place */}
      <div className="notation-editor__scroll" style={{ position: 'relative' }}>
        {!activePattern && (
          <div className="notation-editor__empty">No block loaded</div>
        )}

        {/* Cursor-row position indicator — thin orange line over the active row */}
        {overlay && (
          <div
            className="notation-editor__cursor-line"
            style={{
              left:   `${overlay.x - 1}px`,
              top:    `${overlay.y}px`,
              height: `${overlay.h}px`,
            }}
          />
        )}

        <div
          ref={containerRef}
          className="notation-editor__vexflow"
          style={{ cursor: editCursor }}
          onClick={handleStaffClick}
          onContextMenu={handleStaffClick}
        />
      </div>
    </div>
  );
}

// ── MDI wrapper ───────────────────────────────────────────────────────────────

export function NotationEditorMdi() {
  return <NotationEditor />;
}
