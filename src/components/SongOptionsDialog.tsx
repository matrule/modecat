// Song Options dialog — title, author, playback defaults, loop flags.
// Opened from Song → Set Options….

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';

interface Props {
  onClose: () => void;
}

export function SongOptionsDialog({ onClose }: Props) {
  const meta        = useStore((s) => s.meta);
  const transport   = useStore((s) => s.transport);
  const setMeta     = useStore((s) => s.setMeta);
  const setTransport = useStore((s) => s.setTransport);

  // Local state — committed on OK.
  const [title, setTitle]     = useState(meta.title);
  const [author, setAuthor]   = useState(meta.author);
  const [bpm, setBpm]         = useState(String(transport.bpm));
  const [speed, setSpeed]     = useState(String(transport.speed));
  const [loopSong, setLoopSong]       = useState(transport.loopSong);
  const [patternLoop, setPatternLoop] = useState(transport.patternLoop);

  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.select(); }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      if (e.key === 'Enter')  { e.preventDefault(); save(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, author, bpm, speed, loopSong, patternLoop]);

  function save() {
    setMeta({ title: title.trim().slice(0, 24), author: author.trim().slice(0, 24) });
    const bpmN   = Math.max(20,  Math.min(255, parseInt(bpm,   10)));
    const speedN = Math.max(1,   Math.min(15,  parseInt(speed, 10)));
    setTransport({
      bpm:         isNaN(bpmN)   ? transport.bpm   : bpmN,
      speed:       isNaN(speedN) ? transport.speed : speedN,
      loopSong,
      patternLoop,
    });
    onClose();
  }

  return (
    <div className="ip-backdrop" onMouseDown={onClose}>
      <div className="ip-dialog songopts-dialog" onMouseDown={(e) => e.stopPropagation()}>
        {/* Title bar */}
        <div className="ip-titlebar">
          <span>Song Options</span>
          <button className="ip-close" type="button" onClick={onClose} tabIndex={-1}>✕</button>
        </div>

        <div className="ip-body">
          {/* ── Metadata ── */}
          <div className="ip-section-title">ANNOTATION</div>

          <div className="ip-row">
            <label className="ip-label" htmlFor="so-title">Title</label>
            <input
              id="so-title"
              ref={titleRef}
              className="ip-input"
              type="text"
              maxLength={24}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ width: '18ch' }}
            />
          </div>

          <div className="ip-row">
            <label className="ip-label" htmlFor="so-author">Author</label>
            <input
              id="so-author"
              className="ip-input"
              type="text"
              maxLength={24}
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              style={{ width: '18ch' }}
            />
          </div>

          {/* ── Tempo ── */}
          <div className="ip-section-title">TEMPO</div>

          <div className="ip-row">
            <label className="ip-label" htmlFor="so-bpm">BPM</label>
            <input
              id="so-bpm"
              className="ip-input"
              type="number"
              min={20}
              max={255}
              value={bpm}
              onChange={(e) => setBpm(e.target.value)}
              style={{ width: '6ch', textAlign: 'right' }}
            />
            <span className="ip-unit" style={{ opacity: 0.6, fontSize: '13px' }}>(20 – 255)</span>
          </div>

          <div className="ip-row">
            <label className="ip-label" htmlFor="so-speed">Speed</label>
            <input
              id="so-speed"
              className="ip-input"
              type="number"
              min={1}
              max={15}
              value={speed}
              onChange={(e) => setSpeed(e.target.value)}
              style={{ width: '6ch', textAlign: 'right' }}
            />
            <span className="ip-unit" style={{ opacity: 0.6, fontSize: '13px' }}>(1 – 15)</span>
          </div>

          {/* ── Playback flags ── */}
          <div className="ip-section-title">PLAYBACK</div>

          <div className="ip-row">
            <label className="ip-label" />
            <label style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={loopSong}
                onChange={(e) => setLoopSong(e.target.checked)}
              />
              Loop Song
            </label>
          </div>

          <div className="ip-row">
            <label className="ip-label" />
            <label style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={patternLoop}
                onChange={(e) => setPatternLoop(e.target.checked)}
              />
              Block Loop
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="ip-footer">
          <button className="btn" type="button" onClick={save}>OK</button>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
