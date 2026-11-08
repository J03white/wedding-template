/**
 * Cloudflare Pages Function — POST /photo-upload
 *
 * Lets wedding guests upload photos straight from the website into the
 * couple's cloud storage. Verifies Turnstile and a honeypot server-side
 * (same pattern as functions/rsvp.js), then hands each file to whichever
 * storage provider this site is configured for.
 *
 * The storage backend is selected at runtime via PHOTO_STORAGE_PROVIDER —
 * the request handler never talks to a provider's API directly, only
 * through the adapter functions below, so adding a third provider later
 * means adding one more adapter, not touching the handler.
 *
 *   PHOTO_STORAGE_PROVIDER = "dropbox" | "google-drive"
 *
 * ── Dropbox adapter ──────────────────────────────────────────────────────
 * One scoped Dropbox app ("App folder" access, files.content.write scope
 * only — it can create files in its sandbox folder but never list, read,
 * or download anything) reused across every client site; only the
 * destination subfolder differs per site. The couple's visibility into
 * their folder comes from a one-time manual share (Dropbox UI), not from
 * this app's API access.
 *   DROPBOX_APP_KEY       — shared across all client sites
 *   DROPBOX_APP_SECRET    — shared across all client sites
 *   DROPBOX_REFRESH_TOKEN — shared across all client sites (does not expire)
 *   DROPBOX_FOLDER_PATH   — per-site, e.g. "/alice-and-ben"
 *
 * ── Google Drive adapter ─────────────────────────────────────────────────
 * Requires the couple to have a Google Workspace account. Service accounts
 * have zero personal storage quota, so this only works against a Shared
 * Drive (pooled storage, Workspace-only) — it cannot write into a folder in
 * someone's personal/free Gmail Drive, which would fail with a quota error.
 *
 * Deliberately its own service account, separate from rsvp.js's Sheets
 * writer (different env var names, not just a different credential value)
 * — scoped to only drive.file (create-only; can't list, read, or download
 * anything, including its own uploads), so a compromised credential for
 * one never grants any access to the other.
 *   GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL — this feature's own service account
 *   GOOGLE_DRIVE_PRIVATE_KEY           — that service account's PEM private key
 *   GOOGLE_SHARED_DRIVE_ID             — the Shared Drive's ID
 *   GOOGLE_DRIVE_FOLDER_ID             — per-site destination folder within it
 *
 * ── Shared across providers ─────────────────────────────────────────────
 *   TURNSTILE_SECRET_KEY — optional; skips server-side verification if unset
 */

const MAX_FILES = 10;
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'image/gif']);

export async function onRequestPost(context) {
  const { request, env } = context;
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' } });

  const provider = getStorageProvider(env);
  if (!provider) return json({ ok: false, error: 'not_configured' }, 500);

  let data;
  try {
    data = await request.formData();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  // Honeypot — invisible to real guests, bots fill every field blindly.
  // Pretend success so bots don't learn to leave it alone.
  if (data.get('website')) return json({ ok: true, uploaded: 0 });

  if (env.TURNSTILE_SECRET_KEY) {
    const token = data.get('cf-turnstile-response');
    const valid = await verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, request);
    if (!valid) return json({ ok: false, error: 'captcha_failed' }, 400);
  }

  const files = data.getAll('photos').filter(f => f instanceof File && f.size > 0);
  if (files.length === 0) return json({ ok: false, error: 'no_files' }, 400);
  if (files.length > MAX_FILES) return json({ ok: false, error: 'too_many_files' }, 400);

  for (const file of files) {
    if (!ALLOWED_TYPES.has(file.type)) return json({ ok: false, error: 'unsupported_file_type' }, 400);
    if (file.size > MAX_FILE_BYTES) return json({ ok: false, error: 'file_too_large' }, 400);
  }

  const uploaderName = sanitiseNamePart((data.get('name') || '').trim()) || 'guest';

  let auth;
  try {
    auth = await provider.authenticate(env);
  } catch {
    return json({ ok: false, error: 'auth_failed' }, 502);
  }

  let uploaded = 0;
  for (const file of files) {
    const destName = buildDestName(uploaderName, file.name);
    try {
      await provider.upload(env, auth, destName, file);
      uploaded++;
    } catch {
      // Keep going — a partial batch is better than failing guests who
      // picked several photos, one of which happened to trip something.
    }
  }

  if (uploaded === 0) return json({ ok: false, error: 'upload_failed' }, 502);
  return json({ ok: true, uploaded });
}

