// Sequencer:
//
//   * Plays patterns chained by `song.positions[]`.
//   * Advances `songPos` when a pattern reaches the end (or earlier via
//     Bxx / Dxx).
//   * Honors per-track mute/solo (audible() check before sending anything).
//   * Plays three instrument kinds locally / remotely:
//        - midi   -> note_on/off events sent through the bridge
//        - sample -> AudioBufferSourceNode
//        - synth  -> AudioBufferSourceNode looping a 32-step waveform,
//                    routed through a GainNode with an AHDSR envelope.
//
// Timing model: 25 ms lookahead window, ~80 ms ahead.
//
// Continuous effects (#29):
//   03xx — Tone portamento (slide pitch toward current note at speed xx)
//   04xy — Vibrato (speed=x nibble, depth=y nibble); 0 = use previous
//   05xy — Portamento + volume slide (x=up, y=down per tick)
//   06xy — Vibrato + volume slide
//   07xy — Tremolo (speed=x nibble, depth=y nibble)
//
// Implementation uses Web Audio parameter scheduling so no JS timer is needed
// for modulation. LFO OscillatorNodes connect directly to AudioParams.

import type { BridgeClient } from '../bridge/client';
import type { MidiOutEvent } from '../bridge/protocol';
import { useStore } from '../state/store';
import {
  CHANNELS,
  type Clip,
  type HybridInstrument,
  type Instrument,
  type Pattern,
  type PatternCell,
  type SampleInstrument,
  type SynthInstrument,
} from '../state/types';
import { NOTE_HOLD } from './notes';

const LOOKAHEAD_INTERVAL_MS = 25;
const SCHEDULE_AHEAD_MS = 200;

// ── Per-channel state for continuous/carried effects ─────────────────────────

interface ChannelFxState {
  /** MIDI note of the last triggered note; used as portamento source. */
  lastNote: number;
  /** Portamento target note (set when first 03/05 is encountered at note-on). */
  portaTarget: number;
  /** Portamento slide direction: +1 for sliding up, -1 for sliding down. */
  portaDir: 1 | -1;
  /** Last non-zero portamento speed (reused when 03/05 data byte is 0). */
  portaSpeed: number;
  /** True if portamento is actively sliding toward portaTarget. */
  portaActive: boolean;
  /** Last non-zero vibrato speed nibble (reused when 04/06 nibble is 0). */
  vibratoSpeed: number;
  /** Last non-zero vibrato depth nibble. */
  vibratoDepth: number;
  /** Last non-zero tremolo speed nibble. */
  tremoloSpeed: number;
  /** Last non-zero tremolo depth nibble. */
  tremoloDepth: number;
  // ── User arpeggio sequence (cmd 0x20..0x2F) ──────────────────────────────
  /** Active sequence id (0..15), or -1 = none. */
  arpSeqId: number;
  /** Current step index within the sequence. */
  arpStep: number;
  /** Playback rate for the base (un-shifted) note; offsets are relative to this. */
  arpBaseRate: number;
}

function makeChannelFxState(): ChannelFxState {
  return { lastNote: 0, portaTarget: 0, portaDir: 1, portaSpeed: 4, portaActive: false,
           vibratoSpeed: 4, vibratoDepth: 4, tremoloSpeed: 4, tremoloDepth: 4,
           arpSeqId: -1, arpStep: 0, arpBaseRate: 1 };
}

// ── Pitch program simulation ──────────────────────────────────────────────────

/**
 * Simulate the pitch program offline to get a waveform index per cycle.
 *
 * @param prog      Parsed pitch program lines.
 * @param waveSpeed Cycles per program step (default 1).
 * @param cycles    How many cycles to simulate.
 */
function simulatePitchProg(
  prog: import('../state/types').PitchProgLine[],
  waveSpeed: number,
  cycles: number
): number[] {
  const speed = Math.max(1, waveSpeed);
  const result: number[] = [];
  if (prog.length === 0) {
    // No program — loop waveform 0.
    for (let i = 0; i < cycles; i++) result.push(0);
    return result;
  }

  let pc = 0;         // program counter
  let waveIdx = 0;    // current waveform
  let stepTimer = 0;  // cycles remaining on current step

  for (let c = 0; c < cycles; c++) {
    // Advance program when step timer expires.
    if (stepTimer <= 0) {
      // Consume lines until we hit a wave instruction (or end/jmp).
      let safetyFuse = prog.length * 2 + 4;
      while (safetyFuse-- > 0) {
        const line = prog[pc];
        if (!line || line.op === 'end') break;
        if (line.op === 'wave') { waveIdx = line.idx; pc++; stepTimer = speed - 1; break; }
        if (line.op === 'jmp')  { pc = Math.max(0, Math.min(prog.length - 1, line.target)); continue; }
        // Non-wave ops (CHU/CHD/WAI/VBD/VBS/ARP) — advance past for now.
        pc++;
      }
    } else {
      stepTimer--;
    }
    result.push(Math.max(0, waveIdx));
  }
  return result;
}

// ── Volume program simulation ─────────────────────────────────────────────────

/**
 * Simulate the volume program to produce a normalised gain value (0..1) for
 * each sequencer tick.
 *
 * Volume scale is 0–64 (ModeCat native). Bare-hex instructions (`wave` op)
 * set the volume directly. `CHU n` / `CHD n` add/subtract `n` per tick while
 * the program counter is advancing. `WAI n` pauses the PC for `n` ticks
 * (the current rate continues to apply). `JMP n` loops. `END` / `HLT` freezes
 * the volume at its current value.
 *
 * @param prog       Parsed volume program lines.
 * @param totalTicks How many ticks to simulate.
 * @param vMax       Master volume scale [0..1] applied to every output value.
 */
function simulateVolProg(
  prog: import('../state/types').PitchProgLine[],
  totalTicks: number,
  vMax: number
): Float32Array {
  const VOL_MAX = 64;
  const gains = new Float32Array(totalTicks);
  if (prog.length === 0) {
    gains.fill(vMax);
    return gains;
  }

  let vol  = 0;   // current volume 0..64
  let rate = 0;   // change per tick (signed, from CHU/CHD)
  let pc   = 0;   // program counter
  let wait = 0;   // countdown: ticks remaining before advancing PC
  let halted = false;

  for (let t = 0; t < totalTicks; t++) {
    // Advance the program counter if not waiting and not halted.
    if (!halted && wait <= 0) {
      let fuse = prog.length * 2 + 8;
      while (fuse-- > 0) {
        if (pc >= prog.length) { halted = true; break; }
        const line = prog[pc]!;
        if (line.op === 'end') { halted = true; break; }
        if (line.op === 'jmp') {
          pc = Math.max(0, Math.min(prog.length - 1, line.target));
          continue; // re-evaluate at new PC without consuming a tick
        }
        if (line.op === 'wave') {
          // Bare-hex: set volume directly (0..64).
          vol = Math.max(0, Math.min(VOL_MAX, line.idx));
          rate = 0;
          pc++;
          break;
        }
        if (line.op === 'chu') { rate = +line.speed; pc++; break; }
        if (line.op === 'chd') { rate = -line.speed; pc++; break; }
        if (line.op === 'wai') {
          // Wait n ticks; the current rate continues during the wait.
          wait = Math.max(0, line.ticks - 1);
          pc++;
          break;
        }
        // Unknown / unhandled op (vbd, vbs, arp — pitch-program ops): skip.
        pc++;
      }
    } else if (wait > 0) {
      wait--;
    }

    // Apply the current rate (ramp up or down) while not halted.
    if (!halted) {
      vol = Math.max(0, Math.min(VOL_MAX, vol + rate));
    }

    gains[t] = (vol / VOL_MAX) * vMax;
  }
  return gains;
}

// ── Active note tracking ──────────────────────────────────────────────────────

interface ActiveNote {
  /** performance.now() ms when this note should be released. */
  offAt: number;
  /** True if this note routes through the MIDI bridge. */
  midi: boolean;
  channel?: number;
  note: number;
  /** Index of the instrument that triggered this note */
  instrumentIndex?: number;
  /** MIDI note number of the triggered note */
  noteNumber?: number;
  source?: AudioBufferSourceNode;
  /** Instrument-volume gain node (AHDSR for synth, static for sample). */
  gain?: GainNode;
  /**
   * Tremolo modulation target. For samples this equals `gain`; for synths
   * it is a separate unity-gain node after the AHDSR so the two don't fight.
   */
  tremoTarget?: GainNode;
  /** Vibrato LFO oscillator and its amplitude gain. */
  pitchLfo?: OscillatorNode;
  pitchLfoGain?: GainNode;
  /** Tremolo LFO oscillator and its amplitude gain. */
  tremoLfo?: OscillatorNode;
  tremoLfoGain?: GainNode;
  /**
   * Release time in ms, copied from the instrument at note-on time.
   * When the next note fires on this channel, we schedule a release ramp
   * instead of hard-stopping the source, giving a natural fade-out tail.
   * Zero (or absent) means hard-cut (legacy behaviour).
   */
  releaseMs?: number;
  /**
   * When true this note should NOT be stopped when the next note fires on
   * the same channel — the source is "fire and forget" and plays to its
   * natural end.  Mirrors SampleInstrument.suppressNoteOff and is used for
   * one-shot percussion so short hits (hi-hats, claps) aren't cut off.
   */
  suppressNoteOff?: boolean;
}

