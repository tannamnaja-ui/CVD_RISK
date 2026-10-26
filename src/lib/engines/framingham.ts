import { fmt, pointResult, toPercent, type CheckedPatient, type ModelDef, type RiskCategory } from './types';

/** D'Agostino RB et al. General cardiovascular risk profile for use in primary care. Circulation 2008;117:743–753. */
export const FRS_COEFFICIENTS = {
  male: { lnAge: 3.06117, lnTc: 1.1237, lnHdl: -0.93263, lnSbpTreated: 1.99881, lnSbpUntreated: 1.93303, smoke: 0.65451, dm: 0.57367, s0: 0.88936, mean: 23.9802 },
  female: { lnAge: 2.32888, lnTc: 1.20904, lnHdl: -0.70833, lnSbpTreated: 2.82263, lnSbpUntreated: 2.76157, smoke: 0.52873, dm: 0.69154, s0: 0.95012, mean: 26.1931 },
} as const;

/** 3-tier classification shared by Framingham and WHO/ISH. */
export const THREE_TIER_CATEGORIES: RiskCategory[] = [
  {
    id: 'low',
    min: 0,
    max: 10,
    label: 'ความเสี่ยงต่ำ',
    labelEn: 'Low Risk',
    tone: 'green',
    interpretation: 'Low risk (< 10%) — ส่งเสริมการมีวิถีชีวิตที่ดีต่อสุขภาพ ยังไม่จำเป็นต้องใช้ยาเพื่อป้องกันโดยทั่วไป',
    recommendations: [
      'ออกกำลังกายสม่ำเสมอ ≥ 150 นาที/สัปดาห์',
      'อาหารแบบ DASH/Mediterranean ลดเค็ม ลดไขมันอิ่มตัว',
      'งดบุหรี่ ควบคุมน้ำหนัก',
      'ประเมินความเสี่ยงซ้ำทุก 1–2 ปี',
    ],
  },
  {
    id: 'intermediate',
    min: 10,
    max: 20,
    label: 'ความเสี่ยงปานกลาง',
    labelEn: 'Moderate / Intermediate',
    tone: 'yellow',
    interpretation: 'Intermediate risk (10–<20%) — ปรับพฤติกรรมอย่างจริงจัง และพิจารณายาลดไขมันตามดุลยพินิจแพทย์',
    recommendations: [
      'ปรับเปลี่ยนพฤติกรรมอย่างจริงจังและติดตามผล',
      'ปรึกษาแพทย์เพื่อพิจารณายาลดไขมันกลุ่ม Statin',
      'ควบคุมความดันโลหิตและน้ำตาลให้อยู่ในเกณฑ์',
      'ติดตามความเสี่ยงทุก 6–12 เดือน',
    ],
  },
  {
    id: 'high',
    min: 20,
    max: Infinity,
    label: 'ความเสี่ยงสูง',
    labelEn: 'High Risk',
    tone: 'red',
    interpretation: 'High risk (≥ 20%) — แนะนำการรักษาด้วยยาร่วมกับปรับพฤติกรรม และติดตามอย่างใกล้ชิด',
    recommendations: [
      'ส่งพบแพทย์เพื่อเริ่มการรักษาด้วยยา (Statin, ยาลดความดัน ตามข้อบ่งชี้)',
      'ควบคุมปัจจัยเสี่ยงทุกตัวอย่างเข้มงวด',
      'เลิกบุหรี่ทันที (สายด่วนเลิกบุหรี่ 1600)',
      'ติดตามผลทุก 3–6 เดือน',
    ],
  },
];

export const framingham: ModelDef = {
  id: 'frs',
  engine: 'frs',
  name: 'Framingham Risk Score',
  shortName: 'Framingham (FRS)',
  outcome: 'General CVD ใน 10 ปี',
  ageRange: [30, 74],
  legend: () => THREE_TIER_CATEGORIES,
  required: () => ['age', 'sbp', 'tc', 'hdl'],
  options: ['bpMeds'],
  calculate(p: CheckedPatient) {
    const c = FRS_COEFFICIENTS[p.gender];
    const sum =
      c.lnAge * Math.log(p.age) +
      c.lnTc * Math.log(p.tc!) +
      c.lnHdl * Math.log(p.hdl!) +
      (p.bpMeds ? c.lnSbpTreated : c.lnSbpUntreated) * Math.log(p.sbp) +
      c.smoke * (p.smoke ? 1 : 0) +
      c.dm * (p.dm ? 1 : 0);
    const risk = toPercent(1 - Math.pow(c.s0, Math.exp(sum - c.mean)));
    return pointResult(
      {
        modelId: 'frs',
        variant: `General CVD 2008 · ${p.gender === 'male' ? 'Men' : 'Women'} · SBP ${p.bpMeds ? 'treated' : 'untreated'}`,
        categories: THREE_TIER_CATEGORIES,
        details: [
          { label: 'Σβ ln(X)', value: fmt(sum, 4) },
          { label: 'TC/HDL ratio', value: fmt(p.tc! / p.hdl!, 1) },
        ],
        notes: [],
      },
      risk,
    );
  },
};
