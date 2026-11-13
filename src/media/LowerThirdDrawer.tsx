import { useEffect, useRef, useState } from 'react';
import { Eraser, MonitorPlay, Send, UserRound, X } from 'lucide-react';
import type { LowerThird, LowerThirdTemplate } from '../../shared/live.js';
import { dispatch, useLive } from '../live/store';
import { LowerThirdStage } from '../output/LowerThirdView';
import { useChurchName, useChurchRoster } from '../church/profile';
import type { RosterEntry } from '../church/types';
import { setUi } from '../state/ui';

/** The three layouts. Field labels say what each line is for, so the operator knows what to type. */
const TEMPLATES: { id: LowerThirdTemplate; label: string; line1Label: string; line2Label: string | null }[] = [
  { id: 'nameplate', label: 'Nameplate', line1Label: 'Name', line2Label: 'Role or ministry' },
  { id: 'intention', label: 'Holy Mass intention', line1Label: 'Intention', line2Label: 'Requested by' },
  { id: 'response', label: 'Response', line1Label: 'Response, e.g. R: And with your spirit', line2Label: null },
];

const input = 'h-10 w-full rounded-lg border border-fg/15 bg-panel-2 px-3 text-sm text-fg outline-none placeholder:text-faint focus:border-accent focus:ring-1 focus:ring-accent/40';
const button =
  'flex h-9 items-center gap-2 rounded-md px-4 text-xs font-bold tracking-wide uppercase transition disabled:cursor-not-allowed disabled:opacity-40';

/** The button in the Media Library's status bar that opens the drawer. It shows when a lower third is on screen. */
export function LowerThirdButton({ onOpen }: { onOpen: () => void }) {
  const live = useLive((s) => s.state.lowerThird.live);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      title={live ? `Lower third showing: ${live.line1}` : 'Show a name, a Holy Mass intention or a response on the screen'}
      className="flex h-8 items-center gap-2 rounded-md border border-fg/15 bg-panel-2 px-3 text-[11px] font-bold tracking-wide text-fg/85 uppercase transition hover:bg-fg/10 hover:text-fg"
    >
      <MonitorPlay size={14} aria-hidden />
      Lower third
      {live && <span className="size-1.5 animate-pulse rounded-full bg-ok" aria-label="live" />}
    </button>
  );
}

/**
 * Lower third editor, in a drawer over the Media Library so the library keeps the whole page. Type the lines, check the preview, then
 * show. The preview uses the same layout as the output, so what the operator sees is what the screen gets. Nothing reaches the output
 * until Show. The typed lines stay while the drawer is closed and reopened.
 */
