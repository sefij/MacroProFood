# 01 — Convert Subway to live data ✅

## Goal

Replace the hand-captured `src/scrapers/Subway/store.ts` snapshot (last
refreshed 2025-09-01) with a live scrape, following the same pattern as the
Wendy's/Domino's PDF conversions.

## Data source

Subway's published UK & ROI nutrition information PDF (June 2026), found by
the project owner (the nutrition page itself is bot-gated to plain HTTP
clients, but the media URL serves fine):

```
https://www.subway.com/en-gb/media/emea/europe/uk/nutrition/2026/UKI_IngredientsNutritionalInformationJune2026.pdf
```

## PDF layout (verified with `extractPdfLines`)

- Header rows are rotated label text whose x-positions don't align with data
  cells → fixed anchors read off the data rows, like Wendy's.
- **Two grids in one document** (this drove a pipeline extension):
  - pages 1–2: menu grid (Subs, Toasties, Saver Subs, Wraps, Salads, Spuds,
    Sides, Cookies), name at x ≈ 13.2, macros at x ≈ 179–365;
  - page 3: ingredients grid (breads, proteins incl. HALAL, cheese,
    vegetables, sauces, toppings), name at x ≈ 19.9, macros at x ≈ 143–283.
- Each row repeats as a per-100 g block ~21 pt right of the salt column; a
  5 pt tolerance (columns ~15 pt apart, ±2.5 pt jitter) leaves it unmapped.
- The document title and "UK and ROI" banner repeat on every page; unignored
  they'd be read as section titles and cut the Salads section in two where it
  continues onto page 2 (mis-keying those rows).
- Menu-item names are bare ("Bacon", "Chicken Tikka") — they collide with
  page-3 ingredient portions of the same name ("Chicken Tikka", "Philly
  Steak", "Spiced Plant Patty") and read poorly alone, so menu sections are
  suffixed onto names ("Bacon Sub", "Chicken Tikka Wrap") unless already
  present ("Honey Mustard Deli Toastie").

## Changes

1. **`src/scrapers/pdf/table-grid.ts`** — two new generic options:
   `fixedGrids` (multiple fixed layouts; each line keeps the grid mapping that
   claims the most cells — count-based, because "first anchor hit" can
   coincidentally match the wrong grid) and `ignoreTitles` (regex for repeated
   page-top boilerplate). `fixedColumns` is now the one-grid special case.
2. **`src/scrapers/pdf/pdf-nutrition-scraper.ts`** — passes both through
   `PdfScraperConfig`.
3. **`src/scrapers/Subway/scraper.ts`** — `PdfNutritionScraper` config with
   the two grids, title-ignore regex, section-suffix `buildKey`, and the
   macro-sanity `accept` filter (single macro ≤ 1.3 × calories energy).
4. **Deleted `src/scrapers/Subway/store.ts`**, and **`JsonScraper`** from
   `src/types.ts` (Subway was its last user).
5. **`src/scrapers/scraping-oprerator.ts`** — `scrapeSubway` now cached via
   `withCache('subway', …)` like the other live scrapers.
6. **`src/tools/build-web-data.ts`** — Subway registry entry is `live`.
7. **`README.md`** — data-sources table refreshed (all 8 restaurants live),
   per-6-inch-serving note, todo removed.

No workflow change: `.github/workflows/refresh-data.yml` already seeds and
uploads `subway.json`.

## Verification (done)

- Fresh scrape yields **185 items**, 0 duplicate keys, 1 skipped row (the
  page-3 header line, whose labels coincidentally map as cells).
- Macros spot-checked against the PDF: Bacon Sub 306 kcal / P16 / F11 / C37;
  Italian B.M.T Sub 386 kcal; Chicken Tikka Sub 345 kcal vs Chicken Tikka
  protein portion 89 kcal (collision resolved); Jacket Potato 232 kcal /
  C46.9; page-2 Salads continuation keys correctly ("BBQ Pulled Plant Salad").
- Operator path verified fresh + cached; stale cache entry replaced.
