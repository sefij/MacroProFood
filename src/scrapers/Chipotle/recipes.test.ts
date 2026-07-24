import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RECIPES } from './recipes'

/**
 * A frozen snapshot of every row `ingredients.ts` parsed from a live PDF pull
 * (January 2026 edition), for offline regression testing only — production
 * code always re-fetches the live PDF (see `ingredients.ts`'s docblock on why
 * this project avoids stale hardcoded snapshots). This exists so a typo'd or
 * renamed ingredient key in `recipes.ts` fails a fast, offline test instead of
 * only surfacing at scrape time.
 */
const REFERENCE_INGREDIENTS: Record<string, { calories: number, protein: number, fat: number, carbs: number }> = {
    'Flour Tortilla (Burrito)': { calories: 297, protein: 7.9, fat: 8.8, carbs: 49.2 },
    'Flour Tortilla (Taco)': { calories: 240, protein: 6, fat: 7.5, carbs: 39 },
    'Hard Shell Taco (Crispy Corn Taco)': { calories: 177, protein: 2, fat: 9.2, carbs: 23 },
    'Coriander-Lime White Rice': { calories: 185, protein: 4.1, fat: 2, carbs: 41.5 },
    'Coriander-Lime Brown Rice': { calories: 185, protein: 3.8, fat: 1.7, carbs: 32.8 },
    'Black Beans': { calories: 95, protein: 7.2, fat: 2.4, carbs: 4.9 },
    'Pinto Beans': { calories: 95, protein: 6.7, fat: 0.6, carbs: 6.2 },
    'Fajita Vegetables': { calories: 21, protein: 0.4, fat: 1.1, carbs: 2.1 },
    Barbacoa: { calories: 154, protein: 29.7, fat: 3.8, carbs: 1 },
    Chicken: { calories: 185, protein: 27.3, fat: 8.4, carbs: 1 },
    Carnitas: { calories: 210, protein: 25.8, fat: 11.9, carbs: 1 },
    Steak: { calories: 165, protein: 28.8, fat: 5.5, carbs: 1 },
    'Sofritas (braised tofu)': { calories: 84, protein: 7, fat: 4.6, carbs: 3 },
    'Fresh Tomato Salsa': { calories: 15, protein: 0.8, fat: 0.5, carbs: 1.1 },
    'Chilli-Corn Salsa': { calories: 38, protein: 1.3, fat: 0.8, carbs: 5.9 },
    'Roasted Tomato Green-Chilli Salsa': { calories: 6, protein: 0.3, fat: 0.1, carbs: 1 },
    'Roasted Tomato Red-Chilli Salsa': { calories: 9, protein: 0.3, fat: 0.3, carbs: 1.4 },
    'Monterey Jack Cheese': { calories: 94, protein: 5.8, fat: 7.8, carbs: 0.1 },
    'Sour Cream': { calories: 45, protein: 0.9, fat: 3.9, carbs: 1.4 },
    'Guacamole (topping/side)': { calories: 145, protein: 1.5, fat: 13.5, carbs: 2.8 },
    'Guacamole (large)': { calories: 290, protein: 3, fat: 27, carbs: 5.6 },
    'Romaine Lettuce (salad/topping)': { calories: 15, protein: 0, fat: 0, carbs: 0 },
    'Chips (regular)': { calories: 417, protein: 4.6, fat: 21.6, carbs: 54.1 },
    'Chips (large)': { calories: 627, protein: 6.9, fat: 32.5, carbs: 81 },
    'Chips (Kids)': { calories: 148, protein: 1.6, fat: 7.6, carbs: 19.2 },
    'Chipotle Honey Vinaigrette': { calories: 259, protein: 0.2, fat: 22.9, carbs: 13.1 },
    'Super Greens': { calories: 15, protein: 1.2, fat: 0.3, carbs: 2.9 },
    'Chicken Al Pastor (LTO)': { calories: 207, protein: 22.6, fat: 9.7, carbs: 7 },
    'Chipotle Honey Chicken (LTO)': { calories: 165, protein: 15.9, fat: 9.3, carbs: 4.2 }
}

// protein/carbs ≈ 4 kcal/g, fat ≈ 9 kcal/g; a summed recipe shouldn't wildly
// exceed its own calorie total once rounding across several rows stacks up.
const MACRO_CALORIE_TOLERANCE = 1.15

