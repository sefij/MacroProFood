/**
 * Chipotle's build-your-own order builder (spec 12) — the second, independent
 * use of the two live sources spec 11 introduced. Where `recipes.ts` hand-pins
 * *whole dishes*, this file walks Deliveroo's own live choice tree (Protein →
 * Rice → Beans → Toppings, …) and cross-references each **option** against
 * `ingredients.ts`'s PDF macros. The tree shape itself is never hand-declared
 * here — it's read live from `root.modifierGroups` via
 * {@link buildableTreeFromRoot} — only the option-label → PDF-ingredient
 * alias table below is hand-curated, the same kind of review `recipes.ts`
 * does for whole dishes, just applied to individual options.
 *
 * **Why this is a tree, not a flat list of groups.** A protein choice
 * genuinely unlocks different follow-up groups depending on *which* protein
 * you pick — confirmed live, not assumed: a Chicken taco only offers a shell
 * choice and toppings, but a Sofritas or Veggie taco additionally offers
 * Rice/Beans that the meat proteins don't get. Quesadilla's follow-up
 * ("Quesa Sides") is a single **pick-exactly-3** group merging rice/beans/
 * salsa/toppings, not the Rice-then-Beans-then-Toppings sequence the other
 * formats use. So each {@link BuildChoice} carries its own `next` groups
 * (mirroring Deliveroo's option-level `modifierGroupIds`) instead of a
 * format having one fixed group list.
 *
 * **What's skipped while walking, and why:**
 *  - A group named "Extra" (buy an extra full scoop of a protein) — a pricing
 *    upsell, not a composition choice; this app has never modeled price.
 *  - A group named "Add a Drink?" — every root item carries one; unrelated to
 *    composing the dish itself, and out of scope the same way canned drinks
 *    are for `recipes.ts` (no PDF macro source for them either).
 *  - The "Veggie" protein option — Deliveroo shows it with a flat 145 kcal
 *    hint that doesn't correspond to any single PDF ingredient (no protein/
 *    fat/carb breakdown, and no combination of toppings obviously sums to
 *    it), so there's nothing to verify it against. Excluded rather than
 *    guessed at, same "don't fabricate" stance as everywhere else in this
 *    project.
 *
 * **Rule for a resolved option's macros**: every option maps to its PDF
 * ingredient's **published serving as-is** — no invented scale factors. See
 * spec 12 on the one topping (Fresh Tomato salsa) where Deliveroo's own
 * calorie hint disagrees with the PDF: the PDF's figure is used because it's
 * the higher one (this project's standing rule for a 2-source mismatch is to
 * prefer not under-reporting over manufacturing precision from a single
 * number).
 */

import { IngredientNutrition } from './ingredients'
import {
    DeliverooModifierGroup,
    DeliverooModifierOption,
    DeliverooRoot,
    fetchDeliverooRoot
} from './deliveroo'
import { BuildChoice, BuildGroup } from '../../core/types'

/** Deliveroo root item name → the format label shown in the app. */
export const BUILDABLE_FORMATS: Record<string, string> = {
    Bowl: 'Burrito Bowl',
    Burrito: 'Burrito',
    Salad: 'Salad',
    Tacos: 'Tacos (3)',
    Quesadilla: 'Quesadilla'
}

/** Groups skipped entirely while walking — pricing upsells / unrelated add-ons, not composition choices. */
const SKIPPED_GROUP_NAMES = /^(Extra|Add a Drink\?)$/i

/** Options excluded from the picker — no PDF ingredient can be verified against them (see docblock). */
const EXCLUDED_OPTIONS = new Set(['Veggie'])

/** Options that are a genuine zero-macro "none" choice, not missing from the alias table. */
const ZERO_CHOICES = new Set(['No Rice', 'No Beans'])

/**
 * Deliveroo option label (after {@link normalizeOptionName}) → `ingredients.ts`
 * key. Hand-reviewed against a live pull across all 5 formats' trees — every
 * label actually observed is covered; anything new fails loudly rather than
 * silently narrowing the picker (see {@link resolveIngredient}).
 */
const OPTION_ALIASES: Record<string, string> = {
    // Protein or Veggie
    '(NEW) Chipotle Honey Chicken': 'Chipotle Honey Chicken (LTO)',
    Chicken: 'Chicken',
    Steak: 'Steak',
    Carnitas: 'Carnitas',
    'Braised Beef Barbacoa': 'Barbacoa',
    Sofritas: 'Sofritas (braised tofu)',
    // Quesadilla's own protein-slot options (no meat)
    Cheese: 'Monterey Jack Cheese',
    'Fajita Veggie': 'Fajita Vegetables',

    // Choose Rice / Choose Beans
    'White Rice': 'Coriander-Lime White Rice',
    'Brown Rice': 'Coriander-Lime Brown Rice',
    'Black Beans': 'Black Beans',
    'Pinto Beans (VG)': 'Pinto Beans',

    // Add Your Toppings (shared across every format, including Quesadilla's "Quesa Sides")
    'Fajitas Vegetables (VG)': 'Fajita Vegetables',
    'Fresh Tomato - mild (VG)': 'Fresh Tomato Salsa',
    'Tomato Green-Chili - medium (VG)': 'Roasted Tomato Green-Chilli Salsa',
    'Tomato Red-Chili - hot (VG)': 'Roasted Tomato Red-Chilli Salsa',
    'Sweetcorn - medium (VG)': 'Chilli-Corn Salsa',
    'Sour Cream (V)': 'Sour Cream',
    'Guacamole (VG)': 'Guacamole (topping/side)',
    'Salad Lettuce (VG)': 'Romaine Lettuce (salad/topping)',

    // Vinaigrette (Salad only)
    'Vinaigrette (V)': 'Chipotle Honey Vinaigrette',

    // Choose Your Taco (Tacos only) — the PDF's shell rows are already a
    // full 3-taco serving ("3 Ea"), matching the "Tacos (3)" item exactly.
    'Tacos - Crispy': 'Hard Shell Taco (Crispy Corn Taco)',
    'Tacos - Soft': 'Flour Tortilla (Taco)'
}

