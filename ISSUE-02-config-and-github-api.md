# Issue #2: Phase 2 + Phase 3 — Config loading & concurrency-limited GitHub API calls

**Labels:** `phase-2`, `phase-3`, `async`, `core`
**Milestone:** Core Engine
**Estimate:** 2–3 days

---

## Summary

Two tightly related pieces of the async core:

1. **`src/config.js`** — replace the `loadConfig` stub with a real implementation that
   reads `repos.json` via `fs/promises`, validates its shape, and throws clean, typed
   errors instead of leaking stack traces.
2. **`src/github.js`** — replace the `fetchUserRepos` stub with the full fetch layer:
   a single-user fetch, a sequential baseline (for comparison), a concurrency-limited
   parallel queue (the real implementation), and a retry-with-backoff wrapper — all
   built with zero dependencies (raw `fetch`, no `axios`/`p-limit`/`bottleneck`).

By the end of this issue, `repo-radar` can load a config of 20 usernames and fetch all
of their repos without crashing on GitHub's unauthenticated rate limit, and a missing or
corrupt `repos.json` produces one clean line of output, not a stack trace.

---

## Background / Why

- `fs.readFile` callback style produces a "pyramid" once you need file → parse → validate
  → act. Doing it once by hand motivates `fs/promises` + `async/await` immediately.
- GitHub's unauthenticated REST API caps you at **60 requests/hour** per IP. Firing 20
  requests with `Promise.all` either works fine (if under the limit) or fails all at
  once with 403s — neither teaches you how to *handle* the limit. A hand-rolled
  concurrency queue + retry/backoff is the actual lesson of Phase 3.
- Distinguishing error types (`ENOENT`, `SyntaxError`, 404 vs 403 vs 5xx) instead of
  catching everything as "an error happened" is the core habit this issue builds.

---

## Scope

### In scope
- `loadConfig(path)` reading + validating `repos.json`
- Custom error classes for config problems
- `fetchUserRepos(username)` — single raw fetch
- `fetchAllUsers(usernames)` — sequential (comparison/learning artifact, kept in the repo)
- `fetchAllUsersParallel(usernames, concurrency = 5)` — the queue-based real version
- `withRetry(fn, { attempts, baseDelay })` — exponential backoff wrapper
- Distinct handling of 404 / 403 / 5xx / network errors
- `--verbose` logging of rate-limit headers

### Out of scope (later issues)
- Aggregating/summarizing fetched repo data (Phase 4)
- Writing `report.json` / `report.csv` (Phase 5)
- Adding a GitHub token / auth header (Phase 7 stretch) — but see notes below on
  designing `fetchUserRepos` so a token is a one-line addition later
- Anything in `src/index.js` beyond wiring these two modules together at the end

---

## Phase 2 — Config Reading

### Tasks

- [ ] Write a throwaway callback-style version of the file read first (scratch file or
      a comment block) — feel the nesting, then delete it. This is a learning step, not
      a deliverable.
- [ ] Implement `loadConfig(path)` in `src/config.js` using `fs/promises` + `async/await`
- [ ] Define custom error classes (all extend `Error`, all set `this.name`):
  ```js
  export class ConfigError extends Error {}
  export class ConfigNotFoundError extends ConfigError {}
  export class ConfigParseError extends ConfigError {}
  export class ConfigValidationError extends ConfigError {}
  ```
- [ ] Catch `ENOENT` specifically from the `readFile` call →
      throw `new ConfigNotFoundError(\`Config file not found at ${path}\`)`
- [ ] Catch `SyntaxError` from `JSON.parse` →
      throw `new ConfigParseError(\`Invalid JSON in config file at ${path}\`)`
- [ ] Validate the parsed shape:
  - must be an object with a `users` key
  - `users` must be an `Array`
  - `users` must be **non-empty**
  - every entry must be a non-empty `string` (reject numbers, `null`, `""`, duplicates
    optional — document your choice)
  - on any failure → throw `new ConfigValidationError('<specific reason>')`, e.g.
    `"repos.json must contain a non-empty \"users\" array of strings"`
- [ ] Re-throw any other unexpected error wrapped as `ConfigError` so nothing raw
      escapes `loadConfig`
