import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  CheckCircle2,
  Church,
  CloudOff,
  ImagePlus,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
  Upload,
  Users,
} from 'lucide-react';
import {
  DIOCESE_MAX,
  LOCATION_MAX,
  LOGO_SCALE_DEFAULT,
  LOGO_SCALE_MAX,
  LOGO_SCALE_MIN,
  ROSTER_MAX,
  ROSTER_NAME_MAX,
  ROSTER_ROLE_MAX,
  ROSTER_ROLE_SUGGESTIONS,
  parishSubtitle,
} from '../../shared/parish-profile.js';
import { EVERY_DAY, MASS_LABEL_MAX, MAX_MASS_TIMES, sanitizeMassTimes, type MassTime } from '../../shared/service-schedule.js';
import { bridge, type CloudLink } from '../live/bridge';
import { LOGO_SRC } from '../brand/logo';
import { ChurchEmblem, EmblemPreview } from '../church/ChurchEmblem';
import { LogoCropper, type LogoChoice } from '../church/ChurchProfileForm';
import { autoCenterFrame, exportLogoPng, LOGO_ACCEPT, loadLogoFile, previewLogo } from '../church/logoImage';
import { setChurchProfile, useSavedChurchProfile } from '../church/profile';
import { CHURCH_NAME_MAX, DEFAULT_MINISTRY_NAME, MINISTRY_NAME_MAX, type ChurchProfile, type RosterEntry } from '../church/types';
import { DATE_LOCALES, useT } from '../i18n/strings';
import { LowerThirdCard } from '../output/LowerThirdView';
import { useOutput } from '../output/outputState';
import { setUi, useUi } from '../state/ui';
import { useRegion } from '../state/useRegion';

const CARD = 'flex flex-col gap-5 rounded-xl border border-line bg-panel-2 p-6 shadow-lg';
const CARD_TITLE = 'flex items-center gap-2 text-base font-bold tracking-tight text-fg';
const SUB = 'text-xs text-fg/60';
const FOCUS = 'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';
const INPUT = `h-10 rounded-lg border border-line bg-panel px-3 text-sm text-fg outline-none placeholder:text-fg/35 focus:border-accent disabled:opacity-60`;
const SMALL_BUTTON = `flex h-8 items-center gap-1.5 rounded-md border border-fg/15 px-2.5 text-xs font-semibold hover:bg-fg/10 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`;
const ICON_BUTTON = `grid size-8 shrink-0 place-items-center rounded-md text-fg/60 hover:bg-fg/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-30 ${FOCUS}`;

