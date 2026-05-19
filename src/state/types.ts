// Domain types for ModeCat v1.0.
//
//   * 16 tracks per pattern (was 8 in the v1 build).
//   * Multiple named patterns, indexed by id, referenced by a Song playlist.
//   * Per-track mute/solo flags.
//   * Three instrument kinds: sample, midi, synth (plus 'empty').
//   * Synth = 32-step single-cycle waveform + AHDSR envelope.
//
// The pattern cell shape itself stays the same as in v1 — { note, instrument,
// cmd, data } — because we deliberately did NOT add a volume column
// this pass. The expanded effect set can be layered in later without a
// schema change.

export const CHANNELS = 16;
export const ROWS_PER_PATTERN = 64;
export const MAX_INSTRUMENTS = 32;


/** A note as a MIDI note number (12 = C-0, 60 = C-4). 0 means "empty". */
export type NoteValue = number;

export interface PatternCell {
  note: NoteValue;
  instrument: number; // slot 1..MAX_INSTRUMENTS, 0 = "use previous"
  cmd: number;        // effect command byte 0..255 (widened from nibble in v2)
  data: number;       // effect data byte 0..255
}

// ── Clip system ───────────────────────────────────────────────────────────────

export const CLIP_COLORS = [
  '#4488FF', '#FF8844', '#44CC88', '#CC44CC',
  '#FFCC44', '#44CCCC', '#FF4488', '#88CC44',
];

/** A reusable, named block of pattern data. Independent of any pattern. */
export interface Clip {
  id: string;
  name: string;
  color: string;
  rows: PatternCell[][]; // [row][channel] — channel count = rows[0].length
}

/** A reference to a Clip placed into a specific region of a Pattern. */
export interface ClipPlacement {
  id: string;          // unique placement id (within the pattern)
  clipId: string;
  startCh: number;     // 0-based first channel
  startRow: number;    // 0-based first row
  /** Which clip channels are active. Length = clip channel count. true = use clip data. */
  channelMask: boolean[];
  /** Total rows this placement occupies. May exceed clip row count — content tiles. */
  tileRows: number;
}

export interface Pattern {
  id: number;
  name: string;
  rows: PatternCell[][]; // [row][channel]
  clipPlacements: ClipPlacement[];
}

export type InstrumentKind = 'sample' | 'midi' | 'synth' | 'empty';

export interface SampleInstrument {
  kind: 'sample';
  name: string;
  pcm: Float32Array | null;
  sampleRate: number;
  baseNote: number;
  loopEnabled: boolean; // true = AudioBufferSourceNode loops between loopStart..loopEnd
  loopStart: number;    // loop start offset in samples
  loopEnd: number;      // loop end offset in samples (0 = end of buffer)
  volume: number; // 0..127
  transpose: number; // semitones, displayed as "0/0" (positive/negative)
  finetune: number;  // -8..+7 (fine tune in 1/8-semitone units)
  defaultPitch: number; // 0..127 (default entry pitch for F-key shortcut)
  suppressNoteOff: boolean; // when true, instrument ignores note-off events (one-shot percussion)
  // AHDSR envelope (optional — all zero = legacy hard-cut behaviour)
  attackMs:   number; // 0..2000 ms
  decayMs:    number; // 0..2000 ms
  sustain:    number; // 0..1  (fraction of peak volume)
  releaseMs:  number; // 0..4000 ms
  lengthRows: number; // sustain hold in rows (0 = play until next note)
}

export interface MidiInstrument {
  kind: 'midi';
  name: string;
  channel: number;     // 0..15
  program: number;     // 0..127, or -1 to suppress program changes
  velocity: number;    // default velocity if cell has no override
  lengthRows: number;  // note-off issued this many rows after note-on
  transpose: number;   // semitone offset
  finetune: number;    // -8..+7
  defaultPitch: number; // 0..127
  suppressNoteOff: boolean;
}

// ── Synth pitch program ────────────────────────────────────────────────────

