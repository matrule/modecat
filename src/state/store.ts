import { create } from 'zustand';
import {
  CHANNELS,
  CLIP_COLORS,
  ROWS_PER_PATTERN,
  emptyCell,
  makeEmptyPattern,
  makeDefaultDrumConfig,
  type BridgeStatus,
  type Clip,
  type ClipPlacement,
  type CursorState,
  type DrumConfig,
  type ArpSequence,
  type DrumVoice,
  type Instrument,
  type MidiMessage,
  type MidiPort,
  type Pattern,
  type PatternCell,
  type RangeSel,
  type SectionMarker,
  type Song,
  type SongMeta,
  type TrackFlags,
  type TransportState,
} from './types';
import {
  initialBridge,
  initialCursor,
  initialSongMeta,
  initialTransport,
  makeInitialInstruments,
  makeInitialPatterns,
  makeInitialSong,
  makeInitialTrackFlags,
} from './initial';

/**
 * Pure helper: return a new patterns array with every note inside the active
 * range shifted by `delta` semitones (clamped to MIDI 1..127). Cells with no
 * note are left untouched.
 */
function transposeRange(
  s: { range: RangeSel | null; song: Song; transport: TransportState; patterns: Pattern[] },
  delta: number
): Partial<{ patterns: Pattern[] }> {
  const r = s.range;
  const pid = s.song.positions[s.transport.songPos];
  if (!r || pid == null) return {};
  const patterns = s.patterns.map((p) => {
    if (p.id !== pid) return p;
    const rows = p.rows.map((rowCells, ri) => {
      if (ri < r.startRow || ri > r.endRow) return rowCells;
      return rowCells.map((c, ci) => {
        if (ci < r.startCh || ci > r.endCh) return c;
        if (c.note === 0) return c;
        const next = Math.max(1, Math.min(127, c.note + delta));
        return { ...c, note: next };
      });
    });
    return { ...p, rows };
  });
  return { patterns };
}

type UndoSnapshot = { patterns: Pattern[]; song: Song; instruments: Instrument[] };

interface Store {
  // ---- undo / redo ----
  _undoStack: UndoSnapshot[];
  _redoStack: UndoSnapshot[];
  canUndo: () => boolean;
  canRedo: () => boolean;
  undo: () => void;
  redo: () => void;

  // ---- song / patterns / instruments ----
  meta: SongMeta;
  song: Song;
  patterns: Pattern[];           // pattern bank, keyed by id
  instruments: Instrument[];
  trackFlags: TrackFlags[];      // per-track mute/solo
  clips: Clip[];                 // reusable clip library

  // ---- editor / playback ----
  cursor: CursorState;
  transport: TransportState;

  // ---- bridge / MIDI ----
  bridge: BridgeStatus;
  ports: MidiPort[];
  selectedOutPortId: string | null;

  // ---- UI ----
  selectedInstrument: number;
  rightPanel: 'instruments' | 'detail';

  /**
   * Monotonic counter incremented whenever the user explicitly moves the
   * song position via the UI (e.g. clicking a row in SongEditor). The
   * sequencer watches this so it can reconcile its internal playhead with
   * the store when the user jumps during playback.
   */
  songJumpVersion: number;

  // ---- range / clipboard ----
  /** Active rectangular selection inside the current pattern, or null. */
  range: RangeSel | null;
  /** Clipboard of cells from the last range CUT/COPY. */
  copyBuffer: PatternCell[][] | null;
  /**
   * Block clipboard — holds a deep copy of all rows from the last
   * "Copy Block" operation (all ROWS_PER_PATTERN × CHANNELS cells).
   */
  blockClipboard: PatternCell[][] | null;
  /**
   * Track clipboard — holds a deep copy of one channel's cells
   * (ROWS_PER_PATTERN cells) from the last "Copy Track" operation.
   */
  trackClipboard: PatternCell[] | null;

  // ---- clip library ----
  /** Create a clip from the current range selection. Returns the new clip id. */
  createClipFromRange: (name: string) => string | null;
  /** Add a clip placement to a pattern. Prompts handled by caller. */
  addClipPlacement: (patternId: number, placement: Omit<ClipPlacement, 'id'>) => void;
  /** Remove a clip placement from a pattern (without unlinking — just removes reference). */
  removeClipPlacement: (patternId: number, placementId: string) => void;
  /** Unlink: convert clip placement cells back to plain pattern data and remove placement. */
  unlinkClipPlacement: (patternId: number, placementId: string) => void;
  /** Delete a clip from the library. Removes all its placements across all patterns. */
  deleteClip: (clipId: string) => void;
  /** Duplicate a clip in the library, returning the new clip id. */
  copyClip: (clipId: string) => string;
  /** Update a clip's rows (from the clip MDI editor). Propagates to all placements. */
  updateClip: (clipId: string, rows: PatternCell[][]) => void;
  /** Rename a clip. */
  renameClip: (clipId: string, name: string) => void;
  /** Extend a placement's tileRows. */
  extendClipPlacement: (patternId: number, placementId: string, tileRows: number) => void;
  /** Move a placement to a new row/channel origin. */
  moveClipPlacement: (patternId: number, placementId: string, newStartRow: number, newStartCh: number) => void;
  /** Change a clip's colour. */
  setClipColor: (clipId: string, color: string) => void;

  // ---- meta actions ----
  setMeta: (m: Partial<SongMeta>) => void;

  // ---- pattern bank ----
  /** Look up a pattern by id. */
  patternById: (id: number) => Pattern | undefined;
  /** The currently-active pattern (resolved from song[songPos]). */
  activePattern: () => Pattern | undefined;
  addPattern: (afterPos?: number) => number;     // returns new pattern id
  deletePattern: (id: number) => void;
  renamePattern: (id: number, name: string) => void;

  // ---- song / playlist ----
  setSongPositions: (positions: number[]) => void;
  insertSongPosition: (index: number, patternId: number) => void;
  removeSongPosition: (index: number) => void;
  setSongPositionPattern: (index: number, patternId: number) => void;
  setSongPos: (pos: number) => void;
  setLoopSong: (on: boolean) => void;
  setPatternLoop: (on: boolean) => void;

  // ---- section markers ----
  /** Insert a named section divider before `beforePos` in the song position list. */
  insertSection: (beforePos: number, name?: string) => void;
  /** Remove the section marker at index `markerIdx` in `song.sectionMarkers`. */
  deleteSection: (markerIdx: number) => void;
  /** Rename the section marker at `markerIdx`. */
  renameSection: (markerIdx: number, name: string) => void;

  // ---- cells ----
  setCell: (row: number, channel: number, patch: Partial<PatternCell>) => void;
  clearCell: (row: number, channel: number) => void;

  // ---- cursor / transport ----
  setCursor: (patch: Partial<CursorState>) => void;
  moveCursor: (drow: number, dcolOrField: number) => void;
  setEditMode: (on: boolean) => void;
  setChordMode: (on: boolean) => void;
  setOctave: (o: number) => void;

