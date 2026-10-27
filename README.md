# Spelt Brothers Bakery Admin
Live: https://spelt-bakery-admin.sites.tab.bot/  (Cloudflare Worker + D1 "DB", slug spelt-bakery-admin)
Source: server.src.js (Worker API + auth), app.src.js (SPA), app.src.css. Built into site/worker.mjs by the build() step (strings inlined; SEED = password hashes).
Logins: owner "avrum", worker "worker" (passwords in ../../CREDENTIALS_private.json; PBKDF2-SHA256 100k, salted).
Tests: test/shots.py (screens), test/ui.py (UI flows + worker role), test/ui_delete.py.
Import feed: POST /api/orders/import, Authorization: Bearer <import key from Settings>, JSON {source, orders:[{external_id, customer, date, fulfillment, status, notes, items:[{product, qty}]}]}; upsert by (source, external_id).

Barcode scanning (added 2026-10-25): Scan page (#/scan; in More, side menu, and the gold "Scan" button on Inventory). Owner only.
- Tables (additive): barcodes(code UNIQUE, inventory_id, pack_size, pack_unit, last_cost), scan_log(mode add|use, packs, qty, delivery_id, prev_cost, cost_changed, undone).
- API: GET /api/barcode?code=, POST /api/barcodes {code, inventory_id | new_item{name,kind,unit}, pack_size, pack_unit}, DELETE /api/barcodes/:id, POST /api/scan {code, packs, mode, cost_per_pack}, POST /api/scan/:id/undo, GET /api/scans. /api/all now also returns barcodes.
- Codes normalized: 12-digit UPC-A stored as 13-digit EAN-13 (leading 0). Add = stock += packs × pack size (converted to the item unit) + a deliveries row; cost per bag updates cost_per_unit (= cost ÷ bag size).
- Decoder: native BarcodeDetector when present, else bundled @zxing/library 0.21.3 UMD served at /scanlib.js (owner-only, inlined as SCAN_LIB in worker.mjs; source /tmp/zx/node_modules/@zxing/library/umd/index.min.js).
- Keyboard-wedge scanners: focused "Scan or type barcode" box on tablet/desktop + document keydown burst catcher (scanner-speed bursts only inside other fields). Same code again while its card is open = +1 bag.
- Phone (coarse pointer, screen < 600 px) starts the camera; iPad/desktop default to the scanner box with a "Use camera instead" button.
- Home screen: apple-touch-icon.png, icon-192/512.png, /manifest.webmanifest ("Spelt Admin", standalone).
- Build: worker.mjs = server.src.js (SEED filled) + APP_JS, APP_CSS, LOGIN_HTML, APP_HTML (with home-screen head tags), SCAN_LIB. Test: test/scan_math.test.js (node test/scan_math.test.js server.src.js).

2026-10-26 upgrade (14 changes, task 2faac9f0): units lb/oz + qt (grams stay in DB; 1 qt = 946.353 g water), waste % and mixer max per recipe (recipes.waste_pct, recipes.mixer_max_g in grams), recipe steps (recipe_steps table; recipe_items.step = step index, recipe_items.liquid = 0/1/NULL auto),
"+ Add bake" (extra_bakes), per-batch tick boxes (batch_checks, key 'i:<name>' / 's:<step index>') and Batch done (batch_done), Workers page one batch at a time with timers/alarm (timers in localStorage),
inventory "Preferred vendor" (= supplier column) + shopping list by vendor, pricing ingredient-cost first, Settings download (client-side zip of CSVs + JSON from GET /api/export),
GET /api/backup with "Authorization: Bearer <backup_key>" (settings.backup_key; shown in GET /api/settings) returns the same export for a daily email job; ?mark=sent records backup_last_sent shown in Settings.
New columns are added at startup with ALTER TABLE ADD COLUMN (additive only). Build: worker.mjs = server.src.js (SEED filled) + APP_JS + APP_CSS + the existing LOGIN_HTML/APP_HTML/SCAN_LIB tail.
QA scripts: /home/user/tab/tasks/2faac9f0-f9fe-43a5-b15c-75fb330b7f08/qa_ui.py (local), qa_editor.py, qa_live.py.
