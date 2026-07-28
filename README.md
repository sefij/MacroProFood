# MacroPro 🍔

*Macros, pro.*

A command-line tool that scrapes nutritional information from UK fast-food
restaurants and finds the meal combinations that best match your target macros
(calories, protein, fat, carbs). It can optionally read your remaining macros
from **MyFitnessPal** and push the chosen meal straight back to your diary.

## Features

- **Multi-restaurant scraping** — Popeyes, KFC, Wendy's, McDonald's, Subway,
  Taco Bell, Wagamama, Domino's, Nando's, itsu, YO! Sushi, Slim Chickens,
  Burger King, Pizza Hut, Chipotle, Papa Johns and Five Guys (UK menus).
- **Macro optimizer** — finds the top combinations of menu items that get as
  close as possible to your target calories/protein/fat/carbs.
- **MyFitnessPal integration** — auto-fill your targets from the "Remaining"
  row and push the selected meal to your Dinner entry.
- **Result caching** — scraped data is cached for 7 days (override with
  `--no-cache`).
- **Per-restaurant toggles** — disable any scraper via environment variables.

## Todos

Detailed specs for each todo live in [`docs/specs/`](docs/specs/).

- Evaluate TypeScript 5/7 compatibility and migration impact.

## Requirements

- [Node.js](https://nodejs.org/) 18+ (developed on v22)
- [Yarn](https://yarnpkg.com/)

## Installation

```bash
git clone https://github.com/<your-username>/MacroPro.git
cd MacroPro
yarn install
# Playwright needs a browser for the live scrapers / MyFitnessPal:
yarn playwright install chromium
```

The CLI above is the whole project on its own. Two optional pieces build on it:

- **Web app** ([`web/`](web/)) — a React UI for the same optimizer, deployed to
  Cloudflare Pages. To run it locally:

  ```bash
  cd web
  yarn install
  yarn dev
  ```

  It reads pre-scraped nutrition data from `web/public/data/`, produced by
  `yarn build:data` in the root project (see [Scripts](#scripts) below).

- **MyFitnessPal Companion** ([`extension/`](extension/)) — a browser extension
  that lets the web app read/write your MFP diary via your existing logged-in
  session, no password needed. It's optional (the web app falls back to a
  bookmarklet without it); see [`extension/README.md`](extension/README.md)
  for what it does and how to load it unpacked.

## Configuration

Copy the example environment file and adjust as needed:

```bash
cp .env.example .env
```

| Variable            | Description                                              |
| ------------------- | -------------------------------------------------------- |
| `DISABLE_POPEYES`   | Set to `true` to skip the Popeyes scraper.               |
| `DISABLE_KFC`       | Set to `true` to skip the KFC scraper.                   |
| `DISABLE_WENDYS`    | Set to `true` to skip the Wendy's scraper.               |
| `DISABLE_MCDONALDS` | Set to `true` to skip the McDonald's scraper.            |
| `DISABLE_SUBWAY`    | Set to `true` to skip the Subway scraper.                |
| `DISABLE_TACOBELL`  | Set to `true` to skip the Taco Bell scraper.             |
| `DISABLE_WAGAMAMA`  | Set to `true` to skip the Wagamama scraper.              |
| `DISABLE_DOMINOS`   | Set to `true` to skip the Domino's scraper.              |
| `DISABLE_NANDOS`    | Set to `true` to skip the Nando's scraper.                |
| `DISABLE_ITSU`      | Set to `true` to skip the itsu scraper.                   |
| `DISABLE_YOSUSHI`   | Set to `true` to skip the YO! Sushi scraper.              |
| `DISABLE_SLIMCHICKENS` | Set to `true` to skip the Slim Chickens scraper.      |
| `DISABLE_BURGERKING`| Set to `true` to skip the Burger King scraper.            |
| `DISABLE_PIZZAHUT`  | Set to `true` to skip the Pizza Hut scraper.              |
| `DISABLE_CHIPOTLE`  | Set to `true` to skip the Chipotle scraper.               |
| `DISABLE_PAPAJOHNS` | Set to `true` to skip Papa Johns (fetches a PDF live, with a committed fallback copy). |
| `DISABLE_FIVEGUYS`  | Set to `true` to skip the Five Guys scraper.               |
| `EXCLUDE_CATEGORIES`| Comma-separated categories to leave out by default, e.g. `Drinks`. Overridden by `-x`. |
| `MFP_EMAIL`         | MyFitnessPal email (optional — log in interactively).    |
| `MFP_PASSWORD`      | MyFitnessPal password (optional — log in interactively). |

> `.env` is gitignored — keep your credentials there, never commit them.

## Usage

The `start` script builds the TypeScript and runs the CLI:

```bash
yarn start -- --calories 2000 --protein 150 --fat 67 --carbs 250
```

If you omit any macro, the tool fetches your **Remaining** macros from
MyFitnessPal instead.

### Options

| Flag                      | Description                                      |
| ------------------------- | ------------------------------------------------ |
| `-c, --calories <number>` | Target calories (defaults to MFP remaining).     |
| `-p, --protein <number>`  | Target protein in grams (defaults to MFP).       |
| `-f, --fat <number>`      | Target fat in grams (defaults to MFP).           |
| `-r, --carbs <number>`    | Target carbs in grams (defaults to MFP).         |
| `-m, --max-items <n>`     | Maximum items per restaurant (default `5`).      |
| `-e, --restaurant <name>` | Limit to a single restaurant.                    |
| `-x, --exclude-category <name...>` | Category to leave out, e.g. `Desserts` (space-separated for more than one; defaults to `EXCLUDE_CATEGORIES`). |
| `--no-cache`              | Bypass cached scraper results and fetch fresh.   |
| `--no-mfp`                | Skip the MyFitnessPal push prompt.               |

### Examples

```bash
# Optimize across all restaurants for a specific macro target
yarn start -- -c 1800 -p 140 -f 60 -r 180

# Only look at KFC, allowing up to 4 items
yarn start -- -e kfc -m 4 -c 1200 -p 90 -f 40 -r 110

# Use MFP remaining macros and skip pushing the result back
yarn start -- --no-mfp

# Leave desserts and drinks out of the calculation
yarn start -- -c 1800 -p 140 -f 60 -r 180 -x Desserts Drinks
```

## How it works

1. **Scrape** — each restaurant has a scraper under
   [`src/scrapers/`](src/scrapers/). All pull live data: with Playwright, a
   plain HTTP fetch of embedded JSON, or the published nutrition PDF
   ([`src/scrapers/pdf/`](src/scrapers/pdf/)).
2. **Cache** — live results are stored under `.cache/scrapers/` for 7 days
   ([`src/cache.ts`](src/cache.ts)).
3. **Optimize** — [`src/macro-optimizer.ts`](src/macro-optimizer.ts) searches
   item combinations and ranks the closest matches per restaurant.
4. **MyFitnessPal** — [`src/mfp/`](src/mfp/) handles auth, reading remaining
   macros and quick-adding the chosen meal.

## Data sources & accuracy

Every restaurant is scraped live (and cached for 7 days). Papa Johns is
scraped live too, but is the one restaurant with a committed fallback source
file — explained below the table:

| Restaurant   | Source                                          |
| ------------ | ----------------------------------------------- |
| Popeyes      | Live scrape (Playwright)                        |
| McDonald's   | Live scrape (Playwright)                        |
| Taco Bell    | Live scrape of nutritionix.com                  |
| KFC          | Embedded JSON on the nutrition page             |
| Wagamama     | Embedded JSON on the menu page                  |
| Wendy's      | Published nutrition PDF                         |
| Domino's     | Published nutrition PDF                         |
| Subway       | Published nutrition PDF (UK & ROI)              |
| Nando's      | Embedded JSON on the menu page                  |
| itsu         | GraphQL API behind the menu page                |
| YO! Sushi    | Live scrape of menus.tenkites.com               |
| Slim Chickens| Live scrape of menus.tenkites.com               |
| Burger King  | Public Sanity CMS dataset (GROQ query)          |
| Pizza Hut    | Published allergen/nutrition PDF                |
| Chipotle     | Deliveroo dish list + published ingredient PDF (composed) |
| Papa Johns   | Live-fetched nutrition PDF, with a committed fallback copy (see below) |
| Five Guys    | Deliveroo dish list + published ingredient PDF (composed) |

- **Papa Johns** fetches its nutrition PDF live like everything else here,
  but is the **only restaurant with a committed fallback source file**. Its
  PDF sits behind Akamai, and `axios`/`curl` reliably get `403 Access Denied`
  on it from every environment tried — that turned out to be an HTTP-client
  TLS fingerprint check rather than a real IP/geo block, since Node's native
  `fetch()` gets the file fine from the same network path, so `scraper.ts`
  uses `fetch()` and fetches live on every run. The fallback exists because
  a fingerprint bypass is inherently less stable than a real unblock, and
  this project's CI doesn't have a last-known-good safety net wired up for
  Papa Johns the way it does for 8 other restaurants (see
  [`src/scrapers/PapaJohns/README.md`](src/scrapers/PapaJohns/README.md) for
  the specific gap) — so a failed live fetch reads the committed copy
  instead of returning nothing. Parsing itself
  is otherwise ordinary (no OCR, no LLM): the current PDF has a normal text
  layer, read the same way as Domino's/Wendy's/Subway/Pizza Hut, just without
  the shared header-driven pipeline (this document's headers span several
  lines and some pages draw two products side by side, which that pipeline's
  single-header-row detection doesn't fit). Every row still satisfies two
  independent checks the source table asserts (`per-100g kcal × weight ÷ 100
  == total kcal`, and Atwater `4P + 4C + 9F == per-100g kcal`); rows that
  fail without a uniquely-safe repair are logged and dropped rather than
  guessed. Covers the full menu (74 products / 423 variants). See
  [`src/scrapers/PapaJohns/README.md`](src/scrapers/PapaJohns/README.md) —
  including its history with an earlier, image-only copy of this PDF that
  did need OCR/a vision LLM, in case a future republish regresses to that.
- **Taco Bell** is scraped live from a **third-party service
  ([nutritionix.com](https://www.nutritionix.com/taco-bell-uk/menu/premium))**
  rather than Taco Bell directly, because that's what powers their UK online
  menu. As a result its macros **may differ from official / in-store values**.
  It's also an **item alterations** producer (spec 10) — a piece-count or
  meal-size baked into the source's own item name (`"Chicken Bites (3)"`,
  `"…Meal with Fries (Large)"`) becomes one item with a selector instead of a
  separate row per size, while other real choices in the name (protein,
  combo contents) stay part of the item so they're never folded into that
  selector.
- **Subway** figures are per 6-inch serving (double them for a footlong); the
  PDF also covers individual ingredients (breads, proteins, sauces, veg), which
  are scraped as their own items.
- **Nando's** items are scraped "as published" — the base dish's own
  nutrition, without any baste (spice level), side, or meal-size choice
  folded in, same as how sides and drinks are scraped as their own separate
  items for every other restaurant.
- **YO! Sushi** is scraped live from a **third-party allergen/nutrition
  portal ([menus.tenkites.com](https://menus.tenkites.com/yosushi/allergenpageyosushi)),
  linked from yosushi.com's own allergen-information page** — not from
  yosushi.com itself. yosushi.com's own per-item nutrition panel never
  publishes protein or total carbs (checked across every item type), so it
  can't feed this app's optimizer; tenkites has the full macro panel for
  every item in one page. Its item list isn't a perfect match for the live
  menu, though — e.g. "aburi scallop nigiri" is on yosushi.com but absent
  from tenkites entirely, so it's not included here.
- **Slim Chickens** is scraped from the **same tenkites platform as YO!
  Sushi**, not from slimchickens.com — that's the **US** site (every
  restaurant its own API returns is US-based) and would give US recipes/
  portions. The UK operator (Boparan Restaurant Group) publishes its menu on
  tenkites as a per-branch picker rather than one flat page; this scraper
  resolves the first "standard menu" branch from that picker and scrapes it
  as representative of the UK menu, rather than every branch individually.
  It's also an **item alterations** producer (spec 10) — a piece-count
  baked into the source's own item name as a **leading** number
  (`"6 Crispy Wings"`, `"8 Crispy Wings"`, `"10 Crispy Wings"`) becomes one
  item with a selector instead of a separate row per count.
- **Pizza Hut** is the first restaurant to use **item alterations** — each
  pizza is one item with a size selector rather than ~11 separate rows.
  Sourced from Pizza Hut's published allergen/nutrition PDF, using the
  **whole-product** macros (you order a whole pizza, not a serving). Scope is
  **Pizzas, Sides and Chicken** — Melts, Flatzz, Dips, Desserts and Drinks are
  omitted (they extract unreliably from the PDF's layout, and Drinks are
  excluded by default anyway). A couple of items near the Sides/Chicken/Dips
  section seams may land in an adjacent category.
- **Chipotle** is the first restaurant with **no published per-dish menu at
  all** — being build-your-own, Chipotle only publishes a per-*ingredient*
  nutrition PDF. Its items are **composed**: named, orderable dishes come from
  **Deliveroo's own menu listing** (chipotle-islington), and each dish's
  macros are the sum of its ingredients' live PDF values, per a **hand-curated
  recipe table** (not automated text-matching — see
  [`docs/specs/11-composed-menu-items.md`](docs/specs/11-composed-menu-items.md)).
  This means a Chipotle item's macros are only as accurate as (a) Deliveroo's
  description matching what's actually in the dish, and (b) the recipe having
  been kept in sync with Chipotle's real recipe — unlike every other
  restaurant here, no single published source states these dishes' macros
  directly. Only dishes with a fixed, reconcilable composition are included;
  kids' items, a few "High Protein" dishes whose stated protein doesn't
  reconcile against their own listed ingredients, and canned/bottled drinks
  (no PDF data for them) are left out.
- **Chipotle's build-your-own formats** (Bowl, Burrito, Salad, Tacos,
  Quesadilla) are separately composable in **Menu Mode**: a step-by-step
  picker (Protein → Rice → Beans → Toppings, …) built from Deliveroo's own
  live ordering-flow data (not hand-guessed), cross-referenced against the
  same ingredient PDF — see
  [`docs/specs/12-chipotle-build-your-own.md`](docs/specs/12-chipotle-build-your-own.md).
  The full picker (every option, unbounded toppings) is Menu Mode only, but
  a bounded expansion over just the *required* choices (protein, rice,
  beans, …) also feeds the **automatic optimizer** in the web app —
  ~150 candidate rows across the 5 formats, comparable in size to a normal
  restaurant's menu, **ranked by whichever macro your target leans on
  most** (protein/fat/carbs) rather than a fixed heuristic — a high-carb
  target and a high-protein target get a different, better-matched slice of
  candidates for the same dish. This doesn't reach the CLI (Menu Mode itself
  never has either); only the web app expands build-your-own trees. The
  optimizer core also gained a hard search-time budget after this expansion
  briefly hung the automatic search for hard targets — see spec 12's "A
  hang, its cause, and the fix" for the full story (it turned out to
  protect several other restaurants from the same latent issue, not just
  Chipotle).

## Scripts

Root project (CLI + scraper/build tooling):

| Command                | Description                                          |
| ----------------------- | ----------------------------------------------------- |
| `yarn build`            | Compile TypeScript to `dist/`.                        |
| `yarn start`            | Build and run the CLI.                                |
| `yarn build:data`       | Build, then scrape every enabled restaurant and write `web/public/data/` for the web app (cached results reused where valid). |
| `yarn build:data:fresh` | Same as `build:data`, bypassing the scraper cache.    |
| `yarn papajohns:check [path\|url]` | Check whether a newer Papa Johns PDF exists (tries the official URL by default) — reports only, replaces nothing. |
| `yarn papajohns:update [path\|url]` | Same check, but replaces the committed PDF and its README's provenance block if genuinely newer. See [`src/scrapers/PapaJohns/README.md`](src/scrapers/PapaJohns/README.md). |

[`web/`](web/) (React app, run from inside that directory):

| Command       | Description                                        |
| -------------- | --------------------------------------------------- |
| `yarn dev`     | Start the Vite dev server.                          |
| `yarn build`   | Type-check and build for production.                |
| `yarn preview` | Preview the production build locally.               |

[`extension/`](extension/) has no build step — see
[`extension/README.md`](extension/README.md) for how to load it unpacked.

## Disclaimer

This project scrapes publicly available nutrition data for personal use.
Nutritional figures may be inaccurate or out of date — always verify against
official sources before relying on them. Respect each website's terms of
service when scraping.

## License

[MIT](LICENSE) © Sefi Jantzis
