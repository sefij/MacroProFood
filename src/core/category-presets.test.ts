import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORY_PRESETS, matchingCategories, isPresetActive, togglePreset } from './category-presets'
import { RestaurantCategoryFilter } from './category-filter'

const SIDES = CATEGORY_PRESETS.find((p) => p.key === 'sides')!
const DRINKS = CATEGORY_PRESETS.find((p) => p.key === 'drinks')!
const DESSERTS = CATEGORY_PRESETS.find((p) => p.key === 'desserts')!
const BREAKFAST = CATEGORY_PRESETS.find((p) => p.key === 'breakfast')!

test('matchingCategories catches real category-name variants seen across restaurants (July 2026 data)', () => {
    assert.deepEqual(
        matchingCategories(['Fries & Sides', 'Sourdough Sides', 'Burgers'], SIDES),
        ['Fries & Sides', 'Sourdough Sides']
    )
    // Five Guys' and Wingstop's fries categories are standalone ("Fries",
    // "Sweet Potato Fries", "Loaded Fries") — none contain "side" at all.
    assert.deepEqual(
        matchingCategories(['Fries', 'Sweet Potato Fries', 'Loaded Fries', 'Burgers'], SIDES),
        ['Fries', 'Sweet Potato Fries', 'Loaded Fries']
    )
    assert.deepEqual(
        matchingCategories(['Drinks & Coffee', 'Cold Drinks', 'Beverages', 'Burgers'], DRINKS),
        ['Drinks & Coffee', 'Cold Drinks', 'Beverages']
    )
    assert.deepEqual(
        matchingCategories(['Krushems & Desserts', 'Sweet Treats', 'Churros', 'Cookies', 'Burgers'], DESSERTS),
        ['Krushems & Desserts', 'Sweet Treats', 'Churros', 'Cookies']
    )
})

test('sides preset also catches dips/sauces/condiments — the "fries & extras" bucket, not just literal sides', () => {
    assert.deepEqual(
        matchingCategories(
            ['Dips', 'New 40g Dips', "Dips & Extras", 'Sauces', 'Sauces & Condiments', 'Ingredients/Condiments', 'Burgers'],
            SIDES
        ),
        ['Dips', 'New 40g Dips', 'Dips & Extras', 'Sauces', 'Sauces & Condiments', 'Ingredients/Condiments']
    )
    // KFC's "Sides & Dips" already matched on 'side' alone before dip/sauce/
    // condiment were added — confirm it's still just one match, not double-counted.
    assert.deepEqual(matchingCategories(['Sides & Dips'], SIDES), ['Sides & Dips'])
})

test("sides preset catches Domino's \"Chick 'N' Dip\"/\"Chick 'N' Dip Combos\" via their own literal phrase, not the broad 'dips' keyword", () => {
    // Confirmed with the user: at Domino's, chicken tenders/wings/boneless
    // bites (and their meal combos) are ordered as a side alongside pizza,
    // the same role as garlic bread or wedges — so both should be excluded.
    assert.deepEqual(
        matchingCategories(["Chick 'N' Dip", "Chick 'N' Dip Combos", 'Dips'], SIDES),
        ["Chick 'N' Dip", "Chick 'N' Dip Combos", 'Dips']
    )
})

test("the \"chick 'n' dip\" phrase doesn't spill over into other restaurants' real chicken-main categories", () => {
    assert.deepEqual(matchingCategories(['Just Chicken', 'Chicken', 'Crispy & Tender Chicken'], SIDES), [])
})

test('Slim Chickens\' "Dipping Sauces" still matches — not via \'dips\' (singular "Dipping"), but via \'sauce\'', () => {
    assert.deepEqual(matchingCategories(['Dipping Sauces'], SIDES), ['Dipping Sauces'])
})

test("sides preset catches Wagamama's/Nando's bare \"Extras\" categories via 'extra'", () => {
    assert.deepEqual(
        matchingCategories(['Extras', 'Dips & Extras', 'Burgers'], SIDES),
        ['Extras', 'Dips & Extras']
    )
})

test("sides preset catches Subway's \"Toppings\" via an exact match, not a substring", () => {
    assert.deepEqual(matchingCategories(['Toppings'], SIDES), ['Toppings'])
})

test("the exact 'toppings' match doesn't false-positive on Wendy's \"Salads Includes Toppings & Dressings\" (a salad category)", () => {
    assert.deepEqual(matchingCategories(['Salads Includes Toppings & Dressings'], SIDES), [])
})

test("desserts preset doesn't false-positive on Wingstop's 'Sweet Potato Fries' (a side, not a dessert)", () => {
    assert.deepEqual(matchingCategories(['Sweet Potato Fries', 'Sides'], DESSERTS), [])
})

