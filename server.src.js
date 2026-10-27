
// Spelt Brothers Bakery Admin — Cloudflare Worker + D1
const SEED = __SEED__;
const SESSION_DAYS = 30;
const enc = new TextEncoder();

const SCHEMA = [
`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, username TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, updated_at TEXT)`,
`CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires INTEGER NOT NULL)`,
`CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY, ip TEXT, username TEXT, ts INTEGER)`,
`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
`CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'ingredient', unit TEXT NOT NULL DEFAULT 'kg', g_per_unit REAL NOT NULL DEFAULT 1000, stock REAL NOT NULL DEFAULT 0, cost_per_unit REAL, low_level REAL, supplier TEXT, notes TEXT, updated_at TEXT)`,
`CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY, inventory_id INTEGER, qty REAL, cost_total REAL, supplier TEXT, date TEXT, created_at TEXT)`,
`CREATE TABLE IF NOT EXISTS recipes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, yield_pieces REAL NOT NULL DEFAULT 1, piece_weight_g REAL, method TEXT, notes TEXT, updated_at TEXT)`,
`CREATE TABLE IF NOT EXISTS recipe_items (id INTEGER PRIMARY KEY, recipe_id INTEGER NOT NULL, name TEXT NOT NULL, grams REAL NOT NULL DEFAULT 0, is_flour INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0)`,
`CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, unit TEXT, recipe_id INTEGER, units_per_batch REAL, aliases TEXT, labor_per_batch REAL, overhead_per_batch REAL, markup_pct REAL, current_price REAL, active INTEGER NOT NULL DEFAULT 1, updated_at TEXT)`,
`CREATE TABLE IF NOT EXISTS product_packaging (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL, inventory_id INTEGER NOT NULL, qty_per_unit REAL NOT NULL DEFAULT 1)`,
`CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, source TEXT NOT NULL DEFAULT 'manual', external_id TEXT, customer TEXT, date TEXT NOT NULL, fulfillment TEXT, status TEXT NOT NULL DEFAULT 'new', notes TEXT, created_at TEXT, updated_at TEXT)`,
`CREATE UNIQUE INDEX IF NOT EXISTS orders_ext ON orders(source, external_id)`,
`CREATE INDEX IF NOT EXISTS orders_date ON orders(date)`,
`CREATE TABLE IF NOT EXISTS order_items (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, product_id INTEGER, product_name TEXT NOT NULL, qty REAL NOT NULL DEFAULT 0)`,
`CREATE TABLE IF NOT EXISTS bakes (id INTEGER PRIMARY KEY, date TEXT, recipe_id INTEGER, recipe_name TEXT, factor REAL, detail TEXT, undone INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT)`,
// barcode scanning (added 2026-10-25; additive only)
`CREATE TABLE IF NOT EXISTS barcodes (id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, inventory_id INTEGER NOT NULL, pack_size REAL NOT NULL, pack_unit TEXT NOT NULL, last_cost REAL, created_at TEXT, updated_at TEXT)`,
`CREATE INDEX IF NOT EXISTS barcodes_inv ON barcodes(inventory_id)`,
`CREATE TABLE IF NOT EXISTS recipe_steps (id INTEGER PRIMARY KEY, recipe_id INTEGER NOT NULL, sort INTEGER NOT NULL DEFAULT 0, name TEXT, instruction TEXT, timer_min REAL)`,
`CREATE TABLE IF NOT EXISTS extra_bakes (id INTEGER PRIMARY KEY, date TEXT NOT NULL, recipe_id INTEGER NOT NULL, pieces REAL NOT NULL, note TEXT, created_by TEXT, created_at TEXT)`,
`CREATE TABLE IF NOT EXISTS batch_checks (date TEXT NOT NULL, recipe_id INTEGER NOT NULL, batch_no INTEGER NOT NULL, item_key TEXT NOT NULL, checked_by TEXT, checked_at TEXT, PRIMARY KEY (date, recipe_id, batch_no, item_key))`,
`CREATE TABLE IF NOT EXISTS batch_done (date TEXT NOT NULL, recipe_id INTEGER NOT NULL, batch_no INTEGER NOT NULL, batch_count INTEGER, done_by TEXT, done_role TEXT, done_at TEXT, PRIMARY KEY (date, recipe_id, batch_no))`,
`CREATE TABLE IF NOT EXISTS scan_log (id INTEGER PRIMARY KEY, code TEXT, inventory_id INTEGER, mode TEXT NOT NULL, packs REAL, qty REAL, delivery_id INTEGER, cost_total REAL, prev_cost REAL, cost_changed INTEGER NOT NULL DEFAULT 0, undone INTEGER NOT NULL DEFAULT 0, created_at TEXT)`,
];

// additive columns (2026-10-26): added once, existing rows keep their data (new columns start empty)
const ADD_COLUMNS = [['recipes', 'mixer_max_g', 'REAL'], ['recipes', 'waste_pct', 'REAL'], ['recipe_items', 'step', 'INTEGER'], ['recipe_items', 'liquid', 'INTEGER']];
let ready = false;
async function init(env) {
  if (ready) return;
  const db = env.DB;
  await db.batch(SCHEMA.map(s => db.prepare(s)));
  for (const [t, c, type] of ADD_COLUMNS) {
    const cols = (await db.prepare(`PRAGMA table_info(${t})`).all()).results.map(x => x.name);
    if (!cols.includes(c)) { try { await db.prepare(`ALTER TABLE ${t} ADD COLUMN ${c} ${type}`).run(); } catch (e) { if (!/duplicate column/i.test(String(e && e.message))) throw e; } }
  }
  await db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('backup_key', ?)`).bind(randHex(24)).run();
  const row = await db.prepare(`SELECT value FROM settings WHERE key='seeded'`).first();
  if (!row) {
    const now = iso();
    const stmts = [
      db.prepare(`INSERT OR IGNORE INTO users (role, username, salt, hash, updated_at) VALUES ('owner','avrum',?,?,?)`).bind(SEED.owner_salt, SEED.owner_hash, now),
      db.prepare(`INSERT OR IGNORE INTO users (role, username, salt, hash, updated_at) VALUES ('worker','worker',?,?,?)`).bind(SEED.worker_salt, SEED.worker_hash, now),
      db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('import_key', ?)`).bind(randHex(24)),
      db.prepare(`INSERT INTO recipes (id, name, yield_pieces, piece_weight_g, method, notes, updated_at) VALUES (1, ?, 2, 950, ?, ?, ?)`).bind(
        'Example – Spelt Sourdough (replace with yours)',
        '1. Mix flours and water, rest 45 min (autolyse).\n2. Add levain and salt, mix until smooth.\n3. Bulk ferment ~4 h at 24°C with 3 sets of folds.\n4. Divide into 2 × 950 g, pre-shape, rest 20 min, shape.\n5. Cold proof overnight.\n6. Bake 240°C with steam 20 min, then 220°C 25 min.',
        'This is only an example so you can see how recipes work. Edit it or delete it.', now),
    ];
    const items = [['White spelt flour',800,1],['Whole spelt flour',200,1],['Water',680,0],['Levain (spelt starter)',200,0],['Salt',20,0]];
    items.forEach((it, i) => stmts.push(db.prepare(`INSERT INTO recipe_items (recipe_id, name, grams, is_flour, sort) VALUES (1,?,?,?,?)`).bind(it[0], it[1], it[2], i)));
    stmts.push(db.prepare(`INSERT INTO settings (key, value) VALUES ('seeded', ?)`).bind(now));
    await db.batch(stmts);
  }
  ready = true;
}

function iso() { return new Date().toISOString(); }
function randHex(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); }
function hex(buf) { return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join(''); }
function unhex(h) { const a = new Uint8Array(h.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(h.substr(i * 2, 2), 16); return a; }
async function sha256(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function pbkdf2(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unhex(saltHex), iterations: 100000 }, key, 256);
  return hex(bits);
}
function safeEq(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
};
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SEC_HEADERS, ...extra } });
}
function html(body, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SEC_HEADERS,
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" } });
}
function bad(msg, status = 400) { return json({ ok: false, error: msg }, status); }

function getCookie(req, name) {
  const c = req.headers.get('Cookie') || '';
  for (const part of c.split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return v.join('='); }
  return null;
}
async function getUser(req, env) {
  const tok = getCookie(req, 'sb_session');
  if (!tok || tok.length < 20) return null;
  const th = await sha256(tok);
  const row = await env.DB.prepare(`SELECT u.id, u.role, u.username, s.expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).bind(th).first();
  if (!row || row.expires < Date.now()) return null;
  return row;
}

