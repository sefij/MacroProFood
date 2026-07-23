/**
 * Abstract, config-driven nutrition scraper for PDF menus.
 *
 * A concrete scraper supplies only a {@link PdfScraperConfig} — the PDF URL,
 * regexes that map header labels to columns, a function that builds an item
 * key from a row, and an optional accept filter. Everything else (fetching the
 * PDF, reconstructing tables, parsing macro numbers, ratio maths, logging) is
 * shared here and flows through the reusable {@link extractPdfLines} /
 * {@link extractTables} pipeline.
 *
 * The base understands these column roles: `name`, `crust`, `size`, `serves`,
 * `calories`, `fat`, `carbs`, `protein` (plus any extra roles the config maps,
 * which are ignored). `calories` anchors data rows, so every config must map a
 * calories column.
 */

import axios from 'axios'
import chalk from 'chalk'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import { parseNumber } from '../parse-number'
import { normalizeCategory } from '../category'
import { addItem, addVariant } from '../add-item'
import { extractPdfLines } from './pdf-lines'
import { ColumnMatcher, FixedColumn, extractTables, TableRow } from './table-grid'

/** A row's raw text cells, keyed by the role each column was matched to. */
export type NutritionRow = TableRow['cells']

/** A base item + one of its selectable variants (spec 10). */
export interface RowVariant {
    /** Base item name, e.g. "Pepperoni". */
    base: string
    /** Selector heading, e.g. "Crust & size". */
    groupLabel: string
    /** This variant's option label, e.g. "Thin & Crispy (Per Whole)". */
    option: string
}

/** A fully parsed item, passed to {@link PdfScraperConfig.accept}. */
export interface ParsedNutritionItem {
    key: string
    title: string
    nutrition: NutritionData
    row: NutritionRow
    /** Set when the config's `variant` mapped this row to a variant of a base item. */
    variant?: RowVariant
}

export interface PdfScraperConfig {
    name: string
    icon: string
    /** Direct URL to the nutrition PDF. */
    url: string
    /**
     * Header-label → column-role matchers, for tables whose header row can be
     * auto-detected. Provide this or {@link fixedColumns}.
     */
    columns?: ColumnMatcher[]
    /**
     * Explicit column x-anchors, for a single fixed-layout table whose header
     * can't be auto-detected. Provide this or {@link columns}.
     */
    fixedColumns?: FixedColumn[]
    /**
     * Several fixed layouts for documents that mix grids (e.g. a menu grid on
     * early pages, an ingredients grid on the last); each line snaps to the
     * grid that maps the most of its cells. Alternative to {@link fixedColumns}.
     */
    fixedGrids?: FixedColumn[][]
    /** Skips matching lines entirely, e.g. a title re-printed on every page. */
    ignoreTitles?: RegExp
    /**
     * Overrides the auto-derived heading-height threshold. Lower it when a
     * document's subsection headings are only slightly taller than body text
     * (the auto threshold favours the document's most common — and usually
     * tallest-clustered — heading style, which can miss a smaller one).
     */
    headingMinHeight?: number
    /** Overrides the default cell→column x-tolerance (lower for tight columns). */
    columnXTolerance?: number
    /** Overrides the wrapped-cell merge gap; set 0 for tables whose names never wrap. */
    continuationLineGap?: number
    /** Overrides the baseline gap for clustering fragments into a line (lower for tight rows). */
    lineYTolerance?: number
    /**
     * Builds the item key (map key in {@link RestaurantData}) from a row's text
     * cells and its table's section title. Return `null`/empty to drop the row.
     * Compose in any distinguishing columns (e.g. crust, size) — and, where the
     * distinguishing detail lives only in the section title (e.g. per-slice vs
     * per-whole), pull it from `category` — so variants don't collide.
     */
    buildKey: (row: NutritionRow, category: string) => string | null
    /**
     * Optional (spec 10): maps a row to a variant of a base item, so sizes/
     * crusts become one item with a selector instead of separate rows. Return
     * `null` to fall back to {@link buildKey} (a plain item). When it returns a
     * {@link RowVariant}, the row is stored via `addVariant` and `buildKey` is
     * not consulted for it.
     */
    variant?: (row: NutritionRow, category: string) => RowVariant | null
    /**
     * Maps a table's raw section title to a display category. Defaults to the
     * title as-is (still run through {@link normalizeCategory}); override when
     * the title carries boilerplate the key logic already strips for other
     * purposes (e.g. Domino's "Domino's Pizza Nutrition – X (Per Whole)").
     */
    category?: (title: string) => string | undefined
    /** Optional final filter, e.g. drop drinks or implausible macros. */
    accept?: (item: ParsedNutritionItem) => boolean
    /** HTTP timeout for the PDF download. Defaults to 30s. */
    timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30000

const REQUEST_HEADERS = {
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    Accept: 'application/pdf,*/*'
}

export abstract class PdfNutritionScraper extends SourceScraper {
    protected abstract config: PdfScraperConfig

