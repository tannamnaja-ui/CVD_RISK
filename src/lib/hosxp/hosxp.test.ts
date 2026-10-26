import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, applyPatientFilters, applyRiskFactors, cvdStatus, depMatch, depOption, knownDepCodes, nextSort, riskFactorsOf, type PatientRow, type SortState } from './patients';
import { cvdHistorySql, vitalsHistorySql, patientNamesSql, patientsSql, sqlDate, sqlVn } from './sql';

const rows: PatientRow[] = [
  { vn: '1', hn: '001', ptname: 'นายก', pdx: 'J069', dx_text_list: 'URI', vstdate: '2026-10-24', vsttime: '09:10', depcode: '010', dep_list: '010,020', department: 'OPD', spclty: 'อายุรกรรม' },
  { vn: '2', hn: '002', ptname: 'นางข', pdx: '', vstdate: '2026-10-24', vsttime: '08:00', depcode: '020', dep_list: '', department: 'ER', spclty: 'อุบัติเหตุ' },
  { vn: '3', hn: '001', ptname: 'นายก', pdx: 'E119', vstdate: '2026-10-24', vsttime: '10:30', depcode: '030', dep_list: '030', department: '030 NCD', spclty: 'อายุรกรรม' },
];

describe('room filter', () => {
  const known = knownDepCodes(rows);
  it('matches a known code via queue rows, ignoring visits without queue rows', () => {
    expect(depMatch(rows[0], '020', known)).toBe(true);
    expect(depMatch(rows[1], '020', known)).toBe(false); // main room 020 but no queue rows
  });
  it('falls back to a name search for free text', () => {
    expect(depMatch(rows[1], 'er', known)).toBe(true);
  });
  it('prefixes the room code to option text unless already present', () => {
    expect(depOption(rows[0])).toBe('010 OPD');
    expect(depOption(rows[2])).toBe('030 NCD');
  });
});

describe('patient filters', () => {
  const known = knownDepCodes(rows);
  it('filters by search text, department, HN and sorts by time', () => {
    expect(applyPatientFilters(rows, { ...EMPTY_FILTERS, spclty: 'อายุร' }, null, known).map((r) => r.vn)).toEqual(['1', '3']);
    expect(applyPatientFilters(rows, { ...EMPTY_FILTERS, hn: '002' }, null, known).map((r) => r.vn)).toEqual(['2']);
    expect(applyPatientFilters(rows, EMPTY_FILTERS, { key: 'vstdate', dir: 'asc' }, known).map((r) => r.vn)).toEqual(['2', '1', '3']);
  });
});

describe('SQL builders', () => {
  it('rejects values that could break out of the SQL string', () => {
    expect(() => sqlDate("2025-01-01' OR '1'='1")).toThrow();
    expect(() => sqlVn("1'; DELETE FROM ovst;--")).toThrow();
    expect(() => vitalsHistorySql("1' OR '1'='1")).toThrow();
    expect(() => cvdHistorySql("1' OR '1'='1")).toThrow();
    expect(sqlDate('2025-01-31')).toBe("'2025-01-31'");
  });
  it('uses the dialect-specific aggregate and text sanitising', () => {
    expect(patientsSql('postgresql', '2025-01-01', '2025-01-01')).toContain('string_agg(DISTINCT');
    expect(patientsSql('mysql', '2025-01-01', '2025-01-01')).toContain('GROUP_CONCAT(DISTINCT');
    expect(patientsSql('mysql', '2025-01-01', '2025-01-01')).not.toContain('translate(');
  });
});

describe('protected personal fields', () => {
  it('keeps patient and doctor names out of the list query', () => {
    for (const d of ['postgresql', 'mysql'] as const) {
      const sql = patientsSql(d, '2026-10-24', '2026-10-24');
      expect(sql).not.toMatch(/fname|lname|dr\.name|doctor/);
    }
  });
  it('fetches names separately for the same date range', () => {
    const sql = patientNamesSql('postgresql', '2026-10-24', '2026-10-25');
    expect(sql).toContain('p.fname');
    expect(sql).toContain("BETWEEN '2026-10-24' AND '2026-10-25'");
  });
});

