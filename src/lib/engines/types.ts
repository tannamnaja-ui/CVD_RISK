export type Gender = 'male' | 'female';
/** 'thai' = Thai CV Risk with automatic formula choice; the other thai-* cards pin one formula. */
export type EngineId = 'thai' | 'thai-ratio' | 'thai-tc' | 'thai-nonlab' | 'frs' | 'ascvd' | 'score2' | 'who' | 'qrisk3';
export type ModelId = 'thai-ratio' | 'thai-lab' | 'thai-nonlab' | 'frs' | 'ascvd' | 'score2' | 'who' | 'qrisk3';

/** ratio = TC/HDL (Ramathibodi) · lab = Total Cholesterol only · nonlab = waist/height */
export type ThaiMode = 'ratio' | 'lab' | 'nonlab';
export type Score2Region = 'low' | 'moderate' | 'high' | 'veryHigh';
export type WhoRegion = 'SEAR_B' | 'SEAR_D';
export type AscvdRace = 'white' | 'africanAmerican';
export type DiabetesType = 'type1' | 'type2';
/** QRISK3 smoking category for current smokers */
export type SmokeIntensity = 'light' | 'moderate' | 'heavy';

export interface QriskConditions {
  familyHistory: boolean;
  ckd: boolean;
  ra: boolean;
  af: boolean;
  migraine: boolean;
  sle: boolean;
  steroids: boolean;
  atypicalAntipsychotic: boolean;
  severeMentalIllness: boolean;
  erectileDysfunction: boolean;
}

/** Numeric inputs (all optional at this level; each model declares which it needs). */
export type NumericField = 'age' | 'sbp' | 'tc' | 'hdl' | 'waist' | 'height' | 'weight' | 'sbpSd' | 'townsend';

/** Model-specific option controls shown in the form. */
export type OptionControl = 'bpMeds' | 'score2Region' | 'whoRegion' | 'ascvdRace' | 'qrisk';

export interface PatientData {
  age?: number;
  sbp?: number;
  /** mg/dL */
  tc?: number;
  /** mg/dL */
  hdl?: number;
  waist?: number;
  height?: number;
  weight?: number;
  sbpSd?: number;
  townsend?: number;
  gender: Gender;
  dm: boolean;
  smoke: boolean;
  bpMeds: boolean;
  score2Region: Score2Region;
  whoRegion: WhoRegion;
  ascvdRace: AscvdRace;
  qriskEthnicity: number;
  smokeIntensity: SmokeIntensity;
  /** QRISK3: non-smoker who previously smoked */
  exSmoker: boolean;
  dmType: DiabetesType;
  conditions: QriskConditions;
}

/** PatientData after a model's required fields have been checked. */
export type CheckedPatient = PatientData & { age: number; sbp: number };

export type Tone = 'green' | 'yellow' | 'orange' | 'red' | 'purple';

export const TONES: Record<Tone, { color: string; soft: string; on: string; text: string }> = {
  green: { color: '#28a745', soft: '#e9f7ec', on: '#ffffff', text: '#1e7b34' },
  yellow: { color: '#ffc107', soft: '#fff8e1', on: '#3d2e00', text: '#9a7300' },
  orange: { color: '#fd7e14', soft: '#fff1e6', on: '#ffffff', text: '#c2570a' },
  red: { color: '#dc3545', soft: '#fdecee', on: '#ffffff', text: '#b02a37' },
  purple: { color: '#6f42c1', soft: '#f1ebfa', on: '#ffffff', text: '#5a32a3' },
};

export interface RiskCategory {
  id: string;
  /** inclusive lower bound (%) */
  min: number;
  /** exclusive upper bound (%) */
  max: number;
  label: string;
  labelEn: string;
  tone: Tone;
  interpretation: string;
  recommendations: string[];
}

export interface ResultDetail {
  label: string;
  value: string;
}

export interface ModelResult {
  modelId: ModelId;
  /** Point estimate of 10-year risk in %, or null for chart-based models that only give a band. */
  risk: number | null;
  /** Risk band for chart-based models (WHO/ISH). */
  range?: { min: number; max: number };
  /** Text shown as the headline number, e.g. "12.34" or "10–<20" */
  display: string;
  /** Sub-model actually used, e.g. "SCORE2-OP · Moderate-risk region" */
  variant: string;
  category: RiskCategory;
  categories: RiskCategory[];
  details: ResultDetail[];
  notes: string[];
}

export interface ModelDef {
  id: ModelId;
  engine: EngineId;
  name: string;
  shortName: string;
  outcome: string;
  ageRange: [number, number];
  required: (p: PatientData) => NumericField[];
  /** Risk categories used for the colour legend (SCORE2 thresholds depend on age). */
  legend: (age?: number) => RiskCategory[];
  optional?: NumericField[];
  options?: OptionControl[];
  calculate: (p: CheckedPatient) => ModelResult;
}

export const MGDL_PER_MMOL = 38.67;

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function toPercent(probability: number): number {
  return clamp(Number.isFinite(probability) ? probability * 100 : 100, 0, 100);
}

export function categorize(risk: number, categories: RiskCategory[]): RiskCategory {
  return categories.find((c) => risk >= c.min && risk < c.max) ?? categories[categories.length - 1];
}

export function pointResult(
  base: Omit<ModelResult, 'risk' | 'display' | 'category' | 'range'>,
  risk: number,
): ModelResult {
  return { ...base, risk, display: risk.toFixed(2), category: categorize(risk, base.categories) };
}

export const fmt = (n: number, digits = 2) => n.toFixed(digits);
