/**
 * SampleListEditor — directory-browser for batch sample loading.
 *
 * ModeCat #44: browse a folder of audio files, preview filenames, load
 * named files directly into instrument slots.
 *
 * Web implementation:
 *   • Primary:  File System Access API (showDirectoryPicker) — Chrome/Edge.
 *   • Fallback: <input type="file" webkitdirectory> — Firefox and all browsers.
 *
 * Supported formats: whatever the browser's AudioContext.decodeAudioData
 * accepts (WAV, AIFF, MP3, OGG, FLAC…). Shown only for common extensions.
 */

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { MAX_INSTRUMENTS, type SampleInstrument } from '../state/types';

// ── Audio file extensions we show ─────────────────────────────────────────

const AUDIO_EXTS = new Set([
  'wav', 'wave', 'aif', 'aiff', 'aifc',
  'mp3', 'ogg', 'oga', 'flac', 'opus', 'm4a', 'caf',
]);

function isAudio(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXTS.has(ext);
}

// ── PCM decode helper (same logic as SampleEditor) ────────────────────────

async function decodeFile(file: File): Promise<{ pcm: Float32Array; sampleRate: number }> {
  const buf = await file.arrayBuffer();
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const actx = new Ctor();
  try {
    const audio = await actx.decodeAudioData(buf.slice(0));
    const ch0 = audio.getChannelData(0);
    let pcm: Float32Array;
    if (audio.numberOfChannels > 1) {
      pcm = new Float32Array(ch0.length);
      const ch1 = audio.getChannelData(1);
      for (let i = 0; i < ch0.length; i++) {
        pcm[i] = (ch0[i]! + ch1[i]!) * 0.5;
      }
    } else {
      pcm = new Float32Array(ch0);
    }
    return { pcm, sampleRate: audio.sampleRate };
  } finally {
    actx.close();
  }
}

// ── File System Access API shim (type-safe narrow) ─────────────────────────

interface FSADir {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FSAEntry>;
}

interface FSAFile {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}

type FSAEntry = FSADir | FSAFile;

