// PowerPoint, driven by the app, opens an imported deck with its macros off: Office leaves them on for a file a program opens, and a deck can come
// from anyone. The script runs inside PowerPoint, so its text is what can be checked here. Run with: node --test electron/pptx-macros.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('macros are forced off before PowerPoint opens the file', () => {
  const source = fs.readFileSync(new URL('./documents.js', import.meta.url), 'utf8');
  const macrosOff = source.indexOf('$app.AutomationSecurity = 3');
  const opens = source.indexOf('$app.Presentations.Open(');
  assert.ok(macrosOff > 0, 'the setting is in the script');
  assert.ok(macrosOff < opens, 'it is set before the file is opened');
});
