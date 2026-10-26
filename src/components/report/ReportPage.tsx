import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useHashRoute } from '../../hooks/useHashRoute';
import type { Report } from '../../../server/report';
import { todayLocal } from '../../lib/hosxp/patients';
import { dataMode } from '../../services/dataMode';
import { serverCall } from '../../services/directAuth';
import { AlertTriangleIcon, CalendarIcon, ImageIcon, InfoIcon, SearchIcon } from '../Icons';
import { Donut, Empty, fmtPct, Gauge, GroupedColumns, Legend, Line, RankedBars, Sankey, Scatter, Stacked100, StackedBars, type StackRow } from './charts';

/** Thai CV Risk levels, in the colours of the assessment (cvd_risk_score_type 1–5). */
const LEVELS = [
  { id: 1, label: 'ต่ำ', long: 'ระดับ 1 ความเสี่ยงต่ำ (< 10%)', color: '#28a745' },
  { id: 2, label: 'ปานกลาง', long: 'ระดับ 2 ปานกลาง (10–<20%)', color: '#ffc107' },
  { id: 3, label: 'สูง', long: 'ระดับ 3 สูง (20–<30%)', color: '#fd7e14' },
  { id: 4, label: 'สูงมาก', long: 'ระดับ 4 สูงมาก (30–<40%)', color: '#dc3545' },
  { id: 5, label: 'อันตราย', long: 'ระดับ 5 อันตรายสูงสุด (≥ 40%)', color: '#6f42c1' },
];
const SCREENED = '#2a8c82';
const NOT_SCREENED = '#d5dfdd';
const SEX = [
  { key: 'male', label: 'ชาย', color: '#2a78d6' },
  { key: 'female', label: 'หญิง', color: '#eb6834' },
];

// ---------- period presets (Thai fiscal year starts 1 October) ----------

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function presets() {
  const now = new Date();
  const fyStart = new Date(now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1, 9, 1);
  const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  return [
    { key: 'month', label: 'เดือนนี้', from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: todayLocal() },
    { key: 'quarter', label: 'ไตรมาสนี้', from: iso(qStart), to: todayLocal() },
    { key: 'fy', label: 'ปีงบประมาณนี้', from: iso(fyStart), to: todayLocal() },
    { key: 'lastfy', label: 'ปีงบที่แล้ว', from: iso(new Date(fyStart.getFullYear() - 1, 9, 1)), to: iso(new Date(fyStart.getFullYear(), 8, 30)) },
    { key: '12m', label: '12 เดือนล่าสุด', from: iso(new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 1)), to: todayLocal() },
  ];
}

const thaiDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return `${d}/${m}/${y + 543}`;
};

