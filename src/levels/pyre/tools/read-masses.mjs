// Parses pyre's authored mass tables straight out of composition.ts.
//
// Both audits used to read a hand-maintained JSON export, which silently went
// stale the moment a mass moved — the worst failure mode for a checker, because
// it reports a clean tree that is not the tree. Reading the source removes that
// class of error entirely.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const COMPOSITION_PATH = path.join(here, '..', 'visuals', 'composition.ts');

const MASS_PATTERN =
  /x0:\s*(-?\d+),\s*y0:\s*(-?\d+),\s*x1:\s*(-?\d+),\s*y1:\s*(-?\d+)\s*\},\s*depth:\s*([^,]+),[^\n]*?thickness:\s*([\d.]+)(?:[^\n]*?roll:\s*(-?[\d.]+))?(?:[^\n]*?yaw:\s*(-?[\d.]+))?/;

function listBody(source, marker) {
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const from = start + marker.length;
  const end = source.indexOf('\n];', from);
  return end === -1 ? null : source.slice(from, end);
}

export function readMasses() {
  const source = readFileSync(COMPOSITION_PATH, 'utf8');

  const depths = new Map();
  const depthStart = source.indexOf('export const PYRE_DEPTHS = {');
  if (depthStart !== -1) {
    const depthBlock = source.slice(depthStart, source.indexOf('} as const;', depthStart));
    for (const [, name, value] of depthBlock.matchAll(/(\w+):\s*([\d.]+)/g)) depths.set(name, Number(value));
  }

  const resolveDepth = (expression) => {
    if (/^-?[\d.]+$/.test(expression)) return Number(expression);
    const named = expression.match(/^PYRE_DEPTHS\.(\w+)(?:\s*([-+])\s*([\d.]+))?$/);
    if (!named) return null;
    const base = depths.get(named[1]);
    if (base === undefined) return null;
    if (!named[2]) return base;
    return named[2] === '+' ? base + Number(named[3]) : base - Number(named[3]);
  };

  const masses = [];
  for (const [, group] of source.matchAll(/export const (PYRE_\w+): Slab\[\] = \[/g)) {
    const body = listBody(source, `export const ${group}: Slab[] = [`);
    if (!body) continue;
    for (const line of body.split('\n')) {
      const match = line.match(MASS_PATTERN);
      if (!match) continue;
      const depth = resolveDepth(match[5].trim());
      if (depth === null) throw new Error(`Unresolved depth expression in ${group}: ${match[5].trim()}`);
      masses.push({
        group,
        depth,
        rect: { x0: Number(match[1]), y0: Number(match[2]), x1: Number(match[3]), y1: Number(match[4]) },
        thickness: Number(match[6]),
        roll: match[7] === undefined ? 0 : Number(match[7]),
        yaw: match[8] === undefined ? 0 : Number(match[8]),
      });
    }
  }

  if (masses.length === 0) throw new Error(`No masses parsed from ${COMPOSITION_PATH}`);
  return masses;
}
