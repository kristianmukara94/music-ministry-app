import {
  MEDIA_EDIT_REFERENCE_WIDTH,
  buildMediaFilterCss,
  buildMediaOverlays,
  mediaTransformParts,
  normalizeMediaEditSettings,
  type MediaEditSettings,
} from '../../shared/media-editor.js';

type Source = HTMLImageElement | HTMLVideoElement;

const sizeOf = (el: Source) =>
  el instanceof HTMLVideoElement ? { w: el.videoWidth, h: el.videoHeight } : { w: el.naturalWidth, h: el.naturalHeight };

/** The source's rectangle inside a W×H box for a fit mode, centred, as `object-fit` places it. */
function fittedRect(w: number, h: number, W: number, H: number, fit: MediaEditSettings['fitMode']) {
  if (fit === 'fill') return { x: 0, y: 0, w: W, h: H };
  const k = fit === 'cover' ? Math.max(W / w, H / h) : Math.min(W / w, H / h);
  const dw = w * k;
  const dh = h * k;
  return { x: (W - dw) / 2, y: (H - dh) / 2, w: dw, h: dh };
}

const BLEND: Record<string, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  'soft-light': 'soft-light',
};

/**
 * Draws a picture (or a video's current frame) with its edits into a 16:9 canvas, through the same numbers the screens use: object-fit,
 * the transform, the CSS filter chain (canvas 2D takes the same string), then the warmth wash, tint and vignette. The output is 1920×1080,
 * or up to 3840×2160 for a larger source.
 */
export function renderEditedToCanvas(source: Source, edit: MediaEditSettings): HTMLCanvasElement {
  const s = normalizeMediaEditSettings(edit);
  const { w, h } = sizeOf(source);
  if (!w || !h) throw new Error('The picture has not loaded yet.');
  const k = Math.min(2, Math.max(1, w / MEDIA_EDIT_REFERENCE_WIDTH));
  const W = Math.round(MEDIA_EDIT_REFERENCE_WIDTH * k);
  const H = Math.round((W * 9) / 16);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const scale = W / MEDIA_EDIT_REFERENCE_WIDTH;
  const t = mediaTransformParts(s);
  const blurPx = s.blur * scale;
  const bleed = blurPx > 0 ? 1 + (blurPx * 4) / W : 1;
  const r = fittedRect(w, h, W, H, s.fitMode);

  ctx.save();
  const filter = buildMediaFilterCss(s, { scale });
  ctx.filter = filter === 'none' ? 'none' : filter;
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  // Same order as the CSS: translate (a share of the box), scale, rotate, flip, about the box's centre. The bleed is outermost.
  ctx.translate(W / 2, H / 2);
  ctx.scale(bleed, bleed);
  ctx.translate((t.translateX / 100) * W, (t.translateY / 100) * H);
  ctx.scale(t.scale, t.scale);
  ctx.rotate((t.rotate * Math.PI) / 180);
  ctx.scale(t.flipX, t.flipY);
  ctx.drawImage(source, r.x - W / 2, r.y - H / 2, r.w, r.h);
  ctx.restore();

  for (const layer of buildMediaOverlays(s)) {
    ctx.save();
    if (layer.kind === 'vignette') {
      // CSS `radial-gradient(ellipse at center, …)` reaches the farthest corner: an ellipse with the box's shape, √2 times its half-size.
      const inner = (layer.inner ?? 50) / 100;
      ctx.translate(W / 2, H / 2);
      ctx.scale((W / 2) * Math.SQRT2, (H / 2) * Math.SQRT2);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(Math.min(0.99, Math.max(0, inner)), 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${layer.strength ?? 0})`);
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, 2, 2);
    } else {
      ctx.globalCompositeOperation = BLEND[layer.blendMode] ?? 'source-over';
      ctx.globalAlpha = layer.opacity ?? 1;
      ctx.fillStyle = layer.color ?? '#000';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }
  return canvas;
}

export function canvasBytes(canvas: HTMLCanvasElement, type: 'image/png' | 'image/jpeg' = 'image/png', quality = 0.9): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject) : reject(new Error('Could not encode the picture.'))),
      type,
      quality,
    ),
  );
}

/** The video's current frame as a library thumbnail: 480 wide, JPEG, as the importer makes them. */
export async function captureVideoThumbnail(video: HTMLVideoElement): Promise<Uint8Array> {
  if (!video.videoWidth || !video.videoHeight) throw new Error('The video has not loaded yet.');
  const width = Math.min(480, video.videoWidth);
  const height = Math.round((width * video.videoHeight) / video.videoWidth);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');
  ctx.drawImage(video, 0, 0, width, height);
  return canvasBytes(canvas, 'image/jpeg', 0.85);
}