function hasFSA(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

async function pickDirectory(): Promise<FSADir | null> {
  try {
    const handle = await (
      window as unknown as { showDirectoryPicker(): Promise<FSADir> }
    ).showDirectoryPicker();
    return handle;
  } catch {
    return null; // user cancelled or not supported
  }
}

// ── Sorted file entry ──────────────────────────────────────────────────────

interface AudioEntry {
  name: string;
  /** Present when loaded via FSA; absent for <input> files. */
  handle?: FSAFile;
  /** Present for <input> files. */
  file?: File;
}

// ── Component ──────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export function SampleListEditor({ onClose }: Props) {
  const instruments    = useStore((s) => s.instruments);
  const setInstrument  = useStore((s) => s.setInstrument);
  const selectedInst   = useStore((s) => s.selectedInstrument);

  const [entries, setEntries]     = useState<AudioEntry[]>([]);
  const [dirName, setDirName]     = useState<string>('');
  const [loading, setLoading]     = useState(false);
  const [loadingEntry, setLoadingEntry] = useState<string | null>(null);
  const [targetSlot, setTargetSlot]    = useState(selectedInst);
  const [status, setStatus]            = useState<string>('');

  const fallbackRef = useRef<HTMLInputElement>(null);

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ── FSA directory picker ──────────────────────────────────────────────────

  async function openFsaDir() {
    setLoading(true);
    setStatus('');
    const dir = await pickDirectory();
    if (!dir) { setLoading(false); return; }
    setDirName(dir.name);
    const found: AudioEntry[] = [];
    for await (const entry of dir.values()) {
      if (entry.kind === 'file' && isAudio(entry.name)) {
        found.push({ name: entry.name, handle: entry as FSAFile });
      }
    }
    found.sort((a, b) => a.name.localeCompare(b.name));
    setEntries(found);
    setStatus(`${found.length} audio file${found.length !== 1 ? 's' : ''} found`);
    setLoading(false);
  }

  // ── Fallback: <input type="file" webkitdirectory> ────────────────────────

  function handleFallbackFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const found: AudioEntry[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      if (isAudio(f.name)) found.push({ name: f.name, file: f });
    }
    found.sort((a, b) => a.name.localeCompare(b.name));
    // Derive directory name from webkitRelativePath of first file.
    const rel = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
    setDirName(rel.split('/')[0] ?? 'folder');
    setEntries(found);
    setStatus(`${found.length} audio file${found.length !== 1 ? 's' : ''} found`);
  }

  // ── Load a file into the target instrument slot ───────────────────────────

  async function loadIntoSlot(entry: AudioEntry, slot: number) {
    if (slot < 1 || slot >= MAX_INSTRUMENTS) return;
    setLoadingEntry(entry.name);
    setStatus(`Loading ${entry.name}…`);
    try {
      let file: File;
      if (entry.file) {
        file = entry.file;
      } else if (entry.handle) {
        file = await entry.handle.getFile();
      } else {
        return;
      }
      const { pcm, sampleRate } = await decodeFile(file);
      const name = entry.name.replace(/\.[^.]+$/, '').slice(0, 20);
      const existing = instruments[slot];
      const base: SampleInstrument = {
        kind: 'sample',
        name,
        pcm,
        sampleRate,
        baseNote: 60,
        loopEnabled: false,
        loopStart: 0,
        loopEnd: 0,
        volume: 100,
        transpose: existing && existing.kind !== 'empty' ? (existing as SampleInstrument).transpose ?? 0 : 0,
        finetune: existing && existing.kind !== 'empty' ? (existing as SampleInstrument).finetune ?? 0 : 0,
        defaultPitch: 60,
        suppressNoteOff: false,
        attackMs: 5, decayMs: 0, sustain: 1, releaseMs: 110, lengthRows: 0,
      };
      setInstrument(slot, base);
      setStatus(`✓ Loaded "${name}" → slot ${slot.toString(16).toUpperCase().padStart(2,'0')}`);
      // Advance target slot for quick multi-loading.
      setTargetSlot((s) => Math.min(MAX_INSTRUMENTS - 1, s + 1));
    } catch (err) {
      setStatus(`✗ Failed to decode ${entry.name}: ${String(err)}`);
    } finally {
      setLoadingEntry(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="ip-backdrop" onMouseDown={onClose}>
      <div className="ip-dialog sle-dialog" onMouseDown={(e) => e.stopPropagation()}>

        <div className="ip-titlebar">
          <span>Sample List Editor{dirName ? ` — ${dirName}` : ''}</span>
          <button className="ip-close" type="button" onClick={onClose}>✕</button>
        </div>

        <div className="ip-body sle-body">

          {/* ── Toolbar ────────────────────────────────────────────────────── */}
          <div className="sle-toolbar">
            {hasFSA() ? (
              <button
                className="btn"
                type="button"
                onClick={openFsaDir}
                disabled={loading}
                title="Open a directory and list all audio files inside"
              >
                {loading ? 'Loading…' : 'Open Dir…'}
              </button>
            ) : (
              /* Fallback for Firefox: hidden <input webkitdirectory> */
              <label className="btn" title="Select a folder to scan for audio files">
                Open Dir…
                <input
                  ref={fallbackRef}
                  type="file"
                  // @ts-ignore — non-standard but widely supported
                  webkitdirectory=""
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFallbackFiles}
                />
              </label>
            )}

            <span className="sle-status">{status}</span>

            <label className="sle-slot-label" title="Target instrument slot — files are loaded here; auto-advances after each load">
              → Slot
              <input
                type="number"
                min={1}
                max={MAX_INSTRUMENTS - 1}
                value={targetSlot}
                onChange={(e) =>
                  setTargetSlot(Math.max(1, Math.min(MAX_INSTRUMENTS - 1, Number(e.target.value))))
                }
                className="sle-slot-input"
              />
            </label>
          </div>

          {/* ── File list ──────────────────────────────────────────────────── */}
          {entries.length === 0 ? (
            <p className="sle-empty">
              {dirName ? 'No audio files found in the selected folder.' : 'Open a directory to list audio files.'}
            </p>
          ) : (
            <div className="sle-list">
              <div className="sle-list-hdr">
                <span>File</span>
                <span>Action</span>
              </div>
              {entries.map((entry) => {
                const busy = loadingEntry === entry.name;
                return (
                  <div key={entry.name} className="sle-list-row">
                    <span className="sle-list-name" title={entry.name}>
                      {entry.name}
                    </span>
                    <button
                      className="btn sle-load-btn"
                      type="button"
                      disabled={busy || loadingEntry !== null}
                      onClick={() => loadIntoSlot(entry, targetSlot)}
                      title={`Load into slot ${targetSlot.toString(16).toUpperCase().padStart(2,'0')}`}
                    >
                      {busy ? '…' : `→ ${targetSlot.toString(16).toUpperCase().padStart(2,'0')}`}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="ip-footer">
          <button className="btn" type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
