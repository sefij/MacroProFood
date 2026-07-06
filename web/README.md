# MacroPro 🍔 (web app)

*A super-simple, neat front-end for the MacPro macro optimizer — hostable free on
Cloudflare Pages.*

Enter your remaining macros (or pull them from MyFitnessPal), pick the restaurants
you're choosing between, and get meal combinations you can log in one click.

## How it fits together

Cloudflare Pages can't run Playwright, so the project is split:

```
Playwright scrapers (offline)  ──►  web/public/data/*.json  ──►  static React app
   GitHub Actions cron               (committed snapshots)        client-side optimizer
```

- **Optimizer runs in the browser.** The app reuses the dependency-free core in
  [`../src/core/optimizer.ts`](../src/core/optimizer.ts) — no backend, fully static.
- **Data is precomputed.** `yarn build:data` (run from the repo root) executes the
  existing scrapers and writes one JSON file per restaurant plus `index.json`, each
  stamped with an `updatedAt` that powers the "last updated / stale" badges.
- **Refreshed on a schedule** by [`.github/workflows/refresh-data.yml`](../.github/workflows/refresh-data.yml).

## MyFitnessPal — without storing credentials

MFP has no public write API, and storing a user's password would be a standing
security liability. Instead the app uses two **bookmarklets**
([`src/bookmarklets.ts`](src/bookmarklets.ts)) that run inside the user's own,
already-logged-in MFP tab:

- **Pull remaining → MacroPro** reads the diary's *Remaining* row and sends just the
  four numbers back via the URL hash.
- **Track this meal → MFP** reads the meal from the clipboard and autofills the Quick
  Add macro fields.

Session cookies and credentials never leave the user's browser; the app stays stateless.

## Local development

```bash
# from the repo root — generate data the app reads
yarn install
yarn build:data            # writes web/public/data/*.json

# then run the app
cd web
npm install
npm run dev                # http://localhost:5173
```

## Build

```bash
cd web
npm run build              # outputs web/dist
npm run preview            # serve the production build locally
```

## Deploy to Cloudflare Pages (free)

Connect the repo in the Cloudflare dashboard (Workers & Pages → Create → Pages →
Connect to Git) with:

| Setting | Value |
| --- | --- |
| Build command | `cd web && npm install && npm run build` |
| Build output directory | `web/dist` |
| Root directory | repository root (leave default) |

No environment variables or Functions are required — the app is fully static. Every
push to the default branch (including the scheduled data-refresh commits) triggers a
new deploy.
