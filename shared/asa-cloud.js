/* ============================================================================
   ASA Cloud — shared login + cloud storage for every ASA page.

   Accounts (checked by Firebase, never by this file):
   - Each person has their own account. The admin adds them in the Admin page
     with a first password; they must choose their own on first login.
     Username = the person's name. Behind the scenes it maps to a Firebase
     email/password account through  accounts/{username}.
   - Admin: username = ASA_CONFIG.adminUser → Firebase account ASA_CONFIG.adminEmail.

   A login lasts for the browser session: every new visit asks again.
   Every login is recorded per person + device in  devices/{uid}_{deviceId}.
   Data lives under  apps/{appId}/{collection}/{docId}.
   Load order:  asa-config.js → asa-cloud.js → asa-gate.js
   ========================================================================== */
(function () {
  const V = '10.12.2';
  const SDK = n => `https://www.gstatic.com/firebasejs/${V}/firebase-${n}.js`;
  const SALT = 'asa-cloud-v1:';
  const DOMAIN = '@asa-apps.local';
  const K = { session: 'asa:session', name: 'asa:name', dev: 'asa:deviceId', off: 'asa:offline:' };
  const cfg = () => (window.ASA_CONFIG || {});

  let sdk = null, app = null, auth = null, db = null, loading = null;

  // ---------- helpers ----------
  const readJSON = (store, k) => { try { return JSON.parse(store.getItem(k)); } catch (e) { return null; } };
  const session = () => readJSON(sessionStorage, K.session);
  const setSession = s => s ? sessionStorage.setItem(K.session, JSON.stringify(s)) : sessionStorage.removeItem(K.session);
  const slug = name => String(name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');
  const rand = n => Math.random().toString(36).slice(2, 2 + n);

  async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function localDeviceId() {
    let id = localStorage.getItem(K.dev);
    if (!id) { id = Date.now().toString(36) + rand(8); localStorage.setItem(K.dev, id); }
    return id;
  }
  function deviceLabel() {
    const ua = navigator.userAgent;
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
      : /Windows/.test(ua) ? 'Windows PC' : /Macintosh/.test(ua) ? (navigator.maxTouchPoints > 1 ? 'iPad' : 'Mac')
      : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
    const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /CriOS|Chrome\//.test(ua) ? 'Chrome'
      : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return `${os} · ${br}`;
  }
  function err(code, message) { return Object.assign(new Error(message), { code }); }
  function friendly(e) {
    const c = String((e && e.code) || '');
    if (c.startsWith('asa/')) return e.message;
    if (c.includes('permission-denied')) return 'Access refused by the cloud.';
    if (c.includes('unavailable') || c.includes('network')) return 'No internet connection — try again when online.';
    if (c.includes('wrong-password') || c.includes('invalid-credential') || c.includes('invalid-login') || c.includes('user-not-found')) return 'Wrong password.';
    if (c.includes('weak-password')) return 'Password is too short — use at least 6 characters.';
    if (c.includes('requires-recent-login')) return 'Please log out and log in again, then change the password.';
    if (c.includes('too-many-requests')) return 'Too many attempts — wait a few minutes and try again.';
    if (c.includes('api-key') || c.includes('configuration-not-found') || c.includes('admin-restricted') || c.includes('operation-not-allowed'))
      return 'Cloud settings are incomplete — check the Firebase setup.';
    return (e && e.message) || 'Something went wrong.';
  }
  const isNetwork = e => /unavailable|network|offline/i.test(String((e && (e.code || e.message)) || ''));
  const isAdminName = u => slug(u) === slug(cfg().adminUser);
  // Tools the admin gives access to, person by person. (Sheet Rate Calculator is open to every approved account.)
  const TOOLS = [
    { id: 'quotation', name: 'Fabrication Quotation' }, { id: 'trade-quote', name: 'Trading Quotation' },
    { id: 'tax-invoice', name: 'Tax Invoice' }, { id: 'delivery-order', name: 'Delivery Order' }, { id: 'lpo', name: 'LPO Generator' },
    { id: 'fab-drawing', name: 'Fabrication Drawing' }, { id: 'work-tracker', name: 'Work Tracker' },
    { id: 'material-tracker', name: 'Material Tracker' }, { id: 'powder', name: 'Powder Coating' },
    { id: 'stock', name: 'Stock Inventory' }, { id: 'costing', name: 'Stock Costing' }, { id: 'procurement', name: 'Procurement' },
    { id: 'incoming-material', name: 'Incoming Material' },
    { id: 'stl', name: 'STL Payments' }
  ];
  const OPEN_TOOLS = ['sheet-rate', 'home'];

  // ---------- Firebase ----------
  async function load() {
    if (!cfg().firebase) return false;
    if (loading) return loading;
    loading = (async () => {
      const [a, au, fs] = await Promise.all([import(SDK('app')), import(SDK('auth')), import(SDK('firestore'))]);
      sdk = { ...a, ...au, ...fs };
      app = sdk.initializeApp(cfg().firebase);
      auth = sdk.getAuth(app);
      await sdk.setPersistence(auth, sdk.browserSessionPersistence);   // closing the browser logs out
      db = sdk.getFirestore(app);
      await new Promise(res => { const off = sdk.onAuthStateChanged(auth, () => { off(); res(); }); });
      return true;
    })().catch(e => { loading = null; throw e; });
    return loading;
  }
  const D = (...p) => sdk.doc(db, ...p);

  // One device record per person per browser, so the admin sees who used what.
  async function recordDevice(uid, name, username, role, appId) {
    const id = `${uid}_${localDeviceId()}`, ref = D('devices', id), snap = await sdk.getDoc(ref);
    if (snap.exists() && snap.data().blocked) throw err('asa/blocked', 'This device has been blocked by the admin.');
    const base = { uid, name, username, role, device: deviceLabel(), ua: navigator.userAgent.slice(0, 300),
      lastSeen: sdk.serverTimestamp(), lastApp: appId || '', blocked: false };
    if (snap.exists()) await sdk.updateDoc(ref, { ...base, logins: sdk.increment(1) });
    else await sdk.setDoc(ref, { ...base, firstSeen: sdk.serverTimestamp(), logins: 1 });
    await sdk.addDoc(sdk.collection(db, 'devices', id, 'logins'),
      { at: sdk.serverTimestamp(), app: appId || '', name, device: deviceLabel() }).catch(() => {});
    return id;
  }

  async function loginAdmin(password, appId) {
    await load();
    await sdk.signInWithEmailAndPassword(auth, cfg().adminEmail, password);
    try {
      const dev = await recordDevice(auth.currentUser.uid, cfg().adminUser, slug(cfg().adminUser), 'admin', appId);
      return { role: 'admin', name: cfg().adminUser, username: slug(cfg().adminUser), uid: auth.currentUser.uid, dev };
    } catch (e) { await sdk.signOut(auth); throw e; }
  }

  async function loginMember(name, password, appId) {
    await load();
    const username = slug(name);
    const acct = await sdk.getDoc(D('accounts', username));
    if (!acct.exists()) throw err('asa/no-account', `There is no account for “${name.trim()}”. Create one with “Sign up”.`);
    const a = acct.data();
    if (a.disabled) throw err('asa/disabled', 'This account has been turned off by the admin.');
    try { await sdk.signInWithEmailAndPassword(auth, a.email, password); }
    catch (e) { if (/invalid|wrong|not-found/.test(String(e.code))) throw err('asa/wrong', 'Wrong password.'); throw e; }
    try {
      const m = await sdk.getDoc(D('members', auth.currentUser.uid));
      if (!m.exists() || m.data().disabled) throw err('asa/disabled', 'This account has been turned off by the admin.');
      const md = m.data();
      if (md.status === 'pending') return { role: 'member', name: a.name, username, uid: auth.currentUser.uid, pending: true };
      const dev = await recordDevice(auth.currentUser.uid, a.name, username, 'member', appId);
      localStorage.setItem(K.off + username, await sha256(SALT + username + ':' + password));
      return { role: 'member', name: a.name, username, uid: auth.currentUser.uid, dev, mustChange: !!a.mustChange,
               tools: md.tools || {}, mtEdit: !!md.mtEdit };
    } catch (e) { await sdk.signOut(auth); throw e; }
  }

  // Creates a Firebase login without disturbing the admin's own session.
  async function createLogin(username, password) {
    const tmp = sdk.initializeApp(cfg().firebase, 'asa-create-' + rand(6));
    const tAuth = sdk.getAuth(tmp);
    await sdk.setPersistence(tAuth, sdk.inMemoryPersistence);
    const email = `${username}.${rand(5)}${DOMAIN}`;
    const cred = await sdk.createUserWithEmailAndPassword(tAuth, email, password);
    const uid = cred.user.uid;
    await sdk.signOut(tAuth).catch(() => {});
    await sdk.deleteApp(tmp).catch(() => {});
    return { email, uid };
  }

  const ASACloud = {
    configured: () => !!cfg().firebase,
    session,
    role: () => (session() || {}).role || null,
    isAdmin: () => ((session() || {}).role === 'admin'),
    name: () => (session() || {}).name || '',
    username: () => (session() || {}).username || '',
    lastName: () => localStorage.getItem(K.name) || '',
    slug, deviceLabel, friendly,
    ready: () => load().catch(() => false),
    toDate(ts) { return ts && ts.toDate ? ts.toDate() : (ts ? new Date(ts) : null); },

    /* Login screen. Returns { ok, message, mustChange }. When mustChange is true the
       session is NOT started until changePassword() succeeds. */
    async login(username, password, appId) {
      const name = String(username || '').trim();
      if (!name) return { ok: false, message: 'Please enter your username.' };
      if (!password) return { ok: false, message: 'Please enter your password.' };
      if (!this.configured()) return { ok: false, message: 'Login is not active yet — the cloud setup is not finished.' };
      try {
        const s = isAdminName(name) ? await loginAdmin(password, appId) : await loginMember(name, password, appId);
        if (s.pending) { this._waiting = s; return { ok: true, pending: true, name: s.name }; }
        if (s.mustChange) { this._pending = s; return { ok: true, mustChange: true, name: s.name }; }
        localStorage.setItem(K.name, s.name);
        if (s.tools) localStorage.setItem('asa:tools:' + s.username, JSON.stringify(s.tools));
        setSession({ ...s, at: Date.now() });
        return { ok: true };
      } catch (e) {
        // Offline: someone who has logged in on this device before can still open the tools.
        if (isNetwork(e) && !isAdminName(name)) {
          const u = slug(name);
          if (await sha256(SALT + u + ':' + password) === localStorage.getItem(K.off + u)) {
            localStorage.setItem(K.name, name);
            let tools = {}; try { tools = JSON.parse(localStorage.getItem('asa:tools:' + u)) || {}; } catch (x) {}
            setSession({ role: 'member', name, username: u, offline: true, tools, at: Date.now() });
            return { ok: true, offline: true };
          }
        }
        return { ok: false, message: friendly(e) };
      }
    },

    /* First-login (or later) password change for the person signed in. */
    async changePassword(newPassword) {
      const p = String(newPassword || '');
      if (p.length < 6) return { ok: false, message: 'Use at least 6 characters.' };
      try {
        await load();
        await sdk.updatePassword(auth.currentUser, p);
        const s = this._pending || session();
        if (s && s.role === 'member') {
          await sdk.updateDoc(D('accounts', s.username), { mustChange: false, changedAt: sdk.serverTimestamp() });
          localStorage.setItem(K.off + s.username, await sha256(SALT + s.username + ':' + p));
        }
        if (this._pending) {
          const ps = { ...this._pending, mustChange: false, at: Date.now() };
          this._pending = null;
          localStorage.setItem(K.name, ps.name);
          setSession(ps);
        }
        return { ok: true };
      } catch (e) { return { ok: false, message: friendly(e) }; }
    },

    /* Re-checks the saved session (e.g. the admin turned the account off). */
    async verify(appId) {
      const s = session();
      if (!s || s.setup || !this.configured()) return !!s;
      if (s.offline) return true;
      try { await load(); } catch (e) { return true; }
      const u = auth.currentUser;
      if (!u || u.uid !== s.uid) { setSession(null); return false; }
      try {
        if (s.role === 'member') {
          const m = await sdk.getDoc(D('members', u.uid));
          if (!m.exists() || m.data().disabled || m.data().status !== 'active') { setSession(null); await sdk.signOut(auth); return false; }
          const tools = m.data().tools || {};
          if (JSON.stringify(tools) !== JSON.stringify(s.tools || {}) || !!m.data().mtEdit !== !!s.mtEdit) {
            setSession({ ...s, tools, mtEdit: !!m.data().mtEdit });
            localStorage.setItem('asa:tools:' + s.username, JSON.stringify(tools));
          }
        }
        const dref = D('devices', s.dev), d = await sdk.getDoc(dref);
        if (d.exists() && d.data().blocked) { setSession(null); await sdk.signOut(auth); return false; }
        await sdk.updateDoc(dref, { lastSeen: sdk.serverTimestamp(), lastApp: appId || '' }).catch(() => {});
        return true;
      } catch (e) { return true; }
    },

    TOOLS, OPEN_TOOLS,
    /* Does the signed-in person have this tool? (admin + setup mode: everything) */
    hasTool(id) {
      const s = session();
      if (!s) return false;
      if (s.role === 'admin' || s.setup) return true;
      if (id === 'admin') return false;
      if (!id || OPEN_TOOLS.includes(id)) return true;
      return !!(s.tools && s.tools[id]);
    },
    /* Sign-up: anyone can ask for an account; it waits until the admin approves it. */
    async signUp(name, password) {
      name = String(name || '').trim().replace(/\s+/g, ' ');
      const username = slug(name);
      if (username.length < 2) return { ok: false, message: 'Please enter your name (at least 2 letters).' };
      if (isAdminName(name)) return { ok: false, message: 'That name is taken. Please use your full name.' };
      if (String(password || '').length < 6) return { ok: false, message: 'Use a password of at least 6 characters.' };
      if (!this.configured()) return { ok: false, message: 'Sign-up is not active yet — the cloud setup is not finished.' };
      try {
        await load();
        if ((await sdk.getDoc(D('accounts', username))).exists()) return { ok: false, message: `“${name}” is already taken. Add your surname or a number.` };
        if (auth.currentUser) await sdk.signOut(auth);
        const email = `${username}.${rand(5)}${DOMAIN}`;
        const cred = await sdk.createUserWithEmailAndPassword(auth, email, password);
        const uid = cred.user.uid;
        await sdk.setDoc(D('members', uid), { username, name, status: 'pending', disabled: false, tools: {}, requestedAt: sdk.serverTimestamp() });
        await sdk.setDoc(D('accounts', username), { name, username, email, uid, status: 'pending', disabled: false, mustChange: false, createdAt: sdk.serverTimestamp() });
        this._waiting = { role: 'member', name, username, uid, pending: true };
        localStorage.setItem(K.name, name);
        return { ok: true, pending: true, name };
      } catch (e) { return { ok: false, message: friendly(e) }; }
    },
    /* While waiting: cb('active' | 'rejected' | 'error'). When approved the session starts by itself. */
    async waitForApproval(appId, cb) {
      await load();
      const w = this._waiting; if (!w) return () => {};
      return sdk.onSnapshot(D('members', w.uid), async snap => {
        const m = snap.exists() ? snap.data() : null;
        if (!m) return;
        if (m.disabled || m.status === 'rejected') return cb('rejected');
        if (m.status !== 'active') return;
        try {
          const dev = await recordDevice(w.uid, w.name, w.username, 'member', appId);
          const s = { role: 'member', name: w.name, username: w.username, uid: w.uid, dev, tools: m.tools || {}, mtEdit: !!m.mtEdit, at: Date.now() };
          localStorage.setItem('asa:tools:' + w.username, JSON.stringify(s.tools));
          this._waiting = null; setSession(s); cb('active');
        } catch (e) { cb('error', friendly(e)); }
      }, () => {});
    },

    async logout() {
      const s = session(); setSession(null);
      if (!s || s.setup || !this.configured()) return;
      try { await load(); await sdk.signOut(auth); } catch (e) {}
    },

    /* ---- data: apps/{appId}/{coll}/{id} ---- */
    async put(appId, coll, id, data) {
      await need();
      await sdk.setDoc(D('apps', appId, coll, id),
        { ...data, _by: this.name(), _device: deviceLabel(), _at: sdk.serverTimestamp() });
    },
    async get(appId, coll, id) {
      await need();
      const s = await sdk.getDoc(D('apps', appId, coll, id));
      return s.exists() ? s.data() : null;
    },
    async list(appId, coll) {
      await need();
      const s = await sdk.getDocs(sdk.collection(db, 'apps', appId, coll));
      return s.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    /* Only records whose `owner` is the signed-in person (private collections). */
    async listMine(appId, coll) {
      await need();
      const q = sdk.query(sdk.collection(db, 'apps', appId, coll), sdk.where('owner', '==', this.username()));
      const s = await sdk.getDocs(q);
      return s.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async remove(appId, coll, id) { await need(); await sdk.deleteDoc(D('apps', appId, coll, id)); },
    /* Records where field <op> value, e.g. where('contract_id', '==', id). */
    async where(appId, coll, field, op, value) {
      await need();
      const s = await sdk.getDocs(sdk.query(sdk.collection(db, 'apps', appId, coll), sdk.where(field, op, value)));
      return s.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    /* New record with an automatic id (logs). */
    async add(appId, coll, data) {
      await need();
      await sdk.addDoc(sdk.collection(db, 'apps', appId, coll),
        { ...data, name: this.name(), username: this.username(), device: deviceLabel(), at: sdk.serverTimestamp(), ts: Date.now() });
    },
    /* Many records at once (imports). rows need an `id`. Calls progress(done, total). */
    async putMany(appId, coll, rows, progress) {
      await need();
      for (let i = 0; i < rows.length; i += 400) {
        const b = sdk.writeBatch(db);
        rows.slice(i, i + 400).forEach(r => b.set(D('apps', appId, coll, String(r.id)),
          { ...r, _by: this.name(), _device: deviceLabel(), _at: sdk.serverTimestamp() }));
        await b.commit();
        if (progress) progress(Math.min(i + 400, rows.length), rows.length);
      }
    },
    async removeMany(appId, coll, ids) {
      await need();
      for (let i = 0; i < ids.length; i += 400) {
        const b = sdk.writeBatch(db);
        ids.slice(i, i + 400).forEach(id => b.delete(D('apps', appId, coll, String(id))));
        await b.commit();
      }
    },
    /* Live changes to records whose numeric `ts` is after sinceMs.
       cb([{ type: 'added'|'modified'|'removed', id, data }]). Returns a stop function. */
    async watch(appId, coll, sinceMs, cb, onError) {
      await need();
      let first = true;
      return sdk.onSnapshot(sdk.query(sdk.collection(db, 'apps', appId, coll), sdk.where('ts', '>', sinceMs)), snap => {
        if (first) { first = false; return; }               // what was already there
        const ch = snap.docChanges().filter(c => !c.doc.metadata.hasPendingWrites)
          .map(c => ({ type: c.type, id: c.doc.id, data: c.doc.data() }));
        if (ch.length) cb(ch);
      }, e => { if (onError) onError(e); });
    },
    /* Change some fields of an existing record (keeps the rest). */
    async patch(appId, coll, id, fields) {
      await need();
      await sdk.updateDoc(D('apps', appId, coll, id), { ...fields, _at: sdk.serverTimestamp() });
    },
    /* Live updates of one record. cb(data | null). Returns a stop function. */
    async watchDoc(appId, coll, id, cb) {
      await need();
      return sdk.onSnapshot(D('apps', appId, coll, id), s => cb(s.exists() ? s.data() : null), () => {});
    },
    /* Asks for the person's own name + password again (e.g. before opening a sensitive tool).
       Checked by Firebase; offline it falls back to this device's saved check. */
    async checkPassword(name, password) {
      const s = session();
      if (!s) return { ok: false, message: 'Please log in first.' };
      if (slug(name) !== s.username) return { ok: false, message: `You are logged in as ${s.name}. Enter your own name, or log out first.` };
      if (!password) return { ok: false, message: 'Please enter your password.' };
      if (s.setup) return { ok: true };
      const offlineCheck = async () => (await sha256(SALT + s.username + ':' + password)) === localStorage.getItem(K.off + s.username)
        ? { ok: true, offline: true } : { ok: false, message: 'Wrong password (offline check).' };
      if (s.offline) return offlineCheck();
      try {
        await load();
        const email = s.role === 'admin' ? cfg().adminEmail : (await sdk.getDoc(D('accounts', s.username))).data().email;
        await sdk.reauthenticateWithCredential(auth.currentUser, sdk.EmailAuthProvider.credential(email, password));
        if (s.role === 'member') localStorage.setItem(K.off + s.username, await sha256(SALT + s.username + ':' + password));
        return { ok: true };
      } catch (e) {
        if (isNetwork(e) && s.role === 'member') return offlineCheck();
        if (/invalid|wrong|mismatch|not-found/.test(String(e.code))) return { ok: false, message: 'Wrong password.' };
        return { ok: false, message: friendly(e) };
      }
    },
    /* Direct access to the Firebase SDK + database, for tools that need queries the
       helpers above don't cover (e.g. the Powder Coating Tracker's live feeds). */
    async raw() { await need(); return { sdk, db }; },
    /* This browser's own id (the same for everyone who uses this phone/PC). */
    deviceId: () => localDeviceId(),
    /* This person's own member record (holds per-tool permissions such as mtUse / mtEdit). */
    async myMember() {
      await need();
      const s = session();
      if (s.role === 'admin') return { admin: true };
      const m = await sdk.getDoc(D('members', s.uid));
      return m.exists() ? m.data() : null;
    },
    /* Company-wide running number (1, 2, 3 …) for an app. */
    async nextNumber(appId) {
      await need();
      const ref = D('apps', appId, 'meta', 'counter');
      return sdk.runTransaction(db, async tx => {
        const snap = await tx.get(ref);
        const n = snap.exists() ? (snap.data().next || 1) : 1;
        tx.set(ref, { next: n + 1 });
        return n;
      });
    },

    /* ---- admin only ---- */
    admin: {
      async devices() {
        await need(true);
        const s = await sdk.getDocs(sdk.collection(db, 'devices'));
        return s.docs.map(d => ({ id: d.id, ...d.data() }));
      },
      async history(id) {
        await need(true);
        const q = sdk.query(sdk.collection(db, 'devices', id, 'logins'), sdk.orderBy('at', 'desc'), sdk.limit(50));
        const s = await sdk.getDocs(q);
        return s.docs.map(d => ({ id: d.id, ...d.data() }));
      },
      async setBlocked(id, blocked) { await need(true); await sdk.updateDoc(D('devices', id), { blocked }); },
      async removeDevice(id) { await need(true); await sdk.deleteDoc(D('devices', id)); },

      async people() {
        await need(true);
        const s = await sdk.getDocs(sdk.collection(db, 'accounts'));
        return s.docs.map(d => ({ id: d.id, ...d.data() }));
      },
      async addPerson(name, firstPassword) {
        await need(true);
        name = String(name || '').trim();
        const username = slug(name);
        if (!username) throw err('asa/bad', 'Please enter a name.');
        if (isAdminName(name)) throw err('asa/bad', 'That name is the admin username.');
        if ((await sdk.getDoc(D('accounts', username))).exists()) throw err('asa/exists', `“${name}” already has an account.`);
        const { email, uid } = await createLogin(username, firstPassword);
        await sdk.setDoc(D('members', uid), { username, name, disabled: false });
        await sdk.setDoc(D('accounts', username), { name, username, email, uid, disabled: false, mustChange: true, createdAt: sdk.serverTimestamp() });
        return username;
      },
      async setDisabled(username, disabled) {
        await need(true);
        const a = (await sdk.getDoc(D('accounts', username))).data();
        await sdk.updateDoc(D('members', a.uid), { disabled });
        await sdk.updateDoc(D('accounts', username), { disabled });
      },
      // Firebase can't set someone else's password from a web page, so a reset makes a
      // fresh login for the same username and retires the old one. Their data stays theirs
      // because records are owned by username.
      async resetPassword(username, firstPassword) {
        await need(true);
        const a = (await sdk.getDoc(D('accounts', username))).data();
        const { email, uid } = await createLogin(username, firstPassword);
        const old = (await sdk.getDoc(D('members', a.uid))).data() || {};
        await sdk.setDoc(D('members', uid), { username, name: a.name, disabled: !!a.disabled, status: old.status || 'active',
          tools: old.tools || {}, mtEdit: !!old.mtEdit });
        await sdk.updateDoc(D('members', a.uid), { disabled: true, retired: true }).catch(() => {});
        await sdk.updateDoc(D('accounts', username), { email, uid, mustChange: true, resetAt: sdk.serverTimestamp() });
      },
      /* Per-tool permissions, e.g. { mtUse: true, mtEdit: false }. Kept on the account
         (for the Admin page) and on the member record (which the cloud rules check). */
      async setPerms(username, perms) {
        await need(true);
        const a = (await sdk.getDoc(D('accounts', username))).data();
        const all = { ...(a.perms || {}), ...perms };
        await sdk.updateDoc(D('members', a.uid), perms);
        await sdk.updateDoc(D('accounts', username), { perms: all });
        return all;
      },
      /* Newest records of a log collection (e.g. material-tracker access / activity). */
      async recent(appId, coll, n) {
        await need(true);
        const s = await sdk.getDocs(sdk.query(sdk.collection(db, 'apps', appId, coll), sdk.orderBy('ts', 'desc'), sdk.limit(n || 100)));
        return s.docs.map(d => ({ id: d.id, ...d.data() }));
      },
      /* Approve a waiting sign-up with the tools ticked, or change someone's tools later. */
      async setAccess(username, tools, extra) {
        await need(true);
        const a = (await sdk.getDoc(D('accounts', username))).data();
        const fields = { status: 'active', tools: tools || {}, ...(extra || {}) };
        await sdk.updateDoc(D('members', a.uid), fields);
        await sdk.updateDoc(D('accounts', username), fields);
      },
      async reject(username) {
        await need(true);
        const a = (await sdk.getDoc(D('accounts', username))).data();
        await sdk.updateDoc(D('members', a.uid), { status: 'rejected', disabled: true });
        await sdk.deleteDoc(D('accounts', username));            // the name can be used again
      },
      async getCounter(appId) {
        await need(true);
        const s = await sdk.getDoc(D('apps', appId, 'meta', 'counter'));
        return s.exists() ? (s.data().next || 1) : 1;
      },
      async setCounter(appId, next) { await need(true); await sdk.setDoc(D('apps', appId, 'meta', 'counter'), { next: Math.max(1, parseInt(next, 10) || 1) }); },
    }
  };

  async function need(adminOnly) {
    const s = session();
    if (!s) throw err('asa/out', 'Please log in first.');
    if (adminOnly && s.role !== 'admin') throw err('asa/admin', 'Admin only.');
    if (s.setup) throw err('asa/setup', 'Cloud is not set up yet.');
    if (s.offline) throw err('asa/offline', 'You are offline — the cloud is not available right now.');
    if (!(await load())) throw err('asa/setup', 'Cloud is not set up yet.');
  }

  window.ASACloud = ASACloud;
})();
