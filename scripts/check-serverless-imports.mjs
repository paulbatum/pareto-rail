#!/usr/bin/env node
// Guards against the failure mode that took the vote API down in production:
// a relative *value* import written without an explicit runtime extension.
//
// The api/ functions are compiled by Vercel and run under native Node ESM, which
// (unlike TypeScript's bundler resolution and Vite) requires every runtime import
// specifier to carry its extension and match a real file. `npm run typecheck` and
// `vite build` both tolerate extensionless specifiers, so this class of bug is
// invisible to them. This walker follows the value-import graph from each api/
// entry point and fails if any relative value specifier is extensionless, uses a
// TypeScript extension, or cannot be resolved to a source file.
//
// Type-only imports (`import type ...`, or a named import whose every member is
// `type`-prefixed) are erased before runtime, so they are followed for nothing and
// never flagged.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = join(repoRoot, 'api');

const RUNTIME_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const SOURCE_CANDIDATES = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'];

/** @typedef {{ specifier: string; line: number; reason: string }} Violation */

function walkDir(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walkDir(full));
    else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(entry)) files.push(full);
  }
  return files;
}

function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content[i] === '\n') line += 1;
  }
  return line;
}

/** Is an import/export clause type-only (fully erased before runtime)? */
function isTypeOnlyClause(clause) {
  const trimmed = clause.trim();
  if (/^type\b/.test(trimmed)) return true; // `import type ...` / `export type ...`
  if (/^\*\s+as\b/.test(trimmed)) return false; // namespace import is a value
  const brace = trimmed.match(/\{([\s\S]*)\}/);
  if (!brace) return false; // default/side-effect binding is a value
  const beforeBrace = trimmed.slice(0, trimmed.indexOf('{')).replace(/,\s*$/, '').trim();
  if (beforeBrace.length > 0) return false; // a default binding sits alongside the braces
  const members = brace[1].split(',').map((m) => m.trim()).filter(Boolean);
  if (members.length === 0) return false;
  return members.every((m) => /^type\s+/.test(m));
}

/** Collect the value (runtime) relative specifiers from a source file. */
function valueSpecifiers(content) {
  /** @type {{ specifier: string; line: number }[]} */
  const out = [];
  const seen = new Set();
  const push = (specifier, index) => {
    if (!specifier.startsWith('.')) return; // only relative imports resolve to repo files
    const key = `${specifier}@${index}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ specifier, line: lineOf(content, index) });
  };

  // `import ... from '...'` and `export ... from '...'`
  const fromRe = /\b(import|export)\b([\s\S]*?)\bfrom\s*(['"])([^'"]+)\3/g;
  for (let m; (m = fromRe.exec(content)); ) {
    if (isTypeOnlyClause(m[2])) continue;
    push(m[4], m.index);
  }
  // Side-effect import: `import '...'`
  const sideRe = /(?:^|[\n;])\s*import\s*(['"])([^'"]+)\1/g;
  for (let m; (m = sideRe.exec(content)); ) push(m[2], m.index);
  // Dynamic import: `import('...')`
  const dynRe = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  for (let m; (m = dynRe.exec(content)); ) push(m[2], m.index);

  return out;
}

/** Resolve a specifier to an existing source file, ignoring extension correctness. */
function resolveSource(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  const ext = extname(specifier);
  if (ext && existsSync(base)) return base;
  if (RUNTIME_EXTENSIONS.has(ext) || TS_EXTENSIONS.has(ext)) {
    const stem = base.slice(0, base.length - ext.length);
    for (const candidate of SOURCE_CANDIDATES) {
      if (existsSync(stem + candidate)) return stem + candidate;
    }
  }
  if (ext === '.json') return existsSync(base) ? base : null;
  if (!ext) {
    for (const candidate of SOURCE_CANDIDATES) {
      if (existsSync(base + candidate)) return base + candidate;
    }
    for (const candidate of SOURCE_CANDIDATES) {
      if (existsSync(join(base, `index${candidate}`))) return join(base, `index${candidate}`);
    }
  }
  return null;
}

const entryPoints = existsSync(apiDir) ? walkDir(apiDir) : [];
const visited = new Set();
/** @type {{ file: string; specifier: string; line: number; reason: string }[]} */
const violations = [];
const queue = [...entryPoints];

while (queue.length > 0) {
  const file = queue.pop();
  if (visited.has(file)) continue;
  visited.add(file);
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const { specifier, line } of valueSpecifiers(content)) {
    const ext = extname(specifier);
    const target = resolveSource(file, specifier);
    if (!target) {
      violations.push({ file, specifier, line, reason: 'does not resolve to any source file' });
      continue;
    }
    if (!ext) {
      violations.push({ file, specifier, line, reason: 'extensionless value import (native ESM needs an explicit extension)' });
    } else if (TS_EXTENSIONS.has(ext)) {
      violations.push({ file, specifier, line, reason: `uses a TypeScript extension (${ext}); runtime imports must use .js` });
    }
    if (extname(target) && !TS_EXTENSIONS.has(extname(target)) && extname(target) !== '.json') {
      // resolved straight to a runtime .js/.mjs sibling; still walk it
    }
    if (extname(specifier) !== '.json') queue.push(target);
  }
}

const relative = (file) => file.slice(repoRoot.length + 1);
if (violations.length > 0) {
  console.error(`Serverless import check failed: ${violations.length} bad value import(s) in the api/ runtime graph.\n`);
  for (const v of violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    console.error(`  ${relative(v.file)}:${v.line}  '${v.specifier}'  — ${v.reason}`);
  }
  console.error('\nAdd the explicit .js extension so Vercel\'s native-ESM runtime can load the module.');
  process.exit(1);
}

console.log(`Serverless import check passed: ${visited.size} module(s) in the api/ runtime graph, no bad value imports.`);
