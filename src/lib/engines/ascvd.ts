import { fmt, pointResult, toPercent, type CheckedPatient, type ModelDef, type RiskCategory } from './types';

interface PceCoefficients {
  lnAge: number;
  lnAgeSq: number;
  lnTc: number;
  lnAgeLnTc: number;
  lnHdl: number;
  lnAgeLnHdl: number;
  lnSbpTreated: number;
  lnAgeLnSbpTreated: number;
  lnSbpUntreated: number;
  lnAgeLnSbpUntreated: number;
  smoke: number;
  lnAgeSmoke: number;
  dm: number;
  s0: number;
  mean: number;
}

/**
 * Goff DC Jr et al. 2013 ACC/AHA Guideline on the Assessment of Cardiovascular Risk, Table A.
 * "white" is also used for other/unspecified race per guideline recommendation.
 */
export const PCE_COEFFICIENTS: Record<'female' | 'male', Record<'white' | 'africanAmerican', PceCoefficients>> = {
  female: {
    white: { lnAge: -29.799, lnAgeSq: 4.884, lnTc: 13.54, lnAgeLnTc: -3.114, lnHdl: -13.578, lnAgeLnHdl: 3.149, lnSbpTreated: 2.019, lnAgeLnSbpTreated: 0, lnSbpUntreated: 1.957, lnAgeLnSbpUntreated: 0, smoke: 7.574, lnAgeSmoke: -1.665, dm: 0.661, s0: 0.96652, mean: -29.1817 },
    africanAmerican: { lnAge: 17.114, lnAgeSq: 0, lnTc: 0.94, lnAgeLnTc: 0, lnHdl: -18.92, lnAgeLnHdl: 4.475, lnSbpTreated: 29.291, lnAgeLnSbpTreated: -6.432, lnSbpUntreated: 27.82, lnAgeLnSbpUntreated: -6.087, smoke: 0.691, lnAgeSmoke: 0, dm: 0.874, s0: 0.95334, mean: 86.6081 },
  },
  male: {
    white: { lnAge: 12.344, lnAgeSq: 0, lnTc: 11.853, lnAgeLnTc: -2.664, lnHdl: -7.99, lnAgeLnHdl: 1.769, lnSbpTreated: 1.797, lnAgeLnSbpTreated: 0, lnSbpUntreated: 1.764, lnAgeLnSbpUntreated: 0, smoke: 7.837, lnAgeSmoke: -1.795, dm: 0.658, s0: 0.91436, mean: 61.1816 },
    africanAmerican: { lnAge: 2.469, lnAgeSq: 0, lnTc: 0.302, lnAgeLnTc: 0, lnHdl: -0.307, lnAgeLnHdl: 0, lnSbpTreated: 1.916, lnAgeLnSbpTreated: 0, lnSbpUntreated: 1.809, lnAgeLnSbpUntreated: 0, smoke: 0.549, lnAgeSmoke: 0, dm: 0.645, s0: 0.89536, mean: 19.5425 },
  },
};

export const ASCVD_CATEGORIES: RiskCategory[] = [
  {
    id: 'low',
    min: 0,
    max: 5,
    label: 'ความเสี่ยงต่ำ',
    labelEn: 'Low Risk',
    tone: 'green',
    interpretation: 'Low risk (< 5%) — เน้นปรับวิถีชีวิตเพื่อลดปัจจัยเสี่ยง (ACC/AHA 2018/2019)',
    recommendations: [
      'เน้นวิถีชีวิตเพื่อสุขภาพหัวใจ (Heart-healthy lifestyle)',
      'ออกกำลังกาย ≥ 150 นาที/สัปดาห์ และควบคุมน้ำหนัก',
      'งดสูบบุหรี่',
      'ประเมินความเสี่ยงซ้ำทุก 4–6 ปี',
    ],
  },
  {
    id: 'borderline',
    min: 5,
    max: 7.5,
    label: 'ความเสี่ยงก้ำกึ่ง',
    labelEn: 'Borderline Risk',
    tone: 'yellow',
    interpretation: 'Borderline risk (5–<7.5%) — หากมี risk-enhancing factors ให้หารือกับแพทย์เรื่องการเริ่ม Statin ขนาดปานกลาง',
    recommendations: [
      'ปรับวิถีชีวิตอย่างจริงจัง',
      'ประเมิน risk-enhancing factors (เช่น ประวัติครอบครัว, LDL ≥ 160, CKD, Metabolic syndrome)',
      'หารือกับแพทย์เรื่อง Statin ขนาดปานกลางเมื่อมี risk enhancers',
    ],
  },
  {
    id: 'intermediate',
    min: 7.5,
    max: 20,
    label: 'ความเสี่ยงปานกลาง',
    labelEn: 'Intermediate Risk',
    tone: 'orange',
    interpretation: 'Intermediate risk (7.5–<20%) — แนะนำ Statin ขนาดปานกลาง (ลด LDL-C 30–49%) หลังหารือกับแพทย์ อาจตรวจ CAC score ช่วยตัดสินใจ',
    recommendations: [
      'พบแพทย์เพื่อพิจารณาเริ่ม Statin ขนาดปานกลาง',
      'อาจพิจารณาตรวจ Coronary Artery Calcium (CAC) หากยังไม่แน่ใจ',
      'ควบคุมความดันโลหิต < 130/80 mmHg',
      'ปรับวิถีชีวิตร่วมด้วยเสมอ',
    ],
  },
  {
    id: 'high',
    min: 20,
    max: Infinity,
    label: 'ความเสี่ยงสูง',
    labelEn: 'High Risk',
    tone: 'red',
    interpretation: 'High risk (≥ 20%) — แนะนำ Statin ขนาดสูง (ลด LDL-C ≥ 50%) ร่วมกับการควบคุมปัจจัยเสี่ยงอย่างเข้มงวด',
    recommendations: [
      'ส่งพบแพทย์เพื่อเริ่ม Statin ขนาดสูง',
      'ควบคุมความดัน น้ำตาล และไขมันอย่างเข้มงวด',
      'เลิกบุหรี่ทันที',
      'ติดตามผลการรักษาและ LDL-C เป็นระยะ',
    ],
  },
];

