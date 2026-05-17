/**
 * midiImport.ts
 *
 * Parses a Standard MIDI File (Type 0 or 1) and maps it to ModeCat pattern
 * data.  Includes a byte-level SMF sanitizer that strips invalid system
 * messages and fixes chunk lengths, plus a tick-ceiling filter that discards
 * notes from corrupt delta-time regions.
 *
 * All sanitization steps are recorded in ImportResult.log so the UI can show
 * the user exactly what was repaired.
 */

import { parseMidi } from 'midi-file';
import type { PatternCell } from '../state/types';
import { emptyCell, CHANNELS } from '../state/types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ImportTrack {
  /** Index in the MIDI file (0-based). */
  index: number;
  /** Track name from the MIDI meta event, if present. */
  name: string;
  /** Primary MIDI channel used by notes in this track (0-based, 0–15). */
  midiChannel: number;
  /** Notes quantized to rows. */
  notes: ImportNote[];
  /** Raw note count before any tick-ceiling filtering. */
  rawNoteCount: number;
  /** Notes removed because their tick exceeded the ceiling. */
  filteredCount: number;
}

export interface ImportNote {
  /** Pattern row (after quantization). */
  row: number;
  /** MIDI pitch 0–127. */
  note: number;
  /** MIDI velocity 0–127. */
  velocity: number;
}

export interface ImportResult {
  /** Detected tempo in BPM (from first setTempo event, default 120). */
  bpm: number;
  /** Time-signature numerator (default 4). */
  timeSigNum: number;
  /** Time-signature denominator (default 4). */
  timeSigDen: number;
  /** PPQ from the MIDI header. */
  ppq: number;
  /** All non-empty tracks (percussion on channel 9 included). */
  tracks: ImportTrack[];
  /**
   * Total length in rows at the *suggested* rowsPerBeat.
   * Rounded up to the next complete bar.
   */
  totalRows: number;
  /**
   * Suggested rows-per-beat derived from the 16 vs 12 grid analysis.
   * 4 = 16th-note grid (16 rows/bar in 4/4).
   * 3 = 8th-note-triplet grid (12 rows/bar in 4/4).
   */
  suggestedRpb: number;
  /**
   * Suggested rows per musical bar (= suggestedRpb × timeSigNum).
   * 16 for 4/4 at 16th-note resolution; 12 for 4/4 at triplet resolution.
   */
  suggestedRowsPerBar: number;
  /**
   * Amiga-style terminal log lines describing every step of the import,
   * including sanitization actions and warnings.
   */
  log: string[];
}

// ---------------------------------------------------------------------------
// SMF byte-level sanitizer
// ---------------------------------------------------------------------------

// Number of data bytes that follow each system-common status byte (0xF1–0xF6).
const SYSCOMMON_DATA: Record<number, number> = {
  0xF1: 1, // MIDI Quarter Frame
  0xF2: 2, // Song Position Pointer
  0xF3: 1, // Song Select
  0xF4: 0, // Undefined
  0xF5: 0, // Undefined
  0xF6: 0, // Tune Request
};

// Human-readable names for bad byte types.
const BYTE_NAME: Record<number, string> = {
  0xF1: 'Quarter Frame',
  0xF2: 'Song Position Pointer',
  0xF3: 'Song Select',
  0xF4: 'Sys Common (undef)',
  0xF5: 'Sys Common (undef)',
  0xF6: 'Tune Request',
  0xF8: 'Timing Clock',
  0xF9: 'Realtime (undef)',
  0xFA: 'MIDI Start',
  0xFB: 'MIDI Continue',
  0xFC: 'MIDI Stop',
  0xFD: 'Realtime (undef)',
  0xFE: 'Active Sensing',
};

// Data-byte count per channel-voice message type (status nibble 0x8..0xE).
const VOICE_DATA: number[] = [2, 2, 2, 2, 1, 1, 2];

interface SanitizeResult {
  data: Uint8Array;
  log: string[];
}

/**
 * Strip invalid system-realtime and system-common bytes from every MTrk chunk
 * in an SMF byte array.  Adjusts each chunk's length field to match.
 *
 * Uses a proper running-status state machine so multi-byte removals don't
 * corrupt the surrounding event stream.
 */
