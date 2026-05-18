/**
 * WbDialog — Workbench-styled in-app dialogs.
 *
 * Drop-in replacements for the browser's prompt / confirm / alert calls so the
 * native OS dialog never interrupts the tracker feel.
 *
 * Components:
 *   <WbPrompt>  — single text-input + OK / Cancel  (replaces prompt())
 *   <WbConfirm> — message text    + OK / Cancel  (replaces confirm())
 *   <WbAlert>   — message text    + OK only       (replaces alert())
 *
 * All three render over a semi-transparent backdrop, trap Enter / Escape, and
 * auto-focus the relevant control on mount.
 */

import { useEffect, useRef, useState } from 'react';

// ── WbPrompt ──────────────────────────────────────────────────────────────────

interface WbPromptProps {
  title: string;
  label?: string;
  defaultValue?: string;
  okLabel?: string;
  /** Called with the entered value when OK is pressed (or Enter). */
  onConfirm: (value: string) => void;
  /** Called when Cancel is pressed or Escape is hit. */
  onCancel: () => void;
}

export function WbPrompt({
  title,
  label = 'Name',
  defaultValue = '',
  okLabel = 'OK',
  onConfirm,
  onCancel,
}: WbPromptProps) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      if (e.key === 'Enter')  { e.preventDefault(); submit(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function submit() {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  }

  return (
    <div className="ip-backdrop" onMouseDown={onCancel}>
      <div className="ip-dialog wb-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ip-titlebar">
          <span>{title}</span>
          <button className="ip-close" type="button" onClick={onCancel} tabIndex={-1}>✕</button>
        </div>
        <div className="ip-body wb-dialog__body">
          <div className="ip-row">
            <label className="ip-label">{label}</label>
            <input
              ref={inputRef}
              className="ip-input ip-input--wide"
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
        <div className="ip-footer wb-dialog__footer">
          <button className="btn wb-dialog__btn" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="btn wb-dialog__btn wb-dialog__btn--ok"
            type="button"
            onClick={submit}
            disabled={!value.trim()}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── WbConfirm ─────────────────────────────────────────────────────────────────

interface WbConfirmProps {
  title?: string;
  message: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function WbConfirm({
  title = 'Confirm',
  message,
  okLabel = 'OK',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: WbConfirmProps) {
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    okRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      if (e.key === 'Enter')  { e.preventDefault(); onConfirm(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onConfirm, onCancel]);

  return (
    <div className="ip-backdrop" onMouseDown={onCancel}>
      <div className="ip-dialog wb-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ip-titlebar">
          <span>{title}</span>
          <button className="ip-close" type="button" onClick={onCancel} tabIndex={-1}>✕</button>
        </div>
        <div className="ip-body wb-dialog__body">
          <p className="wb-dialog__message">{message}</p>
        </div>
        <div className="ip-footer wb-dialog__footer">
          <button className="btn wb-dialog__btn" type="button" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            ref={okRef}
            className={`btn wb-dialog__btn${danger ? ' wb-dialog__btn--danger' : ' wb-dialog__btn--ok'}`}
            type="button"
            onClick={onConfirm}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── WbAlert ───────────────────────────────────────────────────────────────────

interface WbAlertProps {
  title?: string;
  message: string;
  onClose: () => void;
}

export function WbAlert({ title = 'Notice', message, onClose }: WbAlertProps) {
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { btnRef.current?.focus(); }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); onClose(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ip-backdrop" onMouseDown={onClose}>
      <div className="ip-dialog wb-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ip-titlebar">
          <span>{title}</span>
          <button className="ip-close" type="button" onClick={onClose} tabIndex={-1}>✕</button>
        </div>
        <div className="ip-body wb-dialog__body">
          <p className="wb-dialog__message">{message}</p>
        </div>
        <div className="ip-footer wb-dialog__footer">
          <button
            ref={btnRef}
            className="btn wb-dialog__btn wb-dialog__btn--ok"
            type="button"
            onClick={onClose}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
