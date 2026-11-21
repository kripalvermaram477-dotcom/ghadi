import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import cors from 'cors';
import cron from 'node-cron';
import { db, getConfig, setConfig } from './lib/db.js';
import { hashPassword, verifyPassword, signUserToken, signAdminToken, userAuth, adminAuth, genInviteCode, verifyUserToken, verifyAdminToken } from './lib/auth.js';
import { getRazorpay, getKeyId, verifySignature } from './lib/razorpay.js';
import { runPayouts, getOrderEarnings } from './lib/payouts.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
function ok(res, data = {}) { res.json({ code: 0, info: 'Success', data }); }
function fail(res, msg, code = 400) { res.status(code).json({ code, info: msg }); }

// ---------- AUTH ----------
app.post('/api/auth/register', (req, res) => {
  try {
    const { tel, pwd, pwd2, deposit_pwd, invite_code } = req.body;
    if (!tel || !pwd) return fail(res, 'Phone and password required');
    if (pwd.length < 6) return fail(res, 'Password min 6 chars');
    if (pwd2 && pwd !== pwd2) return fail(res, 'Passwords do not match');
    const exists = db.prepare('SELECT id FROM users WHERE phone = ?').get(tel);
    if (exists) return fail(res, 'Phone already registered');
    let invitedBy = null;
    if (invite_code) {
      const inv = db.prepare('SELECT id FROM users WHERE invite_code = ?').get(invite_code);
      if (inv) invitedBy = inv.id;
    }
    const code = genInviteCode();
    const info = db.prepare('INSERT INTO users (phone, password_hash, withdraw_password_hash, invite_code, invited_by) VALUES (?, ?, ?, ?, ?)')
      .run(tel, hashPassword(pwd), deposit_pwd ? hashPassword(deposit_pwd) : hashPassword(pwd), code, invitedBy);
    const user = db.prepare('SELECT id, phone, balance, role, invite_code FROM users WHERE id = ?').get(info.lastInsertRowid);
    db.prepare('INSERT INTO transactions (user_id, type, amount, status, note) VALUES (?, ?, ?, ?, ?)').run(user.id, 'system_recharge', 0, 'success', 'Welcome bonus');
    ok(res, { token: signUserToken(user), user });
  } catch (e) { fail(res, e.message, 500); }
});

app.post('/api/auth/login', (req, res) => {
  const { tel, pwd } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(tel);
  if (!user || !verifyPassword(pwd, user.password_hash)) return fail(res, 'Invalid credentials', 401);
  const safe = { id: user.id, phone: user.phone, balance: user.balance, role: user.role, invite_code: user.invite_code };
  ok(res, { token: signUserToken(safe), user: safe });
});

app.post('/api/auth/check_phone', (req, res) => {
  const { tel } = req.body;
  const user = db.prepare('SELECT id FROM users WHERE phone = ?').get(tel);
  ok(res, { exists: !!user });
});

// ---------- COMMON ----------
app.get('/api/common/config', (req, res) => {
  const cfg = db.prepare('SELECT key, value FROM config').all();
  const obj = {};
  for (const c of cfg) obj[c.key] = c.value;
  ok(res, {
    site_name: obj.site_name,
    csrf_token: 'str-' + Math.random().toString(36).slice(2),
    min_recharge: Number(obj.min_recharge),
    min_withdraw: Number(obj.min_withdraw),
    withdraw_fee_percent: Number(obj.withdraw_fee_percent),
    withdraw_start: obj.withdraw_start,
    withdraw_end: obj.withdraw_end,
    razorpay_key_id: obj.razorpay_key_id,
    mock_payments: obj.mock_payments === '1',
  });
});

// ---------- PLANS ----------
app.get('/api/product/home', (req, res) => {
  const hot = db.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY sort_order ASC, id DESC LIMIT 6').all();
  const notices = db.prepare('SELECT * FROM notices ORDER BY id DESC LIMIT 5').all();
  ok(res, { plans: hot, notices, popup: null });
});

app.get('/api/product/list', (req, res) => {
  const plans = db.prepare('SELECT * FROM plans WHERE active = 1 ORDER BY sort_order ASC, id DESC').all();
  ok(res, { plans });
});

app.get('/api/product/detail/:id', (req, res) => {
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(req.params.id);
  if (!plan) return fail(res, 'Plan not found', 404);
  ok(res, { plan });
});