/**
 * One line of the synth pitch program. Executed per-waveform-cycle during
 * playback. Forward-compatible with B08 (CHU/CHD/WAI) and B09/B10 (VBD/VBS/ARP).
 */
export type PitchProgLine =
  | { op: 'wave'; idx: number }          // 00-FF: select waveform at index
  | { op: 'jmp';  target: number }       // JMP n: jump to line n (0-based)
  | { op: 'end' }                        // END / HLT: halt program
  | { op: 'chu';  speed: number }        // CHU n: volume up n per tick (B08)
  | { op: 'chd';  speed: number }        // CHD n: volume down n per tick (B08)
  | { op: 'wai';  ticks: number }        // WAI n: wait n ticks (B08)
  | { op: 'vbd';  depth: number }        // VBD n: vibrato depth (B09)
  | { op: 'vbs';  speed: number }        // VBS n: vibrato speed (B09)
  | { op: 'arp';  offsets: number[] }    // ARP o1 o2 … ARE: arpeggio (B10)
  ;

/** Parse a pitch-program text representation into structured lines. */
export function parsePitchProg(text: string): PitchProgLine[] {
  return text.split('\n').flatMap((raw) => {
    const line = raw.trim().toUpperCase();
    if (!line || line.startsWith(';')) return [];
    if (line === 'END' || line === 'HLT') return [{ op: 'end' } as PitchProgLine];
    const jmp = line.match(/^JMP\s+(\d+)$/);
    if (jmp) return [{ op: 'jmp', target: parseInt(jmp[1]!, 10) }];
    const chu = line.match(/^CHU\s+([0-9A-F]+)$/);
    if (chu) return [{ op: 'chu', speed: parseInt(chu[1]!, 16) }];
    const chd = line.match(/^CHD\s+([0-9A-F]+)$/);
    if (chd) return [{ op: 'chd', speed: parseInt(chd[1]!, 16) }];
    const wai = line.match(/^WAI\s+([0-9A-F]+)$/);
    if (wai) return [{ op: 'wai', ticks: parseInt(wai[1]!, 16) }];
    const vbd = line.match(/^VBD\s+([0-9A-F]+)$/);
    if (vbd) return [{ op: 'vbd', depth: parseInt(vbd[1]!, 16) }];
    const vbs = line.match(/^VBS\s+([0-9A-F]+)$/);
    if (vbs) return [{ op: 'vbs', speed: parseInt(vbs[1]!, 16) }];
    // ARP o1 o2 … ARE
    const arpM = line.match(/^ARP\s+(.+)\s+ARE$/);
    if (arpM) {
      const offsets = arpM[1]!.trim().split(/\s+/).map((t) => parseInt(t, 16));
      return [{ op: 'arp', offsets }];
    }
    // Bare hex (00-FF) = wave index
    const hex = line.match(/^([0-9A-F]{1,2})$/);
    if (hex) return [{ op: 'wave', idx: parseInt(hex[1]!, 16) }];
    return []; // ignore unknown
  });
}

/** Serialise a pitch program back to text. */
export function pitchProgToText(prog: PitchProgLine[]): string {
  return prog.map((l) => {
    switch (l.op) {
      case 'wave': return l.idx.toString(16).toUpperCase().padStart(2, '0');
      case 'jmp':  return `JMP ${l.target}`;
      case 'end':  return 'END';
      case 'chu':  return `CHU ${l.speed.toString(16).toUpperCase().padStart(2, '0')}`;
      case 'chd':  return `CHD ${l.speed.toString(16).toUpperCase().padStart(2, '0')}`;
      case 'wai':  return `WAI ${l.ticks.toString(16).toUpperCase().padStart(2, '0')}`;
      case 'vbd':  return `VBD ${l.depth.toString(16).toUpperCase().padStart(2, '0')}`;
      case 'vbs':  return `VBS ${l.speed.toString(16).toUpperCase().padStart(2, '0')}`;
      case 'arp':  return `ARP ${l.offsets.map((o) => o.toString(16).toUpperCase().padStart(2, '0')).join(' ')} ARE`;
    }
  }).join('\n');
}