    // No browser needed — pure HTTP download + PDF parsing.
    async initialize (): Promise<void> { }

    async scrape (): Promise<RestaurantData> {
        const { name, icon } = this.config
        console.log(chalk.blue(`${icon} Scraping ${name} (PDF)…`))

        let tables
        try {
            const pdf = await this.download()
            const lines = await extractPdfLines(pdf, this.config.lineYTolerance)
            tables = extractTables(lines, {
                columns: this.config.columns,
                fixedColumns: this.config.fixedColumns,
                fixedGrids: this.config.fixedGrids,
                ignoreTitles: this.config.ignoreTitles,
                headingMinHeight: this.config.headingMinHeight,
                columnXTolerance: this.config.columnXTolerance,
                continuationLineGap: this.config.continuationLineGap
            })
        } catch (error) {
            // Isolate failures (dead URL, unreadable PDF) so one bad scraper
            // doesn't sink the others running alongside it in scrapeAll().
            console.error(chalk.red(`Error scraping ${name}: ${error}`))
            return {}
        }

        const items: RestaurantData = {}
        let invalid = 0
        let rejected = 0
        let duplicates = 0
        let renamed = 0
        for (const table of tables) {
            for (const row of table.rows) {
                const built = this.buildItem(table.title, row.cells)
                if (built === 'invalid') {
                    invalid++
                } else if (built === 'rejected') {
                    rejected++
                } else {
                    const outcome = built.variant
                        ? addVariant(
                            items,
                            built.variant.base,
                            built.variant.groupLabel,
                            built.variant.option,
                            built.nutrition
                        )
                        : addItem(items, built.key, built.nutrition)
                    if (outcome.kind === 'duplicate') duplicates++
                    else if (outcome.kind === 'renamed') renamed++
                }
            }
        }

        console.log(chalk.green(`✓ Found ${Object.keys(items).length} ${name} items (PDF)`))
        if (invalid > 0 || rejected > 0 || duplicates > 0 || renamed > 0) {
            console.log(
                chalk.gray(
                    `  skipped ${invalid} (no key / unparseable macros), ${rejected} (filtered out), ` +
                    `${duplicates} (duplicate name, same macros); ${renamed} name collisions requalified`
                )
            )
        }
        return items
    }

    private async download (): Promise<Uint8Array> {
        const response = await axios.get<ArrayBuffer>(this.config.url, {
            headers: REQUEST_HEADERS,
            timeout: this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            responseType: 'arraybuffer'
        })
        return new Uint8Array(response.data)
    }

    /** Turns one table row into an item, or flags why it was dropped. */
    private buildItem (
        title: string,
        row: NutritionRow
    ): ParsedNutritionItem | 'invalid' | 'rejected' {
        // A variant maps to a base + option (stored via addVariant); otherwise
        // fall back to a plain key. Either way something must identify the row.
        const variant = this.config.variant?.(row, title) ?? undefined
        const key = variant
            ? `${variant.base} (${variant.option})`
            : this.config.buildKey(row, title)?.trim()
        if (!key) return 'invalid'

        const calories = parseNumber(row.calories)
        const protein = parseNumber(row.protein)
        const fat = parseNumber(row.fat)
        const carbs = parseNumber(row.carbs)
        if (!Number.isFinite(calories) || calories <= 0) return 'invalid'

        const p = Number.isFinite(protein) ? protein : 0
        const rawCategory = this.config.category ? this.config.category(title) : title
        const nutrition: NutritionData = {
            calories,
            protein: p,
            fat: Number.isFinite(fat) ? fat : 0,
            carbs: Number.isFinite(carbs) ? carbs : 0,
            ProteinTCalRatio: p / calories,
            CarbToCalRatio: (Number.isFinite(carbs) ? carbs : 0) / calories,
            category: normalizeCategory(rawCategory)
        }

        const item: ParsedNutritionItem = { key, title, nutrition, row, variant }
        if (this.config.accept && !this.config.accept(item)) return 'rejected'
        return item
    }
}
