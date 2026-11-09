// The Add to plan dialog on the Songs page: choose an upcoming plan and a step, and the song is added to the plan as if it were added in the
// plan's editor. Options are built with new Option(), so a plan or song name is only ever text.
import { getPlan, savePlan } from './plan-api.js';
import { MASS_PLAN, PRAISE_PLAN } from './sample-data.js';
import { slotName } from './mass-language.js';
import { defaultSongStep, itemsWithSong, savePayload, shortDate, songSteps } from './plan-model.js';

const TEMPLATES = { mass: MASS_PLAN, praise: PRAISE_PLAN };

const dialog = document.getElementById('add-plan-dialog');
const form = document.getElementById('add-plan-form');
const songLine = document.getElementById('add-plan-song');
const fields = document.getElementById('add-plan-fields');
const planSelect = document.getElementById('add-plan-select');
const stepSelect = document.getElementById('add-plan-step');
const errorLine = document.getElementById('add-plan-error');
const confirm = document.getElementById('add-plan-confirm');
const cancel = document.getElementById('add-plan-cancel');

let current = null;
let loadToken = 0;
let busy = false;

const replaceOptions = (select, options) => select.replaceChildren(...options);
const planLabel = (plan) => `${shortDate(plan.liturgical_date)} · ${plan.name} · ${plan.kind === 'pw' ? 'Praise & Worship' : 'Holy Mass'}`;
const stepName = (plan, step) => (plan.kind === 'pw' ? step.row.name : slotName(step.row, plan.language));

function stepLabel(plan, step) {
  const name = stepName(plan, step);
  if (step.hasSong) return `${name} (already has this song)`;
  return step.filled ? `${name} (holds ${step.filled})` : name;
}

/** Reads the chosen plan and offers its steps. Only the latest choice is shown, however the requests finish. */
async function loadSteps() {
  const token = ++loadToken;
  errorLine.textContent = '';
  confirm.disabled = true;
  stepSelect.disabled = true;
  replaceOptions(stepSelect, [new Option('Loading steps…', '')]);
  try {
    const { plan } = await getPlan(planSelect.value);
    if (token !== loadToken) return;
    const steps = songSteps(plan, TEMPLATES, current.song.id, current.song.category);
    const first = defaultSongStep(steps);
    replaceOptions(stepSelect, steps.map((step) => {
      const option = new Option(stepLabel(plan, step), step.id, false, step.id === first?.id);
      option.disabled = step.hasSong;
      return option;
    }));
    stepSelect.disabled = !first;
    confirm.disabled = !first;
    if (!first) errorLine.textContent = 'Every step of this plan already has this song.';
  } catch (err) {
    if (token !== loadToken) return;
    replaceOptions(stepSelect, []);
    errorLine.textContent = err.message;
  }
}

function setBusy(on) {
  busy = on;
  confirm.disabled = on;
  cancel.disabled = on;
  planSelect.disabled = on;
  stepSelect.disabled = on;
  confirm.textContent = on ? 'Adding…' : 'Add to plan';
}

/** Opens the dialog for a song. `plans` are the upcoming plans. `onAdded(plan, stepName)` is called once the song is saved. */
export function openAddToPlan({ song, plans, onAdded }) {
  current = { song, plans, onAdded };
  songLine.textContent = song.title;
  errorLine.textContent = '';
  fields.hidden = plans.length === 0;
  document.getElementById('add-plan-none').hidden = plans.length > 0;
  confirm.hidden = plans.length === 0;
  replaceOptions(planSelect, plans.map((plan) => new Option(planLabel(plan), plan.id)));
  dialog.showModal();
  if (plans.length) void loadSteps();
}

planSelect.addEventListener('change', () => void loadSteps());
cancel.addEventListener('click', () => dialog.close());

// Escape closes the dialog, unless the song has already been sent.
dialog.addEventListener('cancel', (event) => {
  if (busy) event.preventDefault();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || confirm.disabled || !stepSelect.value) return;
  const { song, plans, onAdded } = current;
  const listed = plans.find((plan) => plan.id === planSelect.value);
  const stepId = stepSelect.value;
  errorLine.textContent = '';
  setBusy(true);
  try {
    // The plan is read again just before saving, so a change made since the dialog opened is kept, not overwritten.
    const { plan } = await getPlan(listed.id);
    const items = itemsWithSong(plan, TEMPLATES, stepId, song.id);
    if (!items) throw new Error('That step already has this song. Choose another step.');
    await savePlan(savePayload(plan, items));
    const step = songSteps(plan, TEMPLATES, song.id).find((s) => s.id === stepId);
    setBusy(false);
    dialog.close();
    onAdded(listed, stepName(plan, step));
  } catch (err) {
    setBusy(false);
    errorLine.textContent = err.message;
  }
});
