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

test('Backup & restore: the last backup is saved and shown, folders open in Explorer, sizes are measured, and a move waits for a full backup', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-settings-'));
  const assets = path.join(userData, 'assets');
  setActiveAssetRoot(assets);
  fs.writeFileSync(path.join(userData, 'apccmma.db'), Buffer.alloc(2048));
  fs.writeFileSync(path.join(assets, 'media', '0b0e7c1e-1111-4a4a-8b8b-000000000001.jpg'), Buffer.alloc(100));
  const revealed = [];
  const opened = [];
  let job = 'export';
  let pickerOpened = false;
  const service = createSettingsService({
    userData,
    getDb: () => null,
    getStatus: () => ({}),
    appVersion: '1.0.0',
    showOpenDirectory: async () => {
      pickerOpened = true;
      return { canceled: true };
    },
    showItemInFolder: (file) => revealed.push(file),
    openPath: async (dir) => {
      opened.push(dir);
      return '';
    },
    archiveJob: () => job,
  });

  assert.equal(service.get().config.last_backup, null, 'no backup has been made yet');
  service.recordBackup('full');
  const saved = service.get().config.last_backup;
  assert.equal(saved.kind, 'full');
  assert.ok(Math.abs(Date.parse(saved.at) - Date.now()) < 60_000);
  assert.deepEqual(readConfig(userData).last_backup, saved, 'kept in config.json across restarts');
  writeConfig(userData, { last_backup: { at: 'garbage', kind: 'full' } });
  assert.equal(readConfig(userData).last_backup, null, 'a damaged record is dropped, not shown');

  service.revealDatabase();
  assert.deepEqual(revealed, [path.join(userData, 'apccmma.db')]);
  await service.openMediaFolder();
  assert.deepEqual(opened, [assets]);
  const failing = createSettingsService({ userData, getDb: () => null, getStatus: () => ({}), appVersion: '1', showOpenDirectory: async () => ({ canceled: true }), openPath: async () => 'Access denied' });
  await assert.rejects(failing.openMediaFolder(), /Access denied/);

  assert.deepEqual(await service.storageStats(), { database: { bytes: 2048 }, media: { bytes: 100, files: 1 } });

  await assert.rejects(service.changeLocation(null), /Wait for the full backup to finish/);
  assert.equal(pickerOpened, false, 'the folder picker never opens during a full backup');
  job = null;
  assert.equal(await service.changeLocation(null), null, 'once it is done, the move can start (cancelled here)');
  assert.equal(service.isMoving(), false);

  fs.rmSync(userData, { recursive: true, force: true });
});
