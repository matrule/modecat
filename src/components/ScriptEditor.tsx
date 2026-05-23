/**
 * ScriptEditor — two-tab in-app editor for ModeCat's script interfaces.
 *
 * JSON tab
 *   Shows the live song model as pretty-printed JSON (same format as the
 *   .modecat.json save file, including base64 PCM blobs).  Editable:
 *   Apply writes back via importSongFile().  Auto-refreshes when the model
 *   changes externally (unless the editor has unsaved edits).
 *
 * ARexx tab
 *   Full ARexx interpreter (see engine/arexx.ts) with ADDRESS 'MODECAT'
 *   command port.  Write a script, press ▶ RUN (or Ctrl+Enter), watch the
 *   output console.  Authentic to OctaMED's own ARexx interface circa 1993.
 */

import { useCallback, useRef, useState } from 'react';
import { exportSongFile, importSongFile } from '../state/persist';

type Tab = 'json';

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Serialise the song model to JSON.
 * @param includePcm - include base64 PCM blobs (can be 100s of MB for sample-heavy songs)
 */
function getModelJson(includePcm = false): string {
  try { return JSON.stringify(exportSongFile(includePcm), null, 2); }
  catch (e) { return `/* Error serialising model: ${e} */`; }
}

function lineCount(s: string): number {
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s[i] === '\n') n++;
  return n;
}


// ═══════════════════════════════════════════════════════════════════════════
//  JSON EDITOR PANE
// ═══════════════════════════════════════════════════════════════════════════

function JsonPane() {
  // Start empty — user clicks LOAD to serialise. Avoids freezing the tab when
  // a sample-heavy song (e.g. Space Debris) is loaded and PCM is included.
  const [text, setText] = useState<string>('');
  const [dirty, setDirty] = useState(false);
  const [includePcm, setIncludePcm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyOk, setApplyOk] = useState(false);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    setDirty(true);
    setError(null);
    setApplyOk(false);
  }, []);

  function handleLoad() {
    setText(getModelJson(includePcm));
    setDirty(false);
    setError(null);
    setApplyOk(false);
  }

  function handleApply() {
    try {
      importSongFile(JSON.parse(text));
      setDirty(false);
      setError(null);
      setApplyOk(true);
      setTimeout(() => setApplyOk(false), 1800);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setApplyOk(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (dirty) handleApply(); else handleLoad();
    }
  }

  // Single-node gutter — avoids creating one DOM node per line (catastrophic
  // for 50k-line JSON dumps from sample-heavy songs).
  const lines = lineCount(text || ' ');
  const gutterText = Array.from({ length: lines }, (_, i) => i + 1).join('\n');

  return (
    <div className="script-editor__pane">
      <div className="script-editor__toolbar">
        <button className="btn script-editor__btn" type="button"
          onClick={handleLoad}
          title="Serialise the current song model into this editor">
          ↓ LOAD
        </button>
        <button className="btn script-editor__btn" type="button"
          disabled={!dirty} onClick={handleApply}
          title="Apply JSON to model (Ctrl+Enter)">
          ▶ APPLY
        </button>
        <label className="script-editor__pcm-toggle" title="Include base64-encoded PCM data (warning: can be 100s of MB for sample-heavy songs)">
          <input type="checkbox" checked={includePcm} onChange={(e) => setIncludePcm(e.target.checked)} />
          {' '}PCM
        </label>
        <span className={`script-editor__status${error ? ' is-error' : applyOk ? ' is-ok' : dirty ? ' is-dirty' : ''}`}>
          {error ? `⚠ ${error}` : applyOk ? '✓ Applied' : dirty ? '● Unsaved  (Ctrl+Enter to apply)' : text ? '✓ Loaded' : 'Click ↓ LOAD to serialise'}
        </span>
      </div>
      <div className="script-editor__code-wrap">
        <pre className="script-editor__gutter" aria-hidden="true">{gutterText}</pre>
        <textarea
          className="script-editor__code"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          placeholder="Click ↓ LOAD to serialise the current song to JSON"
        />
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════
//  SCRIPT EDITOR (root)
// ═══════════════════════════════════════════════════════════════════════════

export function ScriptEditor() {
  return (
    <div className="script-editor">
      <div className="script-editor__tabs">
        <div className="script-editor__tabs-spacer" />
        <span className="script-editor__linecount">Song model  ·  full save format (PCM excluded by default)</span>
      </div>
      <JsonPane />
    </div>
  );
}
