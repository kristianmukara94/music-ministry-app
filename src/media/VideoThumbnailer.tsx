import { useEffect } from 'react';

/** Seconds into the video for the still. Early enough to be fast, past any black lead-in. */
// The still is taken one second in, past any black lead-in. A clip shorter than that uses its first frame.
const THUMB_SECONDS = 1.0;
const POSTER_WIDTH = 640;
const POSTER_HEIGHT = 360;
const THUMB_MAX_WIDTH = 640;
const SEEK_TIMEOUT_MS = 20_000;

/**
 * Hidden route loaded by electron/video-thumbnailer.js. Plays the video just far enough
 * to decode one frame, draws it to a canvas, and returns it as JPEG. No ffmpeg needed.
 */
export function VideoThumbnailer() {
  useEffect(() => {
    const thumb = window.apcc?.thumb;
    if (!thumb) return;
    return thumb.onJob(async ({ jobId, src, kind }) => {
      try {
        const jpeg = kind === 'poster' ? await drawPoster() : kind === 'image' ? await captureImage(src) : await captureStill(src);
        thumb.finish({ jobId, jpeg });
      } catch (err) {
        thumb.finish({ jobId, error: err instanceof Error ? err.message : String(err) });
      }
    });
  }, []);

  return null;
}

/**
 * The stand-in for a video whose frame cannot be read: a dark 16:9 poster with a play mark. It needs no file, so it always works.
 */
async function drawPoster(): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  context.fillStyle = '#141014';
  context.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
  const cx = POSTER_WIDTH / 2;
  const cy = POSTER_HEIGHT / 2;
  const r = POSTER_HEIGHT * 0.22;
  context.fillStyle = 'rgba(255, 255, 255, 0.7)';
  context.beginPath();
  context.moveTo(cx - r * 0.6, cy - r);
  context.lineTo(cx + r, cy);
  context.lineTo(cx - r * 0.6, cy + r);
  context.closePath();
  context.fill();
  return encodeJpeg(canvas);
}

async function encodeJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((ok, bad) =>
    canvas.toBlob((b) => (b ? ok(b) : bad(new Error('Could not encode the image.'))), 'image/jpeg', 0.85),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * A still image the native decoder cannot read (WebP). The browser decodes it, and the picture is drawn to a canvas
 * at thumbnail width and encoded as JPEG. A file the browser cannot decode rejects, which the main process reports.
 */
async function captureImage(src: string): Promise<Uint8Array> {
  const image = new Image();
  // Cross-origin, so the canvas is not tainted. The protocol sends Access-Control-Allow-Origin.
  image.crossOrigin = 'anonymous';
  image.src = src;
  await image.decode();

  const width = Math.min(image.naturalWidth, THUMB_MAX_WIDTH);
  const height = Math.round((width * image.naturalHeight) / image.naturalWidth);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  context.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob>((ok, bad) =>
    canvas.toBlob((b) => (b ? ok(b) : bad(new Error('Could not encode the image.'))), 'image/jpeg', 0.85),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

function captureStill(src: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    // Cross-origin, so the canvas is not tainted. The protocol sends Access-Control-Allow-Origin.
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    const timer = window.setTimeout(() => fail('Timed out reading the video.'), SEEK_TIMEOUT_MS);
    const finish = () => {
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
    };
    const fail = (message: string) => {
      finish();
      reject(new Error(message));
    };

    video.onerror = () => fail('The video could not be decoded.');
    video.onloadedmetadata = () => {
      // Very short clips have no frame at 0.5s, so take the first one.
      video.currentTime = video.duration > THUMB_SECONDS ? THUMB_SECONDS : 0;
    };
    video.onseeked = async () => {
      try {
        if (!video.videoWidth || !video.videoHeight) return fail('The video has no picture track.');
        const width = Math.min(video.videoWidth, THUMB_MAX_WIDTH);
        const height = Math.round((width * video.videoHeight) / video.videoWidth);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) return fail('Canvas is unavailable.');
        context.drawImage(video, 0, 0, width, height);

        const blob = await new Promise<Blob>((ok, bad) =>
          canvas.toBlob((b) => (b ? ok(b) : bad(new Error('Could not encode the frame.'))), 'image/jpeg', 0.85),
        );
        finish();
        resolve(new Uint8Array(await blob.arrayBuffer()));
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
    };
    video.src = src;
  });
}
