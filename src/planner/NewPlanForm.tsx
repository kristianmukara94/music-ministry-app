import { useState, type FormEvent } from 'react';
import { NEW_PLAN_TEMPLATES, type NewPlanTemplate } from './templates';
import type { PlannerT } from './strings';

const FIELD = 'h-10 rounded-md border border-fg/15 bg-panel-2 px-3 text-sm outline-none focus:border-accent';

interface Props {
  t: PlannerT;
  /** The date the form starts on: the coming Sunday. */
  initialDate: string;
  /** The name the form starts with: the liturgical day's name when the day was picked on the calendar. */
  initialName?: string;
  /** The order the form starts from: Weekday for a weekday picked on the calendar. */
  initialTemplate?: NewPlanTemplate;
  /** Makes the plan. Resolves true when it was made, so the form can clear itself. */
  onCreate: (input: { name: string; liturgicalDate: string; template: NewPlanTemplate }) => Promise<boolean>;
}

/**
 * The New plan form: a name, the date of the Mass, and the order it starts from. Standard Sunday is the 17 Holy Mass slots, empty, to fill
 * from the Hymn Library. Weekday fills the sung parts of the Ordinary with their Mass Order texts. Either way the plan is the 17 numbered
 * slots, with nothing among the additional items.
 */
export function NewPlanForm({ t, initialDate, initialName = '', initialTemplate = 'standard', onCreate }: Props) {
  const [name, setName] = useState(initialName.slice(0, 120));
  const [date, setDate] = useState(initialDate);
  const [template, setTemplate] = useState<NewPlanTemplate>(initialTemplate);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      if (await onCreate({ name: name.trim(), liturgicalDate: date, template })) setName('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} aria-label={t('newPlan')} className="flex flex-col gap-3 rounded-[10px] border border-line bg-panel p-3">
      <div className="flex flex-wrap gap-2">
        <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('planNamePlaceholder')} aria-label={t('planNamePlaceholder')} className={`${FIELD} min-w-0 flex-1`} />
        <input type="date" required aria-label={t('liturgicalDate')} value={date} onChange={(e) => setDate(e.target.value)} className={`${FIELD} px-2`} />
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">{t('newPlanStartFrom')}</legend>
        <div role="radiogroup" aria-label={t('newPlanStartFrom')} className="grid gap-2 sm:grid-cols-2">
          {NEW_PLAN_TEMPLATES.map((id) => (
            <label
              key={id}
              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition ${template === id ? 'border-accent bg-accent/10' : 'border-line hover:border-fg/25'}`}
            >
              <input type="radio" name="new-plan-template" value={id} checked={template === id} onChange={() => setTemplate(id)} className="mt-1 accent-accent" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-fg">{t(`template_${id}`)}</span>
                <span className="block text-[11px] text-muted">{t(`template_${id}Hint`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end">
        <button type="submit" disabled={!name.trim() || busy} className="h-10 rounded-md bg-accent px-4 text-xs font-extrabold uppercase text-on-accent disabled:opacity-40">
          {t('create')}
        </button>
      </div>
    </form>
  );
}
