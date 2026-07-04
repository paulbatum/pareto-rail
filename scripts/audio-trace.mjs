#!/usr/bin/env node
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TRACE_TARGETS = {
  'crystal-debug': {
    module: '/src/levels/crystal-debug/audio.ts',
    exportName: 'traceCrystalDebugAudio',
  },
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = options.graph ? await captureWebAudioGraph(options) : await captureTrace(options);

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
  const target = TRACE_TARGETS[options.level];
  if (!target) throw new Error(`Unsupported audio trace level: ${options.level}`);

  const server = await createServer({
    root,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });

  let browser;
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Could not determine Vite dev server port');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    browser = await puppeteer.launch({
      headless: true,
      executablePath: findChromeExecutable(),
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[page] ${message.text()}`);
    });
    page.on('pageerror', (error) => console.error(`[page] ${error.message}`));

    await page.goto(new URL('/audio-trace.html', baseUrl).href, { waitUntil: 'networkidle0' });
    return await page.evaluate(
      async ({ modulePath, exportName, seconds }) => {
        const mod = await import(modulePath);
        const trace = mod[exportName];
        if (typeof trace !== 'function') throw new Error(`Missing trace export: ${exportName}`);
        return trace({ seconds });
      },
      { modulePath: target.module, exportName: target.exportName, seconds: options.seconds },
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

async function captureWebAudioGraph(options) {
  assertSafeLevelId(options.level);
  const modulePath = `/src/levels/${options.level}/audio.ts`;
  const rawEvents = [];

  const server = await createServer({
    root,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });

  let browser;
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Could not determine Vite dev server port');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    browser = await puppeteer.launch({
      headless: true,
      executablePath: findChromeExecutable(),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
    });

    const page = await browser.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error') console.error(`[page] ${message.text()}`);
    });
    page.on('pageerror', (error) => console.error(`[page] ${error.message}`));

    const client = await page.target().createCDPSession();
    const record = (method) => (params) => rawEvents.push({ method, params });
    client.on('WebAudio.contextCreated', record('contextCreated'));
    client.on('WebAudio.contextChanged', record('contextChanged'));
    client.on('WebAudio.audioNodeCreated', record('audioNodeCreated'));
    client.on('WebAudio.audioParamCreated', record('audioParamCreated'));
    client.on('WebAudio.nodesConnected', record('nodesConnected'));
    client.on('WebAudio.nodeParamConnected', record('nodeParamConnected'));
    client.on('WebAudio.nodesDisconnected', record('nodesDisconnected'));
    client.on('WebAudio.nodeParamDisconnected', record('nodeParamDisconnected'));
    await client.send('WebAudio.enable');

    await page.goto(new URL('/audio-trace.html', baseUrl).href, { waitUntil: 'networkidle0' });
    await page.evaluate(
      async ({ audioModulePath, graphMs }) => {
        const [audioModule, eventsModule] = await Promise.all([import(audioModulePath), import('/src/events.ts')]);
        if (typeof audioModule.createAudio !== 'function') throw new Error(`Missing createAudio export in ${audioModulePath}`);
        const audio = audioModule.createAudio(eventsModule.createEventBus());
        audio.setMasterVolume(0.5);
        await audio.start();
        await new Promise((resolve) => window.setTimeout(resolve, graphMs));
        audio.dispose();
      },
      { audioModulePath: modulePath, graphMs: options.graphMs },
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    await client.send('WebAudio.disable').catch(() => {});
    return normalizeWebAudioGraph(options, rawEvents);
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

function normalizeWebAudioGraph(options, rawEvents) {
  const nodeMap = new Map();
  const params = [];
  const connections = [];
  const paramConnections = [];
  const contexts = [];
  const typeCounts = new Map();

  for (const event of rawEvents) {
    if (event.method === 'contextCreated' || event.method === 'contextChanged') {
      const context = event.params.context;
      if (context?.contextId && !contexts.some((existing) => existing.contextId === context.contextId)) contexts.push(context);
      continue;
    }

    if (event.method === 'audioNodeCreated') {
      const node = event.params.node;
      if (!node?.nodeId) continue;
      const type = node.nodeType ?? 'UnknownNode';
      const count = (typeCounts.get(type) ?? 0) + 1;
      typeCounts.set(type, count);
      nodeMap.set(node.nodeId, { ...node, alias: `${type}#${count}` });
      continue;
    }

    if (event.method === 'audioParamCreated') {
      const param = event.params.param;
      if (param?.paramId) params.push(param);
      continue;
    }

    if (event.method === 'nodesConnected') {
      connections.push(event.params);
      continue;
    }

    if (event.method === 'nodeParamConnected') {
      paramConnections.push(event.params);
    }
  }

  const aliasForNode = (id) => nodeMap.get(id)?.alias ?? id;
  const nodeForParam = new Map(params.map((param) => [param.paramId, param]));
  const aliasForParam = (id) => {
    const param = nodeForParam.get(id);
    if (!param) return id;
    return `${aliasForNode(param.nodeId)}.${param.paramType ?? 'param'}`;
  };

  const nodes = [...nodeMap.values()].map((node) => ({
    alias: node.alias,
    type: node.nodeType,
    inputs: node.numberOfInputs,
    outputs: node.numberOfOutputs,
    channelCount: node.channelCount,
    channelCountMode: node.channelCountMode,
    channelInterpretation: node.channelInterpretation,
  }));

  return {
    metadata: {
      mode: 'webaudio-graph',
      level: options.level,
      graphMs: options.graphMs,
      contexts: contexts.length,
      rawEvents: rawEvents.length,
    },
    nodes,
    params: params
      .filter((param) => nodeMap.has(param.nodeId))
      .map((param) => ({
        alias: aliasForParam(param.paramId),
        node: aliasForNode(param.nodeId),
        type: param.paramType,
        rate: param.rate,
        defaultValue: param.defaultValue,
        minValue: param.minValue,
        maxValue: param.maxValue,
      })),
    connections: connections.map((connection) => ({
      from: aliasForNode(connection.sourceId),
      to: aliasForNode(connection.destinationId),
      output: connection.sourceOutputIndex ?? 0,
      input: connection.destinationInputIndex ?? 0,
    })),
    paramConnections: paramConnections.map((connection) => ({
      from: aliasForNode(connection.sourceId),
      to: aliasForParam(connection.destinationId),
      output: connection.sourceOutputIndex ?? 0,
    })),
  };
}

