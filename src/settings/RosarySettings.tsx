import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileDown,
  FileUp,
  Loader2,
  MonitorPlay,
  RotateCcw,
  Save,
  Scissors,
} from 'lucide-react';
import type { RosaryKey } from '../../shared/rosary-i18n.js';
import { rosaryT } from '../../shared/rosary-i18n.js';
import { mysteryTypeFor, positionOfDecade, rosarySequence, stepAt, stepsPerDecade, totalPositions, type StepKind } from '../../shared/rosary-logic.js';
import { FIT_MAX_LINES, slideFit, wrappedLineCount, type RosaryPresentation } from '../../shared/rosary-presentation.js';
import { bridge } from '../live/bridge';
import type { MediaAsset } from '../media/types';
import { FramePreview } from '../output/ProjectorView';
import { buildStep, loadDeckStyle, loadPresentation, savePresentation } from '../rosary/frames';
import { notifyRosaryChanged } from '../rosary/refresh';
import {
  type Mystery,
  type MysteryInput,
  type MysteryType,
  type PrayerInput,
  type RosaryImportPreview,
  type RosaryPrayer,
} from '../rosary/types';
import { CHUNK_MAX_CHARS, loadChunkOptions, MAX_LINES_CHOICES, saveChunkOptions, splitPrayerText, type ChunkOptions } from '../rosary/rosaryUtils';

const api = bridge.rosary;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Lang = 'en' | 'tl' | 'ceb';
const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'tl', label: 'Tagalog' },
  { code: 'ceb', label: 'Cebuano' },
];
const langLabel = (code: Lang) => LANGS.find((l) => l.code === code)?.label ?? code;

const PRAYER_LABELS: Record<string, RosaryKey> = {
  creed: 'prayer_creed',
  our_father: 'prayer_our_father',
  hail_mary: 'prayer_hail_mary',
  glory_be: 'prayer_glory_be',
  fatima: 'prayer_fatima',
  hail_holy_queen: 'prayer_hail_holy_queen',
  litany_loreto: 'prayer_litany_loreto',
  st_michael: 'prayer_st_michael',
};

/** The rail's groups, in the order they are prayed. The Fatima prayer is said in every decade, so it sits with the opening prayers. */
type GroupKey = 'opening' | MysteryType | 'closing';
const RAIL_SETS: MysteryType[] = ['joyful', 'luminous', 'sorrowful', 'glorious'];
const GROUPS: { key: GroupKey; label: string; hint?: string }[] = [
  { key: 'opening', label: 'Opening Prayers', hint: 'Said in the introduction and in every decade' },
  ...RAIL_SETS.map((type) => ({ key: type as GroupKey, label: rosaryT('en', `set_${type}`) })),
  { key: 'closing', label: 'Closing Prayers' },
];
const OPENING_PRAYERS = ['creed', 'our_father', 'hail_mary', 'glory_be', 'fatima'];
const CLOSING_PRAYERS = ['hail_holy_queen', 'litany_loreto', 'st_michael'];

/** One entry in the editor's rail. Mysteries are identified by set and decade, prayers by key. */
interface Item {
  id: string;
  group: GroupKey;
  label: string;
  mysteryType?: MysteryType;
  decade?: number;
  prayerKey?: string;
}

/** Text being edited. Keys are column names (`title_tl`), so a draft maps straight onto a save. */
interface Draft {
  values: Record<string, string>;
  approved: Record<Lang, boolean>;
}

const FOCUS = 'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none';
const button = `flex h-10 items-center gap-2 rounded-md border border-fg/15 px-4 text-xs font-bold whitespace-nowrap uppercase transition-colors hover:bg-fg/10 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`;
const small = `flex h-8 items-center gap-1.5 rounded-md border border-fg/15 px-3 text-[11px] font-bold whitespace-nowrap uppercase transition-colors hover:bg-fg/10 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS}`;
const primary = `flex h-10 items-center gap-2 rounded-md bg-accent px-5 text-xs font-extrabold whitespace-nowrap text-on-accent uppercase shadow-md shadow-black/30 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ${FOCUS}`;
const input = `rounded-md border border-fg/15 bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent ${FOCUS}`;
// Prayer and meditation text. Extra padding and a minimum height keep the first line clear of the top border.
const textarea = `w-full resize-y rounded-lg border border-fg/15 bg-panel-2 p-3 text-sm leading-relaxed text-fg outline-none focus:border-accent ${FOCUS}`;
const label = 'mb-2 block text-xs font-semibold uppercase tracking-wider text-fg/70';
const CARD = 'rounded-xl border border-line bg-panel';

const enLabel = (key: RosaryKey) => rosaryT('en', key);

function buildItems(): Item[] {
  const prayer = (key: string, group: GroupKey): Item => ({ id: `p:${key}`, group, label: enLabel(PRAYER_LABELS[key]), prayerKey: key });
  const mysteries = RAIL_SETS.flatMap((type) =>
    [1, 2, 3, 4, 5].map((decade) => ({
      id: `m:${type}:${decade}`,
      group: type as GroupKey,
      label: `${enLabel(`set_${type}`)} · ${rosaryT('en', 'decade', { n: decade })}`,
      mysteryType: type,
      decade,
    })),
  );
  return [...OPENING_PRAYERS.map((k) => prayer(k, 'opening')), ...mysteries, ...CLOSING_PRAYERS.map((k) => prayer(k, 'closing'))];
}

const ITEMS = buildItems();

function draftFromMystery(m: Mystery): Draft {
  return {
    values: {
      title_en: m.titleEn,
      title_tl: m.titleTl,
      title_ceb: m.titleCeb,
      meditation_en: m.meditationEn,
      meditation_tl: m.meditationTl,
      meditation_ceb: m.meditationCeb,
      scripture_ref: m.scriptureRef,
    },
    approved: { en: m.approvedEn === 1, tl: m.approvedTl === 1, ceb: m.approvedCeb === 1 },
  };
}

function draftFromPrayer(p: RosaryPrayer): Draft {
  return {
    values: { text_en: p.textEn, text_tl: p.textTl, text_ceb: p.textCeb },
    approved: { en: p.approvedEn === 1, tl: p.approvedTl === 1, ceb: p.approvedCeb === 1 },
  };
}

