#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertOnlyOptions, assertPrivateOrExternalPath, fail, parseArgs, requireOption, sha256, writeJson } from './common.mjs';

const PLACEHOLDERS = ['LEVEL_ID', 'LEVEL_TITLE', 'THEME'];
const REPEATABLE_PLACEHOLDERS = new Set(['LEVEL_ID']);
const DELEGATION_PLACEHOLDERS = ['DELEGATE_MODEL', 'DELEGATE_EFFORT'];
export const BUDGET_ASSIGNMENT_PARAGRAPH = 'There is a cost budget for this task, and the benchmark expects it to be used. A submission that leaves most of the budget unspent will be resumed and asked to keep improving the level, so plan to invest the budget in quality rather than finishing early. You will receive task budget status updates as you work. Checkpoint your work as you go: get to a complete level that passes the required checks early, commit it, and keep committing at every passing milestone so that if the budget runs out while the tree is failing you can reset to the last passing commit instead of submitting broken work.';

export function renderAssignment(template, { levelId, levelTitle, theme, budget = false }) {
  if (!levelId || /\r|\n/.test(levelId)) fail('levelId must be a non-empty single-line value.');
  if (!levelTitle || /\r|\n/.test(levelTitle)) fail('levelTitle must be a non-empty single-line value.');

  const tokens = [...template.matchAll(/{{([^{}]+)}}/g)].map((match) => match[1]);
  const unknown = tokens.filter((token) => !PLACEHOLDERS.includes(token));
  if (unknown.length > 0) fail(`Unknown template placeholder(s): ${[...new Set(unknown)].join(', ')}.`);

  for (const placeholder of PLACEHOLDERS) {
    const count = tokens.filter((token) => token === placeholder).length;
    const expected = REPEATABLE_PLACEHOLDERS.has(placeholder) ? count >= 1 : count === 1;
    if (!expected) fail(`Expected ${REPEATABLE_PLACEHOLDERS.has(placeholder) ? 'at least one' : 'exactly one'} {{${placeholder}}} placeholder; found ${count}.`);
  }

  const rendered = template
    .replaceAll('{{LEVEL_ID}}', levelId)
    .replace('{{LEVEL_TITLE}}', levelTitle)
    .replace('{{THEME}}', theme);
  return budget ? `${rendered}\n\n${BUDGET_ASSIGNMENT_PARAGRAPH}` : rendered;
}

// The delegation addendum (benchmark/prompts/flexible-delegation.md) is appended verbatim to the
// shared assignment for delegation configurations. It carries only {{DELEGATE_MODEL}} and
// {{DELEGATE_EFFORT}}; every occurrence of each is substituted, and no other placeholder is allowed.
export function renderDelegation(template, { delegateModel, delegateEffort }) {
  if (!delegateModel || /\r|\n/.test(delegateModel)) fail('delegateModel must be a non-empty single-line value.');
  if (!delegateEffort || /\r|\n/.test(delegateEffort)) fail('delegateEffort must be a non-empty single-line value.');

  const tokens = [...template.matchAll(/{{([^{}]+)}}/g)].map((match) => match[1]);
  const unknown = tokens.filter((token) => !DELEGATION_PLACEHOLDERS.includes(token));
  if (unknown.length > 0) fail(`Unknown delegation placeholder(s): ${[...new Set(unknown)].join(', ')}.`);
  for (const placeholder of DELEGATION_PLACEHOLDERS) {
    if (!tokens.includes(placeholder)) fail(`Delegation prompt is missing the {{${placeholder}}} placeholder.`);
  }

  return template
    .replaceAll('{{DELEGATE_MODEL}}', delegateModel)
    .replaceAll('{{DELEGATE_EFFORT}}', delegateEffort);
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