test('breakfast preset catches real category-name variants (plain "Breakfast" and Nando\'s "Breakfast Rolls")', () => {
    assert.deepEqual(
        matchingCategories(['Breakfast', 'Breakfast Rolls', 'Burgers'], BREAKFAST),
        ['Breakfast', 'Breakfast Rolls']
    )
})

test("'shake' is caught by both drinks and desserts — confirmed with the user as genuinely either", () => {
    const shakes = ['Shakes', 'Milkshakes', 'Handspun Shakes', 'Burgers']
    assert.deepEqual(matchingCategories(shakes, DRINKS), ['Shakes', 'Milkshakes', 'Handspun Shakes'])
    assert.deepEqual(matchingCategories(shakes, DESSERTS), ['Shakes', 'Milkshakes', 'Handspun Shakes'])
})

test('genuinely ambiguous categories (proper-noun desserts) are left unmatched by every preset', () => {
    const ambiguous = ['Frosty®']
    for (const preset of CATEGORY_PRESETS) {
        assert.deepEqual(matchingCategories(ambiguous, preset), [], `"${preset.label}" unexpectedly matched something in ${ambiguous}`)
    }
})

test('isPresetActive is false when nothing in scope matches the preset at all', () => {
    const groups = [{ restaurant: 'Chipotle', categories: ['Bowl', 'Burrito', 'Quesadilla'] }]
    assert.equal(isPresetActive(groups, {}, SIDES), false)
})

test('isPresetActive is false until every matching category, in every group, is excluded', () => {
    const groups = [
        { restaurant: 'KFC', categories: ['Sides & Dips', 'Burgers'] },
        { restaurant: "McDonald's", categories: ['Fries & Sides', 'Burgers'] }
    ]
    // Only one of the two restaurants has it excluded so far.
    const partial: Record<string, RestaurantCategoryFilter> = {
        KFC: { mode: 'exclude', categories: ['Sides & Dips'] }
    }
    assert.equal(isPresetActive(groups, partial, SIDES), false)

    const full: Record<string, RestaurantCategoryFilter> = {
        KFC: { mode: 'exclude', categories: ['Sides & Dips'] },
        "McDonald's": { mode: 'exclude', categories: ['Fries & Sides'] }
    }
    assert.equal(isPresetActive(groups, full, SIDES), true)
})

test('togglePreset activates by merging matched categories into any existing exclusions', () => {
    const groups = [{ restaurant: 'KFC', categories: ['Sides & Dips', 'Krushems & Desserts', 'Burgers'] }]
    const filters: Record<string, RestaurantCategoryFilter> = {
        KFC: { mode: 'exclude', categories: ['Krushems & Desserts'] } // user already excluded desserts by hand
    }
    const next = togglePreset(groups, filters, SIDES)
    assert.deepEqual(next.KFC, { mode: 'exclude', categories: ['Krushems & Desserts', 'Sides & Dips'] })
})

test('togglePreset deactivates by removing only its own matched categories, keeping the rest', () => {
    const groups = [{ restaurant: 'KFC', categories: ['Sides & Dips', 'Krushems & Desserts', 'Burgers'] }]
    const filters: Record<string, RestaurantCategoryFilter> = {
        KFC: { mode: 'exclude', categories: ['Krushems & Desserts', 'Sides & Dips'] }
    }
    const next = togglePreset(groups, filters, SIDES)
    assert.deepEqual(next.KFC, { mode: 'exclude', categories: ['Krushems & Desserts'] })
})

test('togglePreset deactivating down to zero remaining exclusions resets that restaurant to mode: all', () => {
    const groups = [{ restaurant: 'KFC', categories: ['Sides & Dips', 'Burgers'] }]
    const filters: Record<string, RestaurantCategoryFilter> = {
        KFC: { mode: 'exclude', categories: ['Sides & Dips'] }
    }
    const next = togglePreset(groups, filters, SIDES)
    assert.deepEqual(next.KFC, { mode: 'all', categories: [] })
})

test("togglePreset never touches a restaurant currently in 'include' mode", () => {
    const groups = [{ restaurant: 'Subway', categories: ['Sides', 'Subs'] }]
    const filters: Record<string, RestaurantCategoryFilter> = {
        Subway: { mode: 'include', categories: ['Subs'] }
    }
    const next = togglePreset(groups, filters, SIDES)
    assert.deepEqual(next.Subway, { mode: 'include', categories: ['Subs'] })
})

test('togglePreset skips restaurants with no matching category entirely', () => {
    const groups = [{ restaurant: 'Chipotle', categories: ['Bowl', 'Burrito'] }]
    const next = togglePreset(groups, {}, SIDES)
    assert.equal(next.Chipotle, undefined)
})
