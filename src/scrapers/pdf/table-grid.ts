/**
 * Positioned text lines → structured tables.
 *
 * This is the reusable, header-driven table reconstructor. Given the
 * {@link PdfLine}s of a document and a set of {@link ColumnMatcher}s, it finds
 * each table's header row, learns that table's column layout from the header
 * cells' x-positions, and assigns every following data cell to a column by
 * nearest x. Because layout is learned per header, tables with different
 * shapes (extra `Crust`/`Size`/`Serves` columns) all parse with one config.
 *
 * Two structural quirks of real menu PDFs are handled here:
 *
 *  - **Tables split across pages.** A header row at the top of a page with no
 *    section title above it is a *continuation*: rows keep flowing into the
 *    same table, with the column layout refreshed from the repeated header.
 *
 *  - **Cells that wrap over several lines.** A long name or crust spills onto
 *    lines below the numeric row. Such continuation lines carry no anchor
 *    value, so their fragments are merged into the row started just above.
 *
 * It is deliberately nutrition-agnostic: roles are opaque strings supplied by
 * the caller, and cell values stay as raw text for a higher layer to parse.
 */

import { PdfLine, PdfCell } from './pdf-lines'

/** Maps a header cell (matched by `match`) to a caller-defined column role. */
export interface ColumnMatcher {
    role: string
    match: RegExp
}

export interface TableGridOptions {
    columns: ColumnMatcher[]
    /**
     * Role whose cell holds the numeric value that marks a line as a data row
     * (as opposed to a wrapped-text continuation). Defaults to `'calories'`.
     */
    anchorRole?: string
    /**
     * Minimum glyph height for a line to count as a section title. Lines at or
     * above this are headings; body text and header rows fall below it.
     * Auto-derived from the document when omitted.
     */
    headingMinHeight?: number
}

/** One extracted data row: role → merged cell text. */
export interface TableRow {
    page: number
    y: number
    cells: Record<string, string>
}

export interface ExtractedTable {
    /** The section title above the (first) header, e.g. a category name. */
    title: string
    rows: TableRow[]
}

/** A header cell's learned column anchor. */
interface Column {
    role: string
    /** Left x of the header cell — data cells map to the nearest of these. */
    x: number
}

/** A header row must match at least this many distinct column roles. */
const MIN_HEADER_ROLES = 3

/** A data cell maps to a column only within this many points of its x anchor. */
const COLUMN_X_TOLERANCE = 26

/**
 * A wrapped continuation line must sit within this many points below the
 * previous line of the same row. Measured line-to-line (not from the anchor) so
 * a name spanning three-plus lines keeps chaining, while stray text a full row
 * gap away is left out.
 */
const CONTINUATION_LINE_GAP = 14

/**
 * Reconstructs every table in the document. Lines are consumed in reading
 * order; state machine transitions on titles, headers, data rows, and
 * wrapped-text continuations.
 */
export function extractTables (
    lines: PdfLine[],
    options: TableGridOptions
): ExtractedTable[] {
    const anchorRole = options.anchorRole ?? 'calories'
    const headingMinHeight =
        options.headingMinHeight ?? deriveHeadingMinHeight(lines)

    const tables: ExtractedTable[] = []
    let table: ExtractedTable | null = null
    let columns: Column[] | null = null
    let pendingTitle = ''
    let lastRow: TableRow | null = null
    // Baseline of the last line folded into `lastRow` (its anchor or a prior
    // wrapped line) — continuations are measured against this, not the anchor.
    let lastLineY = 0

    for (const line of lines) {
        const header = matchHeader(line, options.columns)
        if (header) {
            if (pendingTitle || !table) {
                // New table: either freshly titled, or an untitled header with
                // no table in progress to continue.
                table = { title: pendingTitle, rows: [] }
                tables.push(table)
                pendingTitle = ''
            }
            // Refresh column layout (identical on a continuation page).
            columns = header
            lastRow = null
            continue
        }

        const mapped = columns ? mapCells(line, columns) : null
        const isDataRow = mapped != null && mapped[anchorRole] !== undefined

        // A large-font line is a section title — but only if it isn't a data
        // row. Checking the anchor first stops a data row that happens to carry
        // a large/bold fragment (e.g. a featured item name) from being read as
        // a title, which would drop the row and reset the whole table.
        if (!isDataRow && isHeading(line, headingMinHeight)) {
            pendingTitle = lineText(line)
            table = null
            columns = null
            lastRow = null
            continue
        }

        if (!table || !columns || !mapped) continue

        if (isDataRow) {
            // A value in the anchor column ⇒ this line starts a data row.
            const row: TableRow = { page: line.page, y: line.y, cells: mapped }
            table.rows.push(row)
            lastRow = row
            lastLineY = line.y
        } else if (
            lastRow &&
            line.page === lastRow.page &&
            lastLineY - line.y > 0 &&
            lastLineY - line.y <= CONTINUATION_LINE_GAP
        ) {
            // Wrapped text one line below the previous: append to the open row.
            for (const [role, value] of Object.entries(mapped)) {
                lastRow.cells[role] = joinWrapped(lastRow.cells[role], value)
            }
            lastLineY = line.y
        }
    }

    return tables
}

