import { query, all } from './db.js';

export async function runPayouts() {
  const now = new Date();
  const orders = await all("SELECT * FROM orders WHERE status = 'active'");
  let credited = 0;
  for (const o of orders) {
    await query('UPDATE users SET balance = balance + $1 WHERE id = $2', [o.daily_profit, o.user_id]);
    const newPaid = o.days_paid + 1;
    if (newPaid >= o.days_total) {
      await query("UPDATE orders SET days_paid = $1, status = 'completed', last_payout_at = $2 WHERE id = $3", [newPaid, now, o.id]);
    } else {
      await query('UPDATE orders SET days_paid = $1, last_payout_at = $2 WHERE id = $3', [newPaid, now, o.id]);
    }
    await query('INSERT INTO transactions (user_id, type, amount, status, note) VALUES ($1, $2, $3, $4, $5)', [
      o.user_id, 'income', o.daily_profit, 'success', `Daily profit from plan order #${o.id}`
    ]);
    credited++;
  }
  return { credited, total: orders.length };
}

export async function getOrderEarnings(userId) {
  return all(`
    SELECT o.id, o.plan_id, p.name as plan_name, o.amount, o.daily_profit, o.days_total, o.days_paid, o.status, o.created_at, o.last_payout_at
    FROM orders o LEFT JOIN plans p ON p.id = o.plan_id
    WHERE o.user_id = $1 ORDER BY o.id DESC
  `, [userId]);
}
