import {
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
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
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { ShardSpec } from './effects';
import { PARASITE_HOT, PARASITE_SHELL, PARASITE_VIOLET, WEBBING, hdr } from './palette';

// Four parasite bodies, built so that the silhouette alone tells you what a
// thing does. A clinger is a flat shell with hooks that grip. A swarmer is all
// spines and tail — it travels. A borer is a drill with a collar — it is
// rooted and dangerous. A brood is a soft translucent sac — it is coming for
// you. Every one of them carries the same three-part material language: a dark
// chitin shell, violet plating, and a hot core that is the thing to shoot.

export type TintPart = { material: MeshBasicMaterial; base: import('three').Color; kind: 'shell' | 'plate' | 'core' };

function part(
  parts: TintPart[],
  kind: TintPart['kind'],
  color: import('three').Color,
  additive: boolean,
  opacity = 1,
) {
  const material = additive
    ? createAdditiveBasicMaterial({ color: color.clone(), opacity })
    : new MeshBasicMaterial({ color: color.clone(), side: DoubleSide });
  parts.push({ material, base: color.clone(), kind });
  return material;
}

function finish(group: Group, parts: TintPart[], shards: ShardSpec[], accent: import('three').Color) {
  group.userData.parts = parts;
  group.userData.shardSpecs = shards;
  group.userData.accent = accent.clone();
  return group;
}

function radialShards(count: number, color: import('three').Color, size: number, flatten = 1): ShardSpec[] {
  const specs: ShardSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    specs.push({
      direction: new Vector3(Math.cos(angle), Math.sin(angle) * flatten, (i % 2 === 0 ? 0.5 : -0.5)),
      color: color.clone(),
      size,
    });
  }
  return specs;
}

/** Clinger: a limpet shell with five hooked legs clamped round a strand. */
export function createClingMesh() {
  const group = new Group();
  const parts: TintPart[] = [];

  const shell = new Mesh(
    new SphereGeometry(1.05, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52),
    part(parts, 'shell', PARASITE_SHELL, false),
  );
  shell.scale.set(1, 0.62, 1);
  group.add(shell);

  const plateMaterial = part(parts, 'plate', PARASITE_VIOLET, true, 0.85);
  const ridges: BufferGeometry[] = [];
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    // Hooked legs: a bent claw reaching down and inward to grip the strand.
    ridges.push(new CylinderGeometry(0.09, 0.16, 1.5, 4).applyMatrix4(
      new Matrix4()
        .makeTranslation(Math.cos(angle) * 0.98, -0.42, Math.sin(angle) * 0.98)
        .multiply(new Matrix4().makeRotationZ(-Math.cos(angle) * 0.85))
        .multiply(new Matrix4().makeRotationX(Math.sin(angle) * 0.85)),
    ));
  }
  ridges.push(new TorusGeometry(0.92, 0.07, 4, 18).applyMatrix4(new Matrix4().makeRotationX(Math.PI / 2)));
  const plates = new Mesh(mergeGeometries(ridges), plateMaterial);
  group.add(plates);
  for (const geometry of ridges) geometry.dispose();

  const core = new Mesh(new OctahedronGeometry(0.42, 0), part(parts, 'core', PARASITE_HOT, true, 0.95));
  core.position.y = 0.34;
  group.add(core);
  group.userData.core = core;

  group.userData.lockRingScale = 1.05;
  return finish(group, parts, radialShards(5, PARASITE_VIOLET, 0.4, 0.6), PARASITE_VIOLET);
}

