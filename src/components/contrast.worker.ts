// The auto-legibility worker: draws each 64 x 64 frame the page sends onto an OffscreenCanvas, reads its pixels and measures its text zones,
// off the projector's main thread. Frames arrive as ImageBitmaps, already reduced, and are transferred, so nothing is copied.
// Transparent pixels (the bars round a contained picture) count as black, which is what the projector shows there.
import { SAMPLE_SIZE, analyzePixels, mergeProfiles } from '../../shared/contrast.js';
import type { LuminanceProfile } from '../../shared/contrast.js';

/** One frame, reduced, and where it sits in the 64 x 64 sample in sample pixels. A contained (letterboxed) picture leaves black bars round it. */
export type SampleFrame = { bitmap: ImageBitmap; rect: { x: number; y: number; w: number; h: number } };
export type ContrastRequest = { id: number; frames: SampleFrame[] };
export type ContrastResponse = { id: number; profile: LuminanceProfile | null; ms: number; error?: string };

// The project compiles against the DOM library, not the worker one (the two clash), so the worker's scope is typed here by hand.
const scope = self as unknown as { onmessage: ((event: MessageEvent<ContrastRequest>) => void) | null; postMessage(message: ContrastResponse): void };
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

scope.onmessage = (event: MessageEvent<ContrastRequest>) => {
  const { id, frames } = event.data;
  const start = performance.now();
  try {
    canvas ??= new OffscreenCanvas(SAMPLE_SIZE, SAMPLE_SIZE);
    ctx ??= canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    const profiles: LuminanceProfile[] = [];
    for (const frame of frames) {
      ctx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
      ctx.drawImage(frame.bitmap, frame.rect.x, frame.rect.y, frame.rect.w, frame.rect.h);
      frame.bitmap.close();
      profiles.push(analyzePixels(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data, SAMPLE_SIZE, SAMPLE_SIZE));
    }
    const reply: ContrastResponse = { id, profile: mergeProfiles(profiles), ms: performance.now() - start };
    scope.postMessage(reply);
  } catch (err) {
    for (const frame of frames) frame.bitmap.close();
    const reply: ContrastResponse = { id, profile: null, ms: performance.now() - start, error: err instanceof Error ? err.message : String(err) };
    scope.postMessage(reply);
  }
};