// ---------- ORDERS ----------
app.post('/api/order/buy', userAuth, (req, res) => {
  const { plan_id } = req.body;
  const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND active = 1').get(plan_id);
  if (!plan) return fail(res, 'Plan not found');
  const user = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);
  if (user.balance < plan.price) return fail(res, 'Insufficient balance');
  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(plan.price, req.user.id);
  const info = db.prepare('INSERT INTO orders (user_id, plan_id, amount, daily_profit, days_total) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, plan.id, plan.price, plan.daily_profit, plan.duration_days);
  db.prepare('INSERT INTO transactions (user_id, type, amount, status, note) VALUES (?, ?, ?, ?, ?)').run(
    req.user.id, 'purchase', plan.price, 'success', `Purchased plan: ${plan.name}`
  );
  ok(res, { order_id: info.lastInsertRowid });
});

app.get('/api/order/list', userAuth, (req, res) => {
  const orders = db.prepare(`
    SELECT o.*, p.name as plan_name, p.image_url FROM orders o LEFT JOIN plans p ON p.id = o.plan_id
    WHERE o.user_id = ? ORDER BY o.id DESC
  `).all(req.user.id);
  ok(res, { orders });
});

app.get('/api/order/earnings', userAuth, (req, res) => {
  ok(res, { orders: getOrderEarnings(req.user.id) });
});

// ---------- WALLET ----------
app.post('/api/wallet/recharge', userAuth, (req, res) => {
  const { amount, channel } = req.body;
  const min = Number(getConfig('min_recharge'));
  if (!amount || Number(amount) < min) return fail(res, `Minimum recharge ${min}`);
  const amt = Number(amount);
  const manual = channel === 'upi_manual' || channel === 'manual';
  if (manual) {
    const upi_id = getConfig('upi_id') || '';
    const upi_name = getConfig('upi_name') || 'GHADI';
    const upi_qr = getConfig('upi_qr') || '';
    const info = db.prepare('INSERT INTO recharges (user_id, amount, channel, status) VALUES (?, ?, ?, ?)').run(req.user.id, amt, 'upi_manual', 'pending');
    return ok(res, { manual: true, recharge_id: info.lastInsertRowid, amount: amt, upi_id, upi_name, upi_qr });
  }
  const rz = getRazorpay();
  const mock = getConfig('mock_payments') === '1' || !rz;
  if (mock) {
    // auto credit
    db.prepare('INSERT INTO recharges (user_id, amount, channel, status) VALUES (?, ?, ?, ?)').run(req.user.id, amt, channel || 'mock', 'success');
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amt, req.user.id);
    db.prepare('INSERT INTO transactions (user_id, type, amount, status, note) VALUES (?, ?, ?, ?, ?)').run(req.user.id, 'recharge', amt, 'success', `Recharge via ${channel || 'mock'}`);
    return ok(res, { mock: true, credited: true });
  }
  // razorpay order
  rz.orders.create({ amount: Math.round(amt * 100), currency: 'INR', receipt: 'rcpt_' + Date.now() }, (err, order) => {
    if (err) return fail(res, err.error?.description || 'Razorpay error', 500);
    db.prepare('INSERT INTO recharges (user_id, amount, channel, razorpay_order_id, status) VALUES (?, ?, ?, ?, ?)').run(req.user.id, amt, channel || 'razorpay', order.id, 'pending');
    ok(res, { order_id: order.id, amount: order.amount, currency: order.currency, key_id: getKeyId() });
  });
});

app.post('/api/wallet/verify', userAuth, (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;
  if (!verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) return fail(res, 'Invalid signature', 400);
  const r = db.prepare('SELECT * FROM recharges WHERE razorpay_order_id = ? AND user_id = ?').get(razorpay_order_id, req.user.id);
  if (!r) return fail(res, 'Recharge not found', 404);
  if (r.status === 'success') return ok(res, { already: true });
  db.prepare('UPDATE recharges SET status = ?, razorpay_payment_id = ? WHERE id = ?').run('success', razorpay_payment_id, r.id);
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(r.amount, req.user.id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, status, note) VALUES (?, ?, ?, ?, ?)').run(req.user.id, 'recharge', r.amount, 'success', 'Recharge via Razorpay');
  ok(res, { credited: true });
});

