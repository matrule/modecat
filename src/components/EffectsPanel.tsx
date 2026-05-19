/**
 * EffectsPanel — Effect code reference + user-defined arpeggio sequence editor.
 *
 * Built-in effects mirror the OctaMED / ModeCat effect set.
 * User arpeggio sequences (cmd 0x20..0x2F) are defined here and stored in
 * the song; the sequencer picks them up at runtime.
 */

import { useState } from 'react';
import { useStore } from '../state/store';
import type { ArpSequence } from '../state/types';

// ── Built-in effect reference ─────────────────────────────────────────────────

interface EffectRef {
  cmd: string;
  param: string;
  name: string;
  desc: string;
  implemented: boolean;
}

const BUILTIN_EFFECTS: EffectRef[] = [
  { cmd: '00', param: 'xy', name: 'Arpeggio (fast)',    desc: 'Cycles root / root+x / root+y semitones per tick. Classic chiptune chord buzz.', implemented: true },
  { cmd: '01', param: 'xx', name: 'Portamento Up',      desc: 'Slide pitch up xx/16 semitones per tick, continuously while effect is present.', implemented: true },
  { cmd: '02', param: 'xx', name: 'Portamento Down',    desc: 'Slide pitch down xx/16 semitones per tick.', implemented: true },
  { cmd: '03', param: 'xx', name: 'Tone Portamento',    desc: 'Glide from previous note pitch to new note. xx = slide speed.', implemented: true },
  { cmd: '04', param: 'xy', name: 'Vibrato',            desc: 'Pitch LFO: x = speed, y = depth (semitone-based).', implemented: true },
  { cmd: '05', param: 'xy', name: 'Porta + Vol Slide',  desc: 'Tone portamento continues, plus volume slide (x = up, y = down).', implemented: true },
  { cmd: '06', param: 'xy', name: 'Vibrato + Vol Slide',desc: 'Vibrato continues, plus volume slide.', implemented: true },
  { cmd: '07', param: 'xy', name: 'Tremolo',            desc: 'Volume LFO: x = speed, y = depth.', implemented: true },
  { cmd: '09', param: 'xx', name: 'Sample Offset',      desc: 'Start sample playback at offset xx × 256 samples from start.', implemented: false },
  { cmd: '0A', param: 'xy', name: 'Volume Slide',       desc: 'x = slide up, y = slide down (in 1/64 units per tick).', implemented: true },
  { cmd: '0B', param: 'xx', name: 'Position Jump',      desc: 'Jump to song position xx at end of row.', implemented: true },
  { cmd: '0C', param: 'xx', name: 'Set Volume',         desc: 'Set channel volume: 00–40 (0x40 = full).', implemented: true },
  { cmd: '0F', param: 'xx', name: 'Set Speed / BPM',    desc: 'xx 01–1F: set ticks/row. xx 20–F0: set BPM. FE = stop. FF = cut note.', implemented: true },
  { cmd: '10', param: 'xx', name: 'Send MIDI Msg',      desc: 'Fire raw MIDI message from slot xx (0–F). Edit slots in MIDI panel.', implemented: true },
  { cmd: '11', param: 'xx', name: 'Fine Pitch Up',      desc: 'One-shot pitch shift up by xx semitones on note trigger.', implemented: true },
  { cmd: '12', param: 'xx', name: 'Fine Pitch Down',    desc: 'One-shot pitch shift down by xx semitones on note trigger.', implemented: true },
  { cmd: '16', param: 'xx', name: 'Pattern Loop',       desc: '00 = set loop start. xx = loop back xx times.', implemented: true },
  { cmd: '18', param: 'xx', name: 'Note Cut',           desc: 'Cut note after xx ticks.', implemented: true },
  { cmd: '1A', param: 'xx', name: 'Volume Up',          desc: 'Add xx to channel volume on note trigger.', implemented: true },
  { cmd: '1B', param: 'xx', name: 'Volume Down',        desc: 'Subtract xx from channel volume on note trigger.', implemented: true },
  { cmd: '1C', param: 'xx', name: 'MIDI Program',       desc: 'Send Program Change (xx = program 0–7F) on the MIDI channel of the active instrument.', implemented: true },
  { cmd: '1D', param: 'xx', name: 'Pattern Break',      desc: 'Jump to next song position, starting at row xx.', implemented: true },
  { cmd: '1E', param: 'xx', name: 'Repeat Row',         desc: 'Play current row xx additional times before advancing.', implemented: true },
];

// ── Preset chord shapes for quick fill ────────────────────────────────────────

