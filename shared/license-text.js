// The licensing text, in one place. The EULA modal, the About & Licensing card, the sidebar footer and the printed certificate all read from
// here (src/legal/license.ts re-exports it for the renderer), so a wording change cannot leave one of them behind. Pure, so the main process
// that saves the registration, the window that edits it and the tests all tidy it the same way.

export const SOFTWARE_NAME = 'APCCMMA Presentation';
export const DEVELOPER = 'Kristian Pacatang Mukara';
export const DEVELOPER_ROLE = 'Lead Systems Architect & Developer';
/** The developer's role on the certificate's signature line. */
export const SPONSOR_ROLE = 'Lead Systems Architect & Sponsor';
export const COPYRIGHT_NOTICE = `© 2026 ${DEVELOPER}. All Rights Reserved.`;
/** The developer and copyright line on the About card. */
export const BUILT_BY_LINE = `${DEVELOPER} — ${DEVELOPER_ROLE} · © 2026 All Rights Reserved`;
export const LICENSE_TYPE = 'Sponsored Perpetual Ministry License (Free / Donated)';
export const AUTHORIZED_SCOPE = 'Philippine Church & Worship Ministry Use Only';
export const LICENSED_BADGE = 'Licensed for Philippine Ministry Use';
/** The sidebar's bottom line. Short on purpose: it must fit the 1366px-wide sidebar without an ellipsis. */
export const FOOTER_TEXT = 'APCCMMA · Sponsored Ministry License';

/** The certificate's status, in its credential strip, for a copy with no expiry date (the perpetual sponsorship). */
export const CREDENTIAL_STATUS = 'Active Perpetual License';
/** The status for a copy activated with a dated (pilot) setup key. */
export const PILOT_CREDENTIAL_STATUS = 'Active Pilot License';
/** The credential strip's status: perpetual without an expiry day, pilot with its YYYY-MM-DD expiry day otherwise. */
export const credentialStatus = (expiresOn) => (expiresOn ? `${PILOT_CREDENTIAL_STATUS} (Expires ${expiresOn})` : CREDENTIAL_STATUS);
/** The certificate's grant, after the parish's name. */
export const CERTIFICATE_GRANT =
  `is granted a ${LICENSE_TYPE} to use ${SOFTWARE_NAME} for its liturgical and music ministry services: royalty-free, ` +
  'without license fees or subscriptions, and under the End-User License Agreement accepted at registration.';
/** The blank under each parish signature, and the cue under the Parish Priest's for where the parish's own seal is stamped. */
export const DATE_SIGNED_LABEL = 'Date Signed:';
export const PARISH_SEAL_CUE = 'Official Parish Seal';
/** The words around the certificate's official seal, read clockwise from the top. */
export const SEAL_TEXT = 'APCCMMA · Verified Production Deployment · Sponsored Ministry License';
/** The certificate's account of what was delivered to the parish, under its facts. */
export const DELIVERED_SCOPE_TITLE = 'Delivered System & Architectural Scope';
export const DELIVERED_SCOPE = [
  {
    title: 'Offline-First Desktop Workstation',
    text: 'Liturgical & worship presentation engine with multi-display projection, local network casting, and transactional SQLite storage.',
  },
  {
    title: 'Cloud-Synchronized Web Planner',
    text: 'Bidirectional schedule synchronization, conflict-safe tombstones, and parish ministry coordination portal.',
  },
  {
    title: 'Production Verification & Stewardship',
    text: 'Automated test-verified release engineered and sponsored for parish liturgical operations.',
  },
];

/** The checkbox the operator must tick before the software opens. */
export const EULA_CONFIRMATION = 'I confirm this software will be used solely for official Philippine church and music ministry purposes.';

