import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, FileDown, FileUp, Loader2, RotateCcw, Save, Scissors } from 'lucide-react';
import type { RosaryKey } from '../../shared/rosary-i18n.js';
import { rosaryT } from '../../shared/rosary-i18n.js';
import { bridge } from '../live/bridge';
import { notifyRosaryChanged } from '../rosary/refresh';
import { MYSTERY_TYPES, type Mystery, type MysteryInput, type MysteryType, type PrayerInput, type RosaryPrayer } from '../rosary/types';
import { CHUNK_MAX_CHARS, loadChunkOptions, MAX_LINES_CHOICES, saveChunkOptions, splitPrayerText, type ChunkOptions } from '../rosary/rosaryUtils';

const api = bridge.rosary;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Lang = 'en' | 'tl' | 'ceb';
const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'tl', label: 'Tagalog' },
  { code: 'ceb', label: 'Cebuano' },
];

const PRAYER_LABELS: Record<string, RosaryKey> = {
  creed: 'prayer_creed',
  our_father: 'prayer_our_father',
  hail_mary: 'prayer_hail_mary',
  glory_be: 'prayer_glory_be',
  fatima: 'prayer_fatima',
  hail_holy_queen: 'prayer_hail_holy_queen',
  litany_loreto: 'prayer_litany_loreto',
};
const PRAYER_KEYS = Object.keys(PRAYER_LABELS);

