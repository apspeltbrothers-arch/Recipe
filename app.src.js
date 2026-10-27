
(function(){
'use strict';
const ROLE = document.body.dataset.role;
const main = document.getElementById('main');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const localToday = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
const niceDate = s => { try { return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' }); } catch(e) { return s; } };
const n = v => (v === '' || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v);
const round = (v, step) => Math.round(v / step) * step;
// grams, rounded sensibly: under 10 g to 0.1 g, under 1 kg to 1 g, above that to 5 g
function gRound(g){ if (g === null || g === undefined) return null; const a = Math.abs(g); return a < 10 ? round(g, 0.1) : a < 1000 ? round(g, 1) : round(g, 5); }
// ---- US units (2026-10-26): grams stay in the database; everything shows and is typed in lb/oz, liquids in quarts ----
const G_LB = 453.59237, G_OZ = 28.349523125, G_QT = 946.352946;
const trimN = (v, d) => Number(v.toFixed(d)).toLocaleString('en-US', { maximumFractionDigits: d });
function fmtOz(oz){ return (oz < 1 ? trimN(oz, 2) : trimN(oz, 1)) + ' oz'; }
function fmtLbOz(g){ const neg = g < 0; const oz = Math.abs(g) / G_OZ; let s;
  if (Math.round(oz * 100) / 100 < 16) s = fmtOz(oz);
  else { let lb = Math.floor(oz / 16); let r = Math.round((oz - lb * 16) * 10) / 10; if (r >= 16) { lb++; r = 0; } s = lb.toLocaleString('en-US') + ' lb' + (r ? ' ' + trimN(r, 1) + ' oz' : ''); }
  return (neg ? '−' : '') + s; }
function fmtQt(g){ const q = Math.abs(g) / G_QT; const neg = g < 0 ? '−' : '';
  if (q < 0.25) return neg + trimN(q, 3) + ' qt <span class="pct">(' + trimN(q * 32, 1) + ' fl oz)</span>';
  return neg + trimN(q, 2) + ' qt'; }
// fmtG(grams, _, liquid): weights in lb + oz, liquids in quarts
function fmtG(g, withKg = true, liquid = false){ if (g === null || g === undefined || isNaN(g)) return '–'; return liquid ? fmtQt(g) : fmtLbOz(g); }
const LIQ_RE = /\b(water|oil|milk|eggs?|juice|vinegar|cream|liquid)\b/i;
const isLiqUnit = u => u === 'qt' || u === 'L' || u === 'ml';
// same rule as the server: the recipe's "liquid" box wins, else a liquid Inventory unit or a liquid-sounding name
function isLiq(item){ if (item.liquid !== null && item.liquid !== undefined && item.liquid !== '') return !!Number(item.liquid) || item.liquid === true; const inv = DATA && invByName(item.name); if (inv && isLiqUnit(inv.unit)) return true; return LIQ_RE.test(String(item.name || '')); }
const lbsNum = g => g === null || g === undefined || g === '' ? '' : Math.round(g / G_LB * 100) / 100;
const fmtPct = p => p === null || p === undefined ? '' : (Math.round(p * 10) / 10).toLocaleString('en-US') + '%';
const money = v => v === null || v === undefined || isNaN(v) ? '–' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: v !== 0 && Math.abs(v) < 0.1 ? 4 : 2 });
const qty = v => v === null || v === undefined ? '–' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
const pieces = v => Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 });
function toast(msg){ const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
let routeSeq = 0;
async function api(path, opts = {}){
  const seq = routeSeq;
  const o = { method: opts.method || 'GET', headers: {} };
  if (opts.body !== undefined) { o.method = opts.method || 'POST'; o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(path + sep + 'today=' + localToday(), o);
  if (r.status === 401 && !path.includes('password')) { location.href = '/'; throw new Error('Logged out'); }
  const j = await r.json().catch(() => ({ ok: false, error: 'Bad response' }));
  if (o.method === 'GET' && seq !== routeSeq) throw new Error('__stale');
  if (!j.ok) throw new Error(j.error || 'Something went wrong');
  return j;
}
function modal(html, onMount){ const bg = document.createElement('div'); bg.className = 'modal-bg'; bg.innerHTML = '<div class="modal">' + html + '</div>';
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); }); document.body.appendChild(bg); const close = () => bg.remove();
  bg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close)); if (onMount) onMount(bg.querySelector('.modal'), close); return close; }
const val = (root, sel) => { const el = root.querySelector(sel); return el ? el.value : null; };
function guard(fn){ return async (...a) => { try { await fn(...a); } catch(e) { toast(e.message); } }; }

document.getElementById('logout').addEventListener('click', guard(async () => { await api('/api/logout', { body: {} }); location.href = '/'; }));

const OWNER_TABS = [['dashboard','🏠','Home'],['orders','📦','Orders'],['production','🔥','Bake today'],['recipes','📖','Recipes'],['scaler','⚖️','Scaler'],['inventory','🧺','Inventory'],['scan','📷','Scan'],['pricing','💲','Pricing'],['products','🥐','Products'],['workers','👩‍🍳','Workers page'],['settings','⚙️','Settings']];
const BOTTOM = ['dashboard','orders','production','recipes','more'];
function renderNav(cur){
  const nav = document.getElementById('nav'), bnav = document.getElementById('bnav');
  if (ROLE !== 'owner') { if (nav) nav.remove(); if (bnav) bnav.remove(); document.getElementById('who').textContent = 'WORKERS'; document.body.classList.add('worker'); return; }
  const link = ([k, i, l], on) => '<a href="#/' + k + '" class="' + (on ? 'on' : '') + '"><span class="ico">' + i + '</span><span>' + l + '</span></a>';
  nav.innerHTML = OWNER_TABS.map(t => link(t, t[0] === cur)).join('');
  const inBottom = BOTTOM.includes(cur);
  bnav.innerHTML = BOTTOM.map(k => k === 'more' ? link(['more','☰','More'], !inBottom) : link(OWNER_TABS.find(t => t[0] === k), k === cur)).join('');
}
function viewMore(){
  main.innerHTML = '<h1>More</h1><div class="more-grid">' + OWNER_TABS.filter(t => !BOTTOM.includes(t[0])).map(([k, i, l]) => '<a href="#/' + k + '"><span class="ico">' + i + '</span>' + l + '<small>' + ({scaler:'Scale any recipe',inventory:'Stock & shopping list',scan:'Scan bags into stock',pricing:'Cost & price per item',products:'What you sell',workers:'What workers see',settings:'Passwords & order feed'})[k] + '</small></a>').join('') + '</div>';
}
const BP_HINT = '<i class="hint" title="Baker\'s %: each ingredient as a percent of the total flour weight. All flour together = 100%. Example: 1000 g flour and 20 g salt → salt is 2%.">?</i>';
const emptyState = (icon, title, text, btn) => '<div class="card empty"><span class="big">' + icon + '</span><b>' + title + '</b><div>' + text + '</div>' + (btn ? '<div style="margin-top:14px">' + btn + '</div>' : '') + '</div>';
let DATA = null;
async function loadAll(){ DATA = await api('/api/all'); return DATA; }
const invByName = name => DATA.inventory.find(i => i.name.trim().toLowerCase() === String(name || '').trim().toLowerCase());
const recipeById = id => DATA.recipes.find(r => r.id === Number(id));

function recipeTotals(r){ const flour = r.items.filter(i => i.is_flour).reduce((a, i) => a + Number(i.grams || 0), 0); const total = r.items.reduce((a, i) => a + Number(i.grams || 0), 0); return { flour, total }; }

// ---------- scaled recipe table (shared) ----------
function scaledTable(items, opts = {}){
  const rows = items.map(i => '<tr class="' + (i.is_flour ? 'flour' : '') + '"><td>' + esc(i.name) + (i.is_flour ? ' <span class="chip gold">flour</span>' : '') + '</td><td class="n">' + fmtG(i.grams, true, i.liquid !== undefined ? i.liquid : isLiq(i)) + '</td><td class="n pct">' + fmtPct(i.pct) + '</td></tr>').join('');
  const total = items.reduce((a, i) => a + i.grams, 0);
  return '<div class="tw"><table><thead><tr><th>Ingredient</th><th class="n">Amount</th><th class="n">Baker\'s % ' + BP_HINT + '</th></tr></thead><tbody>' + rows + '</tbody><tfoot><tr><td><b>Total dough</b></td><td class="n"><b>' + fmtG(total) + '</b></td><td></td></tr></tfoot></table></div>';
}

