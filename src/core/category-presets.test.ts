import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORY_PRESETS, matchingCategories, isPresetActive, togglePreset } from './category-presets'
import { RestaurantCategoryFilter } from './category-filter'

const SIDES = CATEGORY_PRESETS.find((p) => p.key === 'sides')!
const DRINKS = CATEGORY_PRESETS.find((p) => p.key === 'drinks')!
const DESSERTS = CATEGORY_PRESETS.find((p) => p.key === 'desserts')!

test('matchingCategories catches real category-name variants seen across restaurants (July 2026 data)', () => {
    assert.deepEqual(
        matchingCategories(['Fries & Sides', 'Sourdough Sides', 'Burgers'], SIDES),
        ['Fries & Sides', 'Sourdough Sides']
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

test("desserts preset doesn't false-positive on Wingstop's 'Sweet Potato Fries' (a side, not a dessert)", () => {
    assert.deepEqual(matchingCategories(['Sweet Potato Fries', 'Sides'], DESSERTS), [])
})

test('genuinely ambiguous categories (shakes, proper-noun desserts) are left unmatched by every preset', () => {
    const ambiguous = ['Shakes', 'Milkshakes', 'Handspun Shakes', 'Frosty®']
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
