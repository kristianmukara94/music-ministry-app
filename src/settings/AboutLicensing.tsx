import { useState } from 'react';
import { ChevronDown, Pencil, ShieldCheck } from 'lucide-react';
import { bridge } from '../live/bridge';
import { LicenseText, RegistrationFields } from '../components/EulaModal';
import { AUTHORIZED_SCOPE, BUILT_BY_LINE, LICENSED_BADGE, SOFTWARE_NAME } from '../legal/license';
import { formatDay } from '../state/region';
import { useRegion } from '../state/useRegion';
import type { ConfigState, Registration } from './types';

interface Props {
  version: string;
  config: ConfigState['config'];
  /** Called after a change is saved, so Settings reloads the stored details. */
  onChanged: () => void;
}

const LABEL = 'w-40 shrink-0 text-xs font-bold tracking-wider text-muted uppercase';
const QA_CREDIT = 'Tested by: Julien Rey Dejanio (Software Quality Assurance Engineer)';
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The About & Licensing card: the registered church, the licence status, the copyright, and the full EULA behind a toggle. */
export function AboutLicensing({ version, config, onChanged }: Props) {
  const region = useRegion();
  const [eulaOpen, setEulaOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Registration>({ church: '', location: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registered = config.eula_accepted && !!config.registered_church && !!config.registered_location;
  const draftFilled = draft.church.trim() !== '' && draft.location.trim() !== '';

  const startEdit = () => {
    setDraft({ church: config.registered_church ?? '', location: config.registered_location ?? '' });
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await bridge.config.updateRegistration({ church: draft.church.trim(), location: draft.location.trim() });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-2xl font-bold tracking-tight">{SOFTWARE_NAME}</span>
        <span className="rounded-md border border-fg/15 px-2 py-0.5 font-mono text-xs font-bold">v{version}</span>
        <span className="text-xs text-muted">{LICENSED_BADGE}</span>
      </div>

      <dl className="flex flex-col gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <dt className={LABEL}>Status</dt>
          <dd>
            {registered ? (
              <span className="flex w-fit items-center gap-1.5 rounded-full border border-ok/40 bg-ok/10 px-3 py-1 text-xs font-bold text-ok">
                <ShieldCheck size={14} aria-hidden />
                Active License
              </span>
            ) : (
              <span className="flex w-fit items-center rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-bold text-accent">
                Registration incomplete
              </span>
            )}
          </dd>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <dt className={LABEL}>Licensed to</dt>
          <dd className="font-semibold">
            {registered ? `${config.registered_church} (${config.registered_location})` : 'Not registered'}
          </dd>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <dt className={LABEL}>Authorized scope</dt>
          <dd>{AUTHORIZED_SCOPE}</dd>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <dt className={LABEL}>Developer &amp; copyright</dt>
          <dd>{BUILT_BY_LINE}</dd>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <dt className={LABEL}>QA TESTING</dt>
          <dd>{QA_CREDIT}</dd>
        </div>

        {config.registered_at && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <dt className={LABEL}>Registered on</dt>
            <dd>{formatDay(new Date(config.registered_at), region)}</dd>
          </div>
        )}
      </dl>

      {editing ? (
        <div className="flex flex-col gap-4 rounded-lg border border-line bg-canvas p-5">
          <RegistrationFields value={draft} onChange={setDraft} disabled={saving} />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={save}
              disabled={!draftFilled || saving}
              className="flex h-10 items-center rounded-md bg-accent px-5 text-xs font-bold uppercase text-on-accent shadow-md hover:brightness-110 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save Registration'}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="flex h-10 items-center rounded-md border border-fg/15 px-5 text-xs font-bold uppercase hover:bg-fg/10 disabled:opacity-40">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" onClick={startEdit} className="flex h-10 items-center gap-2 rounded-md border border-fg/15 px-4 text-xs font-bold uppercase hover:bg-fg/10">
            <Pencil size={14} aria-hidden /> Edit Registration Details
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setEulaOpen((open) => !open)}
          aria-expanded={eulaOpen}
          aria-controls="eula-viewer"
          className="flex h-10 w-fit items-center gap-2 rounded-md border border-fg/15 px-4 text-xs font-bold uppercase hover:bg-fg/10"
        >
          {eulaOpen ? 'Hide' : 'Read'} the End-User License Agreement
          <ChevronDown size={15} aria-hidden className={`transition ${eulaOpen ? 'rotate-180' : ''}`} />
        </button>
        {eulaOpen && (
          <div id="eula-viewer" className="max-h-[420px] overflow-y-auto rounded-lg border border-line bg-canvas p-5">
            <LicenseText />
          </div>
        )}
      </div>
    </div>
  );
}
