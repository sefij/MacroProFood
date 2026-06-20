# MacPro 🍔

*Macros, pro.*

A command-line tool that scrapes nutritional information from UK fast-food
restaurants and finds the meal combinations that best match your target macros
(calories, protein, fat, carbs). It can optionally read your remaining macros
from **MyFitnessPal** and push the chosen meal straight back to your diary.

## Features

- **Multi-restaurant scraping** — Popeyes, KFC, Wendy's, McDonald's, Subway and
  Taco Bell (UK menus).
- **Macro optimizer** — finds the top combinations of menu items that get as
  close as possible to your target calories/protein/fat/carbs.
- **MyFitnessPal integration** — auto-fill your targets from the "Remaining"
  row and push the selected meal to your Dinner entry.
- **Result caching** — scraped data is cached for 7 days (override with
  `--no-cache`).
- **Per-restaurant toggles** — disable any scraper via environment variables.

## Requirements

- [Node.js](https://nodejs.org/) 18+ (developed on v22)
- [Yarn](https://yarnpkg.com/)

## Installation

```bash
git clone https://github.com/<your-username>/MacPro.git
cd MacPro
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
```

## How it works

1. **Scrape** — each restaurant has a scraper under
   [`src/scrapers/`](src/scrapers/). Some pull live data with Playwright; others
   read from bundled snapshots (`store.ts`).
2. **Cache** — live results are stored under `.cache/scrapers/` for 7 days
   ([`src/cache.ts`](src/cache.ts)).
3. **Optimize** — [`src/macro-optimizer.ts`](src/macro-optimizer.ts) searches
   item combinations and ranks the closest matches per restaurant.
4. **MyFitnessPal** — [`src/mfp/`](src/mfp/) handles auth, reading remaining
   macros and quick-adding the chosen meal.

## Data sources & accuracy

Each restaurant gets its data one of two ways:

| Restaurant   | Source                                   | Type            |
| ------------ | ---------------------------------------- | --------------- |
| Popeyes      | Live scrape (Playwright)                 | Live + cached   |
| McDonald's   | Live scrape (Playwright)                 | Live + cached   |
| Taco Bell    | Live scrape of nutritionix.com           | Live + cached   |
| KFC          | Bundled JSON snapshot (`store.ts`)       | Snapshot        |
| Wendy's      | Bundled JSON snapshot (`store.ts`)       | Snapshot        |
| Subway       | Bundled JSON snapshot (`store.ts`)       | Snapshot        |

- **Snapshot scrapers (KFC, Wendy's, Subway)** read from a hand-captured JSON
  snapshot of the menu committed in the repo
  ([`src/scrapers/<name>/store.ts`](src/scrapers/)). They are fast and don't
  hit the network, but they are **a point-in-time copy and will go stale** as
  restaurants change their menus or reformulate items. Re-capture the snapshot
  periodically to keep figures current.
- **Taco Bell** is scraped live from a **third-party service
  ([nutritionix.com](https://www.nutritionix.com/taco-bell-uk/menu/premium))**
  rather than Taco Bell directly, because that's what powers their UK online
  menu. As a result its macros **may differ from official / in-store values**.

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
