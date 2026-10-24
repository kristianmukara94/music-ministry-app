import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Image as ImageIcon, RotateCcw, Trash2, Type, Upload } from 'lucide-react';
import {
  WELCOME_CONTENT_DEFAULTS,
  WELCOME_FONT_MAX,
  WELCOME_FONT_MIN,
  WELCOME_MESSAGE_MAX,
  WELCOME_STYLE_DEFAULTS,
  type WelcomeSettings,
} from '../../shared/welcome-settings.js';
import { bridge } from '../live/bridge';
import { useLive } from '../live/store';
import type { MediaAsset } from '../media/types';
import { WelcomeCanvas } from '../output/WelcomeScreen';

const CARD = 'flex flex-col gap-5 rounded-xl border border-stone-800 bg-stone-900 p-6 shadow-lg';
const CARD_TITLE = 'text-base font-black tracking-wide text-stone-100 uppercase';
const SUB = 'text-xs text-stone-400';
const LABEL = 'text-sm font-semibold text-stone-100';
const INPUT = 'rounded-lg border border-stone-800 bg-stone-950 text-sm text-stone-100 outline-none focus:border-amber-500';
const RESET = 'flex shrink-0 items-center gap-1.5 text-[11px] font-bold tracking-wider text-stone-400 uppercase transition-colors hover:text-amber-300 disabled:opacity-40';
const HEX = /^#[0-9a-fA-F]{6}$/;

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * A value the operator types or drags. It shows at once, and saves a moment after the last change, so a save coming back
 * from the main process never overwrites a change still being made.
 */
function useDraft<T>(stored: T, save: (value: T) => void, delay = 150) {
  const [draft, setDraft] = useState(stored);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (timer.current === null) setDraft(stored);
  }, [stored]);
  const change = (value: T) => {
    setDraft(value);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      save(value);
    }, delay);
  };
  return [draft, change] as const;
}

/** A card header: the title and subtitle on the left, and the reset button on the right, over a rule. */
function CardHeader({ title, subtitle, onReset }: { title: string; subtitle: string; onReset: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-stone-800 pb-4">
      <div className="min-w-0">
        <h2 className={CARD_TITLE}>{title}</h2>
        <p className={`mt-1 ${SUB}`}>{subtitle}</p>
      </div>
      <button type="button" onClick={onReset} className={RESET}>
        <RotateCcw size={13} aria-hidden /> Reset to defaults
      </button>
    </div>
  );
}

/** One setting: its label and sub-label on the left, its control on the right. Wraps when the column is narrow. */
function SettingRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className={LABEL}>{label}</div>
        <p className={`mt-0.5 ${SUB}`}>{hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** The welcome message: a full-width box beneath its label. Typing saves a moment after the last keystroke. */
function MessageField({ value, onSave }: { value: string; onSave: (message: string) => void }) {
  const [draft, change] = useDraft(value, onSave, 350);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <div className={LABEL}>Welcome message</div>
        <p className={`mt-0.5 ${SUB}`}>This text will appear in large letters on the welcome screen</p>
      </div>
      <textarea
        value={draft}
        maxLength={WELCOME_MESSAGE_MAX}
        rows={4}
        onChange={(e) => change(e.target.value)}
        className={`${INPUT} w-full resize-y p-3`}
      />
      <span className={SUB}>
        {draft.length} / {WELCOME_MESSAGE_MAX}. A line break starts a new line on the screen.
      </span>
    </div>
  );
}

/** A colour: a swatch to pick with, and a hex box to type into. Only a complete hex value is saved. */
function ColorRow({ label, hint, value, onSave }: { label: string; hint: string; value: string; onSave: (hex: string) => void }) {
  const [draft, change] = useDraft(value, (hex) => {
    if (HEX.test(hex)) onSave(hex.toUpperCase());
  });
  return (
    <SettingRow label={label} hint={hint}>
      <input
        type="color"
        value={value.toLowerCase()}
        aria-label={`${label} picker`}
        onChange={(e) => onSave(e.target.value.toUpperCase())}
        className="h-9 w-10 cursor-pointer rounded-md border border-stone-800 bg-stone-950 p-1"
      />
      <input
        value={draft}
        maxLength={7}
        aria-label={`${label} hex`}
        onChange={(e) => change(e.target.value)}
        className={`${INPUT} h-9 w-28 px-3 font-mono uppercase`}
      />
    </SettingRow>
  );
}

/** The font size: a slider, and a pill showing the size in pixels on the 1920 reference screen. */
function FontSizeRow({ value, onSave }: { value: number; onSave: (px: number) => void }) {
  const [draft, change] = useDraft(value, onSave);
  return (
    <SettingRow label="Font size" hint="Set the welcome message size in pixels.">
      <input
        type="range"
        min={WELCOME_FONT_MIN}
        max={WELCOME_FONT_MAX}
        step={1}
        value={draft}
        aria-label="Font size"
        onChange={(e) => change(Number(e.target.value))}
        className="w-32 accent-amber-400"
      />
      <output aria-label="Font size in pixels" className="min-w-[4rem] rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-center font-mono text-xs font-bold text-amber-300">
        {draft}px
      </output>
    </SettingRow>
  );
}

