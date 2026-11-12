import type { RosterEntry } from '../../shared/parish-profile.js';

export type { RosterEntry };

/** The parish profile as the main process reports it (electron/church-profile.js). */
export interface ChurchProfile {
  /** The parish name to show. Falls back to the registered church, and is empty only before setup. */
  churchName: string;
  /** The ministry as saved, e.g. "Charismatic Music Ministry". Empty when none was set: screens then show DEFAULT_MINISTRY_NAME. */
  ministryName: string;
  /** Where the custom logo is stored on this machine, or null when the built-in emblem is used. */
  logoPath: string | null;
  /** The custom logo as a `data:image/png` URL (or, on the browser source, a URL on its server). Null: use the built-in emblem. */
  logoDataUrl: string | null;
  /** Changes each time a new logo is saved. Null with no custom logo. */
  logoVersion: number | null;
  /** The diocese or archdiocese, e.g. "Archdiocese of Cebu". Empty when not set. */
  diocese: string;
  /** The city or town. Empty when not set. */
  location: string;
  /** The logo's size inside its round and square frames, in percent (75–120). Below 100 adds padding. */
  logoScale: number;
  /** True: a light disc sits behind the logo on dark screens, so a dark crest stays visible. */
  logoBacking: boolean;
  /** The clergy and liturgical team, offered as one-click nameplates in the Lower Third drawer. */
  roster: RosterEntry[];
  /** True once the first-time setup wizard has been completed. */
  onboarded: boolean;
}

export interface ChurchProfileInput {
  name: string;
  /** The ministry name to set (blank clears it), or left out to keep the saved one. */
  ministry?: string;
  /** PNG bytes for a new logo, null to go back to the built-in emblem, or left out to keep the current logo. */
  logo?: Uint8Array | null;
  /** Each of these is kept when left out. Blank text clears it. */
  diocese?: string;
  location?: string;
  logoScale?: number;
  logoBacking?: boolean;
  roster?: RosterEntry[];
}

export interface ChurchApi {
  getProfile(): Promise<ChurchProfile>;
  /** Saves the profile and marks setup as done. Rejects, with a message to show, when the name or logo is not valid. */
  saveProfile(input: ChurchProfileInput): Promise<ChurchProfile>;
  /** Called in every window when the profile is saved. Returns the unsubscribe. */
  onChanged(callback: (profile: ChurchProfile) => void): () => void;
}

/** The longest parish name accepted. Keep in step with CHURCH_NAME_MAX_LENGTH in electron/config.js. */
export const CHURCH_NAME_MAX = 100;

/** The longest ministry name accepted. Keep in step with MINISTRY_NAME_MAX_LENGTH in electron/config.js. */
export const MINISTRY_NAME_MAX = 100;

/** Shown wherever the ministry is named and the parish has not set its own. Generic on purpose: it names no parish. */
export const DEFAULT_MINISTRY_NAME = 'Music Ministry';
