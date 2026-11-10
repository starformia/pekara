import bcrypt from 'bcryptjs';
import { q } from '../lib/db.js';
import { send, readBody, getUser, startSession, endSession, publicUser, sameOrigin } from '../lib/auth.js';

export default async function handler(req, res) {
  try {
    if (!sameOrigin(req)) return send(res, 403, { error: 'bad_origin' });

    if (req.method === 'GET') {
      const n = (await q('select count(*)::int c from users'))[0].c;
      const u = await getUser(req);
      const s = (await q("select data from docs where coll='settings' and id='main'"))[0];
      return send(res, 200, { needsSetup: n === 0, me: u ? publicUser(u) : null, bakery: s?.data?.bakery || '' });
    }

    if (req.method === 'POST') {
      const b = await readBody(req);
      const username = String(b.username || '').trim().toLowerCase();
      const row = (await q('select * from users where username=$1', [username]))[0];
      const bad = () => send(res, 401, { error: 'invalid_credentials' });
      if (!row) { await bcrypt.compare('x', '$2a$10$abcdefghijklmnopqrstuuAbcdefghijklmnopqrstuvwxyz01234'); return bad(); }
      if (row.locked_until && new Date(row.locked_until) > new Date()) return send(res, 429, { error: 'locked' });
      const ok = await bcrypt.compare(String(b.password || ''), row.pass_hash);
      if (!ok) {
        const fails = row.fails + 1;
        if (fails >= 5) await q("update users set fails=0, locked_until=now()+interval '10 minutes' where id=$1", [row.id]);
        else await q('update users set fails=$2 where id=$1', [row.id, fails]);
        return bad();
      }
      await q('update users set fails=0, locked_until=null where id=$1', [row.id]);
      await startSession(res, row.id);
      return send(res, 200, { me: publicUser(row) });
    }

    if (req.method === 'DELETE') { endSession(res); return send(res, 200, { ok: true }); }
    return send(res, 405, { error: 'method' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'server', message: String(e.message || e) });
  }
}
