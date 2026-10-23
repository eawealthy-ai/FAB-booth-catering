-- Lock an event 7 days after its last date (Asia/Bangkok). Owner/Admin (is_sys) can still edit,
-- and can reopen it for the team until events.unlock_until.
alter table public.events add column if not exists unlock_until text;

create or replace function public.event_open(eid text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_sys() or coalesce((
    select e.status in ('cancelled','tbd')
        or (select max(nullif(d,''))::date from unnest(e.dates) d) is null
        or (select max(nullif(d,''))::date from unnest(e.dates) d) + 7 >= (now() at time zone 'Asia/Bangkok')::date
        or (nullif(e.unlock_until,'')::date >= (now() at time zone 'Asia/Bangkok')::date)
    from public.events e where e.id = eid), true)
$$;

drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
  using (public.has_brand(brand) and (public.can_register() or public.can_sales()) and public.event_open(id))
  with check (public.has_brand(brand) and (public.can_register() or public.can_sales()));
drop policy if exists events_delete on public.events;
create policy events_delete on public.events for delete to authenticated
  using (public.has_brand(brand) and public.can_register() and public.event_open(id));

drop policy if exists pl_write on public.event_pl;
create policy pl_write on public.event_pl for all to authenticated
  using (public.has_brand(brand) and public.can_sales() and public.event_open(event_id))
  with check (public.has_brand(brand) and public.can_sales() and public.event_open(event_id));

drop policy if exists upd_write on public.event_updates;
create policy upd_write on public.event_updates for all to authenticated
  using (public.has_brand(brand) and public.can_register() and public.event_open(event_id))
  with check (public.has_brand(brand) and public.can_register() and public.event_open(event_id));

drop policy if exists pay_write on public.event_payments;
create policy pay_write on public.event_payments for all to authenticated
  using (public.has_brand(brand) and public.can_register() and public.event_open(event_id))
  with check (public.has_brand(brand) and public.can_register() and public.event_open(event_id));