const errorText = (err: unknown) => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err));
const tidy = (text: string) => text.trim().replace(/\s+/g, ' ');
const newRowId = () => `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Everything on the form except the logo image, which has its own state (it may be a file being cropped). */
interface Draft {
  name: string;
  ministry: string;
  diocese: string;
  location: string;
  logoScale: number;
  logoBacking: boolean;
  roster: RosterEntry[];
  massTimes: MassTime[];
}

const draftFrom = (p: ChurchProfile, massTimes: MassTime[]): Draft => ({
  name: p.churchName,
  ministry: p.ministryName,
  diocese: p.diocese ?? '',
  location: p.location ?? '',
  logoScale: p.logoScale ?? LOGO_SCALE_DEFAULT,
  logoBacking: p.logoBacking ?? false,
  roster: (p.roster ?? []).map((r) => ({ ...r })),
  massTimes: massTimes.map((m) => ({ ...m })),
});

/** The roster as it will be saved: rows with nothing typed are dropped. */
const filledRoster = (rows: RosterEntry[]) => rows.filter((r) => tidy(r.name) || tidy(r.role)).map((r) => ({ id: r.id, name: tidy(r.name), role: tidy(r.role) }));

/** A comparable form of a draft, so a trailing space or an empty row does not count as a change. */
const draftKey = (d: Draft) =>
  JSON.stringify([
    tidy(d.name),
    tidy(d.ministry),
    tidy(d.diocese),
    tidy(d.location),
    d.logoScale,
    d.logoBacking,
    filledRoster(d.roster).map((r) => [r.name, r.role]),
    sanitizeMassTimes(d.massTimes),
  ]);

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

// ---------------------------------------------------------------- small pieces

function CardHeader({ id, icon, title, subtitle, action }: { id: string; icon: ReactNode; title: string; subtitle: string; action?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-line pb-4">
      <div className="min-w-0">
        <h2 id={id} className={CARD_TITLE}>
          <span className="text-accent">{icon}</span>
          {title}
        </h2>
        <p className={`mt-1 ${SUB}`}>{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

function TextField({
  label,
  value,
  onChange,
  max,
  hint,
  placeholder,
  required = false,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  hint: string;
  placeholder?: string;
  required?: boolean;
  disabled: boolean;
}) {
  const length = tidy(value).length;
  const error = required && !length ? 'Required.' : length > max ? `Use ${max} characters or fewer.` : null;
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold tracking-wider text-fg uppercase">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={max + 20}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        disabled={disabled}
        className={`${INPUT} w-full`}
      />
      <span className={`flex justify-between gap-3 text-[11px] ${error ? 'text-danger' : 'text-fg/55'}`}>
        <span>{error ?? hint}</span>
        <span className="shrink-0 tabular-nums">
          {length} / {max}
        </span>
      </span>
    </label>
  );
}

// ---------------------------------------------------------------- right column: previews

function PreviewCard({ title, caption, children }: { title: string; caption?: ReactNode; children: ReactNode }) {
  return (
    <figure className="flex flex-col gap-2 rounded-xl border border-line bg-panel-2 p-4 shadow-lg">
      <figcaption className="text-[11px] font-bold tracking-[0.14em] text-fg/55 uppercase">{title}</figcaption>
      {children}
      {caption && <div className="text-[11px] leading-snug text-fg/55">{caption}</div>}
    </figure>
  );
}

/** The parish nameplate drawn by the real lower third card, in the operator's current look, with the logo on. */
function NameplatePreview({ name, subtitle }: { name: string; subtitle: string }) {
  const style = useOutput((s) => s.lowerStyle);
  return (
    <PreviewCard
      title="Lower third nameplate"
      caption={
        style.showLogo
          ? 'In your current lower third look, on the projector and the livestream.'
          : 'Your lower third look has the logo turned off; it is shown here so you can check it. Turn it on in Output › Lower 3rd & OBS.'
      }
    >
      <div
        aria-label="Lower third nameplate preview"
        className="relative aspect-video overflow-hidden rounded-lg border border-line bg-gradient-to-br from-[#3a1020] to-[#100306] [container-type:inline-size]"
      >
        {name ? (
          <div className="absolute right-[5%] bottom-[8%] left-[5%] flex">
            <LowerThirdCard value={{ template: 'nameplate', line1: name, ...(subtitle ? { line2: subtitle } : {}) }} style={{ ...style, showLogo: true }} />
          </div>
        ) : (
          <p className="absolute inset-0 grid place-items-center text-xs text-white/50">Enter the parish name to preview it.</p>
        )}
      </div>
    </PreviewCard>
  );
}

/** The projector's idle crest and the failover screen: the framed logo, centred on the dark sanctuary canvas. */
function CrestPreview() {
  return (
    <PreviewCard title="Projector crest & failover" caption="Shown when nothing is live (with the Crest idle screen) and if the projector page ever fails.">
      <div aria-label="Projector crest preview" className="relative grid aspect-video place-items-center overflow-hidden rounded-lg border border-line" style={{ background: '#080507' }}>
        <ChurchEmblem className="aspect-square h-[40%] opacity-90" />
      </div>
    </PreviewCard>
  );
}

/** The top of a setlist printed from the Web Planner, as the website prints it. */
function LetterheadPreview({ draftName, cloud, onCheck, checking }: { draftName: string; cloud: CloudLink | null; onCheck: () => void; checking: boolean }) {
  const webName = cloud?.linked && cloud.church ? cloud.church : null;
  const printed = webName ?? tidy(draftName);
  const same = webName !== null && webName.trim().toLowerCase() === tidy(draftName).toLowerCase();

  let status: ReactNode;
  if (cloud === null) {
    status = (
      <span className="flex items-center gap-1.5">
        <Loader2 size={12} className="animate-spin" aria-hidden /> Checking the Web Planner link…
      </span>
    );
  } else if (!cloud.linked) {
    status = (
      <span className="flex items-start gap-1.5">
        <CloudOff size={13} className="mt-px shrink-0" aria-hidden /> This laptop is not linked to the Web Planner. Link it under Connections › Cloud sync.
      </span>
    );
  } else if (same) {
    status = (
      <span className="flex items-start gap-1.5 text-ok">
        <CheckCircle2 size={13} className="mt-px shrink-0" aria-hidden /> The Web Planner shows the same parish name{cloud.offline ? ' (last known; the website could not be reached)' : ''}.
      </span>
    );
  } else {
    status = (
      <span className="flex items-start gap-1.5 text-warn">
        <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden />
        <span>
          The Web Planner prints “{webName}”. The website keeps the name the church was registered with online; this laptop&apos;s profile is not sent to it.
          {cloud.offline ? ' (Last known; the website could not be reached.)' : ''}
        </span>
      </span>
    );
  }

  return (
    <PreviewCard
      title="Printed setlist letterhead"
      caption={
        <div className="flex flex-col gap-2">
          <div aria-live="polite">{status}</div>
          <div className="flex items-center justify-between gap-2">
            <span>The website always prints the generic “{DEFAULT_MINISTRY_NAME}”.</span>
            <button type="button" onClick={onCheck} disabled={checking} className={SMALL_BUTTON}>
              <RefreshCw size={12} className={checking ? 'animate-spin' : ''} aria-hidden /> Check again
            </button>
          </div>
        </div>
      }
    >
      <div aria-label="Printed setlist preview" className="rounded-md border border-black/10 bg-white px-5 py-4 text-black shadow-inner">
        <p className="m-0 mb-1.5 truncate text-[9px] font-bold tracking-[0.1em] uppercase">{[printed, DEFAULT_MINISTRY_NAME].filter(Boolean).join(' · ')}</p>
        <p className="m-0 font-serif text-xl leading-tight font-bold">Sunday Holy Mass</p>
        <p className="mt-1 mb-3 text-[11px] text-black/70">Sample plan · English</p>
        <div className="flex flex-col text-[11px]">
          {['Entrance', 'Responsorial Psalm', 'Offertory'].map((part, i) => (
            <div key={part} className="flex gap-3 border-b border-black/30 py-1">
              <span className="w-3 text-black/60">{i + 1}</span>
              <span className="w-28">{part}</span>
              <span className="flex-1 text-black/40">Song or text</span>
            </div>
          ))}
        </div>
      </div>
    </PreviewCard>
  );
}

/** The logo on the four tiles it can meet: a dark and a light surface, round and square. Follows the size slider and backing. */
function ContrastStrip() {
  const tiles = [
    { label: 'Dark round', dark: true, shape: 'round' as const },
    { label: 'Light round', dark: false, shape: 'round' as const },
    { label: 'Dark square', dark: true, shape: 'square' as const },
    { label: 'Light square', dark: false, shape: 'square' as const },
  ];
  return (
    <PreviewCard title="Emblem contrast" caption="Check the crest is clear and uncut on every tile. A logo with a transparent background works best.">
      <div className="grid grid-cols-4 gap-2">
        {tiles.map((tile) => (
          <div key={tile.label} className="flex flex-col items-center gap-1">
            <div
              className={`grid size-16 place-items-center overflow-hidden border border-fg/15 ${tile.shape === 'round' ? 'rounded-full' : 'rounded-[14%]'}`}
              style={{ background: tile.dark ? '#0b0d12' : '#f5f3ee' }}
            >
              <ChurchEmblem shape={tile.shape} dark={tile.dark} className="size-full" />
            </div>
            <span className="text-center text-[10px] leading-tight text-fg/60">{tile.label}</span>
          </div>
        ))}
      </div>
    </PreviewCard>
  );
}

// ---------------------------------------------------------------- left column: editors

function RosterEditor({ rows, onChange, disabled }: { rows: RosterEntry[]; onChange: (rows: RosterEntry[]) => void; disabled: boolean }) {
  const set = (i: number, patch: Partial<RosterEntry>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, delta: number) => {
    const next = [...rows];
    const [row] = next.splice(i, 1);
    next.splice(i + delta, 0, row);
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-5 text-center text-sm text-fg/55">
          No one yet. Add the parish priest, the music director and the regular commentators.
        </p>
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Clergy and liturgical team">
          {rows.map((row, i) => {
            const missingName = !tidy(row.name) && Boolean(tidy(row.role));
            return (
              <li key={row.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-right text-xs text-fg/40 tabular-nums">{i + 1}</span>
                  <input
                    aria-label={`Name ${i + 1}`}
                    value={row.name}
                    onChange={(e) => set(i, { name: e.target.value })}
                    placeholder="Name, e.g. Rev. Fr. Juan dela Cruz"
                    maxLength={ROSTER_NAME_MAX}
                    aria-invalid={missingName || undefined}
                    disabled={disabled}
                    className={`${INPUT} min-w-0 flex-[3]`}
                  />
                  <input
                    aria-label={`Role ${i + 1}`}
                    value={row.role}
                    onChange={(e) => set(i, { role: e.target.value })}
                    placeholder="Role or title"
                    list="parish-roster-roles"
                    maxLength={ROSTER_ROLE_MAX}
                    disabled={disabled}
                    className={`${INPUT} min-w-0 flex-[2]`}
                  />
                  <button type="button" className={ICON_BUTTON} aria-label={`Move ${row.name || 'row'} up`} disabled={disabled || i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp size={14} aria-hidden />
                  </button>
                  <button type="button" className={ICON_BUTTON} aria-label={`Move ${row.name || 'row'} down`} disabled={disabled || i === rows.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown size={14} aria-hidden />
                  </button>
                  <button type="button" className={`${ICON_BUTTON} hover:text-danger`} aria-label={`Remove ${row.name || 'row'}`} disabled={disabled} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
                {missingName && <span className="pl-7 text-[11px] text-danger">Enter a name for this {tidy(row.role)}.</span>}
              </li>
            );
          })}
        </ol>
      )}
      <datalist id="parish-roster-roles">
        {ROSTER_ROLE_SUGGESTIONS.map((role) => (
          <option key={role} value={role} />
        ))}
      </datalist>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={disabled || rows.length >= ROSTER_MAX}
          onClick={() => onChange([...rows, { id: newRowId(), name: '', role: rows.length === 0 ? 'Parish Priest' : '' }])}
          className={`flex items-center gap-1.5 rounded-lg border border-dashed border-fg/30 px-3 py-2 text-xs font-bold text-fg/85 hover:border-accent hover:text-accent disabled:opacity-40 ${FOCUS}`}
        >
          <Plus size={13} aria-hidden /> Add person
        </button>
        <span className={SUB}>
          {rows.length} / {ROSTER_MAX} · In this order in the Lower Third drawer
        </span>
      </div>
    </div>
  );
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function MassScheduleEditor({ rows, onChange, disabled }: { rows: MassTime[]; onChange: (rows: MassTime[]) => void; disabled: boolean }) {
  const t = useT();
  const lang = useUi((s) => s.lang);
  const region = useRegion();
  const dayName = (day: number) => new Intl.DateTimeFormat(DATE_LOCALES[lang], { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + day)));
  const set = (i: number, patch: Partial<MassTime>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // Two rows on the same day and time are saved as one; say so instead of silently dropping it.
  const seen = new Set<string>();
  const duplicate = rows.map((r) => {
    const key = `${r.day}|${r.time}`;
    const dup = seen.has(key);
    seen.add(key);
    return dup;
  });
  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-5 text-center text-sm text-fg/55">No Holy Mass times. The dashboard countdown stays empty until one is added.</p>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Regular Holy Mass times">
          {rows.map((row, i) => (
            <li key={i} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <select
                  aria-label={`Day ${i + 1}`}
                  value={row.day}
                  disabled={disabled}
                  onChange={(e) => set(i, { day: Number(e.target.value) })}
                  className={`${INPUT} w-36 shrink-0`}
                >
                  <option value={EVERY_DAY}>{t('count.everyDay')}</option>
                  {WEEKDAYS.map((d) => (
                    <option key={d} value={d}>
                      {dayName(d)}
                    </option>
                  ))}
                </select>
                <input
                  type="time"
                  aria-label={`Time ${i + 1}`}
                  value={row.time}
                  disabled={disabled}
                  onChange={(e) => set(i, { time: e.target.value })}
                  className={`${INPUT} w-32 shrink-0`}
                />
                <input
                  aria-label={`Label ${i + 1}`}
                  value={row.label ?? ''}
                  disabled={disabled}
                  maxLength={MASS_LABEL_MAX}
                  onChange={(e) => set(i, { label: e.target.value })}
                  placeholder="Label, e.g. Sunday Morning Holy Mass"
                  className={`${INPUT} min-w-0 flex-1`}
                />
                <button type="button" className={`${ICON_BUTTON} hover:text-danger`} aria-label={`Remove Holy Mass time ${i + 1}`} disabled={disabled} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
              {!row.time && <span className="text-[11px] text-danger">Enter a time, or remove this row.</span>}
              {duplicate[i] && <span className="text-[11px] text-warn">Same day and time as an earlier row; only one is kept.</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={disabled || rows.length >= MAX_MASS_TIMES}
          onClick={() => onChange([...rows, { day: 0, time: rows.length === 0 ? '08:00' : '10:00', label: '' }])}
          className={`flex items-center gap-1.5 rounded-lg border border-dashed border-fg/30 px-3 py-2 text-xs font-bold text-fg/85 hover:border-accent hover:text-accent disabled:opacity-40 ${FOCUS}`}
        >
          <Plus size={13} aria-hidden /> Add Holy Mass time
        </button>
        <span className={SUB}>
          {t('count.zoneNote')} ({region.timeZone})
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the page

/**
 * Settings › Parish Profile & Logo: the parish's identity, its logo and how it is framed, the clergy and liturgical team for one-click
 * nameplates, and the regular Holy Mass times behind the dashboard countdown. A form on the left, live previews of the unsaved values on the
 * right. Nothing changes on the projector until Save; a save is broadcast to every window by the main process (church:changed).
 */
export function ChurchProfileSettings() {
  const saved = useSavedChurchProfile();
  if (!saved) return <p className="p-6 text-sm text-muted">Loading the parish profile…</p>;
  return <ParishWorkspace saved={saved} />;
}

function ParishWorkspace({ saved }: { saved: ChurchProfile }) {
  const savedMass = useUi((s) => s.massTimes);
  const [base, setBase] = useState<Draft>(() => draftFrom(saved, savedMass));
  const [draft, setDraft] = useState<Draft>(base);
  const [choice, setChoice] = useState<LogoChoice>({ kind: 'keep' });
  const [cropPreview, setCropPreview] = useState<string | null>(null);
  const [loadingLogo, setLoadingLogo] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [cloud, setCloud] = useState<CloudLink | null>(null);
  const [checkingCloud, setCheckingCloud] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const currentLogo = saved.logoDataUrl;
  const logoChanged = choice.kind === 'new' || (choice.kind === 'default' && currentLogo !== null);
  const dirty = logoChanged || draftKey(draft) !== draftKey(base);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // A save from another window (or the dashboard's Holy Mass times editor) shows here, unless the operator is mid-edit: their edits win.
  useEffect(() => {
    if (dirtyRef.current) return;
    const next = draftFrom(saved, savedMass);
    setBase(next);
    setDraft(next);
  }, [saved, savedMass]);

  // The cropped logo's preview follows the crop, drawn on the next frame so a fast drag does not encode a PNG per pointer move.
  useEffect(() => {
    if (choice.kind !== 'new') return;
    const id = requestAnimationFrame(() => setCropPreview(previewLogo(choice.logo, choice.frame)));
    return () => cancelAnimationFrame(id);
  }, [choice]);

  const checkCloud = useCallback(() => {
    setCheckingCloud(true);
    bridge.cloud
      .status()
      .then(setCloud)
      .catch((err) => setCloud({ linked: false, error: errorText(err) }))
      .finally(() => setCheckingCloud(false));
  }, []);
  useEffect(checkCloud, [checkCloud]);

  const patch = (p: Partial<Draft>) => {
    setSavedAt(null);
    setDraft((d) => ({ ...d, ...p }));
  };

  const shownLogo = choice.kind === 'new' ? (cropPreview ?? LOGO_SRC) : choice.kind === 'default' ? LOGO_SRC : (currentLogo ?? LOGO_SRC);
  const usingDefault = choice.kind === 'default' || (choice.kind === 'keep' && currentLogo === null);

  const name = tidy(draft.name);
  const problems = [
    !name && 'Enter the parish or church name.',
    name.length > CHURCH_NAME_MAX && `The parish name must be ${CHURCH_NAME_MAX} characters or fewer.`,
    tidy(draft.ministry).length > MINISTRY_NAME_MAX && `The ministry name must be ${MINISTRY_NAME_MAX} characters or fewer.`,
    tidy(draft.diocese).length > DIOCESE_MAX && `The diocese must be ${DIOCESE_MAX} characters or fewer.`,
    tidy(draft.location).length > LOCATION_MAX && `The city or location must be ${LOCATION_MAX} characters or fewer.`,
    draft.roster.some((r) => !tidy(r.name) && tidy(r.role)) && 'Every person in the team roster needs a name.',
    draft.massTimes.some((m) => !m.time) && 'Every Holy Mass time needs a time.',
  ].filter((p): p is string => Boolean(p));
  const canSave = dirty && problems.length === 0 && !saving && !loadingLogo;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setLoadingLogo(true);
    try {
      const logo = await loadLogoFile(file);
      setCropPreview(null);
      setSavedAt(null);
      setChoice({ kind: 'new', logo, frame: autoCenterFrame(logo) });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoadingLogo(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  const onDrop = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (!saving && !loadingLogo) void pick(e.dataTransfer.files[0]);
  };

  const discard = () => {
    setDraft(base);
    setChoice({ kind: 'keep' });
    setCropPreview(null);
    setError(null);
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const logo = choice.kind === 'new' ? await exportLogoPng(choice.logo, choice.frame) : choice.kind === 'default' ? null : undefined;
      const profile = await bridge.church.saveProfile({
        name,
        ministry: tidy(draft.ministry),
        diocese: tidy(draft.diocese),
        location: tidy(draft.location),
        logoScale: draft.logoScale,
        logoBacking: draft.logoBacking,
        roster: filledRoster(draft.roster),
        ...(logo !== undefined ? { logo } : {}),
      });
      const massTimes = sanitizeMassTimes(draft.massTimes);
      // The Holy Mass times are an operator preference of this window (the dashboard countdown reads them from the same store).
      setUi({ massTimes });
      const next = draftFrom(profile, massTimes);
      dirtyRef.current = false;
      setBase(next);
      setDraft(next);
      setChoice({ kind: 'keep' });
      setCropPreview(null);
      // This window at once; the projector, lower third and failover windows follow the main process's broadcast.
      setChurchProfile(profile);
      setSavedAt(Date.now());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  // Ctrl+S (Cmd+S on a Mac) saves from anywhere on the page.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      e.stopPropagation();
      void saveRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const subtitle = parishSubtitle({ ministryName: tidy(draft.ministry) || DEFAULT_MINISTRY_NAME, diocese: tidy(draft.diocese) });
  const busy = saving || loadingLogo;
  const shortcut = isMac ? '⌘S' : 'Ctrl+S';

  return (
    <div className="flex w-full flex-col gap-6 @container/parish">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold tracking-[0.2em] text-fg/50 uppercase">Parish</div>
          <h1 className="mt-1 text-4xl leading-tight font-extrabold tracking-tight text-fg xl:text-[44px]">Parish Profile</h1>
          <p className="mt-2 max-w-2xl text-sm text-fg/60">
            The parish name, logo, team and Holy Mass times used across the app. The license registration is separate: change it under About &amp; Licensing.
          </p>
        </div>
        <span
          role="status"
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
            dirty ? 'border-warn/50 bg-warn/10 text-warn' : 'border-ok/40 bg-panel-2 text-ok'
          }`}
        >
          {dirty ? (
            <>
              <span className="size-1.5 rounded-full bg-warn" aria-hidden /> Unsaved changes
            </>
          ) : (
            <>
              <Check size={13} aria-hidden /> {savedAt ? 'Saved · every screen updated' : 'All changes saved'}
            </>
          )}
        </span>
      </header>

      {/* 60 % form, 40 % previews of the unsaved values. Stacks when the canvas is narrower than ~1150 px (a 1366 px laptop with the sidebar open). */}
      <div className="flex flex-col gap-6 @6xl/parish:flex-row @6xl/parish:items-start">
        <div className="flex min-w-0 flex-col gap-6 @6xl/parish:w-3/5">
          <section className={CARD} aria-labelledby="parish-identity-heading">
            <CardHeader id="parish-identity-heading" icon={<Church size={17} aria-hidden />} title="Parish identity" subtitle="Shown in the sidebar, the dashboard header, on lower thirds and nameplates." />
            <TextField
              label="Parish / Church name"
              required
              value={draft.name}
              onChange={(v) => patch({ name: v })}
              max={CHURCH_NAME_MAX}
              placeholder="e.g. Sto. Niño de Cebu Parish"
              hint="Shown in the sidebar, the dashboard header and on lower thirds."
              disabled={saving}
            />
            <TextField
              label="Ministry name"
              value={draft.ministry}
              onChange={(v) => patch({ ministry: v })}
              max={MINISTRY_NAME_MAX}
              placeholder={`e.g. Charismatic Music Ministry (blank shows "${DEFAULT_MINISTRY_NAME}")`}
              hint="Optional. The second line of the parish nameplate."
              disabled={saving}
            />
            <div className="grid gap-5 @xl/parish:grid-cols-2">
              <TextField
                label="Diocese / Archdiocese"
                value={draft.diocese}
                onChange={(v) => patch({ diocese: v })}
                max={DIOCESE_MAX}
                placeholder="e.g. Archdiocese of Cebu"
                hint="Optional. Added after the ministry on the nameplate."
                disabled={saving}
              />
              <TextField
                label="City / Location"
                value={draft.location}
                onChange={(v) => patch({ location: v })}
                max={LOCATION_MAX}
                placeholder="e.g. Cebu City"
                hint="Optional. Kept with the profile for exports and future letterheads."
                disabled={saving}
              />
            </div>
          </section>

          <section className={CARD} aria-labelledby="parish-logo-heading">
            <CardHeader id="parish-logo-heading" icon={<ImagePlus size={17} aria-hidden />} title="Church logo & framing" subtitle="The crest on the sidebar, the projector, the failover screen and lower thirds. Kept on this computer." />
            <div className="grid gap-5 @xl/parish:grid-cols-2">
              <div className="flex flex-col gap-3">
                {choice.kind === 'new' ? (
                  <LogoCropper logo={choice.logo} frame={choice.frame} onFrame={(frame) => setChoice({ ...choice, frame })} disabled={saving} />
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    disabled={busy}
                    className={`flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition ${
                      dragOver ? 'border-accent bg-accent/10' : 'border-fg/20 hover:border-accent/60 hover:bg-fg/[0.04]'
                    } disabled:opacity-60 ${FOCUS}`}
                  >
                    {loadingLogo ? <Loader2 size={28} className="animate-spin text-accent" aria-hidden /> : <ImagePlus size={28} className="text-accent" aria-hidden />}
                    <span className="text-sm font-semibold">{loadingLogo ? 'Opening image…' : 'Drop the logo here, or click to choose'}</span>
                    <span className="text-[11px] text-fg/55">PNG, JPG, WEBP or SVG, up to 10 MB</span>
                  </button>
                )}
                <div className="flex flex-wrap gap-2">
                  {choice.kind === 'new' && (
                    <button type="button" className={SMALL_BUTTON} onClick={() => fileInput.current?.click()} disabled={busy}>
                      <Upload size={13} aria-hidden /> Choose another
                    </button>
                  )}
                  {choice.kind !== 'keep' && currentLogo !== null && (
                    <button type="button" className={SMALL_BUTTON} onClick={() => setChoice({ kind: 'keep' })} disabled={busy}>
                      <RotateCcw size={13} aria-hidden /> Keep current logo
                    </button>
                  )}
                  <button type="button" className={SMALL_BUTTON} onClick={() => setChoice({ kind: 'default' })} disabled={busy || usingDefault} aria-pressed={usingDefault}>
                    <img src={LOGO_SRC} alt="" className="size-4 object-contain" /> {usingDefault ? 'Using default APCCMMA emblem' : 'Use Default APCCMMA Emblem'}
                  </button>
                </div>
                <input ref={fileInput} type="file" accept={LOGO_ACCEPT} className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
              </div>

              <div className="flex flex-col gap-5">
                <label className="flex flex-col gap-2">
                  <span className="flex items-center justify-between text-sm font-semibold text-fg">
                    Logo size in its frame
                    <span className="text-xs text-fg/60 tabular-nums">{draft.logoScale}%</span>
                  </span>
                  <input
                    type="range"
                    min={LOGO_SCALE_MIN}
                    max={LOGO_SCALE_MAX}
                    step={1}
                    value={draft.logoScale}
                    disabled={saving}
                    onChange={(e) => patch({ logoScale: Number(e.target.value) })}
                    className="w-full accent-accent"
                    aria-valuetext={`${draft.logoScale} percent`}
                  />
                  <span className="flex items-center justify-between gap-2 text-[11px] text-fg/55">
                    <span>Below 100% adds padding so a crest&apos;s edges are never cut by a round frame.</span>
                    {draft.logoScale !== LOGO_SCALE_DEFAULT && (
                      <button type="button" className="shrink-0 font-semibold text-accent hover:underline" onClick={() => patch({ logoScale: LOGO_SCALE_DEFAULT })}>
                        Reset
                      </button>
                    )}
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={draft.logoBacking}
                    disabled={saving}
                    onChange={(e) => patch({ logoBacking: e.target.checked })}
                    className="mt-0.5 size-4 shrink-0 accent-accent"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-fg">Light backing on dark screens</span>
                    <span className="text-[11px] text-fg/55">A soft light disc behind the logo on the projector, failover and lower third, so a dark crest stays visible.</span>
                  </span>
                </label>
              </div>
            </div>
          </section>

          <section className={CARD} aria-labelledby="parish-team-heading">
            <CardHeader
              id="parish-team-heading"
              icon={<Users size={17} aria-hidden />}
              title="Clergy & liturgical team"
              subtitle="Shown as one-click nameplates in the Lower Third drawer: the name on the first line, the role on the second."
            />
            <RosterEditor rows={draft.roster} onChange={(roster) => patch({ roster })} disabled={saving} />
          </section>

          <section className={CARD} aria-labelledby="parish-mass-heading">
            <CardHeader
              id="parish-mass-heading"
              icon={<CalendarClock size={17} aria-hidden />}
              title="Regular Holy Mass schedule"
              subtitle="The weekly Holy Mass times behind the dashboard's “Next Holy Mass” countdown. The label shows on the countdown."
            />
            <MassScheduleEditor rows={draft.massTimes} onChange={(massTimes) => patch({ massTimes })} disabled={saving} />
          </section>

          {/* The save bar stays at the bottom of the view while the form scrolls. */}
          <div className="sticky bottom-0 z-10 flex flex-col gap-2 rounded-xl border border-line bg-panel/95 p-3 shadow-lg shadow-black/20 backdrop-blur">
            {(error || (dirty && problems.length > 0)) && (
              <p role="alert" className="flex items-start gap-1.5 px-1 text-xs text-danger">
                <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden /> {error ?? problems[0]}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <span className={`px-1 text-xs font-semibold ${dirty ? 'text-warn' : 'text-fg/55'}`}>{dirty ? 'Unsaved changes' : 'No changes'}</span>
              <span className="ml-auto flex items-center gap-2">
                <button type="button" onClick={discard} disabled={!dirty || saving} className={`${SMALL_BUTTON} h-10 px-4`}>
                  <Undo2 size={14} aria-hidden /> Discard
                </button>
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={!canSave}
                  aria-keyshortcuts="Control+S"
                  className={`flex h-10 items-center gap-2 rounded-md bg-accent px-5 text-sm font-bold text-on-accent uppercase shadow-md transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`}
                >
                  {saving ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Save size={15} aria-hidden />}
                  {saving ? 'Saving…' : 'Save Profile'}
                  <kbd className="rounded border border-current/30 px-1 font-mono text-[10px] font-semibold opacity-70">{shortcut}</kbd>
                </button>
              </span>
            </div>
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4 @6xl/parish:sticky @6xl/parish:top-0 @6xl/parish:max-h-[calc(100vh-9rem)] @6xl/parish:w-2/5 @6xl/parish:overflow-y-auto @6xl/parish:pr-1" aria-label="Live branding preview">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-fg">Live preview</h2>
            <span className={SUB}>{dirty ? 'Showing your unsaved changes' : 'As saved'}</span>
          </div>
          <EmblemPreview.Provider value={{ src: shownLogo, scale: draft.logoScale, backing: draft.logoBacking }}>
            <NameplatePreview name={name} subtitle={subtitle} />
            <CrestPreview />
            <ContrastStrip />
          </EmblemPreview.Provider>
          <LetterheadPreview draftName={draft.name} cloud={cloud} onCheck={checkCloud} checking={checkingCloud} />
        </aside>
      </div>
    </div>
  );
}
