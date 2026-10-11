// What to buy to bring every product with a target back up to it.
// Products without a target, or already at/above it, are left out.
export function buildShoppingList(inventory) {
  const items = inventory
    .filter((i) => i.targetLevel != null && i.current < i.targetLevel)
    .map((i) => {
      const quantity = round(i.targetLevel - i.current);
      return { id: i.id, name: i.name, current: i.current, target: i.targetLevel, quantity, cost: round(quantity * (i.cost || 0)) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return { items, total: round(items.reduce((s, i) => s + i.cost, 0)) };
}

const round = (n) => Math.round(n * 100) / 100;

// Plain text version, for pasting into a message or a notes app.
export function shoppingListText({ items, total }, t, date) {
  const lines = items.map((i) => `- ${i.name} : ${i.quantity}`);
  return [
    t('Shopping list — {date}', { date }),
    ...lines,
    ...(total > 0 ? ['', t('Estimated cost: €{total}', { total: total.toFixed(2) })] : []),
  ].join('\n');
}
