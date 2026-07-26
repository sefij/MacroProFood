# Papa John's UK — source data

`nutritional-information.pdf` is committed here, which no other restaurant in
this project needs. `scraper.ts` fetches the live PDF on every run like an
ordinary scraper — but unlike every other one here, it falls back to this
committed copy if that fetch fails for any reason, rather than returning
nothing. Worth knowing why before anyone "simplifies" it to fetch-only.

## Fetching it isn't as blocked as it first looked

`https://www.papajohns.co.uk/static/assets/pdfs/nutritional-information.pdf` is
the official URL. It sits behind Akamai, and for a long time this section said
that ruled out fetching it from anywhere but a UK residential browser:

- `axios` (Node's legacy `http` module) and `curl` both reliably get
  `403 Access Denied` (`Server: AkamaiGHost`) on the PDF, from every
  environment tried.
- A plain client is redirected to `papajohns.com/international/` instead.

That looked like an IP-based geofence — until Node's **native `fetch()`**
(built on `undici`, a different TLS implementation than `axios`/`curl`) was
tried on the exact same URL, from the exact same network path, with no
special headers or cookies: **`200`, full file, byte-identical to the
committed copy, reproducibly.** So the block isn't about IP or geography at
all — it's TLS/HTTP-client fingerprinting, and `undici`'s fingerprint isn't
on Akamai's list (at least not currently). Both `scraper.ts` and
`tools/update-papajohns-pdf.ts` fetch the official URL directly with
`fetch()`, and it works.

This could stop working the moment Akamai's fingerprint list changes — it's
not a guarantee, just what's currently true. If it does regress, the
fallback is what it always was: download the PDF by hand in a real browser
and pass the saved file's path instead.

    sha256  17d6f89243776c7321d0e8286add3e4c37c240e8ea70fb043d1366caeca9603f
    size    11,936,318 bytes
    pages   86 (menu items start on page 7)
    version JUNE26-1

Anyone with UK access can re-download from the official URL and replace this
copy — check the version stamp printed on each item page (bottom-right,
e.g. `JUNE26-1`) and the sha256 above before assuming a newer copy is actually
newer; the PDF has been captured twice now (see History) and the version tag
is the reliable signal, not the download date.

### Checking for and applying updates

    yarn papajohns:check              # is there a newer one? (fetches the official URL)
    yarn papajohns:check <path-or-url>  # check a specific file/URL instead, report only
    yarn papajohns:update              # same check, but replace if newer
    yarn papajohns:update <path-or-url> # replace with a specific file/URL if newer

Both fetch the given source — a URL (defaulting to the official one) or a
local path (from a browser download, still supported as a fallback) — and
compare it against the committed copy, printing their version stamps/page
counts/sha256s side by side. `--check` never writes anything, even when an
update is found (it saves the fetched bytes to a temp path and prints the
exact `papajohns:update` command to apply it). Without `--check`:

- does nothing if they're byte-identical,
- refuses to replace automatically if the version stamp is unchanged but the
  bytes differ (that's not the normal shape of a real update — could be a
  re-export or a corrupted download; check by hand before overriding),
- otherwise replaces `nutritional-information.pdf` and rewrites this file's
  provenance block (sha256/size/pages/version) to match.

Either way, this does **not** run the scraper or commit anything — run
`yarn build:data` and the test suite afterward and review the diff yourself.
A version bump can shift page numbers and reformulate recipes (that's
exactly what happened between `OCT22-1` and `JUNE26-1` — see History), so
treat a successful swap as the start of a review, not the end of one.

### It's live now, with a fallback — why not drop the file entirely?

`scraper.ts` fetches the official URL live on every run (`fetchLive()`), so
in normal operation the committed PDF is never actually read. The reason it
stays committed rather than being deleted is a specific gap in how this
project's CI handles a live scraper going quiet, not general caution:

`refresh-data.yml`'s "Seed existing snapshots from R2" step pre-loads the
*previous* snapshot for 8 restaurants before running the scrapers, so that
if one of them returns zero items (a transient failure), `build-web-data.ts`
keeps serving the last-known-good data instead of overwriting it with an
empty menu (`resolveUpdatedAt` / `readExisting` in `src/tools/
build-web-data.ts`). **Papa Johns isn't on that seed list.** If `scraper.ts`
had no local fallback and its fetch ever failed on a scheduled run — Akamai
finally blocklisting `undici`'s fingerprint, a network blip, anything — the
next R2 upload would ship an *empty* Papa Johns menu, not just a stale one.

The committed file is what closes that gap without touching CI at all: a
failed live fetch falls back to it inside the scraper itself, so the rest of
the pipeline never has to know a fetch failed. The alternative — adding
`papajohns` (and, since this is a real gap, arguably the 7 other restaurants
missing from that same list) to the R2 seed step — was considered and
deliberately not done; it would remove the need for this file, but changes
shared CI infrastructure for every restaurant instead of staying contained
to this one scraper. Worth revisiting if that list is ever audited generally.

Since the fallback path only actually runs when the live fetch fails, keep
it exercised: `yarn papajohns:update` (or the occasional real Akamai hiccup)
is what keeps it from silently drifting out of date while unused.

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
