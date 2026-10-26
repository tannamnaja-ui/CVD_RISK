/**
 * Direct HOSxP database connection (same approach as the "approve icd10" project):
 * PostgreSQL or MySQL, settings in config.json (edited from the app's database settings page).
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import pg from 'pg';
import type { Dialect } from '../src/lib/hosxp/sql';

// Return DATE/TIMESTAMP as plain strings: converting to JS Date shifts the day by the server timezone.
pg.types.setTypeParser(1082, (v) => v); // DATE
pg.types.setTypeParser(1114, (v) => v); // TIMESTAMP
pg.types.setTypeParser(1184, (v) => v); // TIMESTAMPTZ

export interface DbConfig {
  dbType: Dialect;
  host: string;
  port?: string | number;
  database: string;
  username: string;
  password: string;
}

export const CONFIG_FILE = path.resolve(process.env.CV_CONFIG ?? 'config.json');

export function validateConfig(cfg: Partial<DbConfig>): DbConfig {
  if (cfg.dbType !== 'postgresql' && cfg.dbType !== 'mysql') throw new Error('ประเภทฐานข้อมูลต้องเป็น PostgreSQL หรือ MySQL');
  if (!cfg.host || !cfg.database || !cfg.username) throw new Error('กรุณาระบุ host, database และ username');
  return {
    dbType: cfg.dbType,
    host: String(cfg.host).trim(),
    port: String(cfg.port ?? '').trim(),
    database: String(cfg.database).trim(),
    username: String(cfg.username).trim(),
    password: String(cfg.password ?? ''),
  };
}

export function readConfig(): DbConfig | null {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  return validateConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as Partial<DbConfig>);
}

/** Write via a temp file + rename so a crash never leaves a half-written config.json. */
export function writeConfig(cfg: DbConfig): void {
  const tmp = `${CONFIG_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, CONFIG_FILE);
}

export interface Db {
  dialect: Dialect;
  /** `params` bind to '?' placeholders — use them for anything a user typed. */
  query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
  close: () => Promise<void>;
}

export async function connect(cfg: DbConfig): Promise<Db> {
  if (cfg.dbType === 'postgresql') {
    const pool = new pg.Pool({
      host: cfg.host,
      port: Number(cfg.port) || 5432,
      database: cfg.database,
      user: cfg.username,
      password: cfg.password,
      connectionTimeoutMillis: 8000,
      max: 10,
    });
    try {
      await pool.query('SELECT 1');
    } catch (e) {
      await pool.end().catch(() => {});
      throw e;
    }
    return {
      dialect: 'postgresql',
      query: async (sql, params) => {
        if (!params?.length) return (await pool.query(sql)).rows;
        let i = 0;
        return (await pool.query(sql.replace(/\?/g, () => `$${++i}`), params)).rows;
      },
      close: () => pool.end(),
    };
  }

  const pool = mysql.createPool({
    host: cfg.host,
    port: Number(cfg.port) || 3306,
    database: cfg.database,
    user: cfg.username,
    password: cfg.password,
    waitForConnections: true,
    connectionLimit: 10,
    connectTimeout: 8000,
    dateStrings: true,
  });
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    await pool.end().catch(() => {});
    throw e;
  }
  return {
    dialect: 'mysql',
    query: async (sql, params) => {
      const [rows] = await pool.query(sql, params);
      return rows as Record<string, unknown>[];
    },
    close: () => pool.end(),
  };
}
