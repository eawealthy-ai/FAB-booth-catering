-- Public (no-login) read-only access for the homepage, events, dashboard and P&L.
-- Not public: customer phone, updates, payment slips, notifications, users.
grant usage on schema public to anon;

drop policy if exists brands_anon on public.brands;
create policy brands_anon on public.brands for select to anon using (true);

drop policy if exists events_anon on public.events;
create policy events_anon on public.events for select to anon using (true);
-- hide the customer phone column from anonymous visitors
revoke select on public.events from anon;
grant select (id,brand,format,customer,dates,serve_from,serve_to,venue,map_url,guests,packages,distribution_note,
  catering_fee_per_day,feas,feas_fc,vat_included,status,note,paid,actual,created_by,created_at,updated_at,unlock_until)
  on public.events to anon;

drop policy if exists pl_anon on public.event_pl;
create policy pl_anon on public.event_pl for select to anon using (true);
grant select on public.event_pl to anon;

drop policy if exists menus_anon on public.menus;
create policy menus_anon on public.menus for select to anon using (true);
grant select on public.menus to anon;

drop policy if exists fc_anon on public.booth_settings;
create policy fc_anon on public.booth_settings for select to anon using (true);
grant select on public.booth_settings to anon;
