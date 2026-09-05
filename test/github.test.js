import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  fetchUserRepos,
  fetchAllUsersParallel,
  withRetry,
  GitHubApiError,
} from '../src/github.js';

function fakeResponse({ status, headers = {}, body = [] }) {
  return {
    status,
    headers: { get: (key) => headers[key.toLowerCase()] ?? headers[key] ?? null },
    json: async () => body,
  };
}

test('fetchUserRepos returns parsed JSON on 200', async (t) => {
  t.mock.method(global, 'fetch', async () =>
    fakeResponse({ status: 200, body: [{ name: 'repo1' }] })
  );
  const repos = await fetchUserRepos('octocat');
  assert.deepEqual(repos, [{ name: 'repo1' }]);
});

test('fetchUserRepos throws on 404', async (t) => {
  t.mock.method(global, 'fetch', async () => fakeResponse({ status: 404 }));
  await assert.rejects(fetchUserRepos('ghost'), (err) => {
    assert.ok(err instanceof GitHubApiError);
    assert.equal(err.status, 404);
    assert.equal(err.username, 'ghost');
    assert.equal(err.message, 'GitHub user not found: ghost');
    return true;
  });
});

test('fetchUserRepos throws rate-limit message on 403 with remaining=0', async (t) => {
  t.mock.method(global, 'fetch', async () =>
    fakeResponse({
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '9999999999' },
    })
  );
  await assert.rejects(fetchUserRepos('someone'), (err) => {
    assert.ok(err instanceof GitHubApiError);
    assert.equal(err.status, 403);
    assert.match(err.message, /Rate limited fetching someone \(resets at .+\)/);
    assert.match(err.message, /Consider using a GitHub token to increase your rate limit\./);
    return true;
  });
});

test('fetchUserRepos throws on 5xx', async (t) => {
  t.mock.method(global, 'fetch', async () => fakeResponse({ status: 502 }));
  await assert.rejects(fetchUserRepos('someone'), (err) => {
    assert.equal(err.status, 502);
    assert.equal(err.message, 'GitHub API error (502) fetching someone');
    return true;
  });
});

test('fetchUserRepos wraps network failure', async (t) => {
  t.mock.method(global, 'fetch', async () => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(fetchUserRepos('someone'), (err) => {
    assert.ok(err instanceof GitHubApiError);
    assert.match(err.message, /Network error fetching someone/);
    return true;
  });
});

test('withRetry retries on 403/5xx and succeeds eventually', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls < 3) throw new GitHubApiError('rate limited', { status: 403 });
    return 'ok';
  };
  const result = await withRetry(fn, { attempts: 3, baseDelay: 1 });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('withRetry does not retry on 404', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw new GitHubApiError('not found', { status: 404 });
  };
  await assert.rejects(withRetry(fn, { attempts: 3, baseDelay: 1 }), GitHubApiError);
  assert.equal(calls, 1);
});

test('withRetry rethrows last error after exhausting attempts', async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw new GitHubApiError('server error', { status: 500 });
  };
  await assert.rejects(withRetry(fn, { attempts: 3, baseDelay: 1 }));
  assert.equal(calls, 3);
});

test('fetchAllUsersParallel returns settled per-user results, one failure does not abort batch', async (t) => {
  t.mock.method(global, 'fetch', async (url) => {
    if (url.includes('bad-user')) return fakeResponse({ status: 404 });
    return fakeResponse({ status: 200, body: [{ name: 'r' }] });
  });
  const results = await fetchAllUsersParallel(['good1', 'bad-user', 'good2'], 5);
  assert.equal(results.length, 3);
  assert.equal(results[0].status, 'ok');
  assert.equal(results[1].status, 'error');
  assert.match(results[1].error, /GitHub user not found: bad-user/);
  assert.equal(results[2].status, 'ok');
});

test('fetchAllUsersParallel preserves original order', async (t) => {
  t.mock.method(global, 'fetch', async (url) => {
    const name = url.split('/').at(-2);
    return fakeResponse({ status: 200, body: [{ name }] });
  });
  const usernames = ['a', 'b', 'c', 'd', 'e'];
  const results = await fetchAllUsersParallel(usernames, 2);
  assert.deepEqual(
    results.map((r) => r.username),
    usernames
  );
});

test('fetchAllUsersParallel respects concurrency limit', async (t) => {
  let active = 0;
  let maxActive = 0;
  t.mock.method(global, 'fetch', async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 10));
    active--;
    return fakeResponse({ status: 200, body: [] });
  });
  const usernames = Array.from({ length: 10 }, (_, i) => `user${i}`);
  await fetchAllUsersParallel(usernames, 3);
  assert.ok(maxActive <= 3, `expected max 3 concurrent, got ${maxActive}`);
});

test('fetchAllUsersParallel emits a progress event per completed user', async (t) => {
  t.mock.method(global, 'fetch', async (url) => {
    if (url.includes('bad')) return fakeResponse({ status: 404 });
    return fakeResponse({ status: 200, body: [{ name: 'r' }] });
  });
  const emitter = new EventEmitter();
  const events = [];
  emitter.on('progress', (e) => events.push(e));

  await fetchAllUsersParallel(['good', 'bad'], 2, { emitter });

  assert.equal(events.length, 2);
  assert.ok(events.some((e) => e.username === 'good' && e.status === 'ok' && e.repoCount === 1));
  assert.ok(
    events.some(
      (e) => e.username === 'bad' && e.status === 'error' && /GitHub user not found: bad/.test(e.error)
    )
  );
});

test('fetchAllUsersParallel works without an emitter', async (t) => {
  t.mock.method(global, 'fetch', async () => fakeResponse({ status: 200, body: [] }));
  const results = await fetchAllUsersParallel(['a'], 1);
  assert.equal(results[0].status, 'ok');
});
