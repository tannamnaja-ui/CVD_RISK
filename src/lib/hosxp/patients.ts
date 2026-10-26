/** Patient-list helpers ported from public/js/patients.js (pure functions, no DOM). */
import type { Clinical } from './clinical';

export interface PatientRow {
  vstdate?: string;
  vsttime?: string;
  vn: string;
  hn?: string;
  ptname?: string;
  age?: string;
  age_y?: number | string;
  sex?: string;
  pdx?: string;
  doctor?: string;
  dx_text_list?: string;
  spclty?: string;
  department?: string;
  depcode?: string;
  dep_list?: string;
  pttype?: string;
  /** major CV risk factors, filled in by applyRiskFactors once that data has loaded */
  risk?: RiskFactorId[];
  /** comorbidities / specific high-risk conditions, filled in by applyRiskFactors */
  comorbid?: ComorbidId[];
  /** a Thai CV Risk result is saved in opdscreen_cvd for this visit */
  screened?: boolean;
  /** the saved result (opdscreen_cvd) */
  result?: CvdResult | null;
  /** assessment inputs (TC, HDL, waist, height, smoking, diabetes, SBP) — same sources as the assessment page */
  clinical?: Clinical;
}

/** Merge the assessment inputs (lib/hosxp/clinical.ts) into the rows. */
export function applyClinical(patients: PatientRow[], byVn: Map<string, Clinical>): PatientRow[] {
  return patients.map((p) => ({ ...p, clinical: byVn.get(String(p.vn)) }));
}

export interface PatientFilters {
  search: string;
  spclty: string;
  dep: string;
  hn: string;
  /** only the Thai CV Risk screening age group */
  screeningAge: boolean;
  /** only patients with at least one major risk factor */
  riskFactors: boolean;
  /** only patients with a comorbidity / specific high-risk condition */
  comorbid: boolean;
}

export const EMPTY_FILTERS: PatientFilters = { search: '', spclty: '', dep: '', hn: '', screeningAge: false, riskFactors: false, comorbid: false };

/** Thai CV Risk screening population: everyone aged 35–70. */
export const SCREENING_AGE = { min: 35, max: 70 } as const;

export function inScreeningAge(p: PatientRow): boolean {
  if (p.age_y == null || str(p.age_y).trim() === '') return false;
  const age = Number(p.age_y);
  return Number.isFinite(age) && age >= SCREENING_AGE.min && age <= SCREENING_AGE.max;
}

export type SortDir = 'asc' | 'desc';

/** Every sortable column of the patient table. */
export type SortKey =
  | 'vstdate'
  | 'hn'
  | 'ptname'
  | 'age'
  | 'pdx'
  | 'doctor'
  | 'dx_text_list'
  | 'spclty'
  | 'department'
  | 'pttype'
  | 'risk'
  | 'comorbid'
  | 'cvdStatus'
  | 'result'
  | 'sex'
  | 'tc'
  | 'hdl'
  | 'waist'
  | 'height'
  | 'smoke'
  | 'dm'
  | 'sbp';

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/** First click sorts ascending; clicking the same column again flips the direction. */
export function nextSort(current: SortState | null, key: SortKey): SortState {
  return current?.key === key && current.dir === 'asc' ? { key, dir: 'desc' } : { key, dir: 'asc' };
}

const thaiCollator = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });

