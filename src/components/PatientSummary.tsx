import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBmsSessionContext } from '../contexts/BmsSessionContext';
import { useHosxp } from '../hooks/useHosxp';
import { THAI_CATEGORIES, THAI_FORMULAS } from '../lib/engines/thai';
import type { FormValues } from '../lib/formModel';
import { CVD_LEVEL_COLORS } from '../lib/hosxp/patients';
import { thaiDate } from '../lib/hosxp/vitals';
import { modifiableFactors, thaiWhatIf } from '../lib/whatIf';
import { dataMode } from '../services/dataMode';
import { useDirectUser } from './DirectLogin';
import { PrinterIcon } from './Icons';
import { Modal } from './Modal';

/** Patient details printed on the sheet (from the patient list). */
export interface SummaryPatient {
  name: string;
  hn: string;
  vn: string;
  age: string;
  sex: string;
  /** dd/mm/yyyy (B.E.) */
  visitDate: string;
}

interface PatientSummaryProps {
  open: boolean;
  onClose: () => void;
  values: FormValues;
  patient?: SummaryPatient;
}

const levelOf = (categoryId: string) => THAI_CATEGORIES.findIndex((c) => c.id === categoryId) + 1;
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Patient summary sheet: Thai CV Risk result, modifiable risk factors, "what if" scenarios and advice.
 * Shown as a preview; printing prints only the sheet (a copy rendered at the end of <body>).
 */
export function PatientSummary({ open, onClose, values, patient }: PatientSummaryProps) {
  useEffect(() => {
    if (!open) return;
    document.body.classList.add('printing-summary');
    return () => document.body.classList.remove('printing-summary');
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ใบสรุปผลสำหรับผู้ป่วย"
      subtitle="ตรวจสอบก่อนพิมพ์ — พิมพ์ได้บนกระดาษ A4 หนึ่งแผ่น"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            ปิด
          </button>
          <button type="button" className="btn btn--primary" onClick={() => window.print()}>
            <PrinterIcon size={18} /> พิมพ์
          </button>
        </>
      }
    >
      {open && (
        <>
          <SummarySheet values={values} patient={patient} />
          {createPortal(
            <div className="print-root">
              <SummarySheet values={values} patient={patient} />
            </div>,
            document.body,
          )}
        </>
      )}
    </Modal>
  );
}