/** Swarmer: a spined burr trailing a whip. It reads as motion at any distance. */
export function createSwarmerMesh() {
  const group = new Group();
  const parts: TintPart[] = [];

  const body = new Mesh(new IcosahedronGeometry(0.6, 0), part(parts, 'shell', PARASITE_SHELL, false));
  group.add(body);

  const spineMaterial = part(parts, 'plate', PARASITE_VIOLET, true, 0.9);
  const spines: BufferGeometry[] = [];
  const directions = [
    [1, 0.35, 0], [-1, 0.35, 0], [0.4, 1, 0.3], [-0.4, -1, 0.3],
    [0.3, 0.2, 1], [-0.3, -0.2, -1], [0.8, -0.7, 0.4], [-0.8, 0.7, -0.4],
  ] as const;
  for (const [x, y, z] of directions) {
    const direction = new Vector3(x, y, z).normalize();
    const cone = new ConeGeometry(0.16, 1.15, 4);
    const orient = new Matrix4().lookAt(new Vector3(), direction, new Vector3(0, 0, 1));
    spines.push(cone.applyMatrix4(
      new Matrix4().makeTranslation(direction.x * 0.66, direction.y * 0.66, direction.z * 0.66)
        .multiply(orient)
        .multiply(new Matrix4().makeRotationX(Math.PI / 2)),
    ));
  }
  const spineMesh = new Mesh(mergeGeometries(spines), spineMaterial);
  group.add(spineMesh);
  for (const geometry of spines) geometry.dispose();

  // The whip: three shrinking segments behind the burr.
  const tailMaterial = part(parts, 'core', PARASITE_HOT, true, 0.8);
  const tail: BufferGeometry[] = [];
  for (let i = 0; i < 3; i += 1) {
    tail.push(new OctahedronGeometry(0.24 - i * 0.06, 0).applyMatrix4(
      new Matrix4().makeTranslation(0, 0, 0.95 + i * 0.55),
    ));
  }
  const tailMesh = new Mesh(mergeGeometries(tail), tailMaterial);
  group.add(tailMesh);
  group.userData.tail = tailMesh;
  for (const geometry of tail) geometry.dispose();

  group.userData.lockRingScale = 0.95;
  return finish(group, parts, radialShards(4, PARASITE_HOT, 0.34), PARASITE_HOT);
}

/** Borer: a barbed drill screwed into a strand behind a flared collar. */
export function createBorerMesh() {
  const group = new Group();
  const parts: TintPart[] = [];

  const drill = new Mesh(new ConeGeometry(0.72, 2.6, 6), part(parts, 'shell', PARASITE_SHELL, false));
  drill.rotation.x = Math.PI / 2;
  drill.position.z = -0.5;
  group.add(drill);

  const collarMaterial = part(parts, 'plate', PARASITE_VIOLET, true, 0.9);
  const collar: BufferGeometry[] = [];
  // Three barbed rings stepping back from the drill head.
  for (let i = 0; i < 3; i += 1) {
    collar.push(new TorusGeometry(0.85 + i * 0.24, 0.11, 4, 14).applyMatrix4(
      new Matrix4().makeTranslation(0, 0, 0.25 + i * 0.5),
    ));
  }
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    collar.push(new ConeGeometry(0.14, 0.9, 4).applyMatrix4(
      new Matrix4()
        .makeTranslation(Math.cos(angle) * 1.28, Math.sin(angle) * 1.28, 1.05)
        .multiply(new Matrix4().makeRotationZ(-angle))
        .multiply(new Matrix4().makeRotationX(-0.5)),
    ));
  }
  const collarMesh = new Mesh(mergeGeometries(collar), collarMaterial);
  group.add(collarMesh);
  for (const geometry of collar) geometry.dispose();

  // The sac at the back: it swells before it spits and is the visible weak point.
  const sac = new Mesh(new SphereGeometry(0.62, 10, 8), part(parts, 'core', PARASITE_HOT, true, 0.9));
  sac.position.z = 1.55;
  group.add(sac);
  group.userData.sac = sac;

  const muzzle = new Mesh(
    new RingGeometry(0.22, 0.38, 12),
    part(parts, 'core', PARASITE_HOT, true, 0.9),
  );
  muzzle.position.z = 2.1;
  group.add(muzzle);
  group.userData.muzzle = muzzle;

  group.userData.lockRingScale = 1.5;
  return finish(group, parts, radialShards(6, PARASITE_VIOLET, 0.48), PARASITE_VIOLET);
}

/** Spore: the borer's homing shot — a spiked seed with a violet wake. */
export function createSporeMesh() {
  const group = new Group();
  const parts: TintPart[] = [];
  const core = new Mesh(new OctahedronGeometry(0.42, 0), part(parts, 'core', PARASITE_HOT, true, 1));
  group.add(core);
  const husk = new Mesh(new IcosahedronGeometry(0.72, 0), part(parts, 'plate', PARASITE_VIOLET, true, 0.55));
  group.add(husk);
  group.userData.husk = husk;
  group.userData.isHostileShot = true;
  group.userData.trailColor = PARASITE_VIOLET.clone().multiplyScalar(0.7);
  group.userData.lockRingScale = 0.8;
  return finish(group, parts, radialShards(5, PARASITE_HOT, 0.22), PARASITE_HOT);
}

