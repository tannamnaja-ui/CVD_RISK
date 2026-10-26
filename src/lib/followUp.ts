/**
 * Follow-up worklists: patients with a saved Thai CV Risk result (opdscreen_cvd) who need action now.
 * Runs on the data server (direct database) and in the browser through the BMS API (opened from HOSxP XE),
 * so every query here is plain SQL with validated values only.
 *
 * buildFollowUp reads no protected personal fields; names, phone numbers, addresses and death status come
 * from followUpContactsSql, which the BMS API runs only after approval in HOSxP (applied with withContacts).
 *
 *  - assessed     everyone with a saved result — status "ประเมินแล้ว", newest first
 *  - noStatin     latest risk ≥ 20% and no statin dispensed in the last STATIN_LOOKBACK_DAYS
 *  - rescreen     latest assessment RESCREEN_DAYS or more ago
 *  - uncontrolled latest BP ≥ 140/90, or (risk ≥ 20%) latest LDL ≥ 100, within CONTROL_LOOKBACK_DAYS
 *  - missed       risk ≥ 20%, missed the latest appointment and has not come back since
 */
import {
  BP_TARGET,
  CONTROL_LOOKBACK_DAYS,
  HIGH_RISK,
  LDL_TARGET,
  RESCREEN_DAYS,
  STATIN_LOOKBACK_DAYS,
  addDays,
  daysBetween,
  isoDay,
  missedAppointment,
  type Appointment,
} from './appointments';
import { todayLocal } from './hosxp/patients';
import { TAMBON_JOIN, safeText, sqlDate, win874Join, type Dialect } from './hosxp/sql';

/** What buildFollowUp needs from a database connection (the data server's Db, or the BMS API). */
export interface QueryRunner {
  dialect: Dialect;
  query: (sql: string) => Promise<Record<string, unknown>[]>;
}

/** 'assessed': everyone with a saved result (status "ประเมินแล้ว"); the others need action */
export type FollowUpListId = 'assessed' | 'noStatin' | 'rescreen' | 'uncontrolled' | 'missed';

export interface FollowUpRow {
  hn: string;
  /** '' until the contacts are loaded */
  name: string;
  sex: string;
  /** at the latest visit */
  age: number | null;
  phone: string;
  address: string;
  /** latest saved assessment */
  screenVn: string;
  screenDate: string;
  risk: number;
  level: number;
  levelName: string;
  /** the patient's visit today, if any — an assessment can be opened for it */
  today: { vn: string; vsttime: string; department: string; pttype: string } | null;
  /** the latest assessment belongs to today's visit */
  assessedToday: boolean;
  lastVisit: string;
  /** why the patient is on this list, e.g. "BP 152/94 (12/09/2569)" */
  reason: string;
  /** for sorting: days overdue, or the measured value */
  sortValue: number;
}

export interface FollowUp {
  asOf: string;
  rules: {
    HIGH_RISK: number;
    RESCREEN_DAYS: number;
    STATIN_LOOKBACK_DAYS: number;
    CONTROL_LOOKBACK_DAYS: number;
    BP_TARGET: typeof BP_TARGET;
    LDL_TARGET: number;
  };
  screenedPatients: number;
  /** names / phones / addresses filled in, deceased patients removed */
  contactsLoaded: boolean;
  lists: Record<FollowUpListId, FollowUpRow[]>;
}

