import { useCallback, useEffect, useMemo, useState } from 'react';
import { PrivacyBlockedError, useHosxp } from '../../hooks/useHosxp';
import { navigate } from '../../hooks/useHashRoute';
import { exportSheet } from '../../lib/excel';
import type { FollowUp, FollowUpListId, FollowUpRow } from '../../lib/followUp';
import {
  APPOINTMENT_GRACE_DAYS,
  BP_TARGET,
  CONTROL_LOOKBACK_DAYS,
  HIGH_RISK,
  LDL_TARGET,
  RESCREEN_DAYS,
  STATIN_LOOKBACK_DAYS,
} from '../../lib/appointments';
import { CVD_LEVEL_COLORS, type PatientRow } from '../../lib/hosxp/patients';
import { thaiDate } from '../../lib/hosxp/vitals';
import { AlertTriangleIcon, CheckIcon, EraserIcon, FilterIcon, InfoIcon, KeyIcon, ResetIcon, SheetIcon } from '../Icons';
import { Modal } from '../Modal';
import { CvdHistory } from './CvdHistory';
import { SELECTED_PATIENT_KEY } from './PatientListPage';

const TABS: { id: FollowUpListId; label: string; reason: string; rule: (r: FollowUp['rules']) => string }[] = [
  {
    id: 'assessed',
    label: 'ประเมินแล้วทั้งหมด',
    reason: 'สถานะ',
    rule: () => 'ทุกคนที่มีผล Thai CV Risk บันทึกไว้ (opdscreen_cvd) — แสดงผลครั้งล่าสุด เรียงจากประเมินล่าสุด',
  },
  {
    id: 'noStatin',
    label: 'เสี่ยงสูง ยังไม่ได้ statin',
    reason: 'เหตุผล',
    rule: (r) => `ผลล่าสุด ≥ ${r.HIGH_RISK}% และไม่มีการจ่ายยาที่ชื่อมีคำว่า "statin" ใน ${r.STATIN_LOOKBACK_DAYS} วันที่ผ่านมา`,
  },
  {
    id: 'rescreen',
    label: 'ครบ 1 ปี ยังไม่ประเมินซ้ำ',
    reason: 'ประเมินล่าสุด',
    rule: (r) => `ประเมิน Thai CV Risk ครั้งล่าสุดผ่านมาแล้ว ${r.RESCREEN_DAYS} วันขึ้นไป`,
  },
  {
    id: 'uncontrolled',
    label: 'ความดัน / LDL ยังคุมไม่ได้',
    reason: 'ค่าล่าสุด',
    rule: (r) =>
      `ความดันครั้งล่าสุดใน ${r.CONTROL_LOOKBACK_DAYS} วัน ≥ ${r.BP_TARGET.sbp}/${r.BP_TARGET.dbp} mmHg หรือ (ผลประเมิน ≥ ${r.HIGH_RISK}%) LDL ล่าสุด ≥ ${r.LDL_TARGET} mg/dL`,
  },
  {
    id: 'missed',
    label: 'ขาดนัด (เสี่ยงสูง)',
    reason: 'นัดที่ขาด',
    rule: (r) => `ผลล่าสุด ≥ ${r.HIGH_RISK}% นัดครั้งล่าสุด (oapp) เลยวันนัดเกิน 7 วันโดยไม่มีการมารับบริการ ±7 วัน และยังไม่กลับมาอีก`,
  },
];

const sexLabel = (s: string) => (s === '1' ? 'ชาย' : s === '2' ? 'หญิง' : '–');

