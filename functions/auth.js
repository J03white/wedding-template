/**
 * Cloudflare Pages Function — GET /auth
 *
 * Auth endpoint for Decap CMS. Validates the Cloudflare Access JWT that is
 * set when the user authenticates via magic link, then returns the stored
 * GitHub PAT to the CMS via postMessage. No GitHub account needed for the
 * couple — Cloudflare Access handles identity.
 *
 * Environment variables (Pages dashboard → Settings → Environment Variables):
 *   GITHUB_PAT      — Fine-grained PAT: Contents write, single repo, no expiry needed
 *   CF_TEAM_DOMAIN  — e.g. yourteam.cloudflareaccess.com
 *   CF_ACCESS_AUD   — AUD tag shown in the Access application settings
 */

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const siteId = url.searchParams.get('site_id') || url.hostname;
  const direct = url.searchParams.get('direct') === '1';
  const htmlHeaders = { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' };
  const jsonHeaders = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };

  if (!env.GITHUB_PAT || !env.CF_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
    if (direct) return new Response(JSON.stringify({ error: 'not_configured' }), { status: 500, headers: jsonHeaders });
    return new Response(
      errorPage('CMS is not configured yet. Contact the site administrator.', siteId),
      { status: 500, headers: htmlHeaders },
    );
  }

  const jwt = parseCookie(request.headers.get('Cookie') || '')['CF_Authorization'];

  if (!jwt) {
    if (direct) return new Response(JSON.stringify({ error: 'not_authenticated' }), { status: 401, headers: jsonHeaders });
    return new Response(
      errorPage('Not authenticated — open the admin from the main site.', siteId),
      { status: 401, headers: htmlHeaders },
    );
  }

  const valid = await validateCFAccessJWT(jwt, env.CF_TEAM_DOMAIN, env.CF_ACCESS_AUD);

  if (!valid) {
    if (direct) return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401, headers: jsonHeaders });
    return new Response(
      errorPage('Access token is invalid or expired. Please try again.', siteId),
      { status: 401, headers: htmlHeaders },
    );
  }

  if (direct) return new Response(JSON.stringify({ token: env.GITHUB_PAT }), { headers: jsonHeaders });

  return new Response(successPage(env.GITHUB_PAT, siteId), { headers: htmlHeaders });
}

// ── JWT validation ────────────────────────────────────────────────────────────

async function validateCFAccessJWT(token, teamDomain, aud) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  let header, payload;
  try {
    header = JSON.parse(b64urlDecode(parts[0]));
    payload = JSON.parse(b64urlDecode(parts[1]));
  } catch {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) return false;
  if (payload.iss !== `https://${teamDomain}`) return false;

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) return false;

  try {
    // Cache the JWKS for 10 minutes to avoid hammering Cloudflare's endpoint
    const certsRes = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
      cf: { cacheTtl: 600 },
    });
    if (!certsRes.ok) return false;

    const { keys = [] } = await certsRes.json();
    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) return false;

    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const sig = b64urlToBytes(parts[2]);
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);

    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data);
  } catch {
    return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCookie(header) {
  return Object.fromEntries(
    header.split(';').map(p => {
      const [k, ...v] = p.trim().split('=');
      return [k, v.join('=')];
    }),
  );
}

function b64urlDecode(str) {
  return atob(str.replace(/-/g, '+').replace(/_/g, '/'));
}

function b64urlToBytes(str) {
  return Uint8Array.from(b64urlDecode(str), c => c.charCodeAt(0));
}

// ── Response pages ────────────────────────────────────────────────────────────

function successPage(token, siteId) {
  return postMessagePage(
    `authorization:github:success:${JSON.stringify({ token, provider: 'github' })}`,
    siteId,
  );
}

function errorPage(reason, siteId) {
  return postMessagePage(
    `authorization:github:error:${JSON.stringify({ message: reason })}`,
    siteId,
  );
}

function postMessagePage(message, siteId) {
  const target = siteId ? `https://${siteId}` : '*';
  return `<!doctype html>
<html>
<body>
<script>
  (function () {
    if (window.opener) window.opener.postMessage(${JSON.stringify(message)}, ${JSON.stringify(target)});
    window.close();
  })();
<\/script>
</body>
</html>`;
}
