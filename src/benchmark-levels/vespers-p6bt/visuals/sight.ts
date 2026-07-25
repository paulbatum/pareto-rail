import {
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  ShapeGeometry,
} from 'three';
import { colorForLockCount } from '../../../engine/locks';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { BONE, GOLD, LOCK_GRADIENT, hdr } from './palette';
import { vesicaShape } from './shapes';

// The player's own marks: a quatrefoil sight and a shot shaped like a cross of
// light. Both are bone and gold — deliberately the only warm white in the
// frame — so they can never be confused with the stolen colours.

type SightPart = { material: MeshBasicMaterial; base: Color };

export function createVespersReticle() {
  const group = new Group();
  const parts: SightPart[] = [];
  const add = (mesh: Mesh, base: Color) => {
    parts.push({ material: mesh.material as MeshBasicMaterial, base });
    group.add(mesh);
    return mesh;
  };

  // The lock radius drawn honestly: this ring is what the engine acquires in.
  add(new Mesh(new RingGeometry(0.9, 0.945, 56), sightMaterial()), hdr(BONE, 1.1));

  // Quatrefoil: four lobes on the cardinals, the rose window in miniature.
  const lobes = new Group();
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const lobe = add(new Mesh(new RingGeometry(0.26, 0.3, 20), sightMaterial()), hdr(BONE, 0.85));
    lobe.position.set(Math.cos(angle) * 0.33, Math.sin(angle) * 0.33, 0);
    lobes.add(lobe);
  }
  group.add(lobes);

  // Cusps at the diagonals, counter-turning: the part that spins when held.
  const cusps = new Group();
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const cusp = add(new Mesh(new ShapeGeometry(vesicaShape(0.055, 0.2), 6), sightMaterial()), hdr(GOLD, 1.2));
    cusp.position.set(Math.cos(angle) * 0.66, Math.sin(angle) * 0.66, 0);
    cusp.rotation.z = angle - Math.PI / 2;
    cusps.add(cusp);
  }
  group.add(cusps);

  add(new Mesh(new CircleGeometry(0.045, 16), sightMaterial()), hdr(BONE, 2));

  group.userData.parts = parts;
  group.userData.lobes = lobes;
  group.userData.cusps = cusps;
  group.userData.active = false;
  return group;
}

export function setVespersReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.userData.lockCount = lockCount;
  reticle.scale.setScalar(1 + lockCount * 0.045 + (active ? 0.05 : 0));
  const charge = colorForLockCount(Math.max(1, lockCount), LOCK_GRADIENT);
  const parts = reticle.userData.parts as SightPart[];
  for (const part of parts) {
    if (lockCount > 0) part.material.color.copy(charge).multiplyScalar(1.3 + lockCount * 0.22);
    else part.material.color.copy(part.base).multiplyScalar(active ? 1.5 : 1);
  }
}

export function createVespersProjectile() {
  const group = new Group();
  // The cross faces the camera it was fired from; the streak trails behind it.
  const arm = new Mesh(new PlaneGeometry(0.075, 1.3), sightMaterial(hdr(BONE, 3.2)));
  const bar = new Mesh(new PlaneGeometry(0.52, 0.075), sightMaterial(hdr(BONE, 3.2)));
  bar.position.y = 0.28;
  const bead = new Mesh(new CircleGeometry(0.17, 12), sightMaterial(hdr(GOLD, 2.2)));
  bead.position.z = 0.04;
  const streak = new Mesh(new PlaneGeometry(0.16, 2.6), sightMaterial(hdr(GOLD, 0.9)));
  streak.rotation.x = Math.PI / 2;
  streak.position.z = -1.35;
  group.add(arm, bar, bead, streak);
  return group;
}

function sightMaterial(color: Color | number = 0xffffff) {
  return createAdditiveBasicMaterial({ color, side: DoubleSide });
}