// ── Sequencer class ───────────────────────────────────────────────────────────

export class Sequencer {
  private bridge: BridgeClient;
  private audioCtx: AudioContext | null = null;
  private timer: number | null = null;
  /** Clip library snapshot updated each tick — used by resolveRow. */
  private _clips: Clip[] = [];
  /**
   * One AnalyserNode per channel, wired between the channel's last gain node
   * and ctx.destination.  Created once alongside the AudioContext and reused
   * across note-triggers so the UI can read live waveform data at any time.
   */
  private analysers: AnalyserNode[] = [];
  /** Per-channel GainNode inserted between note output and the analyser — for the Volume Mixer. */
  private channelGains: GainNode[] = [];
  /** performance.now() time at which the *next* row should fire. */
  private nextRowAt = 0;
  /** Current row index within the active pattern. */
  private row = 0;
  /** Current song position. */
  private songPos = 0;
  /** Active notes per channel (so we can cut them on new notes). */
  private active: Array<ActiveNote | null> = Array(CHANNELS).fill(null);
  /**
   * Last `songJumpVersion` we observed from the store. When the user clicks
   * a song row in the SongEditor, the store bumps this counter; we notice
   * the mismatch at the top of the next tick and reconcile our playhead.
   */
  private lastJumpVersion = 0;

  // ── 1x effect state ──────────────────────────────────────────────────────
  /** Row set by `16 00` as the loop target; -1 = none. */
  private loopStart = -1;
  /** Remaining `16 nn` loop iterations; -1 = not in a loop. */
  private loopCount = -1;
  /** Remaining `1E nn` extra row-plays; -1 = not active. */
  private linePlayCount = -1;

  // ── Continuous effect state (per channel) ────────────────────────────────
  private channelFxState: ChannelFxState[] =
    Array.from({ length: CHANNELS }, () => makeChannelFxState());

  constructor(bridge: BridgeClient) {
    this.bridge = bridge;
  }

  /** Read-only access to the per-channel analysers for the oscilloscope UI. */
  getAnalysers(): readonly AnalyserNode[] {
    return this.analysers;
  }

  /** Set per-channel volume (0..100, where 100 = unity gain). */
  setChannelVolume(ch: number, vol: number) {
    const g = this.channelGains[ch];
    if (g) g.gain.value = Math.max(0, Math.min(1, vol / 100));
  }

  start() {
    if (this.timer != null) return;
    const s = useStore.getState();
    this.row = s.transport.row;
    this.songPos = s.transport.songPos;
    this.lastJumpVersion = s.songJumpVersion;
    this.nextRowAt = performance.now();
    if (!this.audioCtx) {
      const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      try { this.audioCtx = new Ctor(); } catch { this.audioCtx = null; }
      // Create one AnalyserNode per channel and connect each to the destination.
      // Note triggers will connect their final gain to analysers[ch] rather than
      // directly to ctx.destination, so the analyser acts as a transparent pass-through.
      if (this.audioCtx) {
        this.analysers = Array.from({ length: CHANNELS }, () => {
          const a = this.audioCtx!.createAnalyser();
          a.fftSize = 256;          // small → low latency, good enough for VU/waveform
          a.smoothingTimeConstant = 0.6;
          a.connect(this.audioCtx!.destination);
          return a;
        });
        // Per-channel volume gains: note output → channelGain → analyser → destination.
        const trackVolumes = useStore.getState().trackVolumes;
        this.channelGains = Array.from({ length: CHANNELS }, (_, ch) => {
          const g = this.audioCtx!.createGain();
          g.gain.value = (trackVolumes[ch] ?? 100) / 100;
          g.connect(this.analysers[ch]!);
          return g;
        });
      }
    }
    this.audioCtx?.resume?.();
    this.timer = window.setInterval(() => this.tick(), LOOKAHEAD_INTERVAL_MS);
  }