export function LowerThirdDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const live = useLive((s) => s.state.lowerThird.live);
  const [template, setTemplate] = useState<LowerThirdTemplate>('nameplate');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const churchName = useChurchName();
  const roster = useChurchRoster();
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const config = TEMPLATES.find((t) => t.id === template) ?? TEMPLATES[0];
  const value: LowerThird | null = line1.trim()
    ? { template, line1: line1.trim(), ...(config.line2Label && line2.trim() ? { line2: line2.trim() } : {}) }
    : null;

  // The drawer's one way on air: its Show button and a roster pill's send button both come here.
  const showValue = (next: LowerThird | null) => {
    if (next) dispatch({ type: 'lowerThird/show', value: next, manual: true });
  };
  const show = () => showValue(value);
  const clear = () => dispatch({ type: 'lowerThird/clear' });

  /** A roster nameplate: the name, then the role (or the parish name when no role was saved). */
  const presetOf = (person: RosterEntry): LowerThird => {
    const second = person.role || churchName;
    return { template: 'nameplate', line1: person.name, ...(second ? { line2: second } : {}) };
  };
  const applyPreset = (person: RosterEntry, showNow: boolean) => {
    const preset = presetOf(person);
    setTemplate('nameplate');
    setLine1(preset.line1);
    setLine2(preset.line2 ?? '');
    if (showNow) showValue(preset);
  };
  const isLive = (person: RosterEntry) => live?.template === 'nameplate' && live.line1 === person.name;

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Close lower third" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/40" />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="lower-third-title"
        className="relative flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-line px-5 py-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-accent/30 bg-accent/10 text-accent">
            <MonitorPlay size={16} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="lower-third-title" className="text-sm font-bold text-fg">Lower third</h2>
            <p className="truncate text-xs text-muted">{live ? `Showing: ${live.line1}` : 'Nothing showing'}</p>
          </div>
          {live && (
            <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-ok/60 bg-ok/15 px-2.5 py-0.5 text-[10px] font-extrabold tracking-wider text-ok uppercase">
              <span className="size-1.5 animate-pulse rounded-full bg-ok" aria-hidden />
              Live
            </span>
          )}
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-md text-muted hover:bg-fg/10 hover:text-fg">
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          {/* The parish team from Settings › Parish: a click fills the nameplate, the send button puts it on screen at once. */}
          <section aria-labelledby="lower-third-team" className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 id="lower-third-team" className="text-[11px] font-bold tracking-wider text-muted uppercase">Parish team</h3>
              <button type="button" onClick={() => { onClose(); setUi({ view: 'settings', settingsSection: 'profile' }); }} className="text-[11px] font-semibold text-accent hover:underline">
                {roster.length ? 'Edit team' : 'Add the parish team'}
              </button>
            </div>
            {roster.length === 0 ? (
              <p className="text-xs text-faint">Save the priests, music director and commentators in Settings › Parish to show their nameplates in one click.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {roster.map((person) => (
                  <li key={person.id} className={`flex items-stretch overflow-hidden rounded-full border text-xs ${isLive(person) ? 'border-ok/60 bg-ok/10' : 'border-fg/15 bg-panel-2'}`}>
                    <button type="button" onClick={() => applyPreset(person, false)} title={`Fill the nameplate: ${person.name}${person.role ? `, ${person.role}` : ''}`}
                      className="flex min-w-0 items-center gap-1.5 py-1 pr-2 pl-2.5 text-left hover:bg-fg/10">
                      <UserRound size={12} aria-hidden className="shrink-0 text-faint" />
                      <span className="max-w-[11rem] truncate font-semibold text-fg">{person.name}</span>
                      {person.role && <span className="max-w-[8rem] truncate text-faint">{person.role}</span>}
                    </button>
                    <button type="button" onClick={() => applyPreset(person, true)} aria-label={`Show ${person.name} now`} title="Show on screen now"
                      className="grid w-7 place-items-center border-l border-fg/15 text-ok hover:bg-ok/15">
                      <Send size={11} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div role="radiogroup" aria-label="Template" className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={template === t.id}
                onClick={() => setTemplate(t.id)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                  template === t.id ? 'border-accent/50 bg-accent/15 text-accent' : 'border-fg/15 text-fg/70 hover:bg-fg/10 hover:text-fg'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg/70">{config.line1Label}</span>
            <input ref={firstField} value={line1} onChange={(e) => setLine1(e.target.value)} maxLength={160} className={input} />
          </label>
          {config.line2Label && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="lower-third-line2" className="text-xs font-medium text-fg/70">{config.line2Label}</label>
                {/* A nameplate's second line is often the parish itself: one click puts the parish profile's name in. */}
                {template === 'nameplate' && churchName && line2 !== churchName && (
                  <button type="button" onClick={() => setLine2(churchName)} className="truncate text-[11px] font-semibold text-accent hover:underline" title={churchName}>
                    Use parish name
                  </button>
                )}
              </div>
              <input
                id="lower-third-line2"
                value={line2}
                onChange={(e) => setLine2(e.target.value)}
                maxLength={160}
                placeholder={template === 'nameplate' && churchName ? churchName : undefined}
                className={input}
              />
            </div>
          )}

          <div
            aria-label="Lower third preview"
            className="relative aspect-video overflow-hidden rounded-[10px] border border-line bg-gradient-to-br from-[#3a1020] to-[#100306] [container-type:inline-size]"
          >
            {value ? <LowerThirdStage value={value} /> : <p className="absolute inset-0 grid place-items-center text-xs text-white/70">Type a line to preview it.</p>}
          </div>
        </div>

        <footer className="flex gap-2 border-t border-line px-5 py-4">
          <button type="button" onClick={show} disabled={!value} className={`${button} border border-ok bg-ok text-canvas shadow-md hover:brightness-110`}>
            <Send size={14} aria-hidden /> Show
          </button>
          <button type="button" onClick={clear} disabled={!live} className={`${button} border border-fg/15 bg-panel-2 text-fg/85 hover:bg-fg/10`}>
            <Eraser size={14} aria-hidden /> Clear
          </button>
        </footer>
      </section>
    </div>
  );
}
