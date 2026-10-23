-- Telegram notifications for new / edited / deleted events.
-- Step 1: run this whole file once in Supabase -> SQL Editor.
-- Step 2: store the bot token and chat id (see the bottom of this file).

create extension if not exists pg_net with schema extensions;

create or replace function public.notify_telegram() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  tok text; chat text; who text; bname text; head text; msg text;
  esc_title text; esc_detail text;
begin
  if new.type not in ('new','edit','del') then return new; end if;
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'telegram_bot_token' limit 1;
  select decrypted_secret into chat from vault.decrypted_secrets where name = 'telegram_chat_' || new.brand limit 1;
  if chat is null then
    select decrypted_secret into chat from vault.decrypted_secrets where name = 'telegram_chat_id' limit 1;
  end if;
  if tok is null or chat is null then return new; end if;
  select coalesce(nullif(full_name,''), email) into who from public.profiles where id::text = new.author;
  select name into bname from public.brands where id = new.brand;
  head := case new.type when 'new' then '🆕 งานใหม่' when 'edit' then '✏️ แก้ไขงาน' else '🗑️ ลบงาน' end;
  esc_title := replace(replace(replace(coalesce(new.title,''),'&','&amp;'),'<','&lt;'),'>','&gt;');
  esc_detail := replace(replace(replace(coalesce(new.detail,''),'&','&amp;'),'<','&lt;'),'>','&gt;');
  msg := head || ' · ' || coalesce(bname, new.brand) || E'\n<b>' || esc_title || '</b>'
      || case when esc_detail <> '' then E'\n' || esc_detail else '' end
      || case when who is not null then E'\nโดย ' || replace(replace(who,'<','&lt;'),'>','&gt;') else '' end
      || E'\n<a href="https://eawealthy-ai.github.io/FAB-booth-catering/">เปิดเว็บ Booth &amp; Catering</a>';
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || tok || '/sendMessage',
    body := jsonb_build_object('chat_id', chat, 'text', msg, 'parse_mode', 'HTML', 'disable_web_page_preview', true),
    headers := '{"Content-Type":"application/json"}'::jsonb);
  return new;
exception when others then
  return new;  -- never block saving because of Telegram
end $$;

revoke all on function public.notify_telegram() from public, anon, authenticated;

drop trigger if exists activity_telegram on public.activity;
create trigger activity_telegram after insert on public.activity
  for each row execute function public.notify_telegram();

-- ===== Step 2 (run separately, replace the values; do NOT share the token in chat) =====
-- select vault.create_secret('123456789:AA...your-bot-token...', 'telegram_bot_token');
-- One group for both brands:
-- select vault.create_secret('-1001234567890', 'telegram_chat_id');
-- Or a separate group per brand (optional, overrides the one above):
-- select vault.create_secret('-100...', 'telegram_chat_jaedang');
-- select vault.create_secret('-100...', 'telegram_chat_tsc');
--
-- Test without opening the website:
-- insert into public.activity (brand,type,event_id,title,detail,author) values ('jaedang','new','','ทดสอบแจ้งเตือน','Booth · ทดสอบ','');
