import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import {
  CORE_WHITE,
  JELLY_GOLD,
  PARASITE_BRUISE,
  PARASITE_CORE,
  PARASITE_VIOLET,
  STRAND_TEAL,
  hdr,
} from './palette';

// Every parasite is built from the same tissue: a bruised violet body, a hot
// magenta core, and hooked appendages. Silhouettes carry the differences —
// the cyst is a hanging sac, the lasher a swimming ribbon, the spitter a
// spiked urchin, the brood a darting tadpole, and the Matriarch a crowned
// mass of grip-arms the size of a house.

export type TintPart = {
  material: MeshBasicMaterial;
  base: Color;
  kind: 'edge' | 'fill' | 'core';
};

function fillMaterial(parts: TintPart[], color: Color, opacity = 1): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ color: color.clone() });
  if (opacity < 1) {
    material.transparent = true;
    material.opacity = opacity;
    material.depthWrite = false;
  }
  parts.push({ material, base: color.clone(), kind: 'fill' });
  return material;
}

function edgeMaterial(parts: TintPart[], color: Color, intensity = 1): MeshBasicMaterial {
  const material = createAdditiveBasicMaterial({ color: hdr(color, intensity), side: DoubleSide });
  parts.push({ material, base: hdr(color, intensity), kind: 'edge' });
  return material;
}

function coreMaterial(parts: TintPart[], color: Color, intensity = 1.6): MeshBasicMaterial {
  const material = new MeshBasicMaterial({ color: hdr(color, intensity) });
  parts.push({ material, base: hdr(color, intensity), kind: 'core' });
  return material;
}

function stampShards(specs: ShardSpec[], count: number, color: Color, size: number, seed = 1) {
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + seed;
    const z = ((i * 0.37 + seed) % 1) * 2 - 1;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    specs.push({
      direction: new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z),
      color: color.clone(),
      size,
    });
  }
}

// ---- cyst -------------------------------------------------------------------

// A hanging sac on a mucus thread, hooks still clutching the strand scrap it
// tore loose. The core pulses like something digesting.
export function createCystMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];
  const shardSpecs: ShardSpec[] = [];

  const sac = new Mesh(new SphereGeometry(0.85, 12, 10), fillMaterial(parts, PARASITE_BRUISE));
  sac.scale.set(1, 1.3, 0.9);
  group.add(sac);

  const membrane = new Mesh(new SphereGeometry(0.98, 12, 10), edgeMaterial(parts, PARASITE_VIOLET, 0.5));
  membrane.scale.set(1, 1.28, 0.92);
  group.add(membrane);

  const core = new Mesh(new SphereGeometry(0.42, 10, 8), coreMaterial(parts, PARASITE_CORE, 1.8));
  core.position.y = -0.1;
  group.add(core);
  group.userData.coreMesh = core;

  // Hook legs curling under the sac.
  const hookGeometries: BufferGeometry[] = [];
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    for (let segment = 0; segment < 3; segment += 1) {
      const piece = new ConeGeometry(0.1 - segment * 0.025, 0.5, 5);
      piece.applyMatrix4(new Matrix4().makeRotationX(Math.PI + segment * 0.7));
      piece.applyMatrix4(new Matrix4().makeTranslation(0, -0.95 - segment * 0.34, 0.15 + segment * 0.2));
      piece.applyMatrix4(new Matrix4().makeRotationY(angle));
      hookGeometries.push(piece);
    }
  }
  group.add(new Mesh(mergeGeometries(hookGeometries), fillMaterial(parts, PARASITE_VIOLET.clone().multiplyScalar(0.5))));
  for (const geometry of hookGeometries) geometry.dispose();

  // The stolen strand scrap in its grip — the one teal note on any parasite.
  const scrap = new Mesh(new CylinderGeometry(0.07, 0.09, 1.6, 6), fillMaterial(parts, STRAND_TEAL.clone().multiplyScalar(0.7)));
  scrap.position.set(0.1, -1.6, 0.2);
  scrap.rotation.z = 0.5;
  group.add(scrap);

  // Mucus thread it hangs from; the runtime stretches it upward.
  const thread = new Mesh(
    new CylinderGeometry(0.03, 0.05, 1, 5),
    edgeMaterial(parts, PARASITE_VIOLET.clone().lerp(CORE_WHITE, 0.4), 0.35),
  );
  thread.position.y = 1.6;
  group.add(thread);
  group.userData.threadMesh = thread;

  stampShards(shardSpecs, 9, PARASITE_VIOLET, 0.34, 0.6);
  stampShards(shardSpecs, 4, PARASITE_CORE, 0.22, 2.1);
  group.userData.parts = parts;
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = PARASITE_CORE.clone();
  group.userData.lockRingScale = 1.15;
  return group;
}

