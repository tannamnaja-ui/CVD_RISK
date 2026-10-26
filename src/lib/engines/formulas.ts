/**
 * Human-readable documentation of every engine, generated from the same coefficient constants
 * the calculators use, so the displayed formula can never drift from the computed one.
 */
import { ASCVD_CATEGORIES, PCE_COEFFICIENTS } from './ascvd';
import { FRS_COEFFICIENTS, THREE_TIER_CATEGORIES } from './framingham';
import { QRISK3_CATEGORIES, QRISK3_FEMALE, QRISK3_MALE, QRISK_ETHNICITIES } from './qrisk3';
import { RECALIBRATION, SCORE2, SCORE2_OP, SCORE2_REGION_LABELS } from './score2';
import { THAI_CATEGORIES, THAI_COEFFICIENTS, THAI_FORMULAS } from './thai';
import type { EngineId, RiskCategory, Score2Region } from './types';

export interface FormulaTable {
  caption?: string;
  columns: string[];
  rows: string[][];
}

export interface FormulaSection {
  heading: string;
  text?: string[];
  equations?: string[];
  table?: FormulaTable;
  /** reference picture (file in /public), e.g. an official colour chart */
  image?: { src: string; alt: string; caption: string };
}

export interface FormulaSource {
  label: string;
  url: string;
}

export interface FormulaInfo {
  engine: EngineId;
  title: string;
  summary: string;
  sections: FormulaSection[];
  sources: FormulaSource[];
}

const n = (v: number) => (v === 0 ? '–' : String(v));
/** Long coefficients (QRISK3) are shown to 6 significant digits; calculations use full precision. */
const n6 = (v: number) => (v === 0 ? '–' : Number(v.toPrecision(6)).toString());

function categoryTable(categories: RiskCategory[]): FormulaTable {
  return {
    columns: ['ช่วงความเสี่ยง', 'ระดับ', 'สี'],
    rows: categories.map((c) => [
      Number.isFinite(c.max) ? `${c.min}% – < ${c.max}%` : `≥ ${c.min}%`,
      `${c.label} (${c.labelEn})`,
      { green: 'เขียว', yellow: 'เหลือง', orange: 'ส้ม', red: 'แดง', purple: 'ม่วง' }[c.tone],
    ]),
  };
}

const VARIABLES_BINARY = 'Gender: ชาย = 1, หญิง = 0 · DM: เป็นเบาหวาน = 1, ไม่เป็น = 0 · Smoke: สูบ = 1, ไม่สูบ = 0';

// ---------------------------------------------------------------- Thai CV
const tr = THAI_COEFFICIENTS.ratio;
const tl = THAI_COEFFICIENTS.lab;
const tn = THAI_COEFFICIENTS.nonlab;
/** "ที่มา / ยังไม่ได้ยืนยัน" lines for one Thai formula. */
const thaiSource = (mode: keyof typeof THAI_FORMULAS) => {
  const f = THAI_FORMULAS[mode];
  return [`${f.needs}`, `ที่มา: ${f.source}`, ...(f.caution ? [`${f.verified ? 'หมายเหตุ' : 'ยังไม่ได้ยืนยัน'}: ${f.caution}`] : [])];
};

