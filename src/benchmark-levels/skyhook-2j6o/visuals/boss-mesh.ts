import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { BOSS_BODY_OFFSET, BOSS_SCALE, CLAW_RADIUS } from '../boss';
import { TETHER_OFFSET } from '../rail';
import { BARE_METAL } from './enemies';
import { CHARCOAL, hdr, HOSTILE_RED, PANEL_DARK } from './palette';
import { cachedTemplate, instantiateTemplate, mergeParts, taggedMesh, taggedPart, tintable, type TintPart } from './template';
import type { ShardSpec } from './effects';

// The Tetherjack: a salvage crawler the size of a house, built for eating
// tethers. Local +z faces the player (the runtime seats it with RAIL_BASIS),
// -z runs up the tether. The body hangs beside the tether toward the car; the
// claws reach down the tether ahead of it and are separate lockable targets.

const DARK = CHARCOAL.clone().multiplyScalar(1.35);

// ---- claw: a hook arm gripping the tether ------------------------------------------

const CLAW = cachedTemplate((b) => {
  // Arm from the shoulder joint (+x, body side) to the hook (-x, on the tether).
  b.panel(new BoxGeometry(2.3, 0.55, 0.5), CHARCOAL.clone().multiplyScalar(1.5), { position: [-0.25, 0, 0], edges: [HOSTILE_RED, 0.45] });
  b.panel(new SphereGeometry(0.5, 10, 8), BARE_METAL, { position: [1.0, 0, 0] });
  b.panel(new TorusGeometry(0.66, 0.2, 6, 16, Math.PI * 1.45), BARE_METAL, { position: [-CLAW_RADIUS, 0, 0], rotation: [0, 0, Math.PI * 0.55] });
  for (const y of [-0.42, 0.42]) b.panel(new BoxGeometry(1.4, 0.16, 0.16), PANEL_DARK, { position: [0.2, y, 0.3] });
  b.light(new OctahedronGeometry(0.18, 0), HOSTILE_RED, 2.0, { position: [-CLAW_RADIUS - 0.2, -0.6, 0] });
  b.light(new SphereGeometry(0.2, 8, 6), HOSTILE_RED, 2.0, { position: [1.0, 0, 0.55] });
});

export function createClawMesh() {
  const group = new Group();
  instantiateTemplate(CLAW(), group);
  group.scale.setScalar(1.6);
  group.userData.baseScale = 1.6;
  group.userData.accent = HOSTILE_RED.clone();
  group.userData.isClaw = true;
  group.userData.shardSpecs = [
    { direction: new Vector3(1, 0.3, 0.3).normalize(), color: BARE_METAL.clone(), size: 0.9 },
    { direction: new Vector3(-1, -0.4, 0.3).normalize(), color: BARE_METAL.clone(), size: 0.8 },
    { direction: new Vector3(0, 1, 0.4).normalize(), color: CHARCOAL.clone().multiplyScalar(2.5), size: 0.7 },
    { direction: new Vector3(0, -1, 0.4).normalize(), color: CHARCOAL.clone().multiplyScalar(2.5), size: 0.7 },
  ] satisfies ShardSpec[];
  group.userData.lockRingScale = 2.4;
  return group;
}

// ---- the body (the `core` enemy, and its stand-in before it is exposed) ------------

const S = BOSS_SCALE;
const TO_TETHER = new Vector3(TETHER_OFFSET.x - BOSS_BODY_OFFSET.x, TETHER_OFFSET.y - BOSS_BODY_OFFSET.y, 0);

const CORE = cachedTemplate((b) => {
  // Hull: a hexagonal drum, axis along the tether, face toward the player.
  const drum = new CylinderGeometry(3.2 * S, 2.6 * S, 5.2 * S, 6);
  drum.rotateX(Math.PI / 2);
  b.panel(drum, DARK, { edges: [HOSTILE_RED, 0.5] });
  // Side pods with three running lights each, in two blink phases.
  for (const side of [-1, 1]) {
    b.panel(new BoxGeometry(1.6 * S, 2.2 * S, 3.6 * S), PANEL_DARK, { position: [side * 3.4 * S, 0.4 * S, -0.6 * S] });
    for (const [index, z] of [-1.4, 0, 1.4].entries()) {
      b.light(new BoxGeometry(0.22 * S, 0.22 * S, 0.22 * S), HOSTILE_RED, 1.6, {
        position: [side * 4.3 * S, 1.1 * S, z * S],
        tag: index % 2 === 0 ? 'lightsA' : 'lightsB',
        bucket: index % 2 === 0 ? 'A' : 'B',
      });
    }
  }
  // Grip arms from the body to the tether.
  const armLength = TO_TETHER.length();
  const armAngle = Math.atan2(TO_TETHER.y, TO_TETHER.x);
  for (const z of [-1.2, 1.0]) {
    b.panel(new BoxGeometry(armLength, 0.7 * S, 0.6 * S), DARK, { position: [TO_TETHER.x / 2, TO_TETHER.y / 2, z * S], rotation: [0, 0, armAngle] });
  }
  // A segmented spine climbing away up the tether: it reads as huge from any distance.
  for (let i = 0; i < 9; i += 1) {
    const radius = (1.9 - i * 0.14) * S;
    const segment = new CylinderGeometry(radius, radius * 0.9, 3.2 * S, 7);
    segment.rotateX(Math.PI / 2);
    b.panel(segment, DARK, { position: [TO_TETHER.x, TO_TETHER.y, (-4 - i * 4.4) * S], rotation: [0, 0, i * 0.4] });
    if (i % 2 === 0) {
      b.light(new BoxGeometry(0.3 * S, 0.3 * S, 0.3 * S), HOSTILE_RED, 1.4, {
        position: [TO_TETHER.x + radius * 0.95, TO_TETHER.y, (-4 - i * 4.4) * S],
        tag: i % 4 === 0 ? 'lightsA' : 'lightsB',
        bucket: i % 4 === 0 ? 'A' : 'B',
      });
    }
  }
  // Six armor petals caging the eye; they hinge open once the claws are gone.
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    b.panel(new BoxGeometry(1.5 * S, 1.05 * S, 0.3 * S), BARE_METAL, {
      tag: `petal${i}`,
      pivot: { position: [0, 0, 2.5 * S], rotation: [0, 0, angle] },
      position: [1.35 * S, 0, 0],
    });
  }
});

