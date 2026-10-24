/**
 * Cloudflare Pages Function — POST /rsvp
 *
 * Replaces Formspree: verifies the Turnstile token and honeypot server-side,
 * then appends one row per guest to a Google Sheet via a service account.
 * Same auth pattern as functions/auth.js (raw Web Crypto, no npm deps).
 *
 * Sheet layout — one row per guest, tied together by submission_id:
 *   submission_id | submitted_at | guest_name | guest_email | is_primary_guest |
 *   attending | dietary | party_size
 * ...plus accommodation | rooms | nights, but only for sites whose RSVP page
 * has onsiteAccommodation: true — those form fields don't exist on sites
 * without on-site rooms to book, so this function omits the columns entirely
 * there rather than writing them blank. Make sure each site's own Sheet
 * header row matches which columns its submissions send.
 *
 * Environment variables (Pages dashboard → Settings → Environment Variables,
 * set separately for Production vs Preview so test submissions never land in
 * the real guest list):
 *   GOOGLE_SHEET_ID              — target spreadsheet ID (from its URL)
 *   GOOGLE_SHEET_TAB             — tab name rows are appended to (default: "RSVPs")
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL — e.g. rsvp-writer@<project>.iam.gserviceaccount.com
 *   GOOGLE_PRIVATE_KEY           — the service account's PEM private key
 *   TURNSTILE_SECRET_KEY         — optional; skips server-side verification if unset
 */

const DEFAULT_SHEET_TAB = 'RSVPs';

export async function onRequestPost(context) {
  const { request, env } = context;
  const jsonHeaders = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });

  if (!env.GOOGLE_SHEET_ID || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    return json({ ok: false, error: 'not_configured' }, 500);
  }

  let data;
  try {
    data = await request.formData();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  // Honeypot — invisible to real guests, bots fill every field blindly.
  // Pretend success so bots don't learn to leave it alone.
  if (data.get('website')) return json({ ok: true });

  if (env.TURNSTILE_SECRET_KEY) {
    const token = data.get('cf-turnstile-response');
    const valid = await verifyTurnstile(token, env.TURNSTILE_SECRET_KEY, request);
    if (!valid) return json({ ok: false, error: 'captcha_failed' }, 400);
  }

  const name = (data.get('name') || '').trim();
  const email = (data.get('email') || '').trim();
  const attending = data.get('attending') || '';
  if (!name || !email || !attending) return json({ ok: false, error: 'missing_fields' }, 400);

  const dietary = (data.get('dietary') || '').trim();

  // The accommodation radio only exists in the form markup when the page's
  // onsiteAccommodation toggle is on — absent (not just empty) otherwise.
  const hasAccommodation = data.has('accommodation');
  const accommodation = data.get('accommodation') || '';
  const rooms = data.get('rooms') || '';
  const nights = data.get('nights') || '';

  const guests = [{ name, email, dietary, isPrimary: true }];
  for (let i = 1; data.get(`guest_${i}_name`); i++) {
    guests.push({
      name: (data.get(`guest_${i}_name`) || '').trim(),
      email: '',
      dietary: (data.get(`guest_${i}_dietary`) || '').trim(),
      isPrimary: false,
    });
  }

  const submissionId = crypto.randomUUID();
  const submittedAt = new Date().toISOString();
  const partySize = attending === 'yes' ? guests.length : 1;

  const rows = guests.map(g => {
    const row = [submissionId, submittedAt, g.name, g.email, g.isPrimary ? 'yes' : 'no', attending, g.dietary, partySize];
    if (hasAccommodation) row.push(accommodation, rooms, nights);
    return row;
  });

  try {
    const accessToken = await getGoogleAccessToken(env.GOOGLE_SERVICE_ACCOUNT_EMAIL, env.GOOGLE_PRIVATE_KEY);
    await appendRows(env.GOOGLE_SHEET_ID, env.GOOGLE_SHEET_TAB || DEFAULT_SHEET_TAB, accessToken, rows);
  } catch (err) {
    return json({ ok: false, error: 'sheet_append_failed' }, 502);
  }

  return json({ ok: true });
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

// ── Google Sheets ────────────────────────────────────────────────────────────

async function getGoogleAccessToken(serviceAccountEmail, privateKeyPem) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: serviceAccountEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${b64urlFromBytes(new Uint8Array(signature))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
  });

  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`);
  const { access_token } = await res.json();
  return access_token;
}

async function appendRows(sheetId, sheetTab, accessToken, rows) {
  const range = encodeURIComponent(`${sheetTab}!A:A`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: rows }),
  });
  if (!res.ok) throw new Error(`sheets append failed: ${res.status} ${await res.text()}`);
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
  return crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function b64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlFromBytes(bytes) {
  let bin = '';
  bytes.forEach(b => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
