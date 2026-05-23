// SongEditor: vertical list of song positions with named section dividers,
// plus a small pattern bank management area at the bottom.
//
// Section markers (ModeCat §"New Sec" / "New Sec Here" / "Delete Sec") appear
// as labelled bars interleaved into the position list. They are purely cosmetic
// — they don't affect playback — but help organise large songs into verse /
// chorus / bridge sections.

import { useMemo, useState, useEffect, useCallback } from 'react';
import { useStore, useActivePattern } from '../state/store';
import { BlockPropsDialog } from './BlockPropsDialog';
import { useWbDialog } from './WbDialog';

interface CtxMenu { posIdx: number; pid: number; x: number; y: number; }

/** An item in the merged render list (either a song position or a section bar). */
type ListItem =
  | { kind: 'pos'; posIdx: number; pid: number }
  | { kind: 'section'; markerIdx: number; name: string };

export function SongEditor() {
  const [blockPropsOpen, setBlockPropsOpen] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const { wbConfirm, dialogEl } = useWbDialog();

  // Close context menu on any outside click
  const closeCtx = useCallback(() => setCtxMenu(null), []);
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = () => setCtxMenu(null);
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ctxMenu]);
  const positions = useStore((s) => s.song.positions);
  const sectionMarkers = useStore((s) => s.song.sectionMarkers);
  const patterns = useStore((s) => s.patterns);
  const songPos = useStore((s) => s.transport.songPos);
  const playing = useStore((s) => s.transport.playing);
  const loopSong = useStore((s) => s.transport.loopSong);
  const patternLoop = useStore((s) => s.transport.patternLoop);

  const setSongPos = useStore((s) => s.setSongPos);
  const setLoopSong = useStore((s) => s.setLoopSong);
  const setPatternLoop = useStore((s) => s.setPatternLoop);
  const insertSongPosition = useStore((s) => s.insertSongPosition);
  const removeSongPosition = useStore((s) => s.removeSongPosition);
  const setSongPositionPattern = useStore((s) => s.setSongPositionPattern);
  const addPattern = useStore((s) => s.addPattern);
  const deletePattern = useStore((s) => s.deletePattern);
  const renamePattern = useStore((s) => s.renamePattern);
  const copyBlock = useStore((s) => s.copyBlock);
  const pasteBlock = useStore((s) => s.pasteBlock);
  const blockClipboard = useStore((s) => s.blockClipboard);
  const setPatternLength = useStore((s) => s.setPatternLength);
  const replacePatternRows = useStore((s) => s.replacePatternRows);
  const activePattern = useActivePattern();

  const insertSection = useStore((s) => s.insertSection);
  const deleteSection = useStore((s) => s.deleteSection);
  const renameSection = useStore((s) => s.renameSection);

  // Build a merged list of positions and section markers, ordered by position index.
  // Multiple markers at the same beforePos are ordered by their markerIdx.
  const items = useMemo<ListItem[]>(() => {
    const out: ListItem[] = [];
    for (let i = 0; i <= positions.length; i++) {
      // Inject any section markers that appear before position i.
      sectionMarkers.forEach((m, mi) => {
        if (m.beforePos === i) {
          out.push({ kind: 'section', markerIdx: mi, name: m.name });
        }
      });
      if (i < positions.length) {
        out.push({ kind: 'pos', posIdx: i, pid: positions[i]! });
      }
    }
    return out;
  }, [positions, sectionMarkers]);

  // Which block IDs appear at more than one position (used for the ↩ reuse indicator).
  const reusedPids = useMemo(() => {
    const counts = new Map<number, number>();
    for (const pid of positions) counts.set(pid, (counts.get(pid) ?? 0) + 1);
    return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([pid]) => pid));
  }, [positions]);

  // How many times each block is referenced in the current song sequence.
  const pidUseCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const pid of positions) counts.set(pid, (counts.get(pid) ?? 0) + 1);
    return counts;
  }, [positions]);

  // Find the section marker immediately preceding the current song position (if any).
  const sectionAboveCurrent = useMemo(() => {
    let lastMarkerIdx = -1;
    for (const m of sectionMarkers) {
      if (m.beforePos <= songPos) lastMarkerIdx = sectionMarkers.indexOf(m);
    }
    return lastMarkerIdx;
  }, [sectionMarkers, songPos]);

  async function fillSequenceWith(pid: number) {
    const patName = patterns.find((p) => p.id === pid)?.name ?? String(pid);
    const ok = await wbConfirm(`Set ALL song positions to block "${patName}"?`);
    if (!ok) return;
    const filled = useStore.getState().song.positions.map(() => pid);
    useStore.setState((st) => ({ song: { ...st.song, positions: filled } }));
    setCtxMenu(null);
  }

  return (
    <div className="song">
      {dialogEl}
      {blockPropsOpen && <BlockPropsDialog onClose={() => setBlockPropsOpen(false)} />}

      {/* Context menu */}
      {ctxMenu && (
        <div
          className="song-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div
            className="song-ctx-menu__item"
            onClick={() => { setSongPos(ctxMenu.posIdx); setCtxMenu(null); }}
          >
            GO TO POSITION {String(ctxMenu.posIdx).padStart(2, '0')}
          </div>
          <div className="song-ctx-menu__sep" />
          <div
            className="song-ctx-menu__item"
            onClick={() => fillSequenceWith(ctxMenu.pid)}
          >
            FILL SEQUENCE WITH THIS BLOCK
          </div>
          <div className="song-ctx-menu__sep" />
          <div
            className="song-ctx-menu__item"
            onClick={() => { removeSongPosition(ctxMenu.posIdx); setCtxMenu(null); }}
          >
            REMOVE POSITION
          </div>
        </div>
      )}
      <div className="panel" style={{ flex: '0 0 auto', borderBottom: '0' }}>
        <div className="panel__title">Song</div>
        <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
          <label className="upper" style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={loopSong}
              onChange={(e) => setLoopSong(e.target.checked)}
            />
            Loop
          </label>
          <label className="upper" style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={patternLoop}
              onChange={(e) => setPatternLoop(e.target.checked)}
            />
            Blk Loop
          </label>
        </div>
      </div>

      <div className="song__list">
        {items.map((item, listIdx) => {
          if (item.kind === 'section') {
            return (
              <div key={`sec-${item.markerIdx}`} className="song__section">
                <span className="song__section-icon">§</span>
                <input
                  className="song__section-name"
                  value={item.name}
                  onChange={(e) => renameSection(item.markerIdx, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  maxLength={24}
                  title="Section name (click to rename)"
                />
                <button
                  className="x"
                  style={{ color: 'var(--wb-white)', opacity: 0.7 }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    deleteSection(item.markerIdx);
                  }}
                  title="Delete section marker"
                >
                  ×
                </button>
              </div>
            );
          }

          // Position row
          const { posIdx, pid } = item;
          const isCurrent = posIdx === songPos;
          const isReused = reusedPids.has(pid);
          const cls = `song-row ${isCurrent ? 'is-current' : ''} ${isCurrent && playing ? 'is-playing' : ''}`;
          return (
            <div
              key={`pos-${listIdx}`}
              className={cls}
              style={{ gridTemplateColumns: '3ch 3.5ch 1fr 2ch 2ch' }}
              onClick={() => setSongPos(posIdx)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxMenu({ posIdx, pid, x: e.clientX, y: e.clientY });
              }}
            >
              <span className="pos" title="Position index">{String(posIdx).padStart(2, '0')}</span>
              <span
                className="song-row__blk"
                title={`Block ${String(pid).padStart(2, '0')}`}
              >
                {String(pid).padStart(2, '0')}
              </span>
              <select
                className="pat"
                value={pid}
                onChange={(e) => setSongPositionPattern(posIdx, Number(e.target.value))}
                onClick={(e) => e.stopPropagation()}
              >
                {patterns.map((pp) => (
                  <option key={pp.id} value={pp.id}>
                    {String(pp.id).padStart(2, '0')} · {pp.name}
                  </option>
                ))}
              </select>
              <span
                className="song-row__reuse"
                style={{ visibility: isReused ? 'visible' : 'hidden' }}
                title={`Block ${String(pid).padStart(2,'0')} referenced at ${pidUseCounts.get(pid) ?? 1} positions`}
              >
                ↩
              </span>
              <button
                className="x"
                onClick={(e) => {
                  e.stopPropagation();
                  removeSongPosition(posIdx);
                }}
                title="Remove this position"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className="row" style={{ padding: '0.4rem', gap: '0.4rem', flexWrap: 'wrap' }}>
        <button
          className="btn"
          onClick={() => {
            const activePid = positions[songPos] ?? patterns[0]?.id ?? 1;
            insertSongPosition(songPos + 1, activePid);
          }}
          type="button"
          title="Insert another reference to the same block after this position (no new block is created)"
        >
          + Ref
        </button>
        <button
          className="btn"
          onClick={() => {
            const src = patterns.find((p) => p.id === positions[songPos]);
            const newId = addPattern(songPos);
            if (src) {
              const copiedRows = src.rows.map((row) => row.map((c) => ({ ...c })));
              replacePatternRows(newId, copiedRows);
              const baseName = src.name.replace(/-copy(\d*)$/, '');
              renamePattern(newId, `${baseName}-copy`);
            }
          }}
          type="button"
          title="Create a new block (copy of this one) and insert it after this position"
        >
          + Block
        </button>
        <button
          className="btn"
          onClick={() => {
            const cursorRow = useStore.getState().cursor.row;
            useStore.getState().splitBlockAt(cursorRow);
          }}
          type="button"
          title="Split current block at cursor row"
        >
          Split
        </button>
        <button
          className="btn"
          onClick={() => setBlockPropsOpen(true)}
          type="button"
          title="Block Properties — rename or resize the active block (Ctrl+B)"
        >
          Props…
        </button>
        <label
          className="upper"
          style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}
          title="Number of rows in the active block (1–3200)"
        >
          Len
          <input
            type="number"
            min={1}
            max={3200}
            value={activePattern?.rows.length ?? 64}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!isNaN(v)) setPatternLength(v);
            }}
            style={{ width: '4.5ch', textAlign: 'right' }}
          />
        </label>
        <button
          className="btn"
          onClick={copyBlock}
          type="button"
          title="Copy current block (all rows & channels) to the block clipboard"
        >
          Copy Blk
        </button>
        <button
          className="btn"
          onClick={pasteBlock}
          disabled={!blockClipboard}
          type="button"
          title="Paste block clipboard into the current block"
        >
          Paste Blk
        </button>
      </div>

      {/* Section marker controls */}
      <div className="row" style={{ padding: '0 0.4rem 0.4rem', gap: '0.4rem', flexWrap: 'wrap' }}>
        <button
          className="btn"
          onClick={() => insertSection(songPos)}
          type="button"
          title="Insert a section marker before the current position"
        >
          New Sec
        </button>
        <button
          className="btn"
          onClick={() => insertSection(positions.length)}
          type="button"
          title="Append a section marker after all positions"
        >
          New Sec End
        </button>
        <button
          className="btn"
          disabled={sectionAboveCurrent < 0}
          onClick={() => {
            if (sectionAboveCurrent >= 0) deleteSection(sectionAboveCurrent);
          }}
          type="button"
          title="Delete the section marker just above the current position"
        >
          Del Sec
        </button>
      </div>

      <div className="panel" style={{ flex: '0 0 auto', borderTop: '2px solid var(--wb-black)' }}>
        <div className="panel__title">Block Library</div>
        <div className="song__patterns">
          {patterns.map((p) => {
            const useCount = pidUseCounts.get(p.id) ?? 0;
            return (
              <div key={p.id} className="song-row" style={{ gridTemplateColumns: '3ch 1fr 3ch 3ch 2ch' }}>
                <span className="pos">{String(p.id).padStart(2, '0')}</span>
                <input
                  type="text"
                  value={p.name}
                  onChange={(e) => renamePattern(p.id, e.target.value.slice(0, 16))}
                  style={{ minWidth: 0 }}
                />
                <span
                  className="upper"
                  style={{ textAlign: 'right', opacity: 0.6, fontSize: '0.8em', lineHeight: '1' }}
                  title="Row count"
                >
                  {p.rows.length}
                </span>
                <span
                  className="song-row__use-count"
                  title={useCount === 0 ? 'Not used in song' : `Used at ${useCount} position${useCount !== 1 ? 's' : ''}`}
                  style={{ opacity: useCount === 0 ? 0.35 : 0.85 }}
                >
                  {useCount === 0 ? '–' : `×${useCount}`}
                </span>
                <button
                  className="x"
                  onClick={() => deletePattern(p.id)}
                  disabled={patterns.length <= 1}
                  title="Delete block"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
