import { useEffect } from 'react';
import { comboOf } from '../../shared/shortcuts.js';
import { setUi, useUi } from '../state/ui';

/**
 * Go Live Fullscreen Mode. A layout switch only: the sidebar and edge tabs step aside so the console fills the window, and the window goes
 * fullscreen. Nothing here dispatches to the live store or touches the projector, and the console stays mounted in the same place, so the
 * live output, the cursor and the console's picks all carry on untouched.
 */

/** True while this mode put the window into fullscreen. A window already fullscreen (Ctrl+Shift+F) is left that way on exit. */
let ownsWindowFullscreen = false;

export function enterGoLiveFullscreen() {
  setUi({ goLiveFullscreen: true });
  if (document.fullscreenElement) return;
  document.documentElement
    .requestFullscreen()
    .then(() => {
      ownsWindowFullscreen = true;
    })
    .catch(() => undefined);
}

export function exitGoLiveFullscreen() {
  setUi({ goLiveFullscreen: false });
  if (!ownsWindowFullscreen) return;
  ownsWindowFullscreen = false;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}

export function toggleGoLiveFullscreen() {
  if (useUi.getState().goLiveFullscreen) exitGoLiveFullscreen();
  else enterGoLiveFullscreen();
}

/**
 * Keeps the mode and the window in step. Leaving window fullscreen another way (Esc, F11, Ctrl+Shift+F) also leaves Fullscreen Mode, and Esc on
 * the Go Live view exits it unless a dialog, a field or a saved shortcut has the key.
 */
export function useGoLiveFullscreenSync() {
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement || !ownsWindowFullscreen) return;
      ownsWindowFullscreen = false;
      setUi({ goLiveFullscreen: false });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
      const ui = useUi.getState();
      if (!ui.goLiveFullscreen || ui.view !== 'goLive' || ui.capturingHotkey || ui.paletteOpen) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const combo = comboOf(e);
      if (combo && ui.shortcuts.some((s) => s.key === combo)) return;
      exitGoLiveFullscreen();
    };
    document.addEventListener('fullscreenchange', onChange);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
