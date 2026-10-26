/**
 * Small SVG chart set for the CVD report. Conventions (dataviz skill): thin marks, 2px surface gaps
 * between fills, recessive grid/axes, text in ink colours (never the series colour), a legend for
 * ≥ 2 series, direct labels where they fit, and a hover tooltip on every mark.
 */
import { useRef, useState, type ReactNode } from 'react';

export const INK = { primary: '#1e293b', secondary: '#4b5563', muted: '#6b7280', grid: '#e5ebea', track: '#e9efee', surface: '#ffffff' };

// ---------- tooltip ----------

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

function useTip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const show = (e: React.MouseEvent, content: ReactNode) => {
    const box = ref.current?.getBoundingClientRect();
    if (box) setTip({ x: e.clientX - box.left, y: e.clientY - box.top, content });
  };
  const hide = () => setTip(null);
  const layer = tip && (
    <div className="viz-tip" style={{ left: tip.x, top: tip.y }} role="status">
      {tip.content}
    </div>
  );
  return { ref, show, hide, layer };
}

export function Empty({ children = 'ยังไม่มีข้อมูลในช่วงนี้' }: { children?: ReactNode }) {
  return <div className="viz-empty">{children}</div>;
}

export function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <ul className="viz-legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className="viz-legend__swatch" style={{ background: i.color }} />
          {i.label}
          {i.value && <b>{i.value}</b>}
        </li>
      ))}
    </ul>
  );
}

const fmtPct = (v: number | null) => (v === null ? '–' : `${v.toLocaleString('th-TH', { maximumFractionDigits: 1 })}%`);
export { fmtPct };

// ---------- donut ----------

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function Donut({ data, size = 200, center, centerSub }: { data: Slice[]; size?: number; center: string; centerSub: string }) {
  const { ref, show, hide, layer } = useTip();
  const total = data.reduce((a, d) => a + d.value, 0);
  const r = size / 2 - 4;
  const inner = r * 0.62;
  let angle = -Math.PI / 2;
  const arc = (a0: number, a1: number) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${size / 2 + rad * Math.cos(a)} ${size / 2 + rad * Math.sin(a)}`;
    return `M ${p(r, a0)} A ${r} ${r} 0 ${large} 1 ${p(r, a1)} L ${p(inner, a1)} A ${inner} ${inner} 0 ${large} 0 ${p(inner, a0)} Z`;
  };
  return (
    <div className="viz" ref={ref}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label={`${center} ${centerSub}`}>
        {total === 0 ? (
          <circle cx={size / 2} cy={size / 2} r={(r + inner) / 2} fill="none" stroke={INK.track} strokeWidth={r - inner} />
        ) : (
          data
            .filter((d) => d.value > 0)
            .map((d) => {
              const a0 = angle;
              const sweep = (d.value / total) * Math.PI * 2;
              angle += sweep;
              const a1 = sweep >= Math.PI * 2 ? a0 + Math.PI * 2 - 0.0001 : angle;
              return (
                <path
                  key={d.key}
                  d={arc(a0, a1)}
                  fill={d.color}
                  stroke={INK.surface}
                  strokeWidth={2}
                  onMouseMove={(e) => show(e, `${d.label}: ${d.value.toLocaleString()} (${fmtPct(Math.round((d.value / total) * 1000) / 10)})`)}
                  onMouseLeave={hide}
                />
              );
            })
        )}
        <text x="50%" y="48%" textAnchor="middle" className="viz-center">
          {center}
        </text>
        <text x="50%" y="62%" textAnchor="middle" className="viz-center-sub">
          {centerSub}
        </text>
      </svg>
      {layer}
    </div>
  );
}

// ---------- gauge (semi-circle progress against a KPI target) ----------

export function Gauge({ value, target, label }: { value: number | null; target: number; label: string }) {
  const w = 240;
  const h = 140;
  const cx = w / 2;
  const cy = 120;
  const r = 96;
  const pt = (pct: number) => {
    const a = Math.PI * (1 - Math.min(Math.max(pct, 0), 100) / 100);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const path = (pct: number) => {
    const [x, y] = pt(pct);
    return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x} ${y}`;
  };
  const [tx, ty] = pt(target);
  const met = value !== null && value >= target;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ maxWidth: w }} role="img" aria-label={`${label} ${fmtPct(value)} เป้าหมาย ${target}%`}>
      <path d={path(100)} fill="none" stroke={INK.track} strokeWidth={18} strokeLinecap="round" />
      {value !== null && value > 0 && <path d={path(value)} fill="none" stroke={met ? '#2a8c82' : '#3b84a6'} strokeWidth={18} strokeLinecap="round" />}
      <line x1={tx} y1={ty} x2={cx + (tx - cx) * 1.18} y2={cy + (ty - cy) * 1.18} stroke={INK.primary} strokeWidth={2} />
      <text x={cx + (tx - cx) * 1.3} y={cy + (ty - cy) * 1.3} textAnchor="middle" className="viz-axis">
        เป้า {target}%
      </text>
      <text x={cx} y={cy - 18} textAnchor="middle" className="viz-gauge-value">
        {fmtPct(value)}
      </text>
      <text x={cx} y={cy + 2} textAnchor="middle" className="viz-center-sub">
        {label}
      </text>
    </svg>
  );
}