/** What each worklist checks, and where in HOSxP the data comes from (shown by its "เงื่อนไข" button). */
const CONDITIONS: Record<FollowUpListId, { criteria: string[]; data: string[]; notes?: string[] }> = {
  assessed: {
    criteria: ['ผู้ป่วยที่มีผล Thai CV Risk บันทึกไว้อย่างน้อย 1 ครั้ง', 'แสดงผลครั้งล่าสุดของแต่ละคน เรียงจากคนที่ประเมินล่าสุด'],
    data: ['opdscreen_cvd — ผลการประเมิน (risk_score) และระดับ (cvd_risk_score_type_id)', 'ovst — วันที่มารับบริการของ visit ที่บันทึก'],
  },
  noStatin: {
    criteria: [`ผลประเมินครั้งล่าสุด ≥ ${HIGH_RISK}% (ระดับ 3–5: สูง, สูงมาก, อันตราย)`, `และไม่มีการจ่ายยากลุ่ม statin ภายใน ${STATIN_LOOKBACK_DAYS} วันที่ผ่านมา`],
    data: ['opdscreen_cvd — ผลประเมินล่าสุด', 'opitemrece + drugitems — รายการยาที่จ่าย โดยดูชื่อยาที่มีคำว่า "statin"'],
    notes: ['ยาที่ชื่อไม่มีคำว่า statin (เช่น ใช้ชื่อการค้าอย่างเดียว) จะไม่ถูกนับ — ควรตั้งชื่อยาใน drugitems ให้มีชื่อสามัญ'],
  },
  rescreen: {
    criteria: [`ประเมิน Thai CV Risk ครั้งล่าสุดผ่านมาแล้ว ${RESCREEN_DAYS} วันขึ้นไป (ครบ 1 ปี) และยังไม่ได้ประเมินซ้ำ`],
    data: ['opdscreen_cvd + ovst — วันที่มารับบริการของ visit ที่ประเมินครั้งล่าสุด'],
  },
  uncontrolled: {
    criteria: [
      `ความดันครั้งล่าสุดภายใน ${CONTROL_LOOKBACK_DAYS} วัน: ตัวบน ≥ ${BP_TARGET.sbp} หรือ ตัวล่าง ≥ ${BP_TARGET.dbp} mmHg`,
      `หรือ ผลประเมินล่าสุด ≥ ${HIGH_RISK}% และ LDL ครั้งล่าสุดภายใน ${CONTROL_LOOKBACK_DAYS} วัน ≥ ${LDL_TARGET} mg/dL`,
    ],
    data: ['opdscreen — ความดัน (bps / bpd) จากการซักประวัติ', 'lab_head + lab_order + lab_items — ผลแล็บที่ชื่อรายการมีคำว่า "LDL"'],
  },
  missed: {
    criteria: [
      `ผลประเมินล่าสุด ≥ ${HIGH_RISK}% (กลุ่มเสี่ยงสูง)`,
      `นัดครั้งล่าสุดในตารางนัด (ภายใน 365 วัน) เลยวันนัดมาแล้วเกิน ${APPOINTMENT_GRACE_DAYS} วัน`,
      `ไม่ได้มาตามนัด: HOSxP ไม่ได้ผูก visit กับนัดนั้น และไม่มีการมารับบริการในช่วง ±${APPOINTMENT_GRACE_DAYS} วันของวันนัด`,
      'และยังไม่ได้กลับมารับบริการอีกหลังวันนัด',
    ],
    data: ['oapp — วันนัด (nextdate), คลินิก และ visit ที่ผูกกับนัด (visit_vn)', 'ovst — วันที่มารับบริการ'],
  },
};

/**
 * Worklists of screened patients who need action. Direct mode: names straight away.
 * Opened from HOSxP XE (BMS API): the lists first, names / phones / addresses after approval in HOSxP.
 */
