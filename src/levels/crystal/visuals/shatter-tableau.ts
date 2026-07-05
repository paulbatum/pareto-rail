import { Color, Group, Vector3 } from 'three';
import { createCrystal, type CrystalKind, type ShardSpec } from './crystal';
import { createFrozenShatterDebris } from './effects';
import { createLancerHalo } from './warden';
import { AMBER, CYAN, MAGENTA, type Rng, mulberry32 } from './palette';

const TABLEAU_AGE = 0.25;
const COLUMN_SPACING = 4.2;
const INTACT_OFFSET = -0.95;
const BURST_OFFSET = 0.65;

type TableauEntry = {
  kind: CrystalKind;
  accentFallback: Color;
  lancer?: boolean;
};

const ENTRIES: TableauEntry[] = [
  { kind: 'node', accentFallback: CYAN },
  { kind: 'drifter', accentFallback: MAGENTA },
  { kind: 'orbiter', accentFallback: AMBER },
  { kind: 'orbiter', accentFallback: AMBER, lancer: true },
];

export function createShatterTableau(): Group {
  const root = new Group();
  ENTRIES.forEach((entry, index) => {
    const column = new Group();
    column.position.x = (index - (ENTRIES.length - 1) / 2) * COLUMN_SPACING;

    const intact = createEnemy(entry.kind, 100 + index, entry.lancer === true);
    intact.position.x = INTACT_OFFSET;
    column.add(intact);

    const specs = intact.userData.shardSpecs as ShardSpec[] | undefined;
    const accent = (intact.userData.accent as Color | undefined) ?? entry.accentFallback;
    const burst = createFrozenShatterDebris(new Vector3(BURST_OFFSET, 0, 0), specs, accent, TABLEAU_AGE, seededRng(9000 + index));
    column.add(burst);

    root.add(column);
  });
  return root;
}

function createEnemy(kind: CrystalKind, seed: number, lancer: boolean): Group {
  const enemy = createCrystal(kind, { seed });
  if (lancer) enemy.add(createLancerHalo());
  return enemy;
}

function seededRng(seed: number): Rng {
  return mulberry32(seed);
}
