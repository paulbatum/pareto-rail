import { AdditiveBlending, BoxGeometry, CircleGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import type { Object3D } from 'three';
import { colorForLockCount } from '../../../engine/locks';
import { CYAN, CYAN_HOT, hdr, LOCK_GRADIENT, WHITE_HOT } from './palette';

// A cyan gunsight: outer ring, four ticks, and six lock pips that light in the
// player's cyan -> ice -> white-gold gradient as the volley builds.

type ReticleState = {
  ring: MeshBasicMaterial;
  ticks: MeshBasicMaterial;
  dot: MeshBasicMaterial;
  pips: MeshBasicMaterial[];
  pipGroup: Group;
  age: number;
};

const dim = new Color(0.05, 0.16, 0.22);
const scratch = new Color();

export function createReticleObject() {
  const root = new Group();
  const additive = (color: Color, opacity = 0.9) => new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const ring = additive(hdr(CYAN, 1.6));
  const ticks = additive(hdr(CYAN_HOT, 1.3));
  const dot = additive(hdr(WHITE_HOT, 1.8));
  root.add(new Mesh(new RingGeometry(0.52, 0.575, 48), ring));
  root.add(new Mesh(new RingGeometry(0.98, 1.0, 64), additive(hdr(CYAN, 0.6), 0.35)));
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(new BoxGeometry(0.26, 0.04, 0.02), ticks);
    const angle = (i * Math.PI) / 2;
    tick.position.set(Math.cos(angle) * 0.74, Math.sin(angle) * 0.74, 0);
    tick.rotation.z = angle;
    root.add(tick);
  }
  root.add(new Mesh(new CircleGeometry(0.035, 12), dot));
  const pipGroup = new Group();
  const pips: MeshBasicMaterial[] = [];
  for (let i = 0; i < 6; i += 1) {
    const material = additive(dim.clone(), 0.95);
    pips.push(material);
    const pip = new Mesh(new BoxGeometry(0.11, 0.11, 0.02), material);
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 2;
    pip.position.set(Math.cos(angle) * 0.86, Math.sin(angle) * 0.86, 0);
    pip.rotation.z = angle + Math.PI / 4;
    pipGroup.add(pip);
  }
  root.add(pipGroup);
  root.userData.reticle = { ring, ticks, dot, pips, pipGroup, age: 0 } satisfies ReticleState;
  root.traverse((child) => { child.userData.raildIgnoreOcclusion = true; });
  return root;
}

export function updateReticleObject(reticle: Object3D, active: boolean, lockCount: number, elapsed: number) {
  const state = reticle.userData.reticle as ReticleState | undefined;
  if (!state) return;
  const full = lockCount >= 6;
  reticle.scale.setScalar(1 + lockCount * 0.05 + (active ? 0.08 : 0) + (full ? 0.12 + Math.sin(elapsed * 28) * 0.03 : 0));
  state.pipGroup.rotation.z = active ? elapsed * (0.7 + lockCount * 0.35) : elapsed * 0.25;
  const lead = lockCount > 0 ? colorForLockCount(lockCount, LOCK_GRADIENT) : CYAN;
  state.ring.color.copy(hdr(full ? WHITE_HOT : lead, active ? 2.0 : 1.4));
  state.ticks.color.copy(hdr(lead, active ? 1.7 : 1.1));
  state.dot.color.copy(hdr(full ? WHITE_HOT : CYAN_HOT, active ? 2.4 : 1.6));
  state.pips.forEach((material, index) => {
    if (index < lockCount) material.color.copy(hdr(colorForLockCount(index + 1, LOCK_GRADIENT), 2.4));
    else material.color.copy(scratch.copy(dim).multiplyScalar(active ? 1.6 : 1));
  });
}
