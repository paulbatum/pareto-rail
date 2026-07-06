#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TRACE_TARGETS = {
  crystal: {
    level: 'crystal',
    module: '/src/levels/crystal/gameplay.ts',
    exportName: 'CRYSTAL_TIMELINE',
  },
  'crystal-corridor': {
    level: 'crystal',
    module: '/src/levels/crystal/gameplay.ts',
    exportName: 'CRYSTAL_TIMELINE',
  },
  helios: {
    level: 'helios',
    module: '/src/levels/helios/gameplay.ts',
    exportName: 'HELIOS_TIMELINE',
  },
  prism: {
    level: 'prism',
    module: '/src/levels/prism/gameplay.ts',
    exportName: 'PRISM_TIMELINE',
  },
  'prism-bloom': {
    level: 'prism',
    module: '/src/levels/prism/gameplay.ts',
    exportName: 'PRISM_TIMELINE',
  },
  rezdle: {
    level: 'rezdle',
    module: '/src/levels/rezdle/gameplay.ts',
    exportName: 'REZDLE_TIMELINE',
  },
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await captureTrace(options);

  if (options.write) {
    const outPath = path.resolve(root, options.write);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(`wrote ${path.relative(process.cwd(), outPath)}`);
  }

  if (options.compare) {
    await compareResult(result, options.compare);
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (options.verbose) {
    console.log(formatVerbose(result));
  } else if (!options.write || options.compare) {
    console.log(formatSummary(result));
  }
}

async function captureTrace(options) {
  const target = Object.hasOwn(TRACE_TARGETS, options.level) ? TRACE_TARGETS[options.level] : undefined;
  if (!target) throw new Error(`Unsupported spawn trace level: ${options.level}`);

  const server = await createServer({
    root,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false },
  });

  try {
    server.moduleGraph.invalidateAll();
    const mod = await server.ssrLoadModule(target.module);
    const timeline = mod[target.exportName];
    if (!Array.isArray(timeline)) throw new Error(`Missing timeline export: ${target.exportName}`);
    const entries = timeline.map((entry, index) => serializeEntry(entry, `entries[${index}]`));
    return {
      metadata: { level: target.level, entryCount: entries.length },
      entries,
    };
  } finally {
    await server.close();
  }
}

function serializeEntry(entry, pathName) {
  if (!isPlainObject(entry)) throw new Error(`${pathName} must be a plain object`);
  if (!Object.hasOwn(entry, 'time')) throw new Error(`${pathName} is missing time`);
  if (!Object.hasOwn(entry, 'kind')) throw new Error(`${pathName} is missing kind`);
  if (!Object.hasOwn(entry, 'data')) throw new Error(`${pathName} is missing data`);

  const result = {
    time: serializeValue(entry.time, `${pathName}.time`),
    kind: serializeValue(entry.kind, `${pathName}.kind`),
  };

  for (const key of serializableObjectKeys(entry, pathName)) {
    if (key === 'time' || key === 'kind' || key === 'data') continue;
    result[key] = serializeValue(entry[key], `${pathName}.${key}`);
  }

  result.data = serializeValue(entry.data, `${pathName}.data`);
  return result;
}

