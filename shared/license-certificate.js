// The Certificate of Perpetual Ministry License & Sponsorship: one portrait sheet of white paper (A4 or US Letter), laid out with none of the
// app's styles or theme. Pure, so the About card's preview (an iframe), the main process that prints it or saves it as a PDF
// (electron/license-certificate.js) and the tests all build the same document. Every value from the registration is escaped: the parish typed it.
// The sheet prints from a window with JavaScript off and loads nothing from outside: the emblem is a data URI and every other graphic
// (the corner ornaments, the watermark crest, the seal) is inline SVG.
import { CERTIFICATE_EMBLEM } from './certificate-emblem.js';
import {
  AUTHORIZED_SCOPE,
  CERTIFICATE_GRANT,
  COPYRIGHT_NOTICE,
  DATE_SIGNED_LABEL,
  DELIVERED_SCOPE,
  DELIVERED_SCOPE_TITLE,
  DEVELOPER,
  LICENSE_TYPE,
  PARISH_SEAL_CUE,
  SEAL_TEXT,
  SOFTWARE_NAME,
  SPONSOR_ROLE,
  credentialStatus,
  tidyRegistrationLine,
} from './license-text.js';

export const CERTIFICATE_TITLE = 'Certificate of Perpetual Ministry License & Sponsorship';

/**
 * The papers the certificate is laid out for, in millimetres. The name is what @page, the Print dialog and the PDF writer are given.
 * The sheet is drawn 1mm shorter than the paper, so rounding can never push it onto a second page.
 */
export const CERTIFICATE_PAPERS = Object.freeze({
  A4: Object.freeze({ name: 'A4', css: 'A4', width: 210, height: 297 }),
  Letter: Object.freeze({ name: 'Letter', css: 'letter', width: 215.9, height: 279.4 }),
});
export const DEFAULT_PAPER = 'A4';
/** The paper a job asks for, or A4 for anything else. */
export const paperOf = (name) => (Object.hasOwn(CERTIFICATE_PAPERS, name) ? CERTIFICATE_PAPERS[name] : CERTIFICATE_PAPERS[DEFAULT_PAPER]);

/** Longest value accepted for each field, so a bad caller cannot lay out a huge page. Matches REGISTRATION_MAX_LENGTH in electron/config.js. */
const FIELD_MAX = 120;
const DATE_MAX = 60;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/;
/** A calendar day as YYYY-MM-DD: the registration day the Credential ID reads, and the license's expiry day. */
const REGISTERED_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const dayOrEmpty = (value) => (typeof value === 'string' && REGISTERED_DATE.test(value) ? value : '');

/**
 * The license's expiry (an ISO timestamp from electron/license-manager.js, or null for a perpetual license) as the YYYY-MM-DD day it ends,
 * in UTC, the clock the expiry is measured on. "" for no expiry or a value that is not a date.
 */
export function expiryDayOf(expiresAt) {
  if (typeof expiresAt !== 'string') return '';
  const ms = Date.parse(expiresAt);
  return Number.isNaN(ms) ? '' : new Date(ms).toISOString().slice(0, 10);
}
/** Only a base64 PNG, JPEG or WebP is drawn as the emblem; anything else falls back to the drawn crest. */
const EMBLEM_URI = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
/** Shown for a registration with no date (a copy registered before the date was kept). */
export const NO_DATE = '—';

/**
 * The three signature lines, left to right. The developer's name is printed under the last; the parish signs the first two by hand, each
 * with a Date Signed blank, and the Parish Priest's carries the cue for the parish's own seal.
 */
export const SIGNATURES = [
  { role: 'Parish Priest / Rector', name: '', dated: true, seal: true },
  { role: 'Music Ministry Coordinator', name: '', dated: true, seal: false },
  { role: SPONSOR_ROLE, name: DEVELOPER, dated: false, seal: false },
];

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

/**
 * The job as the printer may use it: the church and location tidied like a saved registration, the date label and version kept short, the
 * registration day kept only when it is a real YYYY-MM-DD, and the paper one the sheet is laid out for.
 * Throws when there is no church to name, since a certificate made out to nobody is not one.
 */