async function login(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  const body = await req.json().catch(() => ({}));
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const since = Date.now() - 15 * 60 * 1000;
  await env.DB.prepare(`DELETE FROM login_attempts WHERE ts < ?`).bind(Date.now() - 24 * 3600 * 1000).run();
  const byIp = await env.DB.prepare(`SELECT COUNT(*) n FROM login_attempts WHERE ip = ? AND ts > ?`).bind(ip, since).first();
  const byUser = await env.DB.prepare(`SELECT COUNT(*) n FROM login_attempts WHERE username = ? AND ts > ?`).bind(username, since).first();
  if ((byIp && byIp.n >= 8) || (byUser && byUser.n >= 20)) return bad('Too many tries. Wait 15 minutes and try again.', 429);
  const u = await env.DB.prepare(`SELECT * FROM users WHERE username = ?`).bind(username).first();
  let ok = false;
  if (u) ok = safeEq(await pbkdf2(password, u.salt), u.hash);
  else await pbkdf2(password, '00000000000000000000000000000000');
  if (!ok) {
    await env.DB.prepare(`INSERT INTO login_attempts (ip, username, ts) VALUES (?,?,?)`).bind(ip, username, Date.now()).run();
    return bad('Wrong username or password.', 401);
  }
  await env.DB.prepare(`DELETE FROM login_attempts WHERE ip = ?`).bind(ip).run();
  const tok = randHex(32);
  await env.DB.prepare(`INSERT INTO sessions (token_hash, user_id, expires) VALUES (?,?,?)`).bind(await sha256(tok), u.id, Date.now() + SESSION_DAYS * 86400000).run();
  await env.DB.prepare(`DELETE FROM sessions WHERE expires < ?`).bind(Date.now()).run();
  return json({ ok: true, role: u.role, username: u.username }, 200, {
    'Set-Cookie': `sb_session=${tok}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}` });
}

