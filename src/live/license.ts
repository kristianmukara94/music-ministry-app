import { create } from 'zustand';
import { bridge, type LicenseStatus } from './bridge';

const REFRESH_MS = 60_000;

/** The tooltip on a control that an expired license has switched off. */
export const LICENSE_LOCKED_TIP = 'The church license has expired. Renew it to use this.';

/** This laptop's license as the main process last reported it. Null until the first answer. */
export const useLicense = create<{ status: LicenseStatus | null }>()(() => ({ status: null }));

export const refreshLicense = (): Promise<void> =>
  bridge.license
    .get()
    .then((status) => useLicense.setState({ status }))
    .catch(() => undefined);

/**
 * Keeps the status current. The main process reports changes (a renewal, or a new date from the heartbeat), and the timer catches a license
 * that runs out while the app is open. Returns the stop function.
 */
export function startLicenseWatch(): () => void {
  void refreshLicense();
  const stopListening = bridge.license.onChanged((status) => useLicense.setState({ status }));
  const timer = window.setInterval(() => void refreshLicense(), REFRESH_MS);
  return () => {
    stopListening();
    window.clearInterval(timer);
  };
}

/** True when the main process would refuse to turn the projector on. */
export const projectionLocked = (): boolean => useLicense.getState().status?.canProject === false;

/** The same, for a control that has to redraw when it changes. */
export const useProjectionLocked = (): boolean => useLicense((s) => s.status?.canProject === false);
