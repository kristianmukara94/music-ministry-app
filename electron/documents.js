import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { slideParts } from './pptx-html.js';

/**
 * Text documents become projector-ready slides. A page holds at most this many body characters, about
 * three or four short lines, so the text stays large enough to read from the back of the church. The
 * import runs in the main process, where the layout cannot be measured, so this is a fixed budget. The
 * operator can still edit any page in the text-slide editor.
 */
export const MAX_BODY_CHARS = 180;

/** Document types the import routes here. `.ppt` is listed so it gets a clear refusal, not a silent skip. */
export const DOCUMENT_EXTENSIONS = ['.docx', '.txt', '.pptx', '.ppt'];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Breaks one paragraph into word-sized chunks no longer than `max`. Short text comes back unchanged. */
function chunkText(text, max) {
  if (text.length <= max) return [text];
  const chunks = [];
  let current = '';
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (word.length > max) {
      // A single word longer than a page is cut as it is. This is rare, and it stays readable.
      if (current) chunks.push(current);
      for (let i = 0; i < word.length; i += max) chunks.push(word.slice(i, i + max));
      current = '';
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > max) {
      chunks.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Packs one section's paragraphs into body pages, each at most MAX_BODY_CHARS. Lines are kept whole where
 * possible. The section title is not in the body: it is shown as the slide headline instead.
 */
export function paginateSection(paragraphs) {
  const lines = paragraphs.flatMap((p) => chunkText(p, MAX_BODY_CHARS));
  const pages = [];
  let body = [];
  let size = 0;
  for (const line of lines) {
    const cost = line.length + 1;
    if (body.length > 0 && size + cost > MAX_BODY_CHARS) {
      pages.push(body.join('\n'));
      body = [];
      size = 0;
    }
    body.push(line);
    size += cost;
  }
  if (body.length > 0) pages.push(body.join('\n'));
  return pages;
}

/**
 * Turns a list of sections (`{ title, paragraphs, notes }`) into slide pages, in order. Each page has its
 * headline (`title`, null when the section has none), its `body`, and the section's speaker notes, which
 * every page of the section carries. A heading with no body still makes one title-only slide.
 */
export function sectionsToPages(sections) {
  return sections
    .flatMap((s) => {
      const bodies = paginateSection(s.paragraphs);
      if (bodies.length === 0 && s.title) bodies.push('');
      return bodies.map((body) => ({ title: s.title ?? null, body, notes: s.notes ?? null }));
    })
    .filter((page) => page.title || page.body.trim());
}

/** Parses the HTML that mammoth produces. Headings start a new section. Paragraphs and list items are body text. */
export function sectionsFromHtml(html) {
  const sections = [];
  let current = { title: null, paragraphs: [] };
  const blockPattern = /<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const match of html.matchAll(blockPattern)) {
    const [, tag, inner] = match;
    const text = decodeEntities(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim();
    if (!text) continue;
    if (/^h[1-6]$/i.test(tag)) {
      if (current.title !== null || current.paragraphs.length > 0) sections.push(current);
      current = { title: text.replace(/\s*\n\s*/g, ' '), paragraphs: [] };
    } else {
      current.paragraphs.push(text);
    }
  }
  if (current.title !== null || current.paragraphs.length > 0) sections.push(current);
  return sections;
}

/** A plain-text file: blank lines separate paragraphs, and single line breaks inside a paragraph are kept (prayers keep their lines). */
export function sectionsFromText(raw) {
  const paragraphs = raw
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return [{ title: null, paragraphs }];
}

/** A shape the author hid in PowerPoint (Selection Pane → hidden). It is not shown in the slideshow, so it is not imported. */
const isHiddenShape = (shape) => /<p:cNvPr\b[^>]*\bhidden="(?:1|true)"/.test(shape);

/**
 * The visible text of one shape, one line per paragraph. Only `<a:t>` text nodes count. A `<a:br/>` line break inside a
 * paragraph starts a new line, so "Hello<br/>World" stays two lines rather than running together.
 */
function linesOfShape(shape) {
  if (isHiddenShape(shape)) return [];
  const lines = [];
  for (const para of shape.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
    let text = '';
    for (const token of para[1].matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>|<a:br\b[^>]*\/?>/g)) {
      text += token[1] !== undefined ? decodeEntities(token[1]) : '\n';
    }
    for (const line of text.split('\n').map((s) => s.trim())) {
      if (line) lines.push(line);
    }
  }
  return lines;
}

/** A PowerPoint slide's XML: its title placeholder, and the text of every other shape, paragraph by paragraph. */
export function sectionFromSlideXml(xml) {
  let title = null;
  const paragraphs = [];
  // Text shapes, and graphic frames (tables, whose cells hold their text in the same <a:p> paragraphs), in slide order.
  for (const shape of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>|<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g)) {
    const body = shape[0];
    const lines = linesOfShape(body);
    if (lines.length === 0) continue;
    if (/<p:ph\b[^>]*type="(?:title|ctrTitle)"/.test(body) && title === null) title = lines.join(' ');
    else paragraphs.push(...lines);
  }
  return { title, paragraphs };
}

