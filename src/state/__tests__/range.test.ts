/**
 * Range-operation unit tests — Spread, Copy/Paste, Transpose, Echo
 *
 * Uses the real Zustand store so the behaviour matches the running app
 * exactly.  Each test calls `useStore.setState(...)` to inject a fresh
 * minimal pattern, then calls the action under test and reads back the
 * result.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store';
import { emptyCell, makeEmptyPattern, CHANNELS } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a tiny 8-row × CHANNELS pattern with notes on specified rows/channels */
function makeTestPattern(notes: Array<{ row: number; ch: number; note: number }>) {
  const p = makeEmptyPattern(1, 'TEST');
  // Trim to 8 rows for speed
  while (p.rows.length > 8) p.rows.pop();
  while (p.rows.length < 8) p.rows.push(Array(CHANNELS).fill(null).map(() => emptyCell()));
  for (const { row, ch, note } of notes) {
    p.rows[row]![ch] = { ...emptyCell(), note, instrument: 1 };
  }
  return p;
}

function resetStore(notes: Array<{ row: number; ch: number; note: number }>) {
  const p = makeTestPattern(notes);
  // Merge — do NOT pass `true` (replace) because that strips all action methods from the store.
  useStore.setState({
    patterns: [p],
    song: { positions: [1] },
    transport: { ...useStore.getState().transport, songPos: 0 },
    range: null,
    cursor: { ...useStore.getState().cursor, row: 0, channel: 0, field: 0, editMode: false },
    copyBuffer: null,
  } as any);
}

function noteAt(row: number, ch: number): number {
  const s = useStore.getState();
  return s.patterns[0]!.rows[row]![ch]!.note;
}

function setRange(startRow: number, endRow: number, startCh: number, endCh: number) {
  useStore.getState().setRange({ startRow, endRow, startCh, endCh });
}

// ---------------------------------------------------------------------------
// rangeSpread
// ---------------------------------------------------------------------------

describe('rangeSpread', () => {
  it('redistributes notes cyclically across N channels', () => {
    // 4 notes all on channel 0, rows 0–3
    resetStore([
      { row: 0, ch: 0, note: 60 },
      { row: 1, ch: 0, note: 62 },
      { row: 2, ch: 0, note: 64 },
      { row: 3, ch: 0, note: 65 },
    ]);
    setRange(0, 3, 0, 1);
    useStore.getState().rangeSpread(2);

    // Notes should alternate between ch 0 and ch 1
    expect(noteAt(0, 0)).toBe(60); // note 0 → ch 0
    expect(noteAt(1, 0)).toBe(0);  // note 1 → ch 1 (ch 0 cleared)
    expect(noteAt(1, 1)).toBe(62); // note 1 → ch 1
    expect(noteAt(2, 0)).toBe(64); // note 2 → ch 0 (cyclic)
    expect(noteAt(3, 0)).toBe(0);
    expect(noteAt(3, 1)).toBe(65); // note 3 → ch 1
  });

  it('requires n >= 2 — n=1 is a no-op', () => {
    resetStore([{ row: 0, ch: 0, note: 60 }]);
    setRange(0, 0, 0, 1);
    useStore.getState().rangeSpread(1);
    // Note should remain unchanged
    expect(noteAt(0, 0)).toBe(60);
  });

  it('requires a range — no-op without range', () => {
    resetStore([{ row: 0, ch: 0, note: 60 }]);
    // range is null
    useStore.getState().rangeSpread(2);
    expect(noteAt(0, 0)).toBe(60);
  });

  it('spreads multi-channel selection across n=3 channels', () => {
    // 6 notes across ch 0–1, rows 0–2
    resetStore([
      { row: 0, ch: 0, note: 60 },
      { row: 0, ch: 1, note: 61 },
      { row: 1, ch: 0, note: 62 },
      { row: 1, ch: 1, note: 63 },
      { row: 2, ch: 0, note: 64 },
      { row: 2, ch: 1, note: 65 },
    ]);
    setRange(0, 2, 0, 2);
    useStore.getState().rangeSpread(3);

    // Notes collected order: row0/ch0, row0/ch1, row1/ch0, row1/ch1, row2/ch0, row2/ch1
    // → ch offset: 0%3=0, 1%3=1, 2%3=2, 3%3=0, 4%3=1, 5%3=2
    // Note 0 (60) → row0, ch0;  Note 1 (61) → row0, ch1;  Note 2 (62) → row1, ch2
    // Note 3 (63) → row1, ch0;  Note 4 (64) → row2, ch1;  Note 5 (65) → row2, ch2
    expect(noteAt(0, 0)).toBe(60);
    expect(noteAt(0, 1)).toBe(61);
    expect(noteAt(1, 2)).toBe(62);
    expect(noteAt(1, 0)).toBe(63);
    expect(noteAt(2, 1)).toBe(64);
    expect(noteAt(2, 2)).toBe(65);
  });
});

// ---------------------------------------------------------------------------
// rangeCopy / rangePaste
// ---------------------------------------------------------------------------

