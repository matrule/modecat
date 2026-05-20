/**
 * XRNS (Renoise Song) importer for ModeCat.
 *
 * XRNS is a ZIP archive containing:
 *   Song.xml          — all song/pattern/instrument data
 *   SampleData/...    — FLAC (or WAV) sample files
 *
 * Mapping decisions:
 *   • Each Renoise SequencerTrack → one ModeCat channel (first NoteColumn only)
 *   • Up to 16 tracks; extras are ignored
 *   • Renoise note format "A-3" → MIDI using (octave+1)*12 + semitone (C-4=60)
 *   • Instrument indices are hex in the XML ("00", "0A") → 1-based ModeCat slots
 *   • Samples decoded via AudioContext.decodeAudioData (supports FLAC in modern browsers)
 *   • LoopMode: Forward/PingPong → loopEnabled=true; Off → false
 *   • Effects are dropped (not enough overlap with ModeCat's command set)
 */

import { unzipSync } from 'fflate';
import type { ModImportResult, ModInstrument } from './modImport';
import type { PatternCell } from '../state/types';
import { NOTE_OFF } from './notes';

// ── Helpers ───────────────────────────────────────────────────────────────────

function el(parent: Element | Document, selector: string): Element | null {
  // Simple tag-chain selector: "Foo > Bar > Baz"
  const parts = selector.split('>').map(s => s.trim());
  let cur: Element | Document | null = parent;
  for (const tag of parts) {
    if (!cur) return null;
    cur = (cur as Element | Document).querySelector(tag) ?? null;
  }
  return cur as Element | null;
}

function text(parent: Element | Document, selector: string): string {
  return el(parent, selector)?.textContent?.trim() ?? '';
}

const NOTE_SEMITONES: Record<string, number> = {
  C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5,
  'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11,
};

/** Parse Renoise note string ("A-3", "C#4", "OFF", "---") → MIDI note number.
 *  Returns 0 for empty/unset, NOTE_OFF (253) for "OFF". */
