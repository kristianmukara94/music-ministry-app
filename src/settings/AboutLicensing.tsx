import { useState, type ReactNode } from 'react';
import { ChevronDown, Pencil, Printer, ShieldCheck } from 'lucide-react';
import { bridge } from '../live/bridge';
import { useLicense } from '../live/license';
import { LicenseText, RegistrationFields } from '../components/EulaModal';
import { AUTHORIZED_SCOPE, BUILT_BY_LINE, LICENSE_TYPE, LICENSED_BADGE, OSS_NOTICES, SOFTWARE_NAME, tidyRegistration } from '../legal/license';
import { formatDay } from '../state/region';
import { useRegion } from '../state/useRegion';
import { LicenseCertificateDialog } from './LicenseCertificate';
import { expiryDayOf, type CertificateJob } from '../../shared/license-certificate.js';
import type { ConfigState, Registration } from './types';

interface Props {
  version: string;
  config: ConfigState['config'];
  /** Called after a change is saved, so Settings reloads the stored details. */
  onChanged: () => void;
}

const LABEL = 'w-40 shrink-0 text-xs font-bold tracking-wider text-muted uppercase';
const BUTTON = 'flex h-10 w-fit items-center gap-2 rounded-md border border-fg/15 px-4 text-xs font-bold uppercase hover:bg-fg/10 disabled:cursor-not-allowed disabled:opacity-40';
const QA_CREDIT = 'Tested by: Julien Rey Dejanio (Software Quality Assurance Engineer)';
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One labelled row of the card. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <dt className={LABEL}>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** A toggle with its panel underneath: the EULA and the Open-Source & Content Notices open and close the same way. */
function Disclosure({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={id} className={BUTTON}>
        {open ? 'Hide' : 'Read'} the {label}
        <ChevronDown size={15} aria-hidden className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id={id} className="max-h-[420px] overflow-y-auto rounded-lg border border-line bg-canvas p-5">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * The About & Licensing card: the registered church, the license type and status, the copyright, the printable certificate, and the full
 * EULA and the open-source notices behind toggles.
 */
export function AboutLicensing({ version, config, onChanged }: Props) {
  const region = useRegion();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Registration>({ church: '', location: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [certificate, setCertificate] = useState<CertificateJob | null>(null);

  const registered = config.eula_accepted && !!config.registered_church && !!config.registered_location;
  const registeredOn = config.registered_at ? formatDay(new Date(config.registered_at), region) : '';
  // The same calendar day as YYYY-MM-DD, in the same zone, for the certificate's Credential ID: never parsed back out of registeredOn.
  const registeredDate = config.registered_at ? formatDay(new Date(config.registered_at), { ...region, dateFormat: 'YYYY-MM-DD' }) : '';
  // A dated (pilot) setup key prints its expiry day in the status; none is the perpetual sponsorship. The main process re-reads it when printing.
  const expiresOn = expiryDayOf(useLicense((s) => s.status?.expiresAt ?? null));
  // What would be saved: the same tidying the main process applies (shared/license-text.js), so whitespace alone never counts as filled in.
  const tidied = tidyRegistration(draft);
  const draftFilled = tidied.church !== '' && tidied.location !== '';

  const startEdit = () => {
    setDraft({ church: config.registered_church ?? '', location: config.registered_location ?? '' });
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await bridge.config.updateRegistration(tidied);
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const openCertificate = () =>
    setCertificate({ church: config.registered_church ?? '', location: config.registered_location ?? '', registeredOn, registeredDate, expiresOn, version });

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

        <Row label="Licensed to">
          <span className="font-semibold">{registered ? `${config.registered_church} (${config.registered_location})` : 'Not registered'}</span>
        </Row>
        <Row label="License type">
          <span data-license-type>{LICENSE_TYPE}</span>
        </Row>
        <Row label="Authorized scope">{AUTHORIZED_SCOPE}</Row>
        <Row label="Developer & copyright">
          <span data-developer-copyright>{BUILT_BY_LINE}</span>
        </Row>
        <Row label="QA TESTING">{QA_CREDIT}</Row>
        {registeredOn && <Row label="Registered on">{registeredOn}</Row>}
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
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={startEdit} className={BUTTON}>
            <Pencil size={14} aria-hidden /> Edit Registration Details
          </button>
          <button
            type="button"
            onClick={openCertificate}
            disabled={!registered}
            title={registered ? 'Preview, print or save the license certificate as a PDF' : 'Register the church first'}
            data-print-certificate
            className={BUTTON}
          >
            <Printer size={14} aria-hidden /> Print / Export Certificate
          </button>
        </div>
      )}

      <Disclosure id="eula-viewer" label="End-User License Agreement">
        <LicenseText />
      </Disclosure>
      <Disclosure id="notices-viewer" label="Open-Source & Content Notices">
        <LicenseText sections={OSS_NOTICES} />
      </Disclosure>

      {certificate && <LicenseCertificateDialog job={certificate} onClose={() => setCertificate(null)} />}
    </div>
  );
}
