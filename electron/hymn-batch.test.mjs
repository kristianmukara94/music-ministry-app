// Tests the batch song import's two ends in the main process: reading a Word or text file of many songs (with its checks), and saving
// many songs at once, where one refused song does not stop the rest. Run with: node --test electron/hymn-batch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { HYMN_DELETE_MIGRATIONS, LYRICS_MIGRATIONS, LYRICS_STYLE_MIGRATIONS, createLyricsService } = await import('./lyrics.js');
const { MASS_PLAN_MIGRATIONS, PLAN_BIBLE_MIGRATIONS, PLAN_COMMUNION_MIGRATIONS, PLAN_CUSTOM_MIGRATIONS, PLAN_LANGUAGE_MIGRATIONS, PLAN_NOTES_MIGRATIONS } = await import('./mass-plans.js');
const { PW_MIGRATIONS } = await import('./pw-sessions.js');
const { SONG_CATEGORY_MIGRATIONS, SONG_SCOPE_MIGRATIONS, createSongCategoryService } = await import('./song-categories.js');
const { TRANSFER_MIGRATIONS } = await import('./transfer.js');
const { PLAN_SYNC_MIGRATIONS } = await import('./plan-sync-schema.js');
const { readBatchFile } = await import('./lyrics-import.js');
const { splitSongs, songToTagged, effectiveTitle } = await import('../shared/song-batch.js');
const JSZip = createRequire(import.meta.url)('jszip');

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.transaction = (work) => (...args) => {
    db.exec('BEGIN');
    try {
      const result = work(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };
  for (const sqlText of [...LYRICS_MIGRATIONS, ...LYRICS_STYLE_MIGRATIONS, ...HYMN_DELETE_MIGRATIONS, ...MASS_PLAN_MIGRATIONS, ...PLAN_LANGUAGE_MIGRATIONS, ...PLAN_BIBLE_MIGRATIONS,
    ...PLAN_CUSTOM_MIGRATIONS, ...PLAN_NOTES_MIGRATIONS, ...PW_MIGRATIONS, ...PLAN_COMMUNION_MIGRATIONS, ...SONG_CATEGORY_MIGRATIONS, ...SONG_SCOPE_MIGRATIONS, ...TRANSFER_MIGRATIONS, ...PLAN_SYNC_MIGRATIONS]) {
    db.exec(sqlText);
  }
  createSongCategoryService(db).createSongCategory({ name: 'Praise' });
  return { db, service: createLyricsService(db) };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apcc-batch-'));
const file = (name, content) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);
  return p;
};

/** A real, minimal Word document: each entry is a paragraph, `{ text, style, bold }`. */
async function docx(name, paragraphs) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const body = paragraphs
    .map((p) => {
      const style = p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : '';
      const run = p.text ? `<w:r>${p.bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(p.text)}</w:t></w:r>` : '';
      return `<w:p>${style}${run}</w:p>`;
    })
    .join('');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return file(name, await zip.generateAsync({ type: 'nodebuffer' }));
}

test('a Word file of several songs is read with its headings, bold lines and blank lines, and comes apart into songs', async () => {
  const p = await docx('songs.docx', [
    { text: 'Here I Am, Lord', style: 'Heading1' },
    { text: 'Verse 1:' },
    { text: 'I, the Lord of sea and sky' },
    { text: '' },
    { text: 'Chorus:' },
    { text: 'Here I am, Lord. Is it I, Lord?' },
    { text: '' },
    { text: 'Be Not Afraid', bold: true },
    { text: '' },
    { text: 'You shall cross the barren desert' },
  ]);
  const read = await readBatchFile(p);
  assert.equal(read.fileName, 'songs.docx');
  assert.ok(read.size > 0);
  assert.equal(read.lines[0].heading, true);
  assert.equal(read.lines[7].bold, true);
  assert.equal(read.lines[3].text, '', 'an empty paragraph is kept as a blank line');
  const { songs } = splitSongs(read.lines);
  assert.deepEqual(songs.map((s) => s.title), ['Here I Am, Lord', 'Be Not Afraid']);
  assert.deepEqual(songs[0].stanzas.map((s) => s.type), ['Verse 1', 'Chorus']);
});

test('text files are read in UTF-8, UTF-16 and the older Windows encoding', async () => {
  const words = 'AWIT SA PAGSAMBA\n\nPurihin ang Panginoon — señor\n';
  assert.match((await readBatchFile(file('utf8.txt', words))).lines[2].text, /señor/);
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(words, 'utf16le')]);
  assert.match((await readBatchFile(file('utf16.txt', utf16))).lines[2].text, /señor/);
  const ansi = Buffer.from('Se\xf1or\n', 'latin1');
  assert.equal((await readBatchFile(file('ansi.txt', ansi))).lines[0].text, 'Señor');
});

test('a file of the wrong type, too large, empty, missing or damaged is refused with a reason', async () => {
  await assert.rejects(() => readBatchFile(file('songs.pdf', 'x')), /not a Word \(\.docx\) or text \(\.txt\) file/);
  await assert.rejects(() => readBatchFile(file('big.txt', Buffer.alloc(10 * 1024 * 1024 + 1, 97))), /at most 10 MB/);
  await assert.rejects(() => readBatchFile(file('empty.txt', '')), /is empty/);
  await assert.rejects(() => readBatchFile(file('blank.txt', '  \n\n ')), /No text was found/);
  await assert.rejects(() => readBatchFile(path.join(dir, 'gone.txt')), /no longer there/);
  await assert.rejects(() => readBatchFile(file('broken.docx', 'this is not a zip file')), /could not be read as a Word document/);
  await assert.rejects(() => readBatchFile(''), /No file was given/);
});

test('reviewed songs are saved at once; a refused one is reported and the rest are saved', () => {
  const { db, service } = setup();
  const { songs } = splitSongs([
    { text: 'AMAZING GRACE' }, { text: '' }, { text: 'Amazing grace how sweet the sound' }, { text: '' },
    { text: 'HOLY GOD' }, { text: '' }, { text: 'Holy God we praise Thy name' },
  ]);
  const input = (song, more = {}) => ({ title: effectiveTitle(song), composer: '', category: 'General', language: 'EN', musicalKey: '', songCategory: 'Praise', raw: songToTagged(song), ...more });
  const results = service.createHymns([input(songs[0]), input(songs[1], { songCategory: '' }), input(songs[1])]);
  assert.equal(results.length, 3);
  assert.equal(results[0].title, 'AMAZING GRACE');
  assert.ok(Number.isInteger(results[0].id));
  assert.match(results[1].error, /song category/);
  assert.ok(Number.isInteger(results[2].id));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM hymns').get().n, 2);
  assert.equal(service.getHymn(results[0].id).stanzas[0].lyricsText, 'Amazing grace how sweet the sound');
  assert.throws(() => service.createHymns('nope'), /No songs were given/);
});
