import { useEffect, useState } from 'react';
import { useT, type StringKey } from '../i18n/strings';
import { setUi, useUi, type HotkeyAction } from '../state/ui';
import { Panel } from './Panel';

const ROWS: { action: HotkeyAction; label: StringKey }[] = [
  { action: 'announcements', label: 'keys.announcements' },
  { action: 'welcome', label: 'keys.welcome' },
  { action: 'blackout', label: 'keys.blackout' },
  { action: 'clear', label: 'keys.clear' },
];

export function KeyboardMap() {
  const t = useT();
  const keymap = useUi((s) => s.keymap);
  const [capturing, setCapturing] = useState<HotkeyAction | null>(null);

  useEffect(() => {
    setUi({ capturingHotkey: capturing !== null });
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key !== 'Escape') {
        // A key can only drive one action: unbind it elsewhere first.
        const next = { ...useUi.getState().keymap };
        for (const a of Object.keys(next) as HotkeyAction[]) if (next[a] === e.key) next[a] = '';
        next[capturing] = e.key;
        setUi({ keymap: next });
      }
      setCapturing(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [capturing]);

  return (
    <Panel eyebrow={t('keys.eyebrow')} title={t('keys.title')}>
      <ul className="flex flex-col gap-2 p-4">
        {ROWS.map(({ action, label }) => (
          <li key={action} className="flex h-10 items-center justify-between rounded-md border border-line-strong px-3">
            <span className="text-xs font-medium text-fg/80">{t(label)}</span>
            <button type="button" onClick={() => setCapturing(action)} title="Reassign"
              className={`min-w-10 rounded-md border border-zinc-500/70 bg-gradient-to-b from-zinc-600/60 via-zinc-800 to-zinc-950 px-2.5 py-1 text-center font-mono text-[11px] font-bold tracking-wider text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_3px_rgba(0,0,0,0.7)] hover:border-zinc-300 ${
                capturing === action ? 'animate-pulse border-accent text-accent' : ''
              }`}>
              {capturing === action ? t('keys.press') : keymap[action] || '—'}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 px-4 pb-3 text-[11px] leading-normal font-normal text-fg/50">{t('keys.hint')}</p>
    </Panel>
  );
}
