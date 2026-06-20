import { JsonScraper } from '../../types'
import jsonData from './store'

/**
 * KFC is served from a bundled JSON snapshot ({@link ./store}), not a live
 * scrape. The snapshot is a point-in-time copy of the KFC UK menu and can go
 * stale as items change — re-capture `store.ts` to refresh it.
 */
export class KFCScraper extends JsonScraper<typeof jsonData> {
    name = 'KFC'
    icon = '🍗'
    protected jsonData = jsonData
}
