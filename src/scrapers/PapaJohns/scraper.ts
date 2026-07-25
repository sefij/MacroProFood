import chalk from 'chalk'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import { normalizeCategory } from '../category'
import { addItem, addVariant } from '../add-item'
import nutrition from './nutrition.json'

/**
 * Papa John's UK — the only restaurant here served from a committed data file
 * rather than a live scrape. Both reasons are set out in ./README.md; briefly:
 *
 *  - **The source can't be fetched from a server.** papajohns.co.uk is behind
 *    Akamai and geo-fenced to the UK, so a datacenter IP (including the GitHub
 *    runner that drives the weekly refresh) gets `403 Access Denied` — even
 *    through a real headless browser. The PDF is captured by hand instead.
 *  - **The PDF has no text.** Its tables are images: 162 text fragments across
 *    64 pages, all of them the page footer. So `src/scrapers/pdf/` — which reads
 *    Domino's, Wendy's, Subway and Pizza Hut — cannot read this document at all.
 *
 * Recovering the numbers therefore means rendering pages and OCR'ing cells,
 * which takes minutes per page. That can't happen at scrape time, so it happens
 * offline in `tools/papajohns/extract.mjs`, whose output is the
 * `nutrition.json` imported here. This scraper is the cheap half: it shapes
 * already-validated numbers into menu items.
 *
 * **Every figure in that file passed two independent checks** the source table
 * asserts — `per100g_kcal x weight / 100 == totalKcal` and Atwater
 * `4P + 4C + 9F == per100g_kcal`. Rows that failed were dropped, not guessed,
 * and are listed under `rejected` in the file. See the README for why that
 * matters: OCR reliably drops a leading digit, and an unvalidated macro would
 * ship silently wrong.
 *
 * Sizes and crusts become **variants** of one product (`addVariant`, spec 10),
 * so the app shows a single "All The Meats" with a selector rather than eleven
 * near-identical rows — the same treatment Pizza Hut's sizes get. Papadias,
 * sides and desserts have no size choice — a genuine one-row product goes in
 * via `addItem` instead, so the app doesn't show a "Size & Crust" picker with
 * a single "Standard" option, the same split Pizza Hut's scraper makes between
 * its pizza sizes and its single-row sides.
 *
 * Macros are for the **whole product**, matching Pizza Hut: you order a pizza,
 * not a slice. `calories` is the total printed in the PDF; protein/fat/carbs are
 * the per-100g column scaled by the printed total product weight.
 *
 * "Recently Delisted" items (their own category in the source PDF — kept there
 * for allergen/nutrition compliance on discontinued products, per the page's
 * own footer) are dropped entirely: they can't actually be ordered, so
 * including them would let the optimizer recommend something off the real
 * menu. The extract keeps them for provenance; the scraper doesn't emit them.
 */

/** Shape of the committed extract — see tools/papajohns/extract.mjs. */
interface ExtractVariant {
    label: string
    calories: number
    protein: number
    fat: number
    carbs: number
    weightG: number
    slices?: number
    repaired?: string[]
}

interface ExtractItem {
    name: string
    category: string
    page: number
    variants: ExtractVariant[]
}

/**
 * Guards against a nonsensical row reaching the optimizer. The extract is
 * already validated, so anything caught here means the file itself is wrong
 * (a bad hand-edit, or a regenerated extract with a new fault) — worth
 * refusing loudly rather than serving as food data.
 */
const MAX_PLAUSIBLE_CALORIES = 6000

function isPlausible (v: ExtractVariant): boolean {
    const macros = [v.calories, v.protein, v.fat, v.carbs]
    if (macros.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) return false
    if (v.calories <= 0 || v.calories > MAX_PLAUSIBLE_CALORIES) return false
    // A whole pizza is heavy, but not unlimited.
    return !(v.weightG != null && (v.weightG <= 0 || v.weightG > 3000))
}

export class PapaJohnsScraper extends SourceScraper {
    name = 'Papa Johns'
    icon = '🍕'

    /**
     * No browser needed: the data is a local file. Overriding this keeps the
     * shared runner from launching Chromium for nothing.
     */
    async initialize (): Promise<void> {
        // Intentionally empty — see above.
    }

    async scrape (): Promise<RestaurantData> {
        console.log(chalk.blue(`${this.icon} Loading Papa Johns UK (committed PDF extract)…`))

        const items: RestaurantData = {}
        const source = nutrition as unknown as {
            source?: { version?: string; extractedAt?: string }
            items: ExtractItem[]
            rejected?: unknown[]
        }

        let variants = 0
        let implausible = 0
        let duplicates = 0
        let delistedProducts = 0
        let productsEmitted = 0

        for (const item of source.items ?? []) {
            if (/recently delisted/i.test(item.category)) {
                delistedProducts++
                continue
            }
            const category = normalizeCategory(item.category)
            const plausible = (item.variants ?? []).filter((v) => {
                if (isPlausible(v)) return true
                implausible++
                return false
            })
            if (plausible.length === 0) continue
            productsEmitted++

            for (const v of plausible) {
                const built: NutritionData = {
                    calories: v.calories,
                    protein: v.protein,
                    fat: v.fat,
                    carbs: v.carbs,
                    ProteinTCalRatio: v.protein / v.calories || 1,
                    CarbToCalRatio: v.carbs / v.calories || 1,
                    ...(category ? { category } : {})
                }
                // A single-row product (a Papadia, a side, a dessert) has no
                // real size/crust choice — add it as itself rather than a
                // one-option "Size & Crust" variant group.
                const outcome = plausible.length > 1
                    ? addVariant(items, item.name, 'Size & Crust', v.label, built)
                    : addItem(items, item.name, built)
                if (outcome.kind === 'duplicate') duplicates++
                else variants++
            }
        }

        const rejected = source.rejected?.length ?? 0
        console.log(
            chalk.green(
                `${this.icon} Papa Johns: ${variants} variants across ${productsEmitted} products ` +
                `(extract ${source.source?.version ?? 'unknown'})`
            )
        )
        if (duplicates || implausible || rejected || delistedProducts) {
            console.log(
                chalk.gray(
                    `   ↳ ${duplicates} duplicates, ${implausible} implausible, ` +
                    `${rejected} rows rejected during extraction, ` +
                    `${delistedProducts} delisted products excluded (see nutrition.json)`
                )
            )
        }

        return items
    }
}
