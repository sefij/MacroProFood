import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RECIPES } from './recipes'

/**
 * A frozen snapshot of every row `ingredients.ts` parsed from a live PDF pull
 * (June 2026 edition), for offline regression testing only — production code
 * always re-fetches the live PDF (see `ingredients.ts`'s docblock). This
 * exists so a typo'd or renamed ingredient key in `recipes.ts` fails a fast,
 * offline test instead of only surfacing at scrape time.
 */
const REFERENCE_INGREDIENTS: Record<string, { calories: number, protein: number, fat: number, carbs: number }> = {
    'Beef Burger Patty': { calories: 195, protein: 18, fat: 14, carbs: 0 },
    'Burger Bun': { calories: 238, protein: 6.0, fat: 7.5, carbs: 38 },
    'Hot Dog': { calories: 192, protein: 11, fat: 15, carbs: 2.1 },
    'Hot Dog Bun': { calories: 215, protein: 5.3, fat: 6.7, carbs: 34 },
    'Cheese (pasteurised)': { calories: 64, protein: 3.6, fat: 4.9, carbs: 1.1 },
    'Bacon**': { calories: 78, protein: 6.4, fat: 5.5, carbs: 0.7 },
    'Little Fries': { calories: 659, protein: 10, fat: 39, carbs: 70 },
    'Reg Fries': { calories: 1073, protein: 16, fat: 63, carbs: 115 },
    'Large Fries': { calories: 1509, protein: 23, fat: 89, carbs: 162 },
    'Cajun seasoning': { calories: 20, protein: 0.8, fat: 0, carbs: 2.9 },
    Tomatoes: { calories: 6, protein: 0, fat: 0, carbs: 1.3 },
    Pickles: { calories: 3, protein: 0, fat: 0, carbs: 0 },
    'Grilled Onions': { calories: 12, protein: 0, fat: 0, carbs: 2.8 },
    'Green Peppers': { calories: 2, protein: 0, fat: 0, carbs: 0 },
    'Grilled Mushrooms': { calories: 12, protein: 1.0, fat: 0, carbs: 2.0 },
    'Veggie Sandwich': { calories: 330, protein: 10, fat: 7.4, carbs: 52 },
    'Cheese Veggie Sandwich': { calories: 428, protein: 14, fat: 14, carbs: 57 },
    'Grilled Cheese': { calories: 434, protein: 12, fat: 24, carbs: 42 },
    'BLT**': { calories: 652, protein: 22, fat: 41, carbs: 45 },
    'Five Guys Milkshake Base': { calories: 625, protein: 7.8, fat: 33, carbs: 75 },
    'Five Guys Milkshake Base Little': { calories: 313, protein: 3.9, fat: 17, carbs: 37 },
    'Jimmy’s Iced Coffee': { calories: 8, protein: 0.4, fat: 0, carbs: 1.6 },
    'Pistachio***': { calories: 194, protein: 7.8, fat: 17, carbs: 2.1 }
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

test('a multiplier only ever appears where Deliveroo\'s description states an exact quantity (2x patty and 2x cheese on non-Little burgers)', () => {
    for (const recipe of RECIPES) {
        for (const { ingredient, multiplier } of recipe.ingredients) {
            if (multiplier === undefined) continue
            if (ingredient === 'Beef Burger Patty' || ingredient === 'Cheese (pasteurised)') {
                assert.equal(multiplier, 2, `${recipe.deliverooName}: expected 2x ${ingredient}`)
                assert.ok(!recipe.deliverooName.startsWith('Little'), `${recipe.deliverooName}: Little burgers use the 1x default`)
            } else {
                assert.fail(`unexpected multiplier on "${ingredient}" in "${recipe.deliverooName}"`)
            }
        }
    }
})

// Deliveroo's own stated productMeta calories (live pull, June 2026) for every recipe below.
const STATED_KCAL: Record<string, number> = {
    Hamburger: 678,
    Cheeseburger: 811,
    'Bacon Burger': 761,
    'Bacon Cheeseburger': 904,
    'Little Hamburger': 464,
    'Little Cheeseburger': 512,
    'Little Bacon Burger': 537,
    'Little Bacon Cheeseburger': 588,
    'Lettuce Wrap': 246,
    'All Beef Hot Dog': 483,
    'Cheese Dog': 531,
    'Bacon Dog': 574,
    'Bacon Cheese Dog': 606,
    'Veggie Sandwich': 330,
    'Cheese Veggie Sandwich': 428,
    'Grilled Cheese': 434,
    BLT: 652,
    'Little Salted Fries': 659,
    'Regular Salted Fries': 1073,
    'Large Salted Fries': 1509,
    'Regular Cajun Fries': 1093,
    'Large Cajun Fries': 1529,
    'Five Guys Shake': 625,
    'Little Shake': 313,
    'NEW: Jimmy’s Iced Coffee Shake': 633,
    'RETURNING: Pistachio': 194
}

test('fries, shakes and OTHER ITEMS sandwiches reconcile exactly against Deliveroo\'s stated calories', () => {
    const exact = [
        'Veggie Sandwich', 'Cheese Veggie Sandwich', 'Grilled Cheese', 'BLT',
        'Little Salted Fries', 'Regular Salted Fries', 'Large Salted Fries',
        'Regular Cajun Fries', 'Large Cajun Fries',
        'Five Guys Shake', 'Little Shake', 'NEW: Jimmy’s Iced Coffee Shake', 'RETURNING: Pistachio'
    ]
    for (const name of exact) {
        const recipe = RECIPES.find((r) => r.deliverooName === name)
        assert.ok(recipe, `${name} recipe not found`)
        const { calories } = sumMacros(recipe)
        assert.equal(calories, STATED_KCAL[name], `${name}: computed ${calories} vs stated ${STATED_KCAL[name]}`)
    }
})

test('burgers and the from-scratch Lettuce Wrap reconcile within the documented ~8% tolerance', () => {
    const names = [
        'Hamburger', 'Cheeseburger', 'Bacon Burger', 'Bacon Cheeseburger',
        'Little Hamburger', 'Little Cheeseburger', 'Little Bacon Burger', 'Little Bacon Cheeseburger',
        'Lettuce Wrap'
    ]
    for (const name of names) {
        const recipe = RECIPES.find((r) => r.deliverooName === name)
        assert.ok(recipe, `${name} recipe not found`)
        const { calories } = sumMacros(recipe)
        const stated = STATED_KCAL[name]
        const diff = Math.abs(calories - stated) / stated
        assert.ok(diff < 0.09, `${name}: computed ${calories} vs stated ${stated} (${(diff * 100).toFixed(1)}% off)`)
    }
})

test('hot dogs reconcile within the documented, wider ~18% tolerance', () => {
    const names = ['All Beef Hot Dog', 'Cheese Dog', 'Bacon Dog', 'Bacon Cheese Dog']
    for (const name of names) {
        const recipe = RECIPES.find((r) => r.deliverooName === name)
        assert.ok(recipe, `${name} recipe not found`)
        const { calories } = sumMacros(recipe)
        const stated = STATED_KCAL[name]
        const diff = Math.abs(calories - stated) / stated
        assert.ok(diff < 0.19, `${name}: computed ${calories} vs stated ${stated} (${(diff * 100).toFixed(1)}% off)`)
    }
})
