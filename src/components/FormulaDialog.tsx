import { ENGINES, type EngineId } from '../lib/engines';
import { FORMULAS } from '../lib/engines/formulas';
import { ExternalLinkIcon } from './Icons';
import { Modal } from './Modal';

interface FormulaDialogProps {
  engine: EngineId | null;
  onSelect: (engine: EngineId) => void;
  onClose: () => void;
}

export function FormulaDialog({ engine, onSelect, onClose }: FormulaDialogProps) {
  const info = FORMULAS[engine ?? 'thai'];

  return (
    <Modal open={engine !== null} onClose={onClose} title="สูตรที่ใช้คำนวณ" subtitle="สมการ สัมประสิทธิ์ เกณฑ์แปลผล และแหล่งอ้างอิงของแต่ละสูตร" size="lg">
      <div className="formula-tabs" role="tablist" aria-label="เลือกสูตร">
        {ENGINES.map((e, i) => (
          <button
            key={e.id}
            type="button"
            role="tab"
            aria-selected={e.id === engine}
            className={`formula-tab${e.id === engine ? ' is-active' : ''}`}
            onClick={() => onSelect(e.id)}
          >
            <span className="formula-tab__num">{i + 1}</span>
            {e.label}
          </button>
        ))}
      </div>

      <article className="formula" key={info.engine}>
        <h3 className="formula__title">{info.title}</h3>
        <p className="formula__summary">{info.summary}</p>

        {info.sections.map((s) => (
          <section key={s.heading} className="formula__section">
            <h4>{s.heading}</h4>
            {s.equations && (
              <div className="formula__eqs">
                {s.equations.map((eq) => (
                  <code key={eq}>{eq}</code>
                ))}
              </div>
            )}
            {s.text && (
              <ul className="formula__text">
                {s.text.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
            {s.image && (
              <figure className="formula__figure">
                <a href={s.image.src} target="_blank" rel="noopener noreferrer" title="เปิดภาพขนาดเต็ม">
                  <img src={s.image.src} alt={s.image.alt} loading="lazy" />
                </a>
                <figcaption>{s.image.caption}</figcaption>
              </figure>
            )}
            {s.table && (
              <div className="formula__table-wrap">
                <table className="formula__table">
                  <thead>
                    <tr>
                      {s.table.columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.table.rows.map((row) => (
                      <tr key={row[0]}>
                        {row.map((cell, i) => (i === 0 ? <th key={i} scope="row">{cell}</th> : <td key={i}>{cell}</td>))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}

        <section className="formula__section formula__sources">
          <h4>Sources</h4>
          <ol>
            {info.sources.map((src) => (
              <li key={src.url}>
                <a href={src.url} target="_blank" rel="noopener noreferrer">
                  {src.label}
                  <ExternalLinkIcon size={14} />
                </a>
              </li>
            ))}
          </ol>
        </section>
      </article>
    </Modal>
  );
}
