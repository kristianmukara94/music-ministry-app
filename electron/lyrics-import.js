import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { cleanLyricText, splitSongSheet } from '../shared/lyrics-import.js';
import { BATCH_FILE_TYPES, linesFromDocxHtml, linesFromText, MAX_BATCH_FILE_BYTES } from '../shared/song-batch.js';

const FILE_TYPES = ['pdf', 'docx', 'txt'];

/** Word's HTML from mammoth, as plain lines: each paragraph ends a line, an empty paragraph is a blank line, <br> breaks a line. */
function textFromDocxHtml(html) {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Reads the lyrics in one file. The title comes from its first line when that is a short title, otherwise from the file
 * name. Nothing is saved here: the operator checks the result in the Create Hymn form first.
 */
export async function readLyricsFile(filePath, { convertPdf }) {
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  let raw;

  if (ext === 'pdf') {
    const pages = await convertPdf(filePath, 'lyrics');
    raw = cleanLyricText(pages.map((page) => page.text).join('\n\n'));
    if (!raw) throw new Error(`${fileName} has no text to read. If it is a scan or a photo, type or paste the lyrics instead.`);
  } else if (ext === 'docx') {
    const { value } = await mammoth.convertToHtml({ path: filePath });
    raw = cleanLyricText(textFromDocxHtml(value));
  } else if (ext === 'txt') {
    raw = cleanLyricText((await fs.promises.readFile(filePath, 'utf8')).replace(/^﻿/, ''));
  } else {
    throw new Error(`Choose a PDF, Word (.docx) or text (.txt) file. ${fileName} is not one of those.`);
  }

  if (!raw) throw new Error(`No text was found in ${fileName}.`);

  const sheet = splitSongSheet(raw);
  if (!sheet.raw) throw new Error(`No lyrics were found in ${fileName}. Only the title and credit lines are there.`);
  return {
    fileName,
    title: sheet.title || path.parse(fileName).name,
    raw: sheet.raw,
  };
}

/** A text file's words. UTF-8 is expected; a file saved as UTF-16 or in the older Windows encoding is read as what it is. */
function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
}

/**
 * Reads a Word (.docx) or text (.txt) file that holds many songs, as lines, for the batch import to take apart. Word's headings and bold
 * lines are marked, as they are how song titles are usually set. The file is checked first: its type, that it is there, and its size.
 * Resolves to `{ fileName, size, lines }`.
 */
export async function readBatchFile(filePath) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('No file was given.');
  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (!BATCH_FILE_TYPES.includes(ext)) throw new Error(`${fileName} is not a Word (.docx) or text (.txt) file. Choose one of those.`);
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    throw new Error(`${fileName} is no longer there. It may have been moved or deleted.`);
  }
  if (!stat.isFile()) throw new Error(`${fileName} is not a file.`);
  if (stat.size > MAX_BATCH_FILE_BYTES) {
    throw new Error(`${fileName} is ${(stat.size / 1024 / 1024).toFixed(1)} MB. A file can be at most ${MAX_BATCH_FILE_BYTES / 1024 / 1024} MB.`);
  }
  if (stat.size === 0) throw new Error(`${fileName} is empty.`);

  let lines;
  if (ext === 'docx') {
    try {
      // Empty paragraphs are kept: they are the blank lines between verses and songs.
      const { value } = await mammoth.convertToHtml({ path: filePath }, { ignoreEmptyParagraphs: false });
      lines = linesFromDocxHtml(value);
    } catch (err) {
      throw new Error(`${fileName} could not be read as a Word document. It may be damaged, or be an older .doc file saved with a .docx name. Open it in Word and save it again as .docx. (${err.message})`);
    }
  } else {
    lines = linesFromText(decodeText(await fs.promises.readFile(filePath)));
  }
  if (!lines.some((l) => l.text.trim())) throw new Error(`No text was found in ${fileName}.`);
  return { fileName, size: stat.size, lines };
}

/**
 * Registers 'lyrics:importFile'. The main process opens the file dialog itself, so the renderer never sends a path.
 * Resolves to null when the operator cancels.
 */
export function registerLyricsImport(convertPdf) {
  ipcMain.handle('lyrics:importFile', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Import lyrics',
      properties: ['openFile'],
      filters: [{ name: 'Lyrics', extensions: FILE_TYPES }],
    };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return readLyricsFile(picked.filePaths[0], { convertPdf });
  });

  // 'lyrics:readBatchFile': reads a file of many songs, from its path (a file dropped on the window, or one chosen in the picker).
  ipcMain.handle('lyrics:readBatchFile', (_event, filePath) => readBatchFile(filePath));
  // 'lyrics:pickBatchFile': the file picker for a file of many songs. Resolves to its path, or null when the operator cancels.
  ipcMain.handle('lyrics:pickBatchFile', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Import songs from a file',
      properties: ['openFile'],
      filters: [{ name: 'Word or text', extensions: BATCH_FILE_TYPES }],
    };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0];
  });
}