/** Value used for sorting; null = empty (always placed last). */
function sortValue(p: PatientRow, key: SortKey): string | number | null {
  switch (key) {
    case 'age': {
      const n = Number(p.age_y);
      return p.age_y == null || str(p.age_y).trim() === '' || !Number.isFinite(n) ? null : n;
    }
    case 'vstdate':
      // date then time, so visits on the same day keep their arrival order
      return str(p.vstdate).trim() ? `${dateOf(p.vstdate)} ${timeOf(p.vsttime)}` : null;
    case 'risk':
      return p.risk?.length ? p.risk.length : null;
    case 'result':
      return p.result ? p.result.risk : null;
    case 'cvdStatus': {
      const st = cvdStatus(p);
      return st === null ? null : { screened: 2, due: 1, notEligible: 0 }[st];
    }
    case 'comorbid':
      return p.comorbid?.length ? p.comorbid.length : null;
    case 'tc':
    case 'hdl':
    case 'waist':
    case 'height':
    case 'sbp':
      return p.clinical?.[key]?.value ?? null;
    case 'smoke':
      return p.clinical ? (p.clinical.smoke ? 1 : 0) : null;
    case 'dm':
      return p.clinical ? (p.clinical.dm.dm ? 1 : 0) : null;
    default: {
      const v = str(p[key]).trim();
      return v === '' ? null : v;
    }
  }
}

export function comparePatients(a: PatientRow, b: PatientRow, sort: SortState): number {
  const va = sortValue(a, sort.key);
  const vb = sortValue(b, sort.key);
  if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1; // empties last either way
  const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : thaiCollator.compare(String(va), String(vb));
  return sort.dir === 'asc' ? c : -c;
}

const str = (v: unknown) => String(v == null ? '' : v);

export const hasDxText = (p: PatientRow) => str(p.dx_text_list).trim() !== '';

export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Department option text: prefix the room code unless the name already starts with it (names repeat across codes). */
export function depOption(p: PatientRow): string {
  const code = str(p.depcode).trim();
  const name = str(p.department).trim();
  if (!name) return code;
  if (!code || name.toLowerCase().startsWith(code.toLowerCase())) return name;
  return `${code} ${name}`;
}

export function knownDepCodes(patients: PatientRow[]): Set<string> {
  return new Set(
    patients
      .flatMap((p) => [
        str(p.depcode).toLowerCase().trim(),
        ...str(p.dep_list)
          .toLowerCase()
          .split(',')
          .map((x) => x.trim()),
      ])
      .filter(Boolean),
  );
}

function depCodeOf(filter: string, known: Set<string>): string {
  const m = filter.trim().match(/^([A-Za-z0-9]+)(?:[\s-]|$)/);
  const code = m ? m[1].toLowerCase() : '';
  return known.has(code) ? code : '';
}

/**
 * Room filter. A known room code matches by code (queue rows first, then the visit's main room
 * when it has at least one queue row — HOSxP does not count visits without queue rows).
 * Free text falls back to a name search.
 */
export function depMatch(p: PatientRow, filter: string, known: Set<string>): boolean {
  if (!filter) return true;
  const want = depCodeOf(filter, known);
  if (want) {
    const queued = str(p.dep_list)
      .toLowerCase()
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (queued.includes(want)) return true;
    return queued.length > 0 && str(p.depcode).trim().toLowerCase() === want;
  }
  return str(p.department).toLowerCase().includes(filter);
}

