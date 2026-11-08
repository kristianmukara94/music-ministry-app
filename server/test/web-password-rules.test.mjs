// The rules behind the planner's choose-a-password screen: the checklist, the strength bars and when Save unlocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordChecks, passwordFormState, passwordStrength } from '../../web/js/password-rules.js';

const form = (currentPassword, newPassword, confirmPassword) => passwordFormState({ currentPassword, newPassword, confirmPassword });
const GOOD = 'sanctus-gloria';

test('the checklist needs 10 characters and a number or symbol', () => {
  assert.deepEqual(passwordChecks('abcdefghi'), { length: false, numberOrSymbol: false });
  assert.deepEqual(passwordChecks('abcdefghij'), { length: true, numberOrSymbol: false });
  assert.deepEqual(passwordChecks('abcdefghi1'), { length: true, numberOrSymbol: true });
  assert.equal(passwordChecks('abcdefghi!').numberOrSymbol, true);
});

test('a space is not a symbol, and neither is a letter from another alphabet or an accent', () => {
  assert.equal(passwordChecks('a long new password').numberOrSymbol, false);
  assert.equal(passwordChecks('pagmamahál').numberOrSymbol, false);
  assert.equal(passwordChecks('pagmamahál').numberOrSymbol, false, 'a combining accent is part of its letter');
});

test('strength goes from nothing, to weak, to fair, to strong', () => {
  assert.equal(passwordStrength(''), 0);
  assert.equal(passwordStrength('short1'), 1);
  assert.equal(passwordStrength('nonumbersatall'), 1, 'long enough but missing a number or symbol');
  assert.equal(passwordStrength('abcdefghi1'), 2, 'meets the requirements and no more');
  assert.equal(passwordStrength('Sanctus-Gloria'), 3, 'long, with three kinds of character');
  assert.equal(passwordStrength('sanctus-gloria-in'), 3, 'very long');
});

test('repeating a few characters never reads as strong', () => {
  assert.equal(passwordStrength('1111111111111111'), 2);
  assert.equal(passwordStrength('Aa1!Aa1!Aa1!Aa1!'), 2);
});

test('Save stays locked until all three fields are right', () => {
  assert.equal(form('', GOOD, GOOD).canSubmit, false, 'no current password');
  assert.equal(form('temp', 'short1', 'short1').canSubmit, false, 'too short');
  assert.equal(form('temp', 'nonumbersatall', 'nonumbersatall').canSubmit, false, 'no number or symbol');
  assert.equal(form('temp', GOOD, '').canSubmit, false, 'not confirmed');
  assert.equal(form('temp', GOOD, `${GOOD}x`).canSubmit, false, 'does not match');
  assert.equal(form('temp', GOOD, GOOD).canSubmit, true);
});

test('the mismatch message waits for the confirm field and follows it live', () => {
  assert.equal(form('', GOOD, '').mismatch, false, 'nothing typed yet');
  assert.equal(form('', GOOD, 'sanc').mismatch, true);
  assert.equal(form('', GOOD, GOOD).mismatch, false);
  assert.equal(form('', `${GOOD}1`, GOOD).mismatch, true, 'editing the new password re-opens the mismatch');
});
