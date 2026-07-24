import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { mulberry32 } from '../../../engine/rng';
import { AXIS, AXIS_RIGHT, AXIS_UP, BELL_LOCAL, BELL_RADIUS, bundleFlare } from '../gameplay';
import { JELLY_RIM, LUME_DEEP, LUME_GOLD, LUME_GREEN, SICK_VIOLET, hdr } from './palette';

// THE ANIMAL. One object, built once, in its own frame: the origin is the crown
// where every strand roots, the bell sits just ahead of it, and thirty-six
// tentacles trail back behind it for up to seven hundred units. The runtime
// moves the whole thing to wherever the crown belongs that second, so the
// jellyfish is genuinely swimming ahead of you rather than parked at the end of
// the rail — which is also the only way to keep an animal this size inside a
// camera whose far plane is five hundred units.
//
// The strands are alpha-blended jelly, so they fog into deep blue with distance
// the way water actually does. Everything luminous — the bell membrane, the
// crown, the bead chain running each strand — is additive with fog switched off
// and carries its own distance falloff, because additive geometry plus fog adds
// the fog colour and turns the whole frame into a flat mint wash.
//
// Two things animate. A contraction travels tip-to-crown once per half bar (the
// bell squashes, the light arrives behind it), and a "life" level that the
// runtime raises every time you cut a parasite off, which brightens the strands
// and burns the violet rot off them.

const TENTACLE_COUNT = 36;
const TENTACLE_SAMPLES = 40;
const TENTACLE_RADIAL = 6;
const BEADS_PER_TENTACLE = 15;
const BLOTCH_COUNT = 76;
const ORAL_ARM_COUNT = 6;
/** Bell dome height as a fraction of its radius. A shallow bell stays inside the far plane. */
const BELL_HEIGHT = 0.55;

const AXIS_TO_Y = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), AXIS);
const IDENTITY = new Quaternion();
const DRIFT_AXIS = AXIS_UP.clone().normalize();

export type AnimalUpdate = {
  camera: PerspectiveCamera;
  elapsed: number;
  /** World position the crown should occupy this frame. */
  crown: Vector3;
  /** 0..1 — how much of the infestation has been cut off. */
  life: number;
  /** 0..1 — travelling contraction phase, driven off the transport. */
  pulse: number;
  /** 0..1+ — the coda: the animal turns off your heading and swims away. */
  drift: number;
};

export type Animal = {
  group: Group;
  update(dt: number, context: AnimalUpdate): void;
  dispose(): void;
};

/** Animal-local space: `along` is distance ahead of the crown, `x`/`y` are across it. */
function local(along: number, x: number, y: number, out = new Vector3()) {
  return out
    .copy(AXIS)
    .multiplyScalar(along)
    .addScaledVector(AXIS_RIGHT, x)
    .addScaledVector(AXIS_UP, y);
}

