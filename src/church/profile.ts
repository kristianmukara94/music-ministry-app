import { create } from 'zustand';
import { bridge } from '../live/bridge';
import { LOGO_SRC } from '../brand/logo';
import { LOGO_SCALE_DEFAULT } from '../../shared/parish-profile.js';
import { DEFAULT_MINISTRY_NAME, type ChurchProfile, type RosterEntry } from './types';

// The store behind the parish profile. Screens read it through useChurchProfile (src/context/ChurchProfileContext.tsx) or the
// single-value hooks below; each subscribes only to what it shows.

interface ProfileStore {
  /** Null until the main process answers. */
  profile: ChurchProfile | null;
}

const useProfileStore = create<ProfileStore>(() => ({ profile: null }));

// Loaded once per window and kept current from then on. Every window (operator, projector, lower third, failover) shares this.
let started = false;
export function startChurchProfile() {
  if (started) return;
  started = true;
  bridge.church.onChanged((profile) => useProfileStore.setState({ profile }));
  bridge.church
    .getProfile()
    .then((profile) => {
      // A change that arrived first is newer than this answer.
      if (!useProfileStore.getState().profile) useProfileStore.setState({ profile });
    })
    .catch(() => undefined);
}

/** The profile exactly as saved, or null while it loads. For the setup forms; screens use useChurchProfile. */
export function useSavedChurchProfile(): ChurchProfile | null {
  startChurchProfile();
  return useProfileStore((s) => s.profile);
}

/** The saved profile right now, outside React. Null while it loads. */
export function currentChurchProfile(): ChurchProfile | null {
  return useProfileStore.getState().profile;
}

/** The parish logo to draw: the custom one when set, otherwise the built-in APCCMMA emblem. */
export function useChurchLogo(): string {
  startChurchProfile();
  return useProfileStore((s) => s.profile?.logoDataUrl ?? LOGO_SRC);
}

/** How the logo sits in its frame: its size in percent and whether a light backing shows on dark screens. */
export function useChurchLogoFrame(): { scale: number; backing: boolean } {
  startChurchProfile();
  const scale = useProfileStore((s) => s.profile?.logoScale ?? LOGO_SCALE_DEFAULT);
  const backing = useProfileStore((s) => s.profile?.logoBacking ?? false);
  return { scale, backing };
}

/** The clergy and liturgical team roster, for the Lower Third drawer's one-click nameplates. */
export function useChurchRoster(): RosterEntry[] {
  startChurchProfile();
  return useProfileStore((s) => s.profile?.roster ?? NO_ROSTER);
}
const NO_ROSTER: RosterEntry[] = [];

/** The parish name, or an empty string before setup or while loading. */
export function useChurchName(): string {
  startChurchProfile();
  return useProfileStore((s) => s.profile?.churchName ?? '');
}

/** The ministry name to show: the parish's own, or the generic DEFAULT_MINISTRY_NAME. */
export function useMinistryName(): string {
  startChurchProfile();
  return useProfileStore((s) => s.profile?.ministryName || DEFAULT_MINISTRY_NAME);
}

/** Puts a just-saved profile in place at once, without waiting for the change event. */
export function setChurchProfile(profile: ChurchProfile) {
  useProfileStore.setState({ profile });
}
