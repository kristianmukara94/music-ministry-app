import { useEffect, useRef, useState } from 'react';
import { bridge } from '../live/bridge';
import { BLOCKS, type LiturgicalBlock, type LibraryItem, type PlanItem, type SourceModule } from '../planner/types';
import { appendToPlan } from '../planner/plan-api';
import { blockRows } from '../planner/logic';
import { loadLibrary } from '../planner/MassPlanner';
import { usePlannerT, type PlannerT } from '../planner/strings';
import { useUi } from '../state/ui';
import { useGoLiveT } from './strings';
import { previewFor, type PreviewSlides } from './preview';
import { PreviewPane } from './PreviewPane';

/** The search tabs the hub offers: songs, readings (with their responses) and Bible verses. */
const TABS: { id: SourceModule; key: 'tabSongs' | 'tabReadings' | 'tabBible' }[] = [
  { id: 'lyrics', key: 'tabSongs' },
  { id: 'lectionary', key: 'tabReadings' },
  { id: 'bible', key: 'tabBible' },
];

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const input = 'h-11 w-full rounded-xl border border-line-strong bg-canvas/40 px-3 text-sm text-fg outline-none focus:border-accent';

/**
 * The opened Mass plan in the Go Live hub: its items by block, and a search over the same sources the planner searches.
 * Adding a result goes through the plan's own save. Previews only read; going live is added in the next step.
 */
