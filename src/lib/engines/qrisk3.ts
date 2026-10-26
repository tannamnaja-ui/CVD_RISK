import { clamp, fmt, pointResult, toPercent, type CheckedPatient, type ModelDef, type RiskCategory } from './types';

/*
 * QRISK3-2017 — port of the open-source algorithm published by ClinRisk Ltd. (LGPL),
 * Hippisley-Cox J et al. BMJ 2017;357:j2099. Coefficients transcribed from the original source.
 * QRISK® is a registered trademark of ClinRisk Ltd; results are for screening support only.
 */

export const QRISK_ETHNICITIES = [
  'White or not stated',
  'Indian',
  'Pakistani',
  'Bangladeshi',
  'Other Asian',
  'Black Caribbean',
  'Black African',
  'Chinese',
  'Other ethnic group',
] as const;

/** index into QRISK smoking arrays: 0 non, 1 ex, 2 light (<10/day), 3 moderate (10–19), 4 heavy (≥20) */
const SMOKE_INDEX = { light: 2, moderate: 3, heavy: 4 } as const;

export const QRISK3_FEMALE = {
  survivor10: 0.988876402378082,
  ethnicity: [0, 0.28040314332995425, 0.56298994142075398, 0.29590000851116516, 0.072785379877982545, -0.17072135508857317, -0.39371043314874971, -0.32632495283530272, -0.17127056883241784],
  smoke: [0, 0.13386833786546262, 0.56200858012438537, 0.66749593377502547, 0.84948177644830847],
  centre: { age1: 0.053274843841791, age2: 4.332503318786621, bmi1: 0.154946178197861, bmi2: 0.144462317228317, rati: 3.47632646560669, sbp: 123.13001251220703, sbps5: 9.002537727355957, town: 0.392308831214905 },
  cont: { age1: -8.1388109247726188, age2: 0.79733376689699098, bmi1: 0.29236092275460052, bmi2: -4.1513300213837665, rati: 0.15338035820802554, sbp: 0.013131488407103424, sbps5: 0.0078894541014586095, town: 0.077223790588590108 },
  bool: { af: 1.5923354969269663, antipsy: 0.25237642070115557, steroids: 0.59520725304601851, impotence: 0, migraine: 0.301267260870345, ra: 0.21364803435181942, renal: 0.65194569493845833, semi: 0.12555308058820178, sle: 0.75880938654267693, treatedhyp: 0.50931593683423004, type1: 1.7267977510537347, type2: 1.0688773244615468, fh: 0.45445319020896213 },
  age1x: { smoke: [0, -4.7057161785851891, -2.7430383403573337, -0.86608088829392182, 0.90241562369710648], af: 19.938034889546561, steroids: -0.98408045235936281, impotence: 0, migraine: 1.7634979587872999, renal: -3.5874047731694114, sle: 19.690303738638292, treatedhyp: 11.872809733921812, type1: -1.2444332714320747, type2: 6.8652342000009599, bmi1: 23.802623412141742, bmi2: -71.184947692087007, fh: 0.99467807940435127, sbp: 0.034131842338615485, town: -1.0301180802035639 },
  age2x: { smoke: [0, -0.075589244643193026, -0.11951192874867074, -0.10366306397571923, -0.13991853591718389], af: -0.076182651011162505, steroids: -0.12005364946742472, impotence: 0, migraine: -0.065586917898699859, renal: -0.22688873086442507, sle: 0.077347949679016273, treatedhyp: 0.00096857823588174436, type1: -0.28724064624488949, type2: -0.097112252590695489, bmi1: 0.52369958933664429, bmi2: 0.045744190122323759, fh: -0.076885051698423038, sbp: -0.0015082501423272358, town: -0.031593414674962329 },
};

