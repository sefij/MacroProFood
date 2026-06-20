/*
 * MacroPro ↔ MyFitnessPal — background service worker.
 *
 * Bridges the MacroPro web app to the user's already-logged-in MyFitnessPal tab
 * using host permissions. Nothing is stored: every request runs against the live
 * session, in the user's own browser, and returns immediately.
 *
 * Two operations, both performed by injecting a self-contained function into an
 * MFP tab via chrome.scripting (so the page's own cookies/session are used):
 *   - pull:  read the diary's "Remaining" row.
 *   - track: open Quick Add and fill the calorie/macro fields (best-effort).
 *
 * The injected functions mirror the DOM heuristics in src/mfp/client.ts.
 */

const DIARY_URL = 'https://www.myfitnesspal.com/food/diary'

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    handle(msg)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }))
    return true // keep the message channel open for the async response
})

async function handle (msg) {
    if (!msg || typeof msg.type !== 'string') throw new Error('bad request')
    if (msg.type === 'ping') return 'pong'
    if (msg.type === 'pull') return pullRemaining()
    if (msg.type === 'track') return trackMeal(msg.meal, msg.mealName)
    throw new Error(`unknown request: ${msg.type}`)
}

// --- tab helpers ----------------------------------------------------------

async function findMfpTab () {
    const tabs = await chrome.tabs.query({ url: '*://*.myfitnesspal.com/*' })
    return tabs[0] || null
}

function waitForTabComplete (tabId) {
    return new Promise((resolve) => {
        function listener (id, info) {
            if (id === tabId && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(listener)
                resolve()
            }
        }
        chrome.tabs.onUpdated.addListener(listener)
    })
}

/**
 * Returns a tab sitting on the MFP food diary. Reuses an existing diary tab,
 * navigates an existing MFP tab to the diary, or opens a fresh background tab.
 * `createdTabId` is set when we opened the tab ourselves (so callers can clean up).
 */
async function getDiaryTab () {
    const existing = await findMfpTab()
    if (existing && /\/food\/diary/.test(existing.url || '')) {
        return { tabId: existing.id, createdTabId: null }
    }
    if (existing) {
        await chrome.tabs.update(existing.id, { url: DIARY_URL })
        await waitForTabComplete(existing.id)
        return { tabId: existing.id, createdTabId: null }
    }
    const tab = await chrome.tabs.create({ url: DIARY_URL, active: false })
    await waitForTabComplete(tab.id)
    return { tabId: tab.id, createdTabId: tab.id }
}

/**
 * True only when the tab has been redirected to MFP's login page. We rely on the
 * URL — NOT on the presence of a password field, since MFP keeps a hidden login
 * form in the diary DOM even when you're signed in (that false-positived before).
 */
async function isOnLoginPage (tabId) {
    const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => /\/account\/login|\/login|\/account\/access/i.test(location.pathname)
    })
    return result
}

// --- operations -----------------------------------------------------------

async function pullRemaining () {
    const { tabId, createdTabId } = await getDiaryTab()
    try {
        // The injected reader polls for the SPA to render, so one call is enough.
        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId },
            func: readRemainingInPage
        })
        if (result) return result

        // No row found — distinguish "logged out" from "couldn't parse".
        if (await isOnLoginPage(tabId)) {
            await chrome.tabs.update(tabId, { active: true })
            throw new Error('Please sign in to MyFitnessPal in the tab we opened, then click Pull again.')
        }
        throw new Error('Could not read the "Remaining" row. Open your MFP food diary for today, then retry.')
    } finally {
        if (createdTabId) chrome.tabs.remove(createdTabId).catch(() => {})
    }
}

const VALID_MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks']

async function exec (tabId, func, args) {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func, args })
    return result
}

async function trackMeal (meal, mealName) {
    if (!meal || typeof meal.calories !== 'number') throw new Error('no meal provided')
    const targetMeal = VALID_MEALS.includes(mealName) ? mealName : 'Dinner'

    const { tabId } = await getDiaryTab()
    if (await isOnLoginPage(tabId)) {
        await chrome.tabs.update(tabId, { active: true })
        throw new Error('Please sign in to MyFitnessPal in the tab we opened, then try again.')
    }

    // Step 1: open the Quick Add form FROM the chosen meal's section, so MFP
    // pre-selects that meal (this is why opening from "Breakfast" was wrong).
    const opened = await exec(tabId, openQuickAddInPage, [targetMeal])
    if (!opened || !opened.ok) {
        throw new Error((opened && opened.message) || 'Could not open the Quick Add form.')
    }

    // Step 2: "Quick add calories" navigates to a new page — wait for the form
    // to render before we inject the fill (the old approach filled the old page).
    const ready = await waitForQuickAddForm(tabId)
    if (!ready) {
        await focusTab(tabId)
        throw new Error('The Quick Add page did not finish loading. Try again, or fill it manually.')
    }

    // Step 3: fill AND submit in one injection (so React can't wipe the values
    // between filling and clicking), then bring the tab forward.
    const result = await exec(tabId, fillQuickAddInPage, [meal, targetMeal, true])
    await focusTab(tabId)
    if (!result || !result.filled || result.filled.length === 0) {
        throw new Error(
            (result && result.message) ||
            'Opened Quick Add but could not fill the macro fields. Fill them manually, then save.'
        )
    }
    if (!result.submitted) {
        throw new Error(
            (result && result.message) ||
            'Filled the values but could not click "Add to Diary" — please click it manually.'
        )
    }

    // Confirm the entry actually went in (the Quick Add form closes / navigates).
    const confirmed = await waitForSubmitDone(tabId)
    return { ...result, confirmed }
}