// ---------- horizontal stacked bars (e.g. screened vs not, per age group) ----------

export interface StackRow {
  label: string;
  parts: { key: string; label: string; value: number; color: string }[];
}

export function StackedBars({ rows, unit = 'คน' }: { rows: StackRow[]; unit?: string }) {
  const { ref, show, hide, layer } = useTip();
  const max = Math.max(1, ...rows.map((r) => r.parts.reduce((a, p) => a + p.value, 0)));
  return (
    <div className="viz viz-bars" ref={ref}>
      {rows.map((row) => {
        const total = row.parts.reduce((a, p) => a + p.value, 0);
        return (
          <div className="viz-bars__row" key={row.label}>
            <span className="viz-bars__label">{row.label}</span>
            <div className="viz-bars__track">
              {row.parts.map((p) =>
                p.value > 0 ? (
                  <span
                    key={p.key}
                    className="viz-bars__seg"
                    style={{ width: `${(p.value / max) * 100}%`, background: p.color }}
                    onMouseMove={(e) => show(e, `${row.label} · ${p.label}: ${p.value.toLocaleString()} ${unit} (${fmtPct(Math.round((p.value / total) * 1000) / 10)})`)}
                    onMouseLeave={hide}
                  />
                ) : null,
              )}
            </div>
            <span className="viz-bars__total">{total.toLocaleString()}</span>
          </div>
        );
      })}
      {layer}
    </div>
  );
}

// ---------- ranked horizontal bars (single series) ----------

export function RankedBars({ items, color }: { items: { label: string; rate: number | null; count: number }[]; color: string }) {
  const { ref, show, hide, layer } = useTip();
  return (
    <div className="viz viz-bars" ref={ref}>
      {items.map((i) => (
        <div className="viz-bars__row" key={i.label}>
          <span className="viz-bars__label viz-bars__label--wide">{i.label}</span>
          <div className="viz-bars__track">
            <span
              className="viz-bars__seg"
              style={{ width: `${i.rate ?? 0}%`, background: color }}
              onMouseMove={(e) => show(e, `${i.label}: ${i.count.toLocaleString()} คน (${fmtPct(i.rate)})`)}
              onMouseLeave={hide}
            />
          </div>
          <span className="viz-bars__total">{fmtPct(i.rate)}</span>
        </div>
      ))}
      {layer}
    </div>
  );
}

// ---------- grouped columns (e.g. screened vs high risk per tambon) ----------

