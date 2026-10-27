/**
 * Shared-password gate for the whole public site.
 *
 * One password, given out to all guests. On success, sets a cookie derived
 * from the password (not the password itself) so later visits skip the
 * form. /admin and /auth are excluded -- those are already protected
 * separately by Cloudflare Access with per-person magic-link login, and
 * gating them here too would make the couple need the guest password just
 * to edit content.
 *
 * Environment variable:
 *   SITE_PASSWORD -- the single shared password given to guests. If unset,
 *   the gate is a no-op and the site behaves as before.
 */

const COOKIE_NAME = 'site_auth';
const EXEMPT_PREFIXES = ['/admin', '/auth'];

export async function siteGate(request, env) {
  if (!env.SITE_PASSWORD) return null;

  const url = new URL(request.url);
  if (EXEMPT_PREFIXES.some(p => url.pathname.startsWith(p))) return null;

  const sitePassword = env.SITE_PASSWORD.trim();
  const expected = await token(sitePassword);

  if (request.method === 'POST' && url.pathname === '/site-password') {
    const data = await request.formData();
    const submitted = (data.get('password') || '').toString().trim();
    const redirect = (data.get('redirect') || '/').toString();

    if (submitted === sitePassword) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: redirect,
          'Set-Cookie': `${COOKIE_NAME}=${expected}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }

    return new Response(gatePage(redirect, true), {
      status: 401,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const cookie = parseCookie(request.headers.get('Cookie') || '')[COOKIE_NAME];
  if (cookie === expected) return null;

  return new Response(gatePage(url.pathname + url.search, false), {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function token(password) {
  const bytes = new TextEncoder().encode(`site-gate:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseCookie(header) {
  return Object.fromEntries(
    header.split(';').map(p => {
      const [k, ...v] = p.trim().split('=');
      return [k, v.join('=')];
    }).filter(([k]) => k),
  );
}

function gatePage(redirect, wrong) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Enter password</title>
<style>
  body { font-family: Georgia, serif; background: #f5f1e8; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1.5rem; box-sizing: border-box; }
  .card { background: #fff; padding: 2.5rem 2rem; border-radius: 8px; max-width: 360px; width: 100%; text-align: center; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
  h1 { font-size: 1.25rem; margin: 0 0 1.5rem; color: #2b2b2b; }
  input[type="password"] { width: 100%; padding: 0.75rem; font-size: 1rem; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; margin-bottom: 1rem; }
  button { width: 100%; padding: 0.75rem; font-size: 1rem; background: #5b2a2a; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  button:hover { opacity: 0.9; }
  .error { color: #a33; font-size: 0.9rem; margin-bottom: 1rem; }
</style>
</head>
<body>
  <div class="card">
    <h1>This site is password protected</h1>
    <form method="POST" action="/site-password">
      <input type="hidden" name="redirect" value="${escapeHtml(redirect)}">
      ${wrong ? '<p class="error">Incorrect password, please try again.</p>' : ''}
      <input type="password" name="password" placeholder="Password" required autofocus>
      <button type="submit">Enter</button>
    </form>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
