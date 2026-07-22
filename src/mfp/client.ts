import * as fs from 'fs/promises'
import chalk from 'chalk'
import {
    BrowserContext,
    Locator,
    Page,
    chromium
} from 'playwright'

const DIARY_URL = 'https://www.myfitnesspal.com/food/diary'
const LOGIN_URL = 'https://www.myfitnesspal.com/account/login'
const MEAL_NAME = 'Dinner'

const STEALTH_ARGS = [
    '--disable-blink-features=AutomationControlled',
    '--no-first-run',
    '--no-default-browser-check'
]
const IGNORE_DEFAULT_ARGS = ['--enable-automation']

export interface QuickAddInput {
    calories: number
    protein: number
    fat: number
    carbs: number
}

export interface QuickAddResult {
    mode: 'macros' | 'calories-only'
}

export interface RemainingMacros {
    calories: number
    carbs: number
    fat: number
    protein: number
}

export interface CreateOptions {
    headless: boolean
    userDataDir: string
}

export interface EnsureLoggedInOptions {
    email?: string
    password?: string
    allowInteractive: boolean
}

async function ensureDir (p: string): Promise<void> {
    await fs.mkdir(p, { recursive: true })
}

export class MfpClient {
    private constructor (
        private context: BrowserContext,
        private userDataDir: string,
        private headless: boolean
    ) {}

    static async create (options: CreateOptions): Promise<MfpClient> {
        await ensureDir(options.userDataDir)
        const context = await openPersistentChrome(options.userDataDir, options.headless)
        return new MfpClient(context, options.userDataDir, options.headless)
    }

    async ensureLoggedIn (options: EnsureLoggedInOptions): Promise<void> {
        const page = await this.firstOrNewPage()
        await page.goto(DIARY_URL, { waitUntil: 'domcontentloaded' })

        if (await this.isOnDiary(page)) {
            console.log(chalk.green('🔑 MFP: reusing persistent Chrome profile'))
            return
        }

        if (options.email && options.password) {
            console.log(chalk.yellow('🔑 MFP: profile not signed in — attempting credential login'))
            const ok = await this.tryCredentialLogin(page, options.email, options.password)
            if (ok) return
            console.log(chalk.yellow('🔑 MFP: credential login failed'))
        }

        if (!options.allowInteractive) {
            throw new Error('MFP login required but interactive mode disabled')
        }

        if (this.headless) {
            await page.close().catch(() => undefined)
            await this.relaunchHeaded()
        }
        await this.interactiveLogin()
    }

    private async firstOrNewPage (): Promise<Page> {
        const existing = this.context.pages()
        return existing.length > 0 ? existing[0] : await this.context.newPage()
    }

    private async isOnDiary (page: Page): Promise<boolean> {
        try {
            await page.waitForURL((url) => /\/food\/diary/.test(url.toString()), {
                timeout: 5000
            })
            return true
        } catch {
            return /\/food\/diary/.test(page.url())
        }
    }

    private async tryCredentialLogin (
        page: Page,
        email: string,
        password: string
    ): Promise<boolean> {
        await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' })

        const emailField = page.locator(
            'input[name="email"], input[type="email"], input#email'
        ).first()
        const passwordField = page.locator(
            'input[name="password"], input[type="password"], input#password'
        ).first()

        try {
            await emailField.waitFor({ state: 'visible', timeout: 10000 })
            await emailField.fill(email)
            await passwordField.fill(password)

            const submit = page.getByRole('button', { name: /log\s*in/i }).first()
            await submit.click()
            await page.waitForLoadState('networkidle', { timeout: 20000 })

            await page.goto(DIARY_URL, { waitUntil: 'domcontentloaded' })
            return await this.isOnDiary(page)
        } catch {
            return false
        }
    }

    private async relaunchHeaded (): Promise<void> {
        await this.context.close().catch(() => undefined)
        this.context = await openPersistentChrome(this.userDataDir, false)
        this.headless = false
    }

    private async interactiveLogin (): Promise<void> {
        const page = await this.firstOrNewPage()
        await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' })

        console.log(
            chalk.cyan(
                '🔑 MFP: complete login in the opened Chrome window (Google sign-in is OK here). Waiting up to 5 minutes…'
            )
        )

        try {
            await page.waitForURL(
                (url) => /\/food\/diary/.test(url.toString()),
                { timeout: 5 * 60 * 1000 }
            )
        } catch {
            throw new Error('MFP login timeout — diary page never reached')
        }

        console.log(chalk.green('🔑 MFP: login detected, profile retained for future runs'))
    }