export const ascvd: ModelDef = {
  id: 'ascvd',
  engine: 'ascvd',
  name: 'ASCVD Risk Estimator',
  shortName: 'ASCVD (PCE)',
  outcome: 'Hard ASCVD ใน 10 ปี',
  ageRange: [40, 79],
  legend: () => ASCVD_CATEGORIES,
  required: () => ['age', 'sbp', 'tc', 'hdl'],
  options: ['bpMeds', 'ascvdRace'],
  calculate(p: CheckedPatient) {
    const c = PCE_COEFFICIENTS[p.gender][p.ascvdRace];
    const lnAge = Math.log(p.age);
    const lnTc = Math.log(p.tc!);
    const lnHdl = Math.log(p.hdl!);
    const lnSbp = Math.log(p.sbp);
    const smoke = p.smoke ? 1 : 0;

    const sbpTerm = p.bpMeds
      ? c.lnSbpTreated * lnSbp + c.lnAgeLnSbpTreated * lnAge * lnSbp
      : c.lnSbpUntreated * lnSbp + c.lnAgeLnSbpUntreated * lnAge * lnSbp;

    const indv =
      c.lnAge * lnAge +
      c.lnAgeSq * lnAge * lnAge +
      c.lnTc * lnTc +
      c.lnAgeLnTc * lnAge * lnTc +
      c.lnHdl * lnHdl +
      c.lnAgeLnHdl * lnAge * lnHdl +
      sbpTerm +
      c.smoke * smoke +
      c.lnAgeSmoke * lnAge * smoke +
      c.dm * (p.dm ? 1 : 0);

    const notes: string[] = [];
    if (p.tc! < 130 || p.tc! > 320) notes.push('TC อยู่นอกช่วงที่ PCE ตรวจสอบไว้ (130–320 mg/dL) ผลอาจคลาดเคลื่อน');
    if (p.hdl! < 20 || p.hdl! > 100) notes.push('HDL อยู่นอกช่วงที่ PCE ตรวจสอบไว้ (20–100 mg/dL) ผลอาจคลาดเคลื่อน');
    if (p.sbp < 90 || p.sbp > 200) notes.push('SBP อยู่นอกช่วงที่ PCE ตรวจสอบไว้ (90–200 mmHg) ผลอาจคลาดเคลื่อน');
    if (p.ascvdRace === 'white') notes.push('ใช้สมการ White/Other ตามคำแนะนำ ACC/AHA สำหรับเชื้อชาติอื่นรวมถึงชาวเอเชีย');

    return pointResult(
      {
        modelId: 'ascvd',
        variant: `Pooled Cohort Equations 2013 · ${p.ascvdRace === 'white' ? 'White/Other' : 'African American'} ${p.gender === 'male' ? 'Men' : 'Women'}`,
        categories: ASCVD_CATEGORIES,
        details: [{ label: 'Individual sum', value: fmt(indv, 4) }],
        notes,
      },
      toPercent(1 - Math.pow(c.s0, Math.exp(indv - c.mean))),
    );
  },
};
