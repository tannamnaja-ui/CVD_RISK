/**
 * Counselling aids for the patient summary: which modifiable risk factors are present, and what the
 * Thai CV Risk would be if each were brought to target ("what if"). Thai CV Risk only — it is the score
 * saved to HOSxP and the one the colour chart and the advice belong to.
 */
import { assess, modelFor, type ModelResult } from './engines';
import { parseNumber, toPatient, validateForModel, type FormValues } from './formModel';

/** Targets used for the scenarios (printed on the sheet). */
export const TARGETS = { sbp: 130, tc: 200, whtr: 0.5 } as const;

export interface Scenario {
  id: 'smoke' | 'sbp' | 'tc' | 'waist' | 'all';
  label: string;
  result: ModelResult;
}

export interface ModifiableFactor {
  id: 'smoke' | 'sbp' | 'tc' | 'hdl' | 'whtr' | 'dm';
  label: string;
  advice: string;
}

/** Thai CV Risk with the formula the app uses for these values (the one that is saved). */
export function thaiResult(values: FormValues): ModelResult | null {
  const model = modelFor('thai', values.thaiMode);
  if (Object.keys(validateForModel(values, model)).length) return null;
  const outcome = assess(model, toPatient(values));
  return outcome.status === 'ok' ? outcome.result : null;
}

const num = (s: string) => parseNumber(s) ?? null;
const fmt = (n: number, digits = 0) => String(Math.round(n * 10 ** digits) / 10 ** digits);

/** One change per modifiable factor that is off target, plus all of them together. */
export function thaiWhatIf(values: FormValues): { base: ModelResult; scenarios: Scenario[] } | null {
  const base = thaiResult(values);
  if (!base) return null;
  const sbp = num(values.sbp);
  const tc = num(values.tc);
  const waist = num(values.waist);
  const height = num(values.height);
  const usesLab = values.thaiMode !== 'nonlab';

  const changes: { id: Scenario['id']; label: string; patch: Partial<FormValues> }[] = [];
  if (values.smoke) changes.push({ id: 'smoke', label: 'เลิกสูบบุหรี่', patch: { smoke: false } });
  if (sbp !== null && sbp > TARGETS.sbp) {
    changes.push({ id: 'sbp', label: `ลดความดันตัวบนจาก ${fmt(sbp)} เหลือ ${TARGETS.sbp} mmHg`, patch: { sbp: String(TARGETS.sbp) } });
  }
  if (usesLab && tc !== null && tc > TARGETS.tc) {
    changes.push({ id: 'tc', label: `ลดโคเลสเตอรอลรวมจาก ${fmt(tc)} เหลือ ${TARGETS.tc} mg/dL`, patch: { tc: String(TARGETS.tc) } });
  }
  if (!usesLab && waist !== null && height !== null && waist / height >= TARGETS.whtr) {
    const target = Math.ceil(height * TARGETS.whtr) - 1;
    changes.push({ id: 'waist', label: `ลดรอบเอวจาก ${fmt(waist, 1)} เหลือ ${target} ซม. (น้อยกว่าครึ่งหนึ่งของส่วนสูง)`, patch: { waist: String(target) } });
  }
  if (changes.length > 1) {
    changes.push({ id: 'all', label: 'ทำได้ทุกข้อข้างต้นพร้อมกัน', patch: Object.assign({}, ...changes.map((c) => c.patch)) });
  }

  const scenarios = changes
    .map((c) => ({ id: c.id, label: c.label, result: thaiResult({ ...values, ...c.patch }) }))
    .filter((s): s is Scenario => s.result !== null);
  return { base, scenarios };
}

/** Risk factors in the data that treatment or lifestyle can change, with short advice for the patient. */
export function modifiableFactors(values: FormValues): ModifiableFactor[] {
  const out: ModifiableFactor[] = [];
  const sbp = num(values.sbp);
  const tc = num(values.tc);
  const hdl = num(values.hdl);
  const waist = num(values.waist);
  const height = num(values.height);
  if (values.smoke) out.push({ id: 'smoke', label: 'สูบบุหรี่', advice: 'เลิกสูบ — ขอคำปรึกษาได้ที่สายด่วนเลิกบุหรี่ 1600' });
  if (sbp !== null && sbp >= 140) out.push({ id: 'sbp', label: `ความดันโลหิตสูง (SBP ${fmt(sbp)} mmHg)`, advice: 'ควรต่ำกว่า 140/90 mmHg — ลดเค็ม รับประทานยาสม่ำเสมอ' });
  else if (sbp !== null && sbp > TARGETS.sbp) out.push({ id: 'sbp', label: `ความดันค่อนข้างสูง (SBP ${fmt(sbp)} mmHg)`, advice: `ลดเค็ม ออกกำลังกาย ให้ความดันตัวบนใกล้ ${TARGETS.sbp} mmHg` });
  if (tc !== null && tc >= TARGETS.tc) out.push({ id: 'tc', label: `โคเลสเตอรอลรวมสูง (${fmt(tc)} mg/dL)`, advice: `ควรต่ำกว่า ${TARGETS.tc} mg/dL — ลดของทอด ของมัน เนื้อติดมัน` });
  const hdlLow = values.gender === 'female' ? 50 : 40;
  if (hdl !== null && hdl < hdlLow) out.push({ id: 'hdl', label: `HDL ต่ำ (${fmt(hdl)} mg/dL)`, advice: `ควรมากกว่า ${hdlLow} mg/dL — ออกกำลังกายสม่ำเสมอ เลิกบุหรี่` });
  if (waist !== null && height !== null && waist / height >= TARGETS.whtr) {
    out.push({ id: 'whtr', label: `อ้วนลงพุง (รอบเอว ${fmt(waist, 1)} ซม.)`, advice: `รอบเอวควรน้อยกว่า ${fmt(height / 2, 1)} ซม. (ครึ่งหนึ่งของส่วนสูง)` });
  }
  if (values.dm) out.push({ id: 'dm', label: 'เบาหวาน', advice: 'ควบคุมระดับน้ำตาลตามเป้าหมายที่แพทย์กำหนด รับประทานยาสม่ำเสมอ' });
  return out;
}
