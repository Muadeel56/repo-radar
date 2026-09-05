// Phase 4: pure functions that transform raw repo lists into per-user stats.
// No `fetch`, no `fs`, nothing async — this module is trivially unit-testable
// with a hardcoded fixture and no mocking.

/**
 * Reduce one user's raw GitHub repo list into summary stats.
 *
 * - `totalStars` sums `stargazers_count` across all repos.
 * - `topLanguage` is the most-common raw `language` value; repos with
 *   `language: null` (or missing) are excluded from the tally entirely.
 *   Ties are broken by first-encountered order (the language that appears
 *   earliest in `reposArray` wins a tie).
 * - `mostRecentRepo` is picked by comparing `updated_at` as a `Date`, not by
 *   assuming the input is pre-sorted (the GitHub API sorts by `pushed_at` by
 *   default, which is a different field).
 *
 * @param {Array<object>} reposArray - raw GitHub API repo objects
 * @returns {{ totalStars: number, topLanguage: string|null, mostRecentRepo: {name: string, updatedAt: string}|null, repoCount: number }}
 */
export function aggregateUserStats(reposArray) {
  const repoCount = reposArray.length;

  if (repoCount === 0) {
    return { totalStars: 0, topLanguage: null, mostRecentRepo: null, repoCount: 0 };
  }

  const totalStars = reposArray.reduce((sum, repo) => sum + (repo.stargazers_count ?? 0), 0);

  const languageCounts = reposArray.reduce((counts, repo) => {
    if (repo.language != null) {
      counts.set(repo.language, (counts.get(repo.language) ?? 0) + 1);
    }
    return counts;
  }, new Map());

  const topLanguage = [...languageCounts].reduce(
    (best, [language, count]) => (count > best.count ? { language, count } : best),
    { language: null, count: 0 }
  ).language;

  const mostRecentRepo = reposArray.reduce((best, repo) => {
    if (best === null) return repo;
    return new Date(repo.updated_at) > new Date(best.updated_at) ? repo : best;
  }, null);

  return {
    totalStars,
    topLanguage,
    mostRecentRepo: { name: mostRecentRepo.name, updatedAt: mostRecentRepo.updated_at },
    repoCount,
  };
}

/**
 * Map `fetchAllUsersParallel`'s settled results into per-user stats.
 *
 * Entries with `status: 'ok'` are run through `aggregateUserStats`; entries
 * with `status: 'error'` pass through unchanged so a failed fetch doesn't
 * crash aggregation or silently vanish from the report. Returned array has
 * the same length/order as `usersData`.
 *
 * @param {Array<{username: string, status: 'ok'|'error', repos?: Array<object>, error?: string}>} usersData
 * @returns {Array<object>}
 */
export function aggregateAll(usersData) {
  return usersData.map((entry) => {
    if (entry.status === 'error') {
      return entry;
    }
    return { username: entry.username, status: 'ok', ...aggregateUserStats(entry.repos) };
  });
}
