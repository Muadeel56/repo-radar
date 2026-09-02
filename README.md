# repo-radar

A zero-dependency command-line tool that reads a list of GitHub usernames from a JSON
config file, fetches each user's public repositories, aggregates activity stats (total
stars, top language, most recently updated repo, repo count), and writes the results to
`report.json` and `report.csv`. It is built with raw Node.js (ESM, native `fetch`,
`fs/promises`, streams) as a learning exercise — no CLI, HTTP, or config frameworks.

## Requirements

- Node.js >= 18 (native `fetch`)

## Usage

```
node src/index.js [options]

Options:
  --config <path>    Path to the JSON config file      (default: ./repos.json)
  --output <name>    Base name/path for report files   (default: ./report)
  --verbose          Print progress and debug details
  -h, --help         Show this help and exit

Examples:
  node src/index.js
  node src/index.js --config repos.json --output report --verbose
  node src/index.js --config=./data/repos.json
```

> Only argument parsing is implemented so far (Phase 0 + Phase 1). Config loading, GitHub
> fetching, aggregation, and report writing arrive in later phases.
