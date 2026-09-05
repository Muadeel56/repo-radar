# repo-radar

A zero-dependency command-line tool that reads a list of GitHub usernames from a JSON
config file, fetches each user's public repositories (concurrency-limited, with
automatic retry/backoff on rate limits and server errors), aggregates activity stats
(total stars, top language, most recently updated repo, repo count), and writes the
results to `report.json` and `report.csv`. It is built with raw Node.js (ESM, native
`fetch`, `fs/promises`, streams, `EventEmitter`) as a learning exercise — no CLI, HTTP,
or config frameworks, and no `chalk` (colored output uses raw ANSI escape codes).

## Requirements

- Node.js >= 18 (native `fetch`)

## Quick start

```
git clone <this repo>
cd repo-radar
node src/index.js --config repos.json --verbose
```

That's it — no `npm install` needed (zero dependencies). It reads `repos.json` from the
repo root by default and writes `report.json` + `report.csv` alongside it.

## Usage

```
node src/index.js [options]

Options:
  --config <path>       Path to the JSON config file      (default: ./repos.json)
  --output <name>       Base name/path for report files   (default: ./report)
  --verbose             Print progress and debug details
  --concurrency <n>     Max parallel GitHub requests      (default: 5)
  -h, --help            Show this help and exit

Examples:
  node src/index.js
  node src/index.js --config repos.json --output report --verbose
  node src/index.js --config=./data/repos.json
  node src/index.js --concurrency 10
```

With `--verbose`, per-user progress streams to the terminal as each request completes,
color-coded green for success and red for failure:

```
✓ torvalds (12 repos)
✓ sindresorhus (30 repos)
✗ this-user-does-not-exist — GitHub user not found: this-user-does-not-exist

Done: 2 succeeded, 1 failed out of 3 users.
Reports written to ./report.json and ./report.csv
```

A bad username never aborts the run — it's reported per-user and the run continues with
exit code 0. A run only exits non-zero for genuine failures: bad arguments, a
malformed/missing config file, no reachable network at all, or a failure writing the
report files.

## Sample config (`repos.json`)

```json
{
  "users": ["torvalds", "sindresorhus", "gaearon"]
}
```

## Sample output

`report.json` (truncated):

```json
[
  {
    "username": "torvalds",
    "status": "ok",
    "totalStars": 259760,
    "topLanguage": "C",
    "mostRecentRepo": {
      "name": "linux",
      "updatedAt": "2026-09-05T08:34:03Z"
    },
    "repoCount": 12
  },
  {
    "username": "this-user-does-not-exist",
    "status": "error",
    "error": "GitHub user not found: this-user-does-not-exist"
  }
]
```

`report.csv`:

```csv
username,status,repoCount,totalStars,topLanguage,mostRecentRepo,updatedAt,error
torvalds,ok,12,259760,C,linux,2026-09-05T08:34:03Z,
this-user-does-not-exist,error,,,,,,GitHub user not found: this-user-does-not-exist
```

## Error handling

Every failure mode exits cleanly with a clear, single-line message instead of a raw
stack trace:

| Situation | Behavior |
| --- | --- |
| No internet connection | `Network error: could not reach api.github.com. Check your internet connection.` (exit 1) |
| One invalid username among valid ones | Logged as a per-user warning, run continues (exit 0) |
| Rate limit exhausted after retries | Message includes the reset time and suggests using a GitHub token |
| Malformed/missing config | Clear message naming the problem (missing file, invalid JSON, empty/invalid `users`) (exit 1) |
| Output directory doesn't exist | Created automatically (`fs.mkdir(..., { recursive: true })`) |
| Any other unexpected error | Caught by a top-level safety net — printed as one line, never a raw stack trace (exit 1) |

## Development

```
npm test          # runs the test suite (node --test)
node src/index.js --help
```
