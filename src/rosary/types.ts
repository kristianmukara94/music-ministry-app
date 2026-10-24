export type MysteryType = 'joyful' | 'sorrowful' | 'glorious' | 'luminous';

export const MYSTERY_TYPES: readonly MysteryType[] = ['joyful', 'sorrowful', 'glorious', 'luminous'];

/** Review status per language. Approved text is what the parish has signed off on. */
export interface Approval {
  approvedEn: number;
  approvedTl: number;
  approvedCeb: number;
}

export interface Mystery extends Approval {
  mysteryType: MysteryType;
  decadeNumber: number;
  titleEn: string;
  titleTl: string;
  titleCeb: string;
  meditationEn: string;
  meditationTl: string;
  meditationCeb: string;
  scriptureRef: string;
}

export interface RosaryPrayer extends Approval {
  key: string;
  textEn: string;
  textTl: string;
  textCeb: string;
}

/** Shape the editor saves. Column names match the backup file, so the same rows go in and out. */
export interface MysteryInput {
  mystery_type: MysteryType;
  decade_number: number;
  title_en: string;
  title_tl: string;
  title_ceb: string;
  meditation_en: string;
  meditation_tl: string;
  meditation_ceb: string;
  scripture_ref: string;
  approved_en: number;
  approved_tl: number;
  approved_ceb: number;
}

export interface PrayerInput {
  key: string;
  text_en: string;
  text_tl: string;
  text_ceb: string;
  approved_en: number;
  approved_tl: number;
  approved_ceb: number;
}

/** Result of a backup export or import. Null from the call means the operator cancelled the dialog. */
export interface RosaryBackupResult {
  path: string;
  mysteries: number;
  prayers: number;
}

export interface RosaryApi {
  getMysteries(): Promise<Mystery[]>;
  getPrayers(): Promise<RosaryPrayer[]>;
  saveMystery(input: MysteryInput): Promise<true>;
  savePrayer(input: PrayerInput): Promise<true>;
  exportJSON(): Promise<RosaryBackupResult | null>;
  importJSON(): Promise<RosaryBackupResult | null>;
}
