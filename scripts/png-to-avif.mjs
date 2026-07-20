#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const QUALITY = 55;
const EFFORT = 6;

function usage() {
  console.error('Usage: node scripts/png-to-avif.mjs [--out <file-or-directory>] <file.png> [...]');
  console.error('Converts PNG files to same-basename AVIF files. --out names one output file or a directory for multiple inputs.');
}

function parseArgs(args) {
  const inputs = [];
  let out;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--out') {
      out = args[++index];
      if (!out) throw new Error('--out requires a file or directory path.');
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      inputs.push(arg);
    }
  }
  if (inputs.length === 0) throw new Error('At least one PNG input is required.');
  return { inputs, out };
}

async function outputPaths(inputs, out) {
  if (!out) {
    return inputs.map((input) => path.join(path.dirname(input), `${path.basename(input, path.extname(input))}.avif`));
  }

  if (inputs.length > 1) {
    await fs.mkdir(out, { recursive: true });
    return inputs.map((input) => path.join(out, `${path.basename(input, path.extname(input))}.avif`));
  }

  if (path.extname(out).toLowerCase() === '.avif') {
    await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
    return [out];
  }

  await fs.mkdir(out, { recursive: true });
  return [path.join(out, `${path.basename(inputs[0], path.extname(inputs[0]))}.avif`)];
}

/**
 * Convert one PNG to AVIF at the repository's single set of encode settings.
 * Exported so benchmark promotion converts entrant imagery the same way a
 * hand-run conversion does.
 */
export async function convertPngToAvif(input, output) {
  if (path.extname(input).toLowerCase() !== '.png') {
    throw new Error(`Input is not a PNG: ${input}`);
  }
  const metadata = await sharp(input).metadata();
  if (!metadata.width || !metadata.height) throw new Error(`Could not read PNG dimensions: ${input}`);
  await sharp(input)
    .avif({ quality: QUALITY, effort: EFFORT, chromaSubsampling: '4:4:4' })
    .toFile(output);
  return { input, output, width: metadata.width, height: metadata.height };
}

async function convert(input, output) {
  const result = await convertPngToAvif(input, output);
  console.log(`${input} -> ${output} (${result.width}x${result.height})`);
}

async function main() {
  const { inputs, out } = parseArgs(process.argv.slice(2));
  const outputs = await outputPaths(inputs, out);
  await Promise.all(outputs.map((output, index) => convert(inputs[index], output)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`PNG to AVIF conversion failed: ${error instanceof Error ? error.message : String(error)}`);
    usage();
    process.exitCode = 1;
  }
}
