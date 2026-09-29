import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
} from 'three';
import type { Object3D } from 'three';
import { colorForLockCount } from '../../../engine/locks';
import { once } from './merge';
import { KEYLINE, LOCK_GRADIENT, SIGNAL_WHITE, ICE, hdr } from './palette';

// Everything the player owns is cold white-cyan with a dark keyline behind it:
// the reticle, the six charge pips, the lock clamps, the shots.

type ReticlePart = { material: MeshBasicMaterial; base: Color };

const overlay = (material: MeshBasicMaterial) => {
  // The reticle must never be hidden behind a nearby hostile.
  material.depthTest = false;
  material.depthWrite = false;
  material.transparent = true;
  return material;
};

export function createReticle() {
  const group = new Group();
  const parts: ReticlePart[] = [];
  const add = (mesh: Mesh, base: Color, order: number, target: Object3D = group) => {
    const material = overlay(mesh.material as MeshBasicMaterial);
    material.color.copy(base);
    mesh.renderOrder = order;
    parts.push({ material, base });
    target.add(mesh);
    return mesh;
  };
  const keyline = (mesh: Mesh, target: Object3D = group) => {
    const material = overlay(mesh.material as MeshBasicMaterial);
    material.color.copy(KEYLINE);
    material.opacity = 0.7;
    mesh.renderOrder = 8;
    target.add(mesh);
  };

  // Lock-radius ring, with a dark halo so it survives a sunlit sky.
  keyline(new Mesh(new RingGeometry(1.02, 1.36, 64), new MeshBasicMaterial({ side: DoubleSide })));
  add(new Mesh(new RingGeometry(1.14, 1.24, 64), new MeshBasicMaterial({ side: DoubleSide })), hdr(SIGNAL_WHITE, 1.15), 10);

  // Inner sight: four ticks that turn as you sweep.
  const sight = new Group();
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const tickBack = new Mesh(new BoxGeometry(0.4, 0.14, 0.01), new MeshBasicMaterial());
    const tick = new Mesh(new BoxGeometry(0.34, 0.07, 0.01), new MeshBasicMaterial());
    for (const m of [tickBack, tick]) {
      m.position.set(Math.cos(angle) * 0.62, Math.sin(angle) * 0.62, 0);
      m.rotation.z = angle;
    }
    keyline(tickBack, sight);
    add(tick, hdr(SIGNAL_WHITE, 1.3), 10, sight);
  }
  group.add(sight);
  add(new Mesh(new CircleGeometry(0.06, 14), new MeshBasicMaterial()), hdr(SIGNAL_WHITE, 2.2), 11);

  // Six charge pips on an outer arc: each lock lights one, the sixth ignites all.
  const pips: Mesh[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = Math.PI / 2 + ((i - 2.5) / 6) * Math.PI * 1.15;
    const back = new Mesh(new BoxGeometry(0.34, 0.34, 0.01), new MeshBasicMaterial());
    back.position.set(Math.cos(angle) * 1.72, Math.sin(angle) * 1.72, 0);
    back.rotation.z = angle - Math.PI / 2;
    keyline(back);
    const pip = new Mesh(new BoxGeometry(0.24, 0.24, 0.01), new MeshBasicMaterial());
    pip.position.copy(back.position);
    pip.rotation.z = back.rotation.z;
    add(pip, new Color(0.06, 0.07, 0.09), 10);
    pips.push(pip);
  }

  group.userData.parts = parts;
  group.userData.sight = sight;
  group.userData.pips = pips;
  group.userData.active = false;
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.userData.active = active;
  reticle.scale.setScalar(1 + lockCount * 0.035 + (active ? 0.06 : 0));
  const pips = reticle.userData.pips as Mesh[] | undefined;
  if (!pips) return;
  pips.forEach((pip, index) => {
    const material = pip.material as MeshBasicMaterial;
    if (index < lockCount) {
      const color = colorForLockCount(index + 1, LOCK_GRADIENT);
      material.color.copy(hdr(color, lockCount >= 6 ? 2.4 : 1.7));
    } else {
      material.color.set(0.06, 0.07, 0.09);
    }
  });
}

export function updateReticle(reticle: Object3D | undefined, dt: number) {
  if (!reticle) return;
  const sight = reticle.userData.sight as Group | undefined;
  if (sight) sight.rotation.z += dt * (reticle.userData.active ? 3.4 : 0.6);
}

// Player shot: a cold white dart with a cyan shell.
export function createProjectileMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.5, 0.5, 2.5);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(SIGNAL_WHITE, 2.8) })));
  const shellGeometry = new OctahedronGeometry(0.5, 0);
  shellGeometry.scale(0.55, 0.55, 2.0);
  group.add(new Mesh(shellGeometry, new MeshBasicMaterial({ color: hdr(ICE, 1.1), blending: AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.55 })));
  return group;
}

/** The clamp that closes on a locked hostile: dark keyline, then a white octagon. */
export function makeLockRing(color: Color) {
  const group = new Group();
  const geometry = once('lock-ring', () => ({
    back: new RingGeometry(0.8, 1.14, 8),
    ring: new RingGeometry(0.88, 0.98, 8),
    inner: new RingGeometry(0.68, 0.71, 32),
  }));
  const back = new Mesh(geometry.back, new MeshBasicMaterial({ color: KEYLINE.clone(), side: DoubleSide, transparent: true, opacity: 0.6, depthWrite: false }));
  const ring = new Mesh(
    geometry.ring,
    new MeshBasicMaterial({ color: hdr(color, 1.9), side: DoubleSide, blending: AdditiveBlending, transparent: true, depthWrite: false }),
  );
  const inner = new Mesh(
    geometry.inner,
    new MeshBasicMaterial({ color: hdr(color.clone().lerp(SIGNAL_WHITE, 0.5), 1.4), side: DoubleSide, blending: AdditiveBlending, transparent: true, depthWrite: false }),
  );
  group.add(back, ring, inner);
  group.traverse((o) => (o.userData.raildIgnoreOcclusion = true));
  return group;
}
