import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useBmsSessionContext } from '../contexts/BmsSessionContext';
import { markLaunchedFromHosxp } from '../services/dataMode';
import { getSessionCookie, handleUrlSession } from '../utils/sessionStorage';
import { AlertCircleIcon, HeartPulseIcon, KeyIcon } from './Icons';

interface SessionValidatorProps {
  children: ReactNode;
  onSessionReady?: () => void;
}

export function SessionValidator({ children, onSessionReady }: SessionValidatorProps) {
  const session = useBmsSessionContext();
  const { connectSession, isConnected, isLoading, error } = session;
  const [initializing, setInitializing] = useState(true);
  const [inputId, setInputId] = useState('');
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const fromUrl = handleUrlSession();
    // a session id in the URL means HOSxP XE opened this tab → use the BMS API for data
    if (fromUrl) markLaunchedFromHosxp();
    const sessionId = fromUrl ?? getSessionCookie();
    if (sessionId) {
      void connectSession(sessionId).finally(() => setInitializing(false));
    } else {
      setInitializing(false);
    }
  }, [connectSession]);

  useEffect(() => {
    if (isConnected) onSessionReady?.();
  }, [isConnected, onSessionReady]);

  if (isConnected) return <>{children}</>;

  if (initializing) {
    return (
      <div className="auth-screen">
        <div className="auth-card auth-card--loading">
          <span className="spinner" aria-hidden="true" />
          <p>กำลังตรวจสอบ BMS Session…</p>
        </div>
      </div>
    );
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void connectSession(inputId);
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={handleSubmit}>
        <span className="auth-card__logo">
          <HeartPulseIcon size={32} />
        </span>
        <h1>CV Risk Calculator</h1>
        <p className="auth-card__sub">เข้าสู่ระบบด้วย BMS Session จาก HOSxP</p>

        <label className="field__label" htmlFor="bms-session-input">
          BMS Session ID
        </label>
        <div className="field__control">
          <span className="field__prefix">
            <KeyIcon size={18} />
          </span>
          <input
            id="bms-session-input"
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            placeholder="วาง Session ID ที่นี่"
            autoComplete="off"
            autoFocus
          />
        </div>

        {error && (
          <p className="auth-card__error" role="alert">
            <AlertCircleIcon size={16} /> {error}
          </p>
        )}

        <button type="submit" className="btn btn--primary btn--block" disabled={isLoading || !inputId.trim()}>
          {isLoading ? <span className="spinner spinner--sm" aria-hidden="true" /> : null}
          {isLoading ? 'กำลังเชื่อมต่อ…' : 'เข้าสู่ระบบ'}
        </button>

        <p className="auth-card__note">
          หรือเปิดผ่านลิงก์ <code>?bms-session-id=…</code> จากระบบ HOSxP เพื่อเข้าสู่ระบบอัตโนมัติ
        </p>
      </form>
    </div>
  );
}
