/**
 * Oscilloscope — real-time per-channel audio visualiser.
 *
 * Sits between the ModeBar and the PatternEditor, 16 columns wide to match
 * the pattern grid.  Two display modes, toggled via a small button:
 *
 *   SCOPE  — time-domain waveform trace (green on black, CRT aesthetic)
 *   BAR    — peak VU-meter bars (green fill, amber clip indicator)
 *
 * Animation runs only during playback (transport.playing).  When stopped the
 * display holds its last frame, giving a visual "decay" effect.
 *
 * Audio data comes from the Sequencer's per-channel AnalyserNodes.
 */

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { Sequencer } from '../engine/sequencer';
import { CHANNELS } from '../state/types';

// ── Layout constants (must match ModeBar / PatternEditor) ─────────────────────
const GUTTER_PX_RATIO = 3.5;  // 3.5ch — measured in ch units, rendered via flex
const CANVAS_H        = 40;    // px height of the entire strip
const SCOPE_COLOR     = '#00dd44';  // phosphor green
const BAR_COLOR       = '#00cc44';
const BAR_CLIP_COLOR  = '#ff8800';  // amber — clip indicator at top
const BG_COLOR        = '#000408';  // near-black with a hint of navy

type DisplayMode = 'scope' | 'bar';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Draw a waveform trace from time-domain data into a canvas region. */
function drawScope(
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  x: number,
  w: number,
  h: number,
) {
  const mid = h / 2;
  const step = Math.max(1, Math.floor(data.length / w));

  ctx.beginPath();
  for (let px = 0; px < w; px++) {
    const idx = Math.min(px * step, data.length - 1);
    const v = (data[idx]! - 128) / 128; // -1..+1
    const y = mid - v * mid * 0.9;
    if (px === 0) ctx.moveTo(x + px, y);
    else          ctx.lineTo(x + px, y);
  }
  ctx.strokeStyle = SCOPE_COLOR;
  ctx.lineWidth   = 1;
  ctx.stroke();
}

/** Draw a VU bar from time-domain data into a canvas region. */
function drawBar(
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  x: number,
  w: number,
  h: number,
) {
  // Peak level = max |v| across all samples
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i]! - 128) / 128;
    if (v > peak) peak = v;
  }
  const fillH = Math.round(peak * h);
  const clipping = peak > 0.92;

  // Bar fills from bottom
  const barY = h - fillH;
  ctx.fillStyle = clipping ? BAR_CLIP_COLOR : BAR_COLOR;
  ctx.fillRect(x + 1, barY, w - 2, fillH);

  // Clip indicator — 2px orange line at very top when clipping
  if (clipping) {
    ctx.fillStyle = BAR_CLIP_COLOR;
    ctx.fillRect(x + 1, 0, w - 2, 2);
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  seq: Sequencer;
}

export function Oscilloscope({ seq }: Props) {
  const playing    = useStore((s) => s.transport.playing);
  const trackFlags = useStore((s) => s.trackFlags);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number | null>(null);
  const [mode, setMode] = useState<DisplayMode>('scope');
  const modeRef = useRef<DisplayMode>(mode);
  modeRef.current = mode;

  // Keep the canvas pixel width in sync with its CSS layout width so drawing
  // is always 1:1 — without this a CSS flex stretch would produce blurry output.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        canvas.width = Math.round(entry.contentRect.width);
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;

    // dataBuffers are sized to the first analyser's fftSize.  We lazily resize
    // them if the analysers array is initially empty (AudioContext not yet
    // created) and later gets populated after seq.start() is called.
    let dataBuffers: Uint8Array<ArrayBuffer>[] = [];

    /** Draw one frame — called both during animation and for the static stopped state. */
    function drawFrame() {
      if (!canvas || !ctx2d) return;

      const W = canvas.width;
      const H = canvas.height;
      if (W === 0 || H === 0) return;

      // Fetch analysers fresh each frame so we never stale on an empty snapshot
      // captured before seq.start() had a chance to create the AudioContext.
      const analysers = seq.getAnalysers();

      // Lazily (re)size the data buffers to match the current analyser fftSize.
      const bufLen = analysers[0]?.frequencyBinCount ?? 256;
      if (dataBuffers.length !== analysers.length || (dataBuffers[0]?.length ?? 0) !== bufLen) {
        dataBuffers = analysers.map(() => new Uint8Array(new ArrayBuffer(bufLen)));
      }

      // Background
      ctx2d.fillStyle = BG_COLOR;
      ctx2d.fillRect(0, 0, W, H);

      // Subtle horizontal centre line (scope mode)
      if (modeRef.current === 'scope') {
        ctx2d.strokeStyle = 'rgba(0,180,60,0.15)';
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        ctx2d.moveTo(0, H / 2);
        ctx2d.lineTo(W, H / 2);
        ctx2d.stroke();
      }

      // Per-channel rendering
      const chW = W / CHANNELS;

      for (let ch = 0; ch < CHANNELS; ch++) {
        const analyser = analysers[ch];
        if (!analyser) continue;

        analyser.getByteTimeDomainData(dataBuffers[ch]!);

        const xOff = ch * chW;

        // Dim the channel if it's muted
        ctx2d.globalAlpha = trackFlags[ch]?.mute ? 0.2 : 1.0;

        if (modeRef.current === 'scope') {
          drawScope(ctx2d, dataBuffers[ch]!, xOff, chW, H);
        } else {
          drawBar(ctx2d, dataBuffers[ch]!, xOff, chW, H);
        }

        ctx2d.globalAlpha = 1.0;

        // Vertical channel separator
        ctx2d.strokeStyle = 'rgba(0,80,40,0.5)';
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        ctx2d.moveTo(xOff, 0);
        ctx2d.lineTo(xOff, H);
        ctx2d.stroke();
      }
    }

    // Always draw at least one frame so the stopped state shows a fresh snapshot.
    drawFrame();

    // Only animate while playing — when stopped we hold the last frame.
    if (!playing) return;

    function loop() {
      drawFrame();
      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // playing in deps: effect re-runs on play/stop, correctly starting/stopping the loop.
    // trackFlags in deps: mute-dim updates trigger a fresh static frame when stopped,
    //   or seamlessly continue when playing (loop restarts with updated closure).
  }, [seq, trackFlags, playing]);

  return (
    <div className="oscilloscope">
      {/* Label gutter — matches the 3.5ch row-number gutter in the pattern grid */}
      <div className="oscilloscope__gutter">
        <button
          className={`oscilloscope__mode-btn ${mode === 'scope' ? 'is-active' : ''}`}
          type="button"
          title="Toggle oscilloscope / VU bar display"
          onClick={() => setMode((m) => m === 'scope' ? 'bar' : 'scope')}
        >
          {mode === 'scope' ? '~' : '▌'}
        </button>
      </div>

      {/* Canvas fills the remaining width, 16 columns */}
      <canvas
        ref={canvasRef}
        className="oscilloscope__canvas"
        height={CANVAS_H}
      />
    </div>
  );
}
