/**
 * Direct-database mode: login token for the local data server (HOSxP officer login).
 * Kept in sessionStorage, so closing the browser tab signs the user out.
 */
const KEY = 'cv:auth-token';
export const AUTH_EXPIRED_EVENT = 'cv:auth-expired';

export interface Officer {
  loginName: string;
  name: string;
}

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(KEY, token);
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage unavailable — the user signs in again on reload
  }
}

/**
 * Call the local data server. GET when no body is given, POST JSON otherwise.
 * A 401 clears the token and tells the login gate to show the login page again.
 */
export async function serverCall<T>(path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['X-Auth-Token'] = token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new Error('ติดต่อ data server ไม่ได้ — รันคำสั่ง npm run dev (หรือ npm start) ในโฟลเดอร์โปรเจค');
  }
  const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T; message?: string } | null;
  if (!json) throw new Error(`data server ตอบกลับไม่ถูกต้อง (HTTP ${res.status}) — ตรวจว่ารัน npm run dev อยู่`);
  if (res.status === 401 && token) {
    setToken(null);
    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  }
  if (!json.success) throw new Error(json.message ?? `HTTP ${res.status}`);
  return json.data as T;
}
