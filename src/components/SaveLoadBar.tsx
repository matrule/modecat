// Save / Load controls. Save downloads a .modecat.json file. Load opens the
// File API picker and replaces the current song.

import { useState } from 'react';
import { useStore } from '../state/store';
import { downloadSong, loadSongFromFile } from '../state/persist';

export function SaveLoadBar() {
  const meta = useStore((s) => s.meta);
  const setMeta = useStore((s) => s.setMeta);
  // Manual §"SAVE MODULE" p.35: "MOD1(NO INSTR)" saves without instrument
  // data.  Default is to include instruments (save full file).
  const [inclInstr, setInclInstr] = useState(true);

  return (
    <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="upper">TITLE</span>
      <input
        type="text"
        value={meta.title}
        onChange={(e) => setMeta({ title: e.target.value.slice(0, 24) })}
        style={{ width: '14ch' }}
      />
      <span className="upper">BY</span>
      <input
        type="text"
        value={meta.author}
        onChange={(e) => setMeta({ author: e.target.value.slice(0, 24) })}
        style={{ width: '12ch' }}
      />
      <label
        className="upper"
        style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center' }}
        title="When unchecked, PCM sample data is omitted from the saved file (block data + instrument metadata still saved). Synth waveforms are always included."
      >
        <input
          type="checkbox"
          checked={inclInstr}
          onChange={(e) => setInclInstr(e.target.checked)}
        />
        Incl. samples
      </label>
      <button
        className="btn"
        onClick={() => {
          const fname = (meta.title || 'untitled').toLowerCase().replace(/\s+/g, '_') + '.modecat.json';
          downloadSong(fname, inclInstr);
        }}
        type="button"
        tabIndex={-1}
      >
        Save
      </button>
      <label className="btn" style={{ cursor: 'pointer' }}>
        Load…
        <input
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              await loadSongFromFile(f);
            } catch (err) {
              alert(`Could not load song: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
              e.target.value = '';
            }
          }}
        />
      </label>
    </div>
  );
}
