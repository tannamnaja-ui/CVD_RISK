import { fmt, pointResult, toPercent, type CheckedPatient, type ModelDef, type RiskCategory, type ThaiMode } from './types';

/**
 * Thai CV Risk Score — the official equations (P FullScore = 1 − 0.978296^exp(FullScore − c)).
 * There is no official TC/HDL equation, so the TC/HDL card uses the TC one (see thaiRatio).
 */
export const THAI_COEFFICIENTS = {
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
    name: 'สูตร Total Cholesterol (กล่อง TC/HDL)',
    needs: 'ต้องมี Total Cholesterol (ไม่ใช้ HDL)',
    source:
      'ใช้สมการทางการแบบ Total Cholesterol เหมือนสูตรที่ 2 — ยังไม่พบสมการ TC/HDL ทางการ (สัมประสิทธิ์ TC/HDL ที่เคยส่งมาไม่ได้ใช้แล้ว)',
    verified: true,
    caution: 'คำนวณตามตารางสีที่ 2: ใช้ค่าต่ำสุดของช่วงอายุ/ความดัน/โคเลสเตอรอล — ผลจากค่าจริงแสดงไว้ในรายละเอียด',
  },
  lab: {
    name: 'สูตร Total Cholesterol',
    needs: 'ต้องมี Total Cholesterol',
    source:
      'Thai CV Risk Score กรณีมีค่า Total Cholesterol ตามเอกสาร "การประเมิน Thai CV Risk Score จากข้อมูล 43 แฟ้ม" (สูตรเดียวกับที่ใช้ทำตารางสีของกรมควบคุมโรค)',
    verified: true,
    caution: 'คำนวณตามตารางสีที่ 2: ใช้ค่าต่ำสุดของช่วงอายุ/ความดัน/โคเลสเตอรอล ให้ได้สีเดียวกับตาราง — ผลจากค่าจริงแสดงไว้ในรายละเอียด',
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

/**
 * Colour chart 2 (DDC, with Total Cholesterol) gives one colour per band of age / SBP / TC. Checked against all
 * 800 cells of the chart: it is the official equation evaluated at the lower edge of each band (752/800 cells
 * agree; the rest sit on the 10% / 30% boundaries). The Thai TC model works the same way, so its result is the
 * chart's colour; the result for the patient's exact values is shown alongside.
 */
const CHART_BANDS = {
  age: [
    { from: 65, label: '≥ 65' },
    { from: 60, label: '60–64' },
    { from: 55, label: '55–59' },
    { from: 50, label: '50–54' },
    { from: 40, label: '< 40–49', min: -Infinity },
  ],
  sbp: [
    { from: 180, label: '≥ 180' },
    { from: 160, label: '160–179' },
    { from: 140, label: '140–159' },
    { from: 120, label: '< 120–139', min: -Infinity },
  ],
  tc: [
    { from: 320, label: '≥ 320' },
    { from: 280, label: '280–319' },
    { from: 240, label: '240–279' },
    { from: 200, label: '200–239' },
    { from: 160, label: '< 160–199', min: -Infinity },
  ],
};
type Band = { from: number; label: string; min?: number };
const bandOf = (bands: Band[], v: number) => bands.find((b) => v >= (b.min ?? b.from))!;

/** The chart cell of a patient: band label and the value the chart was drawn with, per variable. */
export function chartCell(p: { age: number; sbp: number; tc: number }) {
  return { age: bandOf(CHART_BANDS.age, p.age), sbp: bandOf(CHART_BANDS.sbp, p.sbp), tc: bandOf(CHART_BANDS.tc, p.tc) };
}

function labSum(p: { age: number; sbp: number; tc: number; gender: CheckedPatient['gender']; dm: boolean; smoke: boolean }) {
  const { coef } = THAI_COEFFICIENTS.lab;
  return (
    coef.age * p.age +
    coef.male * (p.gender === 'male' ? 1 : 0) +
    coef.dm * (p.dm ? 1 : 0) +
    coef.smoke * (p.smoke ? 1 : 0) +
    coef.sbp * p.sbp +
    coef.tc * p.tc
  );
}

/** Official Thai CV Risk (Total Cholesterol), read the way colour chart 2 reads it. */
function calculateLab(p: CheckedPatient, modelId: 'thai-lab' | 'thai-ratio') {
  const { baselineSurvival, meanSum } = THAI_COEFFICIENTS.lab;
  const cell = chartCell({ age: p.age, sbp: p.sbp, tc: p.tc! });
  const chartSum = labSum({ ...p, age: cell.age.from, sbp: cell.sbp.from, tc: cell.tc.from });
  const chartRisk = riskFromSum(chartSum, baselineSurvival, meanSum);
  const exactRisk = riskFromSum(labSum({ ...p, tc: p.tc! }), baselineSurvival, meanSum);
  return pointResult(
    {
      modelId,
      variant: 'Total Cholesterol · ตามตารางสีกรมควบคุมโรค',
      categories: THAI_CATEGORIES,
      details: [
        { label: 'ช่องในตารางสี', value: `อายุ ${cell.age.label} · SBP ${cell.sbp.label} · TC ${cell.tc.label}` },
        { label: 'ผลจากค่าจริง', value: `${fmt(exactRisk)}%` },
        { label: 'FullScore (ตารางสี)', value: fmt(chartSum, 4) },
      ],
      notes: [
        `คำนวณตามตารางสีที่ 2: ใช้ค่าต่ำสุดของช่วง (อายุ ${cell.age.from}, SBP ${cell.sbp.from}, TC ${cell.tc.from}) — ผลจากค่าจริงของผู้ป่วย ${fmt(exactRisk)}%`,
      ],
    },
    chartRisk,
  );
}

export const thaiLab: ModelDef = {
  ...base,
  engine: 'thai-tc',
  id: 'thai-lab',
  shortName: 'Thai CV (TC)',
  required: () => ['age', 'sbp', 'tc'],
  legend: () => THAI_CATEGORIES,
  calculate: (p: CheckedPatient) => calculateLab(p, 'thai-lab'),
};

/** Card 2 ("TC/HDL"): uses the official Total Cholesterol equation too — no official TC/HDL equation was found. */
export const thaiRatio: ModelDef = {
  ...base,
  engine: 'thai-ratio',
  id: 'thai-ratio',
  shortName: 'Thai CV (TC)',
  required: () => ['age', 'sbp', 'tc'],
  legend: () => THAI_CATEGORIES,
  calculate: (p: CheckedPatient) => calculateLab(p, 'thai-ratio'),
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
