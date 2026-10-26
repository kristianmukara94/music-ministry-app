import { dispatch, useLive } from './store';
import { bridge } from './bridge';

/** How long to wait for the projector's startup screen before going ahead anyway. */
const STARTUP_WAIT_MS = 2000;

/**
 * Turns the projector on, then runs `go` once its startup screen has been applied. The main process applies the startup
 * screen a moment after the window opens, and it replaces anything sent before then. That is why a take sent straight
 * after switching on could show for a second and then be replaced by the startup screen. Every turn-on-and-go goes
 * through here, for Praise & Worship and the Mass Queue alike.
 *
 * The startup screen is the first state change after the switch-on, so the wait ends on it. The switch-on itself is one
 * change and the startup screen is the next, so the wait is for the revision two past the one before the switch. A
 * black startup screen holds new content behind a blackout, so the blackout is lifted after `go`, and the content shows.
 */
export function turnOnProjectorAndGo(go: () => void): void {
  const base = useLive.getState().state.rev;
  dispatch({ type: 'output/set', output: 'projector', on: true });
  void afterStartup(base).then((startedBlack) => {
    go();
    if (startedBlack) dispatch({ type: 'projector/blackout' });
  });
}

function afterStartup(base: number): Promise<boolean> {
  // The browser preview has no main process, so there is no startup screen to wait for.
  if (!bridge.isElectron) return Promise.resolve(false);
  const mode = useLive.getState().state.settings.startupScreen;
  // "Last content" applies no startup screen, so nothing can replace the take.
  if (mode === 'last') return Promise.resolve(false);

  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      stop();
      console.warn('The projector did not confirm its startup screen in time. Going ahead anyway.');
      resolve(useLive.getState().state.projector.live.kind === 'blackout');
    }, STARTUP_WAIT_MS);
    const stop = useLive.subscribe(({ state }) => {
      if (state.rev < base + 2) return;
      window.clearTimeout(timer);
      stop();
      resolve(state.projector.live.kind === 'blackout');
    });
  });
}
