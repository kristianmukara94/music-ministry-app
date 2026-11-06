import { X } from 'lucide-react';
import { dispatch } from '../live/store';
import { usePwT } from '../praise-worship/strings';
import { ProjectorView } from './ProjectorView';

/**
 * The operator mirror's own window, also the booth's confidence monitor. The window has no frame, so the whole picture is its drag handle;
 * buttons on it (the close button, a stanza's cut-off warning) stay clickable. The close button shows while the pointer is over the window.
 */
export function MirrorWindow() {
  const t = usePwT();
  return (
    <div className="group relative h-screen w-screen [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]">
      <ProjectorView mirror />
      <button
        type="button"
        onClick={() => dispatch({ type: 'output/set', output: 'preview', on: false })}
        aria-label={t('closeMonitor')}
        title={t('closeMonitor')}
        className="absolute top-2 right-2 z-50 grid size-8 place-items-center rounded-full bg-black/70 text-white opacity-0 shadow transition group-hover:opacity-100 hover:bg-red-600 focus-visible:opacity-100"
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}
