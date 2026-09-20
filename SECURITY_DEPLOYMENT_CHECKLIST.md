# Luma security deployment checklist

Luma is a static, browser-only application. Its public build contains only the application shell; task content remains in the browser's IndexedDB recovery copy or in a Markdown file selected by the user.

## Before enabling GitHub Pages

1. Run `npm ci`, `npm test`, `npm run test:e2e`, and `npm run build` locally. Confirm that `dist/` contains only the approved runtime assets.
2. Review `git status --ignored` and ensure `dist/`, `node_modules/`, test reports, local Markdown workspaces, `.env*`, credentials, archives, and backups are not staged.
3. Push the reviewed workflow, then open **GitHub repository → Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**. Do not publish from a branch directory: that can expose repository files such as tests and manifests.
4. In **Actions**, review the first `Deploy Luma to GitHub Pages` run. It must upload only `./dist` and use the environment named `github-pages`.
5. In **Settings → Actions → General**, keep the default workflow token permissions read-only and restrict actions to GitHub- or organization-approved actions where practical. The workflow grants `pages: write` and `id-token: write` only in its deployment job.
6. In **Settings → Pages**, use HTTPS enforcement and use a verified custom domain only if one is required. Keep the Pages site public only if public distribution is intended.
7. Protect `main`: require review for changes to `.github/workflows/`, `scripts/build-production.js`, `index.html`, `sw.js`, and dependency lockfiles.

## Post-deployment checks

From a harmless browser or command-line session, request the public site and confirm only the intended shell assets are reachable. Requests for `.git/HEAD`, `.env`, `package.json`, `package-lock.json`, `test/`, `*.map`, `*.log`, `*.bak`, and archive files must be absent (404).

Confirm the browser console reports no CSP violations during normal use, importing a valid Markdown file, editing notes, saving, downloading, or going offline. The service worker cache should contain only the explicit `SHELL` allowlist in `sw.js`, never task text or imported files.

## Header limitations of GitHub Pages

The CSP and referrer policy in `index.html` protect the static page, but GitHub Pages does not provide repository-managed custom response headers. In particular, it cannot reliably add `frame-ancestors`, `X-Frame-Options`, HSTS, `X-Content-Type-Options`, `Permissions-Policy`, or `Cache-Control` through this repository.

If Luma later moves behind a proxy/CDN or custom hosting, configure these response headers there:

```text
Content-Security-Policy: default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; img-src 'self' blob: data:; manifest-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; worker-src 'self' blob:; frame-ancestors 'none'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Apply HSTS only after HTTPS is confirmed for every relevant hostname. Set cache policy deliberately if a future version serves private user data from a server.

Luma uses a narrowly scoped `style-src-attr 'unsafe-inline'` exception solely for JavaScript-set CSS custom properties that position task cards and timeline markers. Its stylesheet itself is external, so the broader `style-src 'unsafe-inline'` exception is not used. If the renderer is later refactored to use nonce-protected generated rules, remove this exception as well.

## Release review

- Review dependency updates with `npm audit` and the lockfile diff; do not automatically apply security upgrades without compatibility testing.
- Search for secrets before release: `rg -n --hidden -g '!node_modules/**' -g '!dist/**' '(api[_-]?key|secret|token|password|BEGIN (RSA|EC|OPENSSH) PRIVATE KEY)' .`
- Verify no browser-delivered JavaScript includes credentials, server authorization decisions, or private user data. Browser JavaScript is intentionally downloadable.
- Re-run import-limit, escaped-content, build-output, service-worker allowlist, and `/Luma/` base-path tests after changing the import format or deployment setup.
