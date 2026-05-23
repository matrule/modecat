// JSON save/load for songs.
//
// Float32Array contents (sample PCM, synth waveforms) are encoded as
// base64-of-the-underlying-Uint8Array so the JSON stays valid and round-trips
// losslessly.

import {
  defaultWaveform,
} from './types';
import type {
  Clip,
  HybridInstrument,
  Instrument,
  MidiInstrument,
  MidiMessage,
  Pattern,
  SampleInstrument,
  SerialisedInstrument,
  SongFile,
  SynthInstrument,
} from './types';
import { useStore } from './store';

function f32ToBase64(arr: Float32Array): string {
  // We chunk through String.fromCharCode to avoid O(n^2) string concatenation
  // for multi-megabyte sample buffers.
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const sub = bytes.subarray(i, Math.min(bytes.length, i + CHUNK));
    parts.push(String.fromCharCode.apply(null, sub as unknown as number[]));
  }
  return btoa(parts.join(''));
}

function base64ToF32(s: string): Float32Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // Note: passing the underlying buffer to Float32Array requires a 4-byte aligned offset.
  // We copy into a freshly-allocated buffer to guarantee alignment.
  const aligned = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(aligned).set(bytes);
  return new Float32Array(aligned);
}

function serializeInstrument(inst: Instrument, includeData = true): SerialisedInstrument {
  if (inst.kind === 'sample') {
    // When saving without instrument data, keep all metadata but drop the PCM blob.
    const pcm = includeData && inst.pcm ? f32ToBase64(inst.pcm) : null;
    return { ...inst, pcm };
  }
  if (inst.kind === 'hybrid') {
    const pcm = includeData && inst.pcm ? f32ToBase64(inst.pcm) : null;
    return { ...inst, pcm };
  }
  if (inst.kind === 'synth') {
    // Synth waveforms are tiny (32 floats each) — always include them.
    const { waveforms, ...rest } = inst;
    return { ...rest, waveforms: waveforms.map(f32ToBase64) };
  }
  return inst;
}

function deserializeInstrument(s: SerialisedInstrument): Instrument {
  if (s.kind === 'sample') {
    const sample = s as Omit<SampleInstrument, 'pcm'> & { pcm: string | null; loopEnabled?: boolean; attackMs?: number; decayMs?: number; sustain?: number; releaseMs?: number; lengthRows?: number };
    return {
      ...sample,
      pcm: sample.pcm ? base64ToF32(sample.pcm) : null,
      loopEnabled: sample.loopEnabled ?? false, // default for saves made before loopEnabled was added
      // AHDSR defaults for saves made before envelope was added to SampleInstrument:
      attackMs:   sample.attackMs   ?? 5,
      decayMs:    sample.decayMs    ?? 0,
      sustain:    sample.sustain    ?? 1,
      releaseMs:  sample.releaseMs  ?? 110,
      lengthRows: sample.lengthRows ?? 0,
    };
  }
  if (s.kind === 'hybrid') {
    const raw = s as Omit<HybridInstrument, 'pcm'> & { pcm: string | null };
    return {
      ...raw,
      pcm: raw.pcm ? base64ToF32(raw.pcm) : null,
      pitchProg: raw.pitchProg ?? [],
      volProg: raw.volProg ?? [],
      loopEnabled: raw.loopEnabled ?? false,
    } as HybridInstrument;
  }
  if (s.kind === 'synth') {
    type SerialisedSynth = Omit<SynthInstrument, 'waveforms'> & {
      waveforms?: string[];
      waveform?: string; // legacy v1/v2 single-waveform field
    };
    const raw = s as SerialisedSynth;
    let waveforms: Float32Array[];
    if (raw.waveforms && raw.waveforms.length > 0) {
      waveforms = raw.waveforms.map(base64ToF32);
    } else if (raw.waveform) {
      // Migrate old single-waveform format.
      waveforms = [base64ToF32(raw.waveform)];
    } else {
      waveforms = [defaultWaveform()];
    }
    return {
      ...raw,
      waveforms,
      pitchProg: raw.pitchProg ?? [],
      waveSpeed: raw.waveSpeed ?? 1,
      volProg: raw.volProg ?? [],
    } as SynthInstrument;
  }
  return s as MidiInstrument | Instrument;
}

/**
 * Serialise the current song to a SongFile.
 *
 * @param includeInstruments - When false, PCM blobs are omitted from sample
 *   instruments (set to null).  All other instrument metadata (name, kind,
 *   tuning, volume, loop points…) is always preserved.  Synth waveforms are
 *   tiny (32 floats) and are always included.
 */