// ---- lasher -----------------------------------------------------------------

// A swimming ribbon: nine tapering plates. The runtime undulates the chain.
export function createLasherMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];
  const shardSpecs: ShardSpec[] = [];

  const bodyMaterial = fillMaterial(parts, PARASITE_BRUISE.clone().multiplyScalar(1.15));
  const finMaterial = edgeMaterial(parts, PARASITE_VIOLET, 0.55);
  const segments: Mesh[] = [];
  const SEGMENTS = 9;
  for (let i = 0; i < SEGMENTS; i += 1) {
    const t = i / (SEGMENTS - 1);
    const width = 0.62 * (1 - t * 0.75);
    const segment = new Mesh(new SphereGeometry(0.5, 8, 6), bodyMaterial);
    segment.scale.set(width, 0.5 * (1 - t * 0.5), 0.62);
    segment.position.z = -i * 0.62;
    group.add(segment);
    segments.push(segment);

    if (i % 2 === 0 && i > 0 && i < SEGMENTS - 1) {
      const fin = new Mesh(new ConeGeometry(0.16, 0.8, 4), finMaterial);
      fin.rotation.z = Math.PI / 2;
      fin.position.set(width + 0.3, 0, -i * 0.62);
      group.add(fin);
      const fin2 = fin.clone();
      fin2.rotation.z = -Math.PI / 2;
      fin2.position.x = -(width + 0.3);
      group.add(fin2);
      segments.push(fin, fin2);
    }
  }

  // Head: a blunt hood with the hot core showing through.
  const core = new Mesh(new SphereGeometry(0.28, 8, 6), coreMaterial(parts, PARASITE_CORE, 1.7));
  core.position.z = 0.18;
  group.add(core);

  group.userData.lasherSegments = segments;
  stampShards(shardSpecs, 10, PARASITE_VIOLET, 0.3, 1.3);
  group.userData.parts = parts;
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = PARASITE_VIOLET.clone();
  group.userData.lockRingScale = 1.2;
  return group;
}

// ---- spitter ----------------------------------------------------------------

// A spiked urchin wedged between strands; its mouth-lamp is the tell.
export function createSpitterMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];
  const shardSpecs: ShardSpec[] = [];

  group.add(new Mesh(new SphereGeometry(0.9, 12, 10), fillMaterial(parts, PARASITE_BRUISE.clone().multiplyScalar(0.85))));

  const spikeGeometries: BufferGeometry[] = [];
  const SPIKES = 16;
  for (let i = 0; i < SPIKES; i += 1) {
    const z = (i + 0.5) / SPIKES * 2 - 1;
    const angle = i * 2.399963; // golden angle spiral
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const direction = new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
    // Cone points +Y; translate out along it, then rotate +Y onto direction.
    const spike = new ConeGeometry(0.14, 1.15, 5);
    spike.applyMatrix4(new Matrix4().makeTranslation(0, 1.28, 0));
    spike.applyMatrix4(rotationFromY(direction));
    spikeGeometries.push(spike);
  }
  group.add(new Mesh(mergeGeometries(spikeGeometries), fillMaterial(parts, PARASITE_VIOLET.clone().multiplyScalar(0.6))));
  for (const geometry of spikeGeometries) geometry.dispose();

  // Mouth lamp: faces the camera (the whole mesh billboards).
  const mouthRim = new Mesh(new TorusGeometry(0.34, 0.07, 8, 18), edgeMaterial(parts, PARASITE_VIOLET, 0.8));
  mouthRim.position.z = 0.86;
  group.add(mouthRim);
  const lampMaterial = new MeshBasicMaterial({ color: hdr(PARASITE_CORE, 0.7) });
  const lamp = new Mesh(new SphereGeometry(0.24, 8, 6), lampMaterial);
  lamp.position.z = 0.88;
  group.add(lamp);
  group.userData.chargeLamp = lampMaterial;

  stampShards(shardSpecs, 12, PARASITE_VIOLET, 0.36, 0.2);
  stampShards(shardSpecs, 5, PARASITE_CORE, 0.2, 1.7);
  group.userData.parts = parts;
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = PARASITE_CORE.clone();
  group.userData.lockRingScale = 1.25;
  return group;
}

