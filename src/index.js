import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { loadConfig, ConfigError } from './config.js';
import { fetchAllUsersParallel } from './github.js';
import { aggregateAll } from './aggregate.js';
import { writeReports } from './report.js';
import { logger, setVerbose, colors } from './utils/logger.js';

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
  '--concurrency': { key: 'concurrency', type: 'positiveInt' },
  '--help': { key: 'help', type: 'boolean' },
  '-h': { key: 'help', type: 'boolean' },
};

export const USAGE = `repo-radar — aggregate GitHub activity stats for a list of users

Usage:
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
  node src/index.js --concurrency 10`;

/**
 * Turn a raw `process.argv`-style array into a clean options object.
 *
 * Pure: takes the array, returns an object, throws `ArgError` on bad input.
 * Does not read `process.argv` and never exits the process.
 *
 * Positional arguments are rejected (this tool takes only flags).
 *
 * @param {string[]} argv - full argv, including the node binary and script path
 * @returns {{ config: string, output: string, verbose: boolean, concurrency: number, help: boolean }}
 */
export function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    config: './repos.json',
    output: './report',
    verbose: false,
    concurrency: 5,
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

    if (spec.type === 'positiveInt') {
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0) {
        throw new ArgError(`${token} must be a positive integer, got: ${value}`);
      }
      options[spec.key] = n;
      continue;
    }

    options[spec.key] = value;
  }

  return options;
}

/**
 * All fetches failed for the same reason: the request never reached GitHub at
 * all (DNS failure, no route, offline, etc). `fetchUserRepos` normalizes any
 * error thrown by `fetch()` itself into a `Network error fetching <user>: ...`
 * message (as opposed to the distinct templates used for 404/403/5xx
 * responses), so matching that prefix cleanly tells "never reached GitHub"
 * apart from "GitHub responded with an error" without parsing OS error codes.
 */
function isAllNetworkFailure(results) {
  return (
    results.length > 0 &&
    results.every((r) => r.status === 'error' && r.error.startsWith('Network error fetching'))
  );
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

  setVerbose(options.verbose);

  if (options.verbose) {
    logger.debug(JSON.stringify(options));
  }

  let config;
  try {
    config = await loadConfig(options.config);
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error(err.message);
    } else {
      logger.error(`Unexpected error loading config: ${err.message}`);
    }
    process.exit(1);
  }

  const emitter = new EventEmitter();
  let okCount = 0;
  let errorCount = 0;
  emitter.on('progress', (event) => {
    if (event.status === 'ok') {
      okCount++;
      console.log(colors.green(`✓ ${event.username} (${event.repoCount} repos)`));
    } else {
      errorCount++;
      console.log(colors.red(`✗ ${event.username} — ${event.error}`));
    }
  });

  const results = await fetchAllUsersParallel(config.users, options.concurrency, {
    verbose: options.verbose,
    emitter,
  });

  console.log(`\nDone: ${okCount} succeeded, ${errorCount} failed out of ${results.length} users.`);

  if (isAllNetworkFailure(results)) {
    logger.error('Network error: could not reach api.github.com. Check your internet connection.');
    process.exit(1);
  }

  const stats = aggregateAll(results);

  try {
    await writeReports(stats, options.output);
  } catch (err) {
    logger.error(`Failed to write reports: ${err.message}`);
    process.exit(1);
  }

  logger.info(`Reports written to ${options.output}.json and ${options.output}.csv`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    logger.error(`Unexpected error: ${err.message}`);
    process.exit(1);
  });
}
