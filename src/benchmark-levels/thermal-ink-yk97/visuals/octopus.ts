import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { applyLockSpecs, type LockSpecEntry } from './enemies';
import { modeMaterial, type ModedSpec } from './moded';
import {
  CREAM_DIRTY,
  hdr,
  IR_COLD,
  IR_HOT,
  LAMP,
  OIL,
  OIL_SHEEN,
  RUST,
  RUST_DARK,
  SIGNAL_RED,
} from './palette';

// The octopus itself. The body is scenery — an oily mass wrapped around a
// capsized hull, always seated ahead of the camera — while the six arm-tip
// targets and the core are runner enemies built here so the whole creature
// shares one flesh language.
//
// The body root is lookAt-oriented toward the camera, so local +Z is the
// camera side: eyes and siphon sit at positive z, the wreck it grips at
// negative z, and the mantle far enough back that targets (which the level
// keeps within ~26 units of the camera) always pass in front of it.

function fleshMaterial(sheen = 0.12, irIntensity = 1.05, blindDim = 0.92) {
  const murk = OIL.clone().lerp(OIL_SHEEN, sheen);
  return modeMaterial(new MeshBasicMaterial({ color: murk.clone() }), {
    murk,
    ir: hdr(IR_HOT, irIntensity),
    blindDim,
  });
}

// ---- shared geometries ------------------------------------------------------

const armSegmentGeometries = [0, 1, 2].map((segment) => {
  const radius = 0.32 + segment * 0.1;
  return new CylinderGeometry(radius, radius + 0.09, 1.3, 7);
});
const armClub = new SphereGeometry(0.95, 12, 9);
const armTip = new ConeGeometry(0.45, 1.1, 8);
const armSignal = new SphereGeometry(0.36, 10, 8);
const armSuckers = (() => {
  const discs: BufferGeometry[] = [];
  for (let i = 0; i < 5; i += 1) {
    const disc = new CircleGeometry(0.13 + (i % 2) * 0.05, 8);
    disc.applyMatrix4(new Matrix4().makeTranslation(
      -0.35 + Math.sin(i * 2.4) * 0.3,
      -0.75 + i * 0.4,
      0.5,
    ));
    discs.push(disc);
  }
  const merged = mergeGeometries(discs);
  for (const disc of discs) disc.dispose();
  return merged;
})();

const corePlate = new SphereGeometry(1.5, 12, 10, 0, Math.PI);
const coreGlow = new SphereGeometry(0.92, 12, 10);
const coreHot = new SphereGeometry(0.42, 10, 8);
const coreVein = new TorusGeometry(1.1, 0.05, 6, 20, Math.PI * 1.3);

// ---- the body (environment-side) -------------------------------------------

export type OctopusBody = {
  root: Group;
  update(t: number): void;
};