/** Polls for the Quick Add form to disappear, signalling the entry was saved. */
async function waitForSubmitDone (tabId) {
    const start = Date.now()
    while (Date.now() - start < 12000) {
        const done = await exec(tabId, () => {
            const stillOpen = Array.from(
                document.querySelectorAll('h1, h2, h3, [role="heading"]')
            ).some((h) => /quick\s*add/i.test(h.textContent || ''))
            return !stillOpen
        }).catch(() => false)
        if (done) return true
        await new Promise((r) => setTimeout(r, 400))
    }
    return false
}

async function focusTab (tabId) {
    await chrome.tabs.update(tabId, { active: true }).catch(() => {})
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    if (tab && tab.windowId != null) chrome.windows.update(tab.windowId, { focused: true }).catch(() => {})
}

/** Polls (via repeated injection) for the Quick Add form to appear post-navigation. */
async function waitForQuickAddForm (tabId) {
    const start = Date.now()
    while (Date.now() - start < 15000) {
        const ok = await exec(tabId, () => {
            const heading = Array.from(
                document.querySelectorAll('h1, h2, h3, [role="heading"]')
            ).some((h) => /quick\s*add/i.test(h.textContent || ''))
            const inputs = Array.from(document.querySelectorAll('input')).filter(
                (i) => i.offsetParent !== null && i.type !== 'hidden' && !i.disabled
            )
            return heading || inputs.length >= 3
        }).catch(() => false)
        if (ok) return true
        await new Promise((r) => setTimeout(r, 350))
    }
    return false
}

// --- injected page functions (run in the MFP tab) -------------------------
// These must be fully self-contained: no closures over service-worker scope.

/**
 * Reads the diary "Remaining" row → {calories,protein,fat,carbs} | null.
 * Polls for up to ~10s because MFP renders the daily-summary table client-side
 * (it isn't in the initial HTML), mirroring the waitForFunction in client.ts.
 */
async function readRemainingInPage () {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const parseNum = (txt) => {
        const m = String(txt || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)
        return m ? parseFloat(m[0]) : null
    }
    const findRow = () => {
        const rows = Array.from(document.querySelectorAll('tr'))
        for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('td, th'))
            if (cells.length < 5) continue
            const label = (cells[0].textContent || '').trim().toLowerCase()
            if (!label.includes('remaining')) continue
            const calories = parseNum(cells[1].textContent)
            const carbs = parseNum(cells[2].textContent)
            const fat = parseNum(cells[3].textContent)
            const protein = parseNum(cells[4].textContent)
            if ([calories, carbs, fat, protein].some((v) => v === null)) return null
            return { calories, protein, fat, carbs }
        }
        return null
    }

    const start = Date.now()
    for (;;) {
        const v = findRow()
        if (v) return v
        if (Date.now() - start > 10000) return null
        await sleep(250)
    }
}

/**
 * Opens the Quick Add form FROM a specific meal's section so MFP pre-selects
 * that meal. Mirrors findMealHeading + openQuickAddCalories in client.ts.
 * Returns { ok, message? }. (The final click navigates the page.)
 */
async function openQuickAddInPage (mealName) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const visible = (el) => el && el.offsetParent !== null
    const waitFor = async (fn, timeout = 6000) => {
        const start = Date.now()
        for (;;) {
            const v = fn()
            if (v) return v
            if (Date.now() - start > timeout) return null
            await sleep(150)
        }
    }
    const clickables = () =>
        Array.from(document.querySelectorAll('a, button, [role="button"]')).filter(visible)

    // The meal heading (e.g. "Dinner") — exact, visible text.
    const heading = await waitFor(() =>
        Array.from(
            document.querySelectorAll('a, span, div, h1, h2, h3, h4, h5, p, td, th, li')
        ).find((e) => visible(e) && (e.textContent || '').trim() === mealName)
    )
    if (!heading) return { ok: false, message: `Could not find the "${mealName}" section on your diary.` }

    // The first "Quick Tools" that comes after this meal's heading is its own.
    const quickTools = await waitFor(() =>
        clickables().find(
            (e) =>
                /^quick tools$/i.test((e.textContent || '').trim()) &&
                heading.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING
        )
    )
    if (!quickTools) return { ok: false, message: `Could not find Quick Tools for ${mealName}.` }
    quickTools.click()

    // The dropdown's "Quick add calories" item (rendered anywhere in the DOM).
    const quickAdd = await waitFor(() =>
        clickables().find((e) => /quick\s*add/i.test((e.textContent || '').trim()))
    )
    if (!quickAdd) return { ok: false, message: 'Could not find "Quick add calories".' }
    quickAdd.click()
    return { ok: true }
}

