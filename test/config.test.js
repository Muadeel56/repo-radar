import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  loadConfig,
  ConfigError,
  ConfigNotFoundError,
  ConfigParseError,
  ConfigValidationError,
} from '../src/config.js';

async function withTempFile(content) {
  const dir = await mkdtemp(path.join(tmpdir(), 'repo-radar-'));
  const file = path.join(dir, 'repos.json');
  if (content !== undefined) await writeFile(file, content, 'utf-8');
  return { dir, file };
}

test('valid config resolves with parsed users', async () => {
  const { dir, file } = await withTempFile('{"users": ["a", "b"]}');
  const config = await loadConfig(file);
  assert.deepEqual(config.users, ['a', 'b']);
  await rm(dir, { recursive: true, force: true });
});

test('missing file throws ConfigNotFoundError', async () => {
  const missingPath = '/nonexistent/repos.json';
  await assert.rejects(loadConfig(missingPath), (err) => {
    assert.ok(err instanceof ConfigNotFoundError);
    assert.ok(err instanceof ConfigError);
    assert.equal(err.name, 'ConfigNotFoundError');
    assert.equal(err.message, `Config file not found at ${missingPath}`);
    return true;
  });
});

test('malformed JSON throws ConfigParseError', async () => {
  const { dir, file } = await withTempFile('{ bad json');
  await assert.rejects(loadConfig(file), ConfigParseError);
  await rm(dir, { recursive: true, force: true });
});

test('empty users array throws ConfigValidationError', async () => {
  const { dir, file } = await withTempFile('{"users": []}');
  await assert.rejects(loadConfig(file), ConfigValidationError);
  await rm(dir, { recursive: true, force: true });
});

test('non-string entries throw ConfigValidationError', async () => {
  const { dir, file } = await withTempFile('{"users": [123, "ok"]}');
  await assert.rejects(loadConfig(file), ConfigValidationError);
  await rm(dir, { recursive: true, force: true });
});

test('non-array users key throws ConfigValidationError', async () => {
  const { dir, file } = await withTempFile('{"users": "not-an-array"}');
  await assert.rejects(loadConfig(file), ConfigValidationError);
  await rm(dir, { recursive: true, force: true });
});

test('missing users key throws ConfigValidationError', async () => {
  const { dir, file } = await withTempFile('{"foo": "bar"}');
  await assert.rejects(loadConfig(file), ConfigValidationError);
  await rm(dir, { recursive: true, force: true });
});

test('unexpected read error (EISDIR) is wrapped as ConfigError, not raw', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'repo-radar-'));
  await assert.rejects(loadConfig(dir), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.ok(!(err instanceof ConfigNotFoundError));
    assert.ok(!(err instanceof ConfigParseError));
    assert.ok(!(err instanceof ConfigValidationError));
    return true;
  });
  await rm(dir, { recursive: true, force: true });
});
