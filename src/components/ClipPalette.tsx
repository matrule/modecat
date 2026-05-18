/**
 * ClipPalette — Clip library panel.
 *
 * Lists all clips with colour swatch and name. Per-clip actions:
 *   Place  — place at cursor position in active pattern
 *   Copy   — duplicate the clip in the library
 *   Rename — inline name edit
 *   Delete — remove clip and all its placements
 *   Info   — show which patterns reference this clip
 */

import { useState } from 'react';
import { useStore } from '../state/store';
import type { Clip } from '../state/types';
import { CLIP_COLORS } from '../state/types';
import { WbPrompt, WbConfirm, WbAlert } from './WbDialog';

interface ClipPaletteProps {
  onEdit?: (clip: Clip) => void;
}

// Internal dialog state discriminated union
type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'delete'; clipId: string; clipName: string; usageCount: number }
  | { kind: 'no-range' };

export function ClipPalette({ onEdit }: ClipPaletteProps = {}) {
  const clips    = useStore((s) => s.clips);
  const patterns = useStore((s) => s.patterns);
  const cursor   = useStore((s) => s.cursor);
  const song     = useStore((s) => s.song);
  const transport = useStore((s) => s.transport);

  const createClipFromRange = useStore((s) => s.createClipFromRange);
  const copyClip            = useStore((s) => s.copyClip);
  const deleteClip          = useStore((s) => s.deleteClip);
  const renameClip          = useStore((s) => s.renameClip);
  const addClipPlacement    = useStore((s) => s.addClipPlacement);

  const [renamingId,  setRenamingId]  = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [infoClipId,  setInfoClipId]  = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });

  // Which patterns reference a given clip?
  function usageFor(clipId: string): string[] {
    return patterns
      .filter((p) => p.clipPlacements.some((pl) => pl.clipId === clipId))
      .map((p) => p.name);
  }

  function placeAtCursor(clip: Clip) {
    const patId = song.positions[transport.songPos];
    if (patId == null) return;
    const chanCount = clip.rows[0]?.length ?? 1;
    const channelMask = Array.from({ length: chanCount }, () => true);
    addClipPlacement(patId, {
      clipId: clip.id,
      startCh: cursor.channel,
      startRow: cursor.row,
      channelMask,
      tileRows: clip.rows.length,
    });
  }

  function handleCreateClip(name: string) {
    setDialog({ kind: 'none' });
    const id = createClipFromRange(name);
    if (!id) setDialog({ kind: 'no-range' });
  }

  function handleDeleteConfirmed(clipId: string) {
    deleteClip(clipId);
    if (infoClipId === clipId) setInfoClipId(null);
    setDialog({ kind: 'none' });
  }

  return (
    <div className="clip-palette">

      {/* ── Workbench dialogs ─────────────────────────────────────────────── */}
      {dialog.kind === 'create' && (
        <WbPrompt
          title="Save Range as Clip"
          label="Clip name"
          defaultValue={`Clip ${clips.length + 1}`}
          okLabel="Save"
          onConfirm={handleCreateClip}
          onCancel={() => setDialog({ kind: 'none' })}
        />
      )}
      {dialog.kind === 'delete' && (
        <WbConfirm
          title="Delete Clip"
          message={
            dialog.usageCount > 0
              ? `Delete "${dialog.clipName}"?\n\nIt is placed in ${dialog.usageCount} pattern${dialog.usageCount > 1 ? 's' : ''}. All placements will be removed.`
              : `Delete "${dialog.clipName}"?`
          }
          okLabel="Delete"
          danger
          onConfirm={() => handleDeleteConfirmed(dialog.clipId)}
          onCancel={() => setDialog({ kind: 'none' })}
        />
      )}
      {dialog.kind === 'no-range' && (
        <WbAlert
          title="No Range Selected"
          message="Shift-click cells in the pattern editor to select a region first, then save as a clip."
          onClose={() => setDialog({ kind: 'none' })}
        />
      )}

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="clip-palette__header">
        <span className="upper">CLIP LIBRARY</span>
        <span className="muted" style={{ fontSize: '0.75em', marginLeft: '0.5rem' }}>
          {clips.length} clip{clips.length !== 1 ? 's' : ''}
        </span>
      </div>

      {clips.length === 0 && (
        <div className="clip-palette__empty muted">
          No clips yet — select a range and use <strong>Save as Clip</strong> below.
        </div>
      )}

      {/* ── Clip list ─────────────────────────────────────────────────────── */}
      <div className="clip-palette__list">
        {clips.map((clip) => {
          const usage = usageFor(clip.id);
          const isRenaming = renamingId === clip.id;
          const isInfoOpen = infoClipId === clip.id;

          return (
            <div
              key={clip.id}
              className={`clip-palette__item${isInfoOpen ? ' is-info-open' : ''}`}
            >
              {/* Colour swatch — click cycles through available colours */}
              <div
                className="clip-palette__swatch"
                style={{ background: clip.color }}
                title="Click to cycle colour"
                onClick={() => {
                  const idx = CLIP_COLORS.indexOf(clip.color);
                  const next = CLIP_COLORS[(idx + 1) % CLIP_COLORS.length]!;
                  useStore.getState().setClipColor(clip.id, next);
                }}
              />

              {/* Name / rename field */}
              {isRenaming ? (
                <input
                  className="clip-palette__rename-input"
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (renameValue.trim()) renameClip(clip.id, renameValue.trim());
                      setRenamingId(null);
                    }
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  onBlur={() => {
                    if (renameValue.trim()) renameClip(clip.id, renameValue.trim());
                    setRenamingId(null);
                  }}
                />
              ) : (
                <span
                  className="clip-palette__name"
                  title="Double-click to rename"
                  onDoubleClick={() => {
                    setRenamingId(clip.id);
                    setRenameValue(clip.name);
                  }}
                >
                  {clip.name}
                </span>
              )}

              {/* Size label */}
              <span className="clip-palette__size muted">
                {clip.rows.length}r×{clip.rows[0]?.length ?? 0}c
              </span>

              {/* Usage badge */}
              <span
                className={`clip-palette__usage-badge ${usage.length === 0 ? 'is-unused' : ''}`}
                title={usage.length > 0 ? `Used in: ${usage.join(', ')}` : 'Unused'}
              >
                {usage.length === 0 ? '⚠ unused' : `×${usage.length}`}
              </span>

              {/* Action buttons */}
              <div className="clip-palette__actions">
                <button
                  className="btn btn--xs"
                  type="button"
                  title="Place at cursor position"
                  onClick={() => placeAtCursor(clip)}
                >
                  Place
                </button>
                <button
                  className="btn btn--xs btn--edit"
                  type="button"
                  title="Edit clip cells"
                  onClick={() => onEdit?.(clip)}
                  disabled={!onEdit}
                >
                  Edit
                </button>
                <button
                  className="btn btn--xs"
                  type="button"
                  title="Duplicate this clip"
                  onClick={() => copyClip(clip.id)}
                >
                  Copy
                </button>
                <button
                  className="btn btn--xs"
                  type="button"
                  title="Rename"
                  onClick={() => {
                    setRenamingId(clip.id);
                    setRenameValue(clip.name);
                  }}
                >
                  Ren
                </button>
                <button
                  className="btn btn--xs"
                  type="button"
                  title="Show usage info"
                  onClick={() => setInfoClipId(isInfoOpen ? null : clip.id)}
                >
                  Info
                </button>
                <button
                  className="btn btn--xs btn--danger"
                  type="button"
                  title="Delete clip and all its placements"
                  onClick={() =>
                    setDialog({
                      kind: 'delete',
                      clipId: clip.id,
                      clipName: clip.name,
                      usageCount: usage.length,
                    })
                  }
                >
                  Del
                </button>
              </div>

              {/* Info panel (collapsible) */}
              {isInfoOpen && (
                <div className="clip-palette__info">
                  {usage.length === 0 ? (
                    <span className="muted">Not used in any pattern. Safe to delete.</span>
                  ) : (
                    <>
                      <span className="upper" style={{ fontSize: '0.75em' }}>Used in:</span>
                      {usage.map((name) => (
                        <span key={name} className="clip-palette__info-pat">{name}</span>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Footer — Save Range as Clip ───────────────────────────────────── */}
      <div className="clip-palette__footer">
        <button
          className="btn"
          type="button"
          title="Create a new clip from the current range selection"
          onClick={() => setDialog({ kind: 'create' })}
        >
          + Save Range as Clip
        </button>
      </div>
    </div>
  );
}
