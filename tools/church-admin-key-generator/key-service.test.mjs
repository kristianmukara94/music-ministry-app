// The generator's own rules are tested in shared/church-key-generator.test.js. These cover what this app adds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHECK_FAILED, handleGenerate, validateChurchCode, validateSetupKey } from './key-service.mjs';

const stubKeys = (overrides) => ({
  generateSetupKey: () => 'AAAA-AAAA-AAAA',
  generateChurchCode: () => 'BBBB-BBBB',
  validateSetupKey: () => true,
  validateChurchCode: () => true,
  ...overrides,
});

test('Generate returns a setup key and church code that pass their checks', () => {
  for (let i = 0; i < 500; i += 1) {
    const { setupKey, churchCode, error } = handleGenerate('PTGS');
    assert.equal(error, undefined);
    assert.equal(validateSetupKey(setupKey), true);
    assert.equal(validateChurchCode(churchCode), true);
    assert.ok(churchCode.startsWith('PTGS-'));
  }
});

test('a blank prefix gives a random church code', () => {
  assert.equal(validateChurchCode(handleGenerate('').churchCode), true);
});

for (const failing of ['validateSetupKey', 'validateChurchCode']) {
  test(`the guard withholds both values when ${failing} fails`, (t) => {
    const logged = t.mock.method(console, 'error', () => {});
    assert.deepEqual(handleGenerate('', stubKeys({ [failing]: () => false })), { error: CHECK_FAILED });
    assert.equal(logged.mock.callCount(), 1);
  });
}

test('a prefix that cannot appear in a code comes back as a message', () => {
  assert.match(handleGenerate('OLPH').error, /parish prefix/);
});