const thai: FormulaInfo = {
  engine: 'thai',
  title: 'Thai CV Risk Score',
  summary:
    'ประเมินความเสี่ยงโรคหัวใจและหลอดเลือดระยะ 10 ปีสำหรับคนไทย อายุ 35–70 ปี มี 3 สูตรให้เลือกในหน้าคำนวณ (หรือเลือกอัตโนมัติ: มี TC และ HDL → TC/HDL Ratio, มีแค่ TC → Total Cholesterol, ไม่มีผลเลือด → Non-Lab) — สูตร Total Cholesterol และ Non-Lab เป็นสมการทางการ ส่วนสูตร TC/HDL ยังไม่ได้ยืนยัน',
  sections: [
    {
      heading: `สูตรที่ 1 — ${THAI_FORMULAS.ratio.name}`,
      equations: [
        'Ratio = Total Cholesterol (mg/dL) / HDL-Cholesterol (mg/dL)',
        `ΣβX = (${tr.coef.male} × Gender) + (${tr.coef.age} × Age) + (${tr.coef.sbp} × SBP) + (${tr.coef.dm} × DM) + (${tr.coef.smoke} × Smoke) + (${tr.coef.ratio} × Ratio)`,
        `Risk (%) = [1 − ${tr.baselineSurvival}^exp(ΣβX − ${tr.meanSum})] × 100`,
      ],
      text: thaiSource('ratio'),
    },
    {
      heading: `สูตรที่ 2 — ${THAI_FORMULAS.lab.name}`,
      equations: [
        `ΣβX = (${tl.coef.age} × Age) + (${tl.coef.male} × Gender) + (${tl.coef.dm} × DM) + (${tl.coef.smoke} × Smoke) + (${tl.coef.sbp} × SBP) + (${tl.coef.tc} × TC)`,
        `Risk (%) = [1 − ${tl.baselineSurvival}^exp(ΣβX − ${tl.meanSum})] × 100`,
      ],
      text: ['TC หน่วย mg/dL, SBP หน่วย mmHg', ...thaiSource('lab')],
    },
    {
      heading: 'ตารางสีอ้างอิง — ตารางสีที่ 2 กรณีทราบผลโคเลสเตอรอล (กรมควบคุมโรค)',
      text: [
        'ที่มา: Thai CV risk Score, โครงการศึกษาระยะยาวเพื่อหาอิทธิพลของปัจจัยเสี่ยงต่อการเกิดโรคหัวใจและหลอดเลือด 2528–2558 · สำนักโรคไม่ติดต่อ กรมควบคุมโรค กระทรวงสาธารณสุข',
        'ออกแบบโดย นางจารุมน ลัคนาวิวัฒน์ โรงพยาบาลห้วยยอด · จัดพิมพ์โดย ศูนย์หัวใจ โรงพยาบาลตรังร่วมกับงานโรคไม่ติดต่อ สำนักงานสาธารณสุขจังหวัดตรัง (ตามที่พิมพ์ในตาราง)',
        'ตารางนี้ใช้ Total Cholesterol อย่างเดียว (ไม่ใช้ HDL) และทำจากสูตรที่ 2 — แต่ละช่องคือช่วงของอายุ/ความดัน/โคเลสเตอรอล จึงให้สีเดียวทั้งช่วง ผลจากสูตรที่ใช้ค่าจริงอาจสูงหรือต่ำกว่าสีในตารางได้เมื่อค่าอยู่ปลายช่วง',
        'สีเหลือง 10–<20% (ปานกลาง) กับสีเหลืองเข้ม 20–<30% (สูง) ในตารางคล้ายกันมาก ควรดูตัวเลข % ประกอบ',
      ],
      image: {
        src: 'thai-cv-color-chart-tc.jpg',
        alt: 'ตารางสี Thai CV Risk กรณีทราบผลโคเลสเตอรอล แยกตามเบาหวาน เพศ การสูบบุหรี่ อายุ ความดันโลหิตตัวบน และระดับโคเลสเตอรอล',
        caption: 'ตารางสีที่ 2 กรณีทราบผลโคเลสเตอรอลในเลือด — กดที่ภาพเพื่อเปิดขนาดเต็ม',
      },
    },
    {
      heading: `สูตรที่ 3 — ${THAI_FORMULAS.nonlab.name}`,
      equations: [
        'WHtR = Waist (cm) / Height (cm)',
        `ΣβX = (${tn.coef.age} × Age) + (${tn.coef.male} × Gender) + (${tn.coef.dm} × DM) + (${tn.coef.smoke} × Smoke) + (${tn.coef.sbp} × SBP) + (${tn.coef.whtr} × WHtR)`,
        `Risk (%) = [1 − ${tn.baselineSurvival}^exp(ΣβX − ${tn.meanSum})] × 100`,
      ],
      text: thaiSource('nonlab'),
    },
    { heading: 'การกำหนดค่าตัวแปร', text: [VARIABLES_BINARY, 'จำกัดผลลัพธ์ให้อยู่ในช่วง 0–100%'] },
    { heading: 'เกณฑ์การแปลผล', table: categoryTable(THAI_CATEGORIES) },
  ],
  sources: [
    { label: 'สมการ Thai CV Risk Score (ไม่ใช้ผลเลือด) — คู่มือคะแนน เขตสุขภาพที่ 10 กระทรวงสาธารณสุข', url: 'https://terreport.healthregion10.moph.go.th/scoreguide.php' },
    { label: 'ตัวอย่างงานวิจัยที่ใช้ Thai CV Risk Score', url: 'https://he01.tci-thaijo.org/index.php/BMJ/article/view/266373' },
    { label: 'Rama-EGAT Score — Mahidol University (ที่มาของ cohort คนไทย)', url: 'https://murex.mahidol.ac.th/en/publications/risk-of-cardiovascular-events-predicted-by-the-rama-egat-score-am/' },
  ],
};