/** Brood: a soft translucent sac of young, swimming at you. Two hits. */
export function createBroodMesh() {
  const group = new Group();
  const parts: TintPart[] = [];

  const sac = new Mesh(
    new SphereGeometry(1.15, 14, 10),
    part(parts, 'plate', PARASITE_VIOLET, true, 0.42),
  );
  sac.scale.set(1, 1.18, 1);
  group.add(sac);
  group.userData.sac = sac;

  // The young inside, visible through the membrane.
  const clutch: BufferGeometry[] = [];
  for (let i = 0; i < 7; i += 1) {
    const angle = (i / 7) * Math.PI * 2;
    const radius = 0.34 + (i % 3) * 0.16;
    clutch.push(new OctahedronGeometry(0.2, 0).applyMatrix4(
      new Matrix4().makeTranslation(Math.cos(angle) * radius, Math.sin(angle * 1.7) * 0.4, Math.sin(angle) * radius),
    ));
  }
  const clutchMesh = new Mesh(mergeGeometries(clutch), part(parts, 'core', PARASITE_HOT, true, 0.95));
  group.add(clutchMesh);
  group.userData.clutch = clutchMesh;
  for (const geometry of clutch) geometry.dispose();

  // Trailing filaments so it reads as swimming rather than falling.
  const filaments: BufferGeometry[] = [];
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 5) * Math.PI * 2;
    filaments.push(new CylinderGeometry(0.03, 0.09, 1.9, 3).applyMatrix4(
      new Matrix4().makeTranslation(Math.cos(angle) * 0.55, -1.35, Math.sin(angle) * 0.55),
    ));
  }
  const filamentMesh = new Mesh(mergeGeometries(filaments), part(parts, 'shell', WEBBING, true, 0.5));
  group.add(filamentMesh);
  for (const geometry of filaments) geometry.dispose();

  group.userData.lockRingScale = 1.4;
  return finish(group, parts, radialShards(7, PARASITE_HOT, 0.5), PARASITE_HOT);
}

/**
 * The parent: a knotted violet body dug into the crown, hidden behind three
 * sheets of its own webbing. Each sheet withers when the brood it fed dies,
 * and the mantle plates split off when the first stage breaks.
 */
export function createParentMesh() {
  const group = new Group();
  const parts: TintPart[] = [];

  const body = new Mesh(new IcosahedronGeometry(3.1, 1), part(parts, 'shell', PARASITE_SHELL, false));
  body.scale.set(1.15, 0.9, 1.05);
  group.add(body);

  // Mantle: interlocking plates that break away with the first stage.
  const mantleMaterial = part(parts, 'plate', PARASITE_VIOLET, true, 0.8);
  const mantle: BufferGeometry[] = [];
  for (let i = 0; i < 9; i += 1) {
    const angle = (i / 9) * Math.PI * 2;
    const tilt = ((i % 3) - 1) * 0.4;
    mantle.push(new ConeGeometry(0.85, 2.6, 4).applyMatrix4(
      new Matrix4()
        .makeTranslation(Math.cos(angle) * 3.3, Math.sin(angle) * 2.5, 0.5)
        .multiply(new Matrix4().makeRotationZ(-angle + Math.PI / 2))
        .multiply(new Matrix4().makeRotationX(tilt)),
    ));
  }
  const mantleMesh = new Mesh(mergeGeometries(mantle), mantleMaterial);
  group.add(mantleMesh);
  group.userData.mantle = mantleMesh;
  for (const geometry of mantle) geometry.dispose();

  // The hold: the hooked mass actually gripping the crown, exposed last.
  const hold = new Mesh(new TorusGeometry(1.9, 0.55, 6, 16), part(parts, 'core', PARASITE_HOT, true, 0.9));
  hold.position.z = -1.2;
  group.add(hold);
  group.userData.hold = hold;

  const core = new Mesh(new SphereGeometry(1.25, 14, 10), part(parts, 'core', PARASITE_HOT, true, 0.95));
  core.position.z = 0.6;
  group.add(core);
  group.userData.core = core;

  // Three webbing sheets: broad, sagging, and directly in the firing line.
  const sheets: Mesh[] = [];
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const material = createAdditiveBasicMaterial({ color: hdr(WEBBING, 0.7), opacity: 0.5, side: DoubleSide });
    material.wireframe = true;
    const sheet = new Mesh(new SphereGeometry(5.4, 9, 6, angle, Math.PI * 0.78, 0.5, Math.PI * 0.62), material);
    sheet.position.z = 2.6;
    group.add(sheet);
    sheets.push(sheet);
  }
  group.userData.sheets = sheets;
  group.userData.isParent = true;
  group.userData.lockRingScale = 3.4;

  const shards = [
    ...radialShards(9, PARASITE_VIOLET, 1.05),
    ...radialShards(6, PARASITE_HOT, 0.7, 0.4),
  ];
  return finish(group, parts, shards, PARASITE_HOT);
}