function rotationFromY(direction: Vector3): Matrix4 {
  const up = new Vector3(0, 1, 0);
  const axis = new Vector3().crossVectors(up, direction);
  const matrix = new Matrix4();
  if (axis.lengthSq() < 0.0001) {
    if (direction.y < 0) matrix.makeRotationX(Math.PI);
    return matrix;
  }
  axis.normalize();
  return matrix.makeRotationAxis(axis, Math.acos(Math.max(-1, Math.min(1, up.dot(direction)))));
}

// ---- venom ------------------------------------------------------------------

// A lobbed glob of the colony's own acid — small, hot, and wobbling.
export function createVenomMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];

  const core = new Mesh(new SphereGeometry(0.3, 10, 8), coreMaterial(parts, PARASITE_CORE, 2.2));
  core.scale.set(1, 1, 1.7);
  group.add(core);
  const shell = new Mesh(new SphereGeometry(0.5, 10, 8), edgeMaterial(parts, PARASITE_VIOLET, 1.0));
  shell.scale.set(1, 1, 1.5);
  group.add(shell);
  const drips = new Mesh(new SphereGeometry(0.16, 6, 5), edgeMaterial(parts, PARASITE_CORE, 1.1));
  drips.position.set(0.2, -0.25, -0.5);
  group.add(drips);

  group.userData.parts = parts;
  group.userData.shardSpecs = [] as ShardSpec[];
  group.userData.accent = PARASITE_CORE.clone();
  group.userData.isHostileShot = true;
  group.userData.trailColor = PARASITE_VIOLET.clone().multiplyScalar(0.7);
  group.userData.lockRingScale = 0.8;
  return group;
}

// ---- brood ------------------------------------------------------------------

// The Matriarch's larvae: fast tadpole-shaped guardians orbiting the web.
export function createBroodMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];
  const shardSpecs: ShardSpec[] = [];

  const head = new Mesh(new SphereGeometry(0.55, 10, 8), fillMaterial(parts, PARASITE_BRUISE.clone().multiplyScalar(1.3)));
  head.scale.set(1, 0.85, 1.1);
  group.add(head);
  const eye = new Mesh(new SphereGeometry(0.26, 8, 6), coreMaterial(parts, PARASITE_CORE, 2.0));
  eye.position.z = 0.3;
  group.add(eye);
  const hood = new Mesh(new SphereGeometry(0.66, 10, 8), edgeMaterial(parts, PARASITE_VIOLET, 0.6));
  hood.scale.set(1, 0.8, 1.0);
  group.add(hood);

  const tailMaterial = fillMaterial(parts, PARASITE_VIOLET.clone().multiplyScalar(0.55));
  const segments: Mesh[] = [];
  for (let i = 0; i < 3; i += 1) {
    const t = (i + 1) / 3;
    const segment = new Mesh(new SphereGeometry(0.3, 6, 5), tailMaterial);
    segment.scale.set(1 - t * 0.6, 0.6 * (1 - t * 0.5), 1);
    segment.position.set(0, 0, -0.5 - i * 0.42);
    group.add(segment);
    segments.push(segment);
  }
  group.userData.lasherSegments = segments;

  stampShards(shardSpecs, 7, PARASITE_CORE, 0.24, 0.9);
  group.userData.parts = parts;
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = PARASITE_CORE.clone();
  group.userData.lockRingScale = 1.0;
  return group;
}

