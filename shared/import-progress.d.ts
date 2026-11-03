export const IMPORT_PROGRESS_CHANNEL: 'powerpoint:import-progress';

export type ImportStage = 'reading' | 'rendering' | 'saving' | 'layers' | 'layerImages' | 'finishing';

/** One report of a PowerPoint import, as sent from the main process to the window that started it. */
export interface ImportProgress {
  /** The slide the current stage is on (0 when the stage does not count slides). */
  currentSlide: number;
  /** The deck's visible slide count (0 until it is known). */
  totalSlides: number;
  /** A whole number from 0 to 100, for the whole import, every file included. */
  percentage: number;
  statusText: string;
  stage: ImportStage;
  fileName: string;
  fileIndex: number;
  fileCount: number;
}

export const STAGES: Record<ImportStage, [number, number]>;
export function statusOf(stage: ImportStage, parts?: { done?: number; total?: number; fileName?: string }): string;
export function progressFor(input: {
  stage: ImportStage;
  done?: number;
  total?: number;
  totalSlides?: number;
  fileName?: string;
  fileIndex?: number;
  fileCount?: number;
}): ImportProgress;
export interface ImportState {
  busy: boolean;
  progress: ImportProgress | null;
}
export type ImportAction = { type: 'start' } | { type: 'progress'; progress: ImportProgress } | { type: 'finish' } | { type: 'fail' };
export const IDLE_IMPORT: Readonly<ImportState>;
export function importReducer(state: ImportState, action: ImportAction): ImportState;
export function successMessage(added: number | null, destination: string): string | null;
export function failureMessage(reason: unknown): string;
export function importLabel(progress: ImportProgress | null): string;
