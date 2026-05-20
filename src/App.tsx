import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MenuBar } from './components/MenuBar';
import { TransportBar } from './components/TransportBar';
import { PatternEditor } from './components/PatternEditor';
import { InfoBar } from './components/InfoBar';
import { InstrumentList } from './components/InstrumentList';
import { InstParamsDialog } from './components/InstParamsDialog';
import { ProgKeysDialog } from './components/ProgKeysDialog';
import { BlockPropsDialog } from './components/BlockPropsDialog';
import { SongOptionsDialog } from './components/SongOptionsDialog';
import { SampleEditor } from './components/SampleEditor';
import { SynthEditorMdi } from './components/SynthEditor';
import { NotationEditorMdi } from './components/NotationEditor';
import { ScriptEditor } from './components/ScriptEditor';
import { DrumEditor } from './components/DrumEditor';
import { MdiWindow } from './components/MdiWindow';
import { SongEditor } from './components/SongEditor';
import { ModeBar } from './components/ModeBar';
import { RangeBar } from './components/RangeBar';
import { BridgeClient } from './bridge/client';
import { Sequencer } from './engine/sequencer';
import { Oscilloscope } from './components/Oscilloscope';
import { MidiMessagesDialog } from './components/MidiMessagesDialog';
import { MidiImportDialog } from './components/MidiImportDialog';
import type { MidiImportSettings } from './components/MidiImportDialog';
import { parseMidiFile, buildPatternCells } from './engine/midiImport';
import type { ImportResult } from './engine/midiImport';
import { SampleListEditor } from './components/SampleListEditor';
import { SampleBrowser } from './components/SampleBrowser';
import { VolumeMixer } from './components/VolumeMixer';
import { ClipPalette } from './components/ClipPalette';
import { ClipEditor } from './components/ClipEditor';
import { StatusBar } from './components/StatusBar';
import EffectsPanel from './components/EffectsPanel';
import { ModImportDialog } from './components/ModImportDialog';
import type { ModImportOptions } from './components/ModImportDialog';
import { parseTrackerFile } from './engine/modImport';
import type { ModImportResult } from './engine/modImport';
import { parseXrns } from './engine/xrnsImport';
import { useStore } from './state/store';
import { setNoteNamingMode } from './engine/notes';
import type { Clip, SampleInstrument } from './state/types';
import { MAX_INSTRUMENTS } from './state/types';

// MDI window state shape
interface MdiState {
  open: boolean;
  x: number;
  y: number;
  z: number;
}