    async fetchRemainingMacros (): Promise<RemainingMacros> {
        const page = await this.context.newPage()
        try {
            await page.goto(DIARY_URL, { waitUntil: 'domcontentloaded' })
            await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined)

            // The diary's daily-summary table renders after the meal sections.
            // We wait until a row whose first cell mentions "Remaining" is
            // present so we don't race the React render.
            await page
                .waitForFunction(
                    () => {
                        const rows = Array.from(document.querySelectorAll('tr'))
                        return rows.some((row) => {
                            const cells = Array.from(row.querySelectorAll('td, th'))
                            if (cells.length < 5) return false
                            const label = (cells[0].textContent || '').trim().toLowerCase()
                            return label.includes('remaining')
                        })
                    },
                    { timeout: 15000 }
                )

            const parsed = await page.evaluate(() => {
                const parseNum = (txt: string): number | null => {
                    // Cells can contain extra accessibility/responsive text
                    // (e.g. "Carbs 233" or "233\n67%"), so we extract the
                    // first numeric token rather than concatenating digits.
                    const match = txt.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
                    if (!match) return null
                    const n = parseFloat(match[0])
                    return Number.isFinite(n) ? n : null
                }

                // A row's label, or null when it's too narrow to be a macro row.
                const labelOf = (row: Element): string | null => {
                    const cells = row.querySelectorAll('td, th')
                    if (cells.length < 5) return null
                    return (cells[0].textContent || '').trim().toLowerCase()
                }
                // Only the day's summary table carries a "Totals" / "Your Daily
                // Goal" row; meal sections with per-meal goals have their own
                // "Remaining" row, which we must not read instead.
                const isSummaryTable = (row: Element): boolean => {
                    const table = row.closest('table')
                    if (!table) return false
                    return Array.from(table.querySelectorAll('tr')).some((other) => {
                        const l = labelOf(other)
                        return l !== null && /^(totals?|your daily goal|goal)\b/.test(l)
                    })
                }

                const rows = Array.from(document.querySelectorAll('tr'))
                const candidates = rows.filter((row) => {
                    const l = labelOf(row)
                    return l !== null && l.includes('remaining')
                })
                if (candidates.length === 0) return null
                const inSummary = candidates.filter(isSummaryTable)
                const pool = inSummary.length > 0 ? inSummary : candidates

                // Last match: the day's summary renders after every meal section.
                for (let i = pool.length - 1; i >= 0; i--) {
                    const cells = Array.from(pool[i].querySelectorAll('td, th'))
                    const calories = parseNum(cells[1].textContent || '')
                    const carbs = parseNum(cells[2].textContent || '')
                    const fat = parseNum(cells[3].textContent || '')
                    const protein = parseNum(cells[4].textContent || '')

                    if (
                        calories === null ||
                        carbs === null ||
                        fat === null ||
                        protein === null
                    ) {
                        continue
                    }
                    return { calories, carbs, fat, protein }
                }
                return null
            })

            if (!parsed) {
                const shotPath = `mfp-remaining-${Date.now()}.png`
                await page.screenshot({ path: shotPath, fullPage: true }).catch(() => undefined)
                throw new Error(
                    `Could not parse the "Remaining" row from the MFP diary (see ${shotPath})`
                )
            }

            return parsed
        } finally {
            if (!page.isClosed()) await page.close()
        }
    }

    async quickAddDinner (input: QuickAddInput): Promise<QuickAddResult> {
        const page = await this.context.newPage()
        try {
            await page.goto(DIARY_URL, { waitUntil: 'domcontentloaded' })
            await page.waitForLoadState('networkidle', { timeout: 20000 })

            const dinnerHeading = await this.findMealHeading(page, MEAL_NAME)
            await this.openQuickAddCalories(page, dinnerHeading)

            const mode = await this.fillAndSubmitQuickAdd(page, input)

            await page.waitForLoadState('networkidle', { timeout: 15000 })
            return { mode }
        } catch (error) {
            const shotPath = `mfp-error-${Date.now()}.png`
            try {
                await page.screenshot({ path: shotPath, fullPage: true })
                console.log(chalk.yellow(`📷 Saved debug screenshot: ${shotPath}`))
            } catch {
                /* ignore */
            }
            throw error
        } finally {
            if (!page.isClosed()) await page.close()
        }
    }

    private async findMealHeading (page: Page, mealName: string): Promise<Locator> {
        const heading = page
            .getByText(mealName, { exact: true })
            .filter({ visible: true })
            .first()
        await heading.waitFor({ state: 'visible', timeout: 15000 })
        return heading
    }

    private async openQuickAddCalories (page: Page, mealHeading: Locator): Promise<void> {
        const quickTools = mealHeading
            .locator('xpath=following::a[normalize-space()="Quick Tools"][1]')
            .first()
        await quickTools.waitFor({ state: 'visible', timeout: 10000 })
        await quickTools.click()

        const popupShot = `mfp-popup-${Date.now()}.png`
        await page.screenshot({ path: popupShot, fullPage: true }).catch(() => undefined)
        console.log(chalk.gray(`   ↳ popup state captured: ${popupShot}`))

        const inlineInput = page
            .locator('[role="dialog"] input, .modal input, .ui-dialog input, .popup input')
            .filter({ visible: true })
            .first()
        if ((await inlineInput.count()) > 0) {
            return
        }

        const quickAddLink = page
            .getByText(/^\s*Quick\s+add\s+calories\s*$/i)
            .filter({ visible: true })
            .first()
        await quickAddLink.waitFor({ state: 'visible', timeout: 10000 })
        await quickAddLink.click()
    }

    private async fillAndSubmitQuickAdd (
        page: Page,
        input: QuickAddInput
    ): Promise<'macros' | 'calories-only'> {
        const popup = page
            .locator('[role="dialog"], .modal, .ui-dialog, .popup')
            .filter({ visible: true })
            .first()
        const inPopup = (await popup.count()) > 0

        if (inPopup) {
            const caloriesInput = popup
                .locator('input[type="number"], input[type="text"], input:not([type])')
                .filter({ visible: true })
                .first()
            await caloriesInput.waitFor({ state: 'visible', timeout: 10000 })
            await typeInto(page, caloriesInput, String(Math.round(input.calories)))

            const submit = popup
                .getByRole('button', { name: /^\s*(add|save|ok)\s*$/i })
                .filter({ visible: true })
                .first()
            if ((await submit.count()) > 0) {
                await submit.click()
            } else {
                await caloriesInput.press('Enter')
            }
            return 'calories-only'
        }

        await page
            .getByRole('heading', { name: /quick\s*add/i })
            .first()
            .waitFor({ state: 'visible', timeout: 15000 })

        // MFP's Quick Add page renders progressively — the Meal Name dropdown
        // auto-populates with "Dinner" only after the form's React state is
        // fully wired up. Filling before this point writes to the DOM but
        // gets wiped on the next React re-render.
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => undefined)
        await page
            .waitForFunction(
                () => {
                    const candidates = Array.from(
                        document.querySelectorAll('select, [role="combobox"], [role="button"]')
                    )
                    return candidates.some((el) => {
                        const text = (el.textContent || '').trim()
                        const value = (el as HTMLSelectElement).value || ''
                        return /^(breakfast|lunch|dinner|snacks?)$/i.test(text) ||
                            /^(breakfast|lunch|dinner|snacks?)$/i.test(value)
                    })
                },
                { timeout: 15000 }
            )
            .catch(() => {
                console.log(chalk.yellow('   ⚠️  Meal Name auto-populate not detected — proceeding anyway'))
            })

        const tags = await tagMacroInputs(page)

        console.log(
            chalk.gray(
                `   ↳ discovered fields: calories=${!!tags.calories}, carbs=${!!tags.carbs}, fat=${!!tags.fat}, protein=${!!tags.protein}`
            )
        )

        const missing = (['calories', 'carbs', 'fat', 'protein'] as const).filter((k) => !tags[k])
        if (missing.length > 0) {
            console.log(chalk.yellow(`   ⚠️  Could not match: ${missing.join(', ')}`))
            console.log(chalk.gray('   ↳ visible inputs on page:'))
            for (const info of tags.debug) {
                console.log(chalk.gray(`     ${JSON.stringify(info)}`))
            }
        }

        const setField = async (token: string, value: string): Promise<void> => {
            const loc = page.locator(`[data-mfp-test="${token}"]`)
            await loc.click()
            await page.keyboard.press('Control+A')
            await page.keyboard.press('Delete')
            await page.keyboard.type(value, { delay: 25 })
            await page.keyboard.press('Tab')
        }

        const filled: string[] = []
        if (tags.calories) {
            await setField(tags.calories, String(Math.round(input.calories)))
            filled.push('calories')
        }
        if (tags.carbs) {
            await setField(tags.carbs, String(round1(input.carbs)))
            filled.push('carbs')
        }
        if (tags.fat) {
            await setField(tags.fat, String(round1(input.fat)))
            filled.push('fat')
        }
        if (tags.protein) {
            await setField(tags.protein, String(round1(input.protein)))
            filled.push('protein')
        }

        console.log(chalk.gray(`   ↳ filled: [${filled.join(', ') || '—'}]`))

        if (filled.length === 0) {
            console.log(chalk.yellow('   ⚠️  No macro fields filled — falling back to calories-only'))
            const caloriesField =
                (await findMacroField(page, /calorie/i, ['Calories'])) ??
                inputRightOf(page, 'Calories')
            await caloriesField.waitFor({ state: 'visible', timeout: 15000 })
            await fillNumberField(caloriesField, Math.round(input.calories))
            await this.clickAddToDiary(page)
            return 'calories-only'
        }

        const prefillShot = `mfp-prefill-${Date.now()}.png`
        await page.screenshot({ path: prefillShot, fullPage: true }).catch(() => undefined)
        console.log(chalk.gray(`   ↳ pre-submit form state: ${prefillShot}`))

        await this.clickAddToDiary(page)

        return 'macros'
    }

    private async clickAddToDiary (page: Page): Promise<void> {
        const submit = page
            .getByRole('button', { name: /add\s*to\s*diary/i })
            .first()
        await submit.waitFor({ state: 'visible', timeout: 10000 })
        await submit.scrollIntoViewIfNeeded()

        const disabledBefore = await submit.isDisabled().catch(() => false)
        if (disabledBefore) {
            const disabledShot = `mfp-disabled-${Date.now()}.png`
            await page.screenshot({ path: disabledShot, fullPage: true }).catch(() => undefined)
            throw new Error(
                `Add to Diary button is disabled — form state did not accept our values (see ${disabledShot})`
            )
        }

        const urlBefore = page.url()
        // Force-click bypasses the footer's pointer-events intercept while
        // still dispatching real mouse events (mousedown/mouseup/click) so
        // MFP's React onClick handler actually fires.
        await submit.click({ force: true, timeout: 5000 })

        const heading = page
            .getByRole('heading', { name: /quick\s*add/i })
            .first()
        try {
            await Promise.race([
                heading.waitFor({ state: 'hidden', timeout: 10000 }),
                page.waitForURL((url) => url.toString() !== urlBefore, { timeout: 10000 })
            ])
        } catch {
            const stuckShot = `mfp-stuck-${Date.now()}.png`
            await page.screenshot({ path: stuckShot, fullPage: true }).catch(() => undefined)
            throw new Error(
                `Submit did not advance past the Quick Add form — entry likely not saved (see ${stuckShot})`
            )
        }
    }

    async close (): Promise<void> {
        await this.context.close().catch(() => undefined)
    }
}

