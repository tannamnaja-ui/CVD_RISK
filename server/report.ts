/**
 * CVD screening report: aggregates only (counts, rates, means) — no patient identifiers leave the server.
 *
 * Definitions (also shown on the report page):
 *  - Target population: distinct HN with a visit in the period who meets the screening criteria
 *    (age 35–70, or a major risk factor, or a comorbidity) — the same rule as the red circles in the list.
 *  - Screened: distinct HN with an opdscreen_cvd row for a visit in the period (latest one counts).
 *  - High risk: Thai CV Risk ≥ 20%.
 */
import { APPOINTMENT_GRACE_DAYS, appointmentKept, isJudgeable, type Appointment } from '../src/lib/appointments';
import { comorbiditiesOf, inScreeningAge, riskFactorsOf, todayLocal, type PatientRow, type RiskRow } from '../src/lib/hosxp/patients';
import { riskFactorsSql, sqlDate } from '../src/lib/hosxp/sql';
import type { Db } from './db';

const DAY = 86_400_000;
const STATIN_WINDOW_DAYS = 180;
export const COVERAGE_TARGET = 80;
export const LDL_TARGET = 100;

const toDate = (s: unknown) => new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => fmt(new Date(toDate(s).getTime() + n * DAY));
const num = (v: unknown) => {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n;
};
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : null);
const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

const AGE_GROUPS = [
  { label: '35–44', min: 35, max: 44 },
  { label: '45–54', min: 45, max: 54 },
  { label: '55–64', min: 55, max: 64 },
  { label: '65+', min: 65, max: 200 },
];
const ageGroup = (age: number | null) => (age === null ? null : (AGE_GROUPS.find((g) => age >= g.min && age <= g.max)?.label ?? null));

/** Thai address of the patient's tambon (thaiaddress.codetype 3 = tambon). */
export const TAMBON_JOIN = `left outer join thaiaddress ta on ta.codetype='3' and ta.chwpart=p.chwpart and ta.amppart=p.amppart and ta.tmbpart=p.tmbpart
  left outer join thaiaddress tamp on tamp.codetype='2' and tamp.chwpart=p.chwpart and tamp.amppart=p.amppart`;

/** Screenings saved in opdscreen_cvd whose visit falls in the period. */
const screeningsInRange = (from: string, to: string) => `
  SELECT c.vn, o.hn, o.vstdate, c.risk_score, c.cvd_risk_score_type_id AS type_id, c.tc, c.is_smoking, c.is_diabetes,
         v.age_y, p.sex, s.bps, s.bpd, s.waist, s.height, ta.name AS tambon, tamp.name AS amphoe, k.department
  FROM opdscreen_cvd c
  JOIN ovst o ON o.vn = c.vn
  left outer join vn_stat v on v.vn=o.vn
  left outer join patient p on p.hn=o.hn
  left outer join opdscreen s on s.vn=o.vn
  left outer join kskdepartment k on k.depcode=o.main_dep
  ${TAMBON_JOIN}
  WHERE o.vstdate BETWEEN ${sqlDate(from)} AND ${sqlDate(to)}`;

/** HNs screened in the period with Thai CV Risk ≥ 20% (subquery). */
const highRiskHns = (from: string, to: string) =>
  `SELECT o2.hn FROM opdscreen_cvd c2 JOIN ovst o2 ON o2.vn = c2.vn
   WHERE o2.vstdate BETWEEN ${sqlDate(from)} AND ${sqlDate(to)} AND c2.risk_score >= 20`;

interface Screening {
  hn: string;
  date: string;
  risk: number;
  typeId: number;
  tc: number | null;
  smoking: boolean;
  diabetes: boolean;
  age: number | null;
  sex: string;
  sbp: number | null;
  dbp: number | null;
  whtr: number | null;
  tambon: string;
  amphoe: string;
  department: string;
  lab: boolean;
  /** diagnosis-history flags of the patient (from riskFactorsSql) */
  dx: { ht: boolean; dm: boolean; dlp: boolean; smoke: boolean; ckd: boolean };
}