export function exportSongFile(includeInstruments = true): SongFile {
  const s = useStore.getState();
  return {
    format: 'modecat',
    version: 2,
    meta: s.meta,
    song: s.song,
    patterns: s.patterns,
    instruments: s.instruments.map((inst) => serializeInstrument(inst, includeInstruments)),
    transport: { bpm: s.transport.bpm, speed: s.transport.speed, loopSong: s.transport.loopSong },
    mutes: s.trackFlags.map((f) => f.mute),
    solos: s.trackFlags.map((f) => f.solo),
    midiMessages: s.midiMessages as MidiMessage[],
    clips: s.clips,
    arpSequences: s.arpSequences,
  };
}

export function importSongFile(raw: unknown): void {
  if (!isSongFile(raw)) throw new Error('Not a valid modecat song file.');
  const file = raw as SongFile;
  // Backward compat: older saves don't have sectionMarkers on the song object.
  const song = {
    positions: file.song.positions,
    sectionMarkers: (file.song as { sectionMarkers?: unknown }).sectionMarkers
      ? (file.song as { sectionMarkers: { beforePos: number; name: string }[] }).sectionMarkers
      : [],
  };
  useStore.getState().loadFromJson({
    meta: file.meta,
    song,
    // Ensure backward compat: old saves won't have clipPlacements on patterns.
    patterns: (file.patterns as Pattern[]).map((p) => ({
      ...p,
      clipPlacements: p.clipPlacements ?? [],
    })),
    instruments: file.instruments.map(deserializeInstrument),
    transport: file.transport,
    mutes: file.mutes,
    solos: file.solos,
    midiMessages: file.midiMessages,
    clips: (file.clips ?? []) as Clip[],
  });
}

function isSongFile(x: unknown): x is SongFile {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return o.format === 'modecat' && (o.version === 1 || o.version === 2);
}

export function downloadSong(filename = 'untitled.modecat.json', includeInstruments = true) {
  const data = JSON.stringify(exportSongFile(includeInstruments), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function loadSongFromFile(file: File): Promise<void> {
  const text = await file.text();
  const raw = JSON.parse(text);
  importSongFile(raw);
}

// ── Instrument file save / load ───────────────────────────────────────────────

export interface InstrumentFileEntry {
  /** Target slot index (0–31). The dialog lets the user override this. */
  slot: number;
  data: SerialisedInstrument;
}

export interface InstrumentFileFormat {
  format: 'modecat-instruments';
  version: 1;
  instruments: InstrumentFileEntry[];
}

/** Re-export so the load dialog can hydrate SerialisedInstrument → Instrument. */
export { deserializeInstrument };

function downloadJson(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Serialize the currently selected instrument and trigger a browser download. */
export function saveInstrumentFile(idx: number): void {
  const inst = useStore.getState().instruments[idx];
  if (!inst || inst.kind === 'empty') return;
  const payload: InstrumentFileFormat = {
    format: 'modecat-instruments',
    version: 1,
    instruments: [{ slot: idx, data: serializeInstrument(inst, true) }],
  };
  const safe = (inst.name || `slot${idx}`).replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  downloadJson(payload, `${safe}.modecat-inst.json`);
}

/** Serialize all non-empty instruments and trigger a browser download. */
export function saveAllInstrumentsFile(songTitle = 'instruments'): void {
  const entries: InstrumentFileEntry[] = [];
  useStore.getState().instruments.forEach((inst, idx) => {
    if (inst.kind !== 'empty') {
      entries.push({ slot: idx, data: serializeInstrument(inst, true) });
    }
  });
  if (entries.length === 0) return;
  const payload: InstrumentFileFormat = { format: 'modecat-instruments', version: 1, instruments: entries };
  const safe = (songTitle || 'instruments').replace(/\s+/g, '_').toLowerCase();
  downloadJson(payload, `${safe}-instruments.modecat-inst.json`);
}

/**
 * Parse a .modecat-inst.json file (or a plain serialized instrument object)
 * into an array of InstrumentFileEntry objects ready for the load dialog.
 */
export function parseInstrumentFile(text: string): InstrumentFileEntry[] {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object') throw new Error('Invalid instrument file');
  const obj = parsed as Record<string, unknown>;

  // Standard versioned format
  if (obj.format === 'modecat-instruments' && Array.isArray(obj.instruments)) {
    return obj.instruments as InstrumentFileEntry[];
  }
  // Plain serialized instrument (e.g. hand-crafted or older export)
  if (typeof obj.kind === 'string') {
    return [{ slot: 0, data: parsed as SerialisedInstrument }];
  }
  // Raw array of entries
  if (Array.isArray(parsed)) {
    return parsed as InstrumentFileEntry[];
  }
  throw new Error('Unrecognized instrument file format. Expected a .modecat-inst.json file.');
}
