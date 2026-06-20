import { JsonScraper } from '../../types'
import jsonData from './store'

/**
 * Wendy's is served from a bundled JSON snapshot ({@link ./store}), not a live
 * scrape. The snapshot is a point-in-time copy of the Wendy's UK menu and can
 * go stale as items change — re-capture `store.ts` to refresh it.
 */
export class WendysScraper extends JsonScraper<typeof jsonData> {
    name = "Wendy's"
    icon = '🍔'
    protected jsonData = jsonData
}