/** Multi-waveform synth + AHDSR envelope + pitch program + volume program. */
export interface SynthInstrument {
  kind: 'synth';
  name: string;
  /**
   * Array of 32-sample waveforms. Index 0 is the default.
   * Replaces the old single `waveform` field (migrated on load).
   */
  waveforms: Float32Array[];
  /**
   * Pitch program instructions, executed once per waveform cycle during
   * playback. Empty = loop waveform 0 for the note's duration.
   * Recognised ops: wave (select waveform by index), jmp, end, vbd, vbs, arp.
   */
  pitchProg: PitchProgLine[];
  /**
   * How many waveform cycles before the pitch program advances one step.
   * Default 1 (advance every cycle). Higher values slow the program down.
   */
  waveSpeed: number;
  /**
   * Volume program instructions, executed per sequencer tick during playback.
   * Empty = fall back to AHDSR envelope.
   * Recognised ops: wave (bare-hex set-volume 0x00–0x40),
   *   chu (add n/tick), chd (subtract n/tick), wai (wait n ticks),
   *   jmp, end (halt — freeze at current volume).
   * Volume scale is 0–64 (0x40 = full), matching ModeCat's native range.
   */
  volProg: PitchProgLine[];
  /** Attack time in ms (used only when volProg is empty). */
  attackMs: number;
  /** Decay time in ms (used only when volProg is empty). */
  decayMs: number;
  /** Sustain level in [0, 1] (used only when volProg is empty). */
  sustain: number;
  /** Release time in ms (used only when volProg is empty). */
  releaseMs: number;
  /** Output volume 0..127 (master scale applied on top of volProg or AHDSR). */
  volume: number;
  /** MIDI note that plays the waveform at its "natural" pitch (default C-4). */
  baseNote: number;
  /** Note length in rows (for envelope / volume-program timing). */
  lengthRows: number;
  /** Semitone offset applied to all notes (displayed as "0/0"). */
  transpose: number;
  /** Finetune in -8..+7 (1/8-semitone units). */
  finetune: number;
  /** Default entry pitch for F-key shortcut (0..127). */
  defaultPitch: number;
  /** When true, instrument ignores note-off events (one-shot mode). */
  suppressNoteOff: boolean;
}

export interface EmptyInstrument {
  kind: 'empty';
  name: string;
}

/**
 * Hybrid instrument (#38): a PCM sample driven by the synth command system.
 * The sample plays at the note pitch (like a normal sample) but the volume
 * is shaped by a pitch program + AHDSR envelope (like a synth).  This gives
 * the "synth-sample" feel of ModeCat's HYBRID type — e.g. a single-cycle
 * wave with automated vibrato or volume swells without programming the tracker.
 */
export interface HybridInstrument {
  kind: 'hybrid';
  name: string;
  // ── Sample data (same as SampleInstrument) ───────────────────────────────
  pcm: Float32Array | null;
  sampleRate: number;
  baseNote: number;        // MIDI note at which the sample plays at 1× rate
  loopEnabled: boolean;
  loopStart: number;       // sample offset
  loopEnd: number;         // sample offset (0 = end of buffer)
  volume: number;          // 0..127
  transpose: number;       // semitones
  finetune: number;        // -8..+7
  suppressNoteOff: boolean;
  defaultPitch: number;
  // ── Synth envelope / program (same fields as SynthInstrument) ───────────
  pitchProg: PitchProgLine[];
  volProg: PitchProgLine[];
  attackMs: number;
  decayMs: number;
  sustain: number;         // 0..1
  releaseMs: number;
  lengthRows: number;
  waveSpeed: number;       // unused for hybrid, kept for interface symmetry
}

export type Instrument =
  | SampleInstrument
  | MidiInstrument
  | SynthInstrument
  | HybridInstrument
  | EmptyInstrument;

