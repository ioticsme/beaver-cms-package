# beaver-cms — Task List

Work items taken from the "Known issues and tech debt" list in
[`docs/ARCHITECTURE.md` §14](docs/ARCHITECTURE.md#14-known-issues-and-tech-debt-found-during-analysis),
plus issues found in the custom form module. Each one was checked against the code on 2026-10-12.

Priority: **P1** = security or data leak, **P2** = broken behaviour, **P3** = cleanup.

When a task is done, tick it here and remove or update the matching entry in `docs/ARCHITECTURE.md` §14.

---

## Done

- [x] **Duplicate custom form.** "Duplicate" was added to the Actions menu in the custom forms list.
  - `POST /admin/custom-forms/duplicate` → `customForm.controller.duplicateForm`
  - The copy is named `<name> Copy` (or `Copy 2`, `Copy 3`, … when that name is taken) and gets a unique `type`.
    It is created **unpublished**. Submissions are not copied. The admin is then taken to the copy's edit page.
  - The URL was added to the `custom_forms.manage` privilege.
  - Client helper: `duplicateItem()` in `public/common/js/custom-functions.js`.

---

## P1: Security

- [ ] **T1. Lock down GraphQL** (§14.2)
  - `graphql/graphQLschema.js`: the `admins` query returns every admin's name, email, role and status, with no auth.
    The resolver loads full documents, password hashes included.
  - `contents` ignores brand, country and publish status.
  - **Do:** remove the `admins` query (or put it behind admin auth), and filter `contents` by brand, country and `status: 'published'`.
    Use `.select()` so password hashes are never loaded.

- [ ] **T2. Scope custom form admin queries to brand + country** (found while adding duplicate)
  - `save` (edit branch) runs `updateOne({ _id: body.id })` with no brand or country filter.
  - `viewSubmissions` loads the form by `_id` only (the brand filter is commented out).
  - `viewSubmission` loads the form and the submission by id only.
  - **Do:** add `brand: req.authUser.brand._id, country: req.authUser.brand.country` to each query, and return 404 when nothing matches.

- [ ] **T3. Remove the module-level `session` variable in admin controllers** (found while adding duplicate)
  - `controller/admin/customForm.controller.js` declares `let session` at module level and sets it on each request.
    Concurrent requests from different admins can read each other's brand.
  - **Do:** use a local `const session = req.authUser` in each handler.
    Check other admin controllers for the same pattern with `grep -rn "^let session" controller`.

- [ ] **T4. Restrict CORS and fix the rate limit comment** (§14.10)
  - `index.js` calls `cors()` with no options.
  - The rate limit comment says 100 requests but `max` is 1000.
  - **Do:** add an allowed-origins env var (e.g. `CORS_ORIGINS`) to `config/env.config.js`, and fix the comment or the value.

- [ ] **T5. Filter attached content by brand in the content API** (§14.12)
  - In `controller/api/contentType.controller.js` `list`, the `allContents` lookup for attached content is not filtered by brand.
  - **Do:** add brand and country filters to that query.

---

## P2: Broken behaviour

- [ ] **T6. Move the error handler after the routes and add a 404 handler** (§14.1)
  - `index.js` line ~91 registers the error handler before `/api` and `/admin`, so it never catches their errors.
  - It renders `admin/error-<status>`, which does not exist.
  - **Do:** move it after the route mounts. Render `admin-njk/app-error-404` / `app-error-500` for admin requests
    and return JSON for `/api`. Add a 404 handler before it.

- [ ] **T7. Fix the content API cache check** (§14.3)
  - `controller/api/contentType.controller.js` (lines ~29, 171, 230, 287) compares `envConfig.cache.ACTIVE == 'true'`,
    but `ACTIVE` is a boolean, so the cache never hits.
  - Implicit global `for (i = 0; …)` loops in `contentType.controller.js` (~121), `customForm.controller.js` (~95)
    and `catalog.controller.js` (~14).
  - **Do:** use `if (envConfig.cache.ACTIVE && data)` and declare `let i` in each loop.

- [ ] **T8. Make `APP_KEY` required** (§14.4)
  - With no `APP_KEY`, a random key is made on each boot, so every restart logs everyone out and breaks JWTs.
  - If it is not 64 hex characters, `ENCRYPTION_KEY` is random, and stored drive credentials can't be decrypted after a restart.
  - **Do:** fail at boot (or log a loud warning in development) when `APP_KEY` is missing or not 64 hex characters.
    Document how to generate one.

- [ ] **T9. `getCache` should return `null` on error** (§14.6)
  - `helper/Redis.helper.js` returns the error object, and callers then `JSON.parse` it.
  - **Do:** log the error and return `null`.

- [ ] **T10. Invalidate the privilege cache when content types change** (§14.7)
  - The merged privilege tree is cached for 30 days and only cleared by hand.
  - **Do:** call `removeCache` for `<prefix>-mixed-privileges-*` when a content type or admin nav is saved or deleted.

- [ ] **T11. Fix Swagger paths** (§14.8)
  - `utils/swagger.js` hardcodes `servers.url: 'http://localhost:8081'`, and `apis: ['./routes/api/*.js']`
    is relative to the host's cwd, so the spec is empty when the package runs from `node_modules`.
  - **Do:** use `path.join(__dirname, '../routes/api/*.js')` and build the server URL from `envConfig` (`DOMAIN`).

- [ ] **T12. Custom form `type` uniqueness should be per brand + country** (found while adding duplicate)
  - `save` checks for an existing `type` across all brands, so two brands can't have a form with the same name.
  - On edit, `type` is regenerated from `form_name.en` with no uniqueness check, so renaming can create a clash.
  - **Do:** scope the check to brand + country and run it on edit too (excluding the current form).
    Update `duplicateForm` to use the same scope.

---

## P3: Cleanup

- [ ] **T13. Declare optional storage SDKs** (§14.5)
  - `@azure/storage-blob` and `@aws-sdk/client-s3` are lazily required but not in `package.json`.
  - **Do:** add them as `optionalDependencies` (or `peerDependencies` marked optional) and show a clear error when one is missing.

- [ ] **T14. Fix `package.json` scripts** (§14.9)
  - `dev` and `start` run `app.js`, which does not exist in the package. `test` is a placeholder.
  - **Do:** remove `dev` and `start` (or point them at a small dev entry), and set `test` to `jest` once T17 starts.

- [ ] **T15. Make the timezone configurable** (§14.11)
  - `Asia/Dubai` is hardcoded in the date virtuals of `model/Content.js`, `model/CustomForm.js` and `model/CustomFormData.js`.
  - **Do:** read it from an env var (e.g. `APP_TIMEZONE`, default `Asia/Dubai`) through `config/env.config.js`,
    or from the country's `timezone`.

- [ ] **T16. Remove Node built-ins from dependencies** (§14.13)
  - `crypto`, `fs` and `path` are in `dependencies`.
  - **Do:** remove them and run `npm install` to refresh the lock file.

- [ ] **T17. Add automated tests** (§14.14)
  - Jest is installed but there are no tests.
  - **Do:** start with tests for `BrandWithCountryCheck`, `checkRouteAccess`, the custom form `save` / `duplicateForm` handlers
    and `Redis.helper`, using an in-memory Mongo (`mongodb-memory-server`) and a mocked Redis.
