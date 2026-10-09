// Reads a SumUp "items export" CSV and works out what an import would change.

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

// Same product despite case, accents, stray spaces or curly apostrophes.
export const nameKey = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

const COLS = {
  name: 'Item name',
  price: 'Price',
  quantity: 'Quantity',
  category: 'Category',
  track: 'Track inventory? (Yes/No)',
  id: 'Item id (Do not change)',
};

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// Returns { updates, creates, skipped, negatives } for the given inventory.
export function planImport(text, inventory) {
  const [header, ...lines] = parseCsv(text);
  const idx = {};
  for (const [k, label] of Object.entries(COLS)) idx[k] = header?.indexOf(label) ?? -1;
  if (idx.name < 0 || idx.quantity < 0) throw new Error('Not a SumUp items export (columns "Item name" and "Quantity" are required).');

  const byExternal = new Map(inventory.filter((p) => p.externalId).map((p) => [p.externalId, p]));
  const byName = new Map(inventory.map((p) => [nameKey(p.name), p]));

  const seen = new Set();
  const plan = { updates: [], creates: [], skipped: [], negatives: 0 };
  for (const line of lines) {
    const name = (line[idx.name] ?? '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    // Items that don't track inventory (coffee, ...) have no stock to import.
    if (idx.track >= 0 && /^no$/i.test((line[idx.track] ?? '').trim())) {
      plan.skipped.push(name);
      continue;
    }
    const externalId = idx.id >= 0 ? (line[idx.id] ?? '').trim() || null : null;
    const key = externalId ?? nameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);

    const qty = num(line[idx.quantity]) ?? 0;
    if (qty < 0) plan.negatives++;
    const item = {
      name,
      current: Math.max(0, qty),
      price: idx.price >= 0 ? num(line[idx.price]) : null,
      category: idx.category >= 0 ? (line[idx.category] ?? '').trim() || null : null,
      externalId,
    };

    const existing = (externalId && byExternal.get(externalId)) || byName.get(nameKey(name));
    if (existing) plan.updates.push({ ...item, id: existing.id, previous: existing.current, changed: existing.current !== item.current });
    else plan.creates.push(item);
  }
  return plan;
}
