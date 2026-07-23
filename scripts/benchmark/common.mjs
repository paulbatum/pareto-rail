import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{3,63}$/;

export function fail(message) {
  throw new Error(message);
}

export function parseArgs(argv, { positional = false, booleans = [] } = {}) {
  const booleanFlags = new Set(['help', ...booleans]);
  const options = {};
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      if (!positional) fail(`Unexpected argument: ${argument}`);
      rest.push(argument);
      continue;
    }
    const key = argument.slice(2);
    if (!key) fail('Empty option name.');
    if (booleanFlags.has(key)) options[key] = true;
    else {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) fail(`Missing value for --${key}`);
      options[key] = value;
      index += 1;
    }
  }
  return { options, rest };
}

export function requireOption(options, key) {
  const value = options[key];
  if (!value) fail(`Missing required option --${key}`);
  return value;
}

export function assertOnlyOptions(options, allowed) {
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) fail(`Unknown option --${key}`);
  }
}

export async function readJson(filePath) {
  let source;
  try {
    source = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`Missing file: ${filePath}`);
    throw error;
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`Invalid JSON in ${filePath}: ${error.message}`);
  }
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function assertObject(value, label, errors) {
  if (!isPlainObject(value)) errors.push(`${label} must be an object.`);
  return isPlainObject(value);
}

export function assertAllowedKeys(value, keys, label, errors) {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) errors.push(`${label} has unknown field ${key}.`);
  }
}

export function pathInside(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function assertPrivateOrExternalPath(filePath, root = process.cwd()) {
  const resolved = path.resolve(filePath);
  const repositoryRoot = path.resolve(root);
  if (pathInside(resolved, repositoryRoot) && !pathInside(resolved, path.join(repositoryRoot, 'benchmark/private'))) {
    fail(`Refusing to write controller data inside the tracked repository: ${resolved}. Use benchmark/private/ or a path outside the repository.`);
  }
  return resolved;
}

export function formatErrors(errors) {
  return errors.map((error) => `- ${error}`).join('\n');
}
