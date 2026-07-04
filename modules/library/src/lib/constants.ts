/**
 * App-wide constants for the standalone build.
 */

/**
 * Minimum semantic-similarity score a search hit must reach to be shown.
 *
 * The Main Backend semantic search endpoints (concept, kv, targets,
 * experts_db) return a cosine `similarity` in [0, 1] for every hit. Anything
 * below this floor is a weak/incidental match and is dropped client-side so
 * the result list stays relevant instead of trailing off into noise.
 *
 * Tune here — it is the single source of truth for every semantic list.
 * Rows that arrive without a similarity score (e.g. a non-search `list` call)
 * are never filtered by this.
 */
// TEMP: set to 0 for testing — shows every hit the backend returns, so we can
// see the real similarity distribution before picking a production threshold.
export const SEARCH_SIMILARITY_THRESHOLD = 0;

/**
 * Cap on semantic `/search` hits — the N most similar.
 *
 * Used twice: as the `limit` sent on each backend `/search` call, AND as a
 * hard cap re-applied over the MERGED, relevance-sorted result after the
 * (profile, agent) fan-out. The per-request limit alone is not enough — the
 * fan-out issues one request per pair (and experts return global rows for
 * every pair), so the union routinely exceeds `limit`. The real ceiling is
 * the post-merge `.slice(0, SEARCH_RESULT_LIMIT)` in each feature's api.ts.
 */
export const SEARCH_RESULT_LIMIT = 100;
