// The welcome background (colour, picture or video, and the Loop choice) is saved with the welcome settings: a choice survives a restart, and a
// config saved before the background existed reads back as the colour. Uses the real config reader and writer on a temporary folder.
// Run with: node --test electron/welcome-background.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig, writeConfig } from './config.js';
import { sanitizeWelcomeSettings } from '../shared/welcome-settings.js';

const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-background-'));

test('a video background, its file and the Loop choice are saved and still there after a restart', () => {
  const dir = folder();
  const current = readConfig(dir).welcome;
  writeConfig(dir, { welcome: sanitizeWelcomeSettings({ ...current, backgroundType: 'VIDEO', backgroundUrl: 'apcc-media://media/9', videoLoop: false }) });
  // A restart reads the file again.
  const reloaded = readConfig(dir).welcome;
  assert.equal(reloaded.backgroundType, 'VIDEO');
  assert.equal(reloaded.backgroundUrl, 'apcc-media://media/9');
  assert.equal(reloaded.videoLoop, false);
});

test('a picture background is saved and reloaded, and the colour is kept with it', () => {
  const dir = folder();
  writeConfig(dir, { welcome: sanitizeWelcomeSettings({ backgroundType: 'IMAGE', backgroundUrl: 'apcc-media://media/2', backgroundColor: '#123456' }) });
  const reloaded = readConfig(dir).welcome;
  assert.equal(reloaded.backgroundType, 'IMAGE');
  assert.equal(reloaded.backgroundUrl, 'apcc-media://media/2');
  assert.equal(reloaded.backgroundColor, '#123456');
});

test('the shade choice is saved and reloaded, and an unset colour stays unset', () => {
  const dir = folder();
  writeConfig(dir, { welcome: sanitizeWelcomeSettings({ backgroundType: 'IMAGE', backgroundUrl: 'apcc-media://media/5', textShade: false }) });
  const reloaded = readConfig(dir).welcome;
  assert.equal(reloaded.textShade, false, 'the shade stays off after a restart');
  assert.equal(reloaded.backgroundColor, null, 'the colour is still unset, so the slides keep their own colour');
});

test('the Welcome background and the Live slide background are saved and reloaded on their own', () => {
  const dir = folder();
  const current = readConfig(dir).welcome;
  writeConfig(dir, {
    welcome: sanitizeWelcomeSettings({
      ...current,
      backgroundType: 'IMAGE',
      backgroundUrl: 'apcc-media://media/31',
      backgroundFit: 'FILL',
      slideBackground: { backgroundType: 'VIDEO', backgroundUrl: 'apcc-media://media/32', videoLoop: false, backgroundFit: 'FIT', backgroundColor: '#101010', textShade: false },
    }),
  });
  const reloaded = readConfig(dir).welcome;
  assert.equal(reloaded.backgroundType, 'IMAGE', 'the Welcome background is kept');
  assert.equal(reloaded.backgroundUrl, 'apcc-media://media/31');
  assert.equal(reloaded.slideBackground.backgroundType, 'VIDEO', 'the Live slide background is kept');
  assert.equal(reloaded.slideBackground.backgroundUrl, 'apcc-media://media/32');
  assert.equal(reloaded.slideBackground.videoLoop, false);
  assert.equal(reloaded.slideBackground.backgroundFit, 'FIT');
  assert.equal(reloaded.slideBackground.textShade, false);
});

test('an upgraded config: the existing background becomes the Welcome background, and the Live slide background starts at its default', () => {
  const dir = folder();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ welcome: { welcomeType: 'TEXT', backgroundType: 'VIDEO', backgroundUrl: 'apcc-media://media/7', videoLoop: false, imageFit: 'FIT' } }));
  const welcome = readConfig(dir).welcome;
  assert.equal(welcome.backgroundType, 'VIDEO', 'the Welcome screen looks the same as before');
  assert.equal(welcome.backgroundUrl, 'apcc-media://media/7');
  assert.equal(welcome.videoLoop, false);
  assert.equal(welcome.backgroundFit, 'FIT', 'drawn with the fit it had');
  assert.equal(welcome.slideBackground.backgroundType, 'COLOR', 'the Live slide background starts at its default');
  assert.equal(welcome.slideBackground.backgroundUrl, null);
});

test('a config saved before the background existed reads back as the colour, with Loop on', () => {
  const dir = folder();
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ welcome: { welcomeType: 'TEXT', message: 'Welcome', backgroundColor: '#000000' } }));
  const welcome = readConfig(dir).welcome;
  assert.equal(welcome.backgroundType, 'COLOR');
  assert.equal(welcome.backgroundUrl, null);
  assert.equal(welcome.videoLoop, true);
  assert.equal(welcome.backgroundColor, '#000000');
});