export function checkCertificateJob(input) {
  const church = tidyRegistrationLine(input?.church).slice(0, FIELD_MAX);
  if (!church) throw new Error('Register the church before printing its certificate.');
  const location = tidyRegistrationLine(input?.location).slice(0, FIELD_MAX);
  const registeredOn = tidyRegistrationLine(input?.registeredOn).slice(0, DATE_MAX) || NO_DATE;
  const registeredDate = dayOrEmpty(input?.registeredDate);
  const expiresOn = dayOrEmpty(input?.expiresOn);
  const version = typeof input?.version === 'string' && VERSION.test(input.version.trim()) ? input.version.trim() : '';
  const paper = paperOf(input?.paper).name;
  return { church, location, registeredOn, registeredDate, expiresOn, version, paper };
}

/** "Sample Parish Name (Sample City)", or the name alone when no location is given. */
export const licenseeOf = ({ church, location }) => (location ? `${church} (${location})` : church);

/** The PDF's suggested file name: "APCCMMA-License-Certificate-Sample-Parish-Name.pdf". Only letters, digits and hyphens from the name. */
export function certificateFileName(church) {
  const slug = tidyRegistrationLine(church)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `APCCMMA-License-Certificate${slug ? `-${slug}` : ''}.pdf`;
}

// ── Credential ID ──────────────────────────────────────────────────────────

/** Crockford's base-32 digits: no I, L, O or U, so the code reads back without confusion. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 32-bit FNV-1a over the UTF-8 bytes. Not a secret: it only makes the ID stable and short. */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The parish name as the ID reads it: accents dropped, capitals, letters and digits only. "Sto. Niño Parish" becomes "STONINOPARISH". */
export const normalizedParishName = (church) =>
  tidyRegistrationLine(church)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');

/**
 * The certificate's Credential ID, "APCCMMA-YYYY-MMDD-XXXX": the registration day, then four base-32 digits from the normalized parish name
 * and that day. The same registration always gets the same ID, so a reprint matches the first copy. A registration with no day kept gets
 * "APCCMMA-UNDATED-XXXX".
 */
export function credentialId({ church, registeredDate }) {
  const day = dayOrEmpty(registeredDate);
  let hash = fnv1a(`${normalizedParishName(church)}|${day}`);
  let code = '';
  for (let i = 0; i < 4; i += 1) {
    code = CROCKFORD[hash & 31] + code;
    hash >>>= 5;
  }
  if (!day) return `APCCMMA-UNDATED-${code}`;
  const [year, month, date] = day.split('-');
  return `APCCMMA-${year}-${month}${date}-${code}`;
}

// ── What the certificate says ──────────────────────────────────────────────

/** The certificate's facts, in the order they print. */
export function certificateFacts(job) {
  return [
    ['Licensed to', licenseeOf(job)],
    ['License type', LICENSE_TYPE],
    ['Registered on', job.registeredOn],
    ['Authorized scope', AUTHORIZED_SCOPE],
  ];
}

/** The credential strip under the title, left to right. The status is perpetual unless the license has an expiry day. */
export function credentialStrip(job) {
  return [
    ['Credential ID', credentialId(job)],
    ['Status', credentialStatus(job.expiresOn)],
    ['Release version', job.version ? `v${job.version}` : NO_DATE],
  ];
}

// ── Graphics: inline SVG only, each with ids of its own ────────────────────

const round = (n) => Number(n.toFixed(2));

/** A geometric corner ornament, drawn for the top-left corner; the other three are the same drawing turned by CSS. */
const CORNER_SVG =
  '<svg class="corner-art" viewBox="0 0 40 40" aria-hidden="true">' +
  '<path d="M2 38V2h36" fill="none" stroke="#8c6d3f" stroke-width="1.6"/>' +
  '<path d="M7 38V7h31" fill="none" stroke="#1e293b" stroke-width="0.6"/>' +
  '<path d="M7 16l9-9" fill="none" stroke="#8c6d3f" stroke-width="0.6"/>' +
  '<rect x="9.5" y="9.5" width="6" height="6" transform="rotate(45 12.5 12.5)" fill="#8c6d3f"/>' +
  '<circle cx="2" cy="2" r="1.8" fill="#8c6d3f"/>' +
  '</svg>';

