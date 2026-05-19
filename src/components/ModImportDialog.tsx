/**
 * MOD / S3M import wizard dialog.
 * Shows file info, lets the user pick import options, then calls onImport.
 */

import { useState } from 'react';
import type { ModImportResult } from '../engine/modImport';

export interface ModImportOptions {
  /** Which order-list positions to include (indices into result.orderList) */
  orderStart: number;
  orderEnd: number;
  /** Add to end of song (false) or replace current song (true) */
  replaceSong: boolean;
  /** Instrument slot offset: first sample goes to this slot */
  instOffset: number;
}

interface Props {
  result: ModImportResult;
  filename: string;
  onImport: (opts: ModImportOptions) => void;
  onCancel: () => void;
}

const BADGE: React.CSSProperties = {
  display: 'inline-block',
  padding: '0 0.4rem',
  background: '#003388',
  border: '1px solid #0055AA',
  borderRadius: 2,
  color: '#88DDFF',
  fontSize: '0.75rem',
  marginLeft: '0.3rem',
};

const LABEL: React.CSSProperties = {
  color: 'rgba(255,255,255,0.45)',
  fontSize: '0.72rem',
  minWidth: '7rem',
  display: 'inline-block',
};

const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  marginBottom: '0.3rem',
};

export function ModImportDialog({ result, filename, onImport, onCancel }: Props) {
  const { format, songName, numChannels, numPatterns, numInstruments, bpm, speed, instruments, orderList } = result;

  const [orderStart, setOrderStart] = useState(0);
  const [orderEnd,   setOrderEnd]   = useState(Math.max(0, orderList.length - 1));
  const [replaceSong, setReplaceSong] = useState(false);
  const [instOffset, setInstOffset]  = useState(1);

  const totalPatterns = orderEnd - orderStart + 1;

  // Instrument table — only show slots with actual PCM data
  const instRows = instruments
    .map((inst, i) => ({ inst, i }))
    .filter(({ i }) => i > 0 && instruments[i]?.pcm !== null);

  function noteStr(midi: number): string {
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const oct = Math.floor(midi / 12) - 1;
    return `${names[midi % 12]}-${oct}`;
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#0055AA',
        border: '2px solid #FFFFFF',
        borderBottomColor: '#000', borderRightColor: '#000',
        minWidth: 520, maxWidth: 680,
        maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: '#FFF',
      }}>
        {/* Title bar */}
        <div style={{ background: '#003388', padding: '0.3rem 0.6rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
          <span style={{ color: '#FF8800', fontWeight: 'bold', letterSpacing: '0.05em' }}>
            IMPORT {format.toUpperCase()} FILE
          </span>
          <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.7rem' }}>{filename}</span>
        </div>

        <div style={{ overflowY: 'auto', padding: '0.6rem 0.8rem', flex: '1 1 auto' }}>

          {/* File info */}
          <div style={{ background: '#003388', border: '1px solid #224466', padding: '0.5rem 0.6rem', marginBottom: '0.7rem', borderRadius: 2 }}>
            <div style={{ color: '#FF8800', fontSize: '0.7rem', marginBottom: '0.35rem', letterSpacing: '0.07em' }}>FILE INFO</div>
            <div style={ROW}>
              <span style={LABEL}>Song name</span>
              <span style={{ color: '#AADDFF' }}>{songName || '(untitled)'}</span>
            </div>
            <div style={ROW}>
              <span style={LABEL}>Format</span>
              <span style={BADGE}>{format.toUpperCase()}</span>
              <span style={LABEL}>Channels</span>
              <span style={BADGE}>{numChannels}</span>
            </div>
            <div style={ROW}>
              <span style={LABEL}>Patterns</span>
              <span style={BADGE}>{numPatterns}</span>
              <span style={LABEL}>Song positions</span>
              <span style={BADGE}>{orderList.length}</span>
            </div>
            <div style={ROW}>
              <span style={LABEL}>Instruments</span>
              <span style={BADGE}>{numInstruments}</span>
              <span style={LABEL}>BPM / Speed</span>
              <span style={BADGE}>{bpm} / {speed}</span>
            </div>
          </div>

          {/* Instrument list */}
          {instRows.length > 0 && (
            <div style={{ marginBottom: '0.7rem' }}>
              <div style={{ color: '#FF8800', fontSize: '0.7rem', marginBottom: '0.25rem', letterSpacing: '0.07em' }}>SAMPLES</div>
              <div style={{ background: '#003388', border: '1px solid #224466', borderRadius: 2, maxHeight: '140px', overflowY: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2rem 1fr 3.5rem 3.5rem 3.5rem', padding: '0.2rem 0.4rem', borderBottom: '1px solid #224466', color: 'rgba(255,255,255,0.4)', fontSize: '0.68rem' }}>
                  <span>#</span><span>Name</span><span style={{ textAlign:'right' }}>kHz</span><span style={{ textAlign:'right' }}>Base</span><span style={{ textAlign:'right' }}>Vol</span>
                </div>
                {instRows.map(({ inst, i }) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '2rem 1fr 3.5rem 3.5rem 3.5rem', padding: '0.15rem 0.4rem', borderBottom: '1px solid rgba(0,68,136,0.5)', fontSize: '0.74rem' }}>
                    <span style={{ color: '#FF8800' }}>{i.toString(16).toUpperCase().padStart(2, '0')}</span>
                    <span style={{ color: '#AADDFF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inst.name || '—'}</span>
                    <span style={{ textAlign: 'right', color: '#CCEE88' }}>{(inst.sampleRate / 1000).toFixed(1)}</span>
                    <span style={{ textAlign: 'right', color: '#88BBFF' }}>{noteStr(inst.baseNote)}</span>
                    <span style={{ textAlign: 'right', color: '#88FF88' }}>{Math.round(inst.volume / 127 * 64)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Import options */}
          <div style={{ background: '#003388', border: '1px solid #224466', padding: '0.5rem 0.6rem', borderRadius: 2, marginBottom: '0.6rem' }}>
            <div style={{ color: '#FF8800', fontSize: '0.7rem', marginBottom: '0.4rem', letterSpacing: '0.07em' }}>IMPORT OPTIONS</div>

            {/* Song positions range */}
            <div style={ROW}>
              <span style={LABEL}>Song positions</span>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.7rem' }}>From</span>
                <input type="number" min={0} max={Math.max(0, orderList.length - 1)}
                  value={orderStart}
                  onChange={e => { const v = Math.max(0, Math.min(orderList.length - 1, Number(e.target.value))); setOrderStart(v); if (v > orderEnd) setOrderEnd(v); }}
                  style={{ width: '4ch', textAlign: 'center' }} />
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.7rem' }}>to</span>
                <input type="number" min={0} max={Math.max(0, orderList.length - 1)}
                  value={orderEnd}
                  onChange={e => { const v = Math.max(0, Math.min(orderList.length - 1, Number(e.target.value))); setOrderEnd(v); if (v < orderStart) setOrderStart(v); }}
                  style={{ width: '4ch', textAlign: 'center' }} />
                <span style={{ color: '#88DDFF', fontSize: '0.7rem' }}>({totalPatterns} pattern{totalPatterns !== 1 ? 's' : ''})</span>
              </label>
            </div>

            {/* Instrument slot offset */}
            <div style={ROW}>
              <span style={LABEL}>Start inst slot</span>
              <input type="number" min={1} max={31}
                value={instOffset}
                onChange={e => setInstOffset(Math.max(1, Math.min(31, Number(e.target.value))))}
                style={{ width: '4ch', textAlign: 'center' }} />
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.7rem' }}>
                (samples load into slots {instOffset}–{Math.min(31, instOffset + numInstruments - 1)})
              </span>
            </div>

            {/* Replace / append */}
            <div style={ROW}>
              <span style={LABEL}>Song placement</span>
              <label style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center', cursor: 'pointer' }}>
                <input type="radio" name="placement" checked={!replaceSong} onChange={() => setReplaceSong(false)} />
                <span style={{ color: !replaceSong ? '#88FF88' : 'rgba(255,255,255,0.5)' }}>Append to song</span>
              </label>
              <label style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center', cursor: 'pointer', marginLeft: '0.5rem' }}>
                <input type="radio" name="placement" checked={replaceSong} onChange={() => setReplaceSong(true)} />
                <span style={{ color: replaceSong ? '#FF8844' : 'rgba(255,255,255,0.5)' }}>Replace song</span>
              </label>
            </div>

            {numChannels > 16 && (
              <div style={{ color: '#FFCC44', fontSize: '0.7rem', marginTop: '0.3rem' }}>
                ⚠ File has {numChannels} channels — ModeCat supports 16 max. Channels 17+ are skipped.
              </div>
            )}
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', padding: '0.5rem 0.8rem', borderTop: '2px solid #000', background: '#003388' }}>
          <button className="btn" type="button" onClick={onCancel}>Cancel</button>
          <button className="btn" type="button"
            style={{ color: '#FFD700', borderColor: '#FFD700' }}
            onClick={() => onImport({ orderStart, orderEnd, replaceSong, instOffset })}>
            ▶ Import
          </button>
        </div>
      </div>
    </div>
  );
}
