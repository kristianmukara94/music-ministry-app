// The New plan page (plan/new.html), kept for older links and bookmarks: the Planner header with the CREATE A PLAN card under it, the same
// card the Planner's New Plan modal shows (new-plan-form.js). `?date=` and `?kind=` (from older calendar links and the editor's + Add Time) fill
// the form. A created plan opens in the Plan Editor. Viewers are told that only a planner or admin can create a plan.
import { mountSidebar } from './shell.js';
import { guard } from './auth.js';
import { listPlans } from './plan-api.js';
import { openExistingHref } from './schedule-ui.js';
import { canCreatePlans, editorPathFor } from './plan-model.js';
import { mountNewPlanForm } from './new-plan-form.js';
import { lastPlan, mountPlannerHeader } from './planner-header.js';
import { calendarKindOf } from './planner-calendar.js';

mountSidebar();

const root = document.documentElement.dataset.base ?? '';
const params = new URLSearchParams(location.search);
const date = params.get('date');
const kind = calendarKindOf(params.get('kind'));

const user = await guard();
if (user) {
  mountPlannerHeader(document.querySelector('[data-planner-header]'), {
    tab: kind,
    subtitle: 'New plan',
    root,
    editorPlan: lastPlan(),
    canCreate: false,
  });
  if (!canCreatePlans(user.role)) {
    document.getElementById('new-plan-denied').hidden = false;
  } else {
    const layout = document.getElementById('new-plan-layout');
    const form = mountNewPlanForm(layout, {
      kind,
      date: /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date : '',
      // The page sits under plan/, so the editor's path is taken from the site root.
      onCreated: (plan) => location.replace(`${root}${editorPathFor(plan)}`),
      onOpenExisting: (id) => location.assign(openExistingHref(id, root)),
      // × goes back to the calendar of the kind on show.
      onClose: () => location.assign(`${root}index.html?cal=${form.kind ?? kind}`),
    });
    // The form stays hidden until the user is known and its first values are in.
    layout.hidden = false;
    // A time typed before the list arrives is checked again once it has.
    listPlans()
      .then((body) => form.setPlans(body.plans ?? []))
      .catch(() => undefined);
  }
}
