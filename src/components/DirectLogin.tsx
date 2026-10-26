import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { AUTH_EXPIRED_EVENT, getToken, serverCall, setToken, type Officer } from '../services/directAuth';
import { AlertCircleIcon, HeartPulseIcon, KeyIcon, SettingsIcon, UserIcon } from './Icons';

interface DirectUser {
  user: Officer;
  logout: () => void;
}

const DirectUserContext = createContext<DirectUser | null>(null);

/** Signed-in HOSxP officer in direct-database mode (null in BMS mode). */
export function useDirectUser(): DirectUser | null {
  return useContext(DirectUserContext);
}

/** Direct mode: HOSxP login page until signed in, then the app. */
export function DirectLoginGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Officer | null>(null);
  const [checking, setChecking] = useState(() => !!getToken());

  // a token from earlier in this tab: still valid?
  useEffect(() => {
    if (!getToken()) return;
    serverCall<Officer>('/api/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    const expired = () => setUser(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expired);
  }, []);

  const logout = useCallback(() => {
    void serverCall('/api/auth/logout', {}).catch(() => {});
    setToken(null);
    setUser(null);
  }, []);

  if (checking) {
    return (
      <div className="auth-screen">
        <div className="auth-card auth-card--loading">
          <span className="spinner" aria-hidden="true" />
          <p>กำลังตรวจสอบการเข้าสู่ระบบ…</p>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage onLogin={setUser} />;

  return <DirectUserContext.Provider value={{ user, logout }}>{children}</DirectUserContext.Provider>;
}

function LoginPage({ onLogin }: { onLogin: (user: Officer) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await serverCall<{ token: string; officer: Officer }>('/api/auth/login', { username, password });
      setToken(r.token);
      onLogin(r.officer);
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <span className="auth-card__logo">
          <HeartPulseIcon size={32} />
        </span>
        <h1>CV Risk Calculator</h1>
        <p className="auth-card__sub">เข้าสู่ระบบด้วยบัญชีผู้ใช้ HOSxP</p>

        <label className="field__label" htmlFor="login-user">
          ชื่อผู้ใช้
        </label>
        <div className="field__control">
          <span className="field__prefix">
            <UserIcon size={18} />
          </span>
          <input id="login-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        </div>

        <label className="field__label" htmlFor="login-pass">
          รหัสผ่าน
        </label>
        <div className="field__control">
          <span className="field__prefix">
            <KeyIcon size={18} />
          </span>
          <input id="login-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>

        {error && (
          <p className="auth-card__error" role="alert">
            <AlertCircleIcon size={16} /> {error}
          </p>
        )}

        <button type="submit" className="btn btn--primary btn--block" disabled={busy || !username.trim() || !password}>
          {busy && <span className="spinner spinner--sm" aria-hidden="true" />}
          {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </button>

        <a className="btn btn--ghost btn--block auth-card__settings" href="#/settings">
          <SettingsIcon size={18} /> ตั้งค่าฐานข้อมูล
        </a>
      </form>
    </div>
  );
}
