/** Auto-ticking "เบาหวาน" from HOSxP (row of diabetesSql). Pure functions. */
import { FPG_DM_THRESHOLD } from './sql';

export interface DiabetesRow {
  dm_icd10?: unknown;
  dm_drug?: unknown;
  screen_fbs?: unknown;
  /** lab results joined with ';' (text) */
  lab_fbs?: unknown;
}

export interface DiabetesFinding {
  dm: boolean;
  /** why it was ticked, e.g. "วินิจฉัย E119" */
  reasons: string[];
  /** FBS of this visit and where it came from, also when it is below the threshold */
  fbs?: { value: number; source: 'ซักประวัติ' | 'ผลแล็บ' };
}

const positive = (v: unknown) => {
  const n = Number(String(v ?? '').trim());
  return v !== null && v !== undefined && Number.isFinite(n) && n > 0 ? n : undefined;
};

export function diabetesFrom(row: DiabetesRow | undefined): DiabetesFinding {
  const reasons: string[] = [];
  const icd = String(row?.dm_icd10 ?? '').trim();
  const drug = String(row?.dm_drug ?? '').trim();
  if (icd) reasons.push(`วินิจฉัย ${icd}`);
  if (drug) reasons.push(`ได้รับยา ${drug}`);

  // FBS: the screening record of this visit first, otherwise the highest numeric lab result of this visit
  const screen = positive(row?.screen_fbs);
  const labValues = String(row?.lab_fbs ?? '')
    .split(';')
    .map(positive)
    .filter((v): v is number => v !== undefined && v < 1000);
  const fbs = screen !== undefined ? { value: screen, source: 'ซักประวัติ' as const } : labValues.length ? { value: Math.max(...labValues), source: 'ผลแล็บ' as const } : undefined;
  if (fbs && fbs.value >= FPG_DM_THRESHOLD) reasons.push(`FBS ${fbs.value} (${fbs.source})`);

  return { dm: reasons.length > 0, reasons, fbs };
}