export function GroupedColumns({ groups, series }: { groups: { label: string; values: number[] }[]; series: { label: string; color: string }[] }) {
  const { ref, show, hide, layer } = useTip();
  const w = 520;
  const h = 220;
  const pad = { l: 34, r: 8, t: 10, b: 54 };
  const max = Math.max(1, ...groups.flatMap((g) => g.values));
  const step = (w - pad.l - pad.r) / Math.max(groups.length, 1);
  const barW = Math.min(18, (step - 8) / series.length);
  const y = (v: number) => pad.t + (h - pad.t - pad.b) * (1 - v / max);
  const ticks = [0, Math.round(max / 2), max];
  return (
    <div className="viz" ref={ref}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="กราฟแท่งตามพื้นที่">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke={INK.grid} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="viz-axis">
              {t}
            </text>
          </g>
        ))}
        {groups.map((g, gi) => {
          const x0 = pad.l + gi * step + (step - barW * series.length - 2 * (series.length - 1)) / 2;
          return (
            <g key={g.label}>
              {g.values.map((v, si) => (
                <rect
                  key={si}
                  x={x0 + si * (barW + 2)}
                  y={y(v)}
                  width={barW}
                  height={Math.max(0, h - pad.b - y(v))}
                  rx={3}
                  fill={series[si].color}
                  onMouseMove={(e) => show(e, `${g.label} · ${series[si].label}: ${v.toLocaleString()} คน`)}
                  onMouseLeave={hide}
                />
              ))}
              <text x={pad.l + gi * step + step / 2} y={h - pad.b + 14} textAnchor="end" transform={`rotate(-35 ${pad.l + gi * step + step / 2} ${h - pad.b + 14})`} className="viz-axis">
                {g.label.length > 12 ? `${g.label.slice(0, 12)}…` : g.label}
              </text>
            </g>
          );
        })}
      </svg>
      {layer}
    </div>
  );
}

// ---------- 100% stacked bars (achieved vs not) ----------

export function Stacked100({ rows }: { rows: { label: string; achieved: number; total: number; goodLabel: string; badLabel: string }[] }) {
  const { ref, show, hide, layer } = useTip();
  return (
    <div className="viz viz-bars" ref={ref}>
      {rows.map((r) => {
        const rate = r.total ? (r.achieved / r.total) * 100 : 0;
        return (
          <div className="viz-bars__row viz-bars__row--stack" key={r.label}>
            <span className="viz-bars__label viz-bars__label--wide">{r.label}</span>
            <div className="viz-bars__track viz-bars__track--full">
              {r.total === 0 ? (
                <span className="viz-bars__none">ยังไม่มีข้อมูล</span>
              ) : (
                <>
                  <span
                    className="viz-bars__seg"
                    style={{ width: `${rate}%`, background: '#2a8c82' }}
                    onMouseMove={(e) => show(e, `${r.goodLabel}: ${r.achieved}/${r.total} คน`)}
                    onMouseLeave={hide}
                  />
                  <span
                    className="viz-bars__seg"
                    style={{ width: `${100 - rate}%`, background: '#d5dfdd' }}
                    onMouseMove={(e) => show(e, `${r.badLabel}: ${r.total - r.achieved}/${r.total} คน`)}
                    onMouseLeave={hide}
                  />
                </>
              )}
            </div>
            <span className="viz-bars__total">{r.total ? fmtPct(Math.round(rate * 10) / 10) : '–'}</span>
          </div>
        );
      })}
      {layer}
    </div>
  );
}

// ---------- scatter (age × risk, colour = sex) ----------