  // ---- range / clipboard operations ----
  setRange: (r: RangeSel | null) => void;
  extendRangeTo: (row: number, channel: number) => void;
  rangeCut: () => void;
  rangeCopy: () => void;
  rangePaste: () => void;
  rangeClear: () => void;
  /** Move the current range to a new top-left position, clearing the source. */
  rangeMove: (toStartRow: number, toStartCh: number) => void;
  /** Transpose every note in the range by ±semitones. */
  rangeTransposeSemi: (delta: number) => void;
  /** Transpose every note in the range by ±octaves. */
  rangeTransposeOctave: (delta: number) => void;
  /** Linearly interpolate 0C volume between the first and last 0C-row in the range. */
  rangeVolFade: () => void;
  /** Write echo copies of every triggered note within the range. */
  rangeEcho: (distance: number, minVol: number) => void;
  /**
   * Auto-slide: fill intermediate cells between the first and last note in the
   * range with pitch-slide commands.
   *   '01' → cmd 0x01 (slide up, `speed` units/tick)
   *   '02' → cmd 0x02 (slide down, `speed` units/tick)
   *   '03' → cmd 0x03 (tone portamento toward last note at `speed`)
   */
  rangePitchSlide: (mode: '01' | '02' | '03', speed: number) => void;
  /** Write cmd+data into every cell in the range (overwrites existing cmd/data only). */
  rangeSetCmd: (cmd: number, data: number) => void;
  /**
   * Paste the copyBuffer at the cursor, shifted right by `chOffset` channels.
   * Allows pasting to different channels than where the copy originated.
   */
  rangePasteChOffset: (chOffset: number) => void;
  /**
   * Spread notes in the range across `n` adjacent channels.
   * Notes are distributed cyclically: the k-th triggered note goes to channel
   * (startCh + k % n). Notes that stay on their original channel are kept;
   * notes that move to a new channel are written there and cleared from source.
   */
  rangeSpread: (n: number) => void;

  // ---- programmable keys ----
  /** 10 slots for Shift+0..9 quick-insert. null = slot unused. */
  progKeys: Array<{ note: number; instrument: number; cmd: number; data: number } | null>;
  setProgKey: (slot: number, val: { note: number; instrument: number; cmd: number; data: number } | null) => void;

  // ---- block ops ----
  /** Split the active pattern at `atRow`; insert the tail as the next song position. */
  splitBlockAt: (atRow: number) => void;
  /**
   * Resize the active pattern to `newLength` rows (1..3200).
   * If growing, empty rows are appended. If shrinking, trailing rows are dropped.
   */
  setPatternLength: (newLength: number) => void;
  /**
   * Bulk-replace the rows of a specific pattern by id.
   * Used by MIDI import to write all cells at once.
   */
  replacePatternRows: (patternId: number, rows: PatternCell[][]) => void;
  /**
   * Copy the entire active pattern (all rows × all channels) into
   * `blockClipboard`. Does not alter the pattern.
   */
  copyBlock: () => void;
  /**
   * Paste the `blockClipboard` into the active pattern, replacing its rows.
   * No-op when `blockClipboard` is null.
   */
  pasteBlock: () => void;
  /**
   * Copy one channel's cells (all ROWS_PER_PATTERN rows) from the active
   * pattern into `trackClipboard`.
   */
  copyTrack: (channel: number) => void;
  /**
   * Paste `trackClipboard` into `channel` of the active pattern.
   * No-op when `trackClipboard` is null.
   */
  pasteTrack: (channel: number) => void;

  // ---- global ops ----
  /** Replace every occurrence of `fromIdx` with `toIdx` across all patterns. */
  swapInstrumentGlobal: (fromIdx: number, toIdx: number, mode: 'change' | 'exchange' | 'delete') => void;

  /**
   * Change all cells using `fromIdx` to `toIdx` in the **active pattern only**.
   * Does not touch other patterns.
   */
  reassignInBlock: (fromIdx: number, toIdx: number) => void;

  /**
   * Replace every note matching `fromNote` with `toNote` in the active pattern
   * (or in the selection if a range is active). Destructive / permanent.
   */
  rangeNoteChange: (fromNote: number, toNote: number) => void;
  /**
   * Swap all occurrences of `noteA` and `noteB` in the active pattern
   * (or selection). Destructive / permanent.
   */
  rangeNoteExchange: (noteA: number, noteB: number) => void;

  // ---- play transpose ----
  /**
   * Non-destructive semitone offset applied to every note during playback.
   * Does not alter the pattern data — only shifts what the sequencer hears.
   * Range: −24..+24.
   */
  playTranspose: number;
  setPlayTranspose: (semitones: number) => void;

  // ---- MIDI messages ----
  /**
   * 16 named MIDI message slots. Triggered in the sequencer by effect cmd 0x10,
   * data byte = slot index (0x00..0x0F). Bytes are raw MIDI status + data bytes.
   */
  midiMessages: MidiMessage[];
  setMidiMessage: (index: number, msg: MidiMessage) => void;

  /** User-defined arpeggio sequences (cmd 0x20..0x2F). Up to 16. */
  arpSequences: ArpSequence[];
  setArpSequence: (seq: ArpSequence) => void;
  removeArpSequence: (id: number) => void;

  setTransport: (patch: Partial<TransportState>) => void;
  play: () => void;
  stop: () => void;
  togglePlay: () => void;

  // ---- instruments ----
  setInstrument: (idx: number, inst: Instrument) => void;
  setSelectedInstrument: (idx: number) => void;

  // ---- mute / solo ----
  toggleMute: (track: number) => void;
  toggleSolo: (track: number) => void;
  clearSolo: () => void;
  isAudible: (track: number) => boolean;

  // ---- bridge ----
  setBridge: (patch: Partial<BridgeStatus>) => void;
  setPorts: (ports: MidiPort[]) => void;
  setSelectedOutPort: (id: string | null) => void;

  // ---- UI ----
  setRightPanel: (p: 'instruments' | 'detail') => void;

  // ---- line ops ----
  insertRowAt: (row: number) => void;
  deleteRowAt: (row: number) => void;
  insertRowsAt: (row: number, count: number) => void;
  deleteRowsAt: (row: number, count: number) => void;

  // ---- instrument flush ----
  flushInstrument: (idx: number) => void;
  flushUnused: () => void;

  // ---- note naming ----
  noteNaming: 'B' | 'H';
  setNoteNaming: (v: 'B' | 'H') => void;

  // ---- visible tracks ----
  visibleTracks: number;
  setVisibleTracks: (n: number) => void;

  // ---- instrument usage UI ----
  /** Highlight cells in the sequencer that use the selected instrument. */
  instHighlight: boolean;
  setInstHighlight: (v: boolean) => void;
  /** Show usage count badges in the instrument list. */
  instCounts: boolean;
  setInstCounts: (v: boolean) => void;

  // ---- volume mixer ----
  /** Per-channel volume 0..100 (100 = unity). Length = CHANNELS. */
  trackVolumes: number[];
  setTrackVolume: (ch: number, vol: number) => void;
  resetTrackVolumes: () => void;

  // ---- drum machine ----
  drumConfig: DrumConfig;
  /** Replace the entire drum config (e.g. on load or reset). */
  setDrumConfig: (cfg: DrumConfig) => void;
  /** Patch one voice by index. */
  setDrumVoice: (voiceIdx: number, patch: Partial<DrumVoice>) => void;
  /**
   * Set a cell in any pattern by id (not just the active one).
   * Used by the drum editor to write steps into a specific block.
   */
  setPatCell: (patId: number, row: number, channel: number, patch: Partial<PatternCell>) => void;
  /** Clear a cell in any pattern by id. */
  clearPatCell: (patId: number, row: number, channel: number) => void;

  // ---- bulk replace (used by Load) ----
  loadFromJson: (file: {
    meta: SongMeta;
    song: Song;
    patterns: Pattern[];
    instruments: Instrument[];
    transport: { bpm: number; speed: number; loopSong: boolean };
    mutes: boolean[];
    solos: boolean[];
    midiMessages?: MidiMessage[];
    clips?: Clip[];
    arpSequences?: ArpSequence[];
  }) => void;
}

