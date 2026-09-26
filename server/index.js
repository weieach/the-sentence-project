import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { UPLOAD_PASSWORD, MAX_IMAGE_BYTES } from './config.js';
import { createStorage } from './storage.js';
import { validateSubmission, checkImage, HttpError } from './validation.js';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' };
const previewCaptions = ['caption language', 'calligraphic greeting', 'new idea', 'calligraphic greeting', 'new idea', 'calligraphic greeting'];
const hash = value => createHash('sha256').update(value).digest();

export function createApp({ storage = createStorage(), password = UPLOAD_PASSWORD, secret = process.env.SESSION_SECRET || randomBytes(32).toString('hex'), production = process.env.NODE_ENV === 'production', origin = process.env.APP_ORIGIN } = {}) {
  const attempts = new Map();
  const sign = value => createHmac('sha256', secret).update(value).digest('hex');
  function authenticated(req) {
    const cookie = req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith('sentence_session='))?.slice(17);
    if (!cookie) return false;
    const [expires, signature] = cookie.split('.');
    return /^\d+$/.test(expires) && Number(expires) > Date.now() && typeof signature === 'string' && timingSafeEqual(hash(signature), hash(sign(expires)));
  }
  function json(res, status, data, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(data));
  }
  async function body(req, limit) {
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new HttpError(413, 'The upload is too large. Choose an image up to 8 MB.');
      parts.push(chunk);
    }
    return Buffer.concat(parts);
  }
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: blob:; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'POST') {
        const expected = origin || `${production ? 'https' : 'http'}://${req.headers.host}`;
        if ((req.headers.origin && req.headers.origin !== expected) || req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Please submit from this website.');
      }
      if (url.pathname === '/api/session' && req.method === 'GET') return json(res, 200, { authenticated: authenticated(req) });
      if (url.pathname === '/api/session' && req.method === 'POST') {
        if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Expected a password request.');
        const now = Date.now();
        for (const [key, value] of attempts) if (value.expires < now) attempts.delete(key);
        // Use the socket address, not a spoofable forwarding header.
        const ip = req.socket.remoteAddress;
        const attempt = attempts.get(ip) || { count: 0, expires: now + 15 * 60 * 1000 };
        if (attempt.count >= 10) return json(res, 429, { error: 'Too many attempts. Please try again in 15 minutes.' }, { 'Retry-After': '900' });
        let data;
        try { data = JSON.parse((await body(req, 1024)).toString()); } catch (error) { if (error.status) throw error; throw new HttpError(400, 'Invalid password request.'); }
        const supplied = typeof data?.password === 'string' ? data.password : '';
        if (!supplied || !timingSafeEqual(hash(supplied), hash(password))) {
          attempt.count += 1;
          attempts.set(ip, attempt);
          throw new HttpError(401, 'That password is not correct. Please try again.');
        }
        attempts.delete(ip);
        const expires = String(now + 2 * 60 * 60 * 1000);
        return json(res, 200, { authenticated: true }, { 'Set-Cookie': `sentence_session=${expires}.${sign(expires)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200${production ? '; Secure' : ''}` });
      }
      if (url.pathname === '/api/entries' && req.method === 'GET') {
        const offset = Number(url.searchParams.get('offset') || 0);
        if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, 'Invalid gallery offset.');
        if (!storage.configured) return json(res, 200, {
          entries: offset === 0 ? previewCaptions.map((caption, i) => ({ id: `preview-${i}`, caption, displayName: i === 0 ? '' : 'heather corcoran', year: 2026, imageUrl: `/assets/journal-${i + 1}.jpg` })) : [],
          preview: true, nextOffset: null,
        });
        const entries = await storage.list(offset);
        return json(res, 200, { entries, preview: false, nextOffset: entries.length === 50 ? offset + 50 : null });
      }
      if (url.pathname === '/api/entries' && req.method === 'POST') {
        if (!authenticated(req)) throw new HttpError(401, 'Your session has expired. Please enter the password again.');
        if (!storage.configured) throw new HttpError(503, 'Submissions are not open yet. Please try again later.');
        const contentType = req.headers['content-type'] || '';
        if (!contentType.startsWith('multipart/form-data;')) throw new HttpError(415, 'Please send the contribution form.');
        const bytes = await body(req, MAX_IMAGE_BYTES + 64 * 1024);
        let form;
        try { form = await new Request('http://localhost', { method: 'POST', headers: { 'Content-Type': contentType }, body: bytes }).formData(); }
        catch { throw new HttpError(400, 'The upload could not be read. Please select your photo again.'); }
        const { record, photo } = validateSubmission(form);
        const image = Buffer.from(await photo.arrayBuffer());
        checkImage(image, photo.type);
        const id = randomUUID();
        await storage.save({ ...record, id, year: new Date().getUTCFullYear() }, image, photo.type);
        return json(res, 201, { id });
      }
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Not found.');
      if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Method not allowed.');
      const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = resolve(root, `.${pathname}`);
      if (!file.startsWith(root.endsWith(sep) ? root : root + sep) || !mimeTypes[extname(file)]) throw new HttpError(404, 'Not found.');
      let bytes;
      try { if (!(await stat(file)).isFile()) throw new Error(); bytes = await readFile(file); }
      catch { throw new HttpError(404, 'Not found.'); }
      res.writeHead(200, { 'Content-Type': mimeTypes[extname(file)], 'Content-Length': bytes.length, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (!error.status) console.error('Request failed:', error.message);
      if (!res.headersSent) json(res, error.status || 502, { error: error.status ? error.message : 'Storage is temporarily unavailable. Please try again.' });
      else res.end();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.NODE_ENV === 'production' && (!process.env.UPLOAD_PASSWORD || !process.env.SESSION_SECRET || !process.env.APP_ORIGIN || !process.env.SUPABASE_URL || !(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY))) {
    throw new Error('Production requires UPLOAD_PASSWORD, SESSION_SECRET, APP_ORIGIN, SUPABASE_URL, and SUPABASE_SECRET_KEY. See README.md.');
  }
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, '0.0.0.0', () => console.log(`The Sentence Project: http://localhost:${port}`));
}
