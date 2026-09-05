// Phase 7: a tiny leveled logger. `debug` only prints when verbose mode is on.
//
// Raw ANSI escape codes (no `chalk`) keep this zero-dependency: `\x1b[<code>m`
// switches the terminal to a color, `\x1b[0m` resets it.
let verboseEnabled = false;

/**
 * Turn on/off `logger.debug` output. Called once from `main()` right after
 * `parseArgs` succeeds, so every subsequent log call in the run respects it.
 * @param {boolean} enabled
 */
export function setVerbose(enabled) {
  verboseEnabled = enabled;
}

export const colors = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
};

export const logger = {
  info: (msg) => console.log(colors.cyan(msg)),
  warn: (msg) => console.warn(colors.yellow(`⚠ ${msg}`)),
  error: (msg) => console.error(colors.red(`✗ ${msg}`)),
  debug: (msg) => {
    if (verboseEnabled) console.error(colors.gray(`[verbose] ${msg}`));
  },
};