// ---------------------------------------------------------------- Framingham
const fm = FRS_COEFFICIENTS.male;
const ff = FRS_COEFFICIENTS.female;

const frs: FormulaInfo = {
  engine: 'frs',
  title: 'Framingham Risk Score — General CVD (2008)',
  summary: 'ทำนายความเสี่ยงโรคหัวใจและหลอดเลือดโดยรวม (CHD, stroke, PAD, heart failure) ใน 10 ปี อายุ 30–74 ปี ใช้ Cox model บนค่า ln ของตัวแปรต่อเนื่อง',
  sections: [
    {
      heading: 'สมการ',
      equations: [
        'Σβ ln(X) = β₁ ln(Age) + β₂ ln(TC) + β₃ ln(HDL) + β₄ ln(SBP) + β₅ Smoke + β₆ DM',
        'Risk (%) = [1 − S₀^exp(Σβ ln(X) − M̄)] × 100',
      ],
      text: ['β₄ ใช้ค่า "treated" เมื่อรับประทานยาลดความดัน และ "untreated" เมื่อไม่ได้รับยา', 'TC, HDL หน่วย mg/dL'],
    },
    {
      heading: 'สัมประสิทธิ์',
      table: {
        columns: ['ตัวแปร', 'ชาย', 'หญิง'],
        rows: [
          ['ln(Age)', n(fm.lnAge), n(ff.lnAge)],
          ['ln(TC)', n(fm.lnTc), n(ff.lnTc)],
          ['ln(HDL)', n(fm.lnHdl), n(ff.lnHdl)],
          ['ln(SBP) — treated', n(fm.lnSbpTreated), n(ff.lnSbpTreated)],
          ['ln(SBP) — untreated', n(fm.lnSbpUntreated), n(ff.lnSbpUntreated)],
          ['Smoke', n(fm.smoke), n(ff.smoke)],
          ['DM', n(fm.dm), n(ff.dm)],
          ['S₀ (baseline survival)', n(fm.s0), n(ff.s0)],
          ['M̄ (mean Σβ ln X)', n(fm.mean), n(ff.mean)],
        ],
      },
    },
    { heading: 'เกณฑ์การแปลผล', table: categoryTable(THREE_TIER_CATEGORIES) },
  ],
  sources: [
    { label: "D'Agostino RB Sr, et al. General Cardiovascular Risk Profile for Use in Primary Care. Circulation 2008;117:743–753", url: 'https://doi.org/10.1161/CIRCULATIONAHA.107.699579' },
    { label: 'Framingham Heart Study — Cardiovascular Disease (10-year risk)', url: 'https://www.framinghamheartstudy.org/fhs-risk-functions/cardiovascular-disease-10-year-risk/' },
  ],
};

// ---------------------------------------------------------------- ASCVD PCE
const pw = PCE_COEFFICIENTS.female.white;
const pa = PCE_COEFFICIENTS.female.africanAmerican;
const mw = PCE_COEFFICIENTS.male.white;
const ma = PCE_COEFFICIENTS.male.africanAmerican;
const pceRow = (label: string, key: keyof typeof pw) => [label, n(pw[key]), n(pa[key]), n(mw[key]), n(ma[key])];

