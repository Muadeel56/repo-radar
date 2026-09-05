// Phase 5: write JSON + CSV reports (CSV via a write stream).
import { writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';

const CSV_HEADERS = [
  'username',
  'status',
  'repoCount',
  'totalStars',
  'topLanguage',
  'mostRecentRepo',
  'updatedAt',
  'error',
];

/**
 * Escape a single CSV field per standard CSV quoting: wrap in double quotes
 * if it contains a comma, a double quote, or a newline, doubling any internal
 * double quotes. `null`/`undefined` become an empty string.
 *
 * @param {*} value
 * @returns {string}
 */
function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * Turn one aggregated user entry into a single CSV line (including its
 * trailing newline). Kept separate from the stream plumbing so it's cheaply
 * unit-testable on its own.
 *
 * @param {object} entry - one entry from `aggregateAll`'s output
 * @returns {string}
 */
function buildCsvRow(entry) {
  const fields =
    entry.status === 'ok'
      ? [
          entry.username,
          entry.status,
          entry.repoCount,
          entry.totalStars,
          entry.topLanguage,
          entry.mostRecentRepo ? entry.mostRecentRepo.name : '',
          entry.mostRecentRepo ? entry.mostRecentRepo.updatedAt : '',
          '',
        ]
      : [entry.username, entry.status, '', '', '', '', '', entry.error];

  return fields.map(escapeCsvField).join(',') + '\n';
}

/**
 * Write the aggregated stats as pretty-printed JSON.
 *
 * @param {Array<object>} data
 * @param {string} path
 * @returns {Promise<void>} resolves on completion, rejects on write failure
 */
export async function writeJsonReport(data, path) {
  await writeFile(path, JSON.stringify(data, null, 2));
}

/**
 * Write the aggregated stats as CSV, streaming one row at a time via
 * `fs.createWriteStream` rather than building one giant in-memory string —
 * the pattern that still holds at a million rows, even though at 20 rows
 * `stream.write()` will never return `false`.
 *
 * @param {Array<object>} data
 * @param {string} path
 * @returns {Promise<void>} resolves on the stream's `finish` event, rejects on `error`
 */
export function writeCsvReport(data, path) {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(path);
    stream.on('error', reject);
    stream.on('finish', resolve);

    stream.write(CSV_HEADERS.join(',') + '\n');
    for (const entry of data) {
      stream.write(buildCsvRow(entry));
    }
    stream.end();
  });
}

/**
 * Write both `${output}.json` and `${output}.csv`, resolving once both are
 * done. The two files are independent, so ordering between them doesn't matter.
 *
 * @param {Array<object>} data
 * @param {string} output - base path, e.g. './report' -> './report.json' + './report.csv'
 * @returns {Promise<void>}
 */
export async function writeReports(data, output) {
  await Promise.all([writeJsonReport(data, `${output}.json`), writeCsvReport(data, `${output}.csv`)]);
}
