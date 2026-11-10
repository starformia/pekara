// Tiny local server so you can run the whole app without Vercel: `npm run dev` -> http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const routes = {};
for (const f of fs.readdirSync(path.join(root, 'api'))) {
  routes['/api/' + f.replace(/\.js$/, '')] = (await import('./api/' + f)).default;
}
http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (routes[p]) return routes[p](req, res);
  const file = path.join(root, 'public', p === '/' ? 'index.html' : p);
  if (file.startsWith(path.join(root, 'public')) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.setHeader('content-type', file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
    return res.end(fs.readFileSync(file));
  }
  res.statusCode = 404; res.end('Not found');
}).listen(process.env.PORT || 3000, () => console.log('Bread Route on http://localhost:' + (process.env.PORT || 3000)));
