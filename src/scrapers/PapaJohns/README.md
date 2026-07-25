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

OCR alone is not trustworthy on this document. Tesseract systematically drops a
leading digit (`1133` → `133`, `11.7` → `1.7`), which would silently corrupt
macros — the worst possible failure for nutrition data, since nothing downstream
would notice. Raw per-cell accuracy tops out around 93%.

What makes it safe is that each row must satisfy two independent equations:

    energy   per100g_kcal × totalWeight / 100  ==  totalKcal      (±2%)
    Atwater  4×protein + 4×carbs + 9×fat       ==  per100g_kcal   (±12%)

The Atwater identity was checked against 11 hand-transcribed rows and held
within 0.7–4.3%, so it's a real constraint. A row is accepted only when both
equations hold. When they don't, the extractor retries the specific edits that
match the known fault (restore a dropped leading digit) and accepts a repair
**only if both equations then hold**; otherwise the row is dropped rather than
guessed. A wrong leading digit can't survive that, because it shifts the value
tenfold while the energy check is tight to 2%.

Note that `TOTAL PRODUCT WEIGHT` is printed in the per-slice block, so the total
weight does not need deriving from slice counts — that route is available as a
third cross-check instead.

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