app.post('/api/wallet/recharge/confirm', userAuth, (req, res) => {
  const { recharge_id, utr } = req.body;
  const r = db.prepare('SELECT * FROM recharges WHERE id = ? AND user_id = ?').get(recharge_id, req.user.id);
  if (!r) return fail(res, 'Recharge not found', 404);
  if (!utr) return fail(res, 'UTR required');
  db.prepare('UPDATE recharges SET utr = ?, status = ? WHERE id = ?').run(utr, 'pending', r.id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, status, note) VALUES (?, ?, ?, ?, ?)').run(req.user.id, 'recharge', r.amount, 'pending', 'Manual UPI recharge pending verification');
  ok(res, { submitted: true });
});

app.get('/api/wallet/balance', userAuth, (req, res) => {
  const u = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);
  ok(res, { balance: u.balance });
});

app.get('/api/wallet/records', userAuth, (req, res) => {
  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id);
  ok(res, { records: txs });
});

app.post('/api/wallet/withdraw', userAuth, (req, res) => {
  const { amount, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user.withdraw_password_hash || !verifyPassword(password, user.withdraw_password_hash)) return fail(res, 'Invalid withdraw password', 401);
  const min = Number(getConfig('min_withdraw'));
  const amt = Number(amount);
  if (!amt || amt < min) return fail(res, `Minimum withdraw ${min}`);
  if (user.balance < amt) return fail(res, 'Insufficient balance');
  const feePct = Number(getConfig('withdraw_fee_percent'));
  const fee = +(amt * feePct / 100).toFixed(2);
  const net = +(amt - fee).toFixed(2);
  const bank = db.prepare('SELECT * FROM bank_details WHERE user_id = ?').get(req.user.id);
  if (!bank) return fail(res, 'Please add bank details first');
  db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amt, req.user.id);
  db.prepare('INSERT INTO withdrawals (user_id, amount, fee, net, bank_snapshot, status) VALUES (?, ?, ?, ?, ?, ?)').run(
    req.user.id, amt, fee, net, JSON.stringify(bank), 'pending'
  );
  db.prepare('INSERT INTO transactions (user_id, type, amount, status, note) VALUES (?, ?, ?, ?, ?)').run(req.user.id, 'withdraw', amt, 'pending', 'Withdrawal request');
  ok(res, { fee, net });
});

app.get('/api/wallet/withdraw_list', userAuth, (req, res) => {
  const list = db.prepare('SELECT * FROM withdrawals WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  ok(res, { withdrawals: list });
});

// ---------- USER ----------
app.get('/api/user/profile', userAuth, (req, res) => {
  const u = db.prepare('SELECT id, phone, balance, invite_code, created_at FROM users WHERE id = ?').get(req.user.id);
  ok(res, { profile: u });
});

app.get('/api/user/bank', userAuth, (req, res) => {
  const b = db.prepare('SELECT * FROM bank_details WHERE user_id = ?').get(req.user.id);
  ok(res, { bank: b || null });
});

app.post('/api/user/bank_save', userAuth, (req, res) => {
  const { holder, bank, account_no, ifsc, branch, address } = req.body;
  const existing = db.prepare('SELECT id FROM bank_details WHERE user_id = ?').get(req.user.id);
  if (existing) {
    db.prepare("UPDATE bank_details SET holder=?, bank=?, account_no=?, ifsc=?, branch=?, address=?, updated_at=datetime('now') WHERE user_id=?")
      .run(holder, bank, account_no, ifsc, branch, address, req.user.id);
  } else {
    db.prepare('INSERT INTO bank_details (user_id, holder, bank, account_no, ifsc, branch, address) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(req.user.id, holder, bank, account_no, ifsc, branch, address);
  }
  ok(res, {});
});

app.post('/api/user/password', userAuth, (req, res) => {
  const { current, new_pwd } = req.body;
  const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current, u.password_hash)) return fail(res, 'Current password wrong', 401);
  if (!new_pwd || new_pwd.length < 6) return fail(res, 'New password min 6 chars');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_pwd), req.user.id);
  ok(res, {});
});

app.post('/api/user/pay_password', userAuth, (req, res) => {
  const { current, new_pwd } = req.body;
  const u = db.prepare('SELECT withdraw_password_hash FROM users WHERE id = ?').get(req.user.id);
  if (u.withdraw_password_hash && current && !verifyPassword(current, u.withdraw_password_hash)) return fail(res, 'Current password wrong', 401);
  if (!new_pwd || new_pwd.length < 6) return fail(res, 'New password min 6 chars');
  db.prepare('UPDATE users SET withdraw_password_hash = ? WHERE id = ?').run(hashPassword(new_pwd), req.user.id);
  ok(res, {});
});

