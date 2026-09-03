import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { configureAdditiveMaterial, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import {
  BLOOM_GOLD,
  BONE_WHITE,
  CORE_WHITE,
  JELLY_GREEN,
  PARASITE_VIOLET,
  SHALLOW_TEAL,
  SICKLY_MAGENTA,
  SUNLIT_AQUA,
  hdr,
} from './palette';

// The parasites: seven silhouettes, one sour palette. Violet is never used
// for anything the player owns — if it glows violet, it wants the jelly.
// Green-gold is the jelly and the player; the two never mix on one body.
//
// Performance rule: every geometry here is module-shared. Enemy instances
// own only their materials (lock flashes need per-instance colors), so the
// spawn timeline can run its full course without growing the geometry count.

// -- shared geometry ------------------------------------------------------------

const GEO = {
  limpetCup: new ConeGeometry(0.85, 0.7, 10, 1, true),
  limpetSac: new IcosahedronGeometry(0.72, 1),
  limpetCore: new SphereGeometry(0.34, 12, 10),
  limpetSpike: new ConeGeometry(0.09, 0.55, 5),
  limpetRim: new TorusGeometry(0.85, 0.06, 6, 20),
  limpetPulse: new SphereGeometry(0.85, 12, 10),
  skimmerBody: new OctahedronGeometry(0.5, 0),
  skimmerEye: new SphereGeometry(0.2, 10, 8),
  skimmerEdge: new TorusGeometry(1.15, 0.035, 6, 24),
  skimmerTail: new ConeGeometry(0.12, 1.1, 5),
  darterNeedle: new ConeGeometry(0.32, 2.2, 6),
  darterSac: new SphereGeometry(0.42, 12, 10),
  darterFin: new BoxGeometry(0.06, 0.7, 0.5),
  boltThorn: new OctahedronGeometry(0.4, 0),
  boltGlow: new OctahedronGeometry(0.62, 0),
  broodCore: new IcosahedronGeometry(0.4, 0),
  broodMote: new SphereGeometry(0.22, 8, 6),
  broodHalo: new RingGeometry(0.95, 1.0, 24),
  webOuter: new TorusGeometry(3.2, 0.16, 6, 28),
  webInner: new TorusGeometry(1.6, 0.12, 6, 22),
  webSpoke: new BoxGeometry(6.2, 0.14, 0.1),
  webMembrane: new RingGeometry(0.2, 3.1, 24),
  parentBulk: new IcosahedronGeometry(3.0, 1),
  parentSpike: new ConeGeometry(0.35, 2.2, 5),
  parentCrater: new TorusGeometry(1.5, 0.22, 8, 24),
  parentCore: new SphereGeometry(1.15, 16, 12),
  parentSkirt: new TorusGeometry(3.6, 0.3, 8, 28),
  playerCore: new OctahedronGeometry(0.3, 0),
  playerShell: new OctahedronGeometry(0.48, 0),
  reticleBell: new TorusGeometry(0.6, 0.045, 8, 40),
  reticlePolyp: new RingGeometry(0.3, 0.33, 3),
  reticleDrip: new OctahedronGeometry(0.07, 0),
  reticleDot: new SphereGeometry(0.045, 10, 8),
  glint: new OctahedronGeometry(0.3, 0),
};

function buildSkimmerWings(): BufferGeometry {
  const left = new ConeGeometry(0.55, 2.4, 4);
  left.rotateZ(Math.PI / 2);
  left.rotateY(0.5);
  left.scale(1, 0.28, 1);
  const right = left.clone();
  right.rotateY(-1.0);
  const merged = mergeGeometries([left, right]);
  left.dispose();
  right.dispose();
  return merged;
}
const SKIMMER_WINGS = buildSkimmerWings();

// -- shared helpers ---------------------------------------------------------------

function shardSpecs(accent: typeof PARASITE_VIOLET, size: number): ShardSpec[] {
  const specs: ShardSpec[] = [];
  for (let i = 0; i < 8; i += 1) {
    const theta = (i / 8) * Math.PI * 2;
    specs.push({
      direction: new Vector3(Math.cos(theta), Math.sin(theta), i % 2 === 0 ? 0.5 : -0.5).normalize(),
      color: accent.clone(),
      size,
    });
  }
  return specs;
}

function finish(group: Group, accent: typeof PARASITE_VIOLET, lockRingScale: number) {
  group.userData.accent = accent.clone();
  group.userData.shardSpecs = shardSpecs(accent, 0.32);
  group.userData.lockRingScale = lockRingScale;
  return group;
}

export function setEnemyLockedMesh(group: Group, locked: boolean) {
  group.userData.locked = locked;
  const core = group.userData.lockCore as MeshBasicMaterial | undefined;
  const base = group.userData.lockCoreBase as typeof PARASITE_VIOLET | undefined;
  if (core && base) {
    core.color.copy(locked ? hdr(CORE_WHITE, 2.2) : hdr(base, 1.5));
  }
  const rim = group.userData.lockRim as MeshBasicMaterial | undefined;
  const rimBase = group.userData.lockRimBase as typeof PARASITE_VIOLET | undefined;
  if (rim && rimBase) {
    rim.color.copy(locked ? hdr(BONE_WHITE, 1.4) : hdr(rimBase, 0.9));
  }
}

// -- limpet: a clamped violet sac with a suction cup and sting spikes ---------

export function createLimpetMesh() {
  const group = new Group();
  const cup = new Mesh(
    GEO.limpetCup,
    new MeshBasicMaterial({ color: PARASITE_VIOLET.clone().multiplyScalar(0.5), side: DoubleSide }),
  );
  cup.rotation.x = Math.PI;
  cup.position.z = -0.3;
  const sac = new Mesh(
    GEO.limpetSac,
    new MeshBasicMaterial({ color: PARASITE_VIOLET.clone().multiplyScalar(0.75) }),
  );
  sac.scale.set(1, 0.85, 0.8);
  const coreMat = new MeshBasicMaterial({ color: hdr(SICKLY_MAGENTA, 1.5) });
  const core = new Mesh(GEO.limpetCore, coreMat);
  core.position.z = 0.42;
  const spikes: Group = new Group();
  for (let i = 0; i < 6; i += 1) {
    const theta = (i / 6) * Math.PI * 2;
    const spike = new Mesh(
      GEO.limpetSpike,
      new MeshBasicMaterial({ color: PARASITE_VIOLET.clone().multiplyScalar(0.9) }),
    );
    spike.position.set(Math.cos(theta) * 0.72, Math.sin(theta) * 0.62, 0.1);
    spike.rotation.z = theta - Math.PI / 2;
    spike.rotation.x = 0.5;
    spikes.add(spike);
  }
  const rimMat = new MeshBasicMaterial({ color: hdr(PARASITE_VIOLET, 0.9) });
  const rim = new Mesh(GEO.limpetRim, rimMat);
  rim.position.z = -0.55;
  const pulseMat = createAdditiveBasicMaterial({ color: hdr(SICKLY_MAGENTA, 0.7) });
  const pulse = new Mesh(GEO.limpetPulse, pulseMat);
  pulse.scale.set(1, 0.85, 0.6);
  group.add(cup, sac, core, spikes, rim, pulse);
  group.userData.lockCore = coreMat;
  group.userData.lockCoreBase = SICKLY_MAGENTA;
  group.userData.lockRim = rimMat;
  group.userData.lockRimBase = PARASITE_VIOLET;
  group.userData.pulseMesh = pulse;
  return finish(group, PARASITE_VIOLET, 1.1);
}

// -- skimmer: a swept-wing manta that cuts sideways across the frame ---------

export function createSkimmerMesh() {
  const group = new Group();
  const wings = new Mesh(
    SKIMMER_WINGS,
    new MeshBasicMaterial({ color: PARASITE_VIOLET.clone().multiplyScalar(0.7), side: DoubleSide }),
  );
  const body = new Mesh(
    GEO.skimmerBody,
    new MeshBasicMaterial({ color: PARASITE_VIOLET.clone().multiplyScalar(0.9) }),
  );
  body.scale.set(0.55, 0.55, 1.7);
  const coreMat = new MeshBasicMaterial({ color: hdr(SICKLY_MAGENTA, 1.5) });
  const eye = new Mesh(GEO.skimmerEye, coreMat);
  eye.position.z = 0.55;
  const rimMat = createAdditiveBasicMaterial({ color: hdr(SICKLY_MAGENTA, 0.8) });
  const edge = new Mesh(GEO.skimmerEdge, rimMat);
  edge.scale.set(1.15, 0.4, 1);
  const tail = new Mesh(
    GEO.skimmerTail,
    new MeshBasicMaterial({ color: PARASITE_VIOLET.clone().multiplyScalar(0.8) }),
  );
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -1.1;
  group.add(wings, body, eye, edge, tail);
  group.userData.lockCore = coreMat;
  group.userData.lockCoreBase = SICKLY_MAGENTA;
  group.userData.lockRim = rimMat;
  group.userData.lockRimBase = SICKLY_MAGENTA;
  return finish(group, PARASITE_VIOLET, 1.5);
}

// -- darter: a sting needle with a charging glow sac --------------------------

export function createDarterMesh() {
  const group = new Group();
  const needle = new Mesh(
    GEO.darterNeedle,
    new MeshBasicMaterial({ color: PARASITE_VIOLET.clone().multiplyScalar(0.85) }),
  );
  needle.rotation.x = Math.PI / 2;
  const sacMat = new MeshBasicMaterial({ color: hdr(SICKLY_MAGENTA, 1.5) });
  const sac = new Mesh(GEO.darterSac, sacMat);
  sac.position.z = -0.7;
  sac.scale.set(1, 1, 1.3);
  const chargeMat = createAdditiveBasicMaterial({ color: hdr(CORE_WHITE, 1.2) });
  const charge = new Mesh(GEO.darterSac, chargeMat);
  charge.position.z = -0.7;
  charge.scale.setScalar(0.15);
  const fins: Group = new Group();
  for (let i = 0; i < 3; i += 1) {
    const fin = new Mesh(
      GEO.darterFin,
      new MeshBasicMaterial({ color: PARASITE_VIOLET.clone().multiplyScalar(0.7), side: DoubleSide }),
    );
    const angle = (i / 3) * Math.PI * 2;
    fin.position.set(Math.cos(angle) * 0.4, Math.sin(angle) * 0.4, -0.3);
    fin.rotation.z = angle;
    fins.add(fin);
  }
  group.add(needle, sac, charge, fins);
  group.userData.lockCore = sacMat;
  group.userData.lockCoreBase = SICKLY_MAGENTA;
  group.userData.chargeMesh = charge;
  group.userData.spinParts = [fins];
  return finish(group, SICKLY_MAGENTA, 1.2);
}

// -- bolt: an interceptable nematocyst thorn ----------------------------------

export function createBoltMesh() {
  const group = new Group();
  const thorn = new Mesh(
    GEO.boltThorn,
    new MeshBasicMaterial({ color: hdr(SICKLY_MAGENTA, 1.5) }),
  );
  thorn.scale.set(0.55, 0.55, 1.9);
  const glow = new Mesh(
    GEO.boltGlow,
    createAdditiveBasicMaterial({ color: hdr(PARASITE_VIOLET, 0.8), opacity: 0.6 }),
  );
  glow.scale.set(0.55, 0.55, 1.7);
  group.add(thorn, glow);
  group.userData.isBolt = true;
  group.userData.lockCore = thorn.material as MeshBasicMaterial;
  group.userData.lockCoreBase = SICKLY_MAGENTA;
  return finish(group, SICKLY_MAGENTA, 0.8);
}

// -- brood: a fresh-hatched mote cluster spiraling around the parent ---------

export function createBroodMesh() {
  const group = new Group();
  const coreMat = new MeshBasicMaterial({ color: hdr(SICKLY_MAGENTA, 1.6) });
  const core = new Mesh(GEO.broodCore, coreMat);
  const orbiters: Group = new Group();
  for (let i = 0; i < 3; i += 1) {
    const mote = new Mesh(
      GEO.broodMote,
      new MeshBasicMaterial({ color: PARASITE_VIOLET.clone().multiplyScalar(1.0) }),
    );
    const angle = (i / 3) * Math.PI * 2;
    mote.position.set(Math.cos(angle) * 0.85, Math.sin(angle) * 0.85, 0);
    orbiters.add(mote);
  }
  const halo = new Mesh(
    GEO.broodHalo,
    createAdditiveBasicMaterial({ color: hdr(PARASITE_VIOLET, 0.9), side: DoubleSide }),
  );
  group.add(core, orbiters, halo);
  group.userData.lockCore = coreMat;
  group.userData.lockCoreBase = SICKLY_MAGENTA;
  group.userData.spinParts = [orbiters];
  return finish(group, PARASITE_VIOLET, 1.1);
}

// -- web: one plate of the parent's lattice — rings, spokes, membrane --------

export function createWebMesh() {
  const group = new Group();
  const latticeMat = new MeshBasicMaterial({ color: PARASITE_VIOLET.clone().multiplyScalar(0.8), side: DoubleSide });
  const outer = new Mesh(GEO.webOuter, latticeMat);
  const inner = new Mesh(GEO.webInner, latticeMat);
  const spokes: Group = new Group();
  for (let i = 0; i < 6; i += 1) {
    const spoke = new Mesh(GEO.webSpoke, latticeMat);
    spoke.rotation.z = (i / 6) * Math.PI;
    spokes.add(spoke);
  }
  const membraneMat = createAdditiveBasicMaterial({
    color: hdr(PARASITE_VIOLET, 0.28),
    side: DoubleSide,
    opacity: 0.5,
  });
  const membrane = new Mesh(GEO.webMembrane, membraneMat);
  group.add(outer, inner, spokes, membrane);
  group.userData.latticeMat = latticeMat;
  group.userData.membraneMat = membraneMat;
  group.userData.spinParts = [spokes];
  group.userData.accent = PARASITE_VIOLET.clone();
  group.userData.shardSpecs = shardSpecs(PARASITE_VIOLET, 0.4);
  group.userData.lockRingScale = 3.4;
  return group;
}

// -- parent: the brood-mother, dug into the crown ------------------------------

export function createParentMesh() {
  const group = new Group();
  const bulk = new Mesh(
    GEO.parentBulk,
    new MeshBasicMaterial({ color: PARASITE_VIOLET.clone().multiplyScalar(0.5) }),
  );
  bulk.scale.set(1, 0.9, 0.8);
  const spikes: Group = new Group();
  for (let i = 0; i < 9; i += 1) {
    const theta = (i / 9) * Math.PI * 2;
    const spike = new Mesh(
      GEO.parentSpike,
      new MeshBasicMaterial({ color: PARASITE_VIOLET.clone().multiplyScalar(0.75) }),
    );
    spike.position.set(Math.cos(theta) * 3.1, Math.sin(theta) * 2.8, -0.4);
    spike.rotation.z = theta - Math.PI / 2;
    spike.rotation.x = 0.6;
    spikes.add(spike);
  }
  // The wound: a gold-rimmed crater that opens as the webbing starves.
  const craterMat = new MeshBasicMaterial({ color: hdr(BLOOM_GOLD, 0.7) });
  const crater = new Mesh(GEO.parentCrater, craterMat);
  crater.position.z = 2.2;
  const coreMat = new MeshBasicMaterial({ color: hdr(SICKLY_MAGENTA, 1.2) });
  const core = new Mesh(GEO.parentCore, coreMat);
  core.position.z = 2.0;
  core.visible = false;
  const skirt = new Mesh(
    GEO.parentSkirt,
    createAdditiveBasicMaterial({ color: hdr(PARASITE_VIOLET, 0.5), opacity: 0.7 }),
  );
  skirt.position.z = -1.2;
  group.add(bulk, spikes, crater, core, skirt);
  group.userData.lockCore = coreMat;
  group.userData.lockCoreBase = SICKLY_MAGENTA;
  group.userData.coreMesh = core;
  group.userData.craterMat = craterMat;
  group.userData.spinParts = [spikes];
  group.userData.accent = SICKLY_MAGENTA.clone();
  group.userData.shardSpecs = shardSpecs(SICKLY_MAGENTA, 0.5);
  group.userData.lockRingScale = 3.8;
  return group;
}

// -- player projectile: a green-gold sting of the jelly's own light -----------

export function createPlayerBoltMesh() {
  const group = new Group();
  const core = new Mesh(
    GEO.playerCore,
    new MeshBasicMaterial({ color: hdr(CORE_WHITE, 2.8) }),
  );
  core.scale.set(0.45, 0.45, 2.2);
  const shell = new Mesh(
    GEO.playerShell,
    createAdditiveBasicMaterial({ color: hdr(JELLY_GREEN, 0.9), opacity: 0.55 }),
  );
  shell.scale.set(0.55, 0.55, 2.0);
  group.add(core, shell);
  return group;
}

// -- reticle: a diving bell — bell ring, inner polyp, drip brackets ------------

export function createStrandlineReticle() {
  const group = new Group();
  const parts: Array<{ material: MeshBasicMaterial; base: typeof SUNLIT_AQUA; active: typeof SUNLIT_AQUA }> = [];

  const addPart = (mesh: Mesh, base: typeof SUNLIT_AQUA, active: typeof SUNLIT_AQUA) => {
    const material = configureAdditiveMaterial(mesh.material as MeshBasicMaterial, { color: base });
    parts.push({ material, base, active });
  };

  const bell = new Mesh(GEO.reticleBell, new MeshBasicMaterial());
  addPart(bell, hdr(SUNLIT_AQUA, 1.1), hdr(BLOOM_GOLD, 1.7));

  const spinner = new Group();
  const polyp = new Mesh(GEO.reticlePolyp, new MeshBasicMaterial({ side: DoubleSide }));
  addPart(polyp, hdr(SUNLIT_AQUA, 0.8), hdr(CORE_WHITE, 1.6));
  spinner.add(polyp);

  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const drip = new Mesh(GEO.reticleDrip, new MeshBasicMaterial());
    drip.scale.set(0.6, 1.4, 0.6);
    addPart(drip, hdr(JELLY_GREEN, 1.3), hdr(BLOOM_GOLD, 2));
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    drip.position.set(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0);
    brackets.add(drip);
  }

  const dot = new Mesh(GEO.reticleDot, new MeshBasicMaterial());
  addPart(dot, hdr(CORE_WHITE, 2), hdr(CORE_WHITE, 3));

  group.add(bell, spinner, brackets, dot);
  group.userData.parts = parts;
  group.userData.spinner = spinner;
  group.userData.brackets = brackets;
  group.userData.active = false;
  return group;
}

