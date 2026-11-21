import pg from 'pg';

let _query;
let _exec;

if (process.env.DATABASE_URL) {
  const url = process.env.DATABASE_URL;
  // Managed providers (Neon, Render external) require SSL and put sslmode=require in the URL.
  // Render's internal URL does not use SSL, so only enable it when requested.
  const useSsl = /sslmode=(require|verify)/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
  _query = (text, params) => pool.query(text, params);
  _exec = (text) => pool.query(text);
} else {
  // Local development / single-process fallback: embedded Postgres (no install needed).
  const { PGlite } = await import('@electric-sql/pglite');
  const { mkdirSync } = await import('node:fs');
  const dataDir = process.env.PGLITE_PATH || './data/ghadi-pg';
  mkdirSync(dataDir, { recursive: true });
  const pglite = new PGlite(dataDir);
  _query = (text, params) => pglite.query(text, params);
  _exec = (text) => pglite.exec(text);
}

export async function query(text, params = []) {
  return _query(text, params);
}
export async function get(text, params = []) {
  const r = await _query(text, params);
  return r.rows[0] || null;
}
export async function all(text, params = []) {
  const r = await _query(text, params);
  return r.rows;
}
export async function run(text, params = []) {
  return _query(text, params);
}

await _exec(`
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  withdraw_password_hash TEXT,
  invite_code TEXT UNIQUE NOT NULL,
  invited_by INTEGER,
  balance DOUBLE PRECISION NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plans (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  daily_profit DOUBLE PRECISION NOT NULL,
  duration_days INTEGER NOT NULL,
  description TEXT,
  image_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  amount DOUBLE PRECISION NOT NULL,
  daily_profit DOUBLE PRECISION NOT NULL,
  days_total INTEGER NOT NULL,
  days_paid INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  last_payout_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS recharges (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount DOUBLE PRECISION NOT NULL,
  channel TEXT,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  utr TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS withdrawals (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  amount DOUBLE PRECISION NOT NULL,
  fee DOUBLE PRECISION NOT NULL DEFAULT 0,
  net DOUBLE PRECISION NOT NULL,
  bank_snapshot TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  processed_at TIMESTAMP
);
CREATE TABLE IF NOT EXISTS bank_details (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL REFERENCES users(id),
  holder TEXT,
  bank TEXT,
  account_no TEXT,
  ifsc TEXT,
  branch TEXT,
  address TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notices (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);
`);

const defaults = {
  site_name: 'GHADI',
  min_recharge: '100',
  min_withdraw: '230',
  withdraw_fee_percent: '5',
  withdraw_start: '00:30',
  withdraw_end: '17:30',
  razorpay_key_id: '',
  razorpay_key_secret: '',
  mock_payments: '0',
  upi_id: '',
  upi_name: 'GHADI',
  upi_qr: '',
  theme_primary: '#1e1b4b',
  theme_accent: '#f59e0b',
  theme_bg: '#f1f5f9',
  bg_image: '',
  bg_overlay: '0.45',
};
for (const [k, v] of Object.entries(defaults)) {
  await _query('INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING', [k, v]);
}

export async function getConfig(key) {
  const row = await get('SELECT value FROM config WHERE key = $1', [key]);
  return row ? row.value : null;
}
export async function setConfig(key, value) {
  await _query(
    'INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

export default { query, get, all, run, getConfig, setConfig };
