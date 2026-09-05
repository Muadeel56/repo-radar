// Phase 2: read + validate the JSON config file.
import { readFile } from 'node:fs/promises';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class ConfigNotFoundError extends ConfigError {
  constructor(message) {
    super(message);
    this.name = 'ConfigNotFoundError';
  }
}

export class ConfigParseError extends ConfigError {
  constructor(message) {
    super(message);
    this.name = 'ConfigParseError';
  }
}

export class ConfigValidationError extends ConfigError {
  constructor(message) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export async function loadConfig(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new ConfigNotFoundError(`Config file not found at ${path}`);
    }
    throw new ConfigError(`Could not read config file at ${path}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigParseError(`Invalid JSON in config file at ${path}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigValidationError(`repos.json must contain a "users" array`);
  }
  if (!Array.isArray(parsed.users)) {
    throw new ConfigValidationError(`repos.json must contain a "users" array`);
  }
  if (parsed.users.length === 0) {
    throw new ConfigValidationError(`"users" array in ${path} must not be empty`);
  }
  if (!parsed.users.every((u) => typeof u === 'string' && u.trim().length > 0)) {
    throw new ConfigValidationError(`Every entry in "users" must be a non-empty string`);
  }

  return parsed;
}
