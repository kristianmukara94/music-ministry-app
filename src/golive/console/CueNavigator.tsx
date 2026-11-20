import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useLive } from '../../live/store';
import { textCaseOf } from '../../../shared/text-fit.js';
import { cueKeys, cueState, cueTabs, cueText, filterCues, pad2, type Cue } from '../../../shared/stage-cue.js';
import { useChipKeys, type StageChipGroup } from '../../components/LiveStageCanvas';
import { useGoLiveT } from '../strings';
import { BTN, BTN_ACTIVE, CARD, CARD_TITLE } from './styles';

type CueView = 'cards' | 'index';

/** The cue view the operator chose last, kept for this window. Index suits a long item of 40–60 slides; Cards shows the words. */
const VIEW_KEY = 'apcc.goLiveCueView';
function savedView(): CueView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'index' ? 'index' : 'cards';
  } catch {
    return 'cards';
  }
}

/** The cues as chip rows for the 1–9, C and V keys (useChipKeys): one row per song, so C and V keep to the song being sung. */
function chipGroupsOf(cues: Cue[]): StageChipGroup[] {
  const groups: StageChipGroup[] = [];
  for (const cue of cues) {
    const chip = { index: cue.index, label: cue.chip ?? String(cue.number), name: cue.tag, hotkey: cue.hotkey };
    const last = groups[groups.length - 1];
    if (last && last.label === (cue.group ?? null)) last.chips.push(chip);
    else groups.push({ key: `${cue.group ?? 'item'}@${cue.index}`, label: cue.group ?? null, chips: [chip] });
  }
  return groups;
}

interface Props {
  /** Every slide of the item on air, in order. */
  cues: Cue[];
  /** The cue on air, by `Cue.index`, or -1. */
  activeIndex: number;
  onSelect: (index: number) => void;
  disabled?: boolean;
  /** Shown in place of the grid when the item has no cues (an item of one slide). */
  empty?: string;
  /** Changes when the item on air changes: the search and the tab start over. */
  itemKey: string;
}

/**
 * Jump to Cue: every slide of the item on air as a card (its number, tag, Key 1–9 badge and two lines of its words, in the projector's case) or
 * as a compact numbered index for a long item. A click goes live at once. The search finds words, a tag or a slide number; the tabs keep one
 * song or one section. The number keys go to the first nine cues, C to the first chorus and V to the next verse.
 */