const PRESETS: { label: string; steps: number[] }[] = [
  { label: 'Maj up',     steps: [0, 4, 7, 12] },
  { label: 'Min up',     steps: [0, 3, 7, 12] },
  { label: 'Maj up/dn',  steps: [0, 4, 7, 12, 7, 4] },
  { label: 'Min up/dn',  steps: [0, 3, 7, 12, 7, 3] },
  { label: 'Dom7 up',    steps: [0, 4, 7, 10, 12] },
  { label: 'Maj pent',   steps: [0, 2, 4, 7, 9, 12] },
  { label: 'Min pent',   steps: [0, 3, 5, 7, 10, 12] },
  { label: 'Octave',     steps: [0, 12, 0, 12] },
  { label: 'Power',      steps: [0, 7, 12, 7] },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function stepsToStr(steps: number[]): string {
  return steps.join(', ');
}

function strToSteps(s: string): number[] {
  return s
    .split(/[\s,;]+/)
    .map((t) => parseInt(t, 10))
    .filter((n) => !isNaN(n) && n >= -24 && n <= 48);
}

function nextFreeId(seqs: ArpSequence[]): number | null {
  for (let i = 0; i <= 15; i++) {
    if (!seqs.find((s) => s.id === i)) return i;
  }
  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EffectsPanel() {
  const arpSequences  = useStore((s) => s.arpSequences);
  const setArpSeq     = useStore((s) => s.setArpSequence);
  const removeArpSeq  = useStore((s) => s.removeArpSequence);

  // Which sequence is currently being edited (id or null).
  const [editingId, setEditingId] = useState<number | null>(null);

  // Draft fields for the editor.
  const [draftName,  setDraftName]  = useState('');
  const [draftSteps, setDraftSteps] = useState('');
  const [draftLoop,  setDraftLoop]  = useState(false);

  function openEditor(seq: ArpSequence) {
    setEditingId(seq.id);
    setDraftName(seq.name);
    setDraftSteps(stepsToStr(seq.steps));
    setDraftLoop(seq.loop);
  }

  function saveEdit() {
    if (editingId === null) return;
    const steps = strToSteps(draftSteps);
    if (steps.length === 0) return;
    setArpSeq({ id: editingId, name: draftName || `ARP ${editingId.toString(16).toUpperCase()}`, steps, loop: draftLoop });
    setEditingId(null);
  }

  function addNew() {
    const id = nextFreeId(arpSequences);
    if (id === null) return;
    const seq: ArpSequence = { id, name: `ARP ${id.toString(16).toUpperCase()}`, steps: [0, 3, 7, 12], loop: true };
    setArpSeq(seq);
    openEditor(seq);
  }

  const canAdd = arpSequences.length < 16;

  // Panel style constants
  const headerStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: '1rem', letterSpacing: '0.08em',
    color: '#FF8800', borderBottom: '1px solid rgba(255,136,0,0.3)',
    padding: '0.35rem 0.5rem', background: '#000011',
  };
  const rowStyle: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: '3.2rem 2.8rem 1fr',
    gap: '0.3rem', padding: '0.3rem 0.5rem',
    fontFamily: 'var(--font-mono)', fontSize: '1rem', alignItems: 'baseline',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', fontSize: '1rem' }}>

      {/* ── Effect Reference ─────────────────────────────────────────────── */}
      <div style={headerStyle}>EFFECT REFERENCE</div>
      <div style={{ flex: '0 0 auto', overflowY: 'auto', maxHeight: '42vh', borderBottom: '2px solid #000033' }}>
        {/* Column headings */}
        <div style={{ ...rowStyle, color: '#556688', borderBottom: '1px solid #001133' }}>
          <span>CMD</span><span>PARAM</span><span>NAME</span>
        </div>
        {BUILTIN_EFFECTS.map((e) => (
          <div key={e.cmd} style={{ ...rowStyle, opacity: e.implemented ? 1 : 0.45 }}
            title={e.desc}>
            <span style={{ color: '#FF8800', fontWeight: 'bold' }}>{e.cmd}</span>
            <span style={{ color: '#AADDFF' }}>{e.param}</span>
            <span style={{ color: e.implemented ? '#CCDDEE' : '#556688' }}>{e.name}</span>
          </div>
        ))}
        {/* User-defined arp sequences rendered live */}
        {arpSequences.map((seq) => {
          const cmdHex = (0x20 + seq.id).toString(16).toUpperCase().padStart(2, '0');
          return (
            <div key={`arp-${seq.id}`} style={{ ...rowStyle }}
              title={`User arp #${seq.id}: ${seq.steps.join(', ')} semitones${seq.loop ? ' (loop)' : ''}`}>
              <span style={{ color: '#FF8800', fontWeight: 'bold' }}>{cmdHex}</span>
              <span style={{ color: '#AADDFF' }}>--</span>
              <span style={{ color: '#CCEE88' }}>{seq.name}</span>
            </div>
          );
        })}
        {arpSequences.length === 0 && (
          <div style={{ ...rowStyle, opacity: 0.4 }}
            title="Define arp sequences in the Arp Sequences section below">
            <span style={{ color: '#FF8800', fontWeight: 'bold' }}>2x</span>
            <span style={{ color: '#AADDFF' }}>--</span>
            <span style={{ color: '#556688' }}>User Arp (none defined)</span>
          </div>
        )}
        <div style={{ padding: '0.25rem 0.5rem', color: '#7799AA', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
          Hover a row for description. Greyed = planned.
        </div>
      </div>

      {/* ── User Arpeggio Sequences ──────────────────────────────────────── */}
      <div style={headerStyle}>ARP SEQUENCES <span style={{ color: '#AADDFF', fontWeight: 'normal', fontSize: '0.85rem' }}>cmd 20–2F, 1 step/row</span></div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.25rem 0' }}>

        {arpSequences.length === 0 && (
          <div style={{ padding: '0.4rem 0.5rem', color: '#7799AA', fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
            No sequences defined. Add one below.
          </div>
        )}

        {arpSequences.map((seq) => (
          <div key={seq.id} style={{
            borderBottom: '1px solid #001133',
            background: editingId === seq.id ? '#000833' : 'transparent',
          }}>
            {editingId === seq.id ? (
              /* ── Inline editor ── */
              <div style={{ padding: '0.4rem 0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: '#FF8800', fontSize: '1rem', minWidth: '2rem' }}>
                    {(0x20 + seq.id).toString(16).toUpperCase()}
                  </span>
                  <input
                    type="text" value={draftName} maxLength={24}
                    onChange={(e) => setDraftName(e.target.value)}
                    style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '1rem' }}
                    placeholder="Name" />
                </div>

                {/* Steps input */}
                <div className="field-row">
                  <label title="Semitone offsets from the triggered note, comma-separated. E.g. 0,3,7,12">STEPS</label>
                  <input
                    type="text" value={draftSteps}
                    onChange={(e) => setDraftSteps(e.target.value)}
                    style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: '1rem' }}
                    placeholder="0, 3, 7, 12" />
                </div>

                {/* Preset buttons */}
                <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                  {PRESETS.map((p) => (
                    <button key={p.label} className="btn" type="button"
                      style={{ fontSize: '0.9rem', padding: '0.1rem 0.3rem' }}
                      onClick={() => setDraftSteps(stepsToStr(p.steps))}>
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* Step preview */}
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: '1rem', color: '#AADDFF',
                  background: '#000022', padding: '0.2rem 0.3rem', borderRadius: '2px',
                  display: 'flex', gap: '0.3rem', flexWrap: 'wrap', minHeight: '1.4rem',
                }}>
                  {strToSteps(draftSteps).map((st, i) => (
                    <span key={i} style={{
                      background: '#001144', padding: '0 0.3rem',
                      color: st === 0 ? '#FF8800' : st > 0 ? '#00CCFF' : '#FF4466',
                    }}>
                      {st > 0 ? `+${st}` : st}
                    </span>
                  ))}
                  {strToSteps(draftSteps).length === 0 && (
                    <span style={{ color: '#334455' }}>enter semitone offsets</span>
                  )}
                </div>

                {/* Loop + save/cancel */}
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <label style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
                    <input type="checkbox" checked={draftLoop} onChange={(e) => setDraftLoop(e.target.checked)} />
                    <span style={{ color: draftLoop ? '#00CCFF' : '#556688' }}>LOOP</span>
                  </label>
                  <button className="btn" type="button"
                    disabled={strToSteps(draftSteps).length === 0}
                    style={{ color: '#00FF88', marginLeft: 'auto' }}
                    onClick={saveEdit}>SAVE</button>
                  <button className="btn" type="button"
                    onClick={() => setEditingId(null)}>CANCEL</button>
                </div>
              </div>
            ) : (
              /* ── Collapsed row ── */
              <div style={{
                display: 'flex', gap: '0.4rem', alignItems: 'center',
                padding: '0.25rem 0.5rem', cursor: 'pointer',
              }} onClick={() => openEditor(seq)}>
                <span style={{ fontFamily: 'var(--font-mono)', color: '#FF8800', fontSize: '1rem', minWidth: '2rem' }}>
                  {(0x20 + seq.id).toString(16).toUpperCase()}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: '#AADDFF', flex: 1, fontSize: '1rem' }}>
                  {seq.name}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', color: '#556688', fontSize: '0.9rem' }}>
                  [{seq.steps.length} steps{seq.loop ? ', loop' : ''}]
                </span>
                <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', flex: 2 }}>
                  {seq.steps.slice(0, 12).map((st, i) => (
                    <span key={i} style={{
                      fontFamily: 'var(--font-mono)', fontSize: '0.9rem',
                      background: '#001033', padding: '0 0.2rem',
                      color: st === 0 ? '#FF8800' : st > 0 ? '#00CCFF' : '#FF4466',
                    }}>
                      {st > 0 ? `+${st}` : st}
                    </span>
                  ))}
                  {seq.steps.length > 12 && (
                    <span style={{ color: '#334455', fontSize: '0.9rem', fontFamily: 'var(--font-mono)' }}>…</span>
                  )}
                </div>
                <button className="btn" type="button"
                  style={{ fontSize: '0.9rem', padding: '0.1rem 0.3rem', color: '#FF4444' }}
                  onClick={(e) => { e.stopPropagation(); removeArpSeq(seq.id); }}>✕</button>
              </div>
            )}
          </div>
        ))}

        {/* Add button */}
        <div style={{ padding: '0.4rem 0.5rem' }}>
          <button className="btn" type="button" disabled={!canAdd} onClick={addNew}
            style={{ color: canAdd ? '#00FF88' : undefined }}>
            + ADD SEQUENCE {!canAdd ? '(max 16)' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
