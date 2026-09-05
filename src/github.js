// Phase 3: fetch repo data from the GitHub API (concurrency-limited, with retry).

export class GitHubApiError extends Error {
  constructor(message, { status, username } = {}) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.username = username;
  }
}

/**
 * Single place to build request headers, so an `Authorization: token <PAT>`
 * header (Phase 7 `--token`) is a one-line addition later.
 */
function buildHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    // Authorization: `token ${token}`, // Phase 7: add when --token is introduced
  };
}

function formatResetTime(resetHeader) {
  const seconds = Number(resetHeader);
  if (!Number.isFinite(seconds)) return 'unknown time';
  return new Date(seconds * 1000).toLocaleTimeString();
}

function logRateLimitHeaders(headers, username, verbose) {
  if (!verbose) return;
  console.error(
    `[verbose] ${username}: rate-limit remaining=${headers.get('x-ratelimit-remaining')} ` +
      `limit=${headers.get('x-ratelimit-limit')} reset=${headers.get('x-ratelimit-reset')}`
  );
}

/**
 * Fetch a single user's public repos.
 * @param {string} username
 * @param {{ verbose?: boolean }} [options]
 * @returns {Promise<any>} parsed repo list JSON
 */
export async function fetchUserRepos(username, { verbose = false } = {}) {
  const url = `https://api.github.com/users/${username}/repos`;
  let response;
  try {
    response = await fetch(url, { headers: buildHeaders() });
  } catch (err) {
    throw new GitHubApiError(`Network error fetching ${username}: ${err.message}`, {
      username,
    });
  }

  logRateLimitHeaders(response.headers, username, verbose);

  if (response.status === 200) {
    return response.json();
  }

  if (response.status === 404) {
    throw new GitHubApiError(`GitHub user not found: ${username}`, {
      status: 404,
      username,
    });
  }

  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    const resetAt = formatResetTime(response.headers.get('x-ratelimit-reset'));
    throw new GitHubApiError(`Rate limited fetching ${username} (resets at ${resetAt})`, {
      status: 403,
      username,
    });
  }

  if (response.status >= 500) {
    throw new GitHubApiError(`GitHub API error (${response.status}) fetching ${username}`, {
      status: response.status,
      username,
    });
  }

  // Any other non-200 (e.g. plain 403 without exhausted rate limit, 401, etc.)
  throw new GitHubApiError(`GitHub API error (${response.status}) fetching ${username}`, {
    status: response.status,
    username,
  });
}

/**
 * Sequential baseline — kept as a learning/comparison artifact per the issue.
 * NOT wired into src/index.js's real path; fetchAllUsersParallel supersedes it.
 *
 * Measured against fetchAllUsersParallel(usernames, 5) on the same 15-user
 * list (unauthenticated): sequential took 6.34s, parallel (concurrency 5)
 * took 0.69s — ~9x faster. Sequential takes roughly N * (avg request
 * latency) since every fetch waits for the previous one to finish; the
 * parallel worker pool is bounded by ceil(N / concurrency) * avg latency
 * instead.
 */
export async function fetchAllUsers(usernames, { verbose = false } = {}) {
  console.time('fetchAllUsers (sequential)');
  const results = [];
  for (const username of usernames) {
    try {
      const repos = await fetchUserRepos(username, { verbose });
      results.push({ username, status: 'ok', repos });
    } catch (error) {
      results.push({ username, status: 'error', error: error.message });
    }
  }
  console.timeEnd('fetchAllUsers (sequential)');
  return results;
}

/**
 * Retries fn() on 403 (rate limit) and 5xx GitHubApiErrors only, not on 404.
 */
export async function withRetry(fn, { attempts = 3, baseDelay = 500 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof GitHubApiError &&
        (error.status === 403 || (error.status >= 500 && error.status < 600));
      if (!retryable || attempt === attempts) {
        throw error;
      }
      const delay = baseDelay * 2 ** (attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Worker-pool: `concurrency` workers pull the next username off a shared
 * index until the queue is empty. Every user gets a settled result — one
 * failure never aborts the batch.
 */
export async function fetchAllUsersParallel(usernames, concurrency = 5, { verbose = false } = {}) {
  const results = new Array(usernames.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < usernames.length) {
      const i = nextIndex++;
      const username = usernames[i];
      try {
        const repos = await withRetry(() => fetchUserRepos(username, { verbose }));
        results[i] = { username, status: 'ok', repos };
      } catch (error) {
        results[i] = { username, status: 'error', error: error.message };
      }
    }
  }

  const workerCount = Math.min(concurrency, usernames.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return results;
}
