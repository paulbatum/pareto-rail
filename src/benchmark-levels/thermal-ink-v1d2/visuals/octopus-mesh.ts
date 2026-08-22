import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  CREAM,
  hdr,
  IR_HOT,
  IR_METAL,
  IR_WARM,
  OCHRE,
  OIL,
  OIL_EDGE,
  RUST,
  SODIUM,
  SIGNAL_RED,
} from './palette';
import {
  SUCKER_GEOMETRY,
  signalNodeMaterial,
  suckerMaterial,
  tintable,
  type TintPart,
} from './enemies';

// The octopus itself: an oily mass wearing its wreck. The mantle is near-black
// flesh with ochre rims; rusted hull plates and snapped cables are half-sunk
// into it; two pale lamp-pale eyes track the player; the mantle valves cover a
// red signal core that only burns open once every arm is broken.
// In thermal, flesh blazes white-hot, embedded metal stays cold, eyes go white,
// and the core is the reddest thing on screen.
// Geometries are cached at module level and shared across runs.

// ---- shared geometry ------------------------------------------------------------

const mantleGeometry = (() => {
  const geometry = new IcosahedronGeometry(6.2, 1);
  geometry.scale(1.3, 0.95, 1.35);
  return geometry;
})();

const ridgeGeometries = mergeGeometries(
  [
    [-2.8, 3.4, -1.5, 1.9],
    [2.4, 3.8, -0.5, 2.2],
    [0, 4.4, -2.6, 1.7],
    [-1.2, -2.8, -3.4, 1.6],
    [3.4, -1.2, -2.2, 1.5],
  ].map(([x, y, z, size]) => {
    const ridge = new TetrahedronGeometry(size, 0);
    ridge.rotateX(x * 0.3);
    ridge.rotateY(z * 0.2);
    ridge.rotateZ(y * 0.22);
    ridge.translate(x, y, z);
    return ridge;
  }),
);

const eyeGeometry = new SphereGeometry(1.05, 10, 8);
const pupilGeometry = new BoxGeometry(0.16, 0.95, 0.1);
const beakGeometry = new ConeGeometry(1.15, 1.7, 6);
const siphonGeometry = new CylinderGeometry(0.42, 0.62, 3.2, 7);

const plateGeometries = mergeGeometries(
  [
    [-4.4, 0.6, 1.2, 3.4, 2.2],
    [3.8, -1.8, 0.4, 2.6, 3.0],
    [0.4, 3.2, -3.2, 4.2, 1.6],
  ].map(([x, y, z, w, h]) => {
    const plate = new BoxGeometry(w, h, 0.5);
    plate.rotateY(x * 0.15);
    plate.rotateZ(y * 0.2);
    plate.rotateX(z * 0.1);
    plate.translate(x, y, z);
    return plate;
  }),
);

const cableGeometries = mergeGeometries(
  [0, 1, 2].map((i) => {
    const cable = new CylinderGeometry(0.09, 0.09, 7 + i * 2, 5);
    cable.rotateZ(0.5 + i * 0.4);
    cable.translate(-2 + i * 2.4, -1 + (i % 2) * 2, 2.8);
    return cable;
  }),
);

const valveFlapGeometry = (() => {
  const flap = new TetrahedronGeometry(1.5, 0);
  flap.scale(0.55, 1.6, 0.4);
  return flap;
})();

const coreGeometry = new SphereGeometry(1.35, 12, 9);
const coreGlowGeometry = new SphereGeometry(2.1, 12, 9);

// Arm segment geometry per segment index (taper varies).
const armSegmentGeometries = Array.from({ length: 6 }, (_, i) => {
  const t = i / 5;
  const radius = 0.78 * (1 - t * 0.72) + 0.08;
  const length = 1.45 - t * 0.25;
  return new CylinderGeometry(radius * 0.82, radius, length, 7);
});
const armSegmentLengths = Array.from({ length: 6 }, (_, i) => 1.45 - (i / 5) * 0.25);
const armBarbGeometry = (() => {
  const barb = new TetrahedronGeometry(0.34, 0);
  barb.scale(0.7, 1.6, 0.7);
  return barb;
})();
const armBulbGeometry = new SphereGeometry(1.05, 10, 8);
const armNodeGeometry = new OctahedronGeometry(0.42, 1);

