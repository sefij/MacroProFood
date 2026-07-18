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
