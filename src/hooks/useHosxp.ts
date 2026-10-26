import { useCallback } from 'react';
import { useBmsSessionContext } from '../contexts/BmsSessionContext';
import type { PatientRow, RiskRow } from '../lib/hosxp/patients';
import { LIST_QUERY_VARIANTS, cvdHistorySql, diabetesSql, hospitalSql, labLinkSql, listDiabetesSql, listHeightSql, listLabSql, listScreeningSql, smokingSql, patientNamesSql, patientsSql, riskFactorsSql, vitalsHistorySql, type Dialect } from '../lib/hosxp/sql';
import type { VitalsRow } from '../lib/hosxp/vitals';
import type { DiabetesRow } from '../lib/hosxp/diabetes';
import type { ClinicalData } from '../lib/hosxp/clinical';
import { buildFollowUp, followUpContactsSql, withContacts, type FollowUp } from '../lib/followUp';
import { dataMode } from '../services/dataMode';
import { serverCall } from '../services/directAuth';

let dialectPromise: Promise<Dialect> | null = null;

/** Index into LIST_QUERY_VARIANTS that last worked through the BMS API (kept for the page session). */
let workingVariant = 0;

/** Approved authorization requests, keyed by the exact SQL they were approved for (this tab only). */
const approvedRequests = new Map<string, string>();

/**
 * The BMS API refused the query because it reads protected personal fields. The user must approve
 * `requestId` in the HOSxP application; the very same SQL is then re-run with that id.
 */
export class PrivacyBlockedError extends Error {
  constructor(
    message: string,
    public readonly requestId: string,
    public readonly sql: string,
  ) {
    super(message);
    this.name = 'PrivacyBlockedError';
  }
}

/** Row of labLinkSql. */
export interface LabLinkRow {
  sys_lab_code_id: unknown;
  lab_order_result: unknown;
}

/** Row of cvdHistorySql: one saved Thai CV Risk result of the patient. */
export interface CvdHistoryRow {
  vn: unknown;
  vstdate: unknown;
  screen_datetime?: unknown;
  risk_score: unknown;
  level: unknown;
  level_name?: unknown;
  tc?: unknown;
  is_smoking?: unknown;
  is_diabetes?: unknown;
  staff?: unknown;
}

/**
 * Patient data for the app, from one of two sources (see services/dataMode):
 * the BMS API when opened from HOSxP XE, otherwise the local direct-database server.
 */
