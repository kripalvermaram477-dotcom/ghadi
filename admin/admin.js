const API = '/admin-api';
let token = localStorage.getItem('ghadi_admin_token');
const $ = (s) => document.querySelector(s);
const app = () => $('#app');

function setToken(t) { token = t; localStorage.setItem('ghadi_admin_token', t); }
function clearToken() { token = null; localStorage.removeItem('ghadi_admin_token'); }

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.code && data.code !== 0)) throw new Error(data.info || 'Request failed');
  return data.data;
}

function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function fmt(n) { return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

let currentView = 'dashboard';

function layout(content) {
  app().innerHTML = `
    <div class="sidebar">
      <h2>GHADI Admin</h2>
      <a data-view="dashboard" class="${currentView==='dashboard'?'active':''}"><i class="fa-solid fa-chart-line" style="margin-right:8px"></i>Dashboard</a>
      <a data-view="plans" class="${currentView==='plans'?'active':''}"><i class="fa-solid fa-layer-group" style="margin-right:8px"></i>Plans</a>
      <a data-view="users" class="${currentView==='users'?'active':''}"><i class="fa-solid fa-users" style="margin-right:8px"></i>Users</a>
      <a data-view="withdrawals" class="${currentView==='withdrawals'?'active':''}"><i class="fa-solid fa-money-bill-transfer" style="margin-right:8px"></i>Withdrawals</a>
      <a data-view="recharges" class="${currentView==='recharges'?'active':''}"><i class="fa-solid fa-money-bill" style="margin-right:8px"></i>Recharges</a>
      <a data-view="notices" class="${currentView==='notices'?'active':''}"><i class="fa-solid fa-bell" style="margin-right:8px"></i>Notices</a>
      <a data-view="config" class="${currentView==='config'?'active':''}"><i class="fa-solid fa-gear" style="margin-right:8px"></i>Settings</a>
      <a id="logoutBtn" style="margin-top:20px"><i class="fa-solid fa-right-from-bracket" style="margin-right:8px"></i>Logout</a>
    </div>
    <div class="main">${content}</div>
    <div class="toast"></div>
  `;
  document.querySelectorAll('.sidebar a[data-view]').forEach(a => {
    a.onclick = () => { currentView = a.dataset.view; render(); };
  });
  $('#logoutBtn').onclick = () => { clearToken(); renderLogin(); };
}

function renderLogin() {
  app().innerHTML = `
    <div class="login-wrap">
      <div class="login-box">
        <h2 style="margin-bottom:16px;color:var(--primary)">GHADI Admin</h2>
        <input class="input" id="tel" placeholder="Admin phone" />
        <input class="input" id="pwd" type="password" placeholder="Password" />
        <button class="btn btn-primary" style="width:100%" id="loginBtn">Login</button>
      </div>
    </div>
  `;
  $('#loginBtn').onclick = async () => {
    try {
      const d = await api('/login', { method: 'POST', body: JSON.stringify({ tel: $('#tel').value, pwd: $('#pwd').value }) });
      setToken(d.token);
      render();
    } catch (e) { alert(e.message); }
  };
}

async function render() {
  if (!token) { renderLogin(); return; }
  // verify by calling stats
  try {
    if (currentView === 'dashboard') await renderDashboard();
    else if (currentView === 'plans') await renderPlans();
    else if (currentView === 'users') await renderUsers();
    else if (currentView === 'withdrawals') await renderWithdrawals();
    else if (currentView === 'recharges') await renderRecharges();
    else if (currentView === 'notices') await renderNotices();
    else if (currentView === 'config') await renderConfig();
  } catch (e) {
    if (e.message.includes('Unauthorized') || e.message.includes('Forbidden')) { clearToken(); renderLogin(); }
    else { toast(e.message); }
  }
}

async function renderDashboard() {
  const d = await api('/stats');
  const s = d;
  layout(`
    <div class="topbar"><h2>Dashboard</h2><button class="btn btn-outline" id="payoutBtn">Run Daily Payout</button></div>
    <div class="grid">
      <div class="stat"><div class="v">${s.users}</div><div class="l">Users</div></div>
      <div class="stat"><div class="v">${s.plans}</div><div class="l">Plans</div></div>
      <div class="stat"><div class="v">${s.orders}</div><div class="l">Orders</div></div>
      <div class="stat"><div class="v">${s.activeOrders}</div><div class="l">Active Orders</div></div>
      <div class="stat"><div class="v">${s.pendingWd}</div><div class="l">Pending Withdrawals</div></div>
      <div class="stat"><div class="v">${fmt(s.totalBalance)}</div><div class="l">Total User Balance</div></div>
    </div>
  `);
  $('#payoutBtn').onclick = async () => {
    try { const r = await api('/payout/run', { method: 'POST' }); toast(`Payout done: ${r.credited} credited`); render(); } catch (e) { toast(e.message); }
  };
}

async function renderPlans() {
  const d = await api('/plans');
  const plans = d.plans || [];
  layout(`
    <div class="topbar"><h2>Plans</h2><button class="btn btn-primary" id="addPlanBtn">+ Add Plan</button></div>
    <div class="card">
      <table>
        <thead><tr><th>ID</th><th>Name</th><th>Price</th><th>Daily</th><th>Days</th><th>Active</th><th>Actions</th></tr></thead>
        <tbody>
          ${plans.map(p => `
            <tr>
              <td>${p.id}</td>
              <td>${p.name}</td>
              <td>${fmt(p.price)}</td>
              <td>${fmt(p.daily_profit)}</td>
              <td>${p.duration_days}</td>
              <td>${p.active ? 'Yes' : 'No'}</td>
              <td>
                <button class="btn btn-outline" data-edit="${p.id}">Edit</button>
                <button class="btn btn-danger" data-del="${p.id}">Del</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `);
  $('#addPlanBtn').onclick = () => openPlanModal();
  document.querySelectorAll('[data-edit]').forEach(b => {
    b.onclick = () => {
      const p = plans.find(x => x.id == b.dataset.edit);
      openPlanModal(p);
    };
  });
  document.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!confirm('Delete plan?')) return;
      try { await api('/plans/' + b.dataset.del, { method: 'DELETE' }); toast('Deleted'); renderPlans(); } catch (e) { toast(e.message); }
    };
  });
}

function openPlanModal(plan = null) {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal">
      <h3 style="margin-bottom:12px">${plan ? 'Edit Plan' : 'Add Plan'}</h3>
      <input class="input" id="m_name" placeholder="Name" value="${plan?.name || ''}" />
      <input class="input" id="m_price" type="number" placeholder="Price" value="${plan?.price || ''}" />
      <input class="input" id="m_daily" type="number" placeholder="Daily profit" value="${plan?.daily_profit || ''}" />
      <input class="input" id="m_days" type="number" placeholder="Duration days" value="${plan?.duration_days || ''}" />
      <input class="input" id="m_desc" placeholder="Description" value="${plan?.description || ''}" />
      <input class="input" id="m_img" placeholder="Image URL" value="${plan?.image_url || ''}" />
      <input class="input" id="m_sort" type="number" placeholder="Sort order" value="${plan?.sort_order || 0}" />
      <label style="font-size:13px;display:flex;align-items:center;gap:6px;margin-bottom:10px"><input type="checkbox" id="m_active" ${plan?.active ? 'checked' : 'checked'} /> Active</label>
      <div class="row">
        <button class="btn btn-primary" id="m_save">Save</button>
        <button class="btn btn-outline" id="m_cancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  $('#m_cancel').onclick = () => modal.remove();
  $('#m_save').onclick = async () => {
    const body = {
      name: $('#m_name').value,
      price: $('#m_price').value,
      daily_profit: $('#m_daily').value,
      duration_days: $('#m_days').value,
      description: $('#m_desc').value,
      image_url: $('#m_img').value,
      sort_order: $('#m_sort').value,
      active: $('#m_active').checked,
    };
    try {
      if (plan) await api('/plans/' + plan.id, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/plans', { method: 'POST', body: JSON.stringify(body) });
      toast('Saved');
      modal.remove();
      renderPlans();
    } catch (e) { toast(e.message); }
  };
}

async function renderUsers() {
  const d = await api('/users');
  const users = d.users || [];
  layout(`
    <div class="topbar"><h2>Users</h2></div>
    <div class="card">
      <table>
        <thead><tr><th>ID</th><th>Phone</th><th>Balance</th><th>Role</th><th>Actions</th></tr></thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td>${u.id}</td>
              <td>${u.phone}</td>
              <td>${fmt(u.balance)}</td>
              <td>${u.role}</td>
              <td><button class="btn btn-primary" data-adj="${u.id}">Add Money</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `);
  document.querySelectorAll('[data-adj]').forEach(b => {
    b.onclick = async () => {
      const amt = prompt('Enter amount to add to this user (use negative to deduct):');
      if (amt === null || amt === '') return;
      const note = prompt('Note (optional):') || 'Admin deposit';
      try { await api('/users/' + b.dataset.adj + '/balance', { method: 'POST', body: JSON.stringify({ amount: Number(amt), note }) }); toast('Updated'); renderUsers(); } catch (e) { toast(e.message); }
    };
  });
}

async function renderWithdrawals() {
  const d = await api('/withdrawals');
  const list = d.withdrawals || [];
  layout(`
    <div class="topbar"><h2>Withdrawals</h2></div>
    <div class="card">
      <table>
        <thead><tr><th>ID</th><th>User</th><th>Amount</th><th>Net</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${list.map(w => `
            <tr>
              <td>${w.id}</td>
              <td>${w.phone || w.user_id}</td>
              <td>${fmt(w.amount)}</td>
              <td>${fmt(w.net)}</td>
              <td>${w.status}</td>
              <td>
                ${w.status === 'pending' ? `<button class="btn btn-success" data-ap="${w.id}">Approve</button> <button class="btn btn-danger" data-rj="${w.id}">Reject</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `);
  document.querySelectorAll('[data-ap]').forEach(b => {
    b.onclick = async () => { try { await api('/withdrawals/' + b.dataset.ap + '/approve', { method: 'POST' }); toast('Approved'); renderWithdrawals(); } catch (e) { toast(e.message); } };
  });
  document.querySelectorAll('[data-rj]').forEach(b => {
    b.onclick = async () => { if (!confirm('Reject & refund?')) return; try { await api('/withdrawals/' + b.dataset.rj + '/reject', { method: 'POST' }); toast('Rejected'); renderWithdrawals(); } catch (e) { toast(e.message); } };
  });
}

async function renderRecharges() {
  const d = await api('/recharges');
  const list = d.recharges || [];
  layout(`
    <div class="topbar"><h2>Manual Recharges</h2></div>
    <div class="card">
      <table>
        <thead><tr><th>ID</th><th>User</th><th>Amount</th><th>UTR</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${list.map(r => `
            <tr>
              <td>${r.id}</td>
              <td>${r.phone || r.user_id}</td>
              <td>${fmt(r.amount)}</td>
              <td>${r.utr || '-'}</td>
              <td>${r.status}</td>
              <td>
                ${r.status === 'pending' ? `<button class="btn btn-success" data-ap="${r.id}">Approve</button> <button class="btn btn-danger" data-rj="${r.id}">Reject</button>` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `);
  document.querySelectorAll('[data-ap]').forEach(b => {
    b.onclick = async () => { try { await api('/recharges/' + b.dataset.ap + '/approve', { method: 'POST' }); toast('Approved'); renderRecharges(); } catch (e) { toast(e.message); } };
  });
  document.querySelectorAll('[data-rj]').forEach(b => {
    b.onclick = async () => { if (!confirm('Reject?')) return; try { await api('/recharges/' + b.dataset.rj + '/reject', { method: 'POST' }); toast('Rejected'); renderRecharges(); } catch (e) { toast(e.message); } };
  });
}

async function renderNotices() {
  const d = await api('/notices');
  const list = d.notices || [];
  layout(`
    <div class="topbar"><h2>Notices</h2><button class="btn btn-primary" id="addNotice">+ Add</button></div>
    <div class="card">
      <table>
        <thead><tr><th>ID</th><th>Title</th><th>Body</th><th>Actions</th></tr></thead>
        <tbody>
          ${list.map(n => `
            <tr><td>${n.id}</td><td>${n.title}</td><td>${n.body}</td><td><button class="btn btn-danger" data-del="${n.id}">Del</button></td></tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `);
  $('#addNotice').onclick = async () => {
    const title = prompt('Title:'); if (!title) return;
    const body = prompt('Body:'); if (!body) return;
    try { await api('/notices', { method: 'POST', body: JSON.stringify({ title, body }) }); toast('Added'); renderNotices(); } catch (e) { toast(e.message); }
  };
  document.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => { if (!confirm('Delete?')) return; try { await api('/notices/' + b.dataset.del, { method: 'DELETE' }); toast('Deleted'); renderNotices(); } catch (e) { toast(e.message); } };
  });
}

const COLOR_KEYS = ['theme_primary', 'theme_accent', 'theme_bg'];
const APPEARANCE_KEYS = ['site_name', 'theme_primary', 'theme_accent', 'theme_bg', 'bg_image', 'bg_overlay'];
const PRESETS = [
  { name: 'Midnight', primary: '#1e1b4b', accent: '#f59e0b', bg: '#f1f5f9' },
  { name: 'Ocean', primary: '#0f766e', accent: '#06b6d4', bg: '#ecfeff' },
  { name: 'Royal', primary: '#4c1d95', accent: '#ec4899', bg: '#faf5ff' },
  { name: 'Dark', primary: '#0f172a', accent: '#fbbf24', bg: '#0f172a' },
  { name: 'Forest', primary: '#166534', accent: '#ca8a04', bg: '#f0fdf4' },
  { name: 'Rose', primary: '#9f1239', accent: '#f43f5e', bg: '#fff1f2' },
];

function cfgField(k, v) {
  if (COLOR_KEYS.includes(k)) {
    return `<div class="row" style="align-items:center;margin-bottom:10px">
      <input type="color" class="input" data-cfg="${k}" value="${v || '#000000'}" style="width:60px;height:40px;padding:2px;margin:0" />
      <div style="flex:1"><label style="font-size:12px;color:var(--muted)">${k}</label>
      <input class="input" data-cfg="${k}" value="${v || ''}" style="margin:0" /></div>
    </div>`;
  }
  if (/token|secret|password/i.test(k)) {
    return `<label style="font-size:12px;color:var(--muted)">${k}</label>
    <input class="input" type="password" autocomplete="new-password" data-cfg="${k}" value="${v ?? ''}" />`;
  }
  return `<label style="font-size:12px;color:var(--muted)">${k}</label>
    <input class="input" data-cfg="${k}" value="${v ?? ''}" />`;
}

async function renderConfig() {
  const d = await api('/config');
  const c = d.config || {};
  const bg = c.bg_image || '';
  layout(`
    <div class="topbar"><h2>Settings</h2></div>
    <div class="card">
      <h3 style="margin-bottom:12px;color:var(--primary)">Appearance</h3>
      <div class="row" style="margin-bottom:14px">
        ${PRESETS.map(p => `<button class="btn btn-outline" data-preset='${JSON.stringify(p)}'>${p.name}</button>`).join('')}
      </div>
      ${APPEARANCE_KEYS.map(k => cfgField(k, c[k])).join('')}
      <div style="margin-top:10px;border-radius:10px;overflow:hidden;border:1px solid var(--border)">
        <div style="height:120px;background:${bg ? `url('${bg}') center/cover` : 'linear-gradient(135deg,#1e1b4b,#312e81)'};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700">Background Preview</div>
      </div>
      <button class="btn btn-primary" id="saveCfg" style="margin-top:14px">Save Appearance</button>
    </div>
    <div class="card">
      <h3 style="margin-bottom:12px;color:var(--primary)">Other Settings</h3>
      <p style="font-size:12px;color:var(--muted);margin-bottom:10px">
        RupayEx: paste your API token in <b>rupayex_token</b>, set <b>rupayex_enabled</b> to 1,
        and leave <b>rupayex_base</b> as https://rupayex.net. Then users can pay by UPI/Card
        from the wallet and the balance is credited automatically after verification.
      </p>
      ${Object.keys(c).filter(k => !APPEARANCE_KEYS.includes(k)).map(k => cfgField(k, c[k])).join('')}
      <button class="btn btn-primary" id="saveOther">Save Settings</button>
    </div>
  `);
  document.querySelectorAll('[data-preset]').forEach(b => {
    b.onclick = () => {
      const p = JSON.parse(b.dataset.preset);
      document.querySelectorAll('[data-cfg="theme_primary"]').forEach(i => i.value = p.primary);
      document.querySelectorAll('[data-cfg="theme_accent"]').forEach(i => i.value = p.accent);
      document.querySelectorAll('[data-cfg="theme_bg"]').forEach(i => i.value = p.bg);
      toast('Preset applied — click Save');
    };
  });
  $('#saveCfg').onclick = async () => {
    const body = {};
    document.querySelectorAll('[data-cfg]').forEach(i => { body[i.dataset.cfg] = i.value; });
    try { await api('/config', { method: 'POST', body: JSON.stringify(body) }); toast('Appearance saved'); } catch (e) { toast(e.message); }
  };
  $('#saveOther').onclick = async () => {
    const body = {};
    document.querySelectorAll('[data-cfg]').forEach(i => { body[i.dataset.cfg] = i.value; });
    try { await api('/config', { method: 'POST', body: JSON.stringify(body) }); toast('Settings saved'); } catch (e) { toast(e.message); }
  };
}

render();
