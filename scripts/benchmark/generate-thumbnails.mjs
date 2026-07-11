#!/usr/bin/env node
/** Generate one deterministic four-frame card for an opaque benchmark entrant. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULTS = { seed: 424242, width: 1280, height: 720, thumbWidth: 320, columns: 4, fidelity: 'auto' };

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

export async function generateThumbnail({ level, entrant, outDir = path.join(ROOT, 'public/benchmark/thumbnails'), seed = DEFAULTS.seed, width = DEFAULTS.width, height = DEFAULTS.height, thumbWidth = DEFAULTS.thumbWidth, columns = DEFAULTS.columns, fidelity = DEFAULTS.fidelity, dryRun = false }) {
  if (!level || !entrant) throw new Error('level and opaque entrant are required');
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/i.test(entrant)) throw new Error('entrant must be a stable opaque id');
  const args = ['scripts/gameplay-snapshot.mjs', '--level', level, '--thumbnails', '4', '--sheet', '--seed', String(seed), '--immortal', 'true', '--projectiles', 'false', '--width', String(width), '--height', String(height), '--thumb-width', String(thumbWidth), '--columns', String(columns), '--fidelity', fidelity];
  const command = `${process.execPath} ${args.join(' ')}`;
  if (dryRun) return { entrant, level, command, metadata: { seed, width, height, thumbWidth, columns, fidelity, immortal: true, projectiles: false } };

  const temporary = await fs.mkdtemp(path.join(ROOT, '.thumbnail-'));
  try {
    const result = await run(process.execPath, args, { cwd: ROOT, outDir: temporary });
    if (result.code !== 0) throw new Error(`gameplay snapshot failed (exit ${result.code})\n${result.stderr || result.stdout}`);
    const files = (await fs.readdir(temporary)).filter((name) => name.endsWith('.png'));
    // gameplay-snapshot uses the supplied output directory.  Run it there so
    // this command never has to guess or overwrite an existing card.
    if (files.length !== 1) throw new Error(`expected one generated PNG, found ${files.length}`);
    const sourcePath = path.join(temporary, files[0]);
    const png = await fs.readFile(sourcePath);
    const outputPath = path.join(outDir, `${entrant}.png`);
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(outputPath, png);
    const times = [...result.stdout.matchAll(/capture\s+([0-9]+(?:\.[0-9]+)?)s/g)].map((match) => Number(match[1]));
    if (times.length !== 4) throw new Error(`snapshot output did not report four capture times (found ${times.length})`);
    const dimensions = pngDimensions(png);
    const frameFidelities = [...result.stdout.matchAll(/capture\s+[0-9]+(?:\.[0-9]+)?s\s+fidelity=([a-z]+)/g)].map((match) => match[1]);
    if (frameFidelities.length !== 4) throw new Error(`snapshot output did not report four resolved fidelities (found ${frameFidelities.length})`);
    const aggregateFidelity = [...new Set(frameFidelities)].length === 1 ? frameFidelities[0] : 'mixed';
    const metadata = { seed, times, width, height, thumbWidth, columns, fidelity: aggregateFidelity, frameFidelities, immortal: true, projectiles: false, outputWidth: dimensions.width, outputHeight: dimensions.height };
    const manifest = { schemaVersion: 1, opaqueEntrantId: entrant, levelId: level, thumbnail: { path: `/benchmark/thumbnails/${entrant}.png`, status: 'actual', sha256: sha256(png), metadata }, command: { script: 'scripts/gameplay-snapshot.mjs', sha256: sha256(await fs.readFile(path.join(ROOT, 'scripts/gameplay-snapshot.mjs'))) } };
    await fs.writeFile(path.join(outDir, `${entrant}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
    return { outputPath, manifest };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args, '--out', options.outDir], { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function pngDimensions(png) {
  if (png.length < 24 || png.toString('ascii', 1, 4) !== 'PNG' || png.toString('ascii', 12, 16) !== 'IHDR') throw new Error('generated file is not a PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await generateThumbnail(options);
  console.log(options.dryRun ? result.command : `${path.relative(ROOT, result.outputPath)} sha256=${result.manifest.thumbnail.sha256}`);
}

function parseArgs(argv) {
  const result = { level: undefined, entrant: undefined, outDir: path.join(ROOT, 'public/benchmark/thumbnails'), ...DEFAULTS, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === '--dry-run') { result.dryRun = true; continue; }
    const value = argv[++i];
    if (value === undefined) throw new Error(`Missing value for ${key}`);
    if (key === '--level') result.level = value;
    else if (key === '--entrant') result.entrant = value;
    else if (key === '--out') result.outDir = path.resolve(ROOT, value);
    else if (key === '--seed') result.seed = Number(value);
    else if (key === '--width') result.width = Number(value);
    else if (key === '--height') result.height = Number(value);
    else if (key === '--thumb-width') result.thumbWidth = Number(value);
    else if (key === '--columns') result.columns = Number(value);
    else if (key === '--fidelity') result.fidelity = value;
    else throw new Error(`Unknown option ${key}`);
  }
  return result;
}
