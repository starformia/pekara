import nodemailer from 'nodemailer';
import { q } from '../lib/db.js';
import { send, getUser, sameOrigin } from '../lib/auth.js';

const DEFAULT_TO = 'markokjanzo98@gmail.com';
const csv = (rows) => '﻿' + rows.map((r) => r.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
const paidOf = (d) => (d.pays || []).reduce((a, p) => a + p.a, 0);

export async function buildBackup() {
  const docs = await q('select coll, id, data from docs');
  const by = { clients: [], products: [], deliveries: [], expenses: [], monthly: [], cashdays: [], settings: [] };
  for (const r of docs) if (by[r.coll]) by[r.coll].push({ id: r.id, ...r.data });
  const staff = (await q('select username, name, role from users order by created_at'));
  const name = (id) => by.clients.find((c) => c.id === id)?.name || '';
  const ds = by.deliveries.slice().sort((a, b) => a.date.localeCompare(b.date));

  const deliveries = csv([['Date', 'Business', 'Items', 'Loaves', 'Total', 'Paid', 'Due', 'Added by'],
    ...ds.map((d) => [d.date, name(d.cid), d.items.map((i) => `${i.n} x${i.q} @${i.p}`).join('; '),
      d.items.reduce((a, i) => a + i.q, 0), d.total, paidOf(d), Math.max(0, d.total - paidOf(d)), d.bn])]);
  const payments = csv([['Date received', 'Business', 'Amount', 'Delivery date', 'Recorded by'],
    ...ds.flatMap((d) => (d.pays || []).map((p) => [p.t.slice(0, 10), name(d.cid), p.a, d.date, p.bn]))]);
  const expenses = csv([['Date', 'Category', 'Amount', 'Spread over months', 'Note', 'Added by'],
    ...by.expenses.sort((a, b) => a.date.localeCompare(b.date)).map((e) => [e.date, e.cat, e.amt, e.months || 1, e.note, e.bn])]);
  const cash = csv([['Day', 'Expected', 'Counted', 'Difference', 'Note', 'By'],
    ...by.cashdays.sort((a, b) => a.id.localeCompare(b.id)).map((c) => [c.id, c.expected, c.counted, c.counted - c.expected, c.note, c.bn])]);
  const owed = ds.reduce((a, d) => a + Math.max(0, d.total - paidOf(d)), 0);
  const month = new Date().toISOString().slice(0, 7);
  const mSales = ds.filter((d) => d.date.startsWith(month)).reduce((a, d) => a + d.total, 0);
  const mExp = by.expenses.filter((e) => e.date.startsWith(month)).reduce((a, e) => a + e.amt / (e.months || 1), 0);
  return {
    summary: { businesses: by.clients.length, deliveries: ds.length, owed, month, mSales, mExp },
    files: [
      { filename: 'deliveries.csv', content: deliveries }, { filename: 'payments.csv', content: payments },
      { filename: 'expenses.csv', content: expenses }, { filename: 'cash-counts.csv', content: cash },
      { filename: 'backup.json', content: JSON.stringify({ exportedAt: new Date().toISOString(), staff, ...by }, null, 1) },
    ],
    bakery: by.settings.find((s) => s.id === 'main')?.bakery || 'Bakery',
    backupTo: by.settings.find((s) => s.id === 'main')?.backupTo || '',
  };
}

export default async function handler(req, res) {
  try {
    const cron = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
    if (!cron) {
      if (req.method !== 'POST') return send(res, 405, { error: 'method' });
      if (!sameOrigin(req)) return send(res, 403, { error: 'bad_origin' });
      const me = await getUser(req);
      if (!me) return send(res, 401, { error: 'unauthenticated' });
      if (me.role !== 'admin') return send(res, 403, { error: 'admin_only' });
    }
    const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
    if (!user || !pass) return send(res, 400, { error: 'email_not_configured' });

    const b = await buildBackup();
    const to = b.backupTo || process.env.BACKUP_TO || DEFAULT_TO;
    const transport = user === 'test' ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com', port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT || 465) === 465, auth: { user, pass } });
    const date = new Date().toISOString().slice(0, 10);
    const s = b.summary, fmt = (n) => Math.round(n).toLocaleString('en-US') + ' MKD';
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM || `${b.bakery} <${user === 'test' ? 'test@example.com' : user}>`,
      to, subject: `${b.bakery} — backup ${date}`,
      text: `Backup of ${b.bakery} (${date})\n\nBusinesses: ${s.businesses}\nDeliveries: ${s.deliveries}\nTotal still owed: ${fmt(s.owed)}\n${s.month}: sales ${fmt(s.mSales)}, expenses ${fmt(s.mExp)}\n\nAttached: deliveries.csv, payments.csv, expenses.csv, cash-counts.csv (open in Excel) and backup.json (full copy of all data).`,
      attachments: b.files.map((f) => ({ filename: `${date}-${f.filename}`, content: f.content })),
    });
    return send(res, 200, { sent: true, to, id: info.messageId || null });
  } catch (e) {
    console.error(e);
    return send(res, 500, { error: 'server', message: String(e.message || e) });
  }
}
