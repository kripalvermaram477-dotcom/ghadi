import Razorpay from 'razorpay';
import crypto from 'node:crypto';
import { getConfig } from './db.js';

export function getRazorpay() {
  const key_id = getConfig('razorpay_key_id');
  const key_secret = getConfig('razorpay_key_secret');
  if (!key_id || !key_secret) return null;
  return new Razorpay({ key_id, key_secret });
}

export function getKeyId() { return getConfig('razorpay_key_id') || ''; }

export function verifySignature(orderId, paymentId, signature) {
  const secret = getConfig('razorpay_key_secret');
  if (!secret) return false;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(orderId + '|' + paymentId);
  const digest = hmac.digest('hex');
  return digest === signature;
}