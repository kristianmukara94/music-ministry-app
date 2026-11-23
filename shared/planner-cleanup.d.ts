export type CleanupPlanType = 'all' | 'mass' | 'pw';
export interface CleanupPlanRef {
  id: number;
  liturgicalDate: string;
}
export interface CleanupFilter {
  year: number;
  /** 0 (January) to 11. Null or absent: the entire year. An empty list matches nothing. */
  months?: number[] | null;
  planType?: CleanupPlanType;
}
export const CLEANUP_PLAN_TYPES: readonly CleanupPlanType[];
export const CLEANUP_DISMISS_KEY: string;
export function planYear(iso: unknown): number | null;
export function planMonth(iso: unknown): number | null;
export function cleanupPlanType(value: unknown): CleanupPlanType;
export function cleanupMonths(value: unknown): number[] | null;
export function matchCleanup<M extends CleanupPlanRef, P extends CleanupPlanRef>(plans: { mass?: readonly M[]; pw?: readonly P[] }, filter: CleanupFilter): { mass: M[]; pw: P[] };
export function monthCounts(plans: { mass?: readonly CleanupPlanRef[]; pw?: readonly CleanupPlanRef[] }, year: number, planType?: CleanupPlanType): number[];
export function yearOptions(plans: { mass?: readonly CleanupPlanRef[]; pw?: readonly CleanupPlanRef[] }, extraYears?: readonly number[]): { year: number; count: number }[];
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function readDismissedYear(storage: StorageLike | null | undefined): number | null;
export function dismissCleanupPrompt(storage: StorageLike | null | undefined, year: number): boolean;
export function annualCleanupPrompt(plans: { mass?: readonly CleanupPlanRef[]; pw?: readonly CleanupPlanRef[] }, currentYear: number, dismissedYear: number | null): { show: boolean; count: number; year: number | null };
export function cleanupScopeLabel(year: number, months: readonly number[] | null | undefined, monthNames: readonly string[]): string;