// ---- matriarch --------------------------------------------------------------

// The parent organism, dug into the crown: a crowned mass of grip-arms around
// a swollen body, its heart buried until the webbing dies. Local +Z faces the
// player (gameplay lookAt), so the web lattices hang between it and the diver.
export function createMatriarchMesh(): Group {
  const group = new Group();
  const parts: TintPart[] = [];
  const shardSpecs: ShardSpec[] = [];

  // The swollen body — ridged by stacked, slightly offset shells, merged.
  const bodyMaterial = fillMaterial(parts, PARASITE_BRUISE.clone().multiplyScalar(0.9));
  const shellGeometries: BufferGeometry[] = [];
  for (let i = 0; i < 4; i += 1) {
    const shell = new SphereGeometry(4.6 - i * 0.5, 14, 12);
    shell.applyMatrix4(new Matrix4().makeScale(1, 1.15, 0.95));
    shell.applyMatrix4(new Matrix4().makeTranslation(0, i * 0.7 - 0.4, -i * 0.35));
    shellGeometries.push(shell);
  }
  group.add(new Mesh(mergeGeometries(shellGeometries), bodyMaterial));
  for (const geometry of shellGeometries) geometry.dispose();
  const membrane = new Mesh(new SphereGeometry(5.1, 14, 12), edgeMaterial(parts, PARASITE_VIOLET, 0.35));
  membrane.scale.set(1, 1.2, 0.95);
  group.add(membrane);

  // Grip arms: eight jointed claws splayed up and back, dug into the crown.
  const armMaterial = fillMaterial(parts, PARASITE_VIOLET.clone().multiplyScalar(0.45));
  const armGeometries: BufferGeometry[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    for (let segment = 0; segment < 4; segment += 1) {
      const piece = new ConeGeometry(0.85 - segment * 0.17, 2.6, 6);
      piece.applyMatrix4(new Matrix4().makeRotationX(-0.9 - segment * 0.5));
      piece.applyMatrix4(new Matrix4().makeTranslation(0, 3.6 + segment * 1.7, -1.2 - segment * 0.9));
      piece.applyMatrix4(new Matrix4().makeRotationZ(angle));
      armGeometries.push(piece);
    }
  }
  group.add(new Mesh(mergeGeometries(armGeometries), armMaterial));
  for (const geometry of armGeometries) geometry.dispose();

  // Brood nodules crusting the underside.
  const noduleGeometries: BufferGeometry[] = [];
  for (let i = 0; i < 14; i += 1) {
    const angle = i * 2.399963;
    const r = 2.2 + (i % 4) * 0.6;
    const nodule = new SphereGeometry(0.5 + (i % 3) * 0.18, 6, 5);
    nodule.applyMatrix4(new Matrix4().makeTranslation(Math.cos(angle) * r, -4.2 + (i % 3) * 0.5, Math.sin(angle) * r * 0.5 + 1.2));
    noduleGeometries.push(nodule);
  }
  group.add(new Mesh(mergeGeometries(noduleGeometries), fillMaterial(parts, PARASITE_VIOLET.clone().multiplyScalar(0.7))));
  for (const geometry of noduleGeometries) geometry.dispose();

  // The heart: hidden dim behind the web, blinding once bare.
  const heartMaterial = new MeshBasicMaterial({ color: hdr(PARASITE_CORE, 0.5) });
  const heart = new Mesh(new SphereGeometry(1.7, 12, 10), heartMaterial);
  heart.position.set(0, -0.4, 3.6);
  group.add(heart);
  const heartRim = new Mesh(new TorusGeometry(2.2, 0.16, 8, 24), edgeMaterial(parts, PARASITE_CORE, 0.5));
  heartRim.position.copy(heart.position);
  group.add(heartRim);
  group.userData.heartMaterial = heartMaterial;

  // Webbing lattices: two ring-lattice layers between the heart and the
  // diver, wide open in the middle — the broods orbit through the opening.
  // The lattice is a wide funnel AROUND the fight, not across it: rings and
  // struts stay outside the brood orbits so the line of fire into the open
  // center — broods, then the bared heart — is never blocked.
  const webLayerGroups: Group[] = [];
  const webRadii = [11.2, 9.0];
  for (let layer = 0; layer < 2; layer += 1) {
    const webGroup = new Group();
    const radius = webRadii[layer];
    const webMaterial = createAdditiveBasicMaterial({ color: hdr(PARASITE_VIOLET, 0.55), side: DoubleSide });
    parts.push({ material: webMaterial, base: hdr(PARASITE_VIOLET, 0.55), kind: 'edge' });
    const webGeometries: BufferGeometry[] = [
      new TorusGeometry(radius, 0.09, 6, 40),
      new TorusGeometry(radius * 0.86, 0.06, 6, 36),
    ];
    const STRUTS = 10;
    for (let i = 0; i < STRUTS; i += 1) {
      const angle = (i / STRUTS) * Math.PI * 2 + layer * 0.3;
      const strut = new CylinderGeometry(0.05, 0.05, radius * 0.24, 4);
      strut.applyMatrix4(new Matrix4().makeRotationZ(Math.PI / 2));
      strut.applyMatrix4(new Matrix4().makeTranslation(radius * 0.93, 0, 0));
      strut.applyMatrix4(new Matrix4().makeRotationZ(angle));
      // Sag each strut back toward the body slightly.
      strut.applyMatrix4(new Matrix4().makeRotationX(0.12));
      webGeometries.push(strut);
    }
    webGroup.add(new Mesh(mergeGeometries(webGeometries), webMaterial));
    for (const geometry of webGeometries) geometry.dispose();
    webGroup.position.z = 10.5 + layer * 3.2;
    group.add(webGroup);
    webLayerGroups.push(webGroup);
  }
  group.userData.webLayerGroups = webLayerGroups;
  group.userData.webShrivel = [0, 0];

  stampShards(shardSpecs, 16, PARASITE_VIOLET, 0.6, 0.4);
  stampShards(shardSpecs, 8, PARASITE_CORE, 0.4, 1.9);
  group.userData.parts = parts;
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = PARASITE_CORE.clone();
  group.userData.isMatriarch = true;
  group.userData.lockRingScale = 3.4;
  return group;
}

