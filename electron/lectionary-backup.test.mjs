// Tests for the lectionary backup and overview: a backup restores readings on another laptop, a file with any bad reading changes nothing,
// an import replaces the same date and slot and leaves the rest, and the overview counts what is saved. The schema is real and in memory.
// Run with: node --test electron/lectionary-backup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { LECTIONARY_ACCLAMATION_MIGRATIONS, LECTIONARY_MIGRATIONS, LECTIONARY_STYLE_MIGRATIONS, createLectionaryService } = await import('./lectionary.js');
const { BACKUP_FORMAT, BACKUP_VERSION, createLectionaryWriter, isCalendarDate, normalizeReading, parseBackup, readAllLectionary } = await import('./lectionary-backup.js');

function laptopDb() {
  const db = new DatabaseSync(':memory:');
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
  for (const sqlText of [...LECTIONARY_MIGRATIONS, ...LECTIONARY_STYLE_MIGRATIONS, ...LECTIONARY_ACCLAMATION_MIGRATIONS]) db.exec(sqlText);
  return db;
}

const reading = (over = {}) => ({
  liturgical_date: '2026-03-08',
  liturgical_season_info: '3rd Sunday of Lent',
  reading_type: 'First Reading',
  citation: 'Exodus 20:1-17',
  congregation_response: '',
  raw_text: 'A reading from the Book of Exodus.',
  style: null,
  ...over,
});
const backupOf = (rows) => ({ format: BACKUP_FORMAT, version: BACKUP_VERSION, lectionary_readings: rows });
const count = (db) => db.prepare('SELECT COUNT(*) AS n FROM lectionary_readings').get().n;

test('isCalendarDate accepts real dates and refuses impossible ones', () => {
  assert.equal(isCalendarDate('2026-03-08'), true);
  assert.equal(isCalendarDate('2024-02-29'), true);
  assert.equal(isCalendarDate('2026-02-29'), false);
  assert.equal(isCalendarDate('2026-02-30'), false);
  assert.equal(isCalendarDate('2026-13-01'), false);
  assert.equal(isCalendarDate('8 March 2026'), false);
  assert.equal(isCalendarDate(20260308), false);
});

test('a reading is cleaned: text is trimmed, and only the psalm keeps a congregation response', () => {
  const first = normalizeReading(reading({ raw_text: '  Hear, O Israel.  ', congregation_response: 'Ignored' }));
  assert.equal(first.raw_text, 'Hear, O Israel.');
  assert.equal(first.congregation_response, '');
  const psalm = normalizeReading(reading({ reading_type: 'Responsorial Psalm', congregation_response: ' Lord, you have the words of everlasting life. ' }));
  assert.equal(psalm.congregation_response, 'Lord, you have the words of everlasting life.');
});

test('a reading with a bad field is refused with a message that says which one', () => {
  assert.throws(() => normalizeReading(reading({ liturgical_date: '2026-02-30' })), /liturgical_date/);
  assert.throws(() => normalizeReading(reading({ reading_type: 'Homily' })), /reading_type/);
  assert.throws(() => normalizeReading(reading({ raw_text: '   ' })), /raw_text.*empty/);
  assert.throws(() => normalizeReading(reading({ raw_text: undefined })), /raw_text.*missing/);
  assert.throws(() => normalizeReading(reading({ citation: 'x'.repeat(161) })), /citation.*160/);
  assert.throws(() => normalizeReading(reading({ raw_text: 'x'.repeat(20001) })), /raw_text.*20000/);
  assert.throws(() => normalizeReading(reading({ citation: 5 })), /citation.*text/);
  assert.throws(() => normalizeReading(null), /not an object/);
});

test('a style keeps only what the editor would keep', () => {
  const clean = normalizeReading(reading({ style: { textColor: '#ffffff', fontSize: 'enormous', nonsense: true } }));
  assert.ok(clean.style === null || typeof clean.style === 'object');
  assert.equal(clean.style?.nonsense, undefined);
  assert.equal(normalizeReading(reading({ style: 'not an object' })).style, null);
});

