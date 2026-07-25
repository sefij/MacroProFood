# Papa John's UK — source data

`nutritional-information.pdf` is committed here, which no other restaurant in
this project needs. Two independent reasons, both worth knowing before anyone
tries to "fix" it by fetching live.

## 1. The source can't be fetched from a server

`https://www.papajohns.co.uk/static/assets/pdfs/nutritional-information.pdf` is
the official URL. It sits behind Akamai and is geo-fenced to the UK:

- A datacenter IP gets `403 Access Denied` (`Server: AkamaiGHost`) on the PDF,
  on `/allergens-and-nutrition`, and on the homepage.
- A plain client is redirected to `papajohns.com/international/` instead.
- A real headless Chromium session gets the same 403, so this isn't a
  User-Agent or cookie problem.

That rules out fetching it at scrape time: `.github/workflows/refresh-data.yml`
runs on GitHub-hosted runners, which are datacenter IPs and would hit the same
wall. A UK residential connection can download it fine in a browser, which is
why the file is captured by hand.

**Provenance caveat:** this copy came from a third-party mirror
(`ribbyhall.co.uk/uploads/Back End Links/nutritional-information-papa-johns.pdf`)
because the official URL is unreachable from here. It carries Papa John's own
`©2022 Papa John's International, Inc.` footer and the `OCT22-1` version tag on
its item pages, but it has **not** been byte-compared against the official file.
Anyone with UK access should re-download from the official URL and replace this
copy; if the sha256 differs, prefer the official one.

    sha256  af22af9f79e5a6ab4157ccf945efa8ec04980118bceedc7936bff83ad69ecd31
    size    7,179,292 bytes
    pages   64 (menu items start on page 7)
    version OCT22-1

## 2. The PDF has no extractable text

Unlike Domino's, Wendy's, Subway and Pizza Hut — all of which have real text and
are parsed with `src/scrapers/pdf/` — this document's tables are **images**:

- 162 text fragments across all 64 pages, and they're just the per-page
  copyright footer.
- Page 7 draws **271 `paintImageXObject`** ops against 2 `showText`.
- Each cell's value is its own small image, roughly 15×8pt.

So `extractPdfLines` / `extractPdfItems` return nothing useful here, and the
numbers have to be recovered by rendering pages and reading the pixels.

## Reading the tables reliably

Three OCR approaches were tried and rejected before this. Tesseract
systematically drops a leading digit (`1133` → `133`, `11.7` → `1.7`) — raw
per-cell accuracy topped out around 93%, and a column-detection bug (measuring
a vertical rule's coverage against full page height instead of the table's own
row band) undercounted pizzas at 11, then 16, out of ~30. PaddleOCR/PP-Structure
was spiked next — it crashed natively on both Windows and WSL2 until a specific
paddle/paddleocr/numpy version combination was found, and even working it only
reached 60% with a worse failure mode (merged rows) than Tesseract. Neither was
trustworthy enough to ship nutrition data from.

`tools/papajohns/extract.mjs` instead renders each page to a PNG and sends it
to Claude (`claude-opus-5`) with a JSON-schema-constrained structured output
(`client.messages.parse()`), asking for every product and every size/crust row
exactly as printed. This was validated against a hand-transcribed ground truth
for page 7 (100% exact match on every column the scraper uses) before scaling
to the full document, then spot-checked on a title-OCR-failure page and a
two-products-per-page layout.

Vision extraction is far more accurate than OCR, but still not treated as
ground truth on its own — every row must satisfy two independent equations the
source table itself asserts:

    energy   per100g_kcal × totalWeight / 100  ==  totalKcal      (±2%)
    Atwater  4×protein + 4×carbs + 9×fat       ==  per100g_kcal   (±12%)

When a row fails, the extractor tries the same repair OCR needed (restore a
dropped leading digit) across every numeric field, but **only accepts a repair
when exactly one candidate across all fields clears both equations**. The first
version of this accepted the first candidate that passed either check — on a
real row (page 8, American Hot) that silently "fixed" protein from 9.5 to 29.5g
(a wild outlier against every sibling row, 8.4–15.7g) when the actual misread
was fat (1.4 → 11.4g), and separately, two different protein values (29.5 and
39.5) both independently satisfied the check alone. Satisfying an equation is
not proof of correctness when more than one edit satisfies it — only a unique
candidate is safe to auto-accept; everything else is dropped and listed under
`rejected` rather than guessed.

## Coverage today

`nutrition.json` holds **60 products / 260 variants** across Pizzas, Vegan
Pizzas, Papadias, Sides, Vegan Sides, Desserts, and Recently Delisted (excluded
from the scraper's output — see below). All 58 item pages (7-64) are accounted
for: extracted, self-skipped by the model as a non-table page (CYO ingredient
pages, allergen keys, dividers, the table of contents — 11 pages), or rejected
(3 rows, listed under `rejected` with their raw extracted values).

"Recently Delisted" is the source PDF's own category for discontinued products
kept in for allergen/nutrition compliance — its own page banner says so. They
extract cleanly but `scraper.ts` drops them: they can't actually be ordered, so
surfacing them would let the optimizer recommend something off the real menu.

## Known data quirk

Papa John's own per-100g figures are internally inconsistent across sizes of the
same recipe (All The Meats: protein 17.4 → 13.1 → 11.7 for Medium → Large →
XXL thin crust). Derived whole-pizza macros inherit that noise. It's in the
source, not in the extraction.

## If a better source turns up

Preferable, in rough order: a UK-specific Nutritionix path (none exists today —
`/papa-johns` is the **US** menu, and `/papa-johns-uk` 404s); a tenkites-style
allergen portal like YO! Sushi and Slim Chickens use (Papa John's isn't on it);
or a machine-readable file from Papa John's directly (none published). Deliveroo
lists the UK menu with calories but no protein/fat/carbs, so it can only ever
corroborate, not replace this.