function serializeValue(value, pathName) {
  if (value === null) return null;

  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Unsupported non-finite number at ${pathName}: ${value}`);
    return roundTraceTime(value);
  }
  if (Array.isArray(value)) return value.map((item, index) => serializeValue(item, `${pathName}[${index}]`));
  if (isVector3(value)) {
    return [
      serializeValue(value.x, `${pathName}.x`),
      serializeValue(value.y, `${pathName}.y`),
      serializeValue(value.z, `${pathName}.z`),
    ];
  }
  if (isPlainObject(value)) {
    const result = {};
    for (const key of serializableObjectKeys(value, pathName)) result[key] = serializeValue(value[key], `${pathName}.${key}`);
    return result;
  }

  throw new Error(`Unsupported value at ${pathName}: ${describeValue(value)}`);
}

function serializableObjectKeys(value, pathName) {
  const keys = Reflect.ownKeys(value);
  for (const key of keys) {
    if (typeof key !== 'string') throw new Error(`Unsupported symbol key at ${pathName}`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) throw new Error(`Unsupported non-enumerable field at ${pathName}.${key}`);
  }
  return keys;
}

function isVector3(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.isVector3 === true &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.z === 'number',
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function describeValue(value) {
  if (value === undefined) return 'undefined';
  if (typeof value === 'function') return `function ${value.name || '<anonymous>'}`;
  if (typeof value === 'object' && value?.constructor?.name) return `instance of ${value.constructor.name}`;
  return String(value);
}

function roundTraceTime(time) {
  return Math.round(time * 1000) / 1000;
}

function formatSummary(result) {
  const { metadata, entries } = result;
  const counts = countBy(entries, (entry) => entry.kind);
  const sortedKinds = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  const lines = [];
  const firstTime = entries[0]?.time;
  const lastTime = entries[entries.length - 1]?.time;
  lines.push(`${metadata.level} spawn trace summary`);
  lines.push(`Entries: ${entries.length}${sortedKinds.length ? ` · ${sortedKinds.map((kind) => `${kind}=${counts[kind]}`).join(', ')}` : ''}`);
  lines.push(`Time range: ${firstTime === undefined ? 'none' : `${formatSeconds(firstTime)}–${formatSeconds(lastTime)}`}`);
  return lines.join('\n');
}

function formatVerbose(result) {
  return result.entries.map(formatEntryLine).join('\n');
}

function formatEntryLine(entry) {
  const fields = flattenFields(entry)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${formatValue(value)}`);
  return `${entry.time.toFixed(3).padStart(8, '0')} ${entry.kind}${fields.length ? ` ${fields.join(' ')}` : ''}`;
}

function flattenFields(entry) {
  const fields = [];
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'time' || key === 'kind') continue;
    if (key === 'data') {
      flattenValue('data', value, fields);
    } else {
      flattenValue(key, value, fields);
    }
  }
  return fields;
}

function flattenValue(prefix, value, fields) {
  if (isVerboseRecord(value)) {
    for (const [key, child] of Object.entries(value)) flattenValue(`${prefix}.${key}`, child, fields);
  } else {
    fields.push([prefix, value]);
  }
}

function isVerboseRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function formatValue(value) {
  if (Array.isArray(value)) return value.map(formatValue).join(',');
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return String(value);
}

async function compareResult(result, comparePath) {
  const expectedPath = path.resolve(root, comparePath);
  const expected = JSON.parse(await fs.readFile(expectedPath, 'utf8'));
  const expectedLines = formatVerbose(expected).split('\n');
  const actualLines = formatVerbose(result).split('\n');
  if (expectedLines.join('\n') === actualLines.join('\n')) {
    console.log(`spawn trace matches ${path.relative(process.cwd(), expectedPath)}`);
    return;
  }

  const max = Math.max(expectedLines.length, actualLines.length);
  let firstDiff = 0;
  while (firstDiff < max && expectedLines[firstDiff] === actualLines[firstDiff]) firstDiff += 1;
  const start = Math.max(0, firstDiff - 4);
  const end = Math.min(max, firstDiff + 8);
  console.error(`spawn trace differs from ${path.relative(process.cwd(), expectedPath)} at line ${firstDiff + 1}`);
  for (let i = start; i < end; i += 1) {
    const expectedLine = expectedLines[i] ?? '<missing>';
    const actualLine = actualLines[i] ?? '<missing>';
    if (expectedLine === actualLine) console.error(`  ${String(i + 1).padStart(5)} ${expectedLine}`);
    else {
      console.error(`- ${String(i + 1).padStart(5)} ${expectedLine}`);
      console.error(`+ ${String(i + 1).padStart(5)} ${actualLine}`);
    }
  }
  process.exitCode = 1;
}

function countBy(values, keyForValue) {
  const counts = {};
  for (const value of values) {
    const key = keyForValue(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function parseArgs(argv) {
  const options = {
    level: 'crystal',
    verbose: false,
    json: false,
    compare: undefined,
    write: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);

    switch (key) {
      case 'level':
        options.level = readValue(argv, ++i, '--level');
        break;
      case 'compare':
        options.compare = readValue(argv, ++i, '--compare');
        break;
      case 'write':
        options.write = readValue(argv, ++i, '--write');
        break;
      case 'verbose':
        options.verbose = true;
        break;
      case 'json':
        options.json = true;
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  return options;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
  return value;
}

function formatSeconds(seconds) {
  return `${seconds.toFixed(1)}s`;
}
