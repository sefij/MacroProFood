/**
 * MacroPro edge Worker.
 *
 * The site is otherwise pure static assets. This Worker exists only to serve the
 * nutrition snapshots under `/data/*` (index.json + one <restaurant>.json each)
 * from an R2 bucket, so the data lives in Cloudflare storage rather than being
 * committed to the repo and shipped in the bundle. The weekly GitHub Actions
 * scrape (refresh-data.yml) is what writes those objects.
 *
 * Any request that isn't `/data/*` falls through to Workers Static Assets.
 */

interface Env {
    STORAGE_NAME: R2Bucket
    ASSETS: Fetcher
}

const DATA_PREFIX = '/data/'
const APEX_HOST = 'macropro.food'
const CANONICAL_HOST = 'www.macropro.food'

export default {
    async fetch (request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url)
        const isDataRequest = url.pathname.startsWith(DATA_PREFIX)

        // The bare apex domain (macropro.food, over http or https) still
        // resolves and serves the site directly, splitting link equity from
        // the canonical www host. Redirect it — but never for `/data/*` (the
        // app's own same-origin fetches; redirecting those cross-origin trips
        // CORS, since the target sends no Access-Control-Allow-Origin, and
        // breaks the app outright for any client whose page happens to still
        // be running from the apex origin — e.g. a tab left open from before
        // this redirect shipped), and only for actual page navigations
        // otherwise (`Sec-Fetch-Mode: navigate`, sent by browsers and
        // Googlebot for a real navigation but not for a page's own fetch()
        // calls) — so a client already running from the apex host keeps
        // working rather than getting redirected mid-session and broken.
        if (
            url.hostname === APEX_HOST &&
            !isDataRequest &&
            request.headers.get('sec-fetch-mode') === 'navigate'
        ) {
            url.hostname = CANONICAL_HOST
            url.protocol = 'https:'
            return Response.redirect(url.toString(), 301)
        }

        if (!isDataRequest) {
            return env.ASSETS.fetch(request)
        }

        // `/data/index.json` -> `index.json`. Guard against path traversal.
        const key = url.pathname.slice(DATA_PREFIX.length)
        if (!key || key.includes('..') || key.includes('/')) {
            return new Response('Not found', { status: 404 })
        }

        const object = await env.STORAGE_NAME.get(key)
        if (!object) {
            return new Response('Not found', { status: 404 })
        }

        const headers = new Headers()
        object.writeHttpMetadata(headers)
        headers.set('etag', object.httpEtag)
        // Snapshots refresh weekly; a short TTL keeps the edge cache cheap while
        // letting a refresh show up within minutes.
        headers.set('cache-control', 'public, max-age=300')
        if (!headers.has('content-type')) {
            headers.set('content-type', 'application/json; charset=utf-8')
        }
        // Public, non-sensitive nutrition data — allow cross-origin reads so
        // a page never gets stuck unable to fetch its own data regardless of
        // which host (apex, www, a preview deploy) it happens to be served
        // from.
        headers.set('access-control-allow-origin', '*')

        // Honor conditional requests so unchanged snapshots return 304.
        if (request.headers.get('if-none-match') === object.httpEtag) {
            return new Response(null, { status: 304, headers })
        }

        return new Response(object.body, { headers })
    }
}
