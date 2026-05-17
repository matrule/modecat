/**
 * SampleLibrary — Amiga-style sample library viewer MDI window.
 *
 * Left panel  — category tree
 *   • BUILT-IN — DRUMS  (kits from DRUM_KITS)
 *   • MY LIBRARY        (folder scan + MOD/XM file extraction)
 *
 * Right panel — file list
 *   filename | voice/role | KB | ▶/■ (playing indicator)
 *
 * Click      → preview (click again to stop)
 * Double-click / LOAD → decode + store in target instrument slot, advance slot
 * Arrow keys navigate the file list; Space previews; Enter loads.
 *
 * State persistence: sections & userLibRoot survive MDI close/reopen via
 * module-level variables (same page session — not persisted to disk).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DRUM_KITS } from '../data/drumkits';
import { parseTrackerFile } from '../engine/modParser';
import { useStore } from '../state/store';
import { MAX_INSTRUMENTS, type SampleInstrument } from '../state/types';

// ── Audio helpers ─────────────────────────────────────────────────────────────

let _previewCtx: AudioContext | null = null;
let _previewNode: AudioBufferSourceNode | null = null;

function getPreviewCtx(): AudioContext {
  if (!_previewCtx || _previewCtx.state === 'closed') {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    _previewCtx = new Ctor();
  }
  return _previewCtx;
}

function stopPreview() {
  try { _previewNode?.stop(); } catch { /* already stopped */ }
  _previewNode = null;
}

/**
 * Play a buffer. onEnd is called when playback finishes naturally
 * (not when stopped manually — caller handles that case).
 */
async function playPreview(buffer: AudioBuffer, onEnd: () => void): Promise<void> {
  stopPreview();
  const ctx = getPreviewCtx();
  if (ctx.state === 'suspended') await ctx.resume();
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.connect(ctx.destination);
  node.start();
  node.onended = () => { _previewNode = null; onEnd(); };
  _previewNode = node;
}

// ── Decode helpers ────────────────────────────────────────────────────────────

async function decodeUrl(url: string): Promise<AudioBuffer | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const ctx = getPreviewCtx();
    return await ctx.decodeAudioData(await resp.arrayBuffer());
  } catch { return null; }
}

async function decodeFile(file: File): Promise<AudioBuffer | null> {
  try {
    const ctx = getPreviewCtx();
    return await ctx.decodeAudioData(await file.arrayBuffer());
  } catch { return null; }
}

/** Build an AudioBuffer directly from a pre-decoded Float32Array (for MOD/XM samples). */
function pcmToAudioBuffer(pcm: Float32Array, sampleRate: number): AudioBuffer {
  const ctx = getPreviewCtx();
  const buf = ctx.createBuffer(1, pcm.length, sampleRate);
  // copyToChannel needs Float32Array<ArrayBuffer> — copy via a guaranteed plain ArrayBuffer
  const plain = new ArrayBuffer(pcm.byteLength);
  new Float32Array(plain).set(pcm);
  buf.copyToChannel(new Float32Array(plain), 0);
  return buf;
}

function bufferToMono(buf: AudioBuffer): Float32Array {
  const len = buf.length;
  const mono = new Float32Array(len);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += data[i]!;
  }
  if (buf.numberOfChannels > 1) {
    const inv = 1 / buf.numberOfChannels;
    for (let i = 0; i < len; i++) mono[i] *= inv;
  }
  return mono;
}

// ── FSA types ─────────────────────────────────────────────────────────────────

interface FSAFile {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}

interface FSADir {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<FSAFile | FSADir>;
}

