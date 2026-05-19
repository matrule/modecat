import { useMemo, useRef, useState } from 'react';
import { useStore, useActivePattern } from '../state/store';
import { MAX_INSTRUMENTS, type Instrument, type SampleInstrument, type HybridInstrument, type SynthInstrument } from '../state/types';
import { InstParamsDialog } from './InstParamsDialog';

/** Deep-clone an instrument so the copy is fully independent. */
function cloneInstrument(inst: Instrument): Instrument {
  if (inst.kind === 'sample') {
    const s = inst as SampleInstrument;
    return { ...s, pcm: s.pcm ? new Float32Array(s.pcm) : null };
  }
  if (inst.kind === 'hybrid') {
    const h = inst as HybridInstrument;
    return {
      ...h,
      pcm: h.pcm ? new Float32Array(h.pcm) : null,
      pitchProg: [...h.pitchProg],
      volProg: [...h.volProg],
    };
  }
  if (inst.kind === 'synth') {
    const sy = inst as SynthInstrument;
    return {
      ...sy,
      waveforms: sy.waveforms.map((w) => new Float32Array(w)),
      pitchProg: [...sy.pitchProg],
      volProg: [...sy.volProg],
    };
  }
  return { ...inst };
}

const kindLabel: Record<Instrument['kind'], string> = {
  sample: 'SMP',
  midi: 'MID',
  synth: 'SYN',
  hybrid: 'HYB',
  empty: '--',
};

