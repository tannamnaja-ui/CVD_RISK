import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FollowUp, FollowUpListId, FollowUpRow } from '../../../server/followUp';
import { navigate } from '../../hooks/useHashRoute';
import { exportSheet } from '../../lib/excel';
import { CVD_LEVEL_COLORS, type PatientRow } from '../../lib/hosxp/patients';
import { thaiDate } from '../../lib/hosxp/vitals';
import { dataMode } from '../../services/dataMode';
import { serverCall } from '../../services/directAuth';
import { AlertTriangleIcon, EraserIcon, FilterIcon, InfoIcon, ResetIcon, SheetIcon } from '../Icons';
import { Modal } from '../Modal';
import { CvdHistory } from './CvdHistory';
import { SELECTED_PATIENT_KEY } from './PatientListPage';

const TABS: { id: FollowUpListId; label: string; reason: string; rule: (r: FollowUp['rules']) => string }[] = [
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

/** Worklists of screened patients who need action (direct-database mode; rows identify patients). */
export function FollowUpPage() {
  const [data, setData] = useState<FollowUp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FollowUpListId>('noStatin');
  const [search, setSearch] = useState('');
  const [historyOf, setHistoryOf] = useState<FollowUpRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await serverCall<FollowUp>('/api/follow-up'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dataMode() === 'direct') void load();
  }, [load]);

  const rows = useMemo(() => {
    const list = data?.lists[tab] ?? [];
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return list;
    return list.filter((r) => words.every((w) => `${r.name} ${r.hn} ${r.address}`.toLowerCase().includes(w)));
  }, [data, tab, search]);

  if (dataMode() !== 'direct') {
    return (
      <div className="plist">
        <section className="plist__card">
          <p className="ptable__empty">รายชื่อติดตามใช้ได้เมื่อเข้าใช้งานผ่านหน้าเข้าสู่ระบบของแอป (ไม่ใช่เปิดจาก HOSxP XE)</p>
        </section>
      </div>
    );
  }

  const current = TABS.find((t) => t.id === tab)!;

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
              <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} className={`followup-tab${t.id === tab ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
                {t.label}
                <span className="followup-tab__count">{data ? data.lists[t.id].length : '…'}</span>
              </button>
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
            <button type="button" className="pbtn pbtn--green" onClick={exportExcel}>
              <SheetIcon size={16} /> ส่งออก Excel
            </button>
            <span className="plist__count">
              {rows.length} คน{data ? ` · จากผู้ที่เคยประเมิน ${data.screenedPatients} คน · ข้อมูล ณ ${thaiDate(data.asOf)}` : ''}
            </span>
          </div>
          {data && (
            <p className="followup-rule">
              <InfoIcon size={16} /> <span>เกณฑ์: {current.rule(data.rules)} · ไม่รวมผู้เสียชีวิต · กดที่แถวเพื่อดูประวัติผลการประเมิน</span>
            </p>
          )}
        </div>

        {error && (
          <div className="privacy-banner">
            <AlertTriangleIcon size={18} /> <span>{error}</span>
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
                      <td className="strong">{r.name}</td>
                      <td className="center">{r.age ?? '–'}</td>
                      <td className="center">{sexLabel(r.sex)}</td>
                      <td>{r.phone || <span className="muted">–</span>}</td>
                      <td>{r.address || <span className="muted">–</span>}</td>
                      <td>{r.reason}</td>
                      <td>{thaiDate(r.lastVisit)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {r.today ? (
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
    </div>
  );
}