// -- letters: cached per character (geometry shared, materials per plaque) ----

const CELL = 0.34;
const LETTER_WIDTH = 4 * CELL;
const LETTER_HEIGHT = 6 * CELL;
const letterCache = new Map<string, { studs: BufferGeometry; shardSpecs: ShardSpec[] }>();
const letterPlateGeo = new BoxGeometry(LETTER_WIDTH + 0.62, LETTER_HEIGHT + 0.62, 0.08);
const letterStudGeo = new BoxGeometry(0.26, 0.26, 0.12);

function letterGeometry(char: string) {
  const key = char.toUpperCase();
  const cached = letterCache.get(key);
  if (cached) return cached;
  const cells = glyphOnCells(key);
  const shardSpecs: ShardSpec[] = [];
  const studs: BufferGeometry[] = [];
  for (const cell of cells) {
    const offset = new Vector3(cell.x * CELL - LETTER_WIDTH / 2, LETTER_HEIGHT / 2 - cell.y * CELL, 0.07);
    studs.push(letterStudGeo.clone().applyMatrix4(new Matrix4().makeTranslation(offset.x, offset.y, offset.z)));
    const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
    shardSpecs.push({ direction, color: BONE_WHITE.clone(), size: 0.3 });
  }
  const merged = mergeGeometries(studs);
  for (const geometry of studs) geometry.dispose();
  const entry = { studs: merged, shardSpecs };
  letterCache.set(key, entry);
  return entry;
}

