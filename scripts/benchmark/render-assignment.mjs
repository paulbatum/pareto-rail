#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertOnlyOptions, assertPrivateOrExternalPath, fail, parseArgs, requireOption, sha256, writeJson } from './common.mjs';

const PLACEHOLDERS = ['LEVEL_ID', 'LEVEL_TITLE', 'THEME'];

export function renderAssignment(template, { levelId, levelTitle, theme }) {
  if (!levelId || /\r|\n/.test(levelId)) fail('levelId must be a non-empty single-line value.');
  if (!levelTitle || /\r|\n/.test(levelTitle)) fail('levelTitle must be a non-empty single-line value.');

  const tokens = [...template.matchAll(/{{([^{}]+)}}/g)].map((match) => match[1]);
  const unknown = tokens.filter((token) => !PLACEHOLDERS.includes(token));
  if (unknown.length > 0) fail(`Unknown template placeholder(s): ${[...new Set(unknown)].join(', ')}.`);

  for (const placeholder of PLACEHOLDERS) {
    const count = tokens.filter((token) => token === placeholder).length;
    if (count !== 1) fail(`Expected exactly one {{${placeholder}}} placeholder; found ${count}.`);
  }

  return template
    .replace('{{LEVEL_ID}}', levelId)
    .replace('{{LEVEL_TITLE}}', levelTitle)
    .replace('{{THEME}}', theme);
}

async function main() {
  const { options } = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: npm run benchmark:render -- --template <path> --theme <path> --level-id <id> --level-title <title> --out <private-path> --metadata <private-path>');
    return;
  }
  assertOnlyOptions(options, new Set(['help', 'template', 'theme', 'level-id', 'level-title', 'out', 'metadata']));

  const templatePath = path.resolve(requireOption(options, 'template'));
  const themePath = path.resolve(requireOption(options, 'theme'));
  const outputPath = assertPrivateOrExternalPath(requireOption(options, 'out'));
  const metadataPath = assertPrivateOrExternalPath(requireOption(options, 'metadata'));
  if (outputPath === metadataPath) fail('--out and --metadata must differ.');

  const [template, theme] = await Promise.all([
    fs.readFile(templatePath, 'utf8'),
    fs.readFile(themePath, 'utf8'),
  ]);
  const rendering = renderAssignment(template, {
    levelId: requireOption(options, 'level-id'),
    levelTitle: requireOption(options, 'level-title'),
    theme,
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, rendering, 'utf8');
  await writeJson(metadataPath, {
    template: { path: templatePath, sha256: sha256(template) },
    theme: { path: themePath, sha256: sha256(theme) },
    rendering: { path: outputPath, sha256: sha256(rendering) },
  });
  console.log(`Rendered assignment and metadata to private controller storage (${sha256(rendering)}).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
