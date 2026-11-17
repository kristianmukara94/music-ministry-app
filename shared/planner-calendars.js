// The Planner's two calendars: the Liturgical Calendar holds Holy Mass plans, the Praise & Worship Calendar holds Praise & Worship sessions.
// Plain JS, so the split can be tested without React.

/** The calendars, in switcher order. A calendar's id is the plan kind it holds. */
export const PLANNER_CALENDARS = ['mass', 'pw'];

/** The service type each calendar is scoped to. */
export const SERVICE_TYPE = { mass: 'holy-mass', pw: 'praise-worship' };

/** A calendar id from anything: an unknown value is the Liturgical Calendar, where the Planner opens. */
export function calendarKind(value) {
  return value === 'pw' ? 'pw' : 'mass';
}

/**
 * The plans one calendar shows. The Liturgical Calendar shows only Holy Mass plans and the Praise & Worship Calendar only Praise & Worship
 * sessions, so the two kinds of service never share a day cell.
 */
export function calendarPlans(kind, massPlans, pwSessions) {
  const k = calendarKind(kind);
  return { mass: k === 'mass' ? [...(massPlans ?? [])] : [], pw: k === 'pw' ? [...(pwSessions ?? [])] : [] };
}

/** The calendar a plan belongs on, so Back to the calendar returns to that plan's own calendar. */
export function calendarForPlan(plan) {
  return calendarKind(plan?.kind);
}
