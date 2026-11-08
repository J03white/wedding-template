# Wedding Website Template

Hugo site deployed as a Cloudflare Worker with assets (Workers Builds, git-connected) — see "Manual deployment steps" below for why this isn't Cloudflare Pages. The couple can update all content (text, photos, event details, FAQ) via a visual admin panel at `/admin` — no GitHub account or technical knowledge required.

---

## New client setup

Run `/new-wedding-site` in Claude Code and it will walk through replacing all the placeholders and pushing to GitHub. See `ai-toolkit` for the full automated pipeline covering this plus the manual deployment steps below.

Placeholders used throughout the project:

| Placeholder | What to replace it with |
|---|---|
| `PLACEHOLDER_COUPLE_NAMES` | e.g. "Alice & Ben" |
| `PLACEHOLDER_DATE_SHORT` | e.g. "14th September 2026" |
| `PLACEHOLDER_DATE_FULL` | e.g. "Sunday 14th September 2026" |
| `PLACEHOLDER_VENUE_NAME` | e.g. "Barnsley House" |
| `PLACEHOLDER_VENUE_LOCATION` | e.g. "Barnsley, Gloucestershire" |
| `PLACEHOLDER_RSVP_DATE` | e.g. "1st April 2026" |
| `PLACEHOLDER_SITE_DOMAIN` | e.g. "alice-and-ben-wedding.com" |
| `OWNER/REPO` | e.g. "j03white/alice-ben-wedding" |
| `PLACEHOLDER_TURNSTILE_KEY` | Cloudflare Turnstile site key |
| `PLACEHOLDER_WORKER_NAME` (`wrangler.toml`) | Short slug for the Worker/project name, e.g. "alice-ben-wedding" |

`wrangler.toml`'s other `PLACEHOLDER_*` values (`CF_TEAM_DOMAIN`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SHEET_ID`, `SITE_PASSWORD`, `DROPBOX_APP_KEY`, `DROPBOX_FOLDER_PATH`) aren't known yet at this stage — they get filled in during the manual deployment steps below, not this initial pass.

---

## Local development & testing

### Site only

```bash
hugo server
```

Visit `http://localhost:1313`. Hugo hot-reloads on every file save — layouts, content, CSS, images all update instantly.

### Site + CMS admin

To test the admin editor locally you need two terminals and one temporary config change.

**Step 1** — add `local_backend: true` to `static/admin/config.yml`:

```yaml
local_backend: true   # ← add this line
backend:
  name: github
  ...
```

**Step 2** — run the local CMS proxy in one terminal:

```bash
npx decap-server
```

**Step 3** — run Hugo in a second terminal:

```bash
hugo server
```

Visit `http://localhost:1313/admin`. No login is required in local mode — you land straight in the editor. Changes are written to your local files and Hugo reloads the site immediately.

> **Before pushing to GitHub**, remove the `local_backend: true` line from `static/admin/config.yml`. If it's left in, the deployed site will try to connect to a local proxy that doesn't exist.

### Couple Photos in local mode

The Couple Photos section reads from `data/gallery.yaml`. To test adding/removing photos locally:
1. Open the admin at `/admin`
2. Click **Couple Photos** in the left nav
3. Add or remove photos and click Save
4. `data/gallery.yaml` updates on disk and the carousel on `http://localhost:1313` reloads

---

## Manual deployment steps

These steps are done once per client after pushing the code to GitHub. The site deploys as a **Cloudflare Worker with assets** (Workers Builds, git-connected), not Cloudflare Pages — Pages is Cloudflare's legacy platform; Workers is what they now steer all new projects toward, and it's what every real site built from this template deploys as.

**Variable rules, learned the hard way (see `wedding-website/README.md` for the full story):** non-secret values go in `wrangler.toml`'s `[vars]` block, committed to the repo — `wrangler deploy` (which Workers Builds runs on every push) syncs those from the file every time, so anything set only via the dashboard as a plain "Variable" gets silently wiped on the next deploy. Actual secrets go **only** in the dashboard (Settings → Variables and Secrets, type "Secret") or via `wrangler secret put <NAME>` — never in `wrangler.toml`, never committed.

### 1 — Cloudflare Workers Builds

1. Go to **Workers & Pages** → Create → connect the client's GitHub repository
2. Build command: `hugo`
3. Deploy command: `npx wrangler deploy`
4. Deploy — the site will be live at `https://<SITE_DOMAIN>`

There's no API or Terraform resource for this step — confirmed directly against Cloudflare's own docs. It's a one-time dashboard click per new site.

---

### 2 — GitHub Personal Access Token

The CMS needs a token to commit content changes to the repo on the couple's behalf.

1. Go to **GitHub → Settings → Developer Settings → Personal access tokens → Fine-grained tokens**
2. Create a new token scoped to **only this repository**
3. Permissions: **Contents: Read and Write** (nothing else)
4. Set an expiry (1 year recommended)
5. Copy the token — you only see it once
6. Set it as a **Secret** on the Worker: `wrangler secret put GITHUB_PAT`

---

### 3 — Cloudflare Access (magic link login)

This is what lets the couple log into `/admin` using just their email address — no GitHub account needed. **Prefer managing this via `wedding-infra`'s Terraform module** (`modules/wedding-site`) rather than the dashboard — add a `module` block in `sites.tf` with the new site's domain and the couple's emails, `terraform apply` creates the Access application and policy, and its `aud` output is what you need for step 3's `CF_ACCESS_AUD`.

