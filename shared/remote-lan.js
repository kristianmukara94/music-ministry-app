// The two LAN addresses in the Remote Control drawer, and their labels in the three languages of the app.
// The phone row is the chosen viewer's address. The TV row is the Secondary viewer's address with /tv on the end, because the TV page is
// served on the Secondary port only (electron/remote-view-server.js). Both come from the same status poll, so when the laptop changes
// network adapter (WiFi to cable, say) both rows change together.

const STRINGS = {
  en: {
    phoneLabel: 'Phone / Stage Mirror IP',
    phoneHint: 'For phones and tablets without a QR scanner: type this address in the browser.',
    tvLabel: 'TV IP (Smart TV Projector)',
    tvHint: 'Type this address in a Smart TV or large screen browser on the same WiFi.',
    tvOff: 'Turn on the Secondary viewer to show the TV address.',
    copy: 'Copy',
    copied: 'Copied',
    copyPhone: 'Copy the Phone / Stage Mirror address',
    copyTv: 'Copy the TV address',
  },
  tl: {
    phoneLabel: 'IP ng Telepono / Stage Mirror',
    phoneHint: 'Para sa telepono at tablet na walang QR scanner: i-type ang address na ito sa browser.',
    tvLabel: 'TV IP (Smart TV Projector)',
    tvHint: 'I-type ang address na ito sa browser ng Smart TV o malaking screen na nasa parehong WiFi.',
    tvOff: 'Buksan ang Secondary viewer para makita ang address ng TV.',
    copy: 'Kopyahin',
    copied: 'Nakopya',
    copyPhone: 'Kopyahin ang address ng Telepono / Stage Mirror',
    copyTv: 'Kopyahin ang address ng TV',
  },
  ceb: {
    phoneLabel: 'IP sa Telepono / Stage Mirror',
    phoneHint: 'Para sa telepono ug tablet nga walay QR scanner: i-type kini nga address sa browser.',
    tvLabel: 'TV IP (Smart TV Projector)',
    tvHint: 'I-type kini nga address sa browser sa Smart TV o dakong screen nga anaa sa samang WiFi.',
    tvOff: 'Ablihi ang Secondary viewer aron makita ang address sa TV.',
    copy: 'Kopyaha',
    copied: 'Nakopya',
    copyPhone: 'Kopyaha ang address sa Telepono / Stage Mirror',
    copyTv: 'Kopyaha ang address sa TV',
  },
};

/** Looks up `key` in `lang`, falling back to English. */
export function lanT(lang, key) {
  return (STRINGS[lang] ?? STRINGS.en)[key] ?? STRINGS.en[key] ?? key;
}

export const LAN_KEYS = Object.keys(STRINGS.en);
export const LAN_LANGS = Object.keys(STRINGS);

/** The TV page's address on a Secondary viewer address: the same host and port, path /tv. Null when there is no address. */
export function tvUrlFrom(secondaryUrl) {
  if (!secondaryUrl) return null;
  try {
    return new URL('/tv', secondaryUrl).toString();
  } catch {
    return null;
  }
}

/**
 * The drawer's two rows from one status poll: `phone` is the chosen viewer's address while it runs, `tv` the Secondary viewer's /tv page
 * while the Secondary viewer runs (whichever viewer tab is open). Either is null when its viewer is off.
 */
export function lanAddresses(status, role) {
  const viewer = status?.[role];
  const secondary = status?.secondary;
  return {
    phone: viewer?.running ? viewer.url ?? null : null,
    tv: secondary?.running ? tvUrlFrom(secondary.url) : null,
  };
}
