export type LanKey = 'phoneLabel' | 'phoneHint' | 'tvLabel' | 'tvHint' | 'tvOff' | 'copy' | 'copied' | 'copyPhone' | 'copyTv';

export function lanT(lang: string, key: LanKey): string;
export const LAN_KEYS: LanKey[];
export const LAN_LANGS: string[];
export function tvUrlFrom(secondaryUrl: string | null | undefined): string | null;

interface LanViewer {
  running: boolean;
  url: string | null;
}
export function lanAddresses(
  status: { primary: LanViewer; secondary: LanViewer } | null | undefined,
  role: 'primary' | 'secondary',
): { phone: string | null; tv: string | null };
