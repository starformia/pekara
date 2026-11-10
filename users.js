import bcrypt from 'bcryptjs';
import { q } from '../lib/db.js';
import { send, readBody, getUser, sameOrigin, publicUser, COLORS, uid } from '../lib/auth.js';

export default async function handler(req, res) {
  try {
    if (!sameOrigin(req)) return send(res, 403, { error: 'bad_origin' });
    const me = await getUser(req);
    if (!me) return send(res, 401, { error: 'unauthenticated' });
    const admin = me.role === 'admin';
    const b = await readBody(req);

    // Create a team member (admin only)
    if (req.method === 'POST') {
      if (!admin) return send(res, 403, { error: 'admin_only' });
      const username = String(b.username || '').trim().toLowerCase();
      const name = String(b.name || '').trim().slice(0, 60);
      if (!/^[a-z0-9._-]{3,30}$/.test(username)) return send(res, 400, { error: 'bad_username' });
      if (!name) return send(res, 400, { error: 'bad_name' });
      if (String(b.password || '').length < 6) return send(res, 400, { error: 'weak_password' });
      if ((await q('select 1 from users where username=$1', [username])).length) return send(res, 409, { error: 'username_taken' });
      const n = (await q('select count(*)::int c from users'))[0].c;
      const u = { id: uid(), username, name, role: b.role === 'staff' ? 'staff' : 'admin', color: COLORS[n % COLORS.length] };
      await q('insert into users(id,username,name,role,color,pass_hash) values($1,$2,$3,$4,$5,$6)',
        [u.id, u.username, u.name, u.role, u.color, await bcrypt.hash(String(b.password), 10)]);
      return send(res, 200, { user: publicUser(u) });
    }

    // Change password / role / name
    if (req.method === 'PATCH') {
      const target = (await q('select * from users where id=$1', [String(b.id || '')]))[0];
      if (!target) return send(res, 404, { error: 'not_found' });
      const self = target.id === me.id;
      if (!admin && !self) return send(res, 403, { error: 'admin_only' });
      if (b.password !== undefined) {
        if (String(b.password).length < 6) return send(res, 400, { error: 'weak_password' });
        if (self && !(await bcrypt.compare(String(b.current || ''), me.pass_hash))) return send(res, 403, { error: 'wrong_current' });
        await q('update users set pass_hash=$2, fails=0, locked_until=null where id=$1', [target.id, await bcrypt.hash(String(b.password), 10)]);
      }
      if (b.role !== undefined && admin) {
        const role = b.role === 'admin' ? 'admin' : 'staff';
        if (target.role === 'admin' && role !== 'admin') {
          const admins = (await q("select count(*)::int c from users where role='admin'"))[0].c;
          if (admins <= 1) return send(res, 409, { error: 'last_admin' });
        }
        await q('update users set role=$2 where id=$1', [target.id, role]);
      }
      if (b.name !== undefined && String(b.name).trim()) await q('update users set name=$2 where id=$1', [target.id, String(b.name).trim().slice(0, 60)]);
      return send(res, 200, { ok: true });
    }

    if (req.method === 'DELETE') {
      if (!admin) return send(res, 403, { error: 'admin_only' });
      const id = String(b.id || '');
      if (id === me.id) return send(res, 409, { error: 'cannot_remove_self' });
      await q('delete from users where id=$1', [id]);
      return send(res, 200, { ok: true });
    }
    return send(res, 405, { error: 'method' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'server', message: String(e.message || e) });
  }
}