/** One entry in the editor's list. Mysteries are identified by set and decade, prayers by key. */
interface Item {
  id: string;
  group: string;
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
const primary = `flex h-10 items-center gap-2 rounded-md bg-accent px-5 text-xs font-extrabold whitespace-nowrap text-on-accent uppercase shadow-md shadow-black/30 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none ${FOCUS}`;
const input = `rounded-md border border-fg/15 bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent ${FOCUS}`;
// Prayer and meditation text. Extra padding and a minimum height keep the first line clear of the top border.
const textarea = `w-full resize-y rounded-lg border border-fg/15 bg-panel-2 p-3 text-sm leading-relaxed text-fg outline-none focus:border-accent ${FOCUS}`;
const label = 'mb-2 block text-xs font-semibold uppercase tracking-wider text-fg/70';

const enLabel = (key: RosaryKey) => rosaryT('en', key);

function buildItems(): Item[] {
  const mysteries = MYSTERY_TYPES.flatMap((type) =>
    [1, 2, 3, 4, 5].map((decade) => ({
      id: `m:${type}:${decade}`,
      group: enLabel(`set_${type}` as RosaryKey),
      label: `${enLabel(`set_${type}` as RosaryKey)} · ${rosaryT('en', 'decade', { n: decade })}`,
      mysteryType: type,
      decade,
    })),
  );
  const prayers = PRAYER_KEYS.map((key) => ({
    id: `p:${key}`,
    group: 'Prayers',
    label: enLabel(PRAYER_LABELS[key]),
    prayerKey: key,
  }));
  return [...mysteries, ...prayers];
}

const ITEMS = buildItems();
const GROUPS = [...new Set(ITEMS.map((i) => i.group))];

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

/** The slide-splitting bar under a prayer's text: the line limit, the auto-split switch, and a preview of the slides. */
function SlideSplitBar({
  text,
  options,
  onChange,
  previewOpen,
  onTogglePreview,
}: {
  text: string;
  options: ChunkOptions;
  onChange: (next: ChunkOptions) => void;
  previewOpen: boolean;
  onTogglePreview: () => void;
}) {
  const slides = splitPrayerText(text, options);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <p className="text-xs font-semibold tracking-wider text-fg/70 uppercase">Slide chunking &amp; splitting</p>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-fg/70">Max lines per slide</span>
          <select
            value={options.maxLines ?? 'auto'}
            disabled={!options.autoSplit}
            onChange={(e) => onChange({ ...options, maxLines: e.target.value === 'auto' ? null : Number(e.target.value) })}
            className={`${input} h-10 disabled:opacity-40`}
          >
            {MAX_LINES_CHOICES.map((n) => (
              <option key={n ?? 'auto'} value={n ?? 'auto'}>
                {n ?? 'Auto'}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input
            type="checkbox"
            role="switch"
            checked={options.autoSplit}
            onChange={(e) => onChange({ ...options, autoSplit: e.target.checked })}
            className="size-4 accent-accent"
          />
          Auto-split long text
        </label>
        <button
          type="button"
          onClick={onTogglePreview}
          aria-expanded={previewOpen}
          className={`flex h-10 items-center rounded-md border border-accent/40 bg-accent/20 px-4 text-xs font-bold uppercase text-accent hover:bg-accent/30 ${FOCUS}`}
        >
          {previewOpen ? 'Hide' : 'Show'} slide preview ({slides.length})
        </button>
      </div>
      <p className="text-xs text-muted">
        Explicit breaks always apply: a blank line, a line of <code>---</code>, or <code>[SLIDE]</code>. Auto-split also keeps each slide to
        the line limit and to {CHUNK_MAX_CHARS} characters, breaking at the nearest full stop, semicolon or exclamation mark.
      </p>
      {previewOpen && (
        <ol className="flex flex-col gap-2">
          {slides.length === 0 ? (
            <li className="text-sm text-muted">There is no text to split.</li>
          ) : (
            slides.map((s) => (
              <li key={s.partIndex} className="rounded-md border border-line bg-canvas p-3">
                <p className="mb-1 text-xs font-bold tabular-nums text-accent">
                  Slide {s.partIndex}/{s.totalParts}
                </p>
                <p className="text-sm whitespace-pre-line">{s.text}</p>
              </li>
            ))
          )}
        </ol>
      )}
    </div>
  );
}

/** Whether every field of a language has text. An empty language cannot be approved in any useful sense. */
const languageFilled = (draft: Draft, item: Item, lang: Lang) => fieldsFor(item).every((f) => (draft.values[`${f.name}_${lang}`] ?? '').trim() !== '');

export function RosarySettings() {
  const [mysteries, setMysteries] = useState<Mystery[]>([]);
  const [prayers, setPrayers] = useState<RosaryPrayer[]>([]);
  const [selectedId, setSelectedId] = useState(ITEMS[0].id);
  const [lang, setLang] = useState<Lang>('en');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backupNote, setBackupNote] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  // How prayers are split into slides, and which language's slide preview is open. Shared with the deck through storage.
  const [chunks, setChunks] = useState<ChunkOptions>(loadChunkOptions);
  const [previewLang, setPreviewLang] = useState<Lang | null>(null);
  // The prayer text boxes, so a slide break can be inserted at the cursor.
  const textareas = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const tabRefs = useRef<Record<Lang, HTMLButtonElement | null>>({ en: null, tl: null, ceb: null });

  const itemIndex = Math.max(0, ITEMS.findIndex((i) => i.id === selectedId));
  const item = ITEMS[itemIndex];

  /** The saved row, as a draft. The editor's text is "unsaved" exactly when it differs from this. */
  const saved = useMemo<Draft | null>(() => {
    if (item.prayerKey) {
      const row = prayers.find((p) => p.key === item.prayerKey);
      return row ? draftFromPrayer(row) : null;
    }
    const row = mysteries.find((m) => m.mysteryType === item.mysteryType && m.decadeNumber === item.decade);
    return row ? draftFromMystery(row) : null;
  }, [item, mysteries, prayers]);

  const dirty = draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved);

  /** Saves a change to the split settings. The rosary deck reloads, so its staged slide follows the new split. */
  const changeChunks = (next: ChunkOptions) => {
    setChunks(next);
    saveChunkOptions(next);
    notifyRosaryChanged();
  };

  const load = async () => {
    const [m, p] = await Promise.all([api.getMysteries(), api.getPrayers()]);
    setMysteries(m);
    setPrayers(p);
  };

  useEffect(() => {
    load().catch((err) => setError(errorText(err)));
  }, []);

  // Each time the selection changes, or the data is reloaded after a save or import, the draft starts from the saved row.
  useEffect(() => {
    setDraft(saved);
  }, [saved]);

  /** Asks before throwing away unsaved text. */
  const confirmDiscard = () => !dirty || window.confirm('You have unsaved changes to this item. Discard them?');

  const selectItem = (id: string) => {
    if (id === selectedId || !confirmDiscard()) return;
    setStatus(null);
    setError(null);
    setPreviewLang(null);
    setSelectedId(id);
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

  /** Runs a task with the busy state. Its result or failure is reported where the action is: in the backup card, or in the editor's bar. */
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

  const save = () => {
    if (!draft || !dirty) return;
    void run(async () => {
      const v = draft.values;
      const a = draft.approved;
      if (item.prayerKey) {
        const input: PrayerInput = {
          key: item.prayerKey,
          text_en: v.text_en,
          text_tl: v.text_tl,
          text_ceb: v.text_ceb,
          approved_en: a.en ? 1 : 0,
          approved_tl: a.tl ? 1 : 0,
          approved_ceb: a.ceb ? 1 : 0,
        };
        await api.savePrayer(input);
      } else {
        const input: MysteryInput = {
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
        await api.saveMystery(input);
      }
      notifyRosaryChanged();
      await load();
      setStatus('Saved. The rosary deck now uses this text.');
    });
  };

  // Ctrl+S or Cmd+S saves, wherever the cursor is on this page.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const exportBackup = () =>
    run(async () => {
      const result = await api.exportJSON();
      if (result) setBackupNote(`Backup saved to ${result.path} (${result.mysteries} mysteries, ${result.prayers} prayers).`);
    }, 'backup');

  const importBackup = () => {
    const warning = dirty
      ? 'Importing replaces the text of every mystery and prayer in the backup file, and discards your unsaved changes to this item. Continue?'
      : 'Importing replaces the text of every mystery and prayer in the backup file. Continue?';
    if (!window.confirm(warning)) return;
    void run(async () => {
      const result = await api.importJSON();
      if (!result) return;
      notifyRosaryChanged();
      await load();
      setBackupNote(`Imported ${result.mysteries} mysteries and ${result.prayers} prayers from ${result.path}.`);
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

  const approvedCount = draft ? LANGS.filter((l) => draft.approved[l.code]).length : 0;

  return (
    <div className="w-full max-w-4xl space-y-6">
      <section className="rounded-xl border border-line bg-panel p-5" aria-labelledby="rosary-backup-heading">
        <h2 id="rosary-backup-heading" className="mb-4 border-b border-line pb-2 text-xl font-bold tracking-tight">Rosary backup</h2>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Export saves every mystery and prayer, in English, Tagalog and Cebuano, with its approval status, to a JSON file. Import
            restores them from that file. A file with any invalid row changes nothing.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={exportBackup} disabled={busy} className={button}>
              <FileDown size={15} aria-hidden /> Export JSON
            </button>
            <button type="button" onClick={importBackup} disabled={busy} className={button}>
              <FileUp size={15} aria-hidden /> Import JSON
            </button>
            {busy && <Loader2 size={18} className="animate-spin text-accent" aria-label="Working" />}
          </div>
          {backupNote && (
            <p role="status" className="flex items-start gap-2 text-sm break-all text-ok">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden /> {backupNote}
            </p>
          )}
          {backupError && <p role="alert" className="text-sm whitespace-pre-line text-danger">{backupError}</p>}
        </div>
      </section>

      <section className="rounded-xl border border-line bg-panel p-5" aria-labelledby="rosary-text-heading">
        <h2 id="rosary-text-heading" className="mb-4 border-b border-line pb-2 text-xl font-bold tracking-tight">Rosary text</h2>

        <div className="flex flex-col gap-5">
          {/* Which item: a list, and Previous and Next for working down it in order. */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-2 sm:max-w-md">
              <span className="eyebrow">Item</span>
              <select value={selectedId} onChange={(e) => selectItem(e.target.value)} className={`${input} h-11`}>
                {GROUPS.map((group) => (
                  <optgroup key={group} label={group}>
                    {ITEMS.filter((i) => i.group === group).map((i) => (
                      <option key={i.id} value={i.id}>{i.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => step(-1)} disabled={itemIndex === 0} aria-label="Previous item" title="Previous item" className={`${button} size-11 justify-center px-0`}>
                <ChevronLeft size={18} aria-hidden />
              </button>
              <button type="button" onClick={() => step(1)} disabled={itemIndex === ITEMS.length - 1} aria-label="Next item" title="Next item" className={`${button} size-11 justify-center px-0`}>
                <ChevronRight size={18} aria-hidden />
              </button>
              <span className="text-xs text-muted tabular-nums">{itemIndex + 1} of {ITEMS.length}</span>
            </div>
          </div>

          {!draft ? (
            error ? (
              <p role="alert" className="text-sm whitespace-pre-line text-danger">The rosary text could not be loaded. {error}</p>
            ) : (
              <p className="text-sm text-muted">Loading the rosary text…</p>
            )
          ) : (
            <>
              {/* One language at a time. Each tab says whether that language is approved. */}
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-fg">{item.label}</h3>
                  <span className="text-xs text-muted">{approvedCount} of {LANGS.length} languages approved</span>
                </div>
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
                        className={`flex min-w-[8rem] flex-1 items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${FOCUS} ${
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
              </div>

              <div role="tabpanel" id="rosary-panel" aria-labelledby={`rosary-tab-${lang}`} className="flex flex-col gap-4 rounded-lg border border-line p-4">
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
                      {item.prayerKey && field.multiline && (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => insertBreak(lang, column)}
                            className={`flex h-8 items-center gap-1.5 rounded-md border border-fg/15 px-3 text-xs font-bold uppercase hover:bg-fg/10 ${FOCUS}`}
                          >
                            <Scissors size={13} aria-hidden /> Insert slide break (---)
                          </button>
                        </div>
                      )}
                      <div className="flex flex-col">
                        <label htmlFor={common.id} className={label}>{field.label}</label>
                        {field.multiline ? (
                          <textarea
                            {...common}
                            ref={(el) => {
                              textareas.current[common.id] = el;
                            }}
                            rows={item.prayerKey ? 10 : 6}
                            className={textarea}
                          />
                        ) : (
                          <input {...common} className={`${input} h-10`} />
                        )}
                        {field.multiline && <span className="mt-1 self-end text-[11px] text-fg/50 tabular-nums">{value.length} characters</span>}
                      </div>
                      {item.prayerKey && field.multiline && (
                        <SlideSplitBar
                          text={value}
                          options={chunks}
                          onChange={changeChunks}
                          previewOpen={previewLang === lang}
                          onTogglePreview={() => setPreviewLang((p) => (p === lang ? null : lang))}
                        />
                      )}
                    </div>
                  );
                })}

                {/* Approval: its own block, with what it means and what clears it. */}
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${
                    draft.approved[lang] ? 'border-ok/40 bg-ok/10' : 'border-line bg-canvas'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={draft.approved[lang]}
                    onChange={(e) => toggleApproval(lang, e.target.checked)}
                    className="mt-0.5 size-4 accent-accent"
                  />
                  <span className="flex flex-col">
                    <span className="text-sm font-semibold text-fg">Approved by the parish</span>
                    <span className="text-xs text-muted">
                      Tick this once the {LANGS.find((l) => l.code === lang)?.label} text has been checked. Editing the text clears it, so a changed text is never shown as approved.
                    </span>
                  </span>
                </label>
              </div>

              {!item.prayerKey && (
                <label className="flex max-w-md flex-col">
                  <span className={label}>Scripture reference (all languages)</span>
                  <input
                    value={draft.values.scripture_ref ?? ''}
                    onChange={(e) => {
                      setStatus(null);
                      setDraft((d) => (d ? { ...d, values: { ...d.values, scripture_ref: e.target.value } } : d));
                    }}
                    className={`${input} h-10`}
                  />
                </label>
              )}

              {/* Stays on screen while the text is long: what changed, and the actions. */}
              <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel/95 p-3 shadow-lg shadow-black/20 backdrop-blur">
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
                    <p className="text-muted">All changes saved. The deck shows the saved text whether or not it is approved.</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setDraft(saved)} disabled={!dirty || busy} className={button}>
                    <RotateCcw size={14} aria-hidden /> Discard
                  </button>
                  <button type="button" onClick={save} disabled={!dirty || busy} className={primary} title="Save (Ctrl+S)">
                    {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Save size={15} aria-hidden />} Save
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
