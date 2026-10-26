import { ENGINES, type EngineId } from '../lib/engines';
import { FunctionIcon } from './Icons';

interface EngineSelectorProps {
  value: EngineId;
  hidden: EngineId[];
  onChange: (engine: EngineId) => void;
  /** open the formula of one card ("สูตรที่ใช้") without selecting it */
  onShowFormula: (engine: EngineId) => void;
}

export function EngineSelector({ value, hidden, onChange, onShowFormula }: EngineSelectorProps) {
  return (
    <div className="engines" role="radiogroup" aria-label="เลือกสูตรประเมิน">
      {ENGINES.map((e, i) =>
        hidden.includes(e.id) ? null : (
          // the card and its formula button are siblings — a button may not contain another button
          <div key={e.id} className={`engine-wrap${e.id === value ? ' is-active' : ''}`}>
            <button type="button" role="radio" aria-checked={e.id === value} className={`engine${e.id === value ? ' is-active' : ''}`} onClick={() => onChange(e.id)}>
              <span className="engine__num">{i + 1}</span>
              <span className="engine__text">
                <span className="engine__label">{e.label}</span>
                <span className="engine__sub">{e.sublabel}</span>
              </span>
              <span className="engine__age">{e.ageLabel}</span>
            </button>
            <button type="button" className="engine__formula" onClick={() => onShowFormula(e.id)} aria-label={`สูตรที่ใช้ของ ${e.label}`}>
              <FunctionIcon size={14} /> สูตรที่ใช้
            </button>
          </div>
        ),
      )}
    </div>
  );
}
