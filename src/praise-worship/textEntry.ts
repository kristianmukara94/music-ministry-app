/** True for a place where typing goes: a text field, a text area, a select, or an editable node. Space and the arrows there belong to the text. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