export const QRISK3_MALE = {
  survivor10: 0.977268040180206,
  ethnicity: [0, 0.27719248760308279, 0.47446360714931268, 0.52961729919689371, 0.035100159186299017, -0.35807899669327919, -0.4005648523216514, -0.41522792889830173, -0.26321348134749967],
  smoke: [0, 0.19128222863388983, 0.55241588192645552, 0.63835053027506072, 0.78983819881858019],
  centre: { age1: 0.234766781330109, age2: 77.284080505371094, bmi1: 0.149176135659218, bmi2: 0.141913309693336, rati: 4.300998687744141, sbp: 128.57157897949219, sbps5: 8.756621360778809, town: 0.52630490064621 },
  cont: { age1: -17.839781666005575, age2: 0.0022964880605765492, bmi1: 2.4562776660536358, bmi2: -8.3011122314711354, rati: 0.17340196856327111, sbp: 0.012910126542553305, sbps5: 0.010251914291290456, town: 0.033268201277287295 },
  bool: { af: 0.88209236928054657, antipsy: 0.13046879855173513, steroids: 0.45485399750445543, impotence: 0.22251859086705383, migraine: 0.25584178074159913, ra: 0.20970658013956567, renal: 0.71853261288274384, semi: 0.12133039882047164, sle: 0.4401572174457522, treatedhyp: 0.51659871082695474, type1: 1.2343425521675175, type2: 0.85942071430932221, fh: 0.54055469009390156 },
  age1x: { smoke: [0, -0.21011133933516346, 0.75268676447503191, 0.99315887556405791, 2.1331163414389076], af: 3.4896675530623207, steroids: 1.1708133653489108, impotence: -1.506400985745431, migraine: 2.3491159871402441, renal: -0.50656716327223694, sle: 0, treatedhyp: 6.5114581098532671, type1: 5.3379864878006531, type2: 3.6461817406221311, bmi1: 31.004952956033886, bmi2: -111.29157184391643, fh: 2.7808628508531887, sbp: 0.018858524469865853, town: -0.1007554870063731 },
  age2x: { smoke: [0, -0.00049854870275326121, -0.00079875633317385414, -0.00083706184266251296, -0.00078400319155637289], af: -0.00034995608340636049, steroids: -0.0002496045095297166, impotence: -0.0011058218441227373, migraine: 0.00019896446041478631, renal: -0.0018325930166498813, sle: 0, treatedhyp: 0.00063838053104165013, type1: 0.0006409780808752897, type2: -0.00024695695588868315, bmi1: 0.0050380102356322029, bmi2: -0.013074483002524319, fh: -0.00024791809907396037, sbp: -0.000012718741915884570, town: -0.000093299642323272888 },
};

/** Input ranges accepted by the original QRISK3 calculator. Values outside are clamped. */
const LIMITS = { bmi: [20, 40], rati: [1, 12], sbp: [70, 210], sbps5: [0, 40], town: [-7, 11] } as const;

export const QRISK3_CATEGORIES: RiskCategory[] = [
  {
    id: 'low',
    min: 0,
    max: 10,
    label: 'ความเสี่ยงต่ำ',
    labelEn: 'Low Risk',
    tone: 'green',
    interpretation: 'Low risk (< 10%) — ยังไม่เข้าเกณฑ์เริ่ม Statin ตาม NICE เน้นปรับวิถีชีวิต',
    recommendations: [
      'คงวิถีชีวิตเพื่อสุขภาพหัวใจ ออกกำลังกาย และควบคุมอาหาร',
      'งดสูบบุหรี่ และจำกัดแอลกอฮอล์',
      'ประเมิน QRISK ซ้ำอย่างน้อยทุก 5 ปี',
    ],
  },
  {
    id: 'high',
    min: 10,
    max: Infinity,
    label: 'ความเสี่ยงสูง',
    labelEn: 'High Risk',
    tone: 'red',
    interpretation: 'High risk (≥ 10%) — เข้าเกณฑ์พิจารณาเริ่ม Statin (เช่น Atorvastatin 20 mg) ตาม NICE NG238 หลังปรับวิถีชีวิตและหารือร่วมกัน',
    recommendations: [
      'พบแพทย์เพื่อหารือการเริ่ม Statin ป้องกันปฐมภูมิ (Atorvastatin 20 mg)',
      'ปรับวิถีชีวิตร่วมด้วยเสมอ: อาหาร ออกกำลังกาย ควบคุมน้ำหนัก',
      'ควบคุมความดันโลหิตและเลิกบุหรี่',
      'ตรวจไขมันซ้ำหลังเริ่มยา 2–3 เดือน',
    ],
  },
];

