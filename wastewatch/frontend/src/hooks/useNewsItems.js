/**
 * hooks/useNewsItems.js
 * ---------------------
 * Central re-export for the scope-aware news items hook.
 * Compatible with existing imports across the project.
 */

export {
  useNewsItems,
  resolveScopeParams,
  createScopeSignature,
  executeScopedFetch,
  readScopeCache,
  writeScopeCache,
  getScopeCacheKey,
  BASE_CACHE_KEY,
} from '../pages/news/hooks/useNewsItems'
