import Razorpay from 'razorpay';
import crypto from 'node:crypto';
import { getConfig } from './db.js';

export async function getRazorpay() {
  const key_id = await getConfig('razorpay_key_id');
  const key_secret = await getConfig('razorpay_key_secret');
  if (!key_id || !key_secret) return null;
  return new Razorpay({ key_id, key_secret });
}

export async function getKeyId() { return (await getConfig('razorpay_key_id')) || ''; }

export async function verifySignature(orderId, paymentId, signature) {
  const secret = await getConfig('razorpay_key_secret');
  if (!secret || !signature) return false;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(orderId + '|' + paymentId);
  const digest = hmac.digest('hex');
  return digest === signature;
}
