/**
 * Follow-up rules shared by the report (drop-out rate) and the follow-up worklists. Pure functions.
 *
 * An appointment (HOSxP oapp) counts as kept when HOSxP linked a visit to it (visit_vn), or the patient
 * had any visit within APPOINTMENT_GRACE_DAYS before or after the appointment date.
 */

export const APPOINTMENT_GRACE_DAYS = 7;
/** Thai CV Risk at or above this is "high risk" (cvd_risk_score_type 3–5). */
export const HIGH_RISK = 20;
/** Re-assessment is due this many days after the latest one. */
export const RESCREEN_DAYS = 365;
/** Statin dispensed within this many days counts as "on a statin". */
export const STATIN_LOOKBACK_DAYS = 365;
/** BP / LDL older than this is not used to judge control. */
export const CONTROL_LOOKBACK_DAYS = 365;
export const BP_TARGET = { sbp: 140, dbp: 90 } as const;
export const LDL_TARGET = 100;

const DAY = 86_400_000;
export const isoDay = (v: unknown) => String(v ?? '').slice(0, 10);
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export interface Appointment {
  /** YYYY-MM-DD */
  date: string;
  visitVn?: string | null;
  clinic?: string;
}

/** Kept = linked visit, or any visit within the grace window around the date. */
export function appointmentKept(a: Appointment, visitDates: string[]): boolean {
  if (a.visitVn && String(a.visitVn).trim()) return true;
  const lo = addDays(a.date, -APPOINTMENT_GRACE_DAYS);
  const hi = addDays(a.date, APPOINTMENT_GRACE_DAYS);
  return visitDates.some((d) => d >= lo && d <= hi);
}

/** Appointments whose date has passed by more than the grace period, as of `today`. */
export const isJudgeable = (a: Appointment, today: string) => addDays(a.date, APPOINTMENT_GRACE_DAYS) < today;

/**
 * The patient's latest judgeable appointment, when it was missed and the patient has not come back
 * since (a later visit means they are back in care). null = nothing to follow up.
 */
export function missedAppointment(appointments: Appointment[], visitDates: string[], today: string): Appointment | null {
  const past = appointments.filter((a) => isJudgeable(a, today)).sort((a, b) => b.date.localeCompare(a.date));
  const last = past[0];
  if (!last || appointmentKept(last, visitDates)) return null;
  return visitDates.some((d) => d > last.date) ? null : last;
}
