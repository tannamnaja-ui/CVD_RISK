/**
 * Where patient data comes from:
 *  - 'bms'    — opened from HOSxP XE (URL carried ?bms-session-id=): queries go through the BMS API.
 *  - 'direct' — opened on its own: the local data server reads the database with config.json.
 * Remembered per browser tab, so a reload keeps the mode the tab was opened with.
 */
export type DataMode = 'bms' | 'direct';

const KEY = 'cv:launched-from-hosxp';

export function markLaunchedFromHosxp(): void {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    // storage unavailable — the tab falls back to direct mode on reload
  }
}

export function dataMode(): DataMode {
  try {
    return sessionStorage.getItem(KEY) === '1' ? 'bms' : 'direct';
  } catch {
    return 'direct';
  }
}