test('a file that is not a lectionary backup, or is another version, is refused', () => {
  assert.throws(() => parseBackup(null), /not a lectionary backup/);
  assert.throws(() => parseBackup([]), /not a lectionary backup/);
  assert.throws(() => parseBackup({ format: 'apccmma-rosary', version: 1 }), /not a lectionary backup/);
  assert.throws(() => parseBackup({ format: BACKUP_FORMAT, version: 2, lectionary_readings: [] }), /version 2/);
  assert.throws(() => parseBackup({ format: BACKUP_FORMAT, version: BACKUP_VERSION }), /missing its list/);
});

test('the same date and slot twice in one file is refused', () => {
  assert.throws(() => parseBackup(backupOf([reading(), reading({ raw_text: 'Another text.' })])), /Reading 2.*appears twice/);
  assert.doesNotThrow(() => parseBackup(backupOf([reading(), reading({ reading_type: 'Gospel' })])));
});

test('a backup restores readings, labels, psalm responses and styles on another laptop', () => {
  const source = laptopDb();
  const service = createLectionaryService(source);
  service.saveReading({ date: '2026-03-08', readingType: 'First Reading', seasonInfo: '3rd Sunday of Lent', citation: 'Exodus 20:1-17', rawText: 'A reading from the Book of Exodus.' });
  service.saveReading({ date: '2026-03-08', readingType: 'Responsorial Psalm', seasonInfo: '3rd Sunday of Lent', citation: 'Psalm 19', congregationResponse: 'Lord, you have the words of everlasting life.', rawText: 'The law of the Lord is perfect.', style: { textColor: '#ffffff' } });
  service.saveReading({ date: '2026-03-15', readingType: 'Gospel', seasonInfo: '4th Sunday of Lent', rawText: 'A reading from the holy Gospel.' });

  const file = JSON.parse(JSON.stringify(readAllLectionary(source)));
  assert.equal(file.format, BACKUP_FORMAT);
  assert.equal(file.lectionary_readings.length, 3);

  const target = laptopDb();
  createLectionaryWriter(target).write(parseBackup(file));
  const restored = createLectionaryService(target);
  assert.deepEqual(restored.getDay('2026-03-08'), service.getDay('2026-03-08'));
  assert.deepEqual(restored.getDay('2026-03-15'), service.getDay('2026-03-15'));
});

test('a file with any bad reading changes nothing', () => {
  const db = laptopDb();
  const service = createLectionaryService(db);
  service.saveReading({ date: '2026-03-08', readingType: 'First Reading', rawText: 'Keep this.' });
  const file = backupOf([reading({ reading_type: 'Gospel', raw_text: 'Good row.' }), reading({ liturgical_date: '2026-02-30', reading_type: 'Second Reading' })]);
  assert.throws(() => parseBackup(file), /Reading 2/);
  assert.equal(count(db), 1);
  assert.equal(service.getDay('2026-03-08').readings.find((r) => r.readingType === 'First Reading').rawText, 'Keep this.');
});

test('an import replaces the same date and slot, adds new ones, and leaves the others alone', () => {
  const db = laptopDb();
  const service = createLectionaryService(db);
  service.saveReading({ date: '2026-03-08', readingType: 'First Reading', citation: 'Old', rawText: 'Old text.' });
  service.saveReading({ date: '2026-03-08', readingType: 'Gospel', rawText: 'Untouched gospel.' });

  createLectionaryWriter(db).write(parseBackup(backupOf([reading({ citation: 'New', raw_text: 'New text.' }), reading({ liturgical_date: '2026-03-15', reading_type: 'Gospel', raw_text: 'Added gospel.' })])));

  const day = service.getDay('2026-03-08');
  assert.equal(day.readings.find((r) => r.readingType === 'First Reading').rawText, 'New text.');
  assert.equal(day.readings.find((r) => r.readingType === 'First Reading').citation, 'New');
  assert.equal(day.readings.find((r) => r.readingType === 'Gospel').rawText, 'Untouched gospel.');
  assert.equal(service.getDay('2026-03-15').readings.find((r) => r.readingType === 'Gospel').rawText, 'Added gospel.');
  assert.equal(count(db), 3);
});

