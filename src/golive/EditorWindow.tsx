import { useEffect, useState } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import { bridge } from '../live/bridge';
import { useTheme } from '../theme/store';
import { errorText } from '../whiteboard/errors';
import type { WhiteboardSlide } from '../whiteboard/types';
import { LiveSlideEditor } from './LiveSlideEditor';
import { useGoLiveT } from './strings';

const api = bridge.whiteboard;

/**
 * The slide editor's own window (`#/editor/<slide id>`). It paints with the saved theme, loads its slide, and shows the editor full size. If the
 * slide is deleted while the window is open, it says so, rather than editing a slide that is no longer there.
 */
export function EditorWindow({ slideId }: { slideId: number }) {
  const t = useGoLiveT();
  const [slide, setSlide] = useState<WhiteboardSlide | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  // A new window has not painted the operator's theme yet.
  useEffect(() => {
    bridge.config
      .get()
      .then((state) => useTheme.getState().hydrate(state.config.theme))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    api
      .get(slideId)
      .then((found) => setSlide(found))
      .catch((err) => setError(errorText(err)));
  }, [slideId]);

  // Only a deletion matters while editing: the editor keeps the draft it holds, and does not reload over what is being typed.
  const [gone, setGone] = useState(false);
  useEffect(
    () =>
      api.onChanged(() => {
        api
          .get(slideId)
          .then((found) => {
            if (!found) setGone(true);
          })
          .catch(() => undefined);
      }),
    [slideId],
  );

  if (error) {
    return (
      <div role="alert" className="grid h-screen place-items-center bg-canvas p-8 text-center text-fg">
        <p className="flex max-w-md items-center gap-3 text-sm text-danger">
          <TriangleAlert size={18} className="shrink-0" aria-hidden /> {error}
        </p>
      </div>
    );
  }
  if (slide === undefined) {
    return (
      <div role="status" className="grid h-screen place-items-center bg-canvas text-fg/70">
        <p className="flex items-center gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" aria-hidden /> {t('editorLoading')}
        </p>
      </div>
    );
  }
  if (slide === null || gone) {
    return (
      <div role="status" className="grid h-screen place-items-center bg-canvas p-8 text-center text-fg">
        <div className="flex max-w-md flex-col items-center gap-4">
          <p className="text-sm text-fg/80">{t('editorSlideGone')}</p>
          <button type="button" onClick={() => api.closeEditor()} className="rounded-lg bg-accent px-5 py-2 text-xs font-bold tracking-wider text-on-accent uppercase">
            {t('editorDone')}
          </button>
        </div>
      </div>
    );
  }
  return <LiveSlideEditor key={slide.id} slide={slide} layout="window" onClose={() => api.closeEditor()} t={t} />;
}
