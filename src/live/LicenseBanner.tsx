import { useState } from 'react';
import { useLicense } from './license';
import { RenewLicenseDialog } from './RenewLicenseDialog';

/** The operator console's line about an expired license. It blocks nothing on the page: planning carries on underneath it. */
export function LicenseBanner() {
  const banner = useLicense((s) => s.status?.banner);
  const [renewing, setRenewing] = useState(false);
  if (!banner) return null;
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b border-danger/40 bg-panel px-5 py-2 text-sm">
      <span className="min-w-0">{banner}</span>
      <button type="button" onClick={() => setRenewing(true)} className="rounded-md bg-accent px-3 py-1.5 text-xs font-bold text-on-accent uppercase hover:brightness-110">
        Renew License
      </button>
      {renewing && <RenewLicenseDialog onClose={() => setRenewing(false)} />}
    </div>
  );
}
