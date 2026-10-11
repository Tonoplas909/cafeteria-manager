import { useState } from 'react';
import Dialog from '../Dialog.jsx';
import { useT } from '../i18n.jsx';
import { planImport } from '../importStock.js';
import { buildShoppingList, shoppingListText } from '../shoppingList.js';

// Empty field = no target.
const readTarget = (value) => (value === '' || value == null ? null : Math.max(0, Number(value)));

export default function Inventory({ inventory, adjustStock, importProducts, setTargets, canEdit }) {
  const { t, lang } = useT();
  const [adjusting, setAdjusting] = useState(null);
  const [editingTargets, setEditingTargets] = useState(false);
  const [shopping, setShopping] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(null);
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

  const shoppingList = buildShoppingList(inventory);
  const hasTargets = inventory.some((i) => i.targetLevel != null);
  const closeShopping = () => {
    setShopping(false);
    setCopied(false);
    setCopyError(null);
  };
  const copyShoppingList = async () => {
    const date = new Date().toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'long' });
    try {
      await navigator.clipboard.writeText(shoppingListText(shoppingList, t, date));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(t('Copy failed. Select the list and copy it by hand.'));
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
        <div className="shift-actions">
          {canEdit && (
            <>
              <button className="btn btn-secondary" onClick={() => setImporting(true)}>{t('Import stock')}</button>
              <button className="btn btn-secondary" onClick={() => setEditingTargets(true)} disabled={inventory.length === 0}>
                {t('Set targets')}
              </button>
            </>
          )}
          <button className="btn btn-primary" onClick={() => setShopping(true)} disabled={inventory.length === 0}>
            {t('Shopping list')}
          </button>
        </div>
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
                <th>{t('Target')}</th>
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
                    <td data-label={t('In stock')}>{item.current}</td>
                    <td data-label={t('Minimum')}>{item.minLevel}</td>
                    <td data-label={t('Target')}>{item.targetLevel ?? '—'}</td>
                    <td data-label={t('This week')}>{item.weeklyUsage}</td>
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
            adjustStock(adjusting.id, Math.max(0, Number(data.get('current'))), readTarget(data.get('target')));
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
          <div className="field">
            <label htmlFor="target">{t('Target stock')}</label>
            <input
              id="target"
              name="target"
              className="input"
              type="number"
              min="0"
              step="any"
              defaultValue={adjusting.targetLevel ?? ''}
            />
            <span className="hint">{t('Leave empty to keep this item off the shopping list.')}</span>
          </div>
        </Dialog>
      )}

      {editingTargets && (
        <Dialog
          title={t('Target stock')}
          wide
          onClose={() => setEditingTargets(false)}
          onSubmit={async (data) => {
            const changed = inventory
              .map((i) => ({ id: i.id, targetLevel: readTarget(data.get(`target-${i.id}`)), before: i.targetLevel ?? null }))
              .filter((c) => c.targetLevel !== c.before);
            if (changed.length) await setTargets(changed.map(({ id, targetLevel }) => ({ id, targetLevel })));
            setEditingTargets(false);
          }}
        >
          <p className="text-muted" style={{ margin: 0, fontSize: 14 }}>
            {t('The level each item should be brought back to when restocking. Leave empty for items you don’t restock.')}
          </p>
          <div className="target-list">
            {inventory.map((item) => (
              <div key={item.id} className="target-row">
                <label htmlFor={`target-${item.id}`}>
                  <span style={{ fontWeight: 600 }}>{item.name}</span>
                  <span className="hint">{t('{n} in stock', { n: item.current })}</span>
                </label>
                <input
                  id={`target-${item.id}`}
                  name={`target-${item.id}`}
                  className="input"
                  type="number"
                  min="0"
                  step="any"
                  defaultValue={item.targetLevel ?? ''}
                />
              </div>
            ))}
          </div>
        </Dialog>
      )}

      {shopping && (
        <Dialog title={t('Shopping list')} wide onClose={closeShopping}>
          {shoppingList.items.length === 0 ? (
            <p className="text-muted" style={{ margin: 0 }}>
              {hasTargets
                ? t('Nothing to buy: every item is at or above its target.')
                : canEdit
                  ? t('No targets yet. Use “Set targets” to choose how much of each item to keep.')
                  : t('No targets yet. Ask an admin to set them.')}
            </p>
          ) : (
            <>
              <ul className="shopping-list">
                {shoppingList.items.map((i) => (
                  <li key={i.id}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{i.name}</div>
                      <div className="hint">{t('{current} in stock, target {target}', { current: i.current, target: i.target })}</div>
                    </div>
                    <div className="shopping-qty">
                      <span className="shopping-qty-value">{i.quantity}</span>
                      {i.cost > 0 && <span className="hint">≈ €{i.cost.toFixed(2)}</span>}
                    </div>
                  </li>
                ))}
              </ul>
              {shoppingList.total > 0 && (
                <p style={{ margin: 0, fontWeight: 600, textAlign: 'right' }}>
                  {t('Estimated cost: €{total}', { total: shoppingList.total.toFixed(2) })}
                </p>
              )}
              <div className="shift-actions">
                <button type="button" className="btn btn-secondary" onClick={copyShoppingList}>
                  {copied ? t('Copied') : t('Copy list')}
                </button>
              </div>
              {copyError && <p style={{ margin: 0, color: 'var(--color-accent-700)' }}>{copyError}</p>}
            </>
          )}
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