describe('column sorting', () => {
  const people: PatientRow[] = [
    { vn: 'a', age_y: 9, ptname: 'นายข', pdx: '' },
    { vn: 'b', age_y: 65, ptname: 'นางก', pdx: 'I10' },
    { vn: 'c', age_y: '', ptname: '', pdx: 'E119' },
    { vn: 'd', age_y: 10, ptname: 'นายค', pdx: 'A09' },
  ];
  const order = (sort: SortState) => applyPatientFilters(people, EMPTY_FILTERS, sort, new Set()).map((r) => r.vn);

  it('sorts age as a number and keeps empty values last in both directions', () => {
    expect(order({ key: 'age', dir: 'asc' })).toEqual(['a', 'd', 'b', 'c']);
    expect(order({ key: 'age', dir: 'desc' })).toEqual(['b', 'd', 'a', 'c']);
  });
  it('sorts Thai text and codes', () => {
    expect(order({ key: 'ptname', dir: 'asc' })).toEqual(['b', 'a', 'd', 'c']);
    expect(order({ key: 'pdx', dir: 'asc' })).toEqual(['d', 'c', 'b', 'a']);
  });
  it('toggles direction on the same column and resets on a new one', () => {
    expect(nextSort(null, 'hn')).toEqual({ key: 'hn', dir: 'asc' });
    expect(nextSort({ key: 'hn', dir: 'asc' }, 'hn')).toEqual({ key: 'hn', dir: 'desc' });
    expect(nextSort({ key: 'hn', dir: 'desc' }, 'hn')).toEqual({ key: 'hn', dir: 'asc' });
    expect(nextSort({ key: 'hn', dir: 'desc' }, 'age')).toEqual({ key: 'age', dir: 'asc' });
  });
});

describe('screening age filter', () => {
  const people: PatientRow[] = [
    { vn: '1', age_y: 34 },
    { vn: '2', age_y: 35 },
    { vn: '3', age_y: '70' },
    { vn: '4', age_y: 71 },
    { vn: '5', age_y: '' },
  ];
  it('keeps only ages 35–70 inclusive, excluding unknown ages', () => {
    const vns = applyPatientFilters(people, { ...EMPTY_FILTERS, screeningAge: true }, null, new Set()).map((r) => r.vn);
    expect(vns).toEqual(['2', '3']);
  });
});

describe('name search', () => {
  const people: PatientRow[] = [
    { vn: '1', hn: '0001', ptname: 'นายสมชาย  ใจดี', pdx: 'I10' },
    { vn: '2', hn: '0002', ptname: 'นางสมหญิง  ใจงาม', pdx: 'E119' },
    { vn: '3', hn: 'I10', ptname: '', pdx: '' },
  ];
  const find = (search: string) => applyPatientFilters(people, { ...EMPTY_FILTERS, search }, null, new Set()).map((r) => r.vn);

  it('matches first name, surname or both regardless of spacing', () => {
    expect(find('สมชาย')).toEqual(['1']);
    expect(find('ใจ')).toEqual(['1', '2']);
    expect(find('สมชาย ใจดี')).toEqual(['1']);
    expect(find('  ใจงาม   สมหญิง ')).toEqual(['2']);
  });
  it('no longer matches HN or PDX', () => {
    expect(find('I10')).toEqual([]);
    expect(find('0001')).toEqual([]);
  });
});

describe('major risk factors', () => {
  const male: PatientRow = { vn: 'm', sex: '1', age_y: 30 };
  const female: PatientRow = { vn: 'f', sex: '2', age_y: 30 };

  it('reads diagnosis flags', () => {
    expect(riskFactorsOf(male, { vn: 'm', dm: 1, dlp: '1', smoke: 0, fh: 1 })).toEqual(['dm', 'dlp', 'fh']);
  });
  it('flags hypertension from SBP ≥ 140 or DBP ≥ 90 even without a diagnosis', () => {
    expect(riskFactorsOf(male, { vn: 'm', bps: 139, bpd: 89 })).toEqual([]);
    expect(riskFactorsOf(male, { vn: 'm', bps: 140 })).toEqual(['ht']);
    expect(riskFactorsOf(male, { vn: 'm', bpd: 90 })).toEqual(['ht']);
  });
  it('flags obesity by BMI ≥ 25 or sex-specific waist', () => {
    expect(riskFactorsOf(male, { vn: 'm', bw: 72.25, height: 170 })).toEqual(['obese']); // BMI 25.0
    expect(riskFactorsOf(male, { vn: 'm', waist: 90 })).toEqual([]);
    expect(riskFactorsOf(male, { vn: 'm', waist: 91 })).toEqual(['obese']);
    expect(riskFactorsOf(female, { vn: 'f', waist: 81 })).toEqual(['obese']);
    expect(riskFactorsOf({ vn: 'x' }, { vn: 'x', waist: 120 })).toEqual([]); // unknown sex → no waist rule
  });
  it('shows the screening population when both boxes are ticked', () => {
    const rows = applyRiskFactors(
      [
        { vn: '1', age_y: 30, sex: '1' },
        { vn: '2', age_y: 30, sex: '1' },
        { vn: '3', age_y: 50, sex: '1' },
        { vn: '4', age_y: 75, sex: '2' },
      ],
      [{ vn: '2', dm: 1 }, { vn: '4', bps: 150 }],
    );
    const find = (screeningAge: boolean, riskFactors: boolean) =>
      applyPatientFilters(rows, { ...EMPTY_FILTERS, screeningAge, riskFactors }, null, new Set()).map((r) => r.vn);
    expect(find(false, true)).toEqual(['2', '4']);
    expect(find(true, false)).toEqual(['3']);
    expect(find(true, true)).toEqual(['2', '3', '4']);
  });
});

