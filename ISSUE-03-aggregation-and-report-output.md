# Issue #3: Phase 4 + Phase 5 — Data aggregation & report output (JSON + CSV)

**Labels:** `phase-4`, `phase-5`, `streams`, `core`
**Milestone:** Core Engine
**Estimate:** 1–2 days

---

## Summary

Two tightly related pieces that turn the raw fetch results from
[`fetchAllUsersParallel`](src/github.js) into the tool's actual deliverable:

1. **`src/aggregate.js`** — replace the `aggregateAll` stub with pure, side-effect-free
   functions that reduce each user's repo list into `{ totalStars, topLanguage,
   mostRecentRepo, repoCount }`.
2. **`src/report.js`** — replace the `writeReports` stub with real output: a
   `JSON.stringify` dump for `report.json`, and a hand-rolled, stream-based writer for
   `report.csv` (no giant in-memory string).

By the end of this issue, `node src/index.js` produces a `report.json` and a
`report.csv` that both correctly summarize every fetched user, and `src/index.js` is
wired end-to-end: parse args → load config → fetch → aggregate → write reports.

---

## Background / Why

- Phase 4 is a deliberate pure-function exercise: no `fetch`, no `fs`, nothing async.
  Feeding it a hardcoded fake dataset and checking the numbers by hand is the whole
  point — it's what makes this code trivially unit-testable later.
- Phase 5's CSV writer is the actual lesson of this issue. Building one giant string
  and writing it once works fine at 20 users and teaches you nothing; using
  `fs.createWriteStream` and writing row-by-row is how you'd have to do it at
  real scale (millions of rows), and it's worth feeling the API once — including the
  `finish`/`error` event dance and wrapping it in a `Promise` so `index.js` can `await`
  it cleanly.
- `fetchAllUsersParallel` already returns a settled-per-user shape
  (`{ username, status: 'ok' | 'error', repos?, error? }` — see [src/github.js](src/github.js)).
  `aggregateAll` needs to consume that shape directly, including the `status: 'error'`
  entries, without crashing.

---

## Scope

### In scope
- `aggregateUserStats(reposArray)` — pure function, one user's repos → stats
- `aggregateAll(usersData)` — array of `fetchAllUsersParallel` results → array of
  per-user stat objects (carrying failed users through, not silently dropping them)
- `writeJsonReport(data, path)`
- `writeCsvReport(data, path)` via `fs.createWriteStream`
- Wiring `src/index.js`'s `main()` to call aggregate → report after the existing fetch
  step

### Out of scope (later issues)
- Any change to `fetchAllUsersParallel`'s result shape (Phase 3, already merged)
- `--token` / authenticated requests (Phase 7 stretch)
- Colorized/pretty console summary output beyond what's already in `index.js`

---

## Phase 4 — Data Aggregation

### Tasks

- [ ] Implement `aggregateUserStats(reposArray)` in `src/aggregate.js`:
  - `repoCount` — `reposArray.length`
  - `totalStars` — `reduce` summing `stargazers_count` across all repos
  - `topLanguage` — `reduce`/`map`+count into a language→count map, then the key with
    the highest count (use raw `language` value, including `null` for repos with none —
    document how you handle that case, e.g. excluding `null` from the tally)
  - `mostRecentRepo` — the repo with the latest `updated_at`, reduced to `{ name, updatedAt }`
  - Use `map`/`filter`/`reduce` — no imperative `for` loops where a chain reads cleaner
- [ ] Handle the **zero-repos** edge case explicitly: `reposArray.length === 0` must not
      throw (no `.reduce` without an initial value) — return
      `{ totalStars: 0, topLanguage: null, mostRecentRepo: null, repoCount: 0 }`
- [ ] Implement `aggregateAll(usersData)`:
  - `usersData` is the array coming straight out of `fetchAllUsersParallel` — entries
    with `status: 'ok'` get run through `aggregateUserStats(entry.repos)`; entries with
    `status: 'error'` pass through as-is (e.g. `{ username, status: 'error', error }`,
    no stats) so a failed fetch doesn't crash the whole aggregation step or vanish
    silently from the report
  - Returns one array, same length/order as the input, each entry either the stats
    shape (merged with `username`/`status: 'ok'`) or the error passthrough
- [ ] Zero `fetch`/`fs` imports anywhere in `src/aggregate.js` — keep it pure and
      synchronous so it's trivially unit-testable in isolation

### Phase 4 checkpoint

Feed `aggregateUserStats` a hardcoded fake repo array (no network) and confirm by hand:

```js
const fakeRepos = [
  { stargazers_count: 10, language: 'JavaScript', name: 'a', updated_at: '2024-01-01T00:00:00Z' },
  { stargazers_count: 5, language: 'JavaScript', name: 'b', updated_at: '2025-06-01T00:00:00Z' },
  { stargazers_count: 3, language: 'Python', name: 'c', updated_at: '2023-01-01T00:00:00Z' },
];
// expect: { totalStars: 18, topLanguage: 'JavaScript', mostRecentRepo: { name: 'b', updatedAt: '2025-06-01T00:00:00Z' }, repoCount: 3 }

