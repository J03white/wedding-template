# Wedding Website Template

Hugo site deployed on Cloudflare Pages. The couple can update all content (text, photos, event details, FAQ) via a visual admin panel at `/admin` — no GitHub account or technical knowledge required.

---

## New client setup

Run `/new-wedding-site` in Claude Code and it will walk through replacing all the placeholders and pushing to GitHub.

Placeholders used throughout the project:

| Placeholder | What to replace it with |
|---|---|
| `PLACEHOLDER_COUPLE_NAMES` | e.g. "Alice & Ben" |
| `PLACEHOLDER_DATE_SHORT` | e.g. "14th September 2026" |
| `PLACEHOLDER_DATE_FULL` | e.g. "Sunday 14th September 2026" |
| `PLACEHOLDER_VENUE_NAME` | e.g. "Barnsley House" |
| `PLACEHOLDER_VENUE_LOCATION` | e.g. "Barnsley, Gloucestershire" |
| `PLACEHOLDER_RSVP_DATE` | e.g. "1st April 2026" |
| `PLACEHOLDER_SITE_DOMAIN` | e.g. "alice-ben-wedding.pages.dev" |
| `OWNER/REPO` | e.g. "j03white/alice-ben-wedding" |
| `PLACEHOLDER_FORMSPREE_ID` | Formstree form ID |
| `PLACEHOLDER_TURNSTILE_KEY` | Cloudflare Turnstile site key |

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

These steps are done once per client after pushing the code to GitHub.

### 1 — Cloudflare Pages

1. Go to **Cloudflare Pages** → Create a project → Connect to Git
2. Select the client's repository
3. Set **build command**: `hugo`
4. Set **build output directory**: `public`
5. Deploy — the site will be live at `https://<SITE_DOMAIN>`

---

### 2 — GitHub Personal Access Token

The CMS needs a token to commit content changes to the repo on the couple's behalf.

1. Go to **GitHub → Settings → Developer Settings → Personal access tokens → Fine-grained tokens**
2. Create a new token scoped to **only this repository**
3. Permissions: **Contents: Read and Write** (nothing else)
4. Set an expiry (1 year recommended)
5. Copy the token — you only see it once

---

### 3 — Cloudflare Pages environment variables

Go to **Cloudflare Pages → [project] → Settings → Environment Variables** and add these as encrypted variables (Production + Preview):

| Variable | Value |
|---|---|
| `GITHUB_PAT` | The fine-grained token from step 2 |
| `CF_TEAM_DOMAIN` | Your Zero Trust team domain, e.g. `yourteam.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | The AUD tag from the Access application (step 4) |

After adding variables, trigger a redeploy: **Pages → Deployments → Retry deployment**.

---

### 4 — Cloudflare Access (magic link login)

This is what lets the couple log into `/admin` using just their email address — no GitHub account needed.

1. Go to **Cloudflare Zero Trust → Access → Applications → Add an application**
2. Type: **Self-hosted**
3. Application name: e.g. "Alice & Ben Wedding Admin"
4. Application domain: `<SITE_DOMAIN>/admin`
5. Authentication method: **One-time PIN** (magic link email)
6. Policy → rule type: **Emails** → add the couple's email addresses
7. Save — copy the **AUD tag** shown on the application details page
8. Paste the AUD tag as `CF_ACCESS_AUD` in the Pages environment variables (step 3)

---

### 5 — Add images

Commit the following images to the repository:

| File | Purpose |
|---|---|
| `assets/images/venue/hero.jpg` | Large hero photo on the homepage |
| `assets/images/details/ceremony.jpg` | Ceremony event card |
| `assets/images/details/reception.jpg` | Reception event card |

Any photos added to `assets/images/couple/` will appear in the homepage photo carousel.

---

### 6 — Final check

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
