import { ENGINES, type EngineId } from '../lib/engines';
import { ToggleSwitch } from './FormControls';
import { Modal } from './Modal';

interface EngineVisibilityDialogProps {
  open: boolean;
  hidden: EngineId[];
  onChange: (hidden: EngineId[]) => void;
  onClose: () => void;
}

export function EngineVisibilityDialog({ open, hidden, onChange, onClose }: EngineVisibilityDialogProps) {
  const visibleCount = ENGINES.length - hidden.length;

  const setShown = (id: EngineId, shown: boolean) => {
    if (!shown && visibleCount <= 1) return; // keep at least one engine
    onChange(shown ? hidden.filter((h) => h !== id) : [...hidden, id]);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ซ่อนสูตรที่ไม่ใช้"
      subtitle="ปิดสวิตช์สูตรที่ไม่ต้องการ สูตรนั้นจะไม่แสดงในเมนูเลือกสูตรและตารางเปรียบเทียบ (บันทึกไว้ในเบราว์เซอร์นี้)"
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={() => onChange([])} disabled={hidden.length === 0}>
            แสดงทั้งหมด
          </button>
          <button type="button" className="btn btn--primary" onClick={onClose}>
            เสร็จสิ้น
          </button>
        </>
      }
    >
      <div className="visibility-list">
        {ENGINES.map((e, i) => {
          const shown = !hidden.includes(e.id);
          return (
            <ToggleSwitch
              key={e.id}
              label={`${i + 1}. ${e.label}`}
              description={`${e.sublabel}${e.ageLabel ? ` · อายุ ${e.ageLabel}` : ''}${shown && visibleCount <= 1 ? ' — ต้องแสดงอย่างน้อย 1 สูตร' : ''}`}
              checked={shown}
              onChange={(c) => setShown(e.id, c)}
              stateLabels={['ซ่อน', 'แสดง']}
            />
          );
        })}
      </div>
    </Modal>
  );
}
