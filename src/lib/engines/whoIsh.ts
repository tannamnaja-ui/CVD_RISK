import { THREE_TIER_CATEGORIES } from './framingham';
import { MGDL_PER_MMOL, categorize, fmt, type CheckedPatient, type ModelDef, type WhoRegion } from './types';
import { WHO_ISH_CHARTS } from './whoIshData';

const BANDS = [
  { min: 0, max: 10, label: '< 10' },
  { min: 10, max: 20, label: '10–<20' },
  { min: 20, max: 30, label: '20–<30' },
  { min: 30, max: 40, label: '30–<40' },
  { min: 40, max: Infinity, label: '≥ 40' },
];

export const WHO_REGION_LABELS: Record<WhoRegion, string> = {
  SEAR_B: 'SEAR B (ไทย, อินโดนีเซีย, ศรีลังกา)',
  SEAR_D: 'SEAR D (อินเดีย, บังกลาเทศ, เนปาล ฯลฯ)',
};

const ageIndex = (age: number) => (age < 50 ? 0 : age < 60 ? 1 : age < 70 ? 2 : 3);
const sbpIndex = (sbp: number) => (sbp < 140 ? 0 : sbp < 160 ? 1 : sbp < 180 ? 2 : 3);
/** 0 = cholesterol unknown → chart without cholesterol */
const cholIndex = (mmol: number | undefined) =>
  mmol === undefined ? 0 : mmol < 4.5 ? 1 : mmol < 5.5 ? 2 : mmol < 6.5 ? 3 : mmol < 7.5 ? 4 : 5;

export function lookupWhoIsh(p: CheckedPatient): number {
  const tcMmol = p.tc === undefined ? undefined : p.tc / MGDL_PER_MMOL;
  const index =
    (((((p.dm ? 1 : 0) * 2 + (p.gender === 'male' ? 1 : 0)) * 2 + (p.smoke ? 1 : 0)) * 4 + ageIndex(p.age)) * 4 + sbpIndex(p.sbp)) * 6 +
    cholIndex(tcMmol);
  return Number(WHO_ISH_CHARTS[p.whoRegion][index]);
}

export const whoIsh: ModelDef = {
  id: 'who',
  engine: 'who',
  name: 'WHO/ISH Risk Prediction Charts',
  shortName: 'WHO/ISH',
  outcome: 'Fatal/non-fatal MI & stroke ใน 10 ปี',
  ageRange: [40, 100],
  legend: () => THREE_TIER_CATEGORIES,
  required: () => ['age', 'sbp'],
  optional: ['tc'],
  options: ['whoRegion'],
  calculate(p: CheckedPatient) {
    const band = BANDS[lookupWhoIsh(p)];
    const hasChol = p.tc !== undefined;
    const notes = ['WHO/ISH เป็นแบบตาราง (chart) ให้ผลเป็นช่วงความเสี่ยง ไม่ใช่ค่าร้อยละที่แน่นอน'];
    if (p.age >= 80) notes.push('ตารางมีถึงกลุ่มอายุ 70 ปีขึ้นไป ผู้ที่อายุ ≥ 80 ปีใช้ตารางกลุ่ม 70+');

    return {
      modelId: 'who',
      risk: null,
      range: { min: band.min, max: band.max },
      display: band.label,
      variant: `${p.whoRegion.replace('_', ' ')} · ${hasChol ? 'ตารางที่ใช้ Total Cholesterol' : 'ตารางไม่ใช้ Cholesterol'}`,
      category: categorize(band.min, THREE_TIER_CATEGORIES),
      categories: THREE_TIER_CATEGORIES,
      details: [
        { label: 'กลุ่มอายุ', value: ['40–49', '50–59', '60–69', '70+'][ageIndex(p.age)] },
        { label: 'กลุ่ม SBP', value: ['< 140', '140–159', '160–179', '≥ 180'][sbpIndex(p.sbp)] },
        ...(hasChol ? [{ label: 'TC', value: `${fmt(p.tc! / MGDL_PER_MMOL, 1)} mmol/L` }] : []),
      ],
      notes,
    };
  },
};
