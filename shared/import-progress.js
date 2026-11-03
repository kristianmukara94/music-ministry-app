// How far a PowerPoint import has got, as the numbers and words the Whiteboard shows. Pure, so the main process that reports it, the page that
// draws it and the tests all use the same rules.
//
// An import of one file goes through these stages, each with its own share of the bar. Where the work is done slide by slide (PowerPoint
// exporting its slides, saving each picture, saving each editable background) the stage moves with the slide count. Where one step does it
// all at once (LibreOffice converting a deck, the hidden window that reads every slide's text) the stage holds its share and says what it is doing.
//
//   reading       5%   opening the file and counting its visible slides
//   rendering    45%   drawing each slide as a picture
//   saving       12%   saving each picture into the library
//   layers       28%   reading the words and backgrounds of every slide, so they can be edited
//   layerImages   8%   saving each slide's editable background
//   finishing     2%   adding the slides to the Whiteboard
//
// Several files chosen together share the bar equally: the second of three starts at 33%.

export const IMPORT_PROGRESS_CHANNEL = 'powerpoint:import-progress';

/** Each stage's share of one file's bar: [from, to] as fractions of 1. */
export const STAGES = {
  reading: [0, 0.05],
  rendering: [0.05, 0.5],
  saving: [0.5, 0.62],
  layers: [0.62, 0.9],
  layerImages: [0.9, 0.98],
  finishing: [0.98, 1],
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** What a stage says it is doing. `done` and `total` are slide counts, when the stage counts slides. */
export function statusOf(stage, { done = 0, total = 0, fileName = '' } = {}) {
  const of = total > 0 ? ` ${Math.min(done, total)} of ${total}` : '';
  switch (stage) {
    case 'reading':
      return fileName ? `Opening ${fileName}…` : 'Opening the file…';
    case 'rendering':
      return total > 0 ? `Drawing slide${of}…` : 'Drawing the slides…';
    case 'saving':
      return total > 0 ? `Saving slide${of}…` : 'Saving the slides…';
    case 'layers':
      return 'Reading the words of each slide…';
    case 'layerImages':
      return total > 0 ? `Saving editable slide${of}…` : 'Saving the editable slides…';
    case 'finishing':
      return 'Adding the slides to the Whiteboard…';
    default:
      return 'Importing…';
  }
}

/**
 * One progress report. `stage` is a key of STAGES; `done` and `total` count slides in that stage (total 0 when not known); `totalSlides` is the
 * deck's visible slide count once it is known (0 before). `fileIndex` and `fileCount` place this file among those chosen.
 *
 * Returns { currentSlide, totalSlides, percentage, statusText, stage, fileName, fileIndex, fileCount }. `currentSlide` is the slide the stage is on,
 * `percentage` is a whole number from 0 to 100.
 */
export function progressFor({ stage, done = 0, total = 0, totalSlides = 0, fileName = '', fileIndex = 0, fileCount = 1 }) {
  const [from, to] = STAGES[stage] ?? STAGES.reading;
  const within = total > 0 ? clamp(done / total, 0, 1) : 0;
  const files = Math.max(1, fileCount);
  const overall = (clamp(fileIndex, 0, files - 1) + from + (to - from) * within) / files;
  return {
    currentSlide: total > 0 ? Math.min(done, total) : 0,
    totalSlides: totalSlides || total || 0,
    percentage: Math.round(clamp(overall, 0, 1) * 100),
    statusText: statusOf(stage, { done, total, fileName }),
    stage,
    fileName,
    fileIndex,
    fileCount: files,
  };
}

export const IDLE_IMPORT = Object.freeze({ busy: false, progress: null });

/**
 * What the import button and bar show. `start` begins an import with an empty bar; `progress` moves it, but never back and never when no import
 * is running (a late message from an import that already ended must not bring the bar back); `finish` and `fail` both put it back to idle, so the
 * bar is gone and the button can be used again whichever way the import ended.
 */
export function importReducer(state, action) {
  switch (action.type) {
    case 'start':
      return { busy: true, progress: null };
    case 'progress':
      if (!state.busy || !action.progress) return state;
      if (state.progress && action.progress.percentage < state.progress.percentage) return state;
      return { busy: true, progress: action.progress };
    case 'finish':
    case 'fail':
      return IDLE_IMPORT;
    default:
      return state;
  }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The message after an import that ended well. `added` is the number of slides, 0 for a deck with only hidden slides, null if the picker was cancelled (no message). */
export function successMessage(added, destination) {
  if (added == null) return null;
  if (added > 0) return `Added ${plural(added, 'slide', 'slides')} to "${destination}".`;
  return 'That PowerPoint has no visible slides to import (hidden slides are skipped).';
}

/** The message after an import that failed: what went wrong, and what to try. */
export function failureMessage(reason) {
  const what = String(reason ?? '').trim() || 'The import did not finish.';
  return `PowerPoint import failed: ${what}\nNo slides were added. Close the file if it is open in PowerPoint, check that it is a .pptx or .ppt file that is not password protected, then try Import PowerPoint again.`;
}

/** The line next to the bar for the button: "Importing 4 / 12 slides…", or the stage's own words when no slide is being counted. */
export function importLabel(progress) {
  if (!progress) return 'Importing…';
  const files = progress.fileCount > 1 ? ` (file ${progress.fileIndex + 1} of ${progress.fileCount})` : '';
  if (progress.currentSlide > 0 && progress.totalSlides > 0) return `Importing ${progress.currentSlide} / ${progress.totalSlides} slides…${files}`;
  return `${progress.statusText}${files}`;
}
