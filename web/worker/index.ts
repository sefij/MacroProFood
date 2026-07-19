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
const CANONICAL_HOST = 'www.macropro.food'

export default {
    async fetch (request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url)

        // The bare apex domain (macropro.food, over http or https) still
        // resolves and serves the site directly — Google was finding it,
        // respecting the canonical tag, and not double-indexing it, but it
        // was still two live copies of the site splitting link equity.
        // Redirect it to the canonical www host instead of just relying on
        // the <link rel="canonical"> tag to paper over it.
        if (url.hostname === 'macropro.food') {
            url.hostname = CANONICAL_HOST
            url.protocol = 'https:'
            return Response.redirect(url.toString(), 301)
        }

        if (!url.pathname.startsWith(DATA_PREFIX)) {
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

        // Honor conditional requests so unchanged snapshots return 304.
        if (request.headers.get('if-none-match') === object.httpEtag) {
            return new Response(null, { status: 304, headers })
        }

        return new Response(object.body, { headers })
    }
}
