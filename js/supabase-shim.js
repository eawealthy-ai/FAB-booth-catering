/* Booth & Catering Desk — Supabase adapter.
   Gives the app the same small API it used inside Claude (claude.use("db"|"user"|"assets"|"downloads"))
   but backed by Supabase Auth, Postgres (with RLS) and Storage. */
(function () {
  "use strict";
  const CFG = window.BC_CONFIG || {};
  if (!window.supabase || !CFG.supabaseUrl || !CFG.supabaseKey) {
    document.addEventListener("DOMContentLoaded", () => {
      document.body.innerHTML = '<p style="padding:24px;font-family:sans-serif">ตั้งค่า js/config.js ก่อน (Supabase URL และ key)</p>';
    });
    return;
  }
  // Session lives in sessionStorage: closing the tab/browser signs the user out (shared booth devices).
  let sessStore; try { sessionStorage.setItem("bc.t", "1"); sessionStorage.removeItem("bc.t"); sessStore = window.sessionStorage; } catch (_) { sessStore = undefined; }
  try { Object.keys(localStorage).filter(k => /^sb-.*-auth-token/.test(k)).forEach(k => localStorage.removeItem(k)); } catch (_) {}
  const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { storage: sessStore, persistSession: !!sessStore, autoRefreshToken: true, detectSessionInUrl: true },
  });
  window.SB = sb;

  /* ---------------- auth gate ---------------- */
  let session = null, me = null, profilesCache = {};
  let resolveAuth; const authReady = new Promise(r => (resolveAuth = r));

  const LOGIN_CSS = `
  .bc-login{position:fixed;inset:0;z-index:50;display:grid;place-items:center;overflow:auto;
    background:var(--wash),var(--dots) 0 0/28px 28px,var(--bg,#f6f7fb);
    padding:max(24px,env(safe-area-inset-top,0px)) max(16px,env(safe-area-inset-right,0px)) 24px max(16px,env(safe-area-inset-left,0px))}
  .bc-login form{width:100%;max-width:400px;display:flex;flex-direction:column;gap:14px;background:var(--surface,#fff);
    border:1px solid var(--line,#e6e9f1);border-radius:28px;padding:36px 28px 28px;box-shadow:var(--shadow);text-align:left}
  .bc-login .mark{font-family:Georgia,"Times New Roman",serif;font-size:3.6rem;line-height:1;font-weight:700;letter-spacing:-.04em;text-align:center;
    background:linear-gradient(120deg,#4a63d8 0%,#a35a9a 45%,#ee8838 100%);-webkit-background-clip:text;background-clip:text;color:transparent}
  .bc-login .logo{display:block;height:72px;width:auto;margin:0 auto 4px}
  .bc-login h1{margin:0;font-size:1.45rem;text-align:center}
  .bc-login .sub{margin:-6px 0 6px;color:var(--muted,#6b7285);font-size:.95rem;text-align:center}
  .bc-login .err{margin:0;color:var(--bad,#b42318);font-size:.88rem}
  .bc-login .ok{margin:0;color:var(--good,#1f7a4d);font-size:.88rem}
  .bc-login .btn{width:100%;padding:13px 18px;font-size:1rem}
  .bc-login .link{background:none;border:0;color:var(--muted,#6b7285);text-decoration:underline;padding:0;font:inherit;cursor:pointer}
  .bc-login .foot{text-align:center;color:var(--muted,#6b7285);font-size:.8rem;margin-top:6px}`;

  function showLogin(mode, msg, ok) {
    let el = document.getElementById("bcLogin");
    if (!el) {
      const st = document.createElement("style"); st.textContent = LOGIN_CSS; document.head.appendChild(st);
      el = document.createElement("div"); el.id = "bcLogin"; el.className = "bc-login"; document.body.appendChild(el);
    }
    const signup = mode === "signup", reset = mode === "reset";
    el.innerHTML = `<form id="bcLoginForm" novalidate>
      <img class="logo" src="assets/fab-logo.png" alt="FAB">
      <h1>FAB Booth &amp; Catering</h1>
      <p class="sub">${signup ? "สมัครใช้งาน · รอผู้ดูแลกำหนดแบรนด์และสิทธิ์ให้" : reset ? "ลืมรหัสผ่าน · ระบบจะส่งลิงก์ตั้งรหัสใหม่ทางอีเมล" : "ระบบงานบูธและแคเทอริ่ง"}</p>
      ${signup ? '<label>ชื่อ-นามสกุล<input id="bcName" autocomplete="name" required></label><label>แผนก<select id="bcDept" required><option value="">เลือกแผนก…</option><option value="marketing">การตลาด</option><option value="operations">โอเปอเรชั่น</option><option value="clevel">C-level</option></select></label><label id="bcBrandWrap">แบรนด์<select id="bcBrand"><option value="">เลือกแบรนด์…</option><option value="jaedang">เจ๊แดง</option><option value="tsc">Top Secret Café</option><option value="both">ทั้งสองแบรนด์</option></select></label>' : ""}
      <label>อีเมล<input id="bcEmail" type="email" autocomplete="email" required></label>
      ${reset ? "" : `<label>รหัสผ่าน<input id="bcPass" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="6" required></label>`}
      ${msg ? `<p class="${ok ? "ok" : "err"}">${msg}</p>` : ""}
      <button class="btn" type="submit">${signup ? "สมัครใช้งาน" : reset ? "ส่งลิงก์" : "เข้าสู่ระบบ"}</button>
      <div class="row" style="justify-content:space-between;gap:8px;font-size:.88rem">
        ${signup || reset ? '<button class="link" type="button" data-m="login">กลับไปหน้าเข้าสู่ระบบ</button>'
          : '<button class="link" type="button" data-m="signup">สมัครใช้งาน</button><button class="link" type="button" data-m="reset">ลืมรหัสผ่าน</button>'}
      </div><div class="foot">© 2026 Operation FAB</div></form>`;
    el.hidden = false;
    const dsel = el.querySelector("#bcDept"), bw = el.querySelector("#bcBrandWrap");
    if (dsel && bw) { const f = () => (bw.hidden = dsel.value === "clevel"); dsel.onchange = f; f(); }
    el.querySelectorAll("[data-m]").forEach(b => (b.onclick = () => showLogin(b.dataset.m)));
    el.querySelector("form").onsubmit = async ev => {
      ev.preventDefault();
      const email = el.querySelector("#bcEmail").value.trim(), pass = el.querySelector("#bcPass")?.value || "";
      const btn = el.querySelector('button[type="submit"]'); btn.disabled = true;
      try {
        if (signup) {
          const name = el.querySelector("#bcName").value.trim(), department = el.querySelector("#bcDept").value;
          if (!department) { btn.disabled = false; return showLogin("signup", "กรุณาเลือกแผนก"); }
          const brand = department === "clevel" ? "both" : el.querySelector("#bcBrand").value;
          if (!brand) { btn.disabled = false; return showLogin("signup", "กรุณาเลือกแบรนด์"); }
          const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { full_name: name, department, brand }, emailRedirectTo: location.href.split("#")[0] } });
          if (error) throw error;
          if (!data.session) return showLogin("login", "สมัครแล้ว เปิดอีเมลเพื่อยืนยัน แล้วกลับมาเข้าสู่ระบบ", true);
        } else if (reset) {
          const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] });
          if (error) throw error;
          return showLogin("login", "ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลแล้ว", true);
        } else {
          const { error } = await sb.auth.signInWithPassword({ email, password: pass });
          if (error) throw error;
        }
      } catch (e) {
        const m = String(e?.message || "");
        showLogin(mode, /Invalid login/i.test(m) ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง" : /confirm/i.test(m) ? "ยังไม่ได้ยืนยันอีเมล เปิดลิงก์ในอีเมลก่อน" : /registered/i.test(m) ? "อีเมลนี้สมัครไว้แล้ว" : "ทำรายการไม่สำเร็จ: " + m);
      } finally { btn.disabled = false; }
    };
  }

  async function loadMe() {
    const { data } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
    me = data || { id: session.user.id, email: session.user.email, role: "viewer", brands: [] };
    profilesCache[me.id] = me;
  }

  async function onSession(s) {
    if (!s) { session = null; showLogin("login"); return; }
    const first = !session; session = s;
    if (!first) return;
    await loadMe();
    const el = document.getElementById("bcLogin"); if (el) el.hidden = true;
    resolveAuth();
  }

  sb.auth.onAuthStateChange((evt, s) => {
    if (evt === "PASSWORD_RECOVERY") {
      setTimeout(showNewPassword, 0);
      return;
    }
    if (evt === "SIGNED_OUT") { location.reload(); return; }
    onSession(s);
  });
  function showNewPassword() {
    showLogin("login");
    const el = document.getElementById("bcLogin");
    el.innerHTML = `<form id="bcNew"><h1>ตั้งรหัสผ่านใหม่</h1><label>รหัสผ่านใหม่<input id="bcNewPass" type="password" minlength="6" required></label>
      <button class="btn" type="submit">บันทึก</button><p class="err" id="bcNewErr" hidden></p></form>`;
    el.querySelector("form").onsubmit = async ev => {
      ev.preventDefault();
      const { error } = await sb.auth.updateUser({ password: el.querySelector("#bcNewPass").value });
      if (error) { const p = el.querySelector("#bcNewErr"); p.textContent = error.message; p.hidden = false; return; }
      location.replace(location.href.split("#")[0]);
    };
  }
  document.addEventListener("DOMContentLoaded", async () => {
    const { data } = await sb.auth.getSession();
    if (!data.session) showLogin("login"); else onSession(data.session);
  });
  document.addEventListener("click", ev => {
    if (ev.target.closest("#logoutBtn")) { try { localStorage.removeItem("bc.brand"); } catch (_) {} sb.auth.signOut(); }
  });

  /* ---------------- path → table mapping ---------------- */
  const TABLES = {
    events:   { table: "events", rename: {} },
    pl:       { table: "event_pl", rename: {}, idCol: "day" },
    updates:  { table: "event_updates", rename: { by: "author", at: "posted_at" } },
    payments: { table: "event_payments", rename: { by: "author", at: "posted_at", assetId: "asset_path", date: "slip_date", time: "slip_time" } },
    menus:    { table: "menus", rename: { order: "sort_order" } },
    settings: { table: "booth_settings", rename: {}, idCol: "brand" },
    activity: { table: "activity", rename: { by: "author", at: "posted_at", text: "detail" } },
    reads:    { table: "reads", rename: {}, idCol: "user_id" },
  };
  const KEYCOLS = new Set(["brand", "event_id", "day", "id", "user_id"]);

  function parse(path) {
    const s = path.split("/");
    if (s[0] === "access" && s[1] === "members") return { kind: "members" };
    if (s[0] === "reads") return { kind: "reads", match: s[1] ? { user_id: s[1] } : {}, isDoc: !!s[1], id: s[1] };
    if (s[0] !== "b") throw new TypeError("unknown path " + path);
    const brand = s[1], rest = s.slice(2);
    if (rest[0] === "settings") return { kind: "settings", match: { brand }, isDoc: true, id: brand };
    if (rest[0] === "events" && rest.length >= 3 && rest[2]) {
      const ev = rest[1], sub = rest[2], key = rest[3];
      const kind = sub; // pl | updates | payments
      const m = { brand, event_id: ev };
      if (key) m[kind === "pl" ? "day" : "id"] = key;
      return { kind, match: m, isDoc: !!key, id: key, defaults: { brand, event_id: ev } };
    }
    const kind = rest[0]; // events | menus | activity
    const m = { brand }; if (rest[1]) m.id = rest[1];
    return { kind, match: m, isDoc: !!rest[1], id: rest[1], defaults: { brand } };
  }

  const toSnakeKey = (t, k) => TABLES[t].rename[k] || k.replace(/[A-Z]/g, c => "_" + c.toLowerCase());
  function revRename(t) { const r = {}; for (const [a, b] of Object.entries(TABLES[t].rename)) r[b] = a; return r; }
  const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(\+00:00|Z)$/;
  function toRow(t, obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) out[toSnakeKey(t, k)] = v;
    if (t === "activity" && "event_id" in out) { /* eventId → event_id via default camel rule */ }
    return out;
  }
  function fromRow(t, row) {
    const rr = revRename(t), out = {};
    for (const [k, v] of Object.entries(row)) {
      const ck = rr[k] || k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      out[ck] = typeof v === "string" && ISO.test(v) ? new Date(v).toISOString() : v;
    }
    return out;
  }
  function rowId(t, row) { const c = TABLES[t].idCol || "id"; return String(row[c]); }

  function err(e) {
    const code = e?.code === "42501" || /row-level security|permission/i.test(e?.message || "") ? "invalid_argument" : "unavailable";
    const x = new Error(e?.message || code); x.code = code; return x;
  }

  /* ---------------- realtime fan-out ---------------- */
  const listeners = new Map(); // table -> Set<fn>
  function listen(table, fn) {
    if (!listeners.has(table)) listeners.set(table, new Set());
    listeners.get(table).add(fn);
    return () => listeners.get(table)?.delete(fn);
  }
  let channel = null;
  function ensureChannel() {
    if (channel) return;
    channel = sb.channel("bc-live").on("postgres_changes", { event: "*", schema: "public" }, p => {
      (listeners.get(p.table) || []).forEach(fn => fn());
    }).subscribe();
  }
  function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }

  /* ---------------- members (profiles) ---------------- */
  let lastMembers = {};
  async function fetchMembers() {
    const { data, error } = await sb.from("profiles").select("*");
    if (error) throw err(error);
    const m = {};
    (data || []).forEach(p => {
      profilesCache[p.id] = p;
      if (p.role === "owner" || p.role !== "viewer" || (p.brands || []).length || p.department) m[p.id] = { brands: p.brands || [], role: p.role === "owner" ? "owner" : p.role, department: p.department || "" };
    });
    lastMembers = m;
    return m;
  }

  /* ---------------- db namespace ---------------- */
  function snapDoc(id, data) { return { id, exists: !!data, data: () => data || undefined, metadata: { fromCache: false, hasPendingWrites: false } }; }

  function docRef(path) {
    const p = parse(path), id = p.id || (p.kind === "members" ? "members" : "");
    const api = {
      id, path,
      async get() {
        if (p.kind === "members") return snapDoc("members", { members: await fetchMembers() });
        const t = TABLES[p.kind];
        const { data, error } = await sb.from(t.table).select("*").match(p.match).maybeSingle();
        if (error) throw err(error);
        return snapDoc(id, data ? fromRow(p.kind, data) : null);
      },
      async set(body) {
        if (p.kind === "members") {
          const next = body.members || {}, prev = lastMembers;
          for (const [uid, v] of Object.entries(next)) {
            if (v.role === "owner") continue;
            const { error } = await sb.from("profiles").update({ role: v.role || "viewer", brands: v.brands || [], department: v.department || null }).eq("id", uid);
            if (error) throw err(error);
          }
          for (const uid of Object.keys(prev)) if (!next[uid] && prev[uid].role !== "owner") {
            const { error } = await sb.from("profiles").update({ role: "viewer", brands: [] }).eq("id", uid);
            if (error) throw err(error);
          }
          lastMembers = next; (listeners.get("profiles") || []).forEach(fn => fn());
          return;
        }
        const t = TABLES[p.kind];
        const row = { ...toRow(p.kind, body), ...(p.defaults || {}), ...p.match };
        const { data, error } = await sb.from(t.table).upsert(row).select();
        if (error) throw err(error);
        if (!data || !data.length) throw err({ code: "42501" });
        (listeners.get(t.table) || []).forEach(fn => fn());
      },
      async update(body) {
        const t = TABLES[p.kind];
        const { data, error } = await sb.from(t.table).update(toRow(p.kind, body)).match(p.match).select();
        if (error) throw err(error);
        if (!data || !data.length) throw err({ code: "42501" });
        (listeners.get(t.table) || []).forEach(fn => fn());
      },
      async delete() {
        const t = TABLES[p.kind];
        const { error } = await sb.from(t.table).delete().match(p.match);
        if (error) throw err(error);
        (listeners.get(t.table) || []).forEach(fn => fn());
      },
      onSnapshot(next, onErr) {
        ensureChannel();
        let dead = false;
        const run = async () => { try { const s = await api.get(); if (!dead) next(s); } catch (e) { if (!dead && onErr) onErr(e); } };
        const r = debounce(run, 250);
        const table = p.kind === "members" ? "profiles" : TABLES[p.kind].table;
        const off = listen(table, r); run();
        return () => { dead = true; off(); };
      },
      collection(sub) { return collRef(path + "/" + sub); },
    };
    return api;
  }

  function collRef(path, opts = {}) {
    const p = parse(path);
    const api = {
      path,
      doc(id) { return docRef(path + "/" + (id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)))); },
      async add(data) { const d = api.doc(); await d.set(data); return d; },
      where() { return api; },
      orderBy(field, dir) { return collRef(path, { ...opts, order: { field, dir } }); },
      limit(n) { return collRef(path, { ...opts, limit: n }); },
      async get() {
        const t = TABLES[p.kind];
        let q = sb.from(t.table).select("*").match(p.match || {});
        if (opts.order) q = q.order(toSnakeKey(p.kind, opts.order.field), { ascending: opts.order.dir !== "desc" });
        if (opts.limit) q = q.limit(opts.limit);
        const { data, error } = await q;
        if (error) throw err(error);
        const docs = (data || []).map(r => snapDoc(rowId(p.kind, r), fromRow(p.kind, r)));
        return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
      },
      onSnapshot(next, onErr) {
        ensureChannel();
        let dead = false;
        const run = async () => { try { const s = await api.get(); if (!dead) next(s); } catch (e) { if (!dead && onErr) onErr(e); } };
        const r = debounce(run, 250);
        const off = listen(TABLES[p.kind].table, r); run();
        return () => { dead = true; off(); };
      },
    };
    return api;
  }

  const db = { doc: docRef, collection: collRef };

  /* ---------------- user namespace ---------------- */
  const nameOf = p => (p && (p.full_name || p.email)) || "";
  async function ensureProfiles(ids) {
    const missing = ids.filter(id => id && !profilesCache[id]);
    if (missing.length) {
      const { data } = await sb.from("profiles").select("*").in("id", missing.filter(x => /^[0-9a-f-]{36}$/i.test(x)));
      (data || []).forEach(p => (profilesCache[p.id] = p));
    }
  }
  const user = {
    async isOwner() { return me?.role === "owner"; },
    async canEdit() { return true; },           // permissions are enforced by Postgres RLS
    async can() { return null; },
    async id() { return session?.user?.id || null; },
    async me() { return { id: me?.id || null, name: nameOf(me), email: me?.email || null, avatarUrl: "", color: "#888", isOwner: me?.role === "owner", canEdit: true }; },
    async name() { return nameOf(me); },
    async profiles(ids) {
      const list = [].concat(ids || []); await ensureProfiles(list);
      const out = {}; list.forEach(id => { const p = profilesCache[id]; out[id] = { id, name: nameOf(p), email: p?.email || null, avatarUrl: "", color: "#888", isMe: id === me?.id, guest: false }; });
      return out;
    },
    async search(q) {
      const { data } = await sb.from("profiles").select("*");
      (data || []).forEach(p => (profilesCache[p.id] = p));
      const s = String(q || "").toLowerCase();
      return (data || []).filter(p => !s || nameOf(p).toLowerCase().includes(s) || String(p.email || "").toLowerCase().includes(s))
        .slice(0, 8).map(p => ({ id: p.id, name: nameOf(p) || p.email, email: p.email, avatarUrl: "", color: "#888", isMe: p.id === me?.id, guest: false }));
    },
  };

  /* ---------------- assets (payment slips in Storage) ---------------- */
  const urlCache = {}, pending = {};
  const PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="84" height="110"><rect width="84" height="110" fill="#eee"/></svg>');
  window.slipSrc = function (path) {
    if (!path) return PLACEHOLDER;
    if (urlCache[path]) return urlCache[path];
    if (!pending[path]) {
      pending[path] = sb.storage.from("slips").createSignedUrl(path, 3600).then(({ data }) => {
        if (data?.signedUrl) { urlCache[path] = data.signedUrl; window.dispatchEvent(new Event("bc-rerender")); }
      }).finally(() => setTimeout(() => delete pending[path], 1000));
    }
    return PLACEHOLDER;
  };
  const assets = {
    async upload(blob, opts = {}) {
      const type = opts.type || blob.type || "image/jpeg";
      const ext = type === "application/pdf" ? "pdf" : type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
      let brand = "jaedang"; try { brand = localStorage.getItem("bc.brand") || brand; } catch (_) {}
      const path = `${brand}/${crypto.randomUUID ? crypto.randomUUID() : Date.now()}.${ext}`;
      const { error } = await sb.storage.from("slips").upload(path, blob, { contentType: type, upsert: false });
      if (error) { const x = new Error(error.message); x.code = /size/i.test(error.message) ? "too_large" : /mime|type/i.test(error.message) ? "unsupported_type" : "upstream_error"; throw x; }
      return { id: path, url: window.slipSrc(path), sizeBytes: blob.size, contentType: type };
    },
    async delete(path) { await sb.storage.from("slips").remove([path]); return { deleted: true }; },
    async list() { return { assets: [], usage: {} }; },
  };

  /* ---------------- downloads ---------------- */
  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { status: "saved" };
    },
  };

  window.claude = {
    async use(name) {
      await authReady;
      return { db, user, assets, downloads }[name] || null;
    },
  };
})();
