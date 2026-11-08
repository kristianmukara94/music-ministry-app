export type AlertSeverity = 'info' | 'warning' | 'urgent';

/** A Sanctuary Alert as the projector shows it. `expiresAt` (ms) is null for one that stays until dismissed. */
export interface SanctuaryAlert {
  id: string;
  text: string;
  severity: AlertSeverity;
  durationSeconds: number | null;
  shownAt: number;
  expiresAt: number | null;
}

/** What the operator console sends to put an alert live. */
export interface SanctuaryAlertInput {
  id?: string;
  text: string;
  severity?: AlertSeverity;
  durationSeconds?: number | null;
}

export interface AlertPreset {
  id: 'car' | 'nursery' | 'booth';
  icon: string;
  label: string;
  field: { label: string; placeholder: string } | null;
  severity: AlertSeverity;
  durationSeconds: number | null;
}

export const ALERT_TEXT_MAX: number;
export const ALERT_SEVERITIES: AlertSeverity[];
export const ALERT_DURATIONS: (number | null)[];
export const DEFAULT_ALERT_DURATION: number;
export const ALERT_PRESETS: AlertPreset[];
export function formatPlate(raw: unknown): string;
export function formatTag(raw: unknown): string;
export function formatPresetField(presetId: string, raw: unknown): string;
export function presetText(presetId: string, raw: unknown): string;
export function cleanAlertText(raw: unknown): string;
export function sanitizeAlert(value: Partial<SanctuaryAlertInput> | null | undefined, now: number): SanctuaryAlert | null;
export function alertExpired(alert: SanctuaryAlert | null | undefined, now: number): boolean;
export function newAlertId(now?: number): string;