// ---------- TEAM ----------
app.get('/api/team', userAuth, (req, res) => {
  const invited = db.prepare('SELECT id, phone, created_at FROM users WHERE invited_by = ?').all(req.user.id);
  const totalRecharge = db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM recharges WHERE user_id = ? AND status = 'success'").get(req.user.id).s;
  const teamRecharge = db.prepare(`
    SELECT COALESCE(SUM(r.amount),0) as s FROM recharges r JOIN users u ON u.id = r.user_id
    WHERE u.invited_by = ? AND r.status = 'success'
  `).get(req.user.id).s;
  ok(res, {
    invite_code: req.user.invite_code,
    total_invites: invited.length,
    members: invited,
    total_recharge: totalRecharge,
    team_recharge: teamRecharge,
  });
});

// ---------- NOTICES / MESSAGES ----------
app.get('/api/messages', (req, res) => {
  const list = db.prepare('SELECT * FROM notices ORDER BY id DESC').all();
  ok(res, { messages: list });
});

app.get('/api/user/messages', userAuth, (req, res) => {
  const list = db.prepare('SELECT * FROM notices ORDER BY id DESC').all();
  ok(res, { messages: list });
});

// ---------- ADMIN API ----------
app.post('/admin-api/login', (req, res) => {
  const { tel, pwd } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE phone = ? AND role = ?').get(tel, 'admin');
  if (!user || !verifyPassword(pwd, user.password_hash)) return fail(res, 'Invalid admin credentials', 401);
  const safe = { id: user.id, phone: user.phone, role: 'admin' };
  ok(res, { token: signAdminToken(safe), user: safe });
});

// plans CRUD
app.get('/admin-api/plans', adminAuth, (req, res) => {
  const plans = db.prepare('SELECT * FROM plans ORDER BY sort_order ASC, id DESC').all();
  ok(res, { plans });
});
app.post('/admin-api/plans', adminAuth, (req, res) => {
  const { name, price, daily_profit, duration_days, description, image_url, active, sort_order } = req.body;
  if (!name || !price || !daily_profit || !duration_days) return fail(res, 'Missing fields');
  const info = db.prepare('INSERT INTO plans (name, price, daily_profit, duration_days, description, image_url, active, sort_order) VALUES (?,?,?,?,?,?,?,?)')
    .run(name, Number(price), Number(daily_profit), Number(duration_days), description || '', image_url || '', active ? 1 : 0, Number(sort_order || 0));
  ok(res, { id: info.lastInsertRowid });
});
app.put('/admin-api/plans/:id', adminAuth, (req, res) => {
  const { name, price, daily_profit, duration_days, description, image_url, active, sort_order } = req.body;
  db.prepare('UPDATE plans SET name=?, price=?, daily_profit=?, duration_days=?, description=?, image_url=?, active=?, sort_order=? WHERE id=?')
    .run(name, Number(price), Number(daily_profit), Number(duration_days), description || '', image_url || '', active ? 1 : 0, Number(sort_order || 0), req.params.id);
  ok(res, {});
});
app.delete('/admin-api/plans/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM plans WHERE id = ?').run(req.params.id);
  ok(res, {});
});

// users
app.get('/admin-api/users', adminAuth, (req, res) => {
  const users = db.prepare('SELECT id, phone, balance, role, invite_code, invited_by, created_at FROM users ORDER BY id DESC').all();
  ok(res, { users });
});
app.post('/admin-api/users/:id/balance', adminAuth, (req, res) => {
  const { amount, note } = req.body;
  const amt = Number(amount);
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(amt, req.params.id);
  db.prepare('INSERT INTO transactions (user_id, type, amount, status, note) VALUES (?, ?, ?, ?, ?)').run(req.params.id, 'system_recharge', amt, 'success', note || 'Admin adjustment');
  ok(res, {});
});

