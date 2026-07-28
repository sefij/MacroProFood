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
 * Two distinct failure modes, handled differently:
 *
 *  - **A recipe ingredient no longer has a PDF row** (Five Guys renamed or
 *    dropped it in a republish) is a scraper bug, not a menu change — this
 *    throws and fails the whole scrape loudly rather than silently shipping
 *    a dish with missing macros.
 *  - **A recipe's dish is no longer listed on Deliveroo** (delisted, renamed)
 *    is an ordinary menu change — that one dish is skipped with a warning,
 *    the rest of the scrape proceeds.
 */

import chalk from 'chalk'
import { RestaurantData, SourceScraper, NutritionData } from '../../types'
import { normalizeCategory } from '../category'
import { addItem } from '../add-item'
import { fetchIngredients, IngredientNutrition } from './ingredients'
import { fetchDeliverooDishes } from './deliveroo'
import { RECIPES, RecipeIngredient } from './recipes'

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

        let ingredients: Map<string, IngredientNutrition>
        let deliverooDishes: Map<string, unknown>
        try {
            ;[ingredients, deliverooDishes] = await Promise.all([fetchIngredients(), fetchDeliverooDishes()])
        } catch (error) {
            console.error(chalk.red(`Error scraping Five Guys: ${error}`))
            return {}
        }

        for (const recipe of RECIPES) {
            if (!deliverooDishes.has(recipe.deliverooName)) {
                delisted++
                console.log(chalk.yellow(`  ⚠ "${recipe.deliverooName}" is no longer listed on Deliveroo — skipped`))
                continue
            }

            const nutrition = buildNutrition(ingredients, recipe.deliverooName, recipe.category, recipe.ingredients)
            const outcome = addItem(items, recipe.deliverooName, nutrition)
            if (outcome.kind === 'duplicate') duplicates++
            else if (outcome.kind === 'renamed') renamed++
        }

        console.log(chalk.green(`✓ Found ${Object.keys(items).length} Five Guys items (PDF + Deliveroo)`))
        if (delisted || duplicates || renamed) {
            console.log(
                chalk.gray(
                    `  skipped ${delisted} (delisted on Deliveroo); ${duplicates} duplicate, ${renamed} requalified`
                )
            )
        }
        return items
    }
}
