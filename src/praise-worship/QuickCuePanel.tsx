import { useEffect } from 'react';
import { Maximize2, Pencil, Plus, Undo2, X } from 'lucide-react';
import type { PwT } from './strings';
import type { QuickLive } from './useQuickLiveController';
import { useLiveHotEditor } from './useLiveHotEditor';
import { SMALL_BTN, StanzaAddBox, StanzaEditBox } from './HotEditForms';
import { setGoLiveFocused, useFocusEscape } from './useGoLiveFocus';

/**
 * The live cues of the song sent from search: one card per stanza (Verse 1, Chorus, Verse 2 …). Pressing a card shows that stanza at once.
 * The card on the projector has a pulsing red edge and an ON AIR badge. The lineup's card and place are never touched by these presses.
 *
 * The words can be changed while the song is on air: double-click a card, or press its pencil. + Add slide puts a new stanza after the one
 * on screen. Both save the song, and the projector takes the new words in place, with no transition.
 *
 * `focused` is the Go Live focus view: the cards fill the workspace, and ✕ (or Escape) closes only the view, never the projector. Docked in
 * the Library, ✕ closes the cues and Focus view brings the takeover back.
 */
export function QuickCuePanel({ quick, t, focused = false }: { quick: QuickLive; t: PwT; focused?: boolean }) {
  const { cue, onAirStanza, blackedOut } = quick;
  const exit = quick.exitQuickLiveAndRestore;
  const hot = useLiveHotEditor(cue, quick.adoptCue);
  const busyEditing = hot.editing !== null || hot.adding !== null;
  useFocusEscape(focused && cue !== null, busyEditing);

  // Shift + Escape leaves Quick Live from anywhere, even while typing in the search box or when the song has left the screen. It waits while
  // a stanza is being edited, so a half-typed change is never lost, and a dialog keeps its own Escape.
  useEffect(() => {
    if (!cue) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (busyEditing || document.querySelector('[role="dialog"], dialog[open]')) return;
      e.preventDefault();
      e.stopPropagation();
      exit();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cue, exit, busyEditing]);

  if (!cue) return null;
  const onAir = onAirStanza !== null;

  const saveAdd = async (show: boolean) => {
    const index = await hot.commitAdd(onAirStanza);
    if (index !== null && show) quick.showStanza(index);
  };

  return (
    <section
      ref={(el) => {
        quick.cuePanelRef.current = el;
      }}
      tabIndex={-1}
      aria-label={`${t('liveCues')}: ${cue.title}`}
      className={`flex flex-col outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${
        focused ? 'min-w-0 gap-3 rounded-[10px] border border-line bg-panel p-5' : 'gap-2 rounded-lg border border-line bg-panel-2 p-3'
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold tracking-wider text-accent uppercase">{t('liveCues')}</p>
          <h3 className={`truncate font-bold ${focused ? 'text-2xl tracking-tight' : 'text-base'}`}>{cue.title}</h3>
        </div>
        <button type="button" onClick={hot.startAdd} disabled={hot.busy || hot.adding !== null} title={t('addSlideTip')} className={`${SMALL_BTN} border-fg/15 text-fg/85 hover:border-accent hover:text-accent`}>
          <Plus size={14} aria-hidden />
          {t('addSlide')}
        </button>
        <button
          type="button"
          onClick={exit}
          title={t('exitQuickLiveTip')}
          aria-keyshortcuts="Shift+Escape"
          className={`${SMALL_BTN} border-danger/70 bg-danger/10 font-extrabold text-danger hover:bg-danger hover:text-white focus-visible:ring-2 focus-visible:ring-danger/60 focus-visible:outline-none`}
        >
          <Undo2 size={14} aria-hidden />
          {t('exitQuickLive')}
        </button>
        {focused ? (
          // Closes the focus view only: the Library and Lineup come back, and the song stays on the projector.
          <button
            type="button"
            onClick={() => setGoLiveFocused(false)}
            aria-label={t('leaveFocus')}
            title={t('leaveFocusTip')}
            aria-keyshortcuts="Escape"
            className="grid size-9 shrink-0 place-items-center rounded-md border border-fg/25 bg-panel-2 text-fg transition hover:border-accent hover:text-accent focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
          >
            <X size={18} aria-hidden />
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setGoLiveFocused(true)}
              aria-label={t('focusView')}
              title={t('focusViewTip')}
              className="grid size-8 shrink-0 place-items-center rounded-md border border-fg/15 text-muted transition hover:border-accent hover:text-fg"
            >
              <Maximize2 size={14} aria-hidden />
            </button>
            <button
              type="button"
              onClick={quick.closeCue}
              aria-label={t('closeCues')}
              title={t('closeCues')}
              className="grid size-8 shrink-0 place-items-center rounded-md border border-fg/15 text-muted transition hover:border-accent hover:text-fg"
            >
              <X size={14} aria-hidden />
            </button>
          </>
        )}
      </header>

      {hot.error && (
        <p role="alert" className="text-xs text-danger">
          {hot.error}
        </p>
      )}

      <StanzaAddBox
        t={t}
        hot={hot}
        stanzas={cue.stanzas}
        where={onAir ? t('newSlideAfter', { name: cue.stanzas[onAirStanza]?.stanzaType ?? '' }) : t('newSlideEnd')}
        onAdd={(show) => void saveAdd(show)}
      />

      <ol className={focused ? 'grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3' : 'flex max-h-72 flex-col gap-2 overflow-y-auto pr-1'}>
        {cue.stanzas.map((stanza, i) => {
          const live = onAirStanza === i;
          if (hot.editing?.index === i) {
            return (
              <li key={stanza.id}>
                <StanzaEditBox t={t} hot={hot} stanza={stanza} live={live} onSave={() => void hot.commitEdit()} onSplit={() => void hot.commitSplit(i)} onSmartBreak={() => void hot.commitSmartBreak(i)} />
              </li>
            );
          }
          return (
            <li key={stanza.id} className="group relative">
              <button
                type="button"
                onClick={() => quick.showStanza(i)}
                onDoubleClick={() => hot.startEdit(i)}
                aria-current={live ? 'true' : undefined}
                aria-label={`${live ? `${t('onAirBadge')}: ` : ''}${stanza.stanzaType}`}
                className={`w-full rounded-lg border p-3 pr-11 text-left transition ${focused ? 'h-full min-h-28' : ''} ${
                  live ? 'animate-pulse border-danger bg-danger/10 shadow-[0_0_10px_rgba(239,68,68,0.4)]' : 'border-line bg-panel hover:border-fg/25'
                }`}
              >
                <span className="mb-1 flex items-center gap-2">
                  <span className="font-mono text-[11px] font-bold tracking-wider text-accent uppercase">{stanza.stanzaType}</span>
                  {live && <span className="rounded bg-danger px-1.5 py-0.5 text-[10px] font-extrabold text-white uppercase">{t('onAirBadge')}</span>}
                </span>
                <span className={`block leading-snug whitespace-pre-line ${focused ? 'line-clamp-6 text-[15px]' : 'line-clamp-3 text-sm'}`}>{stanza.lyricsText || ' '}</span>
              </button>
              <button
                type="button"
                onClick={() => hot.startEdit(i)}
                disabled={hot.busy}
                aria-label={t('editWords', { name: stanza.stanzaType })}
                title={t('editWords', { name: stanza.stanzaType })}
                className="absolute top-2 right-2 grid size-7 place-items-center rounded-md border border-fg/15 bg-panel-2 text-muted opacity-60 transition group-hover:opacity-100 hover:border-accent hover:text-accent focus-visible:opacity-100"
              >
                <Pencil size={13} aria-hidden />
              </button>
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-muted" role="status">
        {onAir ? t('cueKeys') : blackedOut ? t('cueBlackout') : t('cueOff')}
      </p>
    </section>
  );
}
