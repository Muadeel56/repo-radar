# Issue #1: Phase 0 + Phase 1 — Project scaffold & raw argument parser

**Labels:** `phase-0`, `phase-1`, `setup`, `good-first-issue`
**Milestone:** Foundations
**Estimate:** 0.5–1 day

---

## Summary

Stand up the `repo-radar` project skeleton (ESM, zero dependencies) and implement a
hand-rolled command-line argument parser in `src/index.js`. No `commander`, no `yargs`,
no `minimist`. The goal is to feel what those libraries abstract away before adopting them.

By the end of this issue, `node src/index.js` runs cleanly and prints a correctly parsed
options object for any valid combination of flags, and prints a helpful usage message
(never a stack trace) for anything invalid.

---

## Background / Why

- `process.argv` is a raw `string[]`. The first two entries are always the Node binary
  path and the script path; real arguments start at index 2.
- Parsing it by hand once teaches you: flag-vs-value association, order independence,
  boolean flags, `--flag=value` vs `--flag value`, `--` terminator, unknown-flag handling,
  and exit codes.
- Everything here stays framework-free. Dependencies are not allowed until Phase 6.

---

## Scope

### In scope
- Directory + file structure
- `package.json` with `"type": "module"`
- Sample `repos.json`
- `.gitignore` and `git init`
- A `parseArgs(argv)` function producing a clean `options` object
- `--help` / `-h` output
- Order-independent flags
- Non-zero exit code on invalid input

### Out of scope (later issues)
- Actually reading the config file (Phase 2)
- Any network calls (Phase 3)
- Report writing (Phase 5)
- `--concurrency` / `--token` flags (Phase 7 / stretch) — but design `parseArgs`
  so adding a flag later is a one-line change

---

## Phase 0 — Tasks

- [ ] `npm init -y` in the project root, then set `"type": "module"` in `package.json`
- [ ] Set `"name": "repo-radar"`, `"version": "0.1.0"`, `"private": true`
- [ ] Add a `"start"` script: `"start": "node src/index.js"`
- [ ] Add an `"engines"` field: `{ "node": ">=18" }` (native `fetch` needs 18+)
- [ ] Create the folder structure below
- [ ] Create sample `repos.json`
- [ ] Create `.gitignore`
- [ ] `git init` + first commit: `chore: project scaffold`
- [ ] `README.md` with a one-paragraph description and a "Usage" placeholder

### Folder structure

```
repo-radar/
├── src/
│   ├── index.js          # entry point + arg parsing (this issue)
│   ├── config.js         # stub: export async function loadConfig(path) {}
│   ├── github.js         # stub
│   ├── aggregate.js      # stub
│   ├── report.js         # stub
│   └── utils/
│       └── logger.js     # stub: export const logger = { info, warn, error, debug }
├── repos.json
├── package.json
├── .gitignore
└── README.md
```

> Stub files should export a named function/object that throws
> `new Error('not implemented')` or just returns. This keeps imports valid as the
> project grows and makes each later phase a "fill in the body" task.

### `repos.json` (sample)

```json
{
  "users": ["torvalds", "sindresorhus", "gaearon"]
}
```

### `.gitignore`

```gitignore
node_modules/
.env
# generated reports
report.json
report.csv
*.report.json
*.report.csv
```

### Phase 0 checkpoint

```bash
node src/index.js
```
Runs and exits `0` without throwing. It's fine if it only prints the parsed
(default) options for now.

---

## Phase 1 — Tasks

- [ ] Log `process.argv` raw once (behind `--verbose` or a temporary line) and confirm
      indices 0 and 1 are the node path and script path