// ================= DASHBOARD =================
async function viewDashboard(){
  const d = await api('/api/dashboard');
  const p = d.production;
  const short = (p.needs || []).filter(x => x.short > 0.5);
  main.innerHTML = '<h1>Good ' + (new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening') + ', Avrum</h1><p class="lead">' + niceDate(p.date) + '</p>' +
  '<div class="grid g4"><div class="stat gold"><b>' + p.orders_count + '</b><span>orders today</span></div>' +
  '<div class="stat"><b>' + p.recipes.length + '</b><span>recipes to bake today</span></div>' +
  '<a class="stat tap ' + (d.low.length ? 'alert red' : '') + '" href="#/inventory?low=1"><b>' + d.low.length + '</b><span>items low on stock</span></a>' +
  '<a class="stat tap ' + (short.length ? 'alert red' : '') + '" href="#/production?show=short"><b>' + short.length + '</b><span>ingredients short for today</span></a></div>' +
  (d.counts.products === 0 ? '<div class="note" style="margin-top:14px"><b>Getting started:</b> 1) add your ingredients and packaging in <a href="#/inventory">Inventory</a> with what you pay, 2) enter your <a href="#/recipes">Recipes</a> (there\'s one example to copy), 3) add your <a href="#/products">Products</a> and link each to a recipe, 4) put orders in <a href="#/orders">Orders</a>. Then Bake today, Pricing and the Workers page fill in by themselves.</div>' : '') +
  '<div class="grid g2" style="margin-top:14px"><div class="card"><h3>Today\'s production</h3>' +
  (p.products.length ? p.products.map(x => '<div class="list-item"><span>' + esc(x.name) + '</span><b>' + qty(x.qty) + ' ' + esc(x.unit || '') + '</b></div>').join('') + '<div style="margin-top:12px"><a class="btn sm" href="#/production">Open production &amp; scaled recipes</a></div>' : '<div class="empty">No orders for today yet.</div>') +
  (p.unmatched.length ? '<div class="warn" style="margin-top:10px">Orders mention products not in your list: ' + p.unmatched.map(u => esc(u.name)).join(', ') + '. Add them in Products (or as an alias).</div>' : '') +
  '</div><div class="card"><h3>Low stock</h3>' +
  (d.low.length ? d.low.map(i => '<div class="list-item"><span>' + esc(i.name) + '</span><span class="chip red">' + fmtStock(i, i.stock) + ' left</span></div>').join('') + '<div style="margin-top:12px"><a class="btn sm ghost" href="#/inventory">Shopping list</a></div>' : '<div class="empty">Nothing low. 👍</div>') +
  (short.length ? '<h3 style="margin-top:14px">Short for today</h3>' + short.map(s => '<div class="list-item"><span>' + esc(s.name) + '</span><span class="chip red">need ' + fmtG(s.short, false, s.liquid) + ' more</span></div>').join('') : '') +
  '</div></div>' +
  '<div class="grid g2"><div class="card"><h3>Upcoming order days</h3>' + (d.upcoming.length ? d.upcoming.map(u => '<div class="list-item"><a href="#/orders?date=' + u.date + '">' + niceDate(u.date) + '</a><b>' + u.n + ' order' + (u.n === 1 ? '' : 's') + '</b></div>').join('') : '<div class="empty">No upcoming orders.</div>') + '</div>' +
  '<div class="card"><h3>Recent bakes</h3>' + (d.bakes.length ? d.bakes.map(b => '<div class="list-item"><span>' + esc(b.recipe_name) + ' <span class="mut small">× ' + qty(b.factor) + ' batch · ' + niceDate(b.date) + '</span></span>' + (b.undone ? '<span class="chip">undone</span>' : '<span class="chip green">baked</span>') + '</div>').join('') : '<div class="empty">No batches marked baked yet.</div>') + '</div></div>';
}

// ================= ORDERS =================
const STATUSES = ['new','accepted','in production','ready','out for delivery','delivered','cancelled'];
async function viewOrders(params){
  await loadAll();
  const date = params.get('date') || localToday();
  const to = params.get('to') || date;
  const d = await api('/api/orders?from=' + date + '&to=' + to);
  const statusChip = s => '<span class="chip ' + (s === 'cancelled' ? 'red' : s === 'delivered' || s === 'ready' ? 'green' : '') + '">' + esc(s) + '</span>';
  main.innerHTML = '<h1>Orders</h1><p class="lead">Orders here drive Bake today and the Workers page. Add them by hand, paste a CSV, or (later) they arrive straight from your wholesale portal.</p>' +
  '<div class="row noprint" style="margin-bottom:14px"><button class="btn" id="oadd">+ New order</button><button class="btn gold" id="ocsv">Import CSV</button></div>' +
  '<div class="row noprint" style="margin-bottom:16px"><div class="f s"><label>From</label><input type="date" id="od1" value="' + date + '"></div><div class="f s"><label>To</label><input type="date" id="od2" value="' + to + '"></div><button class="btn ghost" id="oshow">Show</button><button class="btn ghost" id="oweek">Next 7 days</button></div>' +
  (d.orders.length ? '<div class="tw"><table class="stack"><thead><tr><th>Date</th><th>Customer</th><th>Items</th><th>Type</th><th>Status</th><th>From</th><th></th></tr></thead><tbody>' +
    d.orders.map(o => '<tr><td data-label="Date">' + niceDate(o.date) + '</td><td data-label="Customer"><b>' + esc(o.customer || '—') + '</b>' + (o.notes ? '<div class="small mut">' + esc(o.notes) + '</div>' : '') + '</td><td data-label="Items">' + o.items.map(i => qty(i.qty) + ' × ' + esc(i.product_name) + (i.product_id ? '' : ' <span class="chip red" title="Not in your product list">?</span>')).join('<br>') + '</td><td data-label="Type">' + esc(o.fulfillment || '') + '</td><td data-label="Status">' + statusChip(o.status) + '</td><td data-label="From" class="small mut">' + esc(o.source) + (o.external_id ? ' #' + esc(o.external_id) : '') + '</td><td class="n"><button class="btn sm ghost" data-edit="' + o.id + '">Edit</button></td></tr>').join('') +
    '</tbody></table></div><p class="mut small">' + d.orders.length + ' order(s). A red ? means that product name is not in your product list yet, so it can\'t be scaled.</p>' : emptyState('📦','No orders for ' + (date === to ? niceDate(date) : niceDate(date) + ' – ' + niceDate(to)),'Add an order by hand or paste a CSV from your portal.','<button class="btn" onclick="document.getElementById(\'oadd\').click()">+ New order</button>'));
  const go = (a, b) => { location.hash = '#/orders?date=' + a + '&to=' + b; };
  main.querySelector('#oshow').onclick = () => go(val(main, '#od1'), val(main, '#od2') || val(main, '#od1'));
  main.querySelector('#oweek').onclick = () => go(localToday(), addDays(localToday(), 6));
  main.querySelector('#oadd').onclick = () => orderForm(null, date);
  main.querySelector('#ocsv').onclick = csvImport;
  main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => orderForm(d.orders.find(o => o.id === Number(b.dataset.edit))));
}
function orderForm(o, defDate){
  o = o || { customer: '', date: defDate || localToday(), fulfillment: 'delivery', status: 'new', notes: '', items: [{ product_id: null, product_name: '', qty: '' }] };
  const prodOpts = sel => '<option value="">Choose product…</option>' + DATA.products.map(p => '<option value="' + p.id + '"' + (Number(sel) === p.id ? ' selected' : '') + '>' + esc(p.name) + (p.unit ? ' (' + esc(p.unit) + ')' : '') + '</option>').join('');
  const itemRow = it => '<div class="ir ord">' + (it.product_id || !it.product_name ? '<select data-k="product_id">' + prodOpts(it.product_id) + '</select>' : '<input data-k="product_name" value="' + esc(it.product_name) + '">') + '<input type="number" inputmode="decimal" min="0" step="any" data-k="qty" placeholder="Qty" value="' + esc(it.qty) + '"><button class="x" data-del>×</button></div>';
  modal('<h2>' + (o.id ? 'Edit order' : 'New order') + '</h2>' + (DATA.products.length ? '' : '<div class="warn">You have no products yet. Add them in Products first so orders can be scaled.</div>') +
    '<div class="row"><div class="f"><label>Customer</label><input id="m_c" value="' + esc(o.customer || '') + '" placeholder="Store or customer name"></div><div class="f s"><label>Date</label><input type="date" id="m_d" value="' + esc(o.date) + '"></div></div>' +
    '<div class="row" style="margin-top:10px"><div class="f s"><label>Delivery / pickup</label><select id="m_f"><option' + (o.fulfillment === 'delivery' ? ' selected' : '') + '>delivery</option><option' + (o.fulfillment === 'pickup' ? ' selected' : '') + '>pickup</option></select></div><div class="f s"><label>Status</label><select id="m_s">' + STATUSES.map(s => '<option' + (o.status === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></div></div>' +
    '<h3 style="margin-top:16px">Products</h3><div class="items-ed" id="m_items">' + o.items.map(itemRow).join('') + '</div><button class="btn sm ghost" id="m_addi">+ Add product</button>' +
    '<div style="margin-top:12px"><label>Notes</label><textarea id="m_n" style="min-height:60px">' + esc(o.notes || '') + '</textarea></div>' +
    '<div class="row" style="margin-top:16px"><button class="btn" id="m_save">Save order</button><button class="btn ghost" data-close>Cancel</button><span class="spacer"></span>' + (o.id ? '<button class="btn danger" id="m_del">Delete</button>' : '') + '</div><div id="m_err" class="err"></div>',
  (m, close) => {
    const box = m.querySelector('#m_items');
    const wire = () => box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { b.parentElement.remove(); });
    wire();
    m.querySelector('#m_addi').onclick = () => { box.insertAdjacentHTML('beforeend', itemRow({ product_id: null, product_name: '', qty: '' })); wire(); };
    m.querySelector('#m_save').onclick = guard(async () => {
      const items = [...box.querySelectorAll('.ir')].map(r => { const s = r.querySelector('[data-k=product_id]'); const t = r.querySelector('[data-k=product_name]'); return { product_id: s ? n(s.value) : null, product_name: t ? t.value : (s && s.value ? s.options[s.selectedIndex].text.replace(/ \(.*\)$/, '') : ''), qty: n(r.querySelector('[data-k=qty]').value) }; });
      try { await api('/api/orders', { body: { id: o.id, customer: val(m, '#m_c'), date: val(m, '#m_d'), fulfillment: val(m, '#m_f'), status: val(m, '#m_s'), notes: val(m, '#m_n'), items } }); close(); toast('Order saved'); route(); }
      catch(e) { m.querySelector('#m_err').textContent = e.message; }
    });
    const del = m.querySelector('#m_del'); if (del) del.onclick = guard(async () => { if (!confirm('Delete this order?')) return; await api('/api/orders/' + o.id, { method: 'DELETE' }); close(); toast('Deleted'); route(); });
  });
}
function parseCSV(text){
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i+1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',' || c === '\t') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i+1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += c; }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
function csvToOrders(text){
  const rows = parseCSV(text); if (rows.length < 2) throw new Error('Paste a header row and at least one order line.');
  const head = rows[0].map(h => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
  const col = names => head.findIndex(h => names.includes(h));
  const ci = { id: col(['orderid','order','ordernumber','orderno','id','externalid']), cust: col(['customer','customername','store','account','client']), date: col(['date','deliverydate','pickupdate','orderdate','delivery','duedate']), type: col(['type','fulfillment','deliverypickup','method']), prod: col(['product','productname','item','itemname','sku']), qty: col(['quantity','qty','amount','count','units']), notes: col(['notes','note','comments']), status: col(['status']) };
  if (ci.date < 0 || ci.prod < 0 || ci.qty < 0) throw new Error('The header needs at least: date, product, quantity (customer and order_id are optional).');
  const groups = new Map();
  rows.slice(1).forEach((r, k) => { const g = (x) => x >= 0 ? (r[x] || '').trim() : '';
    const key = g(ci.id) || (g(ci.cust) + '|' + g(ci.date)) || ('row' + k);
    if (!groups.has(key)) groups.set(key, { external_id: g(ci.id) || null, customer: g(ci.cust), date: g(ci.date), fulfillment: g(ci.type), notes: g(ci.notes), status: g(ci.status) || 'new', items: [] });
    if (g(ci.prod)) groups.get(key).items.push({ product: g(ci.prod), qty: Number(g(ci.qty).replace(/[^0-9.]/g, '')) || 0 }); });
  return [...groups.values()];
}
function csvImport(){
  modal('<h2>Import orders from CSV</h2><p class="mut small">Copy rows from a spreadsheet or your portal export and paste here. One line per product. Columns (any order): <b>date, product, quantity</b> and optionally <b>customer, order_id, type, status, notes</b>. Lines with the same order_id (or same customer + date) become one order. Re-importing the same order_id updates it instead of doubling it.</p>' +
  '<textarea id="c_t" style="min-height:180px;font-family:ui-monospace,Menlo,monospace;font-size:14px" placeholder="order_id,customer,date,type,product,quantity\n1001,Main St Market,2026-10-27,delivery,Chocolate Babka,12\n1001,Main St Market,2026-10-27,delivery,Whole Spelt Pita,30"></textarea>' +
  '<div class="row" style="margin-top:12px"><button class="btn ghost" id="c_p">Preview</button><button class="btn gold" id="c_i">Import</button><button class="btn ghost" data-close>Close</button></div><div id="c_out" style="margin-top:12px"></div>', (m, close) => {
    const out = m.querySelector('#c_out');
    const prev = () => { const orders = csvToOrders(val(m, '#c_t')); out.innerHTML = '<div class="note">' + orders.length + ' order(s), ' + orders.reduce((a, o) => a + o.items.length, 0) + ' product line(s):<br>' + orders.slice(0, 15).map(o => esc(o.date) + ' · ' + esc(o.customer || '—') + ' · ' + o.items.map(i => i.qty + '× ' + esc(i.product)).join(', ')).join('<br>') + (orders.length > 15 ? '<br>…' : '') + '</div>'; return orders; };
    m.querySelector('#c_p').onclick = () => { try { prev(); } catch(e) { out.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; } };
    m.querySelector('#c_i').onclick = async () => { try { const orders = prev(); const r = await api('/api/orders/import-json', { body: { source: 'csv', orders } });
      out.innerHTML = '<div class="note"><b>Imported:</b> ' + r.created + ' new, ' + r.updated + ' updated.' + (r.errors.length ? '<br><span class="err">' + r.errors.map(esc).join('<br>') + '</span>' : '') + (r.unmatched_products.length ? '<br>Not in your product list yet: ' + r.unmatched_products.map(esc).join(', ') : '') + '</div>'; route(); } catch(e) { out.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; } };
  });
}

// ================= PRODUCTION =================
const doneLabel = d => 'Done by ' + esc(d.by || (d.role === 'owner' ? 'Owner' : 'Worker')) + ' · ' + new Date(d.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
async function viewProduction(params){
  const date = params.get('date') || localToday();
  const p = await api('/api/production?date=' + date);
  if (!DATA) await loadAll();
  const short = (p.needs || []).filter(x => x.short > 0.5);
  main.innerHTML = '<h1>Bake today</h1><p class="lead">Everything ordered for the day, added up and scaled.</p><div class="row noprint" style="margin-bottom:14px"><div class="f s"><label>Day</label><input type="date" id="pd" value="' + date + '"></div><button class="btn ghost" id="ptoday">Today</button><button class="btn ghost" id="ptom">Tomorrow</button><button class="btn gold" id="padd">+ Add bake</button><span class="spacer"></span><button class="btn ghost" onclick="print()">Print</button></div>' +
  '<p class="mut">' + niceDate(date) + ' · ' + p.orders_count + ' order(s)</p>' +
  (p.problems.length ? '<div class="warn">' + p.problems.map(esc).join('<br>') + ' — fix in Products.</div>' : '') +
  (p.unmatched.length ? '<div class="warn">Not in your product list (not counted): ' + p.unmatched.map(u => esc(u.name) + ' × ' + qty(u.qty)).join(', ') + '</div>' : '') +
  (p.products.length ? '<div class="card"><h3>Products to make</h3><div class="tw"><table><thead><tr><th>Product</th><th class="n">Ordered</th></tr></thead><tbody>' + p.products.map(x => '<tr><td>' + esc(x.name) + '</td><td class="n"><b>' + qty(x.qty) + '</b> ' + esc(x.unit || '') + '</td></tr>').join('') + '</tbody></table></div></div>' : (p.recipes.length ? '' : emptyState('🔥','Nothing to bake for this day','When there are orders for this day, the scaled recipes and ingredient totals show up here. You can also add a bake by hand.','<button class="btn gold" onclick="document.getElementById(\'padd\').click()">+ Add bake</button> <a class="btn ghost" href="#/orders">Go to Orders</a>'))) +
  (p.needs && p.needs.length ? '<div class="card" id="needs"><h3>Ingredients needed vs. stock</h3>' + (short.length ? '<div class="warn">' + short.length + ' ingredient(s) short — highlighted in red.</div>' : '') + '<div class="tw"><table class="needs"><thead><tr><th>Ingredient</th><th class="n">Need</th><th class="n">In stock</th><th class="n">Short</th></tr></thead><tbody>' +
    p.needs.map(x => '<tr class="' + (x.short > 0.5 ? 'short' : '') + '"><td data-label="Ingredient">' + esc(x.name) + (x.inventory_id ? '' : ' <span class="chip">not in inventory</span>') + '</td><td data-label="Need" class="n">' + fmtG(x.need_g, true, x.liquid) + '</td><td data-label="In stock" class="n">' + (x.stock_g === null ? '–' : fmtG(x.stock_g, true, x.liquid)) + '</td><td data-label="Short" class="n">' + (x.short > 0.5 ? '<b class="err">' + fmtG(x.short, true, x.liquid) + '</b>' : (x.inventory_id ? '<span class="ok">OK</span>' : '')) + '</td></tr>').join('') +
    ((p.packaging_needs || []).map(x => '<tr class="' + (x.short > 0 ? 'short' : '') + '"><td>' + esc(x.name) + ' <span class="chip">packaging</span></td><td class="n">' + qty(x.need) + ' ' + esc(x.unit) + '</td><td class="n">' + qty(x.stock) + ' ' + esc(x.unit) + '</td><td class="n">' + (x.short > 0 ? '<b class="err">' + qty(x.short) + '</b>' : '<span class="ok">OK</span>') + '</td></tr>').join('')) +
    '</tbody></table></div></div>' : '') +
  p.recipes.map((r, k) => { const forTxt = r.products.map(x => qty(x.qty) + ' ' + esc(x.name)).concat(r.extras.map(e => qty(e.pieces) + ' added <button class="xb noprint" title="Remove this added bake" data-xdel="' + e.id + '">×</button>')).join(', ');
    const nb = r.batches.length;
    return '<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><div><h3>' + esc(r.name) + '</h3><div class="mut">' + qty(r.factor) + ' × batch · ' + pieces(r.pieces) + ' pieces' + (r.piece_weight_g ? ' × ' + fmtG(r.piece_weight_g, false) : '') + (r.waste_pct ? ' · +' + fmtPct(r.waste_pct) + ' waste' : '') + ' · for ' + forTxt + '</div></div><div class="noprint">' +
    (r.baked.length ? '<span class="chip green">baked ✓</span> ' : '') + '<button class="btn sm gold" data-bake="' + k + '">Mark batch baked</button></div></div>' +
    '<div class="batches">' + (nb > 1 ? '<b>' + nb + ' mixer batches</b> <span class="mut small">(mixer max ' + fmtG(r.mixer_max_g) + ')</span>' : '<b>1 mixer batch</b>' + (r.mixer_max_g ? '' : ' <span class="mut small">(set "Mixer max" on the recipe to split big orders)</span>')) +
    r.batches.map(b => { const nck = b.keys.filter(x => b.checked.includes(x)).length; return '<div class="bt-row"><span><b>Batch ' + b.no + ' of ' + nb + '</b> · ' + pieces(b.pieces) + ' pieces · ' + fmtG(b.dough_g) + ' dough</span>' + (b.done ? '<span class="chip green">✓ ' + doneLabel(b.done) + '</span>' : '<span class="chip">' + nck + ' of ' + b.keys.length + ' checked</span>') + ' <a class="btn sm ghost noprint" href="#/workers?date=' + date + '&r=' + r.recipe_id + '&b=' + b.no + '">Open</a></div>'; }).join('') + '</div>' +
    '<div style="margin-top:10px">' + scaledTable(r.items) + (nb > 1 ? '<p class="mut small">Totals for all ' + nb + ' batches. Each batch is ' + (r.batches.every(b => Math.abs(b.pieces - r.batches[0].pieces) < 1e-6) ? '1/' + nb + ' of this.' : 'its share by pieces.') + '</p>' : '') + '</div></div>'; }).join('');
  main.querySelector('#pd').onchange = e => location.hash = '#/production?date=' + e.target.value;
  main.querySelector('#ptoday').onclick = () => location.hash = '#/production?date=' + localToday();
  main.querySelector('#ptom').onclick = () => location.hash = '#/production?date=' + addDays(localToday(), 1);
  main.querySelector('#padd').onclick = () => addBakeDialog(date);
  main.querySelectorAll('[data-xdel]').forEach(b => b.onclick = guard(async () => { if (!confirm('Remove this added bake?')) return; await api('/api/extra-bakes/' + b.dataset.xdel, { method: 'DELETE' }); toast('Removed'); route(); }));
  main.querySelectorAll('[data-bake]').forEach(b => b.onclick = () => { const r = p.recipes[Number(b.dataset.bake)]; bakeDialog(r.recipe_id, r.name, r.factor, date, r.products); });
  if (params.get('show') === 'short') { const nd = main.querySelector('#needs'); if (nd) setTimeout(() => nd.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); else main.querySelector('.lead').insertAdjacentHTML('afterend', '<div class="note">Nothing is short for today. 👍</div>'); }
}
function addBakeDialog(date){
  if (!DATA.recipes.length) { toast('Add a recipe first'); return; }
  modal('<h2>+ Add bake</h2><p class="mut">Bake any recipe without an order. It shows up in Bake today and on the Workers page.</p><div><label>Recipe</label><select id="a_r">' + DATA.recipes.map(r => '<option value="' + r.id + '">' + esc(r.name) + '</option>').join('') + '</select></div>' +
  '<div class="row" style="margin-top:10px"><div class="f s"><label>How many (pieces)</label><input type="number" inputmode="decimal" min="0" step="any" id="a_q"></div><div class="f s"><label>Day</label><input type="date" id="a_d" value="' + date + '"></div></div><div id="a_info" class="mut small" style="margin-top:6px"></div>' +
  '<div style="margin-top:10px"><label>Note (optional)</label><input id="a_n" placeholder="e.g. for the store"></div>' +
  '<div class="row" style="margin-top:16px"><button class="btn gold" id="a_ok">Add bake</button><button class="btn ghost" data-close>Cancel</button></div><div id="a_err" class="err"></div>', (m, close) => {
    const info = () => { const r = recipeById(val(m, '#a_r')); m.querySelector('#a_info').textContent = r ? 'One recipe makes ' + pieces(r.yield_pieces) + ' pieces.' : ''; }; info(); m.querySelector('#a_r').onchange = info;
    m.querySelector('#a_ok').onclick = async () => { try { await api('/api/extra-bakes', { body: { recipe_id: Number(val(m, '#a_r')), pieces: n(val(m, '#a_q')), date: val(m, '#a_d'), note: val(m, '#a_n') } }); close(); toast('Bake added'); if (val(m, '#a_d') !== date) location.hash = '#/production?date=' + val(m, '#a_d'); else route(); } catch(e) { m.querySelector('#a_err').textContent = e.message; } };
  });
}
function bakeDialog(recipe_id, name, factor, date, products){
  modal('<h2>Mark batch baked</h2><p><b>' + esc(name) + '</b></p><div class="row"><div class="f s"><label>Batches</label><input type="number" step="any" min="0" id="b_f" value="' + (Math.round(factor * 1000) / 1000) + '"></div><div class="f s"><label>Date</label><input type="date" id="b_d" value="' + date + '"></div></div>' +
  '<p class="mut small">This subtracts every recipe ingredient (× batches) from Inventory' + (products && products.length ? ', plus the packaging for ' + products.map(x => qty(x.qty) + ' ' + esc(x.name)).join(', ') : '') + '. Ingredient names must match your Inventory names. You can undo it in Inventory → Bake history.</p>' +
  '<div class="row"><button class="btn gold" id="b_ok">Yes, mark baked</button><button class="btn ghost" data-close>Cancel</button></div><div id="b_out"></div>', (m, close) => {
    m.querySelector('#b_ok').onclick = guard(async () => {
      const f = n(val(m, '#b_f')); const ratio = factor ? f / factor : 1;
      const r = await api('/api/bake', { body: { recipe_id, factor: f, date: val(m, '#b_d'), products: (products || []).map(x => ({ product_id: x.product_id, qty: x.qty * ratio })) } });
      close(); toast('Marked baked — stock updated' + (r.detail.not_in_inventory.length ? ' (' + r.detail.not_in_inventory.length + ' ingredient(s) not in inventory)' : '')); route();
    });
  });
}

// ================= SCALER =================
async function viewScaler(params){
  await loadAll();
  if (!DATA.recipes.length) { main.innerHTML = '<h1>Recipe scaler</h1>' + emptyState('⚖️','Add a recipe first','The scaler works from your recipes.','<a class="btn" href="#/recipes">Go to Recipes</a>'); return; }
  const rid = Number(params.get('r')) || DATA.recipes[0].id;
  main.innerHTML = '<h1>Recipe scaler</h1><p class="lead noprint">Pick a recipe and how much you need. Every ingredient is scaled.</p><div class="card noprint"><div class="row"><div class="f"><label>Recipe</label><select id="s_r">' + DATA.recipes.map(r => '<option value="' + r.id + '"' + (r.id === rid ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select></div>' +
  '<div class="f s"><label>Scale by</label><select id="s_m"><option value="pieces">Pieces</option><option value="dough">Dough weight (lb)</option><option value="batches">Batches</option></select></div><div class="f s"><label id="s_l">Target pieces</label><input type="number" inputmode="decimal" min="0" step="any" id="s_v"></div></div></div><div id="s_out"></div>';
  const sel = main.querySelector('#s_r'), mode = main.querySelector('#s_m'), v = main.querySelector('#s_v'), out = main.querySelector('#s_out');
  const calc = () => {
    const r = recipeById(sel.value); const t = recipeTotals(r);
    main.querySelector('#s_l').textContent = mode.value === 'pieces' ? 'Target pieces' : mode.value === 'dough' ? 'Target dough (lb)' : 'Batches';
    const target = n(v.value);
    let factor = 1;
    if (target) factor = mode.value === 'pieces' ? target / (r.yield_pieces || 1) : mode.value === 'dough' ? (t.total ? target * G_LB / t.total : 1) : target;
    const waste = mode.value === 'dough' ? 0 : (Number(r.waste_pct) || 0); const wf = 1 + waste / 100; // pieces/batches: extra dough for waste
    const items = r.items.map(i => ({ name: i.name, grams: i.grams * factor * wf, is_flour: !!i.is_flour, pct: t.flour ? i.grams / t.flour * 100 : null, liquid: isLiq(i) }));
    out.innerHTML = '<div class="card"><div class="row" style="justify-content:space-between;align-items:center"><div><h3>' + esc(r.name) + '</h3><div class="mut">Base recipe: ' + pieces(r.yield_pieces) + ' pieces' + (r.piece_weight_g ? ' × ' + fmtG(r.piece_weight_g, false) : '') + ' · ' + fmtG(t.total) + ' dough</div></div></div>' +
      '<div class="grid g3 stats3" style="margin:12px 0"><div class="stat gold"><b>× ' + (Math.round(factor * 1000) / 1000) + '</b><span>scale factor</span></div><div class="stat"><b>' + pieces(r.yield_pieces * factor) + '</b><span>pieces</span></div><div class="stat"><b>' + fmtG(t.total * factor * wf, false) + '</b><span>total dough' + (t.flour ? ' · ' + fmtG(t.flour * factor * wf, false) + ' flour' : '') + (waste ? ' · incl. ' + fmtPct(waste) + ' waste' : '') + '</span></div></div>' +
      (t.flour ? '' : '<div class="warn">Tick "flour" on the flour lines in this recipe to get baker\'s percentages.</div>') + scaledTable(items) +
      (r.method ? '<h3 style="margin-top:14px">Method</h3><div class="wk-method" style="font-size:16px">' + esc(r.method) + '</div>' : '') +
      '<div class="row noprint" style="margin-top:14px"><button class="btn ghost" onclick="print()">Print</button><button class="btn gold" id="s_bake">Mark this batch baked</button></div><p class="mut small">Weights in lb &amp; oz (to 0.1 oz), liquids in quarts (1 qt = 2 lb 1.4 oz of water).</p></div>';
    out.querySelector('#s_bake').onclick = () => bakeDialog(r.id, r.name, factor, localToday(), []);
  };
  sel.onchange = () => { v.value = ''; calc(); }; mode.onchange = () => { v.value = ''; calc(); }; v.oninput = calc; if (params.get('t')) v.value = params.get('t'); if (params.get('m')) mode.value = params.get('m'); calc();
}

// ================= RECIPES =================
async function viewRecipes(){
  await loadAll();
  main.innerHTML = '<h1>Recipes</h1><p class="lead">Your recipes in lb &amp; oz (liquids in quarts). Baker\'s % is worked out for you ' + BP_HINT + '</p><div class="row" style="margin-bottom:14px"><button class="btn" id="r_add">+ New recipe</button></div>' +
  (DATA.recipes.length ? '<div class="grid g2">' + DATA.recipes.map(r => { const t = recipeTotals(r); return '<div class="card"><h3>' + esc(r.name) + '</h3><div class="mut small">' + pieces(r.yield_pieces) + ' pieces' + (r.piece_weight_g ? ' × ' + fmtG(r.piece_weight_g, false) : '') + ' · ' + fmtG(t.total, false) + ' dough · ' + r.items.length + ' ingredients' + ((r.steps || []).length ? ' · ' + r.steps.length + ' steps' : '') + (r.mixer_max_g ? ' · mixer max ' + fmtG(r.mixer_max_g) : '') + (r.waste_pct ? ' · ' + fmtPct(r.waste_pct) + ' waste' : '') + '</div>' +
    '<div style="margin:10px 0">' + r.items.map(i => '<div class="list-item" style="padding:6px 0"><span>' + esc(i.name) + '</span><span><b>' + fmtG(i.grams, false, isLiq(i)) + '</b> <span class="pct">' + (t.flour ? fmtPct(i.grams / t.flour * 100) : '') + '</span>' + (invByName(i.name) ? '' : ' <span class="chip" title="Name not found in Inventory — no stock or cost tracking">no stock link</span>') + '</span></div>').join('') + '</div>' +
    '<div class="row"><button class="btn sm" data-ed="' + r.id + '">Edit</button><a class="btn sm ghost" href="#/scaler?r=' + r.id + '">Scale</a><button class="btn sm ghost" data-dup="' + r.id + '">Duplicate</button></div></div>'; }).join('') + '</div>' : emptyState('📖','Add your first recipe','Enter the ingredients once (lb &amp; oz, liquids in quarts) — the app scales them for you.','<button class="btn" onclick="document.getElementById(\'r_add\').click()">+ Add a recipe</button>'));
  main.querySelector('#r_add').onclick = () => recipeForm(null);
  main.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => recipeForm(recipeById(b.dataset.ed)));
  main.querySelectorAll('[data-dup]').forEach(b => b.onclick = () => { const r = JSON.parse(JSON.stringify(recipeById(b.dataset.dup))); delete r.id; r.name = r.name + ' (copy)'; recipeForm(r); });
}
function recipeForm(r){
  r = r || { name: '', yield_pieces: 1, piece_weight_g: '', method: '', notes: '', items: [{ name: '', grams: '', is_flour: 1 }, { name: 'Water', grams: '', is_flour: 0 }, { name: 'Salt', grams: '', is_flour: 0 }], steps: [] };
  let uidN = 0; const uid = () => 's' + (++uidN);
  let steps = (r.steps || []).slice().sort((a, b) => a.sort - b.sort).map(s => ({ uid: uid(), name: s.name || '', instruction: s.instruction || '', timer_min: s.timer_min ?? '' }));
  const dl = '<datalist id="invnames">' + DATA.inventory.filter(i => i.kind !== 'packaging').map(i => '<option value="' + esc(i.name) + '">').join('') + '</datalist>';
  const lbOf = g => { if (g === '' || g === null || g === undefined) return ['', '']; const oz = Number(g) / G_OZ; let lb = Math.floor(oz / 16 + 1e-9); let o = Math.round((oz - lb * 16) * 100) / 100; if (o >= 16) { lb++; o = 0; } return [lb || '', o || (lb ? '' : 0)]; };
  const qtOf = g => g === '' || g === null || g === undefined ? '' : Math.round(Number(g) / G_QT * 10000) / 10000;
  const stepOpts = sel => steps.map((s, k) => '<option value="' + s.uid + '"' + (s.uid === sel ? ' selected' : '') + '>Step ' + (k + 1) + (s.name ? ' · ' + esc(s.name) : '') + '</option>').join('');
  const row = i => { const liq = isLiq(i); const [lb, oz] = lbOf(i.grams); const su = Number.isInteger(i.step) && steps[i.step] ? steps[i.step].uid : (i.stepUid || '');
 return '<div class="ir ir2' + (liq ? ' liq' : '') + '" data-g="' + esc(i.grams ?? '') + '"><input list="invnames" data-k="name" placeholder="Ingredient" value="' + esc(i.name) + '">' +
    '<div class="amt"><span class="w"><input type="number" inputmode="decimal" step="any" min="0" data-k="lb" placeholder="0" value="' + esc(lb) + '"><i>lb</i><input type="number" inputmode="decimal" step="any" min="0" data-k="oz" placeholder="0" value="' + esc(oz) + '"><i>oz</i></span><span class="q"><input type="number" inputmode="decimal" step="any" min="0" data-k="qt" placeholder="0" value="' + esc(qtOf(i.grams)) + '"><i>qt</i></span></div>' +
    '<label class="chk"><input type="checkbox" data-k="is_flour"' + (i.is_flour ? ' checked' : '') + '>flour</label><label class="chk"><input type="checkbox" data-k="liquid"' + (liq ? ' checked' : '') + '>liquid</label>' +
    '<select data-k="step" class="stsel"' + (steps.length ? '' : ' hidden') + '>' + stepOpts(su) + '</select><button class="x" data-del title="Remove">×</button></div>'; };
  modal('<h2>' + (r.id ? 'Edit recipe' : 'New recipe') + '</h2>' + dl + '<div><label>Name</label><input id="e_n" value="' + esc(r.name) + '"></div>' +
    '<div class="row" style="margin-top:10px"><div class="f s"><label>Yield (pieces)</label><input type="number" step="any" min="0" id="e_y" value="' + esc(r.yield_pieces) + '"></div><div class="f s"><label>Piece weight</label><div class="lboz"><input type="number" inputmode="decimal" step="any" min="0" id="e_wl" value="' + esc(lbOf(r.piece_weight_g)[0]) + '"><i>lb</i><input type="number" inputmode="decimal" step="any" min="0" id="e_wo" value="' + esc(r.piece_weight_g ? lbOf(r.piece_weight_g)[1] : '') + '"><i>oz</i></div></div></div>' +
    '<div class="row" style="margin-top:10px"><div class="f s"><label>Mixer max (lbs)</label><input type="number" inputmode="decimal" step="any" min="0" id="e_mx" placeholder="empty = one batch" value="' + esc(lbsNum(r.mixer_max_g)) + '"></div><div class="f s"><label>Waste %</label><input type="number" inputmode="decimal" step="any" min="0" max="100" id="e_ws" placeholder="e.g. 3" value="' + esc(r.waste_pct ?? '') + '"></div></div>' +
    '<p class="mut small">Mixer max: how many lbs of dough your mixer takes. Big orders are split into equal batches under it. Waste %: that much extra dough is made so the full count still comes out.</p>' +
    '<h3 style="margin-top:16px">Steps (for the Workers page)</h3><p class="mut small">Each step shows its own ingredients above its instruction. Add a timer (minutes) to a step to give workers a ▶ Start button with an alarm.</p><div id="e_steps"></div><button class="btn sm ghost" id="e_adds">+ Add step</button>' +
    '<h3 style="margin-top:16px">Ingredients</h3><p class="mut small">Weights in lb + oz, liquids in quarts (tick "liquid"). Tick "flour" on every flour — together they are 100%. Use the same names as in Inventory so stock and costs link up. <span id="e_sthint">Pick the step each ingredient goes in.</span></p><div class="items-ed" id="e_items">' + r.items.map(row).join('') + '</div><button class="btn sm ghost" id="e_addi">+ Add ingredient</button>' +
    '<div id="e_tot" class="note" style="margin-top:10px"></div>' +
    '<div style="margin-top:12px"><label id="e_ml">Method</label><textarea id="e_m">' + esc(r.method || '') + '</textarea></div><div style="margin-top:10px"><label>Notes</label><textarea id="e_no" style="min-height:60px">' + esc(r.notes || '') + '</textarea></div>' +
    '<div class="row" style="margin-top:16px"><button class="btn" id="e_save">Save recipe</button><button class="btn ghost" data-close>Cancel</button><span class="spacer"></span>' + (r.id ? '<button class="btn danger" id="e_del">Delete</button>' : '') + '</div><div id="e_err" class="err"></div>',
  (m, close) => {
    const box = m.querySelector('#e_items'), sbox = m.querySelector('#e_steps');
    const typed = x => x.classList.contains('liq') ? (n(x.querySelector('[data-k=qt]').value) || 0) * G_QT : (n(x.querySelector('[data-k=lb]').value) || 0) * G_LB + (n(x.querySelector('[data-k=oz]').value) || 0) * G_OZ;
    // an amount nobody touched keeps its exact stored grams (no rounding drift from lb/oz/qt boxes)
    const gramsOf = x => { const g = typed(x); const o = n(x.dataset.g); return o !== null && x.dataset.untouched !== '0' ? o : g; };
    box.addEventListener('input', e => { const x = e.target.closest('.ir'); if (x && /^(lb|oz|qt)$/.test(e.target.dataset.k || '')) x.dataset.untouched = '0'; }, true);
    const read = () => [...box.querySelectorAll('.ir')].map(x => ({ name: x.querySelector('[data-k=name]').value, grams: gramsOf(x), is_flour: x.querySelector('[data-k=is_flour]').checked, liquid: x.querySelector('[data-k=liquid]').checked, step: steps.findIndex(s => s.uid === x.querySelector('[data-k=step]').value) }));
    const readSteps = () => { sbox.querySelectorAll('.sted').forEach((el, k) => { steps[k].name = el.querySelector('[data-s=name]').value; steps[k].instruction = el.querySelector('[data-s=ins]').value; steps[k].timer_min = el.querySelector('[data-s=tm]').value; }); };
    const drawSteps = () => {
      sbox.innerHTML = steps.length ? steps.map((s, k) => '<div class="sted"><div class="sth"><span class="sn">' + (k + 1) + '</span><input data-s="name" placeholder="Step name, e.g. Mix" value="' + esc(s.name) + '"><button class="x" data-up="' + k + '" title="Move up"' + (k ? '' : ' disabled') + '>↑</button><button class="x" data-sdel="' + k + '" title="Remove step">×</button></div><textarea data-s="ins" placeholder="What to do in this step">' + esc(s.instruction) + '</textarea><div class="stt"><span>⏱ Timer</span><input type="number" inputmode="decimal" min="0" step="any" data-s="tm" placeholder="none" value="' + esc(s.timer_min) + '"><span>min (optional)</span></div></div>').join('') : '<div class="note small">No steps yet. Workers see one step "Mix" with all the ingredients and the Method text below.</div>';
      sbox.querySelectorAll('[data-sdel]').forEach(b => b.onclick = () => { readSteps(); steps.splice(Number(b.dataset.sdel), 1); drawSteps(); });
      sbox.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { readSteps(); const k = Number(b.dataset.up); [steps[k - 1], steps[k]] = [steps[k], steps[k - 1]]; drawSteps(); });
      sbox.querySelectorAll('[data-s=name]').forEach(el => el.oninput = () => { readSteps(); syncSel(); });
      syncSel();
    };
    const syncSel = () => { box.querySelectorAll('[data-k=step]').forEach(sel => { const cur = sel.value; sel.innerHTML = stepOpts(steps.some(s => s.uid === cur) ? cur : (steps[0] || {}).uid); sel.hidden = !steps.length; });
      m.querySelector('#e_sthint').hidden = !steps.length; m.querySelector('#e_ml').textContent = steps.length ? 'Method (extra notes; the steps above are what workers follow)' : 'Method (shown to workers in the one "Mix" step)'; };
    const upd = () => { const it = read(); const fl = it.filter(i => i.is_flour).reduce((a, i) => a + i.grams, 0); const tot = it.reduce((a, i) => a + i.grams, 0);
      m.querySelector('#e_tot').innerHTML = 'Total dough <b>' + fmtG(tot) + '</b> · flour ' + fmtG(fl) + (fl ? ' · ' + it.filter(i => i.name && !i.is_flour).map(i => esc(i.name) + ' ' + fmtPct(i.grams / fl * 100)).join(' · ') : '') + (n(val(m, '#e_y')) && tot ? ' · ' + fmtG(tot / n(val(m, '#e_y'))) + ' per piece' : ''); };
    const wire = () => { box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { b.parentElement.remove(); upd(); }); box.querySelectorAll('input').forEach(i => i.oninput = upd);
      box.querySelectorAll('[data-k=liquid]').forEach(c => c.onchange = () => { const x = c.closest('.ir'); const g = gramsOf(x); x.classList.toggle('liq', c.checked); x.dataset.g = g;
        if (c.checked) x.querySelector('[data-k=qt]').value = g ? qtOf(g) : ''; else { const [lb, oz] = lbOf(g); x.querySelector('[data-k=lb]').value = g ? lb : ''; x.querySelector('[data-k=oz]').value = g ? oz : ''; } upd(); }); };
    drawSteps(); wire(); upd(); m.querySelector('#e_y').oninput = upd;
    ['#e_wl', '#e_wo'].forEach(s => m.querySelector(s).addEventListener('input', () => { m.dataset.pwTouched = '1'; })); m.querySelector('#e_mx').addEventListener('input', () => { m.dataset.mxTouched = '1'; });
    m.querySelector('#e_adds').onclick = () => { readSteps(); steps.push({ uid: uid(), name: steps.length ? '' : 'Mix', instruction: '', timer_min: '' }); drawSteps(); const last = sbox.querySelectorAll('[data-s=name]'); last[last.length - 1].focus(); };
    m.querySelector('#e_addi').onclick = () => { box.insertAdjacentHTML('beforeend', row({ name: '', grams: '', is_flour: 0, liquid: 0 })); wire(); syncSel(); };
    m.querySelector('#e_save').onclick = async () => { try { readSteps();
      let pw = (n(val(m, '#e_wl')) || 0) * G_LB + (n(val(m, '#e_wo')) || 0) * G_OZ; if (r.piece_weight_g && !m.dataset.pwTouched) pw = r.piece_weight_g;
      let mx = n(val(m, '#e_mx')); mx = mx ? mx * G_LB : null; if (r.mixer_max_g && !m.dataset.mxTouched) mx = r.mixer_max_g;
      await api('/api/recipes', { body: { id: r.id, name: val(m, '#e_n'), yield_pieces: n(val(m, '#e_y')), piece_weight_g: pw || null, mixer_max_g: mx, waste_pct: n(val(m, '#e_ws')), method: val(m, '#e_m'), notes: val(m, '#e_no'), items: read().map(i => ({ ...i, step: steps.length ? Math.max(0, i.step) : null })), steps: steps.map(s => ({ name: s.name, instruction: s.instruction, timer_min: n(s.timer_min) })) } }); close(); toast('Recipe saved'); route(); } catch(e) { m.querySelector('#e_err').textContent = e.message; } };
    const del = m.querySelector('#e_del'); if (del) del.onclick = guard(async () => { if (!confirm('Delete this recipe?')) return; await api('/api/recipes/' + r.id, { method: 'DELETE' }); close(); toast('Deleted'); route(); });
  });
}

// ================= PRODUCTS =================
async function viewProducts(){
  await loadAll();
  main.innerHTML = '<h1>Products</h1><p class="lead">What you sell, and which recipe makes it.</p><div class="row" style="margin-bottom:14px"><button class="btn" id="p_add">+ New product</button></div>' +
  (DATA.products.length ? '<div class="tw"><table class="stack"><thead><tr><th>Product</th><th>Unit</th><th>Recipe</th><th class="n">Units / batch</th><th>Packaging</th><th></th></tr></thead><tbody>' +
    DATA.products.map(p => { const r = recipeById(p.recipe_id); return '<tr><td data-label="Product"><b>' + esc(p.name) + '</b>' + (p.aliases ? '<div class="small mut">also: ' + esc(p.aliases) + '</div>' : '') + '</td><td data-label="Unit">' + esc(p.unit || '') + '</td><td data-label="Recipe">' + (r ? esc(r.name) : '<span class="chip red">no recipe</span>') + '</td><td data-label="Per batch" class="n">' + qty(p.units_per_batch ?? (r ? r.yield_pieces : null)) + '</td><td data-label="Packaging" class="small">' + p.packaging.map(pk => { const i = DATA.inventory.find(x => x.id === pk.inventory_id); return i ? qty(pk.qty_per_unit) + ' × ' + esc(i.name) : ''; }).join('<br>') + '</td><td class="n"><button class="btn sm ghost" data-ed="' + p.id + '">Edit</button></td></tr>'; }).join('') + '</tbody></table></div>' : emptyState('🥐','Add your first product','Each product you sell, linked to its recipe — that is how orders turn into scaled recipes.','<button class="btn" onclick="document.getElementById(\'p_add\').click()">+ Add a product</button>'));
  main.querySelector('#p_add').onclick = () => productForm(null);
  main.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => productForm(DATA.products.find(p => p.id === Number(b.dataset.ed))));
}
function productForm(p){
  p = p || { name: '', unit: '', recipe_id: DATA.recipes[0] ? DATA.recipes[0].id : null, units_per_batch: '', aliases: '', labor_per_batch: '', overhead_per_batch: '', markup_pct: '', current_price: '', packaging: [] };
  const packs = DATA.inventory.filter(i => i.kind === 'packaging');
  const pkRow = pk => '<div class="ir pk"><select data-k="inv"><option value="">Choose packaging…</option>' + packs.map(i => '<option value="' + i.id + '"' + (pk.inventory_id === i.id ? ' selected' : '') + '>' + esc(i.name) + '</option>').join('') + '</select><input type="number" step="any" min="0" data-k="q" value="' + esc(pk.qty_per_unit ?? 1) + '" placeholder="per unit"><button class="x" data-del>×</button></div>';
  modal('<h2>' + (p.id ? 'Edit product' : 'New product') + '</h2><div class="row"><div class="f"><label>Name</label><input id="q_n" value="' + esc(p.name) + '"></div><div class="f s"><label>Sold as (unit)</label><input id="q_u" value="' + esc(p.unit || '') + '" placeholder="loaf, box of 12…"></div></div>' +
  '<div class="row" style="margin-top:10px"><div class="f"><label>Recipe</label><select id="q_r"><option value="">— none —</option>' + DATA.recipes.map(r => '<option value="' + r.id + '"' + (r.id === Number(p.recipe_id) ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select></div><div class="f s"><label>Units per batch</label><input type="number" step="any" min="0" id="q_b" value="' + esc(p.units_per_batch ?? '') + '"></div></div>' +
  '<p class="mut small">Units per batch = how many of this product one batch of the recipe makes (empty = the recipe\'s yield).</p>' +
  '<div><label>Other names (comma separated)</label><input id="q_a" value="' + esc(p.aliases || '') + '" placeholder="Names or SKUs your portal uses for this product"></div>' +
  '<h3 style="margin-top:16px">Packaging per unit</h3>' + (packs.length ? '' : '<p class="mut small">Add packaging items in Inventory (type: packaging) to use them here.</p>') + '<div class="items-ed" id="q_pk">' + p.packaging.map(pkRow).join('') + '</div>' + (packs.length ? '<button class="btn sm ghost" id="q_addpk">+ Add packaging</button>' : '') +
  '<h3 style="margin-top:16px">Pricing</h3><div class="row"><div class="f s"><label>Labor $ / batch</label><input type="number" step="any" min="0" id="q_l" value="' + esc(p.labor_per_batch ?? '') + '"></div><div class="f s"><label>Overhead $ / batch</label><input type="number" step="any" min="0" id="q_o" value="' + esc(p.overhead_per_batch ?? '') + '"></div><div class="f s"><label>Markup %</label><input type="number" step="any" min="0" id="q_m" value="' + esc(p.markup_pct ?? '') + '"></div><div class="f s"><label>Your current price $</label><input type="number" step="any" min="0" id="q_c" value="' + esc(p.current_price ?? '') + '"></div></div>' +
  '<div class="row" style="margin-top:16px"><button class="btn" id="q_save">Save product</button><button class="btn ghost" data-close>Cancel</button><span class="spacer"></span>' + (p.id ? '<button class="btn danger" id="q_del">Delete</button>' : '') + '</div><div id="q_err" class="err"></div>',
  (m, close) => {
    const box = m.querySelector('#q_pk'); const wire = () => box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => b.parentElement.remove()); wire();
    const add = m.querySelector('#q_addpk'); if (add) add.onclick = () => { box.insertAdjacentHTML('beforeend', pkRow({ qty_per_unit: 1 })); wire(); };
    m.querySelector('#q_save').onclick = async () => { try { await api('/api/products', { body: { id: p.id, name: val(m, '#q_n'), unit: val(m, '#q_u'), recipe_id: n(val(m, '#q_r')), units_per_batch: n(val(m, '#q_b')), aliases: val(m, '#q_a'), labor_per_batch: n(val(m, '#q_l')), overhead_per_batch: n(val(m, '#q_o')), markup_pct: n(val(m, '#q_m')), current_price: n(val(m, '#q_c')),
      packaging: [...box.querySelectorAll('.ir')].map(x => ({ inventory_id: n(x.querySelector('[data-k=inv]').value), qty_per_unit: n(x.querySelector('[data-k=q]').value) })) } }); close(); toast('Product saved'); route(); } catch(e) { m.querySelector('#q_err').textContent = e.message; } };
    const del = m.querySelector('#q_del'); if (del) del.onclick = guard(async () => { if (!confirm('Delete this product?')) return; await api('/api/products/' + p.id, { method: 'DELETE' }); close(); toast('Deleted'); route(); });
  });
}

// ================= INVENTORY =================
const UNITS = ['lb','oz','qt','pcs'];
const UNIT_G = { kg: 1000, g: 1, lb: G_LB, oz: G_OZ, L: 1000, ml: 1, qt: G_QT };
// inventory amounts are stored in each item's own unit; shown in lb/oz (weights), qt (liquids) or pcs
const gpuOf = i => Number(i.g_per_unit) || UNIT_G[i.unit] || 1;
function dispUnit(i){ if (i.unit === 'pcs') return 'pcs'; if (isLiqUnit(i.unit)) return 'qt'; if (i.unit === 'oz') return 'oz'; return 'lb'; }
const dispF = i => i.unit === 'pcs' ? 1 : gpuOf(i) / UNIT_G[dispUnit(i)]; // item units → display units
function fmtStock(i, amt){ if (amt === null || amt === undefined) return '–'; if (i.unit === 'pcs') return qty(amt) + ' pcs'; return fmtG(amt * gpuOf(i), false, isLiqUnit(i.unit)); }
const fmtCost = i => i.cost_per_unit === null || i.cost_per_unit === undefined ? null : money(i.cost_per_unit / dispF(i)) + ' / ' + dispUnit(i);
const vendorOf = i => (i.supplier || '').trim();
async function viewInventory(params){
  await loadAll();
  const [bk, dv] = await Promise.all([api('/api/bakes'), api('/api/deliveries')]);
  const isLow = i => i.low_level !== null && i.stock <= i.low_level;
  const low = DATA.inventory.filter(isLow);
  const onlyLow = params && params.get('low') === '1';
  const tbl = kind => { const list = DATA.inventory.filter(i => i.kind === kind && (!onlyLow || isLow(i))); if (!list.length) return onlyLow ? '<div class="empty">Nothing low here.</div>' : emptyState(kind === 'packaging' ? '📦' : '🌾', kind === 'packaging' ? 'No packaging yet' : 'Add your first ingredient', kind === 'packaging' ? 'Boxes, bags, labels — so their cost counts in Pricing.' : 'Flour, water, salt… with what you pay, so stock and costs work.', '');
    return '<div class="tw"><table class="stack"><thead><tr><th>Item</th><th class="n">In stock</th><th class="n">Cost</th><th class="n">Low at</th><th>Preferred vendor</th><th></th></tr></thead><tbody>' + list.map(i => '<tr class="' + (isLow(i) ? 'short' : '') + '"><td data-label="Item"><b>' + esc(i.name) + '</b></td><td data-label="In stock" class="n"><b>' + fmtStock(i, i.stock) + '</b></td><td data-label="Cost" class="n">' + (i.cost_per_unit === null ? '<span class="chip">no cost</span>' : fmtCost(i)) + '</td><td data-label="Low at" class="n">' + (i.low_level === null ? '–' : fmtStock(i, i.low_level)) + '</td><td data-label="Preferred vendor" class="small">' + (vendorOf(i) ? '<span class="vendor">' + esc(vendorOf(i)) + '</span>' : '<span class="mut">–</span>') + '</td><td class="n" style="white-space:nowrap"><button class="btn sm gold" data-dv="' + i.id + '">+ Delivery</button> <button class="btn sm ghost" data-ed="' + i.id + '">Edit</button></td></tr>').join('') + '</tbody></table></div>'; };
  const vendors = [...new Set(low.map(vendorOf))].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b));
  const shop = low.length ? vendors.map(v => '<div class="vgroup"><h4>' + (v ? esc(v) : 'No preferred vendor set') + ' <span class="mut small">· ' + low.filter(i => vendorOf(i) === v).length + ' item(s)</span></h4>' + low.filter(i => vendorOf(i) === v).map(i => '<div class="list-item"><span><b>' + esc(i.name) + '</b></span><span>' + fmtStock(i, i.stock) + ' left · low at ' + fmtStock(i, i.low_level) + '</span></div>').join('') + '</div>').join('') : '<div class="empty">Nothing is low right now.</div>';
  main.innerHTML = '<h1>Inventory</h1><p class="lead">What you have in stock. Baking subtracts it, deliveries add it back.</p><div class="row noprint" style="margin-bottom:14px"><a class="btn gold big-scan" href="#/scan">📷 Scan</a><button class="btn" id="i_add">+ Ingredient</button><button class="btn ghost" id="i_addp">+ Packaging</button></div>' +
  '<div class="card shopcard"><div class="row" style="justify-content:space-between;align-items:center"><h3>Shopping list (low stock, by vendor)</h3><button class="btn sm ghost noprint" onclick="print()">Print</button></div>' + shop + '</div>' +
  (onlyLow ? '<div class="note noprint" style="margin-bottom:10px">Showing only items that are low. <a href="#/inventory">Show all items</a></div>' : '') +
  '<div class="' + (onlyLow ? '' : '') + 'invlists"><h2>Ingredients</h2>' + tbl('ingredient') + '<h2>Packaging</h2>' + tbl('packaging') + '</div>' +
  '<div class="grid g2 noprintx" style="margin-top:18px"><div class="card"><h3>Bake history</h3>' + (bk.bakes.length ? bk.bakes.slice(0, 15).map(b => '<div class="list-item"><span>' + esc(b.recipe_name) + ' × ' + qty(b.factor) + '<div class="small mut">' + niceDate(b.date) + ' · ' + esc(b.created_by || '') + '</div></span>' + (b.undone ? '<span class="chip">undone</span>' : '<button class="btn sm ghost" data-undo="' + b.id + '">Undo</button>') + '</div>').join('') : '<div class="empty">None yet.</div>') + '</div>' +
  '<div class="card"><h3>Deliveries</h3>' + (dv.deliveries.length ? dv.deliveries.slice(0, 15).map(d => { const it = DATA.inventory.find(x => x.id === d.inventory_id); return '<div class="list-item"><span>' + esc(d.name || '?') + ' +' + (it ? fmtStock(it, d.qty) : qty(d.qty) + ' ' + esc(d.unit || '')) + '<div class="small mut">' + niceDate(d.date) + (d.supplier ? ' · ' + esc(d.supplier) : '') + '</div></span><span>' + (d.cost_total !== null ? money(d.cost_total) : '') + '</span></div>'; }).join('') : '<div class="empty">None yet.</div>') + '</div></div>';
  main.querySelector('#i_add').onclick = () => invForm({ kind: 'ingredient' });
  main.querySelector('#i_addp').onclick = () => invForm({ kind: 'packaging', unit: 'pcs' });
  main.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => invForm(DATA.inventory.find(i => i.id === Number(b.dataset.ed))));
  main.querySelectorAll('[data-dv]').forEach(b => b.onclick = () => deliveryForm(DATA.inventory.find(i => i.id === Number(b.dataset.dv))));
  main.querySelectorAll('[data-undo]').forEach(b => b.onclick = guard(async () => { if (!confirm('Undo this bake and put the ingredients back in stock?')) return; await api('/api/bakes/' + b.dataset.undo + '/undo', { body: {} }); toast('Undone'); route(); }));
}
function invForm(i){
  const kind = i.kind || 'ingredient';
  // older items stored in kg/g/L/ml open converted to lb/qt; saving stores them in lb/qt
  const unit = i.id ? dispUnit(i) : (i.unit || 'lb'); const f = i.id ? dispF(i) : 1;
  const cv = v => v === null || v === undefined || v === '' ? '' : Math.round(v * f * 10000) / 10000;
  const cc = v => v === null || v === undefined || v === '' ? '' : Math.round(v / f * 10000) / 10000;
  const pcsOz = unit === 'pcs' && i.g_per_unit && i.g_per_unit !== 1 ? Math.round(i.g_per_unit / G_OZ * 100) / 100 : '';
  modal('<h2>' + (i.id ? 'Edit ' : 'New ') + (kind === 'packaging' ? 'packaging' : 'ingredient') + '</h2><div><label>Name</label><input id="v_n" value="' + esc(i.name || '') + '" placeholder="' + (kind === 'packaging' ? 'e.g. Babka box' : 'e.g. White spelt flour') + '"></div>' +
  '<div class="row" style="margin-top:10px"><div class="f s"><label>Unit</label><select id="v_u">' + UNITS.map(u => '<option value="' + u + '"' + (u === unit ? ' selected' : '') + '>' + ({ lb: 'lb (weight)', oz: 'oz (weight)', qt: 'qt (liquid)', pcs: 'pcs (count)' })[u] + '</option>').join('') + '</select></div><div class="f s" id="v_gw"><label>Weight per piece (oz)</label><input type="number" step="any" min="0" id="v_g" value="' + esc(pcsOz) + '"></div><div class="f s"><label>In stock</label><input type="number" step="any" id="v_s" value="' + esc(cv(i.stock)) + '"></div></div>' +
  '<div class="row" style="margin-top:10px"><div class="f s"><label>Cost $ per unit</label><input type="number" step="any" min="0" id="v_c" value="' + esc(cc(i.cost_per_unit)) + '"></div><div class="f s"><label>Low-stock level</label><input type="number" step="any" min="0" id="v_l" value="' + esc(cv(i.low_level)) + '"></div><div class="f"><label>Preferred vendor</label><input id="v_sp" value="' + esc(i.supplier || '') + '" placeholder="Who you buy it from"></div></div>' +
  '<p class="mut small">Stock, cost and low level are all in the unit you pick (e.g. lb and $ per lb). Liquids (water, oil, milk…) use qt. For eggs or anything counted, use pcs and fill in the weight per piece.</p>' +
  (i.id ? '<div class="bc-box"><label>Barcodes</label><div id="v_bc"></div><div class="row" style="margin-top:8px"><div class="f"><input id="v_bcn" inputmode="numeric" placeholder="Barcode number"></div><div class="f s"><input type="number" step="any" min="0" id="v_bcs" placeholder="Bag size"></div><div class="f s"><select id="v_bcu">' + UNITS.map(u => '<option' + (u === unit ? ' selected' : '') + '>' + u + '</option>').join('') + '</select></div><button class="btn sm ghost" id="v_bca">+ Add barcode</button></div><div class="small mut">Or just scan the bag on the Scan page.</div></div>' : '') +
  '<div class="row" style="margin-top:16px"><button class="btn" id="v_save">Save</button><button class="btn ghost" data-close>Cancel</button><span class="spacer"></span>' + (i.id ? '<button class="btn danger" id="v_del">Delete</button>' : '') + '</div><div id="v_err" class="err"></div>', (m, close) => {
    const tog = () => { m.querySelector('#v_gw').style.display = val(m, '#v_u') === 'pcs' && kind !== 'packaging' ? '' : 'none'; }; tog(); m.querySelector('#v_u').onchange = tog;
    if (i.id) barcodeList(m, i);
    m.querySelector('#v_save').onclick = async () => { try { const u = val(m, '#v_u'); await api('/api/inventory', { body: { id: i.id, kind, name: val(m, '#v_n'), unit: u, g_per_unit: u === 'pcs' ? ((n(val(m, '#v_g')) || 0) * G_OZ || 1) : UNIT_G[u], stock: n(val(m, '#v_s')) || 0, cost_per_unit: n(val(m, '#v_c')), low_level: n(val(m, '#v_l')), supplier: val(m, '#v_sp') } }); close(); toast('Saved'); route(); } catch(e) { m.querySelector('#v_err').textContent = e.message; } };
    const del = m.querySelector('#v_del'); if (del) del.onclick = guard(async () => { if (!confirm('Delete ' + i.name + '?')) return; await api('/api/inventory/' + i.id, { method: 'DELETE' }); close(); toast('Deleted'); route(); });
  });
}
function deliveryForm(i){
  const du = dispUnit(i), f = dispF(i);
  modal('<h2>Delivery: ' + esc(i.name) + '</h2><div class="row"><div class="f s"><label>Amount received (' + esc(du) + ')</label><input type="number" step="any" min="0" id="d_q"></div><div class="f s"><label>Total paid $ (optional)</label><input type="number" step="any" min="0" id="d_c"></div><div class="f s"><label>Date</label><input type="date" id="d_d" value="' + localToday() + '"></div></div>' +
  '<div style="margin-top:10px"><label>Vendor</label><input id="d_s" value="' + esc(i.supplier || '') + '"></div><label class="chk" style="margin-top:10px"><input type="checkbox" id="d_u" checked> Update cost per unit from this delivery (total ÷ amount)</label>' +
  '<div class="row" style="margin-top:16px"><button class="btn gold" id="d_ok">Add to stock</button><button class="btn ghost" data-close>Cancel</button></div><div id="d_err" class="err"></div>', (m, close) => {
    m.querySelector('#d_ok').onclick = async () => { try { const q = n(val(m, '#d_q')); await api('/api/inventory/' + i.id + '/delivery', { body: { qty: q === null ? null : q / f, cost_total: n(val(m, '#d_c')), date: val(m, '#d_d'), supplier: val(m, '#d_s'), update_cost: m.querySelector('#d_u').checked } }); close(); toast('Stock added'); route(); } catch(e) { m.querySelector('#d_err').textContent = e.message; } };
  });
}

