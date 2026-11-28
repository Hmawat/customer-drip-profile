import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('Native and Fundamental authenticate, store and share profiles separately', async (t) => {
  const repo = fileURLToPath(new URL('../', import.meta.url));
  const nativeCode = 'TESTNATIVE';
  const fundamentalCode = 'TESTFUNDAMENTAL';
  const ownerPassword = 'Test owner password, not production';
  const recovery = 'Test owner recovery secret, not production';
  const nativeTokens = Array.from({length: 10}, (_, i) => i === 0 ? '0123456789abcdef0123456789abcdef' : String(i + 1).padStart(32, '0'));
  const fundamentalTokens = Array.from({length: 10}, (_, i) => ('ab' + String(i + 1)).padEnd(32, 'c'));
  const nativeConfigured = nativeTokens.map((token, i) => i === 1 ? '' : token);
  const fundamentalConfigured = fundamentalTokens.map((token, i) => i === 9 ? 'b'.repeat(32) : token);
  const scratch = mkdtempSync(join(tmpdir(), 'drip-lib-'));
  const dbfile = join(scratch, 'drip.db');
  const server = spawn(process.execPath, ['--no-warnings', 'dev/serve.mjs', '.', '0', dbfile], {
    cwd: repo,
    env: {
      ...process.env,
      ACCOUNT_OWNER_RECOVERY_HASH: createHash('sha256').update(recovery).digest('hex'),
      ACCOUNT_OWNER_PASSWORD_HASH: createHash('sha256').update(ownerPassword).digest('hex'),
      QR_PLATE_HASHES: JSON.stringify({
        native: nativeTokens.map(token => createHash('sha256').update(token).digest('hex')),
        fundamental: fundamentalTokens.map(token => createHash('sha256').update(token).digest('hex')),
      }),
      QR_PLATE_TOKENS: JSON.stringify({native: nativeConfigured, fundamental: fundamentalConfigured}),
      FUNDAMENTAL_SETUP_SHA256: createHash('sha256').update(fundamentalCode).digest('hex'),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  t.after(() => { server.kill(); rmSync(scratch, { recursive: true, force: true }); });
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
  const bindSlot=(branch,code,ref,slot)=>rpc(branch,'drip_bind_plate',{p_code:code,p_slot:slot,p_ref:ref});
  const concurrent=await Promise.all([1,2].map(()=>bindSlot('',nativeCode,'same-recipe.aaaaaaaaaaaaaaaa',1)));
  assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,409]);
  const byNumber=concurrent.find(x=>x.status===200);
  assert.equal(byNumber.data.minutes,30);
  assert.equal(byNumber.status,200);
  assert.equal(byNumber.data.slot,1);
  assert.equal((await bindSlot('',nativeCode,'same-recipe.aaaaaaaaaaaaaaaa',10)).status,200);
  const tenthPlate=await fetch('http://127.0.0.1:'+port+'/t/10/'+String(10).padStart(32,'0'),{redirect:'manual'});
  assert.equal(tenthPlate.status,302);
  assert.equal(tenthPlate.headers.get('location'),'/customer/same-recipe.aaaaaaaaaaaaaaaa');
  assert.match(await (await fetch('http://127.0.0.1:'+port+'/fundamental/customer/same-recipe.bbbbbbbbbbbbbbbb',{redirect:'manual'})).text(),/Customer Drip Profile/);
  assert.match(await (await fetch('http://127.0.0.1:'+port+'/customer/same-recipe.aaaaaaaaaaaaaaaa',{redirect:'manual'})).text(),/Customer Drip Profile/);
  assert.equal((await bindSlot('',nativeCode,'same-recipe.aaaaaaaaaaaaaaaa',11)).status,400);
  assert.equal((await bindSlot('',fundamentalCode,'same-recipe.aaaaaaaaaaaaaaaa',1)).status,403);
  assert.equal((await bindPlate('',nativeCode,'same-recipe.aaaaaaaaaaaaaaaa')).status,409);
  assert.equal((await bindPlate(fundamental,fundamentalCode,'same-recipe.bbbbbbbbbbbbbbbb')).status,400);
  assert.equal((await bindPlate('',fundamentalCode,'same-recipe.aaaaaaaaaaaaaaaa')).status,403);
  const plateResponse=await fetch('http://127.0.0.1:'+port+plate,{redirect:'manual'});
  assert.equal(plateResponse.status,302);
  assert.match(plateResponse.headers.get('location'),/\/customer\/same-recipe\.aaaaaaaaaaaaaaaa$/);
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
  const dataImage = (mark) => 'data:image/jpeg;base64,' + Buffer.from(String(mark).padEnd(48, '0')).toString('base64');
  const nativeShot = dataImage('native-library-photo');
  const nativeFarm = dataImage('native-farm-photo');
  const nativeSnap = dataImage('native-snap-photo');
  const fundShot = dataImage('fundamental-library-photo');
  const library = (branch, data, cookie = '') => request(branch + 'rpc/drip_library', data, cookie);
  assert.equal((await push('', nativeCode, [
    { k: 'bean', i: 'lib-bean', d: { o: 1, v: { id: 'lib-bean', name: 'Library Lot', country: 'Ethiopia', process: 'Washed' } } },
    { k: 'photo', i: 'lib-bean', d: { label: [nativeShot], farm: [nativeFarm, 'not-a-photo'], origin: [] } },
    { k: 'snap', i: 'lib-snap', d: { v: { photos: { label: [], farm: [nativeSnap], origin: [] } } } },
  ])).status, 200);
  assert.equal((await push(fundamental, fundamentalCode, [
    { k: 'photo', i: 'lib-bean', d: { label: [fundShot], farm: [nativeShot], origin: [] } },
  ])).status, 200);
  const backfillOnly = dataImage('backfill-only-native-photo');
  const sql = new DatabaseSync(dbfile);
  sql.prepare('INSERT INTO drip_items(kind, id, data, deleted, updated_ms) VALUES (?,?,?,0,?)')
    .run('photo', 'backfill-bean', JSON.stringify({ label: [backfillOnly], farm: [], origin: [] }), Date.now());
  sql.close();
  const nativeLib = await library('', { p_code: nativeCode, p_branch: 'fundamental' });
  assert.equal(nativeLib.status, 200);
  assert.deepEqual(nativeLib.data.images.map((img) => img.data).sort(), [backfillOnly, nativeFarm, nativeShot, nativeSnap].sort());
  const fundLib = await library(fundamental, { p_code: fundamentalCode });
  assert.equal(fundLib.status, 200);
  assert.deepEqual(fundLib.data.images.map((img) => img.data).sort(), [fundShot, nativeShot].sort());
  assert.equal(fundLib.data.images.some((img) => img.data === nativeFarm), false);
  assert.equal((await library(fundamental, { p_code: nativeCode })).status, 403);
  assert.equal((await library('', {})).status, 403);
  const extra = dataImage('native-picker-upload');
  const added = await request('rpc/drip_library_add', { p_code: nativeCode, p_data: extra });
  assert.equal(added.status, 200);
  assert.match(added.data.id, /^[0-9a-f-]{36}$/);
  assert.equal((await request('rpc/drip_library_add', { p_code: nativeCode, p_data: extra })).data.id, added.data.id);
  assert.equal((await request('rpc/drip_library_add', { p_code: nativeCode, p_data: 'not-a-photo' })).status, 400);
  assert.equal((await request('fundamental/rpc/drip_library_add', { p_code: nativeCode, p_data: extra })).status, 403);
  const nativeAfter = await library('', { p_code: nativeCode });
  assert.equal(nativeAfter.data.images.some((img) => img.id === added.data.id && img.data === extra), true);
  assert.equal((await library(fundamental, { p_code: fundamentalCode })).data.images.some((img) => img.data === extra), false);
  assert.equal((await rpc('', 'drip_theme', {})).data.ci, 'native-mica');
  assert.equal((await rpc('', 'drip_theme', {})).data.colors, undefined);
  assert.equal((await push('', nativeCode, [{ k: 'setting', i: 'theme', d: { ci: 'custom', cvb: 'light', colors: { bg: '#F0EEE9', ink: '40312F', accent: 'abc', accentH: '#864C24', link: 'nope', extra: '#ffffff' } } }])).status, 200);
  const themed = (await rpc('', 'drip_theme', {})).data;
  assert.equal(themed.ci, 'custom');
  assert.equal(themed.cvb, 'light');
  assert.equal(themed.colors.bg, '#f0eee9');
  assert.equal(themed.colors.ink, '#40312f');
  assert.equal(themed.colors.accent, '#aabbcc');
  assert.equal(themed.colors.accentH, '#864c24');
  assert.equal(themed.colors.link, undefined);
  assert.equal(themed.colors.extra, undefined);
  assert.equal((await push('', nativeCode, [{ k: 'setting', i: 'theme', d: { ci: 'native-mica' } }])).status, 200);
  assert.equal((await rpc('', 'drip_theme', {})).data.ci, 'native-mica');
  assert.equal((await rpc('', 'drip_theme', {})).data.colors, undefined);
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
  const duration=(branch,minutes,cookie)=>request(branch+'rpc/drip_set_plate_duration',{p_minutes:minutes},cookie);
  assert.equal((await duration('',0,owner.cookie)).status,400);
  assert.equal((await duration('',12,owner.cookie)).status,200);
  assert.equal((await request(fundamental+'rpc/drip_list_plates',{p_account:true},owner.cookie)).data.minutes,30);
  const createPlate=(branch,cookie)=>request(branch+'rpc/drip_create_plate',{p_account:true},cookie);
  assert.equal((await createPlate('',null)).status,401);
  const generated=await Promise.all([createPlate('',owner.cookie),createPlate('',owner.cookie)]);
  assert.deepEqual(generated.map(x=>x.status),[200,200]);
  assert.deepEqual(generated.map(x=>x.data.slot).sort((a,b)=>a-b),[11,12]);
  const otherPlate=await createPlate(fundamental,owner.cookie);
  assert.equal(otherPlate.data.slot,11);
  assert.match(otherPlate.data.path,/^\/fundamental\/t\/11\//);
  const generatedPlate=generated.find(x=>x.data.slot===11).data;
  const generatePublic=path=>fetch('http://127.0.0.1:'+port+path,{redirect:'manual'});
  const waitingPlate=await generatePublic(generatedPlate.path);
  assert.equal(waitingPlate.status,410);
  assert.match(await waitingPlate.text(),/<script src="\/route.js"><\/script>/);
  const listPlates=await request('rpc/drip_list_plates',{p_account:true},owner.cookie);
  assert(listPlates.data.slots.includes(11));
  assert.equal(listPlates.data.minutes,12);
  assert.equal(listPlates.data.busy['1'],byNumber.data.expires);
  assert(listPlates.data.generated.some(x=>x.path===generatedPlate.path));
  assert.deepEqual(listPlates.data.printable.map(plate => plate.path), nativeTokens.flatMap((token, index) => index === 1 ? [] : ['/t/' + (index + 1) + '/' + token]));
  const seenPlate = await fetch('http://127.0.0.1:' + port + '/t/2/' + nativeTokens[1], {redirect: 'manual'});
  assert.equal(seenPlate.status, 410);
  const listedAgain = await request('rpc/drip_list_plates', {p_account: true}, owner.cookie);
  assert.equal(listedAgain.data.printable.find(plate => plate.slot === 2).path, '/t/2/' + nativeTokens[1]);
  const keep=(branch,cookie,paths)=>request(branch+'rpc/drip_keep_printed_plates',{p_account:true,p_paths:paths},cookie);
  assert.equal((await keep('',null,['/t/1/'+nativeTokens[0]])).status,401);
  const kept=await keep('',owner.cookie,['/t/2/'+nativeTokens[1],'/t/3/'+nativeTokens[2],'/fundamental/t/1/'+fundamentalTokens[0],'/t/2/'+'f'.repeat(32)]);
  assert.equal(kept.status,200);
  assert.deepEqual(kept.data.kept,[3]);
  assert.deepEqual(kept.data.already,[2]);
  assert.deepEqual(kept.data.rejected,[1,2]);
  const keptAgain=await keep('',owner.cookie,['/t/3/'+nativeTokens[2]]);
  assert.deepEqual(keptAgain.data.already,[3]);
  assert.equal((await request('rpc/drip_list_plates',{p_account:true},owner.cookie)).data.printable.find(plate=>plate.slot===2).path,'/t/2/'+nativeTokens[1]);
  assert.equal((await request('rpc/drip_list_plates',{p_account:true},owner.cookie)).data.printable.find(plate=>plate.slot===3).path,'/t/3/'+nativeTokens[2]);
  const fundamentalPlates = await request(fundamental + 'rpc/drip_list_plates', {p_account: true}, owner.cookie);
  assert.deepEqual(fundamentalPlates.data.printable.map(plate => plate.slot), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(fundamentalPlates.data.printable.every(plate => plate.path === '/fundamental/t/' + plate.slot + '/' + fundamentalTokens[plate.slot - 1]), true);
  assert.equal(JSON.stringify(fundamentalPlates.data).includes('b'.repeat(32)), false);
  const linkedPlate=await request('rpc/drip_bind_plate',{p_account:true,p_slot:11,p_ref:'same-recipe.aaaaaaaaaaaaaaaa'},owner.cookie);
  assert.equal(linkedPlate.status,200);
  assert.equal(linkedPlate.data.minutes,12);
  assert.equal((await generatePublic(generatedPlate.path)).headers.get('location'),'/customer/same-recipe.aaaaaaaaaaaaaaaa');
  const plate12=generated.find(x=>x.data.slot===12).data;
  const drop=(branch,cookie,slot)=>request(branch+'rpc/drip_delete_plate',{p_account:true,p_slot:slot},cookie);
  assert.equal((await drop('',null,12)).status,401);
  assert.equal((await drop('',owner.cookie,99)).status,400);
  const removedExtra=await drop('',owner.cookie,12);
  assert.equal(removedExtra.status,200);
  assert.deepEqual(removedExtra.data,{slot:12,printed:false});
  assert.equal((await generatePublic(plate12.path)).status,404);
  assert.equal((await generatePublic(otherPlate.data.path)).status,410);
  assert.equal((await drop(fundamental,owner.cookie,11)).status,200);
  assert.equal((await generatePublic(otherPlate.data.path)).status,404);
  assert.equal((await generatePublic(generatedPlate.path)).status,302);
  const removedPrinted=await drop('',owner.cookie,9);
  assert.equal(removedPrinted.status,200);
  assert.equal(removedPrinted.data.printed,true);
  assert.equal((await fetch('http://127.0.0.1:'+port+'/t/9/'+nativeTokens[8],{redirect:'manual'})).status,404);
  assert.equal((await fetch('http://127.0.0.1:'+port+'/fundamental/t/9/'+fundamentalTokens[8],{redirect:'manual'})).status,410);
  const platesAfterDelete=await request('rpc/drip_list_plates',{p_account:true},owner.cookie);
  assert.equal(platesAfterDelete.data.printable.some(plate=>plate.slot===9),false);
  assert.equal(platesAfterDelete.data.slots.includes(9),false);
  assert.equal(platesAfterDelete.data.generated.some(plate=>plate.slot===12),false);
  assert.equal((await request(fundamental+'rpc/drip_list_plates',{p_account:true},owner.cookie)).data.printable.some(plate=>plate.slot===9),true);
  assert.equal((await keep('',owner.cookie,['/t/9/'+nativeTokens[8]])).data.rejected.includes(9),true);
  assert.deepEqual(Object.keys(owner.data.user.roles).sort(), ['fundamental', 'native']);
  const invitation = await accounts('save-user', { username:'staff.test', name:'Native Staff', roles:{native:'barista'} }, owner.cookie);
  assert.equal(invitation.status, 200);
  assert.match(invitation.data.token, /^[a-f0-9]{64}$/);
  const password = 'Staff test phrase 123!';
  assert.equal((await accounts('activate', { token: invitation.data.token, password })).status, 200);
  assert.equal((await accounts('activate', { token: invitation.data.token, password })).status, 400);
  const member = await accounts('login', { username:'staff.test', password });
  assert.deepEqual(member.data.user.roles, {native:'barista'});
  assert.equal((await createPlate('',member.cookie)).status,403);
  assert.equal((await duration('',15,member.cookie)).status,403);
  const memberPlates=await request('rpc/drip_list_plates',{p_account:true},member.cookie);
  assert(memberPlates.data.slots.includes(11));
  assert.deepEqual(memberPlates.data.generated,[]);
  assert.deepEqual(memberPlates.data.printable,[]);
  assert.equal((await keep('',member.cookie,['/t/1/'+nativeTokens[0]])).status,403);
  assert.equal((await drop('',member.cookie,11)).status,403);
  assert.equal((await request(fundamental+'rpc/drip_list_plates',{p_account:true},member.cookie)).status,403);
  const read = (branch, cookie) => request(branch + 'rpc/drip_pull', {p_account:true}, cookie);
  assert.equal((await read('', member.cookie)).status, 200);
  assert.equal((await read(fundamental, member.cookie)).status, 403);
  assert.equal((await request('rpc/drip_library', { p_account: true }, owner.cookie)).status, 200);
  assert.equal((await request('fundamental/rpc/drip_library', { p_account: true }, owner.cookie)).data.images.some((img) => img.data === fundShot), true);
  assert.equal((await request('rpc/drip_library', { p_account: true }, owner.cookie)).data.images.some((img) => img.data === fundShot), false);
  assert.equal((await request('rpc/drip_library', { p_account: true }, member.cookie)).status, 403);
  assert.equal((await request('rpc/drip_library_add', { p_account: true, p_data: 'data:image/jpeg;base64,' + 'A'.repeat(64) }, member.cookie)).status, 403);
  assert.equal((await request('fundamental/rpc/drip_library', { p_account: true }, member.cookie)).status, 403);
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
  assert.equal((await request('fundamental/rpc/drip_library', { p_account: true }, member.cookie)).status, 403);
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

  const pack = async (obj, kind) => {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    const b64 = (u8) => { let t = ''; u8.forEach((c) => { t += String.fromCharCode(c); }); return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
    if (kind === 'j') return 'j' + b64(bytes);
    const packed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    return 'z' + b64(packed);
  };
  const unpack = async (payload) => {
    let t = payload.slice(1).replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    const rawText = atob(t);
    const raw = new Uint8Array(rawText.length);
    for (let i = 0; i < rawText.length; i++) raw[i] = rawText.charCodeAt(i);
    const bytes = payload[0] === 'z'
      ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
      : raw;
    return JSON.parse(new TextDecoder().decode(bytes));
  };
  const priced = { id: 'priced', bean: { id: 'priced-bean', name: 'Priced Lot', farm: 'Hill', cupPrice: '450', beanPrice: '1300' }, recipe: { dose: 15 } };
  assert.equal((await push('', nativeCode, [
    { k: 'bean', i: 'priced-bean', d: { v: { id: 'priced-bean', name: 'Priced Lot', cupPrice: '450', beanPrice: '1300' } } },
    { k: 'snap', i: 'priced-z', d: { v: { key: 'cccccccccccccccc', payload: await pack(priced, 'z'), bean: { cupPrice: '450', beanPrice: '1300' } } } },
    { k: 'snap', i: 'priced-j', d: { v: { key: 'dddddddddddddddd', payload: await pack(priced, 'j') } } },
  ])).status, 200);
  const zSnap = await rpc('', 'drip_snap', { p_ref: 'priced-z.cccccccccccccccc' });
  const jSnap = await rpc('', 'drip_snap', { p_ref: 'priced-j.dddddddddddddddd' });
  const zBack = await unpack(zSnap.data);
  const jBack = await unpack(jSnap.data);
  assert.equal(zBack.bean.farm, 'Hill');
  assert.equal(zBack.bean.name, 'Priced Lot');
  assert.equal(zBack.bean.cupPrice, undefined);
  assert.equal(zBack.bean.beanPrice, undefined);
  assert.equal(jBack.bean.cupPrice, undefined);
  assert.equal(jBack.bean.beanPrice, undefined);
  assert.equal(String(jSnap.data).includes('cupPrice'), false);
  assert.equal(String(jSnap.data).includes('beanPrice'), false);
  const shopBean = (await pull('', nativeCode)).data.rows.find((r) => r.k === 'bean' && r.i === 'priced-bean');
  assert.equal(shopBean.d.v.cupPrice, '450');
  assert.equal(shopBean.d.v.beanPrice, '1300');

});
