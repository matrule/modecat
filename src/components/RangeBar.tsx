// RangeBar — surfaces the manual's RANGE PANEL (p.61) and the slice of the
// TRANSPOSE PANEL (p.58-59) that works on a defined range:
//
//   * CUT / COPY / PASTE / CLEAR        (manual p.61-62)
//   * Transpose ±semitone / ±octave     (p.58-59)
//   * Volume Fade (linear 0C slide)     (p.64 — "CREATING VOLUME SLIDES")
//   * Echo (cmd 0C copies)              (p.65 — "ECHO EFFECTS")
//
// The bar appears only when there's an active range. The cursor position is
// the paste anchor.

import { useState, useCallback } from 'react';
import { useStore } from '../state/store';

const COMMANDS = [
  { cmd: 0x00, label: '00 — Arpeggio (xy = +x/+y semitones)' },
  { cmd: 0x01, label: '01 — Slide up (xx = speed)' },
  { cmd: 0x02, label: '02 — Slide down (xx = speed)' },
  { cmd: 0x03, label: '03 — Portamento (xx = speed)' },
  { cmd: 0x04, label: '04 — Vibrato (x=spd y=depth)' },
  { cmd: 0x05, label: '05 — Portamento + vol slide' },
  { cmd: 0x06, label: '06 — Tremolo (x=spd y=depth)' },
  { cmd: 0x07, label: '07 — Tremolo retrigger' },
  { cmd: 0x0a, label: '0A — Volume slide (x=up y=down)' },
  { cmd: 0x0b, label: '0B — Position jump (xx = song pos)' },
  { cmd: 0x0c, label: '0C — Set volume (00–64)' },
  { cmd: 0x0d, label: '0D — Volume slide (x=up y=down)' },
  { cmd: 0x0f, label: '0F — Misc (01–1F=speed 20–F0=BPM FE=stop FF=cut)' },
  { cmd: 0x10, label: '10 — MIDI send (xx = slot)' },
  { cmd: 0x11, label: '11 — Note up (xx semitones, one-shot)' },
  { cmd: 0x12, label: '12 — Note down (xx semitones, one-shot)' },
  { cmd: 0x16, label: '16 — Loop (00=set start, nn=repeat n times)' },
  { cmd: 0x18, label: '18 — Note cut after xx ticks' },
  { cmd: 0x19, label: '19 — Sample offset (xx×256 samples)' },
  { cmd: 0x1a, label: '1A — Volume slide up (fine)' },
  { cmd: 0x1b, label: '1B — Volume slide down (fine)' },
  { cmd: 0x1c, label: '1C — MIDI program change (xx = slot)' },
  { cmd: 0x1d, label: '1D — Block break to row xx' },
  { cmd: 0x1e, label: '1E — Line repeat xx times' },
];

