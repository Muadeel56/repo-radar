// Black-box CLI tests: spawn `node src/index.js` as a child process rather
// than importing `main()` directly, so `global.fetch` mocking used by the
// unit-level github.test.js never has to interact with these process-wide
// exit-code/stdout assertions. Kept narrow: only deterministic, network-free
// scenarios plus one happy-path run that exercises real (unauthenticated)
// GitHub API calls to confirm output-directory auto-creation end-to-end.
// Rate-limit/network-outage/mixed-username scenarios are already covered at
// the unit level in github.test.js and don't need a slower reproduction here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../src/index.js', import.meta.url));

async function makeTempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'repo-radar-index-test-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('--help exits 0 and prints usage', async () => {
  const { stdout } = await run('node', [CLI, '--help']);
  assert.match(stdout, /repo-radar — aggregate GitHub activity stats/);
  assert.match(stdout, /--concurrency <n>/);
});

test('unknown flag exits 1 with a clear message, no stack trace', async () => {
  await assert.rejects(run('node', [CLI, '--bogus']), (err) => {
    assert.equal(err.code, 1);
    assert.match(err.stderr, /Unknown argument: --bogus/);
    assert.doesNotMatch(err.stderr, /at file:|at Object\.|\.js:\d+:\d+/);
    return true;
  });
});

test('missing config file exits 1 with a clear message, no stack trace', async () => {
  await assert.rejects(run('node', [CLI, '--config', '/does/not/exist.json']), (err) => {
    assert.equal(err.code, 1);
    assert.match(err.stderr, /not found|no such file|ENOENT/i);
    assert.doesNotMatch(err.stderr, /at file:|at Object\.|\.js:\d+:\d+/);
    return true;
  });
});

test('malformed config JSON exits 1 with a clear message, no stack trace', async (t) => {
  const dir = await makeTempDir(t);
  const configPath = path.join(dir, 'repos.json');
  await writeFile(configPath, '{ not valid json');

  await assert.rejects(run('node', [CLI, '--config', configPath]), (err) => {
    assert.equal(err.code, 1);
    assert.doesNotMatch(err.stderr, /at file:|at Object\.|\.js:\d+:\d+/);
    return true;
  });
});

test('valid run creates a nonexistent nested output directory', async (t) => {
  const dir = await makeTempDir(t);
  const configPath = path.join(dir, 'repos.json');
  await writeFile(configPath, JSON.stringify({ users: ['octocat'] }));
  const output = path.join(dir, 'nested', 'subdir', 'report');

  const { stdout } = await run('node', [CLI, '--config', configPath, '--output', output]);
  assert.match(stdout, /Reports written to/);

  const json = JSON.parse(await readFile(`${output}.json`, 'utf8'));
  assert.equal(json.length, 1);
  assert.equal(json[0].username, 'octocat');
});
