/**
 * ModeBar — sits between InfoBar and RangeBar.
 *
 * Left cluster  : EDIT toggle, CHORD toggle, Spc step input, Play Transpose.
 * Right cluster : One On/Off button per channel, aligned to the pattern grid
 *                 (3.5ch gutter + 16 × 12ch columns, matching COL_WIDTH_CH).
 *
 * Click  = toggle mute.
 * Shift+click = toggle solo.
 */

import { useStore } from '../state/store';
import { CHANNELS } from '../state/types';

export function ModeBar() {
  const editMode         = useStore((s) => s.cursor.editMode);
  const chordMode        = useStore((s) => s.cursor.chordMode);
  const spc              = useStore((s) => s.cursor.spc);
  const trackFlags       = useStore((s) => s.trackFlags);
  const playTranspose    = useStore((s) => s.playTranspose);
  const setEditMode      = useStore((s) => s.setEditMode);
  const setChordMode     = useStore((s) => s.setChordMode);
  const setCursor        = useStore((s) => s.setCursor);
  const setPlayTranspose = useStore((s) => s.setPlayTranspose);
  const toggleMute       = useStore((s) => s.toggleMute);
  const toggleSolo       = useStore((s) => s.toggleSolo);
  const visibleTracks    = useStore((s) => s.visibleTracks);

  const anySolo = trackFlags.some((f) => f.solo);

  return (
    <div className="mode-bar">
      {/* ── Left: mode toggles ─────────────────────────────────────────────── */}
      <button
        className="btn mode-bar__toggle"
        type="button"
        tabIndex={-1}
        data-pressed={editMode}
        onClick={() => setEditMode(!editMode)}
        title="Edit mode — enable cell editing (keys enter notes/commands)"
      >
        EDIT
      </button>

      <button
        className="btn mode-bar__toggle"
        type="button"
        tabIndex={-1}
        data-pressed={chordMode}
        onClick={() => setChordMode(!chordMode)}
        title="Chord mode — notes advance right across tracks instead of down"
      >
        CHORD
      </button>

      <label className="mode-bar__spc-label" title="Rows to advance after each note entry">
        Spc=
        <input
          type="number"
          min={0}
          max={16}
          value={spc}
          onChange={(e) => setCursor({ spc: Math.max(0, Math.min(16, Number(e.target.value))) })}
          className="mode-bar__spc-input"
        />
      </label>

      {/* ── Play Transpose ─────────────────────────────────────────────────── */}
      <span
        className="mode-bar__trnsp-label"
        title="Non-destructive play transpose: shifts all notes during playback without altering block data"
      >
        Trnsp=
      </span>
      <button
        className="btn mode-bar__trnsp-btn"
        type="button"
        tabIndex={-1}
        onClick={() => setPlayTranspose(playTranspose - 1)}
        title="Transpose down 1 semitone"
      >−</button>
      <span
        className={`mode-bar__trnsp-val${playTranspose !== 0 ? ' is-active' : ''}`}
        title="Click to reset to 0"
        onClick={() => setPlayTranspose(0)}
        style={{ cursor: 'pointer' }}
      >
        {playTranspose >= 0 ? `+${playTranspose}` : String(playTranspose)}
      </span>
      <button
        className="btn mode-bar__trnsp-btn"
        type="button"
        tabIndex={-1}
        onClick={() => setPlayTranspose(playTranspose + 1)}
        title="Transpose up 1 semitone"
      >+</button>

      {/* ── Spacer ─────────────────────────────────────────────────────────── */}
      <div className="mode-bar__spacer" />

      {/* ── Right: per-channel On/Off buttons ──────────────────────────────── */}
      <div className="mode-bar__onoff-row">
        {/* Gutter that aligns with the row-number column in the pattern grid */}
        <div className="mode-bar__gutter" />

        {Array.from({ length: visibleTracks }, (_, i) => {
          const muted = trackFlags[i]?.mute ?? false;
          const solo  = trackFlags[i]?.solo ?? false;
          const dimmed = anySolo && !solo;

          return (
            <button
              key={i}
              className={[
                'btn mode-bar__ch-btn',
                muted  ? 'is-muted'  : '',
                solo   ? 'is-solo'   : '',
                dimmed ? 'is-dimmed' : '',
              ].filter(Boolean).join(' ')}
              type="button"
              tabIndex={-1}
              title={`Ch ${i + 1}: click to mute/unmute, Shift+click to solo`}
              onClick={(e) => {
                if (e.shiftKey) toggleSolo(i);
                else            toggleMute(i);
              }}
            >
              {muted ? 'OFF' : 'ON'}
            </button>
          );
        })}
      </div>
    </div>
  );
}
