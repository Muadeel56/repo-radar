# Repo Radar — Project Build Docs

**Goal:** Master raw Node.js fundamentals (event loop, async patterns, streams, fs, error handling) by building a CLI tool that aggregates GitHub activity stats — no frameworks, no ORM, no external HTTP/CLI libraries until you've felt the pain of doing it raw.

**Estimated time:** 3–5 focused days
**Tech constraints:** Node.js (LTS), ESM only (`type: module`), zero dependencies until Phase 6 (polish)

---

## Phase 0 — Project Setup

### Todos
- [ ] `mkdir repo-radar && cd repo-radar && npm init -y`
- [ ] Add `"type": "module"` to `package.json`
- [ ] Create folder structure:
  ```
  repo-radar/
  ├── src/
  │   ├── index.js
  │   ├── config.js
  │   ├── github.js
  │   ├── aggregate.js
  │   ├── report.js
  │   └── utils/
  │       └── logger.js
  ├── repos.json
  ├── package.json
  └── README.md
  ```
- [ ] Create a sample `repos.json`:
  ```json
  {
    "users": ["torvalds", "sindresorhus", "gaearon"]
  }
  ```
- [ ] Git init + `.gitignore` (node_modules, *.json reports, .env)

**Checkpoint:** `node src/index.js` runs without crashing (even if it does nothing yet).

---

## Phase 1 — Raw Argument Parsing (no `commander`, no `yargs`)

Why: `process.argv` is ugly on purpose. You need to understand what libraries like `commander` actually abstract away before you use them blindly.

### Steps
1. Log `process.argv` raw, understand the first two entries are node path + script path.
2. Write a minimal parser supporting:
   - `--config <path>` (default: `./repos.json`)
   - `--output <name>` (default: `./report`)
   - `--verbose` (boolean flag)
3. Handle missing/malformed flags with a clear usage message, not a crash.

### Todos
- [ ] `src/index.js`: parse argv into a clean `options` object
- [ ] Support `--help` / `-h` printing usage and exiting
- [ ] Support flags in any order (`--verbose --config x.json` and `--config x.json --verbose` both work)
- [ ] Exit with non-zero code on invalid input (`process.exit(1)`)

**Checkpoint:** `node src/index.js --config repos.json --output report --verbose` logs a correctly parsed options object.

---

## Phase 2 — Config Reading with `fs/promises`

### Steps
1. First, write a version using **callback-style `fs.readFile`** — feel the pyramid/awkwardness.
2. Rewrite using `fs/promises` + `async/await`. Compare readability directly.
3. Validate the config shape (must have a `users` array of strings, non-empty).
4. Handle: file not found, invalid JSON, empty user list — each with a distinct, useful error message.

### Todos
- [ ] `src/config.js`: `loadConfig(path)` → returns parsed + validated config object
- [ ] Throw custom errors (e.g. `class ConfigError extends Error`) instead of generic `Error`
- [ ] Catch `ENOENT` specifically and give a human-readable "file not found at X" message
- [ ] Catch `SyntaxError` from `JSON.parse` and say "invalid JSON in config"

**Checkpoint:** Deleting/corrupting `repos.json` produces a clean one-line error, not a stack trace.

---

## Phase 3 — GitHub API Calls (the async core)

This is the heart of the project. Take your time here.

### Steps
1. **Sequential first (deliberately slow):** loop through users, `await fetch(...)` one at a time. Time it.
2. **Parallel with `Promise.all`:** fire all requests at once. Time it again, compare.
3. **Break it on purpose:** test with 15–20 users to trigger GitHub's unauthenticated rate limit (60 req/hr). Observe the 403 response and rate-limit headers (`x-ratelimit-remaining`, `x-ratelimit-reset`).
4. **Build a concurrency-limited queue** — no library. A simple pattern:
   - Keep a counter of in-flight requests
   - Only start a new request when under the limit (e.g. max 5 concurrent)
   - Use an array of promises + `Promise.race` or a manual worker-pool loop
5. **Add retry with exponential backoff** for failed/rate-limited requests (retry after `2^attempt * base_delay`, cap at 3 attempts).

### Todos
- [ ] `src/github.js`: `fetchUserRepos(username)` — single user, raw fetch
- [ ] `fetchAllUsers(usernames)` — sequential version (for comparison/learning only)
- [ ] `fetchAllUsersParallel(usernames, concurrency = 5)` — the real one, queue-based
- [ ] Retry wrapper: `withRetry(fn, { attempts: 3, baseDelay: 500 })`
- [ ] Handle non-200 responses distinctly: 404 (bad username), 403 (rate limit), 5xx (GitHub down)
- [ ] Log rate-limit headers when `--verbose` is on

**Checkpoint:** Running against 20 users doesn't crash on rate limits — it backs off and eventually completes (or fails gracefully with a clear message on which users failed).

---

## Phase 4 — Data Aggregation (pure functions)

