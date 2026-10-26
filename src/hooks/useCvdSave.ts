import { useCallback, useEffect, useMemo, useState } from 'react';
import { assess, modelFor } from '../lib/engines';
import { toPatient, validateForModel, type FormValues } from '../lib/formModel';
import { dataMode } from '../services/dataMode';
import { serverCall } from '../services/directAuth';

/** Row of HOSxP table opdscreen_cvd as returned by the data server. */
export interface SavedCvdScreen {
  screen_datetime: string | null;
  risk_score: string | number | null;
  staff: string | null;
  cvd_risk_score_type_name?: string | null;
}

export type SaveState =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; row: SavedCvdScreen; justNow: boolean }
  | { state: 'error'; message: string };

/**
 * Saving the Thai CV Risk result of a visit to opdscreen_cvd (direct-database mode only).
 * Whatever engine is on screen, what is saved is Thai CV Risk (Lab when TC is entered, otherwise Non-Lab),
 * because opdscreen_cvd and its 5 risk levels belong to that score.
 */
export function useCvdSave(vn: string | undefined, values: FormValues) {
  const [status, setStatus] = useState<SaveState>({ state: 'idle' });

  // a result saved earlier for this visit
  useEffect(() => {
    if (!vn || dataMode() !== 'direct') return;
    serverCall<SavedCvdScreen | null>(`/api/cvd-screen/${encodeURIComponent(vn)}`)
      .then((row) => row && setStatus({ state: 'saved', row, justNow: false }))
      .catch(() => {
        // reading the previous save is informational only
      });
  }, [vn]);

  /** Why saving is not possible right now (null = ready). */
  const blocked = useMemo((): string | null => {
    if (!vn) return 'เปิดหน้าคำนวณจากรายชื่อผู้ป่วยเพื่อบันทึกตาม VN';
    if (dataMode() !== 'direct') return 'บันทึกได้เมื่อเข้าใช้งานผ่านหน้าเข้าสู่ระบบของแอป (ไม่ใช่เปิดจาก HOSxP XE)';
    const model = modelFor('thai', values.thaiMode);
    const errors = Object.values(validateForModel(values, model));
    if (errors.length) return `ข้อมูลสำหรับ Thai CV Risk ยังไม่ครบ: ${errors.join(', ')}`;
    if (assess(model, toPatient(values)).status !== 'ok') return 'คำนวณ Thai CV Risk ไม่ได้ด้วยข้อมูลนี้';
    return null;
  }, [vn, values]);

  const save = useCallback(async () => {
    if (!vn || blocked) return;
    setStatus({ state: 'saving' });
    try {
      const row = await serverCall<SavedCvdScreen>('/api/cvd-screen', {
        vn,
        age: values.age,
        gender: values.gender,
        sbp: values.sbp,
        dm: values.dm,
        smoke: values.smoke,
        tc: values.tc,
        hdl: values.hdl,
        thaiFormula: values.thaiFormula,
        waist: values.waist,
        height: values.height,
      });
      setStatus({ state: 'saved', row, justNow: true });
    } catch (e) {
      setStatus({ state: 'error', message: (e as Error).message });
    }
  }, [blocked, values, vn]);

  return { status, blocked, save };
}
