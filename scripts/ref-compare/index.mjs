#!/usr/bin/env node
import * as blend from './blend.mjs';
import * as compare from './compare.mjs';
import * as crop from './crop.mjs';
import * as flicker from './flicker.mjs';
import * as grid from './grid.mjs';
import * as sample from './sample.mjs';
import * as stack from './stack.mjs';

const COMMANDS = { grid, crop, compare, stack, blend, sample, flicker };

function usage() {
  console.log('Compare a render against a reference image. Outputs default to tmp/ref-compare/.\n');
  for (const command of Object.values(COMMANDS)) console.log(`${command.usage}\n`);
}

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  if (!name || name === '--help' || name === '-h') {
    usage();
    return;
  }
  const command = COMMANDS[name];
  if (!command) throw new Error(`Unknown subcommand: ${name}. Expected one of ${Object.keys(COMMANDS).join(', ')}.`);
  if (rest.includes('--help')) {
    console.log(command.usage);
    return;
  }
  await command.run(rest);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