const ZERO_MACROS: Omit<IngredientNutrition, 'portion'> = { calories: 0, protein: 0, fat: 0, carbs: 0 }

/** A depth past anything Chipotle's real tree needs — guards against a malformed/cyclic modifier graph. */
const MAX_DEPTH = 8

/** Strips emoji/variation-selector noise Deliveroo's labels inconsistently include (e.g. "Sofritas 🌱" vs "Sofritas🌱"), and collapses whitespace. */
function normalizeOptionName (raw: string): string {
    return raw
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}\u{2B00}-\u{2BFF}]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
}

function resolveIngredient (
    normalized: string,
    rawName: string,
    ingredients: Map<string, IngredientNutrition>
): Omit<IngredientNutrition, 'portion'> {
    if (ZERO_CHOICES.has(normalized)) return ZERO_MACROS

    const key = OPTION_ALIASES[normalized]
    if (!key) {
        throw new Error(
            `Chipotle (buildable): no ingredient alias for Deliveroo option "${rawName}" (normalized "${normalized}")`
        )
    }
    const macros = ingredients.get(key)
    if (!macros) {
        throw new Error(`Chipotle (buildable): alias "${key}" for "${rawName}" is not in the parsed PDF table`)
    }
    return macros
}

function selectionOf (group: DeliverooModifierGroup): Pick<BuildGroup, 'selection' | 'count'> {
    if (group.minSelection === group.maxSelection) {
        if (group.minSelection === 1) return { selection: 'one' }
        return { selection: 'exactly', count: group.minSelection }
    }
    return { selection: 'many' }
}

function walkGroup (
    group: DeliverooModifierGroup,
    byId: Map<string, DeliverooModifierGroup>,
    ingredients: Map<string, IngredientNutrition>,
    depth: number
): BuildGroup {
    if (depth > MAX_DEPTH) {
        throw new Error(`Chipotle (buildable): modifier tree exceeds depth ${MAX_DEPTH} at group "${group.name}" — likely a cycle`)
    }

    const choices: BuildChoice[] = []
    for (const option of group.modifierOptions) {
        const normalized = normalizeOptionName(option.name)
        if (EXCLUDED_OPTIONS.has(normalized)) continue
        choices.push(buildChoice(option, normalized, byId, ingredients, depth))
    }

    return { label: group.name, ...selectionOf(group), choices }
}

function buildChoice (
    option: DeliverooModifierOption,
    normalized: string,
    byId: Map<string, DeliverooModifierGroup>,
    ingredients: Map<string, IngredientNutrition>,
    depth: number
): BuildChoice {
    const macros = resolveIngredient(normalized, option.name, ingredients)

    const next: BuildGroup[] = []
    for (const groupId of option.modifierGroupIds) {
        const nested = byId.get(groupId)
        if (!nested || SKIPPED_GROUP_NAMES.test(nested.name)) continue
        next.push(walkGroup(nested, byId, ingredients, depth + 1))
    }

    return {
        label: normalized,
        calories: macros.calories,
        protein: macros.protein,
        fat: macros.fat,
        carbs: macros.carbs,
        ...(next.length > 0 ? { next } : {})
    }
}

/** Builds one format's full choice tree from an already-parsed Deliveroo root. Pure — no network — so it's unit-testable. */
export function buildableTreeFromRoot (
    root: DeliverooRoot,
    deliverooName: string,
    ingredients: Map<string, IngredientNutrition>
): BuildGroup {
    const item = root.items.find((i) => (i.name ?? '').trim() === deliverooName)
    if (!item) {
        throw new Error(`Chipotle (buildable): root item "${deliverooName}" not found on the Deliveroo menu page`)
    }

    const byId = new Map(root.modifierGroups.map((g) => [g.id, g]))
    const topGroups = (item.modifierGroupIds ?? [])
        .map((id) => byId.get(id))
        .filter((g): g is DeliverooModifierGroup => !!g && !SKIPPED_GROUP_NAMES.test(g.name))

    if (topGroups.length !== 1) {
        throw new Error(
            `Chipotle (buildable): expected exactly one top-level choice group for "${deliverooName}", found ${topGroups.length}`
        )
    }
    return walkGroup(topGroups[0], byId, ingredients, 0)
}

/** Fetches the live Deliveroo menu once and builds every format's choice tree from it. */
export async function fetchBuildableFormats (
    ingredients: Map<string, IngredientNutrition>
): Promise<Record<string, BuildGroup>> {
    const root = await fetchDeliverooRoot()
    const result: Record<string, BuildGroup> = {}
    for (const [format, deliverooName] of Object.entries(BUILDABLE_FORMATS)) {
        result[format] = buildableTreeFromRoot(root, deliverooName, ingredients)
    }
    return result
}
