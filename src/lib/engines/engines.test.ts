import { describe, expect, it } from 'vitest';
import { EMPTY_FORM, resolveThaiMode, toPatient, validateForModel } from '../formModel';
import { riskToMeterPosition } from '../meter';
import { FORMULAS } from './formulas';
import { THAI_FORMULAS } from './thai';
import { THAI_CATEGORIES } from './thai';
import { ENGINES, MODELS, MODEL_ORDER, assess, categorize, modelFor, type CheckedPatient, type PatientData } from './index';

const base: PatientData = {
  gender: 'male',
  dm: false,
  smoke: false,
  bpMeds: false,
  exSmoker: false,
  score2Region: 'moderate',
  whoRegion: 'SEAR_B',
  ascvdRace: 'white',
  qriskEthnicity: 0,
  smokeIntensity: 'moderate',
  dmType: 'type2',
  conditions: {
    familyHistory: false,
    ckd: false,
    ra: false,
    af: false,
    migraine: false,
    sle: false,
    steroids: false,
    atypicalAntipsychotic: false,
    severeMentalIllness: false,
    erectileDysfunction: false,
  },
};

const patient = (p: Partial<PatientData>) => ({ ...base, ...p }) as CheckedPatient;
const risk = (id: keyof typeof MODELS, p: Partial<PatientData>) => MODELS[id].calculate(patient(p)).risk!;

describe('Thai CV Risk Score', () => {
  it('lab model matches a hand-computed value', () => {
    // ΣβX = 0.07·50 + 0.584 + 0.443 + 0.014·140 + 0.004·220 = 7.367
    const expected = (1 - Math.pow(0.9592, Math.exp(7.367 - 7.7479))) * 100;
    expect(risk('thai-lab', { age: 50, smoke: true, sbp: 140, tc: 220 })).toBeCloseTo(expected, 8);
  });

  it('non-lab model uses WHtR', () => {
    const sum = 0.074 * 50 + 0.017 * 120 + 1.834 * 0.5;
    const expected = (1 - Math.pow(0.9598, Math.exp(sum - 4.7937))) * 100;
    expect(risk('thai-nonlab', { gender: 'female', age: 50, sbp: 120, waist: 80, height: 160 })).toBeCloseTo(expected, 8);
  });
});

describe('Framingham 2008 (D’Agostino)', () => {
  it('matches a hand-computed value for women', () => {
    const sum = 2.32888 * Math.log(61) + 1.20904 * Math.log(180) - 0.70833 * Math.log(47) + 2.82263 * Math.log(124) + 0.52873;
    const expected = (1 - Math.pow(0.95012, Math.exp(sum - 26.1931))) * 100;
    expect(risk('frs', { gender: 'female', age: 61, tc: 180, hdl: 47, sbp: 124, bpMeds: true, smoke: true })).toBeCloseTo(expected, 8);
  });
});

describe('ASCVD Pooled Cohort Equations', () => {
  // Validation examples from Goff et al. 2013 (55 y, TC 213, HDL 50, SBP 120 untreated, non-smoker, no DM).
  // The paper rounds each term before summing, so unrounded results differ by up to ~0.1 percentage point.
  const example = { age: 55, tc: 213, hdl: 50, sbp: 120 };
  it.each([
    ['female', 'white', 2.1],
    ['female', 'africanAmerican', 3.0],
    ['male', 'white', 5.3],
    ['male', 'africanAmerican', 6.1],
  ] as const)('%s %s → %f%%', (gender, ascvdRace, expected) => {
    expect(Math.abs(risk('ascvd', { ...example, gender, ascvdRace }) - expected)).toBeLessThan(0.1);
  });
});

describe('SCORE2 / SCORE2-OP', () => {
  it('uses SCORE2-OP from age 70', () => {
    const r = MODELS.score2.calculate(patient({ age: 72, sbp: 140, tc: 220, hdl: 50 }));
    expect(r.variant).toContain('SCORE2-OP');
    expect(r.risk).toBeGreaterThan(0);
  });

  it('risk rises with region risk level', () => {
    const p = { age: 55, sbp: 140, tc: 230, hdl: 45, smoke: true };
    const low = risk('score2', { ...p, score2Region: 'low' });
    const veryHigh = risk('score2', { ...p, score2Region: 'veryHigh' });
    expect(veryHigh).toBeGreaterThan(low);
  });

  it('uses age-specific thresholds', () => {
    expect(MODELS.score2.calculate(patient({ age: 45, sbp: 120, tc: 200, hdl: 50 })).categories[0].max).toBe(2.5);
    expect(MODELS.score2.calculate(patient({ age: 60, sbp: 120, tc: 200, hdl: 50 })).categories[0].max).toBe(5);
    expect(MODELS.score2.calculate(patient({ age: 75, sbp: 120, tc: 200, hdl: 50 })).categories[0].max).toBe(7.5);
  });
});

describe('WHO/ISH charts', () => {
  it('returns a band, not a point estimate', () => {
    const r = MODELS.who.calculate(patient({ age: 45, sbp: 120 }));
    expect(r.risk).toBeNull();
    expect(r.range).toEqual({ min: 0, max: 10 });
  });

  it('high-risk profile lands in the top band', () => {
    const r = MODELS.who.calculate(patient({ age: 65, sbp: 185, tc: 310, dm: true, smoke: true }));
    expect(r.range?.min).toBe(40);
  });
});

