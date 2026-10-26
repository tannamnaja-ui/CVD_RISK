import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from './Icons';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}

/** Accessible modal built on the native <dialog> element (focus trap + Esc handled by the browser). */
export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal modal--${size}`}
      onClose={onClose}
      onClick={(e) => {
        // click on the backdrop (outside the panel) closes the dialog
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal__panel">
        <header className="modal__header">
          <div>
            <h2 className="modal__title">{title}</h2>
            {subtitle && <p className="modal__subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="ปิด">
            <CloseIcon size={20} />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </dialog>
  );
}
