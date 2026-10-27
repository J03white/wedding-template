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
 * The password page's hero image and theme colours are pulled live from
 * the built homepage (via env.ASSETS.fetch) rather than hardcoded, so it
 * automatically matches whatever the couple has set via the CMS.
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

    const assets = await fetchHomepageAssets(env);
    return new Response(gatePage(redirect, true, assets), {
      status: 401,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const cookie = parseCookie(request.headers.get('Cookie') || '')[COOKIE_NAME];
  if (cookie === expected) return null;

  const assets = await fetchHomepageAssets(env);
  return new Response(gatePage(url.pathname + url.search, false, assets), {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function fetchHomepageAssets(env) {
  try {
    const res = await env.ASSETS.fetch(new Request('https://internal/'));
    if (!res.ok) return {};
    const html = await res.text();
    const heroMatch = html.match(/<div class="hero__bg"[\s\S]*?<img src="([^"]+)"/);
    const cssMatch = html.match(/<link rel="stylesheet" href="([^"]+)"/);
    return {
      heroImage: heroMatch ? heroMatch[1] : null,
      stylesheet: cssMatch ? cssMatch[1] : null,
    };
  } catch {
    return {};
  }
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

function gatePage(redirect, wrong, assets) {
  const { heroImage, stylesheet } = assets || {};
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Enter password</title>
${stylesheet ? `<link rel="stylesheet" href="${stylesheet}">` : ''}
<style>
  body {
    font-family: Georgia, serif;
    background: var(--color-background, #f5f1e8);
    ${heroImage ? `background-image: linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url('${heroImage}'); background-size: cover; background-position: center;` : ''}
    display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1.5rem; box-sizing: border-box;
  }
  .card { background: #fff; padding: 2.5rem 2rem; border-radius: 8px; max-width: 360px; width: 100%; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.25); }
  h1 { font-size: 1.25rem; margin: 0 0 1.5rem; color: var(--color-text, #2b2b2b); }
  input[type="password"] { width: 100%; padding: 0.75rem; font-size: 1rem; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; margin-bottom: 1rem; }
  button { width: 100%; padding: 0.75rem; font-size: 1rem; background: var(--color-primary, #5b2a2a); color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  button:hover { background: var(--color-primary-light, var(--color-primary, #5b2a2a)); }
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
