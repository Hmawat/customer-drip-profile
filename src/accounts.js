const COOKIE = '__Host-drip-user';
const SESSION_SECONDS = 8 * 60 * 60;
const INVITE_MS = 48 * 60 * 60 * 1000;
const BRANCHES = ['native', 'fundamental'];
const ROLES = new Set(['viewer', 'barista', 'manager']);
const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const random = size => hex(crypto.getRandomValues(new Uint8Array(size)));
const sha = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
const usernameOf = value => String(value ?? '').trim().toLowerCase();

export class AccountError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new AccountError(code, status); };
const json = (data, cookie) => {
  const headers = {'Content-Type':'application/json', 'Cache-Control':'no-store'};
  if (cookie !== undefined) {
    headers['Set-Cookie'] = COOKIE + '=' + cookie + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + (cookie ? SESSION_SECONDS : 0);
  }
  return new Response(JSON.stringify(data), {headers});
};

let initialized = false;
async function schema(env) {
  if (initialized) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS staff_accounts(username TEXT PRIMARY KEY, name TEXT NOT NULL, roles TEXT NOT NULL, password TEXT, invite_hash TEXT, invite_until INTEGER, disabled INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS staff_sessions(token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, expires INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS staff_access(key TEXT PRIMARY KEY, value INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS staff_login_limits(ip TEXT PRIMARY KEY, start INTEGER NOT NULL, attempts INTEGER NOT NULL)"),
  ]);
  initialized = true;
}

export async function accountOnly(env) {
  await schema(env);
  return !!(await env.DB.prepare("SELECT value FROM staff_access WHERE key='account_only'").first())?.value;
}

function sameOrigin(req) {
  const origin = req.headers.get('Origin');
  if (origin && origin !== new URL(req.url).origin) fail('not_allowed', 403);
}

function tokenOf(req) {
  return (req.headers.get('Cookie') || '').match(/(?:^|;\s*)__Host-drip-user=([a-f0-9]{64})(?:;|$)/)?.[1];
}

function publicUser(row) {
  const admin = row.username === 'admin';
  return {username:row.username, name:row.name, admin, roles:JSON.parse(row.roles)};
}

const owner = () => publicUser({username:'admin', name:'Admin', roles:'{"native":"manager","fundamental":"manager"}'});
const sessionKey = (env, token) => sha(env.ACCOUNT_OWNER_PASSWORD_HASH + ':' + token);

export async function accountUser(env, req) {
  sameOrigin(req);
  const token = tokenOf(req);
  if (!token) return null;
  await schema(env);
  const session = await env.DB.prepare('SELECT username FROM staff_sessions WHERE token_hash=? AND expires>?')
    .bind(await sessionKey(env, token), Date.now()).first();
  if (!session) return null;
  if (session.username === 'admin') return env.ACCOUNT_OWNER_PASSWORD_HASH ? owner() : null;
  const row = await env.DB.prepare('SELECT username,name,roles FROM staff_accounts WHERE username=? AND disabled=0 AND password IS NOT NULL')
    .bind(session.username).first();
  return row ? publicUser(row) : null;
}

export async function branchAccount(env, req, branch, write = false) {
  const user = await accountUser(env, req);
  if (!user) fail('account_required', 401);
  const role = user.roles[branch];
  if (!role || (write && role === 'viewer')) fail('not_allowed', 403);
  return {role, user};
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bytes = await crypto.subtle.deriveBits({name:'PBKDF2', salt:encoder.encode(salt), iterations:100000, hash:'SHA-256'}, key, 256);
  return salt + ':' + hex(new Uint8Array(bytes));
}

async function login(env, req, body) {
  const username = usernameOf(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!USERNAME.test(username) || password.length < 12 || password.length > 128) fail('invalid_login', 401);
  const now = Date.now();
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const window = 15 * 60 * 1000;
  const limit = await env.DB.prepare(`INSERT INTO staff_login_limits(ip,start,attempts) VALUES (?,?,1)
    ON CONFLICT(ip) DO UPDATE SET start=CASE WHEN start<=? THEN excluded.start ELSE start END,
    attempts=CASE WHEN start<=? THEN 1 ELSE MIN(attempts+1,41) END RETURNING attempts`)
    .bind(ip, now, now-window, now-window).first();
  if (limit.attempts > 40) fail('retry_later', 429);
  let user;
  if (username === 'admin') {
    if (env.ACCOUNT_OWNER_PASSWORD_HASH && await sha(password) === env.ACCOUNT_OWNER_PASSWORD_HASH) user = owner();
  } else {
    const row = await env.DB.prepare('SELECT username,name,roles,password FROM staff_accounts WHERE username=? AND disabled=0').bind(username).first();
    const hash = await passwordHash(password, row?.password?.split(':')[0] || 'inactive-account-password-check');
    if (row?.password && hash === row.password) user = publicUser(row);
  }
  if (!user) fail('invalid_login', 401);
  const token = random(32);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM staff_sessions WHERE expires<=?').bind(now),
    env.DB.prepare('DELETE FROM staff_login_limits WHERE start<=?').bind(now-window),
    env.DB.prepare('INSERT INTO staff_sessions(token_hash,username,expires) VALUES (?,?,?)')
      .bind(await sessionKey(env, token), username, now + SESSION_SECONDS * 1000),
  ]);
  return json({user}, token);
}