function SummarySheet({ values, patient }: { values: FormValues; patient?: SummaryPatient }) {
  const { hospitalName } = useHosxp();
  const [hospital, setHospital] = useState('');
  const officer = useDirectUser();
  const { userInfo } = useBmsSessionContext();
  const assessor = dataMode() === 'direct' ? officer?.user.name : userInfo?.name;

  useEffect(() => {
    hospitalName()
      .then(setHospital)
      .catch(() => {
        // cosmetic
      });
  }, [hospitalName]);

  const whatIf = thaiWhatIf(values);
  if (!whatIf) return <p className="history__empty">ข้อมูลสำหรับ Thai CV Risk ยังไม่ครบ</p>;
  const { base, scenarios } = whatIf;
  const level = levelOf(base.category.id);
  const color = CVD_LEVEL_COLORS[level];
  const factors = modifiableFactors(values);
  const formula = THAI_FORMULAS[values.thaiMode];
  const usesLab = values.thaiMode !== 'nonlab';

  const data: [string, string][] = [
    ['อายุ', `${values.age} ปี`],
    ['เพศ', values.gender === 'male' ? 'ชาย' : 'หญิง'],
    ['ความดันตัวบน (SBP)', `${values.sbp} mmHg`],
    ['เบาหวาน', values.dm ? 'เป็น' : 'ไม่เป็น'],
    ['สูบบุหรี่', values.smoke ? 'สูบ' : 'ไม่สูบ'],
    ...(usesLab ? ([['โคเลสเตอรอลรวม (TC)', `${values.tc} mg/dL`]] as [string, string][]) : []),
    ...(values.thaiMode === 'ratio' ? ([['HDL', `${values.hdl} mg/dL`]] as [string, string][]) : []),
    ...(!usesLab
      ? ([
          ['รอบเอว', `${values.waist} ซม.`],
          ['ส่วนสูง', `${values.height} ซม.`],
        ] as [string, string][])
      : []),
  ];

  return (
    <article className="summary-sheet">
      <header className="summary-sheet__head">
        <div>
          <p className="summary-sheet__hospital">{hospital}</p>
          <h3>ผลการประเมินโอกาสเสี่ยงต่อการเกิดโรคหัวใจและหลอดเลือดใน 10 ปีข้างหน้า</h3>
          <p className="summary-sheet__sub">Thai CV Risk Score · พิมพ์วันที่ {thaiDate(todayIso())}</p>
        </div>
      </header>

      <dl className="summary-sheet__patient">
        <div>
          <dt>ชื่อ-สกุล</dt>
          <dd>{patient?.name || '................................................'}</dd>
        </div>
        <div>
          <dt>HN</dt>
          <dd>{patient?.hn || '–'}</dd>
        </div>
        <div>
          <dt>อายุ / เพศ</dt>
          <dd>
            {values.age} ปี / {values.gender === 'male' ? 'ชาย' : 'หญิง'}
          </dd>
        </div>
        <div>
          <dt>วันที่ประเมิน</dt>
          <dd>{patient?.visitDate || thaiDate(todayIso())}</dd>
        </div>
      </dl>

      <section className="summary-result" style={{ borderColor: color.color }}>
        <div className="summary-result__score" style={{ background: color.color, color: color.text }}>
          <span>โอกาสเสี่ยง</span>
          <strong>{base.risk!.toFixed(1)}%</strong>
          <span>{base.category.label}</span>
        </div>
        <div className="summary-result__text">
          <p>
            ใน 100 คนที่มีข้อมูลสุขภาพแบบเดียวกับท่าน จะเกิดโรคหัวใจหรือหลอดเลือดสมองภายใน 10 ปี ประมาณ <b>{Math.round(base.risk!)}</b> คน
          </p>
          <p className="summary-result__interp">{base.category.interpretation}</p>
          <div className="summary-scale" aria-label="ระดับความเสี่ยง 5 ระดับ">
            {THAI_CATEGORIES.map((c, i) => (
              <span
                key={c.id}
                className={`summary-scale__seg${i + 1 === level ? ' is-current' : ''}`}
                style={{ background: CVD_LEVEL_COLORS[i + 1].color, color: CVD_LEVEL_COLORS[i + 1].text }}
              >
                {c.label}
                <small>{c.max === Infinity ? `≥ ${c.min}%` : `${c.min}–<${c.max}%`}</small>
              </span>
            ))}
          </div>
        </div>
      </section>

      <div className="summary-sheet__cols">
        <section>
          <h4>ข้อมูลที่ใช้ประเมิน</h4>
          <table className="summary-table">
            <tbody>
              {data.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h4>ปัจจัยเสี่ยงที่ปรับเปลี่ยนได้</h4>
          {factors.length ? (
            <ul className="summary-list">
              {factors.map((f) => (
                <li key={f.id}>
                  <b>{f.label}</b> — {f.advice}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">ไม่พบปัจจัยเสี่ยงที่ปรับเปลี่ยนได้จากข้อมูลนี้ — รักษาพฤติกรรมที่ดีต่อไป</p>
          )}
        </section>
      </div>

      {scenarios.length > 0 && (
        <section>
          <h4>ถ้าปรับเปลี่ยนได้ ความเสี่ยงจะลดลงเหลือเท่าไร</h4>
          <table className="summary-table summary-table--whatif">
            <thead>
              <tr>
                <th>ถ้า...</th>
                <th>ความเสี่ยง</th>
                <th>ระดับ</th>
                <th>ลดลง</th>
              </tr>
            </thead>
            <tbody>
              <tr className="is-base">
                <td>ตอนนี้</td>
                <td className="num">{base.risk!.toFixed(1)}%</td>
                <td>
                  <LevelChip categoryId={base.category.id} />
                </td>
                <td className="num">–</td>
              </tr>
              {scenarios.map((s) => (
                <tr key={s.id} className={s.id === 'all' ? 'is-all' : undefined}>
                  <td>{s.label}</td>
                  <td className="num">
                    <b>{s.result.risk!.toFixed(1)}%</b>
                  </td>
                  <td>
                    <LevelChip categoryId={s.result.category.id} />
                  </td>
                  <td className="num">{(base.risk! - s.result.risk!).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h4>คำแนะนำ</h4>
        <ul className="summary-list">
          {base.category.recommendations.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </section>

      <footer className="summary-sheet__foot">
        <p>
          คำนวณด้วย {formula.name} · ผลเป็นการคาดการณ์ทางสถิติ ใช้ประกอบการให้คำแนะนำ ไม่ใช่การวินิจฉัยโรค
        </p>
        <p className="summary-sheet__sign">ผู้ประเมิน ........................................ {assessor ? `(${assessor})` : ''}</p>
      </footer>
    </article>
  );
}

function LevelChip({ categoryId }: { categoryId: string }) {
  const level = levelOf(categoryId);
  const c = CVD_LEVEL_COLORS[level];
  return (
    <span className="result-badge" style={{ background: c.color, color: c.text }}>
      {THAI_CATEGORIES[level - 1].label}
    </span>
  );
}