/** The drawn APCCMMA crest: a cross in a ringed roundel with rays. The watermark, and the emblem when no picture is given. */
function crestSvg(className) {
  const rays = Array.from({ length: 24 }, (_, i) => {
    const a = (i * Math.PI) / 12;
    const [r1, r2] = i % 2 ? [36, 41] : [35, 44];
    return `<line x1="${round(50 + r1 * Math.sin(a))}" y1="${round(50 - r1 * Math.cos(a))}" x2="${round(50 + r2 * Math.sin(a))}" y2="${round(50 - r2 * Math.cos(a))}"/>`;
  }).join('');
  return (
    `<svg class="${className}" viewBox="0 0 100 100" role="img" aria-label="APCCMMA crest" data-crest>` +
    `<g fill="none" stroke="#8c6d3f" stroke-width="1.1" stroke-linecap="round">${rays}</g>` +
    '<circle cx="50" cy="50" r="33" fill="#ffffff" stroke="#1e293b" stroke-width="1.6"/>' +
    '<circle cx="50" cy="50" r="29.5" fill="none" stroke="#8c6d3f" stroke-width="0.8"/>' +
    '<path d="M50 27v46M38 41h24" stroke="#1e293b" stroke-width="5" stroke-linecap="square"/>' +
    '<path d="M50 27v46M38 41h24" stroke="#8c6d3f" stroke-width="1.6" stroke-linecap="square"/>' +
    '<path d="M33 62q17 9 34 0" fill="none" stroke="#8c6d3f" stroke-width="1.2"/>' +
    '</svg>'
  );
}

/** A point on the seal at `degrees` clockwise from twelve o'clock. */
const onRing = (r, degrees) => {
  const a = (degrees * Math.PI) / 180;
  return [round(50 + r * Math.sin(a)), round(50 - r * Math.cos(a))];
};

/**
 * The official seal: a serrated gold rosette with its words in two arcs, both upright: the first part of SEAL_TEXT over the top (clockwise)
 * and the last part along the bottom (left to right), a star between them on each side, and APCCMMA in the middle.
 */
function sealSvg() {
  const points = Array.from({ length: 96 }, (_, i) => onRing(i % 2 ? 46.6 : 49.4, i * 3.75).join(',')).join(' ');
  const cut = SEAL_TEXT.lastIndexOf(' · ');
  const [top, bottom] = [SEAL_TEXT.slice(0, cut), SEAL_TEXT.slice(cut + 3)].map((s) => s.toUpperCase());
  // The top arc spans 210°, the bottom 120°; both text bands are centred on radius 37.
  const [topR, topFrom, topTo] = [35.4, -105, 105];
  const [bottomR, bottomFrom, bottomTo] = [38.6, 240, 120];
  const [tx1, ty1] = onRing(topR, topFrom);
  const [tx2, ty2] = onRing(topR, topTo);
  const [bx1, by1] = onRing(bottomR, bottomFrom);
  const [bx2, by2] = onRing(bottomR, bottomTo);
  const stars = [112.5, 247.5].map((deg) => {
    const [x, y] = onRing(37, deg);
    return `<text class="seal-star" x="${x}" y="${round(y + 1.6)}" text-anchor="middle">★</text>`;
  });
  return (
    '<svg class="seal-art" viewBox="0 0 100 100" role="img" aria-label="Official seal" data-seal>' +
    '<defs>' +
    '<radialGradient id="apccmma-seal-fill" cx="42%" cy="36%" r="70%">' +
    '<stop offset="0" stop-color="#d9bf86"/><stop offset="0.55" stop-color="#a8834b"/><stop offset="1" stop-color="#6e542e"/>' +
    '</radialGradient>' +
    `<path id="apccmma-seal-top" d="M${tx1},${ty1}A${topR},${topR} 0 1,1 ${tx2},${ty2}"/>` +
    `<path id="apccmma-seal-bottom" d="M${bx1},${by1}A${bottomR},${bottomR} 0 0,0 ${bx2},${by2}"/>` +
    '</defs>' +
    `<polygon points="${points}" fill="url(#apccmma-seal-fill)" stroke="#6e542e" stroke-width="0.5"/>` +
    '<circle cx="50" cy="50" r="43.2" fill="none" stroke="#fdf6e3" stroke-opacity="0.55" stroke-width="0.6"/>' +
    '<circle cx="50" cy="50" r="41.6" fill="none" stroke="#4a3818" stroke-width="0.9"/>' +
    '<circle cx="50" cy="50" r="31.2" fill="none" stroke="#4a3818" stroke-width="0.9"/>' +
    '<circle cx="50" cy="50" r="29.8" fill="none" stroke="#fdf6e3" stroke-opacity="0.55" stroke-width="0.5"/>' +
    `<text class="seal-ring" text-anchor="middle"><textPath href="#apccmma-seal-top" startOffset="50%">${esc(top)}</textPath></text>` +
    `<text class="seal-ring" text-anchor="middle"><textPath href="#apccmma-seal-bottom" startOffset="50%">${esc(bottom)}</textPath></text>` +
    stars.join('') +
    '<path d="M50 30.5v9M45.5 34h9" stroke="#fdf6e3" stroke-width="1.6"/>' +
    '<text class="seal-mark" x="50" y="53.2" text-anchor="middle">APCCMMA</text>' +
    '<path d="M36 56.6h28" stroke="#fdf6e3" stroke-opacity="0.8" stroke-width="0.5"/>' +
    '<text class="seal-sub" x="50" y="61.6" text-anchor="middle">OFFICIAL SEAL</text>' +
    '<text class="seal-sub" x="50" y="67" text-anchor="middle">★ ★ ★</text>' +
    '</svg>'
  );
}

