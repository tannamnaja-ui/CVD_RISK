import { useEffect, useState, type ReactNode } from 'react';
import { useHosxp, type LabLinkRow } from '../../hooks/useHosxp';
import { SYS_LAB_CODE } from '../../lib/hosxp/sql';
import { diabetesFrom } from '../../lib/hosxp/diabetes';
import { navigate } from '../../hooks/useHashRoute';
import type { FormValues } from '../../lib/formModel';
import { dateOf, timeOf, type PatientRow } from '../../lib/hosxp/patients';
import { VITAL_LABELS, pickVitals, screeningLipids, thaiDate, type PickedVital, type VitalKey } from '../../lib/hosxp/vitals';
import { CvRiskCalculator } from '../CvRiskCalculator';
import type { SummaryPatient } from '../PatientSummary';
import { CvdHistory } from './CvdHistory';
import { ArrowLeftIcon, InfoIcon, UserIcon } from '../Icons';
import { SELECTED_PATIENT_KEY } from './PatientListPage';

function loadSelected(vn: string): PatientRow | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(SELECTED_PATIENT_KEY) ?? 'null') as PatientRow | null;
    return p && String(p.vn) === vn ? p : null;
  } catch {
    return null;
  }
}

/** Positive number → form string; anything else → '' (left for the user to fill). */
const num = (v: unknown, digits = 1) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? String(Math.round(n * 10 ** digits) / 10 ** digits) : '';
};

/** HOSxP patient.sex: '1' = male, '2' = female. */
const genderOf = (sex: unknown): FormValues['gender'] => (String(sex) === '1' ? 'male' : String(sex) === '2' ? 'female' : '');

/** Which vitals were filled in, and which of them come from an earlier visit (with its date). */
function vitalsNoteOf(picked: Partial<Record<VitalKey, PickedVital>>): ReactNode {
  const keys = (['bps', 'waist', 'height', 'bw'] as VitalKey[]).filter((k) => picked[k]);
  if (!keys.length) return 'ไม่พบข้อมูลซักประวัติ (opdscreen) ของ visit นี้และ visit ก่อนหน้า — กรุณากรอกเอง';
  const earlier = keys.filter((k) => !picked[k]!.current);
  // values from the same earlier date are listed together, so the date is shown once
  const dates = [...new Set(earlier.map((k) => picked[k]!.date))];
  return (
    <>
      ดึงข้อมูลจากการซักประวัติ (opdscreen) แล้ว — กรุณาตรวจสอบก่อนบันทึก
      {dates.map((date) => (
        <span key={date} className="vitals-earlier">
          ค่าจาก visit {thaiDate(date)}:{' '}
          <b>
            {earlier
              .filter((k) => picked[k]!.date === date)
              .map((k) => `${VITAL_LABELS[k].label} ${picked[k]!.value}`)
              .join(' · ')}
          </b>{' '}
          — ควรวัดใหม่
        </span>
      ))}
    </>
  );
}

/** Latest numeric TC / HDL result of the visit (lab link); text results such as "pending" are skipped. */
function pickLabs(rows: LabLinkRow[]): { tc?: number; hdl?: number } {
  const out: { tc?: number; hdl?: number } = {};
  for (const r of rows) {
    const value = Number(String(r.lab_order_result ?? '').trim());
    if (!Number.isFinite(value) || value <= 0) continue;
    const code = Number(r.sys_lab_code_id);
    if (code === SYS_LAB_CODE.tc) out.tc = value;
    if (code === SYS_LAB_CODE.hdl) out.hdl = value;
  }
  return out;
}

/** Where TC and HDL came from: the screening record (opdscreen) first, otherwise the lab link. */
function labNoteOf(lab: { tc?: number; hdl?: number }, screen: { tc?: number; hdl?: number }, error: string | null): ReactNode {
  const source = (label: string, s?: number, l?: number) => (s !== undefined ? `${label} ${s} (ซักประวัติ)` : l !== undefined ? `${label} ${l} (ผลแล็บ)` : null);
  const tc = source('TC', screen.tc, lab.tc);
  const hdl = source('HDL', screen.hdl, lab.hdl);
  const parts = [tc, hdl].filter(Boolean);
  return (
    <span className="vitals-earlier">
      {parts.length > 0 && (
        <>
          ไขมัน visit นี้: <b>{parts.join(' · ')}</b>
        </>
      )}
      {!tc && (parts.length ? ' · ' : '') + 'ไม่พบ TC'}
      {!hdl && (parts.length || !tc ? ' · ' : '') + 'ไม่พบ HDL'}
      {error && ` · ดึงผลแล็บไม่ได้: ${error}`}
    </span>
  );
}

