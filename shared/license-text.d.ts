export interface LegalSection {
  title: string;
  paragraphs: string[];
}

export const SOFTWARE_NAME: string;
export const DEVELOPER: string;
export const DEVELOPER_ROLE: string;
export const SPONSOR_ROLE: string;
export const COPYRIGHT_NOTICE: string;
export const BUILT_BY_LINE: string;
export const LICENSE_TYPE: string;
export const AUTHORIZED_SCOPE: string;
export const LICENSED_BADGE: string;
export const FOOTER_TEXT: string;
export const CREDENTIAL_STATUS: string;
export const PILOT_CREDENTIAL_STATUS: string;
/** "Active Perpetual License" with no expiry day, "Active Pilot License (Expires YYYY-MM-DD)" with one. */
export function credentialStatus(expiresOn?: string): string;
export const CERTIFICATE_GRANT: string;
export const DATE_SIGNED_LABEL: string;
export const PARISH_SEAL_CUE: string;
export const SEAL_TEXT: string;
export const DELIVERED_SCOPE_TITLE: string;
export const DELIVERED_SCOPE: { title: string; text: string }[];
export const EULA_CONFIRMATION: string;
export const EULA_TITLE: string;
export const EULA_SECTIONS: LegalSection[];
export const NOTICES_TITLE: string;
export const OSS_NOTICES: LegalSection[];

/** Trims the line and turns every run of whitespace inside it into one space. Anything that is not text is "". */
export function tidyRegistrationLine(value: unknown): string;
export function tidyRegistration(input: { church?: unknown; location?: unknown } | null | undefined): { church: string; location: string };
