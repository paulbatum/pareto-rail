import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
} from 'three';
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { attribute, float, positionLocal, smoothstep, uniform, vec3 } from 'three/tsl';
import { createThermalInkV1d2Rail, railU } from '../gameplay';
import { bar } from '../timing';
import { CREAM, OCHRE, RUST, RUST_DARK, SODIUM, mulberry32, type Rng } from './palette';

// The drowned harbor: sodium lamps burning through grit, wrecked hulls and
// collapsed gantries as silhouettes, chains swaying in the current, marine
// snow drifting down through tobacco-brown water. Every environmental material
// registers a murk color and a thermal counterpart; one shared uniform lets
// the tint pass sink the whole world into the charcoal display when ink closes.

/** 1 = normal murk, →0.12 inside the thermal display. Written by visuals/index. */
export const irEnvUniform = uniform(1);

type EnvEntry = { material: MeshBasicMaterial; murk: Color; ir: Color };
const envMaterials: EnvEntry[] = [];

function registerEnv(murk: Color, ir?: Color) {
  const material = new MeshBasicMaterial();
  material.color.copy(murk);
  envMaterials.push({ material, murk: murk.clone(), ir: (ir ?? new Color(0.11, 0.14, 0.16)).clone() });
  return material;
}

export function applyEnvironmentThermal(thermal: number) {
  for (const entry of envMaterials) {
    entry.material.color.copy(entry.murk).lerp(entry.ir, thermal).multiplyScalar(1 - thermal * 0.25);
  }
  irEnvUniform.value = 1 - thermal * 0.88;
}

function sodiumNode(intensity: number) {
  return vec3(SODIUM.r, SODIUM.g, SODIUM.b).mul(float(intensity)).mul(irEnvUniform);
}

export type HarborEnvironment = {
  root: Group;
  fields: ScatterField[];
  streaks: Object3D;
};

export function createEnvironment(scene: Scene): HarborEnvironment {
  scene.background = new Color(0.075, 0.048, 0.02);
  const root = new Group();
  const rng = mulberry32(977124);
  const curve = createThermalInkV1d2Rail();

  root.add(createMarineSnow(rng, curve));
  root.add(createWrappedWreck(curve));
  root.add(createCollapseGantry(curve));

  const fields: ScatterField[] = [];
  for (const field of [
    createWreckHulls(rng, curve),
    createPipes(rng, curve),
    createChains(rng, curve),
    createLamps(rng, curve),
    createCranes(rng, curve),
  ]) {
    root.add(field.group);
    fields.push(field);
  }

  const streaks = createMurkStreaks(rng);
  root.add(streaks);

  scene.add(root);
  return { root, fields, streaks };
}

// ---- marine snow ----------------------------------------------------------------

function createMarineSnow(rng: Rng, curve: ReturnType<typeof createThermalInkV1d2Rail>) {
  const count = 1300;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const u = rng();
    const frame = sampleRailFrame(curve, u);
    const angle = rng() * Math.PI * 2;
    const radius = 14 + rng() * 150;
    const point = frame.position
      .clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius)
      .addScaledVector(frame.tangent, (rng() - 0.5) * 60);
    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;
    const base = rng() < 0.7 ? OCHRE : rng() < 0.85 ? CREAM : SODIUM;
    const intensity = 0.06 + rng() * 0.22;
    colors[i * 3] = base.r * intensity;
    colors[i * 3 + 1] = base.g * intensity;
    colors[i * 3 + 2] = base.b * intensity;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial(additiveMaterialParameters({
    size: 0.45,
    vertexColors: true,
    sizeAttenuation: true,
  }));
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

// ---- the wrapped wreck ------------------------------------------------------------
// Authored opening set piece: a dead freighter hull off to the left with three
// colossal coil arcs squeezed around it — the octopus's first silhouette.

