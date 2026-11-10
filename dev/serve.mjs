// Local stand-in for Cloudflare: serves <repo>/public and routes /api/* to <repo>/src/worker.js with a D1-like SQLite shim.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const [repo, port, dbfile] = [process.argv[2], +process.argv[3], process.argv[4] || ':memory:'];
const db = new DatabaseSync(dbfile);
const clean = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
class Stmt {
  constructor(sql, args = []) { this.sql = sql; this.args = args; }
  bind(...a) { return new Stmt(this.sql, a.map(clean)); }
  _p() { return db.prepare(this.sql); }
  async first() { const r = this._p().get(...this.args); return r ? { ...r } : null; }
  async all() { return { results: this._p().all(...this.args).map((r) => ({ ...r })), success: true, meta: {} }; }
  async run() { const r = this._p().run(...this.args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
  _exec() { return /^\s*(select|with)/i.test(this.sql) ? { results: this._p().all(...this.args).map((r) => ({ ...r })), meta: {} } : { results: [], meta: { changes: Number(this._p().run(...this.args).changes) } }; }
}
const DB = {
  prepare: (sql) => new Stmt(sql),
  async batch(list) { db.exec('BEGIN'); try { const out = list.map((s) => s._exec()); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } },
};
globalThis.__DB = db;
const worker = (await import(pathToFileURL(path.join(repo, 'src/worker.js')).href)).default;
const pub = path.join(repo, 'public');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const ASSETS = { async fetch(req) {
  const u = new URL(req.url); let f = path.join(pub, decodeURIComponent(u.pathname));
  if (!f.startsWith(pub) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(pub, 'index.html');
  return new Response(fs.readFileSync(f), { headers: { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' } });
} };
const env = { DB, ASSETS, RT: { idFromName: (n) => n, get: () => ({ fetch: async () => new Response('no ws in test', { status: 501 }) }) } };
http.createServer(async (q, s) => {
  const chunks = []; for await (const c of q) chunks.push(c);
  const req = new Request('http://localhost:' + port + q.url, { method: q.method, headers: q.headers, body: ['GET', 'HEAD'].includes(q.method) ? undefined : Buffer.concat(chunks) });
  const waits = [];
  try {
    const r = await worker.fetch(req, env, { waitUntil: (p) => waits.push(p) });
    s.writeHead(r.status, Object.fromEntries(r.headers)); s.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { console.error(e); s.writeHead(500); s.end(String(e)); }
  await Promise.allSettled(waits);
}).listen(port, () => console.log('listening', port));
