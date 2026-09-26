import { BUCKET } from './config.js';

export function createStorage({ url = globalThis.process?.env?.SUPABASE_URL, key = globalThis.process?.env?.SUPABASE_SECRET_KEY || globalThis.process?.env?.SUPABASE_SERVICE_ROLE_KEY, fetchImpl = fetch } = {}) {
  const configured = Boolean(url && key);
  const base = url?.replace(/\/$/, '');
  async function request(path, options = {}) {
    const response = await fetchImpl(`${base}${path}`, {
      ...options,
      headers: { apikey: key, ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }), ...options.headers },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      // Do not expose database details or credentials in public errors.
      throw new Error(`Supabase request failed (${response.status})`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  return {
    configured,
    async list(offset) {
      const rows = await request(`/rest/v1/gallery_entries?select=id,caption,display_name,year,image_path,created_at&order=created_at.desc,id.desc&offset=${offset}&limit=50`);
      return rows.map(row => ({ id: row.id, caption: row.caption, displayName: row.display_name, year: row.year,
        imageUrl: `${base}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(row.image_path)}` }));
    },
    async listAdmin(offset) {
      const rows = await request(`/rest/v1/submissions?select=id,name,email,session_attended,image_path,caption,include_name,sentence,hometown,why_write,year,created_at&order=created_at.desc,id.desc&offset=${offset}&limit=50`);
      return rows.map(row => ({ ...row,
        imageUrl: `${base}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(row.image_path)}` }));
    },
    async save(record, bytes, mime) {
      const imagePath = `${record.id}.${mime === 'image/jpeg' ? 'jpg' : mime === 'image/png' ? 'png' : 'webp'}`;
      await request(`/storage/v1/object/${BUCKET}/${imagePath}`, { method: 'POST', headers: { 'Content-Type': mime, 'x-upsert': 'false' }, body: bytes });
      try {
        await request('/rest/v1/submissions', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ ...record, image_path: imagePath }) });
      } catch (error) {
        // Compensate if metadata fails after the image has been uploaded.
        try { await request(`/storage/v1/object/${BUCKET}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [imagePath] }) }); }
        catch { console.error('Image cleanup needed:', imagePath); }
        throw error;
      }
    },
  };
}
