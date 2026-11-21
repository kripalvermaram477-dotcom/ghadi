import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import cron from 'node-cron';
import { query, get, all, getConfig, setConfig } from './lib/db.js';
import { hashPassword, verifyPassword, signUserToken, signAdminToken, userAuth, adminAuth, genInviteCode } from './lib/auth.js';
import { getRazorpay, getKeyId, verifySignature } from './lib/razorpay.js';
import { runPayouts, getOrderEarnings } from './lib/payouts.js';
import { seed } from './lib/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
function ok(res, data = {}) { res.json({ code: 0, info: 'Success', data }); }
function fail(res, msg, code = 400) { res.status(code).json({ code, info: msg }); }
function ah(fn) {
  return (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    fail(res, e.message || 'Server error', 500);
  });
}

// ---------- AUTH ----------
app.post('/api/auth/register', ah(async (req, res) => {
  const { tel, pwd, pwd2, deposit_pwd, invite_code } = req.body;
  if (!tel || !pwd) return fail(res, 'Phone and password required');
  if (pwd.length < 6) return fail(res, 'Password min 6 chars');
  if (pwd2 && pwd !== pwd2) return fail(res, 'Passwords do not match');
  const exists = await get('SELECT id FROM users WHERE phone = $1', [tel]);
  if (exists) return fail(res, 'Phone already registered');
  let invitedBy = null;
  if (invite_code) {
    const inv = await get('SELECT id FROM users WHERE invite_code = $1', [invite_code]);
    if (inv) invitedBy = inv.id;
  }
  const code = genInviteCode();
  const created = await query(
    `INSERT INTO users (phone, password_hash, withdraw_password_hash, invite_code, invited_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tel, hashPassword(pwd), deposit_pwd ? hashPassword(deposit_pwd) : hashPassword(pwd), code, invitedBy]
  );
  const user = await get('SELECT id, phone, balance, role, invite_code FROM users WHERE id = $1', [created.rows[0].id]);
  await query('INSERT INTO transactions (user_id, type, amount, status, note) VALUES ($1, $2, $3, $4, $5)', [
    user.id, 'system_recharge', 0, 'success', 'Welcome bonus',
  ]);
  ok(res, { token: signUserToken(user), user });
}));

app.post('/api/auth/login', ah(async (req, res) => {
  const { tel, pwd } = req.body;
  const user = await get('SELECT * FROM users WHERE phone = $1', [tel]);
  if (!user || !verifyPassword(pwd, user.password_hash)) return fail(res, 'Invalid credentials', 401);
  const safe = { id: user.id, phone: user.phone, balance: user.balance, role: user.role, invite_code: user.invite_code };
  ok(res, { token: signUserToken(safe), user: safe });
}));

app.post('/api/auth/check_phone', ah(async (req, res) => {
  const { tel } = req.body;
  const user = await get('SELECT id FROM users WHERE phone = $1', [tel]);
  ok(res, { exists: !!user });
}));

// ---------- COMMON ----------
app.get('/api/common/config', ah(async (req, res) => {
  const cfg = await all('SELECT key, value FROM config');
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
    theme_primary: obj.theme_primary,
    theme_accent: obj.theme_accent,
    theme_bg: obj.theme_bg,
    bg_image: obj.bg_image,
    bg_overlay: obj.bg_overlay,
  });
}));

// ---------- PLANS ----------
app.get('/api/product/home', ah(async (req, res) => {
  const hot = await all('SELECT * FROM plans WHERE active = 1 ORDER BY sort_order ASC, id DESC LIMIT 6');
  const notices = await all('SELECT * FROM notices ORDER BY id DESC LIMIT 5');
  ok(res, { plans: hot, notices, popup: null });
}));

app.get('/api/product/list', ah(async (req, res) => {
  const plans = await all('SELECT * FROM plans WHERE active = 1 ORDER BY sort_order ASC, id DESC');
  ok(res, { plans });
}));

app.get('/api/product/detail/:id', ah(async (req, res) => {
  const plan = await get('SELECT * FROM plans WHERE id = $1', [req.params.id]);
  if (!plan) return fail(res, 'Plan not found', 404);
  ok(res, { plan });
}));

// ---------- ORDERS ----------
app.post('/api/order/buy', userAuth, ah(async (req, res) => {
  const { plan_id } = req.body;
  const plan = await get('SELECT * FROM plans WHERE id = $1 AND active = 1', [plan_id]);
  if (!plan) return fail(res, 'Plan not found');
  const user = await get('SELECT balance FROM users WHERE id = $1', [req.user.id]);
  if (user.balance < plan.price) return fail(res, 'Insufficient balance');
  await query('UPDATE users SET balance = balance - $1 WHERE id = $2', [plan.price, req.user.id]);
  const created = await query(
    'INSERT INTO orders (user_id, plan_id, amount, daily_profit, days_total) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [req.user.id, plan.id, plan.price, plan.daily_profit, plan.duration_days]
  );
  await query('INSERT INTO transactions (user_id, type, amount, status, note) VALUES ($1, $2, $3, $4, $5)', [
    req.user.id, 'purchase', plan.price, 'success', `Purchased plan: ${plan.name}`,
  ]);
  ok(res, { order_id: created.rows[0].id });
}));

app.get('/api/order/list', userAuth, ah(async (req, res) => {
  const orders = await all(`
    SELECT o.*, p.name as plan_name, p.image_url FROM orders o LEFT JOIN plans p ON p.id = o.plan_id
    WHERE o.user_id = $1 ORDER BY o.id DESC
  `, [req.user.id]);
  ok(res, { orders });
}));

app.get('/api/order/earnings', userAuth, ah(async (req, res) => {
  ok(res, { orders: await getOrderEarnings(req.user.id) });
}));

// ---------- WALLET ----------
app.post('/api/wallet/recharge', userAuth, ah(async (req, res) => {
  const { amount, channel } = req.body;
  const min = Number(await getConfig('min_recharge'));
  if (!amount || Number(amount) < min) return fail(res, `Minimum recharge ${min}`);
  const amt = Number(amount);
  const manual = channel === 'upi_manual' || channel === 'manual';
  if (manual) {
    const upi_id = (await getConfig('upi_id')) || '';
    const upi_name = (await getConfig('upi_name')) || 'GHADI';
    const upi_qr = (await getConfig('upi_qr')) || '';
    const created = await query(
      'INSERT INTO recharges (user_id, amount, channel, status) VALUES ($1, $2, $3, $4) RETURNING id',
      [req.user.id, amt, 'upi_manual', 'pending']
    );
    return ok(res, { manual: true, recharge_id: created.rows[0].id, amount: amt, upi_id, upi_name, upi_qr });
  }
  const rz = await getRazorpay();
  const mock = (await getConfig('mock_payments')) === '1';
  if (mock) {
    await query('INSERT INTO recharges (user_id, amount, channel, status) VALUES ($1, $2, $3, $4)', [req.user.id, amt, channel || 'mock', 'success']);
    await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amt, req.user.id]);
    await query('INSERT INTO transactions (user_id, type, amount, status, note) VALUES ($1, $2, $3, $4, $5)', [req.user.id, 'recharge', amt, 'success', `Recharge via ${channel || 'mock'}`]);
    return ok(res, { mock: true, credited: true });
  }
  if (!rz) return fail(res, 'Online payment is not configured. Please use UPI transfer.', 400);
  rz.orders.create({ amount: Math.round(amt * 100), currency: 'INR', receipt: 'rcpt_' + Date.now() }, async (err, order) => {
    if (err) return fail(res, err.error?.description || 'Razorpay error', 500);
    try {
      await query('INSERT INTO recharges (user_id, amount, channel, razorpay_order_id, status) VALUES ($1, $2, $3, $4, $5)', [req.user.id, amt, channel || 'razorpay', order.id, 'pending']);
      ok(res, { order_id: order.id, amount: order.amount, currency: order.currency, key_id: await getKeyId() });
    } catch (e) { fail(res, e.message, 500); }
  });
}));

app.post('/api/wallet/verify', userAuth, ah(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  if (!(await verifySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature))) return fail(res, 'Invalid signature', 400);
  const r = await get('SELECT * FROM recharges WHERE razorpay_order_id = $1 AND user_id = $2', [razorpay_order_id, req.user.id]);
  if (!r) return fail(res, 'Recharge not found', 404);
  if (r.status === 'success') return ok(res, { already: true });
  await query('UPDATE recharges SET status = $1, razorpay_payment_id = $2 WHERE id = $3', ['success', razorpay_payment_id, r.id]);
  await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [r.amount, req.user.id]);
  await query('INSERT INTO transactions (user_id, type, amount, status, note) VALUES ($1, $2, $3, $4, $5)', [req.user.id, 'recharge', r.amount, 'success', 'Recharge via Razorpay']);
  ok(res, { credited: true });
}));

app.post('/api/wallet/recharge/confirm', userAuth, ah(async (req, res) => {
  const { recharge_id, utr } = req.body;
  const r = await get('SELECT * FROM recharges WHERE id = $1 AND user_id = $2', [recharge_id, req.user.id]);
  if (!r) return fail(res, 'Recharge not found', 404);
  if (!utr) return fail(res, 'UTR required');
  await query('UPDATE recharges SET utr = $1, status = $2 WHERE id = $3', [utr, 'pending', r.id]);
  await query('INSERT INTO transactions (user_id, type, amount, status, note) VALUES ($1, $2, $3, $4, $5)', [req.user.id, 'recharge', r.amount, 'pending', 'Manual UPI recharge pending verification']);
  ok(res, { submitted: true });
}));

app.get('/api/wallet/balance', userAuth, ah(async (req, res) => {
  const u = await get('SELECT balance FROM users WHERE id = $1', [req.user.id]);
  ok(res, { balance: u.balance });
}));

app.get('/api/wallet/records', userAuth, ah(async (req, res) => {
  const txs = await all('SELECT * FROM transactions WHERE user_id = $1 ORDER BY id DESC LIMIT 100', [req.user.id]);
  ok(res, { records: txs });
}));

app.post('/api/wallet/withdraw', userAuth, ah(async (req, res) => {
  const { amount, password } = req.body;
  const user = await get('SELECT * FROM users WHERE id = $1', [req.user.id]);
  if (!user.withdraw_password_hash || !verifyPassword(password, user.withdraw_password_hash)) return fail(res, 'Invalid withdraw password', 401);
  const min = Number(await getConfig('min_withdraw'));
  const amt = Number(amount);
  if (!amt || amt < min) return fail(res, `Minimum withdraw ${min}`);
  if (user.balance < amt) return fail(res, 'Insufficient balance');
  const feePct = Number(await getConfig('withdraw_fee_percent'));
  const fee = +(amt * feePct / 100).toFixed(2);
  const net = +(amt - fee).toFixed(2);
  const bank = await get('SELECT * FROM bank_details WHERE user_id = $1', [req.user.id]);
  if (!bank) return fail(res, 'Please add bank details first');
  await query('UPDATE users SET balance = balance - $1 WHERE id = $2', [amt, req.user.id]);
  await query('INSERT INTO withdrawals (user_id, amount, fee, net, bank_snapshot, status) VALUES ($1, $2, $3, $4, $5, $6)', [
    req.user.id, amt, fee, net, JSON.stringify(bank), 'pending',
  ]);
  await query('INSERT INTO transactions (user_id, type, amount, status, note) VALUES ($1, $2, $3, $4, $5)', [req.user.id, 'withdraw', amt, 'pending', 'Withdrawal request']);
  ok(res, { fee, net });
}));

app.get('/api/wallet/withdraw_list', userAuth, ah(async (req, res) => {
  const list = await all('SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY id DESC', [req.user.id]);
  ok(res, { withdrawals: list });
}));

// ---------- USER ----------
app.get('/api/user/profile', userAuth, ah(async (req, res) => {
  const u = await get('SELECT id, phone, balance, invite_code, created_at FROM users WHERE id = $1', [req.user.id]);
  ok(res, { profile: u });
}));

app.get('/api/user/bank', userAuth, ah(async (req, res) => {
  const b = await get('SELECT * FROM bank_details WHERE user_id = $1', [req.user.id]);
  ok(res, { bank: b || null });
}));

app.post('/api/user/bank_save', userAuth, ah(async (req, res) => {
  const { holder, bank, account_no, ifsc, branch, address } = req.body;
  const existing = await get('SELECT id FROM bank_details WHERE user_id = $1', [req.user.id]);
  if (existing) {
    await query('UPDATE bank_details SET holder = $1, bank = $2, account_no = $3, ifsc = $4, branch = $5, address = $6, updated_at = now() WHERE user_id = $7', [holder, bank, account_no, ifsc, branch, address, req.user.id]);
  } else {
    await query('INSERT INTO bank_details (user_id, holder, bank, account_no, ifsc, branch, address) VALUES ($1, $2, $3, $4, $5, $6, $7)', [req.user.id, holder, bank, account_no, ifsc, branch, address]);
  }
  ok(res, {});
}));

app.post('/api/user/password', userAuth, ah(async (req, res) => {
  const { current, new_pwd } = req.body;
  const u = await get('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!verifyPassword(current, u.password_hash)) return fail(res, 'Current password wrong', 401);
  if (!new_pwd || new_pwd.length < 6) return fail(res, 'New password min 6 chars');
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(new_pwd), req.user.id]);
  ok(res, {});
}));

app.post('/api/user/pay_password', userAuth, ah(async (req, res) => {
  const { current, new_pwd } = req.body;
  const u = await get('SELECT withdraw_password_hash FROM users WHERE id = $1', [req.user.id]);
  if (u.withdraw_password_hash && current && !verifyPassword(current, u.withdraw_password_hash)) return fail(res, 'Current password wrong', 401);
  if (!new_pwd || new_pwd.length < 6) return fail(res, 'New password min 6 chars');
  await query('UPDATE users SET withdraw_password_hash = $1 WHERE id = $2', [hashPassword(new_pwd), req.user.id]);
  ok(res, {});
}));

// ---------- TEAM ----------
app.get('/api/team', userAuth, ah(async (req, res) => {
  const invited = await all('SELECT id, phone, created_at FROM users WHERE invited_by = $1', [req.user.id]);
  const totalRecharge = Number((await get("SELECT COALESCE(SUM(amount),0) as s FROM recharges WHERE user_id = $1 AND status = 'success'", [req.user.id])).s);
  const teamRecharge = Number((await get(`
    SELECT COALESCE(SUM(r.amount),0) as s FROM recharges r JOIN users u ON u.id = r.user_id
    WHERE u.invited_by = $1 AND r.status = 'success'
  `, [req.user.id])).s);
  ok(res, {
    invite_code: req.user.invite_code,
    total_invites: invited.length,
    members: invited,
    total_recharge: totalRecharge,
    team_recharge: teamRecharge,
  });
}));

// ---------- NOTICES / MESSAGES ----------
app.get('/api/messages', ah(async (req, res) => {
  ok(res, { messages: await all('SELECT * FROM notices ORDER BY id DESC') });
}));

app.get('/api/user/messages', userAuth, ah(async (req, res) => {
  ok(res, { messages: await all('SELECT * FROM notices ORDER BY id DESC') });
}));

// ---------- ADMIN API ----------
app.post('/admin-api/login', ah(async (req, res) => {
  const { tel, pwd } = req.body;
  const user = await get('SELECT * FROM users WHERE phone = $1 AND role = $2', [tel, 'admin']);
  if (!user || !verifyPassword(pwd, user.password_hash)) return fail(res, 'Invalid admin credentials', 401);
  const safe = { id: user.id, phone: user.phone, role: 'admin' };
  ok(res, { token: signAdminToken(safe), user: safe });
}));

// plans CRUD
app.get('/admin-api/plans', adminAuth, ah(async (req, res) => {
  ok(res, { plans: await all('SELECT * FROM plans ORDER BY sort_order ASC, id DESC') });
}));
app.post('/admin-api/plans', adminAuth, ah(async (req, res) => {
  const { name, price, daily_profit, duration_days, description, image_url, active, sort_order } = req.body;
  if (!name || !price || !daily_profit || !duration_days) return fail(res, 'Missing fields');
  const created = await query(
    'INSERT INTO plans (name, price, daily_profit, duration_days, description, image_url, active, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
    [name, Number(price), Number(daily_profit), Number(duration_days), description || '', image_url || '', active ? 1 : 0, Number(sort_order || 0)]
  );
  ok(res, { id: created.rows[0].id });
}));
app.put('/admin-api/plans/:id', adminAuth, ah(async (req, res) => {
  const { name, price, daily_profit, duration_days, description, image_url, active, sort_order } = req.body;
  await query(
    'UPDATE plans SET name = $1, price = $2, daily_profit = $3, duration_days = $4, description = $5, image_url = $6, active = $7, sort_order = $8 WHERE id = $9',
    [name, Number(price), Number(daily_profit), Number(duration_days), description || '', image_url || '', active ? 1 : 0, Number(sort_order || 0), req.params.id]
  );
  ok(res, {});
}));
app.delete('/admin-api/plans/:id', adminAuth, ah(async (req, res) => {
  await query('DELETE FROM plans WHERE id = $1', [req.params.id]);
  ok(res, {});
}));

// users
app.get('/admin-api/users', adminAuth, ah(async (req, res) => {
  const users = await all('SELECT id, phone, balance, role, invite_code, invited_by, created_at FROM users ORDER BY id DESC');
  ok(res, { users });
}));
app.post('/admin-api/users/:id/balance', adminAuth, ah(async (req, res) => {
  const { amount, note } = req.body;
  const amt = Number(amount);
  await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [amt, req.params.id]);
  await query('INSERT INTO transactions (user_id, type, amount, status, note) VALUES ($1, $2, $3, $4, $5)', [req.params.id, 'system_recharge', amt, 'success', note || 'Admin adjustment']);
  ok(res, {});
}));

// withdrawals
app.get('/admin-api/withdrawals', adminAuth, ah(async (req, res) => {
  const list = await all(`
    SELECT w.*, u.phone FROM withdrawals w LEFT JOIN users u ON u.id = w.user_id ORDER BY w.id DESC
  `);
  ok(res, { withdrawals: list });
}));
app.post('/admin-api/withdrawals/:id/approve', adminAuth, ah(async (req, res) => {
  const w = await get('SELECT * FROM withdrawals WHERE id = $1', [req.params.id]);
  if (!w) return fail(res, 'Not found', 404);
  await query('UPDATE withdrawals SET status = $1, processed_at = now() WHERE id = $2', ['paid', req.params.id]);
  await query('UPDATE transactions SET status = $1 WHERE user_id = $2 AND type = $3 AND amount = $4 AND status = $5', ['success', w.user_id, 'withdraw', w.amount, 'pending']);
  ok(res, {});
}));
app.post('/admin-api/withdrawals/:id/reject', adminAuth, ah(async (req, res) => {
  const w = await get('SELECT * FROM withdrawals WHERE id = $1', [req.params.id]);
  if (!w) return fail(res, 'Not found', 404);
  await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [w.amount, w.user_id]);
  await query('UPDATE withdrawals SET status = $1, processed_at = now() WHERE id = $2', ['failed', req.params.id]);
  ok(res, {});
}));

// manual recharges
app.get('/admin-api/recharges', adminAuth, ah(async (req, res) => {
  const list = await all(`
    SELECT r.*, u.phone FROM recharges r LEFT JOIN users u ON u.id = r.user_id ORDER BY r.id DESC
  `);
  ok(res, { recharges: list });
}));
app.post('/admin-api/recharges/:id/approve', adminAuth, ah(async (req, res) => {
  const r = await get('SELECT * FROM recharges WHERE id = $1', [req.params.id]);
  if (!r) return fail(res, 'Not found', 404);
  if (r.status === 'success') return ok(res, { already: true });
  await query('UPDATE recharges SET status = $1 WHERE id = $2', ['success', r.id]);
  await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [r.amount, r.user_id]);
  await query('UPDATE transactions SET status = $1 WHERE user_id = $2 AND type = $3 AND amount = $4 AND status = $5', ['success', r.user_id, 'recharge', r.amount, 'pending']);
  ok(res, {});
}));
app.post('/admin-api/recharges/:id/reject', adminAuth, ah(async (req, res) => {
  const r = await get('SELECT * FROM recharges WHERE id = $1', [req.params.id]);
  if (!r) return fail(res, 'Not found', 404);
  await query('UPDATE recharges SET status = $1 WHERE id = $2', ['failed', r.id]);
  await query('UPDATE transactions SET status = $1 WHERE user_id = $2 AND type = $3 AND amount = $4 AND status = $5', ['failed', r.user_id, 'recharge', r.amount, 'pending']);
  ok(res, {});
}));

// notices
app.get('/admin-api/notices', adminAuth, ah(async (req, res) => {
  ok(res, { notices: await all('SELECT * FROM notices ORDER BY id DESC') });
}));
app.post('/admin-api/notices', adminAuth, ah(async (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) return fail(res, 'Missing fields');
  const created = await query('INSERT INTO notices (title, body) VALUES ($1, $2) RETURNING id', [title, body]);
  ok(res, { id: created.rows[0].id });
}));
app.delete('/admin-api/notices/:id', adminAuth, ah(async (req, res) => {
  await query('DELETE FROM notices WHERE id = $1', [req.params.id]);
  ok(res, {});
}));

// config
app.get('/admin-api/config', adminAuth, ah(async (req, res) => {
  const cfg = await all('SELECT key, value FROM config');
  const obj = {};
  for (const c of cfg) obj[c.key] = c.value;
  ok(res, { config: obj });
}));
app.post('/admin-api/config', adminAuth, ah(async (req, res) => {
  const body = req.body || {};
  for (const [k, v] of Object.entries(body)) {
    await setConfig(k, String(v));
  }
  ok(res, {});
}));

// stats
app.get('/admin-api/stats', adminAuth, ah(async (req, res) => {
  const users = Number((await get('SELECT COUNT(*) as c FROM users')).c);
  const plans = Number((await get('SELECT COUNT(*) as c FROM plans')).c);
  const orders = Number((await get('SELECT COUNT(*) as c FROM orders')).c);
  const activeOrders = Number((await get("SELECT COUNT(*) as c FROM orders WHERE status = 'active'")).c);
  const pendingWd = Number((await get("SELECT COUNT(*) as c FROM withdrawals WHERE status = 'pending'")).c);
  const totalBalance = Number((await get('SELECT COALESCE(SUM(balance),0) as s FROM users')).s);
  ok(res, { users, plans, orders, activeOrders, pendingWd, totalBalance });
}));

// manual payout
app.post('/admin-api/payout/run', adminAuth, ah(async (req, res) => {
  ok(res, await runPayouts());
}));

// serve admin static
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// SPA fallback
app.get(/^\/(?!api|admin-api|admin).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// cron daily payout at 00:30 IST
cron.schedule('30 0 * * *', async () => {
  try { await runPayouts(); } catch (e) { console.error(e); }
}, { timezone: 'Asia/Kolkata' });

await seed().catch((e) => console.error('Seed failed:', e));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GHADI running on http://0.0.0.0:${PORT}`);
  console.log(`Admin panel: http://0.0.0.0:${PORT}/admin`);
});
