/**
 * MOD / S3M importer for ModeCat.
 *
 * MOD (ProTracker/NoiseTracker):  4-channel, up to 31 samples, 8-bit signed PCM.
 * S3M (ScreamTracker 3):          up to 32 channels, 99 instruments, 8/16-bit PCM.
 *
 * Returns a normalised ModImportResult that the wizard and store-builder use.
 */

import type { PatternCell } from '../state/types';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ModInstrument {
  name: string;
  pcm: Float32Array | null;   // normalised –1…+1
  sampleRate: number;          // playback rate at baseNote
  baseNote: number;            // MIDI note that plays sample at 1× rate
  volume: number;              // 0–127
  finetune: number;            // –8…+7  (1/8 semitone units, same as ModeCat)
  loopEnabled: boolean;
  loopStart: number;           // samples
  loopEnd: number;             // samples (0 = end of buffer)
}

export interface ModImportResult {
  format: 'mod' | 's3m';
  songName: string;
  numChannels: number;
  numPatterns: number;         // unique patterns
  numInstruments: number;
  bpm: number;
  speed: number;               // ticks per row
  instruments: ModInstrument[];// index 1-based (index 0 unused/empty)
  patterns: PatternCell[][][]; // [patternIdx][row][channel]
  orderList: number[];         // song position → pattern index
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readStr(buf: Uint8Array, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    const c = buf[offset + i]!;
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

function u16be(buf: Uint8Array, off: number) {
  return ((buf[off]! << 8) | buf[off + 1]!) >>> 0;
}
function u16le(buf: Uint8Array, off: number) {
  return ((buf[off + 1]! << 8) | buf[off]!) >>> 0;
}
function u32le(buf: Uint8Array, off: number) {
  return (buf[off]! | (buf[off+1]! << 8) | (buf[off+2]! << 16) | (buf[off+3]! << 24)) >>> 0;
}

/** Convert Amiga period value to MIDI note number.
 *  Period 428 (ProTracker C-2) → MIDI 48 (C-3 in ModeCat where C4=60).
 */
function periodToMidi(period: number): number {
  if (period <= 0) return 0;
  return Math.round(48 + 12 * Math.log2(428 / period));
}

/** Clamp MIDI to valid range */
function clampMidi(n: number): number {
  return Math.max(1, Math.min(127, n));
}

function emptyCell(): PatternCell {
  return { note: 0, instrument: 0, cmd: 0, data: 0 };
}

// ── MOD parser ────────────────────────────────────────────────────────────────

/**
 * Detect MOD channels from the 4-byte tag at offset 1080.
 * Returns channel count or 0 if not a recognised MOD.
 */
function detectModChannels(buf: Uint8Array): number {
  if (buf.length < 1084) return 0;
  const tag = readStr(buf, 1080, 4);
  if (tag === 'M.K.' || tag === 'M!K!' || tag === 'FLT4') return 4;
  if (tag === '6CHN') return 6;
  if (tag === '8CHN' || tag === 'FLT8') return 8;
  // XXCH format (e.g. "10CH", "16CH")
  const m = tag.match(/^(\d+)CH$/);
  if (m) return parseInt(m[1]!, 10);
  return 0;
}

export function parseMod(buffer: ArrayBuffer): ModImportResult {
  const buf = new Uint8Array(buffer);
  const numChannels = detectModChannels(buf);
  if (!numChannels) throw new Error('Not a recognised MOD file (bad magic at 1080)');

  const songName = readStr(buf, 0, 20);

  // ── Sample headers (31 × 30 bytes, starts at offset 20) ──
  const instruments: ModInstrument[] = [{ // slot 0 = unused
    name: '', pcm: null, sampleRate: 8287, baseNote: 48,
    volume: 0, finetune: 0, loopEnabled: false, loopStart: 0, loopEnd: 0,
  }];

  for (let i = 0; i < 31; i++) {
    const base = 20 + i * 30;
    const name       = readStr(buf, base, 22);
    const lenWords   = u16be(buf, base + 22);
    const finetRaw   = buf[base + 24]! & 0x0F;
    const finetune   = finetRaw < 8 ? finetRaw : finetRaw - 16; // signed nibble → -8..+7
    const vol        = Math.min(64, buf[base + 25]!);
    const loopStart  = u16be(buf, base + 26) * 2;
    const loopLen    = u16be(buf, base + 28) * 2;
    const loopEnabled = loopLen > 2;
    const loopEnd    = loopEnabled ? loopStart + loopLen : 0;

    instruments.push({
      name,
      pcm: null, // filled below after patterns
      sampleRate: 8287, // Amiga PAL rate at period 428 (C-2)
      baseNote: 48,     // C-3 in ModeCat (MIDI 48)
      // vol=0 in the header with a non-empty sample is a ProTracker "effect-driven"
      // sample — the composer uses FxAxy (volume slide) to fade it in. Since ModeCat
      // doesn't implement all MOD effects, default these to full volume so they're
      // audible. Samples that are genuinely silent (lenWords=0) stay at 0.
      volume: Math.round((vol > 0 ? vol : (lenWords > 0 ? 64 : 0)) / 64 * 127),
      finetune,
      loopEnabled,
      loopStart,
      loopEnd,
    });
  }

  // ── Song structure ──
  const songLen    = buf[950]!;
  const orderList  = Array.from(buf.slice(952, 952 + 128)).slice(0, songLen);
  const numPatterns = Math.max(...orderList) + 1;
  const bpm = 125;
  const speed = 6;

  // ── Pattern data (starts at 1084) ──
  let patOff = 1084;
  const patternRowCount = 64;
  const patterns: PatternCell[][][] = [];

  // In MOD, instrument=0 on a note means "carry the last-set instrument on this channel".
  // We resolve this at import time so ModeCat sees explicit instrument numbers everywhere.
  // We track across all patterns in parse order (good enough for the vast majority of songs).
  const lastInstPerChannel = new Array(numChannels).fill(0);

  for (let pi = 0; pi < numPatterns; pi++) {
    const rows: PatternCell[][] = [];
    for (let ri = 0; ri < patternRowCount; ri++) {
      const cells: PatternCell[] = [];
      for (let ch = 0; ch < numChannels; ch++) {
        const b0 = buf[patOff]!;
        const b1 = buf[patOff + 1]!;
        const b2 = buf[patOff + 2]!;
        const b3 = buf[patOff + 3]!;
        patOff += 4;

        const sample  = ((b0 & 0xF0) | (b2 >> 4));
        const period  = ((b0 & 0x0F) << 8) | b1;
        const effect  = b2 & 0x0F;
        const edata   = b3;

        // Update channel's last-seen instrument whenever a sample is specified
        if (sample > 0) lastInstPerChannel[ch] = sample;

        let note = 0;
        if (period > 0) {
          const midi = periodToMidi(period);
          note = midi >= 1 && midi <= 127 ? midi : 0;
        }

        // If there's a note but no instrument, carry forward the last instrument
        // so ModeCat has an explicit slot to trigger rather than silent slot 0.
        const effectiveInst = (note > 0 && sample === 0 && lastInstPerChannel[ch] > 0)
          ? lastInstPerChannel[ch]
          : sample;

        // Map MOD effects to ModeCat cmd/data
        // NOTE on portamento speed scaling:
        // MOD porta speed = Amiga period-units/tick (tiny hardware increments).
        // ModeCat's sequencer interprets data differently — roughly 2× faster for
        // TonePorta and 3× faster for pitch slides. We scale down at import time.
        let cmd = 0, data = 0;
        if (effect === 0x1) {           // Pitch slide up
          cmd = 0x01; data = Math.max(1, Math.round(edata / 3));
        } else if (effect === 0x2) {    // Pitch slide down
          cmd = 0x02; data = Math.max(1, Math.round(edata / 3));
        } else if (effect === 0x3) {    // Tone portamento
          // Speed halved: sequencer runs ~2× faster than original Amiga hardware
          cmd = 0x03; data = edata > 0 ? Math.max(1, Math.round(edata / 2)) : 0;
        } else if (effect === 0x5) {    // Tone portamento + volume slide (continue porta)
          cmd = 0x03; data = 0;         // continue at stored speed; vol slide dropped
        } else if (effect === 0xA) {    // Volume slide: hi-nibble=up, lo-nibble=down
          const slideUp   = (edata >> 4) & 0x0F;
          const slideDown = edata & 0x0F;
          if (slideUp > 0)   { cmd = 0x1A; data = slideUp; }
          else if (slideDown > 0) { cmd = 0x1B; data = slideDown; }
        } else if (effect === 0xC) {    // Set Volume — sequencer expects 0-64, scales internally
          cmd = 0x0C; data = Math.min(64, edata);
        } else if (effect === 0xF) {    // Set Speed/Tempo
          cmd = 0x0F; data = edata;
        }

        cells.push({ note, instrument: effectiveInst, cmd, data });
      }
      // Pad to 16 channels
      while (cells.length < 16) cells.push(emptyCell());
      rows.push(cells);
    }
    patterns.push(rows);
  }

  // ── Sample PCM data (follows all patterns) ──
  let smpOff = patOff;
  for (let i = 1; i <= 31; i++) {
    const inst = instruments[i]!;
    // Recalculate byte length from original header
    const base = 20 + (i - 1) * 30;
    const lenWords = u16be(buf, base + 22);
    const byteLen  = lenWords * 2;
    if (byteLen > 0 && smpOff + byteLen <= buf.length) {
      const pcm = new Float32Array(byteLen);
      for (let s = 0; s < byteLen; s++) {
        // 8-bit signed → float32
        const b = buf[smpOff + s]!;
        pcm[s] = (b < 128 ? b : b - 256) / 128.0;
      }
      inst.pcm = pcm;
    }
    smpOff += Math.max(0, byteLen);
  }

  return {
    format: 'mod',
    songName,
    numChannels,
    numPatterns,
    numInstruments: instruments.filter((_, i) => i > 0 && instruments[i]!.pcm !== null).length,
    bpm,
    speed,
    instruments,
    patterns,
    orderList,
  };
}

// ── S3M parser ────────────────────────────────────────────────────────────────

export function parseS3m(buffer: ArrayBuffer): ModImportResult {
  const buf = new Uint8Array(buffer);

  // Validate magic
  const magic = readStr(buf, 44, 4);
  if (magic !== 'SCRM') throw new Error('Not a valid S3M file (bad magic at 44)');

  const songName   = readStr(buf, 0, 28);
  const numOrders  = u16le(buf, 32);
  const numInst    = u16le(buf, 34);
  const numPat     = u16le(buf, 36);
  const initSpeed  = buf[49]!;   // ticks per row
  const initTempo  = buf[50]!;   // BPM
  const sampleType = u16le(buf, 42); // Ffi: 1=signed, 2=unsigned (ST3 default)

  // Channel settings (60..91): 0..7=left, 8..15=right, 16..31=AdLib, FF=unused
  const chanSettings = Array.from(buf.slice(60, 92));
  const activeChannels = chanSettings
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => v !== 0xFF && v < 16)
    .map(({ i }) => i);
  const numChannels = Math.min(activeChannels.length || 4, 16);

  // Order list
  const orderList: number[] = [];
  for (let i = 0; i < numOrders; i++) {
    const ord = buf[96 + i]!;
    if (ord !== 0xFF && ord !== 0xFE) orderList.push(ord);
  }

  // Instrument parapointers (2 bytes each, paragraph = 16 bytes)
  const instPtrs: number[] = [];
  for (let i = 0; i < numInst; i++) {
    instPtrs.push(u16le(buf, 96 + numOrders + i * 2) * 16);
  }

  // Pattern parapointers
  const patPtrs: number[] = [];
  for (let i = 0; i < numPat; i++) {
    patPtrs.push(u16le(buf, 96 + numOrders + numInst * 2 + i * 2) * 16);
  }

  // ── Parse instruments ──
  const instruments: ModInstrument[] = [{
    name: '', pcm: null, sampleRate: 8363, baseNote: 60,
    volume: 0, finetune: 0, loopEnabled: false, loopStart: 0, loopEnd: 0,
  }];

  for (let i = 0; i < numInst; i++) {
    const base = instPtrs[i]!;
    if (!base || base >= buf.length) {
      instruments.push({ name: '', pcm: null, sampleRate: 8363, baseNote: 60, volume: 0, finetune: 0, loopEnabled: false, loopStart: 0, loopEnd: 0 });
      continue;
    }
    const type = buf[base]!;
    if (type !== 1) {
      // Not a PCM sample (AdLib etc.) — push empty
      instruments.push({ name: '', pcm: null, sampleRate: 8363, baseNote: 60, volume: 0, finetune: 0, loopEnabled: false, loopStart: 0, loopEnd: 0 });
      continue;
    }

    // Sample data parapointer: bytes 13 (hi) + 14-15 (lo), paragraph-aligned
    const dataPara = (buf[base + 13]! << 16) | u16le(buf, base + 14);
    const dataOff  = dataPara * 16;

    const smpLen    = u32le(buf, base + 16);
    const loopStart = u32le(buf, base + 20);
    const loopEnd   = u32le(buf, base + 24);
    const vol       = buf[base + 28]!;
    const flags     = buf[base + 31]!;
    const c5speed   = u32le(buf, base + 32) || 8363;
    const name      = readStr(buf, base + 48, 28);
    const is16bit   = !!(flags & 4);
    const isStereo  = !!(flags & 2);
    const loopEnabled = !!(flags & 1) && loopEnd > loopStart;

    let pcm: Float32Array | null = null;
    if (smpLen > 0 && dataOff > 0 && dataOff + smpLen <= buf.length) {
      const numSamples = isStereo ? smpLen / (is16bit ? 4 : 2) : smpLen / (is16bit ? 2 : 1);
      pcm = new Float32Array(numSamples);
      if (is16bit) {
        // 16-bit signed (always LE in S3M)
        for (let s = 0; s < numSamples; s++) {
          const raw = u16le(buf, dataOff + s * 2 * (isStereo ? 2 : 1));
          const signed = raw < 0x8000 ? raw : raw - 0x10000;
          pcm[s] = signed / 32768.0;
        }
      } else {
        // 8-bit: S3M Ffi field — 1=signed, 2=unsigned (ST3 always writes 2=unsigned)
        const isSigned = sampleType === 1;
        for (let s = 0; s < numSamples; s++) {
          const raw = buf[dataOff + s * (isStereo ? 2 : 1)]!;
          if (isSigned) {
            pcm[s] = (raw < 128 ? raw : raw - 256) / 128.0;
          } else {
            pcm[s] = (raw - 128) / 128.0;
          }
        }
      }
    }

    instruments.push({
      name,
      pcm,
      sampleRate: c5speed,
      baseNote: 72,  // C-5 = MIDI 72 (C4=60, C5=72)
      // Same as MOD: vol=0 with data = effect-driven sample, default to full.
      volume: Math.round((vol > 0 ? vol : (smpLen > 0 ? 64 : 0)) / 64 * 127),
      finetune: 0,
      loopEnabled,
      loopStart: loopEnabled ? loopStart : 0,
      loopEnd:   loopEnabled ? loopEnd   : 0,
    });
  }

  // ── Parse patterns ──
  const patterns: PatternCell[][][] = [];
  const patternRowCount = 64;

  for (let pi = 0; pi < numPat; pi++) {
    const patBase = patPtrs[pi]!;
    const rows: PatternCell[][] = Array.from({ length: patternRowCount }, () =>
      Array.from({ length: 16 }, () => emptyCell())
    );

    if (!patBase || patBase >= buf.length) { patterns.push(rows); continue; }

    // Packed data starts after 2-byte length word
    let off = patBase + 2;
    let row = 0;

    while (row < patternRowCount && off < buf.length) {
      const packed = buf[off++]!;
      if (packed === 0x00) { row++; continue; } // end-of-row

      const ch = packed & 0x1F;
      const cell = ch < 16 ? rows[row]![ch]! : { note: 0, instrument: 0, cmd: 0, data: 0 };

      if (packed & 0x20) { // has note + instrument
        const noteByte = buf[off++]!;
        const instByte = buf[off++]!;

        if (noteByte !== 0xFF && noteByte !== 0xFE) {
          const octave = noteByte >> 4;
          const semi   = noteByte & 0x0F;
          // S3M: octave 3 note 0 = C-3, MIDI 48+... let's use C4=60 base
          // octave 0 → MIDI 12, octave 4 → MIDI 60, octave 5 → MIDI 72
          const midi = octave * 12 + semi + 12;
          cell.note = clampMidi(midi);
        }
        cell.instrument = instByte;
      }

      if (packed & 0x40) { // has volume
        const vbyte = buf[off++]!;
        if (vbyte <= 64) {
          cell.cmd  = 0x0C;
          cell.data = Math.round(vbyte / 64 * 255);
        }
      }

      if (packed & 0x80) { // has command + info
        const cmdByte  = buf[off++]!;
        const infoByte = buf[off++]!;
        // Map S3M commands to ModeCat equivalents
        // A = speed (ticks), T = tempo (BPM), C = set volume
        if (cmdByte === 1)  { cell.cmd = 0x0F; cell.data = infoByte; } // A: speed
        if (cmdByte === 20) { cell.cmd = 0x0F; cell.data = infoByte; } // T: tempo
        if (cmdByte === 3)  { cell.cmd = 0x0C; cell.data = Math.min(64, infoByte); } // C: volume (0-64)
      }

      if (ch < 16) rows[row]![ch] = cell;
    }

    patterns.push(rows);
  }

  const numPatterns = patterns.length;

  return {
    format: 's3m',
    songName,
    numChannels,
    numPatterns,
    numInstruments: instruments.filter((_, i) => i > 0 && instruments[i]!.pcm !== null).length,
    bpm: initTempo || 125,
    speed: initSpeed || 6,
    instruments,
    patterns,
    orderList,
  };
}

// ── Auto-detect and parse ─────────────────────────────────────────────────────

export function parseTrackerFile(buffer: ArrayBuffer, filename: string): ModImportResult {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 's3m') return parseS3m(buffer);
  if (ext === 'mod') return parseMod(buffer);

  // Try to auto-detect by magic
  const buf = new Uint8Array(buffer);
  if (buf.length > 48) {
    const magic = readStr(buf, 44, 4);
    if (magic === 'SCRM') return parseS3m(buffer);
  }
  if (buf.length >= 1084) {
    const ch = detectModChannels(buf);
    if (ch > 0) return parseMod(buffer);
  }
  throw new Error('Unrecognised tracker file format. Supported: .mod, .s3m');
}