// ================= PRICING =================
function costProduct(p){
  const r = recipeById(p.recipe_id); const out = { missing: [], batchIng: 0, pack: 0, ings: [], packs: [] };
  if (!r) { out.missing.push('no recipe'); return out; }
  out.upb = p.units_per_batch || r.yield_pieces || 1;
  out.waste = Number(r.waste_pct) || 0; const wf = 1 + out.waste / 100; // waste % = extra dough made, so it costs too
  for (const i of r.items) { const inv = invByName(i.name); const g = i.grams * wf; if (!inv || inv.cost_per_unit === null) { out.missing.push(i.name); out.ings.push({ name: i.name, grams: g / out.upb, liquid: isLiq(i), cost: null }); continue; } const c = g / (inv.g_per_unit || 1) * inv.cost_per_unit; out.batchIng += c; out.ings.push({ name: i.name, grams: g / out.upb, liquid: isLiq(i), cost: c / out.upb }); }
  for (const pk of p.packaging) { const inv = DATA.inventory.find(x => x.id === pk.inventory_id); if (!inv || inv.cost_per_unit === null) { out.missing.push(inv ? inv.name : 'packaging'); continue; } out.pack += pk.qty_per_unit * inv.cost_per_unit; out.packs.push({ name: inv.name, qty: pk.qty_per_unit, cost: pk.qty_per_unit * inv.cost_per_unit }); }
  out.labor = (p.labor_per_batch || 0) + (p.overhead_per_batch || 0);
  out.ingUnit = out.batchIng / out.upb; out.laborUnit = (p.labor_per_batch || 0) / out.upb; out.overUnit = (p.overhead_per_batch || 0) / out.upb;
  out.unitCost = (out.batchIng + out.labor) / out.upb + out.pack;
  out.markup = p.markup_pct ?? 0;
  out.price = out.unitCost * (1 + out.markup / 100);
  out.profit = out.price - out.unitCost;
  if (p.current_price !== null && p.current_price !== undefined) { out.cur = p.current_price; out.curProfit = p.current_price - out.unitCost; out.curMargin = p.current_price ? out.curProfit / p.current_price * 100 : null; }
  return out;
}
async function viewPricing(){
  await loadAll();
  main.innerHTML = '<h1>Pricing calculator</h1><div class="note" style="margin-bottom:14px">First the ingredient cost of one item (each ingredient at your Inventory prices, including the recipe\'s waste %). Then labor, overhead and packaging are added for the full cost, and your markup % gives the suggested wholesale price. Change any ingredient price in Inventory and this updates.</div>' +
  (DATA.products.length ? '<div class="grid g2">' + DATA.products.map(p => { const c = costProduct(p); const per = p.unit ? esc(p.unit) : 'item'; return '<div class="card"><h3>' + esc(p.name) + (p.unit ? ' <span class="mut small">per ' + esc(p.unit) + '</span>' : '') + '</h3>' +
    (c.missing.length ? '<div class="warn">Missing cost for: ' + c.missing.map(esc).join(', ') + '. Add it in Inventory (names must match the recipe).</div>' : '') +
    (c.upb ? '<div class="pr-ing"><div class="list-item pr-head"><span><b>Ingredient cost per ' + per + '</b>' + (c.waste ? ' <span class="mut small">incl. ' + fmtPct(c.waste) + ' waste</span>' : '') + '</span><b class="price">' + money(c.ingUnit) + '</b></div>' +
      c.ings.map(x => '<div class="list-item sub"><span>' + esc(x.name) + ' <span class="mut small">' + fmtG(x.grams, false, x.liquid) + '</span></span><span>' + (x.cost === null ? '<span class="chip">no cost</span>' : money(x.cost)) + '</span></div>').join('') + '</div>' +
    '<div class="list-item"><span>+ Labor per ' + per + ' <span class="mut small">(' + money(p.labor_per_batch || 0) + ' ÷ ' + qty(c.upb) + ' per batch)</span></span><b>' + money(c.laborUnit) + '</b></div>' +
    '<div class="list-item"><span>+ Overhead per ' + per + ' <span class="mut small">(' + money(p.overhead_per_batch || 0) + ' ÷ ' + qty(c.upb) + ')</span></span><b>' + money(c.overUnit) + '</b></div>' +
    '<div class="list-item"><span>+ Packaging per ' + per + (c.packs.length ? ' <span class="mut small">(' + c.packs.map(x => qty(x.qty) + ' × ' + esc(x.name)).join(', ') + ')</span>' : '') + '</span><b>' + money(c.pack) + '</b></div>' +
    '<div class="list-item total"><span><b>Total cost per ' + per + '</b></span><b>' + money(c.unitCost) + '</b></div>' +
    '<div class="row" style="margin:10px 0;align-items:center"><div class="f s"><label>Markup %</label><input type="number" step="any" min="0" data-mk="' + p.id + '" value="' + esc(p.markup_pct ?? '') + '"></div><div class="f s"><label>Labor $/batch</label><input type="number" step="any" min="0" data-lb="' + p.id + '" value="' + esc(p.labor_per_batch ?? '') + '"></div><div class="f s"><label>Overhead $/batch</label><input type="number" step="any" min="0" data-oh="' + p.id + '" value="' + esc(p.overhead_per_batch ?? '') + '"></div></div>' +
    '<div class="list-item"><span>Suggested wholesale price</span><span class="price">' + money(c.price) + '</span></div><div class="list-item"><span>Profit per unit</span><b class="ok">' + money(c.profit) + '</b></div>' +
    (c.cur !== undefined ? '<div class="list-item"><span>At your current price ' + money(c.cur) + '</span><b class="' + (c.curProfit >= 0 ? 'ok' : 'err') + '">' + money(c.curProfit) + ' profit' + (c.curMargin !== null ? ' (' + fmtPct(c.curMargin) + ' margin)' : '') + '</b></div>' : '') : '') + '</div>'; }).join('') + '</div>' : emptyState('💲','No prices yet','Add your ingredient costs in Inventory and your products, and the cost and suggested price of each item show up here.','<a class="btn" href="#/inventory">Go to Inventory</a>'));
  const save = async (id, field, value) => { const p = DATA.products.find(x => x.id === Number(id)); await api('/api/products', { body: { ...p, [field]: n(value), packaging: p.packaging } }); toast('Saved'); route(); };
  main.querySelectorAll('[data-mk]').forEach(i => i.onchange = guard(() => save(i.dataset.mk, 'markup_pct', i.value)));
  main.querySelectorAll('[data-lb]').forEach(i => i.onchange = guard(() => save(i.dataset.lb, 'labor_per_batch', i.value)));
  main.querySelectorAll('[data-oh]').forEach(i => i.onchange = guard(() => save(i.dataset.oh, 'overhead_per_batch', i.value)));
}

