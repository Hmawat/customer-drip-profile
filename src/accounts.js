const COOKIE = '__Host-drip-user';
const SESSION_SECONDS = 8 * 60 * 60;
const INVITE_MS = 48 * 60 * 60 * 1000;
const BRANCHES = ['native', 'fundamental'];
const POSITIONS = ['Trainee','Service','Barista','Senior Barista','Captain','Supervisor','Manager','Bar Manager','Outlet Manager','F&B Manager','Assistant Manager','Assistant Beverage Manager','Bar Beverage Manager','Cluster Beverage Manager','Cluster F&B Team Manager','Director of F&B'];
const validPassword = (value, admin = false) => typeof value === 'string' &&
  (admin ? value.length >= 6 && value.length <= 128 : /^\S{6}$/u.test(value));
const ROLES = new Set(['viewer', 'barista', 'manager']);
const USERNAME = /^[\p{L}\p{Nd}][\p{L}\p{M}\p{Nd}._-]{2,31}$/u;
const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const random = size => hex(crypto.getRandomValues(new Uint8Array(size)));
const sha = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
const usernameOf = value => String(value ?? '').trim().toLowerCase().normalize('NFC');

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
    env.DB.prepare("CREATE TABLE IF NOT EXISTS staff_profiles(username TEXT PRIMARY KEY, position TEXT NOT NULL DEFAULT '', native_name TEXT UNIQUE, must_change INTEGER NOT NULL DEFAULT 0)"),
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
  return {username:row.username,name:row.name,admin,roles:JSON.parse(row.roles),
    position:row.position||'',nativeName:row.native_name||'',mustChange:!!row.must_change};
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
  const row = await accountRow(env,session.username);
  if (!row?.password) return null;
  return row ? publicUser(row) : null;
}

export async function branchAccount(env, req, branch, write = false) {
  const user = await accountUser(env, req);
  if (!user) fail('account_required', 401);
  if (user.mustChange) fail('password_change_required',403);
  if (branch==='native'&&!user.nativeName) {
    const claim=await env.DB.prepare('SELECT username FROM staff_profiles WHERE native_name=?').bind(user.name).first();
    if(claim&&claim.username!==user.username)user.nativeNameReserved=true;
  }
  const role = user.roles[branch];
  if (!role || (write && role === 'viewer')) fail('not_allowed', 403);
  return {role, user};
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bytes = await crypto.subtle.deriveBits({name:'PBKDF2', salt:encoder.encode(salt), iterations:100000, hash:'SHA-256'}, key, 256);
  return salt + ':' + hex(new Uint8Array(bytes));
}

const accountRow = (env,username) => env.DB.prepare(`SELECT a.*,p.position,p.native_name,p.must_change
  FROM staff_accounts a LEFT JOIN staff_profiles p ON p.username=a.username WHERE a.username=? AND a.disabled=0`)
  .bind(username).first();

async function verifyPassword(env, username, password, row) {
  if (typeof password!=='string'||password.length<6||password.length>128) return false;
  if (username==='admin'&&!row?.password) return !!env.ACCOUNT_OWNER_PASSWORD_HASH && await sha(password)===env.ACCOUNT_OWNER_PASSWORD_HASH;
  const hash=await passwordHash(password,row?.password?.split(':')[0]||'inactive-account-password-check');
  return !!row?.password&&hash===row.password;
}

async function throttle(env, req, key, max) {
  const now=Date.now(), window=15*60*1000;
  const limit=await env.DB.prepare(`INSERT INTO staff_login_limits(ip,start,attempts) VALUES (?,?,1)
    ON CONFLICT(ip) DO UPDATE SET start=CASE WHEN start<=? THEN excluded.start ELSE start END,
    attempts=CASE WHEN start<=? THEN 1 ELSE MIN(attempts+1,101) END RETURNING attempts`)
    .bind(key,now,now-window,now-window).first();
  if(limit.attempts>max)fail('retry_later',429);
}