async function openPersistentChrome (
    userDataDir: string,
    headless: boolean
): Promise<BrowserContext> {
    try {
        return await chromium.launchPersistentContext(userDataDir, {
            channel: 'chrome',
            headless,
            args: STEALTH_ARGS,
            ignoreDefaultArgs: IGNORE_DEFAULT_ARGS,
            viewport: null
        })
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        if (/chrome|channel/i.test(msg)) {
            throw new Error(
                'Google Chrome not found. Install Chrome from https://www.google.com/chrome/ ' +
                'or revert to bundled Chromium (note: Google blocks OAuth from Chromium). ' +
                `Original: ${msg}`
            )
        }
        throw error
    }
}

function round1 (n: number): number {
    return Math.round(n * 10) / 10
}

function inputRightOf (page: Page, labelText: string): Locator {
    return page
        .locator(`input:right-of(:text-is("${labelText}"))`)
        .first()
}

async function findMacroField (
    page: Page,
    labelPattern: RegExp,
    fallbackTexts: string[]
): Promise<Locator | null> {
    const tryLocator = async (loc: Locator): Promise<Locator | null> => {
        if ((await loc.count()) === 0) return null
        try {
            await loc.waitFor({ state: 'visible', timeout: 3000 })
            return loc
        } catch {
            return null
        }
    }

    const byLabel = await tryLocator(page.getByLabel(labelPattern).first())
    if (byLabel) return byLabel

    for (const text of fallbackTexts) {
        const escaped = text.replace(/"/g, '\\"')
        const strategies = [
            page.locator(`input:below(:text("${escaped}"))`).first(),
            page.locator(`input:right-of(:text("${escaped}"))`).first(),
            page.locator(`input:near(:text("${escaped}"))`).first()
        ]
        for (const loc of strategies) {
            const found = await tryLocator(loc)
            if (found) return found
        }
    }
    return null
}

interface MacroTagResult {
    calories: string | null
    carbs: string | null
    fat: string | null
    protein: string | null
    debug: Array<{
        id: string
        name: string | null
        ariaLabel: string | null
        placeholder: string | null
        value: string
        candidates: string[]
    }>
}

async function tagMacroInputs (page: Page): Promise<MacroTagResult> {
    return await page.evaluate(() => {
        const allInputs = Array.from(document.querySelectorAll('input'))
            .filter((i) =>
                (i as HTMLInputElement).offsetParent !== null &&
                (i as HTMLInputElement).type !== 'hidden' &&
                !(i as HTMLInputElement).disabled
            ) as HTMLInputElement[]

        const getCandidates = (input: HTMLInputElement): string[] => {
            const cands: Array<string | null | undefined> = [
                input.getAttribute('aria-label'),
                input.getAttribute('name'),
                input.getAttribute('placeholder')
            ]
            if (input.id) {
                const label = document.querySelector(`label[for="${input.id}"]`)
                cands.push(label?.textContent)
            }
            let p: HTMLElement | null = input.parentElement
            let depth = 0
            while (p && depth < 4) {
                p.querySelectorAll('label').forEach((l) => cands.push(l.textContent))
                p = p.parentElement
                depth++
            }
            return cands
                .filter((c): c is string => typeof c === 'string')
                .map((c) => c.trim())
                .filter((c) => c.length > 0 && c.length < 80)
        }

        const findFor = (
            regex: RegExp,
            used: Set<HTMLInputElement>
        ): HTMLInputElement | null => {
            for (const input of allInputs) {
                if (used.has(input)) continue
                const cands = getCandidates(input)
                if (cands.some((c) => regex.test(c))) return input
            }
            return null
        }

        const debug = allInputs.map((i) => ({
            id: i.id,
            name: i.getAttribute('name'),
            ariaLabel: i.getAttribute('aria-label'),
            placeholder: i.getAttribute('placeholder'),
            value: i.value,
            candidates: getCandidates(i)
        }))

        const used = new Set<HTMLInputElement>()
        const tag = (el: HTMLInputElement | null, name: string): string | null => {
            if (!el) return null
            const token = `mfp-${name}-${Math.random().toString(36).slice(2, 10)}`
            el.setAttribute('data-mfp-test', token)
            used.add(el)
            return token
        }

        const calories = tag(findFor(/calorie|energy/i, used), 'calories')
        const carbs = tag(findFor(/carb/i, used), 'carbs')
        const fat = tag(findFor(/\bfats?\b/i, used), 'fat')
        const protein = tag(findFor(/protein/i, used), 'protein')

        return { calories, carbs, fat, protein, debug }
    })
}

async function fillNumberField (input: Locator, value: number): Promise<void> {
    const text = String(value)
    await input.click()
    await input.fill('')
    await input.fill(text)
    await input.press('Tab')
}

async function typeInto (_page: Page, input: Locator, value: string): Promise<void> {
    await input.evaluate((el, val) => {
        const elem = el as HTMLInputElement
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
        )?.set
        if (setter) setter.call(elem, val)
        else elem.value = val
        elem.dispatchEvent(new Event('input', { bubbles: true }))
        elem.dispatchEvent(new Event('change', { bubbles: true }))
        elem.blur()
    }, value)
}
