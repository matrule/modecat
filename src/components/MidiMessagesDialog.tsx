/**
 * MidiMessagesDialog — 16-slot MIDI message editor.
 *
 * Each slot holds a name and a sequence of raw MIDI bytes (e.g. SysEx or
 * a CC burst). Slots are triggered by the sequencer effect command 10xx,
 * where xx is the slot index (00..0F hex).
 *
 * Bytes are entered as space-separated hex pairs: "B0 07 64" = CC 7 value
 * 100 on channel 1. The dialog validates and normalises on blur.
 */

import { useEffect, useState } from 'react';
import { useStore } from '../state/store';

// ── Helpers ────────────────────────────────────────────────────────────────

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

function hexToBytes(s: string): number[] | null {
  const tokens = s.trim().split(/\s+/).filter(Boolean);
  const out: number[] = [];
  for (const t of tokens) {
    const v = parseInt(t, 16);
    if (isNaN(v) || v < 0 || v > 0xff) return null;
    out.push(v);
  }
  return out;
}

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export function MidiMessagesDialog({ onClose }: Props) {
  const midiMessages  = useStore((s) => s.midiMessages);
  const setMidiMessage = useStore((s) => s.setMidiMessage);

  // Local drafts for the text areas so edits don't round-trip through store on every keystroke.
  const [names, setNames]   = useState<string[]>(() => midiMessages.map((m) => m.name));
  const [hexes, setHexes]   = useState<string[]>(() => midiMessages.map((m) => bytesToHex(m.bytes)));
  const [errors, setErrors] = useState<boolean[]>(() => Array(16).fill(false));

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function commitSlot(i: number) {
    const bytes = hexToBytes(hexes[i]);
    const newErrors = errors.slice();
    if (bytes === null) {
      newErrors[i] = true;
      setErrors(newErrors);
      return;
    }
    newErrors[i] = false;
    setErrors(newErrors);
    // Normalise the hex display.
    const newHexes = hexes.slice();
    newHexes[i] = bytesToHex(bytes);
    setHexes(newHexes);
    setMidiMessage(i, { name: names[i], bytes });
  }

  function updateName(i: number, val: string) {
    const newNames = names.slice();
    newNames[i] = val;
    setNames(newNames);
    setMidiMessage(i, { name: val, bytes: midiMessages[i].bytes });
  }

  return (
    <div className="ip-backdrop" onMouseDown={onClose}>
      <div className="ip-dialog midi-msg-dialog" onMouseDown={(e) => e.stopPropagation()}>

        <div className="ip-titlebar">
          <span>MIDI Messages — 10xx command slots</span>
          <button className="ip-close" type="button" onClick={onClose}>✕</button>
        </div>

        <div className="ip-body midi-msg-body">
          <p className="midi-msg-hint">
            Use effect <strong>10xx</strong> in the tracker (xx = slot 00–0F) to fire a slot while playing.
            Enter bytes as space-separated hex: <code>B0 07 64</code> = CC7 vol=100 ch1.
          </p>

          <div className="midi-msg-grid">
            <span className="midi-msg-col-hdr">Slot</span>
            <span className="midi-msg-col-hdr">Name</span>
            <span className="midi-msg-col-hdr">Bytes (hex)</span>
            <span className="midi-msg-col-hdr">Preview</span>

            {Array.from({ length: 16 }, (_, i) => {
              const bytes = midiMessages[i]?.bytes ?? [];
              return (
                <>
                  <span key={`sl-${i}`} className="midi-msg-slot-num">
                    {i.toString(16).toUpperCase().padStart(2, '0')}
                  </span>

                  <input
                    key={`nm-${i}`}
                    className="ip-input midi-msg-name"
                    type="text"
                    maxLength={16}
                    value={names[i]}
                    onChange={(e) => updateName(i, e.target.value)}
                  />

                  <input
                    key={`hx-${i}`}
                    className={`ip-input midi-msg-hex${errors[i] ? ' is-error' : ''}`}
                    type="text"
                    value={hexes[i]}
                    placeholder="e.g. B0 07 64"
                    onChange={(e) => {
                      const newHexes = hexes.slice();
                      newHexes[i] = e.target.value;
                      setHexes(newHexes);
                    }}
                    onBlur={() => commitSlot(i)}
                  />

                  <span key={`pv-${i}`} className="midi-msg-preview">
                    {bytes.length === 0
                      ? <span className="muted">—</span>
                      : describeMidiBytes(bytes)}
                  </span>
                </>
              );
            })}
          </div>
        </div>

        <div className="ip-footer">
          <button className="btn" type="button" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}

// ── Human-readable byte description ───────────────────────────────────────

function describeMidiBytes(bytes: number[]): string {
  if (bytes.length === 0) return '';
  const status = bytes[0];
  if (status === undefined) return '';
  const type = status & 0xf0;
  const ch   = (status & 0x0f) + 1;

  if (status === 0xf0) return `SysEx (${bytes.length} bytes)`;
  if (status === 0xff) return 'Meta / Reset';
  if (bytes.length < 2) return `Status ${status.toString(16).toUpperCase()}`;

  switch (type) {
    case 0x80: return `Note Off  ch${ch} n=${bytes[1]} v=${bytes[2] ?? 0}`;
    case 0x90: return `Note On   ch${ch} n=${bytes[1]} v=${bytes[2] ?? 0}`;
    case 0xa0: return `Aftertouch ch${ch} n=${bytes[1]} p=${bytes[2] ?? 0}`;
    case 0xb0: return `CC${bytes[1]}=${bytes[2] ?? '?'} ch${ch}`;
    case 0xc0: return `Program ${bytes[1]} ch${ch}`;
    case 0xd0: return `Ch Pressure ${bytes[1]} ch${ch}`;
    case 0xe0: {
      const pb = ((bytes[2] ?? 64) << 7) | (bytes[1] ?? 0);
      return `PitchBend ${pb - 8192} ch${ch}`;
    }
    default: return `${bytes.length} bytes`;
  }
}
