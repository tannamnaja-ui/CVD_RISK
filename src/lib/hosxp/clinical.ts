/**
 * Assessment inputs for every visit in the patient list, by the same rules as the assessment page:
 *  - SBP / waist / height / weight: this visit, else an earlier one that is recent enough (pickVitals)
 *  - TC / HDL: this visit's screening (opdscreen), else its lab-link result (sys_lab_code 4 / 6)
 *  - smoking: this visit's smoking_type with nhso_code 1 or 2
 *  - diabetes: E10–E14 ever, a glucose-lowering drug, or this visit's FBS ≥ 126 (diabetesFrom)
 */
import { SYS_LAB_CODE } from './sql';
import { diabetesFrom, type DiabetesFinding } from './diabetes';
import { pickVitals, screeningLipids, type PickedVital, type VitalsRow } from './vitals';

/** Raw rows of listScreeningSql, listHeightSql, listLabSql and listDiabetesSql. */
export interface ClinicalData {
  screenings: Record<string, unknown>[];
  heights: Record<string, unknown>[];
  labs: Record<string, unknown>[];
  diabetes: Record<string, unknown>[];
}

export interface LabValue {
  value: number;
  source: 'ซักประวัติ' | 'ผลแล็บ';
}

export interface Clinical {
  sbp?: PickedVital;
  waist?: PickedVital;
  height?: PickedVital;
  tc?: LabValue;
  hdl?: LabValue;
  smoke: boolean;
  dm: DiabetesFinding;
}

const day = (v: unknown) => String(v ?? '').slice(0, 10);
const positive = (v: unknown) => {
  const n = Number(String(v ?? '').trim());
  return v !== null && v !== undefined && Number.isFinite(n) && n > 0 && n < 1000 ? n : undefined;
};

/** Clinical values per VN for the listed visits. */
export function buildClinical(visits: { vn: string; hn?: string; vstdate?: string }[], data: ClinicalData): Map<string, Clinical> {
  const rowsByHn = new Map<string, VitalsRow[]>();
  for (const r of data.screenings) {
    const hn = String(r.hn);
    rowsByHn.set(hn, [...(rowsByHn.get(hn) ?? []), r as unknown as VitalsRow]);
  }
  const heightByHn = new Map(data.heights.map((r) => [String(r.hn), r]));
  const dmByHn = new Map(data.diabetes.map((r) => [String(r.hn), r]));
  const labsByVn = new Map<string, { tc?: number; hdl?: number; fbs: number[] }>();
  for (const r of data.labs) {
    const vn = String(r.vn);
    const value = positive(r.lab_order_result);
    if (value === undefined) continue;
    const l = labsByVn.get(vn) ?? { fbs: [] };
    const code = Number(r.sys_lab_code_id);
    if (code === SYS_LAB_CODE.tc) l.tc = value; // rows come in order, so the last result wins (as on the assessment page)
    if (code === SYS_LAB_CODE.hdl) l.hdl = value;
    if (code === 2) l.fbs.push(value);
    labsByVn.set(vn, l);
  }

  const out = new Map<string, Clinical>();
  for (const v of visits) {
    const vn = String(v.vn);
    const hn = String(v.hn ?? '');
    const date = day(v.vstdate);
    // earlier visits only (a later one must not fill in this visit), as the assessment page sees them
    const rows: VitalsRow[] = (rowsByHn.get(hn) ?? []).filter((r) => day(r.vstdate) <= date).map((r) => ({ ...r, visit_date: date }));
    const h = heightByHn.get(hn);
    if (h && day(h.vstdate) <= date) rows.push({ vn: `height:${hn}`, vstdate: h.vstdate, visit_date: date, height: h.height });
    const picked = pickVitals(rows, vn);
    const screen = screeningLipids(rows, vn);
    const lab = labsByVn.get(vn) ?? { fbs: [] };
    const current = rows.filter((r) => String(r.vn) === vn);
    const dm = dmByHn.get(hn);
    out.set(vn, {
      sbp: picked.bps,
      waist: picked.waist,
      height: picked.height,
      tc: screen.tc !== undefined ? { value: screen.tc, source: 'ซักประวัติ' } : lab.tc !== undefined ? { value: lab.tc, source: 'ผลแล็บ' } : undefined,
      hdl: screen.hdl !== undefined ? { value: screen.hdl, source: 'ซักประวัติ' } : lab.hdl !== undefined ? { value: lab.hdl, source: 'ผลแล็บ' } : undefined,
      smoke: current.some((r) => Number(r.smoking) === 1),
      dm: diabetesFrom({
        dm_icd10: dm?.dm_icd10,
        dm_drug: dm?.dm_drug,
        // highest screening FBS of the visit, as MAX(s.fbs) on the assessment page
        screen_fbs: Math.max(0, ...current.map((r) => positive(r.fbs) ?? 0)) || undefined,
        lab_fbs: lab.fbs.join(';'),
      }),
    });
  }
  return out;
}