async function activate(env, body) {
  const {token,password} = body;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) fail('invalid_invite');
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail('invalid_password');
  const inviteHash = await sha(token);
  const pending = await env.DB.prepare('SELECT username FROM staff_accounts WHERE invite_hash=? AND invite_until>? AND disabled=0')
    .bind(inviteHash, Date.now()).first();
  if (!pending) fail('invalid_invite');
  const passwordValue = await passwordHash(password, random(16));
  const result = await env.DB.prepare('UPDATE staff_accounts SET password=?,invite_hash=NULL,invite_until=NULL WHERE username=? AND invite_hash=? AND invite_until>? AND disabled=0')
    .bind(passwordValue, pending.username, inviteHash, Date.now()).run();
  if (!result.meta.changes) fail('invalid_invite');
  return json({username:pending.username});
}

async function saveUser(env, body) {
  const username = usernameOf(body.username);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!USERNAME.test(username) || username === 'admin' || !name || name.length > 80) fail('invalid_user');
  const roles = Object.fromEntries(BRANCHES.filter(branch => ROLES.has(body.roles?.[branch])).map(branch => [branch,body.roles[branch]]));
  const disabled = body.disabled === true ? 1 : 0;
  if (!disabled && !Object.keys(roles).length) fail('choose_role');
  const existing = await env.DB.prepare('SELECT username FROM staff_accounts WHERE username=?').bind(username).first();
  const create = !existing;
  const token = !disabled && (create || body.reset === true) ? random(32) : null;
  if (create && !token) fail('invalid_user');
  const values = [name, JSON.stringify(roles), disabled, username];
  if (token && create) {
    const result = await env.DB.prepare('INSERT OR IGNORE INTO staff_accounts(name,roles,disabled,username,invite_hash,invite_until) VALUES (?,?,?,?,?,?)')
      .bind(...values, await sha(token), Date.now()+INVITE_MS).run();
    if (!result.meta.changes) fail('username_taken', 409);
  } else if (token || disabled) {
    await env.DB.batch([
      env.DB.prepare('UPDATE staff_accounts SET name=?,roles=?,disabled=?,password=CASE WHEN ? THEN NULL ELSE password END,invite_hash=?,invite_until=? WHERE username=?')
        .bind(name, JSON.stringify(roles), disabled, token ? 1 : 0, token ? await sha(token) : null, token ? Date.now()+INVITE_MS : null, username),
      env.DB.prepare('DELETE FROM staff_sessions WHERE username=?').bind(username),
    ]);
  } else {
    await env.DB.prepare('UPDATE staff_accounts SET name=?,roles=?,disabled=? WHERE username=?').bind(...values).run();
  }
  return json({username,token});
}

export async function accountEndpoint(env, req, action, body, readRoster) {
  sameOrigin(req);
  await schema(env);
  if (action === 'login') return await login(env, req, body);
  if (action === 'activate') return await activate(env, body);
  if (action === 'status') return json({user:await accountUser(env, req), enforced:await accountOnly(env)});
  if (action === 'logout') {
    const token = tokenOf(req);
    if (token) await env.DB.prepare('DELETE FROM staff_sessions WHERE token_hash=?').bind(await sessionKey(env, token)).run();
    return json({}, '');
  }
  const user = await accountUser(env, req);
  if (!user) fail('account_required', 401);
  if (!user.admin) fail('not_allowed', 403);
  if (action === 'save-user') return await saveUser(env, body);
  if (action === 'users') {
    const rows = await env.DB.prepare('SELECT username,name,roles,disabled,password IS NOT NULL AS active FROM staff_accounts ORDER BY username').all();
    return json({users:rows.results.map(row=>({...publicUser(row),disabled:!!row.disabled,active:!!row.active})), roster:await readRoster(), enforced:await accountOnly(env)});
  }
  if (action === 'mode') {
    if (typeof body.enforced !== 'boolean') fail('invalid_mode');
    await env.DB.prepare("INSERT INTO staff_access(key,value) VALUES ('account_only',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(body.enforced ? 1 : 0).run();
    return json({enforced:body.enforced});
  }
  fail('not_found', 404);
}