/** Frame-by-frame life for a parasite body; every kind breathes differently. */
export function animateParasite(mesh: Group, kind: string, elapsed: number) {
  const pulse = (mesh.userData.pulse as number | undefined) ?? 0.5;
  switch (kind) {
    case 'cling': {
      const core = mesh.userData.core as Mesh | undefined;
      const detach = (mesh.userData.detach as number | undefined) ?? 0;
      if (core) core.scale.setScalar(0.85 + pulse * 0.4 + detach * 0.25);
      break;
    }
    case 'swarmer': {
      const tail = mesh.userData.tail as Mesh | undefined;
      if (tail) {
        tail.rotation.x = Math.sin(elapsed * 9 + mesh.id) * 0.5;
        tail.scale.setScalar(0.8 + pulse * 0.5);
      }
      break;
    }
    case 'borer': {
      const charge = (mesh.userData.charge as number | undefined) ?? 0;
      const sac = mesh.userData.sac as Mesh | undefined;
      const muzzle = mesh.userData.muzzle as Mesh | undefined;
      if (sac) sac.scale.setScalar(0.8 + charge * 0.75 + pulse * 0.12);
      if (muzzle) muzzle.scale.setScalar(0.5 + charge * 1.7);
      break;
    }
    case 'spore': {
      const husk = mesh.userData.husk as Mesh | undefined;
      if (husk) {
        husk.rotation.z = elapsed * 2.4;
        husk.scale.setScalar(0.85 + pulse * 0.35);
      }
      break;
    }
    case 'brood': {
      const sac = mesh.userData.sac as Mesh | undefined;
      const clutch = mesh.userData.clutch as Mesh | undefined;
      const emerge = (mesh.userData.emerge as number | undefined) ?? 1;
      const broodPulse = (mesh.userData.broodPulse as number | undefined) ?? 1;
      if (sac) sac.scale.set(1 / broodPulse, 1.18 * broodPulse, 1 / broodPulse).multiplyScalar(0.4 + emerge * 0.6);
      if (clutch) clutch.rotation.y = elapsed * 1.6;
      break;
    }
    case 'parent': {
      const breathe = (mesh.userData.breathe as number | undefined) ?? 0.5;
      const core = mesh.userData.core as Mesh | undefined;
      const hold = mesh.userData.hold as Mesh | undefined;
      const sheets = mesh.userData.sheets as Mesh[] | undefined;
      const webbing = (mesh.userData.webbing as number | undefined) ?? 3;
      if (core) core.scale.setScalar(0.85 + breathe * 0.35);
      if (hold) hold.rotation.z = elapsed * 0.5;
      if (sheets) {
        sheets.forEach((sheet, index) => {
          const alive = index < webbing;
          const target = alive ? 1 : 0;
          const current = (sheet.userData.alive as number | undefined) ?? 1;
          const next = current + (target - current) * 0.06;
          sheet.userData.alive = next;
          sheet.visible = next > 0.02;
          sheet.scale.setScalar(0.4 + next * 0.6);
          const material = sheet.material as MeshBasicMaterial;
          material.opacity = next * (0.36 + breathe * 0.2);
          material.color.copy(hdr(WEBBING, 0.35 + next * 0.6));
          sheet.rotation.z = Math.sin(elapsed * 0.7 + index) * 0.12;
        });
      }
      break;
    }
    default:
      break;
  }
}

/** The mantle plates split away when the parent's first stage breaks. */
export function breakParentMantle(mesh: Group) {
  const mantle = mesh.userData.mantle as Mesh | undefined;
  if (mantle) mantle.visible = false;
  const hold = mesh.userData.hold as Mesh | undefined;
  if (hold) hold.scale.setScalar(1.35);
}
