-- Booth & Catering Desk — Supabase schema
-- Run once in the Supabase SQL editor (or via the Supabase connector).
-- Access model:
--   profiles.role   : owner | sysadmin | admin | register | sales | viewer
--   profiles.brands : brands the user may see ('jaedang', 'tsc')
--   owner/sysadmin  : everything, incl. menus/BOM, fixed cost, users
--   register        : events, updates, payment slips
--   sales           : daily P&L
--   admin           : register + sales
--   viewer          : read only

create extension if not exists pgcrypto;

-- ---------- reference ----------
create table if not exists public.brands (
  id   text primary key,
  name text not null
);
insert into public.brands (id, name) values
  ('jaedang', 'เจ๊แดง'),
  ('tsc', 'Top Secret Café')
on conflict (id) do nothing;

-- ---------- users ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text,
  role       text not null default 'viewer'
             check (role in ('owner','sysadmin','admin','register','sales','management','viewer')),
  brands     text[] not null default '{}',
  department text,                     -- marketing | operations | clevel (chosen at sign-up)
  created_at timestamptz not null default now()
);

-- every new auth user gets a viewer profile with no brands (an admin assigns them)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- permission helpers (security definer so RLS can read profiles) ----------
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_sys() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('owner','sysadmin'), false)
$$;

create or replace function public.can_register() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('owner','sysadmin','admin','register'), false)
$$;

create or replace function public.can_sales() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('owner','sysadmin','admin','sales'), false)
$$;

create or replace function public.has_brand(b text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and (p.role in ('owner','management') or b = any (p.brands))
  )
$$;

