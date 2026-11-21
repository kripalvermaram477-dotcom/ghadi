import { getConfig } from './db.js';

export async function getRupayexConfig() {
  const token = ((await getConfig('rupayex_token')) || '').trim();
  const base = (((await getConfig('rupayex_base')) || 'https://rupayex.net').trim()).replace(/\/+$/, '');
  const enabled = (await getConfig('rupayex_enabled')) === '1' && !!token;
  return { token, base, enabled };
}

async function parseJson(res) {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { status: false, message: text.slice(0, 300) }; }
}

export async function createRupayexOrder({ amount, orderId, redirectUrl, mobile, remark }) {
  const { token, base, enabled } = await getRupayexConfig();
  if (!enabled) throw new Error('RupayEx is not configured');

  const res = await fetch(`${base}/api/create-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Api-Token': token,
    },
    body: JSON.stringify({
      user_token: token,
      amount: Number(amount),
      order_id: orderId,
      redirect_url: redirectUrl,
      customer_mobile: mobile || undefined,
      remark1: remark || undefined,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await parseJson(res);
  if (!res.ok || data.status !== true || !data.payment_url) {
    throw new Error(data.message || `RupayEx error (${res.status})`);
  }
  return data;
}

export async function checkRupayexOrder(orderId) {
  const { token, base, enabled } = await getRupayexConfig();
  if (!enabled) throw new Error('RupayEx is not configured');

  const url = `${base}/api/order-status?user_token=${encodeURIComponent(token)}&order_id=${encodeURIComponent(orderId)}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json', 'X-Api-Token': token },
    signal: AbortSignal.timeout(20000),
  });
  const data = await parseJson(res);
  if (!res.ok || data.status !== true) {
    throw new Error(data.message || `RupayEx error (${res.status})`);
  }
  return data;
}
