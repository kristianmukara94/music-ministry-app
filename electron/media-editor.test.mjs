// Media Studio persistence against the real schema: the edit_settings_json column, poster-frame thumbnails and baked copies. Fixtures are
// synthetic. Run with: node --test electron/media-editor.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_MEDIA_EDIT_SETTINGS, normalizeMediaEditSettings } from '../shared/media-editor.js';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { MEDIA_MIGRATIONS, MEDIA_AUDIO_MIGRATIONS, MEDIA_FOLDER_MIGRATIONS, MEDIA_EDITOR_MIGRATIONS, imageFormatOf, createMediaService } = await import('./media.js');

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// Smallest byte strings the format check accepts: the PNG and JPEG signatures plus padding.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

function open() {
  const db = new DatabaseSync(':memory:');
  for (const sql of [...MEDIA_MIGRATIONS, ...MEDIA_AUDIO_MIGRATIONS, ...MEDIA_FOLDER_MIGRATIONS]) db.exec(sql);
  // A library from before the Studio: these rows must load unchanged once the column is added.
  db.exec(`INSERT INTO media_assets (filename, file_path, media_type, thumbnail_path, folder_id) VALUES
    ('Sample Motion Backdrop.mp4', 'media/a.mp4', 'video', 'thumbnails/0000aaaa-0000-4000-8000-000000000001.jpg', 1),
    ('Sample Still Image.png', 'media/b.png', 'image', NULL, NULL)`);
  for (const sql of MEDIA_EDITOR_MIGRATIONS) db.exec(sql);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apcc-media-editor-'));
  for (const dir of ['media', 'thumbnails']) fs.mkdirSync(path.join(root, dir));
  fs.writeFileSync(path.join(root, 'thumbnails', '0000aaaa-0000-4000-8000-000000000001.jpg'), JPEG);
  const thumbs = [];
  const service = createMediaService(db, root, {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    makeImageThumbnail: async (file) => {
      thumbs.push(file);
      return Buffer.from(JPEG);
    },
  });
  const [video, still] = service.list().sort((a, b) => a.id - b.id);
  return { db, root, service, video, still, thumbs };
}

