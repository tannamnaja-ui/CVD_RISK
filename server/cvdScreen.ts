/**
 * Save the Thai CV Risk result of a visit to HOSxP table opdscreen_cvd (one row per VN).
 *
 * The server recomputes the score from the submitted inputs with the same engine the app uses,
 * so what is stored always matches the formula. IDs come from HOSxP's own serial table
 * (get_serialnumber_check_exist on PostgreSQL), as HOSxP itself does.
 */
import { THAI_CATEGORIES } from '../src/lib/engines/thai';
import { assess, modelFor } from '../src/lib/engines';
import { EMPTY_FORM, parseNumber, resolveThaiMode, toPatient, validateForModel, type FormValues, type ThaiFormulaChoice } from '../src/lib/formModel';
import { sqlVn } from '../src/lib/hosxp/sql';
import type { Db } from './db';

export interface CvdScreenInput {
  vn: string;
  age: string;
  gender: 'male' | 'female';
  sbp: string;
  dm: boolean;
  smoke: boolean;
  tc?: string;
  hdl?: string;
  waist?: string;
  /** formula picked in the app (default: automatic) */
  thaiFormula?: ThaiFormulaChoice;
  height?: string;
}

export interface CvdScreenRow {
  vn: string;
  screen_datetime: string | null;
  is_smoking: string | null;
  is_diabetes: string | null;
  risk_score: string | number | null;
  tc: string | number | null;
  staff: string | null;
  cvd_risk_score_type_id: number | null;
  cvd_risk_score_type_name?: string | null;
}

/** Thai CV Risk from the inputs; throws with a readable message when the data is incomplete or out of range. */
export function thaiResult(input: CvdScreenInput) {
  const values: FormValues = {
    ...EMPTY_FORM,
    age: String(input.age ?? ''),
    gender: input.gender === 'male' || input.gender === 'female' ? input.gender : '',
    sbp: String(input.sbp ?? ''),
    dm: !!input.dm,
    smoke: !!input.smoke,
    tc: String(input.tc ?? ''),
    hdl: String(input.hdl ?? ''),
    waist: String(input.waist ?? ''),
    height: String(input.height ?? ''),
  };
  // same choice as on screen: the picked formula, or automatic from the lab values
  values.thaiFormula = ['auto', 'ratio', 'lab', 'nonlab'].includes(String(input.thaiFormula)) ? (input.thaiFormula as ThaiFormulaChoice) : 'auto';
  values.thaiMode = resolveThaiMode(values);
  const model = modelFor('thai', values.thaiMode);
  const errors = Object.values(validateForModel(values, model));
  if (errors.length) throw new Error(`ข้อมูลไม่ครบหรือไม่ถูกต้องสำหรับ Thai CV Risk: ${errors.join(', ')}`);
  const outcome = assess(model, toPatient(values));
  if (outcome.status !== 'ok') throw new Error('คำนวณ Thai CV Risk ไม่ได้ด้วยข้อมูลนี้');

  const typeId = THAI_CATEGORIES.findIndex((c) => c.id === outcome.result.category.id) + 1;
  return {
    risk: outcome.result.risk!,
    typeId,
    tc: values.thaiMode === 'nonlab' ? null : parseNumber(values.tc)!,
    smoke: values.smoke,
    dm: values.dm,
  };
}

export async function getCvdScreen(db: Db, vn: string): Promise<CvdScreenRow | null> {
  const rows = await db.query(
    `SELECT c.vn, c.screen_datetime, c.is_smoking, c.is_diabetes, c.risk_score, c.tc, c.staff, c.cvd_risk_score_type_id, t.cvd_risk_score_type_name
       FROM opdscreen_cvd c
       LEFT JOIN cvd_risk_score_type t ON t.cvd_risk_score_type_id = c.cvd_risk_score_type_id
      WHERE c.vn = ?`,
    [vn],
  );
  return (rows[0] as unknown as CvdScreenRow) ?? null;
}

async function nextId(db: Db): Promise<number> {
  if (db.dialect === 'postgresql') {
    // HOSxP's own allocator: seeds a sequence from the `serial` table and skips ids already in the table
    const [row] = await db.query(`SELECT get_serialnumber_check_exist('opdscreen_cvd_id', 'opdscreen_cvd', 'opdscreen_cvd_id') AS id`);
    const id = Number(row?.id);
    if (Number.isInteger(id) && id > 0) return id;
  }
  const [row] = await db.query('SELECT COALESCE(MAX(opdscreen_cvd_id), 0) + 1 AS id FROM opdscreen_cvd');
  return Number(row.id);
}

/** Insert or update the visit's row (vn is unique). */
export async function saveCvdScreen(db: Db, input: CvdScreenInput, staff: string): Promise<CvdScreenRow> {
  sqlVn(input.vn); // reject malformed VNs early
  const visit = await db.query('SELECT vn FROM ovst WHERE vn = ?', [input.vn]);
  if (!visit.length) throw new Error(`ไม่พบ visit VN ${input.vn}`);

  const r = thaiResult(input);
  const values = [
    r.smoke ? 'Y' : 'N',
    r.dm ? 'Y' : 'N',
    Math.round(r.risk * 1000) / 1000, // numeric(15,3): risk in percent
    r.tc,
    Math.round(r.risk * 1e9) / 1e9, // numeric(22,9): the same risk at full precision
    staff.slice(0, 20),
    r.typeId,
  ];

  const existing = await db.query('SELECT opdscreen_cvd_id FROM opdscreen_cvd WHERE vn = ?', [input.vn]);
  if (existing.length) {
    await db.query(
      `UPDATE opdscreen_cvd
          SET screen_datetime = CURRENT_TIMESTAMP, is_smoking = ?, is_diabetes = ?, risk_score = ?, tc = ?,
              pfull_score = ?, staff = ?, cvd_risk_score_type_id = ?
        WHERE vn = ?`,
      [...values, input.vn],
    );
  } else {
    await db.query(
      `INSERT INTO opdscreen_cvd
         (opdscreen_cvd_id, vn, screen_datetime, is_smoking, is_diabetes, risk_score, tc, pfull_score, staff, cvd_risk_score_type_id)
       VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)`,
      [await nextId(db), input.vn, ...values],
    );
  }
  console.log(`[opdscreen_cvd] ${existing.length ? 'แก้ไข' : 'บันทึก'} VN ${input.vn} risk ${r.risk.toFixed(2)}% type ${r.typeId} โดย ${staff}`);
  return (await getCvdScreen(db, input.vn))!;
}
