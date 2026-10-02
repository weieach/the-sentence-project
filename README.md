# The Sentence Project

Plain HTML, CSS Grid, and JavaScript: the gallery homepage, about/contact, password-protected upload form, and a separate admin submissions page. Supabase stores the submission records and images.

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

## Admin access

Open **upload**, then choose **Admin login** below Continue. Log in with:

- Username: **`admin`**
- Password: **`sentence!789`**

The defaults are saved in **`server/config.js`**, which is never served to browsers. Override them with `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env` or the hosting environment. Redeploy after changing hosted values.

Successful login opens **`/admin.html`**. Each submission has an image and caption on the left and all other submitted answers on the right, with dividers between entries. On mobile, the image and answers stack. The page loads all records in batches of 50, including names when the contributor chose not to display them publicly. It also shows submission time, year, and entry ID.

For an existing database, run **`supabase/migrations/20260930_admin_visibility.sql`** in the Supabase SQL Editor before using these controls. Fresh databases get the same changes from `supabase/schema.sql`.

Each submission has **Hide** and **Delete** buttons. Hide removes it from the public gallery while keeping all its information in admin; **Show** restores it. Hidden images retain their existing public storage URL. Delete asks for confirmation, then permanently removes that submission and its image. If image cleanup fails after the record is deleted, the page reports that the remaining image needs to be removed in Supabase. The total count updates after deletion.

Admin data comes from the protected `/api/admin-entries` endpoint. The public gallery still excludes private fields. Admin login uses its own signed HTTP-only cookie, valid for two hours, separate from upload access; an upload cookie cannot grant admin access. Use **log out** on the admin page to clear the admin cookie. Admin login attempts have the same per-instance in-memory limit as upload login.

## Hosting on Vercel

Production: https://the-sentence-project.vercel.app

The repository is linked to the Vercel project `the-sentence-project`. Deploy updates with:

```sh
npx vercel --prod
```

`vercel.json` serves `public/` as static files and `api/session.js`, `api/entries.js`, `api/admin-session.js`, and `api/admin-entries.js` as Node.js Functions. These use the shared request handler in `server/worker.js` through `server/vercel.js`. `server/index.js` remains the local development server. No frontend build or framework is needed.

Production environment variables are stored in Vercel's project settings:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY` (secret)
- `SESSION_SECRET` (secret)
- `UPLOAD_PASSWORD` (secret)
- `ADMIN_USERNAME` and `ADMIN_PASSWORD` (optional overrides; defaults documented above)

The browser's request origin is checked against the current deployment origin. Optionally set `APP_ORIGIN` to an exact canonical origin (no trailing slash). Do not use the former ChatGPT URL. After changing an environment variable, redeploy to apply it.

Vercel's Function request limit is 4.5 MB, so this app accepts photos up to **4 MB**, leaving room for the form fields. `.vercelignore` excludes credentials, reference documents, tests, and local artifacts from deployment.

The former ChatGPT URL now serves only HTTP 410 (Gone), and its runtime secrets have been removed. Its private hosting record and historical versions remain because the available connector has no undeploy/delete operation. This repository no longer contains the Sites manifest or its deployment build. Supabase remains the same backend, so existing records are preserved.

## Web Analytics

All four pages load `public/analytics.js`, which starts Vercel Web Analytics on HTTPS deployments and skips localhost. This is the plain JavaScript integration; `@vercel/analytics/next` is only for Next.js and is not needed here. It tracks page views without sending form answers or adding custom events. The existing content security policy permits the same-origin analytics script and requests.

In Vercel, select **the-sentence-project → Analytics → Enable**, then deploy the site. Analytics requires a new deployment after enabling it. Visit the deployed site and check the project's Analytics dashboard for traffic. If `/_vercel/insights/script.js` returns 404, confirm Analytics is enabled and redeploy. See the [Vercel setup guide](https://vercel.com/docs/analytics/quickstart).

## Data and design

The nine form fields follow the supplied sketch. Name, email, session attended, image, caption, and the name-display choice are required; the remaining answers are optional. Images may be JPG, PNG, or WebP up to 4 MB. “Why write?” is limited to 50 words. The gallery returns only image URLs, captions, opted-in names, year, and record IDs; emails and other answers stay private in Supabase. Images themselves are public gallery content.

Locally, missing Supabase credentials show labeled preview images from the PDF and disable writes. The hosted runtime requires configured storage and never substitutes preview entries for real submissions. The contact link goes to the about page's contact section, alongside the separate admin page. Fonts are self-hosted from `public/fonts/`: Domaine Sans Text for navigation and body copy, Pitch Bold Italic for captions and the separate tagline, and Lyon Display for form questions and headings. These match the typefaces embedded in `reference/websiterough.pdf`. The supplied `logoforweb-2.png` is served unchanged as `public/assets/logo.png`; CSS hides its transparent margins. Source font files remain in `fonts/`. The contact mailto link does not create an email mailbox.

## Checks

```sh
npm test
```

Tests cover admin authentication, role isolation, private submission access, visibility changes, individual deletion, pagination, logout, Node and hosted upload flows, password sessions, validation, origin checks, secret-key headers, private data handling, and image cleanup. Tests use isolated data. Supabase connectivity is checked separately without adding a fake gallery submission.
