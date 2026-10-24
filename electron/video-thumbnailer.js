import { BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';

const JOB_TIMEOUT_MS = 30_000;

/**
 * Captures a still from a video without ffmpeg: a hidden window plays the file in a
 * <video> element, seeks to 0.5s, and draws the frame to a canvas (the `thumbnailer`
 * route of the renderer). Returns JPEG bytes.
 */
export function createVideoThumbnailer({ loadRoute, preload }) {
  const jobs = new Map();
  let win = null;
  let loaded = null;

  ipcMain.on('thumb:finish', (_event, { jobId, jpeg, error }) => {
    const job = jobs.get(jobId);
    if (!job) return;
    jobs.delete(jobId);
    clearTimeout(job.timer);
    if (error) job.reject(new Error(error));
    else job.resolve(Buffer.from(jpeg));
  });

  function ensureWindow() {
    if (!win || win.isDestroyed()) {
      win = new BrowserWindow({
        show: false,
        width: 960,
        height: 540,
        webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false },
      });
      loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
      loadRoute(win, 'thumbnailer');
    }
    return loaded;
  }

  return {
    /** `src` is an apcc-media URL. `kind` is 'video' (a frame is taken) or 'image' (the picture is drawn). */
    async capture(src, kind = 'video') {
      await ensureWindow();
      const jobId = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          jobs.delete(jobId);
          reject(new Error(kind === 'image' ? 'Image thumbnail timed out.' : 'Video thumbnail timed out.'));
        }, JOB_TIMEOUT_MS);
        jobs.set(jobId, { resolve, reject, timer });
        win.webContents.send('thumb:job', { jobId, src, kind });
      });
    },

    dispose() {
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  };
}