- [ ] `loadConfig` resolves with the validated `{ users: string[] }` object (or the full
      parsed object if you later add more config keys — keep it forward-compatible)

### Suggested shape

```js
import { readFile } from 'node:fs/promises';

export class ConfigError extends Error {}
export class ConfigNotFoundError extends ConfigError {}
export class ConfigParseError extends ConfigError {}
export class ConfigValidationError extends ConfigError {}

export async function loadConfig(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new ConfigNotFoundError(`Config file not found at ${path}`);
    }
    throw new ConfigError(`Could not read config file at ${path}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigParseError(`Invalid JSON in config file at ${path}`);
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.users)) {
    throw new ConfigValidationError(`repos.json must contain a "users" array`);
  }
  if (parsed.users.length === 0) {
    throw new ConfigValidationError(`"users" array in ${path} must not be empty`);
  }
  if (!parsed.users.every((u) => typeof u === 'string' && u.trim().length > 0)) {
    throw new ConfigValidationError(`Every entry in "users" must be a non-empty string`);
  }

  return parsed;
}
```

### Phase 2 checkpoint

```bash
node src/index.js --config repos.json          # loads fine
mv repos.json repos.json.bak && node src/index.js   # "Config file not found at ./repos.json", exit 1, no stack trace
echo '{ bad json' > repos.json && node src/index.js # "Invalid JSON in config file at ./repos.json"
echo '{"users": []}' > repos.json && node src/index.js  # "\"users\" array ... must not be empty"
mv repos.json.bak repos.json                    # restore
```

Each failure is **one line on stderr**, exit code `1` — caught in `src/index.js`'s
`main()` by checking `err instanceof ConfigError` (or a broader catch-all fallback).

---

## Phase 3 — GitHub API Calls

This is the heart of the project — take your time here.

### Tasks

- [ ] `fetchUserRepos(username)` in `src/github.js` — single raw `fetch()` call to
      `https://api.github.com/users/${username}/repos`, returns parsed JSON on 200
- [ ] Throw a typed error on non-200, carrying the status and username:
  ```js
  export class GitHubApiError extends Error {
    constructor(message, { status, username } = {}) {
      super(message);
      this.name = 'GitHubApiError';
      this.status = status;
      this.username = username;
    }
  }
  ```
  - `404` → `"GitHub user not found: <username>"`
  - `403` (check `x-ratelimit-remaining: 0`) → `"Rate limited fetching <username> (resets at <time>)"`
  - `5xx` → `"GitHub API error (<status>) fetching <username>"`
  - network failure (fetch rejects) → wrap with username context, don't leak raw
- [ ] Log rate-limit headers (`x-ratelimit-remaining`, `x-ratelimit-limit`,
      `x-ratelimit-reset`) when `--verbose` is on — pass a `verbose` flag through or use
      the shared `logger` from `src/utils/logger.js`
- [ ] `fetchAllUsers(usernames)` — **sequential**, `for...of` + `await` one at a time.
      Keep this in the codebase (behind a flag or just as a documented "slow path") for
      comparison/learning. Time it with `console.time`/`console.timeEnd`.
- [ ] `withRetry(fn, { attempts = 3, baseDelay = 500 } = {})` — generic wrapper:
  - calls `fn()`, catches failures
  - retries on `403` (rate limit) and `5xx` only — **not** on `404` (permanent, no point
    retrying a bad username)
  - delay before retry `n` = `baseDelay * 2 ** (n - 1)` (i.e. 500ms, 1000ms, 2000ms for
    the 3-attempt default), via `await new Promise(r => setTimeout(r, delay))`
  - after `attempts` failures, rethrow the last error
