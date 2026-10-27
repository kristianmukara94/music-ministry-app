// New plan: name, date and type. The browser makes the plan's UUID, the server creates the plan, and the editor for its type opens.
// Viewers are told that only a planner or admin can create a plan.
import { mountSidebar } from './shell.js';
import { guard } from './auth.js';
import { createPlan } from './plan-api.js';
import { canCreatePlans, checkNewPlan, editorPathFor } from './plan-model.js';

mountSidebar();

const form = document.getElementById('new-plan-form');
const status = document.getElementById('new-plan-status');
const submit = document.getElementById('new-plan-submit');
const denied = document.getElementById('new-plan-denied');

const user = await guard();
if (user) {
  if (!canCreatePlans(user.role)) {
    denied.hidden = false;
    form.hidden = true;
  } else {
    // The form stays hidden until the user is known, so a click cannot land before the handler is attached.
    form.hidden = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = {
        name: document.getElementById('plan-name').value,
        date: document.getElementById('plan-date').value,
        kind: document.getElementById('plan-kind').value,
      };
      const problem = checkNewPlan(input);
      if (problem) {
        status.textContent = problem;
        return;
      }
      submit.disabled = true;
      status.textContent = 'Creating…';
      try {
        const body = await createPlan({ id: crypto.randomUUID(), name: input.name.trim(), date: input.date, kind: input.kind, items: [] });
        // The page sits under plan/, so the editor's path is taken from the site root.
        location.replace(`${document.documentElement.dataset.base ?? ''}${editorPathFor(body.plan)}`);
      } catch (err) {
        status.textContent = err.message;
        submit.disabled = false;
      }
    });
  }
}