/** Fields for one language. A mystery has a title and a meditation. A prayer has its text only. */
function fieldsFor(item: Item): { name: string; label: string; multiline: boolean }[] {
  if (item.prayerKey) return [{ name: 'text', label: 'Prayer text', multiline: true }];
  return [
    { name: 'title', label: 'Mystery title', multiline: false },
    { name: 'meditation', label: 'Meditation', multiline: true },
  ];
}

/** Whether every field of a language has text. An empty language cannot be approved in any useful sense. */
const languageFilled = (draft: Draft, item: Item, lang: Lang) => fieldsFor(item).every((f) => (draft.values[`${f.name}_${lang}`] ?? '').trim() !== '');

/** The saved row of an item, or undefined before the data loads. */
function rowOf(item: Item, mysteries: Mystery[], prayers: RosaryPrayer[]): Mystery | RosaryPrayer | undefined {
  if (item.prayerKey) return prayers.find((p) => p.key === item.prayerKey);
  return mysteries.find((m) => m.mysteryType === item.mysteryType && m.decadeNumber === item.decade);
}

/** How many of the three languages the parish has approved for an item, from the saved row. */
const approvedCount = (row: Mystery | RosaryPrayer | undefined) => (row ? [row.approvedEn, row.approvedTl, row.approvedCeb].filter((a) => a === 1).length : 0);

/** The next item after `from` (wrapping round) with a language still to approve, or null when every item is approved. */
function nextUnapproved(from: number, mysteries: Mystery[], prayers: RosaryPrayer[]): Item | null {
  for (let i = 1; i < ITEMS.length; i++) {
    const item = ITEMS[(from + i) % ITEMS.length];
    if (approvedCount(rowOf(item, mysteries, prayers)) < LANGS.length) return item;
  }
  return null;
}

/** The saved rows with the item being edited replaced by its draft, so the preview shows unsaved text. */
function withDraft(item: Item, draft: Draft | null, mysteries: Mystery[], prayers: RosaryPrayer[]): { mysteries: Mystery[]; prayers: RosaryPrayer[] } {
  if (!draft) return { mysteries, prayers };
  const v = draft.values;
  if (item.prayerKey) {
    return { mysteries, prayers: prayers.map((p) => (p.key === item.prayerKey ? { ...p, textEn: v.text_en, textTl: v.text_tl, textCeb: v.text_ceb } : p)) };
  }
  return {
    prayers,
    mysteries: mysteries.map((m) =>
      m.mysteryType === item.mysteryType && m.decadeNumber === item.decade
        ? {
            ...m,
            titleEn: v.title_en,
            titleTl: v.title_tl,
            titleCeb: v.title_ceb,
            meditationEn: v.meditation_en,
            meditationTl: v.meditation_tl,
            meditationCeb: v.meditation_ceb,
            scriptureRef: v.scripture_ref,
          }
        : m,
    ),
  };
}

/** Which presentation option puts a prayer in the deck, for prayers that can be left out. */
const OPTIONAL_PRAYER: Partial<Record<string, keyof RosaryPresentation>> = { fatima: 'fatima', litany_loreto: 'litany', st_michael: 'stMichael' };

// ---------------------------------------------------------------------------------------------------------------------
// Left rail
// ---------------------------------------------------------------------------------------------------------------------

function ApprovalBadge({ count }: { count: number }) {
  if (count === LANGS.length) {
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full border border-ok/40 bg-ok/10 px-1.5 py-0.5 text-[10px] font-bold text-ok tabular-nums" title="All three languages approved">
        {count}/{LANGS.length} <CheckCircle2 size={11} aria-hidden />
      </span>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-1.5 py-0.5 text-[10px] font-bold text-warn tabular-nums" title={`${count} of ${LANGS.length} languages approved`}>
      <AlertTriangle size={11} aria-hidden /> {count}/{LANGS.length}
    </span>
  );
}

