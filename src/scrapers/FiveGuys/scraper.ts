/**
 * Five Guys UK — composed from two sources (see spec 11; same approach as
 * ../Chipotle/scraper.ts).
 *
 * Five Guys' core burgers and hot dogs have no published per-dish nutrition:
 * the brand publishes a per-*ingredient* nutrition PDF
 * ({@link ../FiveGuys/ingredients.ts}) and nothing else for them, because
 * they're built from a handful of shared components. Deliveroo's own listing
 * ({@link ../FiveGuys/deliveroo.ts}) shows what's actually orderable — named,
 * fixed-recipe dishes. This scraper composes each dish in the hand-verified
 * recipe table ({@link ../FiveGuys/recipes.ts}) by summing its ingredients'
 * live PDF macros — so composition is fixed (reviewed by a human), but the
 * macros themselves are refreshed from Five Guys' PDF on every run, not a
 * stale snapshot.
 *
 * Deliveroo's own stated calories for the finished dish (`productMeta`, e.g.
 * "678 kcal" — see deliveroo.ts) are then reconciled against that sum:
 *
 *  - **Within {@link RECONCILIATION_WARNING_THRESHOLD} of the sum** — the
 *    normal case (`recipes.ts`'s docblock documents every current recipe's
 *    gap: fries/shakes/OTHER ITEMS sandwiches exact, burgers ~3-8%, hot dogs
 *    ~12-18%, all comfortably under the threshold) — {@link anchorToStatedCalories}
 *    rescales calories to Deliveroo's exact figure and scales protein/fat/carbs
 *    by the same ratio, so the shipped numbers stay internally consistent
 *    (Atwater still adds up) while matching what Deliveroo shows for the
 *    actual finished dish, not just a sum of separately-published ingredient
 *    servings. There's no PDF row this project can point to for *why* the raw
 *    sum runs short (checked — no separate spread/butter/oil ingredient
 *    exists for burgers or hot dogs anywhere in the document), so this
 *    project treats Deliveroo's total as the more trustworthy figure for the
 *    finished dish once the two are already close.
 *  - **Beyond the threshold** — not seen in the current table, but this is
 *    the case a recipe edit that drops or mistypes an ingredient, or Five
 *    Guys quietly changing a dish's composition, would produce — is logged as
 *    a warning and left **unscaled**. A gap this large is more likely a real
 *    bug than normal variance, and blindly anchoring it would silently paper
 *    over broken protein/fat/carbs (scaling a badly-wrong sum just makes a
 *    proportionally-wrong result) instead of surfacing it for a human to fix.
 *
 * A separate, harder failure mode: **a recipe ingredient no longer has a PDF
 * row at all** (Five Guys renamed or dropped it in a republish) is a scraper
 * bug, not a menu change — `buildNutrition` throws and fails the whole scrape
 * loudly rather than silently shipping a dish with missing macros. And **a
 * recipe's dish no longer listed on Deliveroo** (delisted, renamed) is an
 * ordinary menu change — that one dish is skipped with a warning, the rest of
 * the scrape proceeds.
 */

import chalk from 'chalk'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import { normalizeCategory } from '../category'
import { addItem } from '../add-item'
import { fetchIngredients, IngredientNutrition } from './ingredients'
import { fetchDeliverooDishes, DeliverooDish } from './deliveroo'
import { RECIPES, RecipeIngredient } from './recipes'

/** See the class docblock's third bullet on why this sits above every currently-documented recipe gap (~18% worst case, hot dogs). */
export const RECONCILIATION_WARNING_THRESHOLD = 0.2

/** How far `calories` sits from Deliveroo's stated `energyKcal` for the same dish, as a fraction (0.1 = 10% off) — `undefined` when Deliveroo didn't publish a figure to check against. */
export function reconciliationGap (calories: number, energyKcal: number | undefined): number | undefined {
    if (energyKcal === undefined || energyKcal <= 0) return undefined
    return Math.abs(calories - energyKcal) / energyKcal
}

/**
 * Rescales `nutrition` so its calories match `energyKcal` exactly, scaling
 * protein/fat/carbs by the same ratio to keep the four numbers proportionally
 * consistent (Atwater still adds back up). Only meaningful — and only called
 * — when `reconciliationGap` is within {@link RECONCILIATION_WARNING_THRESHOLD};
 * see the class docblock on why a larger gap is left unscaled instead.
 */