function formatSummary(result) {
  if (result.metadata?.mode === 'webaudio-graph') return formatGraphSummary(result);
  const { metadata, events } = result;
  const counts = countBy(events, (event) => event.kind);
  const sortedKinds = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  const lines = [];
  lines.push(`${metadata.level} audio trace summary`);
  lines.push(`Duration: ${formatSeconds(metadata.seconds)} · Tempo: ${metadata.bpm ?? 'unknown'} BPM · Grid: ${metadata.stepSeconds ? `${metadata.stepSeconds.toFixed(3)}s` : 'unknown'}`);
  lines.push(`Events: ${events.length}${sortedKinds.length ? ` · ${sortedKinds.map((kind) => `${kind}=${counts[kind]}`).join(', ')}` : ''}`);

  if (metadata.bpm) {
    const barSeconds = 4 * (60 / metadata.bpm);
    const sectionBars = 8;
    const sectionSeconds = barSeconds * sectionBars;
    lines.push('Sections:');
    for (let start = 0; start < metadata.seconds; start += sectionSeconds) {
      const end = Math.min(metadata.seconds, start + sectionSeconds);
      const sectionEvents = events.filter((event) => event.time >= start && event.time < end);
      const sectionCounts = countBy(sectionEvents, (event) => event.kind);
      const musicKinds = ['kick', 'clap', 'hat', 'bass', 'arp', 'pad', 'riser', 'beat'];
      const summary = musicKinds.filter((kind) => sectionCounts[kind]).map((kind) => `${kind}=${sectionCounts[kind]}`).join(', ');
      lines.push(`- ${formatSeconds(start)}–${formatSeconds(end)}: ${summary || 'no traced events'}`);
    }
  }

  const firsts = [];
  for (const kind of sortedKinds) {
    const first = events.find((event) => event.kind === kind);
    if (first) firsts.push(`${kind}@${formatSeconds(first.time)}`);
  }
  if (firsts.length) lines.push(`First appearances: ${firsts.join(', ')}`);
  return lines.join('\n');
}

