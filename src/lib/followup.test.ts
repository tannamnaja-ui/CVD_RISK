import { describe, expect, it } from 'vitest';
import { appointmentKept, missedAppointment } from './appointments';
import { EMPTY_FORM, resolveThaiMode, type FormValues } from './formModel';
import { pickVitals } from './hosxp/vitals';
import { diabetesFrom } from './hosxp/diabetes';
import { buildClinical } from './hosxp/clinical';
import { diabetesSql } from './hosxp/sql';
import { modifiableFactors, thaiResult, thaiWhatIf } from './whatIf';

describe('pickVitals', () => {
  const rows = [
    { vn: 'today', vstdate: '2026-10-20', visit_date: '2026-10-20', bps: 150, bw: null, height: null, waist: null },
    { vn: 'v2', vstdate: '2026-08-01', visit_date: '2026-10-20', bps: 120, bw: 70, height: null, waist: 90 },
    { vn: 'v1', vstdate: '2020-01-01', visit_date: '2026-10-20', bps: 130, bw: 60, height: 165, waist: 80 },
  ];
  it('prefers this visit, then the newest earlier value that is recent enough', () => {
    const p = pickVitals(rows, 'today');
    expect(p.bps).toEqual({ value: 150, date: '2026-10-20', current: true });
    expect(p.waist).toEqual({ value: 90, date: '2026-08-01', current: false });
    expect(p.bw?.value).toBe(70);
    // height may be older (adults) — within 10 years
    expect(p.height).toEqual({ value: 165, date: '2020-01-01', current: false });
  });
  it('ignores earlier values that are too old', () => {
    const p = pickVitals([rows[0], { ...rows[2], vstdate: '2025-01-01' }], 'today');
    expect(p.waist).toBeUndefined();
    expect(p.height?.value).toBe(165);
  });
});

const form = (v: Partial<FormValues>): FormValues => {
  const values = { ...EMPTY_FORM, age: '60', gender: 'male' as const, sbp: '160', ...v };
  return { ...values, thaiMode: resolveThaiMode(values) };
};

describe('what-if scenarios', () => {
  it('lowers the risk for each modifiable factor and for all together', () => {
    const w = thaiWhatIf(form({ smoke: true, tc: '260' }))!;
    expect(w.scenarios.map((s) => s.id)).toEqual(['smoke', 'sbp', 'tc', 'all']);
    for (const s of w.scenarios) expect(s.result.risk!).toBeLessThan(w.base.risk!);
    const all = w.scenarios.find((s) => s.id === 'all')!.result.risk!;
    expect(all).toBeLessThan(Math.min(...w.scenarios.filter((s) => s.id !== 'all').map((s) => s.result.risk!)));
  });
  it('uses waist (not TC) when the non-lab formula is in use', () => {
    const w = thaiWhatIf(form({ waist: '100', height: '160' }))!;
    expect(w.scenarios.map((s) => s.id)).toEqual(['sbp', 'waist', 'all']);
  });
  it('needs complete data and lists modifiable factors', () => {
    expect(thaiResult(form({ sbp: '' }))).toBeNull();
    expect(modifiableFactors(form({ smoke: true, tc: '240', hdl: '35', dm: true })).map((f) => f.id)).toEqual(['smoke', 'sbp', 'tc', 'hdl', 'dm']);
  });
});

describe('diabetes auto-tick', () => {
  it('ticks on a diagnosis, a drug, or FBS ≥ 126 (screening first, else the highest numeric lab value)', () => {
    expect(diabetesFrom({ dm_icd10: 'E119' }).reasons).toEqual(['วินิจฉัย E119']);
    expect(diabetesFrom({ dm_drug: 'Metformin 500 mg' }).dm).toBe(true);
    expect(diabetesFrom({ lab_fbs: '98;140;pending' }).reasons).toEqual(['FBS 140 (ผลแล็บ)']);
    expect(diabetesFrom({ screen_fbs: '110', lab_fbs: '140' })).toEqual({ dm: false, reasons: [], fbs: { value: 110, source: 'ซักประวัติ' } });
    expect(diabetesFrom(undefined).dm).toBe(false);
  });
  it('rejects malformed VNs', () => {
    expect(() => diabetesSql('postgresql', "1' OR '1'='1")).toThrow();
    expect(diabetesSql('mysql', '690619000427')).toContain('DATE_SUB');
  });
});

