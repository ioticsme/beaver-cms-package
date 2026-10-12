# beaver-cms — Package Architecture & Developer Reference

> Internal reference for maintaining and extending the `beaver-cms` npm package.
> Package version at time of writing: **1.7.0** (`package.json`).
> Companion doc for the host app: [`../../cms/docs/WRAPPER.md`](../../cms/docs/WRAPPER.md).

---

## 1. What this package is

`beaver-cms` is a **headless, multi-brand / multi-country CMS** delivered as an
**Express sub-application**. `index.js` builds a fully configured `express()`
app and exports it; a host project ("wrapper", see `../cms`) mounts it with
`app.use(beaverCMS)`.

It provides:

| Area | What you get |
| --- | --- |
| Admin panel (`/admin`) | Server-rendered Nunjucks UI (Metronic-style theme in `public/`), session auth, RBAC |
| Content modelling | Dynamic **Content Types** with field groups, repeaters, localisation, single/collection types, page builder (GrapesJS) |
| Public REST API (`/api`) | Brand + country + language aware content, menus, navigation, custom forms, end-user auth |
| GraphQL (`/graphql`) | Apollo Server (read-only content queries) |
| Swagger (`/api-docs`) | swagger-jsdoc over `./routes/api/*.js` |
| Media | Pluggable storage: local, ImageKit, Cloudinary, Azure Blob, AWS S3 (Bunny CDN adaptor exists, disabled) |
| Infra | MongoDB (mongoose), Redis (cache + optional sessions), Agenda job queue, Winston logging |

Stack: Node.js, Express 4, Mongoose 6, ioredis, Nunjucks, Apollo Server 3, Agenda 5.

---

## 2. Directory map

```
cms-package/
├── index.js                 # Builds & exports the Express app (entry point, "main")
├── config/
│   ├── env.config.js        # ALL env vars are read here → single envConfig object
│   ├── db.config.js         # Mongo connect + seeds a Config document on first boot
│   ├── session.config.js    # express-session (file store or Redis store)
│   ├── templateEngine.config.js  # Nunjucks env + custom filters
│   ├── admin.config.js      # Built-in admin side-nav (navConfig) + DB AdminNav sections
│   ├── userPrivilege.config.js   # Built-in privilege tree (RBAC)
│   └── meta-fields.config.js     # SEO / meta field definitions for content
├── middleware/
│   ├── cms.middleware.js    # Admin: baseConfig, nunjucksFilter, authUser, mainNavGenerator, allBrands, contentTypeCheck
│   ├── cmsAuth.middleware.js# Admin: authCheck, checkSuperAdmin, checkRouteAccess (RBAC)
│   └── api.middleware.js    # API: BrandWithCountryCheck, UserAuthCheck (JWT), getNav, userAgent
├── routes/
│   ├── admin/               # Mounted under /admin
│   └── api/                 # Mounted under /api
├── controller/
│   ├── admin/               # Admin panel pages & actions
│   ├── config/              # Super-admin "Config" area (brands, countries, languages, content types, admins…)
│   └── api/                 # Public API handlers
├── model/                   # Mongoose schemas
├── resources/api/           # Response transformers (resources.js) used by API controllers
├── helper/                  # Cache, Redis, Mail, SMS, Slack, Logger, FileUpload, Revision, Jobs…
├── adaptors/
│   ├── file-upload/         # local / ImageKit / Cloudinary / AzureBlob / AwsS3 / BunnyCdn
│   └── email/               # mailgun / nodemailer
├── graphql/                 # Apollo typeDefs + resolvers
├── utils/                   # graphql.js, swagger.js, devAuth.js
├── views/admin-njk/         # Nunjucks templates for the admin panel
├── public/                  # Admin static assets, served at /cms-static
└── db-fix-scripts/          # One-off data migration scripts
```

---

## 3. Boot sequence (`index.js`)

Order matters in Express. This is the order `index.js` sets things up:

1. `require('./config/env.config')` loads `dotenv` and builds `envConfig`.
2. Swagger is mounted at `/api-docs`.
3. A per-request middleware sets `app.locals.baseURL` and `app.locals.clientName`.
4. Helmet security headers (HSTS, frameguard deny, XSS filter, hide powered-by).
5. `cors()` (open to all origins).
6. JSON / urlencoded body parsers (50 MB limit).
7. Static mounts:
   - `/cms-static` → package `public/` (admin theme assets)
   - `/static` → `${process.cwd()}/public` (**host app's** public folder)
   - `/uploads` → `${process.cwd()}/uploads` (local media drive)
8. `express-session` (see §8), `trust proxy` in production, `cookie-parser`.
9. Nunjucks configured on the package's own `views/`.
10. Mongo connection (async, not awaited). On success it seeds a `Config` doc if none exists and sets `global.globalModuleConfig = {}`.
11. `GET /health` returns DB status, APP_KEY presence, timezone, and server time.
12. Error handler (see Known issues §14: it is registered **before** the routes).
13. Dev auto-login (`utils/devAuth.js`) when `NODE_ENV=development` **and** `HAS_DEV_AUTH=true`.
14. Apollo GraphQL at `/graphql`.
15. Rate limit on `/api`: 1000 requests per 15 minutes per IP.
16. `GET /` redirects to `/admin`.
17. `/api` → `routes/api/web-api.routes.js`
18. `/admin` → `[baseConfig, nunjucksFilter, authUser, mainNavGenerator, allBrands]` → `routes/admin/admin.routes.js`

---

## 4. Core domain concepts

### 4.1 Multi-tenancy: Brand × Country × Language

- **Country** (`model/Country.js`): code, currency, symbol, decimals, timezone, position.
- **Language** (`model/Language.js`): name, `prefix` (e.g. `en`, `ar`), `dir`, `is_default`.
- **Brand** (`model/Brand.js`): localised name and logo, `code`, `languages[]`, marketing IDs, and
  `domains[]`. Each domain links a brand to one country and carries `maintenance_mode` and
  `ecommerce_maintenance_mode`.
- **Settings** (`model/Settings.js`): one document per brand + country, holding notification
  settings (mailgun, sms) and similar.
- **Config** (`model/Config.js`): one **global** document, seeded on first boot. It holds
  general settings and `media_drive` (default drive plus encrypted provider credentials).

In the admin panel, the active brand + country is stored in `req.session.brand`.
You switch it with `/admin/settings/switch-brand`.

In the API, `BrandWithCountryCheck` resolves the tenant on every request:

| Input | Source (first match wins) | Fallback |
| --- | --- | --- |
| Country | `?country=` then `country` header | first cached country |
| Brand | `?brand=` then `brand` header | first cached brand |
| Domain | brand.domains matching the country | first domain |
| Language | `?lang=` then `lang` header | default `Language` |
| Source | `source` header (`web` / `app`) | `web` |

It returns `503` when `domain.maintenance_mode` is on. The result is attached as
`req.brand`, `req.country`, `req.language` and `req.source`.

### 4.2 Content Types and Content

- **ContentType** (`model/ContentType.js`) is the schema definition, created by a super admin in `/admin/config/content-type`.
  - `brand[]`: the brands that can use it.
  - `slug`: used in admin URLs (`/admin/cms/:contentType`) and API URLs (`/api/cms/:contentType`).
  - `single_type`: `true` means a singleton page (e.g. "Home"); `false` means a collection.
  - `field_groups[]`: each group has `row_name`, `repeater_group`, `localisation`, `inline_fields`, and `fields[]`.
    Each field has `field_name`, `field_type`, `validation`, `options`, `show_on_list`, `multi_select` and `position`.
  - Field types used in views and controllers: `text, textarea, number, email, url, date, time, color, dropdown, checkbox, radio, file, media, wysiwyg, richtext, article_editor`.
  - Flags: `has_slug`, `has_meta` (SEO fields from `meta-fields.config.js`), `has_form` (attach a CustomForm),
    `page_builder` (GrapesJS editor), `has_api_endpoint`, `nav_on_collection_api` and `nav_on_single_api`
    (whether the API response includes navigation), and `allowed_type[]` (other content types that can be attached).
  - Admin nav: `admin_icon` (SVG), `admin_nav_section` and `has_access[]` (roles).
- **Content** (`model/Content.js`) is one entry of a content type, scoped to `brand` + `country`.
  - `content` holds the field values (shape depends on the content type and localisation).
  - `status` is `published`, `unpublished` or `scheduled`, with `scheduled_at.start` / `.end`
    (filtered at read time by `filteringScheduledCMSItems`).
  - `attached_type[]` holds references to other content, which the API expands into `attached_content`.
  - `form[]`, `products[]`, `meta`, `position`.
  - `revisions[]` stores a snapshot on each save (`helper/Revision.helper.js`, semver-like `revision_number`).
  - Soft delete via `deleted` / `deleted_at`.

### 4.3 Other models

| Model | Purpose |
| --- | --- |
| `Admin` | Admin users. `role` ∈ `super_admin, admin, editor, user, finance`. `privileges` is a comma-separated list of privilege ids. |
| `AdminNav` | Extra side-nav sections created from `/admin/config/admin-nav`. |
| `Menu` | Front-end menus per brand + country, `nav_position`, nested `nav_items[].child[]`. |
| `Media` | Uploaded file record: `drive`, `url`, `meta`, `file_type` (`image`/`pdf`), and the raw provider `response`. |
| `CustomForm` / `CustomFormData` | Form builder definitions and submissions. Forms can store to the DB, email recipients, auto-reply, post to Slack, or call a webhook. |
| `User` | Public end-users for the API (OTP, social login, failed-attempt lockout). |

---

## 5. Admin panel

### 5.1 Route tree (`routes/admin/admin.routes.js`)

```
/admin/auth/*            signup (first super admin), login, logout, forgot   ← public
/admin                   → redirect to ADMIN_LANDING_URL
── authCheck + checkRouteAccess applied below ──
/admin/dashboard
/admin/access-control/users       admin users (non-super)
/admin/cms/media/*                media library (upload, json, meta, delete)
/admin/cms/menu/*                 menu builder
/admin/cms/:contentType/*         list, add, edit, detail, duplicate, save, delete,
                                  change-status, editor/* (GrapesJS)   [unless HAS_CUSTOM_CONTENT_MANAGEMENT]
/admin/users                      public users list
/admin/settings/*                 general (logo, cache clear), seo, ecommerce/invoice, switch-brand
/admin/custom-forms/*             form builder, duplicate, submissions/export [unless HAS_CUSTOM_FORM_MANAGEMENT]
/admin/logs/server[/json]         server log viewer (reads <cwd>/logs)
/admin/admin-user/*               own profile / password
/admin/config/*   (super_admin)   admin, country, language, brand, content-type, admin-nav, app-settings
/admin/upload-article-image       editor inline image upload
```

### 5.2 Middleware chain on every `/admin` request

1. `baseConfig` puts branding into `res.locals` (title, logos, `hasEcommerce`, landing URL, current year).
2. `nunjucksFilter` adds date, JSON and pluralisation helpers to `res.locals`.
3. `authUser` loads session admin details.
4. `mainNavGenerator` builds the side nav (see §5.3).
5. `allBrands` lists brands for the brand switcher.
6. For protected routes: `authCheck` (session has `admin_id`, otherwise redirect to login) and `checkRouteAccess` (RBAC, §5.4).

### 5.3 Side navigation merge

`getNavigation()` in `cms.middleware.js` builds the nav in four steps:

1. Start from the built-in `navConfig` plus any DB `AdminNav` sections (`getBaseNavConfig`).
2. Deep-merge with the **host app's** `config/admin.config.js`, matched by `section` name and then by item `label`.
   A section or item with `is_hidden: true` in the host config removes it.
3. Append one entry per active ContentType for the current brand. Collections get "All X" and "Add X" children.
   Single types get a direct link. They are placed under `admin_nav_section` (default `Content`).
4. Filter by `has_access` against the admin role, then sort by `position`.

### 5.4 RBAC (`cmsAuth.middleware.js`)

- The privilege tree is the built-in `privileges(req)` from `config/userPrivilege.config.js`, which
  generates `cms.<slug>`, `<slug>.view` and `<slug>.manage` per content type.
  It is merged with the host's `config/userPrivilege.config.js` → `customPrivileges`, joined by `section`.
- Every leaf has an `id` and `urls[]`. URL patterns support `:param`.
- `super_admin` and `admin` can reach every URL. Other roles can only reach URLs whose `id` is in
  `Admin.privileges`, plus `dashboard.page`, `/admin/upload-article-image` and `/admin/settings/switch-brand`.
- `res.locals.allowedURLs`, `allowedSections` and `userPrivileges` are exposed to templates.
  `allowedSections` for admins is the built-in list plus the host's `customSections`.
- The merged tree is cached in Redis for **30 days** under `<prefix>-mixed-privileges-<brand>-<country>`.
  If you add a content type or change privilege config, clear the cache from Settings › General.

---

## 6. Public API (`/api`)

Every `/api` route goes through `BrandWithCountryCheck`, `webDefaultHeader`, `getNav` and `userAgent`.

| Method & path | Handler | Notes |
| --- | --- | --- |
| `GET /api` | inline | ping |
| `GET /api/cms/:contentType` | `contentType.list` | Single type returns one object, collection returns an array. Expands `attached_type`. *(disabled by `HAS_CUSTOM_CMS_API_ROUTES`)* |
| `GET /api/cms/:contentType/static-path` | `generateStaticPath` | slugs for Next.js SSG |
| `GET /api/cms/:contentType/:slug` | `contentType.detail` | |
| `GET /api/general/menu` | `menuList` | |
| `GET /api/general/brand` | `brandingDetail` | |
| `GET /api/general/navigation` | `navList` | |
| `POST /api/auth/login` (`/social`, `/update-mobile`) | auth | *(disabled by `HAS_CUSTOM_AUTH_API_ROUTES`)* |
| `POST /api/auth/signup`, `/verify`, `/resend-otp`, `/forgot`, `/forgot/verify` | auth | OTP via SMS / email |
| `POST /api/custom-forms/submit` | `customFormSubmit` | |
| `GET /api/user/logout`, `GET /api/user/account`, `POST …/edit`, `POST …/change-password` | user | JWT (`UserAuthCheck`) *(disabled by `HAS_CUSTOM_USER_API_ROUTES`)* |

**End-user auth:** the JWT is signed with `APP_KEY` and sent as `Authorization: Bearer <token>`.
When caching is active, the token must also match Redis key `user-<source>-auth-<userId>`,
which allows single-session enforcement and logout.

Responses are shaped by classes in `resources/api/*` (`resources.js` library). Change the
resource classes when you need to change the response format.

**GraphQL** (`/graphql`): `contents(where: {type_slug})`, `content(id)`, `admins`.

---

## 7. Caching (Redis)

- Client: `helper/Redis.helper.js` (`getCache`, `setCache`, `removeCache`, `clearCacheAll`, `flushCache`).
  All keys are prefixed with `CACHE_KEY_PREFIX` (default `beaver-data`).
- `CACHE_LOCAL_DATA=false` turns caching off. `getCache` then returns `null` and `setCache` does nothing.
- `helper/Cache.helper.js` caches brands, countries and brand settings.
- Admin "Clear cache" (`/admin/settings/general/clear-cache`) streams and deletes keys in chunks.
- **Redis is required at boot.** The ioredis client is created at import time even if caching is off,
  and the Redis session store needs it too.

---

## 8. Sessions

`SESSION_STORAGE=file` (default) stores sessions in `<cwd>/sessions/*.json`.
`SESSION_STORAGE=redis` uses connect-redis. TTL comes from `SESSION_MAX_AGE` (minutes, default 720).
The session secret is `APP_KEY`. Use Redis whenever you run more than one instance.

---

## 9. Media storage

`helper/FileUpload.helper.js` → `uploadMedia(media, folder, file)` reads
`Config.media_drive.default_drive` and dispatches to an adaptor in `adaptors/file-upload/`:

| drive | adaptor | credentials |
| --- | --- | --- |
| `local` | `localUpload.adaptor.js` | none. Writes to `<cwd>/uploads/<folder>`, served at `/uploads` |
| `imagekit` | `ImageKit.adaptor.js` | Config (encrypted), falls back to `IMAGEKIT_*` env |
| `cloudinary` | `Cloudinary.adaptor.js` | Config (encrypted) |
| `azure_blob` | `AzureBlob.adaptor.js` | Config (encrypted). Needs `@azure/storage-blob` (**not in package.json**) |
| `s3` | `AwsS3.adaptor.js` | Config (encrypted). Needs `@aws-sdk/client-s3` (**not in package.json**) |

Credentials are set in `/admin/config/app-settings` and stored encrypted with
`Operations.helper.encryptData` (AES, key = `ENCRYPTION_KEY`, which is `APP_KEY` when it is 64 hex characters).

**To add a new storage provider:**

1. Create `adaptors/file-upload/<Name>.adaptor.js` that exports upload and delete functions with the same signature as the existing adaptors.
2. Add the drive key to the `enum` in `model/Config.js` (`media_drive.default_drive`) and in `model/Media.js` (`drive`), and add its config sub-object to `Config`.
3. Add branches in `uploadMedia` and `deleteMediaFile`.
4. Add form fields in `views/admin-njk/config/app-settings/*` and handle saving and encryption in `controller/config/appSettings.controller.js`.
5. Add the SDK to `dependencies`.

---

## 10. Background jobs (Agenda)

`helper/Jobs.js` creates an Agenda instance backed by Mongo (`agenda_jobs`
collection). It defines one job, `job queues`, which calls
`require(<cwd>/jobs)[method](payload)`.

- The host app must export job functions from `jobs/index.js`. Each returns `true` on success
  or a falsy value to retry (up to 3 times, 5 s apart).
- Enqueue a job with `queueJob({ method: 'testJob', payload: {...}, delay: '10 seconds' })`.
- Nothing in the package `require`s `helper/Jobs.js` by default, so the queue only starts if
  some code imports it. `require(<cwd>/jobs)` throws if the host has no `jobs/` folder.

---

## 11. Logging

`helper/Logger.helper.js` (Winston + daily-rotate-file) writes to `<cwd>/logs/`:
`info-YYYY-MM-DD.log`, `warn-…`, `error.log` and `exception.log`. Use `logError(err)`,
`logWarn(msg)` and `logInfo(msg)` instead of `console.log`. You can view the logs at `/admin/logs/server`.

---

## 12. Environment variables (read in `config/env.config.js`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | |
| `PORT` | `8080` | host app listens on it |
| `APP_KEY` | **random per boot** | session secret, JWT secret, encryption key (if 64 hex chars). **Always set it.** |
| `HAS_ENCRYPTION` | false | |
| `SESSION_MAX_AGE` | 720 | minutes |
| `SESSION_STORAGE` | `file` | `file` \| `redis` |
| `DOMAIN` | request host | `app.locals.baseURL` |
| `FRONTEND_URL`, `CLIENT_NAME` (`Beaver`) | | branding |
| `CMS_LOGO_LARGE`, `CMS_LOGO_SMALL` | beaver logo | admin logos |
| `ADMIN_LANDING_URL` / `ADMIN_LANDING_URL_PRIVILEGE_ID` | `/admin/dashboard` / `dashboard.page` | |
| `CAPTCHA_ENABLED`, `CAPTCHA_BASE_URL`, `CAPTCHA_SECRET_KEY` | off | admin login captcha |
| `HAS_PDF_UPLOAD` | true | allow PDFs in media |
| `SEND_SIGNUP_MAIL` | false | |
| `HAS_DEV_AUTH` | false | auto-login as the first admin in development |
| `HAS_ECOMMERCE` | false | exposes `hasEcommerce` to templates |
| `HAS_CUSTOM_AUTH_API_ROUTES` | false | disable built-in `/api/auth/*` |
| `HAS_CUSTOM_USER_API_ROUTES` | false | disable built-in `/api/user/*` |
| `HAS_CUSTOM_CMS_API_ROUTES` | false | disable built-in `/api/cms/*` |
| `HAS_CUSTOM_CONTENT_MANAGEMENT` | false | disable built-in `/admin/cms/:contentType/*` |
| `HAS_CUSTOM_FORM_MANAGEMENT` | false | disable built-in `/admin/custom-forms/*` |
| `DB_CONNECTION`, `DB_NAME` | `DB_NAME` falls back to lower-case `CLIENT_NAME` | MongoDB |
| `IMAGEKIT_PUBLIC_KEY/PRIVATE_KEY/URL/FOLDER` | | ImageKit fallback |
| `MAILGUN_DOMAIN/API_KEY/FROM/URL/TEMPLATE_FORGOT_PASSWORD/TEMPLATE_WELCOME` | | email |
| `CACHE_LOCAL_DATA` | on | set `false` to disable the Redis cache |
| `REDIS_URL` | `redis://localhost:6379` | |
| `CACHE_KEY_PREFIX` | `beaver-data` | use a unique prefix per deployment that shares a Redis |
| `SLACK_ADMIN_CHANNEL` | | Slack notifications |

Variables read elsewhere (SMS helper `APTIVA_*`, token expiry `WEB_USER_TOKEN_EXPIRY` and
`MOBILE_USER_TOKEN_EXPIRY`, etc.) can be found with `grep -rn "process.env" --exclude-dir=node_modules .`

---

## 13. Extension points for host apps

The package resolves these files from the host app at runtime. They are the supported way to
customise it without forking:

| Host file | Resolved via | Used by | Shape |
| --- | --- | --- | --- |
| `config/admin.config.js` | `path.dirname(require.main.filename)` | `cms.middleware.js` nav merge | `module.exports = [ {section, section_slug, position, has_access, is_hidden?, items:[{label, icon, path, expandable, child[], is_hidden?}]} ]` |
| `config/userPrivilege.config.js` | `require.main` dir | `cmsAuth.middleware.js` | `module.exports = { customPrivileges: [ {id, text, section, children:[{id, text, urls[]}]} ], customSections: ['ecommerce', …] }` |
| `jobs/index.js` | `process.cwd()` | `helper/Jobs.js` | `module.exports = { jobName: async (payload) => boolean }` |
| `public/` | `process.cwd()` | static at `/static` | |
| `uploads/`, `sessions/`, `logs/` | `process.cwd()` | local drive, file sessions, logs | created at runtime |
| `HAS_CUSTOM_*` env flags | env | route registration | turn off a built-in route group so the host can mount its own |

**Important:** the two `config/*.js` files are resolved next to the **entry script**
(`require.main.filename`). The other paths are resolved from the **process working directory**.
Run the host from its own root folder (e.g. `node app.js` inside `cms/`).

Typical custom-module recipe (e.g. Ecommerce):

1. In the host, build an Express router for `/admin/ecommerce/*` and mount it **before** `app.use(beaverCMS)`.
   Protect it with the package's `authCheck` and `checkRouteAccess` if you import them.
2. Add the nav section to host `config/admin.config.js`.
3. Add privileges for each URL to host `config/userPrivilege.config.js` and add the section slug to `customSections`.
4. Clear the Redis cache so the merged privileges are rebuilt.

---

## 14. Known issues and tech debt (found during analysis)

Fix these first when you touch the related area.

1. **The error handler is registered before the routes** in `index.js`, so it never catches errors from `/admin` or `/api`.
   It also renders `admin/error-<status>`, which does not exist. The real templates are
   `admin-njk/app-error-404.njk` and `app-error-500.njk`. Move it to the end and add a 404 handler.
2. **GraphQL has no auth.** The `admins` query returns every admin's name, email, role and status to anyone who can reach `/graphql`.
   The GraphQL type keeps password hashes out, but the resolver still loads full documents.
   `contents` also ignores brand, country and publish status. Add auth or remove the query.
3. **The content list API cache never hits.** `contentType.controller.js` checks `envConfig.cache.ACTIVE == 'true'`,
   but `ACTIVE` is a boolean. It also uses an implicit global `for (i = 0; …)`.
4. **APP_KEY fallback is random per boot.** If `APP_KEY` is missing, every restart invalidates sessions and JWTs.
   If it is not exactly 64 hex characters, `ENCRYPTION_KEY` is random, so stored drive credentials can't be decrypted after a restart.
5. Azure Blob and S3 SDKs are lazily required but **not declared as dependencies**.
6. `getCache` returns the error object on failure, and callers then `JSON.parse` it. It should return `null`.
7. The privilege cache lasts 30 days and is not invalidated when content types change.
8. Swagger `servers.url` is hardcoded to `http://localhost:8081`, and `apis: ['./routes/api/*.js']` is relative to the
   **host's** cwd, so the spec is empty when the package runs from `node_modules`. Use `path.join(__dirname, …)`.
9. `package.json` `dev` and `start` scripts point at `app.js`, which doesn't exist in the package. `test` is a placeholder.
10. `cors()` is fully open. The rate-limit comment says 100 requests but the code allows 1000.
11. `Content` virtual `date_created` hardcodes the `Asia/Dubai` timezone.
12. The API `list` query for `allContents` (attached content lookup) is not filtered by brand.
13. `crypto`, `fs` and `path` are listed as npm dependencies. They are Node built-ins, so remove them.
14. There are no automated tests. Jest is installed but unused.

---

## 15. Local development workflow

The wrapper `cms/app.js` currently does `require('../cms-package')` (local path) instead of
`require('beaver-cms')`. Nodemon in `cms/nodemon.json` also watches `../cms-package/**/*`, so
editing the package hot-reloads the wrapper.

```bash
# terminal 1: Mongo + Redis must be reachable (see cms/docker-compose.yml for Redis)
cd cms && npm install && npm run dev
```

You can also use `npm link`:

```bash
cd cms-package && npm link
cd ../cms && npm link beaver-cms
```

Then switch `app.js` back to `require('beaver-cms')`.

Admin theme assets: `public/admin` contains the theme's gulp sources (excluded from the
published package by `.npmignore`). Tailwind and laravel-mix are dev dependencies for CSS builds.