export function createOctopusMesh() {
  const group = new Group();

  // Mantle and ridges: one flesh mesh each.
  addFlesh(group, new Mesh(mantleGeometry), 1.0);
  addFlesh(group, new Mesh(ridgeGeometries), 0.92);

  // Eyes: pale, lamp-lit, always watching.
  for (const side of [-1, 1]) {
    const eyeMaterial = new MeshBasicMaterial({ color: hdr(CREAM, 1.15) });
    const eye = new Mesh(eyeGeometry, eyeMaterial);
    eye.position.set(side * 2.6, 1.1, 5.4);
    eye.scale.set(1, 0.85, 0.6);
    group.add(eye);
    tintable(group).push({
      material: eyeMaterial,
      murk: CREAM.clone(),
      ir: IR_HOT.clone(),
      murkIntensity: 1.15,
      irIntensity: 2.1,
      kind: 'core',
    });
  }
  // Slit pupils: one merged mesh spanning both eyes.
  const pupilMaterial = new MeshBasicMaterial({ color: new Color(0.004, 0.003, 0.004) });
  const pupils = new Mesh(mergeGeometries([
    pupilGeometry.clone().translate(-2.6, 1.1, 5.95),
    pupilGeometry.clone().translate(2.6, 1.1, 5.95),
  ]), pupilMaterial);
  group.add(pupils);

  // Beak under the eye line.
  const beak = addFlesh(group, new Mesh(beakGeometry), 0.8);
  beak.position.set(0, -2.6, 5.2);
  beak.rotation.x = Math.PI;

  // Siphon tube, angled toward the player — it spits the gobs.
  const siphon = addFlesh(group, new Mesh(siphonGeometry), 0.88);
  siphon.position.set(-1.6, -3.4, 3.4);
  siphon.rotation.set(1.1, 0, 0.35);

  // Embedded wreckage: rust plates and cable stubs half-sunk in the flesh.
  addMetal(group, new Mesh(plateGeometries), 0.9);
  addMetal(group, new Mesh(cableGeometries), 0.7);

  // Mantle valves: four flaps that hinge apart when the core exposes.
  const valves = new Group();
  valves.position.set(0, -1.2, 4.6);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const hinge = new Group();
    const flap = addFlesh(group, new Mesh(valveFlapGeometry), 0.95);
    flap.removeFromParent();
    flap.position.set(0, 1.1, 0);
    hinge.add(flap);
    hinge.position.set(Math.cos(angle) * 1.15, Math.sin(angle) * 1.15, 0);
    hinge.rotation.z = angle + Math.PI / 2;
    hinge.userData.baseRotZ = hinge.rotation.z;
    hinge.userData.spreadSign = i < 2 ? 1 : -1;
    hinge.userData.baseX = hinge.position.x;
    hinge.userData.baseY = hinge.position.y;
    valves.add(hinge);
  }
  group.add(valves);

  // The signal core: dull ember while sealed, the reddest thing alive when open.
  const coreMaterial = new MeshBasicMaterial({ color: hdr(SIGNAL_RED, 0.28) });
  const core = new Mesh(coreGeometry, coreMaterial);
  core.position.set(0, -1.2, 5.1);
  const coreGlowMaterial = createAdditiveBasicMaterial({ color: hdr(SIGNAL_RED, 0.14), opacity: 0.32 });
  core.add(new Mesh(coreGlowGeometry, coreGlowMaterial));
  group.add(core);
  tintable(group).push(
    { material: coreMaterial, murk: SIGNAL_RED.clone(), ir: SIGNAL_RED.clone(), murkIntensity: 0.28, irIntensity: 2.6, kind: 'core' },
    { material: coreGlowMaterial, murk: SIGNAL_RED.clone(), ir: SIGNAL_RED.clone(), murkIntensity: 0.14, irIntensity: 1.1, kind: 'core' },
  );

  group.userData.isOctopus = true;
  group.userData.valves = valves;
  group.userData.lockRingScale = 3.2;
  return group;
}