export function InstrumentList() {
  const instruments = useStore((s) => s.instruments);
  const selected = useStore((s) => s.selectedInstrument);
  const setSelected = useStore((s) => s.setSelectedInstrument);
  const setInstrument = useStore((s) => s.setInstrument);
  const swapInstrumentGlobal = useStore((s) => s.swapInstrumentGlobal);
  const reassignInBlock = useStore((s) => s.reassignInBlock);
  const instHighlight = useStore((s) => s.instHighlight);
  const setInstHighlight = useStore((s) => s.setInstHighlight);
  const instCounts = useStore((s) => s.instCounts);
  const setInstCounts = useStore((s) => s.setInstCounts);

  // Count how many cells in the active pattern use each instrument slot.
  const activePattern = useActivePattern();
  const usageCounts = useMemo(() => {
    const counts = new Array<number>(MAX_INSTRUMENTS).fill(0);
    if (activePattern) {
      for (const row of activePattern.rows) {
        for (const cell of row) {
          if (cell.instrument > 0 && cell.instrument < MAX_INSTRUMENTS) {
            counts[cell.instrument]!++;
          }
        }
      }
    }
    return counts;
  }, [activePattern]);

  // Instrument Parameters dialog — opened by double-click
  const [paramsOpen, setParamsOpen] = useState<number | null>(null);

  // Instrument clipboard for copy/paste via right-click context menu.
  const instClipboard = useRef<Instrument | null>(null);
  // Trigger a re-render when clipboard gains a value so "Paste" enables.
  const [hasClipboard, setHasClipboard] = useState(false);

  // Manual §"INSTRUMENT DELETION, EXCHANGING AND CHANGING" p.59-60:
  // change all notes from one instrument to another (or exchange, or delete).
  const [swapFrom, setSwapFrom] = useState(1);
  const [swapTo, setSwapTo] = useState(2);

  return (
    <div className="inst-list-wrap">
      {paramsOpen !== null && (
        <InstParamsDialog
          instIdx={paramsOpen}
          onClose={() => setParamsOpen(null)}
        />
      )}

      {/* ── Usage-display toggle buttons ───────────────────────────────── */}
      <div className="inst-list-toggles">
        <button
          className={`btn inst-toggle-btn${instHighlight ? ' is-active' : ''}`}
          type="button"
          title="Highlight cells that use the selected instrument"
          onClick={() => setInstHighlight(!instHighlight)}
        >
          HL
        </button>
        <button
          className={`btn inst-toggle-btn${instCounts ? ' is-active' : ''}`}
          type="button"
          title="Show cell-usage counts per instrument"
          onClick={() => setInstCounts(!instCounts)}
        >
          #
        </button>
      </div>

      <div className="inst-list">
      {instruments.slice(1, MAX_INSTRUMENTS).map((inst, i) => {
        const idx = i + 1;
        const count = usageCounts[idx] ?? 0;
        return (
          <div key={idx}>
          <div
            className={[
              'inst-row',
              inst.kind === 'empty' ? 'is-empty' : '',
              idx === selected ? 'is-selected' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => setSelected(idx)}
            onDoubleClick={() => {
              setSelected(idx);
              setParamsOpen(idx);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setSelected(idx);
              const menu = document.createElement('div');
              menu.className = 'ctx-menu';
              menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999`;
              const mkItem = (label: string, disabled: boolean, cb: () => void) => {
                const item = document.createElement('div');
                item.className = `ctx-menu__item${disabled ? ' is-disabled' : ''}`;
                item.textContent = label;
                if (!disabled) {
                  item.onmousedown = (ev) => {
                    ev.stopPropagation();
                    menu.remove();
                    cb();
                  };
                }
                return item;
              };
              const slotLabel = idx.toString(16).toUpperCase().padStart(2, '0');
              const selLabel  = selected.toString(16).toUpperCase().padStart(2, '0');
              const canReassign = idx !== selected && selected > 0;
              const sep = document.createElement('div');
              sep.className = 'ctx-menu__sep';
              menu.append(
                mkItem(`Copy Instrument ${slotLabel}`, false, () => {
                  instClipboard.current = cloneInstrument(inst);
                  setHasClipboard(true);
                }),
                mkItem('Paste Instrument Here', !hasClipboard, () => {
                  if (!instClipboard.current) return;
                  setInstrument(idx, cloneInstrument(instClipboard.current));
                }),
                sep,
                mkItem(
                  `Reassign ${selLabel} → ${slotLabel}  (this block)`,
                  !canReassign,
                  () => { reassignInBlock(selected, idx); setSelected(idx); }
                ),
                mkItem(
                  `Reassign ${selLabel} → ${slotLabel}  (all blocks)`,
                  !canReassign,
                  () => { swapInstrumentGlobal(selected, idx, 'change'); setSelected(idx); }
                ),
              );
              document.body.append(menu);
              const dismiss = () => { menu.remove(); document.removeEventListener('mousedown', dismiss); };
              setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
            }}
            title="Click to select · Double-click to edit parameters · Right-click to copy/paste"
          >
            <span className="num">{idx.toString(16).toUpperCase().padStart(2, '0')}</span>
            <span className="name">{inst.name}</span>
            {instCounts && (
              <span className={`inst-count${count === 0 ? ' is-zero' : ''}`}>
                {count > 0 ? count : '·'}
              </span>
            )}
            <span className="kind">{kindLabel[inst.kind]}</span>
          </div>
          </div>
        );
      })}
      </div>

      <div className="panel inst-swap">
        <div className="panel__title">Instrument Swap</div>
        <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
          <label className="upper" style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}>
            From
            <input
              type="number" min={1} max={MAX_INSTRUMENTS - 1}
              value={swapFrom}
              onChange={(e) => setSwapFrom(Math.max(1, Math.min(MAX_INSTRUMENTS - 1, Number(e.target.value))))}
              style={{ width: '5ch' }}
            />
          </label>
          <label className="upper" style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}>
            To
            <input
              type="number" min={1} max={MAX_INSTRUMENTS - 1}
              value={swapTo}
              onChange={(e) => setSwapTo(Math.max(1, Math.min(MAX_INSTRUMENTS - 1, Number(e.target.value))))}
              style={{ width: '5ch' }}
            />
          </label>
        </div>
        <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap', marginTop: '0.3rem' }}>
          <button className="btn" type="button" onClick={() => swapInstrumentGlobal(swapFrom, swapTo, 'change')}    title="Change every From → To">Change →</button>
          <button className="btn" type="button" onClick={() => swapInstrumentGlobal(swapFrom, swapTo, 'exchange')}  title="Exchange From ↔ To">Exchange ↔</button>
          <button className="btn btn--danger" type="button" onClick={() => swapInstrumentGlobal(swapFrom, swapTo, 'delete')} title="Delete every note that uses From">Delete</button>
        </div>
      </div>
    </div>
  );
}