/** The End-User License Agreement, as the copyright holder worded it. */
export const EULA_TITLE = 'END-USER LICENSE AGREEMENT (EULA)';
export const EULA_SECTIONS = [
  {
    title: '1. EXCLUSIVE MINISTRY GRANT',
    paragraphs: [
      'This software is custom-developed solely for official use by Philippine Catholic parishes, Christian churches, worship congregations, and recognized music/praise ministries ("Church Use Only").',
    ],
  },
  {
    title: '2. RESTRICTIONS',
    paragraphs: [
      'Commercial resale, renting, leasing, public redistribution for profit, or reverse engineering of this software is strictly prohibited.',
    ],
  },
  {
    title: '3. NON-COMMERCIAL STATUS',
    paragraphs: [
      'This application is provided to support liturgical and music ministry services in the Philippines without subscription fees or commercial charges.',
    ],
  },
  {
    title: '4. SPONSORED PERPETUAL MINISTRY LICENSE',
    paragraphs: [
      `This copy is granted to the registered church under a ${LICENSE_TYPE}. The software is donated by its developer and sponsor: no purchase price, license fee, subscription or royalty is charged for it, and none falls due later.`,
      'The grant is perpetual and royalty-free for the registered church and its ministries, for as long as they use the software within the Authorized Scope. It is personal to that church and may not be sold, sublicensed or transferred to another organization without the developer\'s written consent.',
    ],
  },
  {
    title: '5. PROVIDED "AS IS"; BEST-EFFORT MAINTENANCE',
    paragraphs: [
      'The software is provided "as is", without warranty of any kind, express or implied, including any warranty of fitness for a particular purpose or of uninterrupted, error-free operation.',
      'Updates, fixes and support are offered on a best-effort basis as the developer\'s time allows, with no guaranteed response time or service level. To the fullest extent the law allows, the developer is not liable for any loss arising from the use of the software, including an interruption during a service. The parish should keep regular backups of its database.',
    ],
  },
  {
    title: '6. CONTENT & COPYRIGHT RESPONSIBILITY',
    paragraphs: [
      'APCCMMA ships no song lyrics. Its bundled texts are limited to public-domain and openly licensed Scripture translations (listed under Open-Source & Content Notices) and a standard Holy Mass Order wording supplied for the parish to proofread against the missal approved for its diocese.',
      'Song lyrics, liturgical texts and any other material the parish enters, imports or projects remain the parish\'s responsibility. The parish is responsible for holding and maintaining its own reproduction and projection permissions, such as a CCLI or OneLicense license, for the copyrighted songs it uses.',
    ],
  },
];

/** The runtime and content attributions, shown under the EULA on the About card. */
export const NOTICES_TITLE = 'OPEN-SOURCE & CONTENT NOTICES';
export const OSS_NOTICES = [
  {
    title: 'Electron',
    paragraphs: ['MIT License. Copyright © Electron contributors and GitHub Inc. The desktop shell APCCMMA runs in.'],
  },
  {
    title: 'Chromium',
    paragraphs: [
      'BSD-style license. Copyright © The Chromium Authors. Chromium includes third-party components under their own licenses; the full list (LICENSES.chromium.html) is installed in the application folder.',
    ],
  },
  {
    title: 'Node.js',
    paragraphs: ['MIT License. Copyright © Node.js contributors and the OpenJS Foundation.'],
  },
  {
    title: 'React',
    paragraphs: ['MIT License. Copyright © Meta Platforms, Inc. and affiliates.'],
  },
  {
    title: 'SQLite',
    paragraphs: ['Public domain, by its authors at sqlite.org. Used through better-sqlite3 (MIT License, Copyright © Joshua Wise).'],
  },
  {
    title: 'Scripture translations',
    paragraphs: [
      'World English Bible (WEB): public domain. Distributed via eBible.org.',
      'Tagalog Bible (ULB): © 2018 Door43 World Missions Community. Licensed CC BY-SA 4.0. Distributed via eBible.org.',
      'Biblica® Open Ang Pulong sa Dios (CEB): © 2009, 2010, 2014, 2024 Biblica, Inc. Licensed CC BY-SA 4.0. Distributed via eBible.org.',
    ],
  },
  {
    title: 'Typefaces',
    paragraphs: [
      'Inter, Montserrat, Roboto, Playfair Display, Archivo, JetBrains Mono, Cinzel, Cormorant Garamond, Merriweather and Bodoni Moda: SIL Open Font License 1.1, packaged by Fontsource.',
    ],
  },
];

/**
 * One line of the registration as it is saved: no spaces at either end, and any run of spaces, tabs or line breaks inside it made one space.
 * "  Sample   Parish  Name " becomes "Sample Parish Name". Anything that is not text is "".
 */
export function tidyRegistrationLine(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

/** The registration form's church and location, each tidied. */
export function tidyRegistration(input) {
  return { church: tidyRegistrationLine(input?.church), location: tidyRegistrationLine(input?.location) };
}