export function ReportPage() {
  const PRESETS = useMemo(presets, []);
  // #/report?from=YYYY-MM-DD&to=YYYY-MM-DD opens a given period (default: this fiscal year)
  const { params } = useHashRoute();
  const urlFrom = /^\d{4}-\d{2}-\d{2}$/.test(params.get('from') ?? '') ? params.get('from')! : null;
  const urlTo = /^\d{4}-\d{2}-\d{2}$/.test(params.get('to') ?? '') ? params.get('to')! : urlFrom;
  const [from, setFrom] = useState(urlFrom ?? PRESETS[2].from);
  const [to, setTo] = useState(urlTo ?? PRESETS[2].to);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);

  /** The whole report (without the period controls) as one PNG. */
  async function saveImage() {
    const node = pageRef.current;
    if (!node || !report) return;
    setSaving(true);
    try {
      const { toPng } = await import('html-to-image');
      const options = {
        pixelRatio: 2,
        backgroundColor: getComputedStyle(document.body).backgroundColor || '#f2f6f5',
        filter: (n: HTMLElement) => !n.classList?.contains('report__period'),
      };
      let url: string;
      try {
        url = await toPng(node, options);
      } catch {
        // very tall pages can exceed the canvas limit, and web fonts may fail to embed — retry smaller, system font
        url = await toPng(node, { ...options, pixelRatio: 1, skipFonts: true });
      }
      const a = document.createElement('a');
      a.href = url;
      a.download = `cv-risk-report_${report.period.from}${report.period.to !== report.period.from ? `_${report.period.to}` : ''}.png`;
      a.click();
    } catch (e) {
      setError(`บันทึกเป็นรูปไม่สำเร็จ: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true);
    setError(null);
    try {
      setReport(await serverCall<Report>(`/api/report?${new URLSearchParams({ from: f, to: t })}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dataMode() === 'direct') void load(from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (dataMode() !== 'direct') {
    return (
      <div className="report">
        <Empty>รายงานใช้ได้เมื่อเข้าใช้งานผ่านหน้าเข้าสู่ระบบของแอป (ไม่ใช่เปิดจาก HOSxP XE)</Empty>
      </div>
    );
  }

  const choose = (f: string, t: string) => {
    setFrom(f);
    setTo(t);
    void load(f, t);
  };

  return (
    <div className="report" ref={pageRef}>
      <header className="report__head">
        <div>
          <h2>รายงานการคัดกรองความเสี่ยงโรคหัวใจและหลอดเลือด (Thai CV Risk)</h2>
          <p>{report ? `ช่วงข้อมูล ${thaiDate(report.period.from)} – ${thaiDate(report.period.to)} · เทียบกับช่วงก่อนหน้า ${thaiDate(report.period.prevFrom)} – ${thaiDate(report.period.prevTo)}` : 'กำลังเตรียมรายงาน…'}</p>
        </div>
        <div className="report__period">
          <div className="report__presets" role="group" aria-label="ช่วงเวลา">
            {PRESETS.map((p) => (
              <button key={p.key} type="button" className={`pbtn${from === p.from && to === p.to ? ' pbtn--primary' : ' pbtn--ghost'}`} onClick={() => choose(p.from, p.to)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="report__dates">
            <CalendarIcon size={18} className="plist__muted-icon" />
            <input type="date" className="pinput pinput--date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="ตั้งแต่วันที่" />
            <span className="plist__dash">–</span>
            <input type="date" className="pinput pinput--date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="ถึงวันที่" />
            <button type="button" className="pbtn pbtn--primary" onClick={() => load(from, to)} disabled={loading}>
              <SearchIcon size={16} /> {loading ? 'กำลังสร้าง…' : 'แสดงรายงาน'}
            </button>
            <button type="button" className="pbtn pbtn--ghost" onClick={() => window.print()} disabled={!report}>
              พิมพ์
            </button>
            <button type="button" className="pbtn pbtn--green" onClick={saveImage} disabled={!report || saving || loading} title="บันทึกรายงานทั้งหน้าเป็นไฟล์รูป PNG แผ่นเดียว">
              <ImageIcon size={16} /> {saving ? 'กำลังบันทึก…' : 'บันทึกเป็นรูป'}
            </button>
          </div>
        </div>
      </header>

      {error && (
        <p className="report__error" role="alert">
          <AlertTriangleIcon size={18} /> สร้างรายงานไม่สำเร็จ: {error}
        </p>
      )}

      {report && <ReportBody r={report} />}
      {!report && loading && (
        <div className="assess-page__loading">
          <span className="spinner" /> กำลังรวบรวมข้อมูล…
        </div>
      )}
    </div>
  );
}

function ReportBody({ r }: { r: Report }) {
  const screened = r.factors.screened;
  const noScreen = screened === 0;
  const levelSlices = LEVELS.map((l) => ({ key: String(l.id), label: l.long, value: r.risk.levels.find((x) => x.id === l.id)?.count ?? 0, color: l.color }));
  const [coverBy, setCoverBy] = useState<'age' | 'area' | 'unit'>('age');
  const [areaBy, setAreaBy] = useState<'tambon' | 'amphoe' | 'unit'>('tambon');
  const coverRows: StackRow[] = (coverBy === 'age' ? r.coverage.byAge : coverBy === 'area' ? r.coverage.byArea : r.coverage.byUnit).map((g) => ({
    label: g.group,
    parts: [
      { key: 's', label: 'คัดกรองแล้ว', value: g.screened, color: SCREENED },
      { key: 'n', label: 'ยังไม่คัดกรอง', value: g.notScreened, color: NOT_SCREENED },
    ],
  }));
  const areaRows = areaBy === 'tambon' ? r.risk.areas : areaBy === 'amphoe' ? r.risk.amphoes : r.risk.units;
  const dashArea = [...r.risk.units].slice(0, 8);
  const o = r.outcomes;

  return (
    <>
      {noScreen && (
        <p className="report__notice">
          <InfoIcon size={18} /> ยังไม่มีผลคัดกรองที่บันทึกในตาราง opdscreen_cvd ช่วงนี้ — ตัวเลขที่นับจากผลคัดกรองจะแสดงเมื่อเริ่มกด “บันทึก” ในหน้าคำนวณ ส่วนจำนวนประชากรเป้าหมายแสดงได้แล้ว
        </p>
      )}

      {/* ===== KPI cards ===== */}
      <section className="kpis" aria-label="ตัวชี้วัดหลัก">
        <Kpi label="ยอดคัดกรอง (ราย)" value={r.kpi.screened.toLocaleString()} sub={`จากผู้มารับบริการ ${r.coverage.visitors.toLocaleString()} ราย`} now={r.kpi.screened} before={r.prevKpi.screened} unit="ราย" goodWhenUp />
        <Kpi
          label="ความครอบคลุมการคัดกรอง"
          value={fmtPct(r.kpi.coverage)}
          sub={`${r.coverage.covered.toLocaleString()} / ${r.coverage.eligible.toLocaleString()} คนในกลุ่มเป้าหมาย · เป้า ≥ ${r.coverage.target}%`}
          now={r.kpi.coverage}
          before={r.prevKpi.coverage}
          unit="จุด"
          goodWhenUp
          status={r.kpi.coverage === null ? undefined : r.kpi.coverage >= r.coverage.target ? 'good' : 'bad'}
        />
        <Kpi label="กลุ่มเสี่ยงสูง (≥ 20%)" value={fmtPct(r.kpi.highRisk)} sub={`${r.risk.highCount.toLocaleString()} จาก ${screened.toLocaleString()} คนที่คัดกรอง`} now={r.kpi.highRisk} before={r.prevKpi.highRisk} unit="จุด" />
        <Kpi label="กลุ่มเสี่ยงสูงได้รับยา Statin" value={fmtPct(r.kpi.statin)} sub={`${o.statin.count.toLocaleString()} จาก ${o.highRisk.toLocaleString()} คน`} now={r.kpi.statin} before={r.prevKpi.statin} unit="จุด" goodWhenUp />
      </section>

      {/* ===== Dashboard: left / middle / right ===== */}
      <section className="dash3">
        <Card title="ภาพรวมประชากรตาม 5 ระดับสี" note="จำนวนผู้ที่คัดกรองในแต่ละระดับ">
          <div className="dash3__donut">
            <Donut data={levelSlices} size={190} center={screened.toLocaleString()} centerSub="คนที่คัดกรอง" />
            <Legend items={LEVELS.map((l) => ({ label: l.label, color: l.color, value: String(r.risk.levels.find((x) => x.id === l.id)?.count ?? 0) }))} />
          </div>
        </Card>
        <Card title="กลุ่มเสี่ยงสูงตามหน่วยบริการ" note="8 หน่วยบริการที่มีกลุ่มเสี่ยงสูงมากที่สุด">
          {dashArea.length ? (
            <>
              <GroupedColumns
                groups={dashArea.map((a) => ({ label: a.name, values: [a.screened, a.high] }))}
                series={[
                  { label: 'คัดกรองแล้ว', color: SCREENED },
                  { label: 'เสี่ยงสูง ≥ 20%', color: '#dc3545' },
                ]}
              />
              <Legend items={[{ label: 'คัดกรองแล้ว', color: SCREENED }, { label: 'เสี่ยงสูง ≥ 20%', color: '#dc3545' }]} />
            </>
          ) : (
            <Empty />
          )}
        </Card>
        <Card title="ผลการควบคุมในกลุ่มเสี่ยงสูง" note="สัดส่วนที่ทำได้ตามเป้าหมาย">
          <Stacked100
            rows={[
              { label: 'คุมความดัน < 140/90', achieved: o.bp.controlled, total: o.bp.measured, goodLabel: 'คุมได้', badLabel: 'ยังคุมไม่ได้' },
              { label: `คุม LDL < ${o.ldl.target}`, achieved: o.ldl.controlled, total: o.ldl.measured, goodLabel: 'คุมได้', badLabel: 'ยังคุมไม่ได้' },
              { label: 'มาตามนัดครั้งแรกหลังคัดกรอง', achieved: o.dropout.due - o.dropout.lost, total: o.dropout.due, goodLabel: 'มาตามนัด', badLabel: 'ขาดนัด' },
            ]}
          />
          <Legend items={[{ label: 'ทำได้ตามเป้า', color: '#2a8c82' }, { label: 'ยังไม่ได้', color: NOT_SCREENED }]} />
        </Card>
      </section>

      {/* ===== 1. Coverage ===== */}
      <Section n={1} title="รายงานความครอบคลุมของการคัดกรอง" en="Coverage & Demographics">
        <div className="grid-3">
          <Card title="อัตราความครอบคลุม" note={`คัดกรองแล้ว ÷ ประชากรเป้าหมาย × 100 · เป้าหมาย ≥ ${r.coverage.target}%`}>
            <Gauge value={r.kpi.coverage} target={r.coverage.target} label="ครอบคลุม" />
            <p className="card__fact">
              {r.coverage.covered.toLocaleString()} / {r.coverage.eligible.toLocaleString()} คน
            </p>
          </Card>
          <Card title="สัดส่วนการใช้โมเดล" note="Lab = มีผล Total Cholesterol · Non-Lab = ใช้รอบเอว/ส่วนสูง">
            <div className="dash3__donut">
              <Donut
                data={[
                  { key: 'lab', label: 'ใช้ผลเลือด (Lab)', value: r.coverage.lab, color: '#2a78d6' },
                  { key: 'nonlab', label: 'ไม่ใช้ผลเลือด (Non-Lab)', value: r.coverage.nonLab, color: '#eb6834' },
                ]}
                size={170}
                center={screened ? fmtPct(Math.round((r.coverage.lab / screened) * 1000) / 10) : '–'}
                centerSub="ใช้ผลเลือด"
              />
              <Legend
                items={[
                  { label: 'Lab', color: '#2a78d6', value: r.coverage.lab.toLocaleString() },
                  { label: 'Non-Lab', color: '#eb6834', value: r.coverage.nonLab.toLocaleString() },
                ]}
              />
            </div>
          </Card>
          <Card
            title="ตรวจแล้ว vs ยังไม่ตรวจ"
            note="เฉพาะประชากรเป้าหมาย"
            actions={
              <Toggle
                value={coverBy}
                onChange={setCoverBy}
                options={[
                  { value: 'age', label: 'ช่วงอายุ' },
                  { value: 'area', label: 'ตำบล' },
                  { value: 'unit', label: 'หน่วยบริการ' },
                ]}
              />
            }
          >
            {coverRows.length ? <StackedBars rows={coverRows} /> : <Empty />}
            <Legend items={[{ label: 'คัดกรองแล้ว', color: SCREENED }, { label: 'ยังไม่คัดกรอง', color: NOT_SCREENED }]} />
          </Card>
        </div>
      </Section>

      {/* ===== 2. Risk stratification ===== */}
      <Section n={2} title="รายงานการกระจายตัวของระดับความเสี่ยง" en="Risk Stratification">
        <div className="grid-2">
          <Card title="สัดส่วนตามแถบสีความเสี่ยง" note={`กลุ่มเสี่ยงสูงขึ้นไป (≥ 20%) = ${fmtPct(r.kpi.highRisk)} (${r.risk.highCount.toLocaleString()} คน)`}>
            <div className="dash3__donut">
              <Donut data={levelSlices} size={210} center={fmtPct(r.kpi.highRisk)} centerSub="เสี่ยงสูง ≥ 20%" />
              <table className="mini-table">
                <thead>
                  <tr>
                    <th>ระดับ</th>
                    <th className="num">คน</th>
                    <th className="num">ร้อยละ</th>
                  </tr>
                </thead>
                <tbody>
                  {levelSlices.map((s) => (
                    <tr key={s.key}>
                      <th scope="row">
                        <span className="viz-legend__swatch" style={{ background: s.color }} /> {s.label}
                      </th>
                      <td className="num">{s.value.toLocaleString()}</td>
                      <td className="num">{fmtPct(screened ? Math.round((s.value / screened) * 1000) / 10 : null)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card
            title="ความชุกของกลุ่มเสี่ยงสูง (≥ 20%) ตามพื้นที่"
            note="ตารางความร้อน — สีเข้มขึ้นเมื่อสัดส่วนกลุ่มเสี่ยงสูงมากขึ้น"
            actions={
              <Toggle
                value={areaBy}
                onChange={setAreaBy}
                options={[
                  { value: 'tambon', label: 'ตำบล' },
                  { value: 'amphoe', label: 'อำเภอ' },
                  { value: 'unit', label: 'หน่วยบริการ' },
                ]}
              />
            }
          >
            <HeatTable rows={areaRows} />
          </Card>
        </div>
      </Section>

      {/* ===== 3. Risk factors ===== */}
      <Section n={3} title="รายงานปัจจัยเสี่ยงและโรคร่วม" en="Risk Factor Breakdown">
        <div className="grid-2">
          <Card title="ปัจจัยเสี่ยงที่พบบ่อยที่สุด" note="ร้อยละของผู้ที่คัดกรอง (เรียงจากมากไปน้อย)">
            {noScreen ? <Empty /> : <RankedBars items={r.factors.items} color="#3b84a6" />}
            <div className="means">
              <Mean label="SBP เฉลี่ย" value={r.factors.means.sbp} unit="mmHg" />
              <Mean label="Total Cholesterol เฉลี่ย" value={r.factors.means.tc} unit="mg/dL" />
              <Mean label="LDL เฉลี่ย" value={r.factors.means.ldl} unit="mg/dL" />
            </div>
          </Card>
          <Card title="อายุกับค่าความเสี่ยง (% CVD Risk)" note="แต่ละจุดคือผู้ที่คัดกรอง 1 คน · เส้นประ = 20% (เสี่ยงสูง)">
            {r.factors.scatter.length ? (
              <>
                <Scatter points={r.factors.scatter.map((p) => ({ x: p.age, y: p.risk, group: p.sex }))} groups={SEX} />
                <Legend items={SEX.map((s) => ({ label: s.label, color: s.color }))} />
              </>
            ) : (
              <Empty />
            )}
          </Card>
        </div>
      </Section>

      {/* ===== 4. Outcomes ===== */}
      <Section n={4} title="รายงานคุณภาพการรักษาและการติดตามผล" en="Clinical Outcome & Tracking">
        <div className="tiles">
          <Tile label="Statin Initiation Rate" value={fmtPct(o.statin.rate)} sub={`ได้รับ Statin ${o.statin.count}/${o.highRisk} คน (กลุ่มเสี่ยงสูง)`} />
          <Tile label="BP Control Rate" value={fmtPct(o.bp.rate)} sub={`ความดันล่าสุด < 140/90: ${o.bp.controlled}/${o.bp.measured} คน`} />
          <Tile label="Risk Migration (ระดับสีลดลง)" value={fmtPct(o.migration.rate)} sub={`${o.migration.improved}/${o.migration.reassessed} คนที่ประเมินซ้ำ`} />
          <Tile label="Drop-out Rate" value={fmtPct(o.dropout.rate)} sub={`ขาดนัด ${o.dropout.lost}/${o.dropout.due} คน${o.dropout.noAppointment ? ` · ไม่มีนัด ${o.dropout.noAppointment} คน` : ''}`} tone={o.dropout.rate !== null && o.dropout.rate > 20 ? 'bad' : undefined} />
        </div>
        <div className="grid-2">
          <Card title="การเปลี่ยนระดับสีหลังติดตาม (Sankey)" note="ครั้งแรก → ครั้งล่าสุด ของผู้ที่ประเมินซ้ำ">
            <Sankey flows={o.migration.flows} levels={LEVELS.map((l) => ({ id: l.id, label: l.label, color: l.color }))} />
          </Card>
          <Card title="แนวโน้มรายไตรมาส" note="ค่าเฉลี่ยของผู้ที่เคยคัดกรอง ย้อนหลัง 12 เดือน">
            <div className="grid-2 grid-2--tight">
              <div>
                <h4 className="card__sub">SBP เฉลี่ย (mmHg)</h4>
                <Line points={o.trend.map((t) => ({ x: t.quarter, y: t.sbp }))} color="#2a78d6" unit="mmHg" label="SBP" />
              </div>
              <div>
                <h4 className="card__sub">LDL เฉลี่ย (mg/dL)</h4>
                <Line points={o.trend.map((t) => ({ x: t.quarter, y: t.ldl }))} color="#eb6834" unit="mg/dL" label="LDL" />
              </div>
            </div>
          </Card>
        </div>
      </Section>

      <Definitions r={r} />
    </>
  );
}

// ---------- building blocks ----------

function Kpi({ label, value, sub, now, before, unit, goodWhenUp, status }: { label: string; value: string; sub: string; now: number | null; before: number | null; unit: string; goodWhenUp?: boolean; status?: 'good' | 'bad' }) {
  const delta = now !== null && before !== null ? Math.round((now - before) * 10) / 10 : null;
  const dir = delta === null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down';
  // colour the arrow by meaning: up is good for coverage/statin, bad for high-risk share
  const good = dir === 'flat' ? null : (dir === 'up') === !!goodWhenUp;
  return (
    <div className={`kpi${status ? ` kpi--${status}` : ''}`}>
      <span className="kpi__label">{label}</span>
      <span className="kpi__value">{value}</span>
      <span className="kpi__sub">{sub}</span>
      <span className={`kpi__trend${good === null ? '' : good ? ' is-good' : ' is-bad'}`}>
        {delta === null ? 'ไม่มีข้อมูลช่วงก่อนหน้า' : dir === 'flat' ? '→ เท่าเดิมจากช่วงก่อนหน้า' : `${dir === 'up' ? '↑' : '↓'} ${Math.abs(delta).toLocaleString()} ${unit} จากช่วงก่อนหน้า`}
      </span>
    </div>
  );
}

function Section({ n, title, en, children }: { n: number; title: string; en: string; children: ReactNode }) {
  return (
    <section className="rsection">
      <h3 className="rsection__title">
        <span className="rsection__num">{n}</span> {title} <small>({en})</small>
      </h3>
      {children}
    </section>
  );
}

function Card({ title, note, actions, children }: { title: string; note?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="rcard">
      <div className="rcard__head">
        <div>
          <h4>{title}</h4>
          {note && <p>{note}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

function Toggle<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="rtoggle" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'is-on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'bad' }) {
  return (
    <div className={`tile${tone ? ` tile--${tone}` : ''}`}>
      <span className="tile__label">{label}</span>
      <span className="tile__value">{value}</span>
      <span className="tile__sub">{sub}</span>
    </div>
  );
}

function Mean({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div className="mean">
      <span>{label}</span>
      <b>{value === null ? '–' : value.toLocaleString()}</b>
      <small>{unit}</small>
    </div>
  );
}

/** Area table shaded by high-risk prevalence (single-hue sequential red). */
function HeatTable({ rows }: { rows: { name: string; screened: number; high: number; rate: number | null }[] }) {
  const [all, setAll] = useState(false);
  if (!rows.length) return <Empty />;
  const shown = all ? rows : rows.slice(0, 12);
  const shade = (rate: number | null) => (rate === null ? 'transparent' : `rgb(220 53 69 / ${0.08 + (rate / 100) * 0.62})`);
  return (
    <>
      <table className="mini-table heat-table">
        <thead>
          <tr>
            <th>พื้นที่</th>
            <th className="num">คัดกรอง</th>
            <th className="num">เสี่ยงสูง</th>
            <th className="num">ความชุก</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.name}>
              <th scope="row">{r.name}</th>
              <td className="num">{r.screened.toLocaleString()}</td>
              <td className="num">{r.high.toLocaleString()}</td>
              <td className="num heat-cell" style={{ background: shade(r.rate) }}>
                {fmtPct(r.rate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 12 && (
        <button type="button" className="link-btn" onClick={() => setAll((a) => !a)}>
          {all ? 'แสดงเฉพาะ 12 อันดับแรก' : `แสดงทั้งหมด ${rows.length} พื้นที่`}
        </button>
      )}
    </>
  );
}

function Definitions({ r }: { r: Report }) {
  return (
    <details className="definitions">
      <summary>นิยามตัวชี้วัดและแหล่งข้อมูล</summary>
      <ul>
        <li>
          <b>ประชากรเป้าหมาย</b>: ผู้มารับบริการในช่วงที่เลือก (นับรายคน/HN) ที่อายุ 35–70 ปี หรือมีปัจจัยเสี่ยงสำคัญ หรือมีโรคร่วม — เกณฑ์เดียวกับวงกลมแดงในหน้าทะเบียน
        </li>
        <li>
          <b>คัดกรองแล้ว</b>: มีผล Thai CV Risk บันทึกในตาราง opdscreen_cvd ของ visit ในช่วงนี้ (ใช้ผลล่าสุดของแต่ละคน)
        </li>
        <li>
          <b>กลุ่มเสี่ยงสูง</b>: Thai CV Risk ≥ 20% · <b>ได้รับ Statin</b>: มีการจ่ายยาชื่อลงท้าย “statin” ตั้งแต่ 180 วันก่อนเริ่มช่วงจนถึงสิ้นช่วง
        </li>
        <li>
          <b>คุมความดันได้</b>: ความดันครั้งล่าสุดจากการซักประวัติ &lt; 140/90 mmHg · <b>คุม LDL ได้</b>: ผล LDL ล่าสุด &lt; {r.outcomes.ldl.target} mg/dL
        </li>
        <li>
          <b>ขาดนัด (Drop-out)</b>: นัดครั้งแรกในตารางนัด (oapp) หลังวันคัดกรองของกลุ่มเสี่ยงสูง ที่เลยวันนัดมาแล้วเกิน {r.outcomes.dropout.graceDays} วัน — นับว่ามาตามนัดเมื่อ HOSxP ผูก visit กับนัดนั้น
          หรือมีการมารับบริการภายใน ±{r.outcomes.dropout.graceDays} วันของวันนัด · ผู้ที่ยังไม่มีนัดหลังคัดกรองแสดงแยกเป็น "ไม่มีนัด" ({r.outcomes.dropout.noAppointment} คน)
        </li>
        <li>
          <b>ระดับสีลดลง (Risk Migration)</b>: เทียบระดับครั้งแรกกับครั้งล่าสุดของผู้ที่คัดกรองอย่างน้อย 2 ครั้ง
        </li>
        <li>
          <b>ความชุกปัจจัยเสี่ยง</b>: จากผลคัดกรอง (สูบบุหรี่/เบาหวาน) ร่วมกับการวินิจฉัย ICD-10 ในประวัติ และความดัน/รอบเอวจากการซักประวัติวันที่คัดกรอง
        </li>
        <li>
          <b>แผนที่ความร้อน</b>: แสดงเป็นตารางความร้อนรายตำบล/อำเภอ/หน่วยบริการ (ไม่มีข้อมูลขอบเขตแผนที่ในระบบ)
        </li>
      </ul>
    </details>
  );
}