const ascvd: FormulaInfo = {
  engine: 'ascvd',
  title: 'ASCVD Risk Estimator — Pooled Cohort Equations (ACC/AHA 2013)',
  summary: 'ทำนายความเสี่ยง Hard ASCVD (MI, CHD death, stroke) ใน 10 ปี อายุ 40–79 ปี แยกสมการตามเพศและเชื้อชาติ (White/Other และ African American)',
  sections: [
    {
      heading: 'สมการ',
      equations: [
        'Indv = Σ (สัมประสิทธิ์ × ค่า)  — ค่าเป็น ln(Age), ln(TC), ln(HDL), ln(SBP) และ interaction terms',
        'Risk (%) = [1 − S₀^exp(Indv − Mean)] × 100',
      ],
      text: [
        'ใช้แถว ln(SBP) treated หรือ untreated อย่างใดอย่างหนึ่งตามการใช้ยาลดความดัน',
        'ACC/AHA แนะนำให้ใช้สมการ White สำหรับเชื้อชาติอื่น (รวมชาวเอเชีย)',
        'หมายเหตุ: สูตรหญิงในข้อกำหนดเดิมใช้สัมประสิทธิ์ของ African American คู่กับ S₀/Mean ของ White ซึ่งไม่ถูกต้อง — โปรแกรมนี้ใช้ค่าตามตารางต้นฉบับด้านล่าง',
      ],
    },
    {
      heading: 'สัมประสิทธิ์ (Goff et al. 2013, Table A)',
      table: {
        columns: ['ตัวแปร', 'หญิง White', 'หญิง AA', 'ชาย White', 'ชาย AA'],
        rows: [
          pceRow('ln(Age)', 'lnAge'),
          pceRow('ln(Age)²', 'lnAgeSq'),
          pceRow('ln(TC)', 'lnTc'),
          pceRow('ln(Age) × ln(TC)', 'lnAgeLnTc'),
          pceRow('ln(HDL)', 'lnHdl'),
          pceRow('ln(Age) × ln(HDL)', 'lnAgeLnHdl'),
          pceRow('ln(SBP) treated', 'lnSbpTreated'),
          pceRow('ln(Age) × ln(SBP) treated', 'lnAgeLnSbpTreated'),
          pceRow('ln(SBP) untreated', 'lnSbpUntreated'),
          pceRow('ln(Age) × ln(SBP) untreated', 'lnAgeLnSbpUntreated'),
          pceRow('Smoker', 'smoke'),
          pceRow('ln(Age) × Smoker', 'lnAgeSmoke'),
          pceRow('Diabetes', 'dm'),
          pceRow('S₀ (baseline survival)', 's0'),
          pceRow('Mean (Indv)', 'mean'),
        ],
      },
    },
    { heading: 'เกณฑ์การแปลผล (ACC/AHA 2018/2019)', table: categoryTable(ASCVD_CATEGORIES) },
  ],
  sources: [
    { label: 'Goff DC Jr, et al. 2013 ACC/AHA Guideline on the Assessment of Cardiovascular Risk. Circulation 2014;129:S49–S73', url: 'https://doi.org/10.1161/01.cir.0000437741.48606.98' },
    { label: 'ACC ASCVD Risk Estimator Plus', url: 'https://tools.acc.org/ascvd-risk-estimator-plus/' },
    { label: 'PooledCohort R package — reference coefficients', url: 'https://github.com/cran/PooledCohort' },
  ],
};

// ---------------------------------------------------------------- SCORE2
const sm = SCORE2.male;
const sf = SCORE2.female;
const om = SCORE2_OP.male;
const of = SCORE2_OP.female;
const regions = Object.keys(SCORE2_REGION_LABELS) as Score2Region[];

