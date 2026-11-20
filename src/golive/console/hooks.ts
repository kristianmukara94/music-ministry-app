import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { comboOf } from '../../../shared/shortcuts.js';
import { consoleKeyAction, timerElapsed, timerReducer, TIMER_ZERO, type ConsoleKeyAction, type SegmentTimer, type TimerAction } from '../../../shared/stage-cue.js';
import { useNow } from '../../operator/useNow';
import { useUi } from '../../state/ui';

/** The segment timers of both consoles, kept outside the views so switching tabs or the focus view never loses a running timer. */
const useTimers = create<{ timers: Record<string, SegmentTimer> }>()(() => ({ timers: {} }));

function act(scope: string, action: TimerAction) {
  useTimers.setState((s) => ({ timers: { ...s.timers, [scope]: timerReducer(s.timers[scope], action, Date.now()) } }));
}

/**
 * The header's segment timer for one console (`scope`): a stopwatch that starts from zero on each new segment (running when the run is on
 * air, as the old segment clock did), with Start / Pause and Reset under the operator's hand. Re-renders every second.
 */
export function useSegmentTimer(scope: 'pw' | 'mass', segmentKey: string | null, runOnAir: boolean) {
  const now = useNow().getTime();
  const timer = useTimers((s) => s.timers[scope] ?? TIMER_ZERO);
  useEffect(() => {
    act(scope, { type: 'segment', key: segmentKey, run: runOnAir });
  }, [scope, segmentKey, runOnAir]);
  return {
    elapsedMs: timerElapsed(timer, Math.max(now, Date.now())),
    running: timer.since != null,
    toggle: () => act(scope, { type: 'toggle' }),
    reset: () => act(scope, { type: 'reset' }),
  };
}

/**
 * B (Blackout), L (Lower Third), H (Hide Text) and E (the Output Preview Editor on the slide on air) on a live console. ← → Space and 1–9 are
 * already handled (OperatorApp, the cue navigator).
 * The keys give way, as every console key does, to a text field, an open dialog, the command palette, the shortcut capture, a control that
 * already handled the key, and a saved shortcut on the same key.
 */
export function useConsoleKeys(run: (action: ConsoleKeyAction) => void, enabled = true) {
  const latest = useRef({ run, enabled });
  latest.current = { run, enabled };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!latest.current.enabled || e.defaultPrevented) return;
      const action = consoleKeyAction(e);
      if (!action) return;
      const ui = useUi.getState();
      if (ui.paletteOpen || ui.capturingHotkey || document.querySelector('[aria-modal="true"]')) return;
      const combo = comboOf(e);
      if (combo && ui.shortcuts.some((s) => s.key === combo)) return;
      e.preventDefault();
      latest.current.run(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
