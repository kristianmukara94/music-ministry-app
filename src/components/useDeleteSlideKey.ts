import { useEffect, useRef } from 'react';
import { comboOf } from '../../shared/shortcuts.js';
import { useUi } from '../state/ui';

/** Whether a key went to a text field, where Delete and Backspace edit the text. */
export function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable || Boolean(el.closest?.('[contenteditable="true"]'));
}

/**
 * Delete or Backspace runs a live console's Delete slide, on the slide on screen. Mounted only while the console is, and read through a ref so
 * the listener is added once and always sees the slide on screen now. Pass null while nothing can be deleted, so the key does nothing.
 *
 * The key gives way, as the chip keys do (see LiveStageCanvas), to a text field, an open dialog, the command palette, the shortcut capture, a
 * control that already handled it, and any saved shortcut on the same key. A held key does not repeat, so one press deletes one slide.
 */
export function useDeleteSlideKey(onDelete: (() => void) | null) {
  const latest = useRef(onDelete);
  latest.current = onDelete;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (isTextEntry(e.target)) return;
      const ui = useUi.getState();
      if (ui.paletteOpen || ui.capturingHotkey || document.querySelector('[aria-modal="true"]')) return;
      const combo = comboOf(e);
      if (combo && ui.shortcuts.some((s) => s.key === combo)) return;
      const run = latest.current;
      if (!run) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