If doing it manually instead:
1. Go to **Cloudflare Zero Trust → Access → Applications → Add an application**
2. Type: **Self-hosted**
3. Application name: e.g. "Alice & Ben Wedding Admin"
4. Application domain: `<SITE_DOMAIN>/admin`
5. Authentication method: **One-time PIN** (magic link email)
6. Policy → rule type: **Emails** → add the couple's email addresses
7. Save — copy the **AUD tag** shown on the application details page

### 3b — Set the Worker's runtime variables

- `wrangler.toml` `[vars]` (non-secret, commit these): `CF_TEAM_DOMAIN`
- Dashboard or `wrangler secret put`: `CF_ACCESS_AUD` (the AUD tag from step 3)

---

### 4 — Turnstile

There's already **one shared Turnstile widget** across every client site's domains (see `wedding-infra`'s `turnstile.tf`) rather than one per site — just add the new site's domain to that widget's `domains` list and `terraform apply`. The resulting site key goes in `hugo.toml` → `params.turnstileSiteKey`; the secret key goes in the Worker as `TURNSTILE_SECRET_KEY` (optional — server-side verification is skipped if unset).

---

### 5 — Google Sheets RSVP backend

RSVP submissions append to a Google Sheet via `functions/rsvp.js`.

**Google Cloud (one-off per account, can be reused across multiple sites):** the `rsvp-writer` service account already exists, managed in `wedding-infra`'s Terraform (`service-accounts.tf`) — no new service account needed per client.

**Per client:**
1. Create two Google Sheets (production + dev), each with a tab named `RSVPs`
2. Header row — match whichever columns this site's RSVP form actually sends:
   `submission_id | submitted_at | guest_name | guest_email | is_primary_guest | attending | dietary | party_size`
   — plus `accommodation | rooms | nights` on the end **only if** this site's RSVP page has `onsiteAccommodation: true`
3. **Share** each sheet with the service account's `client_email` (`rsvp-writer@wedding-512615.iam.gserviceaccount.com`), set to **Editor**
4. Grab each sheet's ID from its URL (`.../spreadsheets/d/<ID>/edit`)
5. Worker runtime vars:
   - `wrangler.toml` `[vars]`: `GOOGLE_SHEET_ID` (the production sheet's ID), `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - Secret: `GOOGLE_PRIVATE_KEY`

---

### 6 — Guest photo uploads

Guests can upload photos at `/photos` via `functions/photo-upload.js`. The storage backend is pluggable — pick ONE per site with the `PHOTO_STORAGE_PROVIDER` environment variable, set to either `dropbox` or `google-drive`. The request handler doesn't know which one is active; it just calls whichever adapter is configured, so switching providers later is a config change, not a code change.

**Option A — Dropbox (works for any couple, default choice):**

The shared app (App Folder access, `files.content.write` only) already exists — no new Dropbox app needed per client unless the couple wants their own separate Dropbox account (see `wedding-infra`'s notes on this).

Per client:
1. Inside the app's sandboxed folder, create a subfolder for the couple, e.g. `/alice-and-ben`
2. Manually share that subfolder with the couple's email (Dropbox UI → Share) so they can see what guests upload — this is a plain Dropbox share, outside the app's own API access
3. Worker runtime vars:
   - `wrangler.toml` `[vars]`: `PHOTO_STORAGE_PROVIDER` = `dropbox`, `DROPBOX_APP_KEY`, `DROPBOX_FOLDER_PATH` (e.g. `/alice-and-ben`)
   - Secrets: `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`

**Option B — Google Drive (Workspace accounts only):**

Only viable if the couple has paid Google Workspace — service accounts have zero personal Drive storage quota, so this requires a **Shared Drive**, which doesn't exist on free/personal Gmail no matter how a folder is shared. The dedicated `photo-uploader` service account (Terraform-managed, scope `drive.file` only — confirmed via direct API test that it can create files but never read them back) already exists; reuse it rather than creating a new one.

Per client:
1. Create a Shared Drive in the couple's Workspace, add `photo-uploader@wedding-512615.iam.gserviceaccount.com` as a member
2. Create a destination folder inside that Shared Drive, grab its folder ID from the URL
3. Worker runtime vars:
   - `wrangler.toml` `[vars]`: `PHOTO_STORAGE_PROVIDER` = `google-drive`, `GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SHARED_DRIVE_ID`, `GOOGLE_DRIVE_FOLDER_ID`
   - Secret: `GOOGLE_DRIVE_PRIVATE_KEY`

---

### 7 — Add images

Commit the following images to the repository:

| File | Purpose |
|---|---|
| `assets/images/venue/hero.jpg` | Large hero photo on the homepage |
| `assets/images/details/ceremony.jpg` | Ceremony event card |
| `assets/images/details/reception.jpg` | Reception event card |

Any photos added to `assets/images/couple/` will appear in the homepage photo carousel.

---

### 8 — Final check

1. Visit `https://<SITE_DOMAIN>/admin`
2. Cloudflare Access prompts for email → enter one of the authorised addresses
3. Click the magic link in the email
4. The CMS loads — click **Login**
5. The login popup opens, validates automatically, and closes
6. Edit a field, click Save — the change is committed and the site rebuilds in ~45 seconds

---

## How the admin works

The couple visit `/admin`, authenticate via a magic link sent to their email (Cloudflare Access), and land in a visual editor. When they save a change, the CMS commits the updated content file directly to the GitHub repo. Cloudflare Pages detects the commit and rebuilds the site automatically in about 45 seconds.

The couple photos gallery is managed via the **Couple Photos** section in the CMS — add, remove, or reorder photos and they appear in the homepage carousel automatically.
