import type {
  AscvdRace,
  DiabetesType,
  Gender,
  ModelDef,
  NumericField,
  PatientData,
  QriskConditions,
  Score2Region,
  SmokeIntensity,
  ThaiMode,
  WhoRegion,
} from './engines';

/** Raw form values — numbers kept as strings so partially typed input is preserved across engine switches. */
export interface FormValues {
  age: string;
  sbp: string;
  tc: string;
  hdl: string;
  waist: string;
  height: string;
  weight: string;
  sbpSd: string;
  townsend: string;
  gender: Gender | '';
  dm: boolean;
  smoke: boolean;
  bpMeds: boolean;
  exSmoker: boolean;
  thaiMode: ThaiMode;
  /** Thai CV Risk formula picked by the user; 'auto' chooses from the lab values entered */
  thaiFormula: ThaiFormulaChoice;
  score2Region: Score2Region;
  whoRegion: WhoRegion;
  ascvdRace: AscvdRace;
  qriskEthnicity: number;
  smokeIntensity: SmokeIntensity;
  dmType: DiabetesType;
  conditions: QriskConditions;
}

export const EMPTY_FORM: FormValues = {
  age: '',
  sbp: '',
  tc: '',
  hdl: '',
  waist: '',
  height: '',
  weight: '',
  sbpSd: '',
  townsend: '',
  gender: '',
  dm: false,
  smoke: false,
  bpMeds: false,
  exSmoker: false,
  thaiMode: 'lab',
  thaiFormula: 'auto',
  score2Region: 'moderate',
  whoRegion: 'SEAR_B',
  ascvdRace: 'white',
  qriskEthnicity: 4, // Other Asian
  smokeIntensity: 'moderate',
  dmType: 'type2',
  conditions: {
    familyHistory: false,
    ckd: false,
    ra: false,
    af: false,
    migraine: false,
    sle: false,
    steroids: false,
    atypicalAntipsychotic: false,
    severeMentalIllness: false,
    erectileDysfunction: false,
  },
};

export interface NumericRule {
  label: string;
  short: string;
  min: number;
  max: number;
  unit: string;
  integer?: boolean;
  /** min may be negative */
  signed?: boolean;
}

/** Plausibility ranges for input; model-specific limits are handled by each engine. */
export const NUMERIC_RULES: Record<NumericField, NumericRule> = {
  age: { label: 'อายุ', short: 'อายุ', min: 1, max: 120, unit: 'ปี', integer: true },
  sbp: { label: 'ความดันโลหิตตัวบน', short: 'SBP', min: 70, max: 250, unit: 'mmHg' },
  tc: { label: 'Total Cholesterol', short: 'TC', min: 50, max: 500, unit: 'mg/dL' },
  hdl: { label: 'HDL Cholesterol', short: 'HDL', min: 10, max: 150, unit: 'mg/dL' },
  waist: { label: 'รอบเอว', short: 'รอบเอว', min: 40, max: 200, unit: 'ซม.' },
  height: { label: 'ส่วนสูง', short: 'ส่วนสูง', min: 100, max: 230, unit: 'ซม.' },
  weight: { label: 'น้ำหนัก', short: 'น้ำหนัก', min: 25, max: 250, unit: 'กก.' },
  sbpSd: { label: 'SD ของ SBP', short: 'SD ของ SBP', min: 0, max: 60, unit: 'mmHg' },
  townsend: { label: 'Townsend score', short: 'Townsend', min: -10, max: 15, unit: '', signed: true },
};

export type FormErrors = Partial<Record<NumericField | 'gender', string>>;

export function parseNumber(value: string): number | undefined {
  if (value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function rangeError(field: NumericField, raw: string): string | undefined {
  if (raw.trim() === '') return undefined;
  const rule = NUMERIC_RULES[field];
  const n = parseNumber(raw);
  if (n === undefined) return 'กรุณากรอกตัวเลข';
  if (rule.integer && !Number.isInteger(n)) return `${rule.label}ต้องเป็นจำนวนเต็ม`;
  if (n < rule.min || n > rule.max) return `ค่าควรอยู่ระหว่าง ${rule.min}–${rule.max} ${rule.unit}`.trim();
  return undefined;
}

/** Converts raw values to PatientData; invalid or blank numbers become undefined. */
export function toPatient(values: FormValues): PatientData {
  const num = (f: NumericField) => (rangeError(f, values[f]) ? undefined : parseNumber(values[f]));
  return {
    age: num('age'),
    sbp: num('sbp'),
    tc: num('tc'),
    hdl: num('hdl'),
    waist: num('waist'),
    height: num('height'),
    weight: num('weight'),
    sbpSd: num('sbpSd'),
    townsend: num('townsend'),
    gender: values.gender || 'male',
    dm: values.dm,
    smoke: values.smoke,
    bpMeds: values.bpMeds,
    exSmoker: values.exSmoker,
    score2Region: values.score2Region,
    whoRegion: values.whoRegion,
    ascvdRace: values.ascvdRace,
    qriskEthnicity: values.qriskEthnicity,
    smokeIntensity: values.smokeIntensity,
    dmType: values.dmType,
    conditions: values.conditions,
  };
}

/** Errors for the selected model: required-but-missing and out-of-plausible-range. */
export function validateForModel(values: FormValues, model: ModelDef): FormErrors {
  const errors: FormErrors = {};
  const patient = toPatient(values);
  const fields = [...model.required(patient), ...(model.optional ?? [])];

  for (const f of fields) {
    const err = rangeError(f, values[f]);
    if (err) errors[f] = err;
    else if (values[f].trim() === '' && model.required(patient).includes(f)) errors[f] = `กรุณากรอก${NUMERIC_RULES[f].label}`;
  }

  // no model age-range error: every model calculates with the real age (assess adds a note outside its range)

  if (!values.gender) errors.gender = 'กรุณาเลือกเพศ';
  return errors;
}

/**
 * Thai CV Risk picks its model from the lab data: Total Cholesterol → official TC model (as colour chart 2),
 * no TC → Non-Laboratory (waist/height). HDL is not part of the official equations.
 */
export function autoThaiMode(v: Pick<FormValues, 'tc' | 'hdl'>): ThaiMode {
  // the official equations use Total Cholesterol (not HDL): TC → TC model, otherwise waist/height
  return parseNumber(v.tc) !== undefined ? 'lab' : 'nonlab';
}

export type ThaiFormulaChoice = 'auto' | ThaiMode;

/** The Thai model actually used: the user's choice, or automatic from the lab values. */
export function resolveThaiMode(v: Pick<FormValues, 'tc' | 'hdl' | 'thaiFormula'>): ThaiMode {
  return v.thaiFormula && v.thaiFormula !== 'auto' ? v.thaiFormula : autoThaiMode(v);
}

export function visibleFields(model: ModelDef, values: FormValues): Set<NumericField> {
  return new Set([...model.required(toPatient(values)), ...(model.optional ?? [])]);
}