function addFlesh(group: Group, mesh: Mesh, intensity: number) {
  const fillMaterial = new MeshBasicMaterial({ color: OIL.clone().multiplyScalar(intensity) });
  mesh.material = fillMaterial;
  group.add(mesh);
  tintable(group).push({
    material: fillMaterial,
    murk: OIL.clone(),
    ir: IR_HOT.clone(),
    murkIntensity: intensity,
    irIntensity: 0.92,
    kind: 'fill',
  });
  return mesh;
}

function addMetal(group: Group, mesh: Mesh, intensity: number) {
  const fillMaterial = new MeshBasicMaterial({ color: RUST.clone().multiplyScalar(intensity) });
  mesh.material = fillMaterial;
  group.add(mesh);
  tintable(group).push({
    material: fillMaterial,
    murk: RUST.clone(),
    ir: IR_METAL.clone(),
    murkIntensity: intensity,
    irIntensity: 0.85,
    kind: 'fill',
  });
  return mesh;
}

// ---- arm: a curling tentacle with a signal node at its root --------------------

export function createArmMesh() {
  const group = new Group();
  const SEGMENTS = 6;
  const hinges: Group[] = [];

  let parent: Group = group;
  for (let i = 0; i < SEGMENTS; i += 1) {
    const t = i / (SEGMENTS - 1);
    const length = armSegmentLengths[i];

    const hinge = new Group();
    const segment = addFlesh(group, new Mesh(armSegmentGeometries[i]), 1.02 - t * 0.14);
    segment.removeFromParent();
    segment.position.y = -length / 2;
    hinge.add(segment);

    hinge.userData.phase = i * 1.1;
    hinge.userData.speed = 1.5 + (i % 3) * 0.35;
    parent.add(hinge);
    hinges.push(hinge);
    parent = hinge;
    parent.position.y = -length;
  }

  // Sucker strip: one merged mesh of discs running down the upper arm.
  const suckerStrip = mergeGeometries(
    [1, 2, 3, 4].map((i) => {
      const t = i / (SEGMENTS - 1);
      const radius = 0.78 * (1 - t * 0.72) + 0.08;
      const disc = SUCKER_GEOMETRY.clone();
      disc.rotateY(Math.PI / 2);
      disc.translate(radius * 0.7, -(armSegmentLengths.slice(0, i).reduce((a, b) => a + b, 0)) - armSegmentLengths[i] * 0.45, radius * 0.5);
      return disc;
    }),
  );
  const suckMat = suckerMaterial();
  const suckerMesh = new Mesh(suckerStrip, suckMat);
  group.add(suckerMesh);
  tintable(group).push({
    material: suckMat,
    murk: SODIUM.clone(),
    ir: IR_WARM.clone(),
    murkIntensity: 0.55,
    irIntensity: 1.0,
    kind: 'edge',
  });

  // Barb tip.
  const barb = addFlesh(group, new Mesh(armBarbGeometry), 1.1);
  barb.removeFromParent();
  barb.position.y = -0.4;
  barb.rotation.x = Math.PI;
  parent.add(barb);

  // Root bulb with the arm's signal node — the lockable heart of the limb.
  const bulb = addFlesh(group, new Mesh(armBulbGeometry), 1.1);
  bulb.removeFromParent();
  bulb.position.y = 0.5;
  group.add(bulb);
  const nodeMaterial = signalNodeMaterial();
  const node = new Mesh(armNodeGeometry, nodeMaterial);
  node.position.y = 0.5;
  group.add(node);
  tintable(group).push({
    material: nodeMaterial,
    murk: SIGNAL_RED.clone(),
    ir: SIGNAL_RED.clone(),
    murkIntensity: 0.8,
    irIntensity: 2.6,
    kind: 'core',
  });

  group.userData.isArm = true;
  group.userData.hinges = hinges;
  group.userData.shardSpecs = Array.from({ length: 6 }, (_, i) => ({
    direction: new Vector3(Math.cos(i * 1.05), -0.4 - i * 0.12, Math.sin(i * 1.05)).normalize(),
    color: (i % 2 === 0 ? OIL_EDGE : OCHRE).clone(),
    size: 0.9,
  }));
  group.userData.accent = OIL_EDGE.clone();
  group.userData.lockRingScale = 2.1;
  return group;
}