/**
 * Fills the Quick Add calorie/macro fields by matching their labels, sets the
 * Meal dropdown when present, and re-fills once if React wipes the values on its
 * first re-render. Does NOT submit — the user reviews and clicks "Add to Diary".
 * Returns { filled: string[], message? }.
 */
async function fillQuickAddInPage (meal, mealName, submit) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const visible = (el) => el && el.offsetParent !== null
    const waitFor = async (fn, timeout = 8000) => {
        const start = Date.now()
        for (;;) {
            const v = fn()
            if (v) return v
            if (Date.now() - start > timeout) return null
            await sleep(200)
        }
    }

    const macroInputs = () =>
        Array.from(document.querySelectorAll('input')).filter(
            (i) => visible(i) && i.type !== 'hidden' && !i.disabled &&
                i.type !== 'checkbox' && i.type !== 'radio'
        )

    const candidates = (input) => {
        const out = [
            input.getAttribute('aria-label'),
            input.getAttribute('name'),
            input.getAttribute('placeholder')
        ]
        if (input.id) {
            const lbl = document.querySelector(`label[for="${input.id}"]`)
            if (lbl) out.push(lbl.textContent)
        }
        let p = input.parentElement
        let depth = 0
        while (p && depth < 4) {
            p.querySelectorAll('label').forEach((l) => out.push(l.textContent))
            p = p.parentElement
            depth++
        }
        return out.filter(Boolean).map((s) => s.trim())
    }

    const setValue = (el, value) => {
        const proto = el instanceof HTMLSelectElement
            ? window.HTMLSelectElement.prototype
            : window.HTMLInputElement.prototype
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
        el.focus()
        if (setter) setter.call(el, value)
        else el.value = value
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        el.blur()
    }

    const order = [
        ['calories', /calorie|energy/i],
        ['carbs', /carb/i],
        ['fat', /\bfats?\b/i],
        ['protein', /protein/i]
    ]
    const findField = (regex, used) => {
        for (const input of macroInputs()) {
            if (used.includes(input)) continue
            if (candidates(input).some((c) => regex.test(c))) return input
        }
        return null
    }

    // Wait for the calorie field to exist; MFP renders the form progressively.
    await waitFor(() => findField(order[0][1], []))
    // Let the meal-name dropdown auto-populate before we touch the form.
    await sleep(400)

    // Best-effort: set the Meal <select> to the requested meal.
    const mealSelect = Array.from(document.querySelectorAll('select'))
        .filter(visible)
        .find((s) => Array.from(s.options).some(
            (o) => (o.textContent || '').trim().toLowerCase() === mealName.toLowerCase()
        ))
    if (mealSelect) {
        const opt = Array.from(mealSelect.options).find(
            (o) => (o.textContent || '').trim().toLowerCase() === mealName.toLowerCase()
        )
        if (opt && mealSelect.value !== opt.value) setValue(mealSelect, opt.value)
    }

    const values = {
        calories: String(Math.round(meal.calories)),
        carbs: String(Math.round((meal.carbs ?? 0) * 10) / 10),
        fat: String(Math.round((meal.fat ?? 0) * 10) / 10),
        protein: String(Math.round((meal.protein ?? 0) * 10) / 10)
    }

    const fillOnce = () => {
        const used = []
        const filled = []
        const fields = {}
        for (const [key, regex] of order) {
            const el = findField(regex, used)
            if (el) {
                setValue(el, values[key])
                used.push(el)
                filled.push(key)
                fields[key] = el
            }
        }
        return { filled, fields }
    }

    let { filled, fields } = fillOnce()
    // React can wipe controlled inputs on its first re-render — verify & re-fill.
    await sleep(500)
    const wiped = filled.some((k) => (fields[k].value || '').trim() === '')
    if (wiped) {
        ({ filled, fields } = fillOnce())
    }

    if (filled.length === 0) {
        return { filled: [], message: 'Quick Add fields not found on the page.' }
    }

    if (!submit) return { filled, meal: mealName }

    // Click "Add to Diary". Mirrors clickAddToDiary in client.ts: wait for the
    // button, ensure it isn't disabled, then click the element directly (which
    // dispatches React's onClick and bypasses any footer overlay intercept).
    await sleep(300)
    const button = await waitFor(() =>
        Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')).find(
            (b) => visible(b) && /add\s*to\s*diary/i.test((b.textContent || b.value || '').trim())
        )
    , 6000)
    if (!button) {
        return { filled, submitted: false, meal: mealName, message: 'Filled the values but could not find the "Add to Diary" button.' }
    }
    if (button.disabled) {
        return { filled, submitted: false, meal: mealName, message: 'Filled the values but "Add to Diary" was disabled — the form may not have accepted them.' }
    }
    button.scrollIntoView({ block: 'center' })
    button.click()
    return { filled, submitted: true, meal: mealName }
}
