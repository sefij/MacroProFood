# 08 — Evaluate TypeScript 5/7 compatibility and migration impact

## Context

- Repo pins `typescript ^5.9.2` (a regular dependency; the web app under
  `web/` has its own TypeScript).
- `tsconfig.json` is minimal: `target: esnext`, `module: commonjs`,
  `skipLibCheck`, `types: []`, no `strict`.
- TypeScript 7 is the announced native (Go) compiler rewrite ("tsgo"), with
  TypeScript 6.x as the aligned JS-based transition line; 5.9-era syntax is
  intended to keep working. Previews ship as `@typescript/native-preview`.

## Evaluation tasks

1. **Baseline:** `yarn build` + `yarn build:data` on latest 5.x — expect
   no-op; update the pin if a newer 5.x exists.
2. **Native preview trial:** `npx @typescript/native-preview` (`tsgo`) against
   this tsconfig; note unsupported flags and emit differences. Known risk
   areas here:
   - `module: commonjs` emit — the repo *depends* on CJS output: the pdfjs-dist
     ESM workaround in `src/scrapers/pdf/pdf-lines.ts` uses a `Function`-wrapped
     dynamic `import()` precisely because tsc down-levels `import()` under CJS.
     Verify tsgo preserves that behavior (or finally switch to
     `module: nodenext` and drop the workaround — see below).
   - `src/**/*.json` in `include` without `resolveJsonModule`.
3. **Modernization worth doing regardless of 6/7** (this is the real payoff):
   - `module: nodenext` + `"type": "module"` in package.json, converting the
     CLI to ESM. This removes the pdfjs `importEsm` hack and matches how
     `pdfjs-dist@5`, `chalk@5` (currently on its ESM major used via ESM-interop
     quirks) want to be consumed. Touches every relative import (extension
     suffixes) — mechanical but wide.
   - Turn on `strict` incrementally (`strictNullChecks` first); the codebase is
     small enough (~25 files) to do in one pass.

## Recommendation (to validate during implementation)

Stay on latest 5.x for now; do the ESM/`nodenext` + `strict` modernization as
its own change since it de-risks 6/7 adoption more than any version bump; adopt
6.x/7 once stable rather than the preview — this project has no compile-time
bottleneck (1–2 s builds), so the native compiler's speed win is marginal here.

## Deliverable

A short findings note appended to this spec (versions tested, flags that
changed, whether the pdfjs workaround survived), plus the modernization PR if
the evaluation confirms it's mechanical.

## Findings (2026-07-20)

**Headline change since this spec was written: TypeScript 7 is no longer a
preview.** `typescript@7.0.2` is npm's `latest` dist-tag today — the
Go-rewrite ("tsgo") graduated from `@typescript/native-preview` into the
mainline `typescript` package as a real stable major. `6.x` turned out to be
a dev-only transition line that never got a stable release (100+ `6.0.0-dev.*`
versions, no `6.0.0` proper) — 5.9 goes straight to stable 7. So this
evaluation tested the real release, not a preview trial.

**Versions:** pinned `5.9.2` (current) vs. latest available `5.9.3` (trivial
patch, no behavior difference expected) vs. `7.0.2` (`latest`).

**CLI (`tsconfig.json`, `module: commonjs`) — one required change, otherwise
byte-identical:**
- `tsc -p tsconfig.json` under 7.0.2 fails outright (exit 2, `error TS5011`):
  TS7 tightens the emit-layout inference this tsconfig relied on — `rootDir`
  must now be set explicitly instead of inferred from the common source
  directory. Fix is one line: add `"rootDir": "./src"`.
- With that fix, `tsc -p tsconfig.json` succeeds under 7.0.2, and
  `diff -rq` between the full 5.9.2 build output and the full 7.0.2 build
  output (every emitted `.js`, whole `src/` tree) is **completely empty** —
  byte-identical JS across the entire CLI. This is about as low-risk as a
  major-version compiler bump gets.
- The `pdfjs-dist` `Function`-wrapped dynamic-`import()` workaround
  (`src/scrapers/pdf/pdf-lines.ts`) emits identically under both versions —
  confirmed by the same whole-tree diff. Still needed either way: pdfjs-dist
  is still ESM-only, and TS7's CJS emit still down-levels a plain `import()`
  the same way 5.9 did.
- `src/**/*.json` in `include`, flagged as a `resolveJsonModule` risk area,
  turned out to be dead weight — there are currently no `.json` files
  anywhere under `src/` and nothing imports one, under either TS version.
  Not a live issue now; worth trimming the glob or adding
  `resolveJsonModule` preemptively if a scraper ever needs to import a JSON
  fixture.

**`web/` (two tsconfigs, both `noEmit: true`) — zero changes needed under
7.0.2:**
- `web/tsconfig.json` (the app, via `tsc -b`) — clean.
- `web/worker/tsconfig.json` (the Cloudflare Worker, `@cloudflare/workers-types`)
  — clean.
- Neither hit the `TS5011` rootDir issue — that error is specifically about
  ambiguous *emit* layout, so `noEmit` configs are unaffected by it.

**Updated recommendation (supersedes the "wait for 6/7 to stabilize"
recommendation above, written when 7 was still preview-only):** the CLI
upgrade to `7.0.2` is confirmed mechanical — one line (`rootDir`) plus a
`package.json` bump, with proven byte-identical output. The larger ESM/
`nodenext` + `strict` modernization is unaffected by this finding either way
and remains a separate, valuable, more invasive follow-up — this evaluation
didn't attempt it (no import rewriting or `strict` enabling was tested in
this pass).