export function AssessPage({ vn }: { vn: string | null }) {
  const { vitals: fetchVitals, labs: fetchLabs, smoking: fetchSmoking, diabetes: fetchDiabetes } = useHosxp();
  const [patient] = useState(() => (vn ? loadSelected(vn) : null));
  const [initial, setInitial] = useState<Partial<FormValues> | null>(vn ? null : {});
  const [vitalsNote, setVitalsNote] = useState<ReactNode>(null);
  const sex = genderOf(patient?.sex);
  const summaryPatient: SummaryPatient | undefined = vn
    ? {
        name: patient?.ptname || '',
        hn: patient?.hn || '',
        vn,
        age: patient?.age || '',
        sex: sex === 'male' ? 'ชาย' : sex === 'female' ? 'หญิง' : '',
        visitDate: patient?.vstdate ? thaiDate(patient.vstdate) : '',
      }
    : undefined;

  useEffect(() => {
    if (!vn) return;
    let cancelled = false;
    const base: Partial<FormValues> = patient ? { age: num(patient.age_y, 0), gender: genderOf(patient.sex) } : {};
    (async () => {
      // lab results are optional: a failure there must not lose the vitals
      const [vitalsRes, labsRes, smokingRes, dmRes] = await Promise.allSettled([fetchVitals(vn), fetchLabs(vn), fetchSmoking(vn), fetchDiabetes(vn)]);
      if (cancelled) return;
      // smoking recorded at this visit's screening ticks the box; otherwise it is left for the user
      if (smokingRes.status === 'fulfilled' && smokingRes.value) base.smoke = true;
      // diabetes: diagnosis E10–E14, a glucose-lowering drug in the last year, or FBS ≥ 126 at this visit
      const dm = dmRes.status === 'fulfilled' ? diabetesFrom(dmRes.value) : null;
      if (dm?.dm) base.dm = true;
      const lab = labsRes.status === 'fulfilled' ? pickLabs(labsRes.value) : {};
      // TC and HDL: the screening record of this visit first, otherwise the lab result (lab link)
      const screen = vitalsRes.status === 'fulfilled' ? screeningLipids(vitalsRes.value, vn) : {};
      const labValues = { tc: num(screen.tc ?? lab.tc, 0), hdl: num(screen.hdl ?? lab.hdl) };
      const labLine = (
        <>
          {labNoteOf(lab, screen, labsRes.status === 'rejected' ? (labsRes.reason as Error).message : null)}
          {dm?.dm && (
            <span className="vitals-earlier">
              ติ๊กเบาหวานอัตโนมัติ: <b>{dm.reasons.join(' · ')}</b>
            </span>
          )}
          {dmRes.status === 'rejected' && <span className="vitals-earlier">ตรวจข้อมูลเบาหวานไม่ได้: {(dmRes.reason as Error).message}</span>}
        </>
      );
      if (vitalsRes.status === 'fulfilled') {
        const picked = pickVitals(vitalsRes.value, vn);
        const vitals = { sbp: num(picked.bps?.value, 0), weight: num(picked.bw?.value), height: num(picked.height?.value), waist: num(picked.waist?.value) };
        setVitalsNote(
          <>
            {vitalsNoteOf(picked)}
            {labLine}
          </>,
        );
        setInitial({ ...base, ...Object.fromEntries(Object.entries({ ...vitals, ...labValues }).filter(([, x]) => x)) });
      } else {
        setVitalsNote(
          <>
            ดึงข้อมูลซักประวัติไม่ได้: {(vitalsRes.reason as Error).message}
            {labLine}
          </>,
        );
        setInitial({ ...base, ...Object.fromEntries(Object.entries(labValues).filter(([, x]) => x)) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [vn, patient, fetchVitals, fetchLabs, fetchSmoking, fetchDiabetes]);

  return (
    <div className="assess-page">
      {vn && (
        <section className="patient-banner">
          <button type="button" className="pbtn pbtn--ghost" onClick={() => navigate('/')}>
            <ArrowLeftIcon size={16} /> รายการผู้ป่วย
          </button>
          <span className="patient-banner__avatar">
            <UserIcon size={22} />
          </span>
          {patient ? (
            <div className="patient-banner__info">
              <strong>{patient.ptname || `HN ${patient.hn}`}</strong>
              <span>
                HN <b>{patient.hn}</b> · VN {patient.vn} · {patient.age || '–'} · {genderOf(patient.sex) === 'male' ? 'ชาย' : genderOf(patient.sex) === 'female' ? 'หญิง' : 'ไม่ระบุเพศ'}
              </span>
              <span>
                มา {dateOf(patient.vstdate)} {timeOf(patient.vsttime)} · {patient.department || '–'} · สิทธิ {patient.pttype || '–'}
              </span>
            </div>
          ) : (
            <div className="patient-banner__info">
              <strong>VN {vn}</strong>
              <span>ไม่พบข้อมูลผู้ป่วยในหน้ารายการ — กรอกข้อมูลเองได้</span>
            </div>
          )}
          {vitalsNote && (
            <p className="patient-banner__note">
              <InfoIcon size={18} /> <span>{vitalsNote}</span>
            </p>
          )}
        </section>
      )}

      {initial === null ? (
        <div className="assess-page__loading">
          <span className="spinner" /> กำลังดึงข้อมูลผู้ป่วย...
        </div>
      ) : (
        // after a successful save, back to the patient list (it refreshes the screening status on return)
        <CvRiskCalculator key={vn ?? 'blank'} initialValues={initial} vn={vn ?? undefined} patient={summaryPatient} onSaved={() => navigate('/')} />
      )}
      {vn && <CvdHistory vn={vn} reload={0} />}
    </div>
  );
}