// Placeholders on a notes page that hold no speaker text: the slide thumbnail, the slide number, and the header, footer and date.
const NOTES_SKIPPED_PLACEHOLDER = /<p:ph\b[^>]*type="(?:sldImg|sldNum|hdr|ftr|dt)"/;

/** The speaker notes in a notes slide's XML: the text of its body shapes. Null when there is none. */
export function notesFromNotesXml(xml) {
  const lines = [];
  for (const shape of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
    if (NOTES_SKIPPED_PLACEHOLDER.test(shape[0])) continue;
    lines.push(...linesOfShape(shape[0]));
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

/** The `Type` and `Target` of each entry in a `.rels` file. */
function relationshipsOf(xml) {
  return [...xml.matchAll(/<Relationship\b([^>]*)>/g)].map((m) => ({
    type: /\bType="([^"]*)"/.exec(m[1])?.[1] ?? '',
    target: /\bTarget="([^"]*)"/.exec(m[1])?.[1] ?? '',
  }));
}

/**
 * The speaker notes of one slide. The slide's relationships file, `ppt/slides/_rels/slideN.xml.rels`, names its
 * notes slide, normally `../notesSlides/notesSlideN.xml` relative to the slides folder. Null if the slide has no notes.
 */
export async function readSlideNotes(zip, slideName) {
  const relsFile = zip.file(slideName.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels'));
  if (!relsFile) return null;
  const rel = relationshipsOf(await relsFile.async('string')).find((r) => /\/notesSlide$/.test(r.type));
  if (!rel) return null;
  // An absolute target starts at the package root. A relative one starts at the slides folder.
  const target = rel.target.startsWith('/') ? rel.target.slice(1) : path.posix.join('ppt/slides', rel.target);
  const notesFile = zip.file(path.posix.normalize(target));
  return notesFile ? notesFromNotesXml(await notesFile.async('string')) : null;
}

async function sectionsFromDocx(filePath) {
  const { value: html } = await mammoth.convertToHtml({ path: filePath });
  return sectionsFromHtml(html);
}

/**
 * Every slide of a PowerPoint file in slide order, each as `{ title, paragraphs, notes }`. Empty slides are kept, so
 * slide N here is slide N of the deck. That is what lets a rendered page be matched to its notes.
 */
export async function readPptxSlides(filePath) {
  const zip = await JSZip.loadAsync(await fs.promises.readFile(filePath));
  // The order the presentation lists them in, which differs from the file numbers once slides have been moved.
  const slides = (await slideParts(zip)).map((name) => ({ name }));
  if (slides.length === 0) throw new Error('This PowerPoint file has no slides.');

  const result = [];
  for (const slide of slides) {
    const xml = await zip.files[slide.name].async('string');
    const section = sectionFromSlideXml(xml);
    // PowerPoint stores "hidden" on the slide element itself: <p:sld show="0">.
    const hidden = /<p:sld\b[^>]*\bshow="0"/.test(xml);
    result.push({ title: section.title, paragraphs: section.paragraphs, notes: await readSlideNotes(zip, slide.name), hidden });
  }
  return result;
}

async function sectionsFromPptx(filePath) {
  return (await readPptxSlides(filePath)).filter((s) => s.title !== null || s.paragraphs.length > 0);
}

/**
 * PowerShell that exports every slide through Microsoft PowerPoint itself, at 1920x1080, so templates, fonts, and graphics
 * come out as PowerPoint draws them. The source and output folder come in environment variables. PowerPoint is closed
 * only when this script opened it on its own, so a deck the operator has open is left alone.
 */
const POWERPOINT_EXPORT = [
  "$ProgressPreference = 'SilentlyContinue'",
  "$ErrorActionPreference = 'Stop'",
  '$source = $env:APCCMMA_PPT_SOURCE',
  '$out = $env:APCCMMA_PPT_OUT',
  '$app = New-Object -ComObject PowerPoint.Application',
  'try {',
  '  # Silent background export: no window, and no alert dialogs that could block it. Some builds refuse these settings,',
  '  # and the export still works without them, so a refusal is ignored.',
  '  try { $app.Visible = 0 } catch { }',
  '  try { $app.DisplayAlerts = 1 } catch { }',
  '  $pres = $app.Presentations.Open($source, -1, 0, 0)',
  '  try {',
  '    $exported = 0',
  '    for ($i = 1; $i -le $pres.Slides.Count; $i++) {',
  '      $slide = $pres.Slides.Item($i)',
  '      # Hidden slides are drafts or spares, and are left out of the deck. msoFalse is 0.',
  '      if ($slide.SlideShowTransition.Hidden -eq 0) {',
  '        $exported++',
  "        $slide.Export((Join-Path $out ('slide_{0}.jpg' -f $exported)), 'JPG', 1920, 1080)",
  '      }',
  '    }',
  '    Write-Output $exported',
  '  } finally {',
  '    $pres.Close()',
  '  }',
  '} finally {',
  '  if ($app.Presentations.Count -eq 0) { $app.Quit() }',
  '  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null',
  '}',
].join('\n');

/**
 * Renders each slide of a deck with Microsoft PowerPoint (Windows only). Resolves to one JPEG buffer per slide, in
 * visible slide order. Hidden slides are skipped. Rejects with the reason PowerPoint gave.
 */
// COM start failures that a second attempt can clear: PowerPoint starts on the first call, and that first start can fail.
const RETRYABLE_COM = /CO_E_SERVER_EXEC_FAILURE|Server execution failed|COM class factory/i;

const POWERPOINT_EXE = [
  'C:/Program Files/Microsoft Office/root/Office16/POWERPNT.EXE',
  'C:/Program Files (x86)/Microsoft Office/root/Office16/POWERPNT.EXE',
];

/**
 * Exports the slides once. If the COM server did not start, PowerPoint is started in automation mode (no window), given
 * time to register, and the export is tried once more. A PowerPoint started for the retry is closed afterwards. Any other
 * error is raised at once.
 */
export async function renderWithPowerPoint(source, outDir, timeoutMs = 300_000) {
  try {
    return await exportWithPowerPoint(source, outDir, timeoutMs);
  } catch (err) {
    if (!RETRYABLE_COM.test(err.message)) throw err;
    console.warn('[pptx] PowerPoint did not start for automation. Starting it and trying once more.');
    const exe = POWERPOINT_EXE.find((p) => fs.existsSync(p));
    const started = exe ? spawn(exe, ['/automation'], { windowsHide: true, stdio: 'ignore' }) : null;
    try {
      await new Promise((resolve) => setTimeout(resolve, 10_000));
      return await exportWithPowerPoint(source, outDir, timeoutMs);
    } finally {
      if (started && !started.killed) started.kill();
    }
  }
}

async function exportWithPowerPoint(source, outDir, timeoutMs) {
  const encoded = Buffer.from(POWERPOINT_EXPORT, 'utf16le').toString('base64');
  const env = { ...process.env, APCCMMA_PPT_SOURCE: source, APCCMMA_PPT_OUT: outDir };
  const stdout = await new Promise((resolve, reject) => {
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded];
    execFile('powershell.exe', args, { env, timeout: timeoutMs, windowsHide: true }, (err, out, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)));
      resolve(String(out));
    });
  });
  const count = Number(stdout.match(/(\d+)\s*$/)?.[1]);
  if (!count) throw new Error('PowerPoint did not report a slide count.');
  const files = Array.from({ length: count }, (_, i) => path.join(outDir, `slide_${i + 1}.jpg`));
  return Promise.all(files.map((file) => fs.promises.readFile(file)));
}

