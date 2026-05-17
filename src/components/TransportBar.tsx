/**
 * TransportBar — ModeCat V5 upper-screen transport strip.
 *
 * Single row, no wrapping. Layout matches V5 manual:
 *
 *   [Play Song][Cont Song][Play Block][Cont Block]  [M I]
 *   [Inst Params…][Edit SynthS…][Edit Sample…]      [■ Stop]
 *
 * Edit / Chord / Spc toggles belong in the per-track On/Off row (#56),
 * not here — removed from this component.
 */

import { useStore } from '../state/store';
import type { Sequencer } from '../engine/sequencer';

interface Props {
  seq: Sequencer;
  onInstParams: () => void;    // open Instrument Parameters for selected slot
  onEditSynth: () => void;     // open Synthetic Sound editor MDI window
  onEditSample: () => void;    // open Sample editor MDI window
  onEditNotation: () => void;  // open Graphic Notation editor MDI window
}

export function TransportBar({ seq, onInstParams, onEditSynth, onEditSample, onEditNotation }: Props) {
  const playing      = useStore((s) => s.transport.playing);
  const transport    = useStore((s) => s.transport);
  const bridge       = useStore((s) => s.bridge);
  const cursor       = useStore((s) => s.cursor);

  const play         = useStore((s) => s.play);
  const setTransport = useStore((s) => s.setTransport);

  // ── Handlers ────────────────────────────────────────────────────────────────

  function playSong() {
    setTransport({ songPos: 0, row: 0, patternLoop: false });
    play();
  }

  function contSong() {
    setTransport({ patternLoop: false });
    play();
  }

  function playBlock() {
    // Loops the block; one-shot stop is a future TODO.
    setTransport({ row: 0, patternLoop: true });
    play();
  }

  function contBlock() {
    setTransport({ row: cursor.row, patternLoop: true });
    play();
  }

  return (
    <div className="transport-bar">

      {/* Play controls */}
      <button
        className="btn transport-btn"
        type="button" tabIndex={-1}
        data-pressed={playing && !transport.patternLoop}
        onClick={playSong}
        title="Play Song — start from beginning of sequence (Shift+Ctrl+P)"
      >
        Play Song
      </button>
      <button
        className="btn transport-btn"
        type="button" tabIndex={-1}
        onClick={contSong}
        title="Cont Song — resume from current position"
      >
        Cont Song
      </button>
      <button
        className="btn transport-btn"
        type="button" tabIndex={-1}
        data-pressed={playing && transport.patternLoop}
        onClick={playBlock}
        title="Play Block — play current block from row 0"
      >
        Play Block
      </button>
      <button
        className="btn transport-btn"
        type="button" tabIndex={-1}
        onClick={contBlock}
        title="Cont Block — resume from current row, block loop on"
      >
        Cont Block
      </button>

      {/* MIDI status indicator box — M = bridge connected, I = input active */}
      <div
        className="transport-midi-box"
        title={bridge.connected ? 'MIDI bridge connected' : 'MIDI offline (no bridge)'}
      >
        <span className={`transport-midi-flag${bridge.connected ? ' is-active' : ''}`}>M</span>
        <span className="transport-midi-flag">I</span>
      </div>

      {/* Editor launchers */}
      <button
        className="btn transport-btn transport-btn--editor"
        type="button" tabIndex={-1}
        onClick={onInstParams}
        title="Instrument Parameters… (Alt+I)"
      >
        Inst Params…
      </button>
      <button
        className="btn transport-btn transport-btn--editor"
        type="button" tabIndex={-1}
        onClick={onEditSynth}
        title="Edit Synthetic Sound… (Alt+Y)"
      >
        Edit SynthS…
      </button>
      <button
        className="btn transport-btn transport-btn--editor"
        type="button" tabIndex={-1}
        onClick={onEditSample}
        title="Edit Sample… (Alt+E)"
      >
        Edit Sample…
      </button>
      <button
        className="btn transport-btn transport-btn--editor"
        type="button" tabIndex={-1}
        onClick={onEditNotation}
        title="Graphic Notation Editor… — view active block as western staff notation"
      >
        Notation…
      </button>

      {/* Stop + Panic pushed to the right */}
      <div className="transport-bar__spacer" />

      <button
        className="btn transport-btn"
        type="button" tabIndex={-1}
        data-pressed={!playing}
        onClick={() => seq.stop()}
        title="Stop playback"
      >
        ■ Stop
      </button>
      <button
        className="btn transport-btn transport-btn--danger"
        type="button" tabIndex={-1}
        onClick={() => seq.panic()}
        title="MIDI Panic — all notes off"
      >
        ⚠ Panic
      </button>
    </div>
  );
}