// ---------- domain helpers ----------
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const num = (v, d = null) => { if (v === '' || v === null || v === undefined) return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const txt = (v, max = 2000) => v === null || v === undefined ? null : String(v).slice(0, max);

async function loadAll(env) {
  const db = env.DB;
  const [inv, rec, items, prods, pack, steps] = await db.batch([
    db.prepare(`SELECT * FROM inventory ORDER BY kind, name COLLATE NOCASE`),
    db.prepare(`SELECT * FROM recipes ORDER BY name COLLATE NOCASE`),
    db.prepare(`SELECT * FROM recipe_items ORDER BY recipe_id, sort, id`),
    db.prepare(`SELECT * FROM products ORDER BY name COLLATE NOCASE`),
    db.prepare(`SELECT * FROM product_packaging`),
    db.prepare(`SELECT * FROM recipe_steps ORDER BY recipe_id, sort, id`),
  ]);
  const recipes = rec.results.map(r => ({ ...r, items: items.results.filter(i => i.recipe_id === r.id), steps: steps.results.filter(s => s.recipe_id === r.id) }));
  const products = prods.results.map(p => ({ ...p, packaging: pack.results.filter(x => x.product_id === p.id) }));
  return { inventory: inv.results, recipes, products };
}

function matchProduct(products, id, name) {
  if (id) { const p = products.find(p => p.id === id); if (p) return p; }
  const n = norm(name);
  if (!n) return null;
  return products.find(p => norm(p.name) === n) ||
    products.find(p => String(p.aliases || '').split(',').map(norm).filter(Boolean).includes(n)) || null;
}
function matchInv(inventory, name) { const n = norm(name); return inventory.find(i => norm(i.name) === n) || null; }

// liquids show in quarts: the box ticked in the recipe wins; otherwise a liquid Inventory unit or a liquid-sounding name
const LIQ_RE = /\b(water|oil|milk|eggs?|juice|vinegar|cream|liquid)\b/i;
const LIQ_UNITS = ['qt', 'L', 'ml'];
function isLiquid(item, inventory) {
  if (item.liquid !== null && item.liquid !== undefined) return !!item.liquid;
  const inv = inventory ? matchInv(inventory, item.name) : null;
  if (inv && LIQ_UNITS.includes(inv.unit)) return true;
  return LIQ_RE.test(String(item.name || ''));
}
const itemKey = name => 'i:' + norm(name);
// steps for the Workers page; a recipe with no steps gets one "Mix" step holding every ingredient + the old method text
function recipeSteps(recipe) {
  const st = (recipe.steps || []).slice().sort((a, b) => a.sort - b.sort || a.id - b.id);
  if (!st.length) return [{ name: 'Mix', instruction: recipe.method || '', timer_min: null, fallback: true }];
  return st.map(s => ({ name: s.name || '', instruction: s.instruction || '', timer_min: s.timer_min }));
}
// split the dough into equal batches that each fit the mixer (whole pieces per batch when the count is whole)
function splitBatches(pieces, dough_g, mixer_max_g) {
  let nb = 1;
  if (mixer_max_g > 0 && dough_g > mixer_max_g) nb = Math.ceil(dough_g / mixer_max_g - 1e-9);
  const whole = Math.abs(pieces - Math.round(pieces)) < 1e-6 && pieces >= 1;
  if (whole && mixer_max_g > 0 && pieces > 0) {
    const per = dough_g / pieces;
    while (nb < pieces && Math.ceil(Math.round(pieces) / nb) * per > mixer_max_g + 1e-6) nb++;
    nb = Math.min(nb, Math.round(pieces));
  }
  const out = [];
  if (whole && nb > 1) {
    const P = Math.round(pieces), base = Math.floor(P / nb), extra = P % nb;
    for (let k = 0; k < nb; k++) { const pc = base + (k < extra ? 1 : 0); out.push({ pieces: pc, frac: pc / P }); }
  } else for (let k = 0; k < nb; k++) out.push({ pieces: pieces / nb, frac: 1 / nb });
  return out;
}
function scaleRecipe(recipe, factor, inventory) {
  const flour = recipe.items.filter(i => i.is_flour).reduce((a, i) => a + i.grams, 0);
  const total = recipe.items.reduce((a, i) => a + i.grams, 0);
  const waste = Math.max(0, Number(recipe.waste_pct) || 0);
  const wf = 1 + waste / 100;
  const steps = recipeSteps(recipe);
  const items = recipe.items.map(i => {
    let st = Number.isInteger(i.step) && i.step >= 0 && i.step < steps.length ? i.step : 0;
    if (steps.length === 1) st = 0;
    return { name: i.name, grams: i.grams * factor * wf, is_flour: !!i.is_flour, pct: flour ? i.grams / flour * 100 : null, liquid: isLiquid(i, inventory), step: st, key: itemKey(i.name) };
  });
  const pieces = recipe.yield_pieces * factor;
  const dough_g = total * factor * wf;
  const mixer_max_g = Number(recipe.mixer_max_g) > 0 ? Number(recipe.mixer_max_g) : null;
  const batches = splitBatches(pieces, dough_g, mixer_max_g).map((b, k, arr) => ({
    no: k + 1, count: arr.length, pieces: b.pieces, dough_g: dough_g * b.frac,
    items: items.map(i => ({ ...i, grams: i.grams * b.frac })),
  }));
  return {
    recipe_id: recipe.id, name: recipe.name, factor,
    pieces, piece_weight_g: recipe.piece_weight_g,
    dough_g, flour_g: flour * factor * wf, waste_pct: waste, mixer_max_g,
    method: recipe.method, notes: recipe.notes,
    items, steps, batches,
  };
}
// every box a batch needs ticked before "Batch done": each ingredient + each step
function batchKeys(r) { return [...new Set(r.items.map(i => i.key))].concat(r.steps.map((s, k) => 's:' + k)); }

async function production(env, date, withStock) {
  const all = await loadAll(env);
  const orders = (await env.DB.prepare(`SELECT * FROM orders WHERE date = ? AND status <> 'cancelled'`).bind(date).all()).results;
  const ids = orders.map(o => o.id);
  let items = [];
  if (ids.length) items = (await env.DB.prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results;
  const byProd = new Map(); const unmatched = new Map();
  for (const it of items) {
    const p = matchProduct(all.products, it.product_id, it.product_name);
    if (!p) { unmatched.set(it.product_name, (unmatched.get(it.product_name) || 0) + it.qty); continue; }
    const cur = byProd.get(p.id) || { product_id: p.id, name: p.name, unit: p.unit, qty: 0, recipe_id: p.recipe_id, units_per_batch: p.units_per_batch };
    cur.qty += it.qty; byProd.set(p.id, cur);
  }
  const products = [...byProd.values()].sort((a, b) => a.name.localeCompare(b.name));
  const byRecipe = new Map(); const problems = [];
  for (const p of products) {
    const r = all.recipes.find(r => r.id === p.recipe_id);
    if (!r) { problems.push(`${p.name}: no recipe linked`); continue; }
    const upb = p.units_per_batch || r.yield_pieces;
    const f = p.qty / upb;
    const cur = byRecipe.get(r.id) || { recipe: r, factor: 0, products: [] };
    cur.factor += f; cur.products.push({ product_id: p.product_id, name: p.name, unit: p.unit, qty: p.qty }); byRecipe.set(r.id, cur);
  }
  // "+ Add bake": pieces of any recipe without an order
  const extras = (await env.DB.prepare(`SELECT * FROM extra_bakes WHERE date = ? ORDER BY id`).bind(date).all()).results;
  for (const e of extras) {
    const r = all.recipes.find(r => r.id === e.recipe_id); if (!r) continue;
    const cur = byRecipe.get(r.id) || { recipe: r, factor: 0, products: [] };
    cur.factor += e.pieces / (r.yield_pieces || 1); (cur.extras = cur.extras || []).push({ id: e.id, pieces: e.pieces, note: e.note, created_by: e.created_by }); byRecipe.set(r.id, cur);
  }
  const [bakesR, checksR, doneR] = await env.DB.batch([
    env.DB.prepare(`SELECT id, recipe_id, factor, created_at, created_by FROM bakes WHERE date = ? AND undone = 0`).bind(date),
    env.DB.prepare(`SELECT recipe_id, batch_no, item_key FROM batch_checks WHERE date = ?`).bind(date),
    env.DB.prepare(`SELECT * FROM batch_done WHERE date = ?`).bind(date),
  ]);
  const bakes = bakesR.results;
  const recipes = [...byRecipe.values()].map(x => {
    const s = scaleRecipe(x.recipe, x.factor, all.inventory);
    for (const b of s.batches) {
      b.checked = checksR.results.filter(c => c.recipe_id === s.recipe_id && c.batch_no === b.no).map(c => c.item_key);
      const d = doneR.results.find(d => d.recipe_id === s.recipe_id && d.batch_no === b.no);
      b.done = d ? { by: d.done_by, role: d.done_role, at: d.done_at } : null;
      b.keys = batchKeys(s);
    }
    return { ...s, products: x.products, extras: x.extras || [], baked: bakes.filter(b => b.recipe_id === x.recipe.id) };
  });
  const out = { date, orders_count: orders.length, products, recipes, unmatched: [...unmatched].map(([name, qty]) => ({ name, qty })), problems };
  if (withStock) {
    const need = new Map();
    for (const r of recipes) for (const i of r.items) {
      const k = norm(i.name); const cur = need.get(k) || { name: i.name, need_g: 0, liquid: i.liquid }; cur.need_g += i.grams; need.set(k, cur);
    }
    out.needs = [...need.values()].map(n => {
      const inv = matchInv(all.inventory, n.name);
      const stock_g = inv ? inv.stock * inv.g_per_unit : null;
      return { ...n, inventory_id: inv ? inv.id : null, unit: inv ? inv.unit : null, g_per_unit: inv ? inv.g_per_unit : null, stock_g, short: inv ? Math.max(0, n.need_g - stock_g) : null };
    }).sort((a, b) => b.need_g - a.need_g);
    const packNeed = new Map();
    for (const p of products) {
      const prod = all.products.find(x => x.id === p.product_id);
      for (const pk of (prod ? prod.packaging : [])) {
        const inv = all.inventory.find(i => i.id === pk.inventory_id); if (!inv) continue;
        const cur = packNeed.get(inv.id) || { name: inv.name, unit: inv.unit, need: 0, stock: inv.stock }; cur.need += pk.qty_per_unit * p.qty; packNeed.set(inv.id, cur);
      }
    }
    out.packaging_needs = [...packNeed.values()].map(x => ({ ...x, short: Math.max(0, x.need - x.stock) }));
  }
  return out;
}

async function importOrders(env, payload) {
  const all = await loadAll(env);
  const source = String(payload.source || 'portal').slice(0, 40);
  const list = Array.isArray(payload.orders) ? payload.orders : [];
  if (list.length > 2000) throw new Error('Too many orders in one import (max 2000).');
  let created = 0, updated = 0; const errors = []; const unmatched = new Set();
  const now = iso();
  for (let idx = 0; idx < list.length; idx++) {
    const o = list[idx] || {};
    const date = normDate(o.date || o.delivery_date || o.pickup_date);
    if (!date) { errors.push(`Order ${idx + 1}: missing or bad date`); continue; }
    const itemsIn = Array.isArray(o.items) ? o.items : [];
    const items = itemsIn.map(it => ({ name: String(it.product || it.name || it.sku || '').trim().slice(0, 200), qty: num(it.qty ?? it.quantity, 0) })).filter(it => it.name && it.qty);
    if (!items.length) { errors.push(`Order ${idx + 1}: no items`); continue; }
    let status = norm(o.status || 'new'); if (status === 'canceled') status = 'cancelled';
    const ext = o.external_id !== undefined && o.external_id !== null && String(o.external_id).trim() !== '' ? String(o.external_id).slice(0, 100) : null;
    let orderId = null;
    if (ext) {
      const ex = await env.DB.prepare(`SELECT id FROM orders WHERE source = ? AND external_id = ?`).bind(source, ext).first();
      if (ex) {
        orderId = ex.id;
        await env.DB.prepare(`UPDATE orders SET customer=?, date=?, fulfillment=?, status=?, notes=?, updated_at=? WHERE id=?`).bind(txt(o.customer, 200), date, txt(o.fulfillment || o.type, 40), status, txt(o.notes), now, orderId).run();
        await env.DB.prepare(`DELETE FROM order_items WHERE order_id = ?`).bind(orderId).run();
        updated++;
      }
    }
    if (!orderId) {
      const r = await env.DB.prepare(`INSERT INTO orders (source, external_id, customer, date, fulfillment, status, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .bind(source, ext, txt(o.customer, 200), date, txt(o.fulfillment || o.type, 40), status, txt(o.notes), now, now).run();
      orderId = r.meta.last_row_id; created++;
    }
    await env.DB.batch(items.map(it => {
      const p = matchProduct(all.products, null, it.name); if (!p) unmatched.add(it.name);
      return env.DB.prepare(`INSERT INTO order_items (order_id, product_id, product_name, qty) VALUES (?,?,?,?)`).bind(orderId, p ? p.id : null, it.name, it.qty);
    }));
  }
  return { ok: true, created, updated, errors, unmatched_products: [...unmatched] };
}

function normDate(s) {
  if (!s) return null; s = String(s).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; }
  return null;
}

async function bake(env, user, body) {
  const all = await loadAll(env);
  const r = all.recipes.find(r => r.id === num(body.recipe_id));
  const factor = num(body.factor, 0);
  if (!r || !(factor > 0)) return bad('Pick a recipe and an amount.');
  const detail = { ingredients: [], packaging: [], not_in_inventory: [] };
  const stmts = [];
  const wf = 1 + Math.max(0, Number(r.waste_pct) || 0) / 100; // waste % = extra dough actually mixed
  for (const i of r.items) {
    const inv = matchInv(all.inventory, i.name);
    const g = i.grams * factor * wf;
    if (!inv) { detail.not_in_inventory.push(i.name); continue; }
    const amt = g / (inv.g_per_unit || 1);
    detail.ingredients.push({ inventory_id: inv.id, name: inv.name, amount: amt, unit: inv.unit });
    stmts.push(env.DB.prepare(`UPDATE inventory SET stock = stock - ?, updated_at = ? WHERE id = ?`).bind(amt, iso(), inv.id));
  }
  for (const pp of (Array.isArray(body.products) ? body.products : [])) {
    const prod = all.products.find(p => p.id === num(pp.product_id)); if (!prod) continue;
    for (const pk of prod.packaging) {
      const inv = all.inventory.find(i => i.id === pk.inventory_id); if (!inv) continue;
      const amt = pk.qty_per_unit * num(pp.qty, 0);
      detail.packaging.push({ inventory_id: inv.id, name: inv.name, amount: amt, unit: inv.unit, product: prod.name });
      stmts.push(env.DB.prepare(`UPDATE inventory SET stock = stock - ?, updated_at = ? WHERE id = ?`).bind(amt, iso(), inv.id));
    }
  }
  stmts.push(env.DB.prepare(`INSERT INTO bakes (date, recipe_id, recipe_name, factor, detail, created_by, created_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(normDate(body.date) || iso().slice(0, 10), r.id, r.name, factor, JSON.stringify(detail), user.username, iso()));
  await env.DB.batch(stmts);
  return json({ ok: true, detail });
}

async function undoBake(env, id) {
  const b = await env.DB.prepare(`SELECT * FROM bakes WHERE id = ? AND undone = 0`).bind(id).first();
  if (!b) return bad('Not found', 404);
  const d = JSON.parse(b.detail || '{}');
  const stmts = [...(d.ingredients || []), ...(d.packaging || [])].map(x => env.DB.prepare(`UPDATE inventory SET stock = stock + ? WHERE id = ?`).bind(x.amount, x.inventory_id));
  stmts.push(env.DB.prepare(`UPDATE bakes SET undone = 1 WHERE id = ?`).bind(id));
  await env.DB.batch(stmts);
  return json({ ok: true });
}

// what the worker login gets: only today's scaled per-batch amounts and the steps (no baker's %, no base recipe, no costs)
function workerView(recipes) {
  return recipes.map(r => ({
    recipe_id: r.recipe_id, name: r.name, pieces: r.pieces, piece_weight_g: r.piece_weight_g, dough_g: r.dough_g,
    products: r.products.map(x => ({ name: x.name, unit: x.unit, qty: x.qty })), extra_pieces: (r.extras || []).reduce((a, e) => a + e.pieces, 0),
    steps: r.steps.map(s => ({ name: s.name, instruction: s.instruction, timer_min: s.timer_min })),
    batches: r.batches.map(b => ({ no: b.no, count: b.count, pieces: b.pieces, dough_g: b.dough_g, checked: b.checked, done: b.done, keys: b.keys,
      items: b.items.map(i => ({ name: i.name, grams: i.grams, liquid: i.liquid, step: i.step, key: i.key })) })),
  }));
}
// "Download all my data": every table except logins/sessions
const EXPORT_TABLES = ['inventory', 'deliveries', 'recipes', 'recipe_items', 'recipe_steps', 'products', 'product_packaging', 'orders', 'order_items', 'bakes', 'extra_bakes', 'batch_checks', 'batch_done', 'barcodes', 'scan_log'];
async function exportAll(env) {
  const res = await env.DB.batch(EXPORT_TABLES.map(t => env.DB.prepare(`SELECT * FROM ${t}`)));
  const tables = {}; EXPORT_TABLES.forEach((t, k) => { tables[t] = res[k].results; });
  return { ok: true, app: 'Spelt Brothers Bakery Admin', exported_at: iso(), units_note: 'Weights are stored in grams (recipe_items.grams, piece_weight_g, mixer_max_g). 1 lb = 453.592 g, 1 oz = 28.3495 g, 1 qt = 946.353 g of water. Inventory stock is in each item\'s own unit.', tables };
}

async function dashboard(env, today) {
  const prod = await production(env, today, true);
  const all = await loadAll(env);
  const low = all.inventory.filter(i => i.low_level !== null && i.stock <= i.low_level);
  const upcoming = (await env.DB.prepare(`SELECT date, COUNT(*) n FROM orders WHERE date >= ? AND status <> 'cancelled' GROUP BY date ORDER BY date LIMIT 7`).bind(today).all()).results;
  const bakes = (await env.DB.prepare(`SELECT id, date, recipe_name, factor, created_by, created_at, undone FROM bakes ORDER BY id DESC LIMIT 5`).all()).results;
  return { production: prod, low, upcoming, bakes, counts: { recipes: all.recipes.length, products: all.products.length, inventory: all.inventory.length } };
}

// ---------- router ----------

// ---------- barcode scanning ----------
const UNIT_G = { kg: 1000, g: 1, lb: 453.592, oz: 28.3495, L: 1000, ml: 1, qt: 946.353 };
// "036000291452" (UPC-A, 12 digits) and "0036000291452" (EAN-13) are the same product: store as EAN-13
function normCode(c) { let s = String(c ?? '').trim().replace(/\s+/g, ''); if (/^\d{12}$/.test(s)) s = '0' + s; return s.slice(0, 120); }
// one bag/package of `size` `packUnit`, expressed in the inventory item's own unit; null when the units can't be converted
function packAmount(size, packUnit, item) {
  size = Number(size); if (!(size > 0) || !item) return null;
  if (packUnit === item.unit) return size;
  if (item.unit === 'pcs' || packUnit === 'pcs') return null;
  const pg = UNIT_G[packUnit]; const ig = Number(item.g_per_unit) || UNIT_G[item.unit];
  if (!pg || !ig) return null;
  return Math.round(size * pg / ig * 1e6) / 1e6;
}
// stock change for a scan: bags × bag size (in the item's unit); 'use' subtracts
function scanDelta(packs, size, packUnit, item, mode) {
  const per = packAmount(size, packUnit, item); packs = Number(packs);
  if (per === null || !(packs > 0)) return null;
  const amt = Math.round(packs * per * 1e6) / 1e6;
  return mode === 'use' ? -amt : amt;
}
async function barcodeLookup(env, codeIn) {
  const code = normCode(codeIn);
  if (!code) return { ok: false, error: 'No barcode' };
  const bc = await env.DB.prepare(`SELECT * FROM barcodes WHERE code = ?`).bind(code).first();
  if (!bc) return { ok: true, code, found: false };
  const item = await env.DB.prepare(`SELECT * FROM inventory WHERE id = ?`).bind(bc.inventory_id).first();
  if (!item) return { ok: true, code, found: false, orphan: true };
  return { ok: true, code, found: true, barcode: bc, item, per_pack: packAmount(bc.pack_size, bc.pack_unit, item) };
}
async function scanApi(env, p, m, body, url, today) {
  let x;
  if (p === '/api/barcode' && m === 'GET') return json(await barcodeLookup(env, url.searchParams.get('code')));
  if (p === '/api/barcodes' && m === 'POST') {
    const code = normCode(body.code); if (!code) return bad('Barcode number is missing');
    const size = num(body.pack_size); if (!(size > 0)) return bad('Enter the size of one bag or package');
    const packUnit = txt(body.pack_unit, 20) || '';
    let invId = num(body.inventory_id); let item = null;
    if (body.new_item) {
      const ni = body.new_item; const name = (txt(ni.name, 200) || '').trim(); if (!name) return bad('Enter a name for the new item');
      const unit = Object.prototype.hasOwnProperty.call(UNIT_G, ni.unit) || ni.unit === 'pcs' ? ni.unit : 'kg';
      const kind = ni.kind === 'packaging' ? 'packaging' : 'ingredient';
      const gpu = UNIT_G[unit] ?? 1;
      const dup = await env.DB.prepare(`SELECT id FROM inventory WHERE lower(trim(name)) = lower(?)`).bind(name).first();
      if (dup) invId = dup.id;
      else { const r = await env.DB.prepare(`INSERT INTO inventory (name, kind, unit, g_per_unit, stock, updated_at) VALUES (?,?,?,?,0,?)`).bind(name, kind, unit, gpu, iso()).run(); invId = r.meta.last_row_id; }
    }
    if (invId) item = await env.DB.prepare(`SELECT * FROM inventory WHERE id = ?`).bind(invId).first();
    if (!item) return bad('Choose which item this barcode is');
    if (packAmount(size, packUnit, item) === null) return bad(item.unit === 'pcs' ? 'This item is counted in pcs, so enter the package size in pcs' : 'Enter the bag size in kg, g, lb, oz, L or ml');
    const now = iso();
    await env.DB.prepare(`INSERT INTO barcodes (code, inventory_id, pack_size, pack_unit, created_at, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET inventory_id = excluded.inventory_id, pack_size = excluded.pack_size, pack_unit = excluded.pack_unit, updated_at = excluded.updated_at`).bind(code, item.id, size, packUnit, now, now).run();
    return json(await barcodeLookup(env, code));
  }
  if ((x = p.match(/^\/api\/barcodes\/(\d+)$/)) && m === 'DELETE') { await env.DB.prepare(`DELETE FROM barcodes WHERE id = ?`).bind(Number(x[1])).run(); return json({ ok: true }); }
  if (p === '/api/scan' && m === 'POST') {
    const look = await barcodeLookup(env, body.code); if (!look.found) return bad('This barcode is not set up yet');
    const { barcode: bc, item } = look; const mode = body.mode === 'use' ? 'use' : 'add';
    const packs = num(body.packs, 1); if (!(packs > 0) || packs > 1000) return bad('Enter how many bags');
    const delta = scanDelta(packs, bc.pack_size, bc.pack_unit, item, mode); if (delta === null) return bad('Bag size does not match the item unit — fix it in Inventory');
    const now = iso(); let costTotal = null; let costChanged = 0; const stmts = [];
    if (mode === 'add') {
      const cpp = num(body.cost_per_pack);
      if (cpp !== null && cpp >= 0) costTotal = Math.round(cpp * packs * 100) / 100;
      stmts.push(env.DB.prepare(`INSERT INTO deliveries (inventory_id, qty, cost_total, supplier, date, created_at) VALUES (?,?,?,?,?,?)`).bind(item.id, delta, costTotal, item.supplier ? item.supplier + ' (scanned)' : 'Scanned', today, now));
      if (cpp !== null && cpp > 0 && body.update_cost !== false) { costChanged = 1; stmts.push(env.DB.prepare(`UPDATE inventory SET cost_per_unit = ? WHERE id = ?`).bind(cpp / look.per_pack, item.id)); }
      if (cpp !== null && cpp >= 0) stmts.push(env.DB.prepare(`UPDATE barcodes SET last_cost = ? WHERE id = ?`).bind(cpp, bc.id));
    }
    stmts.push(env.DB.prepare(`UPDATE inventory SET stock = stock + ?, updated_at = ? WHERE id = ?`).bind(delta, now, item.id));
    // one transaction; delivery_id = the delivery row inserted first in this batch (UPDATEs don't move last_insert_rowid)
    stmts.push(env.DB.prepare(`INSERT INTO scan_log (code, inventory_id, mode, packs, qty, delivery_id, cost_total, prev_cost, cost_changed, created_at) VALUES (?,?,?,?,?,${mode === 'add' ? 'last_insert_rowid()' : 'NULL'},?,?,?,?)`).bind(bc.code, item.id, mode, packs, delta, costTotal, item.cost_per_unit, costChanged, now));
    const res = await env.DB.batch(stmts);
    const logId = res[res.length - 1].meta.last_row_id;
    const after = await env.DB.prepare(`SELECT * FROM inventory WHERE id = ?`).bind(item.id).first();
    return json({ ok: true, log_id: logId, mode, packs, delta, item: after, barcode: bc, per_pack: look.per_pack });
  }
  if ((x = p.match(/^\/api\/scan\/(\d+)\/undo$/)) && m === 'POST') {
    const lg = await env.DB.prepare(`SELECT * FROM scan_log WHERE id = ?`).bind(Number(x[1])).first();
    if (!lg) return bad('Not found', 404); if (lg.undone) return bad('Already undone');
    const stmts = [env.DB.prepare(`UPDATE inventory SET stock = stock - ?, updated_at = ? WHERE id = ?`).bind(lg.qty, iso(), lg.inventory_id),
      env.DB.prepare(`UPDATE scan_log SET undone = 1 WHERE id = ?`).bind(lg.id)];
    if (lg.delivery_id) stmts.push(env.DB.prepare(`DELETE FROM deliveries WHERE id = ?`).bind(lg.delivery_id));
    if (lg.cost_changed) stmts.push(env.DB.prepare(`UPDATE inventory SET cost_per_unit = ? WHERE id = ?`).bind(lg.prev_cost, lg.inventory_id));
    await env.DB.batch(stmts);
    return json({ ok: true, item: await env.DB.prepare(`SELECT * FROM inventory WHERE id = ?`).bind(lg.inventory_id).first() });
  }
  if (p === '/api/scans' && m === 'GET') return json({ ok: true, scans: (await env.DB.prepare(`SELECT s.*, i.name, i.unit FROM scan_log s LEFT JOIN inventory i ON i.id = s.inventory_id ORDER BY s.id DESC LIMIT 20`).all()).results });
  return null;
}

async function api(req, env, url, user) {
  const p = url.pathname; const m = req.method;
  const idOf = re => { const x = p.match(re); return x ? Number(x[1]) : null; };
  const body = m === 'POST' || m === 'PUT' ? await req.json().catch(() => ({})) : null;
  const today = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('today') || '') ? url.searchParams.get('today') : iso().slice(0, 10);

  if (p === '/api/me') return json({ ok: true, role: user.role, username: user.username });
  if (p === '/api/logout' && m === 'POST') {
    const tok = getCookie(req, 'sb_session'); if (tok) await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256(tok)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': 'sb_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0' });
  }
  if (p === '/api/worker/production' && m === 'GET') {
    const date = normDate(url.searchParams.get('date')) || today;
    const pr = await production(env, date, false);
    return json({ ok: true, date, recipes: workerView(pr.recipes), problems: pr.problems, unmatched: pr.unmatched });
  }
  // tick boxes + batch done (workers and owner)
  if (p === '/api/check' && m === 'POST') {
    const date = normDate(body.date); const rid = num(body.recipe_id); const bn = num(body.batch_no); const key = txt(body.key, 300);
    if (!date || !rid || !bn || !key) return bad('Missing batch');
    const done = await env.DB.prepare(`SELECT done_at FROM batch_done WHERE date=? AND recipe_id=? AND batch_no=?`).bind(date, rid, bn).first();
    if (done) return bad('This batch is already marked done');
    if (body.checked) await env.DB.prepare(`INSERT OR REPLACE INTO batch_checks (date, recipe_id, batch_no, item_key, checked_by, checked_at) VALUES (?,?,?,?,?,?)`).bind(date, rid, bn, key, user.username, iso()).run();
    else await env.DB.prepare(`DELETE FROM batch_checks WHERE date=? AND recipe_id=? AND batch_no=? AND item_key=?`).bind(date, rid, bn, key).run();
    const checked = (await env.DB.prepare(`SELECT item_key FROM batch_checks WHERE date=? AND recipe_id=? AND batch_no=?`).bind(date, rid, bn).all()).results.map(x => x.item_key);
    return json({ ok: true, checked });
  }
  if (p === '/api/batch/done' && m === 'POST') {
    const date = normDate(body.date); const rid = num(body.recipe_id); const bn = num(body.batch_no);
    const pr = await production(env, date, false);
    const r = pr.recipes.find(r => r.recipe_id === rid); const b = r && r.batches.find(b => b.no === bn);
    if (!b) return bad('That batch is not on the list for this day');
    if (b.done) return json({ ok: true, done: b.done });
    const missing = b.keys.filter(k => !b.checked.includes(k));
    if (missing.length) return bad('Check every ingredient and step first (' + missing.length + ' left)');
    const at = iso(); const by = user.role === 'owner' ? 'Owner' : 'Worker';
    await env.DB.prepare(`INSERT OR IGNORE INTO batch_done (date, recipe_id, batch_no, batch_count, done_by, done_role, done_at) VALUES (?,?,?,?,?,?,?)`).bind(date, rid, bn, b.count, by, user.role, at).run();
    return json({ ok: true, done: { by, role: user.role, at } });
  }
  if (user.role !== 'owner') return bad('Owner only', 403);
  if (p.startsWith('/api/barcode') || p.startsWith('/api/scan')) { const r = await scanApi(env, p, m, body, url, today); if (r) return r; }

  if (p === '/api/all' && m === 'GET') {
    const all = await loadAll(env);
    const barcodes = (await env.DB.prepare(`SELECT * FROM barcodes ORDER BY id`).all()).results;
    return json({ ok: true, ...all, barcodes });
  }
  if (p === '/api/batch/reopen' && m === 'POST') {
    const date = normDate(body.date); const rid = num(body.recipe_id); const bn = num(body.batch_no);
    await env.DB.prepare(`DELETE FROM batch_done WHERE date=? AND recipe_id=? AND batch_no=?`).bind(date, rid, bn).run();
    return json({ ok: true });
  }
  // + Add bake (no order needed)
  if (p === '/api/extra-bakes' && m === 'POST') {
    const date = normDate(body.date); const rid = num(body.recipe_id); const pcs = num(body.pieces);
    if (!date) return bad('Pick a day');
    const r = await env.DB.prepare(`SELECT id FROM recipes WHERE id=?`).bind(rid).first(); if (!r) return bad('Pick a recipe');
    if (!(pcs > 0) || pcs > 100000) return bad('Enter how many to bake');
    const res = await env.DB.prepare(`INSERT INTO extra_bakes (date, recipe_id, pieces, note, created_by, created_at) VALUES (?,?,?,?,?,?)`).bind(date, rid, pcs, txt(body.note, 300), user.username, iso()).run();
    return json({ ok: true, id: res.meta.last_row_id });
  }
  let x;
  if ((x = p.match(/^\/api\/extra-bakes\/(\d+)$/)) && m === 'DELETE') { await env.DB.prepare(`DELETE FROM extra_bakes WHERE id=?`).bind(Number(x[1])).run(); return json({ ok: true }); }
  if (p === '/api/export' && m === 'GET') return json(await exportAll(env));
  if (p === '/api/dashboard') return json({ ok: true, ...(await dashboard(env, today)) });
  if (p === '/api/production') { const date = normDate(url.searchParams.get('date')) || today; return json({ ok: true, ...(await production(env, date, true)) }); }

  // inventory
  if (p === '/api/inventory' && m === 'POST') {
    const b = body; const name = txt(b.name, 200); if (!name || !name.trim()) return bad('Name is required');
    const units = { kg: 1000, g: 1, lb: 453.592, oz: 28.3495, L: 1000, ml: 1, qt: 946.353 };
    const unit = txt(b.unit, 20) || 'kg';
    const gpu = units[unit] ?? (num(b.g_per_unit, 1) || 1);
    const vals = [name.trim(), b.kind === 'packaging' ? 'packaging' : 'ingredient', unit, gpu, num(b.stock, 0), num(b.cost_per_unit), num(b.low_level), txt(b.supplier, 200), txt(b.notes), iso()];
    if (b.id) await env.DB.prepare(`UPDATE inventory SET name=?, kind=?, unit=?, g_per_unit=?, stock=?, cost_per_unit=?, low_level=?, supplier=?, notes=?, updated_at=? WHERE id=?`).bind(...vals, num(b.id)).run();
    else await env.DB.prepare(`INSERT INTO inventory (name, kind, unit, g_per_unit, stock, cost_per_unit, low_level, supplier, notes, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(...vals).run();
    return json({ ok: true });
  }
  let id;
  if ((id = idOf(/^\/api\/inventory\/(\d+)$/)) && m === 'DELETE') { await env.DB.batch([env.DB.prepare(`DELETE FROM inventory WHERE id=?`).bind(id), env.DB.prepare(`DELETE FROM product_packaging WHERE inventory_id=?`).bind(id), env.DB.prepare(`DELETE FROM barcodes WHERE inventory_id=?`).bind(id)]); return json({ ok: true }); }
  if ((id = idOf(/^\/api\/inventory\/(\d+)\/delivery$/)) && m === 'POST') {
    const qty = num(body.qty, 0); if (!(qty > 0)) return bad('Enter the amount delivered');
    const ct = num(body.cost_total);
    const stmts = [env.DB.prepare(`INSERT INTO deliveries (inventory_id, qty, cost_total, supplier, date, created_at) VALUES (?,?,?,?,?,?)`).bind(id, qty, ct, txt(body.supplier, 200), normDate(body.date) || today, iso()),
      env.DB.prepare(`UPDATE inventory SET stock = stock + ?, updated_at = ? WHERE id = ?`).bind(qty, iso(), id)];
    if (ct !== null && body.update_cost) stmts.push(env.DB.prepare(`UPDATE inventory SET cost_per_unit = ? WHERE id = ?`).bind(ct / qty, id));
    if (body.supplier) stmts.push(env.DB.prepare(`UPDATE inventory SET supplier = ? WHERE id = ?`).bind(txt(body.supplier, 200), id));
    await env.DB.batch(stmts); return json({ ok: true });
  }
  if (p === '/api/deliveries') return json({ ok: true, deliveries: (await env.DB.prepare(`SELECT d.*, i.name, i.unit FROM deliveries d LEFT JOIN inventory i ON i.id = d.inventory_id ORDER BY d.id DESC LIMIT 50`).all()).results });

  // recipes
  if (p === '/api/recipes' && m === 'POST') {
    const b = body; const name = txt(b.name, 200); if (!name || !name.trim()) return bad('Recipe name is required');
    const steps = (Array.isArray(b.steps) ? b.steps : []).map((s, k) => ({ name: (txt(s.name, 200) || '').trim(), instruction: txt(s.instruction, 5000) || '', timer_min: num(s.timer_min) > 0 ? num(s.timer_min) : null, sort: k })).filter(s => s.name || s.instruction.trim()).slice(0, 60);
    const items = (Array.isArray(b.items) ? b.items : []).map((i, k) => {
      let st = num(i.step); if (!(Number.isInteger(st) && st >= 0 && st < steps.length)) st = null;
      const liq = i.liquid === true || i.liquid === 1 ? 1 : i.liquid === false || i.liquid === 0 ? 0 : null;
      return { name: txt(i.name, 200), grams: num(i.grams, 0), is_flour: i.is_flour ? 1 : 0, sort: k, step: st, liquid: liq };
    }).filter(i => i.name && i.name.trim());
    const vals = [name.trim(), num(b.yield_pieces, 1) || 1, num(b.piece_weight_g), txt(b.method, 20000), txt(b.notes, 5000), iso()];
    const extra = [num(b.mixer_max_g) > 0 ? num(b.mixer_max_g) : null, num(b.waste_pct) > 0 ? Math.min(num(b.waste_pct), 100) : null];
    let rid = num(b.id);
    if (rid) await env.DB.prepare(`UPDATE recipes SET name=?, yield_pieces=?, piece_weight_g=?, method=?, notes=?, updated_at=?, mixer_max_g=?, waste_pct=? WHERE id=?`).bind(...vals, ...extra, rid).run();
    else rid = (await env.DB.prepare(`INSERT INTO recipes (name, yield_pieces, piece_weight_g, method, notes, updated_at, mixer_max_g, waste_pct) VALUES (?,?,?,?,?,?,?,?)`).bind(...vals, ...extra).run()).meta.last_row_id;
    await env.DB.batch([env.DB.prepare(`DELETE FROM recipe_items WHERE recipe_id=?`).bind(rid), env.DB.prepare(`DELETE FROM recipe_steps WHERE recipe_id=?`).bind(rid),
      ...items.map(i => env.DB.prepare(`INSERT INTO recipe_items (recipe_id, name, grams, is_flour, sort, step, liquid) VALUES (?,?,?,?,?,?,?)`).bind(rid, i.name.trim(), i.grams, i.is_flour, i.sort, i.step, i.liquid)),
      ...steps.map(s => env.DB.prepare(`INSERT INTO recipe_steps (recipe_id, sort, name, instruction, timer_min) VALUES (?,?,?,?,?)`).bind(rid, s.sort, s.name, s.instruction, s.timer_min))]);
    return json({ ok: true, id: rid });
  }
  if ((id = idOf(/^\/api\/recipes\/(\d+)$/)) && m === 'DELETE') { await env.DB.batch([env.DB.prepare(`DELETE FROM recipes WHERE id=?`).bind(id), env.DB.prepare(`DELETE FROM recipe_items WHERE recipe_id=?`).bind(id), env.DB.prepare(`DELETE FROM recipe_steps WHERE recipe_id=?`).bind(id), env.DB.prepare(`UPDATE products SET recipe_id=NULL WHERE recipe_id=?`).bind(id)]); return json({ ok: true }); }

  // products
  if (p === '/api/products' && m === 'POST') {
    const b = body; const name = txt(b.name, 200); if (!name || !name.trim()) return bad('Product name is required');
    const vals = [name.trim(), txt(b.unit, 60), num(b.recipe_id), num(b.units_per_batch), txt(b.aliases, 1000), num(b.labor_per_batch), num(b.overhead_per_batch), num(b.markup_pct), num(b.current_price), b.active === false ? 0 : 1, iso()];
    let pid = num(b.id);
    if (pid) await env.DB.prepare(`UPDATE products SET name=?, unit=?, recipe_id=?, units_per_batch=?, aliases=?, labor_per_batch=?, overhead_per_batch=?, markup_pct=?, current_price=?, active=?, updated_at=? WHERE id=?`).bind(...vals, pid).run();
    else pid = (await env.DB.prepare(`INSERT INTO products (name, unit, recipe_id, units_per_batch, aliases, labor_per_batch, overhead_per_batch, markup_pct, current_price, active, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(...vals).run()).meta.last_row_id;
    if (Array.isArray(b.packaging)) await env.DB.batch([env.DB.prepare(`DELETE FROM product_packaging WHERE product_id=?`).bind(pid),
      ...b.packaging.filter(x => num(x.inventory_id)).map(x => env.DB.prepare(`INSERT INTO product_packaging (product_id, inventory_id, qty_per_unit) VALUES (?,?,?)`).bind(pid, num(x.inventory_id), num(x.qty_per_unit, 1)))]);
    // re-link order items that were waiting for this product
    await env.DB.prepare(`UPDATE order_items SET product_id = ? WHERE product_id IS NULL AND lower(trim(product_name)) = ?`).bind(pid, norm(name)).run();
    return json({ ok: true, id: pid });
  }
  if ((id = idOf(/^\/api\/products\/(\d+)$/)) && m === 'DELETE') { await env.DB.batch([env.DB.prepare(`DELETE FROM products WHERE id=?`).bind(id), env.DB.prepare(`DELETE FROM product_packaging WHERE product_id=?`).bind(id), env.DB.prepare(`UPDATE order_items SET product_id=NULL WHERE product_id=?`).bind(id)]); return json({ ok: true }); }

  // orders
  if (p === '/api/orders' && m === 'GET') {
    const from = normDate(url.searchParams.get('from')) || today; const to = normDate(url.searchParams.get('to')) || from;
    const orders = (await env.DB.prepare(`SELECT * FROM orders WHERE date BETWEEN ? AND ? ORDER BY date, customer COLLATE NOCASE, id`).bind(from, to).all()).results;
    const ids = orders.map(o => o.id); let items = [];
    if (ids.length) items = (await env.DB.prepare(`SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results;
    return json({ ok: true, orders: orders.map(o => ({ ...o, items: items.filter(i => i.order_id === o.id) })) });
  }
  if (p === '/api/orders' && m === 'POST') {
    const b = body; const date = normDate(b.date); if (!date) return bad('Pick a date');
    const all = await loadAll(env);
    const items = (Array.isArray(b.items) ? b.items : []).map(i => { const pr = matchProduct(all.products, num(i.product_id), i.product_name); return { product_id: pr ? pr.id : null, product_name: pr ? pr.name : txt(i.product_name, 200), qty: num(i.qty, 0) }; }).filter(i => i.product_name && i.qty);
    if (!items.length) return bad('Add at least one product with a quantity');
    const vals = [txt(b.customer, 200), date, txt(b.fulfillment, 40), txt(b.status, 40) || 'new', txt(b.notes), iso()];
    let oid = num(b.id);
    if (oid) await env.DB.prepare(`UPDATE orders SET customer=?, date=?, fulfillment=?, status=?, notes=?, updated_at=? WHERE id=?`).bind(...vals, oid).run();
    else oid = (await env.DB.prepare(`INSERT INTO orders (source, customer, date, fulfillment, status, notes, updated_at, created_at) VALUES ('manual',?,?,?,?,?,?,?)`).bind(...vals, iso()).run()).meta.last_row_id;
    await env.DB.batch([env.DB.prepare(`DELETE FROM order_items WHERE order_id=?`).bind(oid), ...items.map(i => env.DB.prepare(`INSERT INTO order_items (order_id, product_id, product_name, qty) VALUES (?,?,?,?)`).bind(oid, i.product_id, i.product_name, i.qty))]);
    return json({ ok: true, id: oid });
  }
  if ((id = idOf(/^\/api\/orders\/(\d+)$/)) && m === 'DELETE') { await env.DB.batch([env.DB.prepare(`DELETE FROM orders WHERE id=?`).bind(id), env.DB.prepare(`DELETE FROM order_items WHERE order_id=?`).bind(id)]); return json({ ok: true }); }
  if ((id = idOf(/^\/api\/orders\/(\d+)\/status$/)) && m === 'POST') { await env.DB.prepare(`UPDATE orders SET status=?, updated_at=? WHERE id=?`).bind(txt(body.status, 40) || 'new', iso(), id).run(); return json({ ok: true }); }
  if (p === '/api/orders/import-json' && m === 'POST') {
    try { return json(await importOrders(env, { ...body, source: body.source || 'csv' })); } catch (e) { return bad(e.message); }
  }

  // baking
  if (p === '/api/bake' && m === 'POST') return bake(env, user, body);
  if ((id = idOf(/^\/api\/bakes\/(\d+)\/undo$/)) && m === 'POST') return undoBake(env, id);
  if (p === '/api/bakes') return json({ ok: true, bakes: (await env.DB.prepare(`SELECT * FROM bakes ORDER BY id DESC LIMIT 50`).all()).results });

  // settings
  if (p === '/api/settings' && m === 'GET') {
    const k = await env.DB.prepare(`SELECT value FROM settings WHERE key='import_key'`).first();
    const users = (await env.DB.prepare(`SELECT username, role, updated_at FROM users`).all()).results;
    const bk = await env.DB.prepare(`SELECT key, value FROM settings WHERE key IN ('backup_key','backup_last_sent')`).all();
    const sv = Object.fromEntries(bk.results.map(r => [r.key, r.value]));
    return json({ ok: true, import_key: k ? k.value : null, users, backup_key: sv.backup_key || null, backup_last_sent: sv.backup_last_sent || null });
  }
  if (p === '/api/history/clear' && m === 'POST') { if (body.confirm !== 'CLEAR') return bad('Type CLEAR to confirm'); await env.DB.batch([env.DB.prepare(`DELETE FROM bakes`), env.DB.prepare(`DELETE FROM deliveries`)]); return json({ ok: true }); }
  if (p === '/api/settings/import-key' && m === 'POST') { const k = randHex(24); await env.DB.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('import_key', ?)`).bind(k).run(); return json({ ok: true, import_key: k }); }
  if (p === '/api/password' && m === 'POST') {
    const target = body.target === 'worker' ? 'worker' : 'owner';
    const np = String(body.new_password || '');
    if (np.length < 8) return bad('New password must be at least 8 characters');
    if (target === 'owner') {
      const u = await env.DB.prepare(`SELECT * FROM users WHERE id=?`).bind(user.id).first();
      if (!safeEq(await pbkdf2(String(body.current_password || ''), u.salt), u.hash)) return bad('Current password is wrong', 401);
    }
    const salt = randHex(16); const h = await pbkdf2(np, salt);
    const tu = await env.DB.prepare(`SELECT id FROM users WHERE role=? ORDER BY id LIMIT 1`).bind(target).first();
    const stmts = [env.DB.prepare(`UPDATE users SET salt=?, hash=?, updated_at=? WHERE id=?`).bind(salt, h, iso(), tu.id)];
    if (target === 'worker') stmts.push(env.DB.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(tu.id));
    await env.DB.batch(stmts);
    return json({ ok: true });
  }
  return bad('Not found', 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    try {
      await init(env);
      const p = url.pathname;
      if (p === '/api/orders/import' && req.method === 'POST') {
        const auth = req.headers.get('Authorization') || ''; const key = (auth.startsWith('Bearer ') ? auth.slice(7) : req.headers.get('X-Import-Key') || '').trim();
        const row = await env.DB.prepare(`SELECT value FROM settings WHERE key='import_key'`).first();
        if (!key || !row || !safeEq(await sha256(key), await sha256(row.value))) return bad('Bad import key', 401);
        try { return json(await importOrders(env, await req.json())); } catch (e) { return bad(e.message || 'Bad JSON'); }
      }
      if (p === '/api/backup' && req.method === 'GET') { // for the daily email backup job: Bearer <backup key>
        const auth = req.headers.get('Authorization') || ''; const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
        const row = await env.DB.prepare(`SELECT value FROM settings WHERE key='backup_key'`).first();
        if (!key || !row || !safeEq(await sha256(key), await sha256(row.value))) return bad('Bad backup key', 401);
        const data = await exportAll(env);
        if (url.searchParams.get('mark') === 'sent') await env.DB.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('backup_last_sent', ?)`).bind(iso()).run();
        return json(data);
      }
      if (p === '/api/login' && req.method === 'POST') return login(req, env);
      const user = await getUser(req, env);
      if (p.startsWith('/api/')) {
        if (!user) return bad('Please log in', 401);
        if ((req.method === 'POST' || req.method === 'PUT') && !(req.headers.get('Content-Type') || '').includes('application/json')) return bad('JSON only', 415);
        return await api(req, env, url, user);
      }
      if (p === '/app.js') { if (!user) return new Response('Please log in', { status: 401, headers: SEC_HEADERS }); return new Response(APP_JS, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', ...SEC_HEADERS } }); }
      if (p === '/scanlib.js') { if (!user || user.role !== 'owner') return new Response('Owner only', { status: 403, headers: SEC_HEADERS }); return new Response(SCAN_LIB, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', ...SEC_HEADERS, 'Cache-Control': 'private, max-age=86400' } }); }
      if (p === '/manifest.webmanifest') return new Response(JSON.stringify({ name: 'Spelt Brothers Bakery Admin', short_name: 'Spelt Admin', start_url: '/', scope: '/', display: 'standalone', background_color: '#f7f3f8', theme_color: '#452747', icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }] }), { headers: { 'Content-Type': 'application/manifest+json', ...SEC_HEADERS } });
      if (p === '/app.css') return new Response(APP_CSS, { headers: { 'Content-Type': 'text/css; charset=utf-8', ...SEC_HEADERS } });
      if (p.endsWith('.png') && env.ASSETS) return env.ASSETS.fetch(req);
      if (!user) return html(LOGIN_HTML);
      return html(APP_HTML.replace('__ROLE__', user.role));
    } catch (e) {
      return json({ ok: false, error: 'Server error: ' + (e && e.message ? e.message : String(e)) }, 500);
    }
  },
};
