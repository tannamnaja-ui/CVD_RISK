import { fmt, pointResult, toPercent, type CheckedPatient, type ModelDef, type RiskCategory, type ThaiMode } from './types';

/**
 * Thai CV Risk Score. lab / nonlab: the official equations (P FullScore = 1 − 0.978296^exp(FullScore − c));
 * ratio: as supplied for this project, not verified.
 */
export const THAI_COEFFICIENTS = {
  /** Ramathibodi (EGAT study) model with the TC/HDL-C ratio — coefficients as supplied for this project. */
  ratio: {
    coef: { age: 0.0706, male: 0.5401, dm: 0.5492, smoke: 0.4184, sbp: 0.0152, ratio: 0.1691 },
    baselineSurvival: 0.9592,
    meanSum: 7.7479,
  },
  /** Official Thai CV Risk Score with Total Cholesterol (sex: male 1, female 0) — see THAI_FORMULAS.lab.source */
  lab: {
    coef: { age: 0.08183, male: 0.39499, dm: 0.69974, smoke: 0.41916, sbp: 0.02084, tc: 0.00212 },
    baselineSurvival: 0.978296,
    meanSum: 7.04423,
  },
  /** Official Thai CV Risk Score without lab values (waist/height) — see THAI_FORMULAS.nonlab.source */
  nonlab: {
    coef: { age: 0.079, male: 0.128, dm: 0.58454, smoke: 0.459, sbp: 0.019350987, whtr: 3.512566 },
    baselineSurvival: 0.978296,
    meanSum: 7.720484,
  },
} as const;

export interface ThaiFormulaInfo {
  name: string;
  needs: string;
  source: string;
  /** checked against a published source or the official colour chart */
  verified: boolean;
  caution?: string;
}

export const THAI_FORMULAS: Record<ThaiMode, ThaiFormulaInfo> = {
  ratio: {
    name: 'สูตร TC/HDL Ratio',
    needs: 'ต้องมี Total Cholesterol และ HDL',
    source: 'สัมประสิทธิ์ตามข้อมูลที่ผู้ใช้ส่งมา ระบุว่าเป็นสมการของคณะแพทยศาสตร์ รพ.รามาธิบดี (โครงการศึกษาพนักงาน กฟผ. / EGAT Study)',
    verified: false,
    caution: 'ยังไม่ได้ตรวจสอบกับบทความต้นฉบับ และค่า S₀ = 0.9592, M̄ = 7.7479 ซ้ำกับสูตร Total Cholesterol ทั้งที่ตัวแปรต่างกัน',
  },
  lab: {
    name: 'สูตร Total Cholesterol',
    needs: 'ต้องมี Total Cholesterol',
    source:
      'Thai CV Risk Score กรณีมีค่า Total Cholesterol ตามเอกสาร "การประเมิน Thai CV Risk Score จากข้อมูล 43 แฟ้ม" (สูตรเดียวกับที่ใช้ทำตารางสีของกรมควบคุมโรค)',
    verified: true,
    caution: 'ตารางสีให้สีเดียวต่อช่วงอายุ/ความดัน/โคเลสเตอรอล — ผลจากสูตรใช้ค่าจริงของผู้ป่วย จึงอาจต่างจากสีในตารางได้เมื่อค่าอยู่ปลายช่วง',
  },
  nonlab: {
    name: 'สูตร Non-Laboratory (WHtR)',
    needs: 'ต้องมีรอบเอวและส่วนสูง',
    source:
      'Thai CV Risk Score กรณีไม่มีค่า Total Cholesterol ตามเอกสาร "การประเมิน Thai CV Risk Score จากข้อมูล 43 แฟ้ม" และหน้าคู่มือคะแนน เขตสุขภาพที่ 10 กระทรวงสาธารณสุข',
    verified: true,
  },
};

