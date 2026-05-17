/**
 * MdiWindow — a draggable, closable, maximisable floating window à la Amiga Workbench.
 *
 * Usage:
 *   <MdiWindow
 *     title="Sample Editor"
 *     zIndex={301}
 *     onClose={() => setSampleOpen(false)}
 *     onFocus={() => bringToFront('sample')}
 *     initialX={120}
 *     initialY={80}
 *     minWidth={480}
 *   >
 *     <SampleEditor />
 *   </MdiWindow>
 *
 * The zoom gadget (□) in the title bar toggles between floating and maximised
 * (covers the viewport, à la Amiga Workbench zoom). Dragging is disabled while
 * maximised.
 */

import { useRef, useState } from 'react';

interface MdiWindowProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onFocus?: () => void;
  initialX?: number;
  initialY?: number;
  zIndex?: number;
  minWidth?: number;
}

export function MdiWindow({
  title,
  children,
  onClose,
  onFocus,
  initialX = 100,
  initialY = 80,
  zIndex = 300,
  minWidth = 320,
}: MdiWindowProps) {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const [maximised, setMaximised] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  function handleTitleMouseDown(e: React.MouseEvent) {
    // Don't start drag if a gadget button was clicked, or if maximised
    if ((e.target as HTMLElement).closest('.mdi__close,.mdi__zoom')) return;
    if (maximised) return;
    e.preventDefault();
    onFocus?.();

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      setPos({
        x: Math.max(0, dragRef.current.origX + ev.clientX - dragRef.current.startX),
        y: Math.max(0, dragRef.current.origY + ev.clientY - dragRef.current.startY),
      });
    }

    function onUp() {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Maximised windows fill the viewport (with a small margin so the menubar is still visible)
  const maximisedStyle = maximised
    ? { left: 0, top: 28, right: 0, bottom: 0, width: 'auto', height: 'auto', maxHeight: 'none', minWidth: 0 }
    : {};

  return (
    <div
      className={`mdi-window${maximised ? ' is-maximised' : ''}`}
      style={maximised ? { ...maximisedStyle, zIndex } : { left: pos.x, top: pos.y, zIndex, minWidth }}
      onMouseDown={() => onFocus?.()}
    >
      {/* Title bar — drag handle */}
      <div className="mdi__titlebar" onMouseDown={handleTitleMouseDown}>
        {/* Depth gadget (decorative, left side) */}
        <div className="mdi__depth-gadget" aria-hidden="true">
          <div /><div />
        </div>

        <span className="mdi__title">{title}</span>

        {/* Zoom gadget — toggle maximise */}
        <button
          className={`mdi__zoom${maximised ? ' is-active' : ''}`}
          type="button"
          title={maximised ? 'Restore' : 'Maximise'}
          onClick={(e) => { e.stopPropagation(); onFocus?.(); setMaximised((v) => !v); }}
        >
          {maximised ? '❐' : '□'}
        </button>

        {/* Close gadget (right side) */}
        <button
          className="mdi__close"
          type="button"
          title="Close"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        >
          ✕
        </button>
      </div>

      {/* Scrollable content */}
      <div className="mdi__content">
        {children}
      </div>
    </div>
  );
}
