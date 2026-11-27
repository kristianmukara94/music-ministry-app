// The licensing text and the About & Licensing card: the registration tidying, the sponsorship metadata, the EULA terms, the notices and the
// sidebar footer. Synthetic data only. Run with: node --test shared/license-text.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AUTHORIZED_SCOPE,
  BUILT_BY_LINE,
  CERTIFICATE_GRANT,
  CREDENTIAL_STATUS,
  DATE_SIGNED_LABEL,
  DELIVERED_SCOPE,
  DELIVERED_SCOPE_TITLE,
  DEVELOPER,
  SEAL_TEXT,
  EULA_SECTIONS,
  FOOTER_TEXT,
  LICENSE_TYPE,
  NOTICES_TITLE,
  OSS_NOTICES,
  PARISH_SEAL_CUE,
  PILOT_CREDENTIAL_STATUS,
  credentialStatus,
  tidyRegistration,
  tidyRegistrationLine,
} from './license-text.js';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const allText = (sections) => sections.flatMap((s) => [s.title, ...s.paragraphs]).join('\n');

// ── Registration tidying ───────────────────────────────────────────────────

test('a registration line is trimmed and its repeated spaces, tabs and line breaks become one space', () => {
  assert.equal(tidyRegistrationLine('  Sample   Parish  Name '), 'Sample Parish Name');
  assert.equal(tidyRegistrationLine('Sample\tCity,\n  Sample  Province'), 'Sample City, Sample Province');
  assert.equal(tidyRegistrationLine('Sample  Parish'), 'Sample Parish', 'a non-breaking space pasted from a document counts too');
  assert.equal(tidyRegistrationLine('Sample Parish Name'), 'Sample Parish Name', 'a tidy name is left alone');
  assert.equal(tidyRegistrationLine('   '), '');
  assert.equal(tidyRegistrationLine(undefined), '');
  assert.equal(tidyRegistrationLine(42), '');
});

test('the registration form tidies both fields together', () => {
  assert.deepEqual(tidyRegistration({ church: '  Sample   Parish Name', location: 'Sample   City  ' }), { church: 'Sample Parish Name', location: 'Sample City' });
  assert.deepEqual(tidyRegistration(null), { church: '', location: '' });
});