const score2: FormulaInfo = {
  engine: 'score2',
  title: 'SCORE2 & SCORE2-OP (ESC 2021)',
  summary: 'ทำนายความเสี่ยง fatal และ non-fatal CVD ใน 10 ปี — SCORE2 สำหรับอายุ 40–69 ปี, SCORE2-OP สำหรับอายุ 70–89 ปี และปรับเทียบ (recalibrate) ตามภูมิภาคความเสี่ยงของ ESC',
  sections: [
    {
      heading: 'SCORE2 (40–69 ปี)',
      equations: [
        'cage = (Age − 60) / 5 · csbp = (SBP − 120) / 20 · ctc = TC − 6 · chdl = (HDL − 1.3) / 0.5',
        'LP = β·cage + β·Smoke + β·csbp + β·DM + β·ctc + β·chdl + β·cage×Smoke + β·cage×csbp + β·cage×ctc + β·cage×chdl + β·cage×DM',
        'Risk₀ = 1 − S₀^exp(LP)',
      ],
      text: ['TC และ HDL แปลงจาก mg/dL เป็น mmol/L โดยหารด้วย 38.67'],
    },
    {
      heading: 'SCORE2-OP (70–89 ปี)',
      equations: [
        'cage = Age − 73 · csbp = SBP − 150 · ctc = TC − 6 · chdl = HDL − 1.4',
        'LP = β·cage + β·DM + β·Smoke + β·csbp + β·ctc + β·chdl + interactions (cage × แต่ละตัวแปร)',
        'Risk₀ = 1 − S₀^exp(LP − mean LP)',
      ],
    },
    {
      heading: 'การปรับเทียบตามภูมิภาค (Recalibration)',
      equations: ['Risk (%) = [1 − exp(−exp(scale₁ + scale₂ × ln(−ln(1 − Risk₀))))] × 100'],
      table: {
        columns: ['ภูมิภาค', 'SCORE2 ชาย', 'SCORE2 หญิง', 'OP ชาย', 'OP หญิง'],
        rows: regions.map((r) => [
          SCORE2_REGION_LABELS[r],
          RECALIBRATION.score2[r].male.join(', '),
          RECALIBRATION.score2[r].female.join(', '),
          RECALIBRATION.op[r].male.join(', '),
          RECALIBRATION.op[r].female.join(', '),
        ]),
      },
    },
    {
      heading: 'สัมประสิทธิ์',
      table: {
        columns: ['ตัวแปร', 'SCORE2 ชาย', 'SCORE2 หญิง', 'OP ชาย', 'OP หญิง'],
        rows: [
          ['Age', n(sm.age), n(sf.age), n(om.age), n(of.age)],
          ['Smoking', n(sm.smoke), n(sf.smoke), n(om.smoke), n(of.smoke)],
          ['SBP', n(sm.sbp), n(sf.sbp), n(om.sbp), n(of.sbp)],
          ['Diabetes', n(sm.dm), n(sf.dm), n(om.dm), n(of.dm)],
          ['Total cholesterol', n(sm.tc), n(sf.tc), n(om.tc), n(of.tc)],
          ['HDL cholesterol', n(sm.hdl), n(sf.hdl), n(om.hdl), n(of.hdl)],
          ['Age × Smoking', n(sm.ageSmoke), n(sf.ageSmoke), n(om.ageSmoke), n(of.ageSmoke)],
          ['Age × SBP', n(sm.ageSbp), n(sf.ageSbp), n(om.ageSbp), n(of.ageSbp)],
          ['Age × TC', n(sm.ageTc), n(sf.ageTc), n(om.ageTc), n(of.ageTc)],
          ['Age × HDL', n(sm.ageHdl), n(sf.ageHdl), n(om.ageHdl), n(of.ageHdl)],
          ['Age × Diabetes', n(sm.ageDm), n(sf.ageDm), n(om.ageDm), n(of.ageDm)],
          ['S₀ (baseline survival)', n(sm.s0), n(sf.s0), n(om.s0), n(of.s0)],
          ['Mean LP', '–', '–', n(om.mean), n(of.mean)],
        ],
      },
    },
    {
      heading: 'เกณฑ์การแปลผล (ขึ้นกับอายุ)',
      table: {
        columns: ['กลุ่มอายุ', 'Low-to-moderate (เขียว)', 'High (ส้ม)', 'Very high (แดง)'],
        rows: [
          ['< 50 ปี', '< 2.5%', '2.5% – < 7.5%', '≥ 7.5%'],
          ['50–69 ปี', '< 5%', '5% – < 10%', '≥ 10%'],
          ['≥ 70 ปี (SCORE2-OP)', '< 7.5%', '7.5% – < 15%', '≥ 15%'],
        ],
      },
    },
  ],
  sources: [
    { label: 'SCORE2 working group and ESC Cardiovascular risk collaboration. SCORE2 risk prediction algorithms. Eur Heart J 2021;42:2439–2454', url: 'https://doi.org/10.1093/eurheartj/ehab309' },
    { label: 'SCORE2-OP working group. SCORE2-OP risk prediction algorithms. Eur Heart J 2021;42:2455–2467', url: 'https://doi.org/10.1093/eurheartj/ehab312' },
    { label: 'Visseren FLJ, et al. 2021 ESC Guidelines on cardiovascular disease prevention in clinical practice. Eur Heart J 2021;42:3227–3337', url: 'https://doi.org/10.1093/eurheartj/ehab484' },
    { label: 'RiskScorescvd R package — SCORE2 reference implementation', url: 'https://github.com/cran/RiskScorescvd' },
  ],
};

