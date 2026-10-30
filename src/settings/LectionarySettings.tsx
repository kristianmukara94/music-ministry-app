import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, FileDown, FileUp, Loader2 } from 'lucide-react';
import { seasonOf, type Season } from '../../shared/liturgical-season.js';
import { sundayCycle, weekdayCycle } from '../liturgy/lectionary';
import { bridge } from '../live/bridge';
import { READING_TYPES, type LectionaryOverview, type ReadingType } from '../lectionary/types';
import { formatIsoDay, formatIsoWeekday } from '../state/region';
import { useRegion } from '../state/useRegion';
import { setUi, useUi } from '../state/ui';
import { SlideTextCard } from './SlideTextCard';
import { Bar, Card, PageHeader, SECONDARY, Stat, SUB } from './settingsUi';

const api = bridge.lectionary;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const DATE_LOCALE = { en: 'en-PH', tl: 'fil-PH', ceb: 'en-PH' } as const;

const SEASON_NAME: Record<Season, string> = {
  advent: 'Advent',
  christmas: 'Christmas',
  'ordinary-time': 'Ordinary Time',
  lent: 'Lent',
  'holy-week': 'Holy Week',
  easter: 'Easter',
  pentecost: 'Pentecost',
};

/** How many Sundays the readiness list looks ahead. About two months: far enough to plan, short enough to read at a glance. */
const SUNDAYS_AHEAD = 8;

/**
 * Sundays have all four readings. The Gospel Acclamation is entered for Praise & Worship, so it is never required. The Second Reading is
 * optional on weekdays, which is why it counts here and not for a weekday.
 */
const SUNDAY_SLOTS: ReadingType[] = ['First Reading', 'Responsorial Psalm', 'Second Reading', 'Gospel'];
const SLOT_SHORT: Record<ReadingType, string> = {
  'First Reading': '1st',
  'Responsorial Psalm': 'Psalm',
  'Second Reading': '2nd',
  'Gospel Acclamation': 'Alleluia',
  Gospel: 'Gospel',
};

/** Local calendar date as YYYY-MM-DD, the form the library stores. */
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dateOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** The next `count` Sundays as dates, starting today when today is a Sunday. */
function upcomingSundays(count: number, from = new Date()): string[] {
  const first = new Date(from.getFullYear(), from.getMonth(), from.getDate() + ((7 - from.getDay()) % 7));
  return Array.from({ length: count }, (_, i) => isoOf(new Date(first.getFullYear(), first.getMonth(), first.getDate() + i * 7)));
}

/** Where the Church is today, and which readings it asks for. The cycles are the ones the lectionary itself follows. */
function CalendarToday() {
  const today = useMemo(() => new Date(), []);
  const season = seasonOf(today);
  return (
    <Card id="lect-today" title="Today in the Church calendar" detail="Which readings to prepare. The year letter and number tell you which set of readings applies.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-line bg-panel/60 px-4 py-3">
          <div className="text-lg font-extrabold text-fg">{SEASON_NAME[season]}</div>
          <div className="text-xs text-fg/60">Liturgical season</div>
        </div>
        <div className="rounded-lg border border-line bg-panel/60 px-4 py-3">
          <div className="text-lg font-extrabold text-fg">Year {sundayCycle(today)}</div>
          <div className="text-xs text-fg/60">Sundays and solemnities</div>
        </div>
        <div className="rounded-lg border border-line bg-panel/60 px-4 py-3">
          <div className="text-lg font-extrabold text-fg">Year {weekdayCycle(today)}</div>
          <div className="text-xs text-fg/60">Weekday first reading</div>
        </div>
      </div>
    </Card>
  );
}

