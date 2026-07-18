import {
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  OctahedronGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MeshBasicMaterial } from 'three';
import type { Rng } from '../../../engine/rng';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { BIO_DIM, BIO_GOLD, BIO_GREEN, hdr } from './palette';

// One tentacle strand: a long tapered rope that is thick where it roots into
// the bell far above and thins to nothing below, bent along its length so no
// two read as the same object, with luminous nodules strung down it. The
// nodules are the readable part at distance — a strand is a line of lights.

export type StrandMaterials = {
  core: MeshBasicMaterial;
  sleeve: MeshBasicMaterial;
  nodes: MeshBasicMaterial;
};

export type StrandBuild = {
  group: Group;
  materials: StrandMaterials;
  /** 0 = infested and dim, 1 = fully lit. Written by the visuals spine. */
  litBase: number;
};

const HEIGHT = 300;

/** The lateral wander of a strand as a function of height, shared by tube and nodules. */
function bend(y: number, phase: number, amplitude: number) {
  const t = y / HEIGHT;
  return {
    x: Math.sin(t * 3.1 + phase) * amplitude + Math.sin(t * 7.4 + phase * 2.1) * amplitude * 0.28,
    z: Math.cos(t * 2.6 + phase * 1.7) * amplitude * 0.8,
  };
}

function bendGeometry(geometry: BufferGeometry, phase: number, amplitude: number) {
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    const offset = bend(y, phase, amplitude);
    position.setX(i, position.getX(i) + offset.x);
    position.setZ(i, position.getZ(i) + offset.z);
  }
  position.needsUpdate = true;
  geometry.computeBoundingSphere();
  return geometry;
}

export function createStrand(rng: Rng): StrandBuild {
  const group = new Group();
  const phase = rng() * Math.PI * 2;
  const amplitude = 6 + rng() * 14;
  const topRadius = 0.75 + rng() * 0.7;

  // The core is additive rather than solid: a tentacle is translucent tissue
  // full of light, so the water and anything behind it shows through. It also
  // means the forest never hides a target you are trying to sweep across.
  const core = createAdditiveBasicMaterial({ color: hdr(BIO_GREEN, 0.5), opacity: 0.62 });
  const coreGeometry = bendGeometry(
    new CylinderGeometry(topRadius, topRadius * 0.16, HEIGHT, 5, 18, true),
    phase,
    amplitude,
  );
  group.add(new Mesh(coreGeometry, core));

  // A wider additive sleeve is the bioluminescence bleeding into the water.
  const sleeve = createAdditiveBasicMaterial({ color: hdr(BIO_GREEN, 0.3), opacity: 0.28 });
  const sleeveGeometry = bendGeometry(
    new CylinderGeometry(topRadius * 2.6, topRadius * 0.5, HEIGHT, 5, 18, true),
    phase,
    amplitude,
  );
  group.add(new Mesh(sleeveGeometry, sleeve));

  // Nodules: the lights that make a strand legible at fog distance.
  const beads: BufferGeometry[] = [];
  const beadCount = 12 + Math.floor(rng() * 7);
  for (let i = 0; i < beadCount; i += 1) {
    const t = (i + 0.5) / beadCount;
    const y = HEIGHT * (0.5 - t);
    const offset = bend(y, phase, amplitude);
    const size = 0.55 + (1 - t) * 0.85 + rng() * 0.3;
    beads.push(
      new OctahedronGeometry(size, 0).applyMatrix4(
        new Matrix4().makeTranslation(offset.x + (rng() - 0.5) * topRadius, y, offset.z + (rng() - 0.5) * topRadius),
      ),
    );
  }
  const nodes = createAdditiveBasicMaterial({ color: hdr(BIO_GOLD, 0.85), opacity: 0.95 });
  const merged = mergeGeometries(beads);
  group.add(new Mesh(merged, nodes));
  for (const geometry of beads) geometry.dispose();

  // A slight backward rake: the animal is swimming and these things trail.
  group.rotation.z = (rng() - 0.5) * 0.22;
  group.rotation.x = -0.05 - rng() * 0.14;
  group.userData.sway = phase;
  group.userData.swayRate = 0.24 + rng() * 0.26;

  return { group, materials: { core, sleeve, nodes }, litBase: 0.55 + rng() * 0.45 };
}

/**
 * Recolour one strand for how much of the animal has been freed. Infested
 * water leaves the strands a dull sea-green; a revived strand burns green-gold.
 */
export function setStrandLight(materials: StrandMaterials, lit: number, flare = 0) {
  const bio = BIO_DIM.clone().lerp(BIO_GREEN, lit);
  materials.core.color.copy(bio).multiplyScalar(0.42 + lit * 0.5 + flare * 0.9);
  materials.sleeve.color.copy(bio).multiplyScalar(0.2 + lit * 0.34 + flare * 1.4);
  materials.nodes.color.copy(new Color().copy(bio).lerp(BIO_GOLD, 0.55 + lit * 0.4)).multiplyScalar(0.45 + lit * 0.8 + flare * 2.2);
}
