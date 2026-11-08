/* ============================================================================
   ASA master material list: one list of every material, shared by every
   approved account and every tool (Trading Quotation, Delivery Order,
   Material Tracker, Stock Inventory, LPO Generator).

   Cloud:  apps/materials/items/{id}   one record per material
           apps/materials/meta/info    { seeded: true } once the admin has built it
   Anyone approved may add or change a material. Only the admin may remove one.
   Load after asa-cloud.js.

   A material looks like a Trading Quotation catalog entry, plus a few fields:
     { id, code, desc, vendor, type, size, weight, length, rate,
       fixed?, perPiece?, aef?, nef?, notes?, oldCode? }
   weight = kg per metre (sheets: kg per sheet, length 1; per-piece items: 1).
   This device keeps a copy, so the list also works offline.
   ========================================================================== */
(function () {
  const C = window.ASACloud;
  const APP = 'materials', COLL = 'items';
  const CACHE = 'asa_materials_v1', OUTBOX = 'asa_materials_outbox';
  const META = ['dev', 'by', 'ts', '_u', '_by', '_device', '_at'];
  const OVERLAP = 15 * 60 * 1000;      // allowance for device clocks that are a little off

  let items = new Map();               // id -> material (deleted ones kept as { id, deleted: true })
  let last = 0;                        // newest ts we have seen
  let started = null, seeded = false, listeners = [];

  const readJSON = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  function loadCache() {
    const c = readJSON(CACHE);
    if (c && c.items) { items = new Map(Object.entries(c.items)); last = c.last || 0; seeded = !!c.seeded; }
  }
  function saveCache() { writeJSON(CACHE, { items: Object.fromEntries(items), last, seeded }); }

  function strip(d) { const o = { ...d }; META.forEach(k => delete o[k]); return o; }
  // Compare two records ignoring key order and sync stamps.
  const canon = d => { const o = strip(d || {}); return JSON.stringify(Object.keys(o).sort().reduce((a, k) => (o[k] !== undefined && (a[k] = o[k]), a), {})); };
  function slug(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'item';
  }
  // Same name -> same id, so two people adding the same material get one record.
  function idFor(code) { return slug(code); }
  function needsPrice(m) {
    if (!m) return false;
    if (m.perPiece || m.fixed) return !(Number(m.rate) > 0);
    return !(Number(m.weight) > 0) || !(Number(m.rate) > 0);
  }
  const live = () => [...items.values()].filter(m => !m.deleted);
  const tag = () => ({ dev: C.deviceId(), by: C.name(), ts: Date.now(), _u: Date.now() });
  const cloudOK = () => { const s = C.session(); return !!(s && C.configured() && !s.setup && !s.offline); };

  function absorb(docs) {
    let changed = 0;
    for (const d of docs) {
      if (!d || !d.id) continue;
      if (d.ts > last) last = d.ts;
      const m = d.deleted ? { id: d.id, deleted: true } : strip(d);
      const before = items.get(d.id);
      if (canon(before) !== canon(m)) { items.set(d.id, m); changed++; }
    }
    return changed;
  }
  function tell(by) { const list = live(); listeners.forEach(fn => { try { fn(list, by || 'the team'); } catch (e) {} }); }

  async function push(m) {
    try { await C.put(APP, COLL, m.id, { ...m, ...tag() }); }
    catch (e) {
      const box = readJSON(OUTBOX) || {}; box[m.id] = m; writeJSON(OUTBOX, box);
      if (String(e && e.code).includes('permission-denied')) throw e;
    }
  }
  async function flush() {
    const box = readJSON(OUTBOX) || {};
    if (!Object.keys(box).length) return;
    localStorage.removeItem(OUTBOX);
    for (const m of Object.values(box)) await push(m).catch(() => {});
  }

  /* Starts the shared list (once per page). Resolves to
     { seeded, items }  — seeded false = the admin has not built the list yet,
     so tools keep working the old way. */
  function start() {
    if (started) return started;
    loadCache();
    started = (async () => {
      if (!cloudOK()) return { seeded, items: live(), offline: true };
      try {
        const info = await C.get(APP, 'meta', 'info');
        seeded = !!(info && info.seeded);
        if (!seeded) { saveCache(); return { seeded: false, items: [] }; }
        await flush();
        const fresh = items.size
          ? await C.where(APP, COLL, 'ts', '>', Math.max(0, last - OVERLAP))
          : await C.list(APP, COLL);
        absorb(fresh);
        saveCache();
        C.watch(APP, COLL, Date.now() - OVERLAP, changes => {
          let by = '';
          const docs = changes.filter(c => c.data.dev !== C.deviceId())
            .map(c => { by = c.data.by || by; return c.type === 'removed' ? { id: c.id, deleted: true } : { id: c.id, ...c.data }; });
          if (docs.length && absorb(docs)) { saveCache(); tell(by); }
        }).catch(() => {});
        return { seeded: true, items: live() };
      } catch (e) {
        return { seeded, items: live(), offline: true };
      }
    })();
    return started;
  }

  const ASAMaterials = {
    start, idFor, needsPrice, strip,
    seeded: () => seeded,
    items: live,
    get: id => { const m = items.get(id); return m && !m.deleted ? m : null; },
    findByCode(code) {
      const k = String(code || '').trim().toLowerCase();
      return live().find(m => String(m.code || '').trim().toLowerCase() === k
        || String(m.oldCode || '').trim().toLowerCase() === k) || null;
    },
    /* Called with (items, byName) whenever someone else changes the list. */
    onChange(fn) { listeners.push(fn); },

    /* Add or change one material. Fills in the id if missing. */
    async save(m) {
      if (!seeded) return null;
      m = strip(m);
      if (!m.id) m.id = idFor(m.code);
      delete m.deleted;
      if (canon(items.get(m.id)) === canon(m)) return m;
      items.set(m.id, m); saveCache();
      await push(m);
      return m;
    },
    async saveMany(list) { for (const m of list) await ASAMaterials.save(m); },

    /* Admin only (the cloud refuses anyone else). */
    async remove(id) {
      if (!C.isAdmin()) throw Object.assign(new Error('Only the admin can remove materials from the master list.'), { code: 'asa/admin' });
      items.set(id, { id, deleted: true }); saveCache();
      await C.put(APP, COLL, id, { id, deleted: true, ...tag() });
    },

    /* Admin: write many materials at once (building or refreshing the list). */
    async publish(list, progress) {
      if (!C.isAdmin()) throw Object.assign(new Error('Admin only.'), { code: 'asa/admin' });
      const t = tag();
      const rows = list.map(m => ({ ...strip(m), ...t }));
      await C.putMany(APP, COLL, rows, progress);
      await C.put(APP, 'meta', 'info', { seeded: true, count: rows.length });
      seeded = true;
      absorb(rows); saveCache();
    },
    /* Admin: everything currently in the cloud (fresh read). */
    async fetchAll() {
      const all = await C.list(APP, COLL);
      absorb(all); saveCache();
      return live();
    },

    /* Connects a tool's own price catalog (Trading Quotation / Delivery Order) to the master list.
       o.read()      -> the tool's catalog array (entries are updated in place with their id)
       o.write(json) -> store the catalog on this device WITHOUT sending it anywhere
       o.refresh()   -> reload the catalog on screen
       o.toast(msg)
       Returns { on, start(), saved() }: call saved() after every catalog save. */
    bridgeCatalog(o) {
      const b = { on: false };
      const toCatalog = () => live().map(strip).sort((x, y) => String(x.code).localeCompare(String(y.code)));
      const apply = () => { o.write(JSON.stringify(toCatalog())); o.refresh(); };
      b.start = async () => {
        let r = await start();
        // The first time the admin opens the tool, the current catalog becomes the master list.
        if (!r.seeded && !r.offline && C.isAdmin()) {
          const base = (o.base ? await o.base() : null) || o.read() || [];
          const used = new Set();
          const list = base.filter(p => p && p.code).map(p => {
            let id = p.id || idFor(p.code), n = 2;
            while (used.has(id)) id = idFor(p.code) + '-' + n++;
            used.add(id);
            return { ...strip(p), id };
          });
          if (list.length) {
            await ASAMaterials.publish(list);
            started = null; r = await start();          // now also listen for everyone else's changes
            o.toast('Shared material list started with ' + list.length + ' materials');
          }
        }
        if (!r.seeded) return false;
        b.on = true; apply();
        ASAMaterials.onChange((list, by) => { apply(); o.toast('Material list updated by ' + by); });
        return true;
      };
      b.saved = () => {
        if (!b.on) return;
        const cat = o.read() || [], seen = new Set();
        let gaveIds = false;
        for (const p of cat) {
          if (!p || !p.code) continue;
          if (!p.id) {
            const same = ASAMaterials.findByCode(p.code);
            let id = same ? same.id : idFor(p.code), n = 2;
            while (!same && items.has(id) && !items.get(id).deleted) id = idFor(p.code) + '-' + n++;
            p.id = id; gaveIds = true;
          }
          seen.add(p.id);
          if (canon(items.get(p.id)) !== canon(p)) {
            ASAMaterials.save({ ...p }).catch(e => o.toast(String(e && e.code).includes('permission')
              ? 'The cloud refused the change to ' + p.code : 'Saved here — will share when online'));
          }
        }
        const gone = live().filter(m => !seen.has(m.id));
        if (gone.length) {
          if (C.isAdmin()) gone.forEach(m => ASAMaterials.remove(m.id).catch(() => {}));
          else { o.toast('Only the admin can remove materials from the master list'); setTimeout(apply, 0); return; }
        }
        if (gaveIds) o.write(JSON.stringify(cat));
      };
      return b;
    }
  };

  loadCache();          // so a tool knows straight away whether this device uses the master list
  window.ASAMaterials = ASAMaterials;
})();
