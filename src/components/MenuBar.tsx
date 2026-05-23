/**
 * MenuBar — ModeCat V5-style Amiga dropdown menu bar.
 *
 * Menus: Project | Display | Song | Block | Track | Edit | Instrument | MIDI | Settings
 *
 * Each item either calls a store action directly, triggers a persist helper,
 * or is stubbed with a TODO comment where the target feature (#52+) is not
 * yet built.
 *
 * Keyboard: clicking a menu title opens its dropdown; clicking outside or
 * pressing Escape closes it. Arrow keys navigate items within an open menu.
 */

import { useEffect, useRef, useState } from 'react';
import { useWbDialog } from './WbDialog';
import { useStore } from '../state/store';
import { downloadSong, exportSongFile, importSongFile, loadSongFromFile, saveInstrumentFile, saveAllInstrumentsFile, parseInstrumentFile } from '../state/persist';
import type { InstrumentFileEntry } from '../state/persist';
import { InstrumentLoadDialog } from './InstrumentLoadDialog';
import modecatLogo from '../assets/modecat.jpeg';
import cloud from '../lib/cloud';
import type { User } from '@supabase/supabase-js';
import { CloudProjectsDialog } from './CloudProjectsDialog';

// ─── Types ───────────────────────────────────────────────────────────────────

type Separator = { kind: 'sep' };
type Item = {
  kind?: 'item';
  label: string;
  /** Called when item is activated. */
  action?: () => void;
  /** Shown greyed when true. */
  disabled?: boolean;
  /** Shown with a check mark when true. */
  checked?: boolean;
  /** Keyboard shortcut hint shown on the right. */
  shortcut?: string;
};
type MenuEntry = Item | Separator;

interface MenuDef {
  title: string;
  items: MenuEntry[];
}

// ─── Environment detection ────────────────────────────────────────────────────

interface EnvInfo {
  os: string;
  browser: string;
  processor: string;
  cores: string;
  ram: string;
}

// Extended navigator types for non-standard / draft APIs
interface NavigatorExt extends Navigator {
  userAgentData?: {
    platform?: string;
    getHighEntropyValues?: (hints: string[]) => Promise<{
      architecture?: string;
      bitness?: string;
      platform?: string;
    }>;
  };
  deviceMemory?: number;
}

