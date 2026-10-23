-- Department chosen at sign-up → automatic role.
--   marketing  (การตลาด)     → register  (Add new event / updates / slips)
--   operations (โอเปอเรชั่น)  → sales     (daily sales + P&L)
--   clevel     (C-level)      → viewer    (read only)
-- Auto-roles are given only to @fabfood.co.th emails; other emails stay viewer with no brands until an Admin assigns them.
alter table public.profiles add column if not exists department text;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  dep text := nullif(new.raw_user_meta_data->>'department','');
  company boolean := lower(new.email) like '%@fabfood.co.th';
  r text := 'viewer';
  b text[] := '{}';
begin
  if dep not in ('marketing','operations','clevel') then dep := null; end if;
  if company and dep is not null then
    r := case dep when 'marketing' then 'register' when 'operations' then 'sales' else 'viewer' end;
    b := array(select id from public.brands);
  end if;
  insert into public.profiles (id, email, full_name, department, role, brands)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), dep, r, b)
  on conflict (id) do nothing;
  return new;
end $$;
