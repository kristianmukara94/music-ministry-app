import { dispatch } from './store';
import { useLiveNotice } from './liveNotice';

const BTN = 'rounded-md border border-line-strong px-3 py-1.5 text-xs font-bold uppercase hover:bg-panel-2';

/**
 * The operator console's notice about the projector. A deleted song or prayer stays on screen; the operator decides whether to
 * clear it. Nothing is cleared automatically.
 */
export function LiveNoticeBanner() {
  const notice = useLiveNotice((s) => s.notice);
  const clear = useLiveNotice((s) => s.clear);
  if (!notice) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-danger/40 bg-panel px-5 py-3 text-sm">
      <span className="min-w-0 flex-1">{notice.text}</span>
      {notice.kind === 'deleted' && (
        <button
          type="button"
          className={BTN}
          onClick={() => {
            dispatch({ type: 'projector/clear' });
            clear();
          }}
        >
          Clear projector
        </button>
      )}
      <button type="button" className={BTN} onClick={clear}>
        {notice.kind === 'deleted' ? 'Keep on screen' : 'Dismiss'}
      </button>
    </div>
  );
}
