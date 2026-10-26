import {
  MGDL_PER_MMOL,
  fmt,
  pointResult,
  toPercent,
  type CheckedPatient,
  type ModelDef,
  type RiskCategory,
  type Score2Region,
} from './types';

/**
 * SCORE2 working group & ESC Cardiovascular Risk Collaboration. Eur Heart J 2021;42:2439–2454 (SCORE2)
 * and SCORE2-OP collaboration. Eur Heart J 2021;42:2455–2467. Coefficients from the supplementary material.
 * Continuous variables are centred: age (yrs), SBP (mmHg), TC and HDL (mmol/L).
 */
export const SCORE2 = {
  male: { age: 0.3742, smoke: 0.6012, sbp: 0.2777, dm: 0.6457, tc: 0.1458, hdl: -0.2698, ageSmoke: -0.0755, ageSbp: -0.0255, ageTc: -0.0281, ageHdl: 0.0426, ageDm: -0.0983, s0: 0.9605 },
  female: { age: 0.4648, smoke: 0.7744, sbp: 0.3131, dm: 0.8096, tc: 0.1002, hdl: -0.2606, ageSmoke: -0.1088, ageSbp: -0.0277, ageTc: -0.0226, ageHdl: 0.0613, ageDm: -0.1272, s0: 0.9776 },
} as const;

export const SCORE2_OP = {
  male: { age: 0.0634, dm: 0.4245, smoke: 0.3524, sbp: 0.0094, tc: 0.085, hdl: -0.3564, ageDm: -0.0174, ageSmoke: -0.0247, ageSbp: -0.0005, ageTc: 0.0073, ageHdl: 0.0091, s0: 0.7576, mean: 0.0929 },
  female: { age: 0.0789, dm: 0.601, smoke: 0.4921, sbp: 0.0102, tc: 0.0605, hdl: -0.304, ageDm: -0.0107, ageSmoke: -0.0255, ageSbp: -0.0004, ageTc: -0.0009, ageHdl: 0.0154, s0: 0.8082, mean: 0.229 },
} as const;

/** Region recalibration scales [scale1, scale2]. */
export const RECALIBRATION: Record<'score2' | 'op', Record<Score2Region, Record<'male' | 'female', [number, number]>>> = {
  score2: {
    low: { male: [-0.5699, 0.7476], female: [-0.738, 0.7019] },
    moderate: { male: [-0.1565, 0.8009], female: [-0.3143, 0.7701] },
    high: { male: [0.3207, 0.936], female: [0.571, 0.9369] },
    veryHigh: { male: [0.5836, 0.8294], female: [0.9412, 0.8329] },
  },
  op: {
    low: { male: [-0.34, 1.19], female: [-0.52, 1.01] },
    moderate: { male: [0.01, 1.25], female: [-0.1, 1.1] },
    high: { male: [0.08, 1.15], female: [0.38, 1.09] },
    veryHigh: { male: [0.05, 0.7], female: [0.38, 0.69] },
  },
};

export const SCORE2_REGION_LABELS: Record<Score2Region, string> = {
  low: 'Low-risk region',
  moderate: 'Moderate-risk region',
  high: 'High-risk region',
  veryHigh: 'Very high-risk region',
};

function score2Categories(age: number): RiskCategory[] {
  const [t1, t2, group] = age < 50 ? [2.5, 7.5, '< 50 ปี'] : age < 70 ? [5, 10, '50–69 ปี'] : [7.5, 15, '≥ 70 ปี'];
  return [
    {
      id: 'lowModerate',
      min: 0,
      max: t1 as number,
      label: 'ความเสี่ยงต่ำ–ปานกลาง',
      labelEn: 'Low-to-moderate',
      tone: 'green',
      interpretation: `Low-to-moderate risk (< ${t1}% สำหรับอายุ ${group}) — โดยทั่วไปยังไม่แนะนำยาลดปัจจัยเสี่ยง เน้นปรับวิถีชีวิต (ESC 2021)`,
      recommendations: [
        'ปรับวิถีชีวิต: ออกกำลังกาย อาหารสุขภาพ งดบุหรี่',
        'ควบคุมน้ำหนักและความดันโลหิต',
        'ประเมินความเสี่ยงซ้ำเป็นระยะ',
      ],
    },
    {
      id: 'high',
      min: t1 as number,
      max: t2 as number,
      label: 'ความเสี่ยงสูง',
      labelEn: 'High',
      tone: 'orange',
      interpretation: `High risk (${t1}–<${t2}% สำหรับอายุ ${group}) — ควรพิจารณา (should be considered) การรักษาปัจจัยเสี่ยงด้วยยา (ESC 2021)`,
      recommendations: [
        'ปรึกษาแพทย์เพื่อพิจารณาการรักษาความดันและไขมันด้วยยา',
        'ตั้งเป้าหมาย LDL-C และความดันโลหิตร่วมกับแพทย์',
        'ปรับวิถีชีวิตอย่างจริงจัง และเลิกบุหรี่',
      ],
    },
    {
      id: 'veryHigh',
      min: t2 as number,
      max: Infinity,
      label: 'ความเสี่ยงสูงมาก',
      labelEn: 'Very high',
      tone: 'red',
      interpretation: `Very high risk (≥ ${t2}% สำหรับอายุ ${group}) — แนะนำ (recommended) การรักษาปัจจัยเสี่ยงด้วยยา (ESC 2021)`,
      recommendations: [
        'ส่งพบแพทย์เพื่อเริ่มการรักษาด้วยยา (Statin, ยาลดความดัน)',
        'ควบคุม LDL-C และความดันโลหิตตามเป้าหมาย ESC อย่างเข้มงวด',
        'เลิกบุหรี่ทันที และติดตามผลอย่างใกล้ชิด',
      ],
    },
  ];
}

