import { createWorker } from './worker.js';

const app = createWorker({
  // Vercel sets this trusted forwarding header at its edge.
  clientIp: request => request.headers.get('x-vercel-forwarded-for') || 'unknown',
});

export function handleRequest(request) {
  return app.fetch(request, {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    SESSION_SECRET: process.env.SESSION_SECRET,
    UPLOAD_PASSWORD: process.env.UPLOAD_PASSWORD,
    ADMIN_USERNAME: process.env.ADMIN_USERNAME,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
    APP_ORIGIN: process.env.APP_ORIGIN,
  });
}
