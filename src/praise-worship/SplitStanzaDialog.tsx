import { useEffect, useRef, useState } from 'react';
import { Scissors, X } from 'lucide-react';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import type { Hymn } from '../lyrics/types';
import { StanzaEditBox } from './HotEditForms';
import { usePwT } from './strings';
import { useLiveHotEditor } from './useLiveHotEditor';

/**
 * Splitting a stanza that is cut off on the slide. It opens in the operator window when the "Text cut off" badge is pressed on the mirror or
 * a preview (in this window or the mirror's own), with the stanza's words in the edit box: Auto-split at midpoint makes it two slides, or the
 * words can be changed and saved. Either way the song is saved in Song Lyrics, and the slide on screen and the cue lists take the change.
 */
export function SplitStanzaDialog() {
  const t = usePwT();
  const request = useLive((s) => s.state.splitRequest);
  // Requests made before this window opened are not acted on; only a new press is.
  const seen = useRef(request?.seq ?? 0);
  const [open, setOpen] = useState<{ hymnId: number; position: number } | null>(null);
  const [hymn, setHymn] = useState<Hymn | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // The number of slides the stanza was split into, once it was; 0 before.
  const [done, setDone] = useState(0);
  const hot = useLiveHotEditor(hymn, setHymn);

  useEffect(() => {
    if (!request || request.seq <= seen.current) return;
    seen.current = request.seq;
    setOpen({ hymnId: request.hymnId, position: request.position });
    setDone(0);
    setFailed(null);
    setHymn(null);
    bridge.lyrics
      .getHymn(request.hymnId)
      .then((loaded) => {
        if (!loaded || loaded.deletedAt) setFailed('This song is not in the library any more.');
        else setHymn(loaded);
      })
      .catch((err) => setFailed(err instanceof Error ? err.message : String(err)));
  }, [request?.seq]);

  // The edit box opens on the stanza once the song is loaded.
  useEffect(() => {
    if (open && hymn && !hot.editing && !done && hymn.stanzas[open.position]) hot.startEdit(open.position);
  }, [open, hymn?.id]);

  const close = () => {
    hot.cancel();
    setOpen(null);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;
  const stanza = hymn?.stanzas[open.position];

  const split = async () => setDone(await hot.commitSplit(open.position));
  const smartBreak = async () => setDone(await hot.commitSmartBreak(open.position));
  const save = async () => {
    if (await hot.commitEdit()) close();
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="split-title" className="flex w-full max-w-xl flex-col gap-3 rounded-xl border border-line-strong bg-panel p-5 shadow-2xl">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="split-title" className="flex items-center gap-2 text-lg font-bold">
              <Scissors size={16} className="text-warn" aria-hidden />
              {t('splitTitle')}
            </h2>
            {hymn && <p className="truncate text-sm text-muted">{hymn.title}</p>}
          </div>
          <button type="button" onClick={close} aria-label={t('closeDialog')} title={t('closeDialog')} className="grid size-8 shrink-0 place-items-center rounded-md border border-fg/15 text-muted hover:text-fg">
            <X size={14} aria-hidden />
          </button>
        </header>
        {failed && <p role="alert" className="text-sm text-danger">{failed}</p>}
        {hot.error && <p role="alert" className="text-sm text-danger">{hot.error}</p>}
        {done ? (
          <p role="status" className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2 text-sm text-ok">
            {t('splitDone', { n: done })}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted">{t('splitHint')}</p>
            {stanza && hot.editing && <StanzaEditBox t={t} hot={hot} stanza={stanza} live={false} onSave={() => void save()} onSplit={() => void split()} onSmartBreak={() => void smartBreak()} />}
          </>
        )}
        {done && (
          <div className="flex justify-end">
            <button type="button" onClick={close} className="h-9 rounded-md border border-accent bg-accent px-4 text-sm font-bold text-on-accent">
              {t('closeDialog')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
