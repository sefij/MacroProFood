/**
 * PDF → positioned text lines.
 *
 * The reusable, content-agnostic primitive underneath the PDF scrapers: it
 * loads a PDF and returns its text as {@link PdfLine}s — horizontal lines of
 * text fragments, each fragment carrying its x-range and font height. It knows
 * nothing about tables or nutrition; {@link ../pdf/table-grid} builds structure
 * on top of it.
 *
 * `pdfjs-dist` v5 ships as ESM only, but this project compiles to CommonJS.
 * A `require()` of the ESM build throws, and `tsc` would down-level a plain
 * `import()` into that failing `require()`. We dodge both by loading it through
 * a `Function`-wrapped dynamic import, which TypeScript leaves untouched.
 */

const importEsm = new Function('specifier', 'return import(specifier)') as (
    specifier: string
) => Promise<typeof import('pdfjs-dist')>

/** A single text fragment on a line, with its horizontal extent. */
export interface PdfCell {
    /** Left edge (PDF user-space x, origin bottom-left). */
    x: number
    /** Right edge (`x + width`). */
    xEnd: number
    /** Glyph height in points — distinguishes headings (large) from body text. */
    height: number
    str: string
}

/** A run of text fragments sharing a baseline, ordered left→right. */
export interface PdfLine {
    /** 1-based page number. */
    page: number
    /** Baseline y (PDF user-space, larger = higher on the page). */
    y: number
    cells: PdfCell[]
}

/** Fragments whose baselines differ by ≤ this many points are one line. */
const LINE_Y_TOLERANCE = 3

interface RawItem {
    x: number
    y: number
    width: number
    height: number
    str: string
}

/**
 * Loads a PDF and returns every non-empty text line across all pages, in
 * natural reading order (page ascending, then top→bottom within a page).
 */
export async function extractPdfLines (data: Uint8Array): Promise<PdfLine[]> {
    const pdfjs = await importEsm('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({
        data,
        useSystemFonts: true,
        isEvalSupported: false
    }).promise

    const lines: PdfLine[] = []
    try {
        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
            const page = await doc.getPage(pageNum)
            const text = await page.getTextContent()

            const items: RawItem[] = []
            for (const item of text.items) {
                // TextMarkedContent entries have no `str`; skip them.
                if (!('str' in item) || item.str.trim() === '') continue
                const t = item.transform
                items.push({
                    x: t[4],
                    y: t[5],
                    width: item.width,
                    // Font height is the scale magnitude of the transform's y-axis.
                    height: Math.hypot(t[2], t[3]),
                    str: item.str
                })
            }

            lines.push(...clusterIntoLines(pageNum, items))
            page.cleanup()
        }
    } finally {
        await doc.destroy()
    }
    return lines
}

/**
 * Groups a page's fragments into lines by baseline proximity. Fragments are
 * sorted top→bottom (then left→right) so same-line items land adjacently, then
 * runs within {@link LINE_Y_TOLERANCE} are merged.
 */
function clusterIntoLines (page: number, items: RawItem[]): PdfLine[] {
    const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
    const lines: PdfLine[] = []

    for (const item of sorted) {
        const cell: PdfCell = {
            x: item.x,
            xEnd: item.x + item.width,
            height: item.height,
            str: item.str
        }
        const current = lines[lines.length - 1]
        if (current && Math.abs(current.y - item.y) <= LINE_Y_TOLERANCE) {
            current.cells.push(cell)
        } else {
            lines.push({ page, y: item.y, cells: [cell] })
        }
    }

    for (const line of lines) line.cells.sort((a, b) => a.x - b.x)
    return lines
}
