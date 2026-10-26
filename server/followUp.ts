/**
 * Follow-up worklists: patients with a saved Thai CV Risk result (opdscreen_cvd) who need action now.
 * Unlike the report these rows identify patients (name, phone, address), so the endpoint is for
 * signed-in users of this PC only. Rules are in src/lib/appointments.ts and shown on the page.
 *
 *  - noStatin    latest risk ≥ 20% and no statin dispensed in the last STATIN_LOOKBACK_DAYS
 *  - rescreen    latest assessment RESCREEN_DAYS or more ago
 *  - uncontrolled latest BP ≥ 140/90, or (risk ≥ 20%) latest LDL ≥ 100, within CONTROL_LOOKBACK_DAYS
 *  - missed      risk ≥ 20%, missed the latest appointment and has not come back since
 * Deceased patients are left out.
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
} from '../src/lib/appointments';
import { safeText, sqlDate, win874Join } from '../src/lib/hosxp/sql';
import { todayLocal } from '../src/lib/hosxp/patients';
import type { Db } from './db';
import { TAMBON_JOIN } from './report';

export type FollowUpListId = 'noStatin' | 'rescreen' | 'uncontrolled' | 'missed';

export interface FollowUpRow {
  hn: string;
  name: string;
  sex: string;
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
  lastVisit: string;
  /** why the patient is on this list, e.g. "BP 152/94 (12/09/2569)" */
  reason: string;
  /** for sorting: days overdue, or the measured value */
  sortValue: number;
}

