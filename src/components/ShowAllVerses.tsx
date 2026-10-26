import { setUi, useUi } from '../state/ui';

/**
 * The "Show all verses" checkbox, shared by the Lyrics module and the Praise & Worship screens. Off by default. The
 * setting lives in the UI store, which is not persisted, so a restart resets it.
 */
export function ShowAllVerses({ label }: { label: string }) {
  const showAll = useUi((s) => s.showAllVerses);
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold">
      <input
        type="checkbox"
        checked={showAll}
        onChange={(e) => setUi({ showAllVerses: e.target.checked })}
        className="size-4 accent-[var(--color-accent)]"
      />
      {label}
    </label>
  );
}