- [ ] `fetchAllUsersParallel(usernames, concurrency = 5)` — the real implementation:
  - a worker-pool pattern: `concurrency` workers pull the next username off a shared
    index/queue until it's empty, each worker wraps its call in `withRetry`
  - returns settled results for *every* user — don't let one failure abort the batch;
    use a shape like `{ username, status: 'ok' | 'error', repos?, error? }` (a manual
    `Promise.allSettled`-style result, since you're not using `Promise.all` directly)
  - measure it against `fetchAllUsers` timing on the same input

### Suggested worker-pool shape

```js
export async function fetchAllUsersParallel(usernames, concurrency = 5) {
  const results = new Array(usernames.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < usernames.length) {
      const i = nextIndex++;
      const username = usernames[i];
      try {
        const repos = await withRetry(() => fetchUserRepos(username));
        results[i] = { username, status: 'ok', repos };
      } catch (error) {
        results[i] = { username, status: 'error', error: error.message };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, usernames.length) }, worker);
  await Promise.all(workers);
  return results;
}
```

### Break it on purpose

- [ ] Bump `repos.json` to 15–20 usernames and run the sequential and parallel
      (concurrency 5) versions back to back
- [ ] Confirm you can trigger a real `403` from GitHub (unauthenticated limit is 60/hr —
      running the suite a few times in the same hour is usually enough); observe
      `x-ratelimit-remaining` hit `0` and `x-ratelimit-reset` in the response headers
- [ ] Confirm `withRetry` backs off and either recovers (limit window rolls over) or
      exhausts attempts and reports that *specific* user as failed — without crashing
      the whole run

### Phase 3 checkpoint

```bash
node src/index.js --config repos.json --verbose
```
With 20 users configured: does not crash on a rate limit. It backs off per the retry
policy and finishes with either full success or a clear per-user list of which
usernames failed and why (e.g. `sindresorhus: Rate limited (exhausted 3 attempts)`).

---

## Acceptance criteria

1. `loadConfig` never throws a raw `Error`/`SyntaxError`/`ENOENT` — only the four typed
   `Config*Error` classes, each with a specific, human-readable message.
2. Deleting or corrupting `repos.json` produces exactly one line of output in
   `src/index.js`, not a stack trace, and exits `1`.
3. `fetchUserRepos` distinguishes 404 / 403 / 5xx / network failure with different
   error messages, each naming the username.
4. `fetchAllUsers` (sequential) and `fetchAllUsersParallel` (concurrency 5) both exist,
   both return per-user results, and a timing comparison between them is recorded
   somewhere (README, code comment, or console output) for at least 10 users.
5. `withRetry` retries only on 403/5xx, uses `baseDelay * 2^(attempt-1)` backoff, caps
   at the configured `attempts`, and does not retry 404s.
6. Running against 15–20 users completes without an unhandled rejection or crash, even
   when GitHub returns 403s mid-run — failures are reported per-user, not fatal.
7. `--verbose` prints rate-limit headers per request.

---

## Manual test matrix

| Scenario | Expected |
| --- | --- |
| Valid `repos.json`, 3 users | `loadConfig` resolves, all repos fetched, exit 0 |
| `repos.json` missing | `ConfigNotFoundError`, one-line message, exit 1 |
| `repos.json` has malformed JSON | `ConfigParseError`, one-line message, exit 1 |
| `repos.json` has `"users": []` | `ConfigValidationError`, exit 1 |
| `repos.json` has `"users": [123]` | `ConfigValidationError`, exit 1 |
| Username that doesn't exist on GitHub | per-user `404` error, rest of batch unaffected |
| 20 users, unauthenticated | some `403`s observed, retried, run finishes (success or clear per-user failure list) |
| `--verbose` on | rate-limit headers logged per request |
| Sequential vs. parallel timing | parallel is measurably faster on the same user list |

---

## Notes for the implementer

- Keep `fetchUserRepos` accepting just `(username)` for now, but structure it so an
  `Authorization: token <PAT>` header is a one-line addition when Phase 7 adds
  `--token` — e.g. build headers in one place, don't inline them at the call site.
- `fetchAllUsers` (sequential) is intentionally kept even though `fetchAllUsersParallel`
  supersedes it — it's the "before" side of the readability/perf comparison this phase
  is built to teach. Don't wire it into `src/index.js`'s real path; call it out as a
  learning artifact (a comment or a `--sequential` debug flag is fine).
- Resist reaching for `p-limit`, `bottleneck`, or `axios` — the whole point of the
  worker-pool + `withRetry` is doing it by hand once.
- `Promise.race` against an array of in-flight promises is the classic alternative to
  the worker-pool pattern above; either is acceptable, but the worker-pool tends to be
  simpler to get right — pick one and don't mix strategies.
