/**
 * An error as the operator should read it. A failed call to the main process arrives as "Error invoking remote method 'x': Error: <message>";
 * only the message is of use to the operator.
 */
export function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '');
}