export function MassPlanHub({ planId, liturgicalDate }: { planId: number; liturgicalDate: string }) {
  const t = useGoLiveT();
  const plannerT: PlannerT = usePlannerT();
  const lang = useUi((s) => s.lang);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [tab, setTab] = useState<SourceModule>('lyrics');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LibraryItem[]>([]);
  // Where a search result lands: songs at the start, readings and verses in the Liturgy of the Word, by default.
  const [block, setBlock] = useState<LiturgicalBlock>('word');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The item being previewed. Only the latest request may fill the pane, so a slow load cannot replace a newer one.
  const [preview, setPreview] = useState<{ label: string; slides: PreviewSlides | null; error: string | null } | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const previewRequest = useRef(0);

  // The plan is read from the database each time it is opened, so the hub never shows an old order.
  useEffect(() => {
    bridge.plans
      .get(planId)
      .then((plan) => setItems(plan.items))
      .catch((err) => setError(errorText(err)));
  }, [planId]);

  /** Re-reads the plan after an insert, so the item list matches the database. */
  const reloadItems = () =>
    bridge.plans
      .get(planId)
      .then((plan) => setItems(plan.items))
      .catch((err) => setError(errorText(err)));

  /**
   * Adds a search result to the plan. appendToPlan saves the whole plan through the same server checks a drag-and-drop
   * move gets, so a result the planner would refuse is refused here too, and the error is shown.
   */
  const add = (row: LibraryItem) => {
    setError(null);
    setNotice(null);
    appendToPlan(planId, [{ block, module: row.module, sourceId: row.sourceId, label: row.label }])
      .then(() => {
        setNotice(t('added', { label: row.label }));
        return reloadItems();
      })
      .catch((err) => setError(errorText(err)));
  };

  /** Loads the slides of one item into the preview pane. Reads only; nothing is staged or sent to the projector. */
  const showPreview = (label: string, module: SourceModule, sourceId: string) => {
    const request = ++previewRequest.current;
    previewFor(module, sourceId, lang)
      .then((slides) => {
        if (request !== previewRequest.current) return;
        setPreview({ label, slides, error: null });
        setSlideIndex(0);
      })
      .catch((err) => {
        if (request !== previewRequest.current) return;
        setPreview({ label, slides: null, error: errorText(err) });
      });
  };

  // The same search the planner runs for each tab, debounced so typing does not send a request per key.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadLibrary(tab, query, liturgicalDate, lang, plannerT, 'WEB')
        .then((rows) => {
          setResults(rows);
          setError(null);
        })
        .catch((err) => setError(errorText(err)));
    }, 150);
    return () => window.clearTimeout(timer);
  }, [tab, query, liturgicalDate, lang]);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {error && (
        <p role="alert" className="rounded-xl border border-danger px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-ok">
          {notice}
        </p>
      )}

      <section aria-labelledby="golive-plan-items" className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4">
        <h2 id="golive-plan-items" className="eyebrow">
          {t('planItems')}
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted">{t('noItems')}</p>
        ) : (
          BLOCKS.map((block) => {
            const rows = blockRows(items, block.id);
            if (rows.length === 0) return null;
            return (
              <div key={block.id} className="flex flex-col gap-1">
                <p className="eyebrow !text-accent">{plannerT(block.titleKey)}</p>
                <ol className="flex flex-col gap-1">
                  {rows.map((row, i) => (
                    <li key={`${block.id}-${i}`} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{row.label}</span>
                      <span className="shrink-0 text-xs text-muted">{plannerT(`module_${row.module}`)}</span>
                      <button
                        type="button"
                        onClick={() => showPreview(row.label, row.module, row.sourceId)}
                        className="min-h-11 shrink-0 rounded-xl border border-line-strong px-4 text-sm font-semibold transition hover:bg-panel-2"
                      >
                        {t('previewButton')}
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })
        )}
      </section>

      {preview && (
        <>
          {preview.error && (
            <p role="alert" className="rounded-xl border border-danger px-4 py-3 text-sm text-danger">
              {t('previewError', { error: preview.error })}
            </p>
          )}
          {preview.slides && preview.slides.pages.length > 0 && (
            <PreviewPane
              label={preview.label}
              slides={preview.slides}
              index={Math.min(slideIndex, preview.slides.pages.length - 1)}
              onStep={(delta) =>
                setSlideIndex((i) => Math.min(Math.max(i + delta, 0), preview.slides!.pages.length - 1))
              }
            />
          )}
          {preview.slides && preview.slides.pages.length === 0 && <p className="text-sm text-muted">{t('noPreview')}</p>}
        </>
      )}

      <section aria-labelledby="golive-search" className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4">
        <h2 id="golive-search" className="eyebrow">
          {t('searchLabel')}
        </h2>
        <div role="tablist" className="flex flex-wrap gap-2">
          {TABS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={tab === x.id}
              onClick={() => setTab(x.id)}
              className={`min-h-11 rounded-xl border px-4 text-sm font-semibold transition ${
                tab === x.id ? 'border-accent bg-accent/15 text-accent' : 'border-line-strong hover:bg-panel-2'
              }`}
            >
              {t(x.key)}
            </button>
          ))}
        </div>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('searchLabel')} className={input} />
        <label className="flex flex-col gap-1">
          <span className="eyebrow">{t('blockLabel')}</span>
          <select value={block} onChange={(e) => setBlock(e.target.value as LiturgicalBlock)} className={input}>
            {BLOCKS.map((b) => (
              <option key={b.id} value={b.id}>
                {plannerT(b.titleKey)}
              </option>
            ))}
          </select>
        </label>
        {results.length === 0 ? (
          <p className="text-sm text-muted">{t('noResults')}</p>
        ) : (
          <ul className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
            {results.map((row) => (
              <li key={`${row.module}-${row.sourceId}`} className="flex min-w-0 items-center gap-3 rounded-lg px-3 py-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{row.label}</span>
                  <span className="truncate text-xs text-muted">{row.sub}</span>
                </span>
                <button
                  type="button"
                  onClick={() => showPreview(row.label, row.module, row.sourceId)}
                  className="min-h-11 shrink-0 rounded-xl border border-line-strong px-4 text-sm font-semibold transition hover:bg-panel-2"
                >
                  {t('previewButton')}
                </button>
                <button type="button" onClick={() => add(row)} className="min-h-11 shrink-0 rounded-xl border border-line-strong px-4 text-sm font-semibold transition hover:border-accent hover:bg-panel-2">
                  {t('addToPlan')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
