import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { serverCall as call } from '../services/directAuth';
import { AlertCircleIcon, CheckIcon, HeartPulseIcon, SettingsIcon } from './Icons';

interface Health {
  db: boolean;
  error: string | null;
  config: string;
}

interface SavedConfig {
  dbType: 'postgresql' | 'mysql';
  host: string;
  port?: string;
  database: string;
  username: string;
  hasPassword: boolean;
}

const DEFAULT_PORT = { postgresql: '5432', mysql: '3306' } as const;

/** Database connection settings for direct mode (writes config.json through the local data server). */
interface DbSettingsPageProps {
  onSaved?: () => void;
  notice?: string | null;
  /** opened directly at #/settings: offer the way to the login page */
  standalone?: boolean;
}

export function DbSettingsPage({ onSaved, notice, standalone }: DbSettingsPageProps) {
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ dbType: 'postgresql' as SavedConfig['dbType'], host: '127.0.0.1', port: '5432', database: '', username: '', password: '' });
  const [hasPassword, setHasPassword] = useState(false);
  const [busy, setBusy] = useState<'test' | 'save' | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    call<SavedConfig | null>('/api/config')
      .then((cfg) => {
        if (!cfg) return;
        setForm({ dbType: cfg.dbType, host: cfg.host, port: String(cfg.port ?? ''), database: cfg.database, username: cfg.username, password: '' });
        setHasPassword(cfg.hasPassword);
      })
      .catch((e) => setMessage({ tone: 'error', text: (e as Error).message }));
  }, []);

  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  function changeType(dbType: SavedConfig['dbType']) {
    // swap the port only if it was still the other type's default
    setForm((f) => ({ ...f, dbType, port: !f.port || f.port === DEFAULT_PORT[f.dbType] ? DEFAULT_PORT[dbType] : f.port }));
  }

  async function test() {
    setBusy('test');
    setMessage(null);
    try {
      const r = await call<{ version: string }>('/api/config/test', form);
      setMessage({ tone: 'ok', text: `เชื่อมต่อสำเร็จ — ${r.version}` });
    } catch (e) {
      setMessage({ tone: 'error', text: `เชื่อมต่อไม่สำเร็จ: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy('save');
    setMessage(null);
    try {
      await call('/api/config/save', form);
      setHasPassword(hasPassword || !!form.password);
      setForm((f) => ({ ...f, password: '' }));
      setMessage({ tone: 'ok', text: 'บันทึกและเชื่อมต่อฐานข้อมูลสำเร็จ' });
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setMessage({ tone: 'error', text: `บันทึกไม่สำเร็จ: ${(err as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <form className="db-settings" onSubmit={save}>
      <header className="db-settings__head">
        <span className="db-settings__icon">
          <SettingsIcon size={22} />
        </span>
        <div>
          <h2>ตั้งค่าฐานข้อมูล HOSxP</h2>
          <p>สำหรับผู้ดูแลระบบ — เชื่อมต่อฐานข้อมูลแล้วจึงเข้าสู่ระบบด้วยบัญชี HOSxP</p>
        </div>
      </header>

      {notice && (
        <p className="db-settings__notice">
          <AlertCircleIcon size={16} /> {notice}
        </p>
      )}

      <div className="db-settings__grid">
        <label className="db-field">
          <span>ประเภทฐานข้อมูล</span>
          <select value={form.dbType} onChange={(e) => changeType(e.target.value as SavedConfig['dbType'])}>
            <option value="postgresql">PostgreSQL</option>
            <option value="mysql">MySQL / MariaDB</option>
          </select>
        </label>
        <label className="db-field">
          <span>Host</span>
          <input value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="เช่น 127.0.0.1" required />
        </label>
        <label className="db-field">
          <span>Port</span>
          <input value={form.port} onChange={(e) => set('port', e.target.value)} inputMode="numeric" placeholder={DEFAULT_PORT[form.dbType]} />
        </label>
        <label className="db-field">
          <span>Database</span>
          <input value={form.database} onChange={(e) => set('database', e.target.value)} placeholder="ชื่อฐานข้อมูล" required />
        </label>
        <label className="db-field">
          <span>Username</span>
          <input value={form.username} onChange={(e) => set('username', e.target.value)} autoComplete="off" required />
        </label>
        <label className="db-field">
          <span>Password</span>
          <input
            type="password"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            autoComplete="new-password"
            placeholder={hasPassword ? 'เว้นว่าง = ใช้รหัสผ่านเดิม (ถ้าไม่เปลี่ยน Host/Database/Username)' : ''}
          />
        </label>
      </div>

      {message && (
        <p className={`db-settings__msg db-settings__msg--${message.tone}`}>
          {message.tone === 'ok' ? <CheckIcon size={16} /> : <AlertCircleIcon size={16} />} {message.text}
        </p>
      )}

      <div className="db-settings__actions">
        <button type="button" className="btn btn--ghost" onClick={test} disabled={busy !== null}>
          {busy === 'test' ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy !== null}>
          {busy === 'save' ? 'กำลังบันทึก...' : 'บันทึกและเชื่อมต่อ'}
        </button>
      </div>
      {standalone && (
        <a className={`btn ${saved ? 'btn--primary' : 'btn--ghost'} btn--block`} href="#/">
          {saved ? 'ไปหน้าเข้าสู่ระบบ' : '← กลับหน้าเข้าสู่ระบบ'}
        </a>
      )}
      <p className="db-settings__note">ค่าจะถูกบันทึกในไฟล์ config.json บนเครื่องนี้ หน้านี้เปิดได้จากเครื่องนี้ (localhost) เท่านั้น</p>
    </form>
  );
}

/** Direct mode: show the settings page until the data server has a working database connection. */
export function DirectDbGate({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const check = useCallback(() => {
    call<Health>('/api/health')
      .then((h) => {
        setHealth(h);
        setServerError(null);
      })
      .catch((e) => setServerError((e as Error).message));
  }, []);

  useEffect(check, [check]);

  if (health?.db) return <>{children}</>;

  return (
    <div className="auth-screen">
      {serverError ? (
        <div className="auth-card">
          <span className="auth-card__logo">
            <HeartPulseIcon size={32} />
          </span>
          <h1>CV Risk Calculator</h1>
          <p className="auth-card__error">
            <AlertCircleIcon size={16} /> {serverError}
          </p>
          <button type="button" className="btn btn--primary btn--block" onClick={check}>
            ลองอีกครั้ง
          </button>
        </div>
      ) : !health ? (
        <div className="auth-card auth-card--loading">
          <span className="spinner" aria-hidden="true" />
          <p>กำลังตรวจสอบการเชื่อมต่อฐานข้อมูล…</p>
        </div>
      ) : (
        <DbSettingsPage onSaved={check} notice={health.error && health.error !== 'ยังไม่ได้ตั้งค่าฐานข้อมูล' ? `เชื่อมต่อด้วยค่าที่บันทึกไว้ไม่สำเร็จ: ${health.error}` : null} />
      )}
    </div>
  );
}
