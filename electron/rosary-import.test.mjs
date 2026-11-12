// Tests the rosary's St. Michael prayer key and the two-step import: a preview that reports what would change and writes nothing,
// then an apply that writes the checked rows.
// Run with: node --test electron/rosary-import.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { ROSARY_MIGRATIONS, ROSARY_LITANY_MIGRATIONS, ROSARY_ST_MICHAEL_MIGRATIONS, createRosaryService, seedRosary } = await import('./rosary.js');
const { readAllRosary } = await import('./rosary-backup.js');

function setup(file) {
  const db = new DatabaseSync(':memory:');
  for (const sql of [...ROSARY_MIGRATIONS, ...ROSARY_LITANY_MIGRATIONS]) db.exec(sql);
  // node:sqlite has no .transaction(); the service only needs it to group writes.
  db.transaction = (fn) => (...args) => fn(...args);
  return {
    db,
    migrate: () => {
      for (const sql of ROSARY_ST_MICHAEL_MIGRATIONS) db.exec(sql);
    },
    service: () => createRosaryService(db, { showOpenDialog: async () => ({ canceled: false, filePaths: [file] }) }),
  };
}

const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rosary-import-')), 'backup.json');

test('the St. Michael migration keeps every prayer and its approval, and the seed then adds St. Michael', () => {
  const { db, migrate } = setup(null);
  db.exec("INSERT INTO rosary_prayers (key, text_en, approved_en) VALUES ('fatima', 'O my Jesus', 1)");
  assert.throws(() => db.exec("INSERT INTO rosary_prayers (key, text_en) VALUES ('st_michael', 'x')"));
  migrate();
  assert.deepEqual({ ...db.prepare("SELECT text_en, approved_en FROM rosary_prayers WHERE key = 'fatima'").get() }, { text_en: 'O my Jesus', approved_en: 1 });
  seedRosary(db);
  const michael = db.prepare("SELECT text_en, text_tl, approved_en FROM rosary_prayers WHERE key = 'st_michael'").get();
  assert.match(michael.text_en, /^St\. Michael the Archangel/);
  assert.equal(michael.text_tl, '');
  assert.equal(michael.approved_en, 0);
});

test('an import preview counts the changes and writes nothing until it is applied', async () => {
  const file = tempFile();
  const { db, migrate, service: make } = setup(file);
  migrate();
  seedRosary(db);
  const backup = readAllRosary(db);
  // Two text edits on one mystery, and three approval flags on a prayer.
  const annunciation = backup.rosary_mysteries.find((m) => m.mystery_type === 'joyful' && m.decade_number === 1);
  annunciation.meditation_tl = 'Bagong pagninilay.';
  annunciation.scripture_ref = 'Lucas 1:26-38';
  Object.assign(backup.rosary_prayers.find((p) => p.key === 'hail_mary'), { approved_en: 1, approved_tl: 1, approved_ceb: 1 });
  fs.writeFileSync(file, JSON.stringify(backup));

  const service = make();
  const preview = await service.previewImport(null);
  assert.equal(preview.mysteries, 20);
  assert.equal(preview.prayers, 8);
  assert.equal(preview.textEdits, 2);
  assert.equal(preview.approvalChanges, 3);
  assert.equal(preview.added, 0);
  assert.equal(preview.unchanged, 26);
  assert.equal(db.prepare("SELECT meditation_tl FROM rosary_mysteries WHERE mystery_type = 'joyful' AND decade_number = 1").get().meditation_tl.startsWith('Bagong'), false);

  const applied = service.applyImport(preview.token);
  assert.equal(applied.mysteries, 20);
  assert.equal(db.prepare("SELECT meditation_tl FROM rosary_mysteries WHERE mystery_type = 'joyful' AND decade_number = 1").get().meditation_tl, 'Bagong pagninilay.');
  assert.equal(db.prepare("SELECT approved_ceb FROM rosary_prayers WHERE key = 'hail_mary'").get().approved_ceb, 1);
  // A token works once.
  assert.throws(() => service.applyImport(preview.token), /expired/);
});

test('a cancelled preview cannot be applied, and a bad file is refused at the preview', async () => {
  const file = tempFile();
  const { db, migrate, service: make } = setup(file);
  migrate();
  seedRosary(db);
  fs.writeFileSync(file, JSON.stringify(readAllRosary(db)));
  const service = make();
  const preview = await service.previewImport(null);
  service.cancelImport(preview.token);
  assert.throws(() => service.applyImport(preview.token), /expired/);

  fs.writeFileSync(file, JSON.stringify({ format: 'apccmma-rosary', version: 1, rosary_mysteries: [{ mystery_type: 'joyful' }], rosary_prayers: [] }));
  await assert.rejects(() => service.previewImport(null), /decade_number/);
});
