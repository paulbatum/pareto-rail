import fs from 'node:fs';
import path from 'node:path';

// Individual source files excluded from the line count, by path suffix. These
// are bulk embedded-data modules that ship as TypeScript but are not authored
// code, so counting them would badly distort the size proxy. rezdle's
// word-data.ts is an ~80k-line word list stored as a template literal.
const EXCLUDED_SUFFIXES = ['/rezdle/word-data.ts'];

/**
 * Non-blank lines of authored TypeScript in a level's source tree. This is the
 * one shared size-proxy definition used for both built-in and benchmark levels:
 * every .ts/.tsx file at any depth (including nested dirs like visuals/),
 * counting lines that contain a non-whitespace character. level.json and
 * level.md are metadata and prose, not code, and are excluded, as are the
 * embedded-data modules in EXCLUDED_SUFFIXES. A missing directory counts as zero.
 */
export function countSourceLines(directory) {
  let total = 0;
  const stack = [directory];
  while (stack.length > 0) {
    let entries;
    try {
      entries = fs.readdirSync(stack.pop(), { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(entry.parentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !isExcluded(full)) {
        for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
          if (line.trim().length > 0) total += 1;
        }
      }
    }
  }
  return total;
}

function isExcluded(fullPath) {
  const normalized = fullPath.replaceAll('\\', '/');
  return EXCLUDED_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}
