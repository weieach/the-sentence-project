import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/index.js';
import { createWorker } from '../server/worker.js';
import { createStorage } from '../server/storage.js';
import { HttpError, validateEntryUpdate } from '../server/validation.js';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const edits = { name: 'Updated writer', email: 'writer@example.org', session_attended: 'Fall session', caption: 'Updated caption', include_name: true, sentence: 'A'.repeat(1500), hometown: '', why_write: '', year: 2026 };
const credentials = { username: 'test-admin', password: 'test-password' };
for (const runtime of ['local', 'hosted']) {
  test(`${runtime}: only admins can hide, restore, or delete one submission`, async t => {
    const rows = [firstId, secondId].map(id => ({ id, is_hidden: false }));
    const mutations = [];
    const storage = {
      configured: true,
      list: async () => rows.filter(row => !row.is_hidden),
      listAdmin: async () => rows,
      setHidden: async (id, hidden) => {
        const row = rows.find(row => row.id === id);
        if (!row) throw new HttpError(404, 'Missing submission.');
        mutations.push(['visibility', id, hidden]);
        row.is_hidden = hidden;
        return { id, hidden };
      },
      update: async (id, data) => {
        const row = rows.find(row => row.id === id);
        if (!row) throw new HttpError(404, 'Missing submission.');
        if (data.name === 'Simulated outage') throw new HttpError(502, 'Storage unavailable.');
        Object.assign(row, data);
        mutations.push(['edit', id]);
        return { entry: { ...row } };
      },
      remove: async id => {
        const index = rows.findIndex(row => row.id === id);
        if (index < 0) throw new HttpError(404, 'Missing submission.');
        mutations.push(['delete', id]);
        rows.splice(index, 1);
        return { deleted: true };
      },
    };
    let request;
    if (runtime === 'local') {
      const server = createApp({ storage, secret: 'test-session-secret', password: 'upload-password', adminUsername: credentials.username, adminPassword: credentials.password });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
      request = (path, options) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
    } else {
      const app = createWorker({ storageFactory: () => storage });
      const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test', SESSION_SECRET: 'test-session-secret', UPLOAD_PASSWORD: 'upload-password', ADMIN_USERNAME: credentials.username, ADMIN_PASSWORD: credentials.password };
      request = (path, options) => app.fetch(new Request(`https://sentence.example${path}`, options), env);
    }
    const login = async (path, data) => {
      const response = await request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie').split(';')[0];
    };
    const cookie = await login('/api/admin-session', credentials);
    const uploadCookie = await login('/api/session', { password: 'upload-password' });
    const endpoint = `/api/admin-entries?id=${firstId}`;
    const action = (method, body, headers = {}, path = endpoint) => request(path, { method, headers: { cookie, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const method of ['PATCH', 'DELETE']) {
      for (const invalidCookie of ['', uploadCookie, cookie + 'x']) {
        assert.equal((await action(method, undefined, { cookie: invalidCookie })).status, 401);
      }
      assert.equal((await action(method, { hidden: true }, { Origin: 'https://other.example' })).status, 403);
      assert.equal((await action(method, { hidden: true }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
      assert.equal((await action(method, { hidden: true }, {}, '/api/admin-entries?id=bad')).status, 400);
      assert.equal((await action(method, { hidden: true }, {}, '/api/admin-entries')).status, 400);
    }
    for (const data of [null, {}, { hidden: 'true' }, { hidden: 1 }]) assert.equal((await action('PATCH', data)).status, 400);
    assert.equal((await action('PATCH', { hidden: true }, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await request(endpoint, { method: 'PATCH', headers: { cookie, 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    for (const invalidCookie of ['', uploadCookie, cookie + 'x']) assert.equal((await action('PATCH', { entry: edits }, { cookie: invalidCookie })).status, 401);
    assert.equal((await action('PATCH', { entry: edits }, { Origin: 'https://other.example' })).status, 403);
    for (const fields of [{...edits, email:'bad'}, {...edits, id:secondId}, {...edits, include_name:'true'}, {...edits, year:1}, {...edits, why_write:'word '.repeat(51)}]) {
      assert.equal((await action('PATCH', { entry: fields })).status, 400);
    }
    assert.deepEqual(mutations, []);
    const saved = await action('PATCH', { entry: edits });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).entry.caption, edits.caption);
    assert.equal(rows[0].sentence, edits.sentence);
    assert.equal(rows[1].caption, undefined);
    assert.equal(rows[0].is_hidden, false);
    assert.equal((await action('PATCH', { entry:{...edits,name:'Simulated outage'} })).status, 502);
    assert.equal(rows[0].name, edits.name);
    assert.equal((await (await request('/api/entries')).json()).entries[0].caption, edits.caption);
    assert.deepEqual(await (await action('PATCH', { hidden: true })).json(), { id: firstId, hidden: true });
    assert.deepEqual((await (await request('/api/entries')).json()).entries.map(row => row.id), [secondId]);
    assert.equal((await (await request('/api/admin-entries', { headers: { cookie } })).json()).entries.length, 2);
    assert.equal((await (await action('PATCH', { hidden: false })).json()).hidden, false);
    assert.equal((await (await request('/api/entries')).json()).entries.length, 2);
    assert.deepEqual(await (await action('DELETE')).json(), { deleted: true });
    assert.deepEqual(rows.map(row => row.id), [secondId]);
    assert.equal((await action('DELETE')).status, 404);
    assert.equal((await action('PATCH', {entry:edits})).status, 404);
    assert.equal((await action('PATCH', { hidden: false })).status, 404);
  });
}

test('Supabase visibility and deletion target only the requested record and image', async () => {
  const calls = [];
  const storage = createStorage({ url: 'https://project.supabase.co', key: 'sb_secret_test', fetchImpl: async (url, options) => {
    const parsed = new URL(url);
    calls.push({ parsed, options });
    if (options.method === 'PATCH') return Response.json([{ id: firstId, is_hidden: JSON.parse(options.body).is_hidden }]);
    if (parsed.pathname === '/rest/v1/submissions') return Response.json([{ id: firstId, image_path: `${firstId}.png` }]);
    return Response.json([]);
  } });
  assert.deepEqual(await storage.setHidden(firstId, true), { id: firstId, hidden: true });
  assert.deepEqual(await storage.setHidden(firstId, false), { id: firstId, hidden: false });
  assert.deepEqual(await storage.remove(firstId), { deleted: true });
  for (const call of calls.slice(0, 3)) {
    assert.equal(call.parsed.searchParams.get('id'), `eq.${firstId}`);
    assert.equal(call.options.headers.Prefer, 'return=representation');
  }
  assert.equal(calls[3].parsed.pathname, '/storage/v1/object/sentence-images');
  assert.deepEqual(JSON.parse(calls[3].options.body), { prefixes: [`${firstId}.png`] });
  await assert.rejects(storage.remove('x&or=(id.neq.y)'), { status: 400 });
  await assert.rejects(storage.setHidden(firstId, 'true'), { status: 400 });
  assert.equal(calls.length, 4);
});

test('missing or failed database deletion never deletes an image; cleanup failure is reported', async t => {
  for (const failure of ['missing', 'database', 'image']) {
    let calls = 0;
    const storage = createStorage({ url: 'https://project.supabase.co', key: 'sb_secret_test', fetchImpl: async () => {
      calls++;
      if (failure === 'missing') return Response.json([]);
      if (failure === 'database' || calls === 2) return new Response('', { status: 500 });
      return Response.json([{ id: firstId, image_path: `${firstId}.png` }]);
    } });
    if (failure === 'image') {
      t.mock.method(console, 'error', () => {});
      const result = await storage.remove(firstId);
      assert.equal(result.deleted, true);
      assert.match(result.warning, /image could not be removed/);
      assert.equal(calls, 2);
    } else {
      await assert.rejects(storage.remove(firstId), failure === 'missing' ? { status: 404 } : /Supabase request failed/);
      assert.equal(calls, 1);
    }
  }
});


test('entry edits validate text and preserve protected database fields', async () => {
  for (const field of ['id', 'image_path', 'created_at', 'is_hidden']) assert.throws(() => validateEntryUpdate({...edits,[field]:'changed'}), {status:400});
  const calls = [];
  const storage = createStorage({url:'https://project.supabase.co',key:'sb_secret_test',fetchImpl:async (url, options) => {
    calls.push({url,options});
    return Response.json([{id:firstId}]);
  }});
  const result = await storage.update(firstId, {...edits,name:'  Updated writer  '});
  assert.equal(result.entry.name, 'Updated writer');
  assert.equal(new URL(calls[0].url).searchParams.get('id'), `eq.${firstId}`);
  assert.deepEqual(JSON.parse(calls[0].options.body), edits);
  assert.equal(calls[0].options.headers.Prefer, 'return=representation');
  const missing = createStorage({url:'https://project.supabase.co',key:'sb_secret_test',fetchImpl:async()=>Response.json([])});
  await assert.rejects(missing.update(firstId, edits), {status:404});
  const failed = createStorage({url:'https://project.supabase.co',key:'sb_secret_test',fetchImpl:async()=>new Response('',{status:500})});
  await assert.rejects(failed.update(firstId, edits), /Supabase request failed/);
});