// ================= WORKERS PAGE =================
// timers live in localStorage so they survive a refresh or switching batches; one ticker drives every countdown + the alarm
const TPFX = 'sbtimer:';
const tGet = k => { try { return JSON.parse(localStorage.getItem(TPFX + k) || 'null'); } catch(e) { return null; } };
const tSet = (k, v) => { try { v ? localStorage.setItem(TPFX + k, JSON.stringify(v)) : localStorage.removeItem(TPFX + k); } catch(e) {} };
const tAll = () => { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(TPFX)) { const v = tGet(k.slice(TPFX.length)); if (v) out.push([k.slice(TPFX.length), v]); } } } catch(e) {} return out; };
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
let alarmLoop = null, wakeLock = null, wkRender = null;
async function keepAwake(on){ try { if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; } } catch(e) {} }
function ringAlarm(labels){
  let bar = document.getElementById('alarmbar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'alarmbar'; bar.setAttribute('role', 'alert'); document.body.appendChild(bar); }
  if (bar.dataset.l !== labels.join('|')) { bar.dataset.l = labels.join('|');
    bar.innerHTML = '<div class="ab-t">⏰ Time\'s up!</div><div class="ab-l">' + labels.map(esc).join('<br>') + '</div><button class="ab-x" id="ab_x">Stop alarm</button>';
    bar.querySelector('#ab_x').onclick = stopAlarm; }
  if (!alarmLoop) { const ring = () => { unlockAudio(); [0, 220, 440].forEach((t, k) => setTimeout(() => beep(k === 1 ? 1320 : 880, 180, 0.9), t)); buzz([500, 150, 500, 150, 500]); }; ring(); alarmLoop = setInterval(ring, 1100); }
}
function stopAlarm(){ if (alarmLoop) { clearInterval(alarmLoop); alarmLoop = null; } const bar = document.getElementById('alarmbar'); if (bar) bar.remove(); tAll().forEach(([k, v]) => { if (v.fired && !v.ack) tSet(k, { ...v, ack: true }); }); try { navigator.vibrate && navigator.vibrate(0); } catch(e) {} }
function timerTick(){
  const now = Date.now(); const all = tAll(); const ringing = [];
  for (const [k, v] of all) {
    if (v.end && !v.fired && v.end <= now) { v.fired = true; tSet(k, v); if (wkRender) setTimeout(wkRender, 0); }
    if (v.fired && !v.ack) ringing.push(v.label || 'Timer');
    document.querySelectorAll('[data-tleft="' + CSS.escape(k) + '"]').forEach(el => { el.textContent = v.fired ? '0:00' : mmss(v.end - now); });
  }
  if (ringing.length) ringAlarm(ringing); else if (alarmLoop) stopAlarm();
  keepAwake(all.some(([, v]) => v.end && !v.fired));
}
setInterval(timerTick, 500);

const WKPOS = 'wkpos:';
async function viewWorkers(params){
  const date = params.get('date') || localToday();
  const d = await api('/api/worker/production?date=' + date);
  const list = []; d.recipes.forEach(r => r.batches.forEach(b => list.push({ r, b })));
  const posKey = x => x.r.recipe_id + ':' + x.b.no;
  let idx = -1;
  if (params.get('r')) idx = list.findIndex(x => x.r.recipe_id === Number(params.get('r')) && x.b.no === Number(params.get('b') || 1));
  if (idx < 0) { let saved = null; try { saved = localStorage.getItem(WKPOS + date); } catch(e) {} idx = list.findIndex(x => posKey(x) === saved); }
  if (idx < 0) idx = Math.max(0, list.findIndex(x => !x.b.done));
  const nRec = d.recipes.length, nB = list.length;
  const head = () => (ROLE === 'owner' ? '<div class="note noprint" style="margin-bottom:14px">This is exactly what workers see when they log in with the worker login. Checks and "Batch done" you make here are saved as Owner.</div>' : '') +
    '<div class="wk-h1">' + (date === localToday() ? 'Today\'s bake' : 'Bake for ' + niceDate(date).replace(/, \d{4}$/, '')) + '</div><div class="wk-day">' + niceDate(date).replace(/, \d{4}$/, '') + ' · ' + nRec + ' recipe' + (nRec === 1 ? '' : 's') + ' · ' + nB + ' batch' + (nB === 1 ? '' : 'es') + '</div>' +
    '<div class="wk-date noprint"><input type="date" id="wd" value="' + date + '" aria-label="Day"><button class="btn ghost" id="wt">Today</button><button class="btn ghost" id="wn">Tomorrow</button></div>';
  const wireHead = () => {
    main.querySelector('#wd').onchange = e => location.hash = '#/workers?date=' + e.target.value;
    main.querySelector('#wt').onclick = () => location.hash = '#/workers?date=' + localToday();
    main.querySelector('#wn').onclick = () => location.hash = '#/workers?date=' + addDays(localToday(), 1);
  };
  if (!list.length) { main.innerHTML = head() + '<div class="wk-recipe empty" style="font-size:20px">Nothing to bake for this day.</div>'; wireHead(); return; }
  const tKey = (x, k) => date + ':' + x.r.recipe_id + ':' + x.b.no + ':' + k;
  const render = () => {
    const x = list[idx]; const { r, b } = x; try { localStorage.setItem(WKPOS + date, posKey(x)); } catch(e) {}
    const ck = new Set(b.checked); const locked = !!b.done;
    const nck = b.keys.filter(k => ck.has(k)).length, tot = b.keys.length; const all = nck === tot;
    const u1 = (r.products[0] && r.products.length === 1 && !r.extra_pieces && r.products[0].unit) ? r.products[0].unit : 'pieces';
    const unit = b.pieces === 1 || u1 === 'pieces' ? u1 : u1 === 'loaf' ? 'loaves' : /(s|x|ch|sh)$/i.test(u1) ? u1 + 'es' : u1 + 's';
    let nowSet = false;
    const stepsHtml = r.steps.map((s, k) => {
      const its = b.items.filter(i => i.step === k); const keys = [...new Set(its.map(i => i.key))].concat(['s:' + k]);
      const done = keys.every(q => ck.has(q)); let cls = done ? 'done' : 'next'; if (!done && !nowSet) { cls = 'now'; nowSet = true; }
      const tk = tKey(x, k); const t = s.timer_min ? tGet(tk) : null;
      const tmr = s.timer_min ? (t && t.end ? (t.fired ? '<div class="tmr run fired"><div class="lab"><div class="big">0:00</div><small>Time\'s up · ' + esc(qty(s.timer_min)) + ' min</small></div><button class="tbtn" data-treset="' + k + '">↺ Reset</button></div>' : '<div class="tmr run"><div class="lab"><div class="big" data-tleft="' + esc(tk) + '">' + mmss(t.end - Date.now()) + '</div><small>left of ' + esc(qty(s.timer_min)) + ' min</small></div><button class="tbtn" data-tstop="' + k + '">■ Stop</button></div>') : '<div class="tmr"><div class="lab">Timer ' + esc(qty(s.timer_min)) + ' min<small>Alarm rings when time is up</small></div><button class="tbtn" data-tstart="' + k + '">▶ Start</button></div>') + '<div class="alarm">🔔 Keep this screen open: the alarm only rings while the page is open.</div>' : '';
      const ins = s.instruction && s.instruction.trim() ? s.instruction : (s.name === 'Mix' && r.steps.length === 1 ? 'Mix all the ingredients.' : 'Do this step.');
      return '<div class="step ' + cls + (locked ? ' locked' : '') + '"><div class="sh"><div class="num">' + (done ? '✓' : k + 1) + '</div><div class="tt">Step ' + (k + 1) + (s.name ? ' · ' + esc(s.name) : '') + '</div><span class="st ' + (done ? 'ok">DONE' : cls === 'now' ? 'go">NOW' : 'wait">NEXT') + '</span></div>' +
        (its.length ? '<div class="lbl">Weigh &amp; add</div>' + its.map(i => '<button type="button" class="ing' + (ck.has(i.key) ? ' ck' : '') + '" data-key="' + esc(i.key) + '"' + (locked ? ' disabled' : '') + '><span class="cb">' + (ck.has(i.key) ? '✓' : '') + '</span><span class="nm">' + esc(i.name) + '</span><span class="g">' + fmtG(i.grams, false, i.liquid) + '</span></button>').join('') : '') +
        '<button type="button" class="ins' + (ck.has('s:' + k) ? ' ck' : '') + '" data-key="s:' + k + '"' + (locked ? ' disabled' : '') + '><span class="cb' + (ck.has('s:' + k) ? ' ck' : '') + '">' + (ck.has('s:' + k) ? '✓' : '') + '</span><span class="tx">' + esc(ins) + '</span></button>' + tmr + '</div>';
    }).join('');
    const prev = idx > 0, next = idx < list.length - 1;
    main.innerHTML = head() +
      '<div class="wk-nav"><button class="arw' + (prev ? '' : ' off') + '" id="wprev"' + (prev ? '' : ' disabled') + '><b>‹</b>Prev</button><div class="mid"><div class="r">' + esc(r.name) + '</div><div class="b">Batch ' + b.no + ' of ' + b.count + '</div><div class="q">' + pieces(b.pieces) + ' ' + esc(unit) + ' · ' + fmtG(b.dough_g) + ' dough</div>' + (nB > b.count ? '<div class="q2">' + (idx + 1) + ' of ' + nB + ' on today\'s list</div>' : '') + '</div><button class="arw' + (next ? '' : ' off') + '" id="wnext"' + (next ? '' : ' disabled') + '><b>›</b>Next</button></div>' +
      '<div class="prog"><div class="t">Batch progress <span>' + nck + ' of ' + tot + ' checked</span></div><div class="bar"><i style="width:' + (tot ? Math.round(nck / tot * 100) : 0) + '%"></i></div></div>' +
      stepsHtml +
      '<div class="donebox">' + (b.done ? '<button class="bdone on" disabled>✓ Batch done</button><div class="dnote ok">' + doneLabel(b.done) + '</div>' + (ROLE === 'owner' ? '<div class="dnote"><button class="btn sm ghost" id="wreopen">Reopen batch</button></div>' : '') :
        '<button class="bdone' + (all ? ' on' : '') + '" id="wdone"' + (all ? '' : ' disabled') + '>' + (all ? 'Batch done' : '🔒 Batch done') + '</button><div class="dnote">' + (all ? 'Everything is green. Tap when the batch is finished.' : '🔒 Check everything green first (' + (tot - nck) + ' left)') + '</div>') +
      (next ? '<button class="nextb" id="wnext2">Next batch ›</button>' : '') + '</div>';
    wireHead();
    const go = k => { idx = k; render(); window.scrollTo(0, 0); };
    if (prev) main.querySelector('#wprev').onclick = () => go(idx - 1);
    if (next) { main.querySelector('#wnext').onclick = () => go(idx + 1); main.querySelector('#wnext2').onclick = () => go(idx + 1); }
    main.querySelectorAll('[data-key]').forEach(el => el.onclick = async () => {
      if (b.done) return; const key = el.dataset.key; const on = !ck.has(key);
      b.checked = on ? b.checked.concat([key]) : b.checked.filter(q => q !== key); render(); buzz(15);
      try { const res = await api('/api/check', { body: { date, recipe_id: r.recipe_id, batch_no: b.no, key, checked: on } }); b.checked = res.checked; if (list[idx] === x) render(); }
      catch(e) { b.checked = on ? b.checked.filter(q => q !== key) : b.checked.concat([key]); if (list[idx] === x) render(); toast('Not saved: ' + e.message); }
    });
    const dn = main.querySelector('#wdone'); if (dn) dn.onclick = guard(async () => { const res = await api('/api/batch/done', { body: { date, recipe_id: r.recipe_id, batch_no: b.no } }); b.done = res.done; toast('Batch done ✓'); render(); });
    const ro = main.querySelector('#wreopen'); if (ro) ro.onclick = guard(async () => { if (!confirm('Reopen this batch so it can be changed?')) return; await api('/api/batch/reopen', { body: { date, recipe_id: r.recipe_id, batch_no: b.no } }); b.done = null; render(); });
    main.querySelectorAll('[data-tstart]').forEach(bt => bt.onclick = () => { unlockAudio(); const k = Number(bt.dataset.tstart); const s = r.steps[k]; tSet(tKey(x, k), { end: Date.now() + s.timer_min * 60000, label: r.name + ' · Batch ' + b.no + ' · Step ' + (k + 1) + (s.name ? ' ' + s.name : '') }); render(); timerTick(); });
    main.querySelectorAll('[data-tstop]').forEach(bt => bt.onclick = () => { if (!confirm('Stop this timer?')) return; tSet(tKey(x, Number(bt.dataset.tstop)), null); render(); });
    main.querySelectorAll('[data-treset]').forEach(bt => bt.onclick = () => { stopAlarm(); tSet(tKey(x, Number(bt.dataset.treset)), null); render(); });
  };
  wkRender = render; render();
}

// ---- "Download all my data": a .zip of one CSV per table + the full JSON (stored, no compression) ----
function csvOf(rows){ if (!rows.length) return ''; const cols = [...rows.reduce((s, r) => { Object.keys(r).forEach(k => s.add(k)); return s; }, new Set())];
  const cell = v => { if (v === null || v === undefined) return ''; const s = String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '\ufeff' + [cols.join(',')].concat(rows.map(r => cols.map(c => cell(r[c])).join(','))).join('\r\n') + '\r\n'; }
function exportFiles(d){ const files = [['README.txt', 'Spelt Brothers Bakery Admin - all data, exported ' + d.exported_at + '\r\n\r\nOne CSV per list (opens in Excel / Numbers / Google Sheets). all-data.json is the complete copy.\r\n' + d.units_note + '\r\n']];
  Object.entries(d.tables).forEach(([t, rows]) => files.push([t + '.csv', csvOf(rows)])); files.push(['all-data.json', JSON.stringify(d, null, 1)]); return files; }
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function makeZip(files){
  const enc = new TextEncoder(); const parts = [], central = []; let off = 0;
  const now = new Date(); const dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF, dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
  for (const [name, text] of files) {
    const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true); h.setUint16(28, 0, true);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
    parts.push(h, nb, data); central.push(c, nb); off += 30 + nb.length + data.length;
  }
  const csize = central.reduce((a, x) => a + (x.byteLength), 0);
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, e], { type: 'application/zip' });
}

