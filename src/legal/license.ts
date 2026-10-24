// The licensing text, in one place. The EULA modal, the About card, and the sidebar footer all read from here,
// so a wording change cannot leave one of them behind.

export const SOFTWARE_NAME = 'APCCMMA Presentation';
export const DEVELOPER = 'Kristian Mukara';
export const COPYRIGHT_NOTICE = `© 2026 ${DEVELOPER}. All Rights Reserved.`;
/** The developer and copyright line on the About card. */
export const BUILT_BY_LINE = `Built by ${DEVELOPER} · © 2026 All Rights Reserved`;
export const AUTHORIZED_SCOPE = 'Philippine Church & Worship Ministry Use Only';
export const LICENSED_BADGE = 'Licensed for Philippine Ministry Use';
export const FOOTER_TEXT = `${SOFTWARE_NAME} · Licensed for Church Use Only · © ${DEVELOPER}`;

/** The checkbox the operator must tick before the software opens. */
export const EULA_CONFIRMATION = 'I confirm this software will be used solely for official Philippine church and music ministry purposes.';

export interface LegalSection {
  title: string;
  paragraphs: string[];
}

/** The End-User License Agreement, as the copyright holder worded it. */
export const EULA_TITLE = 'END-USER LICENSE AGREEMENT (EULA)';
export const EULA_SECTIONS: LegalSection[] = [
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
];
