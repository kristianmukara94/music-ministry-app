// The printed license certificate (shared/license-certificate.js): what it says, its emblem, seal and Credential ID, that the parish's own
// words are escaped, and that it is one clean sheet on A4 or US Letter. Synthetic data only.
// Run with: node --test shared/license-certificate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CERTIFICATE_EMBLEM } from './certificate-emblem.js';
import {
  CERTIFICATE_PAPERS,
  CERTIFICATE_TITLE,
  DEFAULT_PAPER,
  NO_DATE,
  SIGNATURES,
  certificateDocument,
  certificateFacts,
  certificateFileName,
  checkCertificateJob,
  credentialId,
  credentialStrip,
  expiryDayOf,
  normalizedParishName,
  paperOf,
  setWidth,
} from './license-certificate.js';
import {
  AUTHORIZED_SCOPE,
  CERTIFICATE_GRANT,
  COPYRIGHT_NOTICE,
  CREDENTIAL_STATUS,
  DELIVERED_SCOPE,
  DELIVERED_SCOPE_TITLE,
  LICENSE_TYPE,
  SEAL_TEXT,
} from './license-text.js';

const job = (over = {}) => ({
  church: 'Sample Parish Name',
  location: 'Sample City',
  registeredOn: '01/02/2026',
  registeredDate: '2026-02-01',
  version: '1.2.3',
  ...over,
});
/** The document's visible text, roughly: tags removed and entities decoded. */
const textOf = (html) =>
  html
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
/** The style block of a document. */
const styleOf = (html) => html.match(/<style>([\s\S]*?)<\/style>/)[1];

// ── What it says ───────────────────────────────────────────────────────────

test('the certificate names the parish, the date, the license type and the scope', () => {
  const html = certificateDocument(job());
  const text = textOf(html);
  assert.ok(text.includes(CERTIFICATE_TITLE));
  assert.equal(CERTIFICATE_TITLE, 'Certificate of Perpetual Ministry License & Sponsorship');
  assert.match(html, /<p class="licensee" data-licensee>Sample Parish Name<\/p>/);
  assert.ok(text.includes('Licensed to Sample Parish Name (Sample City)'));
  assert.ok(text.includes('Registered on 01/02/2026'));
  assert.ok(text.includes(`License type ${LICENSE_TYPE}`));
  assert.ok(text.includes(`Authorized scope ${AUTHORIZED_SCOPE}`));
  assert.ok(text.includes(COPYRIGHT_NOTICE));
  // The eyebrow over the title.
  assert.match(html, /<p class="eyebrow">APCCMMA Presentation<\/p><h1>/);
  // The grant reads from shared/license-text.js and spells "license" the US way.
  assert.ok(html.includes(`<p class="grant">${CERTIFICATE_GRANT.replace(/&/g, '&amp;')}</p>`));
  assert.ok(text.includes('without license fees or subscriptions'));
  assert.doesNotMatch(text, /licence/i);
});

test('the facts print in a fixed order: Licensed to, License type, Registered on, Authorized scope', () => {
  assert.deepEqual(
    certificateFacts(checkCertificateJob(job())).map(([label]) => label),
    ['Licensed to', 'License type', 'Registered on', 'Authorized scope'],
  );
});

test('the credential strip shows the Credential ID, the status and the release version', () => {
  const checked = checkCertificateJob(job());
  assert.deepEqual(credentialStrip(checked), [
    ['Credential ID', credentialId(checked)],
    ['Status', CREDENTIAL_STATUS],
    ['Release version', 'v1.2.3'],
  ]);
  const html = certificateDocument(job());
  assert.match(html, /<div class="strip" data-credential-strip>/);
  assert.match(html, /<span class="strip-label">Credential ID<\/span><span class="strip-value id" data-credential-id>APCCMMA-2026-0201-[0-9A-Z]{4}<\/span>/);
  assert.match(html, /<span class="strip-label">Status<\/span><span class="strip-value status">Active Perpetual License<\/span>/);
  assert.match(html, /<span class="strip-label">Release version<\/span><span class="strip-value" data-release-version>v1\.2\.3<\/span>/);
  // The status prints in capitals: STATUS: ACTIVE PERPETUAL LICENSE.
  assert.match(styleOf(html), /\.strip-value\.status \{ text-transform: uppercase; \}/);
  // No version prints a dash rather than a bare "v".
  assert.deepEqual(credentialStrip(checkCertificateJob(job({ version: '' })))[2], ['Release version', NO_DATE]);
});