export interface TransportState {
  playing: boolean;
  recording: boolean;
  /** Current row within the active pattern, 0..ROWS_PER_PATTERN-1. */
  row: number;
  /** Index into `song.positions[]` of the currently playing position. */
  songPos: number;
  /** Active pattern index (mirrors song.positions[songPos], cached for UI). */
  patternIndex: number;
  speed: number;       // ticks per row, 1..15
  bpm: number;         // 20..255
  /** When true, song wraps from end back to position 0. Otherwise stops. */
  loopSong: boolean;
  /** When true, replay only the current pattern (ignore song advancement). */
  patternLoop: boolean;
}

export interface CursorState {
  row: number;
  channel: number;
  field: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  octave: number;
  editMode: boolean;
  /**
   * When true, typing a note in the note-field places it at the current cell
   * AND advances horizontally (next channel, same row) instead of vertically.
   * Approximates the manual's CHRD button (§"CHORD ENTERING AID" p. 64).
   */
  chordMode: boolean;
  /**
   * How many rows to advance after each note entry in Edit mode.
   * Matches ModeCat's "SPC=N" setting (1..16, default 1).
   * 0 = cursor stays on the same row (useful for chord building without chord
   * mode, or for overdubbing a single row repeatedly).
   */
  spc: number;
}

/** A rectangular selection inside the current pattern. */
export interface RangeSel {
  startRow: number;
  endRow: number;
  startCh: number;
  endCh: number;
}

export interface BridgeStatus {
  connected: boolean;
  url: string;
  serverVersion?: string;
  schedulingResolutionMs?: number;
  lastError?: string;
}

export interface MidiPort {
  id: string;
  name: string;
  direction: 'in' | 'out';
  isOpen: boolean;
}

export interface SongMeta {
  title: string;
  author: string;
}

/**
 * A named section divider in the song position list.
 * Appears as a labelled bar before position `beforePos` in the sequence.
 * Analogous to ModeCat V5's New Sec / New Sec Here / Delete Sec controls.
 */
export interface SectionMarker {
  /** Index in `positions[]` before which this section label appears. */
  beforePos: number;
  name: string;
}

/** A song = an ordered list of pattern ids, plus optional section dividers. */
export interface Song {
  positions: number[]; // each entry is a pattern id (NOT an index into patterns)
  sectionMarkers: SectionMarker[]; // named dividers interleaved into the position list
}

export interface TrackFlags {
  mute: boolean;
  solo: boolean;
}

export const emptyCell = (): PatternCell => ({
  note: 0,
  instrument: 0,
  cmd: 0,
  data: 0,
});

export const makeEmptyPattern = (
  id: number,
  name = `PAT ${String(id).padStart(2, '0')}`,
  /** Number of rows. Defaults to ROWS_PER_PATTERN (64). Range: 1–3200. */
  length = ROWS_PER_PATTERN,
): Pattern => ({
  id,
  name,
  rows: Array.from({ length }, () =>
    Array.from({ length: CHANNELS }, () => emptyCell())
  ),
  clipPlacements: [],
});

/** A reasonable default 32-step waveform (sawtooth-ish). */
export function defaultWaveform(): Float32Array {
  const w = new Float32Array(32);
  for (let i = 0; i < 32; i++) {
    w[i] = 1 - (2 * i) / 31; // 1 .. -1
  }
  return w;
}

/**
 * One named MIDI message slot — a sequence of raw bytes sent via the bridge
 * when triggered by a `10xx` effect command (xx = slot index 0..15).
 * The `bytes` array holds raw MIDI status + data bytes, e.g. [0xF0, 0x41, 0xF7]
 * for a Roland identity-request SysEx.  Empty bytes = no-op.
 */
export interface MidiMessage {
  name: string;
  bytes: number[];   // raw MIDI bytes, e.g. [0xB0, 0x07, 0x64]
}

/**
 * A user-defined arpeggio sequence, triggered by effect cmd 0x20+id.
 * Steps are semitone offsets from the base note, e.g. [0,3,7,12,7,3].
 * Advances one step per row while the note sustains.
 */
