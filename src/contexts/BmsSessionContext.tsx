import { createContext, useContext, type ReactNode } from 'react';
import { useBmsSession, type BmsSession } from '../hooks/useBmsSession';

const BmsSessionContext = createContext<BmsSession | null>(null);

export function BmsSessionProvider({ children }: { children: ReactNode }) {
  const session = useBmsSession();
  return <BmsSessionContext.Provider value={session}>{children}</BmsSessionContext.Provider>;
}

export function useBmsSessionContext(): BmsSession {
  const ctx = useContext(BmsSessionContext);
  if (!ctx) throw new Error('useBmsSessionContext must be used within BmsSessionProvider');
  return ctx;
}
