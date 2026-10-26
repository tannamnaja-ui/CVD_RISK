import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BmsSessionError,
  executeSqlViaApi,
  extractConnectionConfig,
  retrieveBmsSession,
  type BmsSessionResponse,
  type BmsUserInfo,
  type ConnectionConfig,
  type QueryResult,
} from '../services/bmsSession';
import { removeSessionCookie, setSessionCookie } from '../utils/sessionStorage';

export interface BmsSessionState {
  sessionId: string | null;
  sessionData: BmsSessionResponse | null;
  connectionConfig: ConnectionConfig | null;
  userInfo: BmsUserInfo | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
}

export interface BmsSession extends BmsSessionState {
  connectSession: (sessionId: string) => Promise<boolean>;
  disconnectSession: () => void;
  refreshSession: () => Promise<boolean>;
  executeQuery: <T = Record<string, unknown>>(sql: string, privacyRequestId?: string) => Promise<QueryResult<T>>;
}

const initialState: BmsSessionState = {
  sessionId: null,
  sessionData: null,
  connectionConfig: null,
  userInfo: null,
  isConnected: false,
  isLoading: false,
  error: null,
};

export function useBmsSession(): BmsSession {
  const [state, setState] = useState<BmsSessionState>(initialState);

  const connectSession = useCallback(async (rawId: string): Promise<boolean> => {
    const sessionId = rawId.trim();
    if (!sessionId) {
      setState((s) => ({ ...s, error: 'กรุณาระบุ BMS Session ID' }));
      return false;
    }

    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const sessionData = await retrieveBmsSession(sessionId);
      setSessionCookie(sessionId);
      setState({
        sessionId,
        sessionData,
        connectionConfig: extractConnectionConfig(sessionData),
        userInfo: sessionData.result?.user_info ?? null,
        isConnected: true,
        isLoading: false,
        error: null,
      });
      return true;
    } catch (err) {
      if (err instanceof BmsSessionError && (err.code === 'expired' || err.code === 'invalid')) {
        removeSessionCookie();
      }
      setState({ ...initialState, error: (err as Error).message });
      return false;
    }
  }, []);

  const disconnectSession = useCallback(() => {
    removeSessionCookie();
    setState(initialState);
  }, []);

  const refreshSession = useCallback(async () => {
    return state.sessionId ? connectSession(state.sessionId) : false;
  }, [state.sessionId, connectSession]);

  const executeQuery = useCallback(
    async <T = Record<string, unknown>>(sql: string, privacyRequestId?: string): Promise<QueryResult<T>> => {
      if (!state.isConnected || !state.connectionConfig) {
        return { ok: false, data: [], error: 'ยังไม่ได้เชื่อมต่อ Session' };
      }
      return executeSqlViaApi<T>(sql, state.connectionConfig, privacyRequestId);
    },
    [state.isConnected, state.connectionConfig],
  );

  return { ...state, connectSession, disconnectSession, refreshSession, executeQuery };
}

export function useQuery<T = Record<string, unknown>>(sql: string, session: BmsSession, autoExecute = false) {
  const [data, setData] = useState<T[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { executeQuery, isConnected } = session;
  const executedRef = useRef(false);

  const execute = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const result = await executeQuery<T>(sql);
    setIsLoading(false);
    if (result.ok) setData(result.data);
    else setError(result.error ?? 'Query error');
    return result;
  }, [executeQuery, sql]);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (autoExecute && isConnected && !executedRef.current) {
      executedRef.current = true;
      void execute();
    }
  }, [autoExecute, isConnected, execute]);

  return { data, isLoading, error, execute, reset };
}
