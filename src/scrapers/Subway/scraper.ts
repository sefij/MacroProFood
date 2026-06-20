import jsonData from './store'
import { JsonScraper } from '../../types'

/**
 * Subway is served from a bundled JSON snapshot ({@link ./store}), not a live
 * scrape. The snapshot is a point-in-time copy of the Subway UK menu and can go
 * stale as items change — re-capture `store.ts` to refresh it.
 */
export class SubwayScraper extends JsonScraper<typeof jsonData> {
    name = 'Subway'
    icon = '🥪'
    protected jsonData = jsonData
}
