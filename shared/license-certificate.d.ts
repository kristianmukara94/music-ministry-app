export type CertificatePaperName = 'A4' | 'Letter';

/** What the About card sends to print: the registration, the date already written in the operator's region format, and the app version. */
export interface CertificateJob {
  church: string;
  location: string;
  /** The registration date as it prints, e.g. "27/11/2026". Empty or missing prints "—". */
  registeredOn: string;
  /** The same day as YYYY-MM-DD in the operator's time zone, for the Credential ID. Missing gives an "UNDATED" ID. */
  registeredDate?: string;
  /**
   * The day a dated (pilot) license ends, YYYY-MM-DD in UTC (see expiryDayOf). Missing or empty is a perpetual license. When printing, the
   * main process replaces it with the license it holds, so the window cannot choose the status.
   */
  expiresOn?: string;
  version: string;
  /** The paper the sheet is laid out for. A4 when missing. */
  paper?: CertificatePaperName;
}

/** A job after checkCertificateJob: every field present and tidied. */
export interface CheckedCertificateJob extends CertificateJob {
  registeredDate: string;
  expiresOn: string;
  paper: CertificatePaperName;
}

export interface CertificatePaper {
  name: CertificatePaperName;
  /** The @page size keyword. */
  css: string;
  /** Millimetres. */
  width: number;
  height: number;
}

export const CERTIFICATE_TITLE: string;
export const CERTIFICATE_PAPERS: Readonly<Record<CertificatePaperName, CertificatePaper>>;
export const DEFAULT_PAPER: CertificatePaperName;
export const NO_DATE: string;
export const SIGNATURES: readonly { role: string; name: string; dated: boolean; seal: boolean }[];

export function paperOf(name: unknown): CertificatePaper;
/** A license expiry (ISO timestamp, or null for perpetual) as its YYYY-MM-DD day in UTC; "" for none. */
export function expiryDayOf(expiresAt: unknown): string;
/** How wide a line sets, in lower-case letters: capitals and digits count 1.4. */
export function setWidth(text: unknown): number;
export function checkCertificateJob(input: unknown): CheckedCertificateJob;
export function licenseeOf(job: { church: string; location: string }): string;
export function certificateFileName(church: string): string;
export function normalizedParishName(church: unknown): string;
export function credentialId(job: { church: string; registeredDate?: string }): string;
export function certificateFacts(job: CheckedCertificateJob): [label: string, value: string][];
export function credentialStrip(job: CheckedCertificateJob): [label: string, value: string][];
export function certificateDocument(input: CertificateJob, options?: { emblem?: string | null }): string;