test('the main process saves the registration through the same tidying, and still refuses a blank one', () => {
  const config = read('electron/config.js');
  assert.match(config, /import \{ tidyRegistration \} from '\.\.\/shared\/license-text\.js';/);
  assert.match(config, /export function validateRegistration\(input\) \{\n\s+const \{ church, location \} = tidyRegistration\(input\);/);
  const settings = read('electron/settings.js');
  assert.equal(settings.split('validateRegistration(registration)').length - 1, 2, 'both acceptEula and updateRegistration check it');
});

test('the Edit Registration Details form and the first-launch form send the tidied values', () => {
  const about = read('src/settings/AboutLicensing.tsx');
  assert.match(about, /const tidied = tidyRegistration\(draft\);/);
  assert.match(about, /await bridge\.config\.updateRegistration\(tidied\);/);
  assert.match(about, /const draftFilled = tidied\.church !== '' && tidied\.location !== '';/);
  const eula = read('src/components/EulaModal.tsx');
  assert.match(eula, /const tidied = tidyRegistration\(registration\);/);
  assert.match(eula, /await bridge\.config\.acceptEula\(tidied\);/);
});

// ── Sponsorship metadata ───────────────────────────────────────────────────

test('the license type and the developer & copyright line carry the sponsorship wording', () => {
  assert.equal(LICENSE_TYPE, 'Sponsored Perpetual Ministry License (Free / Donated)');
  assert.equal(DEVELOPER, 'Kristian Pacatang Mukara');
  assert.equal(BUILT_BY_LINE, 'Kristian Pacatang Mukara — Lead Systems Architect & Developer · © 2026 All Rights Reserved');
  assert.equal(AUTHORIZED_SCOPE, 'Philippine Church & Worship Ministry Use Only');
});

test('the certificate\'s status, seal and delivered-system wording', () => {
  assert.equal(CREDENTIAL_STATUS, 'Active Perpetual License');
  assert.equal(SEAL_TEXT, 'APCCMMA · Verified Production Deployment · Sponsored Ministry License');
  assert.equal(DELIVERED_SCOPE_TITLE, 'Delivered System & Architectural Scope');
  assert.deepEqual(
    DELIVERED_SCOPE.map((item) => item.title),
    ['Offline-First Desktop Workstation', 'Cloud-Synchronized Web Planner', 'Production Verification & Stewardship'],
  );
  assert.match(DELIVERED_SCOPE[0].text, /multi-display projection, local network casting, and transactional SQLite storage/);
  assert.match(DELIVERED_SCOPE[1].text, /Bidirectional schedule synchronization, conflict-safe tombstones/);
  assert.match(DELIVERED_SCOPE[2].text, /Automated test-verified release/);
});

test('the status is perpetual without an expiry day and names the pilot\'s expiry day with one', () => {
  assert.equal(PILOT_CREDENTIAL_STATUS, 'Active Pilot License');
  for (const none of [undefined, null, '']) assert.equal(credentialStatus(none), 'Active Perpetual License', String(none));
  assert.equal(credentialStatus('2026-12-15'), 'Active Pilot License (Expires 2026-12-15)');
});

test('the certificate grant and the signature cues', () => {
  assert.equal(
    CERTIFICATE_GRANT,
    'is granted a Sponsored Perpetual Ministry License (Free / Donated) to use APCCMMA Presentation for its liturgical and music ministry ' +
      'services: royalty-free, without license fees or subscriptions, and under the End-User License Agreement accepted at registration.',
  );
  assert.equal(DATE_SIGNED_LABEL, 'Date Signed:');
  assert.equal(PARISH_SEAL_CUE, 'Official Parish Seal');
});

test('every word the parish reads spells "license" the US way: the certificate, the EULA and the notices', () => {
  const words = [CERTIFICATE_GRANT, allText(EULA_SECTIONS), allText(OSS_NOTICES), CREDENTIAL_STATUS, credentialStatus('2026-12-15'), SEAL_TEXT, LICENSE_TYPE];
  for (const text of words) assert.doesNotMatch(text, /licence/i, text.slice(0, 60));
  assert.match(CERTIFICATE_GRANT, /without license fees or subscriptions/);
  // The certificate's own source carries no copy of the old spelling either: its grant comes from here.
  assert.doesNotMatch(read('shared/license-certificate.js'), /licence/i);
});

test('the renderer reads the licensing text from shared/license-text.js, so there is one copy of it', () => {
  const legal = read('src/legal/license.ts');
  assert.match(legal, /from '\.\.\/\.\.\/shared\/license-text\.js';/);
  assert.doesNotMatch(legal, /export const /, 'no second copy of any string');
});

test('the About card shows a License Type row and the new developer & copyright line', () => {
  const about = read('src/settings/AboutLicensing.tsx');
  assert.match(about, /<Row label="License type">\n\s+<span data-license-type>\{LICENSE_TYPE\}<\/span>/);
  assert.match(about, /<Row label="Developer & copyright">\n\s+<span data-developer-copyright>\{BUILT_BY_LINE\}<\/span>/);
  // Licensed to, License type, Authorized scope, Developer & copyright, in that order.
  const order = ['label="Licensed to"', 'label="License type"', 'label="Authorized scope"', 'label="Developer & copyright"'].map((l) => about.indexOf(l));
  assert.ok(order.every((at) => at > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('Print / Export Certificate sits beside Edit Registration Details and is off until the church is registered', () => {
  const about = read('src/settings/AboutLicensing.tsx');
  const row = about.slice(about.indexOf('Edit Registration Details') - 200, about.indexOf('Print / Export Certificate') + 40);
  assert.ok(row.includes('<div className="flex flex-wrap gap-3">'), 'the two buttons share one row');
  assert.ok(row.indexOf('Edit Registration Details') < row.indexOf('Print / Export Certificate'));
  assert.match(about, /onClick=\{openCertificate\}\n\s+disabled=\{!registered\}/);
  assert.match(about, /setCertificate\(\{ church: config\.registered_church \?\? '', location: config\.registered_location \?\? '', registeredOn, registeredDate, expiresOn, version \}\)/);
  // The status follows the license this laptop holds: a dated key's expiry day, or none for the perpetual sponsorship.
  assert.match(about, /const expiresOn = expiryDayOf\(useLicense\(\(s\) => s\.status\?\.expiresAt \?\? null\)\);/);
  // The Credential ID's day is the printed day in the same zone, formatted as YYYY-MM-DD rather than parsed back out of the printed label.
  assert.match(about, /const registeredDate = config\.registered_at \? formatDay\(new Date\(config\.registered_at\), \{ \.\.\.region, dateFormat: 'YYYY-MM-DD' \}\) : '';/);
  assert.match(about, /<LicenseCertificateDialog job=\{certificate\}/);
});

// ── EULA and notices ───────────────────────────────────────────────────────

test('the EULA keeps its first three sections and adds the sponsorship, as-is and copyright terms', () => {
  assert.deepEqual(
    EULA_SECTIONS.map((s) => s.title),
    [
      '1. EXCLUSIVE MINISTRY GRANT',
      '2. RESTRICTIONS',
      '3. NON-COMMERCIAL STATUS',
      '4. SPONSORED PERPETUAL MINISTRY LICENSE',
      '5. PROVIDED "AS IS"; BEST-EFFORT MAINTENANCE',
      '6. CONTENT & COPYRIGHT RESPONSIBILITY',
    ],
  );
  const text = allText(EULA_SECTIONS);
  assert.ok(text.includes(LICENSE_TYPE));
  assert.match(text, /perpetual and royalty-free/);
  assert.match(text, /no purchase price, license fee, subscription or royalty/);
  assert.match(text, /provided "as is", without warranty of any kind/);
  assert.match(text, /best-effort basis/);
  assert.match(text, /APCCMMA ships no song lyrics/);
  assert.match(text, /public-domain and openly licensed Scripture/);
  assert.match(text, /CCLI or OneLicense/);
  assert.match(text, /parish is responsible/);
});

test('the notices name the core runtimes with their licenses, and the bundled Bibles with their attributions', () => {
  assert.equal(NOTICES_TITLE, 'OPEN-SOURCE & CONTENT NOTICES');
  const titles = OSS_NOTICES.map((s) => s.title);
  for (const name of ['Electron', 'Chromium', 'Node.js', 'React', 'SQLite']) assert.ok(titles.includes(name), name);
  const byTitle = Object.fromEntries(OSS_NOTICES.map((s) => [s.title, s.paragraphs.join(' ')]));
  assert.match(byTitle.Electron, /MIT License/);
  assert.match(byTitle.Chromium, /BSD-style license/);
  assert.match(byTitle['Node.js'], /MIT License/);
  assert.match(byTitle.React, /MIT License/);
  assert.match(byTitle.SQLite, /Public domain/);
  // Each bundled translation is credited exactly as its file says (CC BY-SA requires the attribution).
  for (const file of ['web', 'tgl', 'ceb']) {
    const bible = JSON.parse(read(`resources/bible/${file}.json`).slice(0, 2000).replace(/,"books".*$/s, '}'));
    assert.ok(byTitle['Scripture translations'].toLowerCase().includes(bible.translation.license.toLowerCase()), `${file} license`);
  }
  assert.match(byTitle['Scripture translations'], /© 2018 Door43 World Missions Community\. Licensed CC BY-SA 4\.0/);
  assert.match(byTitle['Scripture translations'], /© 2009, 2010, 2014, 2024 Biblica, Inc\. Licensed CC BY-SA 4\.0/);
});

test('the Open-Source & Content Notices toggle sits below the EULA and opens the same way', () => {
  const about = read('src/settings/AboutLicensing.tsx');
  const eula = about.indexOf('<Disclosure id="eula-viewer" label="End-User License Agreement">');
  const notices = about.indexOf('<Disclosure id="notices-viewer" label="Open-Source & Content Notices">');
  assert.ok(eula > 0 && notices > eula, 'the notices come after the EULA');
  assert.match(about, /<LicenseText sections=\{OSS_NOTICES\} \/>/);
  // One toggle for both: its own open state, aria-expanded and aria-controls pointing at its panel.
  const disclosure = about.slice(about.indexOf('function Disclosure('), about.indexOf('export function AboutLicensing('));
  assert.match(disclosure, /aria-expanded=\{open\} aria-controls=\{id\}/);
  assert.match(disclosure, /\{open \? 'Hide' : 'Read'\} the \{label\}/);
});

// ── Sidebar footer ─────────────────────────────────────────────────────────

test('the sidebar footer is the short sponsored line, which fits the 288px sidebar without an ellipsis', () => {
  assert.equal(FOOTER_TEXT, 'APCCMMA · Sponsored Ministry License');
  // The footer's line box is 288px less the sidebar's px-2 and its own px-3: 248px. At 10px with tracking-wide a glyph averages under 6.2px,
  // so 40 characters is the most that fits at every width from 1366px to 1920px (the sidebar does not grow with the window).
  assert.ok(FOOTER_TEXT.length <= 40, `${FOOTER_TEXT.length} characters`);
  const side = read('src/operator/Sidebar.tsx');
  assert.match(side, /'w-\[76px\]' : 'w-\[288px\]'/);
  assert.match(side, /title=\{FOOTER_TEXT\}/);
  assert.match(side, /className="mt-1 truncate border-t border-fg\/\[0\.08\] px-3 pt-2 pb-1 text-center text-\[10px\] tracking-wide/);
});