---

## 16. Release process

1. Make sure the wrapper runs against your local package and spot-check `/health`, `/admin` and `/api/cms/<type>`.
2. Bump `version` in `package.json` (semver: patch for fixes, minor for features, major for breaking schema or route changes).
3. Check what will ship with `npm pack --dry-run`. `.npmignore` excludes theme sources and lock files.
4. `npm publish` (public access is set in `publishConfig`; auth comes from `.npmrc`, never commit tokens).
5. In host apps, bump `beaver-cms` and run them against a staging DB first. Schema changes may need a script in `db-fix-scripts/`.

Repository: `git@github.com:ioticsme/cms-package.git`. Active branch `dev`, release branch `main`.

---

## 17. Checklist: adding a feature

- [ ] New env var? Add it to `config/env.config.js` (never read `process.env` elsewhere) and to the table in §12 and the wrapper `.env.example`.
- [ ] New admin page? Add the route in `routes/admin/*`, the controller in `controller/admin/*`, the view in `views/admin-njk/*`,
      a **privilege entry** in `config/userPrivilege.config.js` (or the page is 403 for editors), and a nav entry in `config/admin.config.js`.
- [ ] New API endpoint? Add it under `routes/api/*` (behind `BrandWithCountryCheck`), shape output with a `resources/api/*` class, and cache via `Redis.helper` with a `CACHE_KEY_PREFIX` key.
- [ ] Schema change? Make it backwards compatible or ship a `db-fix-scripts/` migration.
- [ ] Cached data changed by admin actions? Call `removeCache` for the affected keys.
- [ ] Should host apps be able to override it? Add a `HAS_CUSTOM_*` flag.
- [ ] Bump the version and update this document.