export const useStore = create<Store>((set, get) => {
  // ---- undo/redo helpers ----
  const snap = (): UndoSnapshot => {
    const s = get();
    return { patterns: s.patterns, song: s.song, instruments: s.instruments };
  };

  /**
   * Drop-in replacement for set() that captures a snapshot *before* the
   * update and prepends it to _undoStack (capped at 50), clearing _redoStack.
   */
  const withUndo = (fn: (s: Store) => Partial<Store>): void => {
    const snapshot = snap();
    set((s) => ({
      ...fn(s),
      _undoStack: [snapshot, ...s._undoStack].slice(0, 50),
      _redoStack: [],
    }));
  };

  return {
  _undoStack: [],
  _redoStack: [],
  canUndo: () => get()._undoStack.length > 0,
  canRedo: () => get()._redoStack.length > 0,
  undo: () => {
    const s = get();
    if (s._undoStack.length === 0) return;
    const [top, ...rest] = s._undoStack;
    const current = snap();
    set({
      ...top,
      _undoStack: rest,
      _redoStack: [current, ...s._redoStack],
    });
  },
  redo: () => {
    const s = get();
    if (s._redoStack.length === 0) return;
    const [top, ...rest] = s._redoStack;
    const current = snap();
    set({
      ...top,
      _undoStack: [current, ...s._undoStack],
      _redoStack: rest,
    });
  },

  meta: initialSongMeta,
  song: makeInitialSong(),
  patterns: makeInitialPatterns(),
  instruments: makeInitialInstruments(),
  trackFlags: makeInitialTrackFlags(),
  clips: [],

  cursor: initialCursor,
  transport: initialTransport,

  bridge: initialBridge,
  ports: [],
  selectedOutPortId: null,

  selectedInstrument: 1,
  rightPanel: 'instruments',
  songJumpVersion: 0,

  range: null,
  copyBuffer: null,
  blockClipboard: null,
  trackClipboard: null,
  progKeys: Array(10).fill(null),

  noteNaming: 'B' as 'B' | 'H',
  visibleTracks: 16,
  drumConfig: makeDefaultDrumConfig(),

  // ── Clip library ────────────────────────────────────────────────────────────

  createClipFromRange: (name) => {
    const { range, clips } = get();
    const pat = get().activePattern();
    if (!range || !pat) return null;
    const { startRow, endRow, startCh, endCh } = range;
    const rows: PatternCell[][] = [];
    for (let r = startRow; r <= endRow; r++) {
      const rowCells: PatternCell[] = [];
      for (let c = startCh; c <= endCh; c++) {
        rowCells.push({ ...pat.rows[r]![c]! });
      }
      rows.push(rowCells);
    }
    const id = String(Date.now());
    const color = CLIP_COLORS[clips.length % CLIP_COLORS.length]!;
    const chCount = endCh - startCh + 1;
    const tileRows = endRow - startRow + 1;
    const newClip: Clip = { id, name, color, rows };
    // Replace the source cells with a clip placement
    const placement: ClipPlacement = {
      id: `${id}_p0`,
      clipId: id,
      startCh,
      startRow,
      channelMask: Array(chCount).fill(true),
      tileRows,
    };
    set((s) => ({
      clips: [...s.clips, newClip],
      patterns: s.patterns.map((p) => {
        if (p.id !== pat.id) return p;
        // Clear the original cells so they don't show through when the clip is moved.
        const newRows = p.rows.map((row, r) => {
          if (r < startRow || r > endRow) return row;
          return row.map((cell, c) =>
            c >= startCh && c <= endCh ? emptyCell() : cell
          );
        });
        return {
          ...p,
          rows: newRows,
          clipPlacements: [...(p.clipPlacements ?? []), placement],
        };
      }),
    }));
    return id;
  },

  addClipPlacement: (patternId, placement) => {
    const id = `${placement.clipId}_p${Date.now()}`;
    set((s) => ({
      patterns: s.patterns.map((p) =>
        p.id !== patternId ? p : {
          ...p,
          clipPlacements: [...(p.clipPlacements ?? []), { ...placement, id }],
        }
      ),
    }));
  },

  removeClipPlacement: (patternId, placementId) => {
    set((s) => ({
      patterns: s.patterns.map((p) => {
        if (p.id !== patternId) return p;
        const placement = (p.clipPlacements ?? []).find((pl) => pl.id === placementId);
        if (!placement) return { ...p, clipPlacements: (p.clipPlacements ?? []).filter((pl) => pl.id !== placementId) };
        // Clear the cells at the placement's current position so they don't
        // bleed through after the placement is removed.
        const newRows = p.rows.map((row, r) => {
          if (r < placement.startRow || r >= placement.startRow + placement.tileRows) return row;
          return row.map((cell, c) => {
            const ci = c - placement.startCh;
            if (ci < 0 || ci >= placement.channelMask.length) return cell;
            if (!(placement.channelMask[ci] ?? true)) return cell;
            return emptyCell();
          });
        });
        return {
          ...p,
          rows: newRows,
          clipPlacements: (p.clipPlacements ?? []).filter((pl) => pl.id !== placementId),
        };
      }),
    }));
  },

  unlinkClipPlacement: (patternId, placementId) => {
    const { clips } = get();
    set((s) => ({
      patterns: s.patterns.map((p) => {
        if (p.id !== patternId) return p;
        const placement = (p.clipPlacements ?? []).find((pl) => pl.id === placementId);
        if (!placement) return p;
        const clip = clips.find((c) => c.id === placement.clipId);
        if (!clip) return { ...p, clipPlacements: (p.clipPlacements ?? []).filter((pl) => pl.id !== placementId) };
        // Copy clip data into pattern rows
        const newRows = p.rows.map((row) => row.map((cell) => ({ ...cell })));
        for (let ri = 0; ri < placement.tileRows; ri++) {
          const absRow = placement.startRow + ri;
          if (absRow >= newRows.length) break;
          const clipRow = ri % clip.rows.length;
          for (let ci = 0; ci < clip.rows[clipRow]!.length; ci++) {
            if (!(placement.channelMask[ci] ?? true)) continue;
            const absCh = placement.startCh + ci;
            if (absCh >= CHANNELS) break;
            newRows[absRow]![absCh] = { ...clip.rows[clipRow]![ci]! };
          }
        }
        return {
          ...p,
          rows: newRows,
          clipPlacements: (p.clipPlacements ?? []).filter((pl) => pl.id !== placementId),
        };
      }),
    }));
  },

  deleteClip: (clipId) => {
    set((s) => ({
      clips: s.clips.filter((c) => c.id !== clipId),
      patterns: s.patterns.map((p) => {
        const toRemove = (p.clipPlacements ?? []).filter((pl) => pl.clipId === clipId);
        if (toRemove.length === 0) return p;
        // Clear cells at each placement's current position before removing.
        let rows = p.rows;
        for (const placement of toRemove) {
          rows = rows.map((row, r) => {
            if (r < placement.startRow || r >= placement.startRow + placement.tileRows) return row;
            return row.map((cell, c) => {
              const ci = c - placement.startCh;
              if (ci < 0 || ci >= placement.channelMask.length) return cell;
              if (!(placement.channelMask[ci] ?? true)) return cell;
              return emptyCell();
            });
          });
        }
        return {
          ...p,
          rows,
          clipPlacements: (p.clipPlacements ?? []).filter((pl) => pl.clipId !== clipId),
        };
      }),
    }));
  },

  copyClip: (clipId) => {
    const { clips } = get();
    const src = clips.find((c) => c.id === clipId);
    if (!src) return clipId;
    const id = String(Date.now());
    const color = CLIP_COLORS[clips.length % CLIP_COLORS.length]!;
    const newClip: Clip = {
      id,
      name: `${src.name} copy`,
      color,
      rows: src.rows.map((row) => row.map((cell) => ({ ...cell }))),
    };
    set((s) => ({ clips: [...s.clips, newClip] }));
    return id;
  },

  updateClip: (clipId, rows) => {
    set((s) => ({
      clips: s.clips.map((c) => c.id !== clipId ? c : { ...c, rows }),
    }));
  },

  renameClip: (clipId, name) => {
    set((s) => ({
      clips: s.clips.map((c) => c.id !== clipId ? c : { ...c, name }),
    }));
  },

  extendClipPlacement: (patternId, placementId, tileRows) => {
    set((s) => ({
      patterns: s.patterns.map((p) =>
        p.id !== patternId ? p : {
          ...p,
          clipPlacements: (p.clipPlacements ?? []).map((pl) =>
            pl.id !== placementId ? pl : { ...pl, tileRows }
          ),
        }
      ),
    }));
  },

  moveClipPlacement: (patternId, placementId, newStartRow, newStartCh) => {
    set((s) => ({
      patterns: s.patterns.map((p) => {
        if (p.id !== patternId) return p;
        const maxRow = Math.max(0, p.rows.length - 1);
        return {
          ...p,
          clipPlacements: (p.clipPlacements ?? []).map((pl) =>
            pl.id !== placementId ? pl : {
              ...pl,
              startRow: Math.max(0, Math.min(maxRow, newStartRow)),
              startCh:  Math.max(0, Math.min(CHANNELS - 1, newStartCh)),
            }
          ),
        };
      }),
    }));
  },

  setClipColor: (clipId, color) => {
    set((s) => ({
      clips: s.clips.map((c) => c.id !== clipId ? c : { ...c, color }),
    }));
  },

  setMeta: (m) => set((s) => ({ meta: { ...s.meta, ...m } })),

  patternById: (id) => get().patterns.find((p) => p.id === id),
  activePattern: () => {
    const s = get();
    const pid = s.song.positions[s.transport.songPos];
    if (pid == null) return undefined;
    return s.patterns.find((p) => p.id === pid);
  },

  addPattern: (afterPos) => {
    const snapshot = snap();
    const state = get();
    const nextId = (state.patterns.reduce((m, p) => Math.max(m, p.id), 0) || 0) + 1;
    const newPattern = makeEmptyPattern(nextId);
    const patterns = [...state.patterns, newPattern];
    let positions = state.song.positions;
    if (afterPos != null) {
      positions = [
        ...state.song.positions.slice(0, afterPos + 1),
        nextId,
        ...state.song.positions.slice(afterPos + 1),
      ];
    } else {
      positions = [...state.song.positions, nextId];
    }
    set((s) => ({
      patterns,
      song: { ...state.song, positions },
      _undoStack: [snapshot, ...s._undoStack].slice(0, 50),
      _redoStack: [],
    }));
    return nextId;
  },

  deletePattern: (id) =>
    withUndo((s) => {
      if (s.patterns.length <= 1) return {}; // never delete the last one
      const patterns = s.patterns.filter((p) => p.id !== id);
      const positions = s.song.positions.filter((pid) => pid !== id);
      const fallback = patterns[0]!.id;
      const safePositions = positions.length > 0 ? positions : [fallback];
      return { patterns, song: { ...s.song, positions: safePositions } };
    }),

  renamePattern: (id, name) =>
    set((s) => ({
      patterns: s.patterns.map((p) => (p.id === id ? { ...p, name } : p)),
    })),

  setSongPositions: (positions) => set((s) => ({ song: { ...s.song, positions } })),
  insertSongPosition: (index, patternId) =>
    withUndo((s) => ({
      song: {
        ...s.song,
        positions: [
          ...s.song.positions.slice(0, index),
          patternId,
          ...s.song.positions.slice(index),
        ],
        // Bump any markers whose insertion point is at or after the new slot.
        sectionMarkers: s.song.sectionMarkers.map((m) =>
          m.beforePos >= index ? { ...m, beforePos: m.beforePos + 1 } : m
        ),
      },
    })),
  removeSongPosition: (index) =>
    withUndo((s) => {
      const positions = s.song.positions.filter((_, i) => i !== index);
      if (!positions.length) return {};
      // Decrement markers after the removed slot; markers pointing at the removed
      // slot stay at the same index (they now appear before the next position).
      const sectionMarkers = s.song.sectionMarkers
        .map((m) => (m.beforePos > index ? { ...m, beforePos: m.beforePos - 1 } : m))
        .filter((m) => m.beforePos <= positions.length);
      return { song: { ...s.song, positions, sectionMarkers } };
    }),
  setSongPositionPattern: (index, patternId) =>
    withUndo((s) => {
      const positions = s.song.positions.slice();
      positions[index] = patternId;
      return { song: { ...s.song, positions } };
    }),
  setSongPos: (pos) =>
    set((s) => ({
      transport: {
        ...s.transport,
        songPos: Math.max(0, Math.min(s.song.positions.length - 1, pos)),
        row: 0,
      },
      // bump the version so the sequencer notices and reconciles
      songJumpVersion: s.songJumpVersion + 1,
    })),
  setLoopSong: (on) => set((s) => ({ transport: { ...s.transport, loopSong: on } })),
  setPatternLoop: (on) => set((s) => ({ transport: { ...s.transport, patternLoop: on } })),

  // ---------- section markers ----------

  insertSection: (beforePos, name) =>
    set((s) => {
      const label = name ?? `Section ${s.song.sectionMarkers.length + 1}`;
      const marker: SectionMarker = { beforePos, name: label };
      return {
        song: {
          ...s.song,
          sectionMarkers: [...s.song.sectionMarkers, marker],
        },
      };
    }),

  deleteSection: (markerIdx) =>
    set((s) => ({
      song: {
        ...s.song,
        sectionMarkers: s.song.sectionMarkers.filter((_, i) => i !== markerIdx),
      },
    })),

  renameSection: (markerIdx, name) =>
    set((s) => ({
      song: {
        ...s.song,
        sectionMarkers: s.song.sectionMarkers.map((m, i) =>
          i === markerIdx ? { ...m, name } : m
        ),
      },
    })),

  setCell: (row, channel, patch) =>
    withUndo((s) => {
      const active = s.song.positions[s.transport.songPos];
      if (active == null) return {};
      const patterns = s.patterns.map((p) => {
        if (p.id !== active) return p;
        const rows = p.rows.map((r, ri) => {
          if (ri !== row) return r;
          return r.map((c, ci) => (ci !== channel ? c : { ...c, ...patch }));
        });
        return { ...p, rows };
      });
      return { patterns };
    }),

  clearCell: (row, channel) =>
    withUndo((s) => {
      const active = s.song.positions[s.transport.songPos];
      if (active == null) return {};
      const patterns = s.patterns.map((p) => {
        if (p.id !== active) return p;
        const rows = p.rows.map((r, ri) => {
          if (ri !== row) return r;
          return r.map((c, ci) => (ci !== channel ? c : emptyCell()));
        });
        return { ...p, rows };
      });
      return { patterns };
    }),

  setCursor: (patch) => set((s) => ({ cursor: { ...s.cursor, ...patch } })),

  moveCursor: (drow, dcol) =>
    set((s) => {
      let { row, channel, field } = s.cursor;
      if (dcol !== 0) {
        let fieldFlat = channel * 7 + field + dcol;
        const total = CHANNELS * 7;
        fieldFlat = ((fieldFlat % total) + total) % total;
        channel = Math.floor(fieldFlat / 7);
        field = (fieldFlat % 7) as CursorState['field'];
      }
      if (drow !== 0) {
        // Wrap within the *active* pattern's actual row count, not a global constant.
        const pid = s.song.positions[s.transport.songPos];
        const patLen = (pid != null ? s.patterns.find((p) => p.id === pid)?.rows.length : undefined) ?? ROWS_PER_PATTERN;
        row = row + drow;
        if (row < 0) row = patLen - 1;
        if (row >= patLen) row = 0;
      }
      return { cursor: { ...s.cursor, row, channel, field } };
    }),

  setEditMode: (on) => set((s) => ({ cursor: { ...s.cursor, editMode: on } })),
  setChordMode: (on) => set((s) => ({ cursor: { ...s.cursor, chordMode: on } })),
  setOctave: (o) => set((s) => ({ cursor: { ...s.cursor, octave: Math.max(0, Math.min(8, o)) } })),

  // ---------- range / clipboard ----------

  setRange: (r) => set({ range: r }),

  extendRangeTo: (row, channel) =>
    set((s) => {
      const anchor = s.cursor;
      const startRow = Math.min(anchor.row, row);
      const endRow   = Math.max(anchor.row, row);
      const startCh  = Math.min(anchor.channel, channel);
      const endCh    = Math.max(anchor.channel, channel);
      return { range: { startRow, endRow, startCh, endCh } };
    }),

  rangeCopy: () =>
    set((s) => {
      const r = s.range;
      const pid = s.song.positions[s.transport.songPos];
      const pattern = pid != null ? s.patterns.find((p) => p.id === pid) : undefined;
      if (!r || !pattern) return {};
      const buf: PatternCell[][] = [];
      for (let row = r.startRow; row <= r.endRow; row++) {
        const out: PatternCell[] = [];
        for (let ch = r.startCh; ch <= r.endCh; ch++) {
          out.push({ ...(pattern.rows[row]?.[ch] ?? emptyCell()) });
        }
        buf.push(out);
      }
      return { copyBuffer: buf };
    }),

  rangeClear: () =>
    withUndo((s) => {
      const r = s.range;
      const pid = s.song.positions[s.transport.songPos];
      if (!r || pid == null) return {};
      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        const rows = p.rows.map((rowCells, ri) => {
          if (ri < r.startRow || ri > r.endRow) return rowCells;
          return rowCells.map((c, ci) =>
            ci < r.startCh || ci > r.endCh ? c : emptyCell()
          );
        });
        return { ...p, rows };
      });
      return { patterns };
    }),

  rangeCut: () => {
    get().rangeCopy();
    get().rangeClear();
  },

  rangeMove: (toStartRow, toStartCh) =>
    withUndo((s) => {
      const r = s.range;
      const pid = s.song.positions[s.transport.songPos];
      const pattern = pid != null ? s.patterns.find((p) => p.id === pid) : undefined;
      if (!r || !pattern) return {};
      const rows = r.endRow - r.startRow;
      const cols = r.endCh - r.startCh;
      const toEndRow = toStartRow + rows;
      const toEndCh  = toStartCh + cols;
      // Snapshot source cells.
      const buf: PatternCell[][] = [];
      for (let ri = r.startRow; ri <= r.endRow; ri++) {
        const row: PatternCell[] = [];
        for (let ci = r.startCh; ci <= r.endCh; ci++) {
          row.push({ ...(pattern.rows[ri]?.[ci] ?? emptyCell()) });
        }
        buf.push(row);
      }
      const newRows = pattern.rows.map((rowCells, ri) => {
        return rowCells.map((cell, ci) => {
          // Clear source (only if not overlapping with destination).
          const inSrc = ri >= r.startRow && ri <= r.endRow && ci >= r.startCh && ci <= r.endCh;
          const inDst = ri >= toStartRow && ri <= toEndRow && ci >= toStartCh && ci <= toEndCh;
          if (inDst) {
            const br = ri - toStartRow;
            const bc = ci - toStartCh;
            return { ...(buf[br]?.[bc] ?? emptyCell()) };
          }
          if (inSrc) return emptyCell();
          return cell;
        });
      });
      return {
        patterns: s.patterns.map((p) => p.id !== pid ? p : { ...p, rows: newRows }),
        range: { startRow: toStartRow, endRow: toEndRow, startCh: toStartCh, endCh: toEndCh },
      };
    }),

  rangePaste: () =>
    withUndo((s) => {
      const buf = s.copyBuffer;
      const pid = s.song.positions[s.transport.songPos];
      if (!buf || pid == null) return {};
      const baseRow = s.cursor.row;
      const baseCh  = s.cursor.channel;
      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        const rows = p.rows.map((rowCells, ri) => {
          const localRow = ri - baseRow;
          if (localRow < 0 || localRow >= buf.length) return rowCells;
          return rowCells.map((c, ci) => {
            const localCh = ci - baseCh;
            if (localCh < 0 || localCh >= buf[localRow]!.length) return c;
            return { ...buf[localRow]![localCh]! };
          });
        });
        return { ...p, rows };
      });
      return { patterns };
    }),

  rangeTransposeSemi: (delta) =>
    withUndo((s) => transposeRange(s, delta)),

  rangeTransposeOctave: (delta) =>
    withUndo((s) => transposeRange(s, delta * 12)),

  rangeSetCmd: (cmd, data) =>
    withUndo((s) => {
      const r = s.range;
      const pid = s.song.positions[s.transport.songPos];
      if (!r || pid == null) return {};
      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        const rows = p.rows.map((rowCells, ri) => {
          if (ri < r.startRow || ri > r.endRow) return rowCells;
          return rowCells.map((c, ci) =>
            ci < r.startCh || ci > r.endCh ? c : { ...c, cmd, data }
          );
        });
        return { ...p, rows };
      });
      return { patterns };
    }),

  rangeVolFade: () =>
    withUndo((s) => {
      const r = s.range;
      const pid = s.song.positions[s.transport.songPos];
      const pattern = pid != null ? s.patterns.find((p) => p.id === pid) : undefined;
      if (!r || !pattern) return {};
      // Find first and last rows in range with cmd === 0xC; interpolate between.
      let firstVolRow = -1, lastVolRow = -1, firstVol = 0, lastVol = 0;
      for (let row = r.startRow; row <= r.endRow; row++) {
        for (let ch = r.startCh; ch <= r.endCh; ch++) {
          const cell = pattern.rows[row]?.[ch];
          if (cell?.cmd === 0xc) {
            if (firstVolRow === -1) { firstVolRow = row; firstVol = cell.data; }
            lastVolRow = row; lastVol = cell.data;
          }
        }
      }
      if (firstVolRow < 0 || lastVolRow <= firstVolRow) return {};
      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        const rows = p.rows.map((rowCells, ri) => {
          if (ri <= firstVolRow || ri >= lastVolRow) return rowCells;
          const t = (ri - firstVolRow) / (lastVolRow - firstVolRow);
          const v = Math.round(firstVol + (lastVol - firstVol) * t);
          return rowCells.map((c, ci) => {
            if (ci < r.startCh || ci > r.endCh) return c;
            // Only write a 0C command if the cell is otherwise unused.
            if (c.cmd !== 0 || c.data !== 0) return c;
            return { ...c, cmd: 0xc, data: Math.max(0, Math.min(0x40, v)) };
          });
        });
        return { ...p, rows };
      });
      return { patterns };
    }),

  rangeEcho: (distance, minVol) =>
    withUndo((s) => {
      const r = s.range;
      const pid = s.song.positions[s.transport.songPos];
      const pattern = pid != null ? s.patterns.find((p) => p.id === pid) : undefined;
      if (!r || !pattern || distance < 1) return {};
      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        const rows = p.rows.map((rowCells) => rowCells.slice());
        for (let row = r.startRow; row <= r.endRow; row++) {
          for (let ch = r.startCh; ch <= r.endCh; ch++) {
            const cell = pattern.rows[row]?.[ch];
            if (!cell || cell.note === 0) continue;
            let echoRow = row + distance;
            let vol = 0x20; // start echo at half of 0x40
            while (echoRow <= r.endRow && vol >= minVol) {
              const dest = rows[echoRow]?.[ch];
              // Only overwrite empty cells (the manual notes echo only fills
              // empty positions).
              if (dest && dest.note === 0 && dest.cmd === 0 && dest.data === 0) {
                rows[echoRow]![ch] = {
                  note: cell.note,
                  instrument: cell.instrument,
                  cmd: 0xc,
                  data: vol,
                };
              }
              echoRow += distance;
              vol = Math.floor(vol / 2);
            }
          }
        }
        return { ...p, rows };
      });
      return { patterns };
    }),

  rangePitchSlide: (mode, speed) =>
    withUndo((s) => {
      const r = s.range;
      const pid = s.song.positions[s.transport.songPos];
      const pattern = pid != null ? s.patterns.find((p) => p.id === pid) : undefined;
      if (!r || !pattern) return {};

      const speedByte = Math.max(1, Math.min(255, Math.round(speed))) & 0xff;
      const cmdByte = mode === '01' ? 0x01 : mode === '02' ? 0x02 : 0x03;

      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        // Clone the rows array (shallow); individual row arrays cloned per-channel below.
        const rows = p.rows.map((rowCells) => rowCells.slice()) as typeof p.rows;

        for (let ch = r.startCh; ch <= r.endCh; ch++) {
          // Find first and last rows that carry a note in this channel.
          let firstRow = -1, lastRow = -1;
          for (let ri = r.startRow; ri <= r.endRow; ri++) {
            const cell = rows[ri]?.[ch];
            if (cell && cell.note !== 0) {
              if (firstRow === -1) firstRow = ri;
              lastRow = ri;
            }
          }
          // Need at least two distinct notes to create a slide.
          if (firstRow < 0 || lastRow <= firstRow) continue;

          for (let ri = firstRow; ri <= lastRow; ri++) {
            const rowArr = rows[ri]!.slice() as typeof rows[0];
            const cell = rowArr[ch]!;

            if (mode === '03') {
              if (ri === firstRow) {
                // Source pitch cell — leave note & existing effect untouched.
                // (The note is what the sequencer will slide *from*.)
              } else if (ri === lastRow) {
                // Target note: keep note, write cmd 03 + speed.
                rowArr[ch] = { ...cell, cmd: cmdByte, data: speedByte };
                rows[ri] = rowArr;
              } else {
                // Intermediate: no note (continue slide), keep cmd 03 + speed.
                rowArr[ch] = { ...cell, note: 0, cmd: cmdByte, data: speedByte };
                rows[ri] = rowArr;
              }
            } else {
              // 01 / 02: only fill cells that have no note.
              if (ri > firstRow && ri < lastRow && cell.note === 0) {
                rowArr[ch] = { ...cell, cmd: cmdByte, data: speedByte };
                rows[ri] = rowArr;
              }
            }
          }
        }
        return { ...p, rows };
      });
      return { patterns };
    }),

  rangePasteChOffset: (chOffset) =>
    withUndo((s) => {
      const buf = s.copyBuffer;
      const pid = s.song.positions[s.transport.songPos];
      if (!buf || pid == null) return {};
      const baseRow = s.cursor.row;
      const baseCh  = s.cursor.channel + chOffset;
      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        const rows = p.rows.map((rowCells, ri) => {
          const localRow = ri - baseRow;
          if (localRow < 0 || localRow >= buf.length) return rowCells;
          return rowCells.map((c, ci) => {
            const localCh = ci - baseCh;
            if (localCh < 0 || localCh >= buf[localRow]!.length) return c;
            return { ...buf[localRow]![localCh]! };
          });
        });
        return { ...p, rows };
      });
      return { patterns };
    }),

  rangeSpread: (n) =>
    withUndo((s) => {
      const r = s.range;
      const pid = s.song.positions[s.transport.songPos];
      const pattern = pid != null ? s.patterns.find((p) => p.id === pid) : undefined;
      if (!r || !pattern || n < 2) return {};

      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        const rows = p.rows.map((rowCells) => rowCells.slice()) as typeof p.rows;

        // Collect all triggered notes in the range across all selected channels,
        // ordered by row then channel.
        const notes: Array<{ row: number; srcCh: number; cell: PatternCell }> = [];
        for (let ri = r.startRow; ri <= r.endRow; ri++) {
          for (let ch = r.startCh; ch <= r.endCh; ch++) {
            const cell = rows[ri]?.[ch];
            if (cell && cell.note !== 0) notes.push({ row: ri, srcCh: ch, cell: { ...cell } });
          }
        }

        // Clear all notes from range first.
        for (const { row, srcCh } of notes) {
          const rowArr = rows[row]!.slice() as typeof rows[0];
          rowArr[srcCh] = emptyCell();
          rows[row] = rowArr;
        }

        // Redistribute cyclically across n channels starting from startCh.
        for (let i = 0; i < notes.length; i++) {
          const { row, cell } = notes[i]!;
          const destCh = r.startCh + (i % n);
          if (destCh >= CHANNELS) continue;
          const rowArr = rows[row]!.slice() as typeof rows[0];
          rowArr[destCh] = cell;
          rows[row] = rowArr;
        }

        return { ...p, rows };
      });
      return { patterns };
    }),

  setProgKey: (slot, val) =>
    set((s) => {
      const progKeys = s.progKeys.slice();
      progKeys[slot] = val;
      return { progKeys };
    }),

  // ---------- block ops ----------

  splitBlockAt: (atRow) =>
    withUndo((s) => {
      const pid = s.song.positions[s.transport.songPos];
      const idx = s.patterns.findIndex((p) => p.id === pid);
      const orig = s.patterns[idx]!;
      const patLen = orig.rows.length;
      if (idx < 0 || atRow <= 0 || atRow >= patLen) return {};
      const nextId = (s.patterns.reduce((m, p) => Math.max(m, p.id), 0) || 0) + 1;
      // Top half: rows 0..atRow-1, then padded empty.
      const topRows = orig.rows.map((rowCells, ri) =>
        ri < atRow ? rowCells : Array.from({ length: CHANNELS }, () => emptyCell())
      );
      // Bottom half: rows atRow..end shifted to start at row 0, then padded.
      const bottomRows = Array.from({ length: patLen }, (_, ri) => {
        const src = ri + atRow;
        return src < patLen
          ? orig.rows[src]!.map((c) => ({ ...c }))
          : Array.from({ length: CHANNELS }, () => emptyCell());
      });
      const top: Pattern    = { ...orig, rows: topRows };
      const bottom: Pattern = { id: nextId, name: `${orig.name}+`, rows: bottomRows, clipPlacements: [] };
      const patterns = [...s.patterns.slice(0, idx), top, ...s.patterns.slice(idx + 1), bottom];
      // Insert the new block id directly after the current song position.
      const sp = s.transport.songPos;
      const positions = [
        ...s.song.positions.slice(0, sp + 1),
        nextId,
        ...s.song.positions.slice(sp + 1),
      ];
      // Bump section markers that fall after the insertion point.
      const sectionMarkers = s.song.sectionMarkers.map((m) =>
        m.beforePos > sp ? { ...m, beforePos: m.beforePos + 1 } : m
      );
      return { patterns, song: { ...s.song, positions, sectionMarkers } };
    }),

  copyBlock: () =>
    set((s) => {
      const pid = s.song.positions[s.transport.songPos];
      const pat = s.patterns.find((p) => p.id === pid);
      if (!pat) return {};
      // Deep copy: each row is a new array of new cell objects.
      const blockClipboard = pat.rows.map((row) => row.map((c) => ({ ...c })));
      return { blockClipboard };
    }),

  pasteBlock: () =>
    withUndo((s) => {
      if (!s.blockClipboard) return {};
      const pid = s.song.positions[s.transport.songPos];
      if (pid == null) return {};
      const blockClipboard = s.blockClipboard;
      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        // Paste rows from clipboard; adopt clipboard's row count exactly.
        const rows = Array.from({ length: blockClipboard.length }, (_, ri) => {
          const srcRow = blockClipboard[ri];
          return Array.from({ length: CHANNELS }, (_, ci) =>
            srcRow?.[ci] != null ? { ...srcRow[ci]! } : emptyCell()
          );
        });
        return { ...p, rows };
      });
      return { patterns };
    }),

  copyTrack: (channel) =>
    set((s) => {
      const pid = s.song.positions[s.transport.songPos];
      const pat = s.patterns.find((p) => p.id === pid);
      if (!pat) return {};
      const trackClipboard = pat.rows.map((row) => ({ ...row[channel]! }));
      return { trackClipboard };
    }),

  pasteTrack: (channel) =>
    withUndo((s) => {
      if (!s.trackClipboard) return {};
      const pid = s.song.positions[s.transport.songPos];
      if (pid == null) return {};
      const clip = s.trackClipboard;
      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        const rows = p.rows.map((rowCells, ri) =>
          rowCells.map((c, ci) =>
            ci === channel && clip[ri] != null ? { ...clip[ri]! } : c
          )
        );
        return { ...p, rows };
      });
      return { patterns };
    }),

  replacePatternRows: (patternId, rows) =>
    withUndo((s) => ({
      patterns: s.patterns.map((p) =>
        p.id === patternId ? { ...p, rows } : p
      ),
    })),

  setPatternLength: (newLength) =>
    withUndo((s) => {
      const pid = s.song.positions[s.transport.songPos];
      if (pid == null) return {};
      const clamped = Math.max(1, Math.min(3200, newLength));
      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        const current = p.rows.length;
        let rows: PatternCell[][];
        if (clamped <= current) {
          rows = p.rows.slice(0, clamped);
        } else {
          rows = [
            ...p.rows,
            ...Array.from({ length: clamped - current }, () =>
              Array.from({ length: CHANNELS }, () => emptyCell())
            ),
          ];
        }
        return { ...p, rows };
      });
      // Clamp cursor row if it's now out of bounds.
      const cursorRow = Math.min(s.cursor.row, clamped - 1);
      return { patterns, cursor: { ...s.cursor, row: cursorRow } };
    }),

  // ---------- global ops ----------

  swapInstrumentGlobal: (fromIdx, toIdx, mode) =>
    withUndo((s) => {
      const patterns = s.patterns.map((p) => ({
        ...p,
        rows: p.rows.map((rowCells) =>
          rowCells.map((c) => {
            if (mode === 'delete' && c.instrument === fromIdx) {
              return emptyCell();
            }
            if (mode === 'change' && c.instrument === fromIdx) {
              return { ...c, instrument: toIdx };
            }
            if (mode === 'exchange') {
              if (c.instrument === fromIdx) return { ...c, instrument: toIdx };
              if (c.instrument === toIdx)   return { ...c, instrument: fromIdx };
            }
            return c;
          })
        ),
      }));
      return { patterns };
    }),

  reassignInBlock: (fromIdx, toIdx) =>
    withUndo((s) => {
      const pid = s.song.positions[s.transport.songPos];
      if (pid == null) return {};
      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        return {
          ...p,
          rows: p.rows.map((rowCells) =>
            rowCells.map((c) =>
              c.instrument === fromIdx ? { ...c, instrument: toIdx } : c
            )
          ),
        };
      });
      return { patterns };
    }),

  rangeNoteChange: (fromNote, toNote) =>
    withUndo((s) => {
      const pid = s.song.positions[s.transport.songPos];
      const pattern = pid != null ? s.patterns.find((p) => p.id === pid) : undefined;
      if (!pattern) return {};
      const r = s.range;
      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        const rows = p.rows.map((rowCells, ri) => {
          if (r && (ri < r.startRow || ri > r.endRow)) return rowCells;
          return rowCells.map((c, ci) => {
            if (r && (ci < r.startCh || ci > r.endCh)) return c;
            if (c.note === fromNote) return { ...c, note: toNote };
            return c;
          });
        });
        return { ...p, rows };
      });
      return { patterns };
    }),

  rangeNoteExchange: (noteA, noteB) =>
    withUndo((s) => {
      const pid = s.song.positions[s.transport.songPos];
      const pattern = pid != null ? s.patterns.find((p) => p.id === pid) : undefined;
      if (!pattern) return {};
      const r = s.range;
      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        const rows = p.rows.map((rowCells, ri) => {
          if (r && (ri < r.startRow || ri > r.endRow)) return rowCells;
          return rowCells.map((c, ci) => {
            if (r && (ci < r.startCh || ci > r.endCh)) return c;
            if (c.note === noteA) return { ...c, note: noteB };
            if (c.note === noteB) return { ...c, note: noteA };
            return c;
          });
        });
        return { ...p, rows };
      });
      return { patterns };
    }),

  playTranspose: 0,
  setPlayTranspose: (semitones) =>
    set({ playTranspose: Math.max(-24, Math.min(24, semitones)) }),

  midiMessages: Array.from({ length: 16 }, (_, i): MidiMessage => ({
    name: `MSG ${String(i).padStart(2, '0')}`,
    bytes: [],
  })),
  setMidiMessage: (index, msg) =>
    set((s) => {
      const midiMessages = s.midiMessages.slice();
      midiMessages[index] = msg;
      return { midiMessages };
    }),

  arpSequences: [],
  setArpSequence: (seq) =>
    set((s) => {
      const existing = s.arpSequences.findIndex((a) => a.id === seq.id);
      if (existing >= 0) {
        const next = s.arpSequences.slice();
        next[existing] = seq;
        return { arpSequences: next };
      }
      return { arpSequences: [...s.arpSequences, seq].sort((a, b) => a.id - b.id) };
    }),
  removeArpSequence: (id) =>
    set((s) => ({ arpSequences: s.arpSequences.filter((a) => a.id !== id) })),

  setTransport: (patch) => set((s) => ({ transport: { ...s.transport, ...patch } })),

  play: () => set((s) => ({ transport: { ...s.transport, playing: true } })),
  stop: () => set((s) => ({ transport: { ...s.transport, playing: false, row: 0 } })),
  togglePlay: () => {
    if (get().transport.playing) get().stop();
    else get().play();
  },

  setInstrument: (idx, inst) =>
    withUndo((s) => {
      const instruments = s.instruments.slice();
      instruments[idx] = inst;
      return { instruments };
    }),

  setSelectedInstrument: (idx) => set({ selectedInstrument: idx }),

  toggleMute: (t) =>
    set((s) => {
      const flags = s.trackFlags.slice();
      const cur = flags[t]!;
      flags[t] = { ...cur, mute: !cur.mute };
      return { trackFlags: flags };
    }),
  toggleSolo: (t) =>
    set((s) => {
      const flags = s.trackFlags.slice();
      const cur = flags[t]!;
      flags[t] = { ...cur, solo: !cur.solo };
      return { trackFlags: flags };
    }),
  clearSolo: () => set((s) => ({ trackFlags: s.trackFlags.map((f) => ({ ...f, solo: false })) })),
  isAudible: (t) => !get().trackFlags[t]?.mute,

  setBridge: (patch) => set((s) => ({ bridge: { ...s.bridge, ...patch } })),
  setPorts: (ports) => set({ ports }),
  setSelectedOutPort: (id) => set({ selectedOutPortId: id }),

  setRightPanel: (p) => set({ rightPanel: p }),

  insertRowAt: (row) =>
    withUndo((s) => {
      const pid = s.song.positions[s.transport.songPos];
      if (pid == null) return {};
      const blankRow = () => Array.from({ length: CHANNELS }, (): PatternCell => ({ note: 0, instrument: 0, cmd: 0, data: 0 }));
      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        const rows = p.rows.slice();
        rows.splice(row, 0, blankRow());
        rows.pop(); // drop last to keep length fixed
        return { ...p, rows };
      });
      return { patterns };
    }),

  deleteRowAt: (row) =>
    withUndo((s) => {
      const pid = s.song.positions[s.transport.songPos];
      if (pid == null) return {};
      const blankRow = () => Array.from({ length: CHANNELS }, (): PatternCell => ({ note: 0, instrument: 0, cmd: 0, data: 0 }));
      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        const rows = p.rows.slice();
        rows.splice(row, 1);
        rows.push(blankRow());
        return { ...p, rows };
      });
      return { patterns };
    }),

  insertRowsAt: (row, count) =>
    withUndo((s) => {
      const pid = s.song.positions[s.transport.songPos];
      if (pid == null) return {};
      const blankRow = () => Array.from({ length: CHANNELS }, (): PatternCell => ({ note: 0, instrument: 0, cmd: 0, data: 0 }));
      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        const rows = p.rows.slice();
        const blanks = Array.from({ length: count }, blankRow);
        rows.splice(row, 0, ...blanks);
        rows.length = p.rows.length; // trim back to original length
        return { ...p, rows };
      });
      return { patterns };
    }),

  deleteRowsAt: (row, count) =>
    withUndo((s) => {
      const pid = s.song.positions[s.transport.songPos];
      if (pid == null) return {};
      const blankRow = () => Array.from({ length: CHANNELS }, (): PatternCell => ({ note: 0, instrument: 0, cmd: 0, data: 0 }));
      const patterns = s.patterns.map((p) => {
        if (p.id !== pid) return p;
        const rows = p.rows.slice();
        rows.splice(row, count);
        const blanks = Array.from({ length: count }, blankRow);
        rows.push(...blanks);
        return { ...p, rows };
      });
      return { patterns };
    }),

  flushInstrument: (idx) =>
    withUndo((s) => {
      const instruments = s.instruments.slice();
      instruments[idx] = { kind: 'empty', name: '--' };
      return { instruments };
    }),

  flushUnused: () =>
    withUndo((s) => {
      const used = new Set<number>();
      for (const pat of s.patterns) {
        for (const row of pat.rows) {
          for (const cell of row) {
            if (cell.instrument !== 0) used.add(cell.instrument);
          }
        }
      }
      const instruments = s.instruments.map((inst, idx) => {
        if (inst.kind === 'empty') return inst;
        if (used.has(idx)) return inst;
        return { kind: 'empty' as const, name: '--' };
      });
      return { instruments };
    }),

  setNoteNaming: (v) => set({ noteNaming: v }),

  setVisibleTracks: (n) => set({ visibleTracks: n }),

  instHighlight: true,
  setInstHighlight: (v) => set({ instHighlight: v }),

  instCounts: true,
  setInstCounts: (v) => set({ instCounts: v }),

  // ---------- volume mixer ----------
  trackVolumes: Array.from({ length: CHANNELS }, () => 100),
  setTrackVolume: (ch, vol) => set((s) => {
    const next = s.trackVolumes.slice();
    next[ch] = Math.max(0, Math.min(100, vol));
    return { trackVolumes: next };
  }),
  resetTrackVolumes: () => set({ trackVolumes: Array.from({ length: CHANNELS }, () => 100) }),

  // ---------- drum machine ----------

  setDrumConfig: (cfg) => set({ drumConfig: cfg }),

  setDrumVoice: (voiceIdx, patch) =>
    set((s) => {
      const voices = s.drumConfig.voices.slice();
      voices[voiceIdx] = { ...voices[voiceIdx]!, ...patch };
      return { drumConfig: { ...s.drumConfig, voices } };
    }),

  setPatCell: (patId, row, channel, patch) =>
    withUndo((s) => {
      const patterns = s.patterns.map((p) => {
        if (p.id !== patId) return p;
        const rows = p.rows.map((r, ri) => {
          if (ri !== row) return r;
          return r.map((c, ci) => (ci !== channel ? c : { ...c, ...patch }));
        });
        return { ...p, rows };
      });
      return { patterns };
    }),

  clearPatCell: (patId, row, channel) =>
    withUndo((s) => {
      const patterns = s.patterns.map((p) => {
        if (p.id !== patId) return p;
        const rows = p.rows.map((r, ri) => {
          if (ri !== row) return r;
          return r.map((c, ci) => (ci !== channel ? c : emptyCell()));
        });
        return { ...p, rows };
      });
      return { patterns };
    }),

  loadFromJson: (f) =>
    set((s) => ({
      meta: f.meta,
      song: { ...f.song, sectionMarkers: f.song.sectionMarkers ?? [] },
      patterns: f.patterns,
      instruments: f.instruments,
      transport: {
        ...initialTransport,
        bpm: f.transport.bpm,
        speed: f.transport.speed,
        loopSong: f.transport.loopSong,
      },
      trackFlags: Array.from({ length: CHANNELS }, (_, i) => ({
        mute: !!f.mutes[i],
        solo: false,   // solo removed — always load as false
      })),
      // Merge saved midiMessages on top of the default 16 slots (backward-compat).
      midiMessages: f.midiMessages
        ? Array.from({ length: 16 }, (_, i) => f.midiMessages![i] ?? s.midiMessages[i])
        : s.midiMessages,
      clips: f.clips ?? [],
      arpSequences: f.arpSequences ?? [],
    })),
  }; // end of returned store object
}); // end of create<Store>

/** Convenience hook: get the currently active pattern reactively. */
export function useActivePattern(): Pattern | undefined {
  return useStore((s) => {
    const pid = s.song.positions[s.transport.songPos];
    if (pid == null) return undefined;
    return s.patterns.find((p) => p.id === pid);
  });
}