/** The next Sundays and what is ready for each. A row opens the Lectionary on the first reading still missing. */
function UpcomingSundays({ overview, error }: { overview: LectionaryOverview | null; error: string | null }) {
  const lang = useUi((s) => s.lang);
  const region = useRegion();
  const sundays = useMemo(() => upcomingSundays(SUNDAYS_AHEAD), []);
  const today = isoOf(new Date());

  const open = (date: string, readingType: ReadingType) => setUi({ view: 'lectionary', pendingFocus: { kind: 'reading', date, readingType } });

  const rows = sundays.map((date) => {
    const day = overview?.range.find((d) => d.date === date);
    const saved = new Set<ReadingType>(day?.slots ?? []);
    const missing = SUNDAY_SLOTS.filter((slot) => !saved.has(slot));
    return { date, label: day?.seasonInfo ?? '', saved, missing, season: seasonOf(dateOf(date)), cycle: sundayCycle(dateOf(date)) };
  });
  const readyCount = rows.filter((r) => r.missing.length === 0).length;

  return (
    <Card
      id="lect-upcoming"
      title="Upcoming Sundays"
      detail="A Sunday is ready when its first reading, psalm, second reading and Gospel are saved."
      action={overview && <span className="text-xs font-semibold text-fg/70 tabular-nums">{readyCount} of {SUNDAYS_AHEAD} ready</span>}
    >
      {error ? (
        <p role="alert" className="text-sm text-danger">The readings could not be read. {error}</p>
      ) : overview === null ? (
        <p className={SUB}>Loading…</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
          {rows.map((row) => {
            const ready = row.missing.length === 0;
            const notStarted = row.saved.size === 0;
            return (
              <li key={row.date} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3">
                <div className="min-w-[11rem] flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                    {formatIsoWeekday(row.date, DATE_LOCALE[lang])}, {formatIsoDay(row.date, region)}
                    {row.date === today && <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-extrabold tracking-wider text-on-accent uppercase">Today</span>}
                  </div>
                  <div className="truncate text-xs text-fg/60">
                    {row.label || SEASON_NAME[row.season]} · Year {row.cycle}
                  </div>
                </div>

                <ul className="flex flex-wrap gap-1" aria-label="Readings saved">
                  {READING_TYPES.map((slot) => {
                    const have = row.saved.has(slot);
                    const needed = SUNDAY_SLOTS.includes(slot);
                    return (
                      <li
                        key={slot}
                        title={`${slot}: ${have ? 'saved' : needed ? 'missing' : 'not saved (optional)'}`}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase ${
                          have ? 'border-ok/50 bg-ok/15 text-ok' : needed ? 'border-fg/25 text-fg/60' : 'border-dashed border-fg/20 text-fg/40'
                        }`}
                      >
                        <span className="sr-only">{slot}: {have ? 'saved' : needed ? 'missing' : 'optional, not saved'}. </span>
                        <span aria-hidden>{SLOT_SHORT[slot]}</span>
                      </li>
                    );
                  })}
                </ul>

                <button type="button" onClick={() => open(row.date, row.missing[0] ?? 'First Reading')} className={SECONDARY}>
                  {ready ? 'Review' : notStarted ? 'Prepare' : 'Finish'} <ArrowRight size={13} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className={SUB}>Only Sundays are listed here. Open the Lectionary from the sidebar to prepare a weekday, a feast or any other date.</p>
    </Card>
  );
}

const longDate = (iso: string | null, region: ReturnType<typeof useRegion>) => (iso ? formatIsoDay(iso, region) : '–');

/** What is saved in total, and how it divides among the five slots. */
function LibraryCard({ overview, error }: { overview: LectionaryOverview | null; error: string | null }) {
  const region = useRegion();
  return (
    <Card id="lect-library" title="Reading library" detail="Everything saved in the Lectionary, on every date.">
      {error ? (
        <p role="alert" className="text-sm text-danger">The library could not be read. {error}</p>
      ) : overview === null ? (
        <p className={SUB}>Loading…</p>
      ) : overview.readings === 0 ? (
        <p className="text-sm text-fg/70">
          No readings yet. APCCMMA does not ship the readings, because the texts are copyrighted and differ by region. Paste them into the Lectionary from the sidebar,
          or restore a backup below.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Days with readings" value={overview.days} />
            <Stat label="Readings saved" value={overview.readings} />
            <Stat label="Earliest" value={longDate(overview.earliest, region)} />
            <Stat label="Latest" value={longDate(overview.latest, region)} />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-fg">By reading</h3>
            <ul className="flex flex-col gap-1.5">
              {READING_TYPES.map((slot) => (
                <Bar key={slot} name={slot} count={overview.bySlot[slot] ?? 0} total={overview.days} />
              ))}
            </ul>
            <p className={SUB}>Each bar is the share of days that have that reading.</p>
          </div>
        </>
      )}
    </Card>
  );
}

/** Export and import of every reading, as one JSON file. The readings are the parish's own work, so they are worth a copy kept elsewhere. */
function BackupCard({ onRestored }: { onRestored: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const exportBackup = () =>
    run(async () => {
      const result = await api.exportJSON();
      if (result) setNote(`Backup saved to ${result.path} (${result.readings} ${result.readings === 1 ? 'reading' : 'readings'}).`);
    });

  const importBackup = () => {
    if (!window.confirm('Importing replaces any reading already saved on the same date and slot. Readings the file does not mention are kept. Continue?')) return;
    void run(async () => {
      const result = await api.importJSON();
      if (!result) return;
      onRestored();
      setNote(`Imported ${result.readings} ${result.readings === 1 ? 'reading' : 'readings'} from ${result.path}.`);
    });
  };

  return (
    <Card id="lect-backup" title="Backup" detail="Keeps the readings safe, and moves them to another laptop. A file with any invalid reading changes nothing.">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void exportBackup()} disabled={busy} className={SECONDARY}>
          <FileDown size={14} aria-hidden /> Export JSON
        </button>
        <button type="button" onClick={importBackup} disabled={busy} className={SECONDARY}>
          <FileUp size={14} aria-hidden /> Import JSON
        </button>
        {busy && <Loader2 size={18} className="animate-spin text-accent" aria-label="Working" />}
      </div>
      {note && (
        <p role="status" className="flex items-start gap-2 text-sm break-all text-ok">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden /> {note}
        </p>
      )}
      {error && (
        <p role="alert" className="flex items-start gap-2 text-sm whitespace-pre-line text-danger">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {error}
        </p>
      )}
      <p className={SUB}>The database backup in Backup &amp; restore also keeps the readings, along with everything else.</p>
    </Card>
  );
}

const SLOT_GUIDE: [ReadingType, string][] = [
  ['First Reading', 'Read at every Sunday and solemnity Mass, and on weekdays.'],
  ['Responsorial Psalm', 'The response is pinned above the verses on every slide, so the congregation always sees it.'],
  ['Second Reading', 'Sundays and solemnities have one. It is optional on weekdays.'],
  ['Gospel Acclamation', 'Entered for Praise & Worship. The Mass planner leaves it out of its library.'],
  ['Gospel', 'Read at every Mass.'],
];

/** How a reading becomes slides. Written from the editor, so what it says is what the Lectionary does. */
function HowItWorks() {
  return (
    <Card id="lect-guide" title="How readings are prepared" detail="Open the Lectionary from the sidebar, choose a date, and paste each reading.">
      <div className="grid gap-5 lg:grid-cols-2">
        <dl className="flex flex-col gap-2.5">
          {SLOT_GUIDE.map(([slot, text]) => (
            <div key={slot}>
              <dt className="text-sm font-semibold text-fg">{slot}</dt>
              <dd className="text-xs text-fg/70">{text}</dd>
            </div>
          ))}
        </dl>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-fg/80">
          <li>Long readings are split into slides. <span className="font-semibold text-fg">Auto-paginate</span> does it to fit the screen.</li>
          <li>
            To choose where a slide ends, put <code className="rounded bg-panel px-1 font-mono text-xs text-accent">---</code> on a line of its own, or use{' '}
            <span className="font-semibold text-fg">Break at cursor</span>.
          </li>
          <li>Each reading can have its own font, colour and background under <span className="font-semibold text-fg">Slide style</span>.</li>
          <li>
            <span className="font-semibold text-fg">Ctrl+S</span> saves, and <span className="font-semibold text-fg">Stage</span> then <span className="font-semibold text-fg">Take Live</span> sends it to the projector.
          </li>
        </ul>
      </div>
    </Card>
  );
}

/**
 * Settings for the Lectionary: where the Church is in the year, which Sundays are ready, what the library holds, how slide text looks,
 * and a backup of the readings. The readings themselves are written in the Lectionary, not here.
 */
export function LectionarySettings() {
  const [overview, setOverview] = useState<LectionaryOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let current = true;
    const sundays = upcomingSundays(SUNDAYS_AHEAD);
    api
      .overview(sundays[0], sundays[sundays.length - 1])
      .then((result) => current && (setOverview(result), setError(null)))
      .catch((err) => current && setError(errorText(err)));
    return () => {
      current = false;
    };
  }, [version]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Content"
        title="Lectionary"
        description="See which Sundays are ready, keep a backup of the readings, and set how readings look on the projector."
        autoSave={false}
      />

      <CalendarToday />
      <UpcomingSundays overview={overview} error={error} />
      <LibraryCard overview={overview} error={error} />
      <SlideTextCard
        id="lect-text"
        sample={['A reading from the Book of Isaiah', 'The word of the Lord.']}
        note="A reading with its own font, set under Slide style in the Lectionary, keeps that font. The Live panel has the same size buttons for use during Mass."
      />
      <BackupCard onRestored={refresh} />
      <HowItWorks />
    </div>
  );
}
