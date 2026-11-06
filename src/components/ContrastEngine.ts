/**
 * The auto-legibility engine. It measures how bright and how busy a background picture or video is behind each text zone (top banner,
 * centre stanza, lower third), and from that picks the shade over the background and the shadow under the text, so slide text stays
 * readable (WCAG 2.1 4.5:1 and APCA Lc 60; the maths is in shared/contrast.js).
 *
 * Off the projector's main thread: the picture is decoded asynchronously and reduced to 64 x 64 as an ImageBitmap, which is transferred to
 * a worker that draws it on an OffscreenCanvas and reads its pixels. The page only waits on promises. A video is sampled at three points
 * from a hidden, muted copy (never the one on screen, so playback is untouched), and the worst frame is kept.
 *
 * Each background is measured once: results are cached by the asset's URL (`apcc-media://media/<id>`), its fit and the stage's shape, and a
 * second request for one already being measured shares the first. A background that cannot be measured (a TV browser with no
 * OffscreenCanvas, a picture served without CORS) gives null, and the projector keeps its fixed look.
 */
import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { SAMPLE_SIZE, analyzePixels, legibilityPlan, mergeProfiles, type LegibilityPlan, type LuminanceProfile, type ZoneName } from '../../shared/contrast.js';
import type { ContrastRequest, ContrastResponse, SampleFrame } from './contrast.worker';

export type BackgroundAsset = {
  src: string;
  kind: 'image' | 'video';
  /** How the background fills the stage: cropped to cover it, or shown whole with black bars. */
  fit?: 'cover' | 'contain';
  /** The stage's width over its height, so a covering picture is measured as cropped on screen. */
  aspect: number;
};

/** The longest a measurement may take before it is given up (a video that never loads, a stuck seek). */
const MEASURE_TIMEOUT_MS = 10_000;
/** Backgrounds remembered at once. A Mass uses a handful; the oldest is forgotten first. */
const CACHE_LIMIT = 48;

const pending = new Map<string, Promise<LuminanceProfile | null>>();
const resolved = new Map<string, LuminanceProfile | null>();
/** How long the last measurements took in the worker, newest last, for the operator's diagnostics. */
export const recentAnalysisMs: number[] = [];

const keyOf = (a: BackgroundAsset) => `${a.kind}|${a.fit ?? 'cover'}|${a.aspect.toFixed(3)}|${a.src}`;

function remember(key: string, profile: LuminanceProfile | null) {
  resolved.delete(key);
  resolved.set(key, profile);
  while (resolved.size > CACHE_LIMIT) resolved.delete(resolved.keys().next().value as string);
}

/** The cached measurement of a background: a profile, null when it could not be measured, or undefined when it has not been measured yet. */
export function cachedProfile(asset: BackgroundAsset): LuminanceProfile | null | undefined {
  return resolved.get(keyOf(asset));
}

