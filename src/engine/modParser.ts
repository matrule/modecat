/**
 * modParser — extracts sample data from Amiga tracker module files.
 *
 * Supported formats:
 *   • ProTracker MOD  (M.K., M!K!, FLT4/8, 4CHN–32CH, …)
 *   • FastTracker 2 XM  (Extended Module header)
 *
 * Only sample PCM is extracted; pattern/song data is skipped.
 *
 * Sample rate reference:
 *   MOD: 8363 Hz  (NTSC Amiga C-5 period = 428 → ~8363 Hz)
 *   XM:  8363 Hz  (FT2 uses same reference for relative note 0)
 */

// ── Shared public types ───────────────────────────────────────────────────────

export interface ModSample {
  /** Raw sample name from the file header (may be blank). */
  name: string;
  /** Mono PCM normalised to –1..1. */
  pcm: Float32Array;
  /** Sample rate in Hz. */
  sampleRate: number;
  /** Loop start in samples. */
  loopStart: number;
  /** Loop end in samples. */
  loopEnd: number;
  /** True when the sample has an active loop. */
  loopEnabled: boolean;
  /** Volume 0–64. */
  volume: number;
  /** Finetune –8..7 (MOD nibble) or –128..127 (XM signed byte). */
  finetune: number;
  /**
   * Relative note (XM only) — semitone offset applied at the instrument level.
   * e.g. relativeNote = +12 means the sample was recorded an octave above C-5,
   * so it needs +12 semitones of transpose to sound correct at C-5.
   * Always 0 for MOD samples.
   */
  relativeNote: number;
}

export interface ParsedMod {
  /** Song/module title. */
  title: string;
  /** Format identifier — "MOD" or "XM". */
  format: 'MOD' | 'XM';
  /** Number of channels. */
  channels: number;
  /** All non-empty samples. */
  samples: ModSample[];
}

// ── String helpers ─────────────────────────────────────────────────────────

function readAscii(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    // Only keep printable ASCII to avoid garbage in names
    if (c >= 0x20 && c < 0x7F) s += String.fromCharCode(c);
    else if (c > 0x7E) s += '?';  // replace non-ASCII with ?
  }
  return s.trimEnd();
}

// ── Unified entry point ────────────────────────────────────────────────────

/**
 * Auto-detect format (XM or MOD) and extract samples.
 * Returns null if the buffer is unrecognised or too small.
 */
export function parseTrackerFile(buffer: ArrayBuffer): ParsedMod | null {
  if (buffer.byteLength < 20) return null;
  const view = new DataView(buffer);

  // XM magic: "Extended Module: " at offset 0
  const maybeXm = readRaw(view, 0, 17);
  if (maybeXm === 'Extended Module: ') return parseXmFile(buffer, view);

  // Fallback: attempt MOD
  return parseModFile(buffer, view);
}

