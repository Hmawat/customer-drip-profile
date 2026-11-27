import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('Native and Fundamental authenticate, store and share profiles separately', async (t) => {
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const nativeCode = 'TESTNATIVE';
  const fundamentalCode = 'TESTFUNDAMENTAL';
  const ownerPassword = 'Test owner password, not production';
  const recovery = 'Test owner recovery secret, not production';
  const server = spawn(process.execPath, ['--no-warnings', 'dev/serve.mjs', '.', '0'], {
    cwd: repo,
    env: {
      ...process.env,
      ACCOUNT_OWNER_RECOVERY_HASH: createHash('sha256').update(recovery).digest('hex'),
      ACCOUNT_OWNER_PASSWORD_HASH: createHash('sha256').update(ownerPassword).digest('hex'),
      QR_PLATE_HASHES: JSON.stringify({native:[createHash('sha256').update('0123456789abcdef0123456789abcdef').digest('hex')]}),
      FUNDAMENTAL_SETUP_SHA256: createHash('sha256').update(fundamentalCode).digest('hex'),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => server.kill());
  const [startup] = await Promise.race([
    once(server.stdout, 'data'),
    once(server, 'exit').then(([code]) => { throw new Error('Local server exited with ' + code); }),
  ]);
  const port = Number(String(startup).trim().split(' ').at(-1));
  const request = async (path, data, cookie = '') => {
    const r = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(data),
    });
    return { status: r.status, data: await r.json(), ...(r.headers.has('Set-Cookie') ? { cookie: r.headers.get('Set-Cookie').split(';')[0] } : {}) };
  };
  const rpc = (branch, name, data) => request(branch + 'rpc/' + name, data);
  const nativeRows = [
    { k: 'setting', i: 'baristas', d: ['Native Staff'] },
    { k: 'setting', i: 'theme', d: { ci: 'native-mica' } },
    { k: 'photo', i: 'same-bean', d: { label: ['native-photo'] } },
    { k: 'snap', i: 'same-recipe', d: { v: {
      key: 'aaaaaaaaaaaaaaaa', barista:'Native Staff', bean: { id: 'same-bean' }, payload: 'native-recipe',
    } } },
  ];
  assert.equal((await request('import', { code: nativeCode, rows: nativeRows })).status, 200);

  const fundamental = 'fundamental/';
  const pull = (branch, code) => rpc(branch, 'drip_pull', { p_code: code });
  assert.deepEqual(await pull(fundamental, nativeCode), { status: 403, data: { message: 'bad_code' } });
  assert.equal((await pull('', fundamentalCode)).status, 403);
  assert.deepEqual((await pull(fundamental, fundamentalCode)).data.rows, []);
  assert.equal((await request(fundamental + 'import', { code: nativeCode, rows: [] })).status, 404);

  const fundamentalRows = [
    { k: 'setting', i: 'baristas', d: ['Fundamental Staff'] },
    { k: 'photo', i: 'same-bean', d: { label: ['fundamental-photo'] } },
    { k: 'snap', i: 'same-recipe', d: { v: {
      key: 'bbbbbbbbbbbbbbbb', bean: { id: 'same-bean' }, payload: 'fundamental-recipe',
    } } },
  ];
  const push = (branch, code, rows) => rpc(branch, 'drip_push', { p_code: code, p_rows: rows });
  assert.equal((await push(fundamental, nativeCode, fundamentalRows)).status, 403);
  assert.equal((await push(fundamental, fundamentalCode, fundamentalRows)).status, 200);
  const staff = async (branch, code) => (await pull(branch, code)).data.rows.find(r => r.i === 'baristas').d;
  assert.deepEqual(await staff('', nativeCode), ['Native Staff']);
  assert.deepEqual(await staff(fundamental, fundamentalCode), ['Fundamental Staff']);

  const snap = (branch, key) => rpc(branch, 'drip_snap', { p_ref: 'same-recipe.' + key });
  assert.equal((await snap('', 'aaaaaaaaaaaaaaaa')).data, 'native-recipe');
  const plateToken='0123456789abcdef0123456789abcdef';
  const plate='/t/1/'+plateToken;
  const bindPlate=(branch,code,ref)=>rpc(branch,'drip_bind_plate',{p_code:code,p_plate:plate,p_ref:ref});
  assert.equal((await bindPlate('',nativeCode,'same-recipe.aaaaaaaaaaaaaaaa')).status,200);
  assert.equal((await bindPlate(fundamental,fundamentalCode,'same-recipe.bbbbbbbbbbbbbbbb')).status,400);
  assert.equal((await bindPlate('',fundamentalCode,'same-recipe.aaaaaaaaaaaaaaaa')).status,403);
  const plateResponse=await fetch('http://127.0.0.1:'+port+plate,{redirect:'manual'});
  assert.equal(plateResponse.status,302);
  assert.match(plateResponse.headers.get('location'),/\/#c=same-recipe\.aaaaaaaaaaaaaaaa$/);
  assert.equal(plateResponse.headers.get('cache-control'),'no-store');

  assert.equal((await snap('', 'bbbbbbbbbbbbbbbb')).data, null);
  assert.equal((await snap(fundamental, 'aaaaaaaaaaaaaaaa')).data, null);
  assert.equal((await snap(fundamental, 'bbbbbbbbbbbbbbbb')).data, 'fundamental-recipe');
  const photo = (branch, key) => rpc(branch, 'drip_photo', {
    p_bean: 'same-bean', p_ref: key && 'same-recipe.' + key,
  });
  assert.deepEqual((await photo('')).data.label, ['native-photo']);
  assert.equal((await photo(fundamental)).data, null);
  assert.equal((await photo(fundamental, 'aaaaaaaaaaaaaaaa')).data, null);
  assert.deepEqual((await photo(fundamental, 'bbbbbbbbbbbbbbbb')).data.label, ['fundamental-photo']);
  assert.equal((await rpc('', 'drip_theme', {})).data.ci, 'native-mica');
  assert.equal((await rpc(fundamental, 'drip_theme', {})).data.ci, 'apple');

  const rotate = (branch, code, next) => rpc(branch, 'drip_set_code', { p_code: code, p_new: next });
  assert.equal((await rotate(fundamental, fundamentalCode, nativeCode)).status, 400);
  assert.equal((await rotate('', nativeCode, fundamentalCode)).status, 400);
  assert.equal((await rotate(fundamental, fundamentalCode, 'TESTNEWFUNDAMENTAL')).status, 200);
  assert.equal((await pull(fundamental, fundamentalCode)).status, 403);
  assert.deepEqual(await staff(fundamental, 'TESTNEWFUNDAMENTAL'), ['Fundamental Staff']);
  assert.deepEqual(await staff('', nativeCode), ['Native Staff']);
  const accounts = (route, data, cookie) => request('accounts/' + route, data, cookie);
  const owner = await accounts('login', { username: 'admin', password: ownerPassword });
  assert.equal(owner.status, 200);
  assert.equal(owner.data.user.admin, true);
  assert.deepEqual(Object.keys(owner.data.user.roles).sort(), ['fundamental', 'native']);
  const invitation = await accounts('save-user', { username:'staff.test', name:'Native Staff', roles:{native:'barista'} }, owner.cookie);
  assert.equal(invitation.status, 200);
  assert.match(invitation.data.token, /^[a-f0-9]{64}$/);
  const password = 'Staff test phrase 123!';
  assert.equal((await accounts('activate', { token: invitation.data.token, password })).status, 200);
  assert.equal((await accounts('activate', { token: invitation.data.token, password })).status, 400);
  const member = await accounts('login', { username:'staff.test', password });
  assert.deepEqual(member.data.user.roles, {native:'barista'});
  const read = (branch, cookie) => request(branch + 'rpc/drip_pull', {p_account:true}, cookie);
  assert.equal((await read('', member.cookie)).status, 200);
  assert.equal((await read(fundamental, member.cookie)).status, 403);
  assert.equal((await accounts('users', {}, member.cookie)).status, 403);
  const write = (branch, rows, cookie) => request(branch + 'rpc/drip_push', {p_account:true,p_rows:rows}, cookie);
  assert.equal((await write('', [{k:'setting',i:'baristas',d:['Changed']}], member.cookie)).status, 403);
  assert.equal((await write('', [{k:'snap',i:'member-snap',d:{v:{barista:'Native Staff'}}}], member.cookie)).status, 200);
  assert.equal((await read(fundamental, owner.cookie)).status, 200);
  assert.equal((await accounts('mode', {enforced:true}, owner.cookie)).status, 200);
  assert.equal((await pull('', nativeCode)).status, 401);
  assert.equal((await request('import', {code:nativeCode, rows:[]})).status, 401);
  assert.equal((await snap('', 'aaaaaaaaaaaaaaaa')).data, 'native-recipe');
  assert.equal((await accounts('save-user', {username:'staff.test',name:'Native Staff',roles:{fundamental:'viewer'}}, owner.cookie)).status, 200);
  assert.equal((await read('', member.cookie)).status, 403);
  assert.equal((await read(fundamental, member.cookie)).status, 200);
  assert.equal((await write(fundamental, [], member.cookie)).status, 403);
  assert.equal((await accounts('logout', {}, member.cookie)).status, 200);
  assert.equal((await read(fundamental, member.cookie)).status, 401);
  assert.equal((await accounts('mode', {enforced:false}, owner.cookie)).status, 200);
  assert.deepEqual(await staff('', nativeCode), ['Native Staff']);
  const add=await accounts('save-user',{username:'ชมพู',name:'New display',roles:{native:'barista'},position:'Senior Barista',nativeName:'Native Staff',temporaryPassword:'A1b2C3'},owner.cookie);
  assert.equal(add.status,200);
  const duplicate=await accounts('save-user',{username:'native.duplicate',name:'Another',roles:{native:'barista'},nativeName:'Native Staff',temporaryPassword:'G8h3L1'},owner.cookie);
  assert.equal(duplicate.status,409);
  const pending=await accounts('login',{username:'ชมพู',password:'A1b2C3'});
  assert.equal(pending.data.user.mustChange,true);
  assert.equal((await read('',pending.cookie)).status,403);
  assert.equal((await accounts('change-password',{password:'A1b2C3'},pending.cookie)).status,400);
  const staffChanged=await accounts('change-password',{password:'F7g8H9'},pending.cookie);
  assert.equal(staffChanged.status,200);
  assert.equal((await read('',pending.cookie)).status,401);
  assert.equal((await read('',staffChanged.cookie)).status,200);
  assert.equal((await accounts('change-password',{password:'L0m2N3'},staffChanged.cookie)).status,401);
  assert.equal((await write('', [{k:'snap',i:'same-recipe',d:{v:{barista:'Native Staff',key:'aaaaaaaaaaaaaaaa',payload:'legacy history retained'}}}],staffChanged.cookie)).status,200);
  assert.equal((await snap('', 'aaaaaaaaaaaaaaaa')).data,'legacy history retained');
  assert.equal((await write('', [{k:'snap',i:'same-recipe',d:{v:{barista:'Native Staff'}}}],member.cookie)).status,401);

  const usersAfter=(await accounts('users',{},owner.cookie)).data.users;
  const linked=usersAfter.find(u=>u.username==='ชมพู');
  assert.deepEqual([linked.position,linked.nativeName,linked.mustChange],['Senior Barista','Native Staff',false]);
  const bothRoles={native:'barista',fundamental:'viewer'};
  assert.equal((await accounts('save-user',{username:'ชมพู',name:'New display',roles:bothRoles},owner.cookie)).status,200);
  assert.deepEqual((await accounts('status',{},staffChanged.cookie)).data.user.roles,bothRoles);
  assert.equal((await read('',staffChanged.cookie)).status,200);
  assert.equal((await read(fundamental,staffChanged.cookie)).status,200);
  assert.equal((await write(fundamental,[{k:'snap',i:'no-write',d:{v:{barista:'New display'}}}],staffChanged.cookie)).status,403);
  assert.equal((await accounts('save-user',{username:'ชมพู',name:'New display',roles:{native:'barista'}},owner.cookie)).status,200);
  assert.equal((await read('',staffChanged.cookie)).status,200);
  assert.equal((await read(fundamental,staffChanged.cookie)).status,403);
  assert.equal((await accounts('save-user',{username:'ชมพู',name:'New display',roles:{native:'barista'},position:'Senior Barista',nativeName:'Native Staff',temporaryPassword:'X9y8Z7'},owner.cookie)).status,200);
  assert.equal((await read('',staffChanged.cookie)).status,401);
  const beforeDelete=await accounts('login',{username:'ชมพู',password:'X9y8Z7'});
  assert.equal(beforeDelete.data.user.mustChange,true);
  assert.equal((await accounts('delete-user',{username:'staff.test'},beforeDelete.cookie)).status,403);
  assert.equal((await accounts('delete-user',{username:'admin'},owner.cookie)).status,400);
  assert.equal((await accounts('delete-user',{username:'ชมพู'},owner.cookie)).status,200);
  assert.equal((await accounts('status',{},beforeDelete.cookie)).data.user,null);
  assert.equal((await accounts('login',{username:'ชมพู',password:'X9y8Z7'})).status,401);
  assert.equal((await snap('', 'aaaaaaaaaaaaaaaa')).data,'legacy history retained');
  const afterDelete=(await accounts('users',{},owner.cookie)).data;
  assert.equal(afterDelete.users.some(u=>u.username==='ชมพู'),false);
  assert.equal(afterDelete.archived.some(u=>u.username==='ชมพู'),true);
  assert.equal((await accounts('save-user',{username:'ชมพู',name:'New display',roles:{native:'barista'}},owner.cookie)).status,409);
  assert.equal((await accounts('reset-user-password',{username:'ชมพู',temporaryPassword:'U1v2W3'},owner.cookie)).status,404);
  assert.equal((await accounts('restore-user',{username:'ชมพู'},owner.cookie)).status,200);
  assert.equal((await accounts('reset-user-password',{username:'ชมพู',temporaryPassword:'U1v2W3'},owner.cookie)).status,200);
  assert.equal((await accounts('login',{username:'ชมพู',password:'U1v2W3'})).status,401);
  assert.equal((await accounts('save-user',{username:'ชมพู',name:'New display',roles:{native:'barista'}},owner.cookie)).status,200);
  assert.equal((await accounts('login',{username:'ชมพู',password:'U1v2W3'})).data.user.mustChange,true);
  assert.equal((await accounts('change-password',{password:'Ab34Cd'},owner.cookie)).status,401);

  const changedOwner=await accounts('change-password',{current:ownerPassword,password:'6rKd!A'},owner.cookie);
  assert.equal(changedOwner.status,200);
  assert.equal((await accounts('login',{username:'admin',password:ownerPassword})).status,401);
  assert.equal((await accounts('users',{},owner.cookie)).status,401);
  assert.equal((await accounts('users',{},changedOwner.cookie)).status,200);
  assert.equal((await accounts('recover-admin',{recovery:'incorrect',password:'Ab34Cd'})).status,401);
  assert.equal((await accounts('recover-admin',{recovery,password:'Ab34Cd'})).status,200);
  assert.equal((await accounts('users',{},changedOwner.cookie)).status,401);
  assert.equal((await accounts('login',{username:'admin',password:'Ab34Cd'})).status,200);

});
