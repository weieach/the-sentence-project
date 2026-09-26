import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server/index.js';
import { createStorage } from '../server/storage.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6FEAAAAASUVORK5CYII=', 'base64');
function submission(overrides = {}) {
  const f = new FormData();
  for (const [key, value] of Object.entries({ name: 'Private Name', email: 'private@example.org', session: 'Community writing', caption: '<script>alert(1)</script>', includeName: 'no', sentence: 'One small sentence.', hometown: 'St. Louis', whyWrite: 'To remember.', ...overrides })) f.set(key, value);
  f.set('photo', new Blob([png], { type: 'image/png' }), 'journal.png');
  return f;
}
async function setup(t, storage, extra = {}) {
  const server = createApp({ storage, password: 'test-password', secret: 'test-secret', ...extra });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options) => fetch(base + path, options);
  const login = async () => {
    const res = await request('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-password' }) });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie').split(';')[0];
  };
  return { request, login, base };
}
test('password, private files, and protected submissions', async t => {
  const saved = [];
  const { request, login } = await setup(t, { configured: true, list: async () => [], save: async (...args) => saved.push(args) });
  assert.deepEqual(await (await request('/api/session')).json(), { authenticated: false });
  assert.equal((await request('/api/entries', { method: 'POST', body: submission() })).status, 401);
  const wrong = await request('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"wrong"}' });
  assert.equal(wrong.status, 401);
  for (const path of ['/server/config.js', '/.env', '/supabase/schema.sql', '/websiterough.pdf']) assert.equal((await request(path)).status, 404);
  const cookie = await login();
  assert.equal((await (await request('/api/session', { headers: { cookie } })).json()).authenticated, true);
  assert.equal((await (await request('/api/session', { headers: { cookie: cookie + 'tamper' } })).json()).authenticated, false);
  const result = await request('/api/entries', { method: 'POST', headers: { cookie }, body: submission() });
  assert.equal(result.status, 201);
  assert.equal(saved.length, 1);
  assert.equal(saved[0][0].include_name, false);
  assert.equal(saved[0][0].email, 'private@example.org');
  assert.equal(saved[0][2], 'image/png');
  assert.equal((await request('/api/entries', { method: 'POST', headers: { cookie, Origin: 'https://other.example' }, body: submission() })).status, 403);
});
test('server validation rejects long answers and disguised files', async t => {
  const { request, login } = await setup(t, { configured: true, save: async () => assert.fail('invalid upload reached storage') });
  const cookie = await login();
  for (const fields of [{ whyWrite: 'word '.repeat(51) }, { email: 'invalid' }, { name: '' }, { includeName: 'maybe' }]) {
    assert.equal((await request('/api/entries', { method: 'POST', headers: { cookie }, body: submission(fields) })).status, 400);
  }
  const f = submission();
  f.set('photo', new Blob(['<svg>fake</svg>'], { type: 'image/png' }), 'fake.png');
  assert.equal((await request('/api/entries', { method: 'POST', headers: { cookie }, body: f })).status, 400);
});
test('unconfigured storage is explicitly preview and refuses writes', async t => {
  const { request, login } = await setup(t, { configured: false });
  const gallery = await (await request('/api/entries')).json();
  assert.equal(gallery.preview, true);
  assert.equal(gallery.entries.length, 6);
  const cookie = await login();
  assert.equal((await request('/api/entries', { method: 'POST', headers: { cookie }, body: submission() })).status, 503);
});
test('storage failures do not report successful submissions', async t => {
  const { request, login } = await setup(t, { configured: true, save: async () => { throw new Error('test outage'); } });
  const cookie = await login();
  assert.equal((await request('/api/entries', { method: 'POST', headers: { cookie }, body: submission() })).status, 502);
});
test('Supabase gallery adapter only returns public fields', async () => {
  const storage = createStorage({ url: 'https://project.supabase.co', key: 'server-key', fetchImpl: async (url, options) => {
    assert.match(url, /gallery_entries\?select=/);
    assert.match(url, /offset=50/);
    assert.equal(options.headers.Authorization, 'Bearer server-key');
    return Response.json([{ id: 'one', caption: 'A sentence', display_name: null, year: 2026, image_path: 'one.png', email: 'never@example.org', name: 'Hidden', sentence: 'Private answer' }]);
  } });
  const entries = await storage.list(50);
  assert.equal(entries[0].displayName, null);
  assert.equal(entries[0].imageUrl, 'https://project.supabase.co/storage/v1/object/public/sentence-images/one.png');
  assert.ok(!JSON.stringify(entries).includes('never@'));
  assert.ok(!JSON.stringify(entries).includes('Hidden'));
  assert.ok(!JSON.stringify(entries).includes('Private answer'));
});
test('failed metadata insert cleans up uploaded Supabase image', async () => {
  const calls = [];
  const storage = createStorage({ url: 'https://project.supabase.co', key: 'server-key', fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    return url.endsWith('/rest/v1/submissions') ? new Response('failure', { status: 500 }) : Response.json({});
  } });
  await assert.rejects(storage.save({ id: 'one', caption: 'hello' }, png, 'image/png'));
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /sentence-images\/one.png$/);
  assert.equal(calls[2].method, 'DELETE');
  assert.deepEqual(JSON.parse(calls[2].body), { prefixes: ['one.png'] });
});
test('password attempts are limited and production cookies are secure', async t => {
  const { request } = await setup(t, { configured: false });
  const wrong = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"wrong"}' };
  for (let i = 0; i < 10; i++) assert.equal((await request('/api/session', wrong)).status, 401);
  assert.equal((await request('/api/session', wrong)).status, 429);
  const prod = await setup(t, { configured: true }, { production: true });
  const res = await prod.request('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"test-password"}' });
  assert.match(res.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=7200; Secure/);
});
