/**
 * InstrumentLoadDialog — lets the user pick which instruments from a
 * .modecat-inst.json file to load, and into which slots.
 *
 * Shows each entry as a row:  [checkbox]  slot [NN↕]  name  KIND
 *
 * Select All / None buttons + per-row slot override (0–31).
 * Confirmed entries are written straight into the store.
 */

import { useState } from 'react';
import type { InstrumentFileEntry } from '../state/persist';
import { deserializeInstrument } from '../state/persist';
import { useStore } from '../state/store';

interface Props {
  entries: InstrumentFileEntry[];
  onClose: () => void;
}

const KIND_COLOR: Record<string, string> = {
  sample: '#00CCFF',
  midi:   '#FF8800',
  synth:  '#00FF88',
  hybrid: '#FFD700',
  empty:  '#556688',
};

export function InstrumentLoadDialog({ entries, onClose }: Props) {
  // All entries selected by default
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(entries.map((_, i) => i))
  );
  // Target slot per entry — starts at the slot stored in the file
  const [targetSlots, setTargetSlots] = useState<number[]>(
    () => entries.map((e) => e.slot)
  );

  const setInstrument = useStore((s) => s.setInstrument);

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  function selectAll()  { setSelected(new Set(entries.map((_, i) => i))); }
  function selectNone() { setSelected(new Set()); }

  function setSlot(i: number, v: number) {
    setTargetSlots((prev) => {
      const a = [...prev];
      a[i] = Math.max(0, Math.min(31, v));
      return a;
    });
  }

  function doLoad() {
    for (let i = 0; i < entries.length; i++) {
      if (!selected.has(i)) continue;
      const slot = targetSlots[i] ?? entries[i]!.slot;
      setInstrument(slot, deserializeInstrument(entries[i]!.data));
    }
    onClose();
  }

  const numStyle: React.CSSProperties = {
    width: '3.2ch',
    background: '#000a1e',
    border: '1px inset #0055AA',
    color: '#00CCFF',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.72rem',
    padding: '0 0.1rem',
    textAlign: 'center',
    MozAppearance: 'textfield',
  } as React.CSSProperties;

  return (
    <div
      className="ip-backdrop"
      onMouseDown={onClose}
    >
      <div
        className="ip-dialog"
        style={{ minWidth: 400, maxWidth: 560 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="ip-titlebar">Load Instrument(s)</div>

        {/* Body */}
        <div className="ip-body" style={{ padding: '0.6rem 0.75rem' }}>
          {/* Select all / none */}
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginBottom: '0.5rem' }}>
            <button className="btn" type="button" onClick={selectAll}>All</button>
            <button className="btn" type="button" onClick={selectNone}>None</button>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: '#556688' }}>
              {selected.size} / {entries.length} selected
            </span>
          </div>

          {/* Instrument list */}
          <div style={{ border: '1px solid #003366', maxHeight: 300, overflowY: 'auto' }}>
            {entries.map((entry, i) => {
              const isSelected = selected.has(i);
              return (
                <label
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.28rem 0.5rem',
                    borderBottom: i < entries.length - 1 ? '1px solid #001133' : 'none',
                    cursor: 'pointer',
                    background: isSelected ? '#001122' : 'transparent',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(i)}
                    style={{ flexShrink: 0 }}
                  />

                  {/* Slot label + editable target slot */}
                  <span style={{ color: '#556688', fontFamily: 'var(--font-mono)', fontSize: '0.68rem', flexShrink: 0 }}>
                    slot
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={31}
                    value={targetSlots[i] ?? entry.slot}
                    style={numStyle}
                    onChange={(e) => setSlot(i, Number(e.target.value))}
                    onClick={(e) => e.stopPropagation()}
                    title="Target slot (0–31)"
                  />

                  {/* Name */}
                  <span style={{
                    flex: 1,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.78rem',
                    color: '#FFFFFF',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {entry.data.name || '—'}
                  </span>

                  {/* Kind badge */}
                  <span style={{
                    color: KIND_COLOR[entry.data.kind] ?? '#aaa',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.66rem',
                    flexShrink: 0,
                  }}>
                    {entry.data.kind.toUpperCase()}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: '0.4rem',
          padding: '0.5rem 0.75rem',
          borderTop: '1px solid #003366',
          background: '#000033',
        }}>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button
            className="btn"
            type="button"
            disabled={selected.size === 0}
            onClick={doLoad}
            style={{ color: selected.size > 0 ? '#00CCFF' : undefined }}
          >
            Load{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
