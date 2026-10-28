// The start-up database check reports real counts, and reports a table an old backup lacks as missing rather than zero. Run with:
// node --test electron/db-check.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync as Database } from 'node:sqlite';
import { databaseCounts } from './db-check.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-db-check-'));

test('the counts are the real rows, and a table the backup lacks is missing', () => {
  const db = new Database(path.join(dir, 'restored.db'));
  try {
    db.exec('CREATE TABLE hymns (id INTEGER PRIMARY KEY); INSERT INTO hymns (id) VALUES (1), (2), (3);');
    db.exec('CREATE TABLE mass_plans (id INTEGER PRIMARY KEY);');
    assert.deepEqual(databaseCounts(db), {
      hymns: 3,
      massPlans: 0,
      massPlanItems: 'missing',
      pwSessions: 'missing',
    });
  } finally {
    db.close();
  }
});

test('an empty file with no tables reports every count as missing, and does not throw', () => {
  const db = new Database(path.join(dir, 'empty.db'));
  try {
    assert.deepEqual(Object.values(databaseCounts(db)), ['missing', 'missing', 'missing', 'missing']);
  } finally {
    db.close();
  }
});