function createWrappedWreck(curve: ReturnType<typeof createThermalInkV1d2Rail>) {
  const group = new Group();
  const u = railU(bar(1.6));
  const frame = sampleRailFrame(curve, u);
  group.position.copy(frame.position)
    .addScaledVector(frame.right, -38)
    .addScaledVector(frame.up, -8)
    .addScaledVector(frame.tangent, -30);
  group.rotation.set(0.16, 0.5, -0.22);

  const hull = new Mesh(new BoxGeometry(46, 11, 13), registerEnv(RUST.clone().multiplyScalar(0.55)));
  group.add(hull);
  const deck = new Mesh(new BoxGeometry(10, 8, 10), registerEnv(RUST_DARK.clone().multiplyScalar(0.8)));
  deck.position.set(-14, 8, 0);
  group.add(deck);

  // Coil arcs: dark flesh loops around the hull.
  const coilMaterial = registerEnv(new Color(0.03, 0.02, 0.028), new Color(0.07, 0.09, 0.1));
  for (const [offset, radius, tilt] of [
    [-12, 10.5, 0.3],
    [2, 12, -0.15],
    [15, 9.5, 0.22],
  ] as const) {
    const coil = new Mesh(new CylinderGeometry(2.6, 2.6, 30, 9), coilMaterial);
    coil.position.set(offset, 2, 0);
    coil.rotation.z = Math.PI / 2;
    coil.rotation.x = tilt;
    group.add(coil);
  }
  return group;
}

// ---- collapsing gantry -------------------------------------------------------------
// Mid-dive set piece: leaning crane towers below the rail with snapped cables,
// skimmed at the bottom of the plunge.

function createCollapseGantry(curve: ReturnType<typeof createThermalInkV1d2Rail>) {
  const group = new Group();
  const u = railU(bar(14.4));
  const frame = sampleRailFrame(curve, u);
  group.position.copy(frame.position)
    .addScaledVector(frame.up, -46)
    .addScaledVector(frame.tangent, -18);

  const steelMaterial = registerEnv(RUST_DARK.clone().multiplyScalar(0.75));
  const cableMaterial = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  cableMaterial.colorNode = sodiumNode(0.55);

  for (const side of [-1, 1]) {
    const tower = new Mesh(new BoxGeometry(5, 52, 5), steelMaterial);
    tower.position.set(side * 19, 8, 0);
    tower.rotation.z = side * 0.34;
    group.add(tower);
    const jib = new Mesh(new BoxGeometry(30, 2.4, 2.4), steelMaterial);
    jib.position.set(side * 30, 30, 0);
    jib.rotation.z = side * 0.2;
    group.add(jib);
  }

  for (const [fromX, toX, droop] of [[-20, 14, 9], [16, -12, 12], [-6, 22, 7]] as const) {
    const points: Vector3[] = [];
    for (let i = 0; i <= 14; i += 1) {
      const t = i / 14;
      points.push(new Vector3(
        fromX + (toX - fromX) * t,
        26 - Math.sin(t * Math.PI) * droop - t * 6,
        (t - 0.5) * 4,
      ));
    }
    group.add(new Line(new BufferGeometry().setFromPoints(points), cableMaterial));
  }
  return group;
}

// ---- scattered fields -----------------------------------------------------------

function createWreckHulls(rng: Rng, curve: ReturnType<typeof createThermalInkV1d2Rail>) {
  return scatterAlongRail(curve, {
    count: 26,
    seed: 4411,
    rng,
    window: { behind: 60, ahead: curve.getLength() },
    alignToRail: false,
    make(index) {
      const plate = new BoxGeometry(4 + rng() * 13, 1.4 + rng() * 4.5, 5 + rng() * 16);
      const murk = index % 3 === 0 ? RUST_DARK : RUST;
      return new Mesh(plate, registerEnv(murk.clone().multiplyScalar(0.62)));
    },
    place(_index, placeRng) {
      const side = placeRng() < 0.5 ? -1 : 1;
      return {
        u: 0.02 + placeRng() * 0.96,
        offset: new Vector3(
          side * (42 + placeRng() * 90),
          placeRng() < 0.55 ? -(26 + placeRng() * 40) : 30 + placeRng() * 50,
          (placeRng() - 0.5) * 80,
        ),
      };
    },
  });
}

