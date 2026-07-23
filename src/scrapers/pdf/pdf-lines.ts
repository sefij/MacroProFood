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

/**
 * A raw positioned text fragment, before any line clustering — the primitive
 * {@link extractPdfLines} builds on. Unlike {@link PdfCell} it keeps the
 * fragment's baseline `y`, its advance `width`, and whether it was rotated,
 * which the line clusterer discards. Needed for layouts with rotated text
 * (e.g. a table whose category/product labels are drawn vertically), where
 * baseline clustering can't reconstruct the structure.
 */
export interface PdfItem {
    /** 1-based page number. */
    page: number
    /** Left/anchor x (PDF user-space). */
    x: number
    /** Baseline y (PDF user-space, larger = higher on the page). */
    y: number
    /** Advance width of the run. For rotated text this is its *vertical* extent. */
    width: number
    /** Glyph height in points. */
    height: number
    /** True when the text is rotated off the horizontal (any non-zero shear/rotation). */
    rotated: boolean
    str: string
}

/**
 * Loads a PDF and returns every non-empty text fragment as a flat
 * {@link PdfItem} list (page ascending, then top→bottom, then left→right),
 * preserving rotation and raw geometry. This is the lower-level sibling of
 * {@link extractPdfLines}; use it when a document's structure is carried by
 * rotated text that line clustering would mangle.
 */
export async function extractPdfItems (data: Uint8Array): Promise<PdfItem[]> {
    const pdfjs = await importEsm('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await pdfjs.getDocument({
        data,
        useSystemFonts: true,
        isEvalSupported: false
    }).promise

    const items: PdfItem[] = []
    try {
        for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
            const page = await doc.getPage(pageNum)
            const text = await page.getTextContent()
            for (const item of text.items) {
                if (!('str' in item) || item.str.trim() === '') continue
                const t = item.transform
                items.push({
                    page: pageNum,
                    x: t[4],
                    y: t[5],
                    width: item.width,
                    height: Math.hypot(t[2], t[3]),
                    // A horizontal run has t = [s, 0, 0, s, x, y]; any non-zero
                    // t[1]/t[2] means the run is sheared/rotated off-axis.
                    rotated: Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01,
                    str: item.str
                })
            }
            page.cleanup()
        }
    } finally {
        await doc.destroy()
    }
    return items
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
 *
 * `lineYTolerance` sets how far apart (in points) two fragments' baselines can
 * be and still count as one line. Lower it for tables whose rows are packed
 * close together, or adjacent rows collapse into one.
 */
export async function extractPdfLines (
    data: Uint8Array,
    lineYTolerance: number = LINE_Y_TOLERANCE
): Promise<PdfLine[]> {
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

            lines.push(...clusterIntoLines(pageNum, items, lineYTolerance))
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
function clusterIntoLines (
    page: number,
    items: RawItem[],
    lineYTolerance: number
): PdfLine[] {
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
        if (current && Math.abs(current.y - item.y) <= lineYTolerance) {
            current.cells.push(cell)
        } else {
            lines.push({ page, y: item.y, cells: [cell] })
        }
    }

    for (const line of lines) line.cells.sort((a, b) => a.x - b.x)
    return lines
}