/** Latest screening per HN within the period. */
const dxFlags = (x: RiskRow | undefined) => {
  const on = (v: unknown) => Number(v) === 1;
  return { ht: on(x?.ht), dm: on(x?.dm), dlp: on(x?.dlp), smoke: on(x?.smoke), ckd: on(x?.ckd) };
};

async function loadScreenings(db: Db, from: string, to: string, riskByVn: Map<string, RiskRow>): Promise<Screening[]> {
  const rows = await db.query(screeningsInRange(from, to));
  const byHn = new Map<string, Screening>();
  for (const r of rows) {
    const waist = num(r.waist);
    const height = num(r.height);
    const s: Screening = {
      hn: String(r.hn),
      date: String(r.vstdate).slice(0, 10),
      risk: num(r.risk_score) ?? 0,
      typeId: num(r.type_id) ?? 0,
      tc: num(r.tc),
      smoking: String(r.is_smoking).toUpperCase() === 'Y',
      diabetes: String(r.is_diabetes).toUpperCase() === 'Y',
      age: num(r.age_y),
      sex: String(r.sex ?? ''),
      sbp: num(r.bps),
      dbp: num(r.bpd),
      whtr: waist && height ? waist / height : null,
      tambon: String(r.tambon ?? '').trim() || 'ไม่ระบุตำบล',
      amphoe: String(r.amphoe ?? '').trim() || 'ไม่ระบุอำเภอ',
      department: String(r.department ?? '').trim() || 'ไม่ระบุหน่วยบริการ',
      lab: num(r.tc) !== null,
      dx: dxFlags(riskByVn.get(String(r.vn))),
    };
    const prev = byHn.get(s.hn);
    if (!prev || prev.date <= s.date) byHn.set(s.hn, s);
  }
  return [...byHn.values()];
}

/** Target population per HN (distinct patients with a visit in the period). */
async function loadPopulation(db: Db, from: string, to: string) {
  const [visits, risks] = await Promise.all([
    db.query(`
      SELECT o.vn, o.hn, v.age_y, p.sex, ta.name AS tambon, k.department
      FROM ovst o
      left outer join vn_stat v on v.vn=o.vn
      left outer join patient p on p.hn=o.hn
      left outer join kskdepartment k on k.depcode=o.main_dep
      ${TAMBON_JOIN}
      WHERE o.vstdate BETWEEN ${sqlDate(from)} AND ${sqlDate(to)}`),
    db.query(riskFactorsSql(from, to)),
  ]);
  const riskByVn = new Map(risks.map((r) => [String(r.vn), r as unknown as RiskRow]));
  const people = new Map<string, { age: number | null; eligible: boolean; highRiskFactors: boolean; tambon: string; department: string }>();
  for (const v of visits) {
    const row: PatientRow = { vn: String(v.vn), hn: String(v.hn), age_y: v.age_y as number, sex: String(v.sex ?? '') };
    const r = riskByVn.get(row.vn);
    const eligible = inScreeningAge(row) || riskFactorsOf(row, r).length > 0 || comorbiditiesOf(r).length > 0;
    const age = num(v.age_y);
    const prev = people.get(row.hn!);
    people.set(row.hn!, {
      age: prev?.age != null && age != null ? Math.max(prev.age, age) : (age ?? prev?.age ?? null),
      eligible: !!prev?.eligible || eligible,
      highRiskFactors: !!prev?.highRiskFactors || riskFactorsOf(row, r).length > 0,
      tambon: prev?.tambon ?? (String(v.tambon ?? '').trim() || 'ไม่ระบุตำบล'),
      department: prev?.department ?? (String(v.department ?? '').trim() || 'ไม่ระบุหน่วยบริการ'),
    });
  }
  return { people, riskByVn };
}

