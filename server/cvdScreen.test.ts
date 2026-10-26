import { describe, expect, it } from 'vitest';
import { thaiResult } from './cvdScreen';

describe('opdscreen_cvd values', () => {
  const base = { vn: '1', age: '55', gender: 'male' as const, sbp: '140', dm: true, smoke: false };

  it('uses the Laboratory model when TC is given and stores TC', () => {
    const r = thaiResult({ ...base, tc: '220' });
    expect(r.tc).toBe(220);
    expect(r.dm).toBe(true);
    expect(r.typeId).toBeGreaterThanOrEqual(1);
    expect(r.typeId).toBeLessThanOrEqual(5);
  });
  it('uses the Non-Laboratory model without TC (tc stored as null)', () => {
    expect(thaiResult({ ...base, waist: '90', height: '165' }).tc).toBeNull();
  });
  it('maps risk levels 1–5 like cvd_risk_score_type', () => {
    const low = thaiResult({ ...base, age: '36', sbp: '110', dm: false, tc: '150', gender: 'female' });
    expect(low.typeId).toBe(1);
  });
  it('refuses incomplete or out-of-range data', () => {
    expect(() => thaiResult({ ...base })).toThrow(/ไม่ครบ/);
    expect(() => thaiResult({ ...base, age: '80', tc: '200' })).toThrow();
  });
});

describe('opdscreen_cvd follows the formula picked on screen', () => {
  const base = { vn: '1', age: '60', gender: 'male' as const, sbp: '150', dm: true, smoke: false, tc: '240', hdl: '40' };
  it('automatic: TC + HDL → ratio model', () => {
    const auto = thaiResult(base);
    const tcOnly = thaiResult({ ...base, thaiFormula: 'lab' });
    expect(auto.risk).not.toBeCloseTo(tcOnly.risk, 2);
    expect(auto.tc).toBe(240);
  });
  it('the ratio model needs HDL', () => {
    expect(() => thaiResult({ ...base, hdl: '', thaiFormula: 'ratio' })).toThrow(/HDL/);
  });
});