function parseNote(noteStr: string): number {
  if (!noteStr || noteStr === '---') return 0;
  if (noteStr === 'OFF') return NOTE_OFF; // stop-note cell
  // Format: "X-N" or "X#N" where X=letter, optional #, N=octave digit
  const m = noteStr.match(/^([A-G]#?)(-?)(\d+)$/);
  if (!m) return 0;
  const semi = NOTE_SEMITONES[m[1]!] ?? 0;
  const octave = parseInt(m[3]!, 10);
  // Renoise: C-4 = MIDI 60  →  midi = (octave+1)*12 + semi
  const midi = (octave + 1) * 12 + semi;
  return Math.max(1, Math.min(127, midi));
}

function emptyCell(): PatternCell {
  return { note: 0, instrument: 0, cmd: 0, data: 0 };
}

// ── Main parser ───────────────────────────────────────────────────────────────

export async function parseXrns(buffer: ArrayBuffer): Promise<ModImportResult> {
  // ── 1. Unzip ──────────────────────────────────────────────────────────────
  const zipBytes = new Uint8Array(buffer);
  const files = unzipSync(zipBytes);

  const xmlBytes = files['Song.xml'];
  if (!xmlBytes) throw new Error('No Song.xml found in XRNS archive');

  const xmlStr = new TextDecoder().decode(xmlBytes);
  const doc = new DOMParser().parseFromString(xmlStr, 'text/xml');

  if (doc.querySelector('parsererror')) {
    throw new Error('Failed to parse Song.xml');
  }

  // ── 2. Global timing ──────────────────────────────────────────────────────
  const songName  = text(doc, 'GlobalSongData > SongName');
  const bpm       = parseFloat(text(doc, 'GlobalSongData > BeatsPerMin'))   || 120;
  const ticksPerLine = parseInt(text(doc, 'GlobalSongData > TicksPerLine')) || 6;
  // speed in ModeCat = ticks per row; matches TicksPerLine directly

  // ── 3. Instruments ────────────────────────────────────────────────────────
  const instEls = Array.from(doc.querySelectorAll('Instruments > Instrument'));

  // Create AudioContext for FLAC/WAV decoding — user gesture already happened (file pick)
  let audioCtx: AudioContext | null = null;

  const instruments: ModInstrument[] = [{
    name: '', pcm: null, sampleRate: 44100, baseNote: 60,
    volume: 0, finetune: 0, loopEnabled: false, loopStart: 0, loopEnd: 0,
  }]; // slot 0 unused

  for (let ii = 0; ii < instEls.length; ii++) {
    const instEl = instEls[ii]!;
    const instName = instEl.getAttribute('name') ??
                     instEl.querySelector('Name')?.textContent?.trim() ?? `Inst ${ii}`;

    // Find the first Sample element
    const sampleEl = instEl.querySelector('Samples > Sample') ??
                     instEl.querySelector('Sample');

    const volume    = parseFloat(sampleEl?.querySelector('Volume')?.textContent ?? '1') || 1;
    const transpose = parseInt(sampleEl?.querySelector('Transpose')?.textContent ?? '0') || 0;
    const finetune  = parseInt(sampleEl?.querySelector('Finetune')?.textContent ?? '0') || 0;
    const loopMode  = sampleEl?.querySelector('LoopMode')?.textContent?.trim() ?? 'Off';
    const loopStart = parseInt(sampleEl?.querySelector('LoopStart')?.textContent ?? '0') || 0;
    const loopEnd   = parseInt(sampleEl?.querySelector('LoopEnd')?.textContent ?? '0') || 0;
    // PingPong loops require note-off to stop — without that they oscillate forever.
    // Only enable looping for Forward mode; PingPong and Off play the sample through once.
    const loopEnabled = loopMode === 'Forward';

    // baseNote: C-4 (MIDI 60) adjusted by sample transpose
    const baseNote = Math.max(0, Math.min(127, 60 + transpose));

    // Find sample file in ZIP: "SampleData/Instrument{ii:02d} (...)/Sample00 (...).flac"
    const prefix = `SampleData/Instrument${ii.toString().padStart(2, '0')} `;
    const sampleKey = Object.keys(files).find(
      k => k.startsWith(prefix) && k.includes('/Sample00 ')
    );

    let pcm: Float32Array | null = null;
    if (sampleKey && files[sampleKey]) {
      try {
        if (!audioCtx) audioCtx = new AudioContext();
        // Copy to a fresh ArrayBuffer so decodeAudioData can take ownership
        const sampleData = files[sampleKey]!.slice().buffer;
        const decoded = await audioCtx.decodeAudioData(sampleData);
        // Mix down to mono if stereo
        if (decoded.numberOfChannels >= 2) {
          pcm = new Float32Array(decoded.length);
          const l = decoded.getChannelData(0);
          const r = decoded.getChannelData(1);
          for (let i = 0; i < decoded.length; i++) {
            pcm[i] = (l[i]! + r[i]!) * 0.5;
          }
        } else {
          pcm = new Float32Array(decoded.getChannelData(0));
        }
      } catch (err) {
        console.warn(`XRNS: failed to decode sample ${sampleKey}:`, err);
      }
    }

    const sampleRate = audioCtx?.sampleRate ?? 44100;

    instruments.push({
      name: instName,
      pcm,
      sampleRate,
      baseNote,
      volume: Math.round(Math.min(1, Math.max(0, volume)) * 127),
      finetune: Math.max(-8, Math.min(7, Math.round(finetune / 16))),
      loopEnabled,
      loopStart: loopEnabled ? loopStart : 0,
      // Non-looping: default to full sample range so IN/OUT markers are visible.
      loopEnd:   loopEnabled ? loopEnd   : (pcm ? pcm.length - 1 : 0),
    });
  }

  // Close the temporary AudioContext
  try { await audioCtx?.close(); } catch (_) { /* ignore */ }

  // ── 4. Track list (determines channel mapping) ────────────────────────────
  // Only SequencerTrack elements are data tracks; Master/Send tracks are skipped.
  const trackEls = Array.from(doc.querySelectorAll('Tracks > SequencerTrack'));
  const numChannels = Math.min(trackEls.length, 16);
  const trackNames = trackEls.slice(0, numChannels).map(t =>
    t.getAttribute('name') ?? t.querySelector('Name')?.textContent?.trim() ?? ''
  );

  // ── 5. Pattern pool ───────────────────────────────────────────────────────
  const patternEls = Array.from(doc.querySelectorAll('PatternPool > Patterns > Pattern'));

  // Build a map: Renoise pattern index (position in array) → PatternCell[][]
  const rPatterns: PatternCell[][][] = patternEls.map((patEl) => {
    const numLines = parseInt(patEl.querySelector('NumberOfLines')?.textContent ?? '64') || 64;
    const patTracks = Array.from(patEl.querySelectorAll('Tracks > PatternTrack'));

    // Initialise dense grid: numLines rows × 16 channels
    const rows: PatternCell[][] = Array.from({ length: numLines }, () =>
      Array.from({ length: 16 }, () => emptyCell())
    );

    for (let ch = 0; ch < Math.min(patTracks.length, numChannels); ch++) {
      const trackEl = patTracks[ch]!;
      const lineEls = trackEl.querySelectorAll('Lines > Line');

      for (const lineEl of lineEls) {
        const rowIdx = parseInt(lineEl.getAttribute('index') ?? '-1');
        if (rowIdx < 0 || rowIdx >= numLines) continue;

        // First NoteColumn only
        const nc = lineEl.querySelector('NoteColumns > NoteColumn');
        if (!nc) continue;

        const noteStr  = nc.querySelector('Note')?.textContent?.trim() ?? '';
        const instStr  = nc.querySelector('Instrument')?.textContent?.trim() ?? '';
        const volStr   = nc.querySelector('Volume')?.textContent?.trim() ?? '';

        const note = parseNote(noteStr);
        if (note === 0) continue; // empty cell

        // NOTE_OFF cell: write stop-note marker, no instrument/cmd needed
        if (note === NOTE_OFF) {
          rows[rowIdx]![ch] = { note: NOTE_OFF, instrument: 0, cmd: 0, data: 0 };
          continue;
        }

        // Instrument: hex string "00"–"FF" → 1-based ModeCat slot
        const instIdx = instStr ? parseInt(instStr, 16) + 1 : 0;

        // Volume column: Renoise 00–80 hex → ModeCat 0–64 scale
        let cmd = 0, data = 0;
        if (volStr && volStr !== '..') {
          const renVol = parseInt(volStr, 16);
          if (!isNaN(renVol)) {
            cmd  = 0x0C;
            data = Math.min(64, Math.round(renVol / 0x80 * 64));
          }
        }

        rows[rowIdx]![ch] = { note, instrument: instIdx, cmd, data };
      }
    }

    return rows;
  });

  // ── 6. Pattern sequence → orderList ──────────────────────────────────────
  const seqEntries = Array.from(
    doc.querySelectorAll('PatternSequence > SequenceEntries > SequenceEntry')
  );

  const orderList: number[] = seqEntries.map(e => {
    const pidStr = e.querySelector('Pattern')?.textContent?.trim() ?? '0';
    return parseInt(pidStr) || 0;
  });

  // Collect unique pattern indices actually used in the sequence
  const usedPatIds = [...new Set(orderList)].sort((a, b) => a - b);

  // Map Renoise pattern index → ModeCat pattern array index
  const renToMod = new Map<number, number>();
  usedPatIds.forEach((rid, mi) => renToMod.set(rid, mi));

  const patterns = usedPatIds.map(rid => rPatterns[rid] ?? [Array.from({ length: 16 }, () => emptyCell())]);
  const mappedOrderList = orderList.map(rid => renToMod.get(rid) ?? 0);

  return {
    format: 'xrns' as 'mod', // cast: format field is only used for display labels
    songName,
    numChannels,
    numPatterns: patterns.length,
    numInstruments: instruments.filter((_, i) => i > 0 && instruments[i]!.pcm !== null).length,
    bpm,
    speed: ticksPerLine,
    instruments,
    patterns,
    orderList: mappedOrderList,
    trackNames,
  } as ModImportResult & { trackNames: string[] };
}
