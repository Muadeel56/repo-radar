import { pathToFileURL } from 'node:url';
import { loadConfig, ConfigError } from './config.js';
import { fetchAllUsersParallel } from './github.js';

/**
 * Thrown when the command line cannot be parsed. `main()` catches this and prints
 * a one-line message plus the usage block — the parser itself never calls
 * `process.exit`, so it stays a pure, testable function.
 */
export class ArgError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArgError';
  }
}

/**
 * Declarative flag table. Adding a flag later (e.g. `--concurrency <n>` in Phase 7)
 * is a single new row here.
 */
const FLAG_SPEC = {
  '--config': { key: 'config', type: 'string' },
  '--output': { key: 'output', type: 'string' },
  '--verbose': { key: 'verbose', type: 'boolean' },
  '--help': { key: 'help', type: 'boolean' },
  '-h': { key: 'help', type: 'boolean' },
};

export const USAGE = `repo-radar — aggregate GitHub activity stats for a list of users

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
  node src/index.js --config=./data/repos.json`;

/**
 * Turn a raw `process.argv`-style array into a clean options object.
 *
 * Pure: takes the array, returns an object, throws `ArgError` on bad input.
 * Does not read `process.argv` and never exits the process.
 *
 * Positional arguments are rejected (this tool takes only flags).
 *
 * @param {string[]} argv - full argv, including the node binary and script path
 * @returns {{ config: string, output: string, verbose: boolean, help: boolean }}
 */
export function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    config: './repos.json',
    output: './report',
    verbose: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const raw = args[i];
    let token = raw;
    let inlineValue = null;

    if (token.startsWith('--') && token.includes('=')) {
      const eq = token.indexOf('=');
      inlineValue = token.slice(eq + 1);
      token = token.slice(0, eq);
    }

    const spec = FLAG_SPEC[token];
    if (!spec) {
      if (!raw.startsWith('-')) {
        throw new ArgError(`Unexpected positional argument: ${raw}`);
      }
      throw new ArgError(`Unknown argument: ${raw}`);
    }

    if (spec.type === 'boolean') {
      if (inlineValue !== null) {
        throw new ArgError(`Flag ${token} does not take a value`);
      }
      options[spec.key] = true;
      continue;
    }

    const value = inlineValue ?? args[++i];
    if (value === undefined || value.startsWith('-')) {
      throw new ArgError(`Missing value for ${token}`);
    }
    options[spec.key] = value;
  }

  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv);
  } catch (err) {
    if (err instanceof ArgError) {
      console.error(`${err.message}\n\n${USAGE}`);
      process.exit(1);
    }
    throw err;
  }

  if (options.help) {
    console.log(USAGE);
    process.exit(0);
  }

  if (options.verbose) {
    console.log(options);
  }

  let config;
  try {
    config = await loadConfig(options.config);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
    } else {
      console.error(`Unexpected error loading config: ${err.message}`);
    }
    process.exit(1);
  }

  const results = await fetchAllUsersParallel(config.users, 5, { verbose: options.verbose });

  let okCount = 0;
  let errorCount = 0;
  for (const result of results) {
    if (result.status === 'ok') {
      okCount++;
      console.log(`${result.username}: ok (${result.repos.length} repos)`);
    } else {
      errorCount++;
      console.log(`${result.username}: error — ${result.error}`);
    }
  }
  console.log(`\nDone: ${okCount} succeeded, ${errorCount} failed out of ${results.length} users.`);

  // Phase 4+ will aggregate `results` into stats and write report.json/report.csv here.
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
