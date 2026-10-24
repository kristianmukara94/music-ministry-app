import { BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const JOB_TIMEOUT_MS = 120_000;
const STARTUP_TIMEOUT_MS = 30_000;
const LOG = '[pdf]';

/**
 * Renders PDF pages to JPEG bytes inside a hidden window that runs pdf.js
 * (the `pdf-converter` route of the renderer). No Office or COM automation involved.
 *
 * Every failure is logged to the terminal, because the renderer's own console is not visible
 * to whoever runs the app. A failed window is destroyed, so the next import starts a fresh one.
 */
export function createPdfConverter({ loadRoute, preload }) {
  const jobs = new Map();
  let win = null;
  let loaded = null;

  /** Rejects every job still waiting on the renderer, so none of them hangs until its timeout. */
  const failJobs = (message) => {
    for (const [jobId, job] of jobs) {
      clearTimeout(job.timer);
      job.reject(new Error(message));
      jobs.delete(jobId);
    }
  };

  /** Forgets a window that failed or crashed, and closes it. The next convert starts over. */
  const retire = (failed, message) => {
    if (win === failed) {
      win = null;
      loaded = null;
    }
    if (!failed.isDestroyed()) failed.destroy();
    failJobs(message);
  };

  ipcMain.on('pdf:finish', (_event, { jobId, pages, error }) => {
    const job = jobs.get(jobId);
    if (!job) return;
    jobs.delete(jobId);
    clearTimeout(job.timer);
    if (error) {
      console.error(`${LOG} Rendering failed in the renderer: ${error}`);
      job.reject(new Error(error));
      return;
    }
    console.info(`${LOG} Rendered ${pages.length} page(s).`);
    job.resolve(pages.map((page) => ({ jpeg: Buffer.from(page.jpeg), text: String(page.text ?? '') })));
  });

  function ensureWindow() {
    if (win && !win.isDestroyed() && loaded) return loaded;

    const created = new BrowserWindow({
      show: false,
      width: 1920,
      height: 1080,
      webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    win = created;
    let started = false;
    loaded = new Promise((resolve, reject) => {
      // Every way the window can fail ends here, so a bad start rejects at once instead of hanging.
      const fail = (message) => {
        clearTimeout(startup);
        console.error(`${LOG} ${message}`);
        retire(created, message);
        reject(new Error(message));
      };
      const startup = setTimeout(
        () => fail(`The PDF renderer did not start within ${STARTUP_TIMEOUT_MS / 1000} seconds.`),
        STARTUP_TIMEOUT_MS,
      );

      created.webContents.once('did-finish-load', async () => {
        // The page loaded, but the bridge it needs comes from the preload. Without it, jobs would wait out their timeout.
        const check = created.webContents.executeJavaScript('Boolean(window.apcc && window.apcc.pdf)');
        const bridged = await Promise.race([check, new Promise((ok) => setTimeout(() => ok(false), 5000))]).catch(() => false);
        if (!bridged) return fail('The PDF renderer loaded without its bridge. Check that electron/preload.cjs is in the build.');
        clearTimeout(startup);
        started = true;
        resolve();
      });
      created.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
        if (isMainFrame) fail(`The PDF renderer did not load (${code} ${description}). URL: ${url}`);
      });
      created.webContents.on('render-process-gone', (_event, details) => {
        const message = `The PDF renderer stopped unexpectedly (${details.reason}).`;
        // A crash before the start is a failed start; after it, the job in hand fails and the next import starts afresh.
        if (!started) return fail(message);
        console.error(`${LOG} ${message}`);
        retire(created, message);
      });
    });
    loadRoute(created, 'pdf-converter');
    return loaded;
  }

  return {
    /** Resolves to an array of `{ jpeg, text }`, one per page. Rejects with a message the operator can read. */
    async convert(filePath) {
      const name = path.basename(filePath);
      console.info(`${LOG} Rendering ${name}.`);
      await ensureWindow();

      let bytes;
      try {
        bytes = new Uint8Array(await fs.promises.readFile(filePath));
      } catch (err) {
        // A locked or moved file lands here. Logging it says why, and the import reports the file as skipped.
        console.error(`${LOG} Could not read ${name}: ${err.message}`);
        throw new Error(`Could not read ${name}. It may be open in another program.`);
      }

      const target = win;
      if (!target || target.isDestroyed()) throw new Error('The PDF renderer is not running. Import the file again.');

      const jobId = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          jobs.delete(jobId);
          console.error(`${LOG} Timed out rendering ${name} after ${JOB_TIMEOUT_MS / 1000} seconds.`);
          reject(new Error(`Rendering ${name} took too long.`));
        }, JOB_TIMEOUT_MS);
        jobs.set(jobId, { resolve, reject, timer });
        target.webContents.send('pdf:convert', { jobId, bytes });
      });
    },

    dispose() {
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
      loaded = null;
    },
  };
}
