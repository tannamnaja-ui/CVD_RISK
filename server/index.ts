/**
 * CV Risk data server — reads HOSxP directly with config.json (no BMS tunnel, no approval prompts).
 * Used when the app is opened on this PC on its own; when opened from HOSxP XE the app uses the BMS API.
 * Only fixed endpoints are exposed (read-only, plus saving the Thai CV Risk result to opdscreen_cvd);
 * the browser never sends SQL.
 *
 * Users sign in with their HOSxP account (officer table). The database settings page (#/settings)
 * is reachable without signing in, from this PC only.
 * The server listens on 127.0.0.1 only and rejects requests whose Host is not localhost.
 *
 *   npm run dev   → this server on 127.0.0.1:4010, Vite on localhost:4009 proxies /api here
 *   npm start     → build the app and serve everything on localhost:4009
 */
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { cvdHistorySql, diabetesSql, hospitalSql, labLinkSql, smokingSql, patientNamesSql, patientsSql, riskFactorsSql, vitalsHistorySql } from '../src/lib/hosxp/sql';
import { buildFollowUp } from './followUp';
import { getUser, login, logout, requireLogin } from './auth';
import { getCvdScreen, saveCvdScreen, type CvdScreenInput } from './cvdScreen';
import { buildReport } from './report';
import { CONFIG_FILE, connect, readConfig, validateConfig, writeConfig, type Db, type DbConfig } from './db';

const args = process.argv.slice(2);
const argValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const PORT = Number(argValue('--port') ?? process.env.PORT ?? 4010);
const HOST = '127.0.0.1';
const SERVE_STATIC = args.includes('--serve-static');

let db: Db | null = null;
let dbError: string | null = null;

async function connectFromFile() {
  try {
    const cfg = readConfig();
    if (!cfg) {
      dbError = 'ยังไม่ได้ตั้งค่าฐานข้อมูล';
      return;
    }
    const next = await connect(cfg);
    await db?.close().catch(() => {});
    db = next;
    dbError = null;
    console.log(`[db] เชื่อมต่อ ${cfg.dbType} ${cfg.host}:${cfg.port ?? ''}/${cfg.database} สำเร็จ`);
  } catch (e) {
    db = null;
    dbError = (e as Error).message;
    console.error(`[db] เชื่อมต่อไม่สำเร็จ: ${dbError}`);
  }
}

async function getDb(): Promise<Db> {
  if (!db) await connectFromFile();
  if (!db) throw new Error(`ยังเชื่อมต่อฐานข้อมูลไม่ได้: ${dbError}`);
  return db;
}

/** Settings form leaves the password blank to keep the saved one. */
/**
 * The settings form may leave the password blank to keep the saved one — but only for the same
 * server and account. Otherwise a blank password could be used to send the saved password to any host.
 */
function withSavedPassword(body: Partial<DbConfig>): DbConfig {
  const cfg = validateConfig(body);
  if (cfg.password) return cfg;
  const saved = readConfig();
  const sameTarget =
    !!saved &&
    saved.dbType === cfg.dbType &&
    saved.host === cfg.host &&
    String(saved.port ?? '') === String(cfg.port ?? '') &&
    saved.database === cfg.database &&
    saved.username === cfg.username;
  if (!sameTarget) throw new Error('เปลี่ยน Host, Port, Database หรือ Username แล้ว — กรุณากรอกรหัสผ่าน');
  return { ...cfg, password: saved.password };
}