async function kpis(db: Db, from: string, to: string) {
  const { people, riskByVn } = await loadPopulation(db, from, to);
  const screenings = await loadScreenings(db, from, to, riskByVn);
  const eligible = [...people.entries()].filter(([, p]) => p.eligible);
  const screenedHn = new Set(screenings.map((s) => s.hn));
  const covered = eligible.filter(([hn]) => screenedHn.has(hn)).length;
  const high = screenings.filter((s) => s.risk >= 20);
  const statinUsers = high.length ? await statinHns(db, from, to) : new Set<string>();
  return {
    screenings,
    people,
    eligibleCount: eligible.length,
    coveredCount: covered,
    kpi: {
      screened: screenings.length,
      coverage: pct(covered, eligible.length),
      highRisk: pct(high.length, screenings.length),
      statin: pct(high.filter((s) => statinUsers.has(s.hn)).length, high.length),
    },
    eligible,
    screenedHn,
    high,
    statinUsers,
  };
}

/** High-risk HNs who received a statin from STATIN_WINDOW_DAYS before the period up to its end. */
async function statinHns(db: Db, from: string, to: string): Promise<Set<string>> {
  const rows = await db.query(`
    SELECT DISTINCT o.hn FROM opitemrece o JOIN drugitems d ON d.icode = o.icode
    WHERE LOWER(d.name) LIKE '%statin%'
      AND o.vstdate BETWEEN ${sqlDate(addDays(from, -STATIN_WINDOW_DAYS))} AND ${sqlDate(to)}
      AND o.hn IN (${highRiskHns(from, to)})`);
  return new Set(rows.map((r) => String(r.hn)));
}