function sumMacros (recipe: (typeof RECIPES)[number]) {
    let calories = 0
    let protein = 0
    let fat = 0
    let carbs = 0
    for (const { ingredient, multiplier = 1 } of recipe.ingredients) {
        const macros = REFERENCE_INGREDIENTS[ingredient]
        assert.ok(macros, `recipe "${recipe.deliverooName}" references unknown ingredient "${ingredient}"`)
        calories += macros.calories * multiplier
        protein += macros.protein * multiplier
        fat += macros.fat * multiplier
        carbs += macros.carbs * multiplier
    }
    return { calories, protein, fat, carbs }
}

test('every recipe has a name, category and at least one ingredient', () => {
    for (const recipe of RECIPES) {
        assert.ok(recipe.deliverooName.trim().length > 0)
        assert.ok(recipe.category.trim().length > 0)
        assert.ok(recipe.ingredients.length > 0, `"${recipe.deliverooName}" has no ingredients`)
    }
})

test('every recipe references an ingredient that exists in the PDF table', () => {
    for (const recipe of RECIPES) sumMacros(recipe)
})

test('no two recipes share a Deliveroo dish name', () => {
    const names = RECIPES.map((r) => r.deliverooName)
    assert.equal(new Set(names).size, names.length)
})

test('every recipe sums to plausible, positive macros', () => {
    for (const recipe of RECIPES) {
        const { calories, protein, fat, carbs } = sumMacros(recipe)
        assert.ok(calories > 0, `"${recipe.deliverooName}" summed to zero calories`)
        const cap = calories * MACRO_CALORIE_TOLERANCE
        assert.ok(protein * 4 <= cap, `"${recipe.deliverooName}" protein energy exceeds its calorie total`)
        assert.ok(carbs * 4 <= cap, `"${recipe.deliverooName}" carb energy exceeds its calorie total`)
        assert.ok(fat * 9 <= cap, `"${recipe.deliverooName}" fat energy exceeds its calorie total`)
    }
})

test('High Protein Cup Chicken reconciles against Deliveroo\'s own stated 27g protein', () => {
    const recipe = RECIPES.find((r) => r.deliverooName === 'High Protein Cup Chicken')
    assert.ok(recipe, 'High Protein Cup Chicken recipe not found')
    const { protein } = sumMacros(recipe)
    assert.ok(Math.abs(protein - 27) < 1, `expected ~27g protein, computed ${protein}g`)
})

test('a multiplier only ever appears where the Deliveroo description states an exact quantity', () => {
    // "Go Half Veggie Bowl" states an explicit fraction ("½ Chicken, ½
    // Sofritas"); "Double High Protein Bowl" and "Double Protein Burrito"
    // state an explicit "Double" on the chicken. Everywhere else, an
    // unqualified ingredient means the full 1x standard PDF serving.
    const expectedMultipliers: Record<string, number> = {
        'Go Half Veggie Bowl': 0.5,
        'Double High Protein Bowl': 2,
        'Double Protein Burrito': 2
    }
    for (const recipe of RECIPES) {
        for (const { ingredient, multiplier } of recipe.ingredients) {
            if (multiplier === undefined) continue
            const expected = expectedMultipliers[recipe.deliverooName]
            assert.ok(expected !== undefined, `unexpected multiplier on "${ingredient}" in "${recipe.deliverooName}"`)
            assert.equal(multiplier, expected)
        }
    }
})

test('Double High Protein Bowl and Double Protein Burrito reconcile within normal scoop variance', () => {
    // Both advertise a headline protein figure; summing every listed
    // ingredient (not just the obviously protein-heavy ones) should land
    // within ~15% of it — the mis-check that originally excluded these two
    // only summed Chicken + Cheese and missed rice/beans/veg/salsa/tortilla.
    const cases: Array<[string, number]> = [
        ['Double High Protein Bowl', 81],
        ['Double Protein Burrito', 79]
    ]
    for (const [name, statedProtein] of cases) {
        const recipe = RECIPES.find((r) => r.deliverooName === name)
        assert.ok(recipe, `${name} recipe not found`)
        const { protein } = sumMacros(recipe)
        const diff = Math.abs(protein - statedProtein) / statedProtein
        assert.ok(diff < 0.15, `${name}: computed ${protein}g vs stated ${statedProtein}g (${(diff * 100).toFixed(0)}% off)`)
    }
})