const num = (v: unknown) => {
  const n = Number(String(v ?? '').trim());
  return v === null || v === undefined || String(v).trim() === '' || !Number.isFinite(n) ? null : n;
};
const thai = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${Number(y) + 543}`;
};
const SCREENED_HNS = 'SELECT o2.hn FROM opdscreen_cvd c2 JOIN ovst o2 ON o2.vn = c2.vn';

/** Names, phone numbers, addresses and death status of every screened patient (protected fields). */
export function followUpContactsSql(d: Dialect): string {
  return `
    SELECT p.hn, ${safeText(d, "concat(p.pname,p.fname,'  ',p.lname)")} AS ptname, p.death, p.deathday,
           ${safeText(d, 'p.mobile_phone_number')} AS mobile, ${safeText(d, 'p.hometel')} AS hometel,
           p.moopart, ${safeText(d, 'ta.name')} AS tambon, ${safeText(d, 'tamp.name')} AS amphoe
    FROM patient p
    ${win874Join(d)}
    ${TAMBON_JOIN}
    WHERE p.hn IN (${SCREENED_HNS})`;
}

/** Fill in names / phones / addresses and drop deceased patients. */
export function withContacts(f: FollowUp, rows: Record<string, unknown>[]): FollowUp {
  const byHn = new Map(rows.map((r) => [String(r.hn), r]));
  const deceased = (p: Record<string, unknown> | undefined) => !!p && (String(p.death ?? '').toUpperCase() === 'Y' || !!isoDay(p.deathday));
  const fill = (row: FollowUpRow): FollowUpRow => {
    const p = byHn.get(row.hn);
    if (!p) return row;
    const moo = String(p.moopart ?? '').trim();
    return {
      ...row,
      name: String(p.ptname ?? '').trim(),
      phone: [p.mobile, p.hometel].map((x) => String(x ?? '').trim()).filter((x) => x && x !== '-').join(', '),
      address: [moo && moo !== '0' ? `ม.${moo}` : '', String(p.tambon ?? '').trim(), String(p.amphoe ?? '').trim()].filter(Boolean).join(' '),
    };
  };
  const lists = Object.fromEntries(
    Object.entries(f.lists).map(([id, list]) => [id, list.filter((r) => !deceased(byHn.get(r.hn))).map(fill)]),
  ) as FollowUp['lists'];
  return { ...f, contactsLoaded: true, lists };
}

export async function buildFollowUp(db: QueryRunner, today = todayLocal()): Promise<FollowUp> {
  const d = db.dialect;
  const since = (days: number) => sqlDate(addDays(today, -days));

  const [screenRows, visits, statin, bp, ldl, appts] = await Promise.all([
    db.query(`
      SELECT c.vn, o.hn, o.vstdate, c.risk_score, c.cvd_risk_score_type_id AS level, ct.cvd_risk_score_type_name AS level_name, p.sex, v.age_y
      FROM opdscreen_cvd c JOIN ovst o ON o.vn = c.vn
      left outer join patient p on p.hn = o.hn
      left outer join vn_stat v on v.vn = o.vn
      left outer join cvd_risk_score_type ct on ct.cvd_risk_score_type_id = c.cvd_risk_score_type_id`),
    db.query(`
      SELECT o.hn, o.vn, o.vstdate, o.vsttime, v.age_y, ${safeText(d, 'k.department')} AS department, ${safeText(d, 'pt.name')} AS pttype
      FROM ovst o
      ${win874Join(d)}
      left outer join vn_stat v on v.vn = o.vn
      left outer join kskdepartment k on k.depcode = o.main_dep
      left outer join pttype pt on pt.pttype = o.pttype
      WHERE o.hn IN (${SCREENED_HNS}) AND o.vstdate >= ${since(730)}`),
    db.query(`
      SELECT DISTINCT o.hn FROM opitemrece o JOIN drugitems di ON di.icode = o.icode
      WHERE LOWER(di.name) LIKE '%statin%' AND o.vstdate >= ${since(STATIN_LOOKBACK_DAYS)} AND o.hn IN (${SCREENED_HNS})`),
    db.query(`
      SELECT o.hn, o.vstdate, s.bps, s.bpd FROM opdscreen s JOIN ovst o ON o.vn = s.vn
      WHERE s.bps > 0 AND o.vstdate >= ${since(CONTROL_LOOKBACK_DAYS)} AND o.hn IN (${SCREENED_HNS})`),
    db.query(`
      SELECT lh.hn, lh.order_date AS d, lo.lab_order_result AS v FROM lab_order lo
      JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
      JOIN lab_head lh ON lh.lab_order_number = lo.lab_order_number
      WHERE LOWER(li.lab_items_name) LIKE '%ldl%' AND lh.order_date >= ${since(CONTROL_LOOKBACK_DAYS)} AND lh.hn IN (${SCREENED_HNS})`),
    db.query(`
      SELECT a.hn, a.nextdate, a.visit_vn, ${safeText(d, 'cl.name')} AS clinic
      FROM oapp a
      ${win874Join(d)}
      left outer join clinic cl on cl.clinic = a.clinic
      WHERE a.hn IN (${SCREENED_HNS}) AND a.nextdate BETWEEN ${since(365)} AND ${sqlDate(today)}`),
  ]);

  // latest assessment per patient
  const latest = new Map<string, { vn: string; date: string; risk: number; level: number; levelName: string; sex: string; age: number | null }>();
  for (const r of screenRows) {
    const hn = String(r.hn);
    const date = isoDay(r.vstdate);
    if ((latest.get(hn)?.date ?? '') > date) continue;
    latest.set(hn, {
      vn: String(r.vn),
      date,
      risk: num(r.risk_score) ?? 0,
      level: num(r.level) ?? 0,
      levelName: String(r.level_name ?? '').trim(),
      sex: String(r.sex ?? ''),
      age: num(r.age_y),
    });
  }

  const visitsByHn = new Map<string, { vn: string; date: string; vsttime: string; age: number | null; department: string; pttype: string }[]>();
  for (const v of visits) {
    const hn = String(v.hn);
    const list = visitsByHn.get(hn) ?? [];
    list.push({ vn: String(v.vn), date: isoDay(v.vstdate), vsttime: String(v.vsttime ?? ''), age: num(v.age_y), department: String(v.department ?? ''), pttype: String(v.pttype ?? '') });
    visitsByHn.set(hn, list);
  }

  const latestBy = <T extends { date: string }>(rows: { hn: string; item: T }[]) => {
    const m = new Map<string, T>();
    for (const { hn, item } of rows) if ((m.get(hn)?.date ?? '') < item.date) m.set(hn, item);
    return m;
  };
  const latestBp = latestBy(bp.map((r) => ({ hn: String(r.hn), item: { date: isoDay(r.vstdate), sbp: num(r.bps)!, dbp: num(r.bpd) } })));
  const latestLdl = latestBy(
    ldl
      .map((r) => ({ hn: String(r.hn), item: { date: isoDay(r.d), value: num(r.v) } }))
      .filter((x): x is { hn: string; item: { date: string; value: number } } => x.item.value !== null && x.item.value > 0 && x.item.value < 1000),
  );
  const statinHns = new Set(statin.map((r) => String(r.hn)));
  const apptsByHn = new Map<string, Appointment[]>();
  for (const a of appts) {
    const hn = String(a.hn);
    apptsByHn.set(hn, [...(apptsByHn.get(hn) ?? []), { date: isoDay(a.nextdate), visitVn: a.visit_vn ? String(a.visit_vn) : null, clinic: String(a.clinic ?? '').trim() }]);
  }

  const lists: FollowUp['lists'] = { assessed: [], noStatin: [], rescreen: [], uncontrolled: [], missed: [] };
  for (const [hn, s] of latest) {
    const pv = (visitsByHn.get(hn) ?? []).sort((a, b) => (a.date + a.vsttime).localeCompare(b.date + b.vsttime));
    const last = pv[pv.length - 1];
    const todayVisit = [...pv].reverse().find((v) => v.date === today);
    const base = {
      hn,
      name: '',
      sex: s.sex,
      age: last?.age ?? s.age,
      phone: '',
      address: '',
      screenVn: s.vn,
      screenDate: s.date,
      risk: s.risk,
      level: s.level,
      levelName: s.levelName,
      today: todayVisit ? { vn: todayVisit.vn, vsttime: todayVisit.vsttime, department: todayVisit.department, pttype: todayVisit.pttype } : null,
      assessedToday: s.date === today,
      lastVisit: last ? last.date : s.date,
    };
    const high = s.risk >= HIGH_RISK;

    // newest assessments first
    lists.assessed.push({ ...base, reason: `ประเมินแล้ว ${thai(s.date)}`, sortValue: -daysBetween(s.date, today) });

    if (high && !statinHns.has(hn)) {
      lists.noStatin.push({ ...base, reason: `เสี่ยง ${s.risk.toFixed(1)}% ยังไม่มีการจ่ายยากลุ่ม statin ใน ${STATIN_LOOKBACK_DAYS} วัน`, sortValue: s.risk });
    }

    const age = daysBetween(s.date, today);
    if (age >= RESCREEN_DAYS) {
      lists.rescreen.push({ ...base, reason: `ประเมินล่าสุด ${thai(s.date)} — ผ่านมา ${age} วัน`, sortValue: age });
    }

    const reasons: string[] = [];
    let worst = 0;
    const b = latestBp.get(hn);
    if (b && (b.sbp >= BP_TARGET.sbp || (b.dbp ?? 0) >= BP_TARGET.dbp)) {
      reasons.push(`BP ${b.sbp}/${b.dbp ?? '–'} (${thai(b.date)})`);
      worst = Math.max(worst, b.sbp);
    }
    const l = latestLdl.get(hn);
    if (high && l && l.value >= LDL_TARGET) {
      reasons.push(`LDL ${l.value} (${thai(l.date)})`);
      worst = Math.max(worst, l.value);
    }
    if (reasons.length) lists.uncontrolled.push({ ...base, reason: reasons.join(' · '), sortValue: worst });

    if (high) {
      const missed = missedAppointment(apptsByHn.get(hn) ?? [], pv.map((v) => v.date), today);
      if (missed) {
        const late = daysBetween(missed.date, today);
        lists.missed.push({ ...base, reason: `นัด ${thai(missed.date)}${missed.clinic ? ` ${missed.clinic}` : ''} — เลยนัด ${late} วัน`, sortValue: late });
      }
    }
  }
  for (const list of Object.values(lists)) list.sort((a, b) => b.sortValue - a.sortValue);

  return {
    asOf: today,
    rules: { HIGH_RISK, RESCREEN_DAYS, STATIN_LOOKBACK_DAYS, CONTROL_LOOKBACK_DAYS, BP_TARGET, LDL_TARGET },
    screenedPatients: latest.size,
    contactsLoaded: false,
    lists,
  };
}