export function WelcomeScreenSettings() {
  const welcome = useLive((s) => s.state.welcome);
  const [images, setImages] = useState<MediaAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bridge.media
      .list()
      .then((list) => setImages(list.filter((a) => a.mediaType === 'image')))
      .catch(() => undefined);
  }, []);

  /** Saves a change. The live state carries it to the projector and the preview. */
  const update = (patch: Partial<WelcomeSettings>) => {
    setError(null);
    bridge.welcome.save(patch).catch((err) => setError(errorText(err)));
  };

  /** Imports a picture into the Media Library, then uses the newest picture there. */
  const importImage = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.media.importMedia();
      const list = (await bridge.media.list()).filter((a) => a.mediaType === 'image');
      setImages(list);
      if (result.imported > 0 && list.length > 0) {
        const newest = list.reduce((a, b) => (b.id > a.id ? b : a));
        await bridge.welcome.save({ imageUrl: newest.src, welcomeType: 'IMAGE' });
      }
      if (result.failed.length > 0) setError(`Could not import: ${result.failed.join(', ')}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const types: { id: WelcomeSettings['welcomeType']; label: string; icon: typeof Type }[] = [
    { id: 'TEXT', label: 'TEXT MESSAGE', icon: Type },
    { id: 'IMAGE', label: 'IMAGE', icon: ImageIcon },
  ];

  return (
    <div className="flex w-full max-w-7xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-bold tracking-[0.2em] text-stone-500 uppercase">Output</div>
          <h1 className="mt-1 text-4xl font-black tracking-wide text-stone-100 uppercase">Welcome Screen</h1>
          <p className="mt-2 text-sm text-stone-400">What the projector shows before the service starts.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-stone-900 px-3 py-1 text-xs font-semibold text-amber-300/90">
          <CheckCircle2 size={13} aria-hidden /> Changes save automatically
        </span>
      </header>

      {error && (
        <div role="alert" className="rounded-md border border-danger/40 bg-stone-900 px-4 py-2 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-7">
          <section className={CARD} aria-labelledby="welcome-content-heading">
            <CardHeader
              title="Welcome content"
              subtitle="Choose whether the welcome screen uses text or an image."
              onReset={() => update(WELCOME_CONTENT_DEFAULTS)}
            />

            <SettingRow label="Welcome type" hint="Switch between a typed message and an uploaded image.">
              <div role="radiogroup" aria-label="Welcome type" className="inline-flex flex-wrap gap-1 rounded-lg border border-stone-800 bg-stone-950 p-1">
                {types.map(({ id, label, icon: Icon }) => {
                  const on = welcome.welcomeType === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => update({ welcomeType: id })}
                      className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-[11px] font-bold tracking-wider transition-colors ${
                        on ? 'bg-amber-500 text-stone-950 shadow-md shadow-amber-950/40' : 'text-stone-400 hover:text-stone-100'
                      }`}
                    >
                      <Icon size={13} aria-hidden /> {label}
                    </button>
                  );
                })}
              </div>
            </SettingRow>

            {welcome.welcomeType === 'TEXT' ? (
              <MessageField value={welcome.message} onSave={(message) => update({ message })} />
            ) : (
              <div className="flex flex-col gap-3">
                <div>
                  <div className={LABEL}>Welcome image</div>
                  <p className={`mt-0.5 ${SUB}`}>The picture fills the screen, with the background colour behind it.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void importImage()}
                  disabled={busy}
                  className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-stone-700 bg-stone-950 p-6 text-center transition-colors hover:border-amber-500/40 disabled:opacity-40"
                >
                  <Upload size={20} className="text-amber-300" aria-hidden />
                  <span className="text-sm font-bold text-stone-100">{busy ? 'Importing…' : 'Choose an image from your computer'}</span>
                  <span className={SUB}>The picture is added to the Media Library.</span>
                </button>
                {images.length > 0 && (
                  <label className="flex flex-col gap-2">
                    <span className={SUB}>Or use an image already in the Media Library</span>
                    <select
                      value={welcome.imageUrl ?? ''}
                      onChange={(e) => update({ imageUrl: e.target.value || null })}
                      className={`${INPUT} h-9 max-w-full px-3`}
                    >
                      <option value="">None</option>
                      {images.map((m) => (
                        <option key={m.id} value={m.src}>
                          {m.filename}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {welcome.imageUrl && (
                  <button type="button" onClick={() => update({ imageUrl: null })} className={`${RESET} w-fit`}>
                    <Trash2 size={13} aria-hidden /> Remove image
                  </button>
                )}
              </div>
            )}
          </section>

          <section className={CARD} aria-labelledby="welcome-style-heading">
            <CardHeader
              title="Welcome style"
              subtitle="Set the colours and text size used by the welcome screen."
              onReset={() => update(WELCOME_STYLE_DEFAULTS)}
            />
            <ColorRow
              label="Background colour"
              hint="The solid colour behind welcome text and empty areas."
              value={welcome.backgroundColor}
              onSave={(backgroundColor) => update({ backgroundColor })}
            />
            <ColorRow
              label="Text colour"
              hint="The colour used for the welcome message."
              value={welcome.textColor}
              onSave={(textColor) => update({ textColor })}
            />
            <FontSizeRow value={welcome.fontSize} onSave={(fontSize) => update({ fontSize })} />
          </section>
        </div>

        <aside className="flex min-w-0 flex-col lg:col-span-5 lg:self-start">
          <section className={CARD} aria-labelledby="welcome-preview-heading">
            <div className="border-b border-stone-800 pb-4">
              <h2 id="welcome-preview-heading" className={CARD_TITLE}>
                Live preview
              </h2>
              <p className={`mt-1 ${SUB}`}>A scaled mirror of the welcome screen output.</p>
            </div>
            {/* The frame is the same size on any window; the text scales with it, as it does on the projector. */}
            <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-stone-800 bg-stone-950 p-4 [container-type:inline-size]">
              <div className="relative h-full w-full overflow-hidden">
                <WelcomeCanvas settings={welcome} />
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