// Kept for convenience — accepts a plain ArrayBuffer
function readRaw(view: DataView, offset: number, len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

// ══════════════════════════════════════════════════════════════════════════════
// XM (FastTracker 2 Extended Module)
// ══════════════════════════════════════════════════════════════════════════════

function parseXmFile(buffer: ArrayBuffer, view: DataView): ParsedMod | null {
  if (buffer.byteLength < 80) return null;

  // Module name (20 bytes at offset 17)
  const title = readAscii(view, 17, 20);

  // Version at 58–59 (LE): must be 0x0104 for FT2
  // (we accept any version — just log if unusual)

  // Main header variable block layout (all offsets from file start):
  //  60: headerSize (4)
  //  64: songLength (2)       — not needed for sample extraction
  //  66: restartPos (2)       — not needed
  //  68: numChannels (2)
  //  70: numPatterns (2)
  //  72: numInstruments (2)
  //  74: flags (2)
  //  76: defaultTempo (2)
  //  78: defaultBPM (2)
  //  80: orderTable (256 bytes)
  const headerSize     = view.getUint32(60, true);
  const numChannels    = view.getUint16(68, true);
  const numPatterns    = view.getUint16(70, true);
  const numInstruments = view.getUint16(72, true);

  // Patterns start at 60 + headerSize
  let pos = 60 + headerSize;

  // ── Skip patterns ────────────────────────────────────────────────────────
  for (let p = 0; p < numPatterns; p++) {
    if (pos + 9 > buffer.byteLength) return null;
    const patHdrSize  = view.getUint32(pos, true);
    const packedSize  = view.getUint16(pos + 7, true);
    pos += patHdrSize + packedSize;
    if (pos > buffer.byteLength) return null;
  }

  // ── Parse instruments ────────────────────────────────────────────────────
  const samples: ModSample[] = [];

  for (let i = 0; i < numInstruments; i++) {
    if (pos + 29 > buffer.byteLength) break;

    const instrStart = pos;
    const instrSize  = view.getUint32(pos, true);
    const instrName  = readAscii(view, pos + 4, 22);
    const numSamples = view.getUint16(pos + 27, true);

    if (numSamples === 0) {
      pos = instrStart + instrSize;
      continue;
    }

    // Sample header size is at pos+29 (4 bytes, LE); usually 40
    const sampleHdrSize = view.getUint32(pos + 29, true) || 40;

    // Advance past the instrument header
    pos = instrStart + instrSize;

    // ── Sample headers ──────────────────────────────────────────────────
    interface XmSampleHdr {
      byteLength:   number;
      loopStart:    number;
      loopLength:   number;
      volume:       number;
      finetune:     number;   // signed byte, –128..+127 (1/128-semitone units)
      typeFlags:    number;
      relativeNote: number;   // signed byte, semitone offset from C-5 (offset 16)
      name:         string;
    }

    const sampleHeaders: XmSampleHdr[] = [];
    for (let s = 0; s < numSamples; s++) {
      if (pos + sampleHdrSize > buffer.byteLength) break;
      sampleHeaders.push({
        byteLength:   view.getUint32(pos,      true),
        loopStart:    view.getUint32(pos +  4, true),
        loopLength:   view.getUint32(pos +  8, true),
        volume:       view.getUint8 (pos + 12),
        finetune:     view.getInt8  (pos + 13),
        typeFlags:    view.getUint8 (pos + 14),
        relativeNote: view.getInt8  (pos + 16),   // XM spec: signed byte at offset 16
        name:         readAscii(view, pos + 18, 22),
      });
      pos += sampleHdrSize;
    }

    // ── Sample data (delta-encoded, immediately after all headers) ───────
    for (const hdr of sampleHeaders) {
      if (hdr.byteLength === 0) continue;
      if (pos + hdr.byteLength > buffer.byteLength) break;

      const is16bit  = (hdr.typeFlags & 0x10) !== 0;
      const loopType = hdr.typeFlags & 0x03;

      let pcm: Float32Array;

      if (is16bit) {
        // 16-bit signed LE delta-encoded samples
        const numPcm = hdr.byteLength >>> 1;   // / 2
        pcm = new Float32Array(numPcm);
        let acc = 0;
        for (let j = 0; j < numPcm; j++) {
          const delta = view.getInt16(pos + j * 2, true);
          acc = (acc + delta) & 0xFFFF;
          pcm[j] = (acc >= 0x8000 ? acc - 0x10000 : acc) / 32768.0;
        }
      } else {
        // 8-bit signed delta-encoded samples
        const numPcm = hdr.byteLength;
        pcm = new Float32Array(numPcm);
        let acc = 0;
        for (let j = 0; j < numPcm; j++) {
          const delta = view.getInt8(pos + j);
          acc = (acc + delta) & 0xFF;
          pcm[j] = (acc >= 0x80 ? acc - 0x100 : acc) / 128.0;
        }
      }

      const loopEnabled  = loopType !== 0 && hdr.loopLength > 0;
      const stride       = is16bit ? 2 : 1;
      const loopStartSmp = hdr.loopStart  / stride;
      const loopLenSmp   = hdr.loopLength / stride;

      samples.push({
        name:         hdr.name || instrName || `Sample ${samples.length + 1}`,
        pcm,
        sampleRate:   8363,
        loopStart:    loopStartSmp,
        loopEnd:      loopStartSmp + loopLenSmp,
        loopEnabled,
        volume:       hdr.volume,
        finetune:     hdr.finetune,
        relativeNote: hdr.relativeNote,
      });

      pos += hdr.byteLength;
    }
  }

  return { title, format: 'XM', channels: numChannels, samples };
}

// ══════════════════════════════════════════════════════════════════════════════
// MOD (ProTracker / compatible)
// ══════════════════════════════════════════════════════════════════════════════

function magicChannels(magic: string): number {
  switch (magic) {
    case 'M.K.': case 'M!K!': case 'FLT4': case '4CHN': return 4;
    case 'FLT8': case '8CHN': return 8;
    case '6CHN': return 6;
  }
  const m = magic.match(/^(\d+)CH$/);
  if (m) return parseInt(m[1]!, 10);
  return 4;
}

function parseModFile(buffer: ArrayBuffer, view: DataView): ParsedMod | null {
  if (buffer.byteLength < 1084) return null;

  const title = readAscii(view, 0, 20);

  // Magic at 1080
  const magic    = readRaw(view, 1080, 4);
  const channels = magicChannels(magic);

  // Sample headers: 31 × 30 bytes from offset 20
  interface ModSampleHdr {
    name:           string;
    wordLen:        number;
    finetune:       number;   // raw 0–15
    volume:         number;
    loopStartWords: number;
    loopLenWords:   number;
  }

  const hdrs: ModSampleHdr[] = [];
  for (let i = 0; i < 31; i++) {
    const b = 20 + i * 30;
    hdrs.push({
      name:           readAscii(view, b, 22),
      wordLen:        view.getUint16(b + 22, false),   // big-endian
      finetune:       view.getUint8(b + 24) & 0x0F,
      volume:         view.getUint8(b + 25),
      loopStartWords: view.getUint16(b + 26, false),
      loopLenWords:   view.getUint16(b + 28, false),
    });
  }

  // Number of patterns = max(order table) + 1
  let maxPat = 0;
  for (let i = 0; i < 128; i++) {
    const p = view.getUint8(952 + i);
    if (p > maxPat) maxPat = p;
  }

  let samplePos = 1084 + (maxPat + 1) * 64 * channels * 4;
  if (samplePos > buffer.byteLength) return null;

  const samples: ModSample[] = [];

  for (const hdr of hdrs) {
    const byteLen = hdr.wordLen * 2;
    if (byteLen === 0) continue;

    const end = samplePos + byteLen;
    const available = Math.min(byteLen, buffer.byteLength - samplePos);
    if (available <= 0) break;

    // MOD samples are raw signed 8-bit PCM (no delta encoding)
    const pcm = new Float32Array(available);
    for (let j = 0; j < available; j++) {
      pcm[j] = view.getInt8(samplePos + j) / 128.0;
    }

    const loopStart  = hdr.loopStartWords * 2;
    const loopLen    = hdr.loopLenWords   * 2;
    const loopEnabled = loopLen > 2;
    const finetune    = hdr.finetune >= 8 ? hdr.finetune - 16 : hdr.finetune;

    samples.push({
      name:         hdr.name || `Sample ${samples.length + 1}`,
      pcm,
      sampleRate:   8363,
      loopStart,
      loopEnd:      loopStart + loopLen,
      loopEnabled,
      volume:       hdr.volume,
      finetune,
      relativeNote: 0,   // MOD format has no relative note concept
    });

    samplePos = end;
  }

  return { title, format: 'MOD', channels, samples };
}
