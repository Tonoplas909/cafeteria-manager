import { useState } from 'react';
import Dialog from '../Dialog.jsx';
import { useT } from '../i18n.jsx';
import { planImport } from '../importStock.js';

export default function Inventory({ inventory, adjustStock, importProducts, canEdit }) {
  const { t } = useT();
  const [adjusting, setAdjusting] = useState(null);
  const [importing, setImporting] = useState(false);
  const [plan, setPlan] = useState(null);
  const [importError, setImportError] = useState(null);

  const closeImport = () => {
    setImporting(false);
    setPlan(null);
    setImportError(null);
  };
  const readFile = async (file) => {
    setPlan(null);
    setImportError(null);
    if (!file) return;
    try {
      setPlan(planImport(await file.text(), inventory));
    } catch (e) {
      setImportError(e.message);
    }
  };

  const totalItems = inventory.reduce((s, i) => s + i.current, 0);
  const lowStockCount = inventory.filter((i) => i.current <= i.minLevel).length;
  const weeklyUsage = inventory.reduce((s, i) => s + i.weeklyUsage, 0);

  return (
    <div className="screen-inner">
      <div className="page-head">
        <div>
          <div className="eyebrow">{t('Stock room')}</div>
          <h1 className="page-title">{t("What's on the shelf")}</h1>
          <p className="page-lede">{t('Levels against the minimum, and what each item used this week.')}</p>
        </div>
        {canEdit && (
          <button className="btn btn-secondary" onClick={() => setImporting(true)}>{t('Import stock')}</button>
        )}
      </div>

      <div className="stat-grid">
        <div className="card elev-sm stat">
          <div className="label-caps">{t('Units in stock')}</div>
          <div className="stat-value" style={{ color: 'var(--color-accent-2-700)' }}>{totalItems}</div>
        </div>
        <div className="card elev-sm stat">
          <div className="label-caps">{t('Running low')}</div>
          <div className="stat-value" style={{ color: 'var(--color-accent-700)' }}>{lowStockCount}</div>
        </div>
        <div className="card elev-sm stat">
          <div className="label-caps">{t('Used this week')}</div>
          <div className="stat-value">{weeklyUsage}</div>
        </div>
      </div>

      <div className="card elev-sm table-card">
        {inventory.length === 0 ? (
          <p className="text-muted" style={{ margin: 0 }}>
            {canEdit ? t('No products yet. Add some under Admin → Products.') : t('No products yet.')}
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('Item')}</th>
                <th>{t('Level')}</th>
                <th>{t('In stock')}</th>
                <th>{t('Minimum')}</th>
                <th>{t('This week')}</th>
                <th>{t('Status')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((item) => {
                const low = item.current <= item.minLevel;
                const pct = Math.max(4, Math.min(100, Math.round((item.current / (item.minLevel * 3)) * 100)));
                return (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                    <td>
                      <div className="meter" role="img" aria-label={`${pct}%`}>
                        <span
                          style={{
                            width: `${pct}%`,
                            background: low ? 'var(--color-accent)' : 'var(--color-accent-2)',
                          }}
                        />
                      </div>
                    </td>
                    <td>{item.current}</td>
                    <td>{item.minLevel}</td>
                    <td>{item.weeklyUsage}</td>
                    <td>
                      <span className={low ? 'tag tag-accent' : 'tag tag-accent-2'}>{low ? t('Low') : t('OK')}</span>
                    </td>
                    <td className="t-right">
                      {canEdit && (
                        <button className="btn btn-ghost" onClick={() => setAdjusting(item)}>{t('Adjust')}</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {adjusting && (
        <Dialog
          title={t('Adjust {name}', { name: adjusting.name })}
          onClose={() => setAdjusting(null)}
          onSubmit={(data) => {
            adjustStock(adjusting.id, Math.max(0, Number(data.get('current'))));
            setAdjusting(null);
          }}
        >
          <div className="field">
            <label htmlFor="current">{t('Units in stock')}</label>
            <input
              id="current"
              name="current"
              className="input"
              type="number"
              min="0"
              step="any"
              defaultValue={adjusting.current}
              autoFocus
              required
            />
          </div>
        </Dialog>
      )}

      {importing && (
        <Dialog
          title={t('Import stock')}
          submitLabel="Import"
          onClose={closeImport}
          onSubmit={async () => {
            if (!plan) return;
            await importProducts(plan);
            closeImport();
          }}
        >
          <div className="field">
            <label htmlFor="import-file">{t('SumUp items export (.csv)')}</label>
            <input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              className="input"
              onChange={(e) => readFile(e.target.files[0])}
              required
            />
          </div>
          {importError && <p style={{ margin: 0, color: 'var(--color-accent-700)' }}>{t(importError)}</p>}
          {plan && (
            <div className="import-summary">
              <div className="import-stats">
                <div className="import-stat">
                  <div className="import-stat-value" style={{ color: 'var(--color-accent-2-700)' }}>{plan.updates.length}</div>
                  <div className="label-caps">{t('Updated')}</div>
                </div>
                <div className="import-stat">
                  <div className="import-stat-value" style={{ color: 'var(--color-accent-700)' }}>{plan.creates.length}</div>
                  <div className="label-caps">{t('New')}</div>
                </div>
                <div className="import-stat">
                  <div className="import-stat-value">{plan.skipped.length}</div>
                  <div className="label-caps">{t('Ignored')}</div>
                </div>
              </div>
              {plan.creates.length > 0 && (
                <details className="import-details">
                  <summary>{t('New products')}</summary>
                  <div className="import-tags">
                    {plan.creates.map((c) => <span key={c.name} className="tag tag-accent">{c.name}</span>)}
                  </div>
                </details>
              )}
              {plan.skipped.length > 0 && (
                <details className="import-details">
                  <summary>{t('Ignored: stock not tracked')}</summary>
                  <div className="import-tags">
                    {plan.skipped.map((n) => <span key={n} className="tag tag-neutral">{n}</span>)}
                  </div>
                </details>
              )}
              {plan.negatives > 0 && (
                <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
                  {t('{n} negative quantities will be set to 0.', { n: plan.negatives })}
                </p>
              )}
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
