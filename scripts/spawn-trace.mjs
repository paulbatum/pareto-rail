#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function resolveLevelTarget(levelIdOrAlias, rootDir) {
  const registryPath = path.resolve(rootDir, 'src/levels/index.ts');
  const registrySource = await fs.readFile(registryPath, 'utf8');

  // Find the human-maintained built-in loader mappings.
  const caseRegex = /['"]([^'"]+)['"]:\s*async\s*\(\)\s*=>\s*\(await\s*import\(['"]([^'"]+)['"]\)\)\.([A-Za-z0-9_]+),/g;
  const cases = new Map();
  let match;
  while ((match = caseRegex.exec(registrySource))) {
    const canonicalId = match[1];
    const importPath = match[2];
    const exportName = match[3];
    const folder = importPath.replace(/^\.\//, '');
    cases.set(canonicalId, { folder, exportName });
  }

  // Parse levelMetadatas to get aliases/IDs
  const arrayMatch = registrySource.match(/export const levelMetadatas: LevelMetadata\[] = \[([\s\S]*?)\n\];/);
  if (!arrayMatch) throw new Error('Could not find levelMetadatas array in src/levels/index.ts');
  
  const entryRegex = /\{\s*id:\s*['"]([^'"]+)['"]\s*,\s*title:\s*['"]([^'"]+)['"](?:\s*,\s*aliases:\s*\[([^\]]*)\])?/g;
  let canonicalId = null;
  let title = null;
  while ((match = entryRegex.exec(arrayMatch[1]))) {
    const entryId = match[1];
    const entryTitle = match[2];
    const entryAliases = match[3] 
      ? match[3].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean) 
      : [];
    if (entryId === levelIdOrAlias || entryAliases.includes(levelIdOrAlias)) {
      canonicalId = entryId;
      title = entryTitle;
      break;
    }
  }

  if (!canonicalId || !cases.has(canonicalId)) {
    // Fallback search: if it doesn't match the strict patterns, try to see if the directory exists
    const directPath = path.resolve(rootDir, 'src/levels', levelIdOrAlias);
    try {
      const stats = await fs.stat(directPath);
      if (stats.isDirectory()) {
        canonicalId = levelIdOrAlias;
        title = levelIdOrAlias;
        cases.set(canonicalId, { folder: levelIdOrAlias, exportName: '' });
      }
    } catch {
      // ignore
    }
  }

  if (!canonicalId || !cases.has(canonicalId)) {
    throw new Error(`Unsupported spawn trace level: ${levelIdOrAlias}`);
  }

  const { folder } = cases.get(canonicalId);
  return {
    level: canonicalId,
    title,
    folder,
    module: `/src/levels/${folder}/gameplay.ts`,
    syncModule: `/src/levels/${folder}/timing.ts`
  };
}

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
  } else if (options.bars) {
    console.log(formatBars(result));
  } else if (options.verbose) {
    console.log(formatVerbose(result));
  } else if (!options.write || options.compare) {
    console.log(formatSummary(result));
  }
}

async function captureTrace(options) {
  const target = await resolveLevelTarget(options.level, root);

  const server = await createServer({
    root,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false },
  });

  try {
    server.moduleGraph.invalidateAll();
    const mod = await server.ssrLoadModule(target.module);
    
    // Dynamically find timeline export
    const timelineKey = Object.keys(mod).find(key => key.endsWith('_TIMELINE') || key.endsWith('_SPAWN_TIMELINE'));
    if (!timelineKey) throw new Error(`Missing timeline export in ${target.module}`);
    
    const timeline = mod[timelineKey];
    if (!Array.isArray(timeline)) throw new Error(`Timeline export ${timelineKey} is not an array`);
    const entries = timeline.map((entry, index) => serializeEntry(entry, `entries[${index}]`));

    // Try loading sync dynamically if timing.ts exists
    let sync = undefined;
    if (options.bars) {
      const timingPath = path.resolve(root, target.syncModule.slice(1));
      let timingExists = false;
      try {
        await fs.access(timingPath);
        timingExists = true;
      } catch {
        // file doesn't exist
      }
      if (timingExists) {
        sync = await loadSync(server, target.syncModule);
      }
    }

    return {
      metadata: { level: target.level, entryCount: entries.length },
      entries,
      ...(sync ? { sync } : {}),
    };
  } finally {
    await server.close();
  }
}

async function loadSync(server, syncModule) {
  const mod = await server.ssrLoadModule(syncModule);
  const syncKey = Object.keys(mod).find(key => key.endsWith('_SPAWN_SYNC'));
  if (!syncKey) throw new Error(`Missing sync export in ${syncModule}`);
  const sync = mod[syncKey];
  if (!isPlainObject(sync)) throw new Error(`${syncKey} must be a plain object`);
  if (typeof sync.bpm !== 'number') throw new Error(`${syncKey}.bpm must be a number`);
  if (!Array.isArray(sync.sections)) throw new Error(`${syncKey}.sections must be an array`);
  return sync;
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

function formatBars(result) {
  const sync = result.sync;
  if (!sync) throw new Error(`No musical sync metadata is available for ${result.metadata.level}`);
  const beatsPerBar = sync.beatsPerBar ?? 4;
  const barSeconds = (60 / sync.bpm) * beatsPerBar;
  const durationBars = sync.durationBars ?? Math.ceil((sync.duration ?? result.entries.at(-1)?.time ?? 0) / barSeconds);
  const bars = Array.from({ length: durationBars }, (_, index) => ({ index, entries: [] }));
  for (const entry of result.entries) {
    const barIndex = Math.max(0, Math.min(bars.length - 1, Math.floor(entry.time / barSeconds)));
    bars[barIndex]?.entries.push(entry);
  }

  const emptyRuns = new Map();
  for (let index = 0; index < bars.length;) {
    if (bars[index].entries.length > 0) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < bars.length && bars[index].entries.length === 0) index += 1;
    const length = index - start;
    if (length >= 2) {
      for (let offset = 0; offset < length; offset += 1) emptyRuns.set(start + offset, { offset, length });
    }
  }

  const lines = [];
  lines.push(`${result.metadata.level} spawn/audio sync by bar`);
  lines.push('bar | section | spawns | flags');
  lines.push('----|---------|--------|------');
  for (const bar of bars) {
    const section = sectionAt(sync.sections, bar.index)?.name ?? '—';
    const spawns = formatBarSpawns(bar.entries);
    const gap = emptyRuns.get(bar.index);
    const flags = gap ? `long spawn-free gap ${gap.offset + 1}/${gap.length}` : '';
    lines.push(`${String(bar.index).padStart(3)} | ${section} | ${spawns || '—'} | ${flags}`);
  }
  return lines.join('\n');
}

function sectionAt(sections, bar) {
  for (let index = sections.length - 1; index >= 0; index -= 1) {
    const section = sections[index];
    const toBar = section.toBar ?? sections[index + 1]?.fromBar ?? Infinity;
    if (bar >= section.fromBar && bar < toBar) return section;
  }
  return null;
}

function formatBarSpawns(entries) {
  if (!entries.length) return '';
  const byKind = new Map();
  for (const entry of entries) {
    const bucket = byKind.get(entry.kind) ?? [];
    bucket.push(entry.time);
    byKind.set(entry.kind, bucket);
  }
  return [...byKind.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, times]) => `${kind}×${times.length} (${times.map((time) => time.toFixed(2)).join(',')}s)`)
    .join('; ');
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
    bars: false,
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
      case 'bars':
        options.bars = true;
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