// Where LibreOffice is usually installed. APCCMMA_SOFFICE, if set, is tried first.
const SOFFICE_CANDIDATES = [
  'C:/Program Files/LibreOffice/program/soffice.exe',
  'C:/Program Files (x86)/LibreOffice/program/soffice.exe',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice',
  '/usr/bin/libreoffice',
];
let sofficePath;

/** The LibreOffice binary, or null when none is installed. The answer is remembered for the session. */
export function findSoffice() {
  if (sofficePath !== undefined) return sofficePath;
  sofficePath = [process.env.APCCMMA_SOFFICE, ...SOFFICE_CANDIDATES].find((p) => p && fs.existsSync(p)) ?? null;
  return sofficePath;
}

/**
 * Converts a PowerPoint file to PDF with LibreOffice, headless, into `outDir`. LibreOffice runs with its own profile
 * folder, so an open LibreOffice window on the same computer does not block the conversion.
 */
export function pptxToPdf(filePath, outDir, timeoutMs = 180_000) {
  const soffice = findSoffice();
  if (!soffice) return Promise.reject(new Error('LibreOffice is not installed.'));
  const profile = pathToFileURL(path.join(outDir, 'profile')).href;
  return new Promise((resolve, reject) => {
    const args = ['--headless', '--norestore', `-env:UserInstallation=${profile}`, '--convert-to', 'pdf', '--outdir', outDir, filePath];
    execFile(soffice, args, { timeout: timeoutMs, windowsHide: true }, (err, _stdout, stderr) => {
      if (err) return reject(new Error(`LibreOffice could not convert the slides: ${String(stderr || err.message).trim().slice(0, 300)}`));
      const pdf = path.join(outDir, `${path.basename(filePath, path.extname(filePath))}.pdf`);
      if (!fs.existsSync(pdf)) return reject(new Error('LibreOffice did not write a PDF.'));
      resolve(pdf);
    });
  });
}

/**
 * Reads a document into slide pages, in reading order. Each page is `{ title, body, notes }`: the headline
 * (null when there is none), the body text, and the speaker notes of its PowerPoint slide (null for other
 * formats, or when the slide has none). Throws a message the operator can read when the file cannot be read.
 */
export async function readDocumentPages(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.ppt') {
    throw new Error('Older .ppt files cannot be read. Open the file in PowerPoint and save it as .pptx, then import again.');
  }
  let sections;
  try {
    if (ext === '.docx') sections = await sectionsFromDocx(filePath);
    else if (ext === '.pptx') sections = await sectionsFromPptx(filePath);
    else if (ext === '.txt') sections = sectionsFromText(await fs.promises.readFile(filePath, 'utf8'));
    else throw new Error('Only .docx, .txt, .pptx, and .pdf files can be imported here.');
  } catch (err) {
    if (err.message.startsWith('This PowerPoint') || err.message.startsWith('Only .docx')) throw err;
    throw new Error(`Could not read ${path.basename(filePath)}. The file may be damaged or password-protected.`);
  }
  const pages = sectionsToPages(sections);
  if (pages.length === 0) throw new Error(`${path.basename(filePath)} has no text to show.`);
  return pages;
}