export const THAI_CATEGORIES: RiskCategory[] = [
  {
    id: 'low',
    min: 0,
    max: 10,
    label: 'เสี่ยงต่ำ',
    labelEn: 'Low',
    tone: 'green',
    interpretation: 'ความเสี่ยงต่ำ (< 10%) — เน้นการส่งเสริมสุขภาพและป้องกัน',
    recommendations: [
      'รักษาพฤติกรรมสุขภาพที่ดีต่อไป',
      'ออกกำลังกายระดับปานกลางอย่างน้อย 150 นาที/สัปดาห์',
      'รับประทานผัก ผลไม้ ลดอาหารหวาน มัน เค็ม',
      'ประเมินความเสี่ยงซ้ำอย่างน้อยปีละ 1 ครั้ง',
    ],
  },
  {
    id: 'moderate',
    min: 10,
    max: 20,
    label: 'เสี่ยงปานกลาง',
    labelEn: 'Moderate',
    tone: 'yellow',
    interpretation: 'ความเสี่ยงปานกลาง (10–<20%) — ควรปรับเปลี่ยนพฤติกรรมอย่างจริงจัง',
    recommendations: [
      'ลดเค็ม (โซเดียม < 2,000 มก./วัน) ลดของทอด ของมัน',
      'ควบคุมน้ำหนักและรอบเอว (รอบเอว < ส่วนสูง ÷ 2)',
      'งดสูบบุหรี่ และลดการดื่มแอลกอฮอล์',
      'ตรวจติดตามความดัน น้ำตาล และไขมันในเลือด ทุก 6–12 เดือน',
    ],
  },
  {
    id: 'high',
    min: 20,
    max: 30,
    label: 'เสี่ยงสูง',
    labelEn: 'High',
    tone: 'orange',
    interpretation: 'ความเสี่ยงสูง (20–<30%) — ควรพบแพทย์เพื่อประเมินและพิจารณาการใช้ยา',
    recommendations: [
      'ปรึกษาแพทย์เพื่อประเมินปัจจัยเสี่ยงและพิจารณาการใช้ยา',
      'ควบคุมความดันโลหิตให้ต่ำกว่า 140/90 mmHg',
      'เข้าร่วมคลินิกเลิกบุหรี่ (สายด่วน 1600)',
      'ออกกำลังกายสม่ำเสมอ และติดตามผลทุก 3–6 เดือน',
    ],
  },
  {
    id: 'veryHigh',
    min: 30,
    max: 40,
    label: 'เสี่ยงสูงมาก',
    labelEn: 'Very High',
    tone: 'red',
    interpretation: 'ความเสี่ยงสูงมาก (30–<40%) — ควรได้รับการรักษาด้วยยาร่วมกับปรับพฤติกรรม',
    recommendations: [
      'ส่งพบแพทย์เพื่อพิจารณาการรักษาด้วยยา (เช่น ยาลดไขมัน ยาลดความดัน)',
      'ควบคุมเบาหวาน ความดัน และไขมันอย่างเข้มงวด',
      'เลิกบุหรี่ทันที',
      'ติดตามอาการอย่างใกล้ชิดทุก 1–3 เดือน',
    ],
  },
  {
    id: 'extreme',
    min: 40,
    max: Infinity,
    label: 'อันตรายสูงสุด',
    labelEn: 'Extreme',
    tone: 'purple',
    interpretation: 'ความเสี่ยงอันตรายสูงสุด (≥ 40%) — ต้องส่งต่อพบแพทย์โดยเร็ว',
    recommendations: [
      'ส่งต่อพบแพทย์โดยเร็วเพื่อรับการรักษาและติดตามอย่างใกล้ชิด',
      'หากมีอาการเจ็บแน่นหน้าอก เหนื่อยหอบ แขนขาอ่อนแรง หรือพูดไม่ชัด ให้รีบโทร 1669 ทันที',
      'ใช้ยาตามแพทย์สั่งอย่างเคร่งครัด ห้ามหยุดยาเอง',
      'ปรับพฤติกรรมทุกด้านร่วมกับทีมสหวิชาชีพ',
    ],
  },
];

