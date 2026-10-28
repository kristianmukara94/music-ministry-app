// The welcome image's fit is saved with the welcome settings: a choice survives a restart (it is read back from config.json), and a config
// saved before the setting existed reads back as Fill screen. Uses the real config reader and writer on a temporary folder.
// Run with: node --test electron/welcome-image.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig, writeConfig } from './config.js';
import { sanitizeWelcomeSettings } from '../shared/welcome-settings.js';

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-welcome-'));

test('a Show whole picture choice is saved and still there after a restart', () => {
  const dir = folder();
  // The operator picks Show whole picture: the main process saves it with the other welcome settings.
  const current = readConfig(dir).welcome;
  writeConfig(dir, { welcome: sanitizeWelcomeSettings({ ...current, welcomeType: 'IMAGE', imageUrl: 'apcc-media://photo.png', imageFit: 'FIT' }) });
  // A restart reads the file again.
  const reloaded = readConfig(dir).welcome;
  assert.equal(reloaded.imageFit, 'FIT');
  assert.equal(reloaded.imageUrl, 'apcc-media://photo.png');
});

test('a Fill screen choice is saved and reloaded too', () => {
  const dir = folder();
  writeConfig(dir, { welcome: sanitizeWelcomeSettings({ imageFit: 'FILL' }) });
  assert.equal(readConfig(dir).welcome.imageFit, 'FILL');
});

test('an existing welcome image saved before the setting existed reads back as Fill screen', () => {
  const dir = folder();
  // A config.json written by an earlier version: it has the image, but no fit.
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ welcome: { welcomeType: 'IMAGE', imageUrl: 'apcc-media://old.png', message: 'Welcome' } }));
  const welcome = readConfig(dir).welcome;
  assert.equal(welcome.imageUrl, 'apcc-media://old.png', 'the image is kept');
  assert.equal(welcome.imageFit, 'FILL', 'and it fills the screen by default');
});