// ================= SETTINGS =================
async function viewSettings(){
  const s = await api('/api/settings');
  const base = location.origin;
  main.innerHTML = '<h1>Settings</h1><div class="grid g2"><div class="card"><h3>Your password</h3><div style="display:grid;gap:10px"><div><label>Current password</label><input type="password" id="o_c" autocomplete="current-password"></div><div><label>New password (8+ characters)</label><input type="password" id="o_n" autocomplete="new-password"></div><button class="btn" id="o_s">Change my password</button><div id="o_m"></div></div></div>' +
  '<div class="card"><h3>Worker login</h3><p class="mut">Username: <b>worker</b>. Workers only see the Workers page. Setting a new password logs out every worker device.</p><div style="display:grid;gap:10px"><div><label>New worker password (8+ characters)</label><input id="w_n" autocomplete="off"></div><button class="btn" id="w_s">Set worker password</button><div id="w_m"></div></div></div></div>' +
  '<div class="card"><h3>Order feed from your wholesale portal</h3><p class="mut">Your portal can send orders here automatically. It posts JSON to this address with the key below. Keep the key secret.</p>' +
  '<label>Address</label><input readonly value="' + esc(base) + '/api/orders/import"><label style="margin-top:10px">Import key</label><input readonly id="k_v" value="' + esc(s.import_key || '') + '"><div class="row" style="margin-top:10px"><button class="btn sm ghost" id="k_r">Make a new key</button></div>' +
  '<details style="margin-top:12px"><summary>Format (for whoever codes the portal)</summary><pre style="white-space:pre-wrap;background:var(--bg);padding:12px;border-radius:10px;font-size:13px">POST ' + esc(base) + '/api/orders/import\nAuthorization: Bearer &lt;import key&gt;\nContent-Type: application/json\n\n{"source":"portal","orders":[{"external_id":"1234","customer":"Main St Market","date":"2026-10-27","fulfillment":"delivery","status":"accepted","notes":"","items":[{"product":"Chocolate Babka","qty":12}]}]}\n\nSending the same external_id again updates that order. status "cancelled" removes it from production.</pre></details></div>' +
  '<div class="card"><h3>Your data</h3><p class="mut">Download everything in one file (a .zip with a spreadsheet file per list — recipes, inventory, orders… — plus a full copy for restoring).</p><button class="btn gold" id="x_dl">⬇ Download all my data</button><div id="x_m" class="small" style="margin-top:8px"></div>' +
  '<h3 style="margin-top:18px">Daily email backup</h3><p class="mut">A copy of all your data, emailed every day to <b>avrummiller9@gmail.com</b>.</p><div class="small mut">Last backup emailed: <b>' + (s.backup_last_sent ? esc(new Date(s.backup_last_sent).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : 'not yet') + '</b></div></div>' +
  '<div class="card"><h3>Start fresh</h3><p class="mut">Delete the bake history and delivery history (stock amounts stay as they are).</p><button class="btn danger sm" id="h_c">Clear history</button></div>';
  main.querySelector('#o_s').onclick = async () => { const m = main.querySelector('#o_m'); try { await api('/api/password', { body: { target: 'owner', current_password: val(main, '#o_c'), new_password: val(main, '#o_n') } }); m.innerHTML = '<span class="ok">Password changed.</span>'; } catch(e) { m.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; } };
  main.querySelector('#w_s').onclick = async () => { const m = main.querySelector('#w_m'); try { await api('/api/password', { body: { target: 'worker', new_password: val(main, '#w_n') } }); m.innerHTML = '<span class="ok">Worker password set.</span>'; } catch(e) { m.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; } };
  main.querySelector('#h_c').onclick = guard(async () => { if (prompt('Type CLEAR to delete bake and delivery history') !== 'CLEAR') return; await api('/api/history/clear', { body: { confirm: 'CLEAR' } }); toast('History cleared'); });
  main.querySelector('#x_dl').onclick = guard(async () => { const xm = main.querySelector('#x_m'); xm.textContent = 'Preparing…'; const d = await api('/api/export'); const blob = makeZip(exportFiles(d)); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'spelt-bakery-data-' + localToday() + '.zip'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); xm.innerHTML = '<span class="ok">Downloaded.</span>'; });
  main.querySelector('#k_r').onclick = guard(async () => { if (!confirm('Make a new key? The old one stops working.')) return; const r = await api('/api/settings/import-key', { body: {} }); main.querySelector('#k_v').value = r.import_key; toast('New key made'); });
}