// Per-frame arm dressing: the lash wave runs down the hinges.
export function updateArmMesh(arm: Group, age: number, retracted: boolean) {
  const hinges = arm.userData.hinges as Group[] | undefined;
  if (!hinges) return;
  const calm = retracted ? 0.35 : 1;
  for (const hinge of hinges) {
    const phase = hinge.userData.phase as number;
    const speed = hinge.userData.speed as number;
    hinge.rotation.x = Math.sin(age * speed + phase) * 0.24 * calm + 0.16; // constant forward curl
    hinge.rotation.z = Math.cos(age * speed * 0.8 + phase * 1.3) * 0.18 * calm;
  }
}

// Per-frame body dressing: valve spread when exposed.
export function updateOctopusMesh(body: Group, elapsed: number, exposed: boolean) {
  const valves = body.userData.valves as Group | undefined;
  if (!valves) return;
  let spread = (body.userData.valveSpread as number | undefined) ?? 0;
  spread += ((exposed ? 1 : 0) - spread) * 0.05;
  body.userData.valveSpread = spread;
  for (const hinge of valves.children) {
    hinge.rotation.z = (hinge.userData.baseRotZ as number) + (hinge.userData.spreadSign as number) * spread * 0.5;
    hinge.position.x = (hinge.userData.baseX as number) * (1 + spread * 0.95);
    hinge.position.y = (hinge.userData.baseY as number) * (1 + spread * 0.95);
  }
  void elapsed;
}

// ---- collapse ghost -------------------------------------------------------------
// On death the runner disposes the boss enemy immediately, so the visuals keep
// a simplified silhouette that sinks into the black water as the lamps return.

let ghostCache: { group: Group } | null = null;

export function createCollapseGhost() {
  if (ghostCache) {
    const cached = ghostCache.group;
    for (const material of cached.userData.ghostMaterials as MeshBasicMaterial[]) material.opacity = 0.95;
    return cached;
  }
  const group = new Group();
  const materials: MeshBasicMaterial[] = [];
  const push = (material: MeshBasicMaterial) => {
    materials.push(material);
    return material;
  };

  const mantleMaterial = push(new MeshBasicMaterial({ color: OIL.clone().multiplyScalar(1.1), transparent: true, opacity: 0.96 }));
  group.add(new Mesh(mantleGeometry, mantleMaterial));

  const armGhostGeometries = Array.from({ length: 5 }, (_, i) => {
    const angle = (i / 5) * Math.PI * 2;
    const cone = new ConeGeometry(0.9, 11, 6, 1, true);
    cone.rotateZ(Math.cos(angle) * 0.5);
    cone.rotateX(Math.sin(angle) * 0.4);
    cone.translate(Math.cos(angle) * 4.4, -4.5, Math.sin(angle) * 2.4);
    return cone;
  });
  const armMaterial = push(new MeshBasicMaterial({ color: OIL.clone().multiplyScalar(1.0), transparent: true, opacity: 0.94 }));
  group.add(new Mesh(mergeGeometries(armGhostGeometries), armMaterial));

  const eyeMaterial = push(new MeshBasicMaterial({ color: hdr(CREAM, 1.0), transparent: true, opacity: 0.9 }));
  const eyes = new Mesh(mergeGeometries([
    eyeGeometry.clone().scale(1, 0.85, 0.6).translate(-2.6, 1.1, 5.4),
    eyeGeometry.clone().scale(1, 0.85, 0.6).translate(2.6, 1.1, 5.4),
  ]), eyeMaterial);
  group.add(eyes);

  group.userData.ghostMaterials = materials;
  group.userData.isGhost = true;
  group.userData.raildIgnoreOcclusion = true;
  ghostCache = { group };
  return group;
}