aggregateUserStats([]);
// expect: { totalStars: 0, topLanguage: null, mostRecentRepo: null, repoCount: 0 } — no throw
```

---

## Phase 5 — Report Output (JSON + CSV via streams)

### Tasks

- [ ] `writeJsonReport(data, path)` in `src/report.js`:
  - `JSON.stringify(data, null, 2)` + `fs.promises.writeFile(path, json)`
  - resolves when the write completes, rejects (don't swallow) on write failure
- [ ] `writeCsvReport(data, path)` using `fs.createWriteStream` — **not** a single
      in-memory string:
  - write the header row first (`username,repoCount,totalStars,topLanguage,mostRecentRepo,updatedAt` or similar — include a way to represent failed users, e.g. an `error` column left blank for successes)
  - loop through `data`, `stream.write(rowString)` per user — one `write()` call per row,
    not one call for the whole file
  - properly close with `stream.end()`
  - wrap the whole thing in a `Promise` that resolves on the stream's `finish` event and
    rejects on its `error` event, so callers can `await writeCsvReport(...)` cleanly
- [ ] CSV escaping: any field containing a comma, a double quote, or a newline must be
      wrapped in `"..."` with internal `"` doubled to `""` (standard CSV quoting) — repo
      names and error messages are the realistic case that trips this up
- [ ] `writeReports(data, output)` — the existing exported entry point — calls both
      writers (e.g. `${output}.json` and `${output}.csv`) and resolves once both are
      done (`Promise.all` is fine here — writing two independent files has no ordering
      dependency)
- [ ] Wire `src/index.js`'s `main()`: after the existing fetch step, call
      `aggregateAll(results)` then `await writeReports(stats, options.output)`, and log
      the two output paths on success

### Phase 5 checkpoint

```bash
node src/index.js --config repos.json --output report
```
- `report.json` and `report.csv` both exist after the run
- `report.json` is valid JSON (`node -e "JSON.parse(require('fs').readFileSync('report.json'))"` doesn't throw)
- `report.csv` opens cleanly in a spreadsheet app (Excel/Sheets/LibreOffice) — one row
  per user, correct headers, no column misalignment even for repo names with commas

---

## Acceptance criteria

1. `aggregateUserStats([])` returns the zero-value shape above and never throws.
2. `aggregateUserStats` and `aggregateAll` contain no `fetch`, `fs`, or other I/O calls —
   verified by inspection, and ideally by a unit test that passes a hardcoded fixture
   with no network/mocking required.
3. `aggregateAll` preserves every entry from its input (same length), passing failed
   (`status: 'error'`) users through instead of dropping or crashing on them.
4. `writeJsonReport` produces a file that round-trips through `JSON.parse` unchanged.
5. `writeCsvReport` uses `fs.createWriteStream` and writes row-by-row (not one
   `writeFile` call with a pre-built string) — verified by inspection.
6. `writeCsvReport`'s promise resolves only after the stream's `finish` event, and
   rejects on the stream's `error` event.
7. CSV fields containing commas, quotes, or newlines are correctly escaped and the file
   opens without column misalignment in a real spreadsheet app.
8. `node src/index.js` (happy path, valid config) exits 0 having written both files, and
   the console reports where they were written.

---

## Manual test matrix

| Scenario | Expected |
| --- | --- |
| Hardcoded fixture, 3 repos, mixed languages | `aggregateUserStats` totals/top-language/most-recent match hand calculation |
| User with zero repos | `{ totalStars: 0, topLanguage: null, mostRecentRepo: null, repoCount: 0 }`, no throw |
| `aggregateAll` on a `fetchAllUsersParallel`-shaped array with one `status: 'error'` entry | error entry passed through unchanged, others aggregated normally, array length unchanged |
| Full run against `repos.json` (3–20 users) | `report.json` + `report.csv` both written, both valid |
| A repo name containing a comma (e.g. fork of a repo named `"foo, bar"`) | CSV row still parses as the correct number of columns when opened in a spreadsheet |
| Delete `report.json`/`report.csv` mid-run permission-denied on output dir | rejected promise surfaces a clean error in `index.js`, not an unhandled rejection |

---

## Notes for the implementer

- `mostRecentRepo`'s reduce needs an explicit seed (`null` or the first element) and a
  comparator on `new Date(updated_at)` — don't assume the API returns repos pre-sorted
  by `updated_at` (it's sorted by `pushed_at` if `sort` isn't specified, which is close
  but not the same field).
- `topLanguage` ties (two languages with equal counts): document your tie-break rule
  (e.g. "first one encountered wins" via stable `reduce` order) rather than leaving it
  implicit.
- Keep `writeCsvReport`'s row-building (turning one stats object into an escaped CSV
  line) as its own small helper function — it's the part worth unit testing in
  isolation, separate from the stream plumbing around it.
- This issue's CSV writer is the only place in the whole project that touches
  backpressure conceptually: at 20 rows you will never see `stream.write()` return
  `false`, but know why the `finish`-event-wrapped-in-a-Promise pattern here is exactly
  what you'd still reach for at a million rows — you're not adding drain-handling code,
  just building the habit of writing stream code that would tolerate it.
