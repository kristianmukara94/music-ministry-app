import { useEffect, useState, type FormEvent } from 'react';
import { Play } from 'lucide-react';
import { PlanView } from './PlanView';
import { LiveView } from './LiveView';
import { OutputTemplates } from './OutputTemplates';
import { goLive } from './live';
import { errorText, flushSave, initPw, refreshLibraries, saveAsTemplate, setPwState, usePw, type PwTab } from './store';
import { usePwT } from './strings';

const TABS: PwTab[] = ['plan', 'live', 'outputs'];
const BTN = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line-strong px-4 text-sm font-semibold transition hover:bg-panel-2 disabled:opacity-40';
const BTN_ACCENT = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-bold text-on-accent transition hover:opacity-90 disabled:opacity-40';

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
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-panel p-4">
      <label className="flex min-w-60 flex-1 flex-col gap-1 text-xs text-muted">
        {t('templateName')}
        <input
          autoFocus
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-11 rounded-xl border border-line-strong bg-canvas/40 px-3 text-sm text-fg outline-none focus:border-accent"
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
    <div className="@container/pw flex flex-col gap-5 px-5 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t('views')} className="flex gap-1 rounded-2xl border border-line bg-panel p-1">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setPwState({ tab: id })}
              className={`min-h-11 rounded-xl px-5 text-[15px] font-semibold transition ${tab === id ? 'bg-panel-2 text-accent' : 'text-muted hover:text-fg'}`}
            >
              {t(`tab_${id}`)}
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-muted" aria-live="polite">
            {saveState === 'saving' ? t('saving') : saveState === 'saved' ? t('saved') : ''}
          </span>
          <button type="button" className={BTN} disabled={!session} aria-expanded={templateOpen} onClick={() => setTemplateOpen((v) => !v)}>
            {t('saveTemplate')}
          </button>
          <button
            type="button"
            className={BTN_ACCENT}
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
      {notice && <p role="status" className="text-sm text-ok">{notice}</p>}
      {error && <p role="alert" className="rounded-xl border border-danger px-4 py-3 text-sm text-danger">{error}</p>}

      {tab === 'plan' && <PlanView />}
      {tab === 'live' && <LiveView />}
      {tab === 'outputs' && <OutputTemplates />}
    </div>
  );
}
