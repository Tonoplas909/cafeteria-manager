-- Stock import from a SumUp items export. Products keep SumUp's item id so a
-- re-import updates the same row even if the item is renamed; rows without one
-- (hand-added products) are matched by name instead.

alter table public.products add column if not exists category    text;
alter table public.products add column if not exists external_id text;

create unique index if not exists products_external_id_key
  on public.products (external_id) where external_id is not null;