function createPipes(rng: Rng, curve: ReturnType<typeof createThermalInkV1d2Rail>) {
  return scatterAlongRail(curve, {
    count: 16,
    seed: 882,
    rng,
    window: { behind: 60, ahead: curve.getLength() },
    alignToRail: false,
    make() {
      const length = 26 + rng() * 42;
      const pipe = new CylinderGeometry(0.8 + rng() * 1.4, 0.8 + rng() * 1.4, length, 8);
      const mesh = new Mesh(pipe, registerEnv(RUST.clone().multiplyScalar(0.5)));
      mesh.rotation.z = rng() * Math.PI;
      mesh.rotation.x = (rng() - 0.5) * 0.6;
      return mesh;
    },
    place(_index, placeRng) {
      const side = placeRng() < 0.5 ? -1 : 1;
      return {
        u: 0.02 + placeRng() * 0.96,
        offset: new Vector3(
          side * (36 + placeRng() * 60),
          placeRng() < 0.6 ? -(24 + placeRng() * 34) : 30 + placeRng() * 40,
          (placeRng() - 0.5) * 70,
        ),
      };
    },
  });
}

function createChains(rng: Rng, curve: ReturnType<typeof createThermalInkV1d2Rail>) {
  const chainLines: Line[] = [];
  const material = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  material.colorNode = sodiumNode(0.28);
  return scatterAlongRail(curve, {
    count: 14,
    seed: 77,
    rng,
    window: { behind: 50, ahead: curve.getLength() },
    alignToRail: false,
    make(index) {
      const points: Vector3[] = [];
      const segments = 10;
      const droop = 6 + rng() * 8;
      for (let i = 0; i <= segments; i += 1) {
        const t = i / segments;
        points.push(new Vector3((t - 0.5) * 2, -Math.sin(t * Math.PI) * droop - t * 2, 0));
      }
      const line = new Line(new BufferGeometry().setFromPoints(points), material);
      line.userData.swayPhase = rng() * Math.PI * 2;
      line.scale.setScalar(1.6 + rng() * 1.6);
      chainLines[index] = line;
      return line;
    },
    place(_index, placeRng) {
      const side = placeRng() < 0.5 ? -1 : 1;
      return {
        u: 0.02 + placeRng() * 0.96,
        offset: new Vector3(side * (24 + placeRng() * 40), 30 + placeRng() * 26, (placeRng() - 0.5) * 60),
      };
    },
    onUpdate(item, dt) {
      const line = chainLines[item.index];
      if (line) line.rotation.z += dt * 0.12 * Math.sin((line.userData.swayPhase as number) + item.u * 40);
    },
  });
}

function createLamps(rng: Rng, curve: ReturnType<typeof createThermalInkV1d2Rail>) {
  const haloPlane = new PlaneGeometry(7, 7);
  return scatterAlongRail(curve, {
    count: 18,
    seed: 1947,
    rng,
    window: { behind: 50, ahead: curve.getLength() },
    alignToRail: false,
    make() {
      const group = new Group();
      const poleMaterial = registerEnv(RUST_DARK.clone().multiplyScalar(0.7));
      const pole = new Mesh(new CylinderGeometry(0.35, 0.5, 9, 6), poleMaterial);
      pole.position.y = 4.5;
      group.add(pole);
      const arm = new Mesh(new BoxGeometry(3.4, 0.4, 0.4), poleMaterial);
      arm.position.set(1.4, 8.8, 0);
      group.add(arm);

      const headMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({}));
      headMaterial.colorNode = sodiumNode(2.2);
      const head = new Mesh(new BoxGeometry(1.5, 0.5, 1), headMaterial);
      head.position.set(2.8, 8.6, 0);
      group.add(head);

      const haloMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ depthWrite: false }));
      haloMaterial.colorNode = sodiumNode(0.5);
      const halo = new Mesh(haloPlane, haloMaterial);
      halo.position.set(2.8, 8.6, 0);
      group.add(halo);

      const shaftMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ depthWrite: false }));
      shaftMaterial.colorNode = sodiumNode(0.09);
      const shaft = new Mesh(new ConeGeometry(4.4, 15, 8, 1, true), shaftMaterial);
      shaft.position.set(2.8, 1.2, 0);
      group.add(shaft);
      return group;
    },
    place(_index, placeRng) {
      const side = placeRng() < 0.5 ? -1 : 1;
      return {
        u: 0.015 + placeRng() * 0.97,
        offset: new Vector3(side * (24 + placeRng() * 14), 15 + placeRng() * 8, (placeRng() - 0.5) * 40),
      };
    },
  });
}

