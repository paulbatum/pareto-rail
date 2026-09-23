import { CircleGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, SphereGeometry } from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';

// Leaf: the player's own light. The reticle is a ring of six beads — one
// lights per lock, so a full charge is a full string — and shots are seeds of
// sunlight. Colours arrive from the spine.

export type ReticleLook = { ring: Color; bead: Color; dot: Color };

export function createReticleMesh(look: ReticleLook) {
  const group = new Group();
  const ringMaterial = createAdditiveBasicMaterial({ color: look.ring.clone(), side: DoubleSide });
  const ring = new Mesh(new RingGeometry(0.78, 0.83, 64), ringMaterial);
  const innerMaterial = createAdditiveBasicMaterial({ color: look.ring.clone().multiplyScalar(0.6), side: DoubleSide });
  const inner = new Mesh(new RingGeometry(0.22, 0.25, 32), innerMaterial);
  const dotMaterial = new MeshBasicMaterial({ color: look.dot.clone() });
  const dot = new Mesh(new CircleGeometry(0.05, 16), dotMaterial);

  const beads = new Group();
  const beadMaterials: MeshBasicMaterial[] = [];
  const beadHaloMaterials: MeshBasicMaterial[] = [];
  const beadGeometry = new SphereGeometry(0.095, 10, 8);
  const haloGeometry = new CircleGeometry(0.17, 16);
  for (let i = 0; i < 6; i += 1) {
    const angle = Math.PI / 2 - (i / 6) * Math.PI * 2;
    const material = new MeshBasicMaterial({ color: look.bead.clone() });
    const bead = new Mesh(beadGeometry, material);
    bead.position.set(Math.cos(angle) * 0.805, Math.sin(angle) * 0.805, 0.01);
    const haloMaterial = createAdditiveBasicMaterial({ color: look.bead.clone(), opacity: 0 });
    const halo = new Mesh(haloGeometry, haloMaterial);
    halo.position.copy(bead.position);
    beads.add(bead, halo);
    beadMaterials.push(material);
    beadHaloMaterials.push(haloMaterial);
  }
  group.add(ring, inner, dot, beads);
  group.userData.reticle = { ringMaterial, innerMaterial, dotMaterial, beadMaterials, beadHaloMaterials, beads, look };
  return group;
}

export type ReticleParts = {
  ringMaterial: MeshBasicMaterial;
  innerMaterial: MeshBasicMaterial;
  dotMaterial: MeshBasicMaterial;
  beadMaterials: MeshBasicMaterial[];
  beadHaloMaterials: MeshBasicMaterial[];
  beads: Group;
  look: ReticleLook;
};

export function createShotMesh(core: Color, halo: Color) {
  const group = new Group();
  const seed = new Mesh(new SphereGeometry(0.2, 12, 8), new MeshBasicMaterial({ color: core.clone() }));
  seed.scale.set(0.9, 0.9, 2.6);
  const glow = new Mesh(new SphereGeometry(0.46, 12, 8), createAdditiveBasicMaterial({ color: halo.clone(), opacity: 0.5 }));
  glow.scale.set(1, 1, 1.9);
  group.add(seed, glow);
  return group;
}
