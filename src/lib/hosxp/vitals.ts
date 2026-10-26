/**
 * Pre-filling the assessment from screening vitals (opdscreen): this visit's value when it was measured,
 * otherwise the latest earlier one that is still recent enough. Pure functions, no DOM.
 */

export type VitalKey = 'bps' | 'bw' | 'height' | 'waist';

/** How old an earlier measurement may be and still be used (days before this visit). */
export const VITAL_MAX_AGE_DAYS: Record<VitalKey, number> = { bps: 180, bw: 365, waist: 365, height: 3650 };

export const VITAL_LABELS: Record<VitalKey, { label: string; unit: string }> = {
  bps: { label: 'SBP', unit: 'mmHg' },
  bw: { label: 'น้ำหนัก', unit: 'กก.' },
  height: { label: 'ส่วนสูง', unit: 'ซม.' },
  waist: { label: 'รอบเอว', unit: 'ซม.' },
};

/** Row of vitalsHistorySql. */
export interface VitalsRow {
  vn: unknown;
  vstdate: unknown;
  visit_date?: unknown;
  bps?: unknown;
  bpd?: unknown;
  bw?: unknown;
  height?: unknown;
  waist?: unknown;
  cholesterol?: unknown;
  hdl?: unknown;
}

/** TC / HDL recorded in this visit's screening (opdscreen.cholesterol, opdscreen.hdl) — this visit only, never an earlier one. */
export function screeningLipids(rows: VitalsRow[], vn: string): { tc?: number; hdl?: number } {
  const out: { tc?: number; hdl?: number } = {};
  const positive = (v: unknown) => (v !== null && v !== undefined && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
  for (const r of rows) {
    if (String(r.vn) !== vn) continue;
    out.tc ??= positive(r.cholesterol);
    out.hdl ??= positive(r.hdl);
  }
  return out;
}

export interface PickedVital {
  value: number;
  /** YYYY-MM-DD of the visit it was measured at */
  date: string;
  /** measured at this visit (not taken from an earlier one) */
  current: boolean;
}

const DAY = 86_400_000;
const day = (v: unknown) => String(v ?? '').slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

export function pickVitals(rows: VitalsRow[], vn: string): Partial<Record<VitalKey, PickedVital>> {
  const newestFirst = [...rows].sort((a, b) => day(b.vstdate).localeCompare(day(a.vstdate)));
  // this visit first, then earlier visits newest first
  const ordered = [...newestFirst.filter((r) => String(r.vn) === vn), ...newestFirst.filter((r) => String(r.vn) !== vn)];
  const visitDate = day(rows[0]?.visit_date) || day(ordered[0]?.vstdate);
  const out: Partial<Record<VitalKey, PickedVital>> = {};
  for (const key of Object.keys(VITAL_MAX_AGE_DAYS) as VitalKey[]) {
    for (const r of ordered) {
      const value = Number(r[key]);
      if (r[key] === null || r[key] === undefined || !Number.isFinite(value) || value <= 0) continue;
      const current = String(r.vn) === vn;
      const date = day(r.vstdate);
      if (!current && daysBetween(date, visitDate) > VITAL_MAX_AGE_DAYS[key]) break; // older rows are older still
      out[key] = { value, date, current };
      break;
    }
  }
  return out;
}

/** '2026-03-12' → '12/03/2569' */
export function thaiDate(iso: unknown): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${Number(m[1]) + 543}` : String(iso ?? '');
}