export function FollowUpPage() {
  const { mode, followUp, followUpContacts } = useHosxp();
  const [data, setData] = useState<FollowUp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FollowUpListId>('assessed');
  const [search, setSearch] = useState('');
  const [historyOf, setHistoryOf] = useState<FollowUpRow | null>(null);
  /** the list whose "เงื่อนไข" dialog is open */
  const [conditionsOf, setConditionsOf] = useState<FollowUpListId | null>(null);
  /** BMS mode: contacts query blocked by the API privacy protection, waiting for approval in HOSxP */
  const [approval, setApproval] = useState<{ requestId: string; sql: string; notYet?: boolean } | null>(null);
  const [contactsLoading, setContactsLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setApproval(null);
    try {
      setData(await followUp());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [followUp]);

  useEffect(() => {
    void load();
  }, [load]);

  /** BMS mode: names / phones / addresses — the API releases them after the request is approved in HOSxP. */
  async function loadContacts(retry?: { sql: string; requestId: string }) {
    if (!data) return;
    setContactsLoading(true);
    try {
      setData(await followUpContacts(data, retry));
      setApproval(null);
    } catch (e) {
      if (e instanceof PrivacyBlockedError) setApproval({ requestId: e.requestId, sql: e.sql, notYet: !!retry });
      else setError((e as Error).message);
    } finally {
      setContactsLoading(false);
    }
  }

  const rows = useMemo(() => {
    const list = data?.lists[tab] ?? [];
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return list;
    return list.filter((r) => words.every((w) => `${r.name} ${r.hn} ${r.address}`.toLowerCase().includes(w)));
  }, [data, tab, search]);

  const current = TABS.find((t) => t.id === tab)!;
  const hidden = mode === 'bms' && !data?.contactsLoaded;
  const masked = (v: string) => v || (hidden ? <span className="no-dx">ซ่อนอยู่</span> : <span className="muted">–</span>);

  /** Open the assessment for the patient's visit today (assessments are saved per visit). */
  function assessToday(r: FollowUpRow) {
    if (!r.today) return;
    const p: PatientRow = {
      vn: r.today.vn,
      hn: r.hn,
      ptname: r.name,
      age: r.age !== null ? `${r.age} ปี` : '',
      age_y: r.age ?? undefined,
      sex: r.sex,
      vstdate: data?.asOf,
      vsttime: r.today.vsttime,
      department: r.today.department,
      pttype: r.today.pttype,
    };
    sessionStorage.setItem(SELECTED_PATIENT_KEY, JSON.stringify(p));
    navigate('/assess', { vn: r.today.vn });
  }

  async function exportExcel() {
    if (!rows.length) {
      alert('ไม่มีข้อมูลสำหรับส่งออก');
      return;
    }
    const headers = ['HN', 'ชื่อ - สกุล', 'อายุ', 'เพศ', 'โทรศัพท์', 'ที่อยู่', 'ผลล่าสุด', 'ความเสี่ยง (%)', 'วันที่ประเมินล่าสุด', current.reason, 'มารับบริการล่าสุด'];
    const out = rows.map((r) => [
      r.hn,
      r.name,
      r.age ?? '',
      sexLabel(r.sex),
      r.phone,
      r.address,
      r.levelName,
      Math.round(r.risk * 100) / 100,
      thaiDate(r.screenDate),
      r.reason,
      thaiDate(r.lastVisit),
    ]);
    await exportSheet(headers, out, current.label, `follow-up_${tab}_${data?.asOf ?? ''}.xlsx`);
  }

  return (
    <div className="plist">
      <section className="plist__card">
        <div className="plist__toolbar">
          <div className="followup-tabs" role="tablist" aria-label="รายชื่อที่ต้องติดตาม">
            {TABS.map((t) => (
              // the tab and its "เงื่อนไข" button are siblings — a button may not contain another button
              <span key={t.id} className={`followup-tab-wrap${t.id === tab ? ' is-active' : ''}`}>
                <button type="button" role="tab" aria-selected={t.id === tab} className={`followup-tab${t.id === tab ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
                  {t.label}
                  <span className="followup-tab__count">{data ? data.lists[t.id].length : '…'}</span>
                </button>
                <button type="button" className="followup-tab__info" onClick={() => setConditionsOf(t.id)} title={`ดูเงื่อนไขของรายการ "${t.label}"`}>
                  <InfoIcon size={14} /> เงื่อนไข
                </button>
              </span>
            ))}
          </div>
          <div className="plist__row">
            <label className="pinput-group">
              <FilterIcon size={16} />
              <input type="search" value={search} aria-label="ค้นหาชื่อ, HN หรือที่อยู่" placeholder="ค้นหาชื่อ, HN, ที่อยู่" onChange={(e) => setSearch(e.target.value)} />
            </label>
            <button type="button" className="pbtn pbtn--ghost" onClick={() => setSearch('')} title="ล้างคำค้น">
              <EraserIcon size={16} /> ล้าง
            </button>
            <span className="tb-sep" />
            <button type="button" className="pbtn pbtn--ghost" onClick={load} disabled={loading}>
              <ResetIcon size={16} /> โหลดใหม่
            </button>
            {mode === 'bms' && (
              <button
                type="button"
                className="pbtn pbtn--ghost"
                onClick={() => loadContacts()}
                disabled={!data || data.contactsLoaded || contactsLoading}
                title="ชื่อ เบอร์โทร ที่อยู่ เป็นข้อมูลที่ต้องอนุมัติในโปรแกรม HOSxP ก่อนแสดง"
              >
                <KeyIcon size={16} /> {data?.contactsLoaded ? 'แสดงชื่อแล้ว' : contactsLoading ? 'กำลังขอข้อมูล...' : 'แสดงชื่อ/เบอร์โทร'}
              </button>
            )}
            <button type="button" className="pbtn pbtn--green" onClick={exportExcel}>
              <SheetIcon size={16} /> ส่งออก Excel
            </button>
            <span className="plist__count">
              {rows.length} คน{data ? ` · จากผู้ที่เคยประเมิน ${data.screenedPatients} คน · ข้อมูล ณ ${thaiDate(data.asOf)}` : ''}
            </span>
          </div>
          {data && (
            <p className="followup-rule">
              <InfoIcon size={16} />{' '}
              <span>
                เกณฑ์: {current.rule(data.rules)} · {data.contactsLoaded ? 'ไม่รวมผู้เสียชีวิต' : 'ยังไม่ได้ตัดผู้เสียชีวิตออก (ต้องแสดงชื่อก่อน)'} · กดที่แถวเพื่อดูประวัติผลการประเมิน
              </span>
            </p>
          )}
        </div>

        {error && (
          <div className="privacy-banner">
            <AlertTriangleIcon size={18} /> <span>{error}</span>
          </div>
        )}
        {approval && (
          <div className="privacy-banner">
            <KeyIcon size={18} />
            <span>
              ชื่อ เบอร์โทร และที่อยู่ เป็นข้อมูลส่วนบุคคลที่ต้องอนุมัติ — อนุมัติคำขอ <code>{approval.requestId}</code> ในโปรแกรม HOSxP แล้วกดปุ่มนี้
              {approval.notYet && <b className="privacy-banner__warn"> (ยังไม่ได้รับการอนุมัติหรือหมดอายุ)</b>}
            </span>
            <button type="button" className="pbtn pbtn--primary" onClick={() => loadContacts({ sql: approval.sql, requestId: approval.requestId })} disabled={contactsLoading}>
              อนุมัติแล้ว — แสดงชื่อ
            </button>
            <button type="button" className="pbtn pbtn--ghost" onClick={() => setApproval(null)}>
              ปิด
            </button>
          </div>
        )}

        <div className="plist__table-wrap">
          <table className="ptable">
            <thead>
              <tr>
                <th>#</th>
                <th>ผลล่าสุด</th>
                <th>HN</th>
                <th>ชื่อ - สกุล</th>
                <th>อายุ</th>
                <th>เพศ</th>
                <th>โทรศัพท์</th>
                <th>ที่อยู่</th>
                <th>{current.reason}</th>
                <th>มาล่าสุด</th>
                <th>วันนี้</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                <tr>
                  <td colSpan={11} className="ptable__empty">
                    <span className="spinner" /> กำลังโหลด...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="ptable__empty">
                    {data && data.screenedPatients === 0 ? 'ยังไม่มีผลการประเมินที่บันทึกไว้ (opdscreen_cvd) — รายชื่อจะขึ้นเมื่อเริ่มบันทึกผล' : 'ไม่มีผู้ป่วยในรายการนี้'}
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => {
                  const c = CVD_LEVEL_COLORS[r.level];
                  return (
                    <tr key={r.hn} onClick={() => setHistoryOf(r)} className="followup-row">
                      <td className="center">{i + 1}</td>
                      <td>
                        <span className="result-badge" style={c ? { background: c.color, color: c.text } : undefined} title={r.levelName}>
                          {r.risk.toFixed(1)}%
                        </span>
                      </td>
                      <td className="mono">{r.hn}</td>
                      <td className="strong">{masked(r.name)}</td>
                      <td className="center">{r.age ?? '–'}</td>
                      <td className="center">{sexLabel(r.sex)}</td>
                      <td>{masked(r.phone)}</td>
                      <td>{masked(r.address)}</td>
                      <td>
                        {tab === 'assessed' ? (
                          <span className="assessed-badge">
                            <CheckIcon size={14} /> {r.reason}
                          </span>
                        ) : (
                          r.reason
                        )}
                      </td>
                      <td>{thaiDate(r.lastVisit)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {r.assessedToday && r.today ? (
                          <button type="button" className="assessed-badge assessed-badge--button" onClick={() => assessToday(r)} title="ประเมินแล้วใน visit วันนี้ — กดเพื่อเปิดดูหรือแก้ไข">
                            <CheckIcon size={14} /> ประเมินแล้ว
                          </button>
                        ) : r.today ? (
                          <button type="button" className="pbtn pbtn--primary" onClick={() => assessToday(r)} title="เปิดหน้าประเมินของ visit วันนี้">
                            ประเมิน
                          </button>
                        ) : (
                          <span className="muted">–</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Modal
        open={historyOf !== null}
        onClose={() => setHistoryOf(null)}
        title={historyOf ? `${historyOf.name || `HN ${historyOf.hn}`}` : ''}
        subtitle={historyOf ? `HN ${historyOf.hn} · ${historyOf.reason}` : ''}
        size="lg"
      >
        {historyOf && <CvdHistory vn={historyOf.screenVn} reload={0} />}
      </Modal>

      <Modal
        open={conditionsOf !== null}
        onClose={() => setConditionsOf(null)}
        title={conditionsOf ? `เงื่อนไข: ${TABS.find((t) => t.id === conditionsOf)!.label}` : ''}
        subtitle="ใช้กับผู้ป่วยที่มีผล Thai CV Risk บันทึกไว้ (opdscreen_cvd) · ไม่รวมผู้เสียชีวิต · ข้อมูล ณ วันนี้"
      >
        {conditionsOf && (
          <div className="criteria">
            <div className="criteria__table-wrap">
              <table className="criteria__table">
                <tbody>
                  <tr>
                    <th scope="row">เกณฑ์</th>
                    <td>
                      <ul className="followup-cond">
                        {CONDITIONS[conditionsOf].criteria.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">ข้อมูลจาก HOSxP</th>
                    <td>
                      <ul className="followup-cond">
                        {CONDITIONS[conditionsOf].data.map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                  {CONDITIONS[conditionsOf].notes && (
                    <tr>
                      <th scope="row">หมายเหตุ</th>
                      <td>
                        <ul className="followup-cond">
                          {CONDITIONS[conditionsOf].notes!.map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
