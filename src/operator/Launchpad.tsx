import { useState, type FormEvent } from 'react';
import { ExternalLink, Plus, X, Zap } from 'lucide-react';
import { useT } from '../i18n/strings';
import { MASS_ORDER, massPartName } from '../liturgy/massOrder';
import { setUi, useUi, type LaunchItem } from '../state/ui';
import { runLaunchItem } from './actions';
import { Panel } from './Panel';

function AddForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const lang = useUi((s) => s.lang);
  const [kind, setKind] = useState<LaunchItem['kind']>('massPart');
  const [label, setLabel] = useState('');
  const [target, setTarget] = useState(MASS_ORDER[0].id);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!target.trim()) return;
    const fallback = kind === 'massPart' ? massPartName(MASS_ORDER.find((p) => p.id === target)!, lang) : target;
    const item: LaunchItem = { id: crypto.randomUUID(), kind, target: target.trim(), label: label.trim() || fallback };
    setUi({ launchpad: [...useUi.getState().launchpad, item] });
    onDone();
  };

  const field = 'h-9 w-full rounded-md border border-line-strong bg-canvas px-3 text-sm outline-none focus:border-accent';
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 p-4">
      <div className="flex gap-2">
        {(['massPart', 'open'] as const).map((k) => (
          <button key={k} type="button" onClick={() => { setKind(k); setTarget(k === 'massPart' ? MASS_ORDER[0].id : ''); }}
            className={`rounded-md px-3 py-1.5 text-xs font-bold uppercase ${kind === k ? 'bg-fg text-on-accent' : 'border border-line-strong text-muted'}`}>
            {k === 'massPart' ? t('pad.massPart') : t('pad.link')}
          </button>
        ))}
      </div>
      <input className={field} placeholder={t('pad.label')} value={label} onChange={(e) => setLabel(e.target.value)} />
      {kind === 'massPart' ? (
        <select className={field} value={target} onChange={(e) => setTarget(e.target.value)}>
          {MASS_ORDER.map((p) => <option key={p.id} value={p.id}>{massPartName(p, lang)}</option>)}
        </select>
      ) : (
        <input className={field} placeholder={t('pad.target')} value={target} onChange={(e) => setTarget(e.target.value)} required />
      )}
      <div className="mt-1 flex justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-md px-3 py-2 text-xs font-bold uppercase text-muted hover:text-fg">{t('pad.cancel')}</button>
        <button type="submit" className="rounded-md bg-accent px-4 py-2 text-xs font-extrabold uppercase text-on-accent">{t('pad.add')}</button>
      </div>
    </form>
  );
}

export function Launchpad() {
  const t = useT();
  const items = useUi((s) => s.launchpad);
  const [adding, setAdding] = useState(false);

  const remove = (id: string) => setUi({ launchpad: items.filter((i) => i.id !== id) });

  let body;
  if (adding) {
    body = <AddForm onDone={() => setAdding(false)} />;
  } else if (items.length === 0) {
    body = (
      <div className="m-4 flex flex-col items-center gap-3 rounded-[10px] border-2 border-dashed border-fg/20 px-6 py-8 text-center">
        <div className="grid place-items-center text-fg/60">
          <Zap size={44} strokeWidth={1.4} aria-hidden />
        </div>
        <div>
          <div className="text-base font-semibold text-fg">{t('pad.emptyTitle')}</div>
          <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed font-normal text-fg/65">{t('pad.emptyBody')}</p>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="grid grid-cols-2 gap-2 p-4 2xl:grid-cols-3">
        {items.map((item) => (
          <div key={item.id} className="group relative">
            <button type="button" onClick={() => runLaunchItem(item)}
              className="flex h-16 w-full items-center gap-2 rounded-lg border border-line-strong bg-canvas px-3 text-left text-xs font-semibold text-fg/90 hover:border-accent">
              {item.kind === 'open' ? <ExternalLink size={14} className="shrink-0 text-muted" /> : <Zap size={14} className="shrink-0 text-accent" />}
              <span className="line-clamp-2">{item.label}</span>
            </button>
            <button type="button" onClick={() => remove(item.id)} aria-label={`Remove ${item.label}`}
              className="absolute -top-1.5 -right-1.5 hidden size-5 place-items-center rounded-full border border-line-strong bg-panel-2 group-hover:grid">
              <X size={11} />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setAdding(true)}
          className="flex h-16 items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong text-xs font-semibold text-muted hover:text-fg">
          <Plus size={14} /> {t('pad.add')}
        </button>
      </div>
    );
  }

  return (
    <Panel
      eyebrow={t('pad.eyebrow')}
      title={t('pad.title')}
      action={!adding && (
        <button type="button" onClick={() => setAdding(true)}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-dashed border-fg/30 px-3 text-sm font-medium text-fg transition hover:border-accent hover:text-accent">
          {t('pad.addShortcut')}
        </button>
      )}
    >
      {body}
    </Panel>
  );
}