export default function App() {
  const setBridge = useStore((s) => s.setBridge);
  const setPorts = useStore((s) => s.setPorts);
  const setSelectedOutPort = useStore((s) => s.setSelectedOutPort);
  const playing = useStore((s) => s.transport.playing);
  const noteNaming = useStore((s) => s.noteNaming);
  const visibleTracks = useStore((s) => s.visibleTracks);
  const selectedInstrument = useStore((s) => s.selectedInstrument);
  const canUndo = useStore((s) => s.canUndo());
  const canRedo = useStore((s) => s.canRedo());

  // Left panel tab: 'song' | 'clips' | 'fx'
  const [leftTab, setLeftTab] = useState<'song' | 'clips' | 'fx'>('song');
  // Clip being edited in the ClipEditor MDI
  const [editingClip, setEditingClip] = useState<Clip | null>(null);

  // Inst Params dialog — opened from transport Inst Params… button or Alt+I
  const [instParamsOpen, setInstParamsOpen] = useState(false);
  // Programmable Keys dialog — opened from Settings menu
  const [progKeysOpen, setProgKeysOpen] = useState(false);
  // Song Options dialog — Song → Set Options…
  const [songOptsOpen, setSongOptsOpen] = useState(false);
  // Block Properties dialog — Block → Set Properties…
  const [blockPropsOpen, setBlockPropsOpen] = useState(false);
  // MIDI Messages dialog — MIDI → MIDI Message Editor…
  const [midiMsgOpen, setMidiMsgOpen] = useState(false);
  // Sample List Editor — Instrument → Sample List Editor…
  const [sampleListOpen, setSampleListOpen] = useState(false);

  // MIDI Import — MIDI → Import MIDI File…
  const [midiImportResult, setMidiImportResult] = useState<ImportResult | null>(null);
  const midiFileRef = useRef<Uint8Array | null>(null);
  const midiFileInputRef = useRef<HTMLInputElement>(null);

  const handleMidiFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    midiFileRef.current = bytes;
    try {
      const result = parseMidiFile(bytes);
      setMidiImportResult(result);
    } catch (err) {
      console.error('MIDI parse error', err);
      alert(`Could not parse MIDI file: ${(err as Error).message}`);
    }
    if (midiFileInputRef.current) midiFileInputRef.current.value = '';
  }, []);

  const handleMidiReparse = useCallback((rpb: number) => {
    if (!midiFileRef.current) return;
    try {
      setMidiImportResult(parseMidiFile(midiFileRef.current, rpb));
    } catch (err) {
      console.error('MIDI reparse error', err);
    }
  }, []);

  const handleMidiImport = useCallback((settings: MidiImportSettings) => {
    const { rowsPerBar: importRowsPerBar, overwrite, trackMapping, instrumentBase, totalRows, bpm } = settings;
    const MAX_ROWS = 3200;
    const cappedRows = Math.min(totalRows, MAX_ROWS);
    const result = midiImportResult!;
    const cellGrid = buildPatternCells(result, trackMapping, instrumentBase, cappedRows);
    const s = useStore.getState();
    s.setTransport({ bpm });
    if (overwrite) {
      const pid = s.song.positions[s.transport.songPos];
      if (pid != null) {
        s.setPatternLength(cappedRows);
        s.replacePatternRows(pid, cellGrid);
      }
    } else {
      const currentPos = s.transport.songPos;
      const newId = s.addPattern(currentPos);
      s.replacePatternRows(newId, cellGrid);
      s.insertSongPosition(s.song.positions.length, newId);
    }
    setMidiImportResult(null);
  }, [midiImportResult]);

  // MOD / S3M Import
  const [modImportResult, setModImportResult] = useState<ModImportResult | null>(null);
  const [modImportFilename, setModImportFilename] = useState('');
  const modFileInputRef = useRef<HTMLInputElement>(null);

  const handleModFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (modFileInputRef.current) modFileInputRef.current.value = '';
    try {
      const buf = await file.arrayBuffer();
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const result = ext === 'xrns'
        ? await parseXrns(buf)
        : parseTrackerFile(buf, file.name);
      setModImportFilename(file.name);
      setModImportResult(result);
    } catch (err) {
      alert(`Could not parse tracker file: ${(err as Error).message}`);
    }
  }, []);

  const handleModImport = useCallback((opts: ModImportOptions) => {
    if (!modImportResult) return;
    const { orderStart, orderEnd, replaceSong, instOffset } = opts;
    const { instruments, patterns, orderList, bpm, speed } = modImportResult;
    const s = useStore.getState();

    // ── 1. Load instruments ──
    instruments.forEach((inst, srcIdx) => {
      if (srcIdx === 0 || !inst.pcm) return;
      const slot = instOffset + srcIdx - 1;
      if (slot < 1 || slot >= MAX_INSTRUMENTS) return;
      const sampleInst: SampleInstrument = {
        kind:            'sample',
        name:            inst.name || `Sample ${srcIdx}`,
        pcm:             inst.pcm,
        sampleRate:      inst.sampleRate,
        baseNote:        inst.baseNote,
        volume:          inst.volume,
        transpose:       0,
        finetune:        inst.finetune,
        defaultPitch:    inst.baseNote,
        loopEnabled:     inst.loopEnabled,
        loopStart:       inst.loopStart,
        loopEnd:         inst.loopEnd,
        suppressNoteOff: false,
        attackMs:        5,
        decayMs:         0,
        sustain:         1,
        releaseMs:       110,
        lengthRows:      0,
      };
      s.setInstrument(slot, sampleInst);
    });

    // ── 2. Set BPM / speed ──
    s.setTransport({ bpm, speed });

    // ── 3. Build patterns ──
    // IMPORTANT: addPattern() automatically appends each new id to song.positions.
    // We capture the current positions first, let addPattern do its thing, then
    // overwrite positions with the correct song order using setSongPositions.
    const positionsBefore = useStore.getState().song.positions.slice();

    const sliceOrders = orderList.slice(orderStart, orderEnd + 1);
    // Deduplicate pattern indices so we create each unique pattern once
    const patIdxSeen = new Map<number, number>(); // mod-patIdx → store patId

    for (const modPatIdx of sliceOrders) {
      if (patIdxSeen.has(modPatIdx)) continue;
      const modRows = patterns[modPatIdx];
      if (!modRows) continue;

      // Remap instrument numbers: add (instOffset - 1) to each cell's instrument
      const remapped = modRows.map(row =>
        row.map(cell => ({
          ...cell,
          instrument: cell.instrument > 0
            ? Math.min(MAX_INSTRUMENTS - 1, cell.instrument + instOffset - 1)
            : 0,
        }))
      );

      const newId = s.addPattern(); // also appends newId to positions — fixed below
      s.replacePatternRows(newId, remapped);
      patIdxSeen.set(modPatIdx, newId);
    }

    // ── 4. Set correct song positions in MOD song order ──
    const modPositions = sliceOrders.map(modPatIdx => patIdxSeen.get(modPatIdx)!);
    const newPositions = replaceSong
      ? modPositions
      : [...positionsBefore, ...modPositions];
    useStore.getState().setSongPositions(newPositions);

    setModImportResult(null);
  }, [modImportResult]);

  // MDI window state — each editor is an independent floating window
  const nextZ = useRef(400);
  const [synthMdi, setSynthMdi]               = useState<MdiState>({ open: false, x: 80,  y: 70,  z: 400 });
  const [sampleMdi, setSampleMdi]             = useState<MdiState>({ open: false, x: 130, y: 100, z: 399 });
  const [notationMdi, setNotationMdi]         = useState<MdiState>({ open: false, x: 160, y: 120, z: 398 });
  const [scriptMdi, setScriptMdi]             = useState<MdiState>({ open: false, x: 200, y: 60,  z: 397 });
  const [drumMdi, setDrumMdi]                 = useState<MdiState>({ open: false, x: 60,  y: 80,  z: 396 });
  const [sampleBrowserMdi, setSampleBrowserMdi] = useState<MdiState>({ open: false, x: 100, y: 90,  z: 395 });
  const [mixerMdi, setMixerMdi]               = useState<MdiState>({ open: false, x: 240, y: 100, z: 394 });
  const [clipsMdi, setClipsMdi]               = useState<MdiState>({ open: false, x: 280, y: 110, z: 393 });

  function bringToFront(which: 'synth' | 'sample' | 'notation' | 'script' | 'drum' | 'browser' | 'mixer' | 'clips') {
    nextZ.current += 1;
    const z = nextZ.current;
    if (which === 'synth')         setSynthMdi((s) => ({ ...s, z }));
    else if (which === 'sample')   setSampleMdi((s) => ({ ...s, z }));
    else if (which === 'notation') setNotationMdi((s) => ({ ...s, z }));
    else if (which === 'script')   setScriptMdi((s) => ({ ...s, z }));
    else if (which === 'browser')  setSampleBrowserMdi((s) => ({ ...s, z }));
    else if (which === 'mixer')    setMixerMdi((s) => ({ ...s, z }));
    else if (which === 'clips')    setClipsMdi((s) => ({ ...s, z }));
    else                           setDrumMdi((s) => ({ ...s, z }));
  }

  function openSynthMdi() {
    nextZ.current += 1;
    setSynthMdi((s) => ({ ...s, open: true, z: nextZ.current }));
  }

  function openSampleMdi() {
    nextZ.current += 1;
    setSampleMdi((s) => ({ ...s, open: true, z: nextZ.current }));
  }

  function openNotationMdi() {
    nextZ.current += 1;
    setNotationMdi((s) => ({ ...s, open: true, z: nextZ.current }));
  }

  function openScriptMdi() {
    nextZ.current += 1;
    setScriptMdi((s) => ({ ...s, open: true, z: nextZ.current }));
  }

  function openDrumMdi() {
    nextZ.current += 1;
    setDrumMdi((s) => ({ ...s, open: true, z: nextZ.current }));
  }

  function openSampleBrowserMdi() {
    nextZ.current += 1;
    setSampleBrowserMdi((s) => ({ ...s, open: true, z: nextZ.current }));
  }

  function openMixerMdi() {
    nextZ.current += 1;
    setMixerMdi((s) => ({ ...s, open: true, z: nextZ.current }));
  }

  function openClipsMdi() {
    nextZ.current += 1;
    setClipsMdi((s) => ({ ...s, open: true, z: nextZ.current }));
  }

  // Sync noteNaming store value into the notes engine module
  useEffect(() => {
    setNoteNamingMode(noteNaming);
  }, [noteNaming]);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeys(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      // Undo / Redo
      if (ctrl && (e.key === 'z' || e.key === 'Z')) {
        if (e.shiftKey) {
          e.preventDefault();
          useStore.getState().redo();
        } else {
          e.preventDefault();
          useStore.getState().undo();
        }
        return;
      }
      if (ctrl && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        useStore.getState().redo();
        return;
      }
      // Alt+S — Script Editor
      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        openScriptMdi();
      }
      // Alt+D — Drum Editor
      if (e.altKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        openDrumMdi();
      }
      // Alt+B — Sample Library
      if (e.altKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        openSampleBrowserMdi();
      }
      // Alt+V — Volume Mixer
      if (e.altKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        openMixerMdi();
      }
      // Alt+C — Clip Palette
      if (e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        openClipsMdi();
      }
    }
    document.addEventListener('keydown', handleKeys);
    return () => document.removeEventListener('keydown', handleKeys);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { bridge, seq } = useMemo(() => {
    const bridge = new BridgeClient({
      onStatus: (s) => {
        setBridge({
          connected: s.connected,
          serverVersion: s.serverVersion,
          schedulingResolutionMs: s.schedulingResolutionMs,
          lastError: s.error,
        });
      },
      onDevices: (ports) => {
        setPorts(ports);
        const current = useStore.getState().selectedOutPortId;
        if (!current) {
          const firstOut = ports.find((p) => p.direction === 'out');
          if (firstOut) {
            setSelectedOutPort(firstOut.id);
            bridge.openPort(firstOut.id, 'out').catch(() => {});
          }
        }
      },
      onError: (e) => {
        setBridge({ lastError: `${e.code}: ${e.message}` });
      },
    });
    const seq = new Sequencer(bridge);
    return { bridge, seq };
  }, [setBridge, setPorts, setSelectedOutPort]);

  useEffect(() => {
    bridge.connect();
    return () => {
      seq.stop();
      bridge.close();
    };
  }, [bridge, seq]);

  const selectedOutPortId = useStore((s) => s.selectedOutPortId);
  const lastOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedOutPortId) return;
    if (lastOpened.current === selectedOutPortId) return;
    bridge.openPort(selectedOutPortId, 'out').catch(() => {});
    lastOpened.current = selectedOutPortId;
  }, [bridge, selectedOutPortId]);

  useEffect(() => {
    if (playing) seq.start();
    else seq.stop();
  }, [playing, seq]);

  return (
    <div className="modecat">
      <MenuBar
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => useStore.getState().undo()}
        onRedo={() => useStore.getState().redo()}
        onProgKeys={() => setProgKeysOpen(true)}
        onSongOptions={() => setSongOptsOpen(true)}
        onBlockProps={() => setBlockPropsOpen(true)}
        onMidiMessages={() => setMidiMsgOpen(true)}
        onMidiImport={() => midiFileInputRef.current?.click()}
        onModImport={() => modFileInputRef.current?.click()}
        onSampleList={() => setSampleListOpen(true)}
        onInsertLine={() => {
          const s = useStore.getState();
          s.insertRowAt(s.cursor.row);
        }}
        onDeleteLine={() => {
          const s = useStore.getState();
          s.deleteRowAt(s.cursor.row);
        }}
        onFlushCurrent={() => {
          const s = useStore.getState();
          s.flushInstrument(s.selectedInstrument);
        }}
        onFlushUnused={() => useStore.getState().flushUnused()}
        onRangeCurrentTrack={() => {
          const s = useStore.getState();
          const pat = s.activePattern();
          if (!pat) return;
          s.setRange({ startRow: 0, endRow: pat.rows.length - 1, startCh: s.cursor.channel, endCh: s.cursor.channel });
        }}
        onRangeCurrentBlock={() => {
          const s = useStore.getState();
          const pat = s.activePattern();
          if (!pat) return;
          s.setRange({ startRow: 0, endRow: pat.rows.length - 1, startCh: 0, endCh: 15 });
        }}
        noteNaming={noteNaming}
        onToggleNoteNaming={() => {
          const s = useStore.getState();
          s.setNoteNaming(s.noteNaming === 'B' ? 'H' : 'B');
        }}
        visibleTracks={visibleTracks}
        onSetVisibleTracks={(n) => useStore.getState().setVisibleTracks(n)}
        onEditSynth={openSynthMdi}
        onEditSample={openSampleMdi}
        onEditScript={openScriptMdi}
        onEditDrum={openDrumMdi}
        onVolumeMixer={openMixerMdi}
        onSampleBrowser={openSampleBrowserMdi}
        onClipPalette={openClipsMdi}
        onInstParams={() => setInstParamsOpen(true)}
        onPanic={() => seq.panic()}
      />
      <TransportBar
        seq={seq}
        onInstParams={() => setInstParamsOpen(true)}
        onEditSynth={openSynthMdi}
        onEditSample={openSampleMdi}
        onEditNotation={openNotationMdi}
      />
      <div className="modecat__body">
        <aside className="modecat__song">
          {/* Tab strip */}
          <div className="left-tabs">
            <button
              className={`left-tabs__tab${leftTab === 'song' ? ' is-active' : ''}`}
              type="button"
              onClick={() => setLeftTab('song')}
            >SONG</button>
            <button
              className={`left-tabs__tab${leftTab === 'clips' ? ' is-active' : ''}`}
              type="button"
              onClick={() => setLeftTab('clips')}
            >CLIPS</button>
            <button
              className={`left-tabs__tab${leftTab === 'fx' ? ' is-active' : ''}`}
              type="button"
              onClick={() => setLeftTab('fx')}
            >FX</button>
          </div>
          {leftTab === 'song' && <SongEditor />}
          {leftTab === 'clips' && <ClipPalette onEdit={(clip) => setEditingClip(clip)} />}
          {leftTab === 'fx' && <EffectsPanel />}
        </aside>
        <main className="modecat__main">
          <InfoBar />
          <ModeBar />
          <RangeBar />
          <PatternEditor />
          <Oscilloscope seq={seq} />
        </main>
        {/* Right panel: InstrumentList is now always visible — no tab toggle */}
        <aside className="modecat__side">
          <InstrumentList />
        </aside>
      </div>


      {/* ── Inst Params dialog ─────────────────────────────────────────────── */}
      {instParamsOpen && (
        <InstParamsDialog
          instIdx={selectedInstrument}
          onClose={() => setInstParamsOpen(false)}
        />
      )}

      {/* ── Programmable Keys dialog ────────────────────────────────────────── */}
      {progKeysOpen && (
        <ProgKeysDialog onClose={() => setProgKeysOpen(false)} />
      )}

      {/* ── Song Options dialog ─────────────────────────────────────────────── */}
      {songOptsOpen && (
        <SongOptionsDialog onClose={() => setSongOptsOpen(false)} />
      )}

      {/* ── Block Properties dialog ─────────────────────────────────────────── */}
      {blockPropsOpen && (
        <BlockPropsDialog onClose={() => setBlockPropsOpen(false)} />
      )}

      {/* ── MIDI Messages dialog ─────────────────────────────────────────────── */}
      {midiMsgOpen && (
        <MidiMessagesDialog onClose={() => setMidiMsgOpen(false)} />
      )}

      {/* ── MIDI Import ────────────────────────────────────────────────────────── */}
      <input
        ref={midiFileInputRef}
        type="file"
        accept=".mid,.midi"
        style={{ display: 'none' }}
        onChange={handleMidiFileChange}
      />
      {midiImportResult && (
        <MidiImportDialog
          result={midiImportResult}
          onReparse={handleMidiReparse}
          onImport={handleMidiImport}
          onClose={() => setMidiImportResult(null)}
        />
      )}

      {/* ── MOD / S3M Import ─────────────────────────────────────────────────── */}
      <input
        ref={modFileInputRef}
        type="file"
        accept=".mod,.s3m,.xrns"
        style={{ display: 'none' }}
        onChange={handleModFileChange}
      />
      {modImportResult && (
        <ModImportDialog
          result={modImportResult}
          filename={modImportFilename}
          onImport={handleModImport}
          onCancel={() => setModImportResult(null)}
        />
      )}

      {/* ── Sample List Editor ───────────────────────────────────────────────── */}
      {sampleListOpen && (
        <SampleListEditor onClose={() => setSampleListOpen(false)} />
      )}

      {/* ── MDI floating windows ───────────────────────────────────────────── */}
      {synthMdi.open && (
        <MdiWindow
          title="Synthetic Sound Editor"
          initialX={synthMdi.x}
          initialY={synthMdi.y}
          zIndex={synthMdi.z}
          minWidth={360}
          onClose={() => setSynthMdi((s) => ({ ...s, open: false }))}
          onFocus={() => bringToFront('synth')}
        >
          <SynthEditorMdi />
        </MdiWindow>
      )}

      {sampleMdi.open && (
        <MdiWindow
          title="Sample Editor"
          initialX={sampleMdi.x}
          initialY={sampleMdi.y}
          zIndex={sampleMdi.z}
          minWidth={500}
          onClose={() => setSampleMdi((s) => ({ ...s, open: false }))}
          onFocus={() => bringToFront('sample')}
        >
          <SampleEditor onOpenLibrary={openSampleBrowserMdi} />
        </MdiWindow>
      )}

      {notationMdi.open && (
        <MdiWindow
          title="Graphic Notation Editor"
          initialX={notationMdi.x}
          initialY={notationMdi.y}
          zIndex={notationMdi.z}
          minWidth={700}
          onClose={() => setNotationMdi((s) => ({ ...s, open: false }))}
          onFocus={() => bringToFront('notation')}
        >
          <NotationEditorMdi />
        </MdiWindow>
      )}

      {drumMdi.open && (
        <MdiWindow
          title="Drum Editor"
          initialX={drumMdi.x}
          initialY={drumMdi.y}
          zIndex={drumMdi.z}
          minWidth={720}
          onClose={() => setDrumMdi((s) => ({ ...s, open: false }))}
          onFocus={() => bringToFront('drum')}
        >
          <DrumEditor />
        </MdiWindow>
      )}

      {scriptMdi.open && (
        <MdiWindow
          title="Script Editor"
          initialX={scriptMdi.x}
          initialY={scriptMdi.y}
          zIndex={scriptMdi.z}
          minWidth={560}
          onClose={() => setScriptMdi((s) => ({ ...s, open: false }))}
          onFocus={() => bringToFront('script')}
        >
          <ScriptEditor />
        </MdiWindow>
      )}

      {sampleBrowserMdi.open && (
        <MdiWindow
          title="Sample Library"
          initialX={sampleBrowserMdi.x}
          initialY={sampleBrowserMdi.y}
          zIndex={sampleBrowserMdi.z}
          minWidth={580}
          onClose={() => setSampleBrowserMdi((s) => ({ ...s, open: false }))}
          onFocus={() => bringToFront('browser')}
        >
          <SampleBrowser onClose={() => setSampleBrowserMdi((s) => ({ ...s, open: false }))} />
        </MdiWindow>
      )}

      {mixerMdi.open && (
        <MdiWindow
          title="Volume Mixer"
          initialX={mixerMdi.x}
          initialY={mixerMdi.y}
          zIndex={mixerMdi.z}
          minWidth={420}
          onClose={() => setMixerMdi((s) => ({ ...s, open: false }))}
          onFocus={() => bringToFront('mixer')}
        >
          <VolumeMixer seq={seq} />
        </MdiWindow>
      )}

      {clipsMdi.open && (
        <MdiWindow
          title="Clip Palette"
          initialX={clipsMdi.x}
          initialY={clipsMdi.y}
          zIndex={clipsMdi.z}
          minWidth={360}
          onClose={() => setClipsMdi((s) => ({ ...s, open: false }))}
          onFocus={() => bringToFront('clips')}
        >
          <ClipPalette onEdit={(clip) => setEditingClip(clip)} />
        </MdiWindow>
      )}

      {editingClip && (
        <MdiWindow
          title={`Edit Clip: ${editingClip.name}`}
          initialX={180}
          initialY={90}
          zIndex={600}
          minWidth={480}
          onClose={() => setEditingClip(null)}
        >
          <ClipEditor
            clip={editingClip}
            onSave={(rows) => {
              useStore.getState().updateClip(editingClip.id, rows);
              setEditingClip(null);
            }}
            onClose={() => setEditingClip(null)}
          />
        </MdiWindow>
      )}

      <StatusBar />
    </div>
  );
}
