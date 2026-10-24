import { useEffect, useMemo, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { useT } from '../i18n/strings';
import { MASS_ORDER, massPartName } from '../liturgy/massOrder';
import { setUi, useUi } from '../state/ui';
import { dispatch } from '../live/store';
import { projectMassPart } from './actions';
import { NAV } from './Sidebar';

interface Command {
  id: string;
  group: string;
  label: string;
  run: () => void;
}

export function CommandPalette() {
  const t = useT();
  const { paletteOpen, lang } = useUi();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const commands = useMemo<Command[]>(() => [
    ...NAV.map((n) => ({ id: `nav-${n.key}`, group: t('palette.go'), label: t(n.label), run: () => setUi({ view: n.key }) })),
    ...MASS_ORDER.map((p) => ({ id: `mass-${p.id}`, group: t('palette.project'), label: massPartName(p, lang), run: () => projectMassPart(p.id) })),
    {
      id: 'l3-parish', group: t('palette.project'), label: `${t('top.lowerThird')} · Assumption Parish Church`,
      run: () => dispatch({ type: 'lowerThird/show', value: { line1: 'Assumption Parish Church', line2: 'Charismatic Music Ministry' } }),
    },
  ], [t, lang]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? commands.filter((c) => c.label.toLowerCase().includes(q)) : commands;
  }, [commands, query]);

  useEffect(() => {
    if (paletteOpen) {
      setQuery('');
      setCursor(0);
    }
  }, [paletteOpen]);

  if (!paletteOpen) return null;

  const close = () => setUi({ paletteOpen: false });
  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    c.run();
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 pt-[14vh]" onClick={close}>
      <div role="dialog" aria-label={t('side.search')} className="w-[560px] overflow-hidden rounded-xl border border-line-strong bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={16} className="text-muted" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
              if (e.key === 'Enter') run(results[cursor]);
            }}
            placeholder={t('palette.placeholder')}
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
          />
          <span className="kbd">Esc</span>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2" role="listbox">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{t('palette.empty')}</li>}
          {results.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === cursor}>
              <button type="button" onMouseEnter={() => setCursor(i)} onClick={() => run(c)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm ${i === cursor ? 'bg-panel-2' : ''}`}>
                <span className="w-16 shrink-0 text-[11px] font-bold tracking-wider text-faint uppercase">{c.group}</span>
                <span className="flex-1 font-semibold">{c.label}</span>
                {i === cursor && <CornerDownLeft size={14} className="text-muted" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
