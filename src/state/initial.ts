import {
  CHANNELS,
  MAX_INSTRUMENTS,
  makeEmptyPattern,
  type BridgeStatus,
  type CursorState,
  type Instrument,
  type Pattern,
  type Song,
  type SongMeta,
  type TrackFlags,
  type TransportState,
} from './types';

/** Build the default 32-slot instrument table — all empty slots. */
export function makeInitialInstruments(): Instrument[] {
  const list: Instrument[] = [];
  // Slot 0 is reserved (MED's "no change" semantics).
  list.push({ kind: 'empty', name: '--' });
  while (list.length < MAX_INSTRUMENTS) {
    list.push({ kind: 'empty', name: '--' });
  }
  return list;
}

export function makeInitialPatterns(): Pattern[] {
  return [makeEmptyPattern(1, 'BLOCK 01')];
}

export function makeInitialSong(): Song {
  return { positions: [1], sectionMarkers: [] };
}

export function makeInitialTrackFlags(): TrackFlags[] {
  return Array.from({ length: CHANNELS }, () => ({ mute: false, solo: false }));
}

export const initialTransport: TransportState = {
  playing: false,
  recording: false,
  row: 0,
  songPos: 0,
  patternIndex: 0, // we resolve to the actual pattern via the song
  speed: 6,
  bpm: 125,
  loopSong: true,
  patternLoop: false,
};

export const initialCursor: CursorState = {
  row: 0,
  channel: 0,
  field: 0,
  octave: 3,
  editMode: true,
  chordMode: false,
  spc: 1,
};

export const initialBridge: BridgeStatus = {
  connected: false,
  url: 'ws://127.0.0.1:38010/midi',
};

export const initialSongMeta: SongMeta = {
  title: 'UNTITLED',
  author: 'YOU',
};
