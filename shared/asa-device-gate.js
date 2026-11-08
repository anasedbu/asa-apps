/* ============================================================================
   ASA tool gate — for tools that ask for the person's name + password again
   when they are opened (e.g. LPO Generator). Load after asa-gate.js:

     <script src="…/shared/asa-device-gate.js"></script>
     ASADeviceGate.open({ tool: 'lpo', prefix: 'lpo', title: 'LPO Generator' })
       .then(ctx => …)     // ctx = { cloud, vault, shared, admin }

   1. Asks for the person's own name + password (every time the tool opens).
   2. Logs the visit in apps/<tool>/access for the Admin page.
   3. Gives the tool its cloud folder: apps/<prefix>-data (+ a shared folder if any).
   Who may open a tool is the admin's per-person tick (asa-gate.js + cloud rules).
   ========================================================================== */
(function () {
  const C = window.ASACloud;
  const css = `
    #asaDev{position:fixed;inset:0;z-index:2147482500;background:#262262;color:#E2E2E2;display:flex;align-items:center;justify-content:center;
      padding:24px;font-family:'Barlow',system-ui,-apple-system,'Segoe UI',sans-serif;overflow:auto}
    #asaDev .d-box{width:100%;max-width:380px}
    #asaDev .d-card{background:#fff;color:#1b1946;border-radius:16px;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,.25)}
    #asaDev h1{font-family:'Bebas Neue','Arial Narrow',Impact,sans-serif;font-weight:400;font-size:30px;letter-spacing:.8px;color:#262262;margin:0 0 4px}
    #asaDev .d-tool{font-family:'Bebas Neue','Arial Narrow',Impact,sans-serif;font-size:22px;letter-spacing:.6px;margin-bottom:18px}
    #asaDev p{margin:0 0 14px;font-size:14px;color:#6b6a86;line-height:1.5}
    #asaDev label{display:block;font-size:13px;font-weight:600;margin:12px 0 5px}
    #asaDev input{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:12px 13px;border:1px solid #d3d3dc;border-radius:10px;outline:0}
    #asaDev input:focus{border-color:#262262;box-shadow:0 0 0 3px rgba(38,34,98,.12)}
    #asaDev button{width:100%;margin-top:18px;font:600 16px inherit;font-family:inherit;padding:13px;border-radius:10px;border:0;background:#262262;color:#fff;cursor:pointer}
    #asaDev button[disabled]{opacity:.6;cursor:wait}
    #asaDev .d-msg{min-height:18px;margin-top:12px;font-size:14px;color:#b42318}
    #asaDev .d-icon{font-size:40px;margin-bottom:6px}
    #asaDev .d-small{font-size:12.5px;color:#8a89a3}
    #asaDev a{color:#E2E2E2;font-size:14px;display:inline-block;margin-top:16px;opacity:.85}`;
  const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const home = (document.querySelector('script[src*="asa-device-gate.js"]') || {}).src
    ? new URL('../index.html', document.querySelector('script[src*="asa-device-gate.js"]').src).href : '../../index.html';

  function open(opt) {
    const { tool, prefix, title, shared, sharedPrefix } = opt;   // shared: a data folder used by more than one tool (e.g. customer list)
    const sharedOf = tok => (shared && tok) ? sharedPrefix + '-' + tok : '';
    const OK = 'asa_dev_ok:' + tool;
    return new Promise(resolve => {
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      const el = document.createElement('div'); el.id = 'asaDev';
      const show = html => {
        el.innerHTML = `<div class="d-box"><div class="d-tool">${esc(title)}</div><div class="d-card">${html}</div>
          <a href="${home}">&larr; ASA Home</a></div>`;
        if (!el.parentNode) document.body.appendChild(el);
      };
      const done = ctx => { el.remove(); resolve(ctx); };
      const screen = (icon, h, msg) => show(`<div class="d-icon">${icon}</div><h1>${esc(h)}</h1><p>${msg}</p>
        <p class="d-small">Device: ${esc(C.deviceLabel())} · ID ${esc(C.deviceId().slice(0, 8))}</p>`);

      // 1. name + password
      const login = () => {
        const s = C.session() || {};
        show(`<h1>Log in</h1><p>Enter your name and password to open the ${esc(title)}.</p>
          <form id="dForm" autocomplete="on">
            <label for="dUser">Name</label><input id="dUser" autocomplete="username" value="${esc(s.name || '')}">
            <label for="dPass">Password</label><input id="dPass" type="password" autocomplete="current-password">
            <button type="submit" id="dGo">Open</button>
            <div class="d-msg" id="dMsg"></div>
            ${s.setup ? '<p class="d-small" style="margin-top:8px">Setup mode — the password is checked once the cloud is connected.</p>' : ''}
          </form>`);
        el.querySelector(s.name ? '#dPass' : '#dUser').focus();
        el.querySelector('#dForm').onsubmit = async e => {
          e.preventDefault();
          const go = el.querySelector('#dGo'), msg = el.querySelector('#dMsg');
          go.disabled = true; go.textContent = 'Checking…'; msg.textContent = '';
          const r = await C.checkPassword(el.querySelector('#dUser').value, el.querySelector('#dPass').value);
          go.disabled = false; go.textContent = 'Open';
          if (!r.ok) { msg.textContent = r.message; el.querySelector('#dPass').select(); return; }
          device();
        };
      };

      // 2. open the tool (access was already checked: the admin's tick for this person)
      const device = async () => {
        const s = C.session();
        const mode = !C.configured() || s.setup ? 'local' : s.offline ? 'offline' : 'cloud';
        if (mode !== 'cloud') return done({ cloud: false, vault: '', shared: '', admin: s.role === 'admin' });
        try { await C.add(tool, 'access', { device: C.deviceLabel(), devId: C.deviceId() }); } catch (e) {}
        done({ cloud: true, vault: prefix + '-data', shared: shared ? sharedPrefix + '-data' : '', admin: s.role === 'admin' });
      };

      (window.ASAGate ? ASAGate.ready : Promise.resolve()).then(() => {
        if (document.body) login(); else document.addEventListener('DOMContentLoaded', login);
      });
    });
  }

  window.ASADeviceGate = { open };
})();