function CategoryRail({
  selectedId,
  onSelect,
  mysteries,
  prayers,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  mysteries: Mystery[];
  prayers: RosaryPrayer[];
}) {
  const [filter, setFilter] = useState<'all' | 'pending'>('all');
  const counts = useMemo(() => new Map(ITEMS.map((i) => [i.id, approvedCount(rowOf(i, mysteries, prayers))])), [mysteries, prayers]);
  const pending = ITEMS.filter((i) => (counts.get(i.id) ?? 0) < LANGS.length).length;
  // The selected item stays listed under the filter, so the editor never shows an item the rail hides.
  const visible = (item: Item) => filter === 'all' || item.id === selectedId || (counts.get(item.id) ?? 0) < LANGS.length;

  const railLabel = (item: Item) => {
    if (item.prayerKey) return item.label;
    const m = mysteries.find((x) => x.mysteryType === item.mysteryType && x.decadeNumber === item.decade);
    return `${item.decade}. ${m?.titleEn || rosaryT('en', 'decade', { n: item.decade ?? 0 })}`;
  };

  return (
    <nav aria-label="Rosary items" className={`${CARD} flex min-h-0 flex-col overflow-hidden`}>
      <div className="flex shrink-0 gap-1 border-b border-line p-2" role="group" aria-label="Show">
        {(['all', 'pending'] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-full border px-2 py-1.5 text-[11px] font-bold transition-colors ${FOCUS} ${
              filter === f ? 'border-accent/50 bg-accent/15 text-accent' : 'border-transparent text-fg/70 hover:border-line hover:text-fg'
            }`}
          >
            {f === 'all' ? 'All Items' : 'Needs Approval'}
            {f === 'pending' && <span className="rounded-full bg-warn/20 px-1.5 text-[10px] text-warn tabular-nums">{pending}</span>}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filter === 'pending' && pending === 0 && <p className="px-2 py-3 text-xs text-ok">Every item is approved in all three languages.</p>}
        {GROUPS.map((group) => {
          const items = ITEMS.filter((i) => i.group === group.key && visible(i));
          if (items.length === 0) return null;
          return (
            <div key={group.key} className="mb-3 last:mb-0">
              <h3 className="px-2 pt-1 pb-1 text-[10px] font-bold tracking-wider text-fg/55 uppercase" title={group.hint}>{group.label}</h3>
              <ul className="flex flex-col gap-0.5">
                {items.map((item) => {
                  const on = item.id === selectedId;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-current={on ? 'true' : undefined}
                        onClick={() => onSelect(item.id)}
                        className={`flex w-full items-center gap-2 rounded-md border-l-[3px] px-2 py-1.5 text-left text-[13px] transition-colors ${FOCUS} ${
                          on ? 'border-accent bg-accent/15 font-semibold text-accent' : 'border-transparent text-fg/80 hover:bg-fg/[0.06] hover:text-fg'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{railLabel(item)}</span>
                        <ApprovalBadge count={counts.get(item.id) ?? 0} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Editor parts
// ---------------------------------------------------------------------------------------------------------------------

/** The slide-fit gauge under a text box. A meditation is one slide; a prayer is split, so its longest slide is what counts. */
function FitGauge({ text, prayer, chunks }: { text: string; prayer: boolean; chunks: ChunkOptions }) {
  if (prayer) {
    const slides = splitPrayerText(text, chunks);
    const longest = Math.max(0, ...slides.map((s) => wrappedLineCount(s.text)));
    const fits = longest <= FIT_MAX_LINES;
    return (
      <p className={`mt-1 self-end text-[11px] tabular-nums ${fits ? 'text-fg/55' : 'font-semibold text-warn'}`}>
        {text.trim().length} chars · {slides.length} {slides.length === 1 ? 'slide' : 'slides'} · longest slide {longest} {longest === 1 ? 'line' : 'lines'}
        {fits ? '' : ` — over ${FIT_MAX_LINES} lines, so the projector shrinks the text`}
      </p>
    );
  }
  const fit = slideFit(text);
  const share = Math.min(100, (fit.lines / FIT_MAX_LINES) * 100);
  return (
    <div className="mt-1.5 flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fg/10" aria-hidden>
        <div className={`h-full rounded-full transition-all ${fit.fits ? 'bg-ok' : 'bg-warn'}`} style={{ width: `${share}%` }} />
      </div>
      <p className={`text-[11px] whitespace-nowrap tabular-nums ${fit.fits ? 'text-fg/60' : 'font-semibold text-warn'}`}>
        {fit.chars} / {fit.capacity} chars ·{' '}
        {fit.lines === 0 ? 'Empty' : fit.fits ? `Fits cleanly (${fit.lines} ${fit.lines === 1 ? 'line' : 'lines'})` : `${fit.lines} lines — the projector will shrink it`}
      </p>
    </div>
  );
}

/** The slide-splitting bar under a prayer's text: the line limit, the auto-split switch, and a list of the slides. */
function SlideSplitBar({ text, options, onChange }: { text: string; options: ChunkOptions; onChange: (next: ChunkOptions) => void }) {
  const [open, setOpen] = useState(false);
  const slides = splitPrayerText(text, options);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group rounded-lg border border-line">
      <summary className={`flex cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs font-semibold tracking-wider text-fg/70 uppercase [&::-webkit-details-marker]:hidden ${FOCUS}`}>
        <span className="flex items-center gap-2">
          <Scissors size={13} aria-hidden /> Slide splitting · {slides.length} {slides.length === 1 ? 'slide' : 'slides'}
        </span>
        <ChevronRight size={14} className="transition group-open:rotate-90" aria-hidden />
      </summary>
      <div className="flex flex-col gap-3 border-t border-line p-3">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-fg/70">Max lines per slide</span>
            <select
              value={options.maxLines ?? 'auto'}
              disabled={!options.autoSplit}
              onChange={(e) => onChange({ ...options, maxLines: e.target.value === 'auto' ? null : Number(e.target.value) })}
              className={`${input} h-9 disabled:opacity-40`}
            >
              {MAX_LINES_CHOICES.map((n) => (
                <option key={n ?? 'auto'} value={n ?? 'auto'}>
                  {n ?? 'Auto'}
                </option>
              ))}
            </select>
          </label>
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" role="switch" checked={options.autoSplit} onChange={(e) => onChange({ ...options, autoSplit: e.target.checked })} className="size-4 accent-accent" />
            Auto-split long text
          </label>
        </div>
        <p className="text-xs text-muted">
          Explicit breaks always apply: a blank line, a line of <code>---</code>, or <code>[SLIDE]</code>. Auto-split also keeps each slide to the line limit and to{' '}
          {CHUNK_MAX_CHARS} characters, breaking at the nearest full stop, semicolon or exclamation mark.
        </p>
        <ol className="flex flex-col gap-2">
          {slides.length === 0 ? (
            <li className="text-sm text-muted">There is no text to split.</li>
          ) : (
            slides.map((s) => (
              <li key={s.partIndex} className="rounded-md border border-line bg-canvas p-2.5">
                <p className="mb-1 text-[11px] font-bold tabular-nums text-accent">
                  Slide {s.partIndex}/{s.totalParts}
                </p>
                <p className="text-sm whitespace-pre-line">{s.text}</p>
              </li>
            ))
          )}
        </ol>
      </div>
    </details>
  );
}

/** The English text of the item, read only, above a translation, so a reviewer can compare without switching tabs. */
function EnglishReference({ item, draft }: { item: Item; draft: Draft }) {
  return (
    <section aria-label="English reference" className="rounded-lg border border-dashed border-accent/35 bg-accent/[0.04] p-3">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-accent uppercase">
        <BookOpen size={13} aria-hidden /> English reference · read only
      </p>
      <dl className="flex flex-col gap-2">
        {fieldsFor(item).map((f) => (
          <div key={f.name}>
            <dt className="text-[10px] font-semibold tracking-wider text-fg/55 uppercase">{f.label}</dt>
            <dd className={`text-sm leading-relaxed whitespace-pre-line text-fg/85 ${f.multiline ? 'max-h-40 overflow-y-auto' : 'font-semibold'}`}>
              {(draft.values[`${f.name}_en`] ?? '').trim() || <span className="text-muted italic">No English text yet.</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Live preview and deck sequence
// ---------------------------------------------------------------------------------------------------------------------

function RosaryPreview({
  item,
  draft,
  lang,
  mysteries,
  prayers,
  chunks,
  presentation,
  background,
}: {
  item: Item;
  draft: Draft | null;
  lang: Lang;
  mysteries: Mystery[];
  prayers: RosaryPrayer[];
  chunks: ChunkOptions;
  presentation: RosaryPresentation;
  background: MediaAsset | null;
}) {
  // A step of the decade (mysteries) or a slide of the prayer (prayers). Back to the start whenever the item changes.
  const [at, setAt] = useState(0);
  useEffect(() => setAt(0), [item.id]);

  const data = withDraft(item, draft, mysteries, prayers);
  const style = useMemo(loadDeckStyle, []);
  const optional = item.prayerKey ? OPTIONAL_PRAYER[item.prayerKey] : undefined;
  const turnedOff = optional ? !presentation[optional] : false;
  // A prayer that is turned off is still previewed, as it would look if it were turned on.
  const sequenceOptions = optional && turnedOff ? { ...presentation, [optional]: true } : presentation;
  const type: MysteryType = item.mysteryType ?? (mysteryTypeFor(new Date()) as MysteryType);

  let position: number;
  let count: number;
  let chunk = 0;
  if (item.decade) {
    count = stepsPerDecade(sequenceOptions);
    position = positionOfDecade(item.decade, sequenceOptions) + Math.min(at, count - 1);
  } else {
    position = Math.max(0, rosarySequence(sequenceOptions).findIndex((s) => s.kind === (item.prayerKey as StepKind)));
    count = buildStep(position, type, data.mysteries, data.prayers, lang, style, chunks, 0, sequenceOptions).frame.part?.total ?? 1;
    chunk = Math.min(at, count - 1);
  }
  const built = data.mysteries.length > 0 ? buildStep(position, type, data.mysteries, data.prayers, lang, style, chunks, chunk, sequenceOptions) : null;
  const step = stepAt(position, sequenceOptions);
  const stepName = step.kind === 'announce' ? 'Announce the mystery' : step.kind === 'hail_mary' && step.section === 'decade' ? `Hail Mary ${step.bead} of 10` : enLabel(`prayer_${step.kind}`);
  const where = item.decade ? `Step ${Math.min(at, count - 1) + 1} of ${count} · ${stepName}` : `Slide ${chunk + 1} of ${count}`;
  const media = background && background.mediaType !== 'audio' ? { src: background.src, mediaType: background.mediaType } : null;

  return (
    <section aria-labelledby="rosary-preview-heading" className={`${CARD} flex flex-col gap-3 p-4`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="rosary-preview-heading" className="flex items-center gap-2 text-xs font-bold tracking-wider text-fg/70 uppercase">
          <MonitorPlay size={14} className="text-accent" aria-hidden /> Live slide preview
        </h2>
        <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-bold tracking-wider text-fg/60 uppercase">{langLabel(lang)} · 16:9</span>
      </div>
      <div className="aspect-video w-full overflow-hidden rounded-lg border border-fg/15 shadow-lg shadow-black/30">
        {built ? <FramePreview frame={built.frame} background={media} /> : <div className="grid h-full place-items-center bg-stone-950 text-xs text-white/50">Loading…</div>}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setAt((n) => Math.max(0, n - 1))} disabled={at === 0} aria-label="Previous step" className={`${small} size-8 justify-center px-0`}>
          <ChevronLeft size={15} aria-hidden />
        </button>
        <span className="min-w-0 flex-1 truncate text-center text-xs font-semibold text-fg/75 tabular-nums" aria-live="polite">
          {where}
        </span>
        <button type="button" onClick={() => setAt((n) => Math.min(count - 1, n + 1))} disabled={at >= count - 1} aria-label="Next step" className={`${small} size-8 justify-center px-0`}>
          <ChevronRight size={15} aria-hidden />
        </button>
      </div>
      {turnedOff && (
        <p className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden /> This prayer is turned off in Presentation &amp; devotional options, so the live deck skips it.
        </p>
      )}
      {built?.fallback && <p className="text-xs text-muted">{langLabel(lang)} text is missing here, so the projector shows English.</p>}
    </section>
  );
}

/** The order of the live deck with the current options. Optional prayers that are off are shown struck through. */
function DeckSequence({ presentation }: { presentation: RosaryPresentation }) {
  const chip = (text: string, state: 'on' | 'optional' | 'off' = 'on') => (
    <li
      key={text}
      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        state === 'on' ? 'border-line text-fg/75' : state === 'optional' ? 'border-accent/50 bg-accent/10 text-accent' : 'border-dashed border-fg/20 text-fg/35 line-through'
      }`}
    >
      {text}
    </li>
  );
  const opt = (text: string, on: boolean) => chip(text, on ? 'optional' : 'off');
  const rows: { label: string; chips: JSX.Element[] }[] = [
    { label: 'Opening', chips: [chip('Creed'), chip('Our Father'), chip('Hail Mary ×3'), chip('Glory Be')] },
    {
      label: 'Each decade ×5',
      chips: [chip('Announce'), chip('Our Father'), chip('Hail Mary ×10'), chip('Glory Be'), opt('O My Jesus (Fatima)', presentation.fatima)],
    },
    { label: 'Closing', chips: [chip('Hail Holy Queen'), opt('Litany of Loreto', presentation.litany), opt('St. Michael', presentation.stMichael)] },
  ];
  return (
    <section aria-labelledby="rosary-sequence-heading" className={`${CARD} flex flex-col gap-3 p-4`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id="rosary-sequence-heading" className="text-xs font-bold tracking-wider text-fg/70 uppercase">Live deck sequence</h2>
        <span className="text-xs font-semibold text-accent tabular-nums" aria-live="polite">{totalPositions(presentation)} steps</span>
      </div>
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-1.5">
          <span className="text-[10px] font-bold tracking-wider text-fg/50 uppercase">{row.label}</span>
          <ul className="flex flex-wrap gap-1.5">{row.chips}</ul>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Presentation options
// ---------------------------------------------------------------------------------------------------------------------

function Toggle({ checked, onChange, title, detail }: { checked: boolean; onChange: (on: boolean) => void; title: string; detail?: string }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${checked ? 'border-accent/40 bg-accent/[0.07]' : 'border-line hover:bg-fg/[0.03]'}`}>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-accent" />
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold text-fg">{title}</span>
        {detail && <span className="text-xs text-muted">{detail}</span>}
      </span>
    </label>
  );
}

function PresentationOptions({
  value,
  onChange,
  media,
  prayers,
}: {
  value: RosaryPresentation;
  onChange: (patch: Partial<RosaryPresentation>) => void;
  media: MediaAsset[];
  prayers: RosaryPrayer[];
}) {
  const backgrounds = media.filter((m) => m.mediaType === 'image' || m.mediaType === 'video');
  const chosen = backgrounds.find((m) => m.id === value.backgroundId) ?? null;
  const empty = (key: string) => !(prayers.find((p) => p.key === key)?.textEn ?? '').trim();
  return (
    <section aria-labelledby="rosary-presentation-heading" className={`${CARD} flex flex-col gap-4 p-5`}>
      <div>
        <h2 id="rosary-presentation-heading" className="text-lg font-bold tracking-tight">Presentation &amp; devotional options</h2>
        <p className="text-xs text-muted">Saved on this computer as you change them. The Rosary deck picks them up at once; the preview shows the result.</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-bold tracking-wider text-fg/55 uppercase">On screen</p>
        <Toggle
          checked={value.beadTracker}
          onChange={(beadTracker) => onChange({ beadTracker })}
          title="Display bead tracker overlay"
          detail="Adds a line under the beads on the projector, such as “2nd Joyful Mystery · Hail Mary 4 of 10”."
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-bold tracking-wider text-fg/55 uppercase">Devotional prayers in the deck</p>
        <Toggle checked={value.fatima} onChange={(fatima) => onChange({ fatima })} title="Include Fatima Prayer (“O My Jesus…”)" detail="Said after the Glory Be of every decade." />
        <Toggle
          checked={value.stMichael}
          onChange={(stMichael) => onChange({ stMichael })}
          title="Include St. Michael the Archangel Prayer"
          detail={empty('st_michael') ? 'No text yet: add it under Closing Prayers.' : 'Said at the very end, after the closing prayers.'}
        />
        <Toggle
          checked={value.litany}
          onChange={(litany) => onChange({ litany })}
          title="Include Litany of Loreto"
          detail={empty('litany_loreto') ? 'No text yet: add the parish’s approved litany under Closing Prayers.' : 'Said after the Hail Holy Queen.'}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="rosary-default-bg" className="text-[11px] font-bold tracking-wider text-fg/55 uppercase">
          Default Rosary background
        </label>
        <div className="flex items-center gap-3">
          <div className="grid h-12 w-20 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-stone-950">
            {chosen?.thumbSrc ? <img src={chosen.thumbSrc} alt="" className="h-full w-full object-cover" /> : <span className="text-[10px] text-white/40">None</span>}
          </div>
          <select
            id="rosary-default-bg"
            value={chosen ? String(chosen.id) : ''}
            onChange={(e) => onChange({ backgroundId: e.target.value ? Number(e.target.value) : null })}
            className={`${input} h-10 min-w-0 flex-1`}
          >
            <option value="">No default background</option>
            {backgrounds.map((m) => (
              <option key={m.id} value={m.id}>
                {m.mediaType === 'video' ? '▶ ' : ''}
                {m.filename}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted">
          {backgrounds.length === 0
            ? 'Add a Marian image or a motion loop to the Media Library first.'
            : 'Put on the background layer each time the Rosary goes live. The deck’s own background picker still changes it during the devotion.'}
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Import confirmation
// ---------------------------------------------------------------------------------------------------------------------

function ImportDiffModal({
  preview,
  busy,
  unsavedItem,
  onCancel,
  onApply,
}: {
  preview: RosaryImportPreview;
  busy: boolean;
  unsavedItem: string | null;
  onCancel: () => void;
  onApply: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const items = preview.mysteries + preview.prayers;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const nothing = preview.textEdits === 0 && preview.approvalChanges === 0 && preview.added === 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !busy && onCancel()}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rosary-import-title"
        aria-describedby="rosary-import-summary"
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-fg/15 bg-panel p-6 shadow-2xl"
      >
        <h3 id="rosary-import-title" className="flex items-center gap-2 text-lg font-bold">
          <FileUp size={18} aria-hidden /> Import rosary backup?
        </h3>
        <p id="rosary-import-summary" className="flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 p-3 text-sm text-fg">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ok" aria-hidden />
          <span>
            Valid file: {plural(items, 'item', 'items')} loaded · {plural(preview.textEdits, 'text edit', 'text edits')} detected ·{' '}
            {plural(preview.approvalChanges, 'approval flag', 'approval flags')} updated
            {preview.added > 0 ? ` · ${plural(preview.added, 'new item', 'new items')}` : ''}.
          </span>
        </p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted">File</dt>
          <dd className="break-all text-fg/80">{preview.path}</dd>
          <dt className="text-muted">Unchanged</dt>
          <dd className="text-fg/80">{plural(preview.unchanged, 'item', 'items')}</dd>
        </dl>
        {nothing && <p className="text-sm text-muted">This file matches what is already saved. Importing it changes nothing.</p>}
        {unsavedItem && (
          <p className="flex items-start gap-2 text-sm text-warn">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> Your unsaved changes to {unsavedItem} will be discarded.
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button ref={cancelRef} type="button" onClick={onCancel} disabled={busy} className={button}>
            Cancel
          </button>
          <button type="button" onClick={onApply} disabled={busy} className={primary}>
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <FileUp size={15} aria-hidden />} Apply Import &amp; Overwrite
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------------------------------

export function RosarySettings() {
  const [mysteries, setMysteries] = useState<Mystery[]>([]);
  const [prayers, setPrayers] = useState<RosaryPrayer[]>([]);
  const [media, setMedia] = useState<MediaAsset[]>([]);
  const [selectedId, setSelectedId] = useState(ITEMS[0].id);
  const [lang, setLang] = useState<Lang>('en');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<RosaryImportPreview | null>(null);
  // How prayers are split into slides, and how the rosary is presented. Both are shared with the deck through storage.
  const [chunks, setChunks] = useState<ChunkOptions>(loadChunkOptions);
  const [presentation, setPresentation] = useState<RosaryPresentation>(loadPresentation);
  // The prayer text boxes, so a slide break can be inserted at the cursor.
  const textareas = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const tabRefs = useRef<Record<Lang, HTMLButtonElement | null>>({ en: null, tl: null, ceb: null });

  const itemIndex = Math.max(0, ITEMS.findIndex((i) => i.id === selectedId));
  const item = ITEMS[itemIndex];

  /** The saved row, as a draft. The editor's text is "unsaved" exactly when it differs from this. */
  const saved = useMemo<Draft | null>(() => {
    const row = rowOf(item, mysteries, prayers);
    if (!row) return null;
    return item.prayerKey ? draftFromPrayer(row as RosaryPrayer) : draftFromMystery(row as Mystery);
  }, [item, mysteries, prayers]);

  const dirty = draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved);

  /** Saves a change to the split settings. The rosary deck reloads, so its staged slide follows the new split. */
  const changeChunks = (next: ChunkOptions) => {
    setChunks(next);
    saveChunkOptions(next);
    notifyRosaryChanged();
  };

  /** Saves a presentation option at once. The deck reloads with it, as it does after a text save. */
  const changePresentation = (patch: Partial<RosaryPresentation>) => {
    const next = { ...presentation, ...patch };
    setPresentation(next);
    savePresentation(next);
    notifyRosaryChanged();
  };

  const load = async () => {
    const [m, p] = await Promise.all([api.getMysteries(), api.getPrayers()]);
    setMysteries(m);
    setPrayers(p);
    return { m, p };
  };

  useEffect(() => {
    load().catch((err) => setError(errorText(err)));
    bridge.media.list().then(setMedia).catch(() => undefined);
  }, []);

  // Each time the selection changes, or the data is reloaded after a save or import, the draft starts from the saved row.
  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  /** Asks before throwing away unsaved text. */
  const confirmDiscard = () => !dirty || window.confirm('You have unsaved changes to this item. Discard them?');

  const goTo = (id: string) => {
    setStatus(null);
    setError(null);
    setSelectedId(id);
  };

  const selectItem = (id: string) => {
    if (id === selectedId || !confirmDiscard()) return;
    goTo(id);
  };

  const step = (by: -1 | 1) => {
    const next = ITEMS[itemIndex + by];
    if (next) selectItem(next.id);
  };

  /** Editing a language means it needs approving again, so its approval is cleared as soon as the text changes. */
  const edit = (column: string, forLang: Lang, value: string) => {
    setStatus(null);
    setDraft((d) => (d ? { values: { ...d.values, [column]: value }, approved: { ...d.approved, [forLang]: false } } : d));
  };

  const toggleApproval = (forLang: Lang, on: boolean) => {
    setStatus(null);
    setDraft((d) => (d ? { ...d, approved: { ...d.approved, [forLang]: on } } : d));
  };

  /** Inserts a slide break (`---`) at the cursor in a prayer's text box, and puts the cursor after it. */
  const insertBreak = (forLang: Lang, column: string) => {
    const el = textareas.current[`${item.id}-${column}`];
    const value = draft?.values[column] ?? '';
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const insert = '\n---\n';
    edit(column, forLang, value.slice(0, start) + insert + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + insert.length, start + insert.length);
    });
  };

  /** Runs a task with the busy state. Its result or failure is reported where the action is: in the header, or in the editor's bar. */
  const run = async (task: () => Promise<void>, scope: 'editor' | 'backup' = 'editor') => {
    setBusy(true);
    setError(null);
    setStatus(null);
    setBackupError(null);
    setBackupNote(null);
    try {
      await task();
    } catch (err) {
      (scope === 'backup' ? setBackupError : setError)(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  /** Writes a draft for the current item. */
  const write = async (d: Draft) => {
    const v = d.values;
    const a = d.approved;
    if (item.prayerKey) {
      const row: PrayerInput = {
        key: item.prayerKey,
        text_en: v.text_en,
        text_tl: v.text_tl,
        text_ceb: v.text_ceb,
        approved_en: a.en ? 1 : 0,
        approved_tl: a.tl ? 1 : 0,
        approved_ceb: a.ceb ? 1 : 0,
      };
      await api.savePrayer(row);
    } else {
      const row: MysteryInput = {
        mystery_type: item.mysteryType!,
        decade_number: item.decade!,
        title_en: v.title_en,
        title_tl: v.title_tl,
        title_ceb: v.title_ceb,
        meditation_en: v.meditation_en,
        meditation_tl: v.meditation_tl,
        meditation_ceb: v.meditation_ceb,
        scripture_ref: v.scripture_ref,
        approved_en: a.en ? 1 : 0,
        approved_tl: a.tl ? 1 : 0,
        approved_ceb: a.ceb ? 1 : 0,
      };
      await api.saveMystery(row);
    }
  };

  /**
   * Saves the item. `approveAll` marks all three languages approved first. `advance` then moves to the next item with a language
   * still to approve (Ctrl+Enter). With nothing to save, `advance` just moves on.
   */
  const save = ({ advance = false, approveAll = false }: { advance?: boolean; approveAll?: boolean } = {}) => {
    if (!draft || busy) return;
    const next: Draft = approveAll ? { ...draft, approved: { en: true, tl: true, ceb: true } } : draft;
    const changed = saved === null || JSON.stringify(next) !== JSON.stringify(saved);
    if (!changed && !advance) return;
    void run(async () => {
      let m = mysteries;
      let p = prayers;
      if (changed) {
        await write(next);
        notifyRosaryChanged();
        ({ m, p } = await load());
      }
      const what = approveAll ? 'Approved in all three languages and saved.' : changed ? 'Saved.' : 'Nothing to save.';
      if (!advance) {
        setStatus(`${what} The rosary deck now uses this text.`);
        return;
      }
      const target = nextUnapproved(itemIndex, m, p);
      if (!target) {
        setStatus(`${what} Every item is approved in all three languages.`);
        return;
      }
      goTo(target.id);
      const title = target.prayerKey ? target.label : m.find((x) => x.mysteryType === target.mysteryType && x.decadeNumber === target.decade)?.titleEn || target.label;
      setStatus(`${what} Next to approve: ${title}.`);
    });
  };

  // Ctrl+S saves; Ctrl+Enter saves and moves to the next item that needs approval. Cmd works on a Mac. Not while the import dialog is open.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || importPreview) return;
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        save({ advance: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const exportBackup = () =>
    run(async () => {
      const result = await api.exportJSON();
      if (result) setBackupNote(`Backup saved to ${result.path} (${result.mysteries} mysteries, ${result.prayers} prayers).`);
    }, 'backup');

  /** Picks and checks a file. Nothing is written until the operator confirms the summary. */
  const startImport = () =>
    run(async () => {
      const preview = await api.importPreview();
      if (preview) setImportPreview(preview);
    }, 'backup');

  const cancelImport = () => {
    if (importPreview) void api.importCancel(importPreview.token).catch(() => undefined);
    setImportPreview(null);
  };

  const applyImport = () => {
    if (!importPreview) return;
    const token = importPreview.token;
    void run(async () => {
      try {
        const result = await api.importApply(token);
        notifyRosaryChanged();
        await load();
        setBackupNote(`Imported ${result.mysteries} mysteries and ${result.prayers} prayers from ${result.path}.`);
      } finally {
        setImportPreview(null);
      }
    }, 'backup');
  };

  /** Arrow keys move between the language tabs, as in any tab list. */
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const at = LANGS.findIndex((l) => l.code === lang);
    const to = e.key === 'ArrowRight' ? (at + 1) % LANGS.length : e.key === 'ArrowLeft' ? (at + LANGS.length - 1) % LANGS.length : -1;
    if (to < 0) return;
    e.preventDefault();
    setLang(LANGS[to].code);
    tabRefs.current[LANGS[to].code]?.focus();
  };

  const draftApproved = draft ? LANGS.filter((l) => draft.approved[l.code]).length : 0;
  const allFilled = draft ? LANGS.every((l) => languageFilled(draft, item, l.code)) : false;
  const emptyLangs = draft ? LANGS.filter((l) => !languageFilled(draft, item, l.code)).map((l) => l.label) : [];
  const background = media.find((m) => m.id === presentation.backgroundId) ?? null;
  const groupLabel = GROUPS.find((g) => g.key === item.group)?.label ?? '';

  return (
    <div className="@container/rosary flex w-full flex-col gap-4">
      {/* Title, and the backup actions as compact secondary buttons, so the editor starts at the top of the page. */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight">Rosary text &amp; presentation</h2>
          <p className="text-xs text-muted">Edit and approve each mystery and prayer in English, Tagalog and Cebuano. The preview shows the projected slide.</p>
        </div>
        <div className="flex items-center gap-2">
          {busy && <Loader2 size={16} className="animate-spin text-accent" aria-label="Working" />}
          <button type="button" onClick={exportBackup} disabled={busy} className={small} title="Save every mystery and prayer, with approvals, to a JSON file">
            <FileDown size={14} aria-hidden /> Export JSON
          </button>
          <button type="button" onClick={startImport} disabled={busy} className={small} title="Restore mysteries and prayers from a JSON backup. You confirm the changes first.">
            <FileUp size={14} aria-hidden /> Import JSON
          </button>
        </div>
      </header>
      {backupNote && (
        <p role="status" className="-mt-2 flex items-start gap-2 text-xs break-all text-ok">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden /> {backupNote}
        </p>
      )}
      {backupError && <p role="alert" className="-mt-2 text-xs whitespace-pre-line text-danger">{backupError}</p>}

      <div className="flex flex-col gap-5 @4xl/rosary:flex-row @4xl/rosary:items-start">
        {/* Beside the editor on a wide page, kept in view and scrolling on its own; above it, a short scrolling list, on a narrow one. */}
        <div className="flex max-h-80 w-full shrink-0 flex-col @4xl/rosary:sticky @4xl/rosary:top-0 @4xl/rosary:max-h-[calc(100vh-12rem)] @4xl/rosary:w-64 @4xl/rosary:flex-none">
          <CategoryRail selectedId={selectedId} onSelect={selectItem} mysteries={mysteries} prayers={prayers} />
        </div>

        <div className="@container/work min-w-0 flex-1">
          <div className="grid items-start gap-5 @3xl/work:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            {/* Left: the form, then the presentation options. */}
            <div className="flex min-w-0 flex-col gap-5">
              <section className={`${CARD} p-5`} aria-labelledby="rosary-item-heading">
                {!draft ? (
                  error ? (
                    <p role="alert" className="text-sm whitespace-pre-line text-danger">The rosary text could not be loaded. {error}</p>
                  ) : (
                    <p className="text-sm text-muted">Loading the rosary text…</p>
                  )
                ) : (
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold tracking-wider text-accent uppercase">{groupLabel}</p>
                        <h3 id="rosary-item-heading" className="truncate text-lg font-bold text-fg">
                          {item.prayerKey ? item.label : `${rosaryT('en', 'decade', { n: item.decade ?? 0 })} · ${draft.values.title_en || '…'}`}
                        </h3>
                        <p className="text-xs text-muted">{draftApproved} of {LANGS.length} languages approved</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => step(-1)} disabled={itemIndex === 0} aria-label="Previous item" title="Previous item" className={`${small} size-8 justify-center px-0`}>
                          <ChevronLeft size={16} aria-hidden />
                        </button>
                        <span className="text-xs text-muted tabular-nums">
                          {itemIndex + 1}/{ITEMS.length}
                        </span>
                        <button type="button" onClick={() => step(1)} disabled={itemIndex === ITEMS.length - 1} aria-label="Next item" title="Next item" className={`${small} size-8 justify-center px-0`}>
                          <ChevronRight size={16} aria-hidden />
                        </button>
                      </div>
                    </div>

                    {/* One language at a time. Each tab says whether that language is approved. */}
                    <div role="tablist" aria-label="Language" className="flex flex-wrap gap-1 rounded-lg border border-line bg-canvas p-1">
                      {LANGS.map((l) => {
                        const on = lang === l.code;
                        const approved = draft.approved[l.code];
                        const filled = languageFilled(draft, item, l.code);
                        return (
                          <button
                            key={l.code}
                            ref={(el) => {
                              tabRefs.current[l.code] = el;
                            }}
                            type="button"
                            role="tab"
                            id={`rosary-tab-${l.code}`}
                            aria-selected={on}
                            aria-controls="rosary-panel"
                            tabIndex={on ? 0 : -1}
                            onClick={() => setLang(l.code)}
                            onKeyDown={onTabKey}
                            className={`flex min-w-[7rem] flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${FOCUS} ${
                              on ? 'border-accent/40 bg-accent/15 text-accent' : 'border-transparent text-fg/70 hover:text-fg'
                            }`}
                          >
                            {l.label}
                            {approved ? (
                              <CheckCircle2 size={14} className="text-ok" aria-label="Approved" />
                            ) : (
                              <AlertTriangle size={14} className={filled ? 'text-warn' : 'text-fg/40'} aria-label={filled ? 'Needs approval' : 'Empty'} />
                            )}
                          </button>
                        );
                      })}
                    </div>

                    <div role="tabpanel" id="rosary-panel" aria-labelledby={`rosary-tab-${lang}`} className="flex flex-col gap-4">
                      {lang !== 'en' && <EnglishReference item={item} draft={draft} />}

                      {fieldsFor(item).map((field) => {
                        const column = `${field.name}_${lang}`;
                        const value = draft.values[column] ?? '';
                        const common = {
                          id: `${item.id}-${column}`,
                          value,
                          onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => edit(column, lang, e.target.value),
                        };
                        return (
                          <div key={column} className="flex flex-col gap-3">
                            <div className="flex flex-col">
                              <div className="flex items-end justify-between gap-2">
                                <label htmlFor={common.id} className={label}>
                                  {field.label} · {langLabel(lang)}
                                </label>
                                {item.prayerKey && field.multiline && (
                                  <button type="button" onClick={() => insertBreak(lang, column)} className={`${small} mb-1.5 h-7`}>
                                    <Scissors size={12} aria-hidden /> Insert slide break
                                  </button>
                                )}
                              </div>
                              {field.multiline ? (
                                <textarea
                                  {...common}
                                  ref={(el) => {
                                    textareas.current[common.id] = el;
                                  }}
                                  rows={item.prayerKey ? 9 : 4}
                                  className={textarea}
                                />
                              ) : (
                                <input {...common} className={`${input} h-10`} />
                              )}
                              {field.multiline && <FitGauge text={value} prayer={!!item.prayerKey} chunks={chunks} />}
                            </div>
                            {item.prayerKey && field.multiline && <SlideSplitBar text={value} options={chunks} onChange={changeChunks} />}
                          </div>
                        );
                      })}

                      {!item.prayerKey && (
                        <label className="flex flex-col">
                          <span className={label}>Scripture reference (all languages)</span>
                          <input
                            value={draft.values.scripture_ref ?? ''}
                            onChange={(e) => {
                              setStatus(null);
                              setDraft((d) => (d ? { ...d, values: { ...d.values, scripture_ref: e.target.value } } : d));
                            }}
                            className={`${input} h-10 max-w-sm`}
                          />
                        </label>
                      )}

                      {/* Approval: its own block, with what it means and what clears it. */}
                      <label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${draft.approved[lang] ? 'border-ok/40 bg-ok/10' : 'border-line bg-canvas'}`}>
                        <input type="checkbox" checked={draft.approved[lang]} onChange={(e) => toggleApproval(lang, e.target.checked)} className="mt-0.5 size-4 accent-accent" />
                        <span className="flex flex-col">
                          <span className="text-sm font-semibold text-fg">{langLabel(lang)} approved by the parish</span>
                          <span className="text-xs text-muted">Tick this once the text has been checked. Editing the text clears it, so a changed text is never shown as approved.</span>
                        </span>
                      </label>
                    </div>

                    {/* Stays on screen while the text is long: what changed, and the actions. */}
                    <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-xl border border-line bg-panel/95 p-3 shadow-lg shadow-black/20 backdrop-blur">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 flex-1 text-sm" aria-live="polite">
                          {error ? (
                            <p role="alert" className="whitespace-pre-line text-danger">{error}</p>
                          ) : dirty ? (
                            <p className="flex items-center gap-2 font-semibold text-warn">
                              <span className="size-2 shrink-0 rounded-full bg-warn" aria-hidden /> Unsaved changes
                            </p>
                          ) : status ? (
                            <p role="status" className="flex items-center gap-2 text-ok">
                              <CheckCircle2 size={15} className="shrink-0" aria-hidden /> {status}
                            </p>
                          ) : (
                            <p className="text-muted">All changes saved.</p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" onClick={() => setDraft(saved)} disabled={!dirty || busy} className={button}>
                            <RotateCcw size={14} aria-hidden /> Discard
                          </button>
                          <button
                            type="button"
                            onClick={() => save({ approveAll: true })}
                            disabled={busy || !allFilled || draftApproved === LANGS.length}
                            className={`${button} border-ok/40 text-ok hover:bg-ok/10`}
                            title={allFilled ? 'Mark English, Tagalog and Cebuano approved, and save' : `Add the ${emptyLangs.join(' and ')} text first`}
                          >
                            <CheckCheck size={15} aria-hidden /> Approve All 3 Languages
                          </button>
                          <button type="button" onClick={() => save()} disabled={!dirty || busy} className={primary} title="Save (Ctrl+S)">
                            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Save size={15} aria-hidden />} Save
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-fg/50">
                        <kbd className="rounded border border-fg/20 px-1 font-mono">Ctrl</kbd>+<kbd className="rounded border border-fg/20 px-1 font-mono">S</kbd> save ·{' '}
                        <kbd className="rounded border border-fg/20 px-1 font-mono">Ctrl</kbd>+<kbd className="rounded border border-fg/20 px-1 font-mono">Enter</kbd> save &amp; next item needing approval
                      </p>
                    </div>
                  </div>
                )}
              </section>

              <PresentationOptions value={presentation} onChange={changePresentation} media={media} prayers={prayers} />
            </div>

            {/* Right: the projected slide and the deck order, kept in view while the form scrolls. */}
            <div className="flex min-w-0 flex-col gap-5 @3xl/work:sticky @3xl/work:top-0">
              <RosaryPreview
                item={item}
                draft={draft}
                lang={lang}
                mysteries={mysteries}
                prayers={prayers}
                chunks={chunks}
                presentation={presentation}
                background={background}
              />
              <DeckSequence presentation={presentation} />
            </div>
          </div>
        </div>
      </div>

      {importPreview && (
        <ImportDiffModal
          preview={importPreview}
          busy={busy}
          unsavedItem={dirty ? item.label : null}
          onCancel={cancelImport}
          onApply={applyImport}
        />
      )}
    </div>
  );
}