export interface ArpSequence {
  /** 0..15 — maps to effect cmd 0x20..0x2F displayed as "20".."2F". */
  id: number;
  name: string;
  /** Semitone offsets from triggered note, e.g. [0, 3, 7, 12]. */
  steps: number[];
  /** When true, sequence loops back to step 0 after the last step. */
  loop: boolean;
}

/** Song bundle for JSON round-trip. */
export interface SongFile {
  format: 'modecat';
  version: 1 | 2;
  meta: SongMeta;
  song: Song;
  patterns: Pattern[];
  /** Instruments are serialised with PCM / waveform as base64 strings. */
  instruments: SerialisedInstrument[];
  transport: { bpm: number; speed: number; loopSong: boolean };
  mutes: boolean[];
  solos: boolean[];
  /** Named MIDI message slots (16 slots, index = data byte of 10xx command). */
  midiMessages?: MidiMessage[];
  /** Reusable clip definitions. */
  clips?: Clip[];
  /** User-defined arpeggio sequences (cmd 0x20..0x2F). */
  arpSequences?: ArpSequence[];
}

// ── Drum machine ──────────────────────────────────────────────────────────────

/**
 * One voice in the drum machine.  Each voice maps to a dedicated tracker
 * channel (0-indexed) and fires its instrument whenever a step is active.
 */
export interface DrumVoice {
  /** Display label shown in the drum editor row header. */
  name: string;
  /** 0-indexed tracker channel (0..15). */
  channel: number;
  /** Instrument slot (1-based).  0 = unassigned. */
  instrument: number;
  /** MIDI note number fired for every active step. Default C-3 (48). */
  defaultNote: number;
  mute: boolean;
  solo: boolean;
  /** Output level 0..127. */
  level: number;
  /** Semitone detune −24..+24. */
  tune: number;
}

/**
 * Drum machine configuration stored in the project.
 * Voices are ordered top-to-bottom as they appear in the editor grid.
 */
export interface DrumConfig {
  voices: DrumVoice[];
  /** Step resolution — 16 or 32 steps per block. */
  stepCount: 16 | 32;
  /** Swing amount 0..100 (50 = straight). */
  swing: number;
}

/** Default drum voice layout — channels 8..15 (0-indexed), OctaMED style. */
export function makeDefaultDrumConfig(): DrumConfig {
  const voices: DrumVoice[] = [
    { name: 'BASS DRUM',  channel: 8,  instrument: 0, defaultNote: 48, mute: false, solo: false, level: 100, tune: 0 },
    { name: 'SNARE',      channel: 9,  instrument: 0, defaultNote: 48, mute: false, solo: false, level: 100, tune: 0 },
    { name: 'CLOSED HH',  channel: 10, instrument: 0, defaultNote: 48, mute: false, solo: false, level: 100, tune: 0 },
    { name: 'OPEN HH',    channel: 11, instrument: 0, defaultNote: 48, mute: false, solo: false, level: 100, tune: 0 },
    { name: 'HIGH TOM',   channel: 12, instrument: 0, defaultNote: 48, mute: false, solo: false, level: 100, tune: 0 },
    { name: 'MID TOM',    channel: 13, instrument: 0, defaultNote: 48, mute: false, solo: false, level: 100, tune: 0 },
    { name: 'LOW TOM',    channel: 14, instrument: 0, defaultNote: 48, mute: false, solo: false, level: 100, tune: 0 },
    { name: 'CLAP/RIM',   channel: 15, instrument: 0, defaultNote: 48, mute: false, solo: false, level: 100, tune: 0 },
  ];
  return { voices, stepCount: 16, swing: 50 };
}

export type SerialisedInstrument =
  | (Omit<SampleInstrument, 'pcm'> & { pcm: string | null })
  | (Omit<SynthInstrument, 'waveforms'> & {
      /** Array of base64-encoded waveforms (v3+). */
      waveforms: string[];
      /** Legacy single-waveform field (v1/v2). Migrated to waveforms[0] on load. */
      waveform?: string;
    })
  | (Omit<HybridInstrument, 'pcm'> & { pcm: string | null })
  | MidiInstrument
  | EmptyInstrument;
