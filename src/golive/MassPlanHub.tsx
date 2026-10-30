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
// The same surfaces as the dashboard: cards on the panel colour, hairline borders, dark ghost buttons, an accent focus ring.
const CARD = 'rounded-[10px] border border-line bg-panel';
const LABEL = 'text-[11px] font-semibold tracking-wider text-fg/60 uppercase';
const input = 'h-10 rounded-lg border border-fg/15 bg-panel-2 px-3 text-sm text-fg outline-none placeholder:text-fg/40 focus:border-accent focus:ring-1 focus:ring-accent/40';
const SMALL_BTN =
  'h-9 shrink-0 rounded-md border border-fg/15 bg-panel-2 px-3 text-xs font-semibold text-fg/85 transition hover:bg-fg/10 hover:text-fg';

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
  const previewRef = useRef<HTMLDivElement>(null);

  // A new preview scrolls into view, so pressing Preview in a long plan never seems to do nothing.
  useEffect(() => {
    if (preview) previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [preview?.label]);

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
        <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-ok/50 bg-ok/10 px-4 py-2 text-sm text-ok">
          {notice}
        </p>
      )}

      {/* The plan on the left, the search that adds to it on the right. */}
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <section aria-labelledby="golive-plan-items" className={`${CARD} flex flex-col gap-4 p-4`}>
          <h2 id="golive-plan-items" className={LABEL}>
            {t('planItems')}
          </h2>
          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg/60">{t('noItems')}</p>
          ) : (
            BLOCKS.map((block) => {
              const rows = blockRows(items, block.id);
              if (rows.length === 0) return null;
              return (
                <div key={block.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-3">
                    <p className="shrink-0 text-xs font-bold tracking-wider text-accent uppercase">{plannerT(block.titleKey)}</p>
                    <span className="h-px flex-1 bg-line" aria-hidden />
                  </div>
                  <ol className="flex flex-col">
                    {rows.map((row, i) => (
                      <li key={`${block.id}-${i}`} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition hover:bg-fg/[0.05]">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-fg/10 font-mono text-[10px] font-bold text-fg/70 tabular-nums">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-sm text-fg">{row.label}</span>
                        <span className="shrink-0 rounded-full border border-fg/20 bg-fg/[0.06] px-2 py-0.5 text-[10px] font-bold tracking-wider text-fg/60 uppercase">{plannerT(`module_${row.module}`)}</span>
                        <button type="button" onClick={() => showPreview(row.label, row.module, row.sourceId)} className={SMALL_BTN}>
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

        <section aria-labelledby="golive-search" className={`${CARD} flex flex-col gap-3 p-4`}>
          <h2 id="golive-search" className={LABEL}>
            {t('searchLabel')}
          </h2>
          <div role="tablist" className="flex gap-1 self-start rounded-lg border border-line bg-fg/[0.03] p-1">
            {TABS.map((x) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={tab === x.id}
                onClick={() => setTab(x.id)}
                className={`h-9 rounded-md px-4 text-xs font-semibold uppercase transition ${
                  tab === x.id ? 'bg-accent text-on-accent' : 'text-fg/70 hover:bg-fg/10 hover:text-fg'
                }`}
              >
                {t(x.key)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('searchLabel')} aria-label={t('searchLabel')} className={`${input} min-w-48 flex-1`} />
            <label className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-fg/60 uppercase">
              {t('blockLabel')}
              <select value={block} onChange={(e) => setBlock(e.target.value as LiturgicalBlock)} className={`${input} w-auto normal-case`}>
                {BLOCKS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {plannerT(b.titleKey)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {results.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg/60">{t('noResults')}</p>
          ) : (
            <ul className="flex max-h-[50vh] flex-col overflow-y-auto">
              {results.map((row) => (
                <li key={`${row.module}-${row.sourceId}`} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-fg/[0.05]">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold text-fg">{row.label}</span>
                    <span className="truncate text-xs text-fg/60">{row.sub}</span>
                  </span>
                  <button type="button" onClick={() => showPreview(row.label, row.module, row.sourceId)} className={SMALL_BTN}>
                    {t('previewButton')}
                  </button>
                  <button type="button" onClick={() => add(row)} className={`${SMALL_BTN} hover:!border-accent hover:!text-accent`}>
                    {t('addToPlan')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* The preview opens below the lists, and the page scrolls to it, so pressing Preview always shows something. */}
      <div ref={previewRef} className="scroll-mt-5">
        {preview && (
          <>
            {preview.error && (
              <p role="alert" className="rounded-lg border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
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
            {preview.slides && preview.slides.pages.length === 0 && <p className="text-sm text-fg/60">{t('noPreview')}</p>}
          </>
        )}
      </div>
    </div>
  );
}
