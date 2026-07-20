# 10 — CLI modernization: `module: nodenext` (real ESM) + `strict`

Follow-up to spec 08, split out as its own change since it's wider and more
invasive than the TypeScript version bump — see 08's findings for why the
two were decoupled. Scoped to the root CLI project (`src/`, `tsconfig.json`,
`package.json`); `web/` already runs `"type": "module"` and is unaffected.

## Goal

Two independent, low-risk-once-verified changes bundled into one PR because
they touch the same files:

1. `module: commonjs` → `module: nodenext` + `"type": "module"` in
   `package.json` — the CLI becomes real ESM instead of TS-compiled-to-CJS.
2. Enable `strict` in `tsconfig.json`.

## Why now: what's currently propping up CJS output

`chalk` (15 call sites) and `pdfjs-dist` are both **ESM-only** packages —
`node_modules/chalk/package.json` has `"type": "module"`, `main` and
`exports` both pointing at `./source/index.js`, no CJS build at all. Under
today's `module: commonjs`, the compiled output does
`const chalk_1 = __importDefault(require("chalk"))`
(`esModuleInterop`'s helper) — and this only works at runtime because of
**Node 22's relatively recent synchronous `require(ESM)` support**: `require()`ing
an ESM-only package no longer throws `ERR_REQUIRE_ESM`, Node instead
synthesizes a CJS-shaped namespace object (`__esModule: true`, `.default`,
named exports) on the fly, which `__importDefault` then unwraps. Confirmed
directly (`node -e "require('chalk')"` → returns the synthesized namespace,
`.default` is the real chalk instance).

This works today, but it's leaning on a specific, fairly new Node runtime
capability rather than actually being correct — the CLI's own module system
disagrees with what its dependencies are. `pdfjs-dist` gets a bespoke
`Function`-wrapped dynamic `import()` workaround
(`src/scrapers/pdf/pdf-lines.ts`) precisely because a plain `import()` would
otherwise get down-leveled to the same failing pattern by `tsc` under CJS.
Moving to `module: nodenext` removes the need for either interop path —
real `import chalk from 'chalk'` and real `import('pdfjs-dist/...')` both
just work, because the output *is* ESM.

## Scope: `module: nodenext`

- `package.json`: add `"type": "module"`.
- `tsconfig.json`: `module: commonjs` → `nodenext` (implies
  `moduleResolution: nodenext`; `esModuleInterop` becomes unnecessary and
  should be dropped along with it).
- **Every relative import needs an explicit `.js` extension** — Node's ESM
  resolver requires it even though the source files are `.ts`
  (`import { X } from './foo'` → `'./foo.js'`). Confirmed count: 28 `.ts`
  files under `src/`, 52 relative `import ... from './...'` /
  `'../...'` statements needing the suffix added. Mechanical — a script can
  do this in one pass (rewrite `from '(\.\.?/[^']+)'` → append `.js` unless
  already present), but every file is touched, hence its own PR rather than
  folded into 08's version bump.
- `src/scrapers/pdf/pdf-lines.ts`: replace the `Function`-wrapped
  `importEsm` hack with a plain
  `const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')` — this is
  the whole point of the change for this file. Delete the workaround and its
  doc comment.
- `yarn start` (`node dist/main.js`) and `build:data` (`node
  dist/tools/build-web-data.js`) need no changes — Node runs a `.js` file as
  ESM automatically once `package.json` says `"type": "module"`, no flag
  needed.
- Double-check `commander`, `axios`, `cheerio`, `lodash`, `playwright`,
  `@types/node` all resolve cleanly under `moduleResolution: nodenext`
  (most modern packages ship proper `exports` maps; `lodash` in particular
  is CJS-only and commonly needs `import _ from 'lodash'` — the default
  interop — to keep working, since nodenext still lets CJS packages be
  imported this way from an ESM file, just requires them to be
  default-imported rather than namespace-imported).

## Scope: `strict`

**Already verified zero-cost:** `npx tsc -p tsconfig.json --noEmit --strict`
against the current codebase, unmodified, exits 0 with no new errors. The
full `strict` bundle (`strictNullChecks`, `noImplicitAny`,
`strictFunctionTypes`, etc.) already passes — so unlike the original spec
08 text ("turn on strict incrementally... in one pass"), this isn't
"incrementally migrate toward it," it's "flip the flag." Do it in the same
PR as the `nodenext` change (both touch `tsconfig.json`) rather than a
separate one — no reason to split something that costs nothing.

## Out of scope

- `web/` — already `"type": "module"`, already ESM-native, nothing to do.
- Any behavioral/logic change. This is a module-system and type-strictness
  change only; every scraper's output should be byte-for-byte identical in
  what it produces (not necessarily in emitted `.js`, since the module
  system itself changes, but in what the CLI actually does when run).
- Runtime/Node-version floor changes — not investigating whether to bump
  the minimum supported Node version as part of this; `nodenext` resolution
  itself doesn't require a newer Node than the project already assumes.

## Verification plan

- `yarn build` clean under the new `tsconfig.json`.
- `yarn build:data --no-cache` (or at least `yarn build:data` with cache) —
  full run across all 9 restaurants, same item counts as a pre-change
  baseline run.
- `yarn start -- -c 1800 -p 140 -f 60 -r 180` (or similar) — confirm the
  optimizer path runs end-to-end, chalk-colored console output renders
  correctly (the exact thing the interop quirk was propping up).
- Spot-check the PDF scrapers specifically (Wendy's, Domino's, Subway) since
  those exercise the `pdfjs-dist` import path being rewritten.
- `git diff` on `dist/` output between a pre-change and post-change build is
  *not* expected to be empty this time (unlike spec 08's TS7 finding) —
  the module system itself is changing — so verification here is behavioral
  (does it run and produce the same data), not a byte-diff.
