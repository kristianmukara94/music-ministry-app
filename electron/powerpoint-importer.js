// Tells the window how far a PowerPoint import has got. The import itself is done elsewhere (whiteboard.js, announcements.js, documents.js); each
// step of it calls the `report` made here, and this turns that into `powerpoint:import-progress` messages for the window that started the import.
import { IMPORT_PROGRESS_CHANNEL, progressFor } from '../shared/import-progress.js';

/** Sends one message to a window, if it is still there. A window closed mid-import is not an error: the import carries on without it. */
export function sendToWindow(win) {
  return (payload) => {
    try {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IMPORT_PROGRESS_CHANNEL, payload);
    } catch {
      /* the window went away between the check and the send */
    }
  };
}

/**
 * A `report(stage, done, total, totalSlides)` for one file of an import. It works out the overall percentage (the file's place among
 * `fileCount` included) and passes it to `emit`. The percentage never goes back, and a message that says nothing new is not sent, so a loop that
 * reports every slide, or a poll that sees the same count twice, does not flood the window.
 */
export function createImportReporter({ emit, fileName = '', fileIndex = 0, fileCount = 1 }) {
  let totalSlides = 0;
  let lastPercentage = 0;
  let lastKey = '';
  const report = (stage, done = 0, total = 0, knownSlides = 0) => {
    if (knownSlides > 0) totalSlides = knownSlides;
    const progress = progressFor({ stage, done, total, totalSlides, fileName, fileIndex, fileCount });
    progress.percentage = Math.max(progress.percentage, lastPercentage);
    const key = `${progress.stage}|${progress.currentSlide}|${progress.totalSlides}|${progress.percentage}`;
    if (key === lastKey) return;
    lastKey = key;
    lastPercentage = progress.percentage;
    emit(progress);
  };
  return report;
}
