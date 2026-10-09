import { useEffect, useId } from 'react';
import { useT } from './i18n.jsx';

// Modal built on the design system's .dialog classes.
export default function Dialog({ title, onClose, onSubmit, submitLabel = 'Save', wide = false, children }) {
  const { t } = useT();
  const titleId = useId();

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'dialog dialog-wide' : 'dialog'} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="dialog-title" id={titleId}>{title}</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit?.(new FormData(e.currentTarget));
          }}
        >
          <div className="dialog-body stack gap-3">{children}</div>
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {onSubmit ? t('Cancel') : t('Close')}
            </button>
            {onSubmit && <button type="submit" className="btn btn-primary">{t(submitLabel)}</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
