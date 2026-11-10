import bcrypt from 'bcryptjs';
import { q } from '../lib/db.js';
import { send, readBody, startSession, publicUser, sameOrigin, COLORS, uid } from '../lib/auth.js';

// One-time first-run setup: creates the owner account. Refuses once any user exists.
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    if (!sameOrigin(req)) return send(res, 403, { error: 'bad_origin' });
    const n = (await q('select count(*)::int c from users'))[0].c;
    if (n > 0) return send(res, 403, { error: 'already_setup' });
    const b = await readBody(req);
    const username = String(b.username || '').trim().toLowerCase();
    const name = String(b.name || '').trim().slice(0, 60);
    const password = String(b.password || '');
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) return send(res, 400, { error: 'bad_username' });
    if (!name) return send(res, 400, { error: 'bad_name' });
    if (password.length < 6) return send(res, 400, { error: 'weak_password' });
    const id = uid();
    await q('insert into users(id,username,name,role,color,pass_hash) values($1,$2,$3,$4,$5,$6)',
      [id, username, name, 'admin', COLORS[0], await bcrypt.hash(password, 10)]);
    await q("insert into docs(coll,id,data) values('settings','main',$1::jsonb) on conflict do nothing",
      [JSON.stringify({ bakery: String(b.bakery || '').trim().slice(0, 60) || 'Fresh Bread' })]);
    const seed = Array.isArray(b.products) ? b.products.slice(0, 8) : [];
    let o = 1;
    for (const p of seed) {
      await q("insert into docs(coll,id,data) values('products',$1,$2::jsonb)",
        [uid(), JSON.stringify({ n: String(p.n || '').slice(0, 40), e: String(p.e || '🍞').slice(0, 8), price: Math.max(0, +p.price || 0), o: o++ })]);
    }
    await startSession(res, id);
    return send(res, 200, { me: publicUser({ id, username, name, role: 'admin', color: COLORS[0] }) });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'server', message: String(e.message || e) });
  }
}
