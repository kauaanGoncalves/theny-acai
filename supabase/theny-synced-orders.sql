-- Theny Açaí: sincronização de pedidos, histórico e cardápio entre aparelhos
-- Pré-requisitos: execute theny-approved-sellers.sql e theny-vendedor-permissions.sql
-- antes deste arquivo. Depois, rode este script no Supabase > SQL Editor.
-- Pedidos são visíveis só a vendedores aprovados; visitantes anônimos podem inserir
-- pedidos pendentes, mas apenas owner/editor podem gerenciar pedidos e cardápio.

begin;

do $$
begin
  if to_regclass('public.seller_access') is null then
    raise exception 'Execute primeiro theny-approved-sellers.sql e theny-vendedor-permissions.sql.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'seller_access' and column_name = 'full_name'
  ) then
    raise exception 'Execute theny-vendedor-permissions.sql antes deste script.';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.seller_access'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%orders_viewer%'
  ) then
    raise exception 'Execute theny-vendedor-permissions.sql antes deste script.';
  end if;
end;
$$;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_approved_seller()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.seller_access as a
    where a.user_id = (select auth.uid())
      and a.approved_at is not null
  );
$$;

create or replace function private.can_manage_orders()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.seller_access as a
    where a.user_id = (select auth.uid())
      and a.approved_at is not null
      and a.role in ('owner', 'editor')
  );
$$;

revoke all on function private.is_approved_seller() from public, anon;
revoke all on function private.can_manage_orders() from public, anon;
grant execute on function private.is_approved_seller() to authenticated;
grant execute on function private.can_manage_orders() to authenticated;

create table if not exists public.theny_orders (
  id text primary key check (char_length(id) between 1 and 100),
  customer_name text not null check (char_length(btrim(customer_name)) between 1 and 50),
  product_id text not null check (char_length(product_id) between 1 and 100),
  product_name text not null check (char_length(product_name) between 1 and 50),
  product_icon text not null default '🍧',
  toppings jsonb not null default '[]'::jsonb,
  sauces jsonb not null default '[]'::jsonb,
  note text not null default '' check (char_length(note) <= 180),
  base_price numeric(10,2) not null default 0 check (base_price >= 0),
  total numeric(10,2) not null default 0 check (total >= 0),
  done boolean not null default false,
  done_at timestamptz,
  served_by text check (served_by is null or char_length(served_by) <= 100),
  created_at timestamptz not null default now()
);

create index if not exists theny_orders_created_at_idx
  on public.theny_orders (created_at desc);
create index if not exists theny_orders_done_created_at_idx
  on public.theny_orders (done, created_at desc);

alter table public.theny_orders enable row level security;
revoke all on table public.theny_orders from public, anon, authenticated;
grant select, update, delete on table public.theny_orders to authenticated;
grant insert (id, customer_name, product_id, product_name, product_icon, toppings, sauces, note, base_price, total, created_at)
  on table public.theny_orders to anon;
grant insert (id, customer_name, product_id, product_name, product_icon, toppings, sauces, note, base_price, total, done, done_at, served_by, created_at)
  on table public.theny_orders to authenticated;

drop policy if exists "Approved sellers read shared orders" on public.theny_orders;
create policy "Approved sellers read shared orders"
on public.theny_orders for select to authenticated
using ((select private.is_approved_seller()));

drop policy if exists "Customers submit pending orders" on public.theny_orders;
create policy "Customers submit pending orders"
on public.theny_orders for insert to anon, authenticated
with check (done = false and done_at is null and served_by is null);

drop policy if exists "Editors migrate or add orders" on public.theny_orders;
create policy "Editors migrate or add orders"
on public.theny_orders for insert to authenticated
with check ((select private.can_manage_orders()));

drop policy if exists "Editors update shared orders" on public.theny_orders;
create policy "Editors update shared orders"
on public.theny_orders for update to authenticated
using ((select private.can_manage_orders()))
with check ((select private.can_manage_orders()));

drop policy if exists "Editors delete shared orders" on public.theny_orders;
create policy "Editors delete shared orders"
on public.theny_orders for delete to authenticated
using ((select private.can_manage_orders()));

create table if not exists public.theny_shop_state (
  id text primary key check (id = 'main'),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.theny_shop_state enable row level security;
revoke all on table public.theny_shop_state from public, anon, authenticated;
grant select on table public.theny_shop_state to anon, authenticated;
grant insert, update, delete on table public.theny_shop_state to authenticated;

drop policy if exists "Anyone can read the public shop menu" on public.theny_shop_state;
create policy "Anyone can read the public shop menu"
on public.theny_shop_state for select to anon, authenticated
using (true);

drop policy if exists "Editors create shared shop menu" on public.theny_shop_state;
create policy "Editors create shared shop menu"
on public.theny_shop_state for insert to authenticated
with check ((select private.can_manage_orders()));

drop policy if exists "Editors update shared shop menu" on public.theny_shop_state;
create policy "Editors update shared shop menu"
on public.theny_shop_state for update to authenticated
using ((select private.can_manage_orders()))
with check ((select private.can_manage_orders()));

drop policy if exists "Editors delete shared shop menu" on public.theny_shop_state;
create policy "Editors delete shared shop menu"
on public.theny_shop_state for delete to authenticated
using ((select private.can_manage_orders()));

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'A publicação supabase_realtime não existe; habilite Realtime antes de executar novamente.';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'theny_orders') then
    execute 'alter publication supabase_realtime add table public.theny_orders';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'theny_shop_state') then
    execute 'alter publication supabase_realtime add table public.theny_shop_state';
  end if;
end;
$$;

commit;


