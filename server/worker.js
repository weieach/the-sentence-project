import { createStorage } from './storage.js';
import { validateSubmission, checkImage, HttpError, validateEntryId, validateEntryUpdate, validateGalleryOrder } from './validation.js';
import { MAX_IMAGE_BYTES, ADMIN_USERNAME, ADMIN_PASSWORD } from './config.js';

// The build embeds only public/ here. Secrets are supplied by the hosting runtime.
const bundledAssets = {};
const encoder = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
async function digest(value) { return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
async function equal(a, b) {
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' https: blob:; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'",
};
function json(status, data, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
}
async function limitedBody(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) throw new HttpError(413, 'The upload is too large.');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new HttpError(413, 'The upload is too large. Choose an image up to 4 MB.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
async function hasSession(request, secret, admin = false) {
  const name = admin ? 'sentence_admin' : 'sentence_session';
  const cookie = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!cookie || !secret) return false;
  const [expires, signature, extra] = cookie.split('.');
  return !extra && /^\d+$/.test(expires) && Number(expires) > Date.now() && typeof signature === 'string' && await equal(signature, await sign(admin ? `admin:${expires}` : expires, secret));
}
export function createWorker({ assets = bundledAssets, storageFactory = createStorage, clientIp = request => request.headers.get('cf-connecting-ip') || 'unknown' } = {}) {
  const attempts = new Map();
  return {
    async fetch(request, env) {
      try {
        const url = new URL(request.url);
        const path = url.pathname;
        if (!path.startsWith('/api/')) {
          if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, 'Method not allowed.');
          const asset = assets[path === '/' ? '/index.html' : path];
          if (!asset) throw new HttpError(404, 'Not found.');
          const body = request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.body), c => c.charCodeAt(0));
          return new Response(body, { headers: { ...securityHeaders, 'Content-Type': asset.type, 'Cache-Control': 'no-cache' } });
        }
        if (!env.SUPABASE_URL || !(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY) || !env.SESSION_SECRET || !env.UPLOAD_PASSWORD) {
          throw new HttpError(503, 'The site is not ready to accept submissions.');
        }
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && ((request.headers.get('origin') && request.headers.get('origin') !== (env.APP_ORIGIN || url.origin)) || request.headers.get('sec-fetch-site') === 'cross-site')) {
          throw new HttpError(403, 'Please submit from this website.');
        }
        const admin = path === '/api/admin-session';
        const sessionPath = admin || path === '/api/session';
        if (sessionPath && request.method === 'GET') return json(200, { authenticated: await hasSession(request, env.SESSION_SECRET, admin) });
        if (admin && request.method === 'DELETE') return json(200, { authenticated: false }, { 'Set-Cookie': 'sentence_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure' });
        if (sessionPath && request.method === 'POST') {
          if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Expected a password request.');
          const now = Date.now();
          for (const [key, value] of attempts) if (value.expires < now) attempts.delete(key);
          const ip = `${admin ? 'admin' : 'upload'}:${clientIp(request)}`;
          const attempt = attempts.get(ip) || { count: 0, expires: now + 15 * 60 * 1000 };
          if (attempt.count >= 10) return json(429, { error: 'Too many attempts. Please try again in 15 minutes.' }, { 'Retry-After': '900' });
          let data;
          const bytes = await limitedBody(request, 1024);
          try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, 'Invalid password request.'); }
          const passwordMatches = typeof data?.password === 'string' && await equal(data.password, admin ? (env.ADMIN_PASSWORD || ADMIN_PASSWORD) : env.UPLOAD_PASSWORD);
          const usernameMatches = !admin || (typeof data?.username === 'string' && await equal(data.username, env.ADMIN_USERNAME || ADMIN_USERNAME));
          if (!passwordMatches || !usernameMatches) {
            attempt.count++;
            attempts.set(ip, attempt);
            throw new HttpError(401, admin ? 'Incorrect username or password. Please try again.' : 'That password is not correct. Please try again.');
          }
          attempts.delete(ip);
          const expires = String(now + 2 * 60 * 60 * 1000);
          return json(200, { authenticated: true }, { 'Set-Cookie': `${admin ? 'sentence_admin' : 'sentence_session'}=${expires}.${await sign(admin ? `admin:${expires}` : expires, env.SESSION_SECRET)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200; Secure` });
        }
        const storage = storageFactory({ url: env.SUPABASE_URL, key: env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY });
        if (path === '/api/admin-order' && ['GET', 'PUT'].includes(request.method)) {
          if (!await hasSession(request, env.SESSION_SECRET, true)) throw new HttpError(401, 'Please log in as an admin to reorder submissions.');
          if (request.method === 'GET') return json(200, { order: await storage.getOrder() });
          if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Expected a gallery order.');
          const bytes = await limitedBody(request, 1024 * 1024);
          let data;
          try { data = JSON.parse(new TextDecoder().decode(bytes)); }
          catch { throw new HttpError(400, 'Invalid gallery order.'); }
          return json(200, await storage.setOrder(validateGalleryOrder(data)));
        }
        if (path === '/api/admin-entries' && ['GET', 'PATCH', 'DELETE'].includes(request.method)) {
          if (!await hasSession(request, env.SESSION_SECRET, true)) throw new HttpError(401, 'Please log in as an admin to view submissions.');
          if (request.method !== 'GET') {
            const id = validateEntryId(url.searchParams.get('id'));
            if (request.method === 'DELETE') return json(200, await storage.remove(id));
            if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'Expected a submission update.');
            const bytes = await limitedBody(request, 32768);
            let data;
            try { data = JSON.parse(new TextDecoder().decode(bytes)); }
            catch { throw new HttpError(400, 'Invalid submission update.'); }
            if (data && Object.hasOwn(data, 'entry')) return json(200, await storage.update(id, validateEntryUpdate(data.entry)));
            if (typeof data?.hidden !== 'boolean') throw new HttpError(400, 'Choose whether to hide this submission.');
            return json(200, await storage.setHidden(id, data.hidden));
          }
          const offset = Number(url.searchParams.get('offset') || 0);
          if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, 'Invalid submissions offset.');
          const entries = await storage.listAdmin(offset);
          return json(200, { entries, nextOffset: entries.length === 50 ? offset + 50 : null });
        }
        if (path === '/api/entries' && request.method === 'GET') {
          const offset = Number(url.searchParams.get('offset') || 0);
          if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, 'Invalid gallery offset.');
          const entries = await storage.list(offset);
          return json(200, { entries, preview: false, nextOffset: entries.length === 50 ? offset + 50 : null });
        }
        if (path === '/api/entries' && request.method === 'POST') {
          if (!await hasSession(request, env.SESSION_SECRET)) throw new HttpError(401, 'Your session has expired. Please enter the password again.');
          const contentType = request.headers.get('content-type') || '';
          if (!contentType.startsWith('multipart/form-data;')) throw new HttpError(415, 'Please send the contribution form.');
          const body = await limitedBody(request, MAX_IMAGE_BYTES + 64 * 1024);
          let form;
          try { form = await new Request(url, { method: 'POST', headers: { 'Content-Type': contentType }, body }).formData(); }
          catch { throw new HttpError(400, 'The upload could not be read. Please select your photo again.'); }
          const { record, photo } = validateSubmission(form);
          const image = new Uint8Array(await photo.arrayBuffer());
          checkImage(image, photo.type);
          const id = crypto.randomUUID();
          await storage.save({ ...record, id, year: new Date().getUTCFullYear() }, image, photo.type);
          return json(201, { id });
        }
        throw new HttpError(404, 'Not found.');
      } catch (error) {
        if (!error.status) console.error('Request failed:', error.message);
        return json(error.status || 502, { error: error.status ? error.message : 'Storage is temporarily unavailable. Please try again.' });
      }
    },
  };
}
export default createWorker();
