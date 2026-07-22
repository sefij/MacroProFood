# MacroPro 🍔

*Macros, pro.*

A command-line tool that scrapes nutritional information from UK fast-food
restaurants and finds the meal combinations that best match your target macros
(calories, protein, fat, carbs). It can optionally read your remaining macros
from **MyFitnessPal** and push the chosen meal straight back to your diary.

## Features

- **Multi-restaurant scraping** — Popeyes, KFC, Wendy's, McDonald's, Subway,
  Taco Bell, Wagamama, Domino's, Nando's, itsu, YO! Sushi and Slim Chickens
  (UK menus).
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

Every restaurant is scraped live (and cached for 7 days):

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

- **Taco Bell** is scraped live from a **third-party service
  ([nutritionix.com](https://www.nutritionix.com/taco-bell-uk/menu/premium))**
  rather than Taco Bell directly, because that's what powers their UK online
  menu. As a result its macros **may differ from official / in-store values**.
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

## Scripts

| Command      | Description                          |
| ------------ | ------------------------------------ |
| `yarn build` | Compile TypeScript to `dist/`.       |
| `yarn start` | Build and run the CLI.               |

## Disclaimer

This project scrapes publicly available nutrition data for personal use.
Nutritional figures may be inaccurate or out of date — always verify against
official sources before relying on them. Respect each website's terms of
service when scraping.

## License

[MIT](LICENSE) © Sefi Jantzis
