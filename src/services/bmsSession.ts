const PASTE_JSON_URL = 'https://hosxp.net/phapi/PasteJSON';
const APP_NAME = 'BMS.Dashboard.React';
const REQUEST_TIMEOUT_MS = 30_000;

export interface BmsUserInfo {
  name?: string;
  location?: string;
  doctor_code?: string;
  bms_url?: string;
  bms_session_code?: string;
  'hosxp.api_url'?: string;
  'hosxp.api_auth_key'?: string;
}

export interface BmsSessionResponse {
  MessageCode: number; // 200 = success, 500 = expired
  Message?: string;
  result?: {
    user_info?: BmsUserInfo;
    key_value?: {
      'hosxp.api_url'?: string;
      'hosxp.api_auth_key'?: string;
    };
  };
}

export interface ConnectionConfig {
  apiUrl: string;
  apiAuthKey: string;
}

export interface QueryResult<T = Record<string, unknown>> {
  ok: boolean;
  data: T[];
  error?: string;
  status?: number;
  /** Set when the API blocked the query for touching protected (personal) fields: the authorization request to approve. */
  privacyRequestId?: string;
}

/**
 * The HOSxP API refuses queries that read protected fields (patient/doctor names …) with
 * "SENSITIVE_BLOCKED: … approve authorization request authreq_… then run the same SQL with privacy_request_id".
 */
export function parseSensitiveBlocked(message: string | undefined): string | undefined {
  if (!message || !message.includes('SENSITIVE_BLOCKED')) return undefined;
  return message.match(/authreq_[0-9A-Za-z]+/)?.[0];
}

export class BmsSessionError extends Error {
  constructor(
    message: string,
    public readonly code: 'expired' | 'invalid' | 'network' | 'unknown',
  ) {
    super(message);
    this.name = 'BmsSessionError';
  }
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new BmsSessionError('การเชื่อมต่อหมดเวลา (timeout 30 วินาที)', 'network');
    }
    // The browser hides the real cause (CORS, DNS, refused connection, URL too long) behind a generic TypeError,
    // so say which server failed and how big the request was.
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      // keep raw url
    }
    throw new BmsSessionError(`ไม่สามารถเชื่อมต่อ ${host} ได้ (${(err as Error).message}; คำขอยาว ${url.length.toLocaleString()} ตัวอักษร)`, 'network');
  } finally {
    clearTimeout(timer);
  }
}

export async function retrieveBmsSession(sessionId: string): Promise<BmsSessionResponse> {
  const url = `${PASTE_JSON_URL}?Action=GET&code=${encodeURIComponent(sessionId)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new BmsSessionError(`ไม่สามารถตรวจสอบ Session ได้ (HTTP ${res.status})`, 'unknown');
  }

  const data = (await res.json()) as BmsSessionResponse;
  if (data.MessageCode === 500) {
    throw new BmsSessionError('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่', 'expired');
  }
  if (data.MessageCode !== 200) {
    throw new BmsSessionError(data.Message || 'Session ไม่ถูกต้อง', 'invalid');
  }
  return data;
}

export function extractConnectionConfig(sessionData: BmsSessionResponse): ConnectionConfig | null {
  const keyValue = sessionData.result?.key_value;
  const userInfo = sessionData.result?.user_info;

  const apiUrl = keyValue?.['hosxp.api_url'] || userInfo?.['hosxp.api_url'] || userInfo?.bms_url;
  const apiAuthKey =
    keyValue?.['hosxp.api_auth_key'] || userInfo?.['hosxp.api_auth_key'] || userInfo?.bms_session_code;

  if (!apiUrl || !apiAuthKey) return null;
  return { apiUrl: apiUrl.replace(/\/+$/, ''), apiAuthKey };
}

/** Remove comments and compress whitespace before transport. */
export function minifySql(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * URL lengths the HOSxP tunnel (nginx) answers with 404 and no CORS headers, which the browser
 * reports as a network error. Measured 2026-10-24: ~1,950–3,850 chars fail, shorter and longer pass.
 */
export const TUNNEL_BAD_URL_LENGTH = { from: 1900, to: 4200 } as const;
const PADDED_URL_LENGTH = 4300;

/**
 * GET URL for /api/sql. A URL inside the failing length band is lengthened past it with a trailing
 * SQL line comment ("-- ----…"), which the database ignores, so the query and its result are unchanged.
 */
export function buildSqlUrl(apiUrl: string, sql: string, privacyRequestId?: string): string {
  const build = (s: string) => `${apiUrl}/api/sql?sql=${encodeURIComponent(s)}&app=${APP_NAME}`;
  const minified = minifySql(sql);
  let url = build(minified);
  // padding depends on the SQL alone, so a retry with privacy_request_id sends exactly the same SQL text
  if (url.length >= TUNNEL_BAD_URL_LENGTH.from && url.length < TUNNEL_BAD_URL_LENGTH.to) {
    url = build(minified + ' -- ' + '-'.repeat(PADDED_URL_LENGTH - url.length));
  }
  return privacyRequestId ? `${url}&privacy_request_id=${encodeURIComponent(privacyRequestId)}` : url;
}

export async function executeSqlViaApi<T = Record<string, unknown>>(
  sql: string,
  config: ConnectionConfig,
  privacyRequestId?: string,
): Promise<QueryResult<T>> {
  const url = buildSqlUrl(config.apiUrl, sql, privacyRequestId);

  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${config.apiAuthKey}` },
    });
  } catch (err) {
    return { ok: false, data: [], error: (err as Error).message };
  }

  // The HOSxP API puts the real reason in the JSON body even on error statuses
  // (e.g. HTTP 501 with {"MessageCode":401,"Message":"Invalid authorization"}).
  const body = (await res.json().catch(() => null)) as { MessageCode?: number; Message?: string; data?: T[] } | null;
  const apiCode = Number(body?.MessageCode);

  if (res.status === 401 || apiCode === 401) {
    return { ok: false, data: [], status: 401, error: `${body?.Message || 'Unauthorized'} — BMS Session อาจหมดอายุ กรุณาออกจากระบบแล้วเข้าใหม่ด้วย Session ล่าสุด` };
  }
  if (res.status === 502) return { ok: false, data: [], status: 502, error: 'Bad Gateway: tunnel มีปัญหา (ตรวจว่า HOSxP XE เปิดและ login ค้างไว้)' };
  const blocked = parseSensitiveBlocked(body?.Message);
  if (blocked) return { ok: false, data: [], status: apiCode || res.status, error: body?.Message, privacyRequestId: blocked };
  if (!res.ok || !body) return { ok: false, data: [], status: res.status, error: body?.Message || `HTTP ${res.status}` };
  if (body.MessageCode && body.MessageCode !== 200) {
    return { ok: false, data: [], status: body.MessageCode, error: body.Message || 'Query error' };
  }
  return { ok: true, data: body.data ?? [], status: 200 };
}
