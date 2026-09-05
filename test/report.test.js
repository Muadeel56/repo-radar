import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { writeJsonReport, writeCsvReport, writeReports } from '../src/report.js';

async function makeTempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'repo-radar-test-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('writeJsonReport round-trips through JSON.parse unchanged', async (t) => {
  const dir = await makeTempDir(t);
  const filePath = path.join(dir, 'report.json');
  const data = [{ username: 'alice', status: 'ok', totalStars: 5, topLanguage: 'JavaScript' }];

  await writeJsonReport(data, filePath);
  const parsed = JSON.parse(await readFile(filePath, 'utf8'));

  assert.deepEqual(parsed, data);
});

test('writeJsonReport rejects on write failure', async () => {
  await assert.rejects(writeJsonReport([], '/nonexistent-dir/report.json'));
});

test('writeCsvReport writes a header row and one row per entry', async (t) => {
  const dir = await makeTempDir(t);
  const filePath = path.join(dir, 'report.csv');
  const data = [
    {
      username: 'alice',
      status: 'ok',
      totalStars: 10,
      topLanguage: 'JavaScript',
      mostRecentRepo: { name: 'repo-a', updatedAt: '2025-06-01T00:00:00Z' },
      repoCount: 3,
    },
    { username: 'bob', status: 'error', error: 'GitHub user not found: bob' },
  ];

  await writeCsvReport(data, filePath);
  const content = await readFile(filePath, 'utf8');
  const lines = content.trim().split('\n');

  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'username,status,repoCount,totalStars,topLanguage,mostRecentRepo,updatedAt,error');
  assert.equal(lines[1], 'alice,ok,3,10,JavaScript,repo-a,2025-06-01T00:00:00Z,');
  assert.equal(lines[2], 'bob,error,,,,,,GitHub user not found: bob');
});

test('writeCsvReport escapes commas, quotes, and newlines', async (t) => {
  const dir = await makeTempDir(t);
  const filePath = path.join(dir, 'report.csv');
  const data = [
    {
      username: 'carol',
      status: 'ok',
      totalStars: 1,
      topLanguage: 'Python',
      mostRecentRepo: { name: 'foo, bar', updatedAt: '2024-01-01T00:00:00Z' },
      repoCount: 1,
    },
    { username: 'dave', status: 'error', error: 'said "hi"\nagain' },
  ];

  await writeCsvReport(data, filePath);
  const content = await readFile(filePath, 'utf8');

  assert.match(content, /"foo, bar"/);
  assert.match(content, /"said ""hi""\nagain"/);
});

test('writeCsvReport resolves only once the full file has been written', async (t) => {
  const dir = await makeTempDir(t);
  const filePath = path.join(dir, 'report.csv');
  const data = Array.from({ length: 20 }, (_, i) => ({
    username: `user${i}`,
    status: 'ok',
    totalStars: i,
    topLanguage: 'Go',
    mostRecentRepo: { name: `repo${i}`, updatedAt: '2024-01-01T00:00:00Z' },
    repoCount: 1,
  }));

  await writeCsvReport(data, filePath);
  const content = await readFile(filePath, 'utf8');
  const lines = content.trim().split('\n');

  assert.equal(lines.length, 21);
  assert.equal(lines.at(-1), 'user19,ok,1,19,Go,repo19,2024-01-01T00:00:00Z,');
});

test('writeCsvReport rejects when the stream errors', async () => {
  await assert.rejects(writeCsvReport([], '/nonexistent-dir/report.csv'));
});

test('writeReports writes both the .json and .csv files', async (t) => {
  const dir = await makeTempDir(t);
  const output = path.join(dir, 'report');
  const data = [{ username: 'alice', status: 'ok', totalStars: 1, topLanguage: 'JavaScript', repoCount: 1, mostRecentRepo: { name: 'a', updatedAt: '2024-01-01T00:00:00Z' } }];

  await writeReports(data, output);

  const json = JSON.parse(await readFile(`${output}.json`, 'utf8'));
  assert.deepEqual(json, data);

  const csv = await readFile(`${output}.csv`, 'utf8');
  assert.match(csv, /^username,status,repoCount,totalStars,topLanguage,mostRecentRepo,updatedAt,error/);
  assert.match(csv, /alice,ok,1,1,JavaScript,a,2024-01-01T00:00:00Z,/);
});

test('writeReports creates the output directory if it does not exist', async (t) => {
  const dir = await makeTempDir(t);
  const output = path.join(dir, 'nested', 'subdir', 'report');
  const data = [{ username: 'alice', status: 'ok', totalStars: 1, topLanguage: 'JavaScript', repoCount: 1, mostRecentRepo: { name: 'a', updatedAt: '2024-01-01T00:00:00Z' } }];

  await writeReports(data, output);

  const json = JSON.parse(await readFile(`${output}.json`, 'utf8'));
  assert.deepEqual(json, data);

  const csv = await readFile(`${output}.csv`, 'utf8');
  assert.match(csv, /^username,status,repoCount,totalStars,topLanguage,mostRecentRepo,updatedAt,error/);
});