// ================= BARCODES & SCAN =================
const normC = c => { let s = String(c ?? '').trim().replace(/\s+/g, ''); if (/^\d{12}$/.test(s)) s = '0' + s; return s; };
const bagWord = item => item && item.kind === 'packaging' ? 'pack' : 'bag';
const packLabel = (bc, item) => qty(bc.pack_size) + ' ' + esc(bc.pack_unit) + ' ' + bagWord(item);
function barcodeList(m, i){
  const box = m.querySelector('#v_bc');
  const draw = () => { const list = (DATA.barcodes || []).filter(b => b.inventory_id === i.id);
    box.innerHTML = list.length ? list.map(b => '<div class="list-item"><span><b class="mono">' + esc(b.code) + '</b><div class="small mut">' + packLabel(b, i) + (b.last_cost !== null && b.last_cost !== undefined ? ' · last ' + money(b.last_cost) + ' per ' + bagWord(i) : '') + '</div></span><button class="btn sm ghost" data-bcdel="' + b.id + '">Remove</button></div>').join('') : '<div class="small mut">No barcode yet.</div>';
    box.querySelectorAll('[data-bcdel]').forEach(x => x.onclick = guard(async () => { if (!confirm('Remove this barcode?')) return; await api('/api/barcodes/' + x.dataset.bcdel, { method: 'DELETE' }); DATA.barcodes = DATA.barcodes.filter(b => b.id !== Number(x.dataset.bcdel)); draw(); toast('Barcode removed'); }));
  };
  draw();
  m.querySelector('#v_bca').onclick = guard(async () => {
    const r = await api('/api/barcodes', { body: { code: val(m, '#v_bcn'), inventory_id: i.id, pack_size: n(val(m, '#v_bcs')), pack_unit: val(m, '#v_bcu') } });
    DATA.barcodes = (DATA.barcodes || []).filter(b => b.code !== r.barcode.code).concat([r.barcode]); m.querySelector('#v_bcn').value = ''; m.querySelector('#v_bcs').value = ''; draw(); toast('Barcode added');
  });
}

