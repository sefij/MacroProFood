/**
 * Cleans a raw category/section label scraped from a menu (PDF section
 * heading, HTML section header, JSON category name, …) into something
 * presentable.
 *
 * Sources are inconsistent about casing — some publish clean names ("Sides"),
 * others SHOUT them ("SAUCES & CONDIMENTS", a PDF heading style) or leave them
 * all lowercase (a raw CMS field, e.g. "limited time only"). Only a string
 * with no deliberate mixed casing gets re-cased, so a source's intentional
 * casing (brand names, acronyms embedded in an otherwise-mixed label like
 * "BBQ Chicken & Bacon") is never second-guessed.
 */
export function normalizeCategory (raw: string | undefined): string | undefined {
    const trimmed = (raw ?? '').replace(/\s+/g, ' ').trim()
    if (!trimmed) return undefined
    return isUncased(trimmed) ? titleCase(trimmed) : trimmed
}

/** True when a string has no letters, or its letters are all one case. */
function isUncased (value: string): boolean {
    return value === value.toLowerCase() || value === value.toUpperCase()
}

function titleCase (value: string): string {
    return value.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}