- [ ] Implement `parseArgs(argv)` in `src/index.js` (or `src/args.js` if you prefer;
      keep it a pure function that takes the array and returns an object — do not read
      `process.argv` inside it, pass it in, so it's testable)
- [ ] Support these flags:
  - `--config <path>` — string, default `./repos.json`
  - `--output <name>` — string, default `./report`
  - `--verbose` — boolean flag, default `false`
  - `--help` / `-h` — print usage and exit `0`
- [ ] Accept both `--config x.json` and `--config=x.json` forms
- [ ] Flags work in any order (`--verbose --config x.json` ≡ `--config x.json --verbose`)
- [ ] Unknown flag (e.g. `--nope`) → print usage + error line, exit `1`
- [ ] Value-expecting flag with no value (e.g. `--config` at end of args) → error, exit `1`
- [ ] A bare/positional argument that isn't expected → error, exit `1`
      (or collect into `options._` if you want to allow them later — pick one and document it)
- [ ] `main()` calls `parseArgs(process.argv)`, and on `ArgError` prints
      `err.message` + usage to `stderr` and calls `process.exit(1)` — the raw parser
      itself should throw, not call `process.exit` (keeps it testable)
- [ ] `--verbose` causes the parsed `options` object to be `console.log`-ed

### Suggested shape

```js
// options object returned by parseArgs
{
  config: './repos.json',
  output: './report',
  verbose: false,
  help: false,
}
```

```js
class ArgError extends Error {}

const FLAG_SPEC = {
  '--config': { key: 'config', type: 'string' },
  '--output': { key: 'output', type: 'string' },
  '--verbose': { key: 'verbose', type: 'boolean' },
  '--help':   { key: 'help',    type: 'boolean' },
  '-h':       { key: 'help',    type: 'boolean' },
};

export function parseArgs(argv) {
  const args = argv.slice(2);
  const options = { config: './repos.json', output: './report', verbose: false, help: false };

  for (let i = 0; i < args.length; i++) {
    let token = args[i];
    let inlineValue = null;

    if (token.startsWith('--') && token.includes('=')) {
      [token, inlineValue] = [token.slice(0, token.indexOf('=')), token.slice(token.indexOf('=') + 1)];
    }

    const spec = FLAG_SPEC[token];
    if (!spec) throw new ArgError(`Unknown argument: ${args[i]}`);

    if (spec.type === 'boolean') {
      options[spec.key] = true;
    } else {
      const value = inlineValue ?? args[++i];
      if (value === undefined || value.startsWith('-')) {
        throw new ArgError(`Missing value for ${token}`);
      }
      options[spec.key] = value;
    }
  }
  return options;
}
```

### Usage text

```
repo-radar — aggregate GitHub activity stats for a list of users

Usage:
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

### Phase 1 checkpoint

All of these behave correctly:

```bash
node src/index.js --config repos.json --output report --verbose
# -> logs { config: 'repos.json', output: 'report', verbose: true, help: false }

node src/index.js --verbose --config repos.json
# -> same result, order independent

node src/index.js --config=repos.json
# -> config parsed from = form

node src/index.js --help          # prints usage, exits 0
node src/index.js --config        # error: missing value, exits 1
node src/index.js --bogus         # error: unknown argument, exits 1
echo $?                           # confirm the exit code
```

---

## Acceptance criteria

1. `node src/index.js` runs with no arguments and exits `0`.
2. `parseArgs` is a pure function: takes an array, returns an object, throws `ArgError`
   on bad input, never calls `process.exit` itself.
3. Flags parse correctly in any order, in both `--k v` and `--k=v` forms.
4. `--help` / `-h` prints the usage block and exits `0`.
5. Unknown flags, missing flag values, and stray positionals each produce a one-line
   error + usage on `stderr` and exit `1` — no stack trace reaches the user.
6. `--verbose` prints the resolved `options` object.
7. Project structure, `repos.json`, `.gitignore`, and `"type": "module"` are all in place.
8. Committed to git with sensible messages.

---

## Manual test matrix

| Command | Expected |
| --- | --- |
| `node src/index.js` | defaults printed/used, exit 0 |
| `node src/index.js --verbose` | options logged with `verbose: true`, exit 0 |
| `node src/index.js --config a.json --output b --verbose` | all three applied, exit 0 |
| `node src/index.js --verbose --config a.json` | order-independent, exit 0 |
| `node src/index.js --config=a.json` | `=` form works, exit 0 |
| `node src/index.js -h` | usage printed, exit 0 |
| `node src/index.js --help` | usage printed, exit 0 |
| `node src/index.js --config` | "Missing value for --config", exit 1 |
| `node src/index.js --unknown` | "Unknown argument: --unknown", exit 1 |
| `node src/index.js foo` | stray positional rejected, exit 1 |

---

## Notes for the implementer

- Keep `parseArgs` and its `FLAG_SPEC` table small and declarative so Phase 7's
  `--concurrency <n>` is one new row.
- Don't validate that the config file *exists* here — that's Phase 2. This issue only
  cares about turning `argv` into an `options` object.
- Resist installing anything. `package.json` `dependencies` must stay empty.
- Optional: add a `test/args.test.js` using the built-in `node:test` runner
  (`node --test`) — still zero dependencies, and it locks in the test matrix above.