export function RangeBar() {
  const range = useStore((s) => s.range);
  const copyBuffer = useStore((s) => s.copyBuffer);

  const rangeCut             = useStore((s) => s.rangeCut);
  const rangeCopy            = useStore((s) => s.rangeCopy);
  const rangePaste           = useStore((s) => s.rangePaste);
  const rangePasteChOffset   = useStore((s) => s.rangePasteChOffset);
  const rangeClear           = useStore((s) => s.rangeClear);
  const setRange             = useStore((s) => s.setRange);
  const rangeTransposeSemi   = useStore((s) => s.rangeTransposeSemi);
  const rangeTransposeOctave = useStore((s) => s.rangeTransposeOctave);
  const rangeVolFade         = useStore((s) => s.rangeVolFade);
  const rangeEcho            = useStore((s) => s.rangeEcho);
  const rangePitchSlide      = useStore((s) => s.rangePitchSlide);
  const rangeSpread          = useStore((s) => s.rangeSpread);
  const rangeNoteChange      = useStore((s) => s.rangeNoteChange);
  const rangeNoteExchange    = useStore((s) => s.rangeNoteExchange);
  const rangeSetCmd          = useStore((s) => s.rangeSetCmd);

  const [echoDist,   setEchoDist]   = useState(2);
  const [echoMin,    setEchoMin]    = useState(1);
  const [slideSpeed, setSlideSpeed] = useState(4);
  const [pasteChOfs, setPasteChOfs] = useState(0);
  const [noteFrom,   setNoteFrom]   = useState(60);
  const [noteTo,     setNoteTo]     = useState(60);
  const [cmdSel,     setCmdSel]     = useState(0x0c);
  const [cmdData,    setCmdData]    = useState('40');

  const parseCmdData = useCallback(() => {
    const v = parseInt(cmdData, 16);
    return isNaN(v) ? 0 : Math.max(0, Math.min(255, v));
  }, [cmdData]);

  const w = range ? range.endCh - range.startCh + 1 : 0;
  const h = range ? range.endRow - range.startRow + 1 : 0;

  return (
    <div className="range-bar">
      <span className="upper">Range</span>
      {range ? (
        <span className="orange">
          r{String(range.startRow).padStart(2, '0')}–{String(range.endRow).padStart(2, '0')}
          ·c{range.startCh + 1}–{range.endCh + 1}
          ·{h}×{w}
        </span>
      ) : (
        <span className="muted" style={{ fontSize: '0.75em' }}>Shift-click a cell to select</span>
      )}
      <button className="btn" onClick={rangeCut}   type="button" disabled={!range}>Cut</button>
      <button className="btn" onClick={rangeCopy}  type="button" disabled={!range}>Copy</button>
      <button className="btn" onClick={rangePaste} type="button" disabled={!copyBuffer}>Paste</button>
      <label className="upper" style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}
        title="Channel offset: paste shifted right by N channels (negative = left)">
        Ch±
        <input
          type="number" min={-15} max={15}
          value={pasteChOfs}
          onChange={(e) => setPasteChOfs(Math.max(-15, Math.min(15, Number(e.target.value))))}
          style={{ width: '4ch' }}
        />
      </label>
      <button className="btn" onClick={() => rangePasteChOffset(pasteChOfs)} type="button"
        disabled={!copyBuffer || pasteChOfs === 0}
        title="Paste with channel offset">Paste+Ch</button>
      <button className="btn" onClick={rangeClear} type="button" disabled={!range}>Clear</button>

      <span className="sep" />

      <span className="upper">Transpose</span>
      <button className="btn" onClick={() => rangeTransposeSemi(-1)} type="button" title="½-step down" disabled={!range}>½▼</button>
      <button className="btn" onClick={() => rangeTransposeSemi( 1)} type="button" title="½-step up" disabled={!range}>½▲</button>
      <button className="btn" onClick={() => rangeTransposeOctave(-1)} type="button" title="Octave down" disabled={!range}>Oct▼</button>
      <button className="btn" onClick={() => rangeTransposeOctave( 1)} type="button" title="Octave up" disabled={!range}>Oct▲</button>

      <span className="sep" />

      <button className="btn" onClick={rangeVolFade} type="button" title="Linear 0C volume fade between first/last 0C rows in range" disabled={!range}>Vol Fade</button>

      <span className="sep" />

      {/* Manual §"TRANSPOSE PANEL" — note CHANGE and EXCHANGE within range */}
      <span className="upper" title="Replace or swap note pitches within the range">Note</span>
      <label className="upper" style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}
        title="Source note (MIDI 1–127)">
        From
        <input
          type="number" min={1} max={127}
          value={noteFrom}
          onChange={(e) => setNoteFrom(Math.max(1, Math.min(127, Number(e.target.value))))}
          style={{ width: '4ch' }}
        />
      </label>
      <label className="upper" style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}
        title="Target note (MIDI 1–127)">
        To
        <input
          type="number" min={1} max={127}
          value={noteTo}
          onChange={(e) => setNoteTo(Math.max(1, Math.min(127, Number(e.target.value))))}
          style={{ width: '4ch' }}
        />
      </label>
      <button
        className="btn"
        onClick={() => rangeNoteChange(noteFrom, noteTo)}
        type="button"
        title="Replace every From note with To note in range/block"
        disabled={!range}
      >Change→</button>
      <button
        className="btn"
        onClick={() => rangeNoteExchange(noteFrom, noteTo)}
        type="button"
        title="Swap From ↔ To notes in range/block"
        disabled={!range}
      >Exchange↔</button>

      <span className="sep" />

      {/* Manual §"CREATING PITCH SLIDES" — fill between two notes with slide cmds */}
      <span className="upper">Slide</span>
      <label className="upper" style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}>
        Spd
        <input
          type="number" min={1} max={255}
          value={slideSpeed}
          onChange={(e) => setSlideSpeed(Math.max(1, Math.min(255, Number(e.target.value))))}
          style={{ width: '4ch' }}
          title="Slide speed in 1/16-semitone units per tick (1–255)"
        />
      </label>
      <button
        className="btn"
        onClick={() => rangePitchSlide('01', slideSpeed)}
        type="button"
        title="Fill range with 01xx (slide up) between first and last note"
        disabled={!range}
      >
        Slide▲
      </button>
      <button
        className="btn"
        onClick={() => rangePitchSlide('02', slideSpeed)}
        type="button"
        title="Fill range with 02xx (slide down) between first and last note"
        disabled={!range}
      >
        Slide▼
      </button>
      <button
        className="btn"
        onClick={() => rangePitchSlide('03', slideSpeed)}
        type="button"
        title="Fill range with 03xx (tone portamento toward target note)"
        disabled={!range}
      >
        Porta
      </button>

      <span className="sep" />

      <span className="upper">Echo</span>
      <label className="upper" style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}>
        Dist
        <input
          type="number" min={1} max={32}
          value={echoDist}
          onChange={(e) => setEchoDist(Math.max(1, Math.min(32, Number(e.target.value))))}
          style={{ width: '4ch' }}
        />
      </label>
      <label className="upper" style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}>
        Min
        <input
          type="number" min={0} max={64}
          value={echoMin}
          onChange={(e) => setEchoMin(Math.max(0, Math.min(64, Number(e.target.value))))}
          style={{ width: '4ch' }}
        />
      </label>
      <button className="btn" onClick={() => rangeEcho(echoDist, echoMin)} type="button" disabled={!range}>Apply</button>

      <span className="sep" />

      <span className="upper" title="Distribute notes across N adjacent channels cyclically">Spread</span>
      {([2, 3, 4] as const).map((n) => (
        <button
          key={n}
          className="btn"
          type="button"
          onClick={() => rangeSpread(n)}
          title={`Spread notes across ${n} channels starting from range start`}
          disabled={!range}
        >
          ×{n}
        </button>
      ))}

      <span className="sep" />

      {/* Command fill — write a cmd+data to every cell in the range */}
      <span className="upper" title="Write a command into every cell in the range">Cmd</span>
      <select
        className="range-bar__cmd-select"
        value={cmdSel}
        onChange={(e) => setCmdSel(Number(e.target.value))}
        disabled={!range}
        title="Effect command to write"
      >
        {COMMANDS.map((c) => (
          <option key={c.cmd} value={c.cmd}>{c.label}</option>
        ))}
      </select>
      <label className="upper" style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}
        title="Data value in hex (00–FF)">
        xx=
        <input
          type="text"
          className="range-bar__cmd-data"
          maxLength={2}
          value={cmdData}
          onChange={(e) => setCmdData(e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 2))}
          style={{ width: '3ch', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}
          placeholder="00"
          disabled={!range}
        />
      </label>
      <button
        className="btn"
        type="button"
        disabled={!range}
        title="Write selected command into all cells in the range"
        onClick={() => rangeSetCmd(cmdSel, parseCmdData())}
      >
        Fill Cmd
      </button>

      <span style={{ flex: 1 }} />
    </div>
  );
}