// Runtime animation the mesh owns: heart state, web shrivel, flinch shudder.
export function updateMatriarchMesh(group: Group, elapsed: number, dt: number) {
  const heartMaterial = group.userData.heartMaterial as MeshBasicMaterial | undefined;
  const exposed = group.userData.exposed === true;
  const flinching = group.userData.flinching === true;
  if (heartMaterial && group.userData.locked !== true) {
    const pulse = exposed
      ? 1.7 + Math.sin(elapsed * 7) * 0.7
      : 0.45 + Math.sin(elapsed * 2.2) * 0.15;
    heartMaterial.color.copy(hdr(PARASITE_CORE, flinching ? 2.6 : pulse));
  }

  const webLayerGroups = group.userData.webLayerGroups as Group[] | undefined;
  const webLayers = (group.userData.webLayers as number | undefined) ?? 2;
  const shrivel = group.userData.webShrivel as number[] | undefined;
  if (webLayerGroups && shrivel) {
    for (let layer = 0; layer < webLayerGroups.length; layer += 1) {
      // Outer web (index 0) is fed by wave one; it dies first.
      const alive = layer === 0 ? webLayers >= 2 : webLayers >= 1;
      const target = alive ? 0 : 1;
      shrivel[layer] = Math.min(1, shrivel[layer] + (target > shrivel[layer] ? dt * 1.4 : 0));
      const webGroup = webLayerGroups[layer];
      const s = 1 - shrivel[layer];
      if (s <= 0.02) {
        webGroup.visible = false;
        continue;
      }
      webGroup.visible = true;
      webGroup.scale.setScalar(Math.max(0.05, s));
      webGroup.rotation.z += dt * (0.15 + shrivel[layer] * 2.2);
      // Breathing while alive; a dying layer twists and collapses.
      if (alive) webGroup.scale.multiplyScalar(1 + Math.sin(elapsed * 1.7 + layer) * 0.03);
    }
  }
}
