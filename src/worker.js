// Customer Drip Profile backend on Cloudflare.
// POST /api/rpc/<name> answers like the old Supabase functions (drip_pull, drip_push, drip_photo, drip_snap, drip_set_code).
// GET  /api/rt?t=<topic> is a WebSocket: a device sends "changed" after saving and every other device on the topic is told at once.
// Data lives in D1 (binding DB); the WebSocket hub is a Durable Object (binding RT).

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS drip_items(kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT, deleted INTEGER NOT NULL DEFAULT 0, updated_ms INTEGER NOT NULL, PRIMARY KEY(kind, id))`,
  `CREATE INDEX IF NOT EXISTS drip_items_updated ON drip_items(updated_ms)`,
  `CREATE TABLE IF NOT EXISTS drip_config(key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];
const KINDS = new Set(['bean', 'folder', 'photo', 'snap', 'setting']);

class Fail extends Error { constructor(code, status = 400) { super(code); this.code = code; this.status = status; } }
const fail = (c, s) => { throw new Fail(c, s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ms) => new Date(ms).toISOString();
const norm = (p) => String(p ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

let ready = null;
const schema = (env) => (ready ||= env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q))).catch((e) => { ready = null; throw e; }));

async function codeHash(env) {
  const r = await env.DB.prepare(`SELECT value FROM drip_config WHERE key='code_sha256'`).first();
  if (!r) fail('not_ready', 503);
  return r.value;
}
async function check(env, code) {
  const want = await codeHash(env), n = norm(code);
  if (!n || (await sha256(n)) !== want) { await sleep(400); fail('bad_code', 403); }
}

// Splits upserts into batches of roughly 1 MB so large photos never hit D1 request limits.
async function upsert(env, rows, keepTime) {
  const t0 = Date.now(); let batch = [], size = 0;
  const flush = async () => { if (batch.length) await env.DB.batch(batch); batch = []; size = 0; };
  for (const r of rows) {
    const k = String(r.k ?? ''), id = String(r.i ?? ''), del = r.x === true || r.x === 'true';
    if (!KINDS.has(k) || !id) fail('bad_rows');
    const data = del || r.d === undefined ? null : JSON.stringify(r.d);
    const ms = keepTime && r.t ? Date.parse(r.t) || t0 : t0;
    batch.push(env.DB.prepare(`INSERT INTO drip_items(kind, id, data, deleted, updated_ms) VALUES (?,?,?,?,?)
      ON CONFLICT(kind, id) DO UPDATE SET data=excluded.data, deleted=excluded.deleted, updated_ms=excluded.updated_ms
      WHERE drip_items.data IS NOT excluded.data OR drip_items.deleted IS NOT excluded.deleted`).bind(k, id, data, del ? 1 : 0, ms));
    size += (data ? data.length : 0) + 200;
    if (size > 900000 || batch.length >= 50) await flush();
  }
  await flush();
}

