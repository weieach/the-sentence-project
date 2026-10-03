import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { createApp } from '../server/index.js';
import { createWorker } from '../server/worker.js';
import { createStorage } from '../server/storage.js';

const secret = 'isolated-admin-test-secret';
const credentials = { username: 'test-admin', password: 'test-admin-password' };
const row = { id: 'one', name: 'Private writer', email: 'private@example.org', session_attended: 'Writing session', caption: '<script>not executed</script>', include_name: false, sentence: 'A private sentence.', hometown: 'St. Louis, MO', why_write: 'To remember.', year: 2026, created_at: '2026-09-25T12:00:00Z', image_path: 'one.png', imageUrl: 'https://example.org/one.png' };

for (const runtime of ['local', 'hosted']) {
  test(`${runtime}: admin authentication, private fields, pagination, and role isolation`, async t => {
    const offsets = [];
    const storage = { configured: true, list: async () => [], listAdmin: async offset => {
      offsets.push(offset);
      return offset === 0 ? Array.from({ length: 50 }, (_, i) => ({ ...row, id: String(i) })) : [{ ...row, id: '50' }];
    } };
    let request;
    if (runtime === 'local') {
      const server = createApp({ storage, secret, password: 'upload-password', adminUsername: credentials.username, adminPassword: credentials.password });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
      request = (path, options) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
    } else {
      const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test', SESSION_SECRET: secret, UPLOAD_PASSWORD: 'upload-password', ADMIN_USERNAME: credentials.username, ADMIN_PASSWORD: credentials.password };
      const app = createWorker({ storageFactory: () => storage });
      request = (path, options) => app.fetch(new Request(`https://sentence.example${path}`, options), env);
    }
    const login = (path, data, headers = {}) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
    assert.equal((await request('/api/admin-entries')).status, 401);
    assert.equal((await (await request('/api/admin-session')).json()).authenticated, false);
    for (const data of [{ ...credentials, username: 'wrong' }, { ...credentials, password: 'wrong' }, { password: credentials.password }, null]) {
      assert.equal((await login('/api/admin-session', data)).status, 401);
    }
    assert.equal((await login('/api/admin-session', credentials, { Origin: 'https://other.example' })).status, 403);
    const upload = await login('/api/session', { password: 'upload-password' });
    const uploadCookie = upload.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('/api/admin-entries', { headers: { cookie: uploadCookie } })).status, 401);
    assert.equal((await request('/api/admin-entries', { headers: { cookie: uploadCookie.replace('sentence_session=', 'sentence_admin=') } })).status, 401);
    assert.deepEqual(offsets, []);
    const auth = await login('/api/admin-session', credentials);
    assert.equal(auth.status, 200);
    assert.match(auth.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=7200/);
    if (runtime === 'hosted') assert.match(auth.headers.get('set-cookie'), /Secure/);
    const cookie = auth.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await request('/api/admin-session', { headers: { cookie } })).json()).authenticated, true);
    assert.equal((await (await request('/api/session', { headers: { cookie } })).json()).authenticated, false);
    for (const badCookie of [cookie + 'x', cookie + '.extra']) {
      assert.equal((await request('/api/admin-entries', { headers: { cookie: badCookie } })).status, 401);
    }
    const expires = String(Date.now() - 1000);
    const expired = `sentence_admin=${expires}.${createHmac('sha256', secret).update(`admin:${expires}`).digest('hex')}`;
    assert.equal((await request('/api/admin-entries', { headers: { cookie: expired } })).status, 401);
    const first = await request('/api/admin-entries', { headers: { cookie } });
    assert.match(first.headers.get('cache-control'), /no-store/);
    const data = await first.json();
    assert.deepEqual(data.entries[0], { ...row, id: '0' });
    assert.equal(data.nextOffset, 50);
    const last = await (await request('/api/admin-entries?offset=50', { headers: { cookie } })).json();
    assert.equal(last.entries[0].id, '50');
    assert.equal(last.nextOffset, null);
    assert.deepEqual(offsets, [0, 50]);
    assert.equal((await request('/api/admin-entries?offset=-1', { headers: { cookie } })).status, 400);
    assert.equal((await request('/api/admin-session', { method: 'DELETE', headers: { cookie, Origin: 'https://other.example' } })).status, 403);
    const logout = await request('/api/admin-session', { method: 'DELETE', headers: { cookie } });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get('set-cookie'), /sentence_admin=;.*Max-Age=0/);
    assert.equal((await request('/api/admin-entries', { headers: { cookie: logout.headers.get('set-cookie').split(';')[0] } })).status, 401);
    for (let i = 0; i < 10; i++) assert.equal((await login('/api/admin-session', { ...credentials, password: 'wrong' })).status, 401);
    assert.equal((await login('/api/admin-session', credentials)).status, 429);
  });
}

test('admin storage reads every submitted field from the private table', async () => {
  const storage = createStorage({ url: 'https://project.supabase.co', key: 'sb_secret_test', fetchImpl: async url => {
    if (url.includes('/gallery_settings')) return Response.json([{sort_order:'newest'}]);
    const parsed = new URL(url);
    assert.equal(parsed.pathname, '/rest/v1/submissions');
    assert.equal(parsed.searchParams.get('offset'), '50');
    assert.equal(parsed.searchParams.get('limit'), '50');
    for (const field of ['name', 'email', 'session_attended', 'caption', 'include_name', 'sentence', 'hometown', 'why_write', 'image_path']) assert.ok(parsed.searchParams.get('select').split(',').includes(field));
    return Response.json([row]);
  } });
  const entries = await storage.listAdmin(50);
  assert.equal(entries[0].email, row.email);
  assert.equal(entries[0].include_name, false);
  assert.equal(entries[0].imageUrl, 'https://project.supabase.co/storage/v1/object/public/sentence-images/one.png');
});
