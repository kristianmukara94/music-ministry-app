// The parish profile: name and logo. Run with: node --test electron/church-profile.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

register(new URL('./test-support/electron-hook.mjs', import.meta.url));
const { createChurchProfileService, checkLogoPng, LOGO_FILE_NAME, LOGO_DIR_NAME } = await import('./church-profile.js');
const { readConfig, writeConfig } = await import('./config.js');

/** A real 1x1 PNG of the given size header. */
function png(width = 1, height = 1) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.alloc(1 + width * 4))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const tempUserData = () => fs.mkdtempSync(path.join(os.tmpdir(), 'apccmma-church-'));

test('a fresh copy is not set up, and a copy registered before the wizard existed is', () => {
  const fresh = tempUserData();
  assert.equal(readConfig(fresh).onboarded, false);
  writeConfig(fresh, { theme: 'light' });
  assert.equal(readConfig(fresh).onboarded, false, 'a config file written before the license is accepted is still not set up');
  writeConfig(fresh, { eula_accepted: true, registered_church: 'X', registered_location: 'Y' });
  assert.equal(readConfig(fresh).onboarded, false, 'accepting the license on a new copy still leads to the wizard');

  const legacy = tempUserData();
  fs.writeFileSync(path.join(legacy, 'config.json'), JSON.stringify({ eula_accepted: true, registered_church: 'Old Parish', registered_location: 'Davao' }));
  assert.equal(readConfig(legacy).onboarded, true, 'an existing install is not stopped by the wizard after an update');
  for (const dir of [fresh, legacy]) fs.rmSync(dir, { recursive: true, force: true });
});

test('the name falls back to the registered church until one is saved', () => {
  const userData = tempUserData();
  writeConfig(userData, { eula_accepted: true, registered_church: 'Assumption Parish Music Ministry', registered_location: 'Davao' });
  const service = createChurchProfileService({ userData });
  assert.equal(service.get().churchName, 'Assumption Parish Music Ministry');
  assert.equal(service.get().logoDataUrl, null);

  const saved = service.save({ name: '  Sto. Niño   de Cebu Parish ' });
  assert.equal(saved.churchName, 'Sto. Niño de Cebu Parish');
  assert.equal(saved.onboarded, true);
  assert.equal(readConfig(userData).registered_church, 'Assumption Parish Music Ministry', 'the license registration is left alone');
  fs.rmSync(userData, { recursive: true, force: true });
});

test('the ministry name is saved, kept when left out, cleared when blank, and announced to every window', () => {
  const userData = tempUserData();
  const changes = [];
  const service = createChurchProfileService({ userData, onChanged: (p) => changes.push(p) });
  assert.equal(service.get().ministryName, '', 'none until one is set, so screens show the generic line');

  service.save({ name: 'Sto. Niño de Cebu Parish', ministry: '  Charismatic   Music Ministry ' });
  assert.equal(service.get().ministryName, 'Charismatic Music Ministry');
  assert.equal(changes.at(-1).ministryName, 'Charismatic Music Ministry', 'the broadcast carries the new name');

  service.save({ name: 'Sto. Niño de Cebu Parish' });
  assert.equal(service.get().ministryName, 'Charismatic Music Ministry', 'a save without a ministry keeps it');

  assert.throws(() => service.save({ name: 'X', ministry: 'm'.repeat(101) }), /100 characters/);
  assert.equal(service.get().churchName, 'Sto. Niño de Cebu Parish', 'a refused save changes nothing');

  service.save({ name: 'Sto. Niño de Cebu Parish', ministry: '   ' });
  assert.equal(service.get().ministryName, '');
  assert.equal(readConfig(userData).ministry_name, null);
  fs.rmSync(userData, { recursive: true, force: true });
});

test('a blank or too-long name is refused and nothing is saved', () => {
  const userData = tempUserData();
  const service = createChurchProfileService({ userData });
  assert.throws(() => service.save({ name: '   ' }), /Enter the parish/);
  assert.throws(() => service.save({ name: 'x'.repeat(101) }), /100 characters/);
  assert.equal(readConfig(userData).onboarded, false);
  fs.rmSync(userData, { recursive: true, force: true });
});

test('a logo is saved as a PNG file, kept by later saves, and removed by going back to the emblem', () => {
  const userData = tempUserData();
  const changes = [];
  const service = createChurchProfileService({ userData, onChanged: (p) => changes.push(p) });
  const file = path.join(userData, LOGO_DIR_NAME, LOGO_FILE_NAME);

  const withLogo = service.save({ name: 'Parish', logo: new Uint8Array(png(512, 512)) });
  assert.ok(fs.existsSync(file));
  assert.match(withLogo.logoDataUrl, /^data:image\/png;base64,/);
  assert.equal(withLogo.logoPath, file);
  assert.ok(withLogo.logoVersion > 0);

  const renamed = service.save({ name: 'Parish Two' });
  assert.equal(renamed.logoVersion, withLogo.logoVersion, 'leaving the logo out keeps it');
  assert.ok(fs.existsSync(file));

  const newer = service.save({ name: 'Parish Two', logo: png(256, 256) });
  assert.ok(newer.logoVersion > withLogo.logoVersion, 'a new logo always gets a newer version');

  const reset = service.save({ name: 'Parish Two', logo: null });
  assert.equal(reset.logoDataUrl, null);
  assert.equal(reset.logoVersion, null);
  assert.equal(fs.existsSync(file), false);
  assert.equal(changes.length, 4, 'every save is announced');
  fs.rmSync(userData, { recursive: true, force: true });
});

test('a logo file deleted by hand falls back to the emblem instead of a broken image', () => {
  const userData = tempUserData();
  const service = createChurchProfileService({ userData });
  service.save({ name: 'Parish', logo: png() });
  fs.rmSync(path.join(userData, LOGO_DIR_NAME, LOGO_FILE_NAME));
  const profile = createChurchProfileService({ userData }).get();
  assert.equal(profile.logoDataUrl, null);
  assert.equal(profile.logoPath, null);
  fs.rmSync(userData, { recursive: true, force: true });
});

test('only a PNG of a sensible size is accepted, and a refused logo leaves the profile as it was', () => {
  assert.throws(() => checkLogoPng('not bytes'), /image bytes/);
  assert.throws(() => checkLogoPng(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), /could not be read/);
  assert.throws(() => checkLogoPng(png(4096, 10)), /2048 pixels/);
  assert.throws(() => checkLogoPng(new Uint8Array(5 * 1024 * 1024)), /too large/);
  assert.ok(checkLogoPng(png(512, 512)));

  const userData = tempUserData();
  const service = createChurchProfileService({ userData });
  service.save({ name: 'Before', logo: png() });
  const before = service.get();
  assert.throws(() => service.save({ name: 'After', logo: Buffer.from('GIF89a') }));
  assert.deepEqual(service.get(), before);
  fs.rmSync(userData, { recursive: true, force: true });
});
