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

import { useCallback, useEffect, useRef, useState } from 'react';
import { exportSongFile, importSongFile } from '../state/persist';
import { runARexx, makeModeCatDispatcher } from '../engine/arexx';
import { useStore } from '../state/store';

type Tab = 'json' | 'arexx';

// ── helpers ───────────────────────────────────────────────────────────────────

function getModelJson(): string {
  try { return JSON.stringify(exportSongFile(true), null, 2); }
  catch (e) { return `/* Error serialising model: ${e} */`; }
}

function lineCount(s: string): number {
  let n = 1;
  for (let i = 0; i < s.length; i++) if (s[i] === '\n') n++;
  return n;
}

// ── default ARexx starter script ─────────────────────────────────────────────

const AREXX_STARTER = `/* ModeCat ARexx script — ADDRESS 'MODECAT' command port */
/* See Display → Script Editor → ARexx tab for documentation */

ADDRESS 'MODECAT'

/* Query current song info */
'GETBPM'
SAY 'BPM: ' || RESULT

'GETPATTERNCOUNT'
SAY 'Patterns: ' || RESULT

'GETPATTERNLENGTH'
SAY 'Current pattern length: ' || RESULT || ' rows'
`;

// ── output line types ─────────────────────────────────────────────────────────

interface OutLine { kind: 'say' | 'err' | 'ok' | 'info'; text: string; }

// ═══════════════════════════════════════════════════════════════════════════
//  JSON EDITOR PANE
// ═══════════════════════════════════════════════════════════════════════════

function JsonPane() {
  const [text, setText] = useState<string>(getModelJson);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyOk, setApplyOk] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const patternCount = useStore((s) => s.patterns.length);
  const songLen = useStore((s) => s.song.positions.length);

  useEffect(() => {
    if (dirtyRef.current) return;
    setText(getModelJson());
    setError(null);
  }, [patternCount, songLen]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    setDirty(true);
    setError(null);
    setApplyOk(false);
  }, []);

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

  function handleReset() {
    setText(getModelJson());
    setDirty(false);
    setError(null);
    setApplyOk(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    }
  }

  const lines = lineCount(text);

  return (
    <div className="script-editor__pane">
      <div className="script-editor__toolbar">
        <button className="btn script-editor__btn" type="button"
          disabled={!dirty} onClick={handleApply}
          title="Apply JSON to model (Ctrl+Enter)">
          ▶ APPLY
        </button>
        <button className="btn script-editor__btn" type="button"
          disabled={!dirty} onClick={handleReset}
          title="Discard edits">
          ↺ RESET
        </button>
        <span className={`script-editor__status${error ? ' is-error' : applyOk ? ' is-ok' : dirty ? ' is-dirty' : ''}`}>
          {error ? `⚠ ${error}` : applyOk ? '✓ Applied' : dirty ? '● Unsaved  (Ctrl+Enter to apply)' : '✓ In sync with model'}
        </span>
      </div>
      <div className="script-editor__code-wrap">
        <div className="script-editor__gutter" aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className="script-editor__line-num">{i + 1}</div>
          ))}
        </div>
        <textarea
          className="script-editor__code"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  AREXX EDITOR PANE
// ═══════════════════════════════════════════════════════════════════════════

function ARexxPane() {
  const [code, setCode] = useState<string>(AREXX_STARTER);
  const [output, setOutput] = useState<OutLine[]>([]);
  const [running, setRunning] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  function handleCodeChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setCode(e.target.value);
  }

  function handleRun() {
    if (running) return;
    setRunning(true);
    const dispatch = makeModeCatDispatcher();
    const newLines: OutLine[] = [{ kind: 'info', text: '— Run started —' }];

    const result = runARexx(code, {
      say: (msg) => newLines.push({ kind: 'say', text: msg }),
      dispatch,
    });

    if (result.error) {
      newLines.push({ kind: 'err', text: `ERROR: ${result.error}` });
    } else {
      newLines.push({ kind: 'ok', text: `— Done  RC=${result.rc} —` });
    }

    setOutput((prev) => [...prev, ...newLines]);
    setRunning(false);

    // Scroll output to bottom
    requestAnimationFrame(() => {
      if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
    });
  }

  function handleClear() {
    setOutput([]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleRun();
    }
  }

  const lines = lineCount(code);

  return (
    <div className="script-editor__pane script-editor__pane--arexx">
      {/* Toolbar */}
      <div className="script-editor__toolbar">
        <button className="btn script-editor__btn script-editor__btn--run"
          type="button" onClick={handleRun} disabled={running}
          title="Run ARexx script (Ctrl+Enter)">
          ▶ RUN
        </button>
        <button className="btn script-editor__btn" type="button"
          onClick={handleClear} title="Clear output console">
          ✕ CLEAR
        </button>
        <span className="script-editor__status">
          {running ? '⟳ Running…' : 'ADDRESS \'MODECAT\'  ·  Ctrl+Enter to run'}
        </span>
      </div>

      {/* Split: code editor top, output console bottom */}
      <div className="script-editor__arexx-split">

        {/* Code editor */}
        <div className="script-editor__code-wrap">
          <div className="script-editor__gutter" aria-hidden="true">
            {Array.from({ length: lines }, (_, i) => (
              <div key={i} className="script-editor__line-num">{i + 1}</div>
            ))}
          </div>
          <textarea
            className="script-editor__code script-editor__code--arexx"
            value={code}
            onChange={handleCodeChange}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>

        {/* Output console */}
        <div className="script-editor__console" ref={outputRef}>
          {output.length === 0
            ? <span className="script-editor__console-hint">Output will appear here after ▶ RUN</span>
            : output.map((line, i) => (
                <div key={i} className={`script-editor__console-line is-${line.kind}`}>
                  {line.text}
                </div>
              ))
          }
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  SCRIPT EDITOR (root)
// ═══════════════════════════════════════════════════════════════════════════

export function ScriptEditor() {
  const [activeTab, setActiveTab] = useState<Tab>('arexx');

  return (
    <div className="script-editor">

      {/* Tab bar */}
      <div className="script-editor__tabs">
        <button
          className={`script-editor__tab${activeTab === 'json' ? ' is-active' : ''}`}
          type="button"
          onClick={() => setActiveTab('json')}
        >
          JSON
        </button>
        <button
          className={`script-editor__tab${activeTab === 'arexx' ? ' is-active' : ''}`}
          type="button"
          onClick={() => setActiveTab('arexx')}
        >
          ARexx
        </button>
        <div className="script-editor__tabs-spacer" />
        <span className="script-editor__linecount">
          {activeTab === 'json' ? 'Song model  ·  full save format' : 'ARexx script  ·  ADDRESS \'MODECAT\''}
        </span>
      </div>

      {/* Active pane */}
      {activeTab === 'json' ? <JsonPane /> : <ARexxPane />}

    </div>
  );
}