const num = (v: unknown) => {
  const n = Number(String(v ?? '').trim());
  return v === null || v === undefined || String(v).trim() === '' || !Number.isFinite(n) ? null : n;
};
const thai = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${Number(y) + 543}`;
};
function ageOn(birthday: unknown, today: string): number | null {
  const b = isoDay(birthday);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  let age = Number(today.slice(0, 4)) - Number(b.slice(0, 4));
  if (today.slice(5) < b.slice(5)) age--;
  return age >= 0 && age < 130 ? age : null;
}

export async function buildFollowUp(db: Db, today = todayLocal()) {
  const d = db.dialect;
  const screenedHns = 'SELECT o2.hn FROM opdscreen_cvd c2 JOIN ovst o2 ON o2.vn = c2.vn';
  const since = (days: number) => sqlDate(addDays(today, -days));

  const [screenRows, people, visits, statin, bp, ldl, appts] = await Promise.all([
    db.query(`
      SELECT c.vn, o.hn, o.vstdate, c.risk_score, c.cvd_risk_score_type_id AS level, ct.cvd_risk_score_type_name AS level_name
      FROM opdscreen_cvd c JOIN ovst o ON o.vn = c.vn
      left outer join cvd_risk_score_type ct on ct.cvd_risk_score_type_id = c.cvd_risk_score_type_id`),
    db.query(`
      SELECT p.hn, ${safeText(d, "concat(p.pname,p.fname,'  ',p.lname)")} AS ptname, p.sex, p.birthday, p.death, p.deathday,
             ${safeText(d, 'p.mobile_phone_number')} AS mobile, ${safeText(d, 'p.hometel')} AS hometel,
             p.moopart, ${safeText(d, 'ta.name')} AS tambon, ${safeText(d, 'tamp.name')} AS amphoe
      FROM patient p
      ${win874Join(d)}
      ${TAMBON_JOIN}
      WHERE p.hn IN (${screenedHns})`),
    db.query(`
      SELECT o.hn, o.vn, o.vstdate, o.vsttime, ${safeText(d, 'k.department')} AS department, ${safeText(d, 'pt.name')} AS pttype
      FROM ovst o
      ${win874Join(d)}
      left outer join kskdepartment k on k.depcode = o.main_dep
      left outer join pttype pt on pt.pttype = o.pttype
      WHERE o.hn IN (${screenedHns}) AND o.vstdate >= ${since(730)}`),
    db.query(`
      SELECT DISTINCT o.hn FROM opitemrece o JOIN drugitems di ON di.icode = o.icode
      WHERE LOWER(di.name) LIKE '%statin%' AND o.vstdate >= ${since(STATIN_LOOKBACK_DAYS)} AND o.hn IN (${screenedHns})`),
    db.query(`
      SELECT o.hn, o.vstdate, s.bps, s.bpd FROM opdscreen s JOIN ovst o ON o.vn = s.vn
      WHERE s.bps > 0 AND o.vstdate >= ${since(CONTROL_LOOKBACK_DAYS)} AND o.hn IN (${screenedHns})`),
    db.query(`
      SELECT lh.hn, lh.order_date AS d, lo.lab_order_result AS v FROM lab_order lo
      JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
      JOIN lab_head lh ON lh.lab_order_number = lo.lab_order_number
      WHERE LOWER(li.lab_items_name) LIKE '%ldl%' AND lh.order_date >= ${since(CONTROL_LOOKBACK_DAYS)} AND lh.hn IN (${screenedHns})`),
    db.query(`
      SELECT a.hn, a.nextdate, a.visit_vn, ${safeText(d, 'cl.name')} AS clinic
      FROM oapp a
      ${win874Join(d)}
      left outer join clinic cl on cl.clinic = a.clinic
      WHERE a.hn IN (${screenedHns}) AND a.nextdate BETWEEN ${since(365)} AND ${sqlDate(today)}`),
  ]);

  // latest assessment per patient
  const latest = new Map<string, { vn: string; date: string; risk: number; level: number; levelName: string }>();
  for (const r of screenRows) {
    const hn = String(r.hn);
    const date = isoDay(r.vstdate);
    if ((latest.get(hn)?.date ?? '') > date) continue;
    latest.set(hn, { vn: String(r.vn), date, risk: num(r.risk_score) ?? 0, level: num(r.level) ?? 0, levelName: String(r.level_name ?? '').trim() });
  }

  const visitsByHn = new Map<string, { vn: string; date: string; vsttime: string; department: string; pttype: string }[]>();
  for (const v of visits) {
    const hn = String(v.hn);
    const list = visitsByHn.get(hn) ?? [];
    list.push({ vn: String(v.vn), date: isoDay(v.vstdate), vsttime: String(v.vsttime ?? ''), department: String(v.department ?? ''), pttype: String(v.pttype ?? '') });
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

  const lists: Record<FollowUpListId, FollowUpRow[]> = { noStatin: [], rescreen: [], uncontrolled: [], missed: [] };
  for (const p of people) {
    if (String(p.death ?? '').toUpperCase() === 'Y' || isoDay(p.deathday)) continue;
    const hn = String(p.hn);
    const s = latest.get(hn);
    if (!s) continue;
    const pv = (visitsByHn.get(hn) ?? []).sort((a, b) => (a.date + a.vsttime).localeCompare(b.date + b.vsttime));
    const todayVisit = [...pv].reverse().find((v) => v.date === today);
    const address = [p.moopart && String(p.moopart).trim() !== '0' ? `ม.${String(p.moopart).trim()}` : '', String(p.tambon ?? '').trim(), String(p.amphoe ?? '').trim()]
      .filter(Boolean)
      .join(' ');
    const base = {
      hn,
      name: String(p.ptname ?? '').trim(),
      sex: String(p.sex ?? ''),
      age: ageOn(p.birthday, today),
      phone: [p.mobile, p.hometel].map((x) => String(x ?? '').trim()).filter((x) => x && x !== '-').join(', '),
      address,
      screenVn: s.vn,
      screenDate: s.date,
      risk: s.risk,
      level: s.level,
      levelName: s.levelName,
      today: todayVisit ? { vn: todayVisit.vn, vsttime: todayVisit.vsttime, department: todayVisit.department, pttype: todayVisit.pttype } : null,
      lastVisit: pv.length ? pv[pv.length - 1].date : s.date,
    };
    const high = s.risk >= HIGH_RISK;

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
    lists,
  };
}

export type FollowUp = Awaited<ReturnType<typeof buildFollowUp>>;