test('the status pill: ACTIVE PERPETUAL LICENSE with no expiry day, ACTIVE PILOT LICENSE (EXPIRES YYYY-MM-DD) with one', () => {
  // No expiry date: the perpetual sponsorship.
  for (const expiresOn of [undefined, '', null]) {
    const html = certificateDocument(job({ expiresOn }));
    assert.match(html, /<span class="strip-value status">Active Perpetual License<\/span>/, String(expiresOn));
    assert.doesNotMatch(html, /data-expires-on|Pilot/);
  }
  // A dated key: the pilot status names its day, a step smaller so the strip stays on one line.
  const pilot = certificateDocument(job({ expiresOn: '2026-12-15' }));
  assert.deepEqual(credentialStrip(checkCertificateJob(job({ expiresOn: '2026-12-15' })))[1], ['Status', 'Active Pilot License (Expires 2026-12-15)']);
  assert.match(pilot, /<span class="strip-label">Status<\/span><span class="strip-value status long" data-expires-on>Active Pilot License \(Expires 2026-12-15\)<\/span>/);
  assert.match(styleOf(pilot), /\.strip-value\.status \{ text-transform: uppercase; \}/, 'prints as ACTIVE PILOT LICENSE (EXPIRES 2026-12-15)');
  assert.match(styleOf(pilot), /\.strip-value\.status\.long \{ font-size: 7\.8pt;/);
  assert.doesNotMatch(textOf(pilot), /Active Perpetual License/);
  // Anything that is not a YYYY-MM-DD day is not trusted: the sheet falls back to the perpetual status rather than printing it.
  for (const bad of ['15/12/2026', '2026-12-15T00:00:00Z', '<b>2026-12-15</b>', 42]) {
    assert.equal(checkCertificateJob(job({ expiresOn: bad })).expiresOn, '', String(bad));
    assert.match(certificateDocument(job({ expiresOn: bad })), /<span class="strip-value status">Active Perpetual License<\/span>/);
  }
});

test('a license expiry becomes its UTC day; perpetual (null) and anything that is not a date give none', () => {
  assert.equal(expiryDayOf('2026-12-15T00:00:00.000Z'), '2026-12-15');
  assert.equal(expiryDayOf('2026-12-15T23:59:59.000Z'), '2026-12-15', 'the UTC day, the clock the expiry is measured on');
  assert.equal(expiryDayOf('2026-12-16T07:30:00+08:00'), '2026-12-15');
  for (const none of [null, undefined, '', 'not a date', 1765756800000]) assert.equal(expiryDayOf(none), '', String(none));
});

test('the Delivered System & Architectural Scope block sits under the facts with its three items', () => {
  const html = certificateDocument(job());
  const block = html.match(/<div class="delivered" data-delivered-scope>([\s\S]*?)<\/div>/)?.[1];
  assert.ok(block, 'the block is there');
  assert.match(block, new RegExp(`^<h2>${DELIVERED_SCOPE_TITLE.replace('&', '&amp;')}</h2><ul>`));
  assert.equal(block.split('<li>').length - 1, 3);
  for (const { title, text } of DELIVERED_SCOPE) {
    assert.ok(block.includes(`<span class="delivered-title">${title.replace('&', '&amp;')}</span>`), title);
    assert.ok(block.includes(`<span class="delivered-text">${text.replace('&', '&amp;')}</span>`), text);
  }
  assert.ok(html.indexOf('<table class="facts">') < html.indexOf('data-delivered-scope'), 'after the facts');
  assert.ok(html.indexOf('data-delivered-scope') < html.indexOf('data-seal'), 'before the seal');
});

test('three signature lines under the seal: the Parish Priest / Rector, the Music Ministry Coordinator, and the developer as sponsor', () => {
  assert.deepEqual(SIGNATURES, [
    { role: 'Parish Priest / Rector', name: '', dated: true, seal: true },
    { role: 'Music Ministry Coordinator', name: '', dated: true, seal: false },
    { role: 'Lead Systems Architect & Sponsor', name: 'Kristian Pacatang Mukara', dated: false, seal: false },
  ]);
  const html = certificateDocument(job());
  assert.equal(html.split('<div class="sig-line"></div>').length - 1, 3);
  assert.match(html, /<p class="sig-name">Kristian Pacatang Mukara<\/p><p class="sig-role">Lead Systems Architect &amp; Sponsor<\/p><\/div>/);
  assert.match(html, /<p class="sig-name"><\/p><p class="sig-role">Parish Priest \/ Rector<\/p>/);
  assert.match(html, /<p class="sig-name"><\/p><p class="sig-role">Music Ministry Coordinator<\/p>/);
  // The seal is centred directly above the three columns, inside the same closing section.
  assert.match(html, /<section class="attest"><svg class="seal-art"[\s\S]*?<\/svg><div class="signatures">/);
});

test('the two parish signatures each carry a muted Date Signed blank, and the Parish Priest\'s the Official Parish Seal cue', () => {
  const html = certificateDocument(job());
  const dateLine = '<p class="sig-date" data-date-signed>Date Signed: <span class="sig-blank"></span></p>';
  assert.ok(html.includes(`<p class="sig-role">Parish Priest / Rector</p>${dateLine}<p class="sig-seal" data-parish-seal>Official Parish Seal</p></div>`));
  assert.ok(html.includes(`<p class="sig-role">Music Ministry Coordinator</p>${dateLine}</div>`));
  assert.equal(html.split(dateLine).length - 1, 2, 'the developer\'s printed name needs no date');
  assert.equal(html.split('data-parish-seal').length - 1, 1, 'one seal, the parish\'s');
  assert.ok(textOf(html).includes('Parish Priest / Rector Date Signed: Official Parish Seal'));
  // Compact and muted: smaller and lighter than the role, a ruled blank rather than a row of underscores, the seal cue a dashed gold outline.
  const style = styleOf(html);
  assert.match(style, /\.sig-date \{ margin: 1mm 0 0; font-size: 6\.6pt; line-height: 1\.2; color: #64748b; white-space: nowrap; \}/);
  assert.match(style, /\.sig-blank \{ display: inline-block; width: 24mm;[^}]*border-bottom: 0\.5pt solid #94a3b8; \}/);
  assert.match(style, /\.sig-seal \{[^}]*border: 0\.5pt dashed #b9a274;[^}]*font-size: 5\.8pt;[^}]*text-transform: uppercase;/);
});

// ── Emblem, seal, frame and watermark ──────────────────────────────────────

test('the APCCMMA emblem heads the sheet as an embedded data URI, byte for byte the web logo', () => {
  const html = certificateDocument(job());
  assert.ok(html.includes(`<img class="emblem" src="${CERTIFICATE_EMBLEM}" alt="APCCMMA emblem" data-emblem>`));
  assert.ok(html.indexOf('data-emblem') < html.indexOf('<p class="eyebrow">'), 'above APCCMMA PRESENTATION');
  const png = readFileSync(new URL('../web/img/logo.png', import.meta.url));
  assert.equal(CERTIFICATE_EMBLEM, `data:image/png;base64,${png.toString('base64')}`, 'shared/certificate-emblem.js matches web/img/logo.png');
});

test('without a usable emblem picture the drawn SVG crest heads the sheet instead', () => {
  for (const emblem of [null, '', 'https://example.invalid/logo.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AAAA" onerror="x']) {
    const html = certificateDocument(job(), { emblem });
    assert.doesNotMatch(html, /<img/, String(emblem));
    assert.match(html, /<section class="head"><svg class="emblem-art" viewBox="0 0 100 100" role="img" aria-label="APCCMMA crest" data-crest>/);
  }
  // Only code chooses the emblem: a job from the window that names one is ignored.
  const html = certificateDocument({ ...job(), emblem: 'data:image/png;base64,QUFB' });
  assert.ok(html.includes(CERTIFICATE_EMBLEM));
  assert.doesNotMatch(html, /QUFB"/);
  assert.equal('emblem' in checkCertificateJob({ ...job(), emblem: 'x' }), false);
});

test('the official seal is inline SVG carrying the seal wording, with ids of its own', () => {
  const html = certificateDocument(job());
  const seal = html.match(/<svg class="seal-art"[\s\S]*?<\/svg>/)?.[0];
  assert.ok(seal);
  assert.match(seal, /role="img" aria-label="Official seal" data-seal/);
  assert.equal(SEAL_TEXT, 'APCCMMA · Verified Production Deployment · Sponsored Ministry License');
  assert.match(seal, /<textPath href="#apccmma-seal-top" startOffset="50%">APCCMMA · VERIFIED PRODUCTION DEPLOYMENT<\/textPath>/);
  assert.match(seal, /<textPath href="#apccmma-seal-bottom" startOffset="50%">SPONSORED MINISTRY LICENSE<\/textPath>/);
  assert.match(seal, />APCCMMA<\/text>/);
  assert.match(seal, />OFFICIAL SEAL<\/text>/);
  // Every id in the document is unique, so the seal's paths and gradient can never pick up another drawing's.
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids.sort(), ['apccmma-seal-bottom', 'apccmma-seal-fill', 'apccmma-seal-top']);
});

test('a two-tone double border with four corner ornaments and a faint crest watermark behind the text', () => {
  const html = certificateDocument(job());
  const style = styleOf(html);
  assert.match(style, /\.frame \{[^}]*border: 1\.8pt solid #8c6d3f;/, 'gold outer line');
  assert.match(style, /\.inner \{[^}]*border: 0\.8pt solid #1e293b;/, 'slate inner line');
  assert.equal(html.split('<svg class="corner-art"').length - 1, 4);
  for (const at of ['tl', 'tr', 'bl', 'br']) assert.ok(html.includes(`<div class="corner ${at}" aria-hidden="true">`), at);
  assert.match(html, /<div class="watermark" aria-hidden="true" data-watermark><svg class="watermark-art"/);
  assert.match(style, /\.watermark \{[^}]*opacity: 0\.04;/);
  assert.match(style, /\.content \{ position: relative; z-index: 1;/, 'the text sits above the watermark');
});

// ── Credential ID ──────────────────────────────────────────────────────────

test('the Credential ID is APCCMMA-YYYY-MMDD-XXXX, the same for the same registration every time', () => {
  // Pinned: changing the recipe would give every parish a different ID from the one already printed.
  assert.equal(credentialId({ church: 'Sample Parish Name', registeredDate: '2026-11-27' }), 'APCCMMA-2026-1127-BCVY');
  assert.equal(credentialId({ church: 'Sample Parish Name', registeredDate: '2026-11-28' }), 'APCCMMA-2026-1128-BAWZ');
  // Spacing, capitals and accents do not change it.
  assert.equal(credentialId({ church: '  sample   parish NAME ', registeredDate: '2026-11-27' }), 'APCCMMA-2026-1127-BCVY');
  assert.equal(credentialId({ church: 'Sample Parísh Name', registeredDate: '2026-11-27' }), 'APCCMMA-2026-1127-BCVY');
  assert.equal(normalizedParishName(' Sto. Niño  Sample Parish '), 'STONINOSAMPLEPARISH');
  // A different parish on the same day gets a different code.
  assert.notEqual(credentialId({ church: 'Sample Parish Two', registeredDate: '2026-11-27' }), 'APCCMMA-2026-1127-BCVY');
  // Crockford digits only: no I, L, O or U to misread.
  for (let i = 0; i < 200; i += 1) {
    assert.match(credentialId({ church: `Sample Parish ${i}`, registeredDate: '2026-01-15' }), /^APCCMMA-2026-0115-[0-9A-HJKMNP-TV-Z]{4}$/);
  }
});

test('a registration with no day kept gets an UNDATED Credential ID, and a bad day is not trusted', () => {
  assert.equal(credentialId({ church: 'Sample Parish Name', registeredDate: '' }), 'APCCMMA-UNDATED-06QF');
  assert.equal(credentialId({ church: 'Sample Parish Name' }), 'APCCMMA-UNDATED-06QF');
  for (const bad of ['27/11/2026', '2026-13-01', '2026-11-32', '2026-11-27T00:00:00Z', '<b>2026</b>']) {
    assert.equal(checkCertificateJob(job({ registeredDate: bad })).registeredDate, '', bad);
    assert.equal(credentialId({ church: 'Sample Parish Name', registeredDate: bad }), 'APCCMMA-UNDATED-06QF', bad);
  }
  assert.match(certificateDocument(job({ registeredDate: undefined })), /data-credential-id>APCCMMA-UNDATED-06QF</);
});

// ── Escaping and tidying ───────────────────────────────────────────────────

test('the parish\'s own words are escaped, so a name can never add markup or a script to the sheet', () => {
  const html = certificateDocument(
    job({ church: 'Sample <script>alert(1)</script> & "Parish"', location: "Sample <b>City</b>'s", registeredOn: '<img src=x onerror=alert(1)>' }),
  );
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<b>City/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /Sample &lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;Parish&quot;/);
  assert.match(html, /Sample &lt;b&gt;City&lt;\/b&gt;&#39;s/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  // The name lands in the licensee line, the Licensed to row and nowhere else unescaped: the only <img> is the emblem.
  assert.equal(html.split('<img').length - 1, 1);
});

test('the job is tidied like a saved registration; no date prints a dash, a bad version prints none, an unknown paper is A4', () => {
  assert.deepEqual(
    checkCertificateJob({ church: '  Sample   Parish Name ', location: ' Sample\tCity ', registeredOn: '', registeredDate: '2026-11-27', version: '1.0.0-beta.1' }),
    { church: 'Sample Parish Name', location: 'Sample City', registeredOn: NO_DATE, registeredDate: '2026-11-27', expiresOn: '', version: '1.0.0-beta.1', paper: 'A4' },
  );
  assert.equal(checkCertificateJob(job({ registeredOn: undefined })).registeredOn, '—');
  assert.equal(checkCertificateJob(job({ version: '<img src=x>' })).version, '');
  assert.equal(checkCertificateJob(job({ church: 'x'.repeat(500) })).church.length, 120, 'a huge name is cut to the registration limit');
  assert.equal(checkCertificateJob(job({ paper: 'Letter' })).paper, 'Letter');
  for (const paper of ['letter', 'A3', '__proto__', 'toString', 42, null]) assert.equal(checkCertificateJob(job({ paper })).paper, 'A4', String(paper));
  // A location is optional on the sheet: the name prints alone.
  assert.ok(textOf(certificateDocument(job({ location: '' }))).includes('Licensed to Sample Parish Name License type'));
});

test('a certificate made out to nobody is refused', () => {
  assert.throws(() => checkCertificateJob(job({ church: '   ' })), /Register the church/);
  assert.throws(() => checkCertificateJob(null), /Register the church/);
  assert.throws(() => certificateDocument({}), /Register the church/);
});

// ── One page, A4 or Letter ─────────────────────────────────────────────────

test('A4 and US Letter are the two papers, A4 by default', () => {
  assert.equal(DEFAULT_PAPER, 'A4');
  assert.deepEqual(Object.keys(CERTIFICATE_PAPERS), ['A4', 'Letter']);
  assert.deepEqual({ ...CERTIFICATE_PAPERS.A4 }, { name: 'A4', css: 'A4', width: 210, height: 297 });
  assert.deepEqual({ ...CERTIFICATE_PAPERS.Letter }, { name: 'Letter', css: 'letter', width: 215.9, height: 279.4 });
  assert.equal(paperOf('Letter'), CERTIFICATE_PAPERS.Letter);
  assert.equal(paperOf('nonsense'), CERTIFICATE_PAPERS.A4);
});

test('one clean portrait sheet per paper: its @page, a sheet a hair under the paper, nothing that can spill onto a second page', () => {
  for (const [paper, page, sheet] of [
    ['A4', 'A4', /\.sheet \{ width: 210mm; height: 296mm;[^}]*overflow: hidden; \}/],
    ['Letter', 'letter', /\.sheet \{ width: 215\.9mm; height: 278\.4mm;[^}]*overflow: hidden; \}/],
  ]) {
    const html = certificateDocument(job({ paper }));
    const style = styleOf(html);
    assert.ok(style.includes(`@page { size: ${page} portrait; margin: 0; }`), paper);
    assert.match(style, sheet, `${paper}: 1mm under the paper, so it never spills onto a second page`);
    assert.match(html, new RegExp(`<main class="sheet" data-certificate data-paper="${paper}">`));
    // The five sections share out the height between them, so neither paper leaves one awkward gap.
    assert.match(style, /\.content \{[^}]*height: 100%; display: flex; flex-direction: column; justify-content: space-between;/);
    assert.match(style, /\.inner \{[^}]*overflow: hidden; \}/);
  }
  // The layout is measured against Letter, the shorter sheet: these are the sizes that keep the longest registration on one page there
  // (checked in a real Chromium render, A4 and Letter, 120-character name and location in capitals, pilot status, signature date cues).
  const style = styleOf(certificateDocument(job()));
  assert.match(style, /\.emblem \{ display: block; height: 23mm; width: 23mm;/);
  assert.match(style, /\.seal-art \{ display: block; width: 26mm; height: 26mm; \}/);
  // 8.5mm, the foot 2.4mm under the signatures: room won back for the Date Signed and parish seal cues (about 7px spare on Letter).
  assert.match(style, /\.sig-line \{ height: 8\.5mm;/);
  assert.match(style, /\.foot \{ margin: 2\.4mm 0 0;/);
  assert.match(style, /\.licensee, \.place \{ -webkit-line-clamp: 2; \}/);
  assert.match(style, /\.facts \.v \{ -webkit-line-clamp: 3; \}/);
});

test('a long name and location step down in size, so they stay inside their lines', () => {
  const long = certificateDocument(job({ church: 'Sample Parish Name '.repeat(3).trim(), location: 'Sample City, Sample Province, Sample Region, Sample Country' }));
  assert.match(long, /<p class="licensee long" data-licensee>/);
  const longest = certificateDocument(job({ church: 'Sample Parish Name '.repeat(6).trim(), location: 'Sample City, Sample Province, Sample Region, Sample Country Name' }));
  assert.match(longest, /<p class="licensee longest" data-licensee>/);
  assert.match(longest, /<p class="place long">/);
  assert.match(longest, /<tr><th scope="row">Licensed to<\/th><td class="long"><span class="v">/);
});

test('a name typed in capitals sets wider, so it steps down further than the same length in mixed case', () => {
  assert.equal(setWidth('Sample'), 6.4);
  assert.equal(setWidth('SAMPLE'), 8.4);
  const mixed = 'Sample Parish Name With A Long Title '.repeat(4).slice(0, 118).trim();
  const caps = mixed.toUpperCase();
  assert.match(certificateDocument(job({ church: mixed })), /<p class="licensee longest" data-licensee>/);
  const html = certificateDocument(job({ church: caps, location: 'SAMPLE CITY, SAMPLE PROVINCE, SAMPLE REGION, SAMPLE COUNTRY NAME SAMPLE CITY, SAMPLE PROVINCE' }));
  assert.match(html, /<p class="licensee max" data-licensee>/);
  assert.match(html, /<p class="place long">/);
  assert.match(html, /<tr><th scope="row">Licensed to<\/th><td class="long max"><span class="v">/);
  assert.match(styleOf(html), /\.licensee\.max \{ font-size: 10\.5pt; \}/);
  assert.match(styleOf(html), /\.facts td\.max \{ font-size: 7\.2pt; \}/);
});

test('white paper, its own fonts, no scripts, and nothing loaded from outside: every picture is embedded', () => {
  for (const paper of ['A4', 'Letter']) {
    for (const emblem of [undefined, null]) {
      const html = certificateDocument(job({ paper }), emblem === undefined ? undefined : { emblem });
      assert.ok(html.startsWith('<!doctype html>'));
      assert.match(html, /<meta charset="utf-8">/);
      assert.match(html, /background: #ffffff/);
      assert.doesNotMatch(html, /<script|<link|@import|<iframe|<object|<embed/i);
      // Every src and url() is a data URI or a reference inside the page itself.
      for (const [, value] of html.matchAll(/\ssrc="([^"]*)"/g)) assert.match(value, /^data:image\/png;base64,/);
      for (const [, value] of html.matchAll(/url\(([^)]*)\)/g)) assert.match(value, /^#apccmma-/);
      for (const [, value] of html.matchAll(/\shref="([^"]*)"/g)) assert.match(value, /^#apccmma-/);
    }
  }
});

test('the PDF file name carries the parish name in plain letters', () => {
  assert.equal(certificateFileName('Sample Parish Name'), 'APCCMMA-License-Certificate-Sample-Parish-Name.pdf');
  assert.equal(certificateFileName('  Sto. Niño   Sample / Parish '), 'APCCMMA-License-Certificate-Sto-Nino-Sample-Parish.pdf');
  assert.equal(certificateFileName('<>:"/\\|?*'), 'APCCMMA-License-Certificate.pdf');
});