const riskFromSum = (sum: number, s0: number, mean: number) => toPercent(1 - Math.pow(s0, Math.exp(sum - mean)));

const base = {
  name: 'Thai CV Risk Score',
  outcome: 'โรคหัวใจและหลอดเลือด (CVD) ใน 10 ปี',
  ageRange: [35, 70] as [number, number],
};

export const thaiLab: ModelDef = {
  ...base,
  engine: 'thai-tc',
  id: 'thai-lab',
  shortName: 'Thai CV (Lab)',
  required: () => ['age', 'sbp', 'tc'],
  legend: () => THAI_CATEGORIES,
  calculate(p: CheckedPatient) {
    const { coef, baselineSurvival, meanSum } = THAI_COEFFICIENTS.lab;
    const sum =
      coef.age * p.age +
      coef.male * (p.gender === 'male' ? 1 : 0) +
      coef.dm * (p.dm ? 1 : 0) +
      coef.smoke * (p.smoke ? 1 : 0) +
      coef.sbp * p.sbp +
      coef.tc * p.tc!;
    return pointResult(
      {
        modelId: 'thai-lab',
        variant: 'Laboratory model (Total Cholesterol)',
        categories: THAI_CATEGORIES,
        details: [{ label: 'ΣβX', value: fmt(sum, 4) }],
        notes: [],
      },
      riskFromSum(sum, baselineSurvival, meanSum),
    );
  },
};

export const thaiRatio: ModelDef = {
  ...base,
  engine: 'thai-ratio',
  id: 'thai-ratio',
  shortName: 'Thai CV (TC/HDL)',
  required: () => ['age', 'sbp', 'tc', 'hdl'],
  legend: () => THAI_CATEGORIES,
  calculate(p: CheckedPatient) {
    const { coef, baselineSurvival, meanSum } = THAI_COEFFICIENTS.ratio;
    const ratio = p.tc! / p.hdl!;
    const sum =
      coef.male * (p.gender === 'male' ? 1 : 0) +
      coef.age * p.age +
      coef.sbp * p.sbp +
      coef.dm * (p.dm ? 1 : 0) +
      coef.smoke * (p.smoke ? 1 : 0) +
      coef.ratio * ratio;
    return pointResult(
      {
        modelId: 'thai-ratio',
        variant: 'Laboratory model (TC/HDL-C ratio)',
        categories: THAI_CATEGORIES,
        details: [
          { label: 'TC/HDL ratio', value: fmt(ratio) },
          { label: 'ΣβX', value: fmt(sum, 4) },
        ],
        notes: [],
      },
      riskFromSum(sum, baselineSurvival, meanSum),
    );
  },
};

export const thaiNonLab: ModelDef = {
  ...base,
  engine: 'thai-nonlab',
  id: 'thai-nonlab',
  shortName: 'Thai CV (Non-Lab)',
  required: () => ['age', 'sbp', 'waist', 'height'],
  legend: () => THAI_CATEGORIES,
  calculate(p: CheckedPatient) {
    const { coef, baselineSurvival, meanSum } = THAI_COEFFICIENTS.nonlab;
    const whtr = p.waist! / p.height!;
    const sum =
      coef.age * p.age +
      coef.male * (p.gender === 'male' ? 1 : 0) +
      coef.dm * (p.dm ? 1 : 0) +
      coef.smoke * (p.smoke ? 1 : 0) +
      coef.sbp * p.sbp +
      coef.whtr * whtr;
    return pointResult(
      {
        modelId: 'thai-nonlab',
        variant: 'Non-Laboratory model (WHtR)',
        categories: THAI_CATEGORIES,
        details: [
          { label: 'WHtR', value: fmt(whtr) },
          { label: 'ΣβX', value: fmt(sum, 4) },
        ],
        notes: [],
      },
      riskFromSum(sum, baselineSurvival, meanSum),
    );
  },
};
