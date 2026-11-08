// Types for shared/church-key-generator.js. Node and Electron's main process only: it needs node:crypto.
export const KEY_CHARSET: string;
export function generateSetupKey(): string;
export function validateSetupKey(key: string): boolean;
export function generateChurchCode(prefix?: string | null): string;
export function validateChurchCode(code: string): boolean;