// ── The sheet ──────────────────────────────────────────────────────────────

/** The style for one paper. The layout is set for Letter, the shorter sheet; A4's extra height is shared out between the five sections. */
function styleFor(paper) {
  return `
@page { size: ${paper.css} portrait; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #ffffff; color: #1e293b; }
body { font-family: Georgia, 'Times New Roman', serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { width: ${paper.width}mm; height: ${round(paper.height - 1)}mm; padding: 7mm; overflow: hidden; }
.frame { height: 100%; border: 1.8pt solid #8c6d3f; padding: 1.6mm; }
.inner { position: relative; height: 100%; border: 0.8pt solid #1e293b; padding: 8mm 13mm 6mm; overflow: hidden; }
.corner { position: absolute; width: 13mm; height: 13mm; }
.corner-art { display: block; width: 100%; height: 100%; }
.corner.tl { top: 1.6mm; left: 1.6mm; }
.corner.tr { top: 1.6mm; right: 1.6mm; transform: scaleX(-1); }
.corner.bl { bottom: 1.6mm; left: 1.6mm; transform: scaleY(-1); }
.corner.br { bottom: 1.6mm; right: 1.6mm; transform: scale(-1, -1); }
.watermark { position: absolute; left: 50%; top: 52%; width: 128mm; height: 128mm; transform: translate(-50%, -50%); opacity: 0.04; pointer-events: none; }
.watermark-art { display: block; width: 100%; height: 100%; }
.content { position: relative; z-index: 1; height: 100%; display: flex; flex-direction: column; justify-content: space-between; gap: 1.2mm; align-items: center; text-align: center; }
.content > section { width: 100%; display: flex; flex-direction: column; align-items: center; }
.emblem { display: block; height: 23mm; width: 23mm; object-fit: contain; }
.emblem-art { display: block; height: 23mm; width: 23mm; }
.eyebrow { margin: 2.2mm 0 0; font-family: 'Segoe UI', Arial, sans-serif; font-size: 8.5pt; font-weight: 700; letter-spacing: 0.32em; text-transform: uppercase; color: #8c6d3f; }
h1 { margin: 2.4mm 0 0; max-width: 165mm; font-size: 21pt; line-height: 1.16; font-weight: 700; color: #1e293b; text-wrap: balance; }
.strip { margin: 3.4mm 0 0; width: 100%; display: flex; justify-content: center; border-top: 0.6pt solid #8c6d3f; border-bottom: 0.6pt solid #8c6d3f; font-family: 'Segoe UI', Arial, sans-serif; }
.strip-cell { flex: 0 1 auto; min-width: 0; padding: 1.8mm 4.5mm; text-align: center; }
.strip-cell + .strip-cell { border-left: 0.6pt solid #d6c7a4; }
.strip-label { display: block; font-size: 6.2pt; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #8c6d3f; }
.strip-value { display: block; margin-top: 0.6mm; font-size: 8.6pt; font-weight: 700; letter-spacing: 0.04em; color: #1e293b; white-space: nowrap; }
.strip-value.id { font-family: Consolas, 'Courier New', monospace; letter-spacing: 0.06em; }
.strip-value.status { text-transform: uppercase; }
.strip-value.status.long { font-size: 7.8pt; letter-spacing: 0.02em; }
.lead { margin: 0; font-size: 10.5pt; font-style: italic; color: #475569; }
.licensee { margin: 2.2mm 0 0; max-width: 170mm; font-size: 20pt; line-height: 1.2; font-weight: 700; color: #0f172a; overflow-wrap: anywhere; }
.licensee.long { font-size: 14.5pt; }
.licensee.longest { font-size: 12pt; }
.licensee.max { font-size: 10.5pt; }
.place { margin: 1.2mm 0 0; max-width: 170mm; font-size: 11pt; color: #334155; overflow-wrap: anywhere; }
.place.long { font-size: 9.5pt; }
/* The parish's own lines are held to a fixed number of lines, so no name, however wide its letters, can push the signatures off the page. */
.licensee, .place, .facts .v { display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; }
.licensee, .place { -webkit-line-clamp: 2; }
.facts .v { -webkit-line-clamp: 3; }
.rule { width: 42mm; height: 0; margin: 2.8mm auto 0; border-top: 0.8pt solid #8c6d3f; }
.grant { margin: 2.6mm 0 0; max-width: 158mm; font-size: 10pt; line-height: 1.5; color: #334155; }
.facts { width: 100%; max-width: 168mm; border-collapse: collapse; font-family: 'Segoe UI', Arial, sans-serif; text-align: left; }
.facts th, .facts td { padding: 1.7mm 2.5mm; border-bottom: 0.6pt solid #d6c7a4; vertical-align: top; }
.facts tr:first-child th, .facts tr:first-child td { border-top: 0.6pt solid #d6c7a4; }
.facts th { width: 40mm; font-size: 7pt; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: #8c6d3f; }
.facts td { font-size: 9.5pt; color: #0f172a; overflow-wrap: anywhere; }
.facts td.long { font-size: 8pt; line-height: 1.3; }
.facts td.max { font-size: 7.2pt; }
.delivered { width: 100%; max-width: 168mm; border: 0.6pt solid #b9a274; background: #fbf8f1; padding: 2.6mm 3.5mm 3mm; font-family: 'Segoe UI', Arial, sans-serif; text-align: left; }
.delivered h2 { margin: 0 0 2mm; font-size: 7pt; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: #8c6d3f; text-align: center; }
.delivered ul { margin: 0; padding: 0; list-style: none; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3.5mm; }
.delivered li { margin: 0; padding-left: 2.4mm; border-left: 1.4pt solid #1e293b; }
.delivered-title { display: block; font-size: 7.8pt; font-weight: 700; color: #1e293b; line-height: 1.3; }
.delivered-text { display: block; margin-top: 0.8mm; font-size: 7.2pt; line-height: 1.42; color: #475569; }
.seal-art { display: block; width: 26mm; height: 26mm; }
.seal-ring { font-family: 'Segoe UI', Arial, sans-serif; font-size: 4.7px; font-weight: 700; letter-spacing: 0.03em; fill: #fdf6e3; }
.seal-star { font-family: 'Segoe UI Symbol', 'Segoe UI', Arial, sans-serif; font-size: 4.4px; fill: #fdf6e3; }
.seal-mark { font-family: Georgia, 'Times New Roman', serif; font-size: 9.6px; font-weight: 700; letter-spacing: 0.04em; fill: #fdf6e3; }
.seal-sub { font-family: 'Segoe UI', Arial, sans-serif; font-size: 3.9px; font-weight: 700; letter-spacing: 0.16em; fill: #fdf6e3; }
.signatures { margin-top: 1mm; width: 100%; display: flex; gap: 9mm; font-family: 'Segoe UI', Arial, sans-serif; }
.sig { flex: 1 1 0; min-width: 0; text-align: center; }
.sig-line { height: 8.5mm; border-bottom: 0.8pt solid #1e293b; }
.sig-name { margin: 1.6mm 0 0; min-height: 4.2mm; font-size: 9pt; font-weight: 700; color: #0f172a; }
.sig-role { margin: 0.4mm 0 0; font-size: 7.5pt; color: #475569; }
.sig-date { margin: 1mm 0 0; font-size: 6.6pt; line-height: 1.2; color: #64748b; white-space: nowrap; }
.sig-blank { display: inline-block; width: 24mm; height: 2.4mm; vertical-align: baseline; border-bottom: 0.5pt solid #94a3b8; }
.sig-seal { display: inline-block; margin: 0.8mm 0 0; padding: 0.4mm 2.2mm; border: 0.5pt dashed #b9a274; border-radius: 999px; font-size: 5.8pt; line-height: 1.2; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: #8c6d3f; }
.foot { margin: 2.4mm 0 0; font-family: 'Segoe UI', Arial, sans-serif; font-size: 7pt; color: #64748b; }
`;
}