function formatGraphSummary(result) {
  const nodeCounts = countBy(result.nodes, (node) => node.type);
  const nodeTypes = Object.keys(nodeCounts).sort((a, b) => nodeCounts[b] - nodeCounts[a] || a.localeCompare(b));
  const lines = [];
  lines.push(`${result.metadata.level} WebAudio graph summary`);
  lines.push(`Contexts: ${result.metadata.contexts} · Nodes: ${result.nodes.length}${nodeTypes.length ? ` · ${nodeTypes.map((type) => `${type}=${nodeCounts[type]}`).join(', ')}` : ''}`);
  lines.push(`Connections: ${result.connections.length} node, ${result.paramConnections.length} param · Params: ${result.params.length}`);
  if (result.connections.length) {
    lines.push('Node connections:');
    for (const connection of result.connections) lines.push(`- ${connection.from} -> ${connection.to}`);
  }
  if (result.paramConnections.length) {
    lines.push('Param connections:');
    for (const connection of result.paramConnections) lines.push(`- ${connection.from} -> ${connection.to}`);
  }
  return lines.join('\n');
}

function formatVerbose(result) {
  if (result.metadata?.mode === 'webaudio-graph') return formatGraphVerbose(result);
  return result.events.map(formatEventLine).join('\n');
}

function formatGraphVerbose(result) {
  const lines = [];
  for (const node of result.nodes) {
    lines.push(`node ${node.alias} type=${node.type} inputs=${node.inputs} outputs=${node.outputs} channels=${node.channelCount} mode=${node.channelCountMode}`);
  }
  for (const param of result.params) {
    lines.push(`param ${param.alias} type=${param.type} rate=${param.rate} default=${formatValue(param.defaultValue)} min=${formatValue(param.minValue)} max=${formatValue(param.maxValue)}`);
  }
  for (const connection of result.connections) {
    lines.push(`connect ${connection.from} -> ${connection.to} out=${connection.output} in=${connection.input}`);
  }
  for (const connection of result.paramConnections) {
    lines.push(`connect-param ${connection.from} -> ${connection.to} out=${connection.output}`);
  }
  return lines.join('\n');
}

function formatEventLine(event) {
  const data = event.data ?? {};
  const fields = Object.keys(data)
    .sort()
    .map((key) => `${key}=${formatValue(data[key])}`);
  return `${event.time.toFixed(3).padStart(8, '0')} ${event.kind}${fields.length ? ` ${fields.join(' ')}` : ''}`;
}

function formatValue(value) {
  if (Array.isArray(value)) return value.join(',');
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return String(value);
}

async function compareResult(result, comparePath) {
  const expectedPath = path.resolve(root, comparePath);
  const expected = JSON.parse(await fs.readFile(expectedPath, 'utf8'));
  const expectedLines = formatVerbose(expected).split('\n');
  const actualLines = formatVerbose(result).split('\n');
  if (expectedLines.join('\n') === actualLines.join('\n')) {
    console.log(`${result.metadata?.mode === 'webaudio-graph' ? 'graph' : 'trace'} matches ${path.relative(process.cwd(), expectedPath)}`);
    return;
  }

  const max = Math.max(expectedLines.length, actualLines.length);
  let firstDiff = 0;
  while (firstDiff < max && expectedLines[firstDiff] === actualLines[firstDiff]) firstDiff += 1;
  const start = Math.max(0, firstDiff - 4);
  const end = Math.min(max, firstDiff + 8);
  console.error(`${result.metadata?.mode === 'webaudio-graph' ? 'graph' : 'trace'} differs from ${path.relative(process.cwd(), expectedPath)} at line ${firstDiff + 1}`);
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
    level: 'crystal-debug',
    seconds: 45,
    verbose: false,
    json: false,
    compare: undefined,
    write: undefined,
    graph: false,
    graphMs: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);

    switch (key) {
      case 'level':
        options.level = readValue(argv, ++i, '--level');
        break;
      case 'seconds':
        options.seconds = readPositiveNumber(readValue(argv, ++i, '--seconds'), '--seconds');
        break;
      case 'compare':
        options.compare = readValue(argv, ++i, '--compare');
        break;
      case 'write':
        options.write = readValue(argv, ++i, '--write');
        break;
      case 'graph-ms':
        options.graphMs = readNonNegativeNumber(readValue(argv, ++i, '--graph-ms'), '--graph-ms');
        break;
      case 'graph':
        options.graph = true;
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

function readPositiveNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive number`);
  return parsed;
}

function readNonNegativeNumber(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flag} must be a non-negative number`);
  return parsed;
}

function assertSafeLevelId(level) {
  if (!/^[a-z0-9-]+$/.test(level)) throw new Error(`Invalid level id: ${level}`);
}

function formatSeconds(seconds) {
  return `${seconds.toFixed(1)}s`;
}

function findChromeExecutable() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  for (const candidate of [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
