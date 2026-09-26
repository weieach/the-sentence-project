# The Sentence Project

Three pages in plain HTML, CSS Grid, and JavaScript: the gallery homepage, about/contact, and password-protected upload form. Supabase stores the submission records and images.

## Local development

Use Node.js 22 or newer. Copy `.env.example` to `.env`, enter your Supabase project URL and server-only secret key, then run:

```sh
npm start
```

Open http://localhost:3000. Use `npm run dev` for server restarts on source changes. Do not put real credentials in `.env.example`; `.env` is ignored by Git.

```dotenv
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_your_key
```

The URL is in your Supabase project's Connect dialog. Find the secret key under Settings → API Keys → Publishable and secret API keys → Secret keys. This server uses the secret key, not the browser's publishable key. Legacy `SUPABASE_SERVICE_ROLE_KEY` is also supported.

For a fresh Supabase project, run `supabase/schema.sql` in its SQL Editor. It creates the submissions table, restricted gallery view, and public `sentence-images` bucket. This project's table and bucket were checked successfully during deployment preparation.

## Upload password

The saved password is `UPLOAD_PASSWORD` in **`server/config.js`**. Its default is **`sentences-together`**. Set `UPLOAD_PASSWORD` in `.env` to override it locally. The hosted site uses a secret environment variable with the same name; update that hosted value and redeploy to change its password.

The password is checked on the server. Upload access uses an HTTP-only, same-site cookie valid for two hours. Hosted cookies are Secure. Login attempts are limited in memory (per server / Worker instance).

## Hosting

The site is registered with Sites; `.openai/hosting.json` holds its project ID. The production runtime is `server/worker.js`. Run `npm run build` to create a Cloudflare-compatible Worker at `dist/server/index.js`. The build embeds only public website assets; it never embeds `.env` or Supabase credentials. The local Node server remains available at `server/index.js`.

Runtime settings are stored by Sites:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (secret)
- `SESSION_SECRET` (secret)
- `UPLOAD_PASSWORD` (secret)
- `APP_ORIGIN` (the exact hosted origin, no trailing slash)

New Sites deployments are private to the owner. Change the site's audience when ready to let visitors access it. Keep the same project ID when republishing.

## Data and design

The nine form fields follow the supplied sketch. Name, email, session attended, image, caption, and the name-display choice are required; the remaining answers are optional. Images may be JPG, PNG, or WebP up to 8 MB. “Why write?” is limited to 50 words. The gallery returns only image URLs, captions, opted-in names, year, and record IDs; emails and other answers stay private in Supabase. Images themselves are public gallery content.

Locally, missing Supabase credentials show labeled preview images from the PDF and disable writes. The hosted runtime requires configured storage and never substitutes preview entries for real submissions. The contact link goes to the about page's contact section, preserving the requested three pages. System fonts approximate the sketch's proprietary typefaces. The contact mailto link does not create an email mailbox.

## Checks

```sh
npm test
npm run build
```

Tests cover Node and hosted upload flows, password sessions, validation, origin checks, secret-key headers, private data handling, and cleanup after failed database inserts. Tests use isolated data. Supabase connectivity is checked separately without adding a fake gallery submission.
