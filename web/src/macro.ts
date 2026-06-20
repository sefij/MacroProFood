/**
 * Barrel that re-exports the dependency-free optimizer core shared with the
 * CLI. Keeping a single import surface here means components don't reach across
 * the repo boundary (`../../src/core/...`) directly.
 */
export * from '../../src/core/types'
export { findBestCombinations, avgAccuracyOf, flattenItems } from '../../src/core/optimizer'
