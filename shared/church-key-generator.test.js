import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { KEY_CHARSET, generateChurchCode, generateSetupKey, validateChurchCode, validateSetupKey } from './church-key-generator.js';

const SALT = 'apccmma-sanctuary-master-salt-2026';
const C = `[${KEY_CHARSET}]`;
const SETUP_FORM = new RegExp(`^${C}{4}-${C}{4}-${C}{4}$`);
const CODE_FORM = new RegExp(`^${C}{4}-${C}{4}$`);

/** The check character worked out here, independently of the module. */
const expectedCheck = (payload) => KEY_CHARSET[createHmac('sha256', SALT).update(payload).digest().readUInt32BE(0) % 31];

/** The same text with its last character swapped for each other character in the set. */
const withOtherLastChars = (text) => [...KEY_CHARSET].filter((c) => c !== text.at(-1)).map((c) => text.slice(0, -1) + c);

test('the character set has no look-alikes and no repeats', () => {
  assert.equal(new Set(KEY_CHARSET).size, KEY_CHARSET.length);
  assert.equal(KEY_CHARSET.length, 31);
  for (const c of '01OIL') assert.equal(KEY_CHARSET.includes(c), false, c);
});

test('generated setup keys have the right form and pass their own check', () => {
  for (let i = 0; i < 500; i += 1) {
    const key = generateSetupKey();
    assert.match(key, SETUP_FORM);
    assert.equal(validateSetupKey(key), true);
  }
});

test('generated church codes have the right form and pass their own check', () => {
  for (let i = 0; i < 500; i += 1) {
    const code = generateChurchCode();
    assert.match(code, CODE_FORM);
    assert.equal(validateChurchCode(code), true);
  }
});

test('the character set is exactly the agreed 31 characters', () => {
  assert.equal(KEY_CHARSET, '23456789ABCDEFGHJKMNPQRSTUVWXYZ');
});

test('the check character is the salted HMAC-SHA256 of the payload, modulo 31', () => {
  const key = generateSetupKey().replace(/-/g, '');
  const code = generateChurchCode('PTGS').replace(/-/g, '');
  assert.equal(key.at(-1), expectedCheck(key.slice(0, -1)));
  assert.equal(code.at(-1), expectedCheck(code.slice(0, -1)));
});

test('a key the desktop key generator issued is accepted', () => {
  assert.equal(validateSetupKey('F3ZP-FDQQ-CB9E'), true);
  assert.equal(validateSetupKey('F3ZP-FDQQ-CB9H'), false);
});

test('the key generator tool carries an exact copy of this module', () => {
  const lines = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(
    lines('../tools/church-admin-key-generator/church-key-generator.mjs'),
    lines('./church-key-generator.js'),
    'Run "npm run sync:generator" in tools/church-admin-key-generator.',
  );
});

test('every wrong check character is refused', () => {
  const key = generateSetupKey();
  const code = generateChurchCode();
  for (const wrong of withOtherLastChars(key)) assert.equal(validateSetupKey(wrong), false, wrong);
  for (const wrong of withOtherLastChars(code)) assert.equal(validateChurchCode(wrong), false, wrong);
});

test('every character of the set can be the check character', () => {
  const seen = new Set(Array.from({ length: 5000 }, () => generateSetupKey().at(-1)));
  assert.equal(seen.size, 31);
});

test('case, spaces and dashes do not matter when checking', () => {
  const key = generateSetupKey();
  assert.equal(validateSetupKey(key.toLowerCase()), true);
  assert.equal(validateSetupKey(key.replace(/-/g, ' ')), true);
  assert.equal(validateSetupKey(key.replace(/-/g, '')), true);
  assert.equal(validateChurchCode(` ${generateChurchCode().toLowerCase()} `), true);
});

test('wrong lengths, look-alikes and values that are not text are refused', () => {
  const key = generateSetupKey();
  for (const bad of ['', 'ABCD', key.slice(0, -1), `${key}A`, key.replace(/^./, '0'), key.replace(/^./, 'L'), null, undefined, 12345, {}, []]) {
    assert.equal(validateSetupKey(bad), false, String(bad));
    assert.equal(validateChurchCode(bad), false, String(bad));
  }
});

test('a setup key and a church code are told apart by length', () => {
  assert.equal(validateSetupKey(generateChurchCode()), false);
  assert.equal(validateChurchCode(generateSetupKey()), false);
  assert.equal(validateChurchCode(`PTGS-X2D${expectedCheck('PTGSX2D')}`), true);
});

test('no prefix and an empty prefix both give a random code', () => {
  for (const prefix of [undefined, null, '']) assert.match(generateChurchCode(prefix), CODE_FORM);
});

test('a parish prefix of one to four letters starts the code, and is tidied first', () => {
  for (const [prefix, start] of [['PTGS', 'PTGS-'], ['ptgs', 'PTGS-'], [' PT-GS ', 'PTGS-'], ['ptg', 'PTG'], ['A', 'A']]) {
    const code = generateChurchCode(prefix);
    assert.ok(code.startsWith(start), code);
    assert.match(code, CODE_FORM);
    assert.equal(validateChurchCode(code), true);
  }
});

test('a prefix that cannot be typed in a code is refused', () => {
  for (const prefix of ['   ', 'ABCDE', 'OLOL', 'ABIC', 'AB2C', 'AB10', 'AB!D', 42]) {
    assert.throws(() => generateChurchCode(prefix), /parish prefix/, String(prefix));
  }
});