export function createAnimal(): Animal {
  const rng = mulberry32(0x5712d);
  const group = new Group();
  group.name = 'animal';

  const tentacleMaterials: MeshBasicMaterial[] = [];
  const beadMatrix: Matrix4[] = [];
  const beadLocal: Vector3[] = [];
  const beadRoot: number[] = [];
  const beadTentacle: number[] = [];
  const blotchMatrix: Matrix4[] = [];
  const blotchLocal: Vector3[] = [];

  // ---- tentacles ----------------------------------------------------------------
  // A third are "near" strands that trail close enough to the rail that you
  // thread between them — that is what makes this a forest rather than a
  // distant starburst. The rest fill the bundle out to its flank.
  for (let index = 0; index < TENTACLE_COUNT; index += 1) {
    const near = index % 3 === 0;
    const angle = (index / TENTACLE_COUNT) * Math.PI * 2 + rng() * 0.4;
    const rootRadius = 3 + rng() * 16;
    const spread = near ? 22 + rng() * 22 : 46 + rng() * 74;
    const twist = (rng() - 0.5) * 1.6;
    const length = 300 + rng() * 400;
    const waveAmp = (near ? 4 : 8) + rng() * 12;
    const waveLength = 90 + rng() * 150;
    const wavePhase = rng() * Math.PI * 2;
    const rootThickness = (near ? 0.85 : 1.35) + rng() * 1.1;

    const points: Vector3[] = [];
    const radii: number[] = [];
    const colors: Color[] = [];
    for (let s = 0; s <= TENTACLE_SAMPLES; s += 1) {
      const t = s / TENTACLE_SAMPLES;
      const along = -8 - length * t;
      const radial = (rootRadius + (spread - rootRadius) * t ** 0.62) * bundleFlare(-along);
      const theta = angle + twist * t;
      const wave = Math.sin(along / waveLength + wavePhase) * waveAmp * (0.25 + t);
      const across = theta + Math.PI / 2;
      points.push(local(
        along,
        Math.cos(theta) * radial + Math.cos(across) * wave,
        Math.sin(theta) * radial + Math.sin(across) * wave,
      ));
      radii.push(rootThickness * (1 - t * 0.6));
      // Bright toward the crown, never dark at the tip: the tips are the part
      // you actually fly through.
      const bright = 0.55 + (1 - t) ** 1.2 * 0.5;
      colors.push(LUME_DEEP.clone().lerp(LUME_GREEN, 0.35 + (1 - t) * 0.35).multiplyScalar(bright));
    }

    const material = new MeshBasicMaterial({
      color: hdr(LUME_GREEN, 0.55),
      vertexColors: true,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: DoubleSide,
    });
    const mesh = new Mesh(tubeGeometry(points, radii, colors, TENTACLE_RADIAL), material);
    mesh.renderOrder = -1;
    mesh.frustumCulled = false;
    group.add(mesh);
    tentacleMaterials.push(material);

    for (let b = 0; b < BEADS_PER_TENTACLE; b += 1) {
      const t = 0.03 + (b / (BEADS_PER_TENTACLE - 1)) * 0.95;
      const sample = Math.min(TENTACLE_SAMPLES, Math.round(t * TENTACLE_SAMPLES));
      const size = 0.7 + (1 - t) * 1.5;
      beadMatrix.push(new Matrix4().compose(points[sample], IDENTITY, new Vector3(size, size, size)));
      beadLocal.push(points[sample].clone());
      beadRoot.push(1 - t);
      beadTentacle.push(index);
    }

    // Violet rot where the colony has been feeding. It burns off as you clear it.
    const blotches = Math.round(BLOTCH_COUNT / TENTACLE_COUNT) + (rng() < 0.4 ? 1 : 0);
    for (let b = 0; b < blotches; b += 1) {
      const t = 0.04 + rng() * 0.6;
      const sample = Math.min(TENTACLE_SAMPLES, Math.round(t * TENTACLE_SAMPLES));
      const size = 1.1 + rng() * 1.9;
      blotchMatrix.push(new Matrix4().compose(points[sample], IDENTITY, new Vector3(size, size, size)));
      blotchLocal.push(points[sample].clone());
    }
  }

  // ---- bell ---------------------------------------------------------------------
  // Its own child so the contraction can squash it along the swimming axis
  // without dragging the strands with it.
  const bell = new Group();
  bell.quaternion.copy(AXIS_TO_Y);
  bell.position.copy(local(BELL_LOCAL, 0, 0));
  group.add(bell);

  const domeGeometry = new SphereGeometry(BELL_RADIUS, 52, 20, 0, Math.PI * 2, 0, Math.PI / 2);
  domeGeometry.scale(1, BELL_HEIGHT, 1);
  paintDome(domeGeometry, BELL_RADIUS * BELL_HEIGHT);
  const domeMaterial = createAdditiveBasicMaterial({ color: hdr(LUME_GREEN, 0.34), side: DoubleSide });
  domeMaterial.vertexColors = true;
  domeMaterial.fog = false;
  const dome = new Mesh(domeGeometry, domeMaterial);
  dome.frustumCulled = false;
  bell.add(dome);

  const rimMaterial = createAdditiveBasicMaterial({ color: hdr(JELLY_RIM, 0.85) });
  rimMaterial.fog = false;
  const rim = new Mesh(new TorusGeometry(BELL_RADIUS, 3.2, 8, 96), rimMaterial);
  rim.rotation.x = Math.PI / 2;
  rim.frustumCulled = false;
  bell.add(rim);

  // Radial ribs: the bell's structure, and the thing that makes its pulse read.
  const ribGeometries: BufferGeometry[] = [];
  for (let i = 0; i < 18; i += 1) {
    const theta = (i / 18) * Math.PI * 2;
    const points: Vector3[] = [];
    const radii: number[] = [];
    const colors: Color[] = [];
    for (let s = 0; s <= 12; s += 1) {
      const phi = (s / 12) * (Math.PI / 2);
      points.push(new Vector3(
        Math.sin(phi) * BELL_RADIUS * 0.995 * Math.cos(theta),
        Math.cos(phi) * BELL_RADIUS * BELL_HEIGHT * 0.995,
        Math.sin(phi) * BELL_RADIUS * 0.995 * Math.sin(theta),
      ));
      radii.push(0.8 + Math.sin(phi) * 1.6);
      colors.push(LUME_GOLD.clone().lerp(LUME_GREEN, 1 - Math.sin(phi)).multiplyScalar(0.25 + Math.sin(phi) * 0.75));
    }
    ribGeometries.push(tubeGeometry(points, radii, colors, 4));
  }
  const ribMaterial = createAdditiveBasicMaterial({ color: hdr(LUME_GOLD, 0.5) });
  ribMaterial.vertexColors = true;
  ribMaterial.fog = false;
  const ribs = new Mesh(mergeGeometries(ribGeometries), ribMaterial);
  ribs.frustumCulled = false;
  bell.add(ribs);
  for (const geometry of ribGeometries) geometry.dispose();

  // ---- crown --------------------------------------------------------------------
  // Where every strand gathers and roots. The parent is dug in right here.
  const crownGeometries: BufferGeometry[] = [];
  for (let i = 0; i < 14; i += 1) {
    const theta = (i / 14) * Math.PI * 2;
    const points: Vector3[] = [];
    const radii: number[] = [];
    const colors: Color[] = [];
    for (let s = 0; s <= 12; s += 1) {
      const t = s / 12;
      const along = -34 + t * 78;
      const radial = 20 * Math.sin(t * Math.PI) ** 0.7 + 2.5;
      points.push(local(along, Math.cos(theta) * radial, Math.sin(theta) * radial));
      radii.push(2.6 * (1 - t * 0.5));
      colors.push(LUME_GOLD.clone().lerp(LUME_GREEN, t).multiplyScalar(0.5 + (1 - t) * 0.7));
    }
    crownGeometries.push(tubeGeometry(points, radii, colors, 5));
  }
  const crownMaterial = createAdditiveBasicMaterial({ color: hdr(LUME_GOLD, 0.6) });
  crownMaterial.vertexColors = true;
  crownMaterial.fog = false;
  const crown = new Mesh(mergeGeometries(crownGeometries), crownMaterial);
  crown.frustumCulled = false;
  group.add(crown);
  for (const geometry of crownGeometries) geometry.dispose();

  const crownCoreMaterial = createAdditiveBasicMaterial({ color: hdr(LUME_GOLD, 0.5) });
  crownCoreMaterial.fog = false;
  const crownCore = new Mesh(new SphereGeometry(8, 16, 12), crownCoreMaterial);
  crownCore.position.copy(local(4, 0, 0));
  crownCore.frustumCulled = false;
  group.add(crownCore);

  // ---- oral arms ------------------------------------------------------------------
  const armGeometries: BufferGeometry[] = [];
  for (let i = 0; i < ORAL_ARM_COUNT; i += 1) {
    armGeometries.push(ribbonGeometry((i / ORAL_ARM_COUNT) * Math.PI * 2 + 0.4, rng));
  }
  const armMaterial = createAdditiveBasicMaterial({ color: hdr(LUME_GREEN, 0.34), side: DoubleSide });
  armMaterial.vertexColors = true;
  armMaterial.fog = false;
  const arms = new Mesh(mergeGeometries(armGeometries), armMaterial);
  arms.frustumCulled = false;
  group.add(arms);
  for (const geometry of armGeometries) geometry.dispose();

  // ---- travelling light --------------------------------------------------------------
  const beadMaterial = createAdditiveBasicMaterial({ color: 0xffffff });
  beadMaterial.fog = false;
  const beads = new InstancedMesh(new OctahedronGeometry(1, 0), beadMaterial, Math.max(1, beadMatrix.length));
  beads.frustumCulled = false;
  for (let i = 0; i < beadMatrix.length; i += 1) beads.setMatrixAt(i, beadMatrix[i]);
  beads.instanceMatrix.needsUpdate = true;
  group.add(beads);

  const blotchMaterial = createAdditiveBasicMaterial({ color: 0xffffff });
  blotchMaterial.fog = false;
  const blotches = new InstancedMesh(new OctahedronGeometry(1, 0), blotchMaterial, Math.max(1, blotchMatrix.length));
  blotches.frustumCulled = false;
  for (let i = 0; i < blotchMatrix.length; i += 1) blotches.setMatrixAt(i, blotchMatrix[i]);
  blotches.instanceMatrix.needsUpdate = true;
  group.add(blotches);

  // ---- per-frame -----------------------------------------------------------------
  const beadColor = new Color();
  const blotchColor = new Color();
  const heading = new Vector3();
  // It swims off across your heading rather than straight up it, so the last
  // thing you see is the animal side-on instead of the inside of its bell.
  const driftTurn = new Quaternion().setFromAxisAngle(DRIFT_AXIS, 0.38);
  const world = new Vector3();

  function update(_dt: number, context: AnimalUpdate) {
    const { life, pulse, drift, elapsed } = context;

    group.position.copy(context.crown);
    if (drift > 0) {
      const turn = 1 - (1 - Math.min(1, drift)) ** 2;
      group.quaternion.slerpQuaternions(IDENTITY, driftTurn, turn * 0.92);
      heading.copy(AXIS).applyQuaternion(group.quaternion);
      group.position.addScaledVector(heading, drift ** 1.5 * 210 + Math.max(0, drift - 1) * 26);
    } else {
      group.quaternion.copy(IDENTITY);
    }

    // The bell contracts on the beat; the strands answer a moment later.
    const contraction = Math.max(0, Math.sin(pulse * Math.PI * 2 - 0.6));
    const squash = 1 - contraction * 0.06;
    bell.scale.set(1 / squash ** 0.55, squash, 1 / squash ** 0.55);

    // The bell is drawn without fog so it can loom out of the deep water, so its
    // own brightness has to do the distance work. It is driven off apparent size
    // rather than raw distance: a dome covering a third of the frame reads as a
    // green moon, the same dome at arm's length covers everything and has to
    // come almost all the way down, and beyond the far plane it fades out
    // instead of being sliced off by the clip plane.
    const distance = world.copy(crownCore.position)
      .applyQuaternion(group.quaternion)
      .add(group.position)
      .distanceTo(context.camera.position);
    // `near` keeps the membrane off the whole frame once the bell engulfs you;
    // the far term is what makes the animal *arrive*. Together they put the
    // moon at its brightest around three hundred units out, which is where the
    // rail's wide bank puts you, and leave the opening minute to the strands.
    const apparent = BELL_RADIUS / Math.max(60, distance);
    const near = Math.min(1.1, (0.42 / apparent) ** 2);
    const presence = near * (1 - smoothstep(300, 410, distance));

    const glow = 0.4 + life * 0.3;
    for (const material of tentacleMaterials) {
      material.color.copy(LUME_GREEN).multiplyScalar(0.55 * glow + 0.12);
    }
    domeMaterial.color.copy(LUME_GREEN).lerp(LUME_GOLD, 0.18 + life * 0.2)
      .multiplyScalar((0.42 + life * 0.16 + contraction * 0.07) * presence);
    rimMaterial.color.copy(JELLY_RIM).multiplyScalar((0.3 + life * 0.25 + contraction * 0.3) * Math.min(1, presence * 1.5));
    ribMaterial.color.copy(LUME_GOLD).multiplyScalar((0.16 + life * 0.16 + contraction * 0.16) * Math.min(1, presence * 1.5));
    crownMaterial.color.copy(LUME_GOLD).lerp(LUME_GREEN, 0.45).multiplyScalar((0.34 + life * 0.34) * distanceFade(distance, 240));
    crownCoreMaterial.color.copy(LUME_GOLD).multiplyScalar((0.16 + life * 0.22 + contraction * 0.22) * distanceFade(distance, 175));
    armMaterial.color.copy(LUME_GREEN).multiplyScalar((0.34 + life * 0.34 + contraction * 0.14) * distanceFade(distance, 280));

    // A wave of light runs tip-to-crown once per pulse cycle. Beads are drawn
    // without fog, so each carries its own falloff — that is what keeps the far
    // half of the bundle from turning into a flat sheet of light.
    const clean = 0.25 + life * 0.75;
    for (let i = 0; i < beadMatrix.length; i += 1) {
      const along = beadRoot[i];
      const phase = (pulse - along * 0.55 + beadTentacle[i] * 0.012) % 1;
      const wrapped = phase < 0 ? phase + 1 : phase;
      const flash = Math.max(0, 1 - wrapped * 3.2) ** 1.6;
      const rest = 0.1 + along * 0.16;
      const range = world.copy(beadLocal[i]).applyQuaternion(group.quaternion).add(group.position)
        .distanceTo(context.camera.position);
      beadColor.copy(LUME_GREEN).lerp(LUME_GOLD, along * 0.6 + flash * 0.3)
        .multiplyScalar((rest + flash * 1.5) * (0.5 + life * 0.9) * distanceFade(range, 170));
      beads.setColorAt(i, beadColor);
    }
    if (beads.instanceColor) beads.instanceColor.needsUpdate = true;

    blotches.visible = clean < 0.99;
    if (blotches.visible) {
      const rot = 0.55 + Math.sin(elapsed * 1.7) * 0.15;
      for (let i = 0; i < blotchMatrix.length; i += 1) {
        const range = world.copy(blotchLocal[i]).applyQuaternion(group.quaternion).add(group.position)
          .distanceTo(context.camera.position);
        blotchColor.copy(SICK_VIOLET).multiplyScalar(Math.max(0, (1 - clean) * rot) * distanceFade(range, 150));
        blotches.setColorAt(i, blotchColor);
      }
      if (blotches.instanceColor) blotches.instanceColor.needsUpdate = true;
    }
  }

  return {
    group,
    update,
    dispose() {
      group.removeFromParent();
      group.traverse((object) => {
        const mesh = object as Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as MeshBasicMaterial | MeshBasicMaterial[] | undefined;
        if (Array.isArray(material)) for (const item of material) item.dispose();
        else material?.dispose();
      });
      group.clear();
    },
  };
}