export function createOctopusBody(): OctopusBody {
  const root = new Group();
  root.name = 'octopus-body';
  // IR intensity stays just below hard bloom: the mantle is a huge screen area
  // and must burn without whiting out the frame; the red cores stay hottest.
  const flesh = fleshMaterial(0.1, 0.92);
  const fleshBright = fleshMaterial(0.24, 1.05);
  const wreckMaterial = modeMaterial(new MeshBasicMaterial({ color: RUST_DARK.clone() }), {
    murk: RUST_DARK.clone(),
    ir: IR_COLD.clone(),
    blindDim: 0.85,
  });
  const wreckPlate = modeMaterial(new MeshBasicMaterial({ color: RUST.clone().multiplyScalar(0.7) }), {
    murk: RUST.clone().multiplyScalar(0.7),
    ir: IR_COLD.clone(),
    blindDim: 0.85,
  });
  const eyeMaterial = modeMaterial(createAdditiveBasicMaterial({ color: hdr(LAMP, 1.35) }), {
    murk: hdr(LAMP, 1.35),
    ir: hdr(SIGNAL_RED, 2.6),
    blindDim: 0.7,
  });
  const siphonGlow = modeMaterial(createAdditiveBasicMaterial({ color: OIL_SHEEN.clone().multiplyScalar(0.7), side: DoubleSide }), {
    murk: OIL_SHEEN.clone().multiplyScalar(0.7),
    ir: hdr(SIGNAL_RED, 1.4),
    blindDim: 0.4,
  });

  // Mantle: a swollen oily mass held behind the fight line, brow at its base.
  const mantle = new Mesh(new SphereGeometry(4.4, 14, 10), flesh);
  mantle.scale.set(1.25, 0.95, 1.0);
  mantle.position.set(0, 1.8, -3);
  const brow = new Mesh(new SphereGeometry(3.2, 12, 8), fleshBright);
  brow.scale.set(1.4, 0.5, 0.6);
  brow.position.set(0, 0.4, 0);

  for (const side of [-1, 1]) {
    // Flattened to a hard horizontal slit: a predator's eye, not a cartoon's.
    const eye = new Mesh(new SphereGeometry(0.62, 10, 8), eyeMaterial);
    eye.position.set(side * 2.1, 0.3, 1.7);
    eye.scale.set(1.3, 0.34, 0.7);
    const lid = new Mesh(new SphereGeometry(0.82, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), flesh);
    lid.position.copy(eye.position);
    lid.position.y += 0.14;
    lid.position.z -= 0.24;
    lid.rotation.x = -0.5;
    root.add(eye, lid);
  }

  const siphon = new Mesh(new CylinderGeometry(0.55, 0.85, 2.4, 8), fleshBright);
  siphon.position.set(1.7, -1.7, 0.3);
  siphon.rotation.z = 0.8;
  siphon.rotation.x = 0.4;
  const siphonMouth = new Mesh(new CircleGeometry(0.5, 10), siphonGlow);
  siphonMouth.position.set(2.6, -2.1, 1.1);
  siphonMouth.rotation.y = -0.5;

  // The wreck it is wrapped around, well behind the fight line.
  const hull = new Mesh(new BoxGeometry(13, 2.8, 5), wreckMaterial);
  hull.position.set(-1, -6.2, -3.5);
  hull.rotation.z = 0.22;
  hull.rotation.x = -0.1;
  const deck = new Mesh(new BoxGeometry(12.4, 0.5, 4.4), wreckPlate);
  deck.position.set(-1.2, -4.8, -3.6);
  deck.rotation.z = 0.22;
  const crane = new Mesh(new BoxGeometry(0.7, 7.5, 0.7), wreckMaterial);
  crane.position.set(-5.4, -2.6, -4.2);
  crane.rotation.z = 0.9;

  root.add(mantle, brow, siphon, siphonMouth, hull, deck, crane);

  // Eight background arms curled over the wreck. These are silhouette
  // dressing; the six lockable arm tips are separate runner targets.
  const chains: Mesh[][] = [];
  const chainRoots: Group[] = [];
  for (let armIndex = 0; armIndex < 8; armIndex += 1) {
    const angle = (armIndex / 8) * Math.PI * 2 + 0.35;
    const chainRoot = new Group();
    chainRoot.position.set(Math.cos(angle) * 3.4, -0.8 + Math.sin(armIndex * 2.1) * 0.9, Math.sin(angle) * 1.6 - 1.6);
    chainRoot.rotation.z = angle + Math.PI / 2;
    const segments: Mesh[] = [];
    let parent: Group | Mesh = chainRoot;
    for (let segment = 0; segment < 6; segment += 1) {
      const radius = 0.62 * (1 - segment * 0.13);
      const length = 1.7 - segment * 0.12;
      const mesh = new Mesh(new CylinderGeometry(radius * 0.8, radius, length, 7), segment % 2 ? flesh : fleshBright);
      mesh.position.y = segment === 0 ? 0.8 : 1.35 - segment * 0.09;
      mesh.rotation.z = 0.34 + armIndex * 0.06;
      parent.add(mesh);
      segments.push(mesh);
      parent = mesh;
    }
    chains.push(segments);
    chainRoots.push(chainRoot);
    root.add(chainRoot);
  }

  function update(t: number) {
    for (let armIndex = 0; armIndex < chains.length; armIndex += 1) {
      const segments = chains[armIndex];
      for (let segment = 0; segment < segments.length; segment += 1) {
        segments[segment].rotation.z = 0.34 + armIndex * 0.06
          + Math.sin(t * 0.7 + armIndex * 1.7 + segment * 0.6) * 0.13;
        segments[segment].rotation.x = Math.sin(t * 0.5 + armIndex * 2.3 + segment * 0.4) * 0.08;
      }
    }
    const breathe = 1 + Math.sin(t * 0.9) * 0.035;
    mantle.scale.set(1.25 * breathe, 0.95 / breathe, 1.0 * breathe);
  }

  return { root, update };
}

// ---- arm target: a club tip with a burning signal core ---------------------

