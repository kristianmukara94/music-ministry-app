// What the Settings page is told, and what stays in the main process. Run with: node --test electron/settings-service.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { createSettingsService } = await import('./settings.js');
const { setActiveAssetRoot } = await import('./assets.js');
const { writeConfig, readConfig } = await import('./config.js');

test('the settings page is never sent the Remote view PINs, and they stay saved', () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-settings-'));
  setActiveAssetRoot(path.join(userData, 'assets'));
  writeConfig(userData, { remote_view: { primary: { enabled: true, port: 8787, pin: '4821' }, secondary: { enabled: false, port: 8788, pin: '9090' } } });
  const service = createSettingsService({ userData, getDb: () => null, getStatus: () => ({}), appVersion: '1.0.0', showOpenDirectory: async () => ({ canceled: true }) });

  const shown = service.get();
  assert.equal('remote_view' in shown.config, false);
  assert.equal(JSON.stringify(shown).includes('4821'), false);
  assert.equal(JSON.stringify(shown).includes('9090'), false);
  assert.equal(shown.config.theme, 'obsidian', 'the other settings are still sent');
  assert.equal(readConfig(userData).remote_view.primary.pin, '4821', 'the PIN is still kept for the main process');
  fs.rmSync(userData, { recursive: true, force: true });
});