const handle =
  (fn: (req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response) => {
    try {
      res.json({ success: true, data: await fn(req) });
    } catch (e) {
      console.error(`[${req.method} ${req.path}]`, (e as Error).message);
      res.status(500).json({ success: false, message: (e as Error).message });
    }
  };

function localOnly(req: Request, res: Response, next: NextFunction) {
  if (req.hostname === 'localhost' || req.hostname === '127.0.0.1') return next();
  res.status(403).json({ success: false, message: 'เปิดได้จากเครื่องนี้ (localhost) เท่านั้น' });
}

const app = express();
app.disable('x-powered-by');
app.use(localOnly);
app.use(express.json({ limit: '20kb' }));

app.get('/api/health', async (req, res) => {
  if (!db) await connectFromFile(); // pick up settings saved after start-up
  res.json({ success: true, data: { db: !!db, dialect: db?.dialect ?? null, error: dbError, config: CONFIG_FILE, user: getUser(req) } });
});

// ---------- HOSxP login ----------

app.post(
  '/api/auth/login',
  handle(async (req) => login(await getDb(), String(req.body?.username ?? ''), String(req.body?.password ?? ''))),
);

app.get('/api/auth/me', requireLogin, (_req, res) => {
  res.json({ success: true, data: res.locals.user });
});

app.post('/api/auth/logout', (req, res) => {
  logout(req);
  res.json({ success: true, data: null });
});

/**
 * The database settings page is open without login (like the "approve icd10" project) so an
 * administrator can always reach it; the server only accepts requests from this PC.
 */
function settingsAccess(_req: Request, _res: Response, next: NextFunction) {
  next();
}

// ---------- database settings (the app's settings page) ----------

app.get(
  '/api/config',
  settingsAccess,
  handle(async () => {
    const cfg = readConfig();
    if (!cfg) return null;
    const { password, ...rest } = cfg;
    return { ...rest, hasPassword: !!password }; // never send the password back
  }),
);

app.post(
  '/api/config/test',
  settingsAccess,
  handle(async (req) => {
    const test = await connect(withSavedPassword(req.body ?? {}));
    const [row] = await test.query('SELECT VERSION() AS v');
    await test.close();
    return { version: String(Object.values(row ?? {})[0] ?? '') };
  }),
);

app.post(
  '/api/config/save',
  settingsAccess,
  handle(async (req) => {
    const cfg = withSavedPassword(req.body ?? {});
    const next = await connect(cfg); // only save settings that actually connect
    writeConfig(cfg);
    await db?.close().catch(() => {});
    db = next;
    dbError = null;
    console.log(`[db] บันทึกการตั้งค่าและเชื่อมต่อ ${cfg.dbType} ${cfg.host}:${cfg.port}/${cfg.database} แล้ว`);
    return { saved: true };
  }),
);

// ---------- read-only data (signed-in users only) ----------

app.use(['/api/hospital', '/api/patients', '/api/risk-factors', '/api/opdscreen', '/api/lab-link', '/api/smoking', '/api/diabetes', '/api/cvd-history', '/api/cvd-screen', '/api/report', '/api/follow-up'], requireLogin);

app.get(
  '/api/hospital',
  handle(async () => {
    const rows = await (await getDb()).query(hospitalSql());
    return { hospitalname: String(rows[0]?.hospitalname ?? '') };
  }),
);

app.get(
  '/api/patients',
  handle(async (req) => {
    const d = await getDb();
    const from = String(req.query.dateFrom ?? '');
    const to = String(req.query.dateTo || from);
    // dates are validated inside the SQL builders
    const [rows, names] = await Promise.all([d.query(patientsSql(d.dialect, from, to)), d.query(patientNamesSql(d.dialect, from, to))]);
    const byVn = new Map(names.map((n) => [String(n.vn), n]));
    return rows.map((r) => ({ ...r, ptname: byVn.get(String(r.vn))?.ptname, doctor: byVn.get(String(r.vn))?.doctor }));
  }),
);

app.get(
  '/api/risk-factors',
  handle(async (req) => {
    const from = String(req.query.dateFrom ?? '');
    return (await getDb()).query(riskFactorsSql(from, String(req.query.dateTo || from)));
  }),
);

app.get(
  '/api/opdscreen/:vn',
  handle(async (req) => (await getDb()).query(vitalsHistorySql(String(req.params.vn)))),
);

app.get(
  '/api/lab-link/:vn',
  handle(async (req) => (await getDb()).query(labLinkSql(String(req.params.vn)))),
);

app.get(
  '/api/smoking/:vn',
  handle(async (req) => (await getDb()).query(smokingSql(String(req.params.vn)))),
);

app.get(
  '/api/diabetes/:vn',
  handle(async (req) => {
    const d = await getDb();
    return d.query(diabetesSql(d.dialect, String(req.params.vn)));
  }),
);

app.get(
  '/api/cvd-history/:vn',
  handle(async (req) => (await getDb()).query(cvdHistorySql(String(req.params.vn)))),
);

// follow-up worklists (contain names and phone numbers — signed-in users of this PC only)
app.get(
  '/api/follow-up',
  handle(async () => buildFollowUp(await getDb())),
);

// ---------- save Thai CV Risk to opdscreen_cvd (the only write in this app) ----------

app.get(
  '/api/report',
  handle(async (req) => buildReport(await getDb(), String(req.query.from ?? ''), String(req.query.to ?? ''))),
);

app.get(
  '/api/cvd-screen/:vn',
  handle(async (req) => getCvdScreen(await getDb(), String(req.params.vn))),
);

app.post('/api/cvd-screen', async (req, res) => {
  try {
    const user = res.locals.user as { loginName: string };
    res.json({ success: true, data: await saveCvdScreen(await getDb(), req.body as CvdScreenInput, user.loginName) });
  } catch (e) {
    console.error('[POST /api/cvd-screen]', (e as Error).message);
    res.status(400).json({ success: false, message: (e as Error).message });
  }
});

app.use('/api', (_req, res) => {
  res.status(404).json({ success: false, message: 'ไม่พบ API นี้' });
});

if (SERVE_STATIC) {
  // the built web app: build/web in the project, or --static-dir (the installed app passes its own folder)
  const web = path.resolve(argValue('--static-dir') ?? 'build/web');
  app.use(express.static(web));
  app.get('*', (_req, res) => res.sendFile(path.join(web, 'index.html')));
}

app.listen(PORT, HOST, () => {
  console.log(`[server] CV Risk data server ที่ http://localhost:${PORT}${SERVE_STATIC ? ' (รวมหน้าเว็บ)' : ''}`);
  void connectFromFile();
});