// ── Provider selection ──────────────────────────────────────────────────────

function getStorageProvider(env) {
  switch (env.PHOTO_STORAGE_PROVIDER) {
    case 'dropbox':
      if (!env.DROPBOX_APP_KEY || !env.DROPBOX_APP_SECRET || !env.DROPBOX_REFRESH_TOKEN || !env.DROPBOX_FOLDER_PATH) return null;
      return dropboxProvider;
    case 'google-drive':
      if (!env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_DRIVE_PRIVATE_KEY || !env.GOOGLE_SHARED_DRIVE_ID || !env.GOOGLE_DRIVE_FOLDER_ID) return null;
      return googleDriveProvider;
    default:
      return null;
  }
}

// ── Dropbox adapter ──────────────────────────────────────────────────────────

const dropboxProvider = {
  async authenticate(env) {
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(env.DROPBOX_REFRESH_TOKEN)}&client_id=${encodeURIComponent(env.DROPBOX_APP_KEY)}&client_secret=${encodeURIComponent(env.DROPBOX_APP_SECRET)}`,
    });
    if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
    const { access_token } = await res.json();
    return { accessToken: access_token };
  },

  async upload(env, auth, destName, file) {
    const folder = env.DROPBOX_FOLDER_PATH.endsWith('/') ? env.DROPBOX_FOLDER_PATH.slice(0, -1) : env.DROPBOX_FOLDER_PATH;
    const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: `${folder}/${destName}`,
          mode: 'add',
          autorename: true,
          mute: true,
        }),
      },
      body: await file.arrayBuffer(),
    });
    if (!res.ok) throw new Error(`dropbox upload failed: ${res.status} ${await res.text()}`);
  },
};

// ── Google Drive adapter ─────────────────────────────────────────────────────
// Workspace-only: writes to a Shared Drive, never a personal/free Gmail
// Drive, because service accounts have zero personal storage quota.

const googleDriveProvider = {
  async authenticate(env) {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL,
      scope: 'https://www.googleapis.com/auth/drive.file',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    };

    const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const key = await importPrivateKey(env.GOOGLE_DRIVE_PRIVATE_KEY);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
    const jwt = `${unsigned}.${b64urlFromBytes(new Uint8Array(signature))}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
    });
    if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
    const { access_token } = await res.json();
    return { accessToken: access_token };
  },

  async upload(env, auth, destName, file) {
    const metadata = {
      name: destName,
      parents: [env.GOOGLE_DRIVE_FOLDER_ID],
    };
    const boundary = `boundary-${crypto.randomUUID()}`;
    const body = await buildMultipartBody(boundary, metadata, file);

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );
    if (!res.ok) throw new Error(`drive upload failed: ${res.status} ${await res.text()}`);
  },
};

async function buildMultipartBody(boundary, metadata, file) {
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);

  const combined = new Uint8Array(head.length + fileBytes.length + tail.length);
  combined.set(head, 0);
  combined.set(fileBytes, head.length);
  combined.set(tail, head.length + fileBytes.length);
  return combined;
}

async function importPrivateKey(pem) {
  // Cloudflare env vars are often pasted single-line, so a service-account
  // key's embedded newlines may arrive as literal "\n" escapes.
  const normalised = pem.includes('\\n') ? pem.replace(/\\n/g, '\n') : pem;
  const body = normalised
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bytes = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', bytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

function b64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlFromBytes(bytes) {
  let bin = '';
  bytes.forEach(b => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Turnstile ──────────────────────────────────────────────────────────────

async function verifyTurnstile(token, secret, request) {
  if (!token) return false;
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret,
      response: token,
      remoteip: request.headers.get('CF-Connecting-IP') || undefined,
    }),
  });
  if (!res.ok) return false;
  const result = await res.json();
  return !!result.success;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sanitiseNamePart(name) {
  return name.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 40);
}

function buildDestName(uploaderName, originalFilename) {
  const ext = (originalFilename.match(/\.[a-zA-Z0-9]+$/) || [''])[0].toLowerCase();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = crypto.randomUUID().slice(0, 8);
  return `${timestamp}-${uploaderName.replace(/\s+/g, '-')}-${random}${ext}`;
}
