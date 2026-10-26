import { useEffect, useState } from 'react';
import { useHosxp, type CvdHistoryRow } from '../../hooks/useHosxp';
import { CVD_LEVEL_COLORS } from '../../lib/hosxp/patients';
import { thaiDate } from '../../lib/hosxp/vitals';
import { Panel } from '../FormControls';
import { TrendIcon } from '../Icons';

interface Point {
  vn: string;
  date: string;
  risk: number;
  level: number;
  levelName: string;
  tc: number | null;
  smoking: boolean;
  diabetes: boolean;
  staff: string;
}

const toPoint = (r: CvdHistoryRow): Point => {
  const tc = Number(r.tc);
  return {
    vn: String(r.vn),
    date: String(r.vstdate ?? '').slice(0, 10),
    risk: Number(r.risk_score) || 0,
    level: Number(r.level) || 0,
    levelName: String(r.level_name ?? '').trim(),
    tc: r.tc !== null && r.tc !== undefined && Number.isFinite(tc) && tc > 0 ? tc : null,
    smoking: String(r.is_smoking).toUpperCase() === 'Y',
    diabetes: String(r.is_diabetes).toUpperCase() === 'Y',
    staff: String(r.staff ?? '').trim(),
  };
};

/** Every Thai CV Risk result saved for this patient (opdscreen_cvd), as a trend and a table. */
export function CvdHistory({ vn, reload }: { vn: string; reload: number }) {
  const { cvdHistory } = useHosxp();
  const [points, setPoints] = useState<Point[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    cvdHistory(vn)
      .then((rows) => !cancelled && setPoints(rows.map(toPoint)))
      .catch((e) => !cancelled && setError((e as Error).message));
    return () => {
      cancelled = true;
    };
  }, [vn, reload, cvdHistory]);

  return (
    <Panel icon={<TrendIcon size={18} />} title="ประวัติผลการประเมิน" en="Thai CV Risk History" tone="indigo">
      {error ? (
        <p className="history__empty">โหลดประวัติไม่ได้: {error}</p>
      ) : points === null ? (
        <p className="history__empty">
          <span className="spinner" /> กำลังโหลดประวัติ...
        </p>
      ) : points.length === 0 ? (
        <p className="history__empty">ยังไม่เคยบันทึกผล Thai CV Risk ของผู้ป่วยรายนี้ — กดปุ่ม "บันทึก" เพื่อเริ่มเก็บประวัติ</p>
      ) : (
        <>
          <HistorySummary points={points} />
          {points.length > 1 && <RiskTrend points={points} />}
          <div className="table-scroll">
            <table className="history-table">
              <thead>
                <tr>
                  <th>วันที่มารับบริการ</th>
                  <th>ความเสี่ยง</th>
                  <th>ระดับ</th>
                  <th>เปลี่ยนแปลง</th>
                  <th>TC</th>
                  <th>สูบบุหรี่</th>
                  <th>เบาหวาน</th>
                  <th>ผู้ประเมิน</th>
                </tr>
              </thead>
              <tbody>
                {[...points].reverse().map((p, i, arr) => {
                  const prev = arr[i + 1];
                  const c = CVD_LEVEL_COLORS[p.level];
                  return (
                    <tr key={p.vn} className={p.vn === vn ? 'is-current' : undefined}>
                      <td>
                        {thaiDate(p.date)}
                        {p.vn === vn && <small> (visit นี้)</small>}
                      </td>
                      <td className="num">
                        <b>{p.risk.toFixed(2)}%</b>
                      </td>
                      <td>
                        <span className="result-badge" style={c ? { background: c.color, color: c.text } : undefined}>
                          {p.levelName || `ระดับ ${p.level}`}
                        </span>
                      </td>
                      <td>{prev ? <Change from={prev} to={p} /> : <span className="muted">ครั้งแรก</span>}</td>
                      <td className="num">{p.tc ?? '–'}</td>
                      <td>{p.smoking ? 'สูบ' : '–'}</td>
                      <td>{p.diabetes ? 'เป็น' : '–'}</td>
                      <td>{p.staff || '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}

function Change({ from, to }: { from: Point; to: Point }) {
  const diff = to.risk - from.risk;
  if (Math.abs(diff) < 0.005) return <span className="muted">เท่าเดิม</span>;
  const better = diff < 0;
  return (
    <span className={`change ${better ? 'is-better' : 'is-worse'}`}>
      {better ? '▼ ลดลง' : '▲ เพิ่มขึ้น'} {Math.abs(diff).toFixed(2)}
      {to.level !== from.level && ` · ระดับ ${from.level}→${to.level}`}
    </span>
  );
}

function HistorySummary({ points }: { points: Point[] }) {
  const first = points[0];
  const last = points[points.length - 1];
  const text =
    points.length === 1
      ? `ประเมินแล้ว 1 ครั้ง เมื่อ ${thaiDate(last.date)}`
      : `ประเมินแล้ว ${points.length} ครั้ง ตั้งแต่ ${thaiDate(first.date)} — ครั้งล่าสุด ${last.risk.toFixed(2)}% ${
          last.risk < first.risk ? `ลดลงจากครั้งแรก ${(first.risk - last.risk).toFixed(2)}` : last.risk > first.risk ? `เพิ่มขึ้นจากครั้งแรก ${(last.risk - first.risk).toFixed(2)}` : 'เท่ากับครั้งแรก'
        }`;
  return <p className="history__summary">{text}</p>;
}

/** Thai CV Risk levels as background bands (same boundaries as the colour chart). */
const BANDS = [
  { from: 0, to: 10, level: 1 },
  { from: 10, to: 20, level: 2 },
  { from: 20, to: 30, level: 3 },
  { from: 30, to: 40, level: 4 },
  { from: 40, to: 100, level: 5 },
];

/** Risk over time: one line, markers coloured by level, the level bands behind. */
function RiskTrend({ points }: { points: Point[] }) {
  const W = 760;
  const H = 230;
  const pad = { l: 44, r: 20, t: 18, b: 34 };
  const top = Math.min(100, Math.max(50, Math.ceil((Math.max(...points.map((p) => p.risk)) + 5) / 10) * 10));
  const t = points.map((p) => Date.parse(`${p.date}T00:00:00Z`));
  const t0 = Math.min(...t);
  const span = Math.max(...t) - t0;
  const x = (i: number) => (span ? pad.l + ((t[i] - t0) / span) * (W - pad.l - pad.r) : pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r));
  const y = (risk: number) => pad.t + (1 - Math.min(risk, top) / top) * (H - pad.t - pad.b);
  const labelAll = points.length <= 8;

  return (
    <figure className="history-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`กราฟความเสี่ยง ${points.length} ครั้ง`}>
        {BANDS.filter((b) => b.from < top).map((b) => (
          <rect key={b.level} x={pad.l} width={W - pad.l - pad.r} y={y(Math.min(b.to, top))} height={y(b.from) - y(Math.min(b.to, top))} fill={CVD_LEVEL_COLORS[b.level].color} opacity={0.1} />
        ))}
        {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
          .filter((v) => v <= top)
          .map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="history-chart__grid" />
              <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" className="history-chart__tick">
                {v}%
              </text>
            </g>
          ))}
        <polyline points={points.map((p, i) => `${x(i)},${y(p.risk)}`).join(' ')} className="history-chart__line" />
        {points.map((p, i) => (
          <g key={p.vn}>
            <circle cx={x(i)} cy={y(p.risk)} r={7} fill={CVD_LEVEL_COLORS[p.level]?.color ?? '#94a3b8'} className="history-chart__dot">
              <title>{`${thaiDate(p.date)} — ${p.risk.toFixed(2)}% ${p.levelName}`}</title>
            </circle>
            {(labelAll || i === points.length - 1) && (
              <text x={x(i)} y={y(p.risk) - 13} textAnchor="middle" className="history-chart__value">
                {p.risk.toFixed(1)}%
              </text>
            )}
            {(labelAll || i === 0 || i === points.length - 1) && (
              <text x={x(i)} y={H - 10} textAnchor={i === 0 && !labelAll ? 'start' : 'middle'} className="history-chart__tick">
                {thaiDate(p.date)}
              </text>
            )}
          </g>
        ))}
      </svg>
    </figure>
  );
}
