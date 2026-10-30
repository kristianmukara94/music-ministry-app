import { useEffect, useState, type FormEvent } from 'react';
import { Check, Play } from 'lucide-react';
import { PlanView } from './PlanView';
import { LiveView } from './LiveView';
import { OutputTemplates } from './OutputTemplates';
import { goLive } from './live';
import { errorText, flushSave, initPw, refreshLibraries, saveAsTemplate, setPwState, usePw, type PwTab } from './store';
import { usePwT } from './strings';

const TABS: PwTab[] = ['plan', 'live', 'outputs'];
const BTN = 'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-4 text-sm font-semibold text-fg/85 transition hover:bg-fg/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40';
const BTN_ACCENT = 'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-accent bg-accent px-5 text-sm font-bold text-on-accent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';
const BTN_GO = 'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-ok bg-ok px-5 text-sm font-extrabold text-canvas shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';

function SaveTemplateForm({ onDone }: { onDone: (message: string | null) => void }) {
  const t = usePwT();
  const sessionName = usePw((s) => s.session?.name ?? '');
  const [name, setName] = useState(sessionName);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const saved = await saveAsTemplate(name);
      onDone(saved ? t('templateSaved', { name: saved.name }) : null);
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-[10px] border border-line bg-panel p-4">
      <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs text-muted">
        {t('templateName')}
        <input
          autoFocus
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-10 rounded-lg border border-fg/15 bg-panel-2 px-3 text-sm text-fg outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
        />
      </label>
      <button type="submit" className={BTN_ACCENT}>{t('saveTemplate')}</button>
      <button type="button" className={BTN} onClick={() => onDone(null)}>{t('cancel')}</button>
      {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
    </form>
  );
}

/** The Praise & Worship module: its own planner, live console and output templates, separate from the Mass planner. */
export function PraiseWorship() {
  const t = usePwT();
  const tab = usePw((s) => s.tab);
  const session = usePw((s) => s.session);
  const error = usePw((s) => s.error);
  const saveState = usePw((s) => s.saveState);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void initPw();
    // Prayers and tags can change in other modules; pick the changes up when the operator comes back.
    const onFocus = () => void refreshLibraries().catch(() => undefined);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  return (
    <div className="@container/pw flex flex-col gap-5 p-5 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t('views')} className="flex gap-1 rounded-lg border border-line bg-panel p-1">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setPwState({ tab: id })}
              className={`h-10 rounded-md px-5 text-sm font-semibold uppercase tracking-wide transition ${tab === id ? 'bg-accent text-on-accent' : 'text-fg/70 hover:bg-fg/10 hover:text-fg'}`}
            >
              {t(`tab_${id}`)}
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <span aria-live="polite" className="min-w-20 text-right">
            {saveState === 'saving' ? (
              <span className="text-xs text-fg/60">{t('saving')}</span>
            ) : saveState === 'saved' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/50 bg-ok/10 px-2.5 py-0.5 text-[11px] font-bold text-ok">
                <Check size={12} aria-hidden /> {t('saved')}
              </span>
            ) : null}
          </span>
          <button type="button" className={BTN} disabled={!session} aria-expanded={templateOpen} onClick={() => setTemplateOpen((v) => !v)}>
            {t('saveTemplate')}
          </button>
          <button
            type="button"
            className={BTN_GO}
            disabled={!session}
            onClick={async () => {
              await flushSave();
              setPwState({ tab: 'live' });
              goLive();
            }}
          >
            <Play size={16} aria-hidden fill="currentColor" /> {t('goLive')}
          </button>
        </div>
      </div>

      {templateOpen && (
        <SaveTemplateForm
          onDone={(message) => {
            setTemplateOpen(false);
            setNotice(message);
          }}
        />
      )}
      {notice && <p role="status" className="rounded-lg border border-ok/50 bg-ok/10 px-4 py-2 text-sm text-ok">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>}

      {tab === 'plan' && <PlanView />}
      {tab === 'live' && <LiveView />}
      {tab === 'outputs' && <OutputTemplates />}
    </div>
  );
}