export const qrisk3: ModelDef = {
  id: 'qrisk3',
  engine: 'qrisk3',
  name: 'QRISK3',
  shortName: 'QRISK3',
  outcome: 'CVD (CHD, stroke, TIA) ใน 10 ปี',
  ageRange: [25, 84],
  legend: () => QRISK3_CATEGORIES,
  required: () => ['age', 'sbp', 'tc', 'hdl', 'height', 'weight'],
  optional: ['sbpSd', 'townsend'],
  options: ['bpMeds', 'qrisk'],
  calculate(p: CheckedPatient) {
    const female = p.gender === 'female';
    const c = female ? QRISK3_FEMALE : QRISK3_MALE;
    const notes: string[] = [];

    const clampNote = (name: string, value: number, [lo, hi]: readonly [number, number], unit = '') => {
      const v = clamp(value, lo, hi);
      if (v !== value) notes.push(`${name} ${fmt(value, 1)}${unit} อยู่นอกช่วงของ QRISK3 จึงใช้ค่า ${v}${unit} ในการคำนวณ`);
      return v;
    };

    const rawBmi = p.weight! / (p.height! / 100) ** 2;
    const bmi = clampNote('BMI', rawBmi, LIMITS.bmi);
    const rati = clampNote('TC/HDL ratio', p.tc! / p.hdl!, LIMITS.rati);
    const sbp = clampNote('SBP', p.sbp, LIMITS.sbp, ' mmHg');
    // Missing SBP variability → use the population mean so the term contributes nothing.
    const sbps5 = p.sbpSd === undefined ? c.centre.sbps5 : clampNote('SD ของ SBP', p.sbpSd, LIMITS.sbps5);
    const town = p.townsend === undefined ? 0 : clampNote('Townsend', p.townsend, LIMITS.town);

    const dage = p.age / 10;
    const dbmi = bmi / 10;
    const age1 = (female ? dage ** -2 : dage ** -1) - c.centre.age1;
    const age2 = (female ? dage : dage ** 3) - c.centre.age2;
    const bmi1 = dbmi ** -2 - c.centre.bmi1;
    const bmi2 = dbmi ** -2 * Math.log(dbmi) - c.centre.bmi2;
    const cRati = rati - c.centre.rati;
    const cSbp = sbp - c.centre.sbp;
    const cSbps5 = sbps5 - c.centre.sbps5;
    const cTown = town - c.centre.town;

    const smokeCat = p.smoke ? SMOKE_INDEX[p.smokeIntensity] : p.exSmoker ? 1 : 0;
    const k = p.conditions;
    const b = {
      af: +k.af,
      antipsy: +k.atypicalAntipsychotic,
      steroids: +k.steroids,
      impotence: female ? 0 : +k.erectileDysfunction,
      migraine: +k.migraine,
      ra: +k.ra,
      renal: +k.ckd,
      semi: +k.severeMentalIllness,
      sle: +k.sle,
      treatedhyp: +p.bpMeds,
      type1: +(p.dm && p.dmType === 'type1'),
      type2: +(p.dm && p.dmType === 'type2'),
      fh: +k.familyHistory,
    };

    let a = c.ethnicity[p.qriskEthnicity] + c.smoke[smokeCat];
    a += c.cont.age1 * age1 + c.cont.age2 * age2 + c.cont.bmi1 * bmi1 + c.cont.bmi2 * bmi2;
    a += c.cont.rati * cRati + c.cont.sbp * cSbp + c.cont.sbps5 * cSbps5 + c.cont.town * cTown;
    for (const key of Object.keys(c.bool) as (keyof typeof c.bool)[]) a += c.bool[key] * b[key];

    for (const [ageTerm, x] of [
      [age1, c.age1x],
      [age2, c.age2x],
    ] as const) {
      a += ageTerm * x.smoke[smokeCat];
      a += ageTerm * (x.af * b.af + x.steroids * b.steroids + x.impotence * b.impotence + x.migraine * b.migraine);
      a += ageTerm * (x.renal * b.renal + x.sle * b.sle + x.treatedhyp * b.treatedhyp + x.type1 * b.type1 + x.type2 * b.type2);
      a += ageTerm * (x.bmi1 * bmi1 + x.bmi2 * bmi2 + x.fh * b.fh + x.sbp * cSbp + x.town * cTown);
    }

    if (p.sbpSd === undefined) notes.push('ไม่ได้ระบุ SD ของ SBP — ใช้ค่าเฉลี่ยประชากรแทน');
    if (p.townsend === undefined) notes.push('Townsend deprivation score ใช้ค่า 0 (ค่าเฉลี่ยของสหราชอาณาจักร)');
    notes.push('QRISK3 พัฒนาจากประชากรสหราชอาณาจักร การใช้กับคนไทยยังไม่มีการตรวจสอบความแม่นยำ');

    return pointResult(
      {
        modelId: 'qrisk3',
        variant: `QRISK3-2017 · ${female ? 'Women' : 'Men'} · ${QRISK_ETHNICITIES[p.qriskEthnicity]}`,
        categories: QRISK3_CATEGORIES,
        details: [
          { label: 'BMI', value: fmt(rawBmi, 1) },
          { label: 'TC/HDL ratio', value: fmt(p.tc! / p.hdl!, 1) },
        ],
        notes,
      },
      toPercent(1 - Math.pow(c.survivor10, Math.exp(a))),
    );
  },
};
