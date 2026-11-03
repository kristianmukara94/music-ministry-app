import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Download, Save, Trash2, X } from 'lucide-react';
import { BUILT_IN_TEMPLATES } from '../../shared/mass-slots.js';
import { bridge } from '../live/bridge';
import { builtInItems } from './templates';
import type { PlannerT } from './strings';
import type { PlanItem, PlanTemplateSummary } from './types';

const api = bridge.plans;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const BTN = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-fg/20 bg-panel px-2.5 text-[11px] font-bold tracking-wide uppercase text-fg/85 transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40';

interface Props {
  t: PlannerT;
  lang: 'en' | 'tl' | 'ceb';
  /** The plan's items, saved by Save as a template and replaced by Load. */
  items: PlanItem[];
  /** Puts these items in the plan. `name` and `skipped` (items left out as gone from the library) are for the message. */
  onApply: (items: PlanItem[], name: string, skipped: number) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onClose: () => void;
}

/**
 * The templates panel, opened by the Templates button beside New plan. A template is a Holy Mass order to start from: the two that come with
 * the app (Standard Sunday, Weekday), and any plan the operator saves under a name (Sunday Solemn, a feast, a funeral Mass). Loading one
 * replaces the plan's items after asking, and leaves out any hymn that is no longer in the library rather than refusing the whole load.
 */
export function MassTemplates({ t, lang, items, onApply, onError, onNotice, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState<PlanTemplateSummary[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => api.listTemplates().then(setSaved).catch((err) => onError(errorText(err)));
  useEffect(() => void reload(), []);

  // A click outside closes the panel, and so does Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const confirmReplace = (title: string) => items.length === 0 || window.confirm(t('templateLoadConfirm', { name: title }));

  const loadBuiltIn = (id: string) => {
    const title = t(`template_${id}`);
    if (!confirmReplace(title)) return;
    onApply(builtInItems(id, lang), title, 0);
    onClose();
  };

  const loadSaved = async (template: PlanTemplateSummary) => {
    if (!confirmReplace(template.name)) return;
    setBusy(true);
    try {
      const full = await api.getTemplate(template.id);
      const kept = full.items.filter((item) => !item.stale);
      onApply(kept.map(({ stale: _stale, deleted: _deleted, ...item }) => item), full.name, full.items.length - kept.length);
      onClose();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (template: PlanTemplateSummary) => {
    if (!window.confirm(t('templateDeleteConfirm', { name: template.name }))) return;
    try {
      await api.deleteTemplate(template.id);
      await reload();
    } catch (err) {
      onError(errorText(err));
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const title = name.trim();
    if (!title || items.length === 0) return;
    setBusy(true);
    try {
      // Only what the template needs: where each item sits and what it is.
      await api.saveTemplate({ name: title, items: items.map(({ block, module, sourceId, label, slot }) => ({ block, module, sourceId, label, slot })) });
      setName('');
      onNotice(t('templateSaved', { name: title }));
      await reload();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={box} role="dialog" aria-label={t('templatesTitle')} className="absolute top-full right-0 z-40 mt-2 flex w-[min(28rem,92vw)] flex-col gap-3 rounded-xl border border-line-strong bg-panel p-4 shadow-2xl shadow-black/50">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold tracking-wide uppercase">{t('templatesTitle')}</h2>
          <p className="text-xs text-fg/60">{t('templatesIntro')}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t('templateClose')} title={t('templateClose')} className="grid size-7 shrink-0 place-items-center rounded-md border border-fg/15 text-muted hover:text-fg">
          <X size={13} aria-hidden />
        </button>
      </header>

      <section aria-label={t('templatesBuiltIn')} className="flex flex-col gap-1.5">
        <h3 className="text-[10px] font-bold tracking-wider text-muted uppercase">{t('templatesBuiltIn')}</h3>
        {BUILT_IN_TEMPLATES.map((tpl) => (
          <div key={tpl.id} className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{t(`template_${tpl.id}`)}</div>
              <div className="text-[11px] text-fg/60">{t(`template_${tpl.id}Hint`)}</div>
            </div>
            <button type="button" onClick={() => loadBuiltIn(tpl.id)} disabled={busy} className={BTN}>
              <Download size={13} aria-hidden />
              {t('templateLoad')}
            </button>
          </div>
        ))}
      </section>

      <section aria-label={t('templatesSaved')} className="flex flex-col gap-1.5">
        <h3 className="text-[10px] font-bold tracking-wider text-muted uppercase">{t('templatesSaved')}</h3>
        {saved.length === 0 && <p className="rounded-lg border border-dashed border-fg/20 px-3 py-3 text-xs text-fg/60">{t('templatesNone')}</p>}
        {saved.map((tpl) => (
          <div key={tpl.id} className="flex items-center gap-2 rounded-lg border border-line bg-panel-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{tpl.name}</div>
              <div className="text-[11px] text-fg/60 tabular-nums">{tpl.count}</div>
            </div>
            <button type="button" onClick={() => void loadSaved(tpl)} disabled={busy} className={BTN}>
              <Download size={13} aria-hidden />
              {t('templateLoad')}
            </button>
            <button type="button" onClick={() => void remove(tpl)} aria-label={t('templateDelete', { name: tpl.name })} title={t('templateDelete', { name: tpl.name })} className="grid size-8 shrink-0 place-items-center rounded-md border border-fg/15 text-muted hover:border-danger/60 hover:text-danger">
              <Trash2 size={13} aria-hidden />
            </button>
          </div>
        ))}
      </section>

      <form onSubmit={save} className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          placeholder={t('templateNamePlaceholder')}
          aria-label={t('templateName')}
          className="h-9 min-w-0 flex-1 rounded-md border border-fg/15 bg-panel-2 px-3 text-sm outline-none focus:border-accent"
        />
        <button type="submit" disabled={busy || !name.trim() || items.length === 0} title={t('templateSave')} className={BTN}>
          <Save size={13} aria-hidden />
          {t('templateSave')}
        </button>
      </form>
    </div>
  );
}
