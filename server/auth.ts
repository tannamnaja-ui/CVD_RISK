/**
 * Login with a HOSxP account (table `officer`), as in the "approve icd10" project:
 * officer_login_name + MD5 of the password compared with officer_login_password_md5.
 * Sessions are in memory (a server restart signs everyone out) and expire after SESSION_HOURS.
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Db } from './db';

const SESSION_HOURS = 12;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 5;

export interface Officer {
  loginName: string;
  name: string;
}

interface Session extends Officer {
  expires: number;
}

const sessions = new Map<string, Session>();
/** failed attempts per username, to slow down password guessing */
const failures = new Map<string, { count: number; until: number }>();

const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex');

export async function login(db: Db, username: string, password: string): Promise<{ token: string; officer: Officer }> {
  const user = username.trim();
  if (!user || !password) throw new Error('กรุณาใส่ชื่อผู้ใช้และรหัสผ่าน');

  const key = user.toLowerCase();
  const fail = failures.get(key);
  if (fail && fail.count >= MAX_ATTEMPTS && fail.until > Date.now()) {
    throw new Error(`ใส่รหัสผ่านผิดหลายครั้ง กรุณารอ ${Math.ceil((fail.until - Date.now()) / 60000)} นาที`);
  }

  const where = 'WHERE LOWER(officer_login_name) = LOWER(?) AND LOWER(officer_login_password_md5) = LOWER(?) LIMIT 1';
  let rows: Record<string, unknown>[];
  try {
    rows = await db.query(`SELECT officer_login_name, officer_name FROM officer ${where}`, [user, md5(password)]);
  } catch {
    // some installations have no officer_name column
    rows = await db.query(`SELECT officer_login_name FROM officer ${where}`, [user, md5(password)]);
  }

  if (!rows.length) {
    const count = (fail && fail.until > Date.now() ? fail.count : 0) + 1;
    failures.set(key, { count, until: Date.now() + LOCK_MINUTES * 60_000 });
    throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  failures.delete(key);

  const loginName = String(rows[0].officer_login_name ?? user);
  const officer = { loginName, name: String(rows[0].officer_name ?? '').trim() || loginName };
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { ...officer, expires: Date.now() + SESSION_HOURS * 3_600_000 });
  console.log(`[login] ${officer.name} (${loginName})`);
  return { token, officer };
}

export function getUser(req: Request): Officer | null {
  const token = String(req.header('x-auth-token') ?? '');
  const s = token ? sessions.get(token) : undefined;
  if (!s) return null;
  if (s.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { loginName: s.loginName, name: s.name };
}

export function logout(req: Request): void {
  sessions.delete(String(req.header('x-auth-token') ?? ''));
}

export function requireLogin(req: Request, res: Response, next: NextFunction) {
  const user = getUser(req);
  if (!user) {
    res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบ' });
    return;
  }
  res.locals.user = user;
  next();
}
