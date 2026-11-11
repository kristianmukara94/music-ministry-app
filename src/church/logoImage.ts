// Reading, framing and exporting the parish logo. Everything runs in the window: the main process only ever receives a square PNG, so an
// SVG's scripts or a huge photo never reach the disk.

/** The side, in pixels, of the PNG that is saved. Sharp on a 1080p projector's idle screen, and small on disk. */
export const LOGO_OUTPUT_SIZE = 512;
/** The largest file the operator can pick. */
export const LOGO_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
/** For the file picker's `accept`. */
export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg';

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };
/** An SVG with no size of its own is drawn at this size. */
const SVG_FALLBACK_SIDE = 1024;
/** How much of the square the logo fills after Auto-center, so it never touches the edge of a round tile. */
const AUTO_FILL = 0.88;

/** How the image sits in the square: `zoom` 1 fits the whole image; offsets move its centre, as a share of the square's side. */
export interface LogoFrame {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export const FRAME_FIT: LogoFrame = { zoom: 1, offsetX: 0, offsetY: 0 };
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 5;

export interface LoadedLogo {
  image: HTMLImageElement;
  width: number;
  height: number;
  name: string;
}

/** Checks the file's type and size. Returns a message to show, or null when it can be used. */
export function checkLogoFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const known = Object.values(TYPES).includes(file.type) || ext in TYPES;
  if (!known) return 'Choose a PNG, JPG, WEBP or SVG image.';
  if (file.size > LOGO_UPLOAD_MAX_BYTES) return 'That image is larger than 10 MB. Choose a smaller file.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

/**
 * Reads the file as a data URL (the window's content policy allows data: images, not blob:) and loads it. Rejects with a message to show.
 */
export async function loadLogoFile(file: File): Promise<LoadedLogo> {
  const problem = checkLogoFile(file);
  if (problem) throw new Error(problem);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
  // onload rather than decode(): decode() has been seen never to settle in this Electron version.
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That file could not be opened as an image.'));
    img.src = dataUrl;
  });
  // An SVG without width and height reports no size. It is drawn at a fixed size, keeping its shape when it has a viewBox.
  let width = image.naturalWidth;
  let height = image.naturalHeight;
  if (!width || !height) {
    width = SVG_FALLBACK_SIDE;
    height = SVG_FALLBACK_SIDE;
  }
  return { image, width, height, name: file.name };
}

/** Draws the logo into a square canvas of `side` pixels, framed as `frame` says. Transparent where the image is not. */
export function drawLogo(canvas: HTMLCanvasElement, logo: LoadedLogo, frame: LogoFrame, side = canvas.width) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scale = (side / Math.max(logo.width, logo.height)) * frame.zoom;
  const w = logo.width * scale;
  const h = logo.height * scale;
  const cx = side / 2 + frame.offsetX * side;
  const cy = side / 2 + frame.offsetY * side;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(logo.image, cx - w / 2, cy - h / 2, w, h);
}

/**
 * The frame that centres what is actually drawn: transparent margins are ignored, so a logo exported with wide padding still fills the
 * tile. An image with no transparency is simply fitted.
 */
export function autoCenterFrame(logo: LoadedLogo): LogoFrame {
  const sample = 256;
  const canvas = document.createElement('canvas');
  const scale = sample / Math.max(logo.width, logo.height);
  canvas.width = Math.max(1, Math.round(logo.width * scale));
  canvas.height = Math.max(1, Math.round(logo.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return FRAME_FIT;
  ctx.drawImage(logo.image, 0, 0, canvas.width, canvas.height);
  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    // A canvas the browser will not read back (an SVG with foreign content): fitting is the safe answer.
    return FRAME_FIT;
  }
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return FRAME_FIT;
  // Back to the image's own pixels.
  const box = { x: minX / scale, y: minY / scale, w: (maxX - minX + 1) / scale, h: (maxY - minY + 1) / scale };
  const fit = 1 / Math.max(logo.width, logo.height);
  const zoom = clampZoom(AUTO_FILL / (Math.max(box.w, box.h) * fit));
  const k = fit * zoom;
  return {
    zoom,
    offsetX: -(box.x + box.w / 2 - logo.width / 2) * k,
    offsetY: -(box.y + box.h / 2 - logo.height / 2) * k,
  };
}

/** The frame where the image covers the whole square, cropping the longer side. */
export function fillFrame(logo: LoadedLogo): LogoFrame {
  return { zoom: clampZoom(Math.max(logo.width, logo.height) / Math.min(logo.width, logo.height)), offsetX: 0, offsetY: 0 };
}

export const clampZoom = (zoom: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));

/** The framed logo as PNG bytes, ready to save. Rejects with a message to show. */
export async function exportLogoPng(logo: LoadedLogo, frame: LogoFrame): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = LOGO_OUTPUT_SIZE;
  canvas.height = LOGO_OUTPUT_SIZE;
  drawLogo(canvas, logo, frame);
  const blob = await new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob(resolve, 'image/png');
    } catch {
      resolve(null);
    }
  });
  if (!blob) throw new Error('This image could not be prepared. If it is an SVG, export it as a PNG and try again.');
  return new Uint8Array(await blob.arrayBuffer());
}

/** The framed logo as a data URL, for the live previews. Null when the browser refuses to read the canvas back. */
export function previewLogo(logo: LoadedLogo, frame: LogoFrame, side = 256): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  drawLogo(canvas, logo, frame);
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
