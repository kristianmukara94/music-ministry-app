import { useCallback } from 'react';
import { bridge } from '../live/bridge';
import { currentChurchProfile, setChurchProfile, useSavedChurchProfile } from '../church/profile';
import { DEFAULT_MINISTRY_NAME, type ChurchProfile as SavedChurchProfile } from '../church/types';

/**
 * The parish profile every screen reads: the one source of the parish name, ministry name and logo in the renderer.
 *
 * There is no React provider to mount. The values come from one store per window (src/church/profile.ts), which the main process keeps
 * current: a save from the setup wizard or Settings is broadcast as `church:changed` to every window (operator, projector, lower third,
 * failover), so each window's screens re-render with the new name at once. A provider would have to be added to each of those roots,
 * and a screen outside one would silently show nothing.
 */
export interface ChurchProfile {
  /** The parish name, e.g. "Sto. Niño de Cebu Parish". Empty before setup and while loading. */
  churchName: string;
  /** The ministry, e.g. "Charismatic Music Ministry". Never empty: the generic "Music Ministry" when the parish has not set one. */
  ministryName: string;
  /** The custom logo (a data URL), or null when the built-in APCCMMA emblem is in use. Draw useChurchLogo() for the image to show. */
  logoUrl: string | null;
  /** True until the main process has answered. */
  isLoading: boolean;
  /** Saves a change and tells every window. Rejects, with a message to show, when a name is not valid. */
  updateProfile: (updates: ChurchProfileUpdate) => Promise<void>;
}

/** What updateProfile can change. Fields left out keep their saved value. */
export interface ChurchProfileUpdate {
  churchName?: string;
  /** Blank clears it, so the generic "Music Ministry" shows. */
  ministryName?: string;
  /** PNG bytes for a new logo, or null to go back to the built-in emblem. */
  logo?: Uint8Array | null;
}

/** Saves a profile change outside React. */
export async function updateChurchProfile(updates: ChurchProfileUpdate): Promise<SavedChurchProfile> {
  const current = currentChurchProfile() ?? (await bridge.church.getProfile());
  const saved = await bridge.church.saveProfile({
    name: updates.churchName ?? current.churchName,
    ...(updates.ministryName !== undefined ? { ministry: updates.ministryName } : {}),
    ...(updates.logo !== undefined ? { logo: updates.logo } : {}),
  });
  // This window updates at once; the others follow the broadcast.
  setChurchProfile(saved);
  return saved;
}

export function useChurchProfile(): ChurchProfile {
  const saved = useSavedChurchProfile();
  const updateProfile = useCallback(async (updates: ChurchProfileUpdate) => {
    await updateChurchProfile(updates);
  }, []);
  return {
    churchName: saved?.churchName ?? '',
    ministryName: saved?.ministryName || DEFAULT_MINISTRY_NAME,
    logoUrl: saved?.logoDataUrl ?? null,
    isLoading: saved === null,
    updateProfile,
  };
}

export { useChurchLogo, useChurchName, useMinistryName } from '../church/profile';