const letterFrameGeos: BufferGeometry[] = (() => {
  const fw = LETTER_WIDTH + 0.78;
  const fh = LETTER_HEIGHT + 0.78;
  const geos: BufferGeometry[] = [];
  for (const [w, h, x, y] of [
    [fw, 0.08, 0, fh / 2],
    [fw, 0.08, 0, -fh / 2],
    [0.08, fh, fw / 2, 0],
    [0.08, fh, -fw / 2, 0],
  ] as const) {
    geos.push(new BoxGeometry(w, h, 0.06).applyMatrix4(new Matrix4().makeTranslation(x, y, 0.05)));
  }
  const merged = mergeGeometries(geos);
  for (const geometry of geos) geometry.dispose();
  return [merged];
})();

// Bioluminescent plaques: 5×7 glyphs of raised bone studs on a deep-teal
// plate, ringed by a living green tendril loop — the jelly's own light
// spelling the words. Locking a plaque lights the studs sunlit aqua; a
// denied release sours the whole plaque to parasite violet.

export function createLetterMesh(char: string) {
  const group = new Group();
  const { studs, shardSpecs } = letterGeometry(char);

  const studMaterial = new MeshBasicMaterial({ color: hdr(BONE_WHITE, 1.05) });
  group.add(new Mesh(studs, studMaterial));

  const plateMaterial = new MeshBasicMaterial({ color: SHALLOW_TEAL.clone().multiplyScalar(0.55) });
  group.add(new Mesh(letterPlateGeo, plateMaterial));

  const frameMaterial = createAdditiveBasicMaterial({ color: hdr(JELLY_GREEN, 0.85) });
  group.add(new Mesh(letterFrameGeos[0], frameMaterial));

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = JELLY_GREEN.clone();
  group.userData.letterMaterials = { studMaterial, plateMaterial, frameMaterial };
  return group;
}

type LetterMaterials = { studMaterial: MeshBasicMaterial; plateMaterial: MeshBasicMaterial; frameMaterial: MeshBasicMaterial };

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.studMaterial.color.copy(locked ? hdr(SUNLIT_AQUA, 1.6) : hdr(BONE_WHITE, 1.05));
  materials.frameMaterial.color.copy(locked ? hdr(BONE_WHITE, 1.2) : hdr(JELLY_GREEN, 0.85));
  materials.plateMaterial.color.copy(
    locked ? new Color(0.05, 0.14, 0.13) : SHALLOW_TEAL.clone().multiplyScalar(0.55),
  );
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.studMaterial.color.copy(hdr(PARASITE_VIOLET, 1.3));
    materials.frameMaterial.color.copy(hdr(PARASITE_VIOLET, 1.1));
    materials.plateMaterial.color.copy(new Color(0.1, 0.02, 0.1));
  } else {
    setLetterLocked(group, group.userData.locked === true);
  }
}
