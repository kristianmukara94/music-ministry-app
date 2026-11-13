import { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Trash2, X } from 'lucide-react';
import { MASS_ORDER_LANGS, MASS_ORDER_TEMPLATES, checkMassOrderText, entryForSave, isCustomId, isCustomized, massOrderLang, slidesToText, type MassOrderEntry, type MassOrderLang } from '../../shared/mass-order-text.js';
import { splitDeck } from '../../shared/projector-autofit.js';
import type { Lang } from '../../shared/live.js';
import { findMassPart, standardName, standardSlides } from './massOrder';
import { createMassOrderItem, deleteMassOrderItem, resetMassOrderText, saveMassOrderEntries, useMassOrderTexts } from './massOrderStore';
import type { PlannerT } from '../planner/strings';
import { errorText } from '../whiteboard/errors';

type Draft = { text: string; title: string };
type Drafts = Record<MassOrderLang, Draft>;

/**
 * Edits the title and words of one Holy Mass Order part, in English, Tagalog and Cebuano, or makes a new parish item when `partId` is null. The
 * words are plain text: a blank line starts a new slide, and a line starting "P:" is the priest's part. Everything is saved in the database (see
 * electron/mass-order.js) and used at once by the library, the planner's chips and cards, and every slide staged afterwards. A built-in part
 * can be reset to the standard Missal text and name, language by language; a parish item can be deleted.
 */