function sanitizeSmf(buf: Uint8Array): SanitizeResult {
  const log: string[] = [];
  let pos = 0;
  const outParts: Uint8Array[] = [];
  let totalStripped = 0;

  while (pos < buf.length) {
    if (pos + 8 > buf.length) {
      outParts.push(buf.subarray(pos));
      break;
    }

    const tag = String.fromCharCode(buf[pos]!, buf[pos+1]!, buf[pos+2]!, buf[pos+3]!);
    const chunkLen = (buf[pos+4]! << 24) | (buf[pos+5]! << 16) | (buf[pos+6]! << 8) | buf[pos+7]!;
    const dataStart = pos + 8;
    const dataEnd   = dataStart + chunkLen;

    if (tag !== 'MTrk') {
      outParts.push(buf.subarray(pos, dataEnd));
      pos = dataEnd;
      continue;
    }

    const trackData = buf.subarray(dataStart, dataEnd);
    const clean: number[] = [];
    let tp = 0;
    let runningStatus = 0;
    let stripped = 0;

    /** Read a variable-length quantity from trackData, advancing tp. */
    function readVlq(): { value: number; bytes: number[] } {
      const bytes: number[] = [];
      let value = 0;
      let b: number;
      do {
        b = trackData[tp++]!;
        bytes.push(b);
        value = (value << 7) | (b & 0x7F);
      } while (b & 0x80);
      return { value, bytes };
    }

    while (tp < trackData.length) {
      // --- Read delta time ---
      const { bytes: dtBytes } = readVlq();

      if (tp >= trackData.length) break;

      // --- Skip any realtime bytes that appear between the delta and the event ---
      while (tp < trackData.length) {
        const b = trackData[tp]!;
        if (b >= 0xF8 && b <= 0xFE) {
          log.push(`  ! Stripped ${BYTE_NAME[b] ?? 'Realtime'} (0x${b.toString(16).toUpperCase()}) at track offset ${tp}`);
          stripped++;
          totalStripped++;
          tp++;
        } else {
          break;
        }
      }
      if (tp >= trackData.length) break;

      const status = trackData[tp]!;

      // --- System common (multi-byte, not valid in SMF) ---
      if (status >= 0xF1 && status <= 0xF6) {
        const extra = SYSCOMMON_DATA[status] ?? 0;
        log.push(`  ! Stripped ${BYTE_NAME[status]} (0x${status.toString(16).toUpperCase()}+${extra}B) at track offset ${tp}`);
        stripped++;
        totalStripped++;
        tp += 1 + extra;
        // Drop delta + event entirely
        continue;
      }

      // --- Meta event (0xFF tt <vlen> <data>) ---
      if (status === 0xFF) {
        const evStart = tp;
        tp += 2; // 0xFF + type byte
        const { value: mLen } = readVlq();
        tp += mLen;
        clean.push(...dtBytes, ...trackData.subarray(evStart, tp));
        runningStatus = 0;
        continue;
      }

      // --- SysEx (0xF0 or 0xF7) ---
      if (status === 0xF0 || status === 0xF7) {
        const evStart = tp;
        tp++;
        const { value: sLen } = readVlq();
        tp += sLen;
        clean.push(...dtBytes, ...trackData.subarray(evStart, tp));
        runningStatus = 0;
        continue;
      }

      // --- Channel voice event with explicit status byte ---
      if (status >= 0x80 && status <= 0xEF) {
        runningStatus = status;
        const nb = VOICE_DATA[(status >> 4) - 8] ?? 1;
        clean.push(...dtBytes, ...trackData.subarray(tp, tp + 1 + nb));
        tp += 1 + nb;
        continue;
      }

      // --- Running status (byte < 0x80, re-use previous status) ---
      if (runningStatus >= 0x80) {
        const nb = VOICE_DATA[(runningStatus >> 4) - 8] ?? 1;
        // Expand to explicit status so parseMidi sees a valid stream
        clean.push(...dtBytes, runningStatus, ...trackData.subarray(tp, tp + nb));
        tp += nb;
        continue;
      }

      // --- Truly unknown byte — skip ---
      log.push(`  ! Skipped unknown byte 0x${status.toString(16).toUpperCase()} at track offset ${tp}`);
      stripped++;
      totalStripped++;
      tp++;
    }

    if (stripped > 0) {
      log.push(`  > ${stripped} byte(s) removed from this track, chunk length corrected`);
    }

    // Write the cleaned track chunk with an updated length field
    const nl = clean.length;
    const newChunk = new Uint8Array(8 + nl);
    newChunk[0] = 0x4D; newChunk[1] = 0x54; newChunk[2] = 0x72; newChunk[3] = 0x6B; // MTrk
    newChunk[4] = (nl >> 24) & 0xFF;
    newChunk[5] = (nl >> 16) & 0xFF;
    newChunk[6] = (nl >>  8) & 0xFF;
    newChunk[7] =  nl        & 0xFF;
    newChunk.set(new Uint8Array(clean), 8);
    outParts.push(newChunk);
    pos = dataEnd;
  }

  if (totalStripped === 0) {
    log.push('  > No invalid bytes found');
  } else {
    log.push(`  > Total stripped: ${totalStripped} byte(s)`);
  }

  // Rebuild the full file from parts
  const total = outParts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(total);
  let off = 0;
  for (const p of outParts) { result.set(p, off); off += p.length; }
  return { data: result, log };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Analyse all clean note ticks to decide whether the song uses a 16th-note
 * grid (→ 16 rows/bar in 4/4, rpb=4) or an 8th-note-triplet grid
 * (→ 12 rows/bar in 4/4, rpb=3).
 *
 * Strategy: for each tick T, test whether it lands on the 16th-note grid
 * (step = PPQ/4) or the triplet grid (step = PPQ/3).  Notes that fit the
 * triplet grid but NOT the 16th-note grid are "triplet-exclusive".  If more
 * than 5 % of all notes are triplet-exclusive, recommend 12 rows/bar;
 * otherwise default to 16 rows/bar.
 *
 * @param cleanTicks  All note ticks already filtered by the tick ceiling.
 * @param ppq         Pulses per quarter-note from the MIDI header.
 * @param timeSigNum  Beats per bar (e.g. 4 for 4/4).
 * @returns           rpb (rows per beat) — 4 for 16-row, 3 for 12-row.
 */
function suggestGrid(
  cleanTicks: number[],
  ppq: number,
  timeSigNum: number,
): { rpb: number; rowsPerBar: number; logLine: string } {
  if (cleanTicks.length === 0) {
    return { rpb: 4, rowsPerBar: 16 * timeSigNum / 4, logLine: 'no notes — defaulting to 16 rows/bar' };
  }

  const step16 = ppq / 4;          // ticks per 16th note
  const step12 = ppq / 3;          // ticks per 8th-note triplet
  // Allow ±1 tick of quantisation jitter
  const tol    = Math.max(1, Math.round(ppq / 192));

  let on16 = 0, on12 = 0, tripletOnly = 0;

  for (const t of cleanTicks) {
    const r16    = t % step16;
    const r12    = t % step12;
    const fit16  = Math.min(r16, step16 - r16) <= tol;
    const fit12  = Math.min(r12, step12 - r12) <= tol;
    if (fit16) on16++;
    if (fit12) on12++;
    if (fit12 && !fit16) tripletOnly++;
  }

  const pct16  = Math.round((on16  / cleanTicks.length) * 100);
  const pctTri = Math.round((tripletOnly / cleanTicks.length) * 100);

  if (tripletOnly / cleanTicks.length > 0.05) {
    const rowsPerBar = 3 * timeSigNum;   // 12 for 4/4
    return {
      rpb: 3,
      rowsPerBar,
      logLine: `${pctTri}% of notes require triplet grid → recommended ${rowsPerBar} rows/bar (8th-note triplets, RPB=3)`,
    };
  }

  const rowsPerBar = 4 * timeSigNum;    // 16 for 4/4
  return {
    rpb: 4,
    rowsPerBar,
    logLine: `${pct16}% of notes fit 16th-note grid → recommended ${rowsPerBar} rows/bar (16th notes, RPB=4)`,
  };
}

function tickToRow(tick: number, ppq: number, rpb: number): number {
  return Math.round(tick / (ppq / rpb));
}

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'] as const;
function midiNoteName(n: number): string {
  return NOTE_NAMES[n % 12]! + String(Math.floor(n / 12) - 1);
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

export function parseMidiFile(
  bytes: Uint8Array,
  rpbOverride?: number
): ImportResult {
  const log: string[] = [];
  log.push(`> Parsing MIDI file (${bytes.length} bytes)`);

  // ── Step 1: Sanitize the raw SMF bytes ──────────────────────────────────
  log.push('> Scanning for invalid system bytes...');
  const { data: sanitized, log: sanLog } = sanitizeSmf(bytes);
  log.push(...sanLog);
  if (sanitized.length !== bytes.length) {
    log.push(`> File size after sanitization: ${sanitized.length} bytes`);
  }

  // ── Step 2: Parse the clean MIDI ────────────────────────────────────────
  const midi = parseMidi(sanitized);
  const { header, tracks: rawTracks } = midi;
  const ppq = header.ticksPerBeat ?? 480;

  log.push(`> Header: Format ${header.format} · ${header.numTracks} track(s) · PPQ=${ppq}`);

  // ── Step 3: Resolve absolute ticks ──────────────────────────────────────
  interface AbsEvent {
    tick: number;
    trackIdx: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: any;
  }

  const allEvents: AbsEvent[] = [];
  rawTracks.forEach((trackEvents, trackIdx) => {
    let tick = 0;
    for (const ev of trackEvents) {
      tick += ev.deltaTime;
      allEvents.push({ tick, trackIdx, event: ev });
    }
  });

  // ── Step 4: Extract global tempo + time signature ────────────────────────
  let bpm       = 120;
  let bpmFound  = false;
  let timeSigNum   = 4;
  let timeSigDen   = 4;
  let timeSigFound = false;

  for (const { event } of allEvents) {
    if (event.type === 'setTempo' && !bpmFound) {
      bpm      = Math.round(60_000_000 / event.microsecondsPerBeat);
      bpmFound = true;
      log.push(`> Tempo: ${event.microsecondsPerBeat} µs/beat → ${bpm} BPM`);
    }
    if (event.type === 'timeSignature' && !timeSigFound) {
      timeSigNum   = event.numerator;
      timeSigDen   = event.denominator;
      timeSigFound = true;
      log.push(`> Time signature: ${timeSigNum}/${timeSigDen}`);
    }
  }

  if (!bpmFound) {
    log.push(`> WARNING: No tempo event found — defaulting to 120 BPM`);
  }
  if (!timeSigFound) {
    log.push(`> WARNING: No time signature found — defaulting to 4/4`);
  }

  // ── Step 5: Collect noteOn events per track ──────────────────────────────
  interface RawNote {
    tick: number;
    note: number;
    velocity: number;
    midiChannel: number;
  }

  // Also collect track names and program changes for better naming after splits.
  const trackNames    = new Map<number, string>();
  const trackPrograms = new Map<number, Map<number, number>>(); // trackIdx → midiCh → program
  for (const { tick: _t, trackIdx, event } of allEvents) {
    if (event.type === 'trackName' && event.text && !trackNames.has(trackIdx)) {
      trackNames.set(trackIdx, event.text as string);
    }
    if (event.type === 'programChange') {
      if (!trackPrograms.has(trackIdx)) trackPrograms.set(trackIdx, new Map());
      trackPrograms.get(trackIdx)!.set(event.channel ?? 0, event.programNumber ?? 0);
    }
  }

  const notesByTrack = new Map<number, RawNote[]>();
  for (const { tick, trackIdx, event } of allEvents) {
    if (event.type === 'noteOn' && event.velocity > 0) {
      if (!notesByTrack.has(trackIdx)) notesByTrack.set(trackIdx, []);
      notesByTrack.get(trackIdx)!.push({
        tick,
        note: event.noteNumber,
        velocity: event.velocity,
        midiChannel: event.channel ?? 0,
      });
    }
  }

  // ── Step 5b: Split multi-channel tracks into virtual per-channel tracks ──
  // Format 0 files pack all instruments into a single MIDI track, using MIDI
  // channel to distinguish them. Format 1 files occasionally do the same.
  // If any track has notes on more than one MIDI channel, split it so that
  // each (trackIdx, midiChannel) pair becomes its own ImportTrack.
  // Synthetic key: trackIdx * 16 + midiChannel (unique, stable, ≤ 65535).

  interface VirtualTrack {
    key:         number;
    trackIdx:    number;
    midiChannel: number;
    name:        string;
    notes:       RawNote[];
  }

  // GM General MIDI program names (0-based).
  const GM_NAMES: readonly string[] = [
    'Acoustic Grand Piano','Bright Acoustic Piano','Electric Grand Piano','Honky-tonk Piano',
    'Electric Piano 1','Electric Piano 2','Harpsichord','Clavinet',
    'Celesta','Glockenspiel','Music Box','Vibraphone','Marimba','Xylophone','Tubular Bells','Dulcimer',
    'Drawbar Organ','Percussive Organ','Rock Organ','Church Organ','Reed Organ','Accordion','Harmonica','Tango Accordion',
    'Acoustic Guitar (nylon)','Acoustic Guitar (steel)','Electric Guitar (jazz)','Electric Guitar (clean)',
    'Electric Guitar (muted)','Overdriven Guitar','Distortion Guitar','Guitar Harmonics',
    'Acoustic Bass','Electric Bass (finger)','Electric Bass (pick)','Fretless Bass',
    'Slap Bass 1','Slap Bass 2','Synth Bass 1','Synth Bass 2',
    'Violin','Viola','Cello','Contrabass','Tremolo Strings','Pizzicato Strings','Orchestral Harp','Timpani',
    'String Ensemble 1','String Ensemble 2','Synth Strings 1','Synth Strings 2',
    'Choir Aahs','Voice Oohs','Synth Voice','Orchestra Hit',
    'Trumpet','Trombone','Tuba','Muted Trumpet','French Horn','Brass Section','Synth Brass 1','Synth Brass 2',
    'Soprano Sax','Alto Sax','Tenor Sax','Baritone Sax',
    'Oboe','English Horn','Bassoon','Clarinet',
    'Piccolo','Flute','Recorder','Pan Flute','Blown Bottle','Shakuhachi','Whistle','Ocarina',
    'Lead 1 (square)','Lead 2 (sawtooth)','Lead 3 (calliope)','Lead 4 (chiff)',
    'Lead 5 (charang)','Lead 6 (voice)','Lead 7 (fifths)','Lead 8 (bass+lead)',
    'Pad 1 (new age)','Pad 2 (warm)','Pad 3 (polysynth)','Pad 4 (choir)',
    'Pad 5 (bowed)','Pad 6 (metallic)','Pad 7 (halo)','Pad 8 (sweep)',
    'FX 1 (rain)','FX 2 (soundtrack)','FX 3 (crystal)','FX 4 (atmosphere)',
    'FX 5 (brightness)','FX 6 (goblins)','FX 7 (echoes)','FX 8 (sci-fi)',
    'Sitar','Banjo','Shamisen','Koto','Kalimba','Bag pipe','Fiddle','Shanai',
    'Tinkle Bell','Agogo','Steel Drums','Woodblock','Taiko Drum','Melodic Tom','Synth Drum','Reverse Cymbal',
    'Guitar Fret Noise','Breath Noise','Seashore','Bird Tweet','Telephone Ring','Helicopter','Applause','Gunshot',
  ];

  const virtualTracks = new Map<number, VirtualTrack>();

  for (const [trackIdx, rawNotes] of notesByTrack) {
    const channelsUsed = [...new Set(rawNotes.map(n => n.midiChannel))].sort((a, b) => a - b);
    const baseName = trackNames.get(trackIdx) ?? `Track ${trackIdx}`;

    if (channelsUsed.length <= 1) {
      // Single-channel track — no split needed.
      const midiChannel = channelsUsed[0] ?? 0;
      const key = trackIdx * 16 + midiChannel;
      virtualTracks.set(key, { key, trackIdx, midiChannel, name: baseName, notes: rawNotes });
    } else {
      // Multi-channel track (Format 0 or mixed Format 1) — split by MIDI channel.
      log.push(`> Track ${trackIdx} spans ${channelsUsed.length} MIDI channels — splitting by channel`);
      for (const midiChannel of channelsUsed) {
        const chNotes = rawNotes.filter(n => n.midiChannel === midiChannel);
        const key     = trackIdx * 16 + midiChannel;
        const prog    = trackPrograms.get(trackIdx)?.get(midiChannel);
        let name: string;
        if (midiChannel === 9) {
          name = 'Drums';
        } else if (prog != null && prog >= 0 && prog < GM_NAMES.length) {
          name = GM_NAMES[prog]!;
        } else {
          name = `Ch ${midiChannel + 1}`;
        }
        virtualTracks.set(key, { key, trackIdx, midiChannel, name, notes: chNotes });
      }
    }
  }

  // ── Step 6: Detect corrupt tick regions ─────────────────────────────────
  // Collect all note ticks across all virtual tracks and find the "clean" 95th
  // percentile.  Any note beyond 4× that value is almost certainly from a
  // corrupted giant delta-time and gets discarded.
  const allTicks: number[] = [];
  for (const vt of virtualTracks.values()) {
    for (const n of vt.notes) allTicks.push(n.tick);
  }
  allTicks.sort((a, b) => a - b);

  let tickCeiling = Infinity;
  let ceilReason = '';

  if (allTicks.length > 0) {
    const p95idx  = Math.floor(allTicks.length * 0.95);
    const p95tick = allTicks[p95idx]!;
    const maxTick = allTicks[allTicks.length - 1]!;

    // If the maximum tick is more than 10× the 95th-percentile, there's a
    // corrupt delta-time blowing up the tail.
    if (maxTick > p95tick * 10 && p95tick > 0) {
      tickCeiling = p95tick * 4;
      const ceilBeats  = (tickCeiling / ppq).toFixed(1);
      const ceilBars   = (tickCeiling / ppq / timeSigNum).toFixed(1);
      ceilReason = `p95=${p95tick} ticks, max=${maxTick} ticks (${(maxTick/p95tick).toFixed(0)}× larger)`;
      log.push(`> WARNING: Corrupt delta-time detected!`);
      log.push(`  ${ceilReason}`);
      log.push(`  Tick ceiling set to ${tickCeiling} (≈${ceilBeats} beats · ≈${ceilBars} bars)`);
      log.push(`  Notes beyond ceiling will be discarded.`);
    } else {
      const maxBeats = (maxTick / ppq).toFixed(1);
      const maxBars  = (maxTick / ppq / timeSigNum).toFixed(1);
      log.push(`> Tick range: 0–${maxTick} (${maxBeats} beats · ${maxBars} bars)`);
    }
  }

  // ── Step 7: Determine rows-per-beat via 16 vs 12 grid analysis ─────────
  // Use the clean (ceiling-filtered) ticks so corrupt outliers don't skew
  // the grid detection.
  const cleanTicks = allTicks.filter(t => t <= tickCeiling);
  const gridSuggestion = suggestGrid(cleanTicks, ppq, timeSigNum);

  const rpb = rpbOverride ?? gridSuggestion.rpb;
  log.push(`> Grid analysis: ${gridSuggestion.logLine}`);
  if (rpbOverride != null && rpbOverride !== gridSuggestion.rpb) {
    log.push(`  (override: RPB=${rpbOverride} — ${rpbOverride} rows/beat)`);
  }

  // ── Step 8: Build ImportTrack list ──────────────────────────────────────
  // Sort virtual tracks: by original MIDI track index first, then by MIDI
  // channel within each track, so the order is deterministic and sensible.
  const sortedVirtual = [...virtualTracks.values()]
    .filter(vt => vt.notes.length > 0)
    .sort((a, b) => a.trackIdx !== b.trackIdx ? a.trackIdx - b.trackIdx : a.midiChannel - b.midiChannel);

  log.push(`> Note analysis (${sortedVirtual.length} track(s) after channel split):`);

  const tracks: ImportTrack[] = [];
  let maxRow = 0;

  for (const vt of sortedVirtual) {
    const { key, midiChannel, name, notes: rawNotes } = vt;

    // Separate clean notes from corrupt ones
    const cleanNotes   = rawNotes.filter(n => n.tick <= tickCeiling);
    const filteredCount = rawNotes.length - cleanNotes.length;

    // Pitch range for log
    const pitches = cleanNotes.map(n => n.note);
    const minP    = pitches.length ? Math.min(...pitches) : 0;
    const maxP    = pitches.length ? Math.max(...pitches) : 0;
    const isDrums = midiChannel === 9;
    const rangeStr = pitches.length ? `${midiNoteName(minP)}–${midiNoteName(maxP)}` : '—';

    let logLine = `  Ch${String(midiChannel + 1).padStart(2)}: ${String(cleanNotes.length).padStart(4)} notes`;
    logLine += `  range: ${rangeStr.padEnd(10)}`;
    logLine += `  "${name}"`;
    if (isDrums)        logLine += ' [DRUMS]';
    if (filteredCount > 0) logLine += `  *** ${filteredCount} CORRUPT NOTES DISCARDED ***`;
    log.push(logLine);

    const notes: ImportNote[] = cleanNotes.map((n) => {
      const row = tickToRow(n.tick, ppq, rpb);
      maxRow = Math.max(maxRow, row);
      return { row, note: n.note, velocity: n.velocity };
    });

    // Use the virtual track key as the ImportTrack index — it's unique across
    // all (trackIdx, midiChannel) pairs and stable across re-parses.
    tracks.push({ index: key, name, midiChannel, notes, rawNoteCount: rawNotes.length, filteredCount });
  }

  // ── Step 9: Round up to complete bars ───────────────────────────────────
  const rowsPerBar = rpb * timeSigNum;
  const totalRows = Math.max(
    rowsPerBar,
    Math.ceil((maxRow + 1) / rowsPerBar) * rowsPerBar
  );
  const totalBars = totalRows / rowsPerBar;
  const totalNotes = tracks.reduce((s, t) => s + t.notes.length, 0);
  const totalFiltered = tracks.reduce((s, t) => s + t.filteredCount, 0);

  log.push(`> Import ready:`);
  log.push(`  ${totalNotes} notes · ${tracks.length} channel(s) · RPB=${rpb}`);
  log.push(`  ${totalRows} rows · ${totalBars} bars`);
  if (totalFiltered > 0) {
    log.push(`  ${totalFiltered} corrupt note(s) discarded`);
  }
  log.push(`> Done.`);

  return {
    bpm,
    timeSigNum,
    timeSigDen,
    ppq,
    tracks,
    totalRows,
    suggestedRpb: rpb,
    suggestedRowsPerBar: rowsPerBar,
    log,
  };
}

// ---------------------------------------------------------------------------
// Convert ImportResult → pattern cells
// ---------------------------------------------------------------------------

export function buildPatternCells(
  result: ImportResult,
  trackMapping: Map<number, number>,
  instrumentBase: Map<number, number>,
  rowCount: number
): PatternCell[][] {
  const rows: PatternCell[][] = Array.from({ length: rowCount }, () =>
    Array.from({ length: CHANNELS }, () => emptyCell())
  );

  for (const track of result.tracks) {
    const ch = trackMapping.get(track.index);
    const inst = instrumentBase.get(track.index) ?? 1;
    if (ch == null || ch >= CHANNELS) continue;

    for (const note of track.notes) {
      const row = note.row;
      if (row >= rowCount) continue;
      if (rows[row]![ch]!.note !== 0) continue;
      rows[row]![ch] = {
        note: note.note,
        instrument: inst,
        cmd: 0,
        data: 0,
      };
    }
  }

  return rows;
}