describe('patient-list assessment inputs', () => {
  const visits = [
    { vn: 'A', hn: '1', vstdate: '2026-10-20' },
    { vn: 'B', hn: '2', vstdate: '2026-10-20' },
  ];
  const data = {
    screenings: [
      { vn: 'A', hn: '1', vstdate: '2026-10-20', bps: 150, waist: null, height: null, cholesterol: null, hdl: 45, fbs: 130, smoking: 1 },
      { vn: 'A0', hn: '1', vstdate: '2026-09-01', bps: 120, waist: 92, height: null },
      { vn: 'A9', hn: '1', vstdate: '2026-10-25', bps: 99, waist: 70 }, // after the visit: must not be used
      { vn: 'B', hn: '2', vstdate: '2026-10-20', bps: 0, cholesterol: 210, hdl: null, smoking: 0 },
    ],
    heights: [{ hn: '1', vstdate: '2020-05-01', height: 160 }],
    labs: [
      { vn: 'A', sys_lab_code_id: 4, lab_order_result: '240' },
      { vn: 'A', sys_lab_code_id: 6, lab_order_result: '40' },
      { vn: 'B', sys_lab_code_id: 4, lab_order_result: '199' },
    ],
    diabetes: [{ hn: '2', dm_icd10: 'E119', dm_drug: null }],
  };
  const c = buildClinical(visits, data);
  it('uses the screening record first, then the lab result', () => {
    expect(c.get('A')!.tc).toEqual({ value: 240, source: 'ผลแล็บ' });
    expect(c.get('A')!.hdl).toEqual({ value: 45, source: 'ซักประวัติ' });
    expect(c.get('B')!.tc).toEqual({ value: 210, source: 'ซักประวัติ' });
  });
  it('fills vitals from earlier visits only, and flags smoking and diabetes', () => {
    expect(c.get('A')!.sbp).toEqual({ value: 150, date: '2026-10-20', current: true });
    expect(c.get('A')!.waist).toEqual({ value: 92, date: '2026-09-01', current: false });
    expect(c.get('A')!.height?.value).toBe(160);
    expect(c.get('B')!.sbp).toBeUndefined();
    expect(c.get('A')!.smoke).toBe(true);
    expect(c.get('A')!.dm.reasons).toEqual(['FBS 130 (ซักประวัติ)']);
    expect(c.get('B')!.dm.reasons).toEqual(['วินิจฉัย E119']);
  });
});

describe('appointments', () => {
  it('counts a visit within ±7 days or a linked visit as kept', () => {
    expect(appointmentKept({ date: '2026-09-10' }, ['2026-09-15'])).toBe(true);
    expect(appointmentKept({ date: '2026-09-10' }, ['2026-09-20'])).toBe(false);
    expect(appointmentKept({ date: '2026-09-10', visitVn: '123' }, [])).toBe(true);
  });
  it('reports the latest missed appointment unless the patient came back later', () => {
    const appts = [{ date: '2026-08-01' }, { date: '2026-09-10' }, { date: '2026-10-22' }];
    expect(missedAppointment(appts, ['2026-08-01'], '2026-10-24')?.date).toBe('2026-09-10');
    expect(missedAppointment(appts, ['2026-08-01', '2026-10-01'], '2026-10-24')).toBeNull();
    expect(missedAppointment([{ date: '2026-10-20' }], [], '2026-10-24')).toBeNull(); // still within grace
  });
});