/** Measures a background, once per asset: a later call gets the cached result, and a call during a measurement shares it. */
export function measureBackground(asset: BackgroundAsset): Promise<LuminanceProfile | null> {
  const key = keyOf(asset);
  if (resolved.has(key)) return Promise.resolve(resolved.get(key) ?? null);
  const running = pending.get(key);
  if (running) return running;
  const job = withTimeout(capture(asset).then(analyse), MEASURE_TIMEOUT_MS)
    .then(
      (profile) => {
        remember(key, profile);
        return profile;
      },
      (err: unknown) => {
        console.warn('[legibility] could not measure the background, so the fixed look is kept', { src: asset.src, error: err instanceof Error ? err.message : String(err) });
        // A picture that cannot be read (no CORS, a broken file) stays unmeasured. A slow load or a worker that died is tried again next time.
        if (!(err instanceof RetryLater)) remember(key, null);
        return null;
      },
    )
    .finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

/** Forgets every measurement. For tests, and for a background file replaced in place under the same id. */
export function clearLegibilityCache() {
  resolved.clear();
}

/** A failure worth another try later: a timeout, or the worker stopping. */
class RetryLater extends Error {}

// --- Capture: decode and reduce to 64 x 64, asynchronously -------------------------------------------------------------------------

type Frame = SampleFrame;
type Rect = SampleFrame['rect'];

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RetryLater(`timed out after ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * The part of the source that shows on the stage, and where it lands in the sample. Cover crops the source's middle to the stage's shape;
 * contain keeps all of it and places it, smaller, in the middle of the sample.
 */
function placement(width: number, height: number, asset: BackgroundAsset): { crop: Rect; rect: Rect } {
  const full: Rect = { x: 0, y: 0, w: SAMPLE_SIZE, h: SAMPLE_SIZE };
  const ratio = width / height;
  if ((asset.fit ?? 'cover') === 'cover') {
    if (ratio > asset.aspect) {
      const w = height * asset.aspect;
      return { crop: { x: (width - w) / 2, y: 0, w, h: height }, rect: full };
    }
    const h = width / asset.aspect;
    return { crop: { x: 0, y: (height - h) / 2, w: width, h }, rect: full };
  }
  const whole: Rect = { x: 0, y: 0, w: width, h: height };
  if (ratio > asset.aspect) {
    const h = (SAMPLE_SIZE * asset.aspect) / ratio;
    return { crop: whole, rect: { x: 0, y: (SAMPLE_SIZE - h) / 2, w: SAMPLE_SIZE, h } };
  }
  const w = (SAMPLE_SIZE * ratio) / asset.aspect;
  return { crop: whole, rect: { x: (SAMPLE_SIZE - w) / 2, y: 0, w, h: SAMPLE_SIZE } };
}

async function reduce(source: HTMLImageElement | HTMLVideoElement, width: number, height: number, asset: BackgroundAsset): Promise<Frame> {
  const { crop, rect } = placement(width, height, asset);
  const bitmap = await createImageBitmap(source, Math.round(crop.x), Math.round(crop.y), Math.max(1, Math.round(crop.w)), Math.max(1, Math.round(crop.h)), {
    resizeWidth: Math.max(1, Math.round(rect.w)),
    resizeHeight: Math.max(1, Math.round(rect.h)),
    resizeQuality: 'low',
  });
  return { bitmap, rect };
}

async function capture(asset: BackgroundAsset): Promise<Frame[]> {
  if (typeof createImageBitmap !== 'function') throw new Error('createImageBitmap is not available');
  return asset.kind === 'video' ? captureVideo(asset) : [await captureImage(asset)];
}

async function captureImage(asset: BackgroundAsset): Promise<Frame> {
  const img = new Image();
  // The media protocol sends Access-Control-Allow-Origin, so a CORS request keeps the pixels readable.
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.src = asset.src;
  await img.decode();
  return reduce(img, img.naturalWidth, img.naturalHeight, asset);
}

function once(target: EventTarget, ok: string, fail = 'error'): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      target.removeEventListener(ok, done);
      target.removeEventListener(fail, bad);
      resolve();
    };
    const bad = () => {
      target.removeEventListener(ok, done);
      target.removeEventListener(fail, bad);
      reject(new Error(`media ${fail}`));
    };
    target.addEventListener(ok, done);
    target.addEventListener(fail, bad);
  });
}

/** Three frames of a video: near its start, its middle and near its end. A hidden muted copy is used and released afterwards. */
async function captureVideo(asset: BackgroundAsset): Promise<Frame[]> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  const frames: Frame[] = [];
  try {
    const loaded = once(video, 'loadeddata');
    video.src = asset.src;
    await loaded;
    const d = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const times = d > 0 ? [Math.min(1, d * 0.1), d * 0.5, d * 0.85] : [0];
    for (const t of times) {
      if (Math.abs(video.currentTime - t) > 0.01) {
        const seeked = once(video, 'seeked');
        video.currentTime = t;
        await seeked;
      }
      frames.push(await reduce(video, video.videoWidth, video.videoHeight, asset));
    }
    return frames;
  } catch (err) {
    for (const f of frames) f.bitmap.close();
    throw err;
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

// --- Analysis: in the worker, or here when there is none --------------------------------------------------------------------------

const WORKER_FAILED = 'worker failed';
let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, (r: ContrastResponse) => void>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new Error('no worker or OffscreenCanvas');
    const w = new Worker(new URL('./contrast.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (event: MessageEvent<ContrastResponse>) => {
      const reply = waiting.get(event.data.id);
      waiting.delete(event.data.id);
      reply?.(event.data);
    };
    // A worker that cannot start (blocked by the page's policy, say) is dropped, and the ones waiting on it are measured here instead.
    w.onerror = (event) => {
      event.preventDefault();
      console.warn('[legibility] the worker failed, measuring on the page instead', event.message);
      worker = null;
      for (const [id, reply] of waiting) reply({ id, profile: null, ms: 0, error: WORKER_FAILED });
      waiting.clear();
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

/** The same measurement on the page, for when there is no worker. 64 x 64 pixels: well under a millisecond. */
function analyseHere(frames: Frame[]): LuminanceProfile | null {
  const start = performance.now();
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE) : Object.assign(document.createElement('canvas'), { width: SAMPLE_SIZE, height: SAMPLE_SIZE });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return null;
  const profiles = frames.map((f) => {
    ctx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    ctx.drawImage(f.bitmap, f.rect.x, f.rect.y, f.rect.w, f.rect.h);
    f.bitmap.close();
    return analyzePixels(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data, SAMPLE_SIZE, SAMPLE_SIZE);
  });
  note(performance.now() - start);
  return mergeProfiles(profiles);
}

function note(ms: number) {
  recentAnalysisMs.push(Math.round(ms * 1000) / 1000);
  if (recentAnalysisMs.length > 20) recentAnalysisMs.shift();
}

async function analyse(frames: Frame[]): Promise<LuminanceProfile | null> {
  const w = getWorker();
  if (!w) return analyseHere(frames);
  const id = nextId++;
  const reply = await new Promise<ContrastResponse>((resolve) => {
    waiting.set(id, resolve);
    const request: ContrastRequest = { id, frames };
    w.postMessage(request, frames.map((f) => f.bitmap));
  });
  if (reply.error === WORKER_FAILED) throw new RetryLater('the worker stopped while measuring');
  if (reply.error) throw new Error(reply.error);
  note(reply.ms);
  return reply.profile;
}

// --- React: the plan for what is on screen, and the styles it gives ----------------------------------------------------------------

/**
 * The legibility plan for a background: null until it has been measured, when it cannot be, or when `enabled` is off. It is worked out
 * again at once (no new measurement) when only the text colour changes.
 */
export function useBackgroundLegibility(asset: BackgroundAsset | null, textColor: string | null | undefined, enabled: boolean): LegibilityPlan | null {
  const key = asset && enabled && asset.src ? keyOf(asset) : null;
  const [measured, setMeasured] = useState<{ key: string; profile: LuminanceProfile | null } | null>(null);
  useEffect(() => {
    if (!key || !asset) return;
    let live = true;
    void measureBackground(asset).then((profile) => {
      if (live) setMeasured({ key, profile });
    });
    return () => {
      live = false;
    };
    // The asset object is rebuilt on every render; its key is what identifies it.
  }, [key]);
  const profile = !key ? null : measured?.key === key ? measured.profile : resolved.get(key) ?? null;
  return useMemo(() => (profile ? legibilityPlan(profile, textColor) : null), [profile, textColor]);
}

/** Which surface's background the plan was measured from: the Media Library background, the Live set's slide background, or the Welcome one. */
export type ShadeTarget = 'library' | 'slide' | 'welcome';

export type ShadeChoice = {
  /** The shade per zone for the background that was measured, or null when none was. */
  measured: { target: ShadeTarget; scrim: Record<ZoneName, number> } | null;
  /** Auto-legibility off: this one shade for every background, 0 to 1. Null when auto is on. */
  manual: number | null;
};

/** The projector's shade choice, for the layers inside it. Outside the projector (an editor preview) there is none, and the fixed look is drawn. */
export const LegibilityContext = createContext<ShadeChoice | null>(null);

/** The shade per zone for one surface's background, or null to keep that surface's fixed shade. */
export function useShade(target: ShadeTarget): Record<ZoneName, number> | null {
  const choice = useContext(LegibilityContext);
  if (!choice) return null;
  if (choice.manual !== null) return { top: choice.manual, center: choice.manual, lower: choice.manual };
  return choice.measured && choice.measured.target === target ? choice.measured.scrim : null;
}

const SHADE_TRANSITION = '--apcc-scrim-top 600ms ease, --apcc-scrim-center 600ms ease, --apcc-scrim-lower 600ms ease';

/**
 * A full-height shade as a top-to-bottom gradient: each text zone gets its own darkness, and the change from one background's shade to the
 * next is eased (the custom properties are registered in styles.css, so they animate). `fallback` is the surface's fixed shade.
 */
export function gradientShadeStyle(shade: Record<ZoneName, number> | null, fallback: number): CSSProperties {
  const s = shade ?? { top: fallback, center: fallback, lower: fallback };
  return {
    '--apcc-scrim-top': String(s.top),
    '--apcc-scrim-center': String(s.center),
    '--apcc-scrim-lower': String(s.lower),
    backgroundImage:
      'linear-gradient(to bottom, rgb(0 0 0 / var(--apcc-scrim-top)) 0%, rgb(0 0 0 / var(--apcc-scrim-top)) 14%, rgb(0 0 0 / var(--apcc-scrim-center)) 50%, rgb(0 0 0 / var(--apcc-scrim-lower)) 86%, rgb(0 0 0 / var(--apcc-scrim-lower)) 100%)',
    transition: SHADE_TRANSITION,
  } as CSSProperties;
}

/** A flat shade behind one text box (the centre zone's), eased like the gradient. */
export function boxShadeStyle(shade: Record<ZoneName, number> | null, fallback: number): CSSProperties {
  return {
    '--apcc-scrim-center': String(shade ? shade.center : fallback),
    backgroundColor: 'rgb(0 0 0 / var(--apcc-scrim-center))',
    transition: SHADE_TRANSITION,
  } as CSSProperties;
}

/**
 * The text shadow and outline for a plan, as custom properties set on the stage and read by the `apcc-legible` classes in styles.css. No
 * plan gives none, and the classes fall back to the fixed shadow. Advanced mode's own shadow and outline are drawn over these.
 */
export function legibilityShadowVars(plan: LegibilityPlan | null): Record<string, string> {
  if (!plan) return {};
  const { blurPx, alpha, strokeAlpha } = plan.shadow;
  return {
    '--apcc-legible-blur': `${blurPx}px`,
    '--apcc-legible-alpha': String(alpha),
    // The lyric slide's two-layer text shadow, grown the same way (its fixed form is 14px at 0.85).
    '--apcc-legible-text-shadow': `0 2px ${(blurPx + 2).toFixed(1)}px rgba(0,0,0,${Math.max(0, alpha - 0.1).toFixed(2)}), 0 0 3px rgba(0,0,0,0.6)`,
    '--apcc-legible-stroke': strokeAlpha > 0 ? `0.06cqw rgba(0,0,0,${strokeAlpha})` : '0 transparent',
  };
}
