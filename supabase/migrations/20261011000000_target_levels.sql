-- Target stock per product: the level a restock should bring it back to.
-- Null means "no target", so the product is left out of the shopping list.

alter table public.products add column if not exists target_level numeric check (target_level >= 0);