const F = {
  async drip_pull(env, a) {
    await check(env, a.p_code);
    const now = Date.now();
    const since = a.p_since ? Date.parse(a.p_since) : NaN;
    const q = Number.isFinite(since)
      ? env.DB.prepare('SELECT kind, id, data, deleted, updated_ms FROM drip_items WHERE updated_ms > ?').bind(since - 15000)
      : env.DB.prepare('SELECT kind, id, data, deleted, updated_ms FROM drip_items');
    const { results } = await q.all();
    // Rows are written as text so the stored JSON is not parsed and re-encoded.
    const parts = results.map((r) => `{"k":${JSON.stringify(r.kind)},"i":${JSON.stringify(r.id)},"d":${r.data ?? 'null'},"x":${r.deleted ? 'true' : 'false'},"t":"${iso(r.updated_ms)}"}`);
    return { raw: `{"now":"${iso(now)}","rows":[${parts.join(',')}]}` };
  },
  async drip_push(env, a) {
    await check(env, a.p_code);
    if (!Array.isArray(a.p_rows) || a.p_rows.length > 500) fail('bad_rows');
    await upsert(env, a.p_rows, false);
    return iso(Date.now());
  },
  async drip_photo(env, a) {
    const r = await env.DB.prepare(`SELECT data FROM drip_items WHERE kind='photo' AND id=? AND deleted=0`).bind(String(a.p_bean ?? '')).first();
    return { raw: r && r.data ? r.data : 'null' };
  },
  async drip_snap(env, a) {
    const [id, key] = String(a.p_ref ?? '').split('.');
    if (!id || !key || key.length < 12) return null;
    const r = await env.DB.prepare(`SELECT data FROM drip_items WHERE kind='snap' AND id=? AND deleted=0`).bind(id).first();
    if (!r || !r.data) return null;
    const v = (JSON.parse(r.data) || {}).v || {};
    return String(v.key ?? '').toLowerCase() === key.toLowerCase() ? (v.payload ?? null) : null;
  },
  async drip_set_code(env, a) {
    await check(env, a.p_code);
    const v = norm(a.p_new);
    if (v.length < 6 || v.length > 40) fail('bad_new_code');
    await env.DB.prepare(`UPDATE drip_config SET value=? WHERE key='code_sha256'`).bind(await sha256(v)).run();
    return null;
  },
};

// One-time copy from the old database: {code, rows:[{k,i,d,x,t}]}. Sets the shop code if none is stored yet.
async function importRows(env, b) {
  const have = await env.DB.prepare(`SELECT value FROM drip_config WHERE key='code_sha256'`).first();
  if (have) await check(env, b.code);
  if (!Array.isArray(b.rows)) fail('bad_rows');
  await upsert(env, b.rows, true);
  if (!have) {
    const n = norm(b.code); if (n.length < 6) fail('bad_code');
    await env.DB.prepare(`INSERT INTO drip_config(key, value) VALUES ('code_sha256', ?)`).bind(await sha256(n)).run();
  }
  const c = await env.DB.prepare('SELECT kind, count(*) n FROM drip_items GROUP BY kind').all();
  return { ok: true, counts: c.results };
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (o, status = 200) => new Response(o && typeof o === 'object' && 'raw' in o ? o.raw : JSON.stringify(o ?? null),
  { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/api/rt') {
      const t = url.searchParams.get('t') || '';
      if (req.headers.get('Upgrade') !== 'websocket' || !/^[A-Za-z0-9:_-]{8,120}$/.test(t)) return new Response('bad', { status: 400 });
      return env.RT.get(env.RT.idFromName(t)).fetch(req);
    }
    if (req.method !== 'POST') return json({ message: 'method' }, 405);
    try {
      await schema(env);
      const body = (await req.json().catch(() => ({}))) || {};
      if (url.pathname === '/api/import') return json(await importRows(env, body));
      const m = /^\/api\/rpc\/([a-z_]+)$/.exec(url.pathname);
      const fn = m && Object.prototype.hasOwnProperty.call(F, m[1]) ? F[m[1]] : null;
      if (!fn) return json({ message: 'not_found' }, 404);
      return json(await fn(env, body));
    } catch (e) {
      if (e instanceof Fail) return json({ message: e.code }, e.status);
      console.error(e && e.stack || String(e));
      return json({ message: 'server_error' }, 500);
    }
  },
};

// WebSocket hub, one per shop topic. Uses hibernation so idle connections cost nothing.
export class Hub {
  constructor(state) {
    this.state = state;
    try { state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); } catch (e) {}
  }
  async fetch() {
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  webSocketMessage(ws, msg) {
    if (msg !== 'changed') return;
    for (const o of this.state.getWebSockets()) if (o !== ws) { try { o.send('changed'); } catch (e) {} }
  }
  webSocketClose(ws, code) { try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch (e) {} }
  webSocketError(ws) { try { ws.close(1011, 'error'); } catch (e) {} }
}
