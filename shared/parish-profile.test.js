// The parish profile's extra fields. Run with: node --test shared/parish-profile.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOptionalLine, checkRoster, parishSubtitle, sanitizeLogoScale, sanitizeOptionalLine, sanitizeRoster } from './parish-profile.js';

test('the logo size is a whole percent between 75 and 120', () => {
  assert.equal(sanitizeLogoScale(90.4), 90);
  assert.equal(sanitizeLogoScale(10), 75);
  assert.equal(sanitizeLogoScale(999), 120);
  assert.equal(sanitizeLogoScale('nope'), 100);
  assert.equal(sanitizeLogoScale(undefined), 100);
});

test('optional lines are tidied; blank is null; too long is refused when typed and cut when loaded', () => {
  assert.equal(sanitizeOptionalLine('  a   b ', 10), 'a b');
  assert.equal(sanitizeOptionalLine(' ', 10), null);
  assert.equal(sanitizeOptionalLine('abcdef', 3), 'abc');
  assert.equal(checkOptionalLine('', 5, 'diocese'), null);
  assert.throws(() => checkOptionalLine('abcdef', 5, 'diocese'), /diocese must be 5/);
});

test('the roster keeps order, drops blanks and repeats, and caps its size', () => {
  const roster = sanitizeRoster([
    { id: 'p1', name: 'Fr. Jose', role: 'Parish Priest' },
    { id: 'p2', name: 'fr. jose', role: 'parish priest' },
    { id: 'p3', name: 'Fr. Jose', role: 'Guest Priest' },
    { id: 'bad id!', name: 'Ana', role: '' },
  ]);
  assert.deepEqual(roster.map((r) => r.name), ['Fr. Jose', 'Fr. Jose', 'Ana']);
  assert.match(roster[2].id, /^r-/, 'an unusable id is replaced');
  assert.equal(sanitizeRoster(Array.from({ length: 50 }, (_, i) => ({ name: `P${i}` }))).length, 30);
  assert.throws(() => checkRoster([{ name: '', role: 'Commentator' }]), /Commentator/);
  assert.throws(() => checkRoster('x'), /could not be read/);
});

test('the nameplate subtitle joins the ministry and diocese', () => {
  assert.equal(parishSubtitle({ ministryName: 'Music Ministry', diocese: 'Archdiocese of Cebu' }), 'Music Ministry · Archdiocese of Cebu');
  assert.equal(parishSubtitle({ ministryName: 'Music Ministry', diocese: '' }), 'Music Ministry');
});
