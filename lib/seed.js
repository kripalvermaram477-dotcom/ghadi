import { get, query } from './db.js';
import { hashPassword, genInviteCode } from './auth.js';

export async function seed() {
  const adminPhone = process.env.ADMIN_PHONE || '9999999999';
  const adminPwd = process.env.ADMIN_PASSWORD || 'admin123';
  const exists = await get('SELECT id FROM users WHERE phone = $1', [adminPhone]);
  if (!exists) {
    await query(
      'INSERT INTO users (phone, password_hash, withdraw_password_hash, invite_code, role) VALUES ($1, $2, $3, $4, $5)',
      [adminPhone, hashPassword(adminPwd), hashPassword(adminPwd), genInviteCode(), 'admin']
    );
    console.log('Admin created:', adminPhone);
  } else {
    await query('UPDATE users SET role = $1 WHERE phone = $2', ['admin', adminPhone]);
  }

  const count = Number((await get('SELECT COUNT(*) as c FROM plans')).c);
  if (count === 0) {
    const plans = [
      { name: 'Starter Plan', price: 500, daily: 25, days: 30, desc: 'Beginner friendly plan with steady daily returns.', sort: 1 },
      { name: 'Growth Plan', price: 2000, daily: 120, days: 30, desc: 'Balanced plan for growing your portfolio.', sort: 2 },
      { name: 'Premium Plan', price: 5000, daily: 350, days: 45, desc: 'High returns for serious investors.', sort: 3 },
      { name: 'Elite Plan', price: 10000, daily: 800, days: 60, desc: 'Top tier plan with maximum daily profit.', sort: 4 },
    ];
    for (const p of plans) {
      await query(
        'INSERT INTO plans (name, price, daily_profit, duration_days, description, active, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [p.name, p.price, p.daily, p.days, p.desc, 1, p.sort]
      );
    }
    console.log('Demo plans seeded.');
  }

  const n = Number((await get('SELECT COUNT(*) as c FROM notices')).c);
  if (n === 0) {
    await query('INSERT INTO notices (title, body) VALUES ($1, $2)', [
      'Welcome to GHADI',
      'Start investing today and earn daily profits. Invite friends to grow together!',
    ]);
  }
}