No I/O here — just transforming data. Keep every function pure (input in, output out, no side effects) so it's trivially testable later.

### Steps
1. For each user's repo list, compute:
   - Total stars across all repos
   - Most-used language (by repo count)
   - Most recently updated repo (name + date)
   - Total repo count
2. Write this with `map`/`filter`/`reduce` — avoid imperative `for` loops where a functional chain reads cleaner.

### Todos
- [ ] `src/aggregate.js`: `aggregateUserStats(reposArray)` → `{ totalStars, topLanguage, mostRecentRepo, repoCount }`
- [ ] `aggregateAll(usersData)` → array of per-user stat objects
- [ ] Handle edge case: user with zero repos (don't divide by zero / crash on `.reduce` with no initial value)
- [ ] Unit-testable in isolation — no `fetch`, no `fs` calls inside this file

**Checkpoint:** Feed it a hardcoded fake dataset (no network needed) and confirm stats are correct by hand.

---

## Phase 5 — Report Output (JSON + CSV via Streams)

### Steps
1. **JSON output:** easy — `JSON.stringify(data, null, 2)` + `fs.writeFile`.
2. **CSV output — the important part:** don't build one giant string in memory and write it once. Use `fs.createWriteStream` and write row-by-row.
   - Write the header row first
   - Loop through aggregated stats, `stream.write(rowString)` per user
   - Properly close the stream (`stream.end()`) and listen for `finish`/`error` events
3. Read up on backpressure conceptually: what happens if `write()` returns `false` (the internal buffer is full) — even though at this scale you won't hit it, know why it matters at real scale (millions of rows).

### Todos
- [ ] `src/report.js`: `writeJsonReport(data, path)`
- [ ] `writeCsvReport(data, path)` using `createWriteStream`
- [ ] CSV: escape commas/quotes in values properly (e.g. repo names with commas)
- [ ] Wrap stream completion in a Promise so `index.js` can `await` it cleanly
- [ ] Confirm both files are written correctly and are valid (open CSV in a spreadsheet app to sanity check)

**Checkpoint:** `report.json` and `report.csv` both exist, both are correctly formatted, CSV opens cleanly in Excel/Sheets.

---

## Phase 6 — Error Handling Pass (end-to-end)

Go back through the whole flow and make sure every failure mode exits cleanly.

### Todos
- [ ] No internet connection → clear message, exit code 1
- [ ] Invalid GitHub username → skip that user, log a warning, continue with the rest (don't crash the whole run)
- [ ] Rate limit exhausted even after retries → clear message telling user to wait or use a token
- [ ] Malformed/missing config → already handled in Phase 2, re-verify
- [ ] Output directory doesn't exist → create it (`fs.mkdir` with `recursive: true`) or fail clearly
- [ ] Wrap the whole `main()` in a top-level try/catch so nothing ever dumps a raw stack trace to the user

---

## Phase 7 — Polish (optional but recommended)

### Todos
- [ ] `--verbose` flag prints progress per user as requests complete (bonus: use an `EventEmitter` to decouple progress logging from the fetch logic)
- [ ] Colored terminal output using raw ANSI codes first (e.g. `\x1b[32m%s\x1b[0m` for green) — understand it before reaching for `chalk`
- [ ] `src/utils/logger.js`: a tiny logger with `info`/`warn`/`error`/`debug` (debug only prints if `--verbose`)
- [ ] Add a `--concurrency <n>` flag to make the queue limit configurable
- [ ] README.md: usage instructions, sample config, sample output

---

## Stretch Goals (only after core is solid)

- [ ] Add a GitHub personal access token (`--token` or `.env`) to raise the rate limit from 60/hr to 5000/hr — introduces `.env` handling without a library first (parse it yourself), then optionally swap to `dotenv`
- [ ] Swap raw `fetch` for `worker_threads` experiment: move the aggregation step (Phase 4) into a worker thread just to see the messaging overhead — not because it's needed at this scale, but to feel how `worker_threads` communication works
- [ ] Package it as a real CLI: add a `bin` field in `package.json` + shebang line, `npm link` it, run it as `repo-radar` globally

---

## Definition of Done

Running:
```bash
node src/index.js --config repos.json --output report --verbose
```
Should:
1. Read and validate the config
2. Fetch repo data for all listed users, respecting concurrency limits and retrying on failure
3. Aggregate stats per user
4. Write both `report.json` and `report.csv`
5. Handle at least: bad username, no internet, rate limit — all without a raw stack trace
6. Complete without crashing on a list of 20+ users

---

## What You Should Walk Away Understanding

- The real difference between callback-style and promise-style async code (you wrote both)
- Why `Promise.all` isn't always what you want (unbounded concurrency risk) and how to build a simple concurrency limiter by hand
- Retry/backoff as a pattern, not just a library call
- Why streams exist for output — even if this project doesn't strictly need them at this data size
- How to structure a Node project without a framework imposing structure on you