export const score2: ModelDef = {
  id: 'score2',
  engine: 'score2',
  name: 'SCORE2 & SCORE2-OP',
  shortName: 'SCORE2 / OP',
  outcome: 'Fatal & non-fatal CVD ใน 10 ปี',
  ageRange: [40, 89],
  legend: (age = 60) => score2Categories(age),
  required: () => ['age', 'sbp', 'tc', 'hdl'],
  options: ['score2Region'],
  calculate(p: CheckedPatient) {
    const sex = p.gender;
    const tc = p.tc! / MGDL_PER_MMOL;
    const hdl = p.hdl! / MGDL_PER_MMOL;
    const smoke = p.smoke ? 1 : 0;
    const dm = p.dm ? 1 : 0;
    const isOp = p.age >= 70;

    let uncalibrated: number;
    if (!isOp) {
      const c = SCORE2[sex];
      const cage = (p.age - 60) / 5;
      const csbp = (p.sbp - 120) / 20;
      const ctc = tc - 6;
      const chdl = (hdl - 1.3) / 0.5;
      const lp =
        c.age * cage +
        c.smoke * smoke +
        c.sbp * csbp +
        c.dm * dm +
        c.tc * ctc +
        c.hdl * chdl +
        c.ageSmoke * cage * smoke +
        c.ageSbp * cage * csbp +
        c.ageTc * cage * ctc +
        c.ageHdl * cage * chdl +
        c.ageDm * cage * dm;
      uncalibrated = 1 - Math.pow(c.s0, Math.exp(lp));
    } else {
      const c = SCORE2_OP[sex];
      const cage = p.age - 73;
      const csbp = p.sbp - 150;
      const ctc = tc - 6;
      const chdl = hdl - 1.4;
      const lp =
        c.age * cage +
        c.dm * dm +
        c.smoke * smoke +
        c.sbp * csbp +
        c.tc * ctc +
        c.hdl * chdl +
        c.ageDm * cage * dm +
        c.ageSmoke * cage * smoke +
        c.ageSbp * cage * csbp +
        c.ageTc * cage * ctc +
        c.ageHdl * cage * chdl;
      uncalibrated = 1 - Math.pow(c.s0, Math.exp(lp - c.mean));
    }

    const [scale1, scale2] = RECALIBRATION[isOp ? 'op' : 'score2'][p.score2Region][sex];
    const calibrated = 1 - Math.exp(-Math.exp(scale1 + scale2 * Math.log(-Math.log(1 - uncalibrated))));

    const notes: string[] = [];
    if (p.dm) notes.push('SCORE2 ไม่ได้ออกแบบสำหรับผู้ป่วยเบาหวาน — ESC แนะนำให้ใช้ SCORE2-Diabetes แทน');

    return pointResult(
      {
        modelId: 'score2',
        variant: `${isOp ? 'SCORE2-OP (≥ 70 ปี)' : 'SCORE2 (40–69 ปี)'} · ${SCORE2_REGION_LABELS[p.score2Region]}`,
        categories: score2Categories(p.age),
        details: [
          { label: 'TC', value: `${fmt(tc)} mmol/L` },
          { label: 'HDL', value: `${fmt(hdl)} mmol/L` },
          { label: 'Non-HDL', value: `${fmt(tc - hdl)} mmol/L` },
        ],
        notes,
      },
      toPercent(calibrated),
    );
  },
};