export function HolyMassOrderEditor({ partId, lang, t, onClose, onNotice }: { partId: string | null; lang: Lang; t: PlannerT; onClose: () => void; onNotice: (message: string) => void }) {
  const creating = partId === null;
  const part = partId ? findMassPart(partId) : undefined;
  const custom = creating || isCustomId(partId);
  const overrides = useMassOrderTexts((s) => s.overrides);
  const [tab, setTab] = useState<MassOrderLang>(massOrderLang(lang));

  // What each language starts from: the saved words and title, or the standard ones (a parish item has none).
  const standard = (l: MassOrderLang): Draft =>
    part && !custom ? { text: slidesToText(standardSlides(part, l)), title: standardName(part, l) } : { text: '', title: '' };
  const savedDraft = (l: MassOrderLang): Draft => {
    const entry = partId ? overrides[partId]?.[l] : undefined;
    const base = standard(l);
    return { text: entry?.text ?? base.text, title: entry?.title ?? base.title };
  };
  const [initial] = useState<Drafts>(() => Object.fromEntries(MASS_ORDER_LANGS.map((l) => [l, savedDraft(l)])) as Drafts);
  const [drafts, setDrafts] = useState<Drafts>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A new item can start from a template (the Nicene Creed). Filling one says to proofread it.
  const [template, setTemplate] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, [tab]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [busy, onClose]);

  const draft = drafts[tab];
  const setDraft = (patch: Partial<Draft>) => setDrafts((d) => ({ ...d, [tab]: { ...d[tab], ...patch } }));
  const dirty = (l: MassOrderLang) => drafts[l].text.trim() !== initial[l].text.trim() || drafts[l].title.trim() !== initial[l].title.trim();
  const anyDirty = MASS_ORDER_LANGS.some(dirty);

  // Every language with words must make slides; a parish item needs a title and words in at least one language.
  const problems = useMemo(() => {
    const out: string[] = [];
    for (const l of MASS_ORDER_LANGS) {
      const words = drafts[l].text.trim();
      if (!words) continue;
      const checked = checkMassOrderText(words);
      if (!checked.ok) out.push(`${t(`moLang_${l}`)}: ${checked.error}`);
    }
    if (custom && !MASS_ORDER_LANGS.some((l) => drafts[l].title.trim())) out.push(t('moNeedsTitle'));
    if (custom && !MASS_ORDER_LANGS.some((l) => drafts[l].text.trim())) out.push(t('moNeedsWords'));
    return out;
  }, [drafts, custom, t]);

  const checked = draft.text.trim() ? checkMassOrderText(draft.text) : null;
  const shownTitle = draft.title.trim() || t('moUntitled');
  const projected = checked?.ok ? splitDeck(shownTitle, checked.slides) : null;
  const heading = creating ? t('moNewTitle') : (drafts[massOrderLang(lang)].title.trim() || initial[massOrderLang(lang)].title || shownTitle);

  if (!creating && !part) return null;

  const entriesToSave = (): Partial<Record<MassOrderLang, MassOrderEntry>> => {
    const out: Partial<Record<MassOrderLang, MassOrderEntry>> = {};
    for (const l of MASS_ORDER_LANGS) {
      if (custom) {
        // A parish item keeps exactly what was typed in each language; an empty language reads another (see effectiveSlides).
        out[l] = { text: drafts[l].text.trim() || null, title: drafts[l].title.trim() || null };
      } else if (dirty(l)) {
        const base = standard(l);
        out[l] = entryForSave(drafts[l], { standardText: base.text, standardTitle: base.title });
      }
    }
    return out;
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (problems.length > 0) return setError(problems[0]);
    return run(async () => {
      if (creating) {
        await createMassOrderItem(entriesToSave());
        onNotice(t('moCreated', { part: shownTitle }));
      } else {
        await saveMassOrderEntries(partId!, entriesToSave());
        onNotice(t('moSaved'));
      }
      onClose();
    });
  };

  // A built-in part goes back to the standard text and name in this language. Unsaved changes simply go; saved ones are removed after a confirmation.
  const reset = () => {
    if (!isCustomized(partId!, tab, overrides)) {
      setDrafts((d) => ({ ...d, [tab]: standard(tab) }));
      return;
    }
    if (!window.confirm(t('moResetConfirm', { part: standardName(part!, tab) }))) return;
    return run(async () => {
      await resetMassOrderText(partId!, tab);
      setDrafts((d) => ({ ...d, [tab]: standard(tab) }));
      onNotice(t('moResetDone'));
    });
  };

  const remove = () => {
    if (!window.confirm(t('moDeleteConfirm', { part: heading }))) return;
    return run(async () => {
      await deleteMassOrderItem(partId!);
      onNotice(t('moDeleted', { part: heading }));
      onClose();
    });
  };

  const applyTemplate = (id: string) => {
    setTemplate(id);
    const chosen = MASS_ORDER_TEMPLATES.find((x) => x.id === id);
    if (!chosen) return;
    setDrafts((d) => {
      const next = { ...d };
      for (const l of MASS_ORDER_LANGS) {
        const entry = chosen.entries[l];
        if (entry) next[l] = { text: entry.text, title: entry.title };
      }
      return next;
    });
  };

  const tabStandard = standard(tab);
  const atStandard = !custom && draft.text.trim() === tabStandard.text.trim() && draft.title.trim() === tabStandard.title.trim();

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 backdrop-blur-sm p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="mass-order-editor-title" className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl shadow-black/50">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-wider text-accent uppercase">{t('moEditorTitle')}</p>
            <h2 id="mass-order-editor-title" className="truncate text-lg font-bold text-fg">{heading}</h2>
            <p className="mt-0.5 text-xs text-muted">{custom ? t('moParishItem') : isCustomized(partId!, tab, overrides) ? t('moParish') : t('moStandard')}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t('cancel')} className="grid size-8 place-items-center rounded-md text-muted hover:bg-fg/10 hover:text-fg">
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
          {creating && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-bold tracking-wider text-fg/70 uppercase">{t('moTemplate')}</span>
              <select
                value={template}
                onChange={(e) => applyTemplate(e.target.value)}
                disabled={busy}
                className="h-10 rounded-md border border-fg/15 bg-panel-2 px-2 text-sm text-fg outline-none focus:border-accent"
              >
                <option value="">{t('moTemplateNone')}</option>
                {MASS_ORDER_TEMPLATES.map((x) => (
                  <option key={x.id} value={x.id}>{x.label}</option>
                ))}
              </select>
              {template && <span role="status" className="text-xs text-accent">{t('moTemplateNote')}</span>}
            </label>
          )}
          <div role="tablist" aria-label={t('moEditorTitle')} className="flex flex-wrap gap-1.5">
            {MASS_ORDER_LANGS.map((l) => (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={tab === l}
                onClick={() => setTab(l)}
                disabled={busy}
                className={`h-8 rounded-md border px-3 text-xs font-semibold ${tab === l ? 'border-accent bg-accent/15 text-accent' : 'border-fg/15 text-fg/75 hover:text-fg'}`}
              >
                {t(`moLang_${l}`)}
                {dirty(l) ? <span className="ml-1.5 text-accent" aria-label={t('moUnsaved')}>•</span> : !custom && partId && isCustomized(partId, l, overrides) && <span className="ml-1.5 rounded bg-accent/20 px-1 text-[10px] text-accent">{t('moCustomized')}</span>}
              </button>
            ))}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold tracking-wider text-fg/70 uppercase">{t('moTitleLabel', { lang: t(`moLang_${tab}`) })}</span>
            <input
              ref={titleRef}
              value={draft.title}
              onChange={(e) => setDraft({ title: e.target.value })}
              disabled={busy}
              maxLength={120}
              placeholder={custom ? t('moTitlePlaceholder') : tabStandard.title}
              className="h-10 rounded-md border border-fg/15 bg-panel-2 px-3 text-sm font-semibold text-fg outline-none focus:border-accent"
            />
          </label>

          <p id="mass-order-editor-help" className="text-xs text-fg/70">{t('moHelp')}</p>
          <textarea
            value={draft.text}
            onChange={(e) => setDraft({ text: e.target.value })}
            aria-describedby="mass-order-editor-help"
            aria-label={t('moWordsLabel', { lang: t(`moLang_${tab}`) })}
            spellCheck
            disabled={busy}
            className="min-h-[16rem] w-full resize-y rounded-lg border border-fg/15 bg-panel-2 p-3 font-mono text-sm leading-relaxed text-fg outline-none focus:border-accent"
          />
          <p className="text-xs text-muted" aria-live="polite">
            {projected ? t('moSlides', { n: projected.slides.length }) : custom && !draft.text.trim() ? t('moEmptyLang') : null}
            {projected?.labels ? ` · ${t('moSplitNote', { part: shownTitle })}` : null}
          </p>
          {(error || problems.length > 0) && (
            <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error ?? problems[0]}
            </p>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
          {custom ? (
            !creating && (
              <button type="button" onClick={() => void remove()} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-danger/40 px-3 text-xs font-semibold text-danger hover:bg-danger/10 disabled:opacity-40">
                <Trash2 size={13} aria-hidden /> {t('moDelete')}
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => void reset()}
              disabled={busy || (atStandard && !isCustomized(partId!, tab, overrides))}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-fg/15 px-3 text-xs font-semibold text-fg/80 hover:text-fg disabled:opacity-40"
            >
              <RotateCcw size={13} aria-hidden /> {t('moReset')}
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="h-9 rounded-md border border-fg/15 px-3 text-xs font-semibold text-fg/80 hover:text-fg">
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || problems.length > 0 || (!creating && !anyDirty)}
              className="h-9 rounded-md bg-accent px-4 text-xs font-bold tracking-wide text-on-accent uppercase disabled:opacity-40"
            >
              {creating ? t('moCreate') : t('moSave')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