let stopScan = null;
let audioCtx = null;
function unlockAudio(){ try { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch(e) {} }
function beep(freq = 1400, ms = 90, vol = 0.25){ try { if (!audioCtx) return; const o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.frequency.value = freq; o.type = 'square'; g.gain.value = vol; o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + ms / 1000); } catch(e) {} }
function buzz(ms){ try { navigator.vibrate && navigator.vibrate(ms); } catch(e) {} }
let zxLoad = null;
function loadZXing(){ if (window.ZXing) return Promise.resolve(window.ZXing); if (!zxLoad) zxLoad = new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/scanlib.js'; s.onload = () => res(window.ZXing); s.onerror = () => { zxLoad = null; rej(new Error('Could not load the scanner')); }; document.head.appendChild(s); }); return zxLoad; }
// decoder: phone's built-in detector when it has one (Android Chrome), else the bundled ZXing reader (iPhone Safari)
async function makeDecoder(){
  const fmts = ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf','qr_code'];
  if ('BarcodeDetector' in window) { try { const sup = await window.BarcodeDetector.getSupportedFormats(); if (sup.includes('ean_13')) { const d = new window.BarcodeDetector({ formats: fmts.filter(f => sup.includes(f)) }); return async src => { const r = await d.detect(src); return r.length ? r[0].rawValue : null; }; } } catch(e) {} }
  const Z = await loadZXing(); const F = Z.BarcodeFormat;
  const hints = new Map(); hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE]); hints.set(Z.DecodeHintType.TRY_HARDER, true);
  const reader = new Z.MultiFormatReader(); reader.setHints(hints);
  return async canvas => { try { const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas))); return reader.decodeWithState(bmp).getText(); } catch(e) { return null; } finally { try { reader.reset(); } catch(e) {} } };
}
window.__makeDecoder = makeDecoder; // used by the self-test page