export function Scatter({ points, groups }: { points: { x: number; y: number; group: string }[]; groups: { key: string; label: string; color: string }[] }) {
  const { ref, show, hide, layer } = useTip();
  const w = 520;
  const h = 260;
  const pad = { l: 40, r: 10, t: 10, b: 34 };
  const xMin = 30;
  const xMax = Math.max(80, ...points.map((p) => p.x));
  const yMax = Math.max(40, ...points.map((p) => Math.ceil(p.y / 10) * 10));
  const sx = (v: number) => pad.l + ((v - xMin) / (xMax - xMin)) * (w - pad.l - pad.r);
  const sy = (v: number) => pad.t + (1 - v / yMax) * (h - pad.t - pad.b);
  const color = new Map(groups.map((g) => [g.key, g.color]));
  const label = new Map(groups.map((g) => [g.key, g.label]));
  const xTicks = [30, 40, 50, 60, 70, 80].filter((t) => t <= xMax);
  const yTicks = [0, 10, 20, 30, 40, 60, 80, 100].filter((t) => t <= yMax);
  return (
    <div className="viz" ref={ref}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="อายุกับค่าความเสี่ยง แยกตามเพศ">
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={sy(t)} y2={sy(t)} stroke={t === 20 ? '#e3a2a8' : INK.grid} strokeDasharray={t === 20 ? '4 3' : undefined} />
            <text x={pad.l - 6} y={sy(t) + 4} textAnchor="end" className="viz-axis">
              {t}%
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={sx(t)} y={h - pad.b + 16} textAnchor="middle" className="viz-axis">
            {t}
          </text>
        ))}
        <text x={w - pad.r} y={h - 4} textAnchor="end" className="viz-axis">
          อายุ (ปี)
        </text>
        {points.map((p, i) => (
          <circle
            key={i}
            cx={sx(p.x)}
            cy={sy(p.y)}
            r={5}
            fill={color.get(p.group) ?? INK.muted}
            fillOpacity={0.8}
            stroke={INK.surface}
            strokeWidth={1.5}
            onMouseMove={(e) => show(e, `${label.get(p.group) ?? 'ไม่ระบุเพศ'} อายุ ${p.x} ปี · ความเสี่ยง ${p.y.toFixed(2)}%`)}
            onMouseLeave={hide}
          />
        ))}
      </svg>
      {layer}
    </div>
  );
}

// ---------- line (one measure over quarters) ----------

