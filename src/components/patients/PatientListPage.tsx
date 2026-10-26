import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PrivacyBlockedError, useHosxp } from '../../hooks/useHosxp';
import { navigate } from '../../hooks/useHashRoute';
import { dateSpan, exportSheet } from '../../lib/excel';
import {
  EMPTY_FILTERS,
  COMORBID_LABELS,
  CVD_LEVEL_COLORS,
  CVD_STATUS_LABELS,
  cvdStatus,
  RISK_FACTOR_LABELS,
  applyRiskFactors,
  SCREENING_AGE,
  applyPatientFilters,
  dateOf,
  depOption,
  hasDxText,
  knownDepCodes,
  todayLocal,
  uniqueSorted,
  type PatientFilters,
  type PatientRow,
  nextSort,
  type SortKey,
  type SortState,
} from '../../lib/hosxp/patients';
import { AlertTriangleIcon, CalendarIcon, EraserIcon, FilterIcon, InboxIcon, InfoIcon, KeyIcon, SearchIcon, SheetIcon, SortIcon } from '../Icons';
import { Modal } from '../Modal';

const STATE_KEY = 'patients_state';

export const SELECTED_PATIENT_KEY = 'selected_patient';

interface SavedState {
  dateFrom: string;
  dateTo: string;
  patients: PatientRow[];
  filters: PatientFilters;
  sort: SortState | null;
}

function loadSavedState(): SavedState | null {
  try {
    const raw = sessionStorage.getItem(STATE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STATE_KEY);
    const s = JSON.parse(raw) as SavedState;
    // states saved before every column was sortable stored only the time direction
    const legacy = s.sort as unknown;
    const sort = typeof legacy === 'string' ? { key: 'vstdate' as const, dir: legacy as SortState['dir'] } : s.sort;
    return { ...s, sort, filters: { ...EMPTY_FILTERS, ...s.filters } };
  } catch {
    return null;
  }
}

