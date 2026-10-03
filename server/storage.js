import { BUCKET } from './config.js';
import { HttpError, validateEntryId, validateEntryUpdate, validateGalleryOrder } from './validation.js';

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
  async function getOrder() {
    const settings = await request('/rest/v1/gallery_settings?select=sort_order&id=eq.true');
    return settings[0]?.sort_order || 'newest';
  }
  const orderQuery = order => order === 'oldest' ? 'created_at.asc,id.asc' : order === 'custom' ? 'display_order.asc,created_at.desc,id.desc' : 'created_at.desc,id.desc';
  return {
    configured,
    getOrder,
    async setOrder(data) {
      const { order, ids } = validateGalleryOrder(data);
      const updated = await request('/rest/v1/rpc/set_gallery_order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_order: order, p_ids: ids ?? null }),
      });
      if (!updated) throw new HttpError(409, 'The submissions changed. Refresh the list before reordering.');
      return { order };
    },
    async list(offset) {
      const order = await getOrder();
      const rows = await request(`/rest/v1/gallery_entries?select=id,caption,display_name,year,image_path,created_at&order=${orderQuery(order)}&offset=${offset}&limit=50`);
      return rows.map(row => ({ id: row.id, caption: row.caption, displayName: row.display_name, year: row.year,
        imageUrl: `${base}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(row.image_path)}` }));
    },
    async listAdmin(offset) {
      const order = await getOrder();
      const rows = await request(`/rest/v1/submissions?select=id,name,email,session_attended,image_path,caption,include_name,is_hidden,sentence,hometown,why_write,year,created_at&order=${orderQuery(order)}&offset=${offset}&limit=50`);
      return rows.map(row => ({ ...row,
        imageUrl: `${base}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(row.image_path)}` }));
    },
    async setHidden(id, hidden) {
      validateEntryId(id);
      if (typeof hidden !== 'boolean') throw new HttpError(400, 'Choose whether to hide this submission.');
      const rows = await request(`/rest/v1/submissions?id=eq.${id}&select=id,is_hidden`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify({ is_hidden: hidden }),
      });
      if (!rows?.length) throw new HttpError(404, 'This submission no longer exists.');
      return { id: rows[0].id, hidden: rows[0].is_hidden };
    },
    async update(id, data) {
      validateEntryId(id);
      const record = validateEntryUpdate(data);
      const rows = await request(`/rest/v1/submissions?id=eq.${id}&select=id`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(record),
      });
      if (!rows?.length) throw new HttpError(404, 'This submission no longer exists.');
      return { entry: { ...record, id: rows[0].id } };
    },
    async remove(id) {
      validateEntryId(id);
      // Delete the record first so failed storage cleanup cannot leave a broken gallery entry.
      const rows = await request(`/rest/v1/submissions?id=eq.${id}&select=id,image_path`, {
        method: 'DELETE', headers: { Prefer: 'return=representation' },
      });
      if (!rows?.length) throw new HttpError(404, 'This submission no longer exists.');
      try {
        await request(`/storage/v1/object/${BUCKET}`, {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefixes: [rows[0].image_path] }),
        });
      } catch {
        console.error('Image cleanup needed:', rows[0].image_path);
        return { deleted: true, warning: 'The submission was deleted, but its image could not be removed from storage. Please remove that image in Supabase.' };
      }
      return { deleted: true };
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