/** How wide a line of text sets, in lower-case letters: capitals and digits run about 40% wider, so a name typed in capitals counts for more. */
export const setWidth = (text) => [...String(text ?? '')].reduce((n, ch) => n + (/[A-Z0-9]/.test(ch) ? 1.4 : 1), 0);

/** The licensee's type size: a long name steps down, so it stays on two lines at most. */
const licenseeSize = (church) => {
  const width = setWidth(church);
  return width > 140 ? ' max' : width > 80 ? ' longest' : width > 40 ? ' long' : '';
};
/** A fact's type size: a long value steps down, so it stays on three lines at most. */
const factSize = (value) => {
  const width = setWidth(value);
  return width > 260 ? ' class="long max"' : width > 90 ? ' class="long"' : '';
};

/**
 * The whole certificate as a standalone HTML document: no scripts, nothing loaded from outside. `emblem` is the picture at the head: the
 * APCCMMA emblem by default, or the drawn crest when it is null or not a base64 image. Only code passes it, never a job from the window.
 */
export function certificateDocument(input, { emblem = CERTIFICATE_EMBLEM } = {}) {
  const job = checkCertificateJob(input);
  const paper = paperOf(job.paper);
  // A pilot status with its expiry day sets longer than "Active Perpetual License", so it steps down to keep the strip on one line.
  const stripKinds = [' id" data-credential-id', `${job.expiresOn ? ' status long" data-expires-on' : ' status"'}`, '" data-release-version'];
  const strip = credentialStrip(job)
    .map(
      ([label, value], i) =>
        `<div class="strip-cell"><span class="strip-label">${esc(label)}</span><span class="strip-value${stripKinds[i]}>${esc(value)}</span></div>`,
    )
    .join('');
  const facts = certificateFacts(job)
    .map(([label, value]) => `<tr><th scope="row">${esc(label)}</th><td${factSize(value)}><span class="v">${esc(value)}</span></td></tr>`)
    .join('');
  const delivered = DELIVERED_SCOPE.map(
    ({ title, text }) => `<li><span class="delivered-title">${esc(title)}</span><span class="delivered-text">${esc(text)}</span></li>`,
  ).join('');
  const signatures = SIGNATURES.map(
    ({ role, name, dated, seal }) =>
      `<div class="sig"><div class="sig-line"></div><p class="sig-name">${esc(name)}</p><p class="sig-role">${esc(role)}</p>` +
      (dated ? `<p class="sig-date" data-date-signed>${esc(DATE_SIGNED_LABEL)} <span class="sig-blank"></span></p>` : '') +
      (seal ? `<p class="sig-seal" data-parish-seal>${esc(PARISH_SEAL_CUE)}</p>` : '') +
      '</div>',
  ).join('');
  const head =
    typeof emblem === 'string' && EMBLEM_URI.test(emblem)
      ? `<img class="emblem" src="${emblem}" alt="APCCMMA emblem" data-emblem>`
      : crestSvg('emblem-art');
  const corners = ['tl', 'tr', 'bl', 'br'].map((at) => `<div class="corner ${at}" aria-hidden="true">${CORNER_SVG}</div>`).join('');
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(CERTIFICATE_TITLE)}</title>`,
    `<style>${styleFor(paper)}</style>`,
    '</head><body>',
    `<main class="sheet" data-certificate data-paper="${esc(paper.name)}"><div class="frame"><div class="inner">`,
    corners,
    `<div class="watermark" aria-hidden="true" data-watermark>${crestSvg('watermark-art')}</div>`,
    '<div class="content">',
    '<section class="head">',
    head,
    `<p class="eyebrow">${esc(SOFTWARE_NAME)}</p>`,
    `<h1>${esc(CERTIFICATE_TITLE)}</h1>`,
    `<div class="strip" data-credential-strip>${strip}</div>`,
    '</section>',
    '<section class="award">',
    '<p class="lead">This certifies that</p>',
    `<p class="licensee${licenseeSize(job.church)}" data-licensee>${esc(job.church)}</p>`,
    job.location ? `<p class="place${setWidth(job.location) > 60 ? ' long' : ''}">${esc(job.location)}</p>` : '',
    '<div class="rule"></div>',
    `<p class="grant">${esc(CERTIFICATE_GRANT)}</p>`,
    '</section>',
    `<table class="facts"><tbody>${facts}</tbody></table>`,
    `<div class="delivered" data-delivered-scope><h2>${esc(DELIVERED_SCOPE_TITLE)}</h2><ul>${delivered}</ul></div>`,
    '<section class="attest">',
    sealSvg(),
    `<div class="signatures">${signatures}</div>`,
    `<p class="foot">${esc(COPYRIGHT_NOTICE)}</p>`,
    '</section>',
    '</div>',
    '</div></div></main>',
    '</body></html>',
  ].join('');
}