async function issueSession(env, user, expectedPassword) {
  const token=random(32), now=Date.now();
  const password=expectedPassword??null;
  const result=await env.DB.prepare(`INSERT INTO staff_sessions(token_hash,username,expires)
    SELECT ?,?,? WHERE ((? IS NULL AND NOT EXISTS (SELECT 1 FROM staff_accounts WHERE username=?))
    OR EXISTS(SELECT 1 FROM staff_accounts WHERE username=? AND password=? AND disabled=0))`)
    .bind(await sessionKey(env,token),user.username,now+SESSION_SECONDS*1000,password,user.username,user.username,password).run();
  if(!result.meta.changes)fail('invalid_login',401);
  return json({user},token);
}

async function login(env, req, body) {
  const username=usernameOf(body.username), password=body.password;
  if(!USERNAME.test(username)||typeof password!=='string'||password.length<6||password.length>128)fail('invalid_login',401);
  await throttle(env,req,'ip:'+(req.headers.get('CF-Connecting-IP')||'local'),40);
  await throttle(env,req,'user:'+username,10);
  const row=await accountRow(env,username);
  if(!await verifyPassword(env,username,password,row))fail('invalid_login',401);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM staff_sessions WHERE expires<=?').bind(Date.now()),
    env.DB.prepare('DELETE FROM staff_login_limits WHERE ip=? OR start<=?').bind('user:'+username,Date.now()-15*60*1000),
  ]);
  return issueSession(env,username==='admin'?owner():publicUser(row),row?.password);
}

async function changePassword(env, req, user, body, recovery = false) {
  const admin=user.username==='admin';
  if(!validPassword(body.password,admin))fail('invalid_password');
  if(!recovery&&body.password===body.current)fail('same_password');
  const row=await accountRow(env,user.username);
  if(!recovery){
    await throttle(env,req,'change:'+user.username,10);
    if(!await verifyPassword(env,user.username,body.current,row))fail('invalid_login',401);
  }
  const hash=await passwordHash(body.password,random(16));
  const statement=admin&&!row
    ? env.DB.prepare("INSERT OR IGNORE INTO staff_accounts(username,name,roles,password) VALUES ('admin','Admin','{}',?)").bind(hash)
    : env.DB.prepare('UPDATE staff_accounts SET password=?,invite_hash=NULL,invite_until=NULL WHERE username=? AND password=? AND disabled=0').bind(hash,user.username,row?.password);
  const results=await env.DB.batch([
    statement,
    env.DB.prepare('UPDATE staff_profiles SET must_change=0 WHERE username=? AND EXISTS(SELECT 1 FROM staff_accounts WHERE username=? AND password=?)').bind(user.username,user.username,hash),
    env.DB.prepare('DELETE FROM staff_sessions WHERE username=? AND EXISTS(SELECT 1 FROM staff_accounts WHERE username=? AND password=?)').bind(user.username,user.username,hash),
  ]);
  if(!results[0].meta.changes)fail('invalid_login',401);
  if(recovery)return json({},'');
  return issueSession(env,{...user,mustChange:false},hash);
}

async function activate(env, body) {
  const {token,password} = body;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) fail('invalid_invite');
  if (!validPassword(password) && !(typeof password==='string'&&password.length>=12&&password.length<=128)) fail('invalid_password');
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