// Tags 'lightsA' / 'lightsB' each merge into a single light part: the builder
// keys dynamic parts by tag, so the two buckets become two blinking meshes.

export function createCoreMesh() {
  const group = new Group();
  const template = CORE();
  instantiateTemplate(template, group);

  // The eye: a red core in the gullet. Exposed, it runs hot.
  const eyeMaterial = new MeshBasicMaterial({ color: hdr(HOSTILE_RED, 0.8) });
  const eye = new Mesh(new SphereGeometry(1.25 * S, 18, 14), eyeMaterial);
  eye.position.z = 2.4 * S;
  group.add(eye);
  const eyeGlowMaterial = createAdditiveBasicMaterial({ color: hdr(HOSTILE_RED, 0.3), opacity: 0.45 });
  eye.add(new Mesh(new SphereGeometry(1.9 * S, 14, 10), eyeGlowMaterial));

  group.userData.eyeMaterial = eyeMaterial;
  group.userData.eyeGlowMaterial = eyeGlowMaterial;
  group.userData.accent = HOSTILE_RED.clone();
  group.userData.isTetherjack = true;
  group.userData.shardSpecs = Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * Math.PI * 2;
    return {
      direction: new Vector3(Math.cos(angle), Math.sin(angle) * 0.8, 0.35).normalize(),
      color: (i % 3 === 0 ? BARE_METAL : CHARCOAL.clone().multiplyScalar(2.5)).clone(),
      size: 1.6,
    };
  }) satisfies ShardSpec[];
  group.userData.lockRingScale = 4.5;
  return group;
}

/** Per-frame dressing: eye heat, petal spread, running lights, lurch shudder. */
export function updateCoreMesh(core: Object3D, elapsed: number) {
  const exposed = core.userData.exposed === true;
  const reached = core.userData.reached === true;
  const eyeMaterial = core.userData.eyeMaterial as MeshBasicMaterial | undefined;
  const eyeGlowMaterial = core.userData.eyeGlowMaterial as MeshBasicMaterial | undefined;
  if (!eyeMaterial || !eyeGlowMaterial) return;

  const stage = (core.userData.stage as number | undefined) ?? 0;
  const pulse = exposed ? 1.8 + Math.sin(elapsed * (stage > 0 ? 11 : 7)) * 0.7 : 0.7 + Math.sin(elapsed * 2.4) * 0.15;
  eyeMaterial.color.copy(HOSTILE_RED).multiplyScalar(pulse);
  eyeGlowMaterial.color.copy(HOSTILE_RED).multiplyScalar(pulse * 0.32);

  let spread = (core.userData.petalSpread as number | undefined) ?? 0;
  spread += ((exposed ? 1 : 0) - spread) * 0.05;
  core.userData.petalSpread = spread;
  for (let i = 0; i < 6; i += 1) {
    const hinge = taggedPart(core, `petal${i}`);
    if (!hinge) continue;
    const angle = (i / 6) * Math.PI * 2;
    hinge.rotation.y = -spread * 1.25;
    hinge.position.set(Math.cos(angle) * spread * 0.6 * S, Math.sin(angle) * spread * 0.6 * S, 2.5 * S);
  }

  const lurching = (core.userData.lurching as number | undefined) ?? 0;
  const blink = reached ? 8 : 2.2;
  for (const [tag, phase] of [['lightsA', 0], ['lightsB', 0.5]] as const) {
    const mesh = taggedMesh(core, tag);
    if (!mesh) continue;
    const on = (Math.sin(elapsed * blink + phase * Math.PI * 2) > (reached ? -0.2 : 0.4) ? 1 : 0.15) + lurching * 1.2;
    (mesh.material as MeshBasicMaterial).color.copy(HOSTILE_RED).multiplyScalar(1.6 * on);
  }
}

export function coreParts(core: Object3D): TintPart[] {
  return tintable(core as Group);
}
