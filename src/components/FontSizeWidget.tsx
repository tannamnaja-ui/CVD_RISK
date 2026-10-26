import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FontIcon } from './Icons';

const DEFAULT = 16;
const MIN = 12;
const MAX = 28;

const keyFor = (page: string) => `app_fs:${page}`;

function getSaved(page: string): number {
  try {
    const v = Number(localStorage.getItem(keyFor(page)));
    return v >= MIN && v <= MAX ? v : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/**
 * Floating "ขนาดตัวอักษร" control (port of fontsize.js). Scales the whole page with CSS zoom
 * through --app-zoom; the setting is remembered per page. Rendered outside the zoomed area.
 */
export function FontSizeWidget({ page }: { page: string }) {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState(() => getSaved(page));

  useEffect(() => setSize(getSaved(page)), [page]);

  useEffect(() => {
    document.documentElement.style.setProperty('--app-zoom', String(size / DEFAULT));
    try {
      localStorage.setItem(keyFor(page), String(size));
    } catch {
      // storage unavailable — keep for this session only
    }
  }, [size, page]);

  return createPortal(
    <div className="fs-widget">
      {open && (
        <div className="fs-widget__panel">
          <div className="fs-widget__label">
            <FontIcon size={16} /> ขนาดตัวอักษร
          </div>
          <input type="range" min={MIN} max={MAX} step={1} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="ขนาดตัวอักษร" />
          <div className="fs-widget__row">
            <span className="fs-sm">ก เล็ก</span>
            <b>{size}px</b>
            <span className="fs-lg">ก ใหญ่</span>
          </div>
          <button type="button" onClick={() => setSize(DEFAULT)}>
            ค่าเริ่มต้น ({DEFAULT}px)
          </button>
        </div>
      )}
      <button type="button" className="fs-widget__toggle" onClick={() => setOpen((o) => !o)} title="ปรับขนาดตัวอักษร" aria-expanded={open}>
        <FontIcon size={20} />
      </button>
    </div>,
    document.body,
  );
}
