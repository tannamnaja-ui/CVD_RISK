import { ascvd } from './ascvd';
import { framingham } from './framingham';
import { qrisk3 } from './qrisk3';
import { score2 } from './score2';
import { thaiLab, thaiNonLab, thaiRatio } from './thai';
import type { CheckedPatient, EngineId, ModelDef, ModelId, ModelResult, NumericField, PatientData, ThaiMode } from './types';
import { whoIsh } from './whoIsh';

export * from './types';

export const MODELS: Record<ModelId, ModelDef> = {
  'thai-ratio': thaiRatio,
  'thai-lab': thaiLab,
  'thai-nonlab': thaiNonLab,
  frs: framingham,
  ascvd,
  score2,
  who: whoIsh,
  qrisk3,
};

/** Order used by the comparison table. */
export const MODEL_ORDER: ModelId[] = ['thai-lab', 'thai-nonlab', 'frs', 'ascvd', 'score2', 'who', 'qrisk3'];

export interface EngineInfo {
  id: EngineId;
  label: string;
  sublabel: string;
  ageLabel?: string;
}

export const ENGINES: EngineInfo[] = [
  { id: 'thai', label: 'Thai CV Risk', sublabel: 'อัตโนมัติตามผลเลือด' },
  { id: 'thai-ratio', label: 'Thai CV · TC/HDL', sublabel: 'ใช้สูตร TC ทางการ (ไม่ใช้ HDL)' },
  { id: 'thai-tc', label: 'Thai CV · TC', sublabel: 'สูตรทางการ · ตามตารางสี' },
  { id: 'thai-nonlab', label: 'Thai CV · Non-Lab', sublabel: 'WHtR · สูตรทางการ' },
  { id: 'frs', label: 'Framingham', sublabel: 'General CVD 2008', ageLabel: '30–74 ปี' },
  { id: 'ascvd', label: 'ASCVD', sublabel: 'ACC/AHA PCE 2013', ageLabel: '40–79 ปี' },
  { id: 'score2', label: 'SCORE2 / OP', sublabel: 'ESC 2021', ageLabel: '40–89 ปี' },
  { id: 'who', label: 'WHO/ISH', sublabel: 'SEAR B/D Charts', ageLabel: '40+ ปี' },
  { id: 'qrisk3', label: 'QRISK3', sublabel: 'UK NHS · NICE', ageLabel: '25–84 ปี' },
];

export const isThaiEngine = (e: EngineId) => e === 'thai' || e.startsWith('thai-');

/** Thai cards that pin one formula (the plain 'thai' card chooses automatically). */
export const THAI_ENGINE_MODE: Partial<Record<EngineId, ThaiMode>> = { 'thai-ratio': 'ratio', 'thai-tc': 'lab', 'thai-nonlab': 'nonlab' };

export function modelFor(engine: EngineId, thaiMode: ThaiMode): ModelDef {
  if (isThaiEngine(engine)) {
    const mode = THAI_ENGINE_MODE[engine] ?? thaiMode;
    return mode === 'ratio' ? thaiRatio : mode === 'lab' ? thaiLab : thaiNonLab;
  }
  return Object.values(MODELS).find((m) => m.engine === engine)!;
}

export type Assessment =
  /** outsideAge: the patient's age is outside the range the model was developed for (calculated anyway, with a note) */
  | { status: 'ok'; model: ModelDef; result: ModelResult; outsideAge?: string }
  | { status: 'missing'; model: ModelDef; fields: NumericField[] };

/** Check a model's required inputs and age range, then calculate. */
export function assess(model: ModelDef, patient: PatientData): Assessment {
  const missing = model.required(patient).filter((f) => patient[f] === undefined);
  if (missing.length > 0) return { status: 'missing', model, fields: missing };

  // every model calculates with the patient's real age; outside its development range the result carries a note
  const result = model.calculate(patient as CheckedPatient);
  const [minAge, maxAge] = model.ageRange;
  const age = patient.age!;
  if (age < minAge || age > maxAge) {
    const range = maxAge >= 100 ? `${minAge} ปีขึ้นไป` : `${minAge}–${maxAge} ปี`;
    const outsideAge = `อายุ ${age} ปี อยู่นอกช่วงอายุที่ใช้พัฒนาสูตรนี้ (${range}) — ผลเป็นการประมาณ ควรใช้ด้วยความระมัดระวัง`;
    return { status: 'ok', model, result: { ...result, notes: [outsideAge, ...result.notes] }, outsideAge };
  }
  return { status: 'ok', model, result };
}
