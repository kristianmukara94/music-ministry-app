import { useEffect, useState } from 'react';
import { bridge } from '../live/bridge';
import { COPYRIGHT_NOTICE, DEVELOPER, EULA_CONFIRMATION, EULA_SECTIONS, EULA_TITLE, SOFTWARE_NAME, type LegalSection } from '../legal/license';
import type { Registration } from '../settings/types';

const FIELD = 'h-11 rounded-md border border-line-strong bg-canvas px-3 text-sm outline-none focus:border-accent disabled:opacity-60';

/** The license terms as headed paragraphs. Shared by the first-launch modal and the Settings viewer. */
export function LicenseText({ sections = EULA_SECTIONS }: { sections?: LegalSection[] }) {
  return (
    <div className="flex flex-col gap-4 text-sm leading-relaxed">
      {sections.map((section) => (
        <section key={section.title}>
          <h3 className="mb-1 font-bold">{section.title}</h3>
          {section.paragraphs.map((paragraph, i) => (
            <p key={i} className="text-muted">
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}

/** The church name and location fields. Used by the first-launch form and by the Settings edit form. */
export function RegistrationFields({
  value,
  onChange,
  disabled = false,
}: {
  value: Registration;
  onChange: (next: Registration) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold tracking-wider uppercase">
          Church / Parish / Ministry Name <span className="text-danger">*</span>
        </span>
        <input
          type="text"
          value={value.church}
          onChange={(e) => onChange({ ...value, church: e.target.value })}
          placeholder="e.g. Assumption Parish Music Ministry"
          maxLength={120}
          required
          aria-required="true"
          disabled={disabled}
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold tracking-wider uppercase">
          Location / City <span className="text-danger">*</span>
        </span>
        <input
          type="text"
          value={value.location}
          onChange={(e) => onChange({ ...value, location: e.target.value })}
          placeholder="e.g. Davao City, Philippines"
          maxLength={120}
          required
          aria-required="true"
          disabled={disabled}
          className={FIELD}
        />
      </label>
    </div>
  );
}

/**
 * The first-launch gate. It shows the agreement and the registration form until both are complete.
 * Once they are, it renders nothing. The saved details live in config.json, so each machine asks once.
 */
export function EulaGate() {
  // null while the config loads, so the form does not flash up for someone already registered.
  const [complete, setComplete] = useState<boolean | null>(null);

  useEffect(() => {
    // If the config cannot be read, the form is shown. It is the safer side to err on.
    bridge.config
      .get()
      .then(({ config }) => setComplete(config.eula_accepted && !!config.registered_church && !!config.registered_location))
      .catch(() => setComplete(false));
  }, []);

  if (complete !== false) return null;
  return <EulaModal onAccepted={() => setComplete(true)} />;
}

function EulaModal({ onAccepted }: { onAccepted: () => void }) {
  const [registration, setRegistration] = useState<Registration>({ church: '', location: '' });
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Whitespace alone does not count as filled in.
  const filled = registration.church.trim() !== '' && registration.location.trim() !== '';
  const canAccept = filled && confirmed && !saving;

  const accept = async () => {
    setSaving(true);
    setError(null);
    try {
      await bridge.config.acceptEula({ church: registration.church.trim(), location: registration.location.trim() });
      onAccepted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  // Deliberately no close button, no Escape handler and no backdrop click. The only way forward is to accept.
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="eula-title" className="flex max-h-full w-full max-w-2xl flex-col rounded-xl border border-line-strong bg-panel shadow-2xl">
        <header className="border-b border-line px-6 py-4">
          <p className="eyebrow">{SOFTWARE_NAME}</p>
          <h2 id="eula-title" className="text-2xl font-black uppercase condensed">
            {EULA_TITLE}
          </h2>
          <p className="mt-1 text-xs text-muted">
            Software: {SOFTWARE_NAME} · Developer: {DEVELOPER} · {COPYRIGHT_NOTICE}
          </p>
        </header>

        <div tabIndex={0} aria-label="License terms" className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <LicenseText />
        </div>

        <footer className="flex flex-col gap-4 border-t border-line px-6 py-4">
          <div>
            <p className="mb-3 text-sm font-semibold">Register the church or ministry this copy is for</p>
            <RegistrationFields value={registration} onChange={setRegistration} disabled={saving} />
          </div>

          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={saving}
              className="mt-1 size-4 accent-amber-500"
            />
            <span>{EULA_CONFIRMATION}</span>
          </label>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-4">
            {!filled && <span className="text-xs text-muted">Fill in both fields to continue.</span>}
            <button
              type="button"
              onClick={accept}
              disabled={!canAccept}
              className="flex h-11 items-center rounded-md bg-accent px-6 text-sm font-bold uppercase text-on-accent shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Accept & Launch App'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
