/**
 * clock-processor.js — AudioWorklet metronome for the ModeCat sequencer.
 *
 * Fires a 'tick' message on the MessagePort every `samplesPerTick` audio
 * frames.  Running on the audio rendering thread means the interval is immune
 * to main-thread jank and browser background-tab throttling of setInterval.
 *
 * processorOptions (passed via AudioWorkletNode constructor):
 *   samplesPerTick {number}  Tick interval in sample frames.
 *                            Default: 1102  (≈ 25 ms @ 44 100 Hz)
 *
 * Inbound messages (port.postMessage):
 *   'stop'  — causes process() to return false, removing the node cleanly.
 */
class ClockProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    // Web Audio renders in 128-sample quanta; accumulate until we hit the interval.
    this._interval = Math.max(128, (options?.processorOptions?.samplesPerTick ?? 1102) | 0);
    this._count    = 0;
    this._running  = true;

    this.port.onmessage = (e) => {
      if (e.data === 'stop') this._running = false;
    };
  }

  process(_inputs, _outputs) {
    if (!this._running) return false; // returning false removes the processor

    this._count += 128;
    if (this._count >= this._interval) {
      this._count -= this._interval;
      this.port.postMessage('tick');
    }
    return true;
  }
}

registerProcessor('mc-clock', ClockProcessor);
