import { q } from '../lib/db.js';
import { send, getUser, publicUser } from '../lib/auth.js';

export default async function handler(req, res) {
  try {
    const me = await getUser(req);
    if (!me) return send(res, 401, { error: 'unauthenticated' });

    const url = new URL(req.url, 'http://x');
    const d = (await q('select count(*)::int c, max(updated_at)::text m from docs'))[0];
    const u = (await q("select md5(coalesce(string_agg(id||role||name,',' order by id),'')) h from users"))[0];
    const version = `${d.c}|${d.m}|${u.h}|${me.id}|${me.role}`;
    if (url.searchParams.get('v') === version) return send(res, 200, { same: true, version });

    const docs = await q('select coll, id, data from docs');
    const out = { clients: [], products: [], deliveries: [], expenses: [], monthly: [], settings: {} };
    for (const r of docs) {
      if (r.coll === 'settings') out.settings = { ...out.settings, ...r.data };
      else if (out[r.coll]) out[r.coll].push({ id: r.id, ...r.data });
    }
    if (me.role !== 'admin') { out.expenses = []; out.monthly = []; } // finances are owners-only
    const staff = (await q('select id, username, name, role, color from users order by created_at')).map(publicUser);
    return send(res, 200, { version, me: publicUser(me), staff, ...out });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'server', message: String(e.message || e) });
  }
}