-- ---------- data ----------
create table if not exists public.events (
  id                    text primary key default gen_random_uuid()::text,
  brand                 text not null references public.brands (id),
  format                text,
  customer              text,
  phone                 text,
  dates                 text[] not null default '{}',     -- 'YYYY-MM-DD'
  serve_from            text,
  serve_to              text,
  venue                 text,
  map_url               text,
  guests                numeric default 0,
  packages              jsonb not null default '[]',      -- [{menuId,name,price,qty}]
  distribution_note     text,
  catering_fee_per_day  numeric default 0,
  feas                  jsonb,                            -- booth: {salesPerDay,rent,staff,stay}
  feas_fc               jsonb,                            -- fixed cost snapshot at save time
  vat_included          boolean not null default true,
  status                text not null default 'confirmed' check (status in ('confirmed','tbd','cancelled')),
  note                  text,
  paid                  numeric not null default 0,
  actual                jsonb,                            -- rollup written when P&L is saved
  created_by            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists events_brand_idx on public.events (brand);

create table if not exists public.event_pl (
  event_id      text not null references public.events (id) on delete cascade,
  day           text not null,                -- 'YYYY-MM-DD' (booth) or 'event' (catering)
  brand         text not null references public.brands (id),
  sales         jsonb not null default '[]',
  catering_fee  numeric not null default 0,
  other_costs   jsonb not null default '[]',
  waste         jsonb not null default '[]',      -- [{menuId,name,qty,unitCogs}]
  updated_by    text,
  updated_at    timestamptz not null default now(),
  primary key (event_id, day)
);

create table if not exists public.event_updates (
  id         text primary key default gen_random_uuid()::text,
  event_id   text not null references public.events (id) on delete cascade,
  brand      text not null references public.brands (id),
  title      text,
  type       text,
  due        text,
  body       text not null,
  author     text,
  posted_at  timestamptz not null default now()
);

create table if not exists public.event_payments (
  id            text primary key default gen_random_uuid()::text,
  event_id      text not null references public.events (id) on delete cascade,
  brand         text not null references public.brands (id),
  asset_path    text not null,               -- path inside storage bucket 'slips'
  content_type  text,
  amount        numeric not null default 0,
  slip_date     text,
  slip_time     text,
  payer         text,
  bank          text,
  ref           text,
  kind          text,
  author        text,
  posted_at     timestamptz not null default now()
);

create table if not exists public.menus (
  id          text primary key default gen_random_uuid()::text,
  brand       text not null references public.brands (id),
  name        text not null,
  price       numeric not null default 0,    -- incl. VAT
  bom         jsonb not null default '[]',   -- [{ingredient,qty,unit,unitCost}]
  channel     text[] not null default '{}',  -- 'booth' / 'catering'
  sort_order  int,
  updated_at  timestamptz not null default now()
);

create table if not exists public.booth_settings (
  brand       text primary key references public.brands (id),
  food_pct    numeric not null default 0.355,
  wage        numeric not null default 550,
  ot_hours    numeric not null default 4,
  ot_rate     numeric not null default 1.5,
  allowance   numeric not null default 200,
  hotel_room  numeric not null default 1000,
  per_room    numeric not null default 2,
  transport   numeric not null default 1500,
  other       numeric not null default 500,
  updated_at  timestamptz not null default now()
);
insert into public.booth_settings (brand) values ('jaedang'), ('tsc') on conflict do nothing;

create table if not exists public.activity (
  id         text primary key default gen_random_uuid()::text,
  brand      text not null references public.brands (id),
  type       text not null,
  event_id   text,
  title      text,
  detail     text,
  author     text,
  posted_at  timestamptz not null default now()
);
create index if not exists activity_brand_time_idx on public.activity (brand, posted_at desc);

create table if not exists public.reads (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  brands   jsonb not null default '{}'       -- {brand: {seenAt}}
);

-- ---------- row level security ----------
alter table public.brands          enable row level security;
alter table public.profiles        enable row level security;
alter table public.events          enable row level security;
alter table public.event_pl        enable row level security;
alter table public.event_updates   enable row level security;
alter table public.event_payments  enable row level security;
alter table public.menus           enable row level security;
alter table public.booth_settings  enable row level security;
alter table public.activity        enable row level security;
alter table public.reads           enable row level security;

drop policy if exists brands_read on public.brands;
create policy brands_read on public.brands for select to authenticated using (true);

-- profiles: everyone signed in can see names (for "posted by" / "read by"); only sys admins change roles
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for update to authenticated
  using (public.is_sys() and role <> 'owner' and id <> auth.uid())
  with check (public.is_sys() and role <> 'owner');
drop policy if exists profiles_admin_delete on public.profiles;
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using (public.is_sys() and role <> 'owner');

-- events: brand members read; registration team writes; sales team may update (P&L rollup)
drop policy if exists events_read on public.events;
create policy events_read on public.events for select to authenticated using (public.has_brand(brand));
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated
  with check (public.has_brand(brand) and public.can_register());
drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
  using (public.has_brand(brand) and (public.can_register() or public.can_sales()))
  with check (public.has_brand(brand) and (public.can_register() or public.can_sales()));
drop policy if exists events_delete on public.events;
create policy events_delete on public.events for delete to authenticated
  using (public.has_brand(brand) and public.can_register());

-- daily P&L: sales team
drop policy if exists pl_read on public.event_pl;
create policy pl_read on public.event_pl for select to authenticated using (public.has_brand(brand));
drop policy if exists pl_write on public.event_pl;
create policy pl_write on public.event_pl for all to authenticated
  using (public.has_brand(brand) and public.can_sales())
  with check (public.has_brand(brand) and public.can_sales());

-- updates & payments: registration team
drop policy if exists upd_read on public.event_updates;
create policy upd_read on public.event_updates for select to authenticated using (public.has_brand(brand));
drop policy if exists upd_write on public.event_updates;
create policy upd_write on public.event_updates for all to authenticated
  using (public.has_brand(brand) and public.can_register())
  with check (public.has_brand(brand) and public.can_register());

drop policy if exists pay_read on public.event_payments;
create policy pay_read on public.event_payments for select to authenticated using (public.has_brand(brand));
drop policy if exists pay_write on public.event_payments;
create policy pay_write on public.event_payments for all to authenticated
  using (public.has_brand(brand) and public.can_register())
  with check (public.has_brand(brand) and public.can_register());

-- menus/BOM and fixed cost: sys admins only
drop policy if exists menus_read on public.menus;
create policy menus_read on public.menus for select to authenticated using (public.has_brand(brand));
drop policy if exists menus_write on public.menus;
create policy menus_write on public.menus for all to authenticated
  using (public.is_sys() and public.has_brand(brand)) with check (public.is_sys() and public.has_brand(brand));

drop policy if exists fc_read on public.booth_settings;
create policy fc_read on public.booth_settings for select to authenticated using (public.has_brand(brand));
drop policy if exists fc_write on public.booth_settings;
create policy fc_write on public.booth_settings for all to authenticated
  using (public.is_sys() and public.has_brand(brand)) with check (public.is_sys() and public.has_brand(brand));

-- activity feed: anyone on either team can log; brand members read
drop policy if exists act_read on public.activity;
create policy act_read on public.activity for select to authenticated using (public.has_brand(brand));
drop policy if exists act_insert on public.activity;
create policy act_insert on public.activity for insert to authenticated
  with check (public.has_brand(brand) and (public.can_register() or public.can_sales()));

-- read receipts: everyone reads, each user writes only their own row
drop policy if exists reads_read on public.reads;
create policy reads_read on public.reads for select to authenticated using (true);
drop policy if exists reads_write on public.reads;
create policy reads_write on public.reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- storage: payment slips (private bucket, path = <brand>/<file>) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slips', 'slips', false, 20971520, array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do nothing;

drop policy if exists slips_read on storage.objects;
create policy slips_read on storage.objects for select to authenticated
  using (bucket_id = 'slips' and public.has_brand((storage.foldername(name))[1]));
drop policy if exists slips_insert on storage.objects;
create policy slips_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'slips' and public.has_brand((storage.foldername(name))[1]) and public.can_register());
drop policy if exists slips_delete on storage.objects;
create policy slips_delete on storage.objects for delete to authenticated
  using (bucket_id = 'slips' and public.has_brand((storage.foldername(name))[1]) and public.can_register());

-- ---------- realtime (live refresh for every open screen) ----------
do $$
declare t text;
begin
  foreach t in array array['events','event_pl','event_updates','event_payments','menus','booth_settings','activity','reads','profiles'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- first owner ----------
-- After you sign up in the app with your own email, run (replace the email):
--   update public.profiles set role = 'owner', brands = '{jaedang,tsc}' where email = 'you@example.com';

-- see department.sql for the sign-up department → role trigger
