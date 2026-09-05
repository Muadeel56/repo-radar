import test from 'node:test';
import assert from 'node:assert/strict';

import { aggregateUserStats, aggregateAll } from '../src/aggregate.js';

test('aggregateUserStats totals stars, picks top language and most recent repo', () => {
  const fakeRepos = [
    { stargazers_count: 10, language: 'JavaScript', name: 'a', updated_at: '2024-01-01T00:00:00Z' },
    { stargazers_count: 5, language: 'JavaScript', name: 'b', updated_at: '2025-06-01T00:00:00Z' },
    { stargazers_count: 3, language: 'Python', name: 'c', updated_at: '2023-01-01T00:00:00Z' },
  ];

  assert.deepEqual(aggregateUserStats(fakeRepos), {
    totalStars: 18,
    topLanguage: 'JavaScript',
    mostRecentRepo: { name: 'b', updatedAt: '2025-06-01T00:00:00Z' },
    repoCount: 3,
  });
});

test('aggregateUserStats returns the zero-value shape for an empty repo list, no throw', () => {
  assert.deepEqual(aggregateUserStats([]), {
    totalStars: 0,
    topLanguage: null,
    mostRecentRepo: null,
    repoCount: 0,
  });
});

test('aggregateUserStats excludes null-language repos from the language tally', () => {
  const repos = [
    { stargazers_count: 0, language: null, name: 'a', updated_at: '2024-01-01T00:00:00Z' },
    { stargazers_count: 0, language: null, name: 'b', updated_at: '2024-01-02T00:00:00Z' },
    { stargazers_count: 0, language: 'Ruby', name: 'c', updated_at: '2024-01-03T00:00:00Z' },
  ];

  const stats = aggregateUserStats(repos);
  assert.equal(stats.topLanguage, 'Ruby');
});

test('aggregateUserStats breaks language ties by first-encountered order', () => {
  const repos = [
    { stargazers_count: 0, language: 'Go', name: 'a', updated_at: '2024-01-01T00:00:00Z' },
    { stargazers_count: 0, language: 'Rust', name: 'b', updated_at: '2024-01-02T00:00:00Z' },
  ];

  const stats = aggregateUserStats(repos);
  assert.equal(stats.topLanguage, 'Go');
});

test('aggregateUserStats picks the most recent repo even when input is not pre-sorted', () => {
  const repos = [
    { stargazers_count: 0, language: 'Go', name: 'oldest', updated_at: '2020-01-01T00:00:00Z' },
    { stargazers_count: 0, language: 'Go', name: 'newest', updated_at: '2026-01-01T00:00:00Z' },
    { stargazers_count: 0, language: 'Go', name: 'middle', updated_at: '2023-01-01T00:00:00Z' },
  ];

  const stats = aggregateUserStats(repos);
  assert.deepEqual(stats.mostRecentRepo, { name: 'newest', updatedAt: '2026-01-01T00:00:00Z' });
});

test('aggregateAll passes error entries through unchanged and aggregates ok entries', () => {
  const usersData = [
    {
      username: 'alice',
      status: 'ok',
      repos: [
        { stargazers_count: 2, language: 'JavaScript', name: 'x', updated_at: '2024-01-01T00:00:00Z' },
      ],
    },
    { username: 'bob', status: 'error', error: 'GitHub user not found: bob' },
  ];

  const result = aggregateAll(usersData);

  assert.equal(result.length, 2);
  assert.deepEqual(result[1], usersData[1]);
  assert.deepEqual(result[0], {
    username: 'alice',
    status: 'ok',
    totalStars: 2,
    topLanguage: 'JavaScript',
    mostRecentRepo: { name: 'x', updatedAt: '2024-01-01T00:00:00Z' },
    repoCount: 1,
  });
});

test('aggregateAll returns an empty array for an empty input', () => {
  assert.deepEqual(aggregateAll([]), []);
});