export function anchorToStatedCalories (nutrition: NutritionData, energyKcal: number): NutritionData {
    const ratio = energyKcal / nutrition.calories
    const protein = nutrition.protein * ratio
    const fat = nutrition.fat * ratio
    const carbs = nutrition.carbs * ratio
    return {
        ...nutrition,
        calories: energyKcal,
        protein,
        fat,
        carbs,
        ProteinTCalRatio: protein / energyKcal,
        CarbToCalRatio: carbs / energyKcal
    }
}

function buildNutrition (
    ingredients: Map<string, IngredientNutrition>,
    recipeName: string,
    category: string,
    recipeIngredients: RecipeIngredient[]
): NutritionData {
    let calories = 0
    let protein = 0
    let fat = 0
    let carbs = 0

    for (const { ingredient, multiplier = 1 } of recipeIngredients) {
        const macros = ingredients.get(ingredient)
        if (!macros) {
            throw new Error(
                `Five Guys: recipe "${recipeName}" references ingredient "${ingredient}", ` +
                'which is no longer in the parsed PDF table (renamed or removed upstream?)'
            )
        }
        calories += macros.calories * multiplier
        protein += macros.protein * multiplier
        fat += macros.fat * multiplier
        carbs += macros.carbs * multiplier
    }

    return {
        calories,
        protein,
        fat,
        carbs,
        ProteinTCalRatio: calories > 0 ? protein / calories : 0,
        CarbToCalRatio: calories > 0 ? carbs / calories : 0,
        category: normalizeCategory(category)
    }
}

export class FiveGuysScraper extends SourceScraper {
    name = 'FiveGuys'
    icon = '🌭'

    // No browser needed — pure HTTP downloads (PDF + Deliveroo HTML).
    async initialize (): Promise<void> {}

    async scrape (): Promise<RestaurantData> {
        console.log(chalk.blue(`${this.icon} Scraping Five Guys UK (PDF ingredients + Deliveroo dishes)…`))

        const items: RestaurantData = {}
        let delisted = 0
        let duplicates = 0
        let renamed = 0
        let flagged = 0
        let anchored = 0

        let ingredients: Map<string, IngredientNutrition>
        let deliverooDishes: Map<string, DeliverooDish>
        try {
            ;[ingredients, deliverooDishes] = await Promise.all([fetchIngredients(), fetchDeliverooDishes()])
        } catch (error) {
            console.error(chalk.red(`Error scraping Five Guys: ${error}`))
            return {}
        }

        for (const recipe of RECIPES) {
            const dish = deliverooDishes.get(recipe.deliverooName)
            if (!dish) {
                delisted++
                console.log(chalk.yellow(`  ⚠ "${recipe.deliverooName}" is no longer listed on Deliveroo — skipped`))
                continue
            }

            let nutrition = buildNutrition(ingredients, recipe.deliverooName, recipe.category, recipe.ingredients)

            const energyKcal = dish.energyKcal
            const gap = reconciliationGap(nutrition.calories, energyKcal)
            if (gap !== undefined && energyKcal !== undefined) {
                if (gap > RECONCILIATION_WARNING_THRESHOLD) {
                    flagged++
                    console.log(
                        chalk.yellow(
                            `  ⚠ "${recipe.deliverooName}" computed ${Math.round(nutrition.calories)} kcal vs Deliveroo's ` +
                            `stated ${energyKcal} kcal (${(gap * 100).toFixed(0)}% off) — check the recipe for a ` +
                            'missing or wrong ingredient (left unscaled)'
                        )
                    )
                } else {
                    nutrition = anchorToStatedCalories(nutrition, energyKcal)
                    anchored++
                }
            }

            const outcome = addItem(items, recipe.deliverooName, nutrition)
            if (outcome.kind === 'duplicate') duplicates++
            else if (outcome.kind === 'renamed') renamed++
        }

        console.log(chalk.green(`✓ Found ${Object.keys(items).length} Five Guys items (PDF + Deliveroo)`))
        if (delisted || duplicates || renamed || flagged || anchored) {
            console.log(
                chalk.gray(
                    `  skipped ${delisted} (delisted on Deliveroo); ${duplicates} duplicate, ${renamed} requalified, ` +
                    `${anchored} anchored to Deliveroo's stated calories, ${flagged} flagged for calorie mismatch`
                )
            )
        }
        return items
    }
}
