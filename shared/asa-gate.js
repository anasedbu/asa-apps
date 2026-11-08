/* ============================================================================
   ASA login screen — include in the <head> of every ASA page, after
   asa-config.js and asa-cloud.js:

     <script src="…/shared/asa-gate.js" data-app="tax-invoice"></script>

   Hides the page until the person logs in (username + password). A login lasts
   for the browser session, so each new visit asks again.
   - New people use "Sign up"; their account waits until the admin approves it.
   - The admin ticks which tools each person may use. A page whose data-app is a
     tool the person doesn't have shows a "No access" screen instead.
   Pages can wait for the login:   ASAGate.ready.then(session => …)
   Options on the script tag: data-app="id"  data-chip="off" (no name badge).
   ========================================================================== */
(function () {
  const me = document.currentScript;
  const APP = (me && me.dataset.app) || '';
  const CHIP = !(me && me.dataset.chip === 'off');
  const base = me ? new URL('..', me.src).href : '../';
  const C = window.ASACloud;
  const ADMIN = (window.ASA_CONFIG || {}).adminUser || 'Anas';

  let resolveReady;
  const ready = new Promise(r => resolveReady = r);
  window.ASAGate = { ready, logout };

  // Setup mode (no password checks) is allowed only on this computer, never on the live website.
  const LOCAL = location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const SETUP_OK = !C.configured() && LOCAL;
  // A "setup mode" pass stops working as soon as the cloud is connected.
  let s = C.session();
  if (s && (s.role === 'setup' || s.setup) && (C.configured() || !LOCAL)) { sessionStorage.removeItem('asa:session'); s = null; }

  const css = `
    html.asa-locked body > *:not(#asaGate){display:none!important}
    #asaGate{position:fixed;inset:0;z-index:2147483000;background:#262262;color:#E2E2E2;display:flex;align-items:center;justify-content:center;
      padding:24px;font-family:'Barlow',system-ui,-apple-system,'Segoe UI',sans-serif;overflow:auto}
    #asaGate .g-box{width:100%;max-width:380px}
    #asaGate .g-brand{display:flex;align-items:center;gap:14px;margin-bottom:26px}
    #asaGate .g-brand img{height:56px;filter:invert(.89)}
    #asaGate .g-brand div{font-family:'Bebas Neue','Arial Narrow',Impact,sans-serif;font-size:24px;line-height:1.02;letter-spacing:.6px}
    #asaGate form,#asaGate .g-card{background:#fff;color:#1b1946;border-radius:16px;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,.25)}
    #asaGate h1{font-family:'Bebas Neue','Arial Narrow',Impact,sans-serif;font-weight:400;font-size:30px;letter-spacing:.8px;color:#262262;margin:0 0 4px}
    #asaGate p{margin:0 0 16px;font-size:14px;color:#6b6a86;line-height:1.5}
    #asaGate label{display:block;font-size:13px;font-weight:600;margin:12px 0 5px}
    #asaGate input{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:12px 13px;border:1px solid #d3d3dc;border-radius:10px;outline:0}
    #asaGate input:focus{border-color:#262262;box-shadow:0 0 0 3px rgba(38,34,98,.12)}
    #asaGate button{width:100%;margin-top:18px;font:600 16px inherit;font-family:inherit;padding:13px;border-radius:10px;border:0;background:#262262;color:#fff;cursor:pointer}
    #asaGate button[disabled]{opacity:.6;cursor:wait}
    #asaGate button.g-alt{background:#E2E2E2;color:#262262;margin-top:10px}
    #asaGate .g-tabs{display:flex;gap:6px;margin-bottom:14px;background:#efeff4;border-radius:10px;padding:4px}
    #asaGate .g-tabs button{margin:0;padding:9px;font-size:14px;background:transparent;color:#6b6a86}
    #asaGate .g-tabs button.on{background:#fff;color:#262262;box-shadow:0 1px 3px rgba(0,0,0,.12)}
    #asaGate .g-msg{min-height:18px;margin-top:12px;font-size:14px;color:#b42318}
    #asaGate .g-note{background:#fff6e0;color:#7a5200;border-radius:8px;padding:10px 12px;font-size:13px;margin-top:14px}
    #asaGate .g-icon{font-size:40px;margin-bottom:6px}
    #asaGate a{color:#E2E2E2;font-size:14px;display:inline-block;margin-top:16px;opacity:.85}
    #asaChip{position:fixed;left:12px;bottom:12px;z-index:2147482000;background:#262262;color:#E2E2E2;font:500 12.5px 'Barlow',system-ui,sans-serif;
      border-radius:999px;padding:6px 6px 6px 12px;display:flex;align-items:center;gap:8px;box-shadow:0 4px 14px rgba(0,0,0,.18)}
    #asaChip button{font:600 12px inherit;font-family:inherit;border:0;border-radius:999px;padding:4px 10px;background:#E2E2E2;color:#262262;cursor:pointer}
    @media print{#asaChip,#asaGate{display:none!important}}`;
  const st = document.createElement('style'); st.textContent = css;
  document.head.appendChild(st);

  function whenBody(fn) { document.body ? fn() : document.addEventListener('DOMContentLoaded', fn); }
  const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const brand = `<div class="g-brand"><img src="${base}assets/asa-mark.svg" alt="ASA"><div>Al Sahlawi<br>Aluminum L.L.C</div></div>`;

  let g = null;
  function screen(inner, extra) {
    if (!g) { g = document.createElement('div'); g.id = 'asaGate'; document.body.appendChild(g); }
    g.innerHTML = `<div class="g-box">${brand}${inner}${extra || ''}</div>`;
    return g;
  }
  function message(icon, title, text, withHome) {
    document.documentElement.classList.add('asa-locked');
    whenBody(() => screen(`<div class="g-card"><div class="g-icon">${icon}</div><h1>${esc(title)}</h1><p>${text}</p>
      <button type="button" class="g-alt" id="gOut">Log out</button></div>`,
      withHome ? `<a href="${base}index.html">&larr; ASA Home</a>` : ''));
    whenBody(() => { const b = document.getElementById('gOut'); if (b) b.onclick = logout; });
  }

  if (s) unlocked(s); else { document.documentElement.classList.add('asa-locked'); whenBody(showGate); }

  function showGate() {
    const configured = C.configured();
    if (!configured && !SETUP_OK) {
      screen(`<div class="g-card"><h1>Almost ready</h1><p>ASA Apps is being connected to its secure cloud. Logging in opens as soon as that is finished.</p></div>`);
      return;
    }
    let mode = 'in';
    const draw = () => {
      screen(`<form autocomplete="on">
          ${configured ? `<div class="g-tabs"><button type="button" data-m="in" class="${mode === 'in' ? 'on' : ''}">Log in</button>
            <button type="button" data-m="up" class="${mode === 'up' ? 'on' : ''}">Sign up</button></div>` : ''}
          <h1>${mode === 'in' ? 'Log in' : 'Create your account'}</h1>
          <p>${mode === 'in' ? 'ASA team only. Your username is your name.'
              : 'Use your own name as the username and choose a password. The admin will then give you access.'}</p>
          <label for="gUser">${mode === 'in' ? 'Username' : 'Your name'}</label>
          <input id="gUser" name="username" autocomplete="username" value="${esc(mode === 'in' ? C.lastName() : '')}" placeholder="e.g. Ahmed Khan">
          <label for="gPass">Password</label>
          <input id="gPass" name="password" type="password" autocomplete="${mode === 'in' ? 'current-password' : 'new-password'}">
          ${mode === 'up' ? `<label for="gPass2">Type the password again</label><input id="gPass2" type="password" autocomplete="new-password">` : ''}
          <button type="submit" id="gGo">${mode === 'in' ? 'Log in' : 'Create account'}</button>
          ${configured ? '' : `<div class="g-note">Setup mode (this computer only): passwords are checked once the cloud setup is finished. Type your name (or <b>${esc(ADMIN)}</b> for admin) and log in.</div>`}
          <div class="g-msg" id="gMsg"></div>
        </form>`);
      const user = g.querySelector('#gUser'), pass = g.querySelector('#gPass'), go = g.querySelector('#gGo'), msg = g.querySelector('#gMsg');
      (user.value ? pass : user).focus();
      g.querySelectorAll('.g-tabs button').forEach(b => b.onclick = () => { mode = b.dataset.m; draw(); });
      g.querySelector('form').onsubmit = async e => {
        e.preventDefault();
        if (!configured) return enterSetupMode(user.value, msg, user);
        if (mode === 'up' && pass.value !== g.querySelector('#gPass2').value) { msg.textContent = "The two passwords don't match."; return; }
        go.disabled = true; msg.textContent = ''; go.textContent = mode === 'in' ? 'Checking…' : 'Creating…';
        const r = mode === 'in' ? await C.login(user.value, pass.value, APP) : await C.signUp(user.value, pass.value);
        go.disabled = false; go.textContent = mode === 'in' ? 'Log in' : 'Create account';
        if (!r.ok) { msg.textContent = r.message; pass.select(); return; }
        if (r.pending) return waiting(r.name);
        if (r.mustChange) return askNewPassword(r.name);
        done();
      };
    };
    draw();
  }

  // A new account waits here; the page opens by itself once the admin approves it.
  async function waiting(name) {
    screen(`<div class="g-card"><div class="g-icon">⏳</div><h1>Waiting for the admin</h1>
      <p>Thanks, ${esc(name)}. Your account has been sent to the admin for approval. This page opens by itself as soon as you are given access.</p>
      <button type="button" class="g-alt" id="gOut">Log out</button></div>`);
    g.querySelector('#gOut').onclick = logout;
    await C.waitForApproval(APP, (state, info) => {
      if (state === 'active') done();
      else if (state === 'rejected') message('⛔', 'Not approved', 'The admin has not approved this account.');
      else message('⚠️', 'Something went wrong', esc(info || 'Please try logging in again.'));
    });
  }

  // After a password reset by the admin: the person chooses their own new password.
  function askNewPassword(name) {
    screen(`<form>
        <h1>Choose a new password</h1>
        <p>Welcome back, ${esc(name)}. The admin gave you a temporary password — please choose your own now. Only you will know it.</p>
        <label for="gNew1">New password</label><input id="gNew1" type="password" autocomplete="new-password" minlength="6">
        <label for="gNew2">Type it again</label><input id="gNew2" type="password" autocomplete="new-password">
        <button type="submit" id="gSet">Save password</button>
        <div class="g-msg" id="gMsg2"></div>
      </form>`);
    const n1 = g.querySelector('#gNew1'), n2 = g.querySelector('#gNew2'), b = g.querySelector('#gSet'), m2 = g.querySelector('#gMsg2');
    n1.focus();
    g.querySelector('form').onsubmit = async ev => {
      ev.preventDefault();
      if (n1.value !== n2.value) { m2.textContent = "The two passwords don't match."; return; }
      b.disabled = true; b.textContent = 'Saving…';
      const r2 = await C.changePassword(n1.value);
      b.disabled = false; b.textContent = 'Save password';
      if (!r2.ok) { m2.textContent = r2.message; return; }
      done();
    };
  }

  // Before the cloud exists nothing can be checked and there is no cloud data to protect
  // (this computer only). The admin username opens the admin views.
  function enterSetupMode(raw, msg, user) {
    const name = String(raw || '').trim();
    if (!name) { msg.textContent = 'Please enter your username.'; user.focus(); return; }
    const admin = C.slug(name) === C.slug(ADMIN);
    const nm = admin ? ADMIN : name;
    sessionStorage.setItem('asa:session', JSON.stringify({ role: admin ? 'admin' : 'member', setup: true,
      name: nm, username: C.slug(nm), at: Date.now() }));
    done();
  }

  function done() {
    if (g) { g.remove(); g = null; }
    unlocked(C.session(), true);
  }

  function unlocked(sess, fresh) {
    // A tool this person hasn't been given: show "No access" instead of the page.
    if (APP && !C.hasTool(APP)) {
      message('🔒', APP === 'admin' ? 'Admin only' : 'No access',
        APP === 'admin' ? 'This page is for the admin.' : 'The admin hasn\'t given you access to this tool yet. Ask the admin if you need it.', true);
      if (!fresh && !sess.setup) C.verify(APP).then(ok => { if (!ok || C.hasTool(APP)) location.reload(); });
      return;
    }
    document.documentElement.classList.remove('asa-locked');
    if (CHIP) whenBody(() => {
      const c = document.createElement('div'); c.id = 'asaChip'; c.className = 'no-print';
      c.innerHTML = `<span>${esc(sess.name)}${sess.role === 'admin' ? ' · Admin' : ''}${sess.offline ? ' · offline' : ''}${sess.setup ? ' · setup mode' : ''}</span><button type="button">Log out</button>`;
      c.querySelector('button').onclick = logout;
      document.body.appendChild(c);
    });
    resolveReady(sess);
    // Re-check with the cloud in the background (account turned off, access changed, device blocked).
    if (!fresh && !sess.setup) C.verify(APP).then(ok => { if (!ok || (APP && !C.hasTool(APP))) location.reload(); });
  }

  async function logout() {
    await C.logout();
    location.reload();
  }
})();
