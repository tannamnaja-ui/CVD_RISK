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
  it('refuses incomplete or implausible data, but not ages outside the formula range', () => {
    expect(() => thaiResult({ ...base })).toThrow(/ไม่ครบ/);
    expect(() => thaiResult({ ...base, age: '150', tc: '200' })).toThrow();
    expect(thaiResult({ ...base, age: '80', tc: '200' }).risk).toBeGreaterThan(0);
  });
});

describe('opdscreen_cvd follows the formula picked on screen', () => {
  const base = { vn: '1', age: '60', gender: 'male' as const, sbp: '150', dm: true, smoke: false, tc: '240', hdl: '40' };
  it('automatic with TC (HDL or not), the TC card and the TC/HDL card all save the same chart-based result', () => {
    const auto = thaiResult(base);
    expect(thaiResult({ ...base, thaiFormula: 'lab' }).risk).toBe(auto.risk);
    expect(thaiResult({ ...base, hdl: '', thaiFormula: 'ratio' }).risk).toBe(auto.risk);
    expect(auto.tc).toBe(240);
  });
  it('saves the colour-chart level: DM, woman, smoker, 64 y, SBP 135, TC 244 → level 2 (moderate)', () => {
    const r = thaiResult({ vn: '1', age: '64', gender: 'female', sbp: '135', dm: true, smoke: true, tc: '244', hdl: '52' });
    expect(r.typeId).toBe(2);
  });
});
