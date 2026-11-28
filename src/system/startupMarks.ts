// The page's two steps of the launch timeline (electron/startup-metrics.js): its first paint, and the moment the console can be worked.
// Times are sent as wall-clock milliseconds, the clock the main process counts on. The main process listens to the operator page only,
// and keeps the first mark of each name. Outside the desktop app there is nobody to tell, and nothing happens.
import { useLive } from '../live/store';

const send = (name: 'renderer:first-paint' | 'renderer:interactive', at: number) => window.apcc?.startup?.mark(name, performance.timeOrigin + at);

export function reportFirstPaint() {
  if (!window.apcc?.startup) return;
  try {
    const observer = new PerformanceObserver((list) => {
      const first = list.getEntries()[0];
      if (!first) return;
      observer.disconnect();
      send('renderer:first-paint', first.startTime);
    });
    observer.observe({ type: 'paint', buffered: true });
  } catch {
    // An engine without paint timing: the step is simply missing from the report.
  }
}

/**
 * Reports "interactive" once the live state has arrived from the main process and a frame has been drawn with it, with the page's thread
 * free again. Returns a function that stops waiting.
 */
export function reportInteractive() {
  let frame = 0;
  let timer = 0;
  const draw = () => {
    frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => send('renderer:interactive', performance.now()), 0);
    });
  };
  let stop = () => {};
  if (useLive.getState().ready) draw();
  else {
    stop = useLive.subscribe((s) => {
      if (!s.ready) return;
      stop();
      draw();
    });
  }
  return () => {
    stop();
    cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
}