// withdrawals
app.get('/admin-api/withdrawals', adminAuth, (req, res) => {
  const list = db.prepare(`
    SELECT w.*, u.phone FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id ORDER BY w.id DESC
  `).all();
  ok(res, { withdrawals: list });
});
app.post('/admin-api/withdrawals/:id/approve', adminAuth, (req, res) => {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (!w) return fail(res, 'Not found', 404);
  db.prepare("UPDATE withdrawals SET status = ?, processed_at = datetime('now') WHERE id = ?").run('paid', req.params.id);
  db.prepare('UPDATE transactions SET status = ? WHERE user_id = ? AND type = ? AND amount = ? AND status = ?')
    .run('success', w.user_id, 'withdraw', w.amount, 'pending');
  ok(res, {});
});
app.post('/admin-api/withdrawals/:id/reject', adminAuth, (req, res) => {
  const w = db.prepare('SELECT * FROM withdrawals WHERE id = ?').get(req.params.id);
  if (!w) return fail(res, 'Not found', 404);
  // refund
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(w.amount, w.user_id);
  db.prepare("UPDATE withdrawals SET status = ?, processed_at = datetime('now') WHERE id = ?").run('failed', req.params.id);
  ok(res, {});
});

// manual recharges
app.get('/admin-api/recharges', adminAuth, (req, res) => {
  const list = db.prepare(`
    SELECT r.*, u.phone FROM recharges r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.id DESC
  `).all();
  ok(res, { recharges: list });
});
app.post('/admin-api/recharges/:id/approve', adminAuth, (req, res) => {
  const r = db.prepare('SELECT * FROM recharges WHERE id = ?').get(req.params.id);
  if (!r) return fail(res, 'Not found', 404);
  if (r.status === 'success') return ok(res, { already: true });
  db.prepare('UPDATE recharges SET status = ? WHERE id = ?').run('success', r.id);
  db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(r.amount, r.user_id);
  db.prepare('UPDATE transactions SET status = ? WHERE user_id = ? AND type = ? AND amount = ? AND status = ?')
    .run('success', r.user_id, 'recharge', r.amount, 'pending');
  ok(res, {});
});
app.post('/admin-api/recharges/:id/reject', adminAuth, (req, res) => {
  const r = db.prepare('SELECT * FROM recharges WHERE id = ?').get(req.params.id);
  if (!r) return fail(res, 'Not found', 404);
  db.prepare('UPDATE recharges SET status = ? WHERE id = ?').run('failed', r.id);
  db.prepare('UPDATE transactions SET status = ? WHERE user_id = ? AND type = ? AND amount = ? AND status = ?')
    .run('failed', r.user_id, 'recharge', r.amount, 'pending');
  ok(res, {});
});

// notices
app.get('/admin-api/notices', adminAuth, (req, res) => {
  const list = db.prepare('SELECT * FROM notices ORDER BY id DESC').all();
  ok(res, { notices: list });
});
app.post('/admin-api/notices', adminAuth, (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) return fail(res, 'Missing fields');
  const info = db.prepare('INSERT INTO notices (title, body) VALUES (?, ?)').run(title, body);
  ok(res, { id: info.lastInsertRowid });
});
app.delete('/admin-api/notices/:id', adminAuth, (req, res) => {
  db.prepare('DELETE FROM notices WHERE id = ?').run(req.params.id);
  ok(res, {});
});

// config
app.get('/admin-api/config', adminAuth, (req, res) => {
  const cfg = db.prepare('SELECT key, value FROM config').all();
  const obj = {};
  for (const c of cfg) obj[c.key] = c.value;
  ok(res, { config: obj });
});
app.post('/admin-api/config', adminAuth, (req, res) => {
  const body = req.body || {};
  for (const [k, v] of Object.entries(body)) {
    setConfig(k, String(v));
  }
  ok(res, {});
});

// stats
app.get('/admin-api/stats', adminAuth, (req, res) => {
  const users = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const plans = db.prepare('SELECT COUNT(*) as c FROM plans').get().c;
  const orders = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
  const activeOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status='active'").get().c;
  const pendingWd = db.prepare("SELECT COUNT(*) as c FROM withdrawals WHERE status='pending'").get().c;
  const totalBalance = db.prepare('SELECT COALESCE(SUM(balance),0) as s FROM users').get().s;
  ok(res, { users, plans, orders, activeOrders, pendingWd, totalBalance });
});

// manual payout
app.post('/admin-api/payout/run', adminAuth, (req, res) => {
  const r = runPayouts();
  ok(res, r);
});

// serve admin static
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// SPA fallback
app.get(/^\/(?!api|admin-api|admin).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// cron daily payout at 00:30 IST
cron.schedule('30 0 * * *', () => { try { runPayouts(); } catch (e) { console.error(e); } }, { timezone: 'Asia/Kolkata' });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GHADI running on http://0.0.0.0:${PORT}`);
  console.log(`Admin panel: http://0.0.0.0:${PORT}/admin`);
});