describe('rangeCopy / rangePaste', () => {
  it('copies range and pastes at cursor position', () => {
    resetStore([
      { row: 0, ch: 0, note: 60 },
      { row: 0, ch: 1, note: 62 },
      { row: 1, ch: 0, note: 64 },
      { row: 1, ch: 1, note: 65 },
    ]);
    setRange(0, 1, 0, 1);
    useStore.getState().rangeCopy();

    // Move cursor to row 4, paste there
    useStore.setState({ cursor: { row: 4, channel: 0, field: 0, editMode: false } as any });
    useStore.getState().rangePaste();

    expect(noteAt(4, 0)).toBe(60);
    expect(noteAt(4, 1)).toBe(62);
    expect(noteAt(5, 0)).toBe(64);
    expect(noteAt(5, 1)).toBe(65);
  });

  it('does not overwrite source when pasting to different row', () => {
    resetStore([
      { row: 0, ch: 0, note: 72 },
    ]);
    setRange(0, 0, 0, 0);
    useStore.getState().rangeCopy();
    useStore.setState({ cursor: { row: 3, channel: 0, field: 0, editMode: false } as any });
    useStore.getState().rangePaste();

    expect(noteAt(0, 0)).toBe(72); // source intact
    expect(noteAt(3, 0)).toBe(72); // pasted
  });

  it('rangePaste is a no-op when no copy has been done', () => {
    resetStore([{ row: 0, ch: 0, note: 48 }]);
    useStore.setState({ copyBuffer: null } as any);
    useStore.setState({ cursor: { row: 0, channel: 0, field: 0, editMode: false } as any });
    useStore.getState().rangePaste();
    expect(noteAt(0, 0)).toBe(48); // unchanged
  });
});

// ---------------------------------------------------------------------------
// rangeTransposeSemi
// ---------------------------------------------------------------------------

describe('rangeTransposeSemi', () => {
  it('shifts notes up by 1 semitone', () => {
    resetStore([{ row: 0, ch: 0, note: 60 }]);
    setRange(0, 0, 0, 0);
    useStore.getState().rangeTransposeSemi(+1);
    expect(noteAt(0, 0)).toBe(61);
  });

  it('shifts notes down by 2 semitones', () => {
    resetStore([{ row: 2, ch: 1, note: 67 }]);
    setRange(2, 2, 1, 1);
    useStore.getState().rangeTransposeSemi(-2);
    expect(noteAt(2, 1)).toBe(65);
  });

  it('clamps at MIDI 127 (does not overflow)', () => {
    resetStore([{ row: 0, ch: 0, note: 126 }]);
    setRange(0, 0, 0, 0);
    useStore.getState().rangeTransposeSemi(+5);
    expect(noteAt(0, 0)).toBe(127);
  });

  it('clamps at MIDI 1 (does not go below 1)', () => {
    resetStore([{ row: 0, ch: 0, note: 2 }]);
    setRange(0, 0, 0, 0);
    useStore.getState().rangeTransposeSemi(-5);
    expect(noteAt(0, 0)).toBe(1);
  });

  it('leaves empty cells (note=0) untouched', () => {
    resetStore([]);
    setRange(0, 7, 0, 3);
    useStore.getState().rangeTransposeSemi(+12);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 4; c++) {
        expect(noteAt(r, c)).toBe(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// rangeTransposeOctave
// ---------------------------------------------------------------------------

describe('rangeTransposeOctave', () => {
  it('shifts up 12 semitones per octave', () => {
    resetStore([{ row: 0, ch: 0, note: 60 }]);
    setRange(0, 0, 0, 0);
    useStore.getState().rangeTransposeOctave(+1);
    expect(noteAt(0, 0)).toBe(72);
  });

  it('shifts down one octave', () => {
    resetStore([{ row: 0, ch: 0, note: 60 }]);
    setRange(0, 0, 0, 0);
    useStore.getState().rangeTransposeOctave(-1);
    expect(noteAt(0, 0)).toBe(48);
  });
});

// ---------------------------------------------------------------------------
// rangeClear / rangeCut
// ---------------------------------------------------------------------------

describe('rangeClear / rangeCut', () => {
  it('clears all notes in range', () => {
    resetStore([
      { row: 0, ch: 0, note: 60 },
      { row: 1, ch: 0, note: 62 },
    ]);
    setRange(0, 1, 0, 0);
    useStore.getState().rangeClear();
    expect(noteAt(0, 0)).toBe(0);
    expect(noteAt(1, 0)).toBe(0);
  });

  it('cut = copy then clear', () => {
    resetStore([{ row: 0, ch: 0, note: 55 }]);
    setRange(0, 0, 0, 0);
    useStore.getState().rangeCut();
    expect(noteAt(0, 0)).toBe(0); // cleared
    useStore.setState({ cursor: { row: 5, channel: 0, field: 0, editMode: false } as any });
    useStore.getState().rangePaste();
    expect(noteAt(5, 0)).toBe(55); // pasted elsewhere
  });
});

// ---------------------------------------------------------------------------
// rangeEcho
// ---------------------------------------------------------------------------

describe('rangeEcho', () => {
  it('creates decaying echoes of notes within the range', () => {
    resetStore([{ row: 0, ch: 0, note: 60 }]);
    setRange(0, 7, 0, 0);
    // Echo starts at vol=0x20 (32) and halves each step.
    // minVol must be <= 32 to get at least one echo.
    useStore.getState().rangeEcho(2, 10); // every 2 rows, minVol 10

    // Original note at row 0 should still be there
    expect(noteAt(0, 0)).toBe(60);
    // First echo at row 2 — same note, volume cmd 0x0C set
    expect(noteAt(2, 0)).toBe(60);
    // Second echo at row 4 — vol=16 >= 10, should also exist
    expect(noteAt(4, 0)).toBe(60);
    // Third echo at row 6 — vol=8 < 10, should NOT be placed
    expect(noteAt(6, 0)).toBe(0);
  });
});
