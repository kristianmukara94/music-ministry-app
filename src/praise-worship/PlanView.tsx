import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { formatRunTime, readiness, totalMinutes } from '../../shared/pw.js';
import { LineupRail } from './LineupRail';
import { Library } from './Library';
import { SegmentEditor } from './SegmentEditor';
import { createSession, deleteSession, errorText, flushSave, openSession, updateSession, usePw } from './store';
import { usePwT } from './strings';

const INPUT = 'h-11 rounded-xl border border-line-strong bg-canvas/40 px-3 text-sm outline-none focus:border-accent';
const BTN = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-line-strong px-4 text-sm font-semibold transition hover:bg-panel-2 disabled:opacity-40';
const BTN_ACCENT = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-sm font-bold text-on-accent transition hover:opacity-90 disabled:opacity-40';

const isoToday = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function NewSessionForm({ onDone }: { onDone?: () => void }) {
  const t = usePwT();
  const templates = usePw((s) => s.templates);
  const [name, setName] = useState('Praise & Worship Night');
  const [date, setDate] = useState(isoToday);
  const [templateId, setTemplateId] = useState<number | ''>(templates.find((x) => x.builtIn)?.id ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await createSession({ name, liturgicalDate: date, templateId: templateId === '' ? undefined : templateId });
      onDone?.();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-panel p-4">
      <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-muted">
        {t('sessionName')}
        <input required maxLength={120} value={name} placeholder={t('sessionNamePlaceholder')} onChange={(e) => setName(e.target.value)} className={`${INPUT} text-fg`} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t('date')}
        <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${INPUT} text-fg`} />
      </label>
      <label className="flex min-w-48 flex-col gap-1 text-xs text-muted">
        {t('template')}
        <select value={templateId} onChange={(e) => setTemplateId(e.target.value === '' ? '' : Number(e.target.value))} className={`${INPUT} text-fg`}>
          {templates.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>
              {tpl.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className={BTN_ACCENT}>{t('create')}</button>
      {onDone && (
        <button type="button" className={BTN} onClick={onDone}>
          {t('cancel')}
        </button>
      )}
      {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
    </form>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-36 flex-1 flex-col gap-1 rounded-2xl border border-line bg-panel px-5 py-3.5">
      <span className="text-sm text-muted">{label}</span>
      {children}
    </div>
  );
}

export function PlanView() {
  const t = usePwT();
  const session = usePw((s) => s.session);
  const sessions = usePw((s) => s.sessions);
  const [creating, setCreating] = useState(false);

  if (!session) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted">{t('noSessions')}</p>
        <NewSessionForm />
      </div>
    );
  }

  const { ready, total, missingSongs } = readiness(session.segments);
  const percent = total ? Math.round((ready / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Which session: switch, start a new one, or delete this one. */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-60 flex-col gap-1 text-xs text-muted">
          {t('session')}
          <select
            value={session.id}
            onChange={async (e) => {
              await flushSave();
              await openSession(Number(e.target.value));
            }}
            className={`${INPUT} text-fg`}
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.liturgicalDate}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={BTN} aria-expanded={creating} onClick={() => setCreating((v) => !v)}>
          <Plus size={16} aria-hidden /> {t('newSession')}
        </button>
        <button
          type="button"
          className={BTN}
          onClick={() => window.confirm(t('confirmDeleteSession', { name: session.name })) && void deleteSession(session.id)}
        >
          <Trash2 size={16} aria-hidden /> {t('deleteSession')}
        </button>
      </div>
      {creating && <NewSessionForm onDone={() => setCreating(false)} />}

      <header className="flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="eyebrow !text-accent">{t('eyebrow_plan')}</p>
          <h1 className="mt-1 font-sans condensed text-[56px] leading-none font-black uppercase">{session.name}</h1>
          <label className="mt-1 inline-flex items-center gap-2 text-muted">
            <span className="sr-only">{t('date')}</span>
            <input
              type="date"
              value={session.liturgicalDate}
              onChange={(e) => e.target.value && updateSession({ liturgicalDate: e.target.value })}
              className="min-h-11 rounded-lg bg-transparent px-1 text-fg outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-3">
          <Stat label={t('stat_segments')}>
            <span className="font-mono text-2xl font-bold">{total}</span>
          </Stat>
          <Stat label={t('stat_runTime')}>
            <span className="font-mono text-2xl font-bold whitespace-nowrap">{formatRunTime(totalMinutes(session.segments))}</span>
          </Stat>
          <div className="flex min-w-64 flex-[2] flex-col gap-2 rounded-2xl border border-line bg-panel px-5 py-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <span id="pw-ready-label" className="text-sm text-muted">{t('stat_ready')}</span>
              <span className="font-mono">{ready} / {total}</span>
            </div>
            <div
              role="progressbar"
              aria-labelledby="pw-ready-label"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={ready}
              className="h-2 overflow-hidden rounded-full bg-panel-2"
            >
              <div className="h-full rounded-full bg-ok transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <span className="text-sm text-muted">
              {missingSongs === 0 ? t('allHaveSongs') : missingSongs === 1 ? t('stillNeedSongOne') : t('stillNeedSong', { n: missingSongs })}
            </span>
          </div>
        </div>
      </header>

      {/* Three columns when there is room; the library drops below, then everything stacks. Sized by the module's width, not the window's. */}
      <div className="grid grid-cols-1 items-start gap-5 @4xl/pw:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] @6xl/pw:grid-cols-[minmax(280px,320px)_minmax(0,1fr)_minmax(260px,300px)]">
        <LineupRail />
        <SegmentEditor />
        <div className="@4xl/pw:col-span-2 @6xl/pw:col-span-1">
          <Library />
        </div>
      </div>
    </div>
  );
}
