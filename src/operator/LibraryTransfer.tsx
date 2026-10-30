import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { bridge, type LibraryExportOptions, type LibraryPreview, type LibrarySummary, type LibraryType } from '../live/bridge';

const api = bridge.library;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const TYPE_LABEL: Record<LibraryType, string> = {
  songs: 'Songs',
  setlists: 'Setlists',
  plans: 'Plans',
  praiseWorship: 'Praise & Worship sessions',
};
const TYPES: LibraryType[] = ['plans', 'setlists', 'praiseWorship', 'songs'];

type ExportKey = Exclude<keyof LibraryExportOptions, 'lyrics'>;
const EXPORT_KEYS: ExportKey[] = ['plans', 'setlists', 'praiseWorship', 'songs'];
const EXPORT_LABEL: Record<ExportKey, string> = {
  plans: 'Plans',
  setlists: 'Setlists',
  praiseWorship: 'Praise & Worship sessions',
  songs: 'Song library (titles, categories, languages, keys)',
};

const BUTTON = 'flex h-10 items-center rounded-md border border-fg/30 px-4 text-xs font-bold uppercase text-fg hover:bg-fg/10 disabled:opacity-40';
const PRIMARY = 'flex h-10 items-center rounded-md bg-accent px-4 text-xs font-bold uppercase text-on-accent hover:brightness-110 disabled:opacity-40';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-panel/60 p-5">
      <h3 className="text-[11px] font-semibold tracking-wider text-fg/70 uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** Export: the chosen parts of the library into one .apccmma file. Lyrics are a separate box, off by default. */
function ExportSection() {
  const [options, setOptions] = useState<LibraryExportOptions>({ plans: true, setlists: true, praiseWorship: true, songs: true, lyrics: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const anyChosen = options.plans || options.setlists || options.praiseWorship || options.songs;

  const save = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await api.export(options);
      if (saved) {
        const c = saved.counts;
        setMessage(`Saved to ${saved.path}: ${c.songs} songs, ${c.setlists} setlists, ${c.plans} plans, ${c.praiseWorship} sessions.`);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Export">
      <div className="flex flex-col gap-2 text-sm">
        {EXPORT_KEYS.map((key) => (
          <label key={key} className="flex items-center gap-3">
            <input type="checkbox" checked={options[key]} onChange={(e) => setOptions({ ...options, [key]: e.target.checked })} className="size-4 accent-accent" />
            {EXPORT_LABEL[key]}
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-line p-3">
        <label className="flex items-center gap-3 text-sm font-semibold">
          <input type="checkbox" checked={options.lyrics} onChange={(e) => setOptions({ ...options, lyrics: e.target.checked })} className="size-4 accent-accent" />
          Include lyrics (off by default)
        </label>
        <p className={`text-xs ${options.lyrics ? 'text-accent' : 'text-fg/60'}`}>
          Warning: lyrics leave this laptop in this file. Only share the file with people you trust.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={busy || !anyChosen} className={PRIMARY}>
          {busy ? 'Saving…' : 'Save file…'}
        </button>
        {message && <span className="text-xs text-fg/80">{message}</span>}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </Section>
  );
}

/** Import: read a file, show what it would change, and write only when the operator confirms. */
function ImportSection() {
  const [preview, setPreview] = useState<LibraryPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, 'keep' | 'use'>>({});
  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const next = await api.open();
      setPreview(next);
      setChoices({});
    } catch (err) {
      setPreview(null);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      setSummary(await api.import(choices));
      setPreview(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Import">
      <p className="text-xs text-fg/60">Imports add only what is new. Nothing is deleted, and nothing is saved until you press Import.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={open} disabled={busy} className={BUTTON}>
          Choose file…
        </button>
      </div>

      {preview && (
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-base font-semibold">
            {preview.totals.new} new, {preview.totals.same} already here (skipped), {preview.totals.changed} changed (you choose)
          </p>
          <p className="text-xs text-fg/60">
            From {preview.laptop || 'another laptop'}, exported {new Date(preview.exportedAt).toLocaleString()}.{' '}
            {preview.includesLyrics ? 'The file includes lyrics.' : 'The file has no lyrics.'}
          </p>
          <ul className="flex flex-col gap-1 text-xs text-fg/80">
            {TYPES.map((type) => (
              <li key={type}>
                {TYPE_LABEL[type]}: {preview.counts[type].new} new · {preview.counts[type].same} already here · {preview.counts[type].changed} changed
              </li>
            ))}
          </ul>
          {preview.notes.map((note) => (
            <p key={note} className="text-xs text-accent">
              {note}
            </p>
          ))}

          {preview.changed.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-xs font-bold tracking-wider text-fg/80 uppercase">Changed: choose which version to keep</p>
              {preview.changed.map((item) => (
                <fieldset key={item.key} className="flex flex-col gap-2 rounded-md border border-line p-3">
                  <legend className="px-1 text-sm font-semibold">
                    {TYPE_LABEL[item.type]}: {item.name || 'Untitled'}
                  </legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={item.key}
                      checked={(choices[item.key] ?? 'keep') === 'keep'}
                      onChange={() => setChoices({ ...choices, [item.key]: 'keep' })}
                      className="accent-accent"
                    />
                    Keep this laptop&apos;s version (default)
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={item.key}
                      checked={choices[item.key] === 'use'}
                      onChange={() => setChoices({ ...choices, [item.key]: 'use' })}
                      className="accent-accent"
                    />
                    Use the imported version
                  </label>
                </fieldset>
              ))}
            </div>
          )}

          <div>
            <button type="button" onClick={confirm} disabled={busy} className={PRIMARY}>
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      )}

      {summary && (
        <div className="flex flex-col gap-1 rounded-md border border-fg/20 p-3 text-sm">
          <p className="font-semibold">Import finished.</p>
          <p>
            Added: {TYPES.map((t) => `${summary.added[t]} ${TYPE_LABEL[t].toLowerCase()}`).join(', ')}.
          </p>
          <p>
            Skipped (already here): {TYPES.map((t) => `${summary.skipped[t]} ${TYPE_LABEL[t].toLowerCase()}`).join(', ')}.
          </p>
          <p>
            Changed: {summary.changed.kept} kept this laptop&apos;s version, {summary.changed.used} used the imported version.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </Section>
  );
}

/** The library export and import dialog, opened from the Export/Import quick action. */
export function LibraryTransferDialog({ onClose }: { onClose: () => void }) {
  const close = () => {
    void api.cancel();
    onClose();
  };
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export and import the library"
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-5 overflow-y-auto rounded-xl border border-fg/20 bg-panel-2 p-6 text-fg shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight">Library: export and import</h2>
          <button type="button" onClick={close} className={BUTTON}>
            Close
          </button>
        </div>
        <p className="text-xs text-fg/60">Plans, setlists, Praise &amp; Worship sessions and songs move between laptops in one .apccmma file.</p>
        <ExportSection />
        <ImportSection />
      </div>
    </div>,
    document.body,
  );
}