/** Search text → lower-case words; every word must appear in the name (order and spacing don't matter). */
export function searchWords(search: string): string[] {
  return search.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Name search only (first name / surname). HOSxP stores "คำนำหน้าชื่อ␣␣นามสกุล" with a double space. */
export function nameMatches(p: PatientRow, words: string[]): boolean {
  const name = str(p.ptname).toLowerCase().replace(/\s+/g, ' ');
  return words.every((w) => name.includes(w));
}

export function applyPatientFilters(all: PatientRow[], f: PatientFilters, sort: SortState | null, known: Set<string>): PatientRow[] {
  const words = searchWords(f.search);
  const spclty = f.spclty.toLowerCase().trim();
  const dep = f.dep.toLowerCase().trim();
  const hn = f.hn.toLowerCase().trim();

  let rows = all.filter((p) => {
    if (words.length && !nameMatches(p, words)) return false;
    if (spclty && !str(p.spclty).toLowerCase().includes(spclty)) return false;
    if (dep && !depMatch(p, dep, known)) return false;
    if (hn && !str(p.hn).toLowerCase().includes(hn)) return false;
    // Several boxes ticked = the screening population: a patient qualifies by ANY ticked group.
    if (f.screeningAge || f.riskFactors || f.comorbid) {
      const ok = (f.screeningAge && inScreeningAge(p)) || (f.riskFactors && hasRiskFactor(p)) || (f.comorbid && hasComorbid(p));
      if (!ok) return false;
    }
    return true;
  });

  if (sort) rows = [...rows].sort((a, b) => comparePatients(a, b, sort));
  return rows;
}

export function uniqueSorted(values: unknown[]): string[] {
  return [...new Set(values.map(str).filter((v) => v.trim()))].sort((a, b) => a.localeCompare(b, 'th'));
}

export const dateOf = (v: unknown) => str(v).substring(0, 10);
export const timeOf = (v: unknown) => str(v).substring(0, 5);

// ---------- major CV risk factors ----------

export type RiskFactorId = 'dm' | 'ht' | 'dlp' | 'smoke' | 'obese' | 'fh';

export const RISK_FACTOR_LABELS: Record<RiskFactorId, { short: string; label: string }> = {
  dm: { short: 'DM', label: 'เบาหวาน' },
  ht: { short: 'HT', label: 'ความดันโลหิตสูง' },
  dlp: { short: 'DLP', label: 'ไขมันในเลือดผิดปกติ' },
  smoke: { short: 'สูบบุหรี่', label: 'สูบบุหรี่' },
  obese: { short: 'อ้วน', label: 'อ้วน / อ้วนลงพุง' },
  fh: { short: 'FH', label: 'ประวัติครอบครัวเป็นโรคหัวใจก่อนวัยอันควร' },
};

/** Diagnosis-history flags (0/1) and this visit's screening vitals, from riskFactorsSql. */
export interface RiskRow {
  vn: string | number;
  bps?: unknown;
  bpd?: unknown;
  bw?: unknown;
  height?: unknown;
  waist?: unknown;
  dm?: unknown;
  ht?: unknown;
  dlp?: unknown;
  smoke?: unknown;
  obese?: unknown;
  fh?: unknown;
  ckd?: unknown;
  mets?: unknown;
  autoimmune?: unknown;
  pregnancy?: unknown;
  cvd_screened?: unknown;
  cvd_risk?: unknown;
  cvd_level?: unknown;
  cvd_level_name?: unknown;
}

const flagged = (v: unknown) => Number(v) === 1;
const positive = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Thresholds from the screening criteria (BMI uses the Asian cut-off). */
export const RISK_THRESHOLDS = { sbp: 140, dbp: 90, bmi: 25, waistMale: 90, waistFemale: 80 } as const;

export function riskFactorsOf(p: PatientRow, r: RiskRow | undefined): RiskFactorId[] {
  if (!r) return [];
  const sbp = positive(r.bps);
  const dbp = positive(r.bpd);
  const weight = positive(r.bw);
  const height = positive(r.height);
  const waist = positive(r.waist);
  const bmi = weight && height ? weight / (height / 100) ** 2 : null;
  // HOSxP patient.sex: '1' male, '2' female
  const waistLimit = String(p.sex) === '1' ? RISK_THRESHOLDS.waistMale : String(p.sex) === '2' ? RISK_THRESHOLDS.waistFemale : null;

  const found: RiskFactorId[] = [];
  if (flagged(r.dm)) found.push('dm');
  if (flagged(r.ht) || (sbp !== null && sbp >= RISK_THRESHOLDS.sbp) || (dbp !== null && dbp >= RISK_THRESHOLDS.dbp)) found.push('ht');
  if (flagged(r.dlp)) found.push('dlp');
  if (flagged(r.smoke)) found.push('smoke');
  if (flagged(r.obese) || (bmi !== null && bmi >= RISK_THRESHOLDS.bmi) || (waist !== null && waistLimit !== null && waist > waistLimit)) found.push('obese');
  if (flagged(r.fh)) found.push('fh');
  return found;
}

export function applyRiskFactors(patients: PatientRow[], risks: RiskRow[]): PatientRow[] {
  const byVn = new Map(risks.map((r) => [String(r.vn), r]));
  return patients.map((p) => {
    const r = byVn.get(String(p.vn));
    return { ...p, risk: riskFactorsOf(p, r), comorbid: comorbiditiesOf(r), screened: r ? flagged(r.cvd_screened) : undefined, result: r ? resultOf(r) : undefined };
  });
}

export const hasRiskFactor = (p: PatientRow) => (p.risk?.length ?? 0) > 0;

// ---------- comorbidities / specific high-risk conditions ----------

export type ComorbidId = 'ckd' | 'mets' | 'autoimmune' | 'pregnancy';

export const COMORBID_LABELS: Record<ComorbidId, { short: string; label: string }> = {
  ckd: { short: 'CKD', label: 'โรคไตเรื้อรัง / โปรตีนรั่วในปัสสาวะ' },
  mets: { short: 'MetS', label: 'Metabolic Syndrome' },
  autoimmune: { short: 'ภูมิแพ้ตัวเอง', label: 'โรคภูมิคุ้มกันทำลายตนเอง / อักเสบเรื้อรัง (RA, SLE, สะเก็ดเงิน)' },
  pregnancy: { short: 'ครรภ์เสี่ยง', label: 'ประวัติภาวะแทรกซ้อนขณะตั้งครรภ์ (เบาหวานขณะตั้งครรภ์ / ครรภ์เป็นพิษ)' },
};

export function comorbiditiesOf(r: RiskRow | undefined): ComorbidId[] {
  if (!r) return [];
  return (['ckd', 'mets', 'autoimmune', 'pregnancy'] as const).filter((k) => flagged(r[k]));
}

export const hasComorbid = (p: PatientRow) => (p.comorbid?.length ?? 0) > 0;

// ---------- CVD screening status (patient list) ----------

export type CvdStatus = 'screened' | 'due' | 'notEligible';

export const CVD_STATUS_LABELS: Record<CvdStatus, string> = {
  screened: 'คัดกรองแล้ว',
  due: 'เข้าเกณฑ์ ยังไม่คัดกรอง',
  notEligible: 'ไม่อยู่ในเกณฑ์',
};

/** In the screening population: age 35–70, or a major risk factor, or a comorbidity. */
export const isEligible = (p: PatientRow) => inScreeningAge(p) || hasRiskFactor(p) || hasComorbid(p);

/** null until the risk-factor data (which also carries the saved flag) has loaded. */
export function cvdStatus(p: PatientRow): CvdStatus | null {
  if (p.screened === undefined) return null;
  if (p.screened) return 'screened';
  return isEligible(p) ? 'due' : 'notEligible';
}

// ---------- saved assessment result (patient list) ----------

export interface CvdResult {
  /** Thai CV Risk in percent */
  risk: number;
  /** cvd_risk_score_type_id 1–5 */
  level: number;
  /** cvd_risk_score_type_name, e.g. "ระดับ 2 ความเสี่ยงปานกลาง" */
  label: string;
}

/** Colours of the five Thai CV Risk levels (same as the assessment page). */
export const CVD_LEVEL_COLORS: Record<number, { color: string; text: string }> = {
  1: { color: '#28a745', text: '#ffffff' },
  2: { color: '#ffc107', text: '#3d2e00' },
  3: { color: '#fd7e14', text: '#ffffff' },
  4: { color: '#dc3545', text: '#ffffff' },
  5: { color: '#6f42c1', text: '#ffffff' },
};

function resultOf(r: RiskRow): CvdResult | null {
  if (!flagged(r.cvd_screened)) return null;
  const level = Number(r.cvd_level);
  const risk = Number(r.cvd_risk);
  return {
    risk: Number.isFinite(risk) ? risk : 0,
    level: Number.isInteger(level) ? level : 0,
    label: String(r.cvd_level_name ?? '').trim() || (Number.isInteger(level) ? `ระดับ ${level}` : 'ประเมินแล้ว'),
  };
}
