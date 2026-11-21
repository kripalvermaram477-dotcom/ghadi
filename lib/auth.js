import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { get } from './db.js';

const USER_SECRET = process.env.USER_JWT_SECRET || 'ghadi-user-secret-change-me';
const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET || 'ghadi-admin-secret-change-me';

export function hashPassword(p) { return bcrypt.hashSync(p, 10); }
export function verifyPassword(p, h) { return bcrypt.compareSync(p, h); }

export function signUserToken(user) {
  return jwt.sign({ id: user.id, phone: user.phone, role: user.role }, USER_SECRET, { expiresIn: '30d' });
}
export function signAdminToken(user) {
  return jwt.sign({ id: user.id, phone: user.phone, role: 'admin' }, ADMIN_SECRET, { expiresIn: '7d' });
}

export function verifyUserToken(token) {
  try { return jwt.verify(token, USER_SECRET); } catch { return null; }
}
export function verifyAdminToken(token) {
  try {
    const p = jwt.verify(token, ADMIN_SECRET);
    if (p.role !== 'admin') return null;
    return p;
  } catch { return null; }
}

export async function userAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  const p = t ? verifyUserToken(t) : null;
  if (!p) return res.status(401).json({ code: 401, info: 'Unauthorized' });
  const user = await get('SELECT id, phone, balance, role, invite_code FROM users WHERE id = $1', [p.id]);
  if (!user) return res.status(401).json({ code: 401, info: 'Unauthorized' });
  req.user = user;
  next();
}

export async function adminAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  const p = t ? verifyAdminToken(t) : null;
  if (!p) return res.status(401).json({ code: 401, info: 'Unauthorized' });
  const user = await get('SELECT id, phone, role FROM users WHERE id = $1 AND role = $2', [p.id, 'admin']);
  if (!user) return res.status(403).json({ code: 403, info: 'Forbidden' });
  req.admin = user;
  next();
}

export function genInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