// ---------------------------------------------------------------- WHO/ISH
const who: FormulaInfo = {
  engine: 'who',
  title: 'WHO/ISH Risk Prediction Charts (SEAR B / SEAR D)',
  summary: 'ตารางทำนายความเสี่ยง fatal/non-fatal myocardial infarction หรือ stroke ใน 10 ปี สำหรับระบบสาธารณสุขปฐมภูมิ ไม่ใช่สมการ แต่เป็นการเปิดตาราง (lookup) ตามกลุ่มของตัวแปร',
  sections: [
    {
      heading: 'วิธีการ (Lookup Matrix)',
      text: [
        'เลือกตารางตาม ภูมิภาค WHO → เบาหวาน (มี/ไม่มี) → เพศ → สูบบุหรี่ (ใช่/ไม่ใช่)',
        'อ่านช่องจาก กลุ่มอายุ × กลุ่ม SBP × กลุ่ม Total Cholesterol ได้ระดับความเสี่ยงเป็นช่วง',
        'หากไม่ทราบค่า Cholesterol ใช้ตารางชุด "ไม่ใช้ Cholesterol" (low-information chart)',
        'ประเทศไทยอยู่ในภูมิภาค SEAR B (ร่วมกับอินโดนีเซียและศรีลังกา)',
      ],
    },
    {
      heading: 'การจัดกลุ่มตัวแปร',
      table: {
        columns: ['ตัวแปร', 'กลุ่ม'],
        rows: [
          ['อายุ', '40–49, 50–59, 60–69, ≥ 70 ปี'],
          ['SBP', '< 140, 140–159, 160–179, ≥ 180 mmHg'],
          ['Total Cholesterol', '< 4.5 (4), 4.5–5.4 (5), 5.5–6.4 (6), 6.5–7.4 (7), ≥ 7.5 (8) mmol/L'],
          ['เพศ / DM / Smoke', 'ใช่ = 1, ไม่ใช่ = 0'],
        ],
      },
    },
    {
      heading: 'ผลลัพธ์จากตาราง',
      table: {
        columns: ['ช่องสีในตาราง WHO', 'ระดับในโปรแกรมนี้'],
        rows: [
          ['< 10%', 'Low Risk (เขียว)'],
          ['10% – < 20%', 'Moderate / Intermediate (เหลือง)'],
          ['20% – < 30%', 'High Risk (แดง)'],
          ['30% – < 40%', 'High Risk (แดง)'],
          ['≥ 40%', 'High Risk (แดง)'],
        ],
      },
    },
    { heading: 'เกณฑ์การแปลผล', table: categoryTable(THREE_TIER_CATEGORIES) },
  ],
  sources: [
    { label: 'WHO. Prevention of cardiovascular disease: guidelines for assessment and management of total cardiovascular risk (2007)', url: 'https://www.who.int/publications/i/item/9789241547178' },
    { label: 'WHO/ISH Pocket guidelines (PDF, รวม risk charts)', url: 'https://www.afro.who.int/sites/default/files/2017-06/Pocket%20CVD%20manual%20English.pdf' },
    { label: 'Collins D, et al. whoishRisk – an R package to calculate WHO/ISH cardiovascular risk scores. F1000Research 2016;5:2522', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC5345772/' },
    { label: 'whoishRisk — ข้อมูลตาราง (WHO_ISH_Scores.csv) ที่ใช้ในโปรแกรมนี้', url: 'https://github.com/DylanRJCollins/whoishRisk' },
  ],
};

// ---------------------------------------------------------------- QRISK3
const qf = QRISK3_FEMALE;
const qm = QRISK3_MALE;
const BOOL_LABELS: [keyof typeof qf.bool, string][] = [
  ['af', 'Atrial fibrillation'],
  ['antipsy', 'Atypical antipsychotic'],
  ['steroids', 'Corticosteroids'],
  ['impotence', 'Erectile dysfunction'],
  ['migraine', 'Migraine'],
  ['ra', 'Rheumatoid arthritis'],
  ['renal', 'CKD stage 3–5'],
  ['semi', 'Severe mental illness'],
  ['sle', 'SLE'],
  ['treatedhyp', 'Treated hypertension'],
  ['type1', 'Type 1 diabetes'],
  ['type2', 'Type 2 diabetes'],
  ['fh', 'Family history CHD < 60'],
];
const CONT_LABELS: [keyof typeof qf.cont, string][] = [
  ['age1', 'age₁'],
  ['age2', 'age₂'],
  ['bmi1', 'bmi₁'],
  ['bmi2', 'bmi₂'],
  ['rati', 'TC/HDL ratio'],
  ['sbp', 'SBP'],
  ['sbps5', 'SD of SBP'],
  ['town', 'Townsend'],
];
const SMOKE_LABELS = ['Non-smoker', 'Ex-smoker', 'Light (< 10/day)', 'Moderate (10–19/day)', 'Heavy (≥ 20/day)'];
const INTERACTION_LABELS: [keyof typeof qf.age1x, string][] = [
  ['af', 'AF'],
  ['steroids', 'Corticosteroids'],
  ['impotence', 'Erectile dysfunction'],
  ['migraine', 'Migraine'],
  ['renal', 'CKD'],
  ['sle', 'SLE'],
  ['treatedhyp', 'Treated hypertension'],
  ['type1', 'Type 1 diabetes'],
  ['type2', 'Type 2 diabetes'],
  ['bmi1', 'bmi₁'],
  ['bmi2', 'bmi₂'],
  ['fh', 'Family history'],
  ['sbp', 'SBP'],
  ['town', 'Townsend'],
];
const scalar = (v: number | readonly number[]) => (typeof v === 'number' ? v : 0);

const qrisk3: FormulaInfo = {
  engine: 'qrisk3',
  title: 'QRISK3-2017 (UK NHS)',
  summary: 'ทำนายความเสี่ยง CVD (CHD, ischaemic stroke, TIA) ใน 10 ปี อายุ 25–84 ปี ใช้ fractional polynomials ของอายุและ BMI ร่วมกับปัจจัยทางคลินิกและ interaction กับอายุ',
  sections: [
    {
      heading: 'การแปลงตัวแปร (Fractional polynomials)',
      equations: [
        'หญิง: age₁ = (Age/10)^−2 · age₂ = Age/10',
        'ชาย: age₁ = (Age/10)^−1 · age₂ = (Age/10)^3',
        'bmi₁ = (BMI/10)^−2 · bmi₂ = (BMI/10)^−2 × ln(BMI/10)',
        'ตัวแปรต่อเนื่องทุกตัวถูกลบด้วยค่ากลาง (centring) ก่อนคูณสัมประสิทธิ์',
      ],
    },
    {
      heading: 'สมการ',
      equations: [
        'a = β_ethnicity + β_smoking + Σ β·(ตัวแปรต่อเนื่อง) + Σ β·(ตัวแปร 0/1) + Σ β·age₁×(…) + Σ β·age₂×(…)',
        `Risk (%) = 100 × [1 − S₀^exp(a)]   (S₀ หญิง = ${qf.survivor10}, ชาย = ${qm.survivor10})`,
      ],
      text: [
        'ช่วงค่าที่โมเดลรับ: BMI 20–40, TC/HDL 1–12, SBP 70–210, SD ของ SBP 0–40, Townsend −7 ถึง 11 (ค่านอกช่วงถูกปรับเข้าขอบ)',
        'ตารางแสดงค่า 6 หลักนัยสำคัญ — การคำนวณใช้ค่าเต็มตาม source ต้นฉบับ',
      ],
    },
    {
      heading: 'ค่ากลางและสัมประสิทธิ์ตัวแปรต่อเนื่อง',
      table: {
        columns: ['ตัวแปร', 'หญิง: ค่ากลาง', 'หญิง: β', 'ชาย: ค่ากลาง', 'ชาย: β'],
        rows: CONT_LABELS.map(([k, label]) => [label, n6(qf.centre[k]), n6(qf.cont[k]), n6(qm.centre[k]), n6(qm.cont[k])]),
      },
    },
    {
      heading: 'สัมประสิทธิ์ตัวแปร 0/1',
      table: {
        columns: ['ปัจจัย', 'หญิง', 'ชาย'],
        rows: BOOL_LABELS.map(([k, label]) => [label, n6(qf.bool[k]), n6(qm.bool[k])]),
      },
    },
    {
      heading: 'กลุ่มชาติพันธุ์และการสูบบุหรี่',
      table: {
        columns: ['ตัวแปร', 'หญิง', 'ชาย'],
        rows: [
          ...QRISK_ETHNICITIES.map((label, i) => [`Ethnicity: ${label}`, n6(qf.ethnicity[i]), n6(qm.ethnicity[i])]),
          ...SMOKE_LABELS.map((label, i) => [`Smoking: ${label}`, n6(qf.smoke[i]), n6(qm.smoke[i])]),
        ],
      },
    },
    {
      heading: 'Interaction terms กับอายุ',
      table: {
        columns: ['ตัวแปร', 'หญิง × age₁', 'หญิง × age₂', 'ชาย × age₁', 'ชาย × age₂'],
        rows: [
          ...SMOKE_LABELS.slice(1).map((label, i) => [
            `Smoking: ${label}`,
            n6(qf.age1x.smoke[i + 1]),
            n6(qf.age2x.smoke[i + 1]),
            n6(qm.age1x.smoke[i + 1]),
            n6(qm.age2x.smoke[i + 1]),
          ]),
          ...INTERACTION_LABELS.map(([k, label]) => [
            label,
            n6(scalar(qf.age1x[k])),
            n6(scalar(qf.age2x[k])),
            n6(scalar(qm.age1x[k])),
            n6(scalar(qm.age2x[k])),
          ]),
        ],
      },
    },
    { heading: 'เกณฑ์การแปลผล (NICE)', table: categoryTable(QRISK3_CATEGORIES) },
  ],
  sources: [
    { label: 'Hippisley-Cox J, Coupland C, Brindle P. Development and validation of QRISK3 risk prediction algorithms. BMJ 2017;357:j2099', url: 'https://doi.org/10.1136/bmj.j2099' },
    { label: 'QRISK3 — ClinRisk Ltd. (เว็บไซต์ทางการ)', url: 'https://qrisk.org/' },
    { label: 'NICE NG238: Cardiovascular disease — risk assessment and reduction, including lipid modification', url: 'https://www.nice.org.uk/guidance/ng238' },
    { label: 'QRISK3 R package — port ของ source ต้นฉบับ ใช้ตรวจสอบความถูกต้อง', url: 'https://github.com/cran/QRISK3' },
  ],
};

export const FORMULAS: Record<EngineId, FormulaInfo> = { thai, 'thai-ratio': thai, 'thai-tc': thai, 'thai-nonlab': thai, frs, ascvd, score2, who, qrisk3 };