function detectOsAndBrowser(): Pick<EnvInfo, 'os' | 'browser'> {
  const ua = navigator.userAgent;
  const nav = navigator as NavigatorExt;
  const plat = nav.userAgentData?.platform ?? navigator.platform ?? '';

  let os = 'Unknown OS';
  if (/win/i.test(plat))              os = 'Windows';
  else if (/mac/i.test(plat))         os = 'macOS';
  else if (/linux/i.test(plat))       os = 'Linux';
  else if (/android/i.test(ua))       os = 'Android';
  else if (/iphone|ipad/i.test(ua))   os = 'iOS';
  if (os === 'Windows') {
    const m = ua.match(/Windows NT (\d+\.\d+)/);
    const ver: Record<string, string> = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
    if (m) os = `Windows ${ver[m[1]] ?? m[1]}`;
  }

  let browser = 'Unknown';
  if (/Edg\//i.test(ua))          browser = `Edge ${ua.match(/Edg\/([\d.]+)/i)?.[1] ?? ''}`;
  else if (/OPR\//i.test(ua))     browser = `Opera ${ua.match(/OPR\/([\d.]+)/i)?.[1] ?? ''}`;
  else if (/Chrome\//i.test(ua))  browser = `Chrome ${ua.match(/Chrome\/([\d.]+)/i)?.[1] ?? ''}`;
  else if (/Firefox\//i.test(ua)) browser = `Firefox ${ua.match(/Firefox\/([\d.]+)/i)?.[1] ?? ''}`;
  else if (/Safari\//i.test(ua))  browser = `Safari ${ua.match(/Version\/([\d.]+)/i)?.[1] ?? ''}`;

  return { os, browser };
}

/**
 * Async: uses the high-entropy UA client hints API (Chrome/Edge) to identify
 * the processor architecture.  Falls back to UA sniffing on other browsers.
 *
 * The browser never exposes an exact model name (M1 vs M2 etc.) but it does
 * expose architecture + platform, which is enough to say "Apple Silicon".
 */
async function detectProcessor(os: string): Promise<string> {
  const nav = navigator as NavigatorExt;

  // Try high-entropy hints first (Chrome 90+, Edge)
  if (typeof nav.userAgentData?.getHighEntropyValues === 'function') {
    try {
      const hints = await nav.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'platform']);
      const arch    = hints.architecture ?? '';
      const bitness = hints.bitness ?? '';
      const plat    = hints.platform ?? os;

      if (/arm/i.test(arch)) {
        if (/mac/i.test(plat)) return 'Apple Silicon';
        if (/win/i.test(plat)) return `ARM${bitness === '64' ? '64' : ''} (Snapdragon)`;
        return `ARM${bitness === '64' ? '64' : ''}`;
      }
      if (/x86/i.test(arch)) {
        if (/mac/i.test(plat)) return `Intel (x86${bitness === '64' ? '_64' : ''})`;
        return `x86${bitness === '64' ? '_64' : ''}`;
      }
    } catch {
      // permission denied or not supported — fall through
    }
  }

  // Firefox / Safari fallback: infer from UA + platform
  const ua = navigator.userAgent;
  if (/mac/i.test(os)) {
    // Apple Silicon Macs running native browsers report "arm" or "aarch64" in
    // some UA strings; Intel Macs say "Intel" explicitly.
    if (/intel/i.test(ua)) return 'Intel';
    // No way to distinguish M1/M2/M3 without high-entropy hints
    return 'Apple Silicon (likely)';
  }
  if (/win/i.test(os)) return 'x86_64';
  if (/linux/i.test(os)) {
    if (/aarch64|arm/i.test(ua)) return 'ARM64';
    return 'x86_64';
  }
  return 'Unknown';
}

function detectEnvSync(): Omit<EnvInfo, 'processor'> {
  const { os, browser } = detectOsAndBrowser();
  const nav = navigator as NavigatorExt;
  const cores = navigator.hardwareConcurrency
    ? `${navigator.hardwareConcurrency} logical cores`
    : 'Unknown';
  const ram = nav.deviceMemory != null ? `≈${nav.deviceMemory} GB` : 'Unknown';
  return { os, browser, cores, ram };
}

// ─── About dialog ────────────────────────────────────────────────────────────

function AboutDialog({ onClose }: { onClose: () => void }) {
  const [env, setEnv] = useState<EnvInfo>(() => ({
    ...detectEnvSync(),
    processor: '…',
  }));

  useEffect(() => {
    detectProcessor(env.os).then((processor) =>
      setEnv((prev) => ({ ...prev, processor }))
    );
  // env.os is stable after first render — no need to re-run
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'Enter') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="about-backdrop" onMouseDown={onClose}>
      <div className="about-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <img src={modecatLogo} alt="ModeCat Pro — Retro Tracker Music" className="about-logo" />
        <div className="about-body">
          <div className="about-version">ModeCat Pro · V1.0.0</div>
          <div className="about-sub">© 1991–2026 Neutron Jr. All rights reserved.</div>

          <div className="about-divider" />

          <div className="about-section-label">ORIGINAL SOFTWARE</div>
          <div className="about-credit-row">
            <span className="about-credit-name">OctaMED</span>
            <span className="about-credit-role">Teijo Kinnunen &amp; Ray Burt-Frost</span>
          </div>

          <div className="about-divider" />

          <div className="about-section-label">INSPIRATION</div>
          <div className="about-credit-row">
            <span className="about-credit-name">Bizzy B</span>
            <span className="about-credit-role">Drum &amp; Bass pioneer</span>
          </div>
          <div className="about-credit-row">
            <span className="about-credit-name">Liam Howlett</span>
            <span className="about-credit-role">The Prodigy</span>
          </div>
          <div className="about-credit-row">
            <span className="about-credit-name">Jay Miner</span>
            <span className="about-credit-role">Father of the Amiga</span>
          </div>

          <div className="about-divider" />

          <div className="about-section-label">SYSTEM</div>
          <div className="about-credit-row">
            <span className="about-credit-name">OS</span>
            <span className="about-credit-role">{env.os}</span>
          </div>
          <div className="about-credit-row">
            <span className="about-credit-name">Processor</span>
            <span className="about-credit-role">{env.processor}</span>
          </div>
          <div className="about-credit-row">
            <span className="about-credit-name">CPU cores</span>
            <span className="about-credit-role">{env.cores}</span>
          </div>
          <div className="about-credit-row">
            <span className="about-credit-name">RAM</span>
            <span className="about-credit-role">{env.ram}</span>
          </div>
          <div className="about-credit-row">
            <span className="about-credit-name">Browser</span>
            <span className="about-credit-role">{env.browser}</span>
          </div>

          <div className="about-divider" />

          <div className="about-sub about-tech">React · Web Audio API · WebSocket MIDI bridge</div>
        </div>
        <button className="btn about-ok" type="button" onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}

// ─── MenuBar ─────────────────────────────────────────────────────────────────

interface MenuBarProps {
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onProgKeys?: () => void;
  onSongOptions?: () => void;
  onBlockProps?: () => void;
  onMidiMessages?: () => void;
  onMidiImport?: () => void;
  onModImport?: () => void;
  onSampleList?: () => void;
  onInsertLine?: () => void;
  onDeleteLine?: () => void;
  onFlushCurrent?: () => void;
  onFlushUnused?: () => void;
  onRangeCurrentTrack?: () => void;
  onRangeCurrentBlock?: () => void;
  noteNaming?: 'B' | 'H';
  onToggleNoteNaming?: () => void;
  visibleTracks?: number;
  onSetVisibleTracks?: (n: number) => void;
  /** Open the Synth Editor MDI window */
  onEditSynth?: () => void;
  /** Open the Sample Editor MDI window */
  onEditSample?: () => void;
  /** Open the Script Editor MDI window */
  onEditScript?: () => void;
  /** Open the Drum Editor MDI window */
  onEditDrum?: () => void;
  /** Open the Volume Mixer MDI window */
  onVolumeMixer?: () => void;
  /** Open the Sample Library MDI window */
  onSampleBrowser?: () => void;
  /** Open the Clip Palette MDI window */
  onClipPalette?: () => void;
  /** Open the Instrument Parameters dialog */
  onInstParams?: () => void;
  /** Send MIDI all-notes-off panic */
  onPanic?: () => void;
}

export function MenuBar({ canUndo = false, canRedo = false, onUndo, onRedo, onProgKeys, onSongOptions, onBlockProps, onMidiMessages, onMidiImport, onModImport, onSampleList, onInsertLine, onDeleteLine, onFlushCurrent, onFlushUnused, onRangeCurrentTrack, onRangeCurrentBlock, noteNaming = 'B', onToggleNoteNaming, visibleTracks = 16, onSetVisibleTracks, onEditSynth, onEditSample, onEditScript, onEditDrum, onVolumeMixer, onSampleBrowser, onClipPalette, onInstParams, onPanic }: MenuBarProps = {}) {
  const [openMenu, setOpenMenu] = useState<number | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [cloudSaving, setCloudSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [instLoadEntries, setInstLoadEntries] = useState<InstrumentFileEntry[] | null>(null);
  const { wbPrompt, wbConfirm, wbAlert, dialogEl } = useWbDialog();
  const barRef = useRef<HTMLDivElement>(null);

  // Track cloud auth state
  useEffect(() => cloud.onAuthChange(setCloudUser), []);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenMenu(null);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);

  const menus = useMenuDefs(setShowAbout, canUndo, canRedo, onUndo, onRedo, onProgKeys, onSongOptions, onBlockProps, onMidiMessages, onMidiImport, onModImport, onSampleList, onInsertLine, onDeleteLine, onFlushCurrent, onFlushUnused, onRangeCurrentTrack, onRangeCurrentBlock, noteNaming, onToggleNoteNaming, visibleTracks, onSetVisibleTracks, onEditSynth, onEditSample, onEditScript, onEditDrum, onVolumeMixer, onSampleBrowser, onClipPalette, onInstParams, onPanic, wbPrompt, wbConfirm, wbAlert, setInstLoadEntries);

  // ── Inject cloud items into the Project menu ────────────────────────────────
  const projectMenu = menus[0];
  if (projectMenu) {
    // Save to cloud: serialise via exportSongFile() which handles PCM base64 encoding
    async function cloudSave() {
      if (cloudSaving) return;
      setCloudSaving(true);
      setOpenMenu(null);
      try {
        const s = useStore.getState();
        const id = s.meta.cloudId ?? crypto.randomUUID();
        await cloud.saveProject({
          id,
          title: s.meta.title || 'Untitled',
          bpm: s.transport.bpm,
          blockCount: Object.keys(s.patterns).length,
          data: exportSongFile(),
        });
        s.setMeta({ cloudId: id });
        setToast({ msg: '☁ Saved to cloud', ok: true });
      } catch (e) {
        setToast({ msg: `☁ Save failed: ${e instanceof Error ? e.message : String(e)}`, ok: false });
      } finally {
        setCloudSaving(false);
        setTimeout(() => setToast(null), 3500);
      }
    }

    const cloudItems: MenuDef['items'] = [
      { kind: 'sep' },
      ...(cloudUser ? [
        { label: `☁ ${cloudUser.email ?? 'Cloud account'}`, disabled: true } as Item,
        { label: cloudSaving ? '☁ Saving…' : '☁ Save to Cloud', action: cloudSave, disabled: cloudSaving } as Item,
        { label: '☁ Open from Cloud…', action: () => { setOpenMenu(null); setCloudOpen(true); } } as Item,
      ] : [
        { label: '☁ Connect account…', action: () => { setOpenMenu(null); cloud.connectAccount(); } } as Item,
      ]),
    ];

    // Insert cloud items before "About" (which is the last item)
    const aboutIdx = projectMenu.items.findIndex(
      (it) => 'label' in it && it.label === 'About'
    );
    if (aboutIdx >= 0) {
      projectMenu.items.splice(aboutIdx, 0, ...cloudItems);
    } else {
      projectMenu.items.push(...cloudItems);
    }
  }

  function toggleMenu(idx: number) {
    setOpenMenu((prev) => (prev === idx ? null : idx));
  }

  function activateItem(item: Item) {
    if (item.disabled) return;
    item.action?.();
    setOpenMenu(null);
  }

  return (
    <>
      {showAbout && <AboutDialog onClose={() => setShowAbout(false)} />}
      {cloudOpen && <CloudProjectsDialog onClose={() => setCloudOpen(false)} />}
      {instLoadEntries && (
        <InstrumentLoadDialog
          entries={instLoadEntries}
          onClose={() => setInstLoadEntries(null)}
        />
      )}
      {dialogEl}
      {toast && (
        <div className={`cloud-toast cloud-toast--${toast.ok ? 'ok' : 'err'}`}>
          {toast.msg}
        </div>
      )}
      <div className="menubar" ref={barRef}>
      {menus.map((menu, mi) => (
        <div
          key={menu.title}
          className={`menubar__menu${openMenu === mi ? ' is-open' : ''}`}
        >
          <button
            className="menubar__title"
            type="button"
            onMouseDown={() => toggleMenu(mi)}
            // Hover opens if another menu is already open
            onMouseEnter={() => {
              if (openMenu !== null && openMenu !== mi) setOpenMenu(mi);
            }}
            tabIndex={-1}
          >
            {menu.title}
          </button>

          {openMenu === mi && (
            <div className="menubar__dropdown">
              {menu.items.map((entry, ei) =>
                entry.kind === 'sep' ? (
                  <div key={`sep-${ei}`} className="menubar__sep" />
                ) : (
                  <button
                    key={entry.label}
                    className={`menubar__item${entry.disabled ? ' is-disabled' : ''}${entry.checked ? ' is-checked' : ''}`}
                    type="button"
                    onMouseDown={() => activateItem(entry)}
                    tabIndex={-1}
                  >
                    <span className="menubar__item-label">
                      {entry.checked ? '✓ ' : '  '}
                      {entry.label}
                    </span>
                    {entry.shortcut && (
                      <span className="menubar__item-shortcut">{entry.shortcut}</span>
                    )}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}

      <span className="menubar__brand">
        ModeCat&nbsp;Pro&nbsp;V1.0.0&nbsp;&nbsp;©&nbsp;1991–2026&nbsp;&nbsp;Neutron&nbsp;Jr.
      </span>
      </div>
    </>
  );
}

// ─── Menu definitions (one hook so we can call useStore) ─────────────────────

function useMenuDefs(
  setShowAbout: (v: boolean) => void,
  canUndo: boolean,
  canRedo: boolean,
  onUndo?: () => void,
  onRedo?: () => void,
  onProgKeys?: () => void,
  onSongOptions?: () => void,
  onBlockProps?: () => void,
  onMidiMessages?: () => void,
  onMidiImport?: () => void,
  onModImport?: () => void,
  onSampleList?: () => void,
  onInsertLine?: () => void,
  onDeleteLine?: () => void,
  onFlushCurrent?: () => void,
  onFlushUnused?: () => void,
  onRangeCurrentTrack?: () => void,
  onRangeCurrentBlock?: () => void,
  noteNaming: 'B' | 'H' = 'B',
  onToggleNoteNaming?: () => void,
  visibleTracks: number = 16,
  onSetVisibleTracks?: (n: number) => void,
  onEditSynth?: () => void,
  onEditSample?: () => void,
  onEditScript?: () => void,
  onEditDrum?: () => void,
  onVolumeMixer?: () => void,
  onSampleBrowser?: () => void,
  onClipPalette?: () => void,
  onInstParams?: () => void,
  onPanic?: () => void,
  wbPrompt?: (title: string, opts?: { label?: string; defaultValue?: string; allowEmpty?: boolean }) => Promise<string | null>,
  wbConfirm?: (message: string, opts?: { title?: string; danger?: boolean }) => Promise<boolean>,
  wbAlert?: (message: string, opts?: { title?: string }) => Promise<void>,
  setInstLoadEntries?: (entries: InstrumentFileEntry[] | null) => void,
): MenuDef[] {
  const meta        = useStore((s) => s.meta);
  const setMeta     = useStore((s) => s.setMeta);
  const transport   = useStore((s) => s.transport);
  const cursor      = useStore((s) => s.cursor);
  const bridge      = useStore((s) => s.bridge);
  const setCursor   = useStore((s) => s.setCursor);
  const setTransport = useStore((s) => s.setTransport);
  const play        = useStore((s) => s.play);

  // Block ops
  const addPattern    = useStore((s) => s.addPattern);
  const patterns      = useStore((s) => s.patterns);
  const song          = useStore((s) => s.song);
  const transport2    = useStore((s) => s.transport);
  const activePattern = useStore((s) => s.activePattern);
  const setPatternLength = useStore((s) => s.setPatternLength);
  const splitBlockAt  = useStore((s) => s.splitBlockAt);
  const copyBlock     = useStore((s) => s.copyBlock);
  const pasteBlock    = useStore((s) => s.pasteBlock);
  const blockClipboard = useStore((s) => s.blockClipboard);

  // Track ops
  const copyTrack   = useStore((s) => s.copyTrack);
  const pasteTrack  = useStore((s) => s.pasteTrack);
  const trackClipboard = useStore((s) => s.trackClipboard);

  // Range ops
  const range       = useStore((s) => s.range);
  const rangeCut    = useStore((s) => s.rangeCut);
  const rangeCopy   = useStore((s) => s.rangeCopy);
  const rangePaste  = useStore((s) => s.rangePaste);
  const rangeClear  = useStore((s) => s.rangeClear);
  const rangeTransposeSemi = useStore((s) => s.rangeTransposeSemi);
  const rangeEcho   = useStore((s) => s.rangeEcho);
  const rangePitchSlide = useStore((s) => s.rangePitchSlide);
  const rangeVolFade = useStore((s) => s.rangeVolFade);
  const rangeSpread  = useStore((s) => s.rangeSpread);
  const setRightPanel = useStore((s) => s.setRightPanel);

  const hasRange = range !== null;
  const cursorRow = cursor.row;
  const pat = activePattern();

  // ── Helpers ──

  function openSave(inclInstr: boolean) {
    const fname = (meta.title || 'UNTITLED').replace(/\s+/g, '_').toLowerCase() + '.modecat.json';
    downloadSong(fname, inclInstr);
  }

  function openLoad() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.modecat.json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const text = await f.text();
        importSongFile(JSON.parse(text));
      } catch (err) {
        wbAlert?.(`Could not load song: ${err instanceof Error ? err.message : String(err)}`, { title: 'Load Error' });
      }
    };
    input.click();
  }

  async function newProject() {
    const title = await wbPrompt?.('New Project', { label: 'Project name', defaultValue: 'Untitled' }) ?? null;
    if (title === null) return;
    const ok = await wbConfirm?.('Discard current project and start new?', { title: 'New Project', danger: true }) ?? false;
    if (!ok) return;
    sessionStorage.setItem('mc_new_project_title', title.trim() || 'Untitled');
    window.location.reload();
  }

  async function setAnnotation() {
    const title = await wbPrompt?.('Song Annotation', { label: 'Song title', defaultValue: meta.title, allowEmpty: true }) ?? null;
    if (title === null) return;
    const author = await wbPrompt?.('Song Annotation', { label: 'Author', defaultValue: meta.author, allowEmpty: true }) ?? null;
    if (author === null) return;
    setMeta({ title, author });
  }

  function stub(label: string) {
    return () => wbAlert?.(`${label} — not yet implemented`);
  }

  return [
    // ── PROJECT ──────────────────────────────────────────────────────────────
    {
      title: 'Project',
      items: [
        { label: 'New', action: newProject, shortcut: 'Ctrl+N' },
        { kind: 'sep' },
        { label: 'Open…', action: openLoad, shortcut: 'Ctrl+O' },
        { label: 'Save', action: () => openSave(true), shortcut: 'Ctrl+S' },
        { label: 'Save without instruments', action: () => openSave(false) },
        { kind: 'sep' },
        { label: 'Import MOD / S3M…', action: onModImport },
        { kind: 'sep' },
        { label: 'About', action: () => setShowAbout(true) },
      ],
    },

    // ── DISPLAY ──────────────────────────────────────────────────────────────
    {
      title: 'Display',
      items: [
        // Tracker Editor is always visible — item kept for menu completeness but is a no-op
        { label: 'Tracker Editor', checked: true },
        { kind: 'sep' },
        { label: 'Synth Editor…', action: onEditSynth, shortcut: 'Alt+Y' },
        { label: 'Sample Editor…', action: onEditSample, shortcut: 'Alt+E' },
        { kind: 'sep' },
        { label: 'Sample Library…', action: onSampleBrowser, shortcut: 'Alt+B' },
        { label: 'Sample List Editor…', action: onSampleList ?? stub('Sample List Editor') },
        { label: 'MIDI Message Editor…', action: onMidiMessages ?? stub('MIDI Message Editor') },
        { label: 'Input Map Editor…', disabled: true },     // #40 future
        { kind: 'sep' },
        { label: 'Script Editor…', action: onEditScript, shortcut: 'Alt+S' },
        { label: 'Drum Editor…', action: onEditDrum, shortcut: 'Alt+D' },
        { kind: 'sep' },
        { label: 'Volume Mixer…', action: onVolumeMixer, shortcut: 'Alt+V' },
        { label: 'Clip Palette…', action: onClipPalette, shortcut: 'Alt+C' },
      ],
    },

    // ── SONG ─────────────────────────────────────────────────────────────────
    {
      title: 'Song',
      items: [
        { label: 'Playing Sequence…', action: stub('Playing Sequence') },
        { kind: 'sep' },
        { label: 'Set Options…', action: onSongOptions ?? stub('Song Options') },
        { label: 'Set Volumes…', action: onVolumeMixer ?? stub('Track Volumes') },
        { kind: 'sep' },
        { label: 'Set Annotation…', action: setAnnotation },
        { kind: 'sep' },
        {
          label: 'Loop Song',
          checked: transport.loopSong,
          action: () => setTransport({ loopSong: !transport.loopSong }),
        },
        {
          label: 'Block Loop',
          checked: transport.patternLoop,
          action: () => setTransport({ patternLoop: !transport.patternLoop }),
        },
      ],
    },

    // ── BLOCK ────────────────────────────────────────────────────────────────
    {
      title: 'Block',
      items: [
        {
          label: 'New / Insert',
          action: () => {
            const pos = transport2.songPos;
            addPattern(pos);
          },
          shortcut: 'Ctrl+I',
        },
        {
          label: 'New / Append',
          action: () => addPattern(),
          shortcut: 'Ctrl+N',
        },
        { kind: 'sep' },
        {
          label: 'Set Properties…',
          action: onBlockProps ?? (async () => {
            if (!pat) return;
            const name = await wbPrompt?.('Block Properties', { label: 'Block name', defaultValue: pat.name ?? '', allowEmpty: true }) ?? null;
            if (name === null) return;
            useStore.getState().renamePattern(pat.id, name);
            const lenStr = await wbPrompt?.('Block Properties', { label: 'Block length (rows)', defaultValue: String(pat.rows.length) }) ?? null;
            if (lenStr === null) return;
            const len = parseInt(lenStr, 10);
            if (len >= 1 && len <= 3200) setPatternLength(len);
          }),
          shortcut: 'Ctrl+B',
        },
        { label: 'Block List…', disabled: true },  // #51 future
        { kind: 'sep' },
        {
          label: 'Cut',
          action: () => {
            // Copy block to clipboard, then clear all cells in the pattern
            // (don't resize — ModeCat keeps the block length, just empties it).
            copyBlock();
            const s = useStore.getState();
            const pid = s.song.positions[s.transport.songPos];
            if (pid == null) return;
            s.setRange({
              startRow: 0,
              endRow: (s.activePattern()?.rows.length ?? 1) - 1,
              startCh: 0,
              endCh: 15,
            });
            s.rangeClear();
          },
          disabled: !pat,
          shortcut: 'Shift+Alt+X',
        },
        {
          label: 'Copy',
          action: copyBlock,
          disabled: !pat,
          shortcut: 'Shift+Alt+C',
        },
        {
          label: 'Paste',
          action: pasteBlock,
          disabled: !blockClipboard,
          shortcut: 'Shift+Alt+V',
        },
        { kind: 'sep' },
        {
          label: 'Insert Line',
          action: onInsertLine ?? stub('Insert Line'),
          shortcut: 'Ins',
        },
        {
          label: 'Delete Line',
          action: onDeleteLine ?? stub('Delete Line'),
          shortcut: 'Shift+Del',
        },
        { kind: 'sep' },
        {
          label: 'Split At Cursor',
          action: () => splitBlockAt(cursorRow),
          disabled: !pat,
          shortcut: 'Shift+Ctrl+J',
        },
        {
          label: 'Join With Next',
          disabled: true,  // #51
          shortcut: 'Ctrl+J',
        },
        { kind: 'sep' },
        {
          label: 'Fill Sequence with this Block',
          action: async () => {
            if (!pat) return;
            const ok = await wbConfirm?.(`Set ALL song positions to block "${pat.name || pat.id}"?`) ?? false;
            if (!ok) return;
            const s = useStore.getState();
            const filled = s.song.positions.map(() => pat.id);
            useStore.setState((st) => ({
              song: { ...st.song, positions: filled },
            }));
          },
          disabled: !pat,
        },
      ],
    },

    // ── TRACK ────────────────────────────────────────────────────────────────
    {
      title: 'Track',
      items: [
        {
          label: 'Cut',
          action: () => {
            // Copy the track to clipboard then clear all cells in the channel.
            const ch = cursor.channel;
            copyTrack(ch);
            const s = useStore.getState();
            const patLen = s.activePattern()?.rows.length ?? 1;
            s.setRange({ startRow: 0, endRow: patLen - 1, startCh: ch, endCh: ch });
            s.rangeClear();
          },
          shortcut: 'Ctrl+X',
        },
        {
          label: 'Copy',
          action: () => copyTrack(cursor.channel),
          shortcut: 'Ctrl+C',
        },
        {
          label: 'Paste',
          action: () => pasteTrack(cursor.channel),
          disabled: !trackClipboard,
          shortcut: 'Ctrl+V',
        },
        { kind: 'sep' },
        { label: 'Insert Empty Track', disabled: true },  // future
        { label: 'Delete Track', disabled: true },        // future
      ],
    },

    // ── EDIT ─────────────────────────────────────────────────────────────────
    {
      title: 'Edit',
      items: [
        {
          label: 'Undo',
          action: onUndo,
          disabled: !canUndo,
          shortcut: 'Ctrl+Z',
        },
        {
          label: 'Redo',
          action: onRedo,
          disabled: !canRedo,
          shortcut: 'Ctrl+Shift+Z',
        },
        { kind: 'sep' },
        {
          label: 'Cut Range',
          action: rangeCut,
          disabled: !hasRange,
          shortcut: 'Ctrl+X',
        },
        {
          label: 'Copy Range',
          action: rangeCopy,
          disabled: !hasRange,
          shortcut: 'Ctrl+C',
        },
        {
          label: 'Paste Range',
          action: rangePaste,
          disabled: !hasRange,
          shortcut: 'Ctrl+V',
        },
        {
          label: 'Erase Range',
          action: rangeClear,
          disabled: !hasRange,
        },
        { kind: 'sep' },
        {
          label: 'Transpose +1 semitone',
          action: () => rangeTransposeSemi(1),
          disabled: !hasRange,
        },
        {
          label: 'Transpose −1 semitone',
          action: () => rangeTransposeSemi(-1),
          disabled: !hasRange,
        },
        {
          label: 'Transpose +1 octave',
          action: () => useStore.getState().rangeTransposeOctave(1),
          disabled: !hasRange,
        },
        {
          label: 'Transpose −1 octave',
          action: () => useStore.getState().rangeTransposeOctave(-1),
          disabled: !hasRange,
        },
        { kind: 'sep' },
        {
          label: 'Pitch Slide — Type 1 (01xx)',
          action: () => rangePitchSlide('01', 4),
          disabled: !hasRange,
          shortcut: 'Ctrl+T',
        },
        {
          label: 'Pitch Slide — Type 2 (02xx)',
          action: () => rangePitchSlide('02', 4),
          disabled: !hasRange,
          shortcut: 'Shift+Ctrl+T',
        },
        {
          label: 'Pitch Slide — Portamento (03xx)',
          action: () => rangePitchSlide('03', 4),
          disabled: !hasRange,
        },
        { kind: 'sep' },
        {
          label: 'Vol Fade',
          action: rangeVolFade,
          disabled: !hasRange,
        },
        {
          label: 'Note Echo',
          action: () => rangeEcho(4, 20),
          disabled: !hasRange,
        },
        { kind: 'sep' },
        {
          label: 'Range Current Track',
          action: onRangeCurrentTrack ?? stub('Range Current Track'),
          shortcut: 'Ctrl+B',
        },
        {
          label: 'Range Current Block',
          action: onRangeCurrentBlock ?? stub('Range Current Block'),
          shortcut: 'Shift+Ctrl+B',
        },
        { kind: 'sep' },
        {
          label: 'Spread Notes…',
          action: async () => {
            const v = await wbPrompt?.('Spread Notes', { label: 'Spread across N channels (2–16)', defaultValue: '2' }) ?? null;
            if (!v) return;
            const n = parseInt(v, 10);
            if (n >= 2 && n <= 16) rangeSpread(n);
          },
          disabled: !hasRange,
        },
      ],
    },

    // ── INSTRUMENT ───────────────────────────────────────────────────────────
    {
      title: 'Instrument',
      items: [
        {
          label: 'Set Parameters…',
          action: onInstParams,
          shortcut: 'Alt+I',
        },
        { kind: 'sep' },
        {
          label: 'Load Instrument(s)…',
          shortcut: 'Ctrl+I',
          action: () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,.modecat-inst.json';
            input.onchange = async () => {
              const f = input.files?.[0];
              if (!f) return;
              try {
                const text = await f.text();
                const entries = parseInstrumentFile(text);
                if (entries.length === 0) {
                  wbAlert?.('No instruments found in that file.', { title: 'Load Instrument(s)' });
                  return;
                }
                setInstLoadEntries?.(entries);
              } catch (err) {
                wbAlert?.(`Could not read instrument file: ${err instanceof Error ? err.message : String(err)}`, { title: 'Load Error' });
              }
            };
            input.click();
          },
        },
        {
          label: 'Save Instrument',
          action: () => {
            const idx = useStore.getState().selectedInstrument;
            const inst = useStore.getState().instruments[idx];
            if (!inst || inst.kind === 'empty') {
              wbAlert?.('The selected slot is empty — nothing to save.', { title: 'Save Instrument' });
              return;
            }
            saveInstrumentFile(idx);
          },
        },
        {
          label: 'Save All Instruments',
          action: () => {
            const s = useStore.getState();
            const hasAny = s.instruments.some((i) => i.kind !== 'empty');
            if (!hasAny) {
              wbAlert?.('No instruments to save.', { title: 'Save All Instruments' });
              return;
            }
            saveAllInstrumentsFile(s.meta.title || 'instruments');
          },
        },
        { kind: 'sep' },
        {
          label: 'Flush Current',
          action: onFlushCurrent ?? (async () => {
            const idx = useStore.getState().selectedInstrument;
            const ok = await wbConfirm?.(`Flush instrument ${idx}?`, { danger: true }) ?? false;
            if (!ok) return;
            useStore.getState().setInstrument(idx, { kind: 'empty', name: '--' });
          }),
        },
        {
          label: 'Flush All Unused',
          action: onFlushUnused ?? stub('Flush All Unused'),
        },
      ],
    },

    // ── MIDI ─────────────────────────────────────────────────────────────────
    {
      title: 'MIDI',
      items: [
        {
          label: 'MIDI Active',
          checked: bridge.connected,
          disabled: true,   // connection is automatic via bridge; toggle is future
        },
        { kind: 'sep' },
        {
          label: 'Import MIDI File…',
          action: onMidiImport,
        },
        { kind: 'sep' },
        {
          label: 'Input Channel…',
          disabled: true,   // #40
        },
        { kind: 'sep' },
        {
          label: 'Send MIDI Reset (Panic)',
          action: onPanic,
          shortcut: 'Ctrl+Space',
        },
        { kind: 'sep' },
        { label: 'Ext Sync…', disabled: true },      // future
        { label: 'Send Sync…', disabled: true },     // future
        { label: 'Read Key-Ups', disabled: true },   // future
        { label: 'Read Volume', disabled: true },    // future
      ],
    },

    // ── SETTINGS ─────────────────────────────────────────────────────────────
    {
      title: 'Settings',
      items: [
        {
          label: 'Keyboard Options…',
          action: stub('Keyboard Options'),
          shortcut: 'Ctrl+K',
        },
        {
          label: 'Programmable Keys…',
          action: onProgKeys,
          shortcut: 'Ctrl+Y',
        },
        { kind: 'sep' },
        {
          label: `${visibleTracks === 4 ? '✓ ' : ''}Display Max Tracks: 4`,
          action: () => onSetVisibleTracks?.(4),
          checked: visibleTracks === 4,
        },
        {
          label: `${visibleTracks === 8 ? '✓ ' : ''}Display Max Tracks: 8`,
          action: () => onSetVisibleTracks?.(8),
          checked: visibleTracks === 8,
        },
        {
          label: `${visibleTracks === 16 ? '✓ ' : ''}Display Max Tracks: 16`,
          action: () => onSetVisibleTracks?.(16),
          checked: visibleTracks === 16,
        },
        { kind: 'sep' },
        {
          label: noteNaming === 'H' ? 'H → B (use B)' : 'B → H (use H)',
          action: onToggleNoteNaming ?? stub('H→B note naming'),
        },
        { kind: 'sep' },
        {
          label: 'Edit Mode',
          checked: cursor.editMode,
          action: () => setCursor({ editMode: !cursor.editMode }),
        },
        {
          label: 'Chord Mode',
          checked: cursor.chordMode,
          action: () => setCursor({ chordMode: !cursor.chordMode }),
        },
        {
          label: `Spacing: ${cursor.spc}`,
          action: async () => {
            const v = await wbPrompt?.('Cursor Spacing', { label: 'Advance after note entry (1–16)', defaultValue: String(cursor.spc) }) ?? null;
            if (!v) return;
            const n = parseInt(v, 10);
            if (n >= 1 && n <= 16) setCursor({ spc: n });
          },
        },
      ],
    },
  ];
}
