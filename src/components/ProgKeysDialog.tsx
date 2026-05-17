/**
 * ProgKeysDialog — Programmable Keys editor (#32).
 *
 * 10 slots (Shift+0 … Shift+9). Each slot defines a note, instrument,
 * optional command, and data byte. Pressing Shift+<digit> in the pattern
 * editor inserts the corresponding slot at the cursor position.
 *
 * Fields:
 *   Note       — MIDI note number 1..127, or 0 = "no note"
 *   Instrument — 0..31 (0 = no change)
 *   Cmd        — 0..FF hex command byte (0 = none)
 *   Data       — 0..FF hex data byte
 *
 * Opened from Settings → Programmable Keys…
 */

import { useEffect } from 'react';
import { useStore } from '../state/store';

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function noteName(n: number): string {
  if (n <= 0) return '—';
  return NOTE_NAMES[n % 12]! + Math.floor(n / 12 - 1);
}

interface Props {
  onClose: () => void;
}

export function ProgKeysDialog({ onClose }: Props) {
  const progKeys  = useStore((s) => s.progKeys);
  const setProgKey = useStore((s) => s.setProgKey);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function patch(slot: number, field: 'note' | 'instrument' | 'cmd' | 'data', raw: string) {
    const current = progKeys[slot] ?? { note: 0, instrument: 0, cmd: 0, data: 0 };
    let value: number;
    if (field === 'note' || field === 'instrument') {
      value = Math.max(0, Math.min(field === 'note' ? 127 : 31, Number(raw)));
    } else {
      value = Math.max(0, Math.min(0xff, parseInt(raw, 16) || 0));
    }
    const next = { ...current, [field]: value };
    // If everything is zero, treat as empty slot
    setProgKey(slot, (next.note === 0 && next.instrument === 0 && next.cmd === 0 && next.data === 0)
      ? null : next);
  }

  function clearSlot(slot: number) {
    setProgKey(slot, null);
  }

  const val = (slot: number) => progKeys[slot] ?? { note: 0, instrument: 0, cmd: 0, data: 0 };

  return (
    <div className="ip-backdrop" onMouseDown={onClose}>
      <div className="ip-dialog progkeys-dialog" onMouseDown={(e) => e.stopPropagation()}>

        <div className="ip-titlebar">
          <span>Programmable Keys — Shift+0..9</span>
          <button className="ip-close" type="button" onClick={onClose}>✕</button>
        </div>

        <div className="ip-body">
          <table className="progkeys-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Note</th>
                <th></th>
                <th>Inst</th>
                <th>Cmd</th>
                <th>Data</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 10 }, (_, i) => {
                const v = val(i);
                const isEmpty = progKeys[i] === null;
                return (
                  <tr key={i} className={isEmpty ? 'progkeys-row--empty' : ''}>
                    <td className="progkeys-key">Shift+{i}</td>

                    <td>
                      <input
                        className="ip-input ip-input--sm"
                        type="number" min={0} max={127}
                        value={v.note}
                        onChange={(e) => patch(i, 'note', e.target.value)}
                      />
                    </td>
                    <td className="progkeys-notename">{noteName(v.note)}</td>

                    <td>
                      <input
                        className="ip-input ip-input--sm"
                        type="number" min={0} max={31}
                        value={v.instrument}
                        onChange={(e) => patch(i, 'instrument', e.target.value)}
                      />
                    </td>

                    <td>
                      <input
                        className="ip-input ip-input--hex"
                        type="text" maxLength={2}
                        value={v.cmd.toString(16).toUpperCase().padStart(2, '0')}
                        onChange={(e) => patch(i, 'cmd', e.target.value)}
                      />
                    </td>

                    <td>
                      <input
                        className="ip-input ip-input--hex"
                        type="text" maxLength={2}
                        value={v.data.toString(16).toUpperCase().padStart(2, '0')}
                        onChange={(e) => patch(i, 'data', e.target.value)}
                      />
                    </td>

                    <td>
                      <button
                        className="btn"
                        type="button"
                        onClick={() => clearSlot(i)}
                        disabled={isEmpty}
                        title="Clear slot"
                      >✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="progkeys-hint">
            In the pattern editor: Shift+digit inserts the programmed note at the cursor.
            Note 0 = no note (command only). Inst 0 = keep current instrument.
          </p>
        </div>

        <div className="ip-footer">
          <button className="btn" type="button" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}