test('items from before the Studio load with neutral edits and are not marked edited', () => {
  const { db, service } = open();
  assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('media_assets') WHERE name = 'edit_settings_json'").get(), 'the column exists');
  for (const item of service.list()) {
    assert.deepEqual(item.edit, normalizeMediaEditSettings(DEFAULT_MEDIA_EDIT_SETTINGS));
    assert.equal(item.edited, false);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM media_assets WHERE edit_settings_json IS NULL').get().n, 2);
});

test('saved edits persist as normalised JSON, and a reset stores NULL again', () => {
  const { db, service, video } = open();
  const saved = service.saveEditSettings(video.id, { brightness: 12, blur: 99, trimStart: 2, trimEnd: 8, junk: 'ignored' });
  assert.equal(saved.edited, true);
  assert.equal(saved.edit.blur, 24, 'clamped before it is stored');
  const raw = JSON.parse(db.prepare('SELECT edit_settings_json AS j FROM media_assets WHERE id = ?').get(video.id).j);
  assert.equal(raw.brightness, 12);
  assert.equal(raw.trimStart, 2);
  assert.equal(raw.trimEnd, 8);
  assert.equal('junk' in raw, false, 'only known fields are stored');
  assert.deepEqual(service.list().find((m) => m.id === video.id).edit, saved.edit, 'the list reads it back');
  // Everything else about the item is untouched.
  const after = service.get(video.id);
  assert.deepEqual([after.filename, after.folderId, after.src, after.mediaType], [video.filename, video.folderId, video.src, video.mediaType]);

  const reset = service.saveEditSettings(video.id, DEFAULT_MEDIA_EDIT_SETTINGS);
  assert.equal(reset.edited, false);
  assert.equal(db.prepare('SELECT edit_settings_json AS j FROM media_assets WHERE id = ?').get(video.id).j, null);
  assert.throws(() => service.saveEditSettings(9999, {}), /no longer in the library/);
});

test('a broken stored value loads as neutral instead of failing the whole library', () => {
  const { db, service, still } = open();
  db.prepare('UPDATE media_assets SET edit_settings_json = ? WHERE id = ?').run('{oops', still.id);
  assert.equal(service.get(still.id).edited, false);
  assert.equal(service.list().length, 2);
});

test('a poster frame replaces the thumbnail, removes the old file, and changes the thumbnail address', async () => {
  const { root, service, video } = open();
  assert.match(video.thumbSrc, /^apcc-media:\/\/thumb\/\d+\?v=0000aaaa$/);
  const item = await service.updateThumbnail(video.id, JPEG);
  assert.notEqual(item.thumbSrc, video.thumbSrc, 'a new address, so no window shows a cached picture');
  const rel = service.thumbPath(video.id);
  assert.match(rel, /^thumbnails[\\/][0-9a-f-]{36}\.jpg$/);
  assert.ok(fs.existsSync(path.join(root, rel)));
  assert.equal(fs.existsSync(path.join(root, 'thumbnails', '0000aaaa-0000-4000-8000-000000000001.jpg')), false, 'the old thumbnail is removed');
  assert.equal(service.filePath(video.id), 'media/a.mp4', 'the video itself is untouched');
});

test('a poster frame must be a real PNG or JPEG', async () => {
  const { service, video } = open();
  await assert.rejects(service.updateThumbnail(video.id, new Uint8Array([1, 2, 3, 4, 5])), /Only PNG and JPEG/);
  await assert.rejects(service.updateThumbnail(video.id, new Uint8Array()), /empty/);
  await assert.rejects(service.updateThumbnail(9999, JPEG), /no longer in the library/);
  assert.equal(imageFormatOf(PNG), 'png');
  assert.equal(imageFormatOf(JPEG), 'jpg');
  assert.equal(imageFormatOf(Buffer.from('GIF89a')), null);
});

test('Save as New Copy adds a still in the same folder and leaves the original alone', async () => {
  const { root, service, video, still, thumbs } = open();
  service.saveEditSettings(video.id, { blur: 6 });
  const copy = await service.saveEditedCopy(video.id, PNG);
  assert.equal(copy.mediaType, 'image');
  assert.equal(copy.filename, 'Sample Motion Backdrop (edited).png');
  assert.equal(copy.folderId, video.folderId, 'filed beside its source');
  assert.equal(copy.edited, false, 'the look is baked into the pixels, so the copy has no edits of its own');
  assert.ok(copy.thumbSrc, 'thumbnailed');
  assert.equal(thumbs.length, 1);
  const rel = service.filePath(copy.id);
  assert.match(rel, /^media[\\/][0-9a-f-]{36}\.png$/);
  assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(root, rel))), PNG);
  assert.equal(service.list().length, 3);
  assert.equal(service.get(video.id).edited, true, 'the original keeps its edits');
  assert.equal(service.filePath(video.id), 'media/a.mp4');

  const named = await service.saveEditedCopy(still.id, JPEG, '  Sample Still Image soft  ');
  assert.equal(named.filename, 'Sample Still Image soft');
  assert.equal(named.folderId, null);
  assert.match(service.filePath(named.id), /\.jpg$/, 'the format comes from the bytes');
  await assert.rejects(service.saveEditedCopy(still.id, new Uint8Array([0, 1, 2, 3])), /Only PNG and JPEG/);
  assert.equal(service.list().length, 4, 'a refused copy adds nothing');
});

test('the Studio IPC channels are registered, exposed to the renderer, and restyle the live background', () => {
  const media = read('./media.js');
  for (const channel of ['media:save-edit-settings', 'media:update-thumbnail', 'media:save-edited-copy']) {
    assert.match(media, new RegExp(`ipcMain\\.handle\\('${channel}'`), channel);
    assert.match(read('./preload.cjs'), new RegExp(`ipcRenderer\\.invoke\\('${channel}'`), `${channel} in preload`);
  }
  assert.match(media, /restyleBackground\?\.\(asset\.src, asset\.edited \? asset\.edit : null\)/);
  assert.match(media, /webContents\.send\('media:event', \{ kind: 'changed' \}\)/, 'every window reloads its library');
  assert.match(read('./main.js'), /apply\(\{ type: 'background\/restyle', src: url, edit \}\)/);
});

test('the migration is appended at the end of the shared schema', () => {
  const source = read('./announcements.js');
  assert.match(source, /\.\.\.HYMN_FILING_MIGRATIONS,\s*\.\.\.MEDIA_EDITOR_MIGRATIONS,\s*\.\.\.HYMN_FONT_SCALE_MIGRATIONS,\s*\.\.\.MASS_SCHEDULE_MIGRATIONS,\s*\];/);
});