export function CueNavigator({ cues, activeIndex, onSelect, disabled = false, empty, itemKey }: Props) {
  const t = useGoLiveT();
  const textCase = useLive((s) => textCaseOf(s.state.settings.textCase));
  const [view, setView] = useState<CueView>(savedView);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<string | null>(null);
  useEffect(() => {
    setQuery('');
    setTab(null);
  }, [itemKey]);
  const pickView = (next: CueView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* the choice is a convenience: without storage it lasts until the window closes */
    }
  };

  const tabs = useMemo(() => cueTabs(cues), [cues]);
  const shown = useMemo(() => filterCues(cues, { query, tab }), [cues, query, tab]);
  const keys = useMemo(() => cueKeys(cues), [cues]);
  const groups = useMemo(() => chipGroupsOf(cues), [cues]);
  useChipKeys({ groups, activeIndex, onSelect, disabled });

  return (
    <section aria-labelledby="cue-heading" className={`${CARD} flex flex-col p-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-line pb-3">
        <div className="min-w-0">
          <h2 id="cue-heading" className={CARD_TITLE}>{t('consoleCueHeading', { n: cues.length })}</h2>
          <p className="text-xs text-muted">{t('consoleCueHint')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative flex items-center">
            <Search size={13} aria-hidden className="pointer-events-none absolute left-2.5 text-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && query && (e.stopPropagation(), setQuery(''))}
              placeholder={t('consoleCueSearch')}
              aria-label={t('consoleCueSearchLabel')}
              className="h-8 w-52 rounded-lg border border-line bg-canvas/60 pr-2.5 pl-8 text-xs text-fg outline-none placeholder:text-muted focus:border-accent"
            />
          </label>
          <div role="group" aria-label={t('consoleCueView')} className="flex gap-1">
            <button type="button" aria-pressed={view === 'cards'} onClick={() => pickView('cards')} className={view === 'cards' ? BTN_ACTIVE : BTN}>
              {t('consoleCards')}
            </button>
            <button type="button" aria-pressed={view === 'index'} onClick={() => pickView('index')} className={view === 'index' ? BTN_ACTIVE : BTN}>
              {t('consoleIndex')}
            </button>
          </div>
        </div>
      </div>

      {cues.length === 0 ? (
        <p className="pt-3 text-sm text-muted">{empty}</p>
      ) : (
        <>
          {tabs.length > 1 && (
            <div role="group" aria-label={t('consoleCueTabs')} className="flex gap-1.5 overflow-x-auto py-3">
              {[null, ...tabs].map((value) => {
                const on = tab === value;
                return (
                  <button
                    key={value ?? '__all'}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTab(value)}
                    className={`shrink-0 rounded-md border px-2.5 py-1 text-xs whitespace-nowrap transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none ${
                      on ? 'border-accent bg-accent font-bold text-on-accent' : 'border-transparent bg-panel-2 text-fg/85 hover:border-line'
                    }`}
                  >
                    {value ?? t('consoleAll')}
                  </button>
                );
              })}
            </div>
          )}
          {shown.length === 0 ? (
            <p className="py-3 text-sm text-muted">{t('consoleNoCues')}</p>
          ) : (
            <ol
              data-cue-view={view}
              className={`grid max-h-[350px] gap-2.5 overflow-y-auto pr-1 ${tabs.length > 1 ? '' : 'pt-3'} ${
                view === 'index' ? 'grid-cols-[repeat(auto-fill,minmax(56px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(165px,1fr))]'
              }`}
            >
              {shown.map((cue) => {
                const where = cueState(cue, activeIndex);
                const key = keys.get(cue.index);
                const words = cueText(cue.text, textCase);
                const label = t('consoleCueLabel', { n: pad2(cue.number), tag: cue.tag, text: words });
                const tone =
                  where === 'live' ? 'border-accent bg-accent/15 ring-1 ring-accent' : where === 'next' ? 'border-accent/45 bg-panel-2' : 'border-line bg-panel-2 hover:border-fg/30';
                return (
                  <li key={cue.index} className="min-w-0">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => cue.index !== activeIndex && onSelect(cue.index)}
                      aria-current={where === 'live' ? 'step' : undefined}
                      aria-label={label}
                      aria-keyshortcuts={key ? String(key) : undefined}
                      title={view === 'index' ? label : undefined}
                      className={`w-full rounded-lg border text-left transition focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none disabled:cursor-not-allowed ${tone} ${
                        view === 'index' ? 'grid min-h-10 place-items-center p-1.5 text-center font-mono text-sm font-bold tabular-nums' : 'flex min-h-[78px] flex-col justify-between gap-1.5 p-2.5'
                      } ${where === 'live' ? 'text-accent' : 'text-fg'}`}
                    >
                      {view === 'index' ? (
                        pad2(cue.number)
                      ) : (
                        <>
                          <span className="flex w-full items-center justify-between gap-2 font-mono text-[11px] text-muted">
                            <span className="truncate">
                              {pad2(cue.number)} · {cue.tag}
                            </span>
                            {key && (
                              <span className={`shrink-0 rounded px-1 ${where === 'live' ? 'bg-accent text-on-accent' : 'bg-fg/10 text-fg/80'}`}>{t('consoleKey', { n: key })}</span>
                            )}
                          </span>
                          <span className="line-clamp-2 text-xs font-medium text-fg">{words || '—'}</span>
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
