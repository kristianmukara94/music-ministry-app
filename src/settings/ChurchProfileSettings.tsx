import { useState } from 'react';
import { Check } from 'lucide-react';
import { ChurchProfileForm } from '../church/ChurchProfileForm';
import { useChurchProfile } from '../church/profile';

/** Settings › Parish Profile & Logo: change the name and logo shown across the app, without running setup again. */
export function ChurchProfileSettings() {
  const profile = useChurchProfile();
  const [savedAt, setSavedAt] = useState<number | null>(null);

  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <h2 className="mb-1 border-b border-line pb-2 text-xl font-bold tracking-tight">Parish Profile &amp; Logo</h2>
      <p className="mb-5 text-xs text-muted">
        Shown in the sidebar, on the projector&apos;s crest and failover screens, and on lower thirds that show the logo. The logo is kept on
        this computer. The license registration is separate: change it under About &amp; Licensing.
      </p>
      {profile ? (
        // Keyed by the saved logo, so a save from another window resets the form to what is now saved.
        <ChurchProfileForm
          key={profile.logoVersion ?? 'default'}
          initialName={profile.churchName}
          currentLogo={profile.logoDataUrl}
          submitLabel="Save Profile"
          requireChange
          onSaved={() => setSavedAt(Date.now())}
        />
      ) : (
        <p className="text-sm text-muted">Loading…</p>
      )}
      {savedAt && (
        <p role="status" className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-ok">
          <Check size={14} aria-hidden /> Saved. Every screen now shows the new profile.
        </p>
      )}
    </section>
  );
}
