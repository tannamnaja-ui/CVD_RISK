import { forwardRef } from 'react';
import { TONES, type ModelDef, type ModelResult } from '../lib/engines';
import { riskToMeterPosition } from '../lib/meter';
import { ClipboardIcon, CompareIcon, FunctionIcon, InfoIcon, RiskLevelIcon, StarIcon, StethoscopeIcon } from './Icons';

interface AssessmentPanelProps {
  model: ModelDef;
  age?: number;
  result: ModelResult | null;
  stale: boolean;
  compareOpen: boolean;
  onToggleCompare: () => void;
  onShowFormula: () => void;
}

const EMPTY_VARS = { color: '#94a3b8', soft: '#f1f5f9', on: '#ffffff', text: '#94a3b8' };

function rangeLabel(min: number, max: number) {
  return Number.isFinite(max) ? `${min}–<${max}%` : `≥${min}%`;
}

/** Assessment result section: big score box, progress bar, colour legend and a large colour-coded status block. */
export const AssessmentPanel = forwardRef<HTMLElement, AssessmentPanelProps>(function AssessmentPanel(
  { model, age, result, stale, compareOpen, onToggleCompare, onShowFormula },
  ref,
) {
  const categories = result?.categories ?? model.legend(age);
  const category = result?.category;
  const tone = category ? TONES[category.tone] : EMPTY_VARS;
  const width = 100 / categories.length;
  const position = !result
    ? 0
    : result.risk !== null
      ? riskToMeterPosition(result.risk, categories)
      : Math.min(riskToMeterPosition(result.range!.min, categories) + width / 2, 100);

  return (
    <section
      ref={ref}
      className={`panel panel--indigo panel--result${result ? ' is-assessed' : ''}${stale ? ' is-stale' : ''}`}
      style={{
        ['--level-color' as string]: tone.color,
        ['--level-soft' as string]: tone.soft,
        ['--level-on' as string]: tone.on,
        ['--level-text' as string]: tone.text,
      }}
      aria-live="polite"
      tabIndex={-1}
    >
      <header className="panel__head">
        <span className="panel__icon">
          <StarIcon size={18} />
        </span>
        <h2 className="panel__title">
          ผลการประเมินความเสี่ยง CVD <span>(Assessment Result)</span>
        </h2>
        <span className="panel__meta">{result ? result.variant : model.name}</span>
      </header>

      {stale && (
        <p className="assess__stale">
          <InfoIcon size={16} /> ข้อมูลมีการเปลี่ยนแปลง กด “คำนวณความเสี่ยง” อีกครั้งเพื่ออัปเดตผล
        </p>
      )}

      <div className="assess">
        <div className="assess__score">
          <span className="assess__caption">ค่าความเสี่ยง 10 ปี (10-Year CVD Risk Score)</span>
          <div className="assess__value-row">
            <output className={`assess__value${result?.risk === null ? ' assess__value--range' : ''}`}>{result ? result.display : '—'}</output>
            <span className="assess__pct">%</span>
          </div>

          <div className="progress" role="img" aria-label={result ? `ความเสี่ยง ${result.display}%` : 'ยังไม่ได้ประเมิน'}>
            <span className="progress__fill" style={{ width: `${position}%` }} />
            {categories.slice(1).map((c, i) => (
              <span key={c.id} className="progress__tick" style={{ left: `${(i + 1) * width}%` }} />
            ))}
          </div>

          <ul className="legend">
            {categories.map((c) => (
              <li key={c.id} className={c.id === category?.id ? 'is-current' : undefined}>
                <span className="legend__dot" style={{ background: TONES[c.tone].color }} />
                {rangeLabel(c.min, c.max)} {c.label.replace('ความเสี่ยง', '')} ({c.labelEn})
              </li>
            ))}
          </ul>

          <div className="assess__level">
            <span>ระดับความเสี่ยง (Risk Level)</span>
            <div className="assess__level-box">{category ? `${category.label} — ${category.labelEn}` : 'ยังไม่ได้ประเมิน'}</div>
          </div>
        </div>

        <div className="assess__status">
          <span className="assess__status-icon">{category ? <RiskLevelIcon tone={category.tone} size={40} /> : <StethoscopeIcon size={40} />}</span>
          <strong>{category ? category.label : 'ยังไม่ได้ประเมิน'}</strong>
          <span className="assess__status-en">{category ? category.labelEn.toUpperCase() : 'NOT ASSESSED'}</span>
          <span className="assess__status-advice">{category ? category.recommendations[0] : 'กรอกข้อมูลแล้วกด “คำนวณความเสี่ยง”'}</span>
        </div>
      </div>

      {result && category && (
        <div className="assess__more">
          <div className="assess__cols">
            <div className="interpretation">
              <StethoscopeIcon size={20} />
              <div>
                <h3>Clinical Interpretation</h3>
                <p>{category.interpretation}</p>
              </div>
            </div>
            <div className="advice">
              <h3 className="advice__title">
                <ClipboardIcon size={18} /> คำแนะนำการปฏิบัติตัว
              </h3>
              <ul className="advice__list">
                {category.recommendations.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </div>

          {result.details.length > 0 && (
            <dl className="details">
              {result.details.map((d) => (
                <div key={d.label}>
                  <dt>{d.label}</dt>
                  <dd>{d.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {result.notes.length > 0 && (
            <ul className="notes">
              {result.notes.map((n) => (
                <li key={n}>
                  <InfoIcon size={14} /> {n}
                </li>
              ))}
            </ul>
          )}

          <div className="result__actions">
            <button type="button" className="btn btn--outline" onClick={onToggleCompare} aria-expanded={compareOpen}>
              <CompareIcon size={18} /> {compareOpen ? 'ซ่อนตารางเปรียบเทียบ' : 'เปรียบเทียบผลทุกสูตร'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={onShowFormula}>
              <FunctionIcon size={18} /> สูตรที่ใช้คำนวณ
            </button>
          </div>
        </div>
      )}
    </section>
  );
});