test('the overview counts the library and lists the slots saved in the range', () => {
  const db = laptopDb();
  const service = createLectionaryService(db);
  service.saveReading({ date: '2026-03-08', readingType: 'First Reading', seasonInfo: '3rd Sunday of Lent', rawText: 'a' });
  service.saveReading({ date: '2026-03-08', readingType: 'Gospel', seasonInfo: '3rd Sunday of Lent', rawText: 'b' });
  service.saveReading({ date: '2026-03-15', readingType: 'Gospel', rawText: 'c' });
  service.saveReading({ date: '2027-01-03', readingType: 'Gospel', rawText: 'd' });

  const overview = service.overview('2026-03-01', '2026-03-31');
  assert.equal(overview.readings, 4);
  assert.equal(overview.days, 3);
  assert.equal(overview.earliest, '2026-03-08');
  assert.equal(overview.latest, '2027-01-03');
  assert.equal(overview.bySlot.Gospel, 3);
  assert.equal(overview.bySlot['First Reading'], 1);
  assert.equal(overview.bySlot['Second Reading'], 0);
  assert.deepEqual(overview.range.map((d) => d.date), ['2026-03-08', '2026-03-15']);
  assert.equal(overview.range[0].seasonInfo, '3rd Sunday of Lent');
  assert.deepEqual([...overview.range[0].slots].sort(), ['First Reading', 'Gospel']);
  assert.deepEqual(overview.range[1], { date: '2026-03-15', seasonInfo: '', slots: ['Gospel'] });
});

test('an overview of an empty library is empty, and a bad range is refused', () => {
  const service = createLectionaryService(laptopDb());
  assert.deepEqual(service.overview('2026-01-01', '2026-12-31'), {
    readings: 0, days: 0, earliest: null, latest: null,
    bySlot: { 'First Reading': 0, 'Responsorial Psalm': 0, 'Second Reading': 0, 'Gospel Acclamation': 0, Gospel: 0 }, range: [],
  });
  assert.throws(() => service.overview('2026-03-31', '2026-03-01'), /after the end/);
  assert.throws(() => service.overview('2026-02-30', '2026-03-01'), /real dates/);
  assert.throws(() => service.overview('2020-01-01', '2026-01-01'), /400 days/);
});

test('export writes the file and import reads it back; cancelling does nothing; a broken file says so', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-lect-'));
  try {
    const file = path.join(dir, 'backup.json');
    const source = laptopDb();
    const exporter = createLectionaryService(source, { showSaveDialog: async () => ({ canceled: false, filePath: file }) });
    exporter.saveReading({ date: '2026-03-08', readingType: 'Gospel', rawText: 'A reading from the holy Gospel.' });
    assert.deepEqual(await exporter.exportBackup(null), { path: file, readings: 1 });

    const cancelled = createLectionaryService(source, { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }) });
    assert.equal(await cancelled.exportBackup(null), null);
    assert.equal(await cancelled.importBackup(null), null);

    const target = laptopDb();
    const importer = createLectionaryService(target, { showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) });
    assert.deepEqual(await importer.importBackup(null), { path: file, readings: 1 });
    assert.equal(importer.getDay('2026-03-08').readings.find((r) => r.readingType === 'Gospel').rawText, 'A reading from the holy Gospel.');

    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{ not json');
    const failing = createLectionaryService(laptopDb(), { showOpenDialog: async () => ({ canceled: false, filePaths: [broken] }) });
    await assert.rejects(() => failing.importBackup(null), /not valid JSON/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
