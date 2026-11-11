import { create } from 'zustand';
import { bridge } from '../live/bridge';
import { LOGO_SRC } from '../brand/logo';
import type { ChurchProfile } from './types';

interface ProfileStore {
  /** Null until the main process answers. */
  profile: ChurchProfile | null;
}

const useProfileStore = create<ProfileStore>(() => ({ profile: null }));

// Loaded once per window and kept current from then on. Every window (operator, projector, lower third, failover) shares this.
let started = false;
function start() {
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

/** The whole profile, or null while it loads. */
export function useChurchProfile(): ChurchProfile | null {
  start();
  return useProfileStore((s) => s.profile);
}

/** The parish logo to draw: the custom one when set, otherwise the built-in APCCMMA emblem. */
export function useChurchLogo(): string {
  start();
  return useProfileStore((s) => s.profile?.logoDataUrl ?? LOGO_SRC);
}

/** The parish name, or an empty string before setup or while loading. */
export function useChurchName(): string {
  start();
  return useProfileStore((s) => s.profile?.churchName ?? '');
}

/** Puts a just-saved profile in place at once, without waiting for the change event. */
export function setChurchProfile(profile: ChurchProfile) {
  useProfileStore.setState({ profile });
}