export function Line({ points, color, unit, label }: { points: { x: string; y: number | null }[]; color: string; unit: string; label: string }) {
  const { ref, show, hide, layer } = useTip();
  const vals = points.map((p) => p.y).filter((v): v is number => v !== null);
  if (!vals.length) return <Empty>ยังไม่มีข้อมูล{label}</Empty>;
  const w = 320;
  const h = 170;
  const pad = { l: 40, r: 12, t: 14, b: 28 };
  const lo = Math.floor(Math.min(...vals) * 0.9);
  const hi = Math.ceil(Math.max(...vals) * 1.1);
  const sx = (i: number) => pad.l + (points.length === 1 ? (w - pad.l - pad.r) / 2 : (i / (points.length - 1)) * (w - pad.l - pad.r));
  const sy = (v: number) => pad.t + (1 - (v - lo) / Math.max(hi - lo, 1)) * (h - pad.t - pad.b);
  const d = points
    .map((p, i) => (p.y === null ? null : `${sx(i)} ${sy(p.y)}`))
    .filter(Boolean)
    .map((s, i) => `${i ? 'L' : 'M'} ${s}`)
    .join(' ');
  return (
    <div className="viz" ref={ref}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={label}>
        {[lo, Math.round((lo + hi) / 2), hi].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={sy(t)} y2={sy(t)} stroke={INK.grid} />
            <text x={pad.l - 6} y={sy(t) + 4} textAnchor="end" className="viz-axis">
              {t}
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke={color} strokeWidth={2} />
        {points.map((p, i) =>
          p.y === null ? null : (
            <g key={p.x}>
              <circle cx={sx(i)} cy={sy(p.y)} r={5} fill={color} stroke={INK.surface} strokeWidth={2} onMouseMove={(e) => show(e, `${p.x}: ${p.y} ${unit}`)} onMouseLeave={hide} />
              <text x={sx(i)} y={h - 8} textAnchor="middle" className="viz-axis">
                {p.x}
              </text>
            </g>
          ),
        )}
      </svg>
      {layer}
    </div>
  );
}

// ---------- sankey: first → latest risk level of re-assessed patients ----------

export function Sankey({ flows, levels }: { flows: { from: number; to: number; count: number }[]; levels: { id: number; label: string; color: string }[] }) {
  const { ref, show, hide, layer } = useTip();
  const total = flows.reduce((a, f) => a + f.count, 0);
  if (!total) return <Empty>ยังไม่มีผู้ที่ได้รับการประเมินซ้ำ (ต้องคัดกรองอย่างน้อย 2 ครั้ง)</Empty>;
  const w = 520;
  const h = 260;
  const nodeW = 14;
  const gap = 6;
  const usable = h - gap * (levels.length - 1);
  const layout = (side: 'from' | 'to') => {
    let y = 0;
    return new Map(
      levels.map((l) => {
        const n = flows.filter((f) => f[side] === l.id).reduce((a, f) => a + f.count, 0);
        const node = { y, h: (n / total) * usable, n };
        y += node.h + (n ? gap : 0);
        return [l.id, node];
      }),
    );
  };
  const left = layout('from');
  const right = layout('to');
  const leftUsed = new Map(levels.map((l) => [l.id, 0]));
  const rightUsed = new Map(levels.map((l) => [l.id, 0]));
  const x0 = 110;
  const x1 = w - 110;
  const color = new Map(levels.map((l) => [l.id, l.color]));
  const name = new Map(levels.map((l) => [l.id, l.label]));
  const sorted = [...flows].sort((a, b) => a.from - b.from || a.to - b.to);
  return (
    <div className="viz" ref={ref}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label="การเปลี่ยนระดับสีของผู้ที่ประเมินซ้ำ">
        {sorted.map((f) => {
          const t = (f.count / total) * usable;
          const a = left.get(f.from)!;
          const b = right.get(f.to)!;
          const ya = a.y + leftUsed.get(f.from)!;
          const yb = b.y + rightUsed.get(f.to)!;
          leftUsed.set(f.from, leftUsed.get(f.from)! + t);
          rightUsed.set(f.to, rightUsed.get(f.to)! + t);
          const mx = (x0 + nodeW + x1) / 2;
          return (
            <path
              key={`${f.from}-${f.to}`}
              d={`M ${x0 + nodeW} ${ya} C ${mx} ${ya}, ${mx} ${yb}, ${x1} ${yb} L ${x1} ${yb + t} C ${mx} ${yb + t}, ${mx} ${ya + t}, ${x0 + nodeW} ${ya + t} Z`}
              fill={color.get(f.from)}
              fillOpacity={0.35}
              onMouseMove={(e) => show(e, `${name.get(f.from)} → ${name.get(f.to)}: ${f.count} คน`)}
              onMouseLeave={hide}
            />
          );
        })}
        {(['from', 'to'] as const).map((side) =>
          levels.map((l) => {
            const node = (side === 'from' ? left : right).get(l.id)!;
            if (!node.n) return null;
            const x = side === 'from' ? x0 : x1;
            return (
              <g key={`${side}-${l.id}`}>
                <rect x={x} y={node.y} width={nodeW} height={Math.max(node.h, 2)} rx={3} fill={l.color} />
                <text x={side === 'from' ? x - 6 : x + nodeW + 6} y={node.y + node.h / 2 + 4} textAnchor={side === 'from' ? 'end' : 'start'} className="viz-axis">
                  {l.label} ({node.n})
                </text>
              </g>
            );
          }),
        )}
      </svg>
      <div className="viz-sankey-heads">
        <span>ครั้งแรก</span>
        <span>ล่าสุด</span>
      </div>
      {layer}
    </div>
  );
}