function createCranes(rng: Rng, curve: ReturnType<typeof createThermalInkV1d2Rail>) {
  return scatterAlongRail(curve, {
    count: 7,
    seed: 3313,
    rng,
    window: { behind: 100, ahead: curve.getLength() },
    alignToRail: false,
    make() {
      const group = new Group();
      const steelMaterial = registerEnv(RUST_DARK.clone().multiplyScalar(0.5));
      const legA = new Mesh(new BoxGeometry(3, 60, 3), steelMaterial);
      legA.position.set(-4, 30, 0);
      legA.rotation.z = 0.06;
      const legB = new Mesh(new BoxGeometry(3, 60, 3), steelMaterial);
      legB.position.set(4, 30, 0);
      legB.rotation.z = -0.06;
      const jib = new Mesh(new BoxGeometry(56, 3.4, 3.4), steelMaterial);
      jib.position.set(10, 58, 0);
      jib.rotation.z = -0.08;
      group.add(legA, legB, jib);
      group.scale.setScalar(1.4 + rng() * 1.2);
      return group;
    },
    place(_index, placeRng) {
      const side = placeRng() < 0.5 ? -1 : 1;
      return {
        u: 0.02 + placeRng() * 0.95,
        offset: new Vector3(side * (95 + placeRng() * 70), -(6 + placeRng() * 20), (placeRng() - 0.5) * 120),
      };
    },
  });
}

// ---- murk streaks ------------------------------------------------------------------
// A cylinder of faint drift streaks around the camera — felt airspeed without
// ever reading as speed lines.

const STREAK_SPAN = 48;
const STREAK_BACK = 42;
const streakOffsetUniform = uniform(0);

function createMurkStreaks(rng: Rng) {
  const COUNT = 170;
  const positions: number[] = [];
  const z0: number[] = [];
  const dz: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 4 + rng() * 10;
    const start = rng() * STREAK_SPAN;
    const length = 2 + rng() * 4;
    const color = (rng() < 0.65 ? OCHRE : rng() < 0.85 ? CREAM : SODIUM).clone().multiplyScalar(0.1 + rng() * 0.2);
    for (const delta of [0, length]) {
      positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      z0.push(start);
      dz.push(delta);
      colors.push(color.r, color.g, color.b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('z0', new Float32BufferAttribute(z0, 1));
  geometry.setAttribute('dz', new Float32BufferAttribute(dz, 1));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const material = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  const wrapped = attribute<'float'>('z0', 'float')
    .add(streakOffsetUniform)
    .mod(STREAK_SPAN)
    .sub(STREAK_BACK);
  material.positionNode = vec3(
    positionLocal.x,
    positionLocal.y,
    wrapped.add(attribute<'float'>('dz', 'float')),
  );
  const envelope = smoothstep(float(-STREAK_BACK), float(-STREAK_BACK + 9), wrapped).mul(
    smoothstep(float(STREAK_SPAN - STREAK_BACK), float(STREAK_SPAN - STREAK_BACK - 5), wrapped),
  );
  material.colorNode = attribute<'vec3'>('color', 'vec3').mul(envelope).mul(irEnvUniform);

  const streaks = new LineSegments(geometry, material);
  streaks.frustumCulled = false;
  const group = new Group();
  group.add(streaks);
  return group;
}

export function updateStreaks(streaks: Object3D, camera: Object3D, dt: number, speed: number) {
  streaks.position.copy(camera.position);
  streaks.quaternion.copy(camera.quaternion);
  streakOffsetUniform.value = (streakOffsetUniform.value + dt * speed * 18) % STREAK_SPAN;
}
