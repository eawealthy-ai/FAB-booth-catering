# FAB Booth & Catering Desk

Web app for the Booth & Catering unit (เจ๊แดง, Top Secret Café): event registration, post-confirmation updates, payment slips, booth feasibility, POS-style daily sales, P&L, monthly dashboard, PDF reports and notifications.

- Front end: static `index.html` (GitHub Pages)
- Back end: Supabase project **Booth-Catering** (`uibveomevwoclocpqlbo`, Singapore) — Auth, Postgres with Row Level Security, Storage bucket `slips`

## One-time setup

### 1. Database (Supabase → SQL Editor)
1. Open the project → **SQL Editor** → **New query**.
2. Paste all of `supabase/schema.sql` → **Run**.
3. New query → paste all of `supabase/seed.sql` → **Run** (moves the existing 6 events, 13 menus, P&L, updates, payments and fixed cost from the old Claude version).

### 2. Login settings (Supabase → Authentication)
- **Sign In / Providers → Email**: enabled (default).
- **URL Configuration → Site URL**: `https://eawealthy-ai.github.io/FAB-booth-catering/`
  and add the same URL under **Redirect URLs** (used by sign-up confirmation and password reset emails).
- Optional: turn off **Confirm email** if staff should be able to sign in right after signing up.

### 3. Make yourself the owner
1. Open the site and click **สมัครใช้งาน** with your email.
2. In SQL Editor run (replace the email):
   ```sql
   update public.profiles set role = 'owner', brands = '{jaedang,tsc}' where email = 'you@example.com';
   ```

### 4. Old payment slips
The two slips from the Claude version are referenced as:
- `slips/jaedang/a09a9ccaf8b28f21ddf9f750c9eeae46.jpg` (Nano Cable, ฿39,000)
- `slips/jaedang/a5c0af9343178177cc39cf643c645bd6.jpg` (test event "EW")

Upload the image files to **Storage → slips → jaedang/** with exactly those names, or re-attach them in the app.

### 5. GitHub Pages
Repository **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save**.
The site is published at `https://eawealthy-ai.github.io/FAB-booth-catering/`.

## Roles

| Role (`profiles.role`) | Can do |
|---|---|
| `owner` | Everything, all brands |
| `sysadmin` (Admin) | Everything in assigned brands, incl. Menu & BOM, fixed cost, users |
| `admin` | Registration team + sales team |
| `register` | Register/edit events, post updates, attach slips |
| `sales` | Enter daily sales and costs (P&L) |
| `management` | Read only, all brands, plus the two-brand overview |
| `viewer` | Read only |

`profiles.brands` limits which brands a user sees (`jaedang`, `tsc`). New sign-ups start as `viewer` with no brands until an Admin assigns them in **ผู้ใช้ & สิทธิ์**.
These rules are enforced in Postgres (RLS), not only in the UI.

## Files
- `index.html` — the app
- `js/config.js` — Supabase URL and publishable (anon) key; safe to be public because every table uses RLS
- `js/supabase-shim.js` — login screen and the data/storage adapter used by the app
- `supabase/schema.sql` — tables, RLS policies, storage bucket, realtime
- `supabase/seed.sql` — data migrated from the Claude version