  stop() {
    if (this.timer != null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.allNotesOff();
    useStore.setState((s) => ({ transport: { ...s.transport, playing: false } }));
  }

  panic() {
    this.allNotesOff();
    const out = useStore.getState().selectedOutPortId;
    if (out) this.bridge.panic(out);
  }

  // ── Note lifecycle ────────────────────────────────────────────────────────

  /** Cut one channel cleanly, stopping all audio nodes and collecting MIDI off. */
  private cutChannel(ch: number, midiEvents: MidiOutEvent[], portId: string | null) {
    const a = this.active[ch];
    if (!a) return;
    if (a.midi && a.channel != null && portId) {
      midiEvents.push({ at: 0, type: 'note_off', channel: a.channel, note: a.note });
    }
    try { a.pitchLfo?.stop(); } catch {}
    a.pitchLfoGain?.disconnect();
    try { a.tremoLfo?.stop(); } catch {}
    a.tremoLfoGain?.disconnect();
    // Apply a short fade-out to prevent a click on abrupt note cut.
    // Time constant of 2ms → signal reaches ~0 within ~10ms.
    const ctx = this.audioCtx;
    if (ctx && a.gain) {
      const now = ctx.currentTime;
      a.gain.gain.cancelScheduledValues(now);
      a.gain.gain.setTargetAtTime(0, now, 0.002);
      try { a.source?.stop(now + 0.020); } catch {}
    } else {
      try { a.source?.stop(); } catch {}
    }
    this.active[ch] = null;
  }

  private allNotesOff() {
    const portId = useStore.getState().selectedOutPortId;
    const offs: MidiOutEvent[] = [];
    for (let c = 0; c < CHANNELS; c++) this.cutChannel(c, offs, portId);
    if (portId && offs.length) this.bridge.midiOut(portId, offs);
  }

  // ── Audio buffer caches ───────────────────────────────────────────────────

  private sampleBufferCache = new WeakMap<object, AudioBuffer>();
  private getSampleBuffer(inst: SampleInstrument): AudioBuffer | null {
    if (!this.audioCtx || !inst.pcm) return null;
    const cached = this.sampleBufferCache.get(inst);
    if (cached) return cached;
    const buf = this.audioCtx.createBuffer(1, inst.pcm.length, inst.sampleRate);
    // Ensure plain ArrayBuffer (not SharedArrayBuffer) for copyToChannel.
    buf.copyToChannel(new Float32Array(inst.pcm), 0);
    this.sampleBufferCache.set(inst, buf);
    return buf;
  }

  /**
   * Pre-render a synth note buffer by simulating the pitch program.
   *
   * Each pitch-program step selects a waveform (32 samples). The program
   * advances every `waveSpeed` cycles. `JMP n` loops; `END`/`HLT` freezes
   * on the last selected waveform.
   *
   * Buffer sample rate is chosen so one cycle at the base note = 32 samples,
   * giving natural-pitch playback at rate=1.0. The caller scales playbackRate
   * for the actual note pitch.
   */
  private renderSynthBuffer(inst: SynthInstrument, totalMs: number): AudioBuffer | null {
    if (!this.audioCtx) return null;
    const CYCLE = 32;
    const baseFreq = 440 * Math.pow(2, (inst.baseNote - 69) / 12);
    const sr = Math.max(8000, Math.round(baseFreq * CYCLE));
    const totalSamples = Math.max(CYCLE, Math.ceil((totalMs / 1000) * sr));
    const totalCycles  = Math.ceil(totalSamples / CYCLE);

    // Simulate pitch program to get waveform index per cycle.
    const waveSeq = simulatePitchProg(inst.pitchProg, inst.waveSpeed ?? 1, totalCycles);

    const buf  = this.audioCtx.createBuffer(1, totalCycles * CYCLE, sr);
    const data = buf.getChannelData(0);
    for (let c = 0; c < totalCycles; c++) {
      const wi = waveSeq[c] ?? 0;
      const wv = inst.waveforms[wi] ?? inst.waveforms[0];
      if (!wv) continue;
      for (let s = 0; s < CYCLE; s++) {
        data[c * CYCLE + s] = wv[s] ?? 0;
      }
    }
    return buf;
  }

  // ── LFO helpers ───────────────────────────────────────────────────────────

  /**
   * Attach (or refresh) a sinusoidal pitch LFO to an active note for vibrato.
   * Connects to `act.source.playbackRate`.
   * Speed and depth nibbles of 0 reuse the last values for this channel.
   */
  private attachPitchLFO(
    act: ActiveNote,
    ch: number,
    baseRate: number,
    tStart: number,
    msPerTick: number,
    speedNib: number,
    depthNib: number
  ) {
    const ctx = this.audioCtx;
    if (!ctx || !act.source) return;

    const spd = speedNib > 0 ? speedNib : this.channelFxState[ch].vibratoSpeed;
    const dep = depthNib > 0 ? depthNib : this.channelFxState[ch].vibratoDepth;
    if (!spd || !dep) return;

    this.channelFxState[ch].vibratoSpeed = spd;
    this.channelFxState[ch].vibratoDepth = dep;

    // Stop any existing pitch LFO before replacing.
    try { act.pitchLfo?.stop(tStart); } catch {}
    act.pitchLfoGain?.disconnect();

    // Frequency: spd cycles advance per 64 ticks of the vibrato table.
    const freq = Math.max(0.01, spd / (64 * msPerTick / 1000));
    // Depth: dep/16 semitones peak deviation, converted to playbackRate delta.
    const depthSemitones = dep / 16;
    const amplitude = baseRate * (Math.pow(2, depthSemitones / 12) - 1);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = freq;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = amplitude;

    lfo.connect(lfoGain);
    lfoGain.connect(act.source.playbackRate);
    lfo.start(tStart);

    act.pitchLfo = lfo;
    act.pitchLfoGain = lfoGain;
  }

  /**
   * Attach (or refresh) a sinusoidal volume LFO to an active note for tremolo.
   * Connects to `act.tremoTarget.gain`. Does not fight AHDSR automation
   * because for synths `tremoTarget` is a separate unity-gain node after
   * the AHDSR chain.
   */
  private attachVolumeLFO(
    act: ActiveNote,
    ch: number,
    tStart: number,
    msPerTick: number,
    speedNib: number,
    depthNib: number
  ) {
    const ctx = this.audioCtx;
    if (!ctx || !act.tremoTarget) return;

    const spd = speedNib > 0 ? speedNib : this.channelFxState[ch].tremoloSpeed;
    const dep = depthNib > 0 ? depthNib : this.channelFxState[ch].tremoloDepth;
    if (!spd || !dep) return;

    this.channelFxState[ch].tremoloSpeed = spd;
    this.channelFxState[ch].tremoloDepth = dep;

    try { act.tremoLfo?.stop(tStart); } catch {}
    act.tremoLfoGain?.disconnect();

    const freq = Math.max(0.01, spd / (64 * msPerTick / 1000));
    // Depth: dep/64 of current peak volume. LFO is bipolar, so amplitude/2
    // so the note oscillates between (peak - amp/2) and (peak + amp/2).
    const currentGain = act.tremoTarget.gain.value;
    const amplitude = currentGain * dep / 128; // half-range so peak stays below 1

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = freq;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = amplitude;

    lfo.connect(lfoGain);
    lfoGain.connect(act.tremoTarget.gain);
    lfo.start(tStart);

    act.tremoLfo = lfo;
    act.tremoLfoGain = lfoGain;
  }

  // ── Main scheduling loop ──────────────────────────────────────────────────

  private tick() {
    const state = useStore.getState();
    if (!state.transport.playing) { this.stop(); return; }

    // Reconcile against user-initiated song position jumps.
    if (state.songJumpVersion !== this.lastJumpVersion) {
      this.lastJumpVersion = state.songJumpVersion;
      this.songPos = state.transport.songPos;
      this.row = state.transport.row;
      this.nextRowAt = performance.now();
      this.allNotesOff();
    }

    // Snapshot store once per tick — avoids N×16 getState() calls inside the loop.
    // BPM/speed are re-read each iteration in case Fxx effect changes them mid-burst,
    // but patterns, instruments and audibility are stable across the 80ms window.
    const { song, patterns, instruments, selectedOutPortId, playTranspose, midiMessages, clips } = state;
    // Keep clip library current so resolveRow can overlay clip cells on top of
    // zeroed pattern rows during playback.
    this._clips = clips;
    const patMap = new Map(patterns.map((p) => [p.id, p]));
    const isAudible = Array.from({ length: CHANNELS }, (_, ch) => state.isAudible(ch));

    const horizon = performance.now() + SCHEDULE_AHEAD_MS;
    while (this.nextRowAt <= horizon) {
      // Re-read only transport so live BPM/speed changes (Fxx) are respected.
      const transport = useStore.getState().transport;

      const msPerTick = 2500 / Math.max(20, Math.min(255, transport.bpm));
      const msPerRow  = msPerTick * Math.max(1, Math.min(15, transport.speed));

      const patternId = song.positions[this.songPos];
      const pattern = patternId != null ? patMap.get(patternId) : undefined;
      if (!pattern) { this.stop(); return; }

      const deltaMs = this.nextRowAt - performance.now();
      const audibleRow = this.row;
      const audibleSongPos = this.songPos;

      const branch = this.scheduleRow(
        pattern, audibleRow, Math.max(0, deltaMs), msPerRow, msPerTick,
        instruments, selectedOutPortId, isAudible, playTranspose, midiMessages
      );

      // Update the visual playhead.
      window.setTimeout(() => {
        const live = useStore.getState();
        if (!live.transport.playing) return;
        useStore.setState({
          transport: { ...live.transport, row: audibleRow, songPos: audibleSongPos, patternIndex: audibleSongPos },
        });
      }, Math.max(0, deltaMs));

      // Advance row / song position.
      let nextRow: number;
      let nextSongPos: number;
      if (branch) {
        nextSongPos = branch.newSongPos ?? this.songPos;
        nextRow = branch.newRow;
        if (nextSongPos >= song.positions.length) {
          if (transport.loopSong) nextSongPos = 0;
          else { window.setTimeout(() => this.stop(), Math.max(0, deltaMs)); return; }
        } else if (nextSongPos < 0) {
          nextSongPos = transport.loopSong ? song.positions.length - 1 : 0;
        }
      } else if (this.row + 1 >= pattern.rows.length) {
        if (transport.patternLoop) {
          nextSongPos = this.songPos;
          nextRow = 0;
        } else {
          nextSongPos = this.songPos + 1;
          nextRow = 0;
          if (nextSongPos >= song.positions.length) {
            if (transport.loopSong) { nextSongPos = 0; }
            else { window.setTimeout(() => this.stop(), Math.max(0, deltaMs)); return; }
          }
        }
      } else {
        nextSongPos = this.songPos;
        nextRow = this.row + 1;
      }

      this.row = nextRow;
      this.songPos = nextSongPos;
      this.nextRowAt += msPerRow;
    }
  }

  // ── Clip resolution ───────────────────────────────────────────────────────

  /**
   * Return the effective cells for `row` in `pattern`, overlaying any clip
   * placements that cover this row on top of the (possibly zeroed) base row.
   *
   * When a clip is created the source cells are cleared so they don't bleed
   * through when the clip is repositioned. The sequencer must therefore read
   * clip data from the clip library rather than pattern.rows for any row that
   * falls inside a clip placement.
   */
  private resolveRow(pattern: Pattern, row: number): PatternCell[] | undefined {
    const base = pattern.rows[row];
    if (!base) return undefined;

    const placements = pattern.clipPlacements;
    if (!placements || placements.length === 0) return base;

    let resolved: PatternCell[] | null = null;

    for (const placement of placements) {
      // Skip if this row is outside the placement's tileRows span.
      if (row < placement.startRow || row >= placement.startRow + placement.tileRows) continue;

      const clip = this._clips.find((c) => c.id === placement.clipId);
      if (!clip || clip.rows.length === 0) continue;

      // Clip rows tile (loop) if tileRows > clip.rows.length.
      const clipRowIdx = (row - placement.startRow) % clip.rows.length;
      const clipRow = clip.rows[clipRowIdx];
      if (!clipRow) continue;

      // Lazy-copy base row before first mutation.
      if (!resolved) resolved = base.slice();

      for (let ci = 0; ci < clipRow.length; ci++) {
        if (!(placement.channelMask[ci] ?? true)) continue;
        const absCh = placement.startCh + ci;
        if (absCh >= CHANNELS) break;
        resolved[absCh] = clipRow[ci]!;
      }
    }

    return resolved ?? base;
  }

  // ── Row scheduling ────────────────────────────────────────────────────────

  private scheduleRow(
    pattern: Pattern,
    row: number,
    deltaMs: number,
    msPerRow: number,
    msPerTick: number,
    instruments: Instrument[],
    portId: string | null,
    isAudible: boolean[],
    playTranspose = 0,
    midiMessages: { name: string; bytes: number[] }[] = []
  ): { newSongPos?: number; newRow: number } | undefined {
    const cells = this.resolveRow(pattern, row);
    if (!cells) return undefined;

    const midiEvents: MidiOutEvent[] = [];
    let branch: { newSongPos?: number; newRow: number } | undefined;
    const tStart = (this.audioCtx?.currentTime ?? 0) + deltaMs / 1000;

    for (let ch = 0; ch < CHANNELS; ch++) {
      const cell = cells[ch];
      if (!cell) continue;

      // Effects that affect global/song state (processed even on muted tracks).
      const eff = this.processEffect(cell, pattern.rows.length);
      if (eff?.kind === 'branch') branch = { newSongPos: eff.songPos, newRow: eff.row };

      // FFF — hard stop note on this channel.
      if (eff?.kind === 'stopNote') {
        const offs: MidiOutEvent[] = [];
        this.cutChannel(ch, offs, portId);
        midiEvents.push(...offs);
        continue;
      }

      // Audibility check (mute/solo) — uses pre-computed snapshot from tick().
      if (!isAudible[ch]) {
        const offs: MidiOutEvent[] = [];
        this.cutChannel(ch, offs, portId);
        midiEvents.push(...offs);
        continue;
      }

      // 0x1C — MIDI program change (independent of note trigger).
      if (cell.cmd === 0x1c && portId) {
        const inst = instruments[cell.instrument] ?? instruments[0];
        const midiCh = inst?.kind === 'midi' ? inst.channel : 0;
        midiEvents.push({ at: Math.round(deltaMs), type: 'program', channel: midiCh, program: cell.data & 0x7f });
      }

      // 0x10 — Send MIDI message: data byte = slot index 0x00..0x0F.
      // Fires the raw byte sequence stored in midiMessages[data] via the bridge.
      if (cell.cmd === 0x10 && portId) {
        const idx = cell.data & 0x0f;
        const msg = midiMessages[idx];
        if (msg && msg.bytes.length > 0) {
          midiEvents.push({ at: Math.round(deltaMs), bytes: msg.bytes.slice() });
        }
      }

    // Sustaining effects on cells with no new note.
    // NOTE_HOLD (0xFE) sustains the current note like an empty note field —
    // effects still apply but no new note is triggered.
    if (cell.note === 0 || cell.note === NOTE_HOLD) {
      const act = this.active[ch];
if (act) {
          const spd = (cell.data >> 4) & 0xf;
          const dep = cell.data & 0xf;
          if (cell.cmd === 0x03 || cell.cmd === 0x05) {
            // Portamento continuation toward portaTarget.
            if (act.source) {
              const st = this.channelFxState[ch];
              if (st.portaActive && st.portaTarget > 0 && act.source) {
                const inst = instruments[act.instrumentIndex ?? 0] ?? instruments[0];
                if (inst && (inst.kind === 'sample' || inst.kind === 'synth' || inst.kind === 'hybrid')) {
                  const baseFreq = 440 * Math.pow(2, (inst.baseNote - 69) / 12);
                  const currentRate = act.source.playbackRate.value;
                  const currentNote = 69 + 12 * Math.log2(currentRate * baseFreq / 440);
                  const dist = st.portaTarget - currentNote;
                  const sign = Math.sign(dist) || st.portaDir;
                  if (Math.abs(dist) < 0.01) {
                    act.source.playbackRate.setValueAtTime(act.source.playbackRate.value, tStart);
                    st.portaActive = false;
                  } else {
                    const speed = cell.data > 0 ? cell.data : st.portaSpeed;
                    const slide = (speed / 16) * sign;
                    const toRate = Math.max(0.001, currentRate * Math.pow(2, slide / 12));
                    act.source.playbackRate.setValueAtTime(currentRate, tStart);
                    act.source.playbackRate.exponentialRampToValueAtTime(toRate, tStart + msPerRow / 1000);
                  }
                }
              }
            }
            // Portamento component of 05xy.
            if (cell.cmd === 0x05 && act.source) {
              const st = this.channelFxState[ch];
              if (st.portaActive && st.portaTarget > 0) {
                const inst = instruments[act.instrumentIndex ?? 0] ?? instruments[0];
                if (inst && (inst.kind === 'sample' || inst.kind === 'synth' || inst.kind === 'hybrid')) {
                  const baseFreq = 440 * Math.pow(2, (inst.baseNote - 69) / 12);
                  const currentRate = act.source.playbackRate.value;
                  const currentNote = 69 + 12 * Math.log2(currentRate * baseFreq / 440);
                  const dist = st.portaTarget - currentNote;
                  const sign = Math.sign(dist) || st.portaDir;
                  if (Math.abs(dist) >= 0.01) {
                    const speed = st.portaSpeed;
                    const slide = (speed / 16) * sign;
                    const toRate = Math.max(0.001, currentRate * Math.pow(2, slide / 12));
                    act.source.playbackRate.setValueAtTime(currentRate, tStart);
                    act.source.playbackRate.exponentialRampToValueAtTime(toRate, tStart + msPerRow / 1000);
                  }
                }
              }
            }
          } else if (cell.cmd === 0x04 || cell.cmd === 0x06) {
          // Vibrato continuation / refresh.
          const baseRate = act.source
            ? act.source.playbackRate.value
            : 1;
          this.attachPitchLFO(act, ch, baseRate, tStart, msPerTick, spd, dep);
        }
if (cell.cmd === 0x06 || cell.cmd === 0x05 || cell.cmd === 0x0d || cell.cmd === 0x0a) {
          this.applySustainingVolSlide(act, ch, cell.data, tStart, msPerRow, msPerTick);
        }
        if (cell.cmd === 0x07) {
          // Tremolo continuation / refresh.
          this.attachVolumeLFO(act, ch, tStart, msPerTick, spd, dep);
        }
        if ((cell.cmd === 0x01 || cell.cmd === 0x02) && act.source) {
          // Per-row pitch slide up (01xx) / down (02xx): each tick shifts the
          // pitch by `data / 16` semitones. Ramp playbackRate over the row.
          const speed = cell.data > 0 ? cell.data : 1;
          const ticksPerRow = Math.max(1, Math.round(msPerRow / Math.max(1, msPerTick)));
          const semiChange = (speed / 16) * ticksPerRow * (cell.cmd === 0x01 ? 1 : -1);
          const fromRate = act.source.playbackRate.value;
          const toRate = Math.max(0.001, fromRate * Math.pow(2, semiChange / 12));
          act.source.playbackRate.setValueAtTime(fromRate, tStart);
          act.source.playbackRate.exponentialRampToValueAtTime(toRate, tStart + msPerRow / 1000);
        }
        // Arpeggio (00xy): cycle base / base+x / base+y semitones per tick.
        if (cell.cmd === 0x00 && cell.data !== 0 && act.source) {
          this.applyArpeggio(act.source, act.source.playbackRate.value, cell.data, tStart, msPerRow, msPerTick);
        }
      }
      // User arpeggio sequence (2X xx) — advance one step per row while sustaining.
      {
        const st = this.channelFxState[ch];
        if (st.arpSeqId >= 0 && act?.source) {
          const seqs = useStore.getState().arpSequences;
          const seq = seqs.find((s) => s.id === st.arpSeqId);
          if (seq && seq.steps.length > 0) {
            st.arpStep++;
            if (st.arpStep >= seq.steps.length) {
              if (seq.loop) {
                st.arpStep = 0;
              } else {
                // Sequence finished — revert to base note, cancel.
                st.arpSeqId = -1;
                act.source.playbackRate.setValueAtTime(st.arpBaseRate, tStart);
              }
            }
            if (st.arpSeqId >= 0) {
              const offset = seq.steps[st.arpStep] ?? 0;
              const newRate = st.arpBaseRate * Math.pow(2, offset / 12);
              act.source.playbackRate.setValueAtTime(newRate, tStart);
            }
          } else {
            st.arpSeqId = -1; // seq deleted/missing — cancel silently
          }
        }
      }
      continue; // no new note to trigger
    }

      // Trigger the note.
      this.triggerCell(cell, ch, deltaMs, msPerRow, msPerTick, instruments, midiEvents, playTranspose);

      // User arpeggio (2X): initialise carry state after note is triggered.
      if (cell.cmd >= 0x20 && cell.cmd <= 0x2F) {
        const seqId = cell.cmd - 0x20;
        const st = this.channelFxState[ch];
        st.arpSeqId   = seqId;
        st.arpStep    = 0;
        // Grab base playback rate from the newly triggered source (if sample).
        const act = this.active[ch];
        st.arpBaseRate = act?.source ? act.source.playbackRate.value : 1;
        // Apply step 0 offset immediately (allows non-zero first step).
        if (act?.source) {
          const seqs = useStore.getState().arpSequences;
          const seq = seqs.find((s) => s.id === seqId);
          if (seq && seq.steps.length > 0) {
            const offset = seq.steps[0] ?? 0;
            if (offset !== 0) {
              act.source.playbackRate.setValueAtTime(
                st.arpBaseRate * Math.pow(2, offset / 12), tStart
              );
            }
          } else {
            st.arpSeqId = -1; // seq not found — cancel
          }
        }
      } else {
        // Any other note cancels a running user arpeggio on this channel.
        this.channelFxState[ch].arpSeqId = -1;
      }
    }

    if (portId && midiEvents.length) this.bridge.midiOut(portId, midiEvents);
    return branch;
  }

  /** Apply a per-row volume slide to the currently sustaining note. */
  private applySustainingVolSlide(
    act: ActiveNote,
    _ch: number,
    data: number,
    tStart: number,
    msPerRow: number,
    msPerTick: number
  ) {
    const target = act.tremoTarget ?? act.gain;
    if (!target) return;
    const slideUp   = (data >> 4) & 0xf;
    const slideDown = data & 0xf;
    const ticksPerRow = Math.round(msPerRow / msPerTick);
    const delta = (slideUp - slideDown) * ticksPerRow / 0x40;
    const currentVal = target.gain.value;
    const endVal = Math.max(0, Math.min(1, currentVal + delta));
    target.gain.setValueAtTime(currentVal, tStart);
    target.gain.linearRampToValueAtTime(endVal, tStart + msPerRow / 1000);
  }

  /**
   * Apply ModeCat arpeggio (cmd 00xy) to a BufferSource over the current row.
   *
   * Each tick cycles through three playback rates:
   *   tick % 3 === 0 → baseRate             (original note)
   *   tick % 3 === 1 → baseRate × 2^(x/12) (base + x semitones)
   *   tick % 3 === 2 → baseRate × 2^(y/12) (base + y semitones)
   *
   * data === 0 is a null-effect (no arpeggio). Cancels any previously
   * scheduled playbackRate automation for the row before scheduling steps.
   */
  private applyArpeggio(
    source: AudioBufferSourceNode,
    baseRate: number,
    data: number,
    tStart: number,
    msPerRow: number,
    msPerTick: number
  ) {
    if (data === 0) return;
    const hi = (data >> 4) & 0xf;
    const lo = data & 0xf;
    const rates = [
      baseRate,
      baseRate * Math.pow(2, hi / 12),
      baseRate * Math.pow(2, lo / 12),
    ];
    const ticksPerRow = Math.max(1, Math.round(msPerRow / Math.max(1, msPerTick)));
    const tickSec     = Math.max(0.001, msPerTick / 1000);
    source.playbackRate.cancelScheduledValues(tStart);
    for (let tick = 0; tick < ticksPerRow; tick++) {
      source.playbackRate.setValueAtTime(rates[tick % 3], tStart + tick * tickSec);
    }
  }

  // ── Effect routing ────────────────────────────────────────────────────────

  /** Process effects that change global / song state (position, tempo, loop). */
  private processEffect(
    cell: PatternCell,
    patLen: number
  ): { kind: 'branch'; songPos?: number; row: number } | { kind: 'tempo' } | { kind: 'stopNote' } | undefined {
    if (cell.cmd === 0 && cell.data === 0) return undefined;

    switch (cell.cmd) {
      case 0x0b: // POSITION JUMP
        return { kind: 'branch', songPos: cell.data, row: 0 };
      // NOTE: 0x0d in ModeCat is VOLUME SLIDE (not ProTracker pattern-break).
      // It is handled per-channel in the note-trigger and sustain paths below.
      case 0x0f: { // MISCELLANEOUS
        const d = cell.data;
        if (d === 0x00) return { kind: 'branch', songPos: this.songPos + 1, row: 0 };
        if (d === 0xfe) { window.setTimeout(() => this.stop(), 0); return { kind: 'tempo' }; }
        if (d === 0xff) return { kind: 'stopNote' };
        if (d >= 0x01 && d <= 0x1f) {
          useStore.setState((s) => ({ transport: { ...s.transport, speed: d } }));
        } else if (d >= 0x20 && d <= 0xf0) {
          useStore.setState((s) => ({ transport: { ...s.transport, bpm: d } }));
        }
        return { kind: 'tempo' };
      }
      case 0x16: {
        if (cell.data === 0) { this.loopStart = this.row; return undefined; }
        if (this.loopStart < 0) return undefined;
        if (this.loopCount < 0) this.loopCount = cell.data;
        if (this.loopCount > 0) { this.loopCount--; return { kind: 'branch', row: this.loopStart }; }
        this.loopCount = -1; this.loopStart = -1; return undefined;
      }
      case 0x1d:
        return { kind: 'branch', songPos: this.songPos + 1, row: Math.min(patLen - 1, cell.data) };
      case 0x1e: {
        if (this.linePlayCount < 0) this.linePlayCount = Math.max(0, cell.data - 1);
        if (this.linePlayCount > 0) { this.linePlayCount--; return { kind: 'branch', row: this.row }; }
        this.linePlayCount = -1; return undefined;
      }
      default:
        return undefined;
    }
  }

  // ── Note triggering ───────────────────────────────────────────────────────

  private triggerCell(
    cell: PatternCell,
    ch: number,
    deltaMs: number,
    msPerRow: number,
    msPerTick: number,
    instruments: Instrument[],
    midiOut: MidiOutEvent[],
    playTranspose = 0
  ) {
    if (cell.note === 0 && cell.instrument === 0) return;
    // Apply non-destructive play transpose (0 = no shift).
    if (playTranspose !== 0 && cell.note > 0 && cell.note !== NOTE_HOLD) {
      cell = { ...cell, note: Math.max(1, Math.min(127, cell.note + playTranspose)) };
    }

    // Cut any prior note on this channel.
    const prior = this.active[ch];
    if (prior) {
      if (prior.midi && prior.channel != null) {
        midiOut.push({ at: Math.round(deltaMs), type: 'note_off', channel: prior.channel, note: prior.note });
      }

      if (prior.suppressNoteOff) {
        // One-shot percussion: do NOT stop the source — just untrack it so it
        // plays to its natural buffer end (fire-and-forget).  LFOs are not
        // attached to one-shot samples so we skip those teardowns too.
        this.active[ch] = null;
      } else {
        try { prior.pitchLfo?.stop(); } catch {}
        prior.pitchLfoGain?.disconnect();
        try { prior.tremoLfo?.stop(); } catch {}
        prior.tremoLfoGain?.disconnect();

        // If the prior note has a release tail, fade it out gracefully rather
        // than hard-cutting. cancelAndHoldAtTime freezes the gain at its
        // current scheduled value at tStart, then we ramp to 0 over releaseMs.
        const priorReleaseMs = prior.releaseMs ?? 110;
        if (prior.source && prior.gain && priorReleaseMs > 0) {
          const ctx = prior.source.context;
          const tNow = ctx.currentTime + deltaMs / 1000;
          const r = Math.max(0.005, priorReleaseMs / 1000);
          try {
            prior.gain.gain.cancelAndHoldAtTime(tNow);
            prior.gain.gain.linearRampToValueAtTime(0, tNow + r);
            prior.source.stop(tNow + r + 0.05);
          } catch {
            // Fallback if cancelAndHoldAtTime is unavailable.
            try { prior.source.stop(); } catch {}
          }
        } else {
          try { prior.source?.stop(); } catch {}
        }
        this.active[ch] = null;
      }
    }
    if (cell.note === 0) return;

    const inst = instruments[cell.instrument];
    if (!inst || inst.kind === 'empty') return;

    switch (inst.kind) {
      case 'midi':   return this.playMidi(inst, cell, ch, deltaMs, msPerRow, msPerTick, midiOut);
      case 'sample': return this.playSample(inst, cell, ch, deltaMs, msPerRow, msPerTick);
      case 'synth':  return this.playSynth(inst, cell, ch, deltaMs, msPerRow, msPerTick);
      case 'hybrid': return this.playHybrid(inst, cell, ch, deltaMs, msPerRow, msPerTick);
    }
  }

  // ── Instrument-specific note playback ─────────────────────────────────────

  private playMidi(
    inst: Extract<Instrument, { kind: 'midi' }>,
    cell: PatternCell,
    ch: number,
    deltaMs: number,
    msPerRow: number,
    msPerTick: number,
    midiOut: MidiOutEvent[]
  ) {
    const lastNote = this.channelFxState[ch].lastNote;

    // Velocity computation.
    let vel = inst.velocity & 0x7f;
    if (cell.cmd === 0x0c) {
      vel = Math.round(Math.min(0x40, Math.max(0, cell.data)) / 0x40 * 127);
    } else if (cell.cmd === 0x1a) {
      vel = Math.min(127, vel + cell.data * 2);
    } else if (cell.cmd === 0x1b) {
      vel = Math.max(0,   vel - cell.data * 2);
    }

    // Note (with one-shot pitch shift for 0x11/0x12, plus instrument transpose/finetune).
    let note = cell.note;
    if (cell.cmd === 0x11) note = Math.min(127, note + cell.data);
    if (cell.cmd === 0x12) note = Math.max(1,   note - cell.data);
    note = Math.max(1, Math.min(127, note + inst.transpose + Math.round(inst.finetune / 8)));

    // Portamento (03/05): use MIDI portamento controllers (CC#65 on/off, CC#5 time).
    if ((cell.cmd === 0x03 || cell.cmd === 0x05) && lastNote > 0) {
      const speed = cell.cmd === 0x03
        ? (cell.data > 0 ? cell.data : this.channelFxState[ch].portaSpeed)
        : this.channelFxState[ch].portaSpeed;
      this.channelFxState[ch].portaSpeed = speed;
      this.channelFxState[ch].portaTarget = note;
      this.channelFxState[ch].portaDir = note >= lastNote ? 1 : -1;
      this.channelFxState[ch].portaActive = true;
      const portaTimeCC = Math.min(127, Math.round(127 - (speed / 16) * 127));
      midiOut.push({ at: Math.round(deltaMs), type: 'cc', channel: inst.channel, controller: 65, value: 127 });
      midiOut.push({ at: Math.round(deltaMs), type: 'cc', channel: inst.channel, controller: 5,  value: portaTimeCC });
    } else {
      this.channelFxState[ch].portaActive = false;
    }

    // Note length.
    const lengthRows = inst.lengthRows;
    const offAtRelMs = (cell.cmd === 0x18 && cell.data > 0)
      ? Math.round(deltaMs + cell.data * msPerTick)
      : Math.round(deltaMs + lengthRows * msPerRow - 1);

    midiOut.push({ at: Math.round(deltaMs), type: 'note_on',  channel: inst.channel, note, velocity: vel });
    if (!inst.suppressNoteOff) {
      midiOut.push({ at: offAtRelMs, type: 'note_off', channel: inst.channel, note });
    }

     this.channelFxState[ch].lastNote = note;
     this.active[ch] = { offAt: performance.now() + offAtRelMs, midi: true, channel: inst.channel, note, instrumentIndex: cell.instrument, noteNumber: note };
  }

  private playSample(
    inst: SampleInstrument,
    cell: PatternCell,
    ch: number,
    deltaMs: number,
    msPerRow: number,
    msPerTick: number
  ) {
    const ctx = this.audioCtx;
    const buf = this.getSampleBuffer(inst);
    if (!ctx || !buf) return;

    const lastNote = this.channelFxState[ch].lastNote;

    // Apply instrument transpose; keep finetune separate as a fractional semitone
    // so it feeds directly into the playback rate rather than being rounded to
    // the nearest whole note (which would cause a pitch step of up to ±0.5st).
    let effectiveNote = cell.note + inst.transpose;
    effectiveNote = Math.max(1, Math.min(127, effectiveNote));

    // One-shot pitch offset (0x11/0x12); portamento overrides in a moment.
    const semidelta = cell.cmd === 0x11 ? cell.data : cell.cmd === 0x12 ? -cell.data : 0;
    // finetune range: -8..+7 (each unit = 1/8 semitone). Include fractionally.
    const baseRate = Math.pow(2, (effectiveNote - inst.baseNote + semidelta + inst.finetune / 8) / 12);

    const src = ctx.createBufferSource();
    src.buffer = buf;

    // ── Sample loop ───────────────────────────────────────────────────────
    if (inst.loopEnabled && buf.length > 0) {
      src.loop = true;
      src.loopStart = inst.loopStart / inst.sampleRate;
      src.loopEnd   = inst.loopEnd > 0
        ? Math.min(inst.loopEnd, buf.length) / inst.sampleRate
        : buf.duration;
    }

    const tStart = ctx.currentTime + deltaMs / 1000;
    // Gain envelope start must not be in the past — if the scheduler tick was
    // late (GC, heavy render) deltaMs can be negative, which compresses or
    // skips the attack ramp entirely and produces a click.  We floor the
    // envelope start at "now + 1 ms" while leaving tStart (the rhythmic
    // position) intact so note timing stays correct.
    const tEnv = Math.max(tStart, ctx.currentTime + 0.001);

    // ── Portamento (03xx / 05xy) ──────────────────────────────────────────
    const portaActive = (cell.cmd === 0x03 || cell.cmd === 0x05) && lastNote > 0;
    if (portaActive) {
      const speed = cell.cmd === 0x03
        ? (cell.data > 0 ? cell.data : this.channelFxState[ch].portaSpeed)
        : this.channelFxState[ch].portaSpeed;
      if (speed > 0) this.channelFxState[ch].portaSpeed = speed;
      const portSpeed = this.channelFxState[ch].portaSpeed;
      const fromRate = Math.pow(2, (lastNote - inst.baseNote) / 12);
      const targetNote = effectiveNote;
      const dir: 1 | -1 = effectiveNote >= lastNote ? 1 : -1;
      this.channelFxState[ch].portaTarget = targetNote;
      this.channelFxState[ch].portaDir = dir;
      this.channelFxState[ch].portaActive = true;
      const semidist = Math.abs(effectiveNote - lastNote);
      const slideMs = Math.min((semidist * 16 / Math.max(1, portSpeed)) * msPerTick, 16 * msPerRow);
      src.playbackRate.setValueAtTime(fromRate, tStart);
      src.playbackRate.exponentialRampToValueAtTime(baseRate, tStart + Math.max(0.001, slideMs / 1000));
    } else {
      src.playbackRate.value = baseRate;
      this.channelFxState[ch].portaActive = false;
    }

    // ── Per-row pitch slide (01xx up / 02xx down) on new note ────────────
    if (cell.cmd === 0x01 || cell.cmd === 0x02) {
      const speed = cell.data > 0 ? cell.data : 1;
      const ticksPerRow = Math.max(1, Math.round(msPerRow / Math.max(1, msPerTick)));
      const semiChange = (speed / 16) * ticksPerRow * (cell.cmd === 0x01 ? 1 : -1);
      const toRate = Math.max(0.001, baseRate * Math.pow(2, semiChange / 12));
      src.playbackRate.setValueAtTime(baseRate, tStart);
      src.playbackRate.exponentialRampToValueAtTime(toRate, tStart + msPerRow / 1000);
    }

    // ── Arpeggio (00xy) on new sample note ────────────────────────────────
    if (cell.cmd === 0x00 && cell.data !== 0) {
      this.applyArpeggio(src, baseRate, cell.data, tStart, msPerRow, msPerTick);
    }

    // ── Instrument volume ─────────────────────────────────────────────────
    let v64 = Math.min(1, inst.volume / 127);
    if (cell.cmd === 0x0c) {
      v64 = Math.min(0x40, Math.max(0, cell.data)) / 0x40;
    } else if (cell.cmd === 0x1a) {
      v64 = Math.min(1, v64 + cell.data / 0x40);
    } else if (cell.cmd === 0x1b) {
      v64 = Math.max(0, v64 - cell.data / 0x40);
    }

    const gain = ctx.createGain();
    // Default GainNode value is 1.0. Zero it immediately so there is no window
    // between node creation and the first scheduled automation event where the
    // source could play at full volume — the race that causes note-on clicks.
    gain.gain.value = 0;

    // ── AHDSR envelope for samples ────────────────────────────────────────
    // If any envelope field is non-zero we run the full AHDSR shape.
    // Otherwise we fall back to a bare 3ms anti-click ramp (legacy behaviour).
    const hasEnv = (inst.attackMs ?? 0) > 0
                || (inst.decayMs  ?? 0) > 0
                || (inst.releaseMs ?? 110) > 0
                || ((inst.sustain ?? 1) < 0.999 && (inst.sustain ?? 1) > 0)
                || (inst.lengthRows ?? 0) > 0;

    // Separate tremolo target so vol-slide/LFO doesn't fight AHDSR automation.
    const tremoTarget = hasEnv ? ctx.createGain() : gain;
    if (hasEnv) tremoTarget.gain.value = 1.0;

    let sampleStopAt: number | undefined;

    if (hasEnv) {
      const a   = Math.max(0.003, (inst.attackMs  ?? 5) / 1000);
      const d   = Math.max(0.001, (inst.decayMs   ?? 0) / 1000);
      const sus = Math.max(0, Math.min(1, inst.sustain ?? 1));
      const r   = Math.max(0.001, (inst.releaseMs ?? 110) / 1000);
      const holdMs = cell.cmd === 0x18 && cell.data > 0
        ? Math.max(0, cell.data * msPerTick - (inst.releaseMs ?? 110))
        : (inst.lengthRows ?? 0) > 0
          ? Math.max(0, (inst.lengthRows ?? 0) * msPerRow - (inst.releaseMs ?? 110))
          : undefined; // undefined = sustain until next note (loop/long sample)

      // Use tEnv (floored to never be in the past) so a late scheduler tick
      // doesn't compress or skip the attack ramp.
      gain.gain.setValueAtTime(0, tEnv);
      gain.gain.linearRampToValueAtTime(v64, tEnv + a);
      gain.gain.linearRampToValueAtTime(sus * v64, tEnv + a + d);

      if (holdMs !== undefined) {
        const tSusEnd = tEnv + a + d + holdMs / 1000;
        gain.gain.setValueAtTime(sus * v64, tSusEnd);
        gain.gain.linearRampToValueAtTime(0, tSusEnd + r);
        sampleStopAt = tSusEnd + r + 0.05;
      }
      // If holdMs is undefined the gain stays at sus*v64 until the source
      // node stops naturally (sample end / loop cut by next note).
    } else {
      // Legacy: 3ms anti-click ramp only.
      const ATTACK_S = 0.003;
      gain.gain.setValueAtTime(0, tEnv);
      gain.gain.linearRampToValueAtTime(v64, tEnv + ATTACK_S);
    }

    // ── Volume slide component of 05xy / 0Dxy / 0Axy ─────────────────────
    if (cell.cmd === 0x05 || cell.cmd === 0x0d || cell.cmd === 0x0a) {
      const slideUp   = (cell.data >> 4) & 0xf;
      const slideDown = cell.data & 0xf;
      const tpr = Math.round(msPerRow / msPerTick);
      const endVol = Math.max(0, Math.min(1, v64 + (slideUp - slideDown) * tpr / 0x40));
      if (hasEnv) {
        // Modulate the tremolo pass-through rather than the AHDSR gain.
        tremoTarget.gain.linearRampToValueAtTime(endVol / Math.max(0.001, v64), tEnv + msPerRow / 1000);
      } else {
        gain.gain.linearRampToValueAtTime(endVol, tEnv + msPerRow / 1000);
      }
    }

    // ── Sample offset (19xx) ──────────────────────────────────────────────
    const offsetSecs = cell.cmd === 0x19 ? (cell.data * 256) / inst.sampleRate : 0;

    // Route through channelGain → analyser so the oscilloscope UI can read it
    // and the Volume Mixer can control per-channel volume.
    const chGain = this.channelGains[ch];
    const analyser = this.analysers[ch];
    const outDest = chGain ?? analyser ?? ctx.destination;
    if (hasEnv) {
      src.connect(gain);
      gain.connect(tremoTarget);
      tremoTarget.connect(outDest);
    } else {
      src.connect(gain).connect(outDest);
    }
    src.start(tStart, offsetSecs);

    // Hard stop: either envelope end, or explicit 0x18 note-cut ticks.
    if (sampleStopAt !== undefined) {
      src.stop(sampleStopAt);
    } else if (cell.cmd === 0x18 && cell.data > 0 && !hasEnv) {
      src.stop(tStart + (cell.data * msPerTick) / 1000);
    }

    // ── Natural-end zero-ramp (anti-click for Suspect 1) ─────────────────
    // Non-looping samples can end on a non-zero PCM frame, causing a hard-cut
    // click even when the sample has been faded in the editor. We schedule a
    // short exponential decay (time constant 1ms, starting 3ms before the
    // buffer's natural end) so the gain reaches ~0 exactly as the source ends.
    // Only applied when there is no explicit stop already scheduled (looping
    // sustain notes are cut by the next note's own fade-out path instead).
    if (!inst.loopEnabled && sampleStopAt === undefined) {
      const remainingSecs = (buf.duration - offsetSecs) / Math.max(0.01, baseRate);
      const naturalEndT   = tStart + remainingSecs;
      const rampStartT    = naturalEndT - 0.003; // 3 ms headroom
      if (rampStartT > tStart + 0.001) {
        // setTargetAtTime: exponential decay toward 0 with τ = 1ms.
        // After 5τ (5ms) the gain is < 1% of its starting value — inaudible.
        gain.gain.setTargetAtTime(0, rampStartT, 0.001);
      }
    }

      const act: ActiveNote = {
        offAt: performance.now() + deltaMs + msPerRow,
        midi: false,
        note: effectiveNote,
        instrumentIndex: cell.instrument,
        noteNumber: effectiveNote,
        source: src,
        gain,
        tremoTarget,
        releaseMs: hasEnv ? (inst.releaseMs ?? 110) : 0,
        // One-shot flag: when true the source is not stopped if a subsequent
        // note fires on this channel before the buffer finishes playing.
        suppressNoteOff: inst.suppressNoteOff,
      };

    // ── Vibrato (04xy / 06xy at note-on) ─────────────────────────────────
    if (cell.cmd === 0x04 || cell.cmd === 0x06) {
      const spd = (cell.data >> 4) & 0xf;
      const dep = cell.data & 0xf;
      this.attachPitchLFO(act, ch, baseRate, tStart, msPerTick, spd, dep);
    }

    // ── Tremolo (07xy at note-on) ─────────────────────────────────────────
    if (cell.cmd === 0x07) {
      const spd = (cell.data >> 4) & 0xf;
      const dep = cell.data & 0xf;
      this.attachVolumeLFO(act, ch, tStart, msPerTick, spd, dep);
    }

    this.channelFxState[ch].lastNote = effectiveNote;
    this.active[ch] = act;
  }

  private playSynth(
    inst: SynthInstrument,
    cell: PatternCell,
    ch: number,
    deltaMs: number,
    msPerRow: number,
    msPerTick: number
  ) {
    const ctx = this.audioCtx;
    // Pre-render the waveform sequence for the note's full envelope duration.
    const envelopeMs = inst.lengthRows * msPerRow + inst.attackMs + inst.decayMs + inst.releaseMs;
    const buf = this.renderSynthBuffer(inst, envelopeMs);
    if (!ctx || !buf) return;

    const lastNote = this.channelFxState[ch].lastNote;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    // No looping — the buffer contains the complete waveform sequence.

    // Apply instrument transpose; finetune is fractional (1/8 semitone per unit)
    // and must not be rounded into the integer note — apply it in the rate calc.
    let effectiveNote = cell.note + inst.transpose;
    effectiveNote = Math.max(1, Math.min(127, effectiveNote));
    const semidelta = cell.cmd === 0x11 ? cell.data : cell.cmd === 0x12 ? -cell.data : 0;
    const baseFreq = 440 * Math.pow(2, (inst.baseNote - 69) / 12);
    const noteFreq = 440 * Math.pow(2, (effectiveNote + semidelta + inst.finetune / 8 - 69) / 12);
    const baseRate = noteFreq / baseFreq;

    const tStart = ctx.currentTime + deltaMs / 1000;

    // ── Portamento ────────────────────────────────────────────────────────
    if ((cell.cmd === 0x03 || cell.cmd === 0x05) && lastNote > 0) {
      const speed = cell.cmd === 0x03
        ? (cell.data > 0 ? cell.data : this.channelFxState[ch].portaSpeed)
        : this.channelFxState[ch].portaSpeed;
      if (speed > 0) this.channelFxState[ch].portaSpeed = speed;
      const portSpeed = this.channelFxState[ch].portaSpeed;
      const fromFreq = 440 * Math.pow(2, (lastNote - 69) / 12);
      const fromRate = fromFreq / baseFreq;
      this.channelFxState[ch].portaTarget = effectiveNote;
      this.channelFxState[ch].portaDir = effectiveNote >= lastNote ? 1 : -1;
      this.channelFxState[ch].portaActive = true;
      const semidist = Math.abs(effectiveNote - lastNote);
      const slideMs = Math.min((semidist * 16 / Math.max(1, portSpeed)) * msPerTick, 16 * msPerRow);
      src.playbackRate.setValueAtTime(fromRate, tStart);
      src.playbackRate.exponentialRampToValueAtTime(baseRate, tStart + Math.max(0.001, slideMs / 1000));
    } else {
      src.playbackRate.value = baseRate;
      this.channelFxState[ch].portaActive = false;
    }

    // ── Per-row pitch slide (01xx up / 02xx down) on new synth note ──────
    if (cell.cmd === 0x01 || cell.cmd === 0x02) {
      const speed = cell.data > 0 ? cell.data : 1;
      const ticksPerRow = Math.max(1, Math.round(msPerRow / Math.max(1, msPerTick)));
      const semiChange = (speed / 16) * ticksPerRow * (cell.cmd === 0x01 ? 1 : -1);
      const toRate = Math.max(0.001, baseRate * Math.pow(2, semiChange / 12));
      src.playbackRate.setValueAtTime(baseRate, tStart);
      src.playbackRate.exponentialRampToValueAtTime(toRate, tStart + msPerRow / 1000);
    }

    // ── Arpeggio (00xy) on new synth note ─────────────────────────────────
    if (cell.cmd === 0x00 && cell.data !== 0) {
      this.applyArpeggio(src, baseRate, cell.data, tStart, msPerRow, msPerTick);
    }

    // ── Pitch program: VBD / VBS / ARP ────────────────────────────────────
    // Scan the pitch program for vibrato (VBD depth + VBS speed) and arpeggio
    // (ARP offsets ARE) ops; apply them over the note's full duration.
    let ppVbdDepth = 0;
    let ppVbsSpeed = 0;
    let ppArpOffsets: number[] = [];
    for (const line of inst.pitchProg) {
      if (line.op === 'vbd') ppVbdDepth = line.depth;
      if (line.op === 'vbs') ppVbsSpeed = line.speed;
      if (line.op === 'arp') ppArpOffsets = line.offsets;
    }
    // Pitch-program ARP: schedule over the entire note duration.
    if (ppArpOffsets.length > 0 && cell.cmd !== 0x00) {
      const noteMs    = Math.max(msPerRow, inst.lengthRows * msPerRow);
      const totalTks  = Math.max(1, Math.ceil(noteMs / Math.max(1, msPerTick)));
      const tickSec   = Math.max(0.001, msPerTick / 1000);
      const arpeRates = [baseRate, ...ppArpOffsets.map((o) => baseRate * Math.pow(2, o / 12))];
      src.playbackRate.cancelScheduledValues(tStart);
      for (let tick = 0; tick < totalTks; tick++) {
        src.playbackRate.setValueAtTime(arpeRates[tick % arpeRates.length], tStart + tick * tickSec);
      }
    }

    // ── Volume ────────────────────────────────────────────────────────────
    let vMax = Math.min(1, inst.volume / 127);
    if (cell.cmd === 0x1a) vMax = Math.min(1, vMax + cell.data / 0x40);
    if (cell.cmd === 0x1b) vMax = Math.max(0, vMax - cell.data / 0x40);

    const gain = ctx.createGain();
    gain.gain.value = 0; // prevent 1.0-default race at note-on
    let stopAt: number;

    if (inst.volProg.length > 0) {
      // ── Volume program path ─────────────────────────────────────────────
      // Simulate the volume program at sequencer-tick resolution and schedule
      // a series of setValueAtTime calls on the gain node.
      const noteMs   = inst.lengthRows * msPerRow;
      const tickSec  = Math.max(0.001, msPerTick / 1000);
      const totalTks = Math.max(1, Math.ceil(noteMs / Math.max(1, msPerTick)));
      const curve    = simulateVolProg(inst.volProg, totalTks, vMax);
      gain.gain.setValueAtTime(0, tStart);
      for (let ti = 0; ti < totalTks; ti++) {
        gain.gain.setValueAtTime(Math.max(0, curve[ti] ?? 0), tStart + ti * tickSec);
      }
      gain.gain.setValueAtTime(0, tStart + noteMs / 1000);
      stopAt = tStart + noteMs / 1000 + 0.05;
    } else {
      // ── AHDSR envelope path ─────────────────────────────────────────────
      const a = Math.max(0.001, inst.attackMs  / 1000);
      const d = Math.max(0.001, inst.decayMs   / 1000);
      const sus = Math.max(0, Math.min(1, inst.sustain));
      const susLevel = sus * vMax;
      const r = Math.max(0.001, inst.releaseMs / 1000);
      const holdMs = cell.cmd === 0x18 && cell.data > 0
        ? Math.max(0, cell.data * msPerTick - inst.releaseMs)
        : Math.max(0, inst.lengthRows * msPerRow - inst.releaseMs);
      const tSusEnd = tStart + a + d + holdMs / 1000;

      gain.gain.setValueAtTime(0, tStart);
      gain.gain.linearRampToValueAtTime(vMax, tStart + a);
      gain.gain.linearRampToValueAtTime(susLevel, tStart + a + d);
      gain.gain.setValueAtTime(susLevel, tSusEnd);
      gain.gain.linearRampToValueAtTime(0, tSusEnd + r);
      stopAt = tSusEnd + r + 0.05;
    }

    // Tremolo target: separate unity-gain node so LFO doesn't interfere with
    // the AudioParam automation on `gain`.
    const tremoTarget = ctx.createGain();
    tremoTarget.gain.value = 1.0;

    src.connect(gain);
    gain.connect(tremoTarget);
    // Route through channelGain → analyser → destination.
    const chGainSynth = this.channelGains[ch];
    const analyserSynth = this.analysers[ch];
    tremoTarget.connect(chGainSynth ?? analyserSynth ?? ctx.destination);

    // Volume slide component of 05xy / 0Dxy / 0Axy (on top of the start gain).
    if ((cell.cmd === 0x05 || cell.cmd === 0x0d || cell.cmd === 0x0a) && inst.volProg.length === 0) {
      const slideUp   = (cell.data >> 4) & 0xf;
      const slideDown = cell.data & 0xf;
      const tpr = Math.round(msPerRow / msPerTick);
      const endVal = Math.max(0, Math.min(1, vMax + (slideUp - slideDown) * tpr / 0x40));
      // Modulate tremoTarget (not gain, since gain has AHDSR).
      tremoTarget.gain.linearRampToValueAtTime(endVal / Math.max(0.001, vMax), tStart + msPerRow / 1000);
    }

    src.start(tStart);
    src.stop(stopAt);

    const act: ActiveNote = {
      offAt: performance.now() + deltaMs + msPerRow,
      midi: false,
      note: effectiveNote,
      instrumentIndex: cell.instrument,
      noteNumber: effectiveNote,
      source: src,
      gain,
      tremoTarget,
      releaseMs: inst.releaseMs ?? 110,
    };

    // ── Vibrato ───────────────────────────────────────────────────────────
    if (cell.cmd === 0x04 || cell.cmd === 0x06) {
      const spd = (cell.data >> 4) & 0xf;
      const dep = cell.data & 0xf;
      this.attachPitchLFO(act, ch, baseRate, tStart, msPerTick, spd, dep);
    }

    // ── Pitch program VBD/VBS vibrato (applied after 04/06 so cmd overrides) ──
    if (ppVbdDepth > 0 && ppVbsSpeed > 0 && cell.cmd !== 0x04 && cell.cmd !== 0x06) {
      this.attachPitchLFO(act, ch, baseRate, tStart, msPerTick, ppVbsSpeed, ppVbdDepth);
    }

    // ── Tremolo ───────────────────────────────────────────────────────────
    if (cell.cmd === 0x07) {
      const spd = (cell.data >> 4) & 0xf;
      const dep = cell.data & 0xf;
      this.attachVolumeLFO(act, ch, tStart, msPerTick, spd, dep);
    }

    this.channelFxState[ch].lastNote = effectiveNote;
    this.active[ch] = act;
  }

  // ── Hybrid (#38): PCM sample + synth envelope/pitch-program ───────────────

  private playHybrid(
    inst: HybridInstrument,
    cell: PatternCell,
    ch: number,
    deltaMs: number,
    msPerRow: number,
    msPerTick: number
  ) {
    const ctx = this.audioCtx;
    const buf = this.getSampleBuffer(inst as unknown as import('../state/types').SampleInstrument);
    if (!ctx || !buf) return;

    const lastNote = this.channelFxState[ch].lastNote;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    if (inst.loopEnabled && buf.length > 0) {
      src.loop = true;
      src.loopStart = inst.loopStart / inst.sampleRate;
      src.loopEnd   = inst.loopEnd > 0
        ? Math.min(inst.loopEnd, buf.length) / inst.sampleRate
        : buf.duration;
    }

    let effectiveNote = cell.note + inst.transpose;
    effectiveNote = Math.max(1, Math.min(127, effectiveNote));
    const baseFreq = 440 * Math.pow(2, (inst.baseNote - 69) / 12);
    const noteFreq = 440 * Math.pow(2, (effectiveNote + inst.finetune / 8 - 69) / 12);
    const baseRate = noteFreq / baseFreq;

    const tStart = ctx.currentTime + deltaMs / 1000;

    // Portamento (03/05)
    const portaActive = (cell.cmd === 0x03 || cell.cmd === 0x05) && lastNote > 0;
    if (portaActive) {
      const speed = cell.cmd === 0x03
        ? (cell.data > 0 ? cell.data : this.channelFxState[ch].portaSpeed)
        : this.channelFxState[ch].portaSpeed;
      if (speed > 0) this.channelFxState[ch].portaSpeed = speed;
      const fromRate = Math.pow(2, (lastNote - inst.baseNote) / 12);
      const semidist = Math.abs(effectiveNote - lastNote);
      const slideMs = Math.min((semidist * 16 / Math.max(1, speed)) * msPerTick, 16 * msPerRow);
      this.channelFxState[ch].portaTarget = effectiveNote;
      this.channelFxState[ch].portaDir    = effectiveNote >= lastNote ? 1 : -1;
      this.channelFxState[ch].portaActive = true;
      src.playbackRate.setValueAtTime(fromRate, tStart);
      src.playbackRate.exponentialRampToValueAtTime(baseRate, tStart + Math.max(0.001, slideMs / 1000));
    } else {
      src.playbackRate.value = baseRate;
      this.channelFxState[ch].portaActive = false;
    }

    // Volume (AHDSR or volProg, same as synth)
    let vMax = Math.min(1, inst.volume / 127);
    if (cell.cmd === 0x1a) vMax = Math.min(1, vMax + cell.data / 0x40);
    if (cell.cmd === 0x1b) vMax = Math.max(0, vMax - cell.data / 0x40);

    const gain = ctx.createGain();
    gain.gain.value = 0; // prevent 1.0-default race at note-on
    let stopAt: number;

    if (inst.volProg.length > 0) {
      const noteMs   = inst.lengthRows * msPerRow;
      const tickSec  = Math.max(0.001, msPerTick / 1000);
      const totalTks = Math.max(1, Math.ceil(noteMs / Math.max(1, msPerTick)));
      const curve    = simulateVolProg(inst.volProg, totalTks, vMax);
      gain.gain.setValueAtTime(0, tStart);
      for (let ti = 0; ti < totalTks; ti++) {
        gain.gain.setValueAtTime(Math.max(0, curve[ti] ?? 0), tStart + ti * tickSec);
      }
      gain.gain.setValueAtTime(0, tStart + noteMs / 1000);
      stopAt = tStart + noteMs / 1000 + 0.05;
    } else {
      const a = Math.max(0.001, inst.attackMs  / 1000);
      const d = Math.max(0.001, inst.decayMs   / 1000);
      const sus = Math.max(0, Math.min(1, inst.sustain));
      const r = Math.max(0.001, inst.releaseMs / 1000);
      const holdMs = Math.max(0, inst.lengthRows * msPerRow - inst.releaseMs);
      const tSusEnd = tStart + a + d + holdMs / 1000;
      gain.gain.setValueAtTime(0, tStart);
      gain.gain.linearRampToValueAtTime(vMax, tStart + a);
      gain.gain.linearRampToValueAtTime(sus * vMax, tStart + a + d);
      gain.gain.setValueAtTime(sus * vMax, tSusEnd);
      gain.gain.linearRampToValueAtTime(0, tSusEnd + r);
      stopAt = tSusEnd + r + 0.05;
    }

    const tremoTarget = ctx.createGain();
    tremoTarget.gain.value = 1.0;
    src.connect(gain);
    gain.connect(tremoTarget);
    const chGainHyb = this.channelGains[ch];
    const analyserHyb = this.analysers[ch];
    tremoTarget.connect(chGainHyb ?? analyserHyb ?? ctx.destination);

    src.start(tStart);
    if (inst.loopEnabled) { /* sustain until next note */ }
    else                  { src.stop(stopAt); }

    const act: ActiveNote = {
      offAt: performance.now() + deltaMs + msPerRow,
      midi: false,
      note: effectiveNote,
      instrumentIndex: cell.instrument,
      noteNumber: effectiveNote,
      source: src,
      gain,
      tremoTarget,
      releaseMs: inst.releaseMs ?? 110,
    };

    if (cell.cmd === 0x04 || cell.cmd === 0x06) {
      const spd = (cell.data >> 4) & 0xf;
      const dep = cell.data & 0xf;
      this.attachPitchLFO(act, ch, baseRate, tStart, msPerTick, spd, dep);
    }
    if (cell.cmd === 0x07) {
      const spd = (cell.data >> 4) & 0xf;
      const dep = cell.data & 0xf;
      this.attachVolumeLFO(act, ch, tStart, msPerTick, spd, dep);
    }

    // Pitch-program vibrato from pitchProg (VBD/VBS), same as playSynth.
    let ppVbdDepth = 0, ppVbsSpeed = 0;
    for (const line of inst.pitchProg) {
      if (line.op === 'vbd') ppVbdDepth = line.depth;
      if (line.op === 'vbs') ppVbsSpeed = line.speed;
    }
    if (ppVbdDepth > 0 && ppVbsSpeed > 0 && cell.cmd !== 0x04 && cell.cmd !== 0x06) {
      this.attachPitchLFO(act, ch, baseRate, tStart, msPerTick, ppVbsSpeed, ppVbdDepth);
    }

    this.channelFxState[ch].lastNote = effectiveNote;
    this.active[ch] = act;
  }
}