export function useHosxp() {
  const { executeQuery, connectionConfig } = useBmsSessionContext();
  const mode = dataMode();

  // ---------- BMS API ----------

  const query = useCallback(
    async <T = Record<string, unknown>>(sql: string, privacyRequestId?: string): Promise<T[]> => {
      const requestId = privacyRequestId ?? approvedRequests.get(sql);
      const r = await executeQuery<T>(sql, requestId);
      if (r.ok) {
        if (requestId) approvedRequests.set(sql, requestId);
        return r.data;
      }
      if (r.privacyRequestId) {
        approvedRequests.delete(sql);
        throw new PrivacyBlockedError(r.error ?? 'SENSITIVE_BLOCKED', r.privacyRequestId, sql);
      }
      throw new Error(r.error ?? 'Query error');
    },
    [executeQuery],
  );

  /** HOSxP runs on PostgreSQL or MySQL; detected once per page load. */
  const dialect = useCallback((): Promise<Dialect> => {
    dialectPromise ??= query<Record<string, unknown>>('SELECT VERSION() AS v')
      .then((rows) => (/postgres/i.test(String(Object.values(rows[0] ?? {})[0] ?? '')) ? 'postgresql' : 'mysql') as Dialect)
      .catch((e) => {
        dialectPromise = null;
        throw e;
      });
    return dialectPromise;
  }, [query]);

  // ---------- direct-database server ----------

  const api = useCallback(<T,>(path: string): Promise<T> => serverCall<T>(path), []);

  // ---------- operations used by the pages ----------

  const hospitalName = useCallback(async (): Promise<string> => {
    if (mode === 'direct') return (await api<{ hospitalname: string }>('/api/hospital')).hospitalname;
    const rows = await query<{ hospitalname?: string }>(hospitalSql());
    return String(rows[0]?.hospitalname ?? '');
  }, [api, mode, query]);

  /** Visit list. Direct mode includes names; BMS mode leaves them out (they need approval — see loadNames). */
  const listPatients = useCallback(
    async (from: string, to: string): Promise<{ rows: PatientRow[]; namesIncluded: boolean }> => {
      if (mode === 'direct') {
        const qs = new URLSearchParams({ dateFrom: from, dateTo: to });
        return { rows: await api<PatientRow[]>(`/api/patients?${qs}`), namesIncluded: true };
      }
      const d = await dialect();
      const failures: string[] = [];
      // Start from the variant that worked before; on failure step down to simpler queries.
      for (let i = workingVariant; i < LIST_QUERY_VARIANTS.length; i++) {
        const variant = LIST_QUERY_VARIANTS[i];
        try {
          const rows = await query<PatientRow>(patientsSql(d, from, to, variant.options));
          workingVariant = i;
          if (failures.length) console.warn(`[patients] ใช้ query แบบ "${variant.label}" แทน —`, failures.join(' | '));
          return { rows, namesIncluded: false };
        } catch (e) {
          failures.push(`${variant.label}: ${(e as Error).message}`);
        }
      }
      throw new Error(failures.join(' | '));
    },
    [api, dialect, mode, query],
  );

  /** BMS mode only: patient/doctor names, which the API releases after approval in HOSxP. */
  const loadNames = useCallback(
    async (from: string, to: string, retry?: { sql: string; requestId: string }) => {
      const sql = retry?.sql ?? patientNamesSql(await dialect(), from, to, LIST_QUERY_VARIANTS[workingVariant].options.sanitize);
      return query<Pick<PatientRow, 'vn' | 'ptname' | 'doctor'>>(sql, retry?.requestId);
    },
    [dialect, query],
  );

  /** Diagnosis-history flags + screening vitals for the major-risk-factor filter. */
  const loadRiskFactors = useCallback(
    async (from: string, to: string): Promise<RiskRow[]> => {
      if (mode === 'direct') return api<RiskRow[]>(`/api/risk-factors?${new URLSearchParams({ dateFrom: from, dateTo: to })}`);
      return query<RiskRow>(riskFactorsSql(from, to));
    },
    [api, mode, query],
  );

  /** Screening vitals of this visit and the patient's earlier visits (see pickVitals). */
  const vitals = useCallback(
    async (vn: string): Promise<VitalsRow[]> => {
      if (mode === 'direct') return api<VitalsRow[]>(`/api/opdscreen/${encodeURIComponent(vn)}`);
      return query<VitalsRow>(vitalsHistorySql(vn));
    },
    [api, mode, query],
  );

  /** TC / HDL results of this visit from HOSxP's lab link (sys_lab_link). */
  const labs = useCallback(
    async (vn: string): Promise<LabLinkRow[]> => {
      if (mode === 'direct') return api<LabLinkRow[]>(`/api/lab-link/${encodeURIComponent(vn)}`);
      return query<LabLinkRow>(labLinkSql(vn));
    },
    [api, mode, query],
  );

  /** Does this visit's screening record smoking (smoking_type nhso_code 1 or 2)? */
  const smoking = useCallback(
    async (vn: string): Promise<boolean> => {
      if (mode === 'direct') return (await api<unknown[]>(`/api/smoking/${encodeURIComponent(vn)}`)).length > 0;
      return (await query(smokingSql(vn))).length > 0;
    },
    [api, mode, query],
  );

  /** Diabetes signals of the patient of this visit (diagnosis, drugs, FBS). */
  const diabetes = useCallback(
    async (vn: string): Promise<DiabetesRow | undefined> => {
      if (mode === 'direct') return (await api<DiabetesRow[]>(`/api/diabetes/${encodeURIComponent(vn)}`))[0];
      return (await query<DiabetesRow>(diabetesSql(await dialect(), vn)))[0];
    },
    [api, dialect, mode, query],
  );

  /**
   * Follow-up worklists. Direct mode: from the data server, names included. BMS mode: built here from
   * BMS API queries without protected fields — names come from followUpContacts after approval.
   */
  const followUp = useCallback(async (): Promise<FollowUp> => {
    if (mode === 'direct') return api<FollowUp>('/api/follow-up');
    const d = await dialect();
    return buildFollowUp({ dialect: d, query: (sql) => query(sql) });
  }, [api, dialect, mode, query]);

  /** BMS mode: names / phones / addresses for the worklists; throws PrivacyBlockedError until approved in HOSxP. */
  const followUpContacts = useCallback(
    async (f: FollowUp, retry?: { sql: string; requestId: string }): Promise<FollowUp> => {
      const sql = retry?.sql ?? followUpContactsSql(await dialect());
      return withContacts(f, await query(sql, retry?.requestId));
    },
    [dialect, query],
  );

  /** Assessment inputs for the whole patient list (see lib/hosxp/clinical.ts). */
  const loadClinical = useCallback(
    async (from: string, to: string): Promise<ClinicalData> => {
      if (mode === 'direct') return api<ClinicalData>(`/api/clinical?${new URLSearchParams({ dateFrom: from, dateTo: to })}`);
      const [screenings, heights, labs, diabetes] = await Promise.all([
        query(listScreeningSql(from, to)),
        query(listHeightSql(from, to)),
        query(listLabSql(from, to)),
        query(listDiabetesSql(from, to)),
      ]);
      return { screenings, heights, labs, diabetes };
    },
    [api, mode, query],
  );

  /** Every Thai CV Risk result saved for the patient of this visit, oldest first. */
  const cvdHistory = useCallback(
    async (vn: string): Promise<CvdHistoryRow[]> => {
      if (mode === 'direct') return api<CvdHistoryRow[]>(`/api/cvd-history/${encodeURIComponent(vn)}`);
      return query<CvdHistoryRow>(cvdHistorySql(vn));
    },
    [api, mode, query],
  );

  /** After a failure: is the data source unreachable, or is only this query the problem? */
  const diagnose = useCallback(async (): Promise<string> => {
    if (mode === 'direct') {
      try {
        const res = await fetch('/api/health');
        const h = (await res.json()) as { data?: { db: boolean; error: string | null; config: string } };
        if (!h.data) return 'data server ตอบกลับไม่ถูกต้อง';
        return h.data.db
          ? 'data server เชื่อมต่อฐานข้อมูลได้ปกติ — ปัญหาอยู่ที่คำขอนี้ ดูรายละเอียดในหน้าต่าง terminal ของ server'
          : `data server ยังเชื่อมต่อฐานข้อมูลไม่ได้: ${h.data.error} (ไฟล์ตั้งค่า ${h.data.config})`;
      } catch {
        return 'ติดต่อ data server ไม่ได้ — รันคำสั่ง npm run dev ในโฟลเดอร์โปรเจค หรือเปิดแอปผ่าน HOSxP XE เพื่อใช้ BMS API';
      }
    }
    if (!connectionConfig) return 'BMS Session นี้ไม่มีค่า hosxp.api_url จึงเข้าฐานข้อมูลผ่าน BMS ไม่ได้';
    const apiUrl = connectionConfig.apiUrl;
    try {
      await query('SELECT 1 AS ok');
      return `เชื่อมต่อฐานข้อมูลผ่าน ${apiUrl} ได้ปกติ (SELECT 1 สำเร็จ) — ปัญหาอยู่ที่ query นี้โดยเฉพาะ`;
    } catch (e) {
      // A tunnel whose hospital-side agent is offline answers 502 without CORS headers,
      // which the browser reports as a plain network error.
      return `เรียก ${apiUrl} ไม่ได้เลย (${(e as Error).message}) — สาเหตุที่พบบ่อย: HOSxP XE ไม่ได้เปิดหรือไม่ได้ login (tunnel ตอบ 502), เครื่องนี้เข้าเครือข่ายไม่ได้ หรือ API ไม่อนุญาต CORS จาก ${window.location.origin}`;
    }
  }, [connectionConfig, mode, query]);

  return { mode, hospitalName, listPatients, loadNames, loadRiskFactors, vitals, labs, smoking, diabetes, loadClinical, followUp, followUpContacts, cvdHistory, diagnose };
}
