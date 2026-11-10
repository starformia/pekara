import { q } from '../lib/db.js';
import { send, readBody, getUser, sameOrigin, uid } from '../lib/auth.js';

const str = (v, n) => String(v ?? '').trim().slice(0, n);
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const paidOf = (d) => (d.pays || []).reduce((a, p) => a + p.a, 0);

const getDoc = async (coll, id) => (await q('select data from docs where coll=$1 and id=$2', [coll, id]))[0]?.data || null;
const putDoc = (coll, id, data) => q(
  `insert into docs(coll,id,data) values($1,$2,$3::jsonb)
   on conflict(coll,id) do update set data=excluded.data, updated_at=now()`, [coll, id, JSON.stringify(data)]);

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: 'method' });
    if (!sameOrigin(req)) return send(res, 403, { error: 'bad_origin' });
    const me = await getUser(req);
    if (!me) return send(res, 401, { error: 'unauthenticated' });
    const admin = me.role === 'admin';
    const b = await readBody(req);
    const { op, coll } = b;
    const id = str(b.id, 40) || null;
    const now = new Date().toISOString();

    if (op === 'set') {
      if (coll === 'clients') {
        const name = str(b.data?.name, 80);
        if (!name) return send(res, 400, { error: 'name_required' });
        const key = id || uid();
        const old = await getDoc('clients', key);
        const others = await q("select id, data->>'name' n from docs where coll='clients'");
        if (others.some((r) => r.id !== key && String(r.n || '').toLowerCase() === name.toLowerCase())) return send(res, 409, { error: 'name_taken' });
        await putDoc('clients', key, {
          name, contact: str(b.data.contact, 80), phone: str(b.data.phone, 40),
          address: str(b.data.address, 160), note: str(b.data.note, 300),
          terms: b.data.terms === null || b.data.terms === '' || b.data.terms === undefined ? null : Math.max(0, Math.min(365, Math.round(num(b.data.terms)))),
          standing: (() => {
            const st = b.data.standing; if (!st) return null;
            const days = [...new Set((st.days || []).map(Number).filter((d) => d >= 0 && d <= 6))];
            const items = Object.fromEntries(Object.entries(st.items || {}).slice(0, 40)
              .map(([k, v]) => [str(k, 40), Math.max(0, Math.round(num(v)))]).filter(([, v]) => v > 0));
            return days.length && Object.keys(items).length ? { days, items } : null;
          })(),
          prices: Object.fromEntries(Object.entries(b.data.prices || {}).slice(0, 40)
            .map(([k, v]) => [str(k, 40), Math.max(0, num(v))]).filter(([, v]) => v > 0)),
          at: old?.at || now });
        return send(res, 200, { id: key });
      }
      if (coll === 'products') {
        if (!admin) return send(res, 403, { error: 'admin_only' });
        const key = id || uid();
        const old = await getDoc('products', key);
        const rc = b.data?.recipe;
        const recipe = rc === undefined ? old?.recipe : rc === null ? null : {
          yield: Math.max(1, Math.round(num(rc.yield)) || 1),
          items: (Array.isArray(rc.items) ? rc.items : []).slice(0, 40).map((i) => ({
            n: str(i.n, 40), q: Math.max(0, num(i.q)), u: str(i.u, 8), p: Math.max(0, num(i.p)) }))
            .filter((i) => i.n || i.q || i.p) };
        await putDoc('products', key, {
          n: str(b.data?.n, 40) || 'Bread', e: str(b.data?.e, 8) || '🍞',
          price: Math.max(0, num(b.data?.price)), o: old?.o ?? Date.now(), ...(recipe ? { recipe } : {}) });
        return send(res, 200, { id: key });
      }
      if (coll === 'expenses') {
        if (!admin) return send(res, 403, { error: 'admin_only' });
        const amt = Math.max(0, num(b.data?.amt));
        if (!(amt > 0)) return send(res, 400, { error: 'bad_amount' });
        const key = id || uid();
        const old = await getDoc('expenses', key);
        const date = /^\d{4}-\d{2}-\d{2}$/.test(b.data?.date || '') ? b.data.date : now.slice(0, 10);
        await putDoc('expenses', key, { cat: str(b.data?.cat, 40) || 'other', amt, date, note: str(b.data?.note, 200),
          by: old?.by || me.id, bn: old?.bn || me.name, at: old?.at || now });
        return send(res, 200, { id: key });
      }
      if (coll === 'cashdays') {
        if (!admin) return send(res, 403, { error: 'admin_only' });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(id || '')) return send(res, 400, { error: 'bad_date' });
        const DEN = ['5000', '2000', '1000', '500', '200', '100', '50', '10'];
        const notes = {}; let counted = 0;
        for (const d of DEN) { const c = Math.max(0, Math.round(num(b.data?.notes?.[d]))); if (c) { notes[d] = c; counted += c * Number(d); } }
        const other = Math.max(0, num(b.data?.other)); counted += other;
        await putDoc('cashdays', id, { notes, other, counted, expected: num(b.data?.expected), note: str(b.data?.note, 200),
          by: me.id, bn: me.name, at: now });
        return send(res, 200, { counted });
      }
      if (coll === 'monthly') {
        if (!admin) return send(res, 403, { error: 'admin_only' });
        if (!/^\d{4}-\d{2}$/.test(id || '')) return send(res, 400, { error: 'bad_month' });
        await putDoc('monthly', id, { produced: Math.max(0, Math.round(num(b.data?.produced))) });
        return send(res, 200, { ok: true });
      }
      if (coll === 'settings') {
        if (!admin) return send(res, 403, { error: 'admin_only' });
        const cur = (await getDoc('settings', 'main')) || {};
        const next = { ...cur };
        if (b.data?.bakery !== undefined) next.bakery = str(b.data.bakery, 60) || 'Fresh Bread';
        if (b.data?.backupTo !== undefined) {
          const em = str(b.data.backupTo, 120);
          if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return send(res, 400, { error: 'bad_email' });
          next.backupTo = em;
        }
        await putDoc('settings', 'main', next);
        return send(res, 200, { ok: true });
      }
      if (coll === 'deliveries') {
        const items = (Array.isArray(b.data?.items) ? b.data.items : []).slice(0, 30).map((i) => ({
          pid: str(i.pid, 40), n: str(i.n, 40), e: str(i.e, 8),
          q: Math.max(0, Math.round(num(i.q))), p: Math.max(0, num(i.p)) })).filter((i) => i.q > 0);
        if (!items.length) return send(res, 400, { error: 'no_items' });
        const total = items.reduce((a, i) => a + i.q * i.p, 0);
        const date = /^\d{4}-\d{2}-\d{2}$/.test(b.data.date || '') ? b.data.date : now.slice(0, 10);
        if (id) { // edit an existing delivery (payments are kept)
          const old = await getDoc('deliveries', id);
          if (!old) return send(res, 404, { error: 'not_found' });
          if (!admin && old.by !== me.id) return send(res, 403, { error: 'not_yours' });
          await putDoc('deliveries', id, { ...old, date, items, total, note: str(b.data.note, 300) });
          return send(res, 200, { id });
        }
        if (!(await getDoc('clients', str(b.data.cid, 40)))) return send(res, 400, { error: 'unknown_client' });
        const pay0 = Math.min(total, Math.max(0, num(b.data.pay0)));
        const key = uid();
        await putDoc('deliveries', key, {
          cid: str(b.data.cid, 40), date, items, total, note: str(b.data.note, 300),
          pays: pay0 > 0 ? [{ a: pay0, t: now, by: me.id, bn: me.name }] : [],
          by: me.id, bn: me.name, at: now });
        return send(res, 200, { id: key });
      }
      return send(res, 400, { error: 'bad_collection' });
    }

    if (op === 'delete') {
      if (!id) return send(res, 400, { error: 'id_required' });
      if (coll === 'deliveries') {
        const d = await getDoc('deliveries', id);
        if (!d) return send(res, 200, { ok: true });
        if (!admin && d.by !== me.id) return send(res, 403, { error: 'not_yours' });
      } else if (coll === 'clients') {
        if (!admin) return send(res, 403, { error: 'admin_only' });
        const n = (await q("select count(*)::int c from docs where coll='deliveries' and data->>'cid'=$1", [id]))[0].c;
        if (n > 0 && !b.cascade) return send(res, 409, { error: 'has_deliveries' });
        if (n > 0) await q("delete from docs where coll='deliveries' and data->>'cid'=$1", [id]);
      } else if (coll === 'products' || coll === 'expenses') {
        if (!admin) return send(res, 403, { error: 'admin_only' });
      } else return send(res, 400, { error: 'bad_collection' });
      await q('delete from docs where coll=$1 and id=$2', [coll, id]);
      return send(res, 200, { ok: true });
    }

    if (op === 'pay') {
      const d = id && await getDoc('deliveries', id);
      if (!d) return send(res, 404, { error: 'not_found' });
      const a = Math.min(num(b.amount), d.total - paidOf(d));
      if (!(a > 0)) return send(res, 400, { error: 'nothing_due' });
      d.pays = [...(d.pays || []), { a, t: now, by: me.id, bn: me.name }];
      await putDoc('deliveries', id, d);
      return send(res, 200, { paid: a });
    }

    if (op === 'unpay') {
      const d = id && await getDoc('deliveries', id);
      if (!d) return send(res, 404, { error: 'not_found' });
      const i = Math.round(num(b.index));
      if (!d.pays || !d.pays[i]) return send(res, 400, { error: 'bad_index' });
      d.pays.splice(i, 1);
      await putDoc('deliveries', id, d);
      return send(res, 200, { ok: true });
    }

    if (op === 'collect') {
      const cid = str(b.cid, 40);
      let left = num(b.amount);
      if (!(left > 0)) return send(res, 400, { error: 'bad_amount' });
      const rows = await q("select id, data from docs where coll='deliveries' and data->>'cid'=$1", [cid]);
      const open = rows.filter((r) => r.data.total - paidOf(r.data) > 0)
        .sort((x, y) => x.data.date.localeCompare(y.data.date) || x.data.at.localeCompare(y.data.at));
      let applied = 0;
      for (const r of open) {
        if (left <= 0) break;
        const a = Math.min(left, r.data.total - paidOf(r.data));
        r.data.pays = [...(r.data.pays || []), { a, t: now, by: me.id, bn: me.name }];
        await putDoc('deliveries', r.id, r.data);
        left -= a; applied += a;
      }
      return send(res, 200, { applied });
    }

    return send(res, 400, { error: 'bad_op' });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'server', message: String(e.message || e) });
  }
}
