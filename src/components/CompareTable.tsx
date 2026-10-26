import { forwardRef } from 'react';
import { TONES, type Assessment, type ModelId } from '../lib/engines';
import { NUMERIC_RULES } from '../lib/formModel';
import { CompareIcon, RiskLevelIcon } from './Icons';

interface CompareTableProps {
  rows: Assessment[];
  currentModel: ModelId;
  stale: boolean;
}

function StatusCell({ row }: { row: Assessment }) {
  if (row.status === 'ok') {
    const { category, display } = row.result;
    const tone = TONES[category.tone];
    return (
      <>
        <td className="compare__risk" data-label="ความเสี่ยง 10 ปี">
          <strong style={{ color: tone.text }}>{display}%</strong>
          {row.outsideAge && (
            <span className="compare__outside" title={row.outsideAge}>
              {' '}
              * นอกช่วงอายุของสูตร
            </span>
          )}
        </td>
        <td data-label="ระดับ">
          <span className="badge badge--sm" style={{ ['--level-color' as string]: tone.color, ['--level-on' as string]: tone.on }}>
            <RiskLevelIcon tone={category.tone} size={14} />
            {category.labelEn}
          </span>
        </td>
      </>
    );
  }
  const message = `ข้อมูลไม่ครบ: ${row.fields.map((f) => NUMERIC_RULES[f].short).join(', ')}`;
  return (
    <td colSpan={2} className="compare__na" data-label="ผล">
      {message}
    </td>
  );
}

export const CompareTable = forwardRef<HTMLElement, CompareTableProps>(function CompareTable({ rows, currentModel, stale }, ref) {
  const computed = rows.filter((r) => r.status === 'ok').length;
  return (
    <section ref={ref} className={`card compare${stale ? ' is-stale' : ''}`} tabIndex={-1}>
      <header className="compare__header">
        <CompareIcon size={20} />
        <div>
          <h2>เปรียบเทียบผลทุกสูตร</h2>
          <p>
            คำนวณได้ {computed} จาก {rows.length} โมเดล ด้วยข้อมูลชุดเดียวกัน — แต่ละสูตรประเมิน outcome และประชากรต่างกัน จึงไม่ควรนำตัวเลขมาเทียบกันโดยตรง
          </p>
        </div>
      </header>
      <div className="compare__scroll">
        <table className="compare__table">
          <thead>
            <tr>
              <th>สูตร / โมเดล</th>
              <th>ความเสี่ยง 10 ปี</th>
              <th>ระดับ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.model.id} className={row.model.id === currentModel ? 'is-current' : undefined}>
                <th scope="row" data-label="สูตร">
                  <span className="compare__name">{row.model.shortName}</span>
                  <span className="compare__variant">{row.status === 'ok' ? row.result.variant : row.model.outcome}</span>
                </th>
                <StatusCell row={row} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
});
