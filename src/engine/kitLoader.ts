/**
 * kitLoader — fetches drum kit WAV files and installs them as SampleInstruments
 * in the Zustand store, then updates the DrumConfig to wire voices to those slots.
 *
 * Each kit voice gets its own instrument slot, starting from the first free slot
 * (or overwriting slots 1–N if `overwrite` is true).
 *
 * Usage:
 *   const result = await loadKit(kit, useStore.getState(), { overwrite: false });
 *   if (result.error) console.warn(result.error);
 */

import type { DrumKit, KitVoice } from '../data/drumkits';
import type { SampleInstrument } from '../state/types';
import { useStore } from '../state/store';

export interface LoadKitOptions {
  /**
   * If true, overwrite existing instruments starting at slot 1.
   * If false (default), find free ('empty') slots.
   */
  overwrite?: boolean;
  /**
   * Maximum number of voices to load (defaults to all voices in the kit,
   * capped at the number of drum voices in drumConfig).
   */
  voiceLimit?: number;
  /** Called with progress info as each sample loads. */
  onProgress?: (loaded: number, total: number, name: string) => void;
}

export interface LoadKitResult {
  /** How many voices were successfully loaded. */
  loaded: number;
  /** Any error message (partial success is possible). */
  error?: string;
}

/** Shared AudioContext — created once, reused across loads. */
let _ctx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new AudioContext();
  }
  return _ctx;
}

/**
 * Fetch a WAV/audio file and decode it to a mono Float32Array at the browser's
 * native sample rate.  Returns null on failure (logs to console).
 */
async function fetchAndDecode(url: string): Promise<{ pcm: Float32Array; sampleRate: number } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const arrayBuffer = await resp.arrayBuffer();
    const ctx = getAudioContext();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    // Mix down to mono by averaging all channels.
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;
    const mono = new Float32Array(length);
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const data = audioBuffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        mono[i] += data[i]!;
      }
    }
    if (audioBuffer.numberOfChannels > 1) {
      const inv = 1 / audioBuffer.numberOfChannels;
      for (let i = 0; i < length; i++) mono[i] *= inv;
    }
    return { pcm: mono, sampleRate };
  } catch (err) {
    console.warn(`[kitLoader] Failed to load ${url}:`, err);
    return null;
  }
}

/**
 * Resolve instrument slots for loading a kit.
 *
 * Priority order:
 *  1. If `overwrite` is true → use slots 1..count unconditionally.
 *  2. If drum voices already have instrument slots assigned → reuse those same
 *     slots so that re-loading a kit replaces the existing voice samples rather
 *     than consuming a fresh run of empty slots each time.
 *  3. Otherwise → find the first `count` free (kind === 'empty') slots.
 */
function findFreeSlots(
  instruments: ReturnType<typeof useStore.getState>['instruments'],
  count: number,
  overwrite: boolean,
  drumVoices?: ReturnType<typeof useStore.getState>['drumConfig']['voices'],
): number[] {
  if (overwrite) {
    return Array.from({ length: count }, (_, i) => i + 1);
  }

  // Re-use slots the drum voices already point to (handles "load kit again").
  if (drumVoices) {
    const existing = drumVoices.slice(0, count).map((v) => v.instrument).filter((s) => s > 0);
    if (existing.length === count) return existing;
  }

  // Fall back to scanning for empty slots.
  const slots: number[] = [];
  for (let i = 1; i < instruments.length && slots.length < count; i++) {
    if (instruments[i]?.kind === 'empty') slots.push(i);
  }
  return slots;
}

/**
 * Load a drum kit into the store.
 *
 * Steps:
 *  1. Fetch + decode each WAV in parallel.
 *  2. Find free instrument slots (or overwrite from slot 1).
 *  3. Write a SampleInstrument for each voice.
 *  4. Update drumConfig voices with the new instrument slot and voice name.
 */
export async function loadKit(kit: DrumKit, options: LoadKitOptions = {}): Promise<LoadKitResult> {
  const { overwrite = false, onProgress } = options;
  const state = useStore.getState();
  const voiceCount = state.drumConfig.voices.length;
  const kitVoices = kit.voices.slice(0, voiceCount);
  const total = kitVoices.length;

  onProgress?.(0, total, '');

  // Fetch all samples in parallel.
  const decoded = await Promise.all(
    kitVoices.map(async (v, i) => {
      const result = await fetchAndDecode(v.sampleUrl);
      onProgress?.(i + 1, total, v.name);
      return { voice: v, decoded: result };
    })
  );

  // Find instrument slots.
  const successful = decoded.filter((d) => d.decoded !== null);
  const freshState = useStore.getState();
  const slots = findFreeSlots(freshState.instruments, successful.length, overwrite, freshState.drumConfig.voices);

  if (slots.length < successful.length) {
    return {
      loaded: 0,
      error: `Not enough free instrument slots (need ${successful.length}, found ${slots.length}). Try overwriting existing instruments.`,
    };
  }

  // Write instruments + update drum voices.
  let slotIdx = 0;
  let loadedCount = 0;

  for (let vi = 0; vi < kitVoices.length; vi++) {
    const entry = decoded[vi]!;
    if (!entry.decoded) continue; // skip failed samples

    const slot = slots[slotIdx++]!;
    const voice = entry.voice as KitVoice;

    // Build the SampleInstrument.
    const inst: SampleInstrument = {
      kind: 'sample',
      name: voice.name,
      pcm: entry.decoded.pcm,
      sampleRate: entry.decoded.sampleRate,
      baseNote: voice.defaultNote,
      loopEnabled: false,
      loopStart: 0,
      loopEnd: 0,
      volume: 100,
      transpose: 0,
      finetune: 0,
      defaultPitch: voice.defaultNote,
      suppressNoteOff: voice.oneShot,
      attackMs: 0,
      decayMs: 0,
      sustain: 1,
      releaseMs: voice.oneShot ? 0 : 20,
      lengthRows: 0,
    };

    useStore.getState().setInstrument(slot, inst);

    // Update the corresponding drum voice.
    useStore.getState().setDrumVoice(vi, {
      name: voice.name,
      instrument: slot,
      defaultNote: voice.defaultNote,
    });

    loadedCount++;
  }

  return { loaded: loadedCount };
}