// ---- geometry helpers ------------------------------------------------------------

/** Inverse-square falloff standing in for the fog these additive parts opt out of. */
function distanceFade(distance: number, half: number) {
  return 1 / (1 + (distance / half) ** 2);
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** A tapered, vertex-coloured tube swept along a polyline with parallel-transport frames. */
export function tubeGeometry(points: Vector3[], radii: number[], colors: Color[], radialSegments: number) {
  const count = points.length;
  const positions: number[] = [];
  const colorValues: number[] = [];
  const indices: number[] = [];

  const tangent = new Vector3();
  const normal = new Vector3();
  const binormal = new Vector3();
  const offset = new Vector3();

  // Seed the frame with any vector that is not parallel to the first tangent.
  tangent.copy(points[Math.min(1, count - 1)]).sub(points[0]).normalize();
  normal.set(0, 1, 0);
  if (Math.abs(normal.dot(tangent)) > 0.9) normal.set(1, 0, 0);
  normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();

  for (let i = 0; i < count; i += 1) {
    const previous = points[Math.max(0, i - 1)];
    const next = points[Math.min(count - 1, i + 1)];
    tangent.copy(next).sub(previous);
    if (tangent.lengthSq() < 1e-8) tangent.set(0, 0, 1);
    tangent.normalize();
    normal.addScaledVector(tangent, -normal.dot(tangent));
    if (normal.lengthSq() < 1e-6) {
      normal.set(0, 1, 0).addScaledVector(tangent, -tangent.y);
      if (normal.lengthSq() < 1e-6) normal.set(1, 0, 0).addScaledVector(tangent, -tangent.x);
    }
    normal.normalize();
    binormal.crossVectors(tangent, normal).normalize();

    const radius = radii[i];
    const color = colors[i];
    for (let j = 0; j < radialSegments; j += 1) {
      const angle = (j / radialSegments) * Math.PI * 2;
      offset.copy(normal).multiplyScalar(Math.cos(angle) * radius).addScaledVector(binormal, Math.sin(angle) * radius);
      positions.push(points[i].x + offset.x, points[i].y + offset.y, points[i].z + offset.z);
      colorValues.push(color.r, color.g, color.b);
    }
  }

  for (let i = 0; i < count - 1; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const a = i * radialSegments + j;
      const b = i * radialSegments + ((j + 1) % radialSegments);
      const c = a + radialSegments;
      const d = b + radialSegments;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colorValues, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Bell membrane shading: it has to read as a filled luminous disc, not an outline. */
function paintDome(geometry: BufferGeometry, height: number) {
  const position = geometry.getAttribute('position');
  const colors: number[] = [];
  const color = new Color();
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i) / height;
    const rim = 1 - Math.max(0, Math.min(1, y));
    color.copy(LUME_DEEP).lerp(LUME_GREEN, 0.55 + rim * 0.4).lerp(LUME_GOLD, rim * rim * 0.3);
    color.multiplyScalar(0.95 + rim ** 1.6 * 0.5);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
}

/** A broad ruffled oral arm hanging back from the crown. */
function ribbonGeometry(theta: number, rng: () => number) {
  const segments = 24;
  const radialBase = 10 + rng() * 14;
  const length = 150 + rng() * 90;
  const twist = (rng() - 0.5) * 1.1;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new Color();
  const point = new Vector3();

  for (let s = 0; s <= segments; s += 1) {
    const t = s / segments;
    const along = -12 - t * length;
    const angle = theta + twist * t + Math.sin(t * 4.2) * 0.18;
    const radial = radialBase * (0.6 + t * 1.5) * bundleFlare(-along);
    const halfWidth = (7 + t * 15) * (1 - t * 0.55);
    const ruffle = Math.sin(t * 9.5) * 4;
    for (const side of [-1, 1]) {
      local(
        along + ruffle * side * 0.35,
        Math.cos(angle) * radial + Math.cos(angle + Math.PI / 2) * halfWidth * side,
        Math.sin(angle) * radial + Math.sin(angle + Math.PI / 2) * halfWidth * side,
        point,
      );
      positions.push(point.x, point.y, point.z);
      const bright = (0.12 + (1 - t) ** 1.6 * 0.9) * (side < 0 ? 1 : 0.75);
      color.copy(LUME_DEEP).lerp(LUME_GREEN, 0.5).multiplyScalar(bright);
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let s = 0; s < segments; s += 1) {
    const a = s * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}
