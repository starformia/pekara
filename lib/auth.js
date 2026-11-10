import { SignJWT, jwtVerify } from 'jose';
import { q } from './db.js';

const COOKIE = 'bk_session';
const prod = process.env.NODE_ENV === 'production';

function secret() {
  const s = process.env.AUTH_SECRET || (prod ? '' : 'dev-secret-change-me-dev-secret-0000');
  if (!s || s.length < 16) throw new Error('AUTH_SECRET is not set (use a long random string)');
  return new TextEncoder().encode(s);
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return {}; }
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export async function startSession(res, userId) {
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId).setIssuedAt().setExpirationTime('30d').sign(secret());
  res.setHeader('set-cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${prod ? '; Secure' : ''}`);
}

export function endSession(res) {
  res.setHeader('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${prod ? '; Secure' : ''}`);
}

export const publicUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, color: u.color });

// Returns the logged-in user (re-read from the DB on every call, so removing a user locks them out at once).
export async function getUser(req) {
  const t = cookies(req)[COOKIE];
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, secret());
    const rows = await q('select * from users where id=$1', [payload.sub]);
    return rows[0] || null;
  } catch { return null; }
}

// Basic CSRF guard: state-changing requests must come from our own origin.
export function sameOrigin(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

export const COLORS = ['#c0612b', '#2f7d4f', '#3b6ea5', '#8e4585', '#c28a0e', '#b3352a'];
export const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
