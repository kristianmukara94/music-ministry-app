import { useState, type FormEvent } from 'react';
import { CalendarDays, Plus, Trash2 } from 'lucide-react';
import { formatRunTime, readiness, totalMinutes } from '../../shared/pw.js';
import { DATE_LOCALES } from '../i18n/strings';
import { formatIsoDay, formatIsoWeekday } from '../state/region';
import { useRegion } from '../state/useRegion';
import { useUi } from '../state/ui';
import { LineupRail } from './LineupRail';
import { Library } from './Library';
import { SegmentEditor } from './SegmentEditor';
import { createSession, deleteSession, errorText, flushSave, openSession, updateSession, usePw } from './store';
import { usePwT } from './strings';

const INPUT = 'h-10 rounded-lg border border-fg/15 bg-panel-2 px-3 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent/40';
const BTN = 'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-4 text-sm font-semibold text-fg/85 transition hover:bg-fg/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40';
const BTN_ACCENT = 'inline-flex h-10 items-center justify-center gap-2 rounded-md border border-accent bg-accent px-5 text-sm font-bold text-on-accent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40';

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
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-[10px] border border-line bg-panel p-4">
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
    <div className="flex min-w-0 flex-col gap-1 rounded-[10px] border border-line bg-panel px-4 py-3">
      <span className="text-[11px] font-semibold tracking-wider text-fg/60 uppercase">{label}</span>
      {children}
    </div>
  );
}

export function PlanView() {
  const t = usePwT();
  const session = usePw((s) => s.session);
  const sessions = usePw((s) => s.sessions);
  const [creating, setCreating] = useState(false);
  const lang = useUi((s) => s.lang);
  const region = useRegion();

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
  const dateLabel = `${formatIsoWeekday(session.liturgicalDate, DATE_LOCALES[lang])}, ${formatIsoDay(session.liturgicalDate, region)}`;

  return (
    <div className="flex flex-col gap-5">
      {/* Which session: switch, start a new one, or delete this one. */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-fg/60 uppercase">
          {t('session')}
          <select
            value={session.id}
            onChange={async (e) => {
              await flushSave();
              await openSession(Number(e.target.value));
            }}
            className={`${INPUT} min-w-60 text-fg normal-case`}
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
          className={`${BTN} hover:!border-danger/60 hover:!text-danger`}
          onClick={() => window.confirm(t('confirmDeleteSession', { name: session.name })) && void deleteSession(session.id)}
        >
          <Trash2 size={16} aria-hidden /> {t('deleteSession')}
        </button>
      </div>
      {creating && <NewSessionForm onDone={() => setCreating(false)} />}

      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-wider text-accent uppercase">{t('eyebrow_plan')}</p>
          <h1 className="mt-1 text-4xl leading-tight font-extrabold tracking-tight text-fg xl:text-[44px]">{session.name}</h1>
          {/* The date reads as a plain label. Pressing it opens the calendar. */}
          <label className="relative mt-2 inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-3 text-sm font-semibold text-fg/85 transition focus-within:ring-2 focus-within:ring-accent hover:bg-fg/10">
            <CalendarDays size={15} className="text-accent" aria-hidden />
            {dateLabel}
            <input
              type="date"
              aria-label={t('date')}
              value={session.liturgicalDate}
              onChange={(e) => e.target.value && updateSession({ liturgicalDate: e.target.value })}
              onClick={(e) => e.currentTarget.showPicker?.()}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
        </div>

        <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:grid-cols-[8rem_8rem_minmax(16rem,1fr)]">
          <Stat label={t('stat_segments')}>
            <span className="font-mono text-2xl font-bold text-fg">{total}</span>
          </Stat>
          <Stat label={t('stat_runTime')}>
            <span className="font-mono text-2xl font-bold whitespace-nowrap text-fg">{formatRunTime(totalMinutes(session.segments))}</span>
          </Stat>
          <div className="col-span-2 flex min-w-0 flex-col gap-2 rounded-[10px] border border-line bg-panel px-4 py-3 sm:col-span-1">
            <div className="flex items-center justify-between gap-3">
              <span id="pw-ready-label" className="text-[11px] font-semibold tracking-wider text-fg/60 uppercase">{t('stat_ready')}</span>
              <span className="inline-flex items-center gap-2 font-mono text-lg font-bold whitespace-nowrap text-fg">
                {ready === total && total > 0 && <span aria-hidden className="inline-flex items-center rounded-full border border-ok/40 bg-ok/15 px-2 py-0.5 text-[10px] font-bold text-ok">✓</span>}
                {ready} / {total}
              </span>
            </div>
            <div
              role="progressbar"
              aria-labelledby="pw-ready-label"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={ready}
              className="h-2 overflow-hidden rounded-full bg-fg/10"
            >
              <div className="h-full rounded-full bg-ok transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <span className={`text-xs ${missingSongs === 0 ? 'text-ok' : 'text-warn'}`}>
              {missingSongs === 0 ? t('allHaveSongs') : missingSongs === 1 ? t('stillNeedSongOne') : t('stillNeedSong', { n: missingSongs })}
            </span>
          </div>
        </div>
      </header>

      {/*
        Song List on the left, Lineup on the right, the segment editor across the bottom. Narrower than that, everything stacks
        with the Lineup first. Sized by the module's width, not the window's.
      */}
      <div className="grid grid-cols-1 items-start gap-5 @4xl/pw:grid-cols-2">
        <LineupRail />
        <div className="@4xl/pw:col-span-2">
          <SegmentEditor />
        </div>
        <div className="@4xl/pw:order-first">
          <Library />
        </div>
      </div>
    </div>
  );
}