const quarterOf = (date: string) => {
  const d = toDate(date);
  return `${d.getUTCFullYear() + 543} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
};

export async function buildReport(db: Db, from: string, to: string) {
  sqlDate(from);
  sqlDate(to);
  if (from > to) throw new Error('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด');

  // previous period of the same length, for the trend arrows on the KPI cards
  const days = Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  const [cur, prev] = await Promise.all([kpis(db, from, to), kpis(db, prevFrom, prevTo)]);
  const { screenings, people, eligible, screenedHn, high, statinUsers } = cur;

  // ---------- 1. coverage ----------
  const byAge = AGE_GROUPS.map((g) => {
    const inGroup = eligible.filter(([, p]) => ageGroup(p.age) === g.label);
    const done = inGroup.filter(([hn]) => screenedHn.has(hn)).length;
    return { group: g.label, screened: done, notScreened: inGroup.length - done };
  });
  const youngerEligible = eligible.filter(([, p]) => p.age === null || p.age < 35);
  const youngerDone = youngerEligible.filter(([hn]) => screenedHn.has(hn)).length;
  if (youngerEligible.length) byAge.unshift({ group: '< 35 (มีปัจจัยเสี่ยง)', screened: youngerDone, notScreened: youngerEligible.length - youngerDone });
  const lab = screenings.filter((s) => s.lab).length;
  /** screened vs not among the target population, by the patient's tambon or the visit's service unit (top 10) */
  const coverageBy = (key: 'tambon' | 'department') => {
    const m = new Map<string, { screened: number; notScreened: number }>();
    for (const [hn, p] of eligible) {
      const g = m.get(p[key]) ?? { screened: 0, notScreened: 0 };
      if (screenedHn.has(hn)) g.screened++;
      else g.notScreened++;
      m.set(p[key], g);
    }
    return [...m.entries()]
      .map(([group, g]) => ({ group, ...g }))
      .sort((a, b) => b.screened + b.notScreened - (a.screened + a.notScreened))
      .slice(0, 10);
  };

  // ---------- 2. risk stratification ----------
  const levels = [1, 2, 3, 4, 5].map((id) => ({ id, count: screenings.filter((s) => s.typeId === id).length }));
  /** high-risk (≥ 20%) prevalence among the screened, per tambon / amphoe / service unit */
  const groupHigh = (key: 'tambon' | 'amphoe' | 'department') => {
    const m = new Map<string, { screened: number; high: number }>();
    for (const s of screenings) {
      const a = m.get(s[key]) ?? { screened: 0, high: 0 };
      a.screened++;
      if (s.risk >= 20) a.high++;
      m.set(s[key], a);
    }
    return [...m.entries()]
      .map(([name, a]) => ({ name, ...a, rate: pct(a.high, a.screened) }))
      .sort((a, b) => b.high - a.high || b.screened - a.screened);
  };

  // ---------- 3. risk factors ----------
  const n = screenings.length;
  const ht = screenings.filter((s) => s.dx.ht || (s.sbp ?? 0) >= 140 || (s.dbp ?? 0) >= 90).length;
  const ldlRows = n
    ? await db.query(`
        SELECT lo.lab_order_result AS v FROM lab_order lo
        JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
        JOIN lab_head lh ON lh.lab_order_number = lo.lab_order_number
        WHERE LOWER(li.lab_items_name) LIKE '%ldl%'
          AND lh.order_date BETWEEN ${sqlDate(from)} AND ${sqlDate(to)}
          AND lh.hn IN (SELECT o2.hn FROM opdscreen_cvd c2 JOIN ovst o2 ON o2.vn=c2.vn WHERE o2.vstdate BETWEEN ${sqlDate(from)} AND ${sqlDate(to)})`)
    : [];
  const ldl = ldlRows.map((r) => num(String(r.v).trim())).filter((v): v is number => v !== null && v > 0 && v < 1000);
  const factors = [
    { key: 'ht', label: 'ความดันโลหิตสูง', count: ht },
    { key: 'dm', label: 'เบาหวาน', count: screenings.filter((s) => s.diabetes || s.dx.dm).length },
    { key: 'smoke', label: 'สูบบุหรี่', count: screenings.filter((s) => s.smoking || s.dx.smoke).length },
    { key: 'whtr', label: 'อ้วนลงพุง (WHtR ≥ 0.5)', count: screenings.filter((s) => (s.whtr ?? 0) >= 0.5).length },
    { key: 'dlp', label: 'ไขมันในเลือดผิดปกติ', count: screenings.filter((s) => s.dx.dlp).length },
    { key: 'ckd', label: 'โรคไตเรื้อรัง (โรคร่วม)', count: screenings.filter((s) => s.dx.ckd).length },
  ]
    .map((f) => ({ ...f, rate: pct(f.count, n) }))
    .sort((a, b) => b.count - a.count);
  const scatter = screenings.filter((s) => s.age !== null).map((s) => ({ age: s.age!, risk: Math.round(s.risk * 100) / 100, sex: s.sex === '1' ? 'male' : s.sex === '2' ? 'female' : 'unknown' }));

  // ---------- 4. outcomes ----------
  const highHn = new Set(high.map((s) => s.hn));
  let bpControlled = 0;
  let bpMeasured = 0;
  let followed = 0;
  let dueForFollowUp = 0;
  let noAppointment = 0;
  let migration: { from: number; to: number; count: number }[] = [];
  const trend: { quarter: string; sbp: number | null; ldl: number | null }[] = [];

  if (high.length) {
    // latest BP of each high-risk patient up to the end of the period
    const bp = await db.query(`
      SELECT o.hn, o.vstdate, s.bps, s.bpd FROM opdscreen s JOIN ovst o ON o.vn = s.vn
      WHERE s.bps > 0 AND o.vstdate <= ${sqlDate(to)} AND o.hn IN (${highRiskHns(from, to)})`);
    const latest = new Map<string, { date: string; sbp: number; dbp: number | null }>();
    for (const r of bp) {
      const hn = String(r.hn);
      const date = String(r.vstdate).slice(0, 10);
      if (!latest.has(hn) || latest.get(hn)!.date < date) latest.set(hn, { date, sbp: num(r.bps)!, dbp: num(r.bpd) });
    }
    for (const v of latest.values()) {
      bpMeasured++;
      if (v.sbp < 140 && (v.dbp === null || v.dbp < 90)) bpControlled++;
    }

    // drop-out: the first appointment (oapp) after each high-risk screening, once its date has passed
    // by the grace period — kept when a visit is linked to it or falls within the grace window
    const today = todayLocal();
    const [appts, later] = await Promise.all([
      db.query(`
        SELECT a.hn, a.nextdate, a.visit_vn FROM oapp a
        WHERE a.hn IN (${highRiskHns(from, to)}) AND a.nextdate > ${sqlDate(from)}`),
      db.query(`
        SELECT o.hn, o.vstdate FROM ovst o
        WHERE o.hn IN (${highRiskHns(from, to)}) AND o.vstdate >= ${sqlDate(addDays(from, -APPOINTMENT_GRACE_DAYS))}`),
    ]);
    const visitsByHn = new Map<string, string[]>();
    for (const r of later) visitsByHn.set(String(r.hn), [...(visitsByHn.get(String(r.hn)) ?? []), String(r.vstdate).slice(0, 10)]);
    const apptsByHn = new Map<string, Appointment[]>();
    for (const r of appts) {
      apptsByHn.set(String(r.hn), [...(apptsByHn.get(String(r.hn)) ?? []), { date: String(r.nextdate).slice(0, 10), visitVn: r.visit_vn ? String(r.visit_vn) : null }]);
    }
    for (const s of high) {
      const next = (apptsByHn.get(s.hn) ?? []).filter((a) => a.date > s.date).sort((a, b) => a.date.localeCompare(b.date))[0];
      if (!next) {
        noAppointment++;
        continue;
      }
      if (!isJudgeable(next, today)) continue;
      dueForFollowUp++;
      if (appointmentKept(next, visitsByHn.get(s.hn) ?? [])) followed++;
    }
  }

  if (n) {
    // first vs latest screening of each patient screened in the period (all history up to the period end)
    const hist = await db.query(`
      SELECT o.hn, o.vstdate, c.cvd_risk_score_type_id AS type_id FROM opdscreen_cvd c JOIN ovst o ON o.vn = c.vn
      WHERE o.vstdate <= ${sqlDate(to)}
        AND o.hn IN (SELECT o2.hn FROM opdscreen_cvd c2 JOIN ovst o2 ON o2.vn=c2.vn WHERE o2.vstdate BETWEEN ${sqlDate(from)} AND ${sqlDate(to)})`);
    const perHn = new Map<string, { date: string; type: number }[]>();
    for (const r of hist) perHn.set(String(r.hn), [...(perHn.get(String(r.hn)) ?? []), { date: String(r.vstdate).slice(0, 10), type: num(r.type_id) ?? 0 }]);
    const flows = new Map<string, number>();
    for (const list of perHn.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => a.date.localeCompare(b.date));
      const key = `${list[0].type}>${list[list.length - 1].type}`;
      flows.set(key, (flows.get(key) ?? 0) + 1);
    }
    migration = [...flows.entries()].map(([k, count]) => {
      const [a, b] = k.split('>').map(Number);
      return { from: a, to: b, count };
    });

    // quarterly mean SBP (screening vitals) and LDL of patients ever screened, last 4 quarters to the period end
    const start = addDays(to, -365);
    const everScreened = `SELECT o2.hn FROM opdscreen_cvd c2 JOIN ovst o2 ON o2.vn=c2.vn WHERE o2.vstdate <= ${sqlDate(to)}`;
    const [sbpRows, ldlTrend] = await Promise.all([
      db.query(`SELECT o.vstdate AS d, s.bps AS v FROM opdscreen s JOIN ovst o ON o.vn=s.vn
                WHERE s.bps > 0 AND o.vstdate BETWEEN ${sqlDate(start)} AND ${sqlDate(to)} AND o.hn IN (${everScreened})`),
      db.query(`SELECT lh.order_date AS d, lo.lab_order_result AS v FROM lab_order lo
                JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
                JOIN lab_head lh ON lh.lab_order_number = lo.lab_order_number
                WHERE LOWER(li.lab_items_name) LIKE '%ldl%' AND lh.order_date BETWEEN ${sqlDate(start)} AND ${sqlDate(to)} AND lh.hn IN (${everScreened})`),
    ]);
    const buckets = new Map<string, { sbp: number[]; ldl: number[] }>();
    const bucket = (d: unknown) => {
      const q = quarterOf(String(d));
      if (!buckets.has(q)) buckets.set(q, { sbp: [], ldl: [] });
      return buckets.get(q)!;
    };
    for (const r of sbpRows) bucket(r.d).sbp.push(num(r.v)!);
    for (const r of ldlTrend) {
      const v = num(String(r.v).trim());
      if (v !== null && v > 0 && v < 1000) bucket(r.d).ldl.push(v);
    }
    for (const [quarter, b] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      trend.push({ quarter, sbp: mean(b.sbp), ldl: mean(b.ldl) });
    }
  }

  // lipid control: latest LDL of each high-risk patient up to the period end, below LDL_TARGET mg/dL
  let ldlControlled = 0;
  let ldlMeasured = 0;
  if (high.length) {
    const rows = await db.query(`
      SELECT lh.hn, lh.order_date AS d, lo.lab_order_result AS v FROM lab_order lo
      JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
      JOIN lab_head lh ON lh.lab_order_number = lo.lab_order_number
      WHERE LOWER(li.lab_items_name) LIKE '%ldl%' AND lh.order_date <= ${sqlDate(to)} AND lh.hn IN (${highRiskHns(from, to)})`);
    const latestLdl = new Map<string, { d: string; v: number }>();
    for (const r of rows) {
      const v = num(String(r.v).trim());
      if (v === null || v <= 0 || v >= 1000) continue;
      const d = String(r.d).slice(0, 10);
      const hn = String(r.hn);
      if (!latestLdl.has(hn) || latestLdl.get(hn)!.d < d) latestLdl.set(hn, { d, v });
    }
    for (const x of latestLdl.values()) {
      ldlMeasured++;
      if (x.v < LDL_TARGET) ldlControlled++;
    }
  }

  const improved = migration.filter((m) => m.to < m.from).reduce((a, m) => a + m.count, 0);
  const reassessed = migration.reduce((a, m) => a + m.count, 0);

  return {
    period: { from, to, prevFrom, prevTo },
    kpi: cur.kpi,
    prevKpi: prev.kpi,
    coverage: {
      target: COVERAGE_TARGET,
      eligible: cur.eligibleCount,
      covered: cur.coveredCount,
      visitors: people.size,
      byAge,
      byArea: coverageBy('tambon'),
      byUnit: coverageBy('department'),
      lab,
      nonLab: n - lab,
    },
    risk: { levels, highCount: high.length, areas: groupHigh('tambon'), amphoes: groupHigh('amphoe'), units: groupHigh('department') },
    factors: {
      screened: n,
      items: factors,
      means: { sbp: mean(screenings.map((s) => s.sbp).filter((v): v is number => v !== null)), tc: mean(screenings.map((s) => s.tc).filter((v): v is number => v !== null)), ldl: mean(ldl) },
      scatter,
    },
    outcomes: {
      highRisk: high.length,
      statin: { count: high.filter((s) => statinUsers.has(s.hn)).length, rate: cur.kpi.statin },
      bp: { controlled: bpControlled, measured: bpMeasured, rate: pct(bpControlled, bpMeasured) },
      ldl: { controlled: ldlControlled, measured: ldlMeasured, rate: pct(ldlControlled, ldlMeasured), target: LDL_TARGET },
      migration: { flows: migration, improved, reassessed, rate: pct(improved, reassessed) },
      dropout: {
        lost: dueForFollowUp - followed,
        due: dueForFollowUp,
        rate: pct(dueForFollowUp - followed, dueForFollowUp),
        graceDays: APPOINTMENT_GRACE_DAYS,
        noAppointment,
      },
      trend,
      highRiskHn: highHn.size,
    },
  };
}

export type Report = Awaited<ReturnType<typeof buildReport>>;