describe('comorbidities / specific high-risk conditions', () => {
  it('reads comorbidity flags separately from risk factors', () => {
    const [p] = applyRiskFactors([{ vn: '1', sex: '2', age_y: 28 }], [{ vn: '1', ckd: 1, pregnancy: '1', dm: 0 }]);
    expect(p.comorbid).toEqual(['ckd', 'pregnancy']);
    expect(p.risk).toEqual([]);
  });
  it('qualifies a patient by any ticked group', () => {
    const rows = applyRiskFactors(
      [
        { vn: 'a', age_y: 28, sex: '2' },
        { vn: 'b', age_y: 28, sex: '1' },
        { vn: 'c', age_y: 50, sex: '1' },
      ],
      [{ vn: 'a', autoimmune: 1 }, { vn: 'b', dm: 1 }],
    );
    const find = (f: Partial<typeof EMPTY_FILTERS>) => applyPatientFilters(rows, { ...EMPTY_FILTERS, ...f }, null, new Set()).map((r) => r.vn);
    expect(find({ comorbid: true })).toEqual(['a']);
    expect(find({ comorbid: true, riskFactors: true })).toEqual(['a', 'b']);
    expect(find({ comorbid: true, riskFactors: true, screeningAge: true })).toEqual(['a', 'b', 'c']);
  });
});

describe('CVD screening status', () => {
  const rows = applyRiskFactors(
    [
      { vn: 's', age_y: 50, sex: '1' },
      { vn: 'd1', age_y: 50, sex: '1' },
      { vn: 'd2', age_y: 25, sex: '2' },
      { vn: 'n', age_y: 25, sex: '2' },
      { vn: 'x', age_y: 50, sex: '1' },
    ],
    [{ vn: 's', cvd_screened: 1 }, { vn: 'd1', cvd_screened: 0 }, { vn: 'd2', ckd: 1, cvd_screened: 0 }, { vn: 'n', cvd_screened: 0 }],
  );
  const status = (vn: string) => cvdStatus(rows.find((r) => r.vn === vn)!);

  it('marks saved visits as screened, eligible ones as due, the rest as not eligible', () => {
    expect(status('s')).toBe('screened');
    expect(status('d1')).toBe('due'); // age 35–70
    expect(status('d2')).toBe('due'); // young but has a comorbidity
    expect(status('n')).toBe('notEligible');
  });
  it('is unknown until the data has loaded', () => {
    expect(cvdStatus({ vn: 'y', age_y: 50 })).toBeNull();
  });
});

describe('saved assessment result', () => {
  it('carries the saved level and risk, or null when not assessed', () => {
    const [a, b] = applyRiskFactors(
      [{ vn: '1', age_y: 50 }, { vn: '2', age_y: 50 }],
      [{ vn: '1', cvd_screened: 1, cvd_risk: '12.345', cvd_level: 2, cvd_level_name: 'ระดับ 2 ความเสี่ยงปานกลาง' }, { vn: '2', cvd_screened: 0 }],
    );
    expect(a.result).toEqual({ risk: 12.345, level: 2, label: 'ระดับ 2 ความเสี่ยงปานกลาง' });
    expect(b.result).toBeNull();
  });
});
