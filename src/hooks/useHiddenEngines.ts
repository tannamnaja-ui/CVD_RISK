import { useCallback, useState } from 'react';
import { ENGINES, type EngineId } from '../lib/engines';

const STORAGE_KEY = 'cv-risk:hidden-engines';
const VALID = new Set<string>(ENGINES.map((e) => e.id));

function load(): EngineId[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const ids = parsed.filter((x): x is EngineId => typeof x === 'string' && VALID.has(x));
    return ids.length < ENGINES.length ? ids : [];
  } catch {
    return [];
  }
}

/** Per-browser preference of which engines to hide from the selector and comparison. */
export function useHiddenEngines() {
  const [hidden, setHiddenState] = useState<EngineId[]>(load);

  const setHidden = useCallback((next: EngineId[]) => {
    setHiddenState(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable (private mode etc.) — keep in memory only
    }
  }, []);

  return [hidden, setHidden] as const;
}