async function viewScan(){
  await loadAll();
  let mode = 'add', busy = false, stream = null, timer = null, decoder = null, lastCode = '', lastAt = 0, paused = false, alive = true;
  const session = [];
  const phone = window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
  main.innerHTML = '<div class="scanpage"><h1>Scan</h1><div class="seg" id="sc_mode"><button data-m="add" class="on">➕ Add to stock</button><button data-m="use">➖ Use from stock</button></div>' +
    '<div class="card scanin"><label for="sc_code">Scan or type barcode</label><div class="row"><div class="f"><input id="sc_code" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="go" placeholder="Scan a bag, or type the number + Enter"></div><button class="btn" id="sc_look">Look up</button></div><div class="small mut" style="margin-top:6px">Bluetooth or USB barcode scanner: just scan, it goes in here.</div></div>' +
    '<button class="btn ghost camopen" id="sc_cam"' + (phone ? ' hidden' : '') + '>📷 Use camera instead</button>' +
    '<div class="scanbox" id="sc_box"' + (phone ? '' : ' hidden') + '><video id="sc_v" playsinline muted autoplay></video><div class="aim"></div><div class="scanmsg" id="sc_msg">Starting camera…</div><button class="torch" id="sc_t" hidden>🔦</button><button class="btn gold" id="sc_go" hidden>📷 Start camera</button><button class="camx" id="sc_off" aria-label="Turn camera off">✕</button></div>' +
    '<div id="sc_panel"></div>' +
    '<div class="card"><h3>Scanned now</h3><div id="sc_hist"><div class="empty">Nothing yet.</div></div></div></div>';
  const v = main.querySelector('#sc_v'), msg = main.querySelector('#sc_msg'), panel = main.querySelector('#sc_panel'), go = main.querySelector('#sc_go'), tbtn = main.querySelector('#sc_t');
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const setMsg = t => { msg.textContent = t; };
  main.querySelectorAll('#sc_mode button').forEach(b => b.onclick = () => { unlockAudio(); mode = b.dataset.m; main.querySelectorAll('#sc_mode button').forEach(x => x.classList.toggle('on', x === b)); main.querySelector('#sc_box').classList.toggle('use', mode === 'use'); panel.innerHTML = ''; paused = false; });
  main.addEventListener('pointerdown', unlockAudio, { once: true });
  function stop(){ alive = false; clearTimeout(timer); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; document.removeEventListener('visibilitychange', onVis); document.removeEventListener('keydown', onKey, true); }
  stopScan = stop;
  function onVis(){ if (document.hidden) { clearTimeout(timer); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; } else if (alive && !main.querySelector('#sc_box').hidden) start(); }
  document.addEventListener('visibilitychange', onVis);
  async function start(){
    go.hidden = true; setMsg('Starting camera…');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setMsg('This browser can\'t use the camera here. Type the number below.'); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
      v.srcObject = stream; await v.play().catch(() => {});
      const track = stream.getVideoTracks()[0]; let torchOn = false;
      try { const cap = track.getCapabilities ? track.getCapabilities() : {}; if (cap.torch) { tbtn.hidden = false; tbtn.onclick = async () => { torchOn = !torchOn; try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); tbtn.classList.toggle('on', torchOn); } catch(e) { tbtn.hidden = true; } }; } } catch(e) {}
      if (!decoder) decoder = await makeDecoder();
      setMsg('Point at the barcode'); loop();
    } catch(e) {
      go.hidden = false;
      setMsg(e && e.name === 'NotAllowedError' ? 'Camera is blocked. Tap Start camera and choose Allow. (iPhone: Settings › Safari › Camera › Allow)' : 'Camera not available. Type the number below.');
    }
  }
  go.onclick = () => { unlockAudio(); start(); };
  function grab(){
    const w = v.videoWidth, h = v.videoHeight; if (!w || !h) return null;
    // middle band of the picture (where the aim box is), max ~900 px wide
    const cw = Math.round(w * 0.9), ch = Math.round(h * 0.6), sx = Math.round((w - cw) / 2), sy = Math.round((h - ch) / 2);
    const sc = Math.min(1, 900 / cw); canvas.width = Math.round(cw * sc); canvas.height = Math.round(ch * sc);
    ctx.drawImage(v, sx, sy, cw, ch, 0, 0, canvas.width, canvas.height); return canvas;
  }
  async function loop(){
    if (!alive || !stream) return;
    if (!paused && !busy) {
      busy = true;
      try { const c = grab(); const code = c ? await decoder(c) : null; if (code) await onCode(code, true); } catch(e) {}
      busy = false;
    }
    timer = setTimeout(loop, 120);
  }
  async function onCode(raw, fromCam){
    const code = String(raw).trim(); if (!code) return;
    const now = Date.now(); if (fromCam && code === lastCode && now - lastAt < 2500) return; // same bag still in view
    const openCard = panel.querySelector('#k_q');
    if (!fromCam && openCard && panel.dataset.code && normC(code) === panel.dataset.code) { openCard.value = (n(openCard.value) || 0) + 1; openCard.dispatchEvent(new Event('input')); beep(1700, 70); buzz(60); toast('Scanned again: ' + openCard.value); return; }
    lastCode = code; lastAt = now; paused = true; beep(1700, 70); buzz(60);
    try { const r = await api('/api/barcode?code=' + encodeURIComponent(code)); r.found ? showKnown(r) : showNew(r.code); }
    catch(e) { paused = false; toast(e.message); }
  }
  const box = main.querySelector('#sc_code');
  const refocus = () => { if (!phone && alive && !panel.querySelector('input:focus, select:focus')) box.focus({ preventScroll: true }); };
  const submitBox = () => { unlockAudio(); const c = box.value; if (c && c.trim()) { box.value = ''; onCode(c, false); } };
  main.querySelector('#sc_look').onclick = submitBox;
  box.addEventListener('keydown', e => { if ((e.key === 'Enter' || (e.key === 'Tab' && box.value.trim())) ) { e.preventDefault(); submitBox(); } });
  // keyboard-wedge scanners type fast and end with Enter: catch a burst even when focus is elsewhere.
  // Inside another field only a scanner-speed burst (≥6 keys, <35 ms apart) counts, and that field gets its old value back.
  let kb = { buf: '', last: 0, slow: false, el: null, before: null };
  function onKey(e){
    if (!alive || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target; if (t === box) return;
    const field = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    const now = performance.now(), gap = now - kb.last;
    if (gap > 100) kb = { buf: '', last: now, slow: false, el: field ? t : null, before: field && 'value' in t ? t.value : null };
    else { if (gap > 35) kb.slow = true; kb.last = now; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const ok = field ? (kb.buf.length >= 6 && !kb.slow) : kb.buf.length >= 4;
      if (ok) { e.preventDefault(); e.stopPropagation(); const code = kb.buf; if (kb.el && kb.before !== null) { const el = kb.el, b4 = kb.before; setTimeout(() => { el.value = b4; el.dispatchEvent(new Event('input')); }, 0); } unlockAudio(); onCode(code, false); }
      kb.buf = ''; return;
    }
    if (e.key.length === 1) kb.buf += e.key;
  }
  document.addEventListener('keydown', onKey, true);
  const camBox = main.querySelector('#sc_box'), camBtn = main.querySelector('#sc_cam');
  camBtn.onclick = () => { unlockAudio(); camBox.hidden = false; camBtn.hidden = true; start(); };
  main.querySelector('#sc_off').onclick = () => { clearTimeout(timer); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; camBox.hidden = true; camBtn.hidden = false; refocus(); };
  const resume = () => { panel.innerHTML = ''; panel.dataset.code = ''; paused = false; lastAt = Date.now(); setMsg('Point at the barcode'); refocus(); };
  function showKnown(r){
    const it = r.item, bc = r.barcode, word = bagWord(it), add = mode === 'add';
    setMsg('Found it');
    panel.innerHTML = '<div class="card scard"><div class="small mut mono">' + esc(r.code) + '</div><h2 style="margin:4px 0">' + esc(it.name) + '</h2><div><span class="chip">' + packLabel(bc, it) + '</span> <span class="small mut">In stock now: <b>' + fmtStock(it, it.stock) + '</b></span></div>' +
      '<div class="stepper"><button class="btn ghost" id="k_m" aria-label="Less">−</button><input type="number" inputmode="decimal" min="0" step="any" id="k_q" value="1"><button class="btn ghost" id="k_p" aria-label="More">+</button><span class="stepw">' + word + 's</span></div>' +
      '<div class="small mut" id="k_tot"></div>' +
      (add ? '<div style="margin-top:10px"><label for="k_c">Cost per ' + word + ' $ (optional)</label><input type="number" inputmode="decimal" step="any" min="0" id="k_c" value="' + esc(bc.last_cost ?? '') + '" placeholder="e.g. 32.50"></div>' : '') +
      '<div class="row" style="margin-top:14px"><button class="btn ' + (add ? 'gold' : '') + ' big" id="k_ok">' + (add ? 'Add to stock' : 'Take from stock') + '</button><button class="btn ghost" id="k_x">Cancel</button></div><div id="k_err" class="err"></div></div>';
    const q = panel.querySelector('#k_q');
    const tot = () => { const k = n(q.value) || 0; panel.querySelector('#k_tot').textContent = '= ' + qty(k * (r.per_pack || 0)) + ' ' + it.unit + (add ? ' added' : ' taken out'); };
    tot(); q.oninput = tot; panel.dataset.code = r.code; refocus();
    panel.querySelector('#k_m').onclick = () => { q.value = Math.max(1, (n(q.value) || 1) - 1); tot(); };
    panel.querySelector('#k_p').onclick = () => { q.value = (n(q.value) || 0) + 1; tot(); };
    panel.querySelector('#k_x').onclick = resume;
    panel.querySelector('#k_ok').onclick = async () => { unlockAudio(); const btn = panel.querySelector('#k_ok'); btn.disabled = true;
      try { const res = await api('/api/scan', { body: { code: r.code, packs: n(q.value), mode, cost_per_pack: add ? n(val(panel, '#k_c')) : null } }); done(res); }
      catch(e) { btn.disabled = false; panel.querySelector('#k_err').textContent = e.message; } };
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function done(res){
    const it = res.item, word = bagWord(it), add = res.mode === 'add';
    beep(1200, 80); setTimeout(() => beep(1800, 120), 110); buzz([60, 40, 60]);
    session.unshift(res); drawHist();
    panel.innerHTML = '<div class="card scard okc"><div class="okbig">✓ ' + (add ? 'Added' : 'Taken out') + '</div><div><b>' + qty(res.packs) + ' × ' + packLabel(res.barcode, it) + '</b> ' + (add ? 'of' : 'from') + ' ' + esc(it.name) + '</div><div>Now in stock: <b>' + fmtStock(it, it.stock) + '</b></div><div class="row" style="margin-top:10px"><button class="btn sm ghost" id="o_u">Undo</button><span class="small mut">Ready for the next ' + word + '</span></div></div>';
    panel.querySelector('#o_u').onclick = guard(async () => { await undo(res); });
    panel.dataset.code = ''; paused = false; lastAt = Date.now(); setMsg('Point at the next barcode'); refocus();
  }
  async function undo(res){ if (res.undone) return; await api('/api/scan/' + res.log_id + '/undo', { body: {} }); res.undone = true; drawHist(); if (panel.querySelector('.okc')) panel.innerHTML = ''; toast('Undone'); }
  function drawHist(){
    const h = main.querySelector('#sc_hist'); if (!session.length) return;
    h.innerHTML = session.map((s, ix) => '<div class="list-item"><span>' + (s.mode === 'add' ? '➕ ' : '➖ ') + esc(s.item.name) + '<div class="small mut">' + qty(s.packs) + ' × ' + packLabel(s.barcode, s.item) + ' = ' + qty(Math.abs(s.delta)) + ' ' + esc(s.item.unit) + '</div></span>' + (s.undone ? '<span class="chip">undone</span>' : '<button class="btn sm ghost" data-hu="' + ix + '">Undo</button>') + '</div>').join('');
    h.querySelectorAll('[data-hu]').forEach(b => b.onclick = guard(async () => { await undo(session[Number(b.dataset.hu)]); }));
  }
  function showNew(code){
    setMsg('New barcode'); panel.dataset.code = '';
    const ing = DATA.inventory.filter(i => i.kind !== 'packaging'), pk = DATA.inventory.filter(i => i.kind === 'packaging');
    const opt = i => '<option value="' + i.id + '">' + esc(i.name) + ' (' + esc(i.unit) + ')</option>';
    const none = !DATA.inventory.length;
    panel.innerHTML = '<div class="card scard newc"><h2 style="margin:0 0 4px">New barcode</h2><div class="mono">' + esc(code) + '</div><p class="mut small" style="margin:6px 0 10px">Tell me what this is once. Next time it\'s instant.</p>' +
      '<label for="n_i">Which item is it?</label><select id="n_i"><option value="">Choose…</option>' + (ing.length ? '<optgroup label="Ingredients">' + ing.map(opt).join('') + '</optgroup>' : '') + (pk.length ? '<optgroup label="Packaging">' + pk.map(opt).join('') + '</optgroup>' : '') + '<option value="new"' + (none ? ' selected' : '') + '>➕ New item…</option></select>' +
      '<div id="n_new" hidden><div style="margin-top:10px"><label for="n_n">Name</label><input id="n_n" placeholder="e.g. Whole spelt flour"></div><div class="row" style="margin-top:10px"><div class="f s"><label for="n_k">Type</label><select id="n_k"><option value="ingredient">Ingredient</option><option value="packaging">Packaging</option></select></div><div class="f s"><label for="n_u">Count it in</label><select id="n_u">' + UNITS.map(u => '<option' + (u === 'lb' ? ' selected' : '') + '>' + u + '</option>').join('') + '</select></div></div></div>' +
      '<label style="margin-top:10px;display:block" for="n_s">Size of one bag / package</label><div class="row"><div class="f s"><input type="number" inputmode="decimal" step="any" min="0" id="n_s" placeholder="e.g. 25"></div><div class="f s"><select id="n_su">' + UNITS.map(u => '<option' + (u === 'lb' ? ' selected' : '') + '>' + u + '</option>').join('') + '</select></div></div>' +
      '<div class="row" style="margin-top:14px"><button class="btn gold big" id="n_ok">Save barcode</button><button class="btn ghost" id="n_x">Cancel</button></div><div id="n_err" class="err"></div></div>';
    const sel = panel.querySelector('#n_i'), nw = panel.querySelector('#n_new'), su = panel.querySelector('#n_su');
    const sync = () => { nw.hidden = sel.value !== 'new'; const it = DATA.inventory.find(i => i.id === Number(sel.value)); if (it) su.value = it.unit; else if (sel.value === 'new') su.value = val(panel, '#n_u'); };
    sel.onchange = sync; panel.querySelector('#n_u').onchange = () => { su.value = val(panel, '#n_u'); }; panel.querySelector('#n_k').onchange = () => { if (val(panel, '#n_k') === 'packaging') { panel.querySelector('#n_u').value = 'pcs'; su.value = 'pcs'; } }; sync();
    panel.querySelector('#n_x').onclick = resume;
    panel.querySelector('#n_ok').onclick = async () => {
      try {
        const body = { code, pack_size: n(val(panel, '#n_s')), pack_unit: su.value };
        if (sel.value === 'new') body.new_item = { name: val(panel, '#n_n'), kind: val(panel, '#n_k'), unit: val(panel, '#n_u') }; else body.inventory_id = n(sel.value);
        const r = await api('/api/barcodes', { body });
        await loadAll(); toast('Barcode saved'); showKnown(r);
      } catch(e) { panel.querySelector('#n_err').textContent = e.message; }
    };
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  if (phone) start(); else refocus();
}

// ================= ROUTER =================
const VIEWS = { more: viewMore, dashboard: viewDashboard, orders: viewOrders, production: viewProduction, scaler: viewScaler, recipes: viewRecipes, products: viewProducts, inventory: viewInventory, scan: viewScan, pricing: viewPricing, workers: viewWorkers, settings: viewSettings };
async function route(){
  const h = location.hash.replace(/^#\/?/, ''); const [name, qs] = h.split('?');
  routeSeq++; wkRender = null;
  if (stopScan) { try { stopScan(); } catch(e) {} stopScan = null; }
  let v = ROLE === 'owner' ? (VIEWS[name] ? name : 'dashboard') : 'workers';
  renderNav(v);
  try { await VIEWS[v](new URLSearchParams(qs || '')); } catch(e) { if (e.message === '__stale') return; main.innerHTML = '<div class="card err">' + esc(e.message) + '</div>'; }
  document.querySelectorAll('.modal-bg').length || window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();
})();
