// Note utilities: MIDI <-> human readable, qwerty -> note maps.

const NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

/**
 * ModeCat hold symbol: sustain the previous note without retriggering.
 * Stored as note value 254 (0xFE) in pattern cells, displayed as "-|-".
 */
export const NOTE_HOLD = 254;

/**
 * ModeCat stop-note symbol: immediately cut the sounding note on this channel.
 * Stored as note value 253 (0xFD) in pattern cells, displayed as "-X-".
 * The sequencer treats this identically to cmd=0x0F/data=0xFF (stopNote).
 */
export const NOTE_OFF = 253;

/** Current note naming convention. 'B' = standard, 'H' = European (B is called H). */
export let noteNaming: 'B' | 'H' = 'B';

/** Update the note naming mode (call when store value changes). */
export function setNoteNamingMode(v: 'B' | 'H'): void {
  noteNaming = v;
}

/** Format a MIDI note 0..127 as 3 chars (e.g. 60 -> "C-4"). 0 -> "---". 254 -> "-|-". 253 -> "-X-". */
export function formatNote(midi: number): string {
  if (midi === NOTE_HOLD) return '-|-';
  if (midi === NOTE_OFF)  return '-X-';
  if (midi <= 0) return '---';
  const name = NAMES[midi % 12];
  const octave = Math.max(0, Math.floor(midi / 12) - 1);
  const raw = `${name}${octave}`;
  return noteNaming === 'H' ? raw.replace('B-', 'H-') : raw;
}

/** Hex byte 0..255 -> 2-char uppercase. */
export function hex2(n: number): string {
  return n.toString(16).toUpperCase().padStart(2, '0');
}
/** Hex nibble 0..15 -> 1 char. */
export function hex1(n: number): string {
  return (n & 0xf).toString(16).toUpperCase();
}

/**
 * Two-row qwerty piano, like every tracker since the dawn of time.
 *   Lower octave:  Z S X D C V G B H N J M , L .
 *   Upper octave:  Q 2 W 3 E R 5 T 6 Y 7 U I 9 O 0 P
 * The "offset" is added to (octave * 12 + 12) to get the MIDI note number.
 */
export const KEYMAP_LOWER: Record<string, number> = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11,
  ',': 12, l: 13, '.': 14,
};
export const KEYMAP_UPPER: Record<string, number> = {
  q: 12, '2': 13, w: 14, '3': 15, e: 16, r: 17, '5': 18, t: 19, '6': 20, y: 21,
  '7': 22, u: 23, i: 24, '9': 25, o: 26, '0': 27, p: 28,
};

/** Hex digit char -> 0..15, or -1 if not a hex digit. */
export function hexCharToValue(ch: string): number {
  const c = ch.toLowerCase();
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48;
  if (c >= 'a' && c <= 'f') return c.charCodeAt(0) - 87;
  return -1;
}