describe('QRISK3', () => {
  it('produces a plausible risk and increases with conditions', () => {
    const p = { age: 60, sbp: 140, tc: 220, hdl: 50, height: 170, weight: 75 };
    const plain = risk('qrisk3', p);
    const withAf = risk('qrisk3', { ...p, conditions: { ...base.conditions, af: true } });
    expect(plain).toBeGreaterThan(5);
    expect(plain).toBeLessThan(40);
    expect(withAf).toBeGreaterThan(plain);
  });
});

describe('formula documentation', () => {
  it('covers every engine with well-formed tables and https sources', () => {
    for (const info of Object.values(FORMULAS)) {
      expect(info.sources.length).toBeGreaterThan(0);
      for (const s of info.sources) expect(s.url).toMatch(/^https:\/\//);
      for (const section of info.sections) {
        for (const row of section.table?.rows ?? []) expect(row).toHaveLength(section.table!.columns.length);
      }
    }
    expect(Object.keys(FORMULAS).sort()).toEqual(ENGINES.map((e) => e.id).sort());
  });
});

describe('assess / validation', () => {
  it('reports missing fields, and calculates outside the age range with a note', () => {
    const p = { ...base, age: 30, sbp: 120 };
    expect(assess(MODELS.ascvd, p).status).toBe('missing');
    const who = assess(MODELS.who, p);
    expect(who.status).toBe('ok');
    if (who.status === 'ok') {
      expect(who.outsideAge).toContain('อายุ 30 ปี');
      expect(who.result.notes[0]).toBe(who.outsideAge);
    }
    const thai = assess(MODELS['thai-lab'], { ...p, age: 78, tc: 220 });
    expect(thai.status === 'ok' && thai.outsideAge).toBeTruthy();
    expect(MODEL_ORDER).toHaveLength(8);
  });

  it('only requires fields of the selected model', () => {
    const values = { ...EMPTY_FORM, age: '55', gender: 'male' as const, sbp: '120' };
    expect(validateForModel(values, MODELS.who)).toEqual({});
    expect(Object.keys(validateForModel(values, MODELS.frs))).toEqual(['tc', 'hdl']);
    expect(toPatient(values).tc).toBeUndefined();
  });

  it('categorizes on boundaries', () => {
    expect(categorize(9.99, THAI_CATEGORIES).id).toBe('low');
    expect(categorize(10, THAI_CATEGORIES).id).toBe('moderate');
    expect(categorize(40, THAI_CATEGORIES).id).toBe('extreme');
  });

  it('maps risk onto equal-width meter bands', () => {
    expect(riskToMeterPosition(10, THAI_CATEGORIES)).toBe(20);
    expect(riskToMeterPosition(90, THAI_CATEGORIES)).toBe(100);
  });
});

describe('Thai CV Risk — TC/HDL ratio model and formula choice', () => {
  it('matches a hand-computed value', () => {
    // B = 0.5401 + 0.0706·60 + 0.0152·150 + 0.5492 + 0 + 0.1691·(240/40) = 8.6199
    const b = 0.5401 + 0.0706 * 60 + 0.0152 * 150 + 0.5492 + 0.1691 * 6;
    const expected = (1 - Math.pow(0.9592, Math.exp(b - 7.7479))) * 100;
    expect(risk('thai-ratio', { age: 60, sbp: 150, tc: 240, hdl: 40, dm: true })).toBeCloseTo(expected, 8);
  });
  it('picks the model from the lab values in automatic mode, or uses the chosen one', () => {
    expect(resolveThaiMode({ tc: '200', hdl: '50', thaiFormula: 'auto' })).toBe('ratio');
    expect(resolveThaiMode({ tc: '200', hdl: '', thaiFormula: 'auto' })).toBe('lab');
    expect(resolveThaiMode({ tc: '', hdl: '', thaiFormula: 'auto' })).toBe('nonlab');
    expect(resolveThaiMode({ tc: '200', hdl: '50', thaiFormula: 'lab' })).toBe('lab');
    expect(resolveThaiMode({ tc: '', hdl: '', thaiFormula: 'ratio' })).toBe('ratio');
  });
  it('documents a source for every Thai formula', () => {
    for (const f of Object.values(THAI_FORMULAS)) expect(f.source.length).toBeGreaterThan(10);
  });
});

describe('Thai CV Risk cards', () => {
  it('each card pins its formula; the plain card is automatic', () => {
    expect(modelFor('thai-ratio', 'nonlab').id).toBe('thai-ratio');
    expect(modelFor('thai-tc', 'ratio').id).toBe('thai-lab');
    expect(modelFor('thai-nonlab', 'lab').id).toBe('thai-nonlab');
    expect(modelFor('thai', 'ratio').id).toBe('thai-ratio');
    expect(modelFor('thai', 'nonlab').id).toBe('thai-nonlab');
  });
  it('every card is in the engine list (so it can be hidden) and has a formula page', () => {
    for (const id of ['thai', 'thai-ratio', 'thai-tc', 'thai-nonlab'] as const) {
      expect(ENGINES.some((e) => e.id === id)).toBe(true);
      expect(FORMULAS[id]).toBeDefined();
    }
  });
});
