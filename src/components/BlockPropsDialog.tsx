// Block Properties dialog — name and row length for the active pattern.
// Opened from Block → Set Properties… or a Props button in SongEditor.

import { useEffect, useRef, useState } from 'react';
import { useActivePattern, useStore } from '../state/store';

interface Props {
  onClose: () => void;
}

export function BlockPropsDialog({ onClose }: Props) {
  const pattern = useActivePattern();
  const renamePattern  = useStore((s) => s.renamePattern);
  const setPatternLength = useStore((s) => s.setPatternLength);

  const [name, setName]   = useState(pattern?.name ?? '');
  const [len, setLen]     = useState(String(pattern?.rows.length ?? 64));
  const nameRef = useRef<HTMLInputElement>(null);

  // Focus the name field on open.
  useEffect(() => { nameRef.current?.select(); }, []);

  // Escape closes without saving; Enter saves.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'Enter')  { e.preventDefault(); save(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, len]);

  function save() {
    if (!pattern) { onClose(); return; }
    const trimmed = name.trim();
    if (trimmed !== pattern.name) renamePattern(pattern.id, trimmed);
    const n = parseInt(len, 10);
    if (!isNaN(n) && n >= 1 && n <= 3200 && n !== pattern.rows.length) {
      setPatternLength(n);
    }
    onClose();
  }

  if (!pattern) return null;

  return (
    <div className="ip-backdrop" onMouseDown={onClose}>
      <div className="ip-dialog blockprops-dialog" onMouseDown={(e) => e.stopPropagation()}>
        {/* Title bar */}
        <div className="ip-titlebar">
          <span>Block Properties</span>
          <button className="ip-close" type="button" onClick={onClose} tabIndex={-1}>✕</button>
        </div>

        <div className="ip-body">
          <div className="ip-row">
            <label className="ip-label">Block ID</label>
            <span style={{ opacity: 0.65, fontVariantNumeric: 'tabular-nums' }}>
              {String(pattern.id).padStart(2, '0')}
            </span>
          </div>

          <div className="ip-row">
            <label className="ip-label" htmlFor="bp-name">Name</label>
            <input
              id="bp-name"
              ref={nameRef}
              className="ip-input"
              type="text"
              maxLength={16}
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: '14ch' }}
            />
          </div>

          <div className="ip-row">
            <label className="ip-label" htmlFor="bp-len">Rows</label>
            <input
              id="bp-len"
              className="ip-input"
              type="number"
              min={1}
              max={3200}
              value={len}
              onChange={(e) => setLen(e.target.value)}
              style={{ width: '7ch', textAlign: 'right' }}
            />
            <span className="ip-unit" style={{ opacity: 0.6, fontSize: '13px' }}>
              (1 – 3200)
            </span>
          </div>
        </div>

        {/* Footer buttons */}
        <div className="ip-footer">
          <button className="btn" type="button" onClick={save}>OK</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
