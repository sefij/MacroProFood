# Papa John's UK — source data

`nutritional-information.pdf` is committed here, which no other restaurant in
this project needs — `scraper.ts` reads this local file instead of fetching
one. One reason, worth knowing before anyone tries to "fix" it by fetching
live.

## The source can't be fetched from a server

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
why the file is captured by hand and committed.

    sha256  17d6f89243776c7321d0e8286add3e4c37c240e8ea70fb043d1366caeca9603f
    size    11,936,318 bytes
    pages   86 (menu items start on page 7)
    version JUNE26-1

Anyone with UK access can re-download from the official URL and replace this
copy — check the version stamp printed on each item page (bottom-right,
e.g. `JUNE26-1`) and the sha256 above before assuming a newer copy is actually
newer; the PDF has been captured twice now (see History) and the version tag
is the reliable signal, not the download date.

## Reading the table

Unlike the copy this scraper originally shipped against, the current PDF has
a **real text layer** — every number is selectable, extractable text, not a
picture of a number. So this is parsed the same way as Domino's, Wendy's,
Subway and Pizza Hut (`src/scrapers/pdf/`, or `extractPdfLines` directly):
positioned text, no OCR, no vision model, no offline step. Parsing the full
86-page document takes under a second.

It doesn't use the shared header-driven pipeline (`extractTables`), though,
because the layout doesn't fit its one-header-row assumption: a page's
"VALUES PER 100G" / "VALUES PER PORTION" headers are stacked across several
lines (a label row, then a wrapped continuation, then a units row), and some
pages draw **two** products side by side, each with its own pair of tables.
`scraper.ts` reads raw positioned lines and reconstructs rows itself:

- **Pizza-family pages** (and some single-row pages) draw both tables side by
  side, so a product's 16 figures (10 per-100g + 6 per-portion) sit on one
  line per size/crust row — read directly.
- **Papadias/Sides/Desserts pages** (one or two products per page) stack the
  two tables instead, so a product's per-100g row and per-portion row are
  found independently and paired; two products on one page are split by the
  x-gap between their title blocks.
- A row's numbers occasionally wrap onto the next baseline (a long crust
  label pushes the portion cells down a few points) — detected and merged
  rather than silently truncating the row to 10 values.
- A handful of promotional/kids-menu pages (e.g. "Space Ranger Roni" /
  "Sheriffs Round Up") print the column-header row without the usual "VALUES
  PER 100G" super-label above it — detected by falling back to the
  `ENERGY, ENERGY, PROTEIN, FAT` header pattern itself when that label is
  entirely absent from the page.
- A page occasionally prints a redundant "per single serving" summary row
  alongside the true whole-product portion row. They aren't interchangeable:
  for most products either scaling is internally self-consistent (pick the
  larger, whole-product one), but for a few only the *smaller* row actually
  satisfies its own energy equation — every candidate is tried against the
  check itself, never assumed from size.
- "Sulphites / SO₂" (a common allergen note) renders its subscript "2" as its
  own text run, which can land on the same baseline as a real numeric row by
  coincidence. Stripped by dropping any leading cell separated from the rest
  of the row by an implausibly wide gap (real column gaps top out around
  30-45pt; this sits ~170pt off).

Every row is still checked against the two equations the source table itself
asserts:

    energy   per100g_kcal × totalWeight / 100  ==  totalKcal      (±2%)
    Atwater  4×protein + 4×carbs + 9×fat       ==  per100g_kcal   (±12%)

A row that fails either is dropped — *unless* exactly one candidate fix makes
both hold. The source PDF occasionally drops a decimal point (e.g. prints
`135` where every sibling row reads `13.5`); the scraper tries un-dropping one
(÷10) or the inverse (×10) on each numeric field and accepts a fix only when
it's the **unique** candidate that clears both equations. Accepting the first
candidate that merely passes the tolerance isn't safe: during an earlier
version of this scraper (reading an older, image-only copy of this same PDF
via OCR), that approach once silently "fixed" the wrong field, and separately,
two different values for the same field both independently passed the check.
Only a unique fix is trustworthy; everything else is logged and dropped.

## Coverage today