/**
 * Reads a header row into columns, or returns `null` if the line isn't a
 * header. Each cell is tested against every matcher; the first match wins and
 * fixes that column's role and x anchor.
 */
function matchHeader (line: PdfLine, matchers: ColumnMatcher[]): Column[] | null {
    const columns: Column[] = []
    const seenRoles = new Set<string>()

    for (const cell of line.cells) {
        const text = cell.str.trim()
        const matcher = matchers.find((m) => m.match.test(text))
        if (!matcher) return null // a stray non-header cell ⇒ not a header row
        if (seenRoles.has(matcher.role)) continue
        seenRoles.add(matcher.role)
        columns.push({ role: matcher.role, x: cell.x })
    }

    return seenRoles.size >= MIN_HEADER_ROLES ? columns : null
}

/**
 * Assigns a line's fragments to columns by nearest x anchor. Multiple
 * fragments landing in one column (a name split mid-line) are joined in
 * left→right order.
 */
function mapCells (line: PdfLine, columns: Column[]): Record<string, string> {
    const out: Record<string, string> = {}
    for (const cell of line.cells) {
        const column = nearestColumn(cell, columns)
        if (!column) continue
        const value = cell.str.trim()
        if (!value) continue
        out[column.role] = out[column.role] ? `${out[column.role]} ${value}` : value
    }
    return out
}

function nearestColumn (cell: PdfCell, columns: Column[]): Column | null {
    let best: Column | null = null
    let bestDist = Infinity
    for (const column of columns) {
        const dist = Math.abs(cell.x - column.x)
        if (dist < bestDist) {
            bestDist = dist
            best = column
        }
    }
    return best && bestDist <= COLUMN_X_TOLERANCE ? best : null
}

/** Small lowercase words that begin a fresh word when wrapped, not a tail. */
const CONNECTOR_WORD = /^(and|or|to|of|in|on|at|the|a|no|n|with|for)\b/i

/**
 * Appends a wrapped continuation fragment to a column's running text. Text
 * wrapped across lines is normally separate words and joins with a space
 * (`"BBQ Chicken"` + `"and Bacon"`). The exception is a word the wrap split
 * mid-way, glued on with no space — recognised two ways:
 *
 *  - a short lowercase tail that isn't a small connector word
 *    (`"Plant-Bas"` + `"ed"` → `"Plant-Based"`), or
 *  - any lowercase fragment following a stem left dangling on a hyphen
 *    (`"Margheri-t"` + `"astic"` → `"Margheri-tastic"`).
 *
 * A longer lowercase fragment on its own (`"andouille"`, `"online"`) is treated
 * as a fresh word and gets a space, as do capitals, digits and symbols.
 */
function joinWrapped (prev: string | undefined, next: string): string {
    if (!prev) return next
    if (!/^[a-z]/.test(next)) return `${prev} ${next}`

    const firstToken = next.match(/^\S+/)?.[0] ?? next
    const shortTail = firstToken.length <= 3 && !CONNECTOR_WORD.test(next)
    const danglingHyphen = /-\w{1,2}$/.test(prev)
    return shortTail || danglingHyphen ? prev + next : `${prev} ${next}`
}

function isHeading (line: PdfLine, minHeight: number): boolean {
    return line.cells.some((c) => c.height >= minHeight)
}

function lineText (line: PdfLine): string {
    return line.cells.map((c) => c.str.trim()).filter(Boolean).join(' ')
}

/**
 * Picks a heading-height threshold from the document. Body text dominates, so
 * the most common height is the body size; anything ≥ 1.5 points taller is a
 * heading. Falls back to a large value if heights are uniform.
 */
function deriveHeadingMinHeight (lines: PdfLine[]): number {
    const counts = new Map<number, number>()
    for (const line of lines) {
        for (const cell of line.cells) {
            const h = Math.round(cell.height * 2) / 2 // 0.5pt buckets
            counts.set(h, (counts.get(h) ?? 0) + 1)
        }
    }
    let bodyHeight = 0
    let bodyCount = -1
    for (const [height, count] of counts) {
        if (count > bodyCount) {
            bodyCount = count
            bodyHeight = height
        }
    }
    return bodyHeight + 1.5
}
