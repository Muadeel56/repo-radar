import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, ArgError } from '../src/index.js';

// Helper: build a fake argv (node binary + script path + real args).
const argv = (...args) => ['/usr/bin/node', '/repo/src/index.js', ...args];

const DEFAULTS = {
  config: './repos.json',
  output: './report',
  verbose: false,
  help: false,
};

test('no args -> defaults', () => {
  assert.deepEqual(parseArgs(argv()), DEFAULTS);
});

test('--verbose sets verbose true', () => {
  assert.deepEqual(parseArgs(argv('--verbose')), { ...DEFAULTS, verbose: true });
});

test('--config a.json --output b --verbose applies all three', () => {
  assert.deepEqual(parseArgs(argv('--config', 'a.json', '--output', 'b', '--verbose')), {
    config: 'a.json',
    output: 'b',
    verbose: true,
    help: false,
  });
});

test('flags are order-independent', () => {
  const a = parseArgs(argv('--verbose', '--config', 'a.json'));
  const b = parseArgs(argv('--config', 'a.json', '--verbose'));
  assert.deepEqual(a, b);
  assert.deepEqual(a, { ...DEFAULTS, config: 'a.json', verbose: true });
});

test('--config=a.json (= form) works', () => {
  assert.deepEqual(parseArgs(argv('--config=a.json')), { ...DEFAULTS, config: 'a.json' });
});

test('-h and --help both set help true', () => {
  assert.deepEqual(parseArgs(argv('-h')), { ...DEFAULTS, help: true });
  assert.deepEqual(parseArgs(argv('--help')), { ...DEFAULTS, help: true });
});

test('--config with no value throws ArgError', () => {
  assert.throws(() => parseArgs(argv('--config')), (err) => {
    assert.ok(err instanceof ArgError);
    assert.equal(err.message, 'Missing value for --config');
    return true;
  });
});

test('--config followed by another flag throws (no value consumed)', () => {
  assert.throws(() => parseArgs(argv('--config', '--verbose')), ArgError);
});

test('unknown flag throws ArgError', () => {
  assert.throws(() => parseArgs(argv('--unknown')), (err) => {
    assert.ok(err instanceof ArgError);
    assert.equal(err.message, 'Unknown argument: --unknown');
    return true;
  });
});

test('bare positional argument is rejected', () => {
  assert.throws(() => parseArgs(argv('foo')), (err) => {
    assert.ok(err instanceof ArgError);
    assert.equal(err.message, 'Unexpected positional argument: foo');
    return true;
  });
});

test('boolean flag given a value throws', () => {
  assert.throws(() => parseArgs(argv('--verbose=1')), ArgError);
});