function hasFSA(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

async function pickDirectory(): Promise<FSADir | null> {
  try {
    return await (window as unknown as { showDirectoryPicker(): Promise<FSADir> }).showDirectoryPicker();
  } catch { return null; }
}

// ── Audio extensions ──────────────────────────────────────────────────────────

const AUDIO_EXTS = new Set(['wav', 'wave', 'aif', 'aiff', 'aifc', 'mp3', 'ogg', 'oga', 'flac', 'opus', 'm4a', 'caf']);

function isAudio(name: string): boolean {
  return AUDIO_EXTS.has(name.split('.').pop()?.toLowerCase() ?? '');
}

function fmtKb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ── Data model ────────────────────────────────────────────────────────────────

interface FileEntry {
  name: string;
  /** Voice role label (e.g. "BASS DRUM") — built-in kits only */
  role: string;
  /** File size for display (bytes) */
  sizeBytes?: number;
  /** For built-in samples: URL to fetch + decode */
  url?: string;
  /** For user-library samples: File object */
  file?: File;
  /** For MOD/XM samples: pre-decoded PCM (avoids re-parsing on every preview) */
  pcm?: Float32Array;
  /** Sample rate for pcm data (MOD/XM: 8363 Hz) */
  sampleRateHint?: number;
  /**
   * XM relative note — semitone offset to apply as instrument transpose.
   * Positive = sample was recorded above C-5, needs pitch-up to sound correct.
   */
  relativeNote?: number;
  /** Finetune from MOD/XM header (passed through to instrument finetune). */
  finetune?: number;
}

interface Category {
  id: string;
  label: string;
  credit?: string;
  files: FileEntry[];
  sizesLoading?: boolean;
}

interface Section {
  id: string;
  label: string;
  categories: Category[];
  collapsed?: boolean;
}

// ── Decode any FileEntry into an AudioBuffer ──────────────────────────────────

async function decodeEntry(entry: FileEntry): Promise<AudioBuffer | null> {
  if (entry.pcm) return pcmToAudioBuffer(entry.pcm, entry.sampleRateHint ?? 8363);
  if (entry.url)  return decodeUrl(entry.url);
  if (entry.file) return decodeFile(entry.file);
  return null;
}

// ── Module-level persistent state ─────────────────────────────────────────────
// Survives MDI close/reopen within the same browser session (not persisted to disk).
// File and Float32Array objects cannot go in localStorage, so we keep them in memory.

let _libSections: Section[] | null = null;
let _libUserLibRoot = '';

function buildBuiltinSection(): Section[] {
  const cats: Category[] = DRUM_KITS.map((kit) => ({
    id: `builtin-${kit.id}`,
    label: kit.name,
    credit: kit.credit,
    files: kit.voices.map((v) => ({
      name: v.sampleUrl.split('/').pop() ?? v.name,
      role: v.name,
      url: v.sampleUrl,
    })),
  }));
  return [
    { id: 'builtin', label: 'BUILT-IN — DRUMS', categories: cats, collapsed: false },
    { id: 'user',    label: 'MY LIBRARY',        categories: [],   collapsed: false },
  ];
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export function SampleBrowser({ onClose }: Props) {
  const instruments   = useStore((s) => s.instruments);
  const setInstrument = useStore((s) => s.setInstrument);
  const selectedInst  = useStore((s) => s.selectedInstrument);

  const [targetSlot, setTargetSlot] = useState(selectedInst);
  const [status, setStatus]         = useState('');

  // ── Tree state — initialised from module-level persisted vars ─────────────

  const [sections, setSections]     = useState<Section[]>(() => _libSections ?? buildBuiltinSection());
  const [userLibRoot, setUserLibRoot] = useState(_libUserLibRoot);

  const [activeCatId, setActiveCatId]     = useState<string | null>(null);
  const [activeFileIdx, setActiveFileIdx] = useState<number>(0);

  /**
   * Name of the sample currently playing audio.
   * null when nothing is playing (or playback has ended naturally).
   */
  const [playingName, setPlayingName] = useState<string | null>(null);
  const [loadingName, setLoadingName] = useState<string | null>(null);

  const previewCache = useRef<Map<string, AudioBuffer | null>>(new Map());
  const listRef      = useRef<HTMLDivElement>(null);

  // ── Sync state back to module-level vars whenever it changes ─────────────

  useEffect(() => { _libSections    = sections;    }, [sections]);
  useEffect(() => { _libUserLibRoot = userLibRoot; }, [userLibRoot]);

  // ── User library: folder scan ─────────────────────────────────────────────

  async function openUserLibrary() {
    const dir = await pickDirectory();
    if (!dir) return;
    setUserLibRoot(dir.name);
    setStatus(`Scanning ${dir.name}…`);

    const cats: Category[] = [];
    const rootFiles: FileEntry[] = [];

    for await (const entry of dir.values()) {
      if (entry.kind === 'file' && isAudio(entry.name)) {
        const file = await (entry as FSAFile).getFile();
        rootFiles.push({ name: entry.name, role: '', sizeBytes: file.size, file });
      } else if (entry.kind === 'directory') {
        const sub = entry as FSADir;
        const subFiles: FileEntry[] = [];
        for await (const subEntry of sub.values()) {
          if (subEntry.kind === 'file' && isAudio(subEntry.name)) {
            const file = await (subEntry as FSAFile).getFile();
            subFiles.push({ name: subEntry.name, role: '', sizeBytes: file.size, file });
          }
        }
        if (subFiles.length > 0) {
          subFiles.sort((a, b) => a.name.localeCompare(b.name));
          cats.push({ id: `user-${sub.name}`, label: sub.name, files: subFiles });
        }
      }
    }

    if (rootFiles.length > 0) {
      rootFiles.sort((a, b) => a.name.localeCompare(b.name));
      cats.unshift({ id: 'user-root', label: `${dir.name} (root)`, files: rootFiles });
    }

    setSections((prev) => prev.map((s) =>
      s.id === 'user' ? { ...s, categories: [...getUserModCats(s), ...cats] } : s
    ));

    const total = cats.reduce((n, c) => n + c.files.length, 0);
    setStatus(`${dir.name}: ${cats.length} folder${cats.length !== 1 ? 's' : ''}, ${total} files`);
  }

  // Fallback: <input webkitdirectory> for Firefox
  const fallbackRef = useRef<HTMLInputElement>(null);
  function handleFallbackFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const byFolder = new Map<string, FileEntry[]>();
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      if (!isAudio(f.name)) continue;
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
      const parts = rel.split('/');
      const folder = parts.length >= 3 ? (parts[1] ?? 'root') : 'root';
      if (!byFolder.has(folder)) byFolder.set(folder, []);
      byFolder.get(folder)!.push({ name: f.name, role: '', sizeBytes: f.size, file: f });
    }

    const rootName = ((files[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? '').split('/')[0] ?? 'folder';
    setUserLibRoot(rootName);

    const cats: Category[] = [];
    byFolder.forEach((fEntries, folder) => {
      fEntries.sort((a, b) => a.name.localeCompare(b.name));
      cats.push({ id: `user-${folder}`, label: folder, files: fEntries });
    });
    cats.sort((a, b) => a.label.localeCompare(b.label));

    setSections((prev) => prev.map((s) =>
      s.id === 'user' ? { ...s, categories: [...getUserModCats(s), ...cats] } : s
    ));

    const total = cats.reduce((n, c) => n + c.files.length, 0);
    setStatus(`${rootName}: ${cats.length} folders, ${total} files`);
  }

  /** Keep MOD/XM categories when replacing folder categories. */
  function getUserModCats(sec: Section): Category[] {
    return sec.categories.filter((c) => c.id.startsWith('mod-'));
  }

  // ── User library: MOD/XM file ─────────────────────────────────────────────

  const modInputRef = useRef<HTMLInputElement>(null);

  async function handleModFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';   // allow re-selecting the same file

    setStatus(`Parsing ${file.name}…`);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseTrackerFile(buffer);
      if (!parsed) {
        setStatus(`✗ ${file.name} — unrecognised format (need MOD or XM)`);
        return;
      }

      const nonEmpty = parsed.samples.filter((s) => s.pcm.length > 0);
      if (nonEmpty.length === 0) {
        setStatus(`✗ ${file.name} — no samples found`);
        return;
      }

      const catId = `mod-${file.name}`;
      const moduleName = parsed.title || file.name.replace(/\.[^.]+$/, '');
      const catLabel = `${parsed.format}: ${moduleName}`;

      const files: FileEntry[] = nonEmpty.map((s, i) => ({
        name:           s.name || `Sample ${i + 1}`,
        role:           '',
        sizeBytes:      s.pcm.length * 4,    // Float32 bytes
        pcm:            s.pcm,
        sampleRateHint: s.sampleRate,
        relativeNote:   s.relativeNote,
        finetune:       s.finetune,
      }));

      const newCat: Category = { id: catId, label: catLabel, credit: `${parsed.channels}ch ${parsed.format}`, files };

      setSections((prev) => prev.map((sec) => {
        if (sec.id !== 'user') return sec;
        const existing = sec.categories.find((c) => c.id === catId);
        if (existing) {
          return { ...sec, categories: sec.categories.map((c) => c.id === catId ? newCat : c) };
        }
        return { ...sec, categories: [...sec.categories, newCat] };
      }));

      setStatus(`${catLabel}: ${files.length} sample${files.length !== 1 ? 's' : ''}`);
    } catch (err) {
      setStatus(`✗ Failed to parse ${file.name}: ${String(err)}`);
    }
  }

  // ── Lazy size loading for built-in files ──────────────────────────────────

  function loadSizesForCat(catId: string) {
    setSections((prev) => prev.map((sec) => ({
      ...sec,
      categories: sec.categories.map((cat) => {
        if (cat.id !== catId) return cat;
        if (cat.sizesLoading || cat.files.every((f) => f.sizeBytes !== undefined)) return cat;
        const updatedCat = { ...cat, sizesLoading: true };
        Promise.all(
          cat.files.map(async (f) => {
            if (f.url && f.sizeBytes === undefined) {
              try {
                const resp = await fetch(f.url, { method: 'HEAD' });
                const cl = resp.headers.get('content-length');
                return { name: f.name, sizeBytes: cl ? parseInt(cl, 10) : undefined };
              } catch { return { name: f.name, sizeBytes: undefined }; }
            }
            return { name: f.name, sizeBytes: f.sizeBytes };
          })
        ).then((results) => {
          const sizeMap = new Map(results.map((r) => [r.name, r.sizeBytes]));
          setSections((p) => p.map((sec) => ({
            ...sec,
            categories: sec.categories.map((c) => {
              if (c.id !== catId) return c;
              return { ...c, sizesLoading: false, files: c.files.map((f) => ({ ...f, sizeBytes: sizeMap.get(f.name) ?? f.sizeBytes })) };
            }),
          })));
        });
        return updatedCat;
      }),
    })));
  }

  // ── Category selection ────────────────────────────────────────────────────

  function selectCategory(cat: Category) {
    stopPreview();
    setPlayingName(null);
    setActiveCatId(cat.id);
    setActiveFileIdx(0);
    if (cat.files[0]?.url) loadSizesForCat(cat.id);
    setTimeout(() => listRef.current?.focus(), 50);
  }

  // ── Preview — click toggles; clicking a different sample auto-stops ───────

  const previewEntry = useCallback(async (entry: FileEntry, toggle = false) => {
    const key = entry.url ?? (entry.pcm ? `pcm-${entry.name}` : entry.name);

    // Toggle off if already playing this entry
    if (toggle && entry.name === playingName) {
      stopPreview();
      setPlayingName(null);
      return;
    }

    // Stop whatever was playing (different entry)
    stopPreview();
    setPlayingName(entry.name);

    let buf = previewCache.current.get(key);
    if (buf === undefined) {
      buf = await decodeEntry(entry);
      previewCache.current.set(key, buf);
    }
    if (buf) {
      await playPreview(buf, () => setPlayingName(null));
    } else {
      setPlayingName(null);
    }
  }, [playingName]);

  // ── Load into slot ────────────────────────────────────────────────────────

  const loadEntry = useCallback(async (entry: FileEntry, slot: number) => {
    if (slot < 1 || slot >= MAX_INSTRUMENTS) return;
    setLoadingName(entry.name);
    setStatus(`Loading ${entry.name}…`);

    try {
      const key = entry.url ?? (entry.pcm ? `pcm-${entry.name}` : entry.name);
      let audioBuf = previewCache.current.get(key);
      if (!audioBuf) {
        audioBuf = await decodeEntry(entry);
        if (audioBuf) previewCache.current.set(key, audioBuf);
      }
      if (!audioBuf) { setStatus(`✗ Could not decode ${entry.name}`); return; }

      const sampleRate = audioBuf.sampleRate;
      const pcm = entry.pcm && audioBuf.numberOfChannels === 1
        ? entry.pcm      // MOD/XM: already mono Float32Array
        : bufferToMono(audioBuf);

      const name = (entry.role || entry.name.replace(/\.[^.]+$/, '')).slice(0, 20);

      const inst: SampleInstrument = {
        kind: 'sample',
        name,
        pcm,
        sampleRate,
        baseNote: 60,
        loopEnabled: false,
        loopStart: 0,
        loopEnd: 0,
        volume: 100,
        // Apply MOD/XM tuning metadata; fall back to 0 for plain wav/folder files
        transpose:         entry.relativeNote ?? 0,
        finetune:          entry.finetune     ?? 0,
        defaultPitch: 60,
        suppressNoteOff: false,
        attackMs: 0, decayMs: 0, sustain: 1, releaseMs: 30, lengthRows: 0,
      };

      setInstrument(slot, inst);
      setStatus(`✓ "${name}" → slot ${slot.toString(16).toUpperCase().padStart(2, '0')}`);
      setTargetSlot((s) => Math.min(MAX_INSTRUMENTS - 1, s + 1));
    } catch (err) {
      setStatus(`✗ Failed: ${String(err)}`);
    } finally {
      setLoadingName(null);
    }
  }, [instruments, setInstrument]);

  // ── Keyboard navigation ───────────────────────────────────────────────────

  const activeCategory = sections.flatMap((s) => s.categories).find((c) => c.id === activeCatId) ?? null;
  const activeFiles    = activeCategory?.files ?? [];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { onClose(); return; }
      if (document.activeElement !== listRef.current) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveFileIdx((i) => Math.min(activeFiles.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveFileIdx((i) => Math.max(0, i - 1));
      } else if (e.key === ' ') {
        e.preventDefault();
        const f = activeFiles[activeFileIdx];
        if (f) previewEntry(f, true);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const f = activeFiles[activeFileIdx];
        if (f) loadEntry(f, targetSlot);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, activeFiles, activeFileIdx, previewEntry, loadEntry, targetSlot]);

  // Auto-preview on keyboard navigation (no toggle — always play on nav)
  useEffect(() => {
    const f = activeFiles[activeFileIdx];
    if (f && document.activeElement === listRef.current) previewEntry(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFileIdx]);

  // Scroll active row into view
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    rowRefs.current[activeFileIdx]?.scrollIntoView({ block: 'nearest' });
  }, [activeFileIdx]);

  function toggleSection(secId: string) {
    setSections((prev) => prev.map((s) => s.id === secId ? { ...s, collapsed: !s.collapsed } : s));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="sb-root">

      {/* ── Left: category tree ──────────────────────────────────────────── */}
      <div className="sb-tree">
        {sections.map((sec) => (
          <div key={sec.id} className="sb-section">
            <button className="sb-section-hdr" type="button" onClick={() => toggleSection(sec.id)}>
              <span className="sb-section-arrow">{sec.collapsed ? '▶' : '▼'}</span>
              {sec.label}
            </button>

            {!sec.collapsed && (
              <>
                {sec.id === 'user' && (
                  <div className="sb-tree-action">
                    {hasFSA() ? (
                      <button className="btn sb-open-btn" type="button" onClick={openUserLibrary}>
                        {userLibRoot ? `↺ ${userLibRoot}` : 'Open Folder…'}
                      </button>
                    ) : (
                      <label className="btn sb-open-btn">
                        {userLibRoot ? `↺ ${userLibRoot}` : 'Open Folder…'}
                        <input ref={fallbackRef} type="file"
                          // @ts-ignore
                          webkitdirectory="" multiple style={{ display: 'none' }}
                          onChange={handleFallbackFiles} />
                      </label>
                    )}

                    {/* MOD/XM file picker */}
                    <label className="btn sb-open-btn" title="Extract samples from a MOD or XM tracker file">
                      Open MOD…
                      <input ref={modInputRef} type="file"
                        accept=".mod,.MOD,.xm,.XM,.s3m,.S3M,.it,.IT"
                        style={{ display: 'none' }}
                        onChange={handleModFile} />
                    </label>

                    {sec.categories.length === 0 && userLibRoot === '' && (
                      <span className="sb-tree-hint">open a folder or MOD file</span>
                    )}
                  </div>
                )}

                {sec.categories.map((cat) => (
                  <button
                    key={cat.id}
                    className={`sb-cat-item${activeCatId === cat.id ? ' is-active' : ''}`}
                    type="button"
                    onClick={() => selectCategory(cat)}
                    title={cat.credit}
                  >
                    <span className="sb-cat-name">{cat.label}</span>
                    <span className="sb-cat-count">{cat.files.length}</span>
                  </button>
                ))}

                {sec.id === 'user' && sec.categories.length === 0 && userLibRoot !== '' && (
                  <div className="sb-tree-hint">no audio files found</div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {/* ── Right: file list ─────────────────────────────────────────────── */}
      <div className="sb-panel">

        {/* Toolbar */}
        <div className="sb-toolbar">
          <span className="sb-status">
            {status || (activeCategory ? activeCategory.label : 'Select a category')}
          </span>

          <label className="sb-slot-label" title="Target instrument slot">
            → Slot
            <input
              type="number"
              min={1}
              max={MAX_INSTRUMENTS - 1}
              value={targetSlot}
              onChange={(e) => setTargetSlot(Math.max(1, Math.min(MAX_INSTRUMENTS - 1, Number(e.target.value))))}
              className="sb-slot-input"
            />
          </label>

          <button
            className="btn"
            type="button"
            disabled={activeFiles[activeFileIdx] === undefined || loadingName !== null}
            onClick={() => { const f = activeFiles[activeFileIdx]; if (f) loadEntry(f, targetSlot); }}
          >
            {loadingName ? '…' : 'LOAD'}
          </button>
        </div>

        {/* Column headers */}
        {activeFiles.length > 0 && (
          <div className="sb-list-hdr">
            <span className="sb-col-name">Filename</span>
            <span className="sb-col-role">Voice</span>
            <span className="sb-col-size">Size</span>
            <span className="sb-col-play"> </span>
          </div>
        )}

        {/* File rows */}
        <div className="sb-list" ref={listRef} tabIndex={0} aria-label="Sample files">
          {activeFiles.length === 0 ? (
            <div className="sb-empty">
              {activeCategory ? 'No audio files in this category.' : 'Select a category from the left panel.'}
            </div>
          ) : (
            activeFiles.map((entry, idx) => {
              const isActive    = idx === activeFileIdx;
              const isPlaying   = entry.name === playingName;
              const isLoading   = entry.name === loadingName;
              return (
                <div
                  key={`${entry.name}-${idx}`}
                  ref={(el) => { rowRefs.current[idx] = el; }}
                  className={`sb-row${isActive ? ' is-selected' : ''}${idx % 2 === 0 ? ' is-even' : ''}`}
                  onClick={() => {
                    setActiveFileIdx(idx);
                    previewEntry(entry, true);   // toggle: click same → stop, different → play
                    listRef.current?.focus();
                  }}
                  onDoubleClick={() => loadEntry(entry, targetSlot)}
                  role="option"
                  aria-selected={isActive}
                >
                  <span className="sb-col-name" title={entry.name}>{entry.name}</span>
                  <span className="sb-col-role" title={entry.role}>{entry.role}</span>
                  <span className="sb-col-size">
                    {entry.sizeBytes !== undefined ? fmtKb(entry.sizeBytes) : '…'}
                  </span>
                  <span className={`sb-col-play${isPlaying ? ' is-playing' : ''}`}>
                    {isLoading ? '↑' : isPlaying ? '■' : '▶'}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="sb-footer-hint">
          click = play/stop · dbl-click = load · ↑↓ navigate · space = play/stop · enter = load
        </div>
      </div>
    </div>
  );
}