export function createArmMesh() {
  const group = new Group();
  const flesh = fleshMaterial(0.08, 1.15);
  const fleshBright = fleshMaterial(0.26, 1.3);
  const sucker = modeMaterial(new MeshBasicMaterial({ color: CREAM_DIRTY.clone().multiplyScalar(0.8), side: DoubleSide }), {
    murk: CREAM_DIRTY.clone().multiplyScalar(0.8),
    ir: hdr(IR_HOT, 1.5),
    blindDim: 0.95,
  });
  const core = modeMaterial(createAdditiveBasicMaterial({ color: hdr(SIGNAL_RED, 0.85) }), {
    murk: hdr(SIGNAL_RED, 0.85),
    ir: hdr(SIGNAL_RED, 3.2),
    blindDim: 0.94,
  });

  // Tail runs toward the body along -X; the club sits at the origin where the
  // runner seats the target.
  let x = -0.95;
  for (let segment = 0; segment < 3; segment += 1) {
    const mesh = new Mesh(armSegmentGeometries[segment], segment % 2 ? flesh : fleshBright);
    mesh.rotation.z = Math.PI / 2;
    mesh.position.set(x, Math.sin(segment * 1.6) * 0.24, -0.1 * segment);
    x -= 1.2;
    group.add(mesh);
  }

  const club = new Mesh(armClub, fleshBright);
  club.scale.set(0.8, 1.15, 0.6);
  const tip = new Mesh(armTip, flesh);
  tip.position.set(0.25, 1.25, 0);
  tip.rotation.z = -0.5;
  const suckers = new Mesh(armSuckers, sucker);
  const signal = new Mesh(armSignal, core);
  signal.position.set(0.1, 0.15, 0.45);

  group.add(club, tip, suckers, signal);
  group.userData.kind = 'arm';
  group.userData.accent = SIGNAL_RED.clone().lerp(LAMP, 0.25);
  group.userData.lockSpecs = [
    {
      spec: core.userData.moded as ModedSpec,
      murkBase: hdr(SIGNAL_RED, 0.85),
      irBase: hdr(SIGNAL_RED, 3.2),
      murkLocked: hdr(LAMP, 2.4),
      irLocked: hdr(SIGNAL_RED, 4.4),
    },
  ] satisfies LockSpecEntry[];
  return group;
}

// ---- core target: the heart in the split mantle ----------------------------

export function createCoreMesh() {
  const group = new Group();
  const plateMaterial = fleshMaterial(0.05, 0.55, 0.9);
  const heartMaterial = modeMaterial(createAdditiveBasicMaterial({ color: hdr(SIGNAL_RED, 1.15) }), {
    murk: hdr(SIGNAL_RED, 1.15),
    ir: hdr(SIGNAL_RED, 3.6),
    blindDim: 0.9,
  });
  const heartWhite = modeMaterial(new MeshBasicMaterial({ color: hdr(SIGNAL_RED, 1.7) }), {
    murk: hdr(SIGNAL_RED, 1.7),
    ir: hdr(IR_HOT, 3.2),
    blindDim: 0.9,
  });
  const veinMaterial = fleshMaterial(0.3, 1.3);

  const plates = new Group();
  const left = new Mesh(corePlate, plateMaterial);
  left.rotation.y = Math.PI / 2;
  const right = new Mesh(corePlate, plateMaterial);
  right.rotation.y = -Math.PI / 2;
  plates.add(left, right);

  const heart = new Group();
  const glow = new Mesh(coreGlow, heartMaterial);
  const hot = new Mesh(coreHot, heartWhite);
  heart.add(glow, hot);

  for (let i = 0; i < 2; i += 1) {
    const vein = new Mesh(coreVein, veinMaterial);
    vein.rotation.z = 0.8 + i * 2.4;
    vein.rotation.x = 0.4 * i;
    group.add(vein);
  }

  group.add(plates, heart);
  group.userData.kind = 'core';
  group.userData.plates = { left, right };
  group.userData.heart = heart;
  group.userData.openAmount = 0;
  group.userData.accent = SIGNAL_RED.clone();
  group.userData.lockSpecs = [
    {
      spec: heartMaterial.userData.moded as ModedSpec,
      murkBase: hdr(SIGNAL_RED, 1.15),
      irBase: hdr(SIGNAL_RED, 3.6),
      murkLocked: hdr(SIGNAL_RED, 2.4),
      irLocked: hdr(SIGNAL_RED, 5.2),
    },
  ] satisfies LockSpecEntry[];
  return group;
}

/** Per-frame core animation: plates split once exposed, heart pulses with gameplay's pulse value. */
export function updateCoreMesh(group: Group, dt: number) {
  const plates = group.userData.plates as { left: Mesh; right: Mesh } | undefined;
  const heart = group.userData.heart as Group | undefined;
  if (!plates || !heart) return;
  const exposed = group.userData.exposed === true;
  const target = exposed ? 1 : 0.12;
  group.userData.openAmount = MathUtils.lerp(group.userData.openAmount as number, target, Math.min(1, dt * 2.2));
  const open = group.userData.openAmount as number;
  plates.left.position.x = -0.25 - open * 1.7;
  plates.left.rotation.y = Math.PI / 2 + open * 0.9;
  plates.right.position.x = 0.25 + open * 1.7;
  plates.right.rotation.y = -Math.PI / 2 - open * 0.9;
  const pulse = (group.userData.pulse as number | undefined) ?? 0.5;
  heart.scale.setScalar(0.9 + pulse * 0.28 + open * 0.15);
}

export { applyLockSpecs };
