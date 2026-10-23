# ADR-0001: Deployment Platform

**Status:** Accepted  
**Date:** 2026-06-26

## Context

The site is a Hugo static site hosted on GitHub. We needed a CI/CD pipeline that would:
- Deploy a preview environment automatically when a PR is raised
- Deploy to production automatically when a PR is merged to `main`

GitHub Pages was the original target, but it only serves a single site per repository and has no native support for per-PR preview URLs. Achieving PR previews with GitHub Pages would require combining two separate services (e.g. GitHub Actions → GitHub Pages for production, plus a second service like Netlify for previews), adding unnecessary complexity.

Two options were evaluated:

| Option | Notes |
|---|---|
| **Cloudflare Pages** | PR previews and production deploys built in. Free tier. Fast CDN. Single service. |
| **GitHub Pages + Netlify** | GitHub Pages for production, Netlify for PR previews. Two services to manage. Only relevant if the `github.io` URL was required. |

## Decision

Use **Cloudflare Pages** as the sole deployment platform, replacing GitHub Pages.

Build settings:
- Build command: `hugo`
- Build output directory: `public`
- Environment variable: `HUGO_VERSION=0.160.1`

The existing GitHub Actions workflow (`.github/workflows/hugo.yml`) was deleted as Cloudflare Pages handles all CI/CD directly from the GitHub integration.

## Consequences

- Every PR automatically receives a unique `*.pages.dev` preview URL; Cloudflare posts it as a comment on the PR.
- Merging to `main` triggers a production deploy automatically.
- No GitHub Actions config to maintain.
- A custom domain can be connected via the Cloudflare dashboard when the site goes live.
