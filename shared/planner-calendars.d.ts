export type PlannerCalendar = 'mass' | 'pw';

export const PLANNER_CALENDARS: readonly PlannerCalendar[];
export const SERVICE_TYPE: { readonly mass: 'holy-mass'; readonly pw: 'praise-worship' };
export function calendarKind(value: unknown): PlannerCalendar;
export function calendarPlans<M, P>(kind: PlannerCalendar, massPlans: readonly M[], pwSessions: readonly P[]): { mass: M[]; pw: P[] };
export function calendarForPlan(plan: { kind: string } | null | undefined): PlannerCalendar;
