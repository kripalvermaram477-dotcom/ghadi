import { db } from './db.js';

export function runPayouts() {
  const now = new Date().toISOString();
  const orders = db.prepare("SELECT * FROM orders WHERE status = 'active'").all();
  let credited = 0;
  for (const o of orders) {
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(o.daily_profit, o.user_id);
    const newPaid = o.days_paid + 1;
    if (newPaid >= o.days_total) {
      db.prepare("UPDATE orders SET days_paid = ?, status = 'completed', last_payout_at = ? WHERE id = ?").run(newPaid, now, o.id);
    } else {
      db.prepare('UPDATE orders SET days_paid = ?, last_payout_at = ? WHERE id = ?').run(newPaid, now, o.id);
    }
    db.prepare('INSERT INTO transactions (user_id, type, amount, status, note) VALUES (?, ?, ?, ?, ?)').run(
      o.user_id, 'income', o.daily_profit, 'success', `Daily profit from plan order #${o.id}`
    );
    credited++;
  }
  return { credited, total: orders.length };
}

export function getOrderEarnings(userId) {
  return db.prepare(`
    SELECT o.id, o.plan_id, p.name as plan_name, o.amount, o.daily_profit, o.days_total, o.days_paid, o.status, o.created_at, o.last_payout_at
    FROM orders o LEFT JOIN plans p ON p.id = o.plan_id
    WHERE o.user_id = ? ORDER BY o.id DESC
  `).all(userId);
}