**74 products / 423 variants**, across Pizzas, Sourdough Pizzas, Vegan
Pizzas, Papadias, Sides, Sourdough Sides, Vegan Sides, Desserts and Sourdough
Desserts. "Recently Delisted" (the source PDF's own category for
discontinued products, kept in for allergen/compliance reasons per its own
page footer) parses cleanly but is dropped by `scraper.ts` — those items
can't actually be ordered, so surfacing them would let the optimizer
recommend something off the real menu. "CYO Ingredients" and "Drinks" pages
carry no "VALUES PER 100G" table at all and are skipped as non-item pages.

11 rows across the rest of the menu fail both equations with no unique
repair — logged to the console and dropped rather than guessed, most as one
missing size/crust within an otherwise-complete pizza. Two whole products are
lost this way (both single-row, so their one failing row takes the product
with it): **Cinnapie Sticks** (page 61) misses its own Atwater equation by
34% (4×7.2 + 4×56.2 + 9×9.7 = 341 vs a printed 520kcal/100g — no plausible
single-field fix closes a gap that size) and **Cinnamon Scrolls** (also page
61) misses its energy equation by 2.78% (330kcal/100g × 332g should be
1096kcal; the PDF prints 1066) — just outside the ±2% tolerance, plausibly
rounding noise rather than a real error, but not confidently repairable
either way. Both were spot-checked against the rendered page to rule out a
parsing bug before accepting them as genuine source inconsistencies.

## Known data quirk

Papa John's own figures are internally inconsistent in a couple of ways, both
in the source, not the extraction:

- Per-100g figures vary across sizes of the same recipe (a thin-crust pizza's
  protein-per-100g isn't identical at Medium vs Large vs XXL) — derived
  whole-pizza macros inherit that noise.
- A handful of rows don't satisfy their own printed energy/Atwater equations
  at all (not just a dropped decimal) — these are the 13 rejected rows above.

## History: an image-only predecessor, and why OCR/vision aren't used

The copy this scraper originally shipped against (`OCT22-1`, captured via a
third-party mirror since the official URL was unreachable even by hand at the
time) had **no extractable text at all** — its tables were images: 162 text
fragments across 64 pages, all of them the page footer; a page drew ~271
`paintImageXObject` ops against 2 `showText`. Recovering numbers meant
rendering pages and reading pixels, which was tried two ways before this
document was superseded by a text-layer copy:

- **OCR (Tesseract).** Systematically dropped a leading digit (`1133` →
  `133`), capping raw per-cell accuracy around 93%; a column-detection bug
  (measuring a vertical rule's coverage against full page height instead of
  the table's own row band) undercounted pizzas at 11, then 16, of ~30.
- **PaddleOCR/PP-Structure.** Crashed natively on both Windows and WSL2 until
  a specific paddle/paddleocr/numpy version combination was found, and even
  working it only reached 60% accuracy with a worse failure mode (merged
  rows) than Tesseract.
- **Vision LLM (Claude Opus 5, structured outputs).** Validated to 100% exact
  match against a hand-transcribed page before scaling to a full 58-page run
  (~$2.25 in API cost) — this is what shipped, briefly, as **60 products /
  260 variants, pizzas-only-complete**, before a user cross-check against a
  since-updated PDF (`JUNE26-1`, with a real text layer) showed the old
  `OCT22-1` figures were simply stale, not wrong — Papa John's had
  reformulated recipes in the interim. The `JUNE26-1` PDF made all of the
  above moot: real text needs none of it.

If the source ever regresses to an image-only PDF again, the vision-LLM
approach (render page → `client.messages.parse()` with a JSON-schema output,
gated by the same two equations) is the one worth reaching for first — see
this file's git history for the last working version of that pipeline.

## If a better source turns up

Preferable, in rough order: a UK-specific Nutritionix path (none exists today —
`/papa-johns` is the **US** menu, and `/papa-johns-uk` 404s); a tenkites-style
allergen portal like YO! Sushi and Slim Chickens use (Papa John's isn't on it);
or a machine-readable file from Papa John's directly (none published). Deliveroo
lists the UK menu with calories but no protein/fat/carbs, so it can only ever
corroborate, not replace this.
