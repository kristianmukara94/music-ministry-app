import { useEffect, useState } from 'react';
import { LOGO_SRC } from '../brand/logo';
import { bridge } from '../live/bridge';
import { ChurchProfileForm } from '../church/ChurchProfileForm';
import { setChurchProfile, useChurchProfile } from '../church/profile';

/**
 * First-time setup: the parish name and logo, shown once after the license is accepted and before the console can be used. There is no
 * close button: the only way on is to save a name. The logo can be left as the APCCMMA emblem and changed later in Settings.
 */
export function OnboardingWizard({ onComplete }: { onComplete: () => void }) {
  const profile = useChurchProfile();
  // Read again on opening: the license step just saved the registered church, which the name field starts from.
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    bridge.church
      .getProfile()
      .then(setChurchProfile)
      .catch(() => undefined)
      .finally(() => setFresh(true));
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/85 p-4 backdrop-blur-md">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-subtitle"
        className="my-auto flex max-h-full w-full max-w-3xl flex-col rounded-xl border border-fg/15 bg-panel shadow-2xl"
      >
        <header className="flex items-center gap-4 border-b border-line px-6 py-5">
          <img src={LOGO_SRC} alt="" draggable={false} className="size-14 shrink-0 object-contain" />
          <div className="min-w-0">
            <p className="eyebrow">First-time setup</p>
            <h2 id="onboarding-title" className="text-2xl font-bold tracking-tight">
              Welcome to <span className="text-accent">APCCMMA</span> Presentation Manager
            </h2>
            <p id="onboarding-subtitle" className="mt-1 text-sm text-muted">
              Set up your parish profile to get started. You can change these at any time in Settings › Parish Profile &amp; Logo.
            </p>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {/* Waits for the profile, so the registered church name is already in the field. */}
          {profile && fresh ? (
            <ChurchProfileForm
              initialName={profile.churchName}
              currentLogo={profile.logoDataUrl}
              submitLabel="Complete Setup & Launch"
              savingLabel="Setting up…"
              onSaved={onComplete}
            />
          ) : (
            <p className="py-10 text-center text-sm text-muted">Loading…</p>
          )}
        </div>
      </div>
    </div>
  );
}
