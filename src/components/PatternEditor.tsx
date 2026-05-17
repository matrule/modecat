// PatternEditor (v5): virtualised rows — only visible rows are rendered.
// Row height is 18 px (matches CSS .pattern__row { height: 18px }).
// Top/bottom spacer <div>s carry the full scroll height so the scrollbar
// thumb size and position are accurate for 3000+ row patterns.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, useActivePattern } from '../state/store';
import {
  formatNote,
  hex2,
  hexCharToValue,
  KEYMAP_LOWER,
  KEYMAP_UPPER,
  NOTE_HOLD,
} from '../engine/notes';
import { CHANNELS, type PatternCell } from '../state/types';

const COL_WIDTH_CH = 12; // each channel column = 12 character cells wide
const ROW_H        = 18; // must match CSS: .pattern__row { height: 18px }
const OVERSCAN     = 12; // extra rows to render above and below the viewport

export function PatternEditor() {
  const pattern = useActivePattern();
  const cursor = useStore((s) => s.cursor);
  // Subscribe to transport.playing only — NOT transport.row.
  // Row changes are handled via direct DOM mutation so React never reconciles
  // on every tick.
  const transportPlaying = useStore((s) => s.transport.playing);
  const selectedInstrument = useStore((s) => s.selectedInstrument);
  const trackFlags = useStore((s) => s.trackFlags);

  const setCell        = useStore((s) => s.setCell);
  const clearCell      = useStore((s) => s.clearCell);
  const setCursor      = useStore((s) => s.setCursor);
  const moveCursor     = useStore((s) => s.moveCursor);
  const setEditMode    = useStore((s) => s.setEditMode);
  const setOctave      = useStore((s) => s.setOctave);
  const togglePlay     = useStore((s) => s.togglePlay);
  const toggleMute     = useStore((s) => s.toggleMute);
  const toggleSolo     = useStore((s) => s.toggleSolo);
  const range          = useStore((s) => s.range);
  const setRange       = useStore((s) => s.setRange);
  const extendRangeTo  = useStore((s) => s.extendRangeTo);
  const copyTrack      = useStore((s) => s.copyTrack);
  const pasteTrack     = useStore((s) => s.pasteTrack);
  const trackClipboard = useStore((s) => s.trackClipboard);
  const rangeClear     = useStore((s) => s.rangeClear);
  const progKeys       = useStore((s) => s.progKeys);
  const visibleTracks  = useStore((s) => s.visibleTracks);
  const drumConfig     = useStore((s) => s.drumConfig);
  const instHighlight  = useStore((s) => s.instHighlight);

  // Build a map from channel index (0-based) → voice name for drum channels.
  const drumChannelNames = useMemo(() => {
    const map = new Map<number, string>();
    for (const v of drumConfig.voices) {
      map.set(v.channel, v.name);
    }
    return map;
  }, [drumConfig.voices]);
  const insertRowAt    = useStore((s) => s.insertRowAt);
  const deleteRowAt    = useStore((s) => s.deleteRowAt);
  const insertRowsAt   = useStore((s) => s.insertRowsAt);
  const deleteRowsAt   = useStore((s) => s.deleteRowsAt);

  // ── Row selection (shift-click on row numbers) ───────────────────────────
  // Independent of the cell range — only rows, not channels.
  const [rowSel, setRowSel] = useState<{ anchor: number; end: number } | null>(null);
  const rowSelRef = useRef(rowSel);
  rowSelRef.current = rowSel;

  const scrollRef      = useRef<HTMLDivElement>(null);
  // Which row currently has the 'is-playhead' CSS class (direct DOM mutation).
  const playheadRowRef = useRef<number>(-1);
  // When the playhead moves to a row outside the rendered window we can't
  // apply the class immediately — store it here and apply in useLayoutEffect
  // after the scroll-triggered re-render brings the row into view.
  const pendingPlayheadRef = useRef<number>(-1);

  const anySolo = useMemo(() => trackFlags.some((f) => f.solo), [trackFlags]);

  // ── Refs for always-fresh state in the stable keyboard handler ──────────
  const cursorRef         = useRef(cursor);
  cursorRef.current       = cursor;
  const patternRef        = useRef(pattern);
  patternRef.current      = pattern;
  const selectedInstRef   = useRef(selectedInstrument);
  selectedInstRef.current = selectedInstrument;
  const rangeRef          = useRef(range);
  rangeRef.current        = range;
  const progKeysRef       = useRef(progKeys);
  progKeysRef.current     = progKeys;

  // ── Virtual scroll window ───────────────────────────────────────────────
  // [start, end) index range of rows that are actually rendered.
  // Updated on scroll events; React only re-renders when these boundaries change.
  const [visWindow, setVisWindow] = useState<{ start: number; end: number }>({ start: 0, end: 80 });

  // Initialise end based on real container height after first mount.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const totalRows = patternRef.current?.rows.length ?? 0;
    const viewH = container.clientHeight;
    const newEnd = Math.min(totalRows, Math.ceil(viewH / ROW_H) + OVERSCAN * 2);
    setVisWindow({ start: 0, end: Math.max(newEnd, 40) });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset scroll + window when the active pattern changes (pattern ID switch).
  // We identify a pattern switch by watching the pattern's row-count alongside
  // the cursor row; a simpler proxy is the pattern object reference itself but
  // that fires on every cell edit. Instead we rely on the song-position from
  // the transport, which only changes on actual pattern switches.
  const songPos = useStore((s) => s.transport.songPos);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    pendingPlayheadRef.current = -1;
    playheadRowRef.current = -1;
    const container = scrollRef.current;
    const viewH = container?.clientHeight ?? 0;
    const totalRows = patternRef.current?.rows.length ?? 0;
    const newEnd = Math.min(totalRows, Math.ceil(viewH / ROW_H) + OVERSCAN * 2);
    setVisWindow({ start: 0, end: Math.max(newEnd, 40) });
  }, [songPos]);

  // Scroll handler — recomputes the visible window without causing extra renders
  // unless the rendered range actually needs to change.
  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const totalRows = patternRef.current?.rows.length ?? 0;
    const viewH = el.clientHeight;
    const newStart = Math.max(0, Math.floor(el.scrollTop / ROW_H) - OVERSCAN);
    const newEnd   = Math.min(totalRows, Math.ceil((el.scrollTop + viewH) / ROW_H) + OVERSCAN);
    setVisWindow((prev) => {
      if (prev.start === newStart && prev.end === newEnd) return prev;
      return { start: newStart, end: newEnd };
    });
  }

  // Imperatively scroll the container so that `row` is centred in the viewport.
  // Does NOT use scrollIntoView so it works even when the row div isn't rendered.
  function scrollContainerToRow(row: number) {
    const container = scrollRef.current;
    if (!container) return;
    const rowTop    = row * ROW_H;
    const rowBottom = rowTop + ROW_H;
    const { scrollTop, clientHeight } = container;
    if (rowTop < scrollTop || rowBottom > scrollTop + clientHeight) {
      container.scrollTop = Math.max(0, rowTop - clientHeight / 2 + ROW_H / 2);
    }
  }

  // Cursor vertical scroll: when stopped, keep the cursor row in view.
  // If the row isn't rendered yet we scroll by position (imperative) so the
  // onScroll → setVisWindow → re-render chain brings it into the DOM.
  useEffect(() => {
    if (!transportPlaying) {
      const container = scrollRef.current;
      if (!container) return;
      const el = container.querySelector<HTMLDivElement>(`[data-row="${cursor.row}"]`);
      if (el) {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else {
        scrollContainerToRow(cursor.row);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transportPlaying, cursor.row]);

  // Cursor horizontal scroll: keep the active channel cell in view.
  useEffect(() => {
    const el = scrollRef.current?.querySelector<HTMLDivElement>(
      `[data-ch="${cursor.channel}"][data-row="${cursor.row}"]`
    );
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [cursor.channel, cursor.row]);

  // Playhead: subscribe to transport changes WITHOUT causing React re-renders.
  // We directly toggle 'is-playhead' on the row div. If the target row isn't
  // in the rendered window we scroll the container (which triggers handleScroll
  // → setVisWindow → re-render) and store the row in pendingPlayheadRef so
  // useLayoutEffect can apply the class after the row appears in the DOM.
  useEffect(() => {
    return useStore.subscribe((state, prev) => {
      const t    = state.transport;
      const prevT = prev.transport;
      if (t.playing === prevT.playing && t.row === prevT.row) return;

      const container = scrollRef.current;
      if (!container) return;

      if (!t.playing) {
        if (playheadRowRef.current >= 0) {
          container.querySelector(`[data-row="${playheadRowRef.current}"]`)
            ?.classList.remove('is-playhead');
          playheadRowRef.current = -1;
        }
        pendingPlayheadRef.current = -1;
        return;
      }

      const newRow = t.row;
      if (newRow === playheadRowRef.current) return;

      // Remove the class from the old row (if rendered).
      if (playheadRowRef.current >= 0) {
        container.querySelector(`[data-row="${playheadRowRef.current}"]`)
          ?.classList.remove('is-playhead');
      }

      const el = container.querySelector<HTMLElement>(`[data-row="${newRow}"]`);
      if (el) {
        // Row is in the DOM — apply immediately.
        el.classList.add('is-playhead');
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        playheadRowRef.current = newRow;
        pendingPlayheadRef.current = -1;
      } else {
        // Row is outside the rendered window. Scroll the container — the
        // resulting scroll event will fire handleScroll → setVisWindow,
        // causing a re-render that brings the row into the DOM. We apply
        // the class in useLayoutEffect below.
        pendingPlayheadRef.current = newRow;
        scrollContainerToRow(newRow);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // After every React reconciliation:
  // 1. Re-apply 'is-playhead' to the current playhead row (React may have
  //    reconstructed the div when a cell was edited during playback).
  // 2. Apply any pending playhead from a virtualised scroll (pendingPlayheadRef).
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    // Re-apply current playhead class.
    if (playheadRowRef.current >= 0) {
      container.querySelector(`[data-row="${playheadRowRef.current}"]`)
        ?.classList.add('is-playhead');
    }

    // Apply pending playhead once the row is in the DOM.
    if (pendingPlayheadRef.current >= 0) {
      const el = container.querySelector<HTMLElement>(`[data-row="${pendingPlayheadRef.current}"]`);
      if (el) {
        el.classList.add('is-playhead');
        playheadRowRef.current = pendingPlayheadRef.current;
        pendingPlayheadRef.current = -1;
      }
    }
  });

  // ── Keyboard handler ─────────────────────────────────────────────────────
  const onKey = useCallback((e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    const cursor   = cursorRef.current;
    const pattern  = patternRef.current;
    const progKeys = progKeysRef.current;
    const range    = rangeRef.current;

    if (e.key === ' ') { e.preventDefault(); togglePlay(); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (rowSelRef.current) { setRowSel(null); return; }
      if (range) setRange(null);
      else setEditMode(!cursor.editMode);
      return;
    }
    if (e.key === 'Enter')      { e.preventDefault(); setEditMode(!cursor.editMode); return; }
    if (e.key === 'ArrowUp')    { e.preventDefault(); moveCursor(-1, 0); return; }
    if (e.key === 'ArrowDown')  { e.preventDefault(); moveCursor( 1, 0); return; }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); moveCursor( 0, -1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); moveCursor( 0,  1); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      moveCursor(0, e.shiftKey ? -7 : 7);
      return;
    }
    if (e.key === 'PageUp')   { e.preventDefault(); moveCursor(-16, 0); return; }
    if (e.key === 'PageDown') { e.preventDefault(); moveCursor( 16, 0); return; }
    if (e.key === 'Home')     { e.preventDefault(); setCursor({ row: 0 }); return; }
    if (e.key === 'End')      { e.preventDefault(); setCursor({ row: (pattern?.rows.length ?? 1) - 1 }); return; }

    if (e.key === '+' || e.key === '=') { e.preventDefault(); setOctave(cursor.octave + 1); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); setOctave(cursor.octave - 1); return; }

    if (e.key === 'F1') { e.preventDefault(); setOctave(1); return; }
    if (e.key === 'F2') { e.preventDefault(); setOctave(2); return; }
    if (e.key === 'F3') { e.preventDefault(); setOctave(3); return; }
    if (e.key === 'F4') { e.preventDefault(); setOctave(4); return; }
    if (e.key === 'F5') { e.preventDefault(); setOctave(5); return; }

    if (e.key === 'F6')  { e.preventDefault(); setCursor({ row: 0 }); return; }
    if (e.key === 'F7')  { e.preventDefault(); setCursor({ row: Math.floor((pattern?.rows.length ?? 1) * 1 / 4) }); return; }
    if (e.key === 'F8')  { e.preventDefault(); setCursor({ row: Math.floor((pattern?.rows.length ?? 1) / 2) }); return; }
    if (e.key === 'F9')  { e.preventDefault(); setCursor({ row: Math.floor((pattern?.rows.length ?? 1) * 3 / 4) }); return; }
    if (e.key === 'F10') { e.preventDefault(); setCursor({ row: (pattern?.rows.length ?? 1) - 1 }); return; }

    // Insert / Delete line — ModeCat shortcuts, active regardless of edit mode.
    if (e.key === 'Insert') {
      e.preventDefault();
      insertRowAt(cursor.row);
      return;
    }
    if (e.key === 'Delete' && e.shiftKey) {
      e.preventDefault();
      deleteRowAt(cursor.row);
      return;
    }

    if (!cursor.editMode) return;

    const { row, channel, field } = cursor;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      clearCell(row, channel);
      if (e.key === 'Backspace') moveCursor(-cursor.spc, 0); else moveCursor(cursor.spc, 0);
      return;
    }

    if (field === 0) {
      const k = e.key.toLowerCase();

      if (k === 'a') {
        e.preventDefault();
        setCell(row, channel, { note: NOTE_HOLD });
        if (cursor.chordMode) moveCursor(0, 7);
        else moveCursor(cursor.spc, 0);
        return;
      }

      if (e.shiftKey && e.key >= '0' && e.key <= '9') {
        const slot = parseInt(e.key, 10);
        const pk = progKeys[slot];
        if (pk) {
          e.preventDefault();
          const patch: Partial<PatternCell> = {};
          if (pk.note > 0) { patch.note = pk.note; }
          if (pk.instrument > 0) patch.instrument = pk.instrument;
          if (pk.cmd !== 0)  patch.cmd  = pk.cmd;
          if (pk.data !== 0) patch.data = pk.data;
          if (Object.keys(patch).length > 0) {
            setCell(row, channel, patch);
            if (cursor.chordMode) moveCursor(0, 7);
            else moveCursor(cursor.spc, 0);
          }
          return;
        }
      }

      const lower = KEYMAP_LOWER[k];
      const upper = KEYMAP_UPPER[k];
      if (lower != null || upper != null) {
        e.preventDefault();
        const base   = (cursor.octave + 1) * 12;
        const offset = lower != null ? lower : (upper as number);
        const note   = base + offset;
        setCell(row, channel, { note, instrument: selectedInstRef.current });
        if (cursor.chordMode) moveCursor(0, 7);
        else moveCursor(cursor.spc, 0);
        return;
      }
    }

    const hv = hexCharToValue(e.key);
    if (hv >= 0) {
      e.preventDefault();
      const cell = pattern?.rows[row]?.[channel];
      if (!cell) return;
      switch (field) {
        case 1: {
          const v = ((hv << 4) | (cell.instrument & 0x0f)) & 0xff;
          setCell(row, channel, { instrument: v });
          moveCursor(0, 1);
          return;
        }
        case 2: {
          const v = ((cell.instrument & 0xf0) | hv) & 0xff;
          setCell(row, channel, { instrument: v });
          setCursor({ field: 3 });
          return;
        }
        case 3: {
          const v = ((hv << 4) | (cell.cmd & 0x0f)) & 0xff;
          setCell(row, channel, { cmd: v });
          moveCursor(0, 1);
          return;
        }
        case 4: {
          const v = ((cell.cmd & 0xf0) | hv) & 0xff;
          setCell(row, channel, { cmd: v });
          setCursor({ field: 5 });
          return;
        }
        case 5: {
          const v = ((hv << 4) | (cell.data & 0x0f)) & 0xff;
          setCell(row, channel, { data: v });
          moveCursor(0, 1);
          return;
        }
        case 6: {
          const v = ((cell.data & 0xf0) | hv) & 0xff;
          setCell(row, channel, { data: v });
          const patLen  = patternRef.current?.rows.length ?? 1;
          const nextRow = (row + cursor.spc) % patLen;
          setCursor({ row: nextRow, field: 0 });
          return;
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setCell, clearCell, setCursor, moveCursor, setEditMode, setOctave, togglePlay, setRange, insertRowAt, deleteRowAt]);

  useEffect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onKey]);

  if (!pattern) return null;

  const totalRows = pattern.rows.length;
  // Clamp the window against the actual row count (pattern may have shrunk).
  const winStart  = Math.min(visWindow.start, Math.max(0, totalRows - 1));
  const winEnd    = Math.min(visWindow.end, totalRows);
  const topH      = winStart * ROW_H;
  const bottomH   = Math.max(0, (totalRows - winEnd) * ROW_H);

  // CSS column template: 3.5ch line-number gutter + visibleTracks fixed-width tracks
  const tpl = `3.5ch repeat(${visibleTracks}, ${COL_WIDTH_CH}ch)`;

  return (
    <div className="pattern">
      <div className="pattern__scroll" ref={scrollRef} onScroll={handleScroll}>
        <div className="pattern__header" style={{ gridTemplateColumns: tpl }}>
          <div className="num"></div>
          {Array.from({ length: visibleTracks }, (_, i) => {
            const f = trackFlags[i]!;
            const audible = anySolo ? f.solo : !f.mute;
            const drumName = drumChannelNames.get(i);
            const isDrum = drumName !== undefined;
            const cls = [
              'ch',
              f.mute ? 'is-muted' : '',
              f.solo ? 'is-solo'  : '',
              !audible ? 'is-silent' : '',
              isDrum ? 'is-drum' : '',
            ].filter(Boolean).join(' ');
            // Drum channels show abbreviated voice name + channel number so the
            // tracker mapping is always visible.  E.g. "BASS/9", "SNAR/10".
            const chNum = String(i + 1).padStart(2, '0');
            const label = isDrum
              ? `${drumName!.substring(0, 4)}/${chNum}`
              : `CH${chNum}`;
            const title = isDrum
              ? `${drumName} · CH${chNum} · Click: mute · Shift-click: solo`
              : 'Click: mute · Shift-click: solo · Right-click: copy/paste track';
            return (
              <div
                key={i}
                className={cls}
                onClick={(e) => {
                  if (e.shiftKey) toggleSolo(i);
                  else toggleMute(i);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const menu = document.createElement('div');
                  menu.className = 'ctx-menu';
                  menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999`;
                  const mkItem = (lbl: string, disabled: boolean, cb: () => void) => {
                    const item = document.createElement('div');
                    item.className = `ctx-menu__item${disabled ? ' is-disabled' : ''}`;
                    item.textContent = lbl;
                    if (!disabled) {
                      // Use onmousedown + stopPropagation so the callback fires
                      // before the document mousedown dismiss listener can remove
                      // the menu — onclick never fires on a removed element.
                      item.onmousedown = (ev) => {
                        ev.stopPropagation();
                        menu.remove();
                        cb();
                      };
                    }
                    return item;
                  };
                  const chLabel = isDrum
                    ? `${drumName} (CH${chNum})`
                    : `CH${chNum}`;
                  menu.append(
                    mkItem(`Copy Track ${chLabel}`, false, () => copyTrack(i)),
                    mkItem('Paste Track Here', !trackClipboard, () => pasteTrack(i)),
                    mkItem('Select All Rows', false, () => {
                      const len = patternRef.current?.rows.length ?? 1;
                      setRange({ startRow: 0, endRow: len - 1, startCh: i, endCh: i });
                      setCursor({ row: 0, channel: i });
                    }),
                    mkItem('Clear Track', false, () => {
                      const len = patternRef.current?.rows.length ?? 1;
                      setRange({ startRow: 0, endRow: len - 1, startCh: i, endCh: i });
                      rangeClear();
                    }),
                  );
                  document.body.append(menu);
                  const dismiss = () => { menu.remove(); document.removeEventListener('mousedown', dismiss); };
                  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
                }}
                title={title}
              >
                {label}
              </div>
            );
          })}
        </div>

        {/* Top spacer — fills the scroll height above the rendered window */}
        {topH > 0 && <div style={{ height: topH }} aria-hidden />}

        {/* Visible rows only */}
        {pattern.rows.slice(winStart, winEnd).map((cells, i) => {
          const r         = winStart + i;
          const isCurrent = r === cursor.row;
          const isBeat    = r % 4 === 0;
          // Row selection bounds (anchor may be above or below end).
          const rsMin = rowSel ? Math.min(rowSel.anchor, rowSel.end) : -1;
          const rsMax = rowSel ? Math.max(rowSel.anchor, rowSel.end) : -1;
          const isRowSel = rowSel !== null && r >= rsMin && r <= rsMax;
          const cls = [
            'pattern__row',
            isBeat    ? 'is-beat'    : '',
            isCurrent ? 'is-current' : '',
            isRowSel  ? 'is-row-sel' : '',
          ].filter(Boolean).join(' ');
          return (
            <div
              className={cls}
              key={r}
              data-row={r}
              style={{ gridTemplateColumns: tpl }}
              onContextMenu={(e) => {
                e.preventDefault();
                const rs = rowSelRef.current;
                const selMin = rs ? Math.min(rs.anchor, rs.end) : r;
                const selMax = rs ? Math.max(rs.anchor, rs.end) : r;
                const count  = selMax - selMin + 1;
                const label  = count === 1 ? '1 row' : `${count} rows`;
                const menu = document.createElement('div');
                menu.className = 'ctx-menu';
                menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:9999`;
                const mkItem = (text: string, cb: () => void) => {
                  const item = document.createElement('div');
                  item.className = 'ctx-menu__item';
                  item.textContent = text;
                  item.onmousedown = (ev) => { ev.stopPropagation(); menu.remove(); cb(); };
                  return item;
                };
                menu.append(
                  mkItem(`Insert ${label} at ${selMin}  [Ins]`, () => {
                    setCursor({ row: selMin });
                    insertRowsAt(selMin, count);
                    setRowSel(null);
                  }),
                  mkItem(`Delete ${label} at ${selMin}  [Shift+Del]`, () => {
                    setCursor({ row: selMin });
                    deleteRowsAt(selMin, count);
                    setRowSel(null);
                  }),
                );
                document.body.append(menu);
                const dismiss = () => { menu.remove(); document.removeEventListener('mousedown', dismiss); };
                setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
              }}
            >
              <div
                className="num"
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation(); // don't trigger cell cursor move
                  if (e.shiftKey && rowSelRef.current) {
                    // Extend selection from anchor to here.
                    setRowSel((prev) => prev ? { ...prev, end: r } : { anchor: r, end: r });
                  } else {
                    // Start a new selection.
                    setRowSel({ anchor: r, end: r });
                    setCursor({ row: r });
                  }
                }}
              >{String(r).padStart(2, '0')}</div>
              {cells.slice(0, visibleTracks).map((cell, c) => {
                const inRange = !!range
                  && r >= range.startRow && r <= range.endRow
                  && c >= range.startCh  && c <= range.endCh;
                const highlighted = instHighlight
                  && cell.instrument !== 0
                  && cell.instrument === selectedInstrument;
                return (
                  <CellView
                    key={c}
                    cell={cell}
                    channelIndex={c}
                    rowIndex={r}
                    isCursorRow={isCurrent}
                    isCursorChannel={c === cursor.channel}
                    cursorField={cursor.field}
                    muted={anySolo ? !trackFlags[c]!.solo : trackFlags[c]!.mute}
                    inRange={inRange}
                    highlighted={highlighted}
                    onMouseDown={(e) => {
                      setRowSel(null); // cell click clears row selection
                      if (e.shiftKey) {
                        extendRangeTo(r, c);
                      } else {
                        setRange(null);
                        setCursor({ row: r, channel: c, field: 0 });
                      }
                    }}
                  />
                );
              })}
            </div>
          );
        })}

        {/* Bottom spacer — fills the scroll height below the rendered window */}
        {bottomH > 0 && <div style={{ height: bottomH }} aria-hidden />}
      </div>
    </div>
  );
}

function CellView({
  cell,
  channelIndex,
  rowIndex,
  isCursorRow,
  isCursorChannel,
  cursorField,
  muted,
  inRange,
  highlighted,
  onMouseDown,
}: {
  cell: PatternCell;
  channelIndex: number;
  rowIndex: number;
  isCursorRow: boolean;
  isCursorChannel: boolean;
  cursorField: number;
  muted: boolean;
  inRange: boolean;
  highlighted: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const noteEmpty = cell.note === 0;
  const instEmpty = cell.instrument === 0;
  const cmdEmpty  = cell.cmd === 0 && cell.data === 0;
  const showCursor = isCursorRow && isCursorChannel;
  const cls = [
    'cell',
    muted       ? 'is-muted'          : '',
    inRange     ? 'in-range'          : '',
    highlighted ? 'is-inst-highlight' : '',
  ].filter(Boolean).join(' ');

  const instActive = showCursor && (cursorField === 1 || cursorField === 2);
  const cmdActive  = showCursor && cursorField >= 3;

  return (
    <div className={cls} onMouseDown={onMouseDown} data-ch={channelIndex} data-row={rowIndex}>
      <span className={`note seg ${noteEmpty ? 'is-empty' : ''} ${showCursor && cursorField === 0 ? 'is-cursor' : ''}`}>
        {formatNote(cell.note)}
      </span>
      <span> </span>
      <span className={`inst${instEmpty ? ' is-empty' : ''}${instActive ? ' is-active' : ''}`}>
        <span className={`seg${showCursor && cursorField === 1 ? ' is-cursor' : ''}`}>{hex2(cell.instrument)[0]}</span>
        <span className={`seg${showCursor && cursorField === 2 ? ' is-cursor' : ''}`}>{hex2(cell.instrument)[1]}</span>
      </span>
      <span> </span>
      <span className={`cmd${cmdEmpty ? ' is-empty' : ''}${cmdActive ? ' is-active' : ''}`}>
        <span className={`seg${showCursor && cursorField === 3 ? ' is-cursor' : ''}`}>{hex2(cell.cmd)[0]}</span>
        <span className={`seg${showCursor && cursorField === 4 ? ' is-cursor' : ''}`}>{hex2(cell.cmd)[1]}</span>
        <span className={`seg${showCursor && cursorField === 5 ? ' is-cursor' : ''}`}>{hex2(cell.data)[0]}</span>
        <span className={`seg${showCursor && cursorField === 6 ? ' is-cursor' : ''}`}>{hex2(cell.data)[1]}</span>
      </span>
    </div>
  );
}