async function saveUser(env, body, readRoster) {
  const username=usernameOf(body.username);
  const name=typeof body.name==='string'?body.name.trim():'';
  if(!USERNAME.test(username)||username==='admin'||!name||name.length>80)fail('invalid_user');
  const roles=Object.fromEntries(BRANCHES.filter(branch=>ROLES.has(body.roles?.[branch])).map(branch=>[branch,body.roles[branch]]));
  const disabled=body.disabled===true?1:0;
  if(!disabled&&!Object.keys(roles).length)fail('choose_role');
  const existing=await env.DB.prepare(`SELECT a.username,p.position,p.native_name FROM staff_accounts a
    LEFT JOIN staff_profiles p ON p.username=a.username WHERE a.username=?`).bind(username).first();
  const position=body.position??existing?.position??'';
  const nativeName=(body.nativeName??existing?.native_name)||null;
  if(position&&!POSITIONS.includes(position))fail('invalid_position');
  if(nativeName&&nativeName!==existing?.native_name&&
    (!roles.native||!(await readRoster()).native.includes(nativeName)))fail('invalid_roster');
  const temporary=body.temporaryPassword||'';
  if(temporary&&(!validPassword(temporary)||disabled))fail('invalid_password');
  const password=temporary?await passwordHash(temporary,random(16)):null;
  const token=!disabled&&!password&&(!existing||body.reset===true)?random(32):null;
  if(!existing&&!token&&!password)fail('invalid_user');
  const authChanged=!!(password||token||disabled);
  const statements=[
    env.DB.prepare(`INSERT INTO staff_accounts(username,name,roles,disabled,password,invite_hash,invite_until)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(username) DO UPDATE SET name=excluded.name,roles=excluded.roles,disabled=excluded.disabled,
      password=CASE WHEN ? THEN excluded.password ELSE password END,
      invite_hash=CASE WHEN ? THEN excluded.invite_hash ELSE invite_hash END,
      invite_until=CASE WHEN ? THEN excluded.invite_until ELSE invite_until END`)
      .bind(username,name,JSON.stringify(roles),disabled,password,token?await sha(token):null,token?Date.now()+INVITE_MS:null,
        password||token?1:0,authChanged?1:0,authChanged?1:0),
    env.DB.prepare(`INSERT INTO staff_profiles(username,position,native_name,must_change) VALUES (?,?,?,?)
      ON CONFLICT(username) DO UPDATE SET position=excluded.position,native_name=excluded.native_name,
      must_change=CASE WHEN ? THEN excluded.must_change ELSE must_change END`)
      .bind(username,position,nativeName,password?1:0,password||token?1:0),
  ];
  if(authChanged)statements.push(env.DB.prepare('DELETE FROM staff_sessions WHERE username=?').bind(username));
  try{await env.DB.batch(statements);}
  catch(e){if(String(e).includes('staff_profiles.native_name'))fail('roster_already_linked',409);throw e;}
  return json({username,token});
}

export async function accountEndpoint(env, req, action, body, readRoster) {
  sameOrigin(req);
  await schema(env);
  if (action === 'login') return await login(env, req, body);
  if (action === 'activate') return await activate(env, body);
  if(action==='recover-admin'){
    await throttle(env,req,'recover:'+(req.headers.get('CF-Connecting-IP')||'local'),10);
    if(typeof body.recovery!=='string'||body.recovery.length>150||!env.ACCOUNT_OWNER_RECOVERY_HASH||
      await sha(body.recovery)!==env.ACCOUNT_OWNER_RECOVERY_HASH)fail('invalid_recovery',401);
    return changePassword(env,req,owner(),body,true);
  }
  if (action === 'status') return json({user:await accountUser(env, req), enforced:await accountOnly(env)});
  if (action === 'logout') {
    const token = tokenOf(req);
    if (token) await env.DB.prepare('DELETE FROM staff_sessions WHERE token_hash=?').bind(await sessionKey(env, token)).run();
    return json({}, '');
  }
  const user = await accountUser(env, req);
  if (!user) fail('account_required', 401);
  if(action==='change-password')return await changePassword(env,req,user,body);
  if (!user.admin) fail('not_allowed', 403);
  if (action === 'save-user') return await saveUser(env, body, readRoster);
  if (action === 'users') {
    const rows = await env.DB.prepare(`SELECT a.username,a.name,a.roles,a.disabled,a.password IS NOT NULL AS active,p.position,p.native_name,p.must_change
      FROM staff_accounts a LEFT JOIN staff_profiles p ON p.username=a.username WHERE a.username!='admin' ORDER BY a.username`).all();
    return json({positions:POSITIONS,users:rows.results.map(row=>({...publicUser(row),disabled:!!row.disabled,active:!!row.active})), roster:await readRoster(), enforced:await accountOnly(env)});
  }
  if (action === 'mode') {
    if (typeof body.enforced !== 'boolean') fail('invalid_mode');
    await env.DB.prepare("INSERT INTO staff_access(key,value) VALUES ('account_only',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .bind(body.enforced ? 1 : 0).run();
    return json({enforced:body.enforced});
  }
  fail('not_found', 404);
}
