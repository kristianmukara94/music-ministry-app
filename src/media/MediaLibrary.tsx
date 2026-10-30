import { useEffect, useState, type DragEvent, type MouseEvent } from 'react';
import { Film, Image as ImageIcon, MoreHorizontal, Music, Play, Trash2, Upload, X } from 'lucide-react';
import type { MediaFrame } from '../../shared/live.js';
import { bridge } from '../live/bridge';
import { dispatch, useLive } from '../live/store';
import { setUi, useUi } from '../state/ui';
import { addToQueue } from '../planner/plan-api';
import { useMediaT } from './strings';
import { LowerThirdDeck } from './LowerThirdDeck';
import { MEDIA_DRAG, type MediaAsset, type MediaType } from './types';

const api = bridge.media;
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** A library item as a background frame. Audio is never a background, so it has no frame. */
const toFrame = (m: MediaAsset): MediaFrame | null =>
  m.mediaType === 'audio' ? null : { kind: 'media', mediaType: m.mediaType, src: m.src, title: m.filename };

const button =
  'flex h-9 items-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-3 text-xs font-semibold tracking-wide uppercase text-fg/85 transition hover:bg-fg/10 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40';
const LABEL = 'text-[11px] font-semibold tracking-wider text-fg/60 uppercase';

/**
 * A library thumbnail. If the preview picture cannot be loaded, an image falls back to the file itself, and then to an icon, instead of showing
 * the browser's broken-image mark.
 */
function Thumb({ asset }: { asset: MediaAsset }) {
  const [stage, setStage] = useState<'thumb' | 'file' | 'icon'>(asset.thumbSrc ? 'thumb' : 'icon');
  if (stage !== 'icon') {
    const src = (stage === 'thumb' ? asset.thumbSrc : asset.src) ?? undefined;
    return (
      <img
        key={stage}
        src={src}
        alt=""
        loading="lazy"
        draggable={false}
        onError={() => setStage(stage === 'thumb' && asset.mediaType === 'image' ? 'file' : 'icon')}
        className="h-full w-full object-cover"
      />
    );
  }
  return (
    <div className="grid h-full place-items-center text-fg/50">
      {asset.mediaType === 'audio' ? (
        <Music size={28} strokeWidth={1.6} aria-hidden />
      ) : asset.mediaType === 'video' ? (
        <Film size={28} strokeWidth={1.6} aria-hidden />
      ) : (
        <ImageIcon size={28} strokeWidth={1.6} aria-hidden />
      )}
    </div>
  );
}

/** The filter tabs, in the order the operator reads them. */
const TABS: { type: MediaType; label: string; banner: string; empty: string }[] = [
  {
    type: 'image',
    label: 'IMAGES',
    banner: 'ⓘ Images: PNG, JPG, GIF, WebP, SVG supported. Click to project, drag to queue or folders, right-click for options.',
    empty: 'No images yet. Import PNG, JPG, GIF, WebP or SVG files.',
  },
  {
    type: 'video',
    label: 'VIDEOS',
    banner: 'ⓘ Videos: MP4, MOV, MKV, WebM supported (automatic remuxing enabled). Click to project, drag to queue or folders, right-click for options.',
    empty: 'No videos yet. Import MP4, MOV, MKV or WebM files.',
  },
  {
    type: 'audio',
    label: 'AUDIO',
    banner: 'ⓘ Audio: MP3, WAV, AAC, FLAC, OGG supported. Click to play, drag to queue or folders, right-click for options.',
    empty: 'No audio yet. Import MP3, WAV, AAC, FLAC or OGG files.',
  },
];

interface MenuState {
  asset: MediaAsset;
  x: number;
  y: number;
}

