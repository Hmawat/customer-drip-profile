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
  const server = spawn(process.execPath, ['--no-warnings', 'dev/serve.mjs', '.', '0'], {
    cwd: repo,
    env: {
      ...process.env,
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
  const request = async (path, data) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    return { status: r.status, data: await r.json() };
  };
  const rpc = (branch, name, data) => request(branch + 'rpc/' + name, data);
  const nativeRows = [
    { k: 'setting', i: 'baristas', d: ['Native Staff'] },
    { k: 'setting', i: 'theme', d: { ci: 'native-mica' } },
    { k: 'photo', i: 'same-bean', d: { label: ['native-photo'] } },
    { k: 'snap', i: 'same-recipe', d: { v: {
      key: 'aaaaaaaaaaaaaaaa', bean: { id: 'same-bean' }, payload: 'native-recipe',
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
});