export function PatientListPage() {
  const { mode, listPatients, loadNames: fetchNames, loadRiskFactors, diagnose } = useHosxp();
  const [saved] = useState(loadSavedState);
  const [dateFrom, setDateFrom] = useState(saved?.dateFrom ?? todayLocal());
  const [dateTo, setDateTo] = useState(saved?.dateTo ?? todayLocal());
  const [patients, setPatients] = useState<PatientRow[]>(saved?.patients ?? []);
  const [filters, setFilters] = useState<PatientFilters>(saved?.filters ?? EMPTY_FILTERS);
  const [sort, setSort] = useState<SortState | null>(saved?.sort ?? null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(!!saved);
  const [error, setError] = useState<string | null>(null);
  const [diagnosis, setDiagnosis] = useState<string | null>(null);
  /** Date range of the list on screen — the names query must use the same one. */
  const [range, setRange] = useState(saved ? { from: saved.dateFrom, to: saved.dateTo || saved.dateFrom } : null);
  const [namesShown, setNamesShown] = useState(!!saved?.patients.some((p) => p.ptname));
  const [namesLoading, setNamesLoading] = useState(false);
  const [namesError, setNamesError] = useState<string | null>(null);
  /** Names query blocked by the API privacy protection, waiting for approval in HOSxP. */
  const [approval, setApproval] = useState<{ requestId: string; sql: string; notYet?: boolean } | null>(null);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [riskCriteriaOpen, setRiskCriteriaOpen] = useState(false);
  const [comorbidCriteriaOpen, setComorbidCriteriaOpen] = useState(false);
  /** risk-factor data loads after the list; the filter is unavailable until it has */
  const [riskStatus, setRiskStatus] = useState<{ state: 'idle' | 'loading' | 'ready' | 'error'; message?: string }>(() => ({ state: saved?.patients.some((p) => p.risk) ? 'ready' : 'idle' }));

  // BMS mode: the list has no protected fields, so it loads without an authorization request.
  // Direct mode: the data server returns names too.
  const loadPatients = useCallback(async () => {
    const from = dateFrom;
    const to = dateTo || from;
    if (!from) return;
    setLoading(true);
    setError(null);
    setDiagnosis(null);
    setApproval(null);
    setNamesError(null);
    setNamesShown(false);
    setFilters((f) => ({ ...f, search: '' }));
    try {
      const { rows, namesIncluded } = await listPatients(from, to);
      setPatients(rows);
      setRange({ from, to });
      setNamesShown(namesIncluded);
      void loadRisk(from, to);
    } catch (e) {
      setPatients([]);
      setError(`เกิดข้อผิดพลาด: ${(e as Error).message}`);
      setDiagnosis('กำลังตรวจสอบการเชื่อมต่อ...');
      setDiagnosis(await diagnose());
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [dateFrom, dateTo, diagnose, listPatients]);

  /** Major-risk-factor data (diagnosis history + today's vitals), merged into the rows once loaded. */
  async function loadRisk(from: string, to: string) {
    setRiskStatus({ state: 'loading' });
    try {
      const risks = await loadRiskFactors(from, to);
      setPatients((rows) => applyRiskFactors(rows, risks));
      setRiskStatus({ state: 'ready' });
    } catch (e) {
      setRiskStatus({ state: 'error', message: (e as Error).message });
    }
  }

  /** Patient/doctor names: a separate query that the API runs only after approval in HOSxP. */
  async function loadNames(retry?: { sql: string; requestId: string }) {
    if (!range) return;
    setNamesLoading(true);
    setNamesError(null);
    try {
      const names = await fetchNames(range.from, range.to, retry);
      const byVn = new Map(names.map((n) => [String(n.vn), n]));
      setPatients((rows) => rows.map((p) => ({ ...p, ptname: byVn.get(String(p.vn))?.ptname, doctor: byVn.get(String(p.vn))?.doctor })));
      setNamesShown(true);
      setApproval(null);
    } catch (e) {
      if (e instanceof PrivacyBlockedError) setApproval({ requestId: e.requestId, sql: e.sql, notYet: !!retry });
      else setNamesError(`ดึงชื่อไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setNamesLoading(false);
    }
  }

  // Open on today's list straight away. Coming back from an assessment keeps the list but
  // refreshes risk data + screening status, so a result saved meanwhile shows its yellow tick.
  useEffect(() => {
    if (!saved) void loadPatients();
    else if (range) void loadRisk(range.from, range.to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const known = useMemo(() => knownDepCodes(patients), [patients]);
  const rows = useMemo(() => applyPatientFilters(patients, filters, sort, known), [patients, filters, sort, known]);
  const lists = useMemo(
    () => ({
      spclty: uniqueSorted(patients.map((p) => p.spclty)),
      dep: uniqueSorted(patients.map(depOption)),
    }),
    [patients],
  );

  const setFilter = <K extends keyof PatientFilters>(key: K, value: PatientFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  const sortBy = useCallback((key: SortKey) => setSort((s) => nextSort(s, key)), []);

  // latest list state for the (stable) row click handler, so memoised rows don't re-render
  const stateRef = useRef<SavedState>({ dateFrom, dateTo, patients, filters, sort });
  stateRef.current = { dateFrom, dateTo, patients, filters, sort };
  const openPatient = useCallback((p: PatientRow) => {
    sessionStorage.setItem(SELECTED_PATIENT_KEY, JSON.stringify(p));
    sessionStorage.setItem(STATE_KEY, JSON.stringify(stateRef.current));
    navigate('/assess', { vn: String(p.vn) });
  }, []);

  async function exportExcel() {
    if (!rows.length) {
      alert('ไม่มีข้อมูลสำหรับส่งออก');
      return;
    }
    const headers = ['คัดกรอง CVD', 'ผลการประเมิน', 'วันที่มา', 'HN', 'ชื่อ - สกุล', 'อายุ', 'ปัจจัยเสี่ยง', 'โรคร่วม/ภาวะเสี่ยง', 'PDX', 'แพทย์ผู้ตรวจ', 'รายละเอียด DiagText', 'แผนก', 'ห้องตรวจ', 'สิทธิ'];
    const data = rows.map((p) => [
      (() => {
        const st = cvdStatus(p);
        return st ? CVD_STATUS_LABELS[st] : '';
      })(),
      p.result ? `${p.result.label} (${p.result.risk.toFixed(2)}%)` : '',
      dateOf(p.vstdate),
      p.hn ?? '',
      p.ptname ?? '',
      p.age ?? '',
      (p.risk ?? []).map((r) => RISK_FACTOR_LABELS[r].label).join(', '),
      (p.comorbid ?? []).map((c) => COMORBID_LABELS[c].label).join(', '),
      p.pdx ?? '',
      p.doctor ?? '',
      p.dx_text_list ?? '',
      p.spclty ?? '',
      p.department ?? '',
      p.pttype ?? '',
    ]);
    await exportSheet(headers, data, 'ผู้ป่วย', `patients_${dateSpan(dateFrom, dateTo || dateFrom)}.xlsx`);
  }

  return (
    <div className="plist">
      <section className="plist__card">
        <div className="plist__toolbar">
          <div className="plist__row">
            <CalendarIcon size={18} className="plist__muted-icon" />
            <input
              type="date"
              className="pinput pinput--date"
              value={dateFrom}
              title="ตั้งแต่วันที่"
              onChange={(e) => setDateFrom(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadPatients()}
            />
            <span className="plist__dash">–</span>
            <input
              type="date"
              className="pinput pinput--date"
              value={dateTo}
              title="ถึงวันที่"
              onChange={(e) => setDateTo(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadPatients()}
            />
            <button type="button" className="pbtn pbtn--primary" onClick={loadPatients}>
              <SearchIcon size={16} /> ค้นหา
            </button>
            <span className="tb-sep" />
            <label className="pinput-group">
              <FilterIcon size={16} />
              <input
                type="search"
                value={filters.search}
                disabled={!namesShown}
                aria-label="ค้นหาชื่อ - นามสกุล"
                placeholder={namesShown ? 'ค้นหาชื่อ - นามสกุล' : 'กด “แสดงชื่อผู้ป่วย/แพทย์” ก่อนค้นหาชื่อ'}
                onChange={(e) => setFilter('search', e.target.value)}
              />
            </label>
            <span className="tb-sep" />
            <input
              className="pinput pinput--wide"
              list="listSpclty"
              placeholder="แผนก"
              title="กรองตามแผนก"
              value={filters.spclty}
              onChange={(e) => setFilter('spclty', e.target.value)}
            />
            <datalist id="listSpclty">
              {lists.spclty.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <input
              className="pinput pinput--wide"
              list="listDep"
              placeholder="ห้องตรวจ"
              title="กรองตามห้องตรวจ"
              value={filters.dep}
              onChange={(e) => setFilter('dep', e.target.value)}
            />
            <datalist id="listDep">
              {lists.dep.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <input className="pinput pinput--hn" placeholder="HN" title="กรองตาม HN" value={filters.hn} onChange={(e) => setFilter('hn', e.target.value)} />
            <button type="button" className="pbtn pbtn--ghost" onClick={() => setFilters(EMPTY_FILTERS)} title="ล้างตัวกรองทั้งหมด">
              <EraserIcon size={16} /> ล้าง
            </button>
            <span className="age-filter">
              <label className={`age-filter__check${filters.screeningAge ? ' is-on' : ''}`}>
                <input type="checkbox" checked={filters.screeningAge} onChange={(e) => setFilter('screeningAge', e.target.checked)} />
                <span>
                  แสดงเฉพาะอายุ {SCREENING_AGE.min}–{SCREENING_AGE.max} ปี
                </span>
              </label>
              <button type="button" className="age-filter__info" onClick={() => setCriteriaOpen(true)} title="ดูเงื่อนไขการคัดกรองตามอายุ">
                <InfoIcon size={16} /> เงื่อนไข
              </button>
            </span>
            <span className="age-filter">
              <label
                className={`age-filter__check${filters.riskFactors ? ' is-on' : ''}${riskStatus.state !== 'ready' ? ' is-disabled' : ''}`}
                title={riskStatus.state === 'error' ? `ดึงข้อมูลปัจจัยเสี่ยงไม่สำเร็จ: ${riskStatus.message}` : riskStatus.state === 'loading' ? 'กำลังดึงข้อมูลปัจจัยเสี่ยง...' : undefined}
              >
                <input
                  type="checkbox"
                  checked={filters.riskFactors}
                  disabled={riskStatus.state !== 'ready'}
                  onChange={(e) => setFilter('riskFactors', e.target.checked)}
                />
                <span>{riskStatus.state === 'loading' ? 'กำลังโหลดปัจจัยเสี่ยง…' : riskStatus.state === 'error' ? 'ปัจจัยเสี่ยง (โหลดไม่สำเร็จ)' : 'กลุ่มที่มีปัจจัยเสี่ยงสำคัญ'}</span>
              </label>
              <button type="button" className="age-filter__info" onClick={() => setRiskCriteriaOpen(true)} title="ดูเงื่อนไขกลุ่มที่มีปัจจัยเสี่ยงสำคัญ">
                <InfoIcon size={16} /> เงื่อนไข
              </button>
            </span>
            <span className="age-filter">
              <label
                className={`age-filter__check${filters.comorbid ? ' is-on' : ''}${riskStatus.state !== 'ready' ? ' is-disabled' : ''}`}
                title={riskStatus.state === 'error' ? `ดึงข้อมูลโรคร่วมไม่สำเร็จ: ${riskStatus.message}` : riskStatus.state === 'loading' ? 'กำลังดึงข้อมูลโรคร่วม...' : undefined}
              >
                <input type="checkbox" checked={filters.comorbid} disabled={riskStatus.state !== 'ready'} onChange={(e) => setFilter('comorbid', e.target.checked)} />
                <span>{riskStatus.state === 'loading' ? 'กำลังโหลดโรคร่วม…' : riskStatus.state === 'error' ? 'โรคร่วม (โหลดไม่สำเร็จ)' : 'กลุ่มที่มีโรคร่วมหรือภาวะเสี่ยงสูงเฉพาะ'}</span>
              </label>
              <button type="button" className="age-filter__info" onClick={() => setComorbidCriteriaOpen(true)} title="ดูเงื่อนไขกลุ่มที่มีโรคร่วมหรือภาวะเสี่ยงสูงเฉพาะ">
                <InfoIcon size={16} /> เงื่อนไข
              </button>
            </span>
            {mode === 'bms' && (
              <button type="button" className="pbtn pbtn--ghost" onClick={() => loadNames()} disabled={!range || namesShown || namesLoading} title="ชื่อผู้ป่วย/แพทย์เป็นข้อมูลที่ต้องอนุมัติในโปรแกรม HOSxP ก่อนแสดง">
                <KeyIcon size={16} /> {namesShown ? 'แสดงชื่อแล้ว' : namesLoading ? 'กำลังขอชื่อ...' : 'แสดงชื่อผู้ป่วย/แพทย์'}
              </button>
            )}
            {mode === 'bms' && (
              <span className="data-mode data-mode--bms" title="เปิดจาก HOSxP XE — ดึงข้อมูลผ่าน BMS API">
                BMS API
              </span>
            )}
            <span className="plist__count">{loaded && !error ? `พบ ${rows.length.toLocaleString()} ราย` : ''}</span>
            <button type="button" className="pbtn pbtn--green" onClick={exportExcel}>
              <SheetIcon size={16} /> ส่งออก Excel
            </button>
          </div>
        </div>

        {(approval || namesError) && (
          <div className="privacy-banner">
            {approval ? (
              <>
                <KeyIcon size={18} />
                <span>
                  ชื่อผู้ป่วย/แพทย์เป็นข้อมูลส่วนบุคคลที่ต้องอนุมัติ — อนุมัติคำขอ <code>{approval.requestId}</code> ในโปรแกรม HOSxP แล้วกดปุ่มนี้
                  {approval.notYet && <b className="privacy-banner__warn"> (ยังไม่ได้รับการอนุมัติหรือหมดอายุ)</b>}
                </span>
                <button type="button" className="pbtn pbtn--primary" onClick={() => loadNames({ sql: approval.sql, requestId: approval.requestId })} disabled={namesLoading}>
                  อนุมัติแล้ว — แสดงชื่อ
                </button>
                <button type="button" className="pbtn pbtn--ghost" onClick={() => setApproval(null)}>
                  ปิด
                </button>
              </>
            ) : (
              <>
                <AlertTriangleIcon size={18} /> <span>{namesError}</span>
              </>
            )}
          </div>
        )}

        <div className="plist__table-wrap">
          <table className="ptable">
            <thead>
              <tr>
                <th>#</th>
                <SortTh k="cvdStatus" sort={sort} onSort={sortBy}>คัดกรอง CVD</SortTh>
                <SortTh k="result" sort={sort} onSort={sortBy}>ผลการประเมิน</SortTh>
                <SortTh k="vstdate" sort={sort} onSort={sortBy}>วันที่มา</SortTh>
                <SortTh k="hn" sort={sort} onSort={sortBy}>HN</SortTh>
                <SortTh k="ptname" sort={sort} onSort={sortBy}>ชื่อ - สกุล</SortTh>
                <SortTh k="age" sort={sort} onSort={sortBy}>อายุ</SortTh>
                <SortTh k="risk" sort={sort} onSort={sortBy}>ปัจจัยเสี่ยง</SortTh>
                <SortTh k="comorbid" sort={sort} onSort={sortBy}>โรคร่วม/ภาวะเสี่ยง</SortTh>
                <SortTh k="pdx" sort={sort} onSort={sortBy}>PDX</SortTh>
                <SortTh k="doctor" sort={sort} onSort={sortBy}>แพทย์ผู้ตรวจ</SortTh>
                <SortTh k="dx_text_list" sort={sort} onSort={sortBy}>รายละเอียด DiagText</SortTh>
                <SortTh k="spclty" sort={sort} onSort={sortBy}>แผนก</SortTh>
                <SortTh k="department" sort={sort} onSort={sortBy}>ห้องตรวจ</SortTh>
                <SortTh k="pttype" sort={sort} onSort={sortBy}>สิทธิ</SortTh>
              </tr>
            </thead>
            <tbody>
              {error ? (
                <EmptyRow tone="error">
                  <AlertTriangleIcon size={18} /> {error}
                  {diagnosis && <small className="ptable__diagnosis">{diagnosis}</small>}
                </EmptyRow>
              ) : !loaded ? (
                <EmptyRow>
                  <CalendarIcon size={28} /> เลือกวันที่แล้วกดค้นหา
                </EmptyRow>
              ) : rows.length === 0 ? (
                <EmptyRow>
                  <InboxIcon size={28} /> ไม่พบข้อมูล
                </EmptyRow>
              ) : (
                rows.map((p, i) => (
                  <PatientTr key={p.vn} p={p} index={i} riskLoading={riskStatus.state === 'loading'} namesShown={namesShown} onOpen={openPatient} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Modal open={criteriaOpen} onClose={() => setCriteriaOpen(false)} title="กลุ่มประชากรทั่วไปตามเกณฑ์อายุ (Screening by Age)">
        <div className="criteria">
          <p>ผู้ที่ยังไม่มีอาการของโรคหัวใจและหลอดเลือด ควรเริ่มคัดกรองตามช่วงอายุ:</p>
          <dl>
            <div className="criteria__item criteria__item--thai">
              <dt>คนไทย (Thai CV Risk)</dt>
              <dd>
                แนะนำตรวจคัดกรองในผู้ที่มีอายุ <strong>35–70 ปี ทุกคน</strong>
              </dd>
            </div>
            <div className="criteria__item">
              <dt>มาตรฐานสากล (ACC/AHA หรือ ESC)</dt>
              <dd>
                แนะนำเริ่มคัดกรองในผู้ที่มีอายุ <strong>40 ปีขึ้นไป</strong> (หรือเพศชายอายุตั้งแต่ 40 ปี และเพศหญิงอายุตั้งแต่ 50 ปีขึ้นไป หรือหลังหมดประจำเดือน)
              </dd>
            </div>
          </dl>
          <p className="criteria__note">ช่อง “แสดงเฉพาะอายุ 35–70 ปี” ใช้เกณฑ์ของ Thai CV Risk — ผู้ที่ไม่มีข้อมูลอายุจะไม่แสดงเมื่อติ๊กช่องนี้ · ติ๊กคู่กับ “กลุ่มที่มีปัจจัยเสี่ยงสำคัญ” จะแสดงผู้ที่เข้าเกณฑ์ข้อใดข้อหนึ่ง</p>
        </div>
      </Modal>

      <Modal open={riskCriteriaOpen} onClose={() => setRiskCriteriaOpen(false)} title="กลุ่มที่มีปัจจัยเสี่ยงสำคัญ" size="lg">
        <div className="criteria">
          <p>
            แม้จะอายุน้อยกว่าเกณฑ์ (เช่น ต่ำกว่า 35–40 ปี) หากมีปัจจัยเสี่ยง<strong>ข้อใดข้อหนึ่ง</strong>ดังต่อไปนี้ ควรได้รับการประเมิน:
          </p>
          <dl>
            <div className="criteria__item">
              <dt>โรคเบาหวาน (Diabetes Mellitus)</dt>
              <dd>ทั้ง Type 1 และ Type 2</dd>
            </div>
            <div className="criteria__item">
              <dt>โรคความดันโลหิตสูง (Hypertension)</dt>
              <dd>ผู้ที่มีความดันโลหิตตัวบน ≥ 140 mmHg หรือตัวล่าง ≥ 90 mmHg หรือกำลังรับยาลดความดัน</dd>
            </div>
            <div className="criteria__item">
              <dt>ภาวะไขมันในเลือดผิดปกติ (Dyslipidemia)</dt>
              <dd>เช่น คอเลสเตอรอลรวมหรือ LDL สูง, HDL ต่ำ</dd>
            </div>
            <div className="criteria__item">
              <dt>ผู้ที่สูบบุหรี่</dt>
              <dd>ทั้งผู้ที่สูบเป็นประจำหรือเพิ่งเลิกสูบไม่เกิน 1 ปี</dd>
            </div>
            <div className="criteria__item">
              <dt>ภาวะอ้วนหรืออ้วนลงพุง</dt>
              <dd>ดัชนีมวลกาย (BMI) เกินเกณฑ์ หรือมีรอบเอวเกินค่ามาตรฐาน (เพศชาย &gt; 90 ซม., เพศหญิง &gt; 80 ซม.)</dd>
            </div>
            <div className="criteria__item">
              <dt>ประวัติครอบครัวมีโรคหลอดเลือดหัวใจก่อนวัยอันควร (Premature CVD)</dt>
              <dd>มีญาติสายตรง (พ่อ แม่ พี่ น้อง) เป็นโรคหลอดเลือดหัวใจหรือเสียชีวิตเฉียบพลันก่อนวัย (ชายอายุน้อยกว่า 55 ปี หรือหญิงอายุน้อยกว่า 65 ปี)</dd>
            </div>
          </dl>
          <div className="criteria__how">
            <strong>ระบบตรวจจากอะไร</strong>
            <div className="criteria__table-wrap">
              <table className="criteria__table">
                <thead>
                  <tr>
                    <th>ปัจจัยเสี่ยง</th>
                    <th>จากการวินิจฉัย (ICD-10) ทุกครั้งในประวัติผู้ป่วย</th>
                    <th>จากการซักประวัติวันนี้</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">เบาหวาน</th>
                    <td>E10–E14</td>
                    <td>–</td>
                  </tr>
                  <tr>
                    <th scope="row">ความดันโลหิตสูง</th>
                    <td>I10–I15</td>
                    <td>ตัวบน ≥ 140 หรือตัวล่าง ≥ 90</td>
                  </tr>
                  <tr>
                    <th scope="row">ไขมันผิดปกติ</th>
                    <td>E78</td>
                    <td>–</td>
                  </tr>
                  <tr>
                    <th scope="row">สูบบุหรี่</th>
                    <td>Z72.0, F17</td>
                    <td>–</td>
                  </tr>
                  <tr>
                    <th scope="row">อ้วน/อ้วนลงพุง</th>
                    <td>E66</td>
                    <td>BMI ≥ 25 หรือรอบเอว ชาย &gt; 90 / หญิง &gt; 80 ซม.</td>
                  </tr>
                  <tr>
                    <th scope="row">ประวัติครอบครัว</th>
                    <td>Z82.4</td>
                    <td>–</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ul>
              <li>ยังไม่ได้ตรวจจากรายการยาลดความดันและผลแล็บไขมัน — ผู้ที่ไม่เคยได้รับการวินิจฉัยด้วยรหัสข้างต้นอาจไม่ถูกนับ</li>
              <li>ติ๊กหลายช่องพร้อมกัน = แสดงผู้ที่เข้าเกณฑ์กลุ่มใดกลุ่มหนึ่ง (อายุ 35–70 ปี <strong>หรือ</strong> มีปัจจัยเสี่ยง <strong>หรือ</strong> มีโรคร่วม) — กลุ่มที่ควรได้รับการคัดกรองทั้งหมด</li>
            </ul>
          </div>
        </div>
      </Modal>

      <Modal open={comorbidCriteriaOpen} onClose={() => setComorbidCriteriaOpen(false)} title="กลุ่มที่มีโรคร่วมหรือภาวะเสี่ยงสูงเฉพาะ" size="lg">
        <div className="criteria">
          <dl>
            <div className="criteria__item">
              <dt>โรคไตเรื้อรัง (Chronic Kidney Disease - CKD)</dt>
              <dd>โดยเฉพาะผู้ที่มีอัตราการกรองของไต (eGFR) &lt; 60 mL/min/1.73 m² หรือมีโปรตีนรั่วในปัสสาวะ (Microalbuminuria)</dd>
            </div>
            <div className="criteria__item">
              <dt>กลุ่มโรคไม่ติดต่อเรื้อรัง (NCDs) อื่นๆ</dt>
              <dd>ภาวะ Metabolic Syndrome</dd>
            </div>
            <div className="criteria__item">
              <dt>โรคภูมิคุ้มกันทำลายตนเองและการอักเสบเรื้อรัง</dt>
              <dd>เช่น โรคข้ออักเสบรูมาตอยด์ (Rheumatoid Arthritis), โรคแพ้ภูมิตัวเอง (SLE) หรือโรคสะเก็ดเงิน (Psoriasis)</dd>
            </div>
            <div className="criteria__item">
              <dt>ประวัติภาวะแทรกซ้อนขณะตั้งครรภ์</dt>
              <dd>เช่น เบาหวานขณะตั้งครรภ์ หรือภาวะครรภ์เป็นพิษ (Preeclampsia) ซึ่งเพิ่มความเสี่ยงในระยะยาว</dd>
            </div>
          </dl>
          <div className="criteria__how">
            <strong>ระบบตรวจจากอะไร</strong>
            <div className="criteria__table-wrap">
              <table className="criteria__table">
                <thead>
                  <tr>
                    <th>โรคร่วม / ภาวะเสี่ยง</th>
                    <th>จากการวินิจฉัย (ICD-10) ทุกครั้งในประวัติผู้ป่วย</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">โรคไตเรื้อรัง / โปรตีนรั่วในปัสสาวะ</th>
                    <td>N18 (CKD), R80 (โปรตีนในปัสสาวะ)</td>
                  </tr>
                  <tr>
                    <th scope="row">Metabolic Syndrome</th>
                    <td>E88.8</td>
                  </tr>
                  <tr>
                    <th scope="row">โรคภูมิคุ้มกันทำลายตนเอง / อักเสบเรื้อรัง</th>
                    <td>M05, M06 (รูมาตอยด์) · M32 (SLE) · L40 (สะเก็ดเงิน)</td>
                  </tr>
                  <tr>
                    <th scope="row">ภาวะแทรกซ้อนขณะตั้งครรภ์</th>
                    <td>O24.4 (เบาหวานขณะตั้งครรภ์) · O11, O13, O14, O15 (ความดันสูงขณะตั้งครรภ์ / ครรภ์เป็นพิษ)</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <ul>
              <li>ยังไม่ได้ตรวจจากผลแล็บ eGFR และ Microalbumin — ผู้ที่ไม่เคยได้รับการวินิจฉัยด้วยรหัสข้างต้นอาจไม่ถูกนับ</li>
              <li>ติ๊กหลายช่องพร้อมกัน = แสดงผู้ที่เข้าเกณฑ์กลุ่มใดกลุ่มหนึ่ง</li>
            </ul>
          </div>
        </div>
      </Modal>

      {loading && (
        <div className="ploading">
          <span className="spinner" />
          <span>กำลังโหลดข้อมูล...</span>
        </div>
      )}
    </div>
  );
}

/** ✓ yellow = screened · ● red = eligible, not yet screened · ○ white = not in the screening criteria */
function CvdStatusMark({ status, loading }: { status: ReturnType<typeof cvdStatus>; loading: boolean }) {
  if (!status) return <span className="no-dx">{loading ? '…' : '–'}</span>;
  return (
    <span className={`cvd-mark cvd-mark--${status}`} title={CVD_STATUS_LABELS[status]} aria-label={CVD_STATUS_LABELS[status]}>
      {status === 'screened' ? '✓' : ''}
    </span>
  );
}

/** Saved Thai CV Risk result in the colour of its level, with the level text and percentage. */
function ResultBadge({ result, loading }: { result: PatientRow['result']; loading: boolean }) {
  if (result === undefined) return <span className="no-dx">{loading ? '…' : '–'}</span>;
  if (result === null) return <span className="no-dx">ยังไม่ประเมิน</span>;
  const c = CVD_LEVEL_COLORS[result.level] ?? { color: '#94a3b8', text: '#ffffff' };
  return (
    <span className="result-badge" style={{ background: c.color, color: c.text }} title={`${result.label} — ${result.risk.toFixed(2)}%`}>
      {result.label}
      <b>{result.risk.toFixed(2)}%</b>
    </span>
  );
}

/** Clickable column header; aria-sort tells screen readers the current order. */
function SortTh({ k, sort, onSort, children }: { k: SortKey; sort: SortState | null; onSort: (k: SortKey) => void; children: ReactNode }) {
  const dir = sort?.key === k ? sort.dir : null;
  return (
    <th className={`ptable__sortable${dir ? ' is-sorted' : ''}`} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
      <button type="button" onClick={() => onSort(k)} title="กดเพื่อเรียงลำดับ">
        {children} <SortIcon size={14} dir={dir} />
      </button>
    </th>
  );
}

interface PatientTrProps {
  p: PatientRow;
  index: number;
  riskLoading: boolean;
  namesShown: boolean;
  onOpen: (p: PatientRow) => void;
}

/** One table row; memoised so typing in a filter or other page state does not re-render every row. */
const PatientTr = memo(function PatientTr({ p, index, riskLoading, namesShown, onOpen }: PatientTrProps) {
  return (
    <tr onClick={() => onOpen(p)} title="คลิกเพื่อประเมิน CV Risk">
      <td className="muted">{index + 1}</td>
      <td className="center">
        <CvdStatusMark status={cvdStatus(p)} loading={riskLoading} />
      </td>
      <td>
        <ResultBadge result={p.result} loading={riskLoading} />
      </td>
      <td>{dateOf(p.vstdate) || '–'}</td>
      <td className="mono">{p.hn || '–'}</td>
      <td className="strong">{p.ptname || (namesShown ? '–' : <span className="no-dx">ซ่อนอยู่</span>)}</td>
      <td className="small">{p.age || '–'}</td>
      <td className="risk-cell">
        {p.risk === undefined ? (
          <span className="no-dx">{riskLoading ? '…' : '–'}</span>
        ) : p.risk.length ? (
          p.risk.map((r) => (
            <span key={r} className={`risk-chip risk-chip--${r}`} title={RISK_FACTOR_LABELS[r].label}>
              {RISK_FACTOR_LABELS[r].short}
            </span>
          ))
        ) : (
          <span className="no-dx">ไม่พบ</span>
        )}
      </td>
      <td className="risk-cell">
        {p.comorbid === undefined ? (
          <span className="no-dx">{riskLoading ? '…' : '–'}</span>
        ) : p.comorbid.length ? (
          p.comorbid.map((c) => (
            <span key={c} className={`risk-chip risk-chip--${c}`} title={COMORBID_LABELS[c].label}>
              {COMORBID_LABELS[c].short}
            </span>
          ))
        ) : (
          <span className="no-dx">ไม่พบ</span>
        )}
      </td>
      <td>{p.pdx ? <span className="badge-pdx">{p.pdx}</span> : <span className="no-dx">–</span>}</td>
      <td className="small">{p.doctor || (namesShown ? '–' : <span className="no-dx">ซ่อนอยู่</span>)}</td>
      <td className="dxtext">
        {hasDxText(p) ? (
          <small className="dxtext-clamp" title={p.dx_text_list}>
            {p.dx_text_list}
          </small>
        ) : (
          <span className="no-dx">–</span>
        )}
      </td>
      <td className="small">{p.spclty || '–'}</td>
      <td className="small">{p.department || '–'}</td>
      <td className="small">{p.pttype || '–'}</td>
    </tr>
  );
});

function EmptyRow({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return (
    <tr className="ptable__empty">
      <td colSpan={15} className={tone === 'error' ? 'is-error' : undefined}>
        <span>{children}</span>
      </td>
    </tr>
  );
}
