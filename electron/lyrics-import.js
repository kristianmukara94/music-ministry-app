import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import mammoth from 'mammoth';
import { cleanLyricText, splitSongSheet } from '../shared/lyrics-import.js';

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
}
