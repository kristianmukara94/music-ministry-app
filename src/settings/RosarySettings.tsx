import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { FileDown, FileUp, Loader2, Save } from 'lucide-react';
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

const button =
  'flex h-10 items-center gap-2 rounded-md border border-fg/15 px-4 text-xs font-bold uppercase hover:bg-fg/10 disabled:opacity-40';
const input = 'rounded-md border border-fg/15 bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent';
// Prayer and meditation text. Extra padding and a minimum height keep the first line clear of the top border.
const textarea =
  'w-full min-h-[120px] resize-y rounded-lg border border-fg/15 bg-panel-2 p-3 text-sm leading-relaxed text-fg outline-none focus:border-accent';
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
            className={`${input} h-10`}
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
          className="flex h-10 items-center rounded-md border border-accent/40 bg-accent/20 px-4 text-xs font-bold uppercase text-accent hover:bg-accent/30"
        >
          Auto-split preview
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

export function RosarySettings() {
  const [mysteries, setMysteries] = useState<Mystery[]>([]);
  const [prayers, setPrayers] = useState<RosaryPrayer[]>([]);
  const [selectedId, setSelectedId] = useState(ITEMS[0].id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // How prayers are split into slides, and which language's slide preview is open. Shared with the deck through storage.
  const [chunks, setChunks] = useState<ChunkOptions>(loadChunkOptions);
  const [previewLang, setPreviewLang] = useState<Lang | null>(null);
  // The prayer text boxes, so a slide break can be inserted at the cursor.
  const textareas = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const item = ITEMS.find((i) => i.id === selectedId) ?? ITEMS[0];

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
    if (item.prayerKey) {
      const row = prayers.find((p) => p.key === item.prayerKey);
      setDraft(row ? draftFromPrayer(row) : null);
    } else {
      const row = mysteries.find((m) => m.mysteryType === item.mysteryType && m.decadeNumber === item.decade);
      setDraft(row ? draftFromMystery(row) : null);
    }
  }, [selectedId, mysteries, prayers]);

  /** Editing a language means it needs approving again, so its approval is cleared as soon as the text changes. */
  const edit = (column: string, lang: Lang, value: string) => {
    setDraft((d) => (d ? { values: { ...d.values, [column]: value }, approved: { ...d.approved, [lang]: false } } : d));
  };

  const toggleApproval = (lang: Lang, on: boolean) => {
    setDraft((d) => (d ? { ...d, approved: { ...d.approved, [lang]: on } } : d));
  };

  /** Inserts a slide break (`---`) at the cursor in a prayer's text box, and puts the cursor after it. */
  const insertBreak = (lang: Lang, column: string) => {
    const el = textareas.current[`${item.id}-${column}`];
    const value = draft?.values[column] ?? '';
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const insert = '\n---\n';
    edit(column, lang, value.slice(0, start) + insert + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + insert.length, start + insert.length);
    });
  };

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await task();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!draft) return;
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

  const exportBackup = () =>
    run(async () => {
      const result = await api.exportJSON();
      if (result) setStatus(`Backup saved to ${result.path} (${result.mysteries} mysteries, ${result.prayers} prayers).`);
    });

  const importBackup = () => {
    if (!window.confirm('Importing replaces the text of every mystery and prayer in the backup file. Continue?')) return;
    void run(async () => {
      const result = await api.importJSON();
      if (!result) return;
      notifyRosaryChanged();
      await load();
      setStatus(`Imported ${result.mysteries} mysteries and ${result.prayers} prayers from ${result.path}.`);
    });
  };

  return (
    <div className="w-full max-w-4xl space-y-6">
      <section className="rounded-xl border border-line bg-panel p-5">
        <h2 className="mb-4 border-b border-line pb-2 text-xl font-bold tracking-tight">Rosary backup</h2>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Export saves every mystery and prayer, in English, Tagalog and Cebuano, with its approval status, to a JSON file. Import
            restores them from that file. A file with any invalid row changes nothing.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={exportBackup} disabled={busy} className={button}>
              <FileDown size={15} aria-hidden /> Export JSON
            </button>
            <button type="button" onClick={importBackup} disabled={busy} className={button}>
              <FileUp size={15} aria-hidden /> Import JSON
            </button>
            {busy && <Loader2 size={18} className="animate-spin self-center text-accent" aria-label="Working" />}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-line bg-panel p-5">
        <h2 className="mb-4 border-b border-line pb-2 text-xl font-bold tracking-tight">Rosary text</h2>

        <div className="flex flex-col gap-5">
          <label className="flex max-w-md flex-col gap-2">
            <span className="eyebrow">Item</span>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className={`${input} h-11`}>
              {GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {ITEMS.filter((i) => i.group === group).map((i) => (
                    <option key={i.id} value={i.id}>{i.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {!draft ? (
            <p className="text-sm text-muted">No rosary text is loaded yet.</p>
          ) : (
            <>
              {LANGS.map((lang) => (
                <fieldset key={lang.code} className="flex flex-col gap-3 rounded-lg border border-line p-4">
                  <legend className={`px-1 ${label}`}>{lang.label}</legend>
                  {fieldsFor(item).map((field) => {
                    const column = `${field.name}_${lang.code}`;
                    const common = {
                      id: `${item.id}-${column}`,
                      value: draft.values[column] ?? '',
                      onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => edit(column, lang.code, e.target.value),
                    };
                    return (
                      <div key={column} className="flex flex-col gap-3">
                        {item.prayerKey && field.multiline && (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => insertBreak(lang.code, column)}
                              className="flex h-8 items-center rounded-md border border-fg/15 px-3 text-xs font-bold uppercase hover:bg-fg/10"
                            >
                              Insert slide break (---)
                            </button>
                          </div>
                        )}
                        <label htmlFor={common.id} className="flex flex-col">
                          <span className={label}>{field.label}</span>
                          {field.multiline ? (
                            <textarea
                              {...common}
                              ref={(el) => {
                                textareas.current[common.id] = el;
                              }}
                              rows={4}
                              className={textarea}
                            />
                          ) : (
                            <input {...common} className={`${input} h-10`} />
                          )}
                        </label>
                        {item.prayerKey && field.multiline && (
                          <SlideSplitBar
                            text={draft.values[column] ?? ''}
                            options={chunks}
                            onChange={changeChunks}
                            previewOpen={previewLang === lang.code}
                            onTogglePreview={() => setPreviewLang((p) => (p === lang.code ? null : lang.code))}
                          />
                        )}
                      </div>
                    );
                  })}
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.approved[lang.code]}
                      onChange={(e) => toggleApproval(lang.code, e.target.checked)}
                      className="size-4 accent-accent"
                    />
                    Approved by the parish
                  </label>
                </fieldset>
              ))}

              {!item.prayerKey && (
                <label className="flex max-w-md flex-col">
                  <span className={label}>Scripture reference (all languages)</span>
                  <input
                    value={draft.values.scripture_ref ?? ''}
                    onChange={(e) => setDraft((d) => (d ? { ...d, values: { ...d.values, scripture_ref: e.target.value } } : d))}
                    className={`${input} h-10`}
                  />
                </label>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={save} disabled={busy} className={`${button} bg-accent text-on-accent`}>
                  <Save size={15} aria-hidden /> Save
                </button>
                <p className="text-xs text-muted">
                  Changing a language clears its approval. The deck shows the saved text whether or not it is approved.
                </p>
              </div>
            </>
          )}

          {status && <p role="status" className="text-sm text-accent">{status}</p>}
          {error && <p role="alert" className="text-sm whitespace-pre-line text-danger">{error}</p>}
        </div>
      </section>
    </div>
  );
}
