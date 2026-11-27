import { AccountError, accountEndpoint, accountOnly, branchAccount } from './accounts.js';

// Customer Drip Profile backend on Cloudflare.
// POST /api/rpc/<name> answers like the old Supabase functions (drip_pull, drip_push, drip_photo, drip_snap, drip_set_code).
// GET  /api/rt?t=<topic> is a WebSocket: a device sends "changed" after saving and every other device on the topic is told at once.
// Data lives in D1 (binding DB); the WebSocket hub is a Durable Object (binding RT).

const NATIVE = { id: 'native', items: 'drip_items', config: 'drip_config' };
const FUNDAMENTAL = { id: 'fundamental', items: 'fundamental_drip_items', config: 'fundamental_drip_config' };
const KINDS = new Set(['bean', 'folder', 'photo', 'snap', 'setting']);

class Fail extends Error { constructor(code, status = 400) { super(code); this.code = code; this.status = status; } }
const fail = (c, s) => { throw new Fail(c, s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (ms) => new Date(ms).toISOString();
const norm = (p) => String(p ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

const ready = new Map();
function schema(env, shop) {
  if (!ready.has(shop)) {
    const { items, config } = shop;
    const statements = [
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${items}(kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT, deleted INTEGER NOT NULL DEFAULT 0, updated_ms INTEGER NOT NULL, PRIMARY KEY(kind, id))`),
      env.DB.prepare(`CREATE INDEX IF NOT EXISTS ${items}_updated ON ${items}(updated_ms)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS ${config}(key TEXT PRIMARY KEY, value TEXT NOT NULL)`),
    ];
    if (shop === FUNDAMENTAL && env.FUNDAMENTAL_SETUP_SHA256) {
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO ${config}(key, value) VALUES ('code_sha256', ?)`)
        .bind(env.FUNDAMENTAL_SETUP_SHA256));
    }
    ready.set(shop, env.DB.batch(statements).catch((e) => { ready.delete(shop); throw e; }));
  }
  return ready.get(shop);
}

async function codeHash(env, shop) {
  const r = await env.DB.prepare(`SELECT value FROM ${shop.config} WHERE key='code_sha256'`).first();
  return r?.value;
}
async function check(env, shop, code) {
  const want = await codeHash(env, shop), n = norm(code);
  if (!want) fail('not_ready', 503);
  if (!n || (await sha256(n)) !== want) { await sleep(400); fail('bad_code', 403); }
}

// Splits upserts into batches of roughly 1 MB so large photos never hit D1 request limits.
async function upsert(env, shop, rows, keepTime, author = null) {
  const t0 = Date.now(); let batch = [], size = 0;
  const flush = async () => { if (batch.length) await env.DB.batch(batch); batch = []; size = 0; };
  for (const r of rows) {
    const k = String(r.k ?? ''), id = String(r.i ?? ''), del = r.x === true || r.x === 'true';
    if (!KINDS.has(k) || !id) fail('bad_rows');
    const data = del || r.d === undefined ? null : JSON.stringify(r.d);
    const ms = keepTime && r.t ? Date.parse(r.t) || t0 : t0;
    batch.push(env.DB.prepare(`INSERT INTO ${shop.items}(kind, id, data, deleted, updated_ms) VALUES (?,?,?,?,?)
      ON CONFLICT(kind, id) DO UPDATE SET data=excluded.data, deleted=excluded.deleted, updated_ms=excluded.updated_ms
      WHERE (${shop.items}.data IS NOT excluded.data OR ${shop.items}.deleted IS NOT excluded.deleted)
      AND (? IS NULL OR COALESCE(json_extract(${shop.items}.data, '$.v.ownerUsername')=?,json_extract(${shop.items}.data, '$.v.barista')=?))`)
      .bind(k, id, data, del ? 1 : 0, ms, author?.username ?? null, author?.username ?? null, author?.nativeNameReserved ? null : (author?.nativeName || author?.name || null)));
    size += (data ? data.length : 0) + 200;
    if (size > 900000 || batch.length >= 50) await flush();
  }
  await flush();
}

async function access(env, shop, body, req, write = false) {
  if (body.p_account === true) return branchAccount(env, req, shop.id, write);
  if (await accountOnly(env)) fail('account_required', 401);
  await check(env, shop, body.p_code);
  return null;
}

const authSetting = row => row.k === 'setting' &&
  (['adminPin','stockPin','baristas','baPins'].includes(row.i) || String(row.i).startsWith('baPin.'));

async function checkBaristaRows(env, shop, rows, user) {
  if (rows.some(row => row.k !== 'snap' || row.x === true || row.x === 'true' || ![user.name,user.nativeName].filter(Boolean).includes(row.d?.v?.barista))) fail('not_allowed', 403);
  for (let offset=0;offset<rows.length;offset+=50) {
    const ids=rows.slice(offset,offset+50).map(row=>String(row.i ?? ''));
    const found=await env.DB.prepare(`SELECT data FROM ${shop.items} WHERE kind='snap' AND id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all();
    if (found.results.some(row => {
      const snap = JSON.parse(row.data || 'null')?.v;
      return snap?.ownerUsername ? snap.ownerUsername !== user.username : (!snap || user.nativeNameReserved || snap.barista!==(user.nativeName||user.name));
    })) fail('not_allowed', 403);
  }
}

async function readRoster(env) {
  const entries=await Promise.all([NATIVE,FUNDAMENTAL].map(async shop=>{
    await schema(env,shop);
    const row=await env.DB.prepare(`SELECT data FROM ${shop.items} WHERE kind='setting' AND id='baristas' AND deleted=0`).first();
    const names=JSON.parse(row?.data || '[]');
    return [shop.id,Array.isArray(names) ? names.filter(name=>typeof name==='string') : []];
  }));
  return Object.fromEntries(entries);
}

const SAMPLE_BEANS = [
  {id:'sample-fund-thai',name:'Sample · Thailand Washed',country:'Thailand',region:'Chiang Mai',farm:'Example lot',farmer:'',variety:'Bourbon',process:'Washed',roast:'Light',altitude:'1,400 m',harvest:'',note:'Example coffee. Edit this entry in Admin Settings.',flavors:['Orange','Honey','Jasmine'],hue:28,sample:true},
  {id:'sample-fund-ethiopia',name:'Sample · Ethiopia Natural',country:'Ethiopia',region:'Guji',farm:'Example lot',farmer:'',variety:'Heirloom',process:'Natural',roast:'Light',altitude:'1,950 m',harvest:'',note:'Example coffee. Edit this entry in Admin Settings.',flavors:['Blueberry','Peach','Black tea'],hue:265,sample:true},
  {id:'sample-fund-colombia',name:'Sample · Colombia Honey',country:'Colombia',region:'Huila',farm:'Example lot',farmer:'',variety:'Caturra',process:'Honey',roast:'Light',altitude:'1,650 m',harvest:'',note:'Example coffee. Edit this entry in Admin Settings.',flavors:['Red apple','Caramelized','Almond'],hue:14,sample:true},
];

async function seedFundamental(env) {
  const rows = SAMPLE_BEANS.map((bean,o) => ['bean',bean.id,JSON.stringify({o,v:bean})]);
  rows.push(['setting','beansSet','true']);
  const terms = rows.map(() => '(?,?,?)').join(',');
  await env.DB.prepare(`WITH samples(kind,id,data) AS (VALUES ${terms})
    INSERT INTO ${FUNDAMENTAL.items}(kind,id,data,deleted,updated_ms)
    SELECT kind,id,data,0,? FROM samples
    WHERE NOT EXISTS (SELECT 1 FROM ${FUNDAMENTAL.items} WHERE kind='bean' OR (kind='setting' AND id='beansSet'))
    ON CONFLICT(kind,id) DO NOTHING`).bind(...rows.flat(),Date.now()).run();
}

async function sharedSnap(env, shop, ref) {
  const [id, key] = String(ref ?? '').split('.');
  if (!id || !key || key.length < 12) return null;
  const r = await env.DB.prepare(`SELECT data FROM ${shop.items} WHERE kind='snap' AND id=? AND deleted=0`).bind(id).first();
  if (!r?.data) return null;
  const v = (JSON.parse(r.data) || {}).v || {};
  return String(v.key ?? '').toLowerCase() === key.toLowerCase() ? v : null;
}

const F = {
  async drip_pull(env, a, shop, req) {
    const account=await access(env, shop, a, req);
    if (shop===FUNDAMENTAL && account?.user.admin) await seedFundamental(env);
    const now = Date.now();
    const since = a.p_since ? Date.parse(a.p_since) : NaN;
    const q = Number.isFinite(since)
      ? env.DB.prepare(`SELECT kind, id, data, deleted, updated_ms FROM ${shop.items} WHERE updated_ms > ?`).bind(since - 15000)
      : env.DB.prepare(`SELECT kind, id, data, deleted, updated_ms FROM ${shop.items}`);
    const { results } = await q.all();
    // Rows are written as text so the stored JSON is not parsed and re-encoded.
    const rows=account ? results.filter(r => !authSetting({k:r.kind,i:r.id})) : results;
    const parts = rows.map((r) => `{"k":${JSON.stringify(r.kind)},"i":${JSON.stringify(r.id)},"d":${r.data ?? 'null'},"x":${r.deleted ? 'true' : 'false'},"t":"${iso(r.updated_ms)}"}`);
    return { raw: `{"now":"${iso(now)}","rows":[${parts.join(',')}]}` };
  },
  async drip_push(env, a, shop, req) {
    const account=await access(env, shop, a, req, true);
    if (!Array.isArray(a.p_rows) || a.p_rows.length > 500 || a.p_rows.some(row => !row || typeof row !== 'object')) fail('bad_rows');
    if (account && a.p_rows.some(authSetting)) fail('not_allowed', 403);
    const barista=account?.role==='barista' ? {...account.user} : null;
    if(barista&&shop!==NATIVE)barista.nativeName='';
    if (barista) {
      await checkBaristaRows(env, shop, a.p_rows, barista);
      for (const row of a.p_rows) row.d.v.ownerUsername=barista.username;
    }
    await upsert(env, shop, a.p_rows, false, barista);
    return iso(Date.now());
  },
  async drip_photo(env, a, shop) {
    const id = String(a.p_bean ?? '');
    if (shop === FUNDAMENTAL) {
      const snap = await sharedSnap(env, shop, a.p_ref);
      if (!id || id !== String(snap?.bean?.id ?? '')) return null;
    }
    const r = await env.DB.prepare(`SELECT data FROM ${shop.items} WHERE kind='photo' AND id=? AND deleted=0`).bind(id).first();
    return { raw: r && r.data ? r.data : 'null' };
  },
  async drip_snap(env, a, shop) {
    return (await sharedSnap(env, shop, a.p_ref))?.payload ?? null;
  },
  // Public: the shop's brand colour set, so customer pages (no shop code) match the shop.
  async drip_theme(env, a, shop) {
    const r = await env.DB.prepare(`SELECT data FROM ${shop.items} WHERE kind='setting' AND id='theme' AND deleted=0`).first();
    let ci = 'apple', cvb = 'dark';
    try { const t = r && r.data ? JSON.parse(r.data) : null; if (t && /^native-(slate|mica)$/.test(t.ci)) ci = t.ci; if (t && t.cvb === 'light') cvb = 'light'; } catch (e) {}
    return { ci, cvb };
  },
  async drip_set_code(env, a, shop, req) {
    const account=await access(env, shop, a, req, true);
    if (account && !account.user.admin) fail('not_allowed', 403);
    const v = norm(a.p_new);
    if (v.length < 6 || v.length > 40) fail('bad_new_code');
    const other = shop === NATIVE ? FUNDAMENTAL : NATIVE;
    await schema(env, other);
    const hash = await sha256(v);
    const result = await env.DB.prepare(`UPDATE ${shop.config} SET value=? WHERE key='code_sha256'
      AND NOT EXISTS (SELECT 1 FROM ${other.config} WHERE key='code_sha256' AND value=?)`).bind(hash, hash).run();
    if (!result.meta.changes) fail('bad_new_code');
    return null;
  },
};

// One-time copy from the old database: {code, rows:[{k,i,d,x,t}]}. Sets the shop code if none is stored yet.
async function importRows(env, b) {
  if (await accountOnly(env)) fail('account_required', 401);
  const have = await codeHash(env, NATIVE);
  if (have) await check(env, NATIVE, b.code);
  if (!Array.isArray(b.rows)) fail('bad_rows');
  if (!have) {
    const n = norm(b.code); if (n.length < 6) fail('bad_code');
    await schema(env, FUNDAMENTAL);
    const hash = await sha256(n);
    const result = await env.DB.prepare(`INSERT INTO drip_config(key, value) SELECT 'code_sha256', ?
      WHERE NOT EXISTS (SELECT 1 FROM ${FUNDAMENTAL.config} WHERE key='code_sha256' AND value=?)`).bind(hash, hash).run();
    if (!result.meta.changes) fail('bad_code');
  }
  await upsert(env, NATIVE, b.rows, true);
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
    const shop = url.pathname.startsWith('/api/fundamental/') ? FUNDAMENTAL : NATIVE;
    const path = shop === FUNDAMENTAL ? '/api' + url.pathname.slice('/api/fundamental'.length) : url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (path === '/api/rt') {
      const t = url.searchParams.get('t') || '';
      if (req.headers.get('Upgrade') !== 'websocket' || !/^[A-Za-z0-9:_-]{8,120}$/.test(t)) return new Response('bad', { status: 400 });
      return env.RT.get(env.RT.idFromName(shop === FUNDAMENTAL ? 'fundamental/' + t : t)).fetch(req);
    }
    if (req.method !== 'POST') return json({ message: 'method' }, 405);
    try {
      const body = (await req.json().catch(() => ({}))) || {};
      if (url.pathname.startsWith('/api/accounts/')) {
        return await accountEndpoint(env,req,url.pathname.slice('/api/accounts/'.length),body,()=>readRoster(env));
      }
      await schema(env, shop);
      if (shop === NATIVE && path === '/api/import') return json(await importRows(env, body));
      const m = /^\/api\/rpc\/([a-z_]+)$/.exec(path);
      const fn = m && Object.prototype.hasOwnProperty.call(F, m[1]) ? F[m[1]] : null;
      if (!fn) return json({ message: 'not_found' }, 404);
      return json(await fn(env, body, shop, req));
    } catch (e) {
      if (e instanceof Fail || e instanceof AccountError) return json({ message: e.code }, e.status);
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