export function MediaLibrary() {
  const t = useMediaT();
  const background = useLive((s) => s.state.projector.background);
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [tab, setTab] = useState<MediaType>('image');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Set when the staged video cannot be played, so the operator sees why before it goes to the screen.
  const [videoError, setVideoError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The audio item previewing in this window. It is never sent to the projector.
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const reload = () => api.list().then(setItems).catch((err) => setError(errorText(err)));

  /** Shows a note for a few seconds, without holding up the screen. */
  const showNotice = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((current) => (current === text ? null : current)), 8000);
  };

  // Background events: a converted MP4 appears in the list, and a failed conversion is reported.
  useEffect(
    () =>
      api.onEvent((event) => {
        if (event.kind === 'changed') void reload();
        else if (event.kind === 'remux-failed') showNotice(`Could not convert ${event.name ?? 'a file'} to MP4. The original is still in the library.`);
      }),
    [],
  );

  useEffect(() => {
    void reload().then(() => {
      // A Service Queue request to stage one item: stage it once the list is loaded.
      const pending = useUi.getState().pendingFocus;
      if (pending?.kind !== 'media') return;
      setUi({ pendingFocus: null });
      api.list().then((list) => {
        const asset = list.find((m) => m.id === pending.id);
        const frame = asset ? toFrame(asset) : null;
        if (frame) dispatch({ type: 'background/stage', media: frame });
      });
    });
  }, []);

  // The menu closes on any click elsewhere, on Escape, and when the page scrolls.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  const importMedia = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.importMedia();
      await reload();
      if (result.imported > 0) setNotice(t('imported', { n: result.imported }));
      if (result.notice) showNotice(result.notice);
      if (result.failed.length > 0) setError(t('notImported', { names: result.failed.join(', ') }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  /** Stages the item on the background layer. It reaches the screen when taken. */
  const stageBackground = (m: MediaAsset) => {
    const frame = toFrame(m);
    if (frame) dispatch({ type: 'background/stage', media: frame });
  };

  /** Clicking an image or a video puts it straight on the screen as the background. */
  const projectNow = (m: MediaAsset) => {
    const frame = toFrame(m);
    if (!frame) return;
    dispatch({ type: 'background/stage', media: frame });
    dispatch({ type: 'background/take' });
  };

  /** Clicking audio plays it here, in this window. The congregation screen never hears it. */
  const togglePreview = (m: MediaAsset) => setPlayingId((current) => (current === m.id ? null : m.id));

  const clearBackground = () => dispatch({ type: 'background/clear' });

  const takeBackground = () => dispatch({ type: 'background/take' });

  const remove = async (m: MediaAsset) => {
    if (!window.confirm(t('confirmDelete', { name: m.filename }))) return;
    try {
      await api.deleteMedia(m.id);
      // A deleted file cannot keep playing, so it leaves the background layer too.
      if (background.live?.src === m.src || background.staged?.src === m.src) clearBackground();
      if (playingId === m.id) setPlayingId(null);
      await reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const rename = async (m: MediaAsset) => {
    const name = window.prompt('New name for this file', m.filename);
    if (name === null || name.trim() === '' || name.trim() === m.filename) return;
    try {
      await api.rename(m.id, name);
      await reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const reveal = (m: MediaAsset) => {
    api.reveal(m.id).catch((err) => setError(errorText(err)));
  };

  /** Makes the image the screen's idle background: what shows when nothing is live. */
  const setDefaultBackground = (m: MediaAsset) => {
    bridge.projector
      .save({ idle: 'media', idleMedia: m.src })
      .then(() => setNotice(`"${m.filename}" is now the default worship background.`))
      .catch((err) => setError(errorText(err)));
  };

  const addToMassQueue = (m: MediaAsset) => {
    addToQueue([{ block: 'introductory', module: 'media', sourceId: String(m.id), label: m.filename }])
      .then(() => setNotice(`"${m.filename}" added to the Mass Queue.`))
      .catch((err) => setError(errorText(err)));
  };

  const onDragStart = (e: DragEvent<HTMLLIElement>, m: MediaAsset) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(MEDIA_DRAG, JSON.stringify({ id: m.id, label: m.filename }));
  };

  /** The same menu from the ... button on a card: placed under the button, kept on screen. */
  const openMenuFromButton = (e: MouseEvent<HTMLButtonElement>, m: MediaAsset) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu({ asset: m, x: Math.max(8, Math.min(rect.right - 256, window.innerWidth - 264)), y: Math.min(rect.bottom + 4, window.innerHeight - 300) });
  };

  const openMenu = (e: MouseEvent, m: MediaAsset) => {
    e.preventDefault();
    // Keeps the menu on screen when the click is near an edge.
    const x = Math.min(e.clientX, window.innerWidth - 260);
    const y = Math.min(e.clientY, window.innerHeight - 300);
    setMenu({ asset: m, x, y });
  };

  const liveName = background.live?.title ?? null;
  const stagedName = background.staged?.title ?? null;
  const stagedIsNew = background.staged !== null && background.staged !== background.live;

  const current = TABS.find((x) => x.type === tab) ?? TABS[0];
  const visible = items.filter((m) => m.mediaType === tab);
  const counts = { image: 0, video: 0, audio: 0 } as Record<MediaType, number>;
  for (const m of items) counts[m.mediaType] += 1;
  const playing = items.find((m) => m.id === playingId && m.mediaType === 'audio') ?? null;

  return (
    <div className="flex min-h-[calc(100vh-88px)] flex-col">
      <header className="flex flex-wrap items-start justify-between gap-6 px-5 pt-5 pb-3">
        <div>
          <div className="text-sm font-semibold tracking-wider text-accent uppercase">{t('eyebrow')}</div>
          <h1 className="mt-1 text-4xl leading-tight font-extrabold tracking-tight text-fg xl:text-[44px]">{t('title')}</h1>
          <p className="mt-1 text-sm text-fg/70">{t('subtitle')}</p>
        </div>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="min-w-44 rounded-[10px] border border-line bg-panel px-4 py-3">
              <div className={LABEL}>{t('stagedBackground')}</div>
              <div className="mt-1 truncate font-semibold">{stagedName ?? t('nothingStaged')}</div>
            </div>
            <div className="min-w-44 rounded-[10px] border border-line bg-panel px-4 py-3">
              <div className={LABEL}>{t('liveBackground')}</div>
              <div className={`mt-1 flex items-center gap-2 truncate font-semibold ${liveName ? 'text-ok' : 'text-fg'}`}>
                {liveName && <span className="size-2 shrink-0 animate-pulse rounded-full bg-ok" aria-hidden />}
                {liveName ?? t('none')}
              </div>
            </div>
          </div>
          {background.staged?.mediaType === 'video' && (
            <div className="flex items-start gap-3">
              <video
                key={background.staged.src}
                src={background.staged.src}
                muted
                playsInline
                controls={false}
                preload="auto"
                onLoadedData={() => setVideoError(null)}
                onError={(e) => {
                  console.error('Video playback error:', e.currentTarget.error ?? e);
                  // MEDIA_ERR_SRC_NOT_SUPPORTED (4) and MEDIA_ERR_DECODE (3) are the codec failures.
                  const code = e.currentTarget.error?.code;
                  setVideoError(
                    code === 3 || code === 4
                      ? 'Unsupported video codec. Please re-encode file using H.264 video & AAC audio.'
                      : 'This video could not be played.',
                  );
                }}
                className="aspect-video w-48 shrink-0 rounded-md border border-fg/15 bg-black object-contain"
              />
              {videoError && <p role="alert" className="text-sm text-danger">{videoError}</p>}
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={clearBackground} disabled={!background.live && !background.staged} className={button}>
              <X size={14} aria-hidden /> {t('clearBackground')}
            </button>
            <button
              type="button"
              onClick={takeBackground}
              disabled={!stagedIsNew}
              className="flex h-9 items-center gap-2 rounded-md border border-accent bg-accent px-4 text-xs font-extrabold tracking-wide uppercase text-on-accent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play size={14} aria-hidden /> {t('takeToScreen')}
            </button>
            <button type="button" onClick={importMedia} disabled={busy} className={button}>
              <Upload size={14} aria-hidden /> {busy ? t('importing') : t('importMedia')}
            </button>
          </div>
        </div>
      </header>

      <div className="px-5 pt-3">
        <LowerThirdDeck />
      </div>

      {/* Segmented filter: the active tab is a bright pill, the others are muted. */}
      <div className="flex flex-col gap-3 px-5 pt-5">
        <div role="tablist" aria-label="Media type" className="inline-flex w-fit gap-1 rounded-lg border border-line bg-panel p-1">
          {TABS.map((tb) => (
            <button
              key={tb.type}
              type="button"
              role="tab"
              aria-selected={tab === tb.type}
              onClick={() => setTab(tb.type)}
              className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-xs font-semibold tracking-wider uppercase transition ${
                tab === tb.type ? 'bg-accent text-on-accent' : 'text-fg/70 hover:bg-fg/10 hover:text-fg'
              }`}
            >
              {tb.label}
              <span className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${tab === tb.type ? 'bg-on-accent/15' : 'bg-fg/10'}`}>{counts[tb.type]}</span>
            </button>
          ))}
        </div>
        {/* What the current tab accepts, and how its items are used. */}
        <p role="note" className="rounded-lg border border-line bg-fg/[0.03] px-4 py-2 text-xs text-fg/75">
          {current.banner}
        </p>
      </div>

      {(error || notice) && (
        <div role={error ? 'alert' : 'status'} className={`mx-5 mt-4 rounded-lg border px-4 py-2 text-sm ${error ? 'border-danger/50 bg-danger/10 text-danger' : 'border-ok/50 bg-ok/10 text-ok'}`}>
          {error ?? notice}
        </div>
      )}

      {playing && (
        <div className="mx-5 mt-4 flex items-center gap-3 rounded-[10px] border border-line bg-panel px-4 py-2">
          <Music size={15} aria-hidden />
          <span className="flex-1 truncate text-sm font-semibold">{playing.filename}</span>
          {/* The preview plays in this window only. Projector output is unaffected. */}
          <audio key={playing.src} src={playing.src} autoPlay controls className="h-8" onEnded={() => setPlayingId(null)} />
        </div>
      )}

      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
          <div className="grid size-16 place-items-center rounded-[10px] border border-line bg-panel text-accent">
            <Film size={26} strokeWidth={1.6} aria-hidden />
          </div>
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-fg">{t('emptyTitle')}</h2>
          <p className="mt-2 max-w-md text-sm text-fg/70">{t('emptyBody')}</p>
          <button type="button" onClick={importMedia} disabled={busy} className="mt-5 flex h-10 items-center gap-2 rounded-md border border-accent bg-accent px-5 text-xs font-extrabold tracking-wide text-on-accent uppercase transition hover:brightness-110 disabled:opacity-40">
            <Upload size={14} aria-hidden /> {busy ? t('importing') : t('importMedia')}
          </button>
        </div>
      ) : visible.length === 0 ? (
        <p className="p-6 text-sm text-fg/60">{current.empty}</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 px-5 py-5">
          {visible.map((m) => {
            const isLive = background.live?.src === m.src;
            const isStaged = background.staged?.src === m.src && !isLive;
            const isAudio = m.mediaType === 'audio';
            return (
              <li
                key={m.id}
                draggable
                onDragStart={(e) => onDragStart(e, m)}
                onContextMenu={(e) => openMenu(e, m)}
                className={`group relative cursor-grab overflow-hidden rounded-[10px] border bg-panel transition hover:border-fg/30 ${isLive ? 'border-ok/60' : isStaged ? 'border-warn/60' : 'border-line'}`}
              >
                <button
                  type="button"
                  onClick={() => (isAudio ? togglePreview(m) : projectNow(m))}
                  aria-label={isAudio ? `Play ${m.filename}` : `Project ${m.filename}`}
                  className="relative block aspect-video w-full bg-canvas"
                >
                  <Thumb asset={m} />
                  {isLive && <span className="absolute top-2 right-2 rounded bg-ok px-1.5 py-0.5 text-[10px] font-extrabold text-canvas uppercase">{t('live')}</span>}
                  {isStaged && <span className="absolute top-2 right-2 rounded bg-warn px-1.5 py-0.5 text-[10px] font-extrabold text-canvas uppercase">{t('staged')}</span>}
                  {isAudio && playingId === m.id && (
                    <span className="absolute top-2 right-2 rounded bg-ok px-1.5 py-0.5 text-[10px] font-extrabold text-canvas uppercase">Playing</span>
                  )}
                </button>
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg" title={m.filename}>{m.filename}</span>
                  <button
                    type="button"
                    onClick={(e) => openMenuFromButton(e, m)}
                    onPointerDown={(e) => e.stopPropagation()}
                    aria-haspopup="menu"
                    aria-label={`More actions for ${m.filename}`}
                    title="More actions"
                    className="grid size-7 shrink-0 place-items-center rounded text-fg/60 opacity-70 transition hover:bg-fg/10 hover:text-fg group-hover:opacity-100 focus:opacity-100"
                  >
                    <MoreHorizontal size={15} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(m)}
                    aria-label={t('deleteLabel', { name: m.filename })}
                    title={t('delete')}
                    className="grid size-7 shrink-0 place-items-center rounded text-fg/60 opacity-70 transition hover:text-danger group-hover:opacity-100 focus:opacity-100"
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {menu && (
        <ContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          onStage={stageBackground}
          onQueue={addToMassQueue}
          onDefault={setDefaultBackground}
          onRename={rename}
          onReveal={reveal}
          onDelete={remove}
        />
      )}
    </div>
  );
}

/** Quick actions for one item. Actions that do not apply to its type are shown disabled. */
function ContextMenu({ state, onClose, onStage, onQueue, onDefault, onRename, onReveal, onDelete }: {
  state: MenuState;
  onClose: () => void;
  onStage: (m: MediaAsset) => void;
  onQueue: (m: MediaAsset) => void;
  onDefault: (m: MediaAsset) => void;
  onRename: (m: MediaAsset) => void;
  onReveal: (m: MediaAsset) => void;
  onDelete: (m: MediaAsset) => void;
}) {
  const { asset: m } = state;
  const items: { label: string; disabled?: boolean; danger?: boolean; run: () => void }[] = [
    { label: 'Stage to Projector', disabled: m.mediaType === 'audio', run: () => onStage(m) },
    { label: 'Add to Mass Queue', run: () => onQueue(m) },
    { label: 'Set as Default Worship Background', disabled: m.mediaType !== 'image', run: () => onDefault(m) },
    { label: 'Rename', run: () => onRename(m) },
    { label: 'Reveal in File Explorer', run: () => onReveal(m) },
    { label: 'Delete Asset', danger: true, run: () => onDelete(m) },
  ];
  return (
    <div
      role="menu"
      aria-label={m.filename}
      style={{ left: state.x, top: state.y }}
      // A click inside the menu must not reach the window listener, which would close it before the item runs.
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed z-50 flex w-64 flex-col gap-0.5 rounded-lg border border-fg/20 bg-panel p-1 shadow-2xl"
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.run();
          }}
          className={`rounded-md px-3 py-2 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${
            item.danger ? 'text-danger hover:bg-danger/10' : 'text-fg/90 hover:bg-fg/10'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
