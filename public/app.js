const API = '/api';
let token = localStorage.getItem('ghadi_token');
let user = JSON.parse(localStorage.getItem('ghadi_user') || 'null');

const $ = (s) => document.querySelector(s);
const app = () => $('#app');

function setAuth(t, u) { token = t; user = u; localStorage.setItem('ghadi_token', t); localStorage.setItem('ghadi_user', JSON.stringify(u)); }
function clearAuth() { token = null; user = null; localStorage.removeItem('ghadi_token'); localStorage.removeItem('ghadi_user'); }

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.code && data.code !== 0)) {
    throw new Error(data.info || 'Request failed');
  }
  return data.data;
}

function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function fmt(n) { return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ---------- Router ----------
const routes = {};
function route(hash, fn) { routes[hash] = fn; }
function navigate(h) { location.hash = h; }
function currentRoute() { return (location.hash || '#/home').replace(/^#/, '').split('?')[0]; }
function currentQuery() { const h = (location.hash || '').split('?')[1]; return new URLSearchParams(h || location.search); }

function matchRoute(path) {
  // exact
  if (routes[path]) return { fn: routes[path], params: {} };
  // param patterns
  for (const key of Object.keys(routes)) {
    if (!key.includes(':')) continue;
    const regex = new RegExp('^' + key.replace(/:[^/]+/g, '([^/]+)') + '$');
    const m = path.match(regex);
    if (m) {
      const paramNames = (key.match(/:[^/]+/g) || []).map((p) => p.slice(1));
      const params = {};
      paramNames.forEach((n, i) => params[n] = m[i + 1]);
      return { fn: routes[key], params };
    }
  }
  return null;
}

async function render() {
  const path = currentRoute();
  if (!token && !['/login', '/register'].includes(path)) { navigate('/login'); return; }
  if (token && (path === '/login' || path === '/register')) { navigate('/home'); return; }
  const m = matchRoute(path);
  if (!m) { app().innerHTML = '<div class="page"><div class="empty">Page not found</div></div>'; return; }
  app().innerHTML = '<div class="page"><div class="spinner"></div></div>';
  try { await m.fn(m.params); } catch (e) { console.error(e); app().innerHTML = `<div class="page"><div class="empty">${e.message}</div></div>`; }
}

window.addEventListener('hashchange', render);

// ---------- Layout helpers ----------
function layout(title, content, showNav = true) {
  document.body.classList.toggle('auth-mode', !showNav);
  const nav = showNav && user ? `
    <nav class="bottom-nav">
      <a href="#/home" class="${currentRoute()==='/home'?'active':''}"><i class="fa-solid fa-house"></i>Home</a>
      <a href="#/plans" class="${currentRoute().startsWith('/plan')?'active':''}"><i class="fa-solid fa-layer-group"></i>Plans</a>
      <a href="#/wallet" class="${currentRoute()==='/wallet'?'active':''}"><i class="fa-solid fa-wallet"></i>Wallet</a>
      <a href="#/team" class="${currentRoute()==='/team'?'active':''}"><i class="fa-solid fa-users"></i>Team</a>
      <a href="#/my" class="${['/my','/orders','/records','/bank','/settings','/notices'].includes(currentRoute())?'active':''}"><i class="fa-solid fa-user"></i>My</a>
    </nav>` : '';
  app().innerHTML = `
    <header class="appbar">
      <button class="back" onclick="history.back()"><i class="fa-solid fa-arrow-left"></i></button>
      <h1>${title}</h1>
      <div style="width:34px"></div>
    </header>
    <div class="page">${content}</div>
    ${nav}
  `;
}

// ---------- Auth pages ----------
route('/login', async () => {
  layout('Login', `
    <div class="card">
      <div class="card-title">Welcome to GHADI</div>
      <input class="input" id="tel" placeholder="Mobile number" />
      <input class="input" id="pwd" type="password" placeholder="Password" />
      <button class="btn btn-primary" id="loginBtn">Login</button>
      <p style="text-align:center;margin-top:12px;font-size:13px;color:var(--muted)">No account? <a href="#/register" style="color:var(--primary);font-weight:600">Register</a></p>
    </div>
  `, false);
  $('#loginBtn').onclick = async () => {
    try {
      const d = await api('/auth/login', { method: 'POST', body: JSON.stringify({ tel: $('#tel').value, pwd: $('#pwd').value }) });
      setAuth(d.token, d.user);
      toast('Logged in');
      navigate('/home');
    } catch (e) { toast(e.message); }
  };
});

route('/register', async () => {
  layout('Register', `
    <div class="card">
      <div class="card-title">Create Account</div>
      <input class="input" id="tel" placeholder="Mobile number" />
      <input class="input" id="pwd" type="password" placeholder="Password" />
      <input class="input" id="pwd2" type="password" placeholder="Confirm password" />
      <input class="input" id="depwd" type="password" placeholder="Withdraw password" />
      <input class="input" id="invite" placeholder="Invite code (optional)" value="${currentQuery().get('invite') || ''}" />
      <button class="btn btn-primary" id="regBtn">Register</button>
      <p style="text-align:center;margin-top:12px;font-size:13px;color:var(--muted)">Already have account? <a href="#/login" style="color:var(--primary);font-weight:600">Login</a></p>
    </div>
  `, false);
  $('#regBtn').onclick = async () => {
    try {
      const d = await api('/auth/register', { method: 'POST', body: JSON.stringify({
        tel: $('#tel').value, pwd: $('#pwd').value, pwd2: $('#pwd2').value,
        deposit_pwd: $('#depwd').value, invite_code: $('#invite').value
      }) });
      toast('Registered! Please login.');
      navigate('/login');
    } catch (e) { toast(e.message); }
  };
});

// ---------- Home ----------
route('/home', async () => {
  const cfg = await api('/common/config');
  const home = await api('/product/home');
  const bal = await api('/wallet/balance').catch(() => ({ balance: 0 }));
  const plans = home.plans || [];
  layout('GHADI', `
    <div class="hero-banner">
      <img src="/img/ghadi-sponsor.svg" alt="Ghadi" onerror="this.style.display='none'" />
      <div class="hero-overlay">
        <div class="sponsor-tag"><i class="fa-solid fa-star"></i> Sponsored by GHADI Detergent</div>
      </div>
    </div>
    <div class="balance-card">
      <div class="label">Available Balance</div>
      <div class="amount">${fmt(bal.balance)}</div>
      <div class="actions">
        <button onclick="navigate('/wallet')">Recharge</button>
        <button onclick="navigate('/withdraw')">Withdraw</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Hot Plans</div>
      ${plans.map(p => `
        <div class="plan-card">
          <div class="plan-img"><img src="/img/ghadi-sponsor.svg" alt="Ghadi" onerror="this.style.display='none'" /><span class="sponsor-mini">Ghadi</span></div>
          <h3>${p.name}</h3>
          <div class="meta">
            <div>Price <b>${fmt(p.price)}</b></div>
            <div>Daily <b>${fmt(p.daily_profit)}</b></div>
            <div>Duration <b>${p.duration_days} days</b></div>
            <div>Total <b>${fmt(p.daily_profit * p.duration_days)}</b></div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="navigate('/plan/${p.id}')">View & Buy</button>
        </div>
      `).join('') || '<div class="empty">No plans</div>'}
    </div>
    <div class="sponsor-strip">
      <img src="/img/ghadi-sponsor.svg" alt="Sponsored by Ghadi" onerror="this.style.display='none'" />
      <div><b>Sponsored by GHADI Detergent</b><br><span style="font-size:12px;opacity:.8">India's most trusted detergent brand</span></div>
    </div>
    ${(home.notices || []).map(n => `<div class="card"><div class="card-title">${n.title}</div><div style="font-size:13px;color:var(--muted)">${n.body}</div></div>`).join('')}
  `);
});

// ---------- Plans ----------
route('/plans', async () => {
  const d = await api('/product/list');
  const plans = d.plans || [];
  layout('All Plans', `
    <div class="card">
      ${plans.map(p => `
        <div class="plan-card">
          <div class="plan-img"><img src="/img/ghadi-sponsor.svg" alt="Ghadi" onerror="this.style.display='none'" /><span class="sponsor-mini">Ghadi</span></div>
          <h3>${p.name}</h3>
          <div style="font-size:13px;color:var(--muted);margin-bottom:8px">${p.description || ''}</div>
          <div class="meta">
            <div>Price <b>${fmt(p.price)}</b></div>
            <div>Daily profit <b>${fmt(p.daily_profit)}</b></div>
            <div>Duration <b>${p.duration_days} days</b></div>
            <div>Total return <b>${fmt(p.daily_profit * p.duration_days)}</b></div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="navigate('/plan/${p.id}')">Buy Now</button>
        </div>
      `).join('') || '<div class="empty">No plans available</div>'}
    </div>
  `);
});

route('/plan/:id', async (params) => {
  const d = await api('/product/detail/' + params.id);
  const p = d.plan;
  layout(p.name, `
    <div class="card">
      <div class="price">${fmt(p.price)}</div>
      <div style="font-size:13px;color:var(--muted);margin:8px 0">${p.description || ''}</div>
      <div class="meta" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0">
        <div class="stat"><div class="v">${fmt(p.daily_profit)}</div><div class="l">Daily profit</div></div>
        <div class="stat"><div class="v">${p.duration_days}</div><div class="l">Days</div></div>
        <div class="stat"><div class="v">${fmt(p.daily_profit * p.duration_days)}</div><div class="l">Total return</div></div>
        <div class="stat"><div class="v">${((p.daily_profit / p.price) * 100).toFixed(2)}%</div><div class="l">Daily %</div></div>
      </div>
      <button class="btn btn-primary" onclick="navigate('/buy/${p.id}')">Purchase</button>
    </div>
  `);
});

route('/buy/:id', async (params) => {
  const d = await api('/product/detail/' + params.id);
  const p = d.plan;
  const bal = await api('/wallet/balance');
  layout('Confirm Purchase', `
    <div class="card">
      <div class="card-title">${p.name}</div>
      <div class="meta" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0">
        <div class="stat"><div class="v">${fmt(p.price)}</div><div class="l">Amount</div></div>
        <div class="stat"><div class="v">${p.duration_days} days</div><div class="l">Duration</div></div>
      </div>
      <p style="font-size:13px;color:var(--muted);margin-bottom:12px">Your balance: ${fmt(bal.balance)}</p>
      <button class="btn btn-primary" id="buyBtn">Confirm Purchase</button>
      <button class="btn btn-outline" style="margin-top:8px" onclick="navigate('/plan/${p.id}')">Cancel</button>
    </div>
  `);
  $('#buyBtn').onclick = async () => {
    try {
      await api('/order/buy', { method: 'POST', body: JSON.stringify({ plan_id: p.id }) });
      toast('Purchased!');
      navigate('/orders');
    } catch (e) { toast(e.message); }
  };
});

// ---------- Wallet ----------
route('/wallet', async () => {
  const bal = await api('/wallet/balance');
  const cfg = await api('/common/config');
  layout('Wallet', `
    <div class="balance-card">
      <div class="label">Available Balance</div>
      <div class="amount">${fmt(bal.balance)}</div>
    </div>
    <div class="card">
      <div class="card-title">Recharge</div>
      <input class="input" id="rAmt" type="number" placeholder="Amount (min ${cfg.min_recharge})" />
      <select class="input" id="rCh">
        <option value="upi_manual">Manual UPI (Instant, no KYC)</option>
        <option value="upi">UPI (Razorpay)</option>
        <option value="bank">Bank Transfer</option>
        <option value="card">Card</option>
      </select>
      <button class="btn btn-primary" id="rBtn">Recharge Now</button>
    </div>
    <div class="card">
      <div class="card-title">Recent Records</div>
      <a href="#/records" style="color:var(--primary);font-size:13px">View all →</a>
    </div>
  `);
  $('#rBtn').onclick = async () => {
    try {
      const amt = $('#rAmt').value;
      const ch = $('#rCh').value;
      const d = await api('/wallet/recharge', { method: 'POST', body: JSON.stringify({ amount: Number(amt), channel: ch }) });
      if (d.manual) {
        const info = `Pay ${fmt(d.amount)} to UPI: ${d.upi_id} (${d.upi_name})${d.upi_qr ? '\\nQR: ' + d.upi_qr : ''}\\nThen enter the UTR/transaction ID.`;
        const utr = prompt(info + '\\n\\nEnter UTR / Transaction ID:');
        if (!utr) { toast('Cancelled'); return; }
        await api('/wallet/recharge/confirm', { method: 'POST', body: JSON.stringify({ recharge_id: d.recharge_id, utr }) });
        toast('Submitted for verification');
        navigate('/wallet');
        return;
      }
      if (d.mock) { toast('Recharged (test mode)'); navigate('/wallet'); return; }
      // razorpay
      const options = {
        key: d.key_id,
        amount: d.amount,
        currency: d.currency,
        name: 'GHADI',
        order_id: d.order_id,
        handler: async function (resp) {
          try {
            await api('/wallet/verify', { method: 'POST', body: JSON.stringify({
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature,
            }) });
            toast('Payment successful');
            navigate('/wallet');
          } catch (e) { toast(e.message); }
        },
        theme: { color: '#1e1b4b' }
      };
      if (typeof Razorpay !== 'undefined') {
        const rzp = new Razorpay(options);
        rzp.open();
      } else {
        // load script
        const s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.onload = () => { const rzp = new window.Razorpay(options); rzp.open(); };
        document.body.appendChild(s);
      }
    } catch (e) { toast(e.message); }
  };
});

route('/withdraw', async () => {
  const cfg = await api('/common/config');
  const bal = await api('/wallet/balance');
  const bank = await api('/user/bank').catch(() => ({ bank: null }));
  layout('Withdraw', `
    <div class="balance-card">
      <div class="label">Available Balance</div>
      <div class="amount">${fmt(bal.balance)}</div>
    </div>
    ${bank.bank ? '' : '<div class="card" style="background:#fef3c7"><a href="#/bank" style="color:var(--primary);font-weight:600">Link bank account first →</a></div>'}
    <div class="card">
      <div class="card-title">Withdraw</div>
      <input class="input" id="wAmt" type="number" placeholder="Amount (min ${cfg.min_withdraw})" />
      <input class="input" id="wPwd" type="password" placeholder="Withdraw password" />
      <p style="font-size:12px;color:var(--muted);margin-bottom:12px">Fee: ${cfg.withdraw_fee_percent}% · Window: ${cfg.withdraw_start}-${cfg.withdraw_end} IST</p>
      <button class="btn btn-primary" id="wBtn">Withdraw Now</button>
    </div>
    <div class="card">
      <div class="card-title">History</div>
      <a href="#/withdrawals" style="color:var(--primary);font-size:13px">View withdrawals →</a>
    </div>
  `);
  $('#wBtn').onclick = async () => {
    try {
      const d = await api('/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amount: Number($('#wAmt').value), password: $('#wPwd').value }) });
      toast(`Requested. You'll receive ${fmt(d.net)}`);
      navigate('/wallet');
    } catch (e) { toast(e.message); }
  };
});

route('/withdrawals', async () => {
  const d = await api('/wallet/withdraw_list');
  const list = d.withdrawals || [];
  layout('Withdrawals', `
    <div class="card">
      ${list.map(w => `
        <div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between"><b>${fmt(w.amount)}</b><span style="color:${w.status==='paid'?'var(--success)':w.status==='failed'?'var(--danger)':'var(--muted)'}">${w.status.toUpperCase()}</span></div>
          <div style="font-size:12px;color:var(--muted)">Fee ${fmt(w.fee)} · Net ${fmt(w.net)} · ${w.created_at}</div>
        </div>
      `).join('') || '<div class="empty">No withdrawals</div>'}
    </div>
  `);
});

// ---------- Team ----------
route('/team', async () => {
  const d = await api('/team');
  layout('Team', `
    <div class="card">
      <div class="card-title">Your Referral Code</div>
      <div style="font-size:24px;font-weight:800;color:var(--primary);text-align:center;margin:10px 0">${d.invite_code}</div>
      <button class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText('${d.invite_code}');toast('Copied')">Copy Code</button>
    </div>
    <div class="grid2">
      <div class="stat"><div class="v">${d.total_invites}</div><div class="l">Total Invites</div></div>
      <div class="stat"><div class="v">${fmt(d.team_recharge)}</div><div class="l">Team Recharge</div></div>
    </div>
    <div class="card" style="margin-top:12px">
      <div class="card-title">Members (${d.members.length})</div>
      ${d.members.map(m => `<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">${m.phone} <span style="color:var(--muted);float:right">${m.created_at}</span></div>`).join('') || '<div class="empty">No members yet</div>'}
    </div>
    <div class="card">
      <div class="card-title">Invite Link</div>
      <input class="input" value="${location.origin}/#/register?invite=${d.invite_code}" readonly />
      <button class="btn btn-primary btn-sm" onclick="navigator.clipboard.writeText('${location.origin}/#/register?invite=${d.invite_code}');toast('Copied')">Copy Link</button>
    </div>
  `);
});

// ---------- My ----------
route('/my', async () => {
  const u = await api('/user/profile');
  layout('My', `
    <div class="balance-card">
      <div class="label">${u.profile.phone}</div>
      <div class="amount">${fmt(u.profile.balance)}</div>
    </div>
    <div class="card">
      <a href="#/orders" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)"><span><i class="fa-solid fa-list-check" style="color:var(--primary);margin-right:8px"></i>My Plans</span><i class="fa-solid fa-chevron-right" style="color:var(--muted)"></i></a>
      <a href="#/records" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)"><span><i class="fa-solid fa-receipt" style="color:var(--primary);margin-right:8px"></i>Transactions</span><i class="fa-solid fa-chevron-right" style="color:var(--muted)"></i></a>
      <a href="#/bank" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)"><span><i class="fa-solid fa-building-columns" style="color:var(--primary);margin-right:8px"></i>Bank Details</span><i class="fa-solid fa-chevron-right" style="color:var(--muted)"></i></a>
      <a href="#/settings" style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)"><span><i class="fa-solid fa-gear" style="color:var(--primary);margin-right:8px"></i>Security</span><i class="fa-solid fa-chevron-right" style="color:var(--muted)"></i></a>
      <a href="#/notices" style="display:flex;justify-content:space-between;padding:10px 0"><span><i class="fa-solid fa-bell" style="color:var(--primary);margin-right:8px"></i>Notices</span><i class="fa-solid fa-chevron-right" style="color:var(--muted)"></i></a>
    </div>
    <button class="btn btn-danger" id="logoutBtn" style="margin-top:10px">Logout</button>
  `);
  $('#logoutBtn').onclick = () => { clearAuth(); navigate('/login'); };
});

route('/orders', async () => {
  const d = await api('/order/list');
  const list = d.orders || [];
  layout('My Plans', `
    <div class="card">
      ${list.map(o => `
        <div style="padding:12px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between"><b>${o.plan_name}</b><span style="color:${o.status==='active'?'var(--success)':'var(--muted)'}">${o.status}</span></div>
          <div style="font-size:12px;color:var(--muted);margin-top:4px">Invested ${fmt(o.amount)} · Daily ${fmt(o.daily_profit)} · ${o.days_paid}/${o.days_total} days</div>
          <div style="background:var(--border);border-radius:4px;height:6px;margin-top:6px;overflow:hidden"><div style="background:var(--accent);height:100%;width:${(o.days_paid/o.days_total*100).toFixed(0)}%"></div></div>
        </div>
      `).join('') || '<div class="empty">No plans yet. <a href="#/plans" style="color:var(--primary)">Explore plans</a></div>'}
    </div>
  `);
});

route('/records', async () => {
  const d = await api('/wallet/records');
  const list = d.records || [];
  layout('Transactions', `
    <div class="card">
      ${list.map(t => `
        <div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between"><span style="font-weight:600">${t.type}</span><span style="color:${t.amount>=0?'var(--success)':'var(--danger)'}">${fmt(t.amount)}</span></div>
          <div style="font-size:12px;color:var(--muted)">${t.status} · ${t.note || ''} · ${t.created_at}</div>
        </div>
      `).join('') || '<div class="empty">No records</div>'}
    </div>
  `);
});

route('/bank', async () => {
  const d = await api('/user/bank');
  const b = d.bank;
  layout('Bank Details', `
    <div class="card">
      <input class="input" id="holder" placeholder="Account holder name" value="${b?.holder || ''}" />
      <input class="input" id="bank" placeholder="Bank name" value="${b?.bank || ''}" />
      <input class="input" id="acc" placeholder="Account number" value="${b?.account_no || ''}" />
      <input class="input" id="ifsc" placeholder="IFSC code" value="${b?.ifsc || ''}" />
      <input class="input" id="branch" placeholder="Branch" value="${b?.branch || ''}" />
      <input class="input" id="addr" placeholder="Address" value="${b?.address || ''}" />
      <button class="btn btn-primary" id="saveBank">Save</button>
    </div>
  `);
  $('#saveBank').onclick = async () => {
    try {
      await api('/user/bank_save', { method: 'POST', body: JSON.stringify({
        holder: $('#holder').value, bank: $('#bank').value, account_no: $('#acc').value,
        ifsc: $('#ifsc').value, branch: $('#branch').value, address: $('#addr').value
      }) });
      toast('Saved');
    } catch (e) { toast(e.message); }
  };
});

route('/settings', async () => {
  layout('Security', `
    <div class="card">
      <div class="card-title">Change Login Password</div>
      <input class="input" id="c1" type="password" placeholder="Current password" />
      <input class="input" id="n1" type="password" placeholder="New password" />
      <button class="btn btn-primary btn-sm" id="p1">Update</button>
    </div>
    <div class="card">
      <div class="card-title">Change Withdraw Password</div>
      <input class="input" id="c2" type="password" placeholder="Current withdraw password" />
      <input class="input" id="n2" type="password" placeholder="New withdraw password" />
      <button class="btn btn-primary btn-sm" id="p2">Update</button>
    </div>
  `);
  $('#p1').onclick = async () => {
    try { await api('/user/password', { method: 'POST', body: JSON.stringify({ current: $('#c1').value, new_pwd: $('#n1').value }) }); toast('Updated'); }
    catch (e) { toast(e.message); }
  };
  $('#p2').onclick = async () => {
    try { await api('/user/pay_password', { method: 'POST', body: JSON.stringify({ current: $('#c2').value, new_pwd: $('#n2').value }) }); toast('Updated'); }
    catch (e) { toast(e.message); }
  };
});

route('/notices', async () => {
  const d = await api('/user/messages');
  const list = d.messages || [];
  layout('Notices', `
    <div class="card">
      ${list.map(n => `<div style="padding:10px 0;border-bottom:1px solid var(--border)"><div style="font-weight:600">${n.title}</div><div style="font-size:13px;color:var(--muted);margin-top:4px">${n.body}</div><div style="font-size:11px;color:var(--muted);margin-top:4px">${n.created_at}</div></div>`).join('') || '<div class="empty">No notices</div>'}
    </div>
  `);
});

// ---------- Theme / background from admin ----------
function applyTheme(cfg) {
  const root = document.documentElement;
  if (cfg.theme_primary) root.style.setProperty('--primary', cfg.theme_primary);
  if (cfg.theme_accent) root.style.setProperty('--accent', cfg.theme_accent);
  if (cfg.theme_bg) root.style.setProperty('--bg', cfg.theme_bg);
  if (cfg.bg_image) {
    const ov = Number(cfg.bg_overlay || 0.45);
    document.body.style.backgroundImage = `linear-gradient(rgba(15,23,42,${ov}), rgba(15,23,42,${ov})), url('${cfg.bg_image}')`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundAttachment = 'fixed';
    document.body.style.backgroundPosition = 'center';
  } else {
    document.body.style.backgroundImage = '';
  }
}
async function initTheme() {
  try { applyTheme(await api('/common/config')); } catch (e) { /* ignore */ }
}

initTheme();
render();
