import { db } from '../lib/db.js';
import { hashPassword, genInviteCode } from '../lib/auth.js';

const adminPhone = process.env.ADMIN_PHONE || '9999999999';
const adminPwd = process.env.ADMIN_PASSWORD || 'admin123';
const exists = db.prepare('SELECT id FROM users WHERE phone = ?').get(adminPhone);
if (!exists) {
  db.prepare('INSERT INTO users (phone, password_hash, withdraw_password_hash, invite_code, role) VALUES (?,?,?,?,?)')
    .run(adminPhone, hashPassword(adminPwd), hashPassword(adminPwd), genInviteCode(), 'admin');
  console.log('Admin created:', adminPhone, adminPwd);
} else {
  db.prepare('UPDATE users SET role = ? WHERE phone = ?').run('admin', adminPhone);
  console.log('Admin exists, role set.');
}

const count = db.prepare('SELECT COUNT(*) as c FROM plans').get().c;
if (count === 0) {
  const plans = [
    { name: 'Starter Plan', price: 500, daily: 25, days: 30, desc: 'Beginner friendly plan with steady daily returns.', sort: 1 },
    { name: 'Growth Plan', price: 2000, daily: 120, days: 30, desc: 'Balanced plan for growing your portfolio.', sort: 2 },
    { name: 'Premium Plan', price: 5000, daily: 350, days: 45, desc: 'High returns for serious investors.', sort: 3 },
    { name: 'Elite Plan', price: 10000, daily: 800, days: 60, desc: 'Top tier plan with maximum daily profit.', sort: 4 },
  ];
  for (const p of plans) {
    db.prepare('INSERT INTO plans (name, price, daily_profit, duration_days, description, active, sort_order) VALUES (?,?,?,?,?,?,?)')
      .run(p.name, p.price, p.daily, p.days, p.desc, 1, p.sort);
  }
  console.log('Demo plans seeded.');
}
const n = db.prepare('SELECT COUNT(*) as c FROM notices').get().c;
if (n === 0) {
  db.prepare('INSERT INTO notices (title, body) VALUES (?,?)').run('Welcome to GHADI', 'Start investing today and earn daily profits. Invite friends to grow together!');
}
console.log('Seed done.');