import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Points,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera, Color } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scatterAlongRail } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { createThermalInk4xmhRail, thermalInkRunProgress } from '../gameplay';
import { THERMAL_INK_TIME, THERMAL_INK_WINDOWS } from '../timing';
import { inkMesh, modalLine, modalMesh, modalPoints } from './materials';

// The drowned harbour. Everything is silhouette work: hulls, gantries, pipes,
// chains, and a line of sodium lamps burning through the grit — read against
// the murk in normal sight, and read as cold nothing once the imager is up.

const INK_PUFFS_PER_WINDOW = 30;
const PUFF_CAPACITY = INK_PUFFS_PER_WINDOW * 4;

export type EnvironmentSkin = {
  steelMurk: Color;
  steelThermal: Color;
  paintMurk: Color;
  paintThermal: Color;
  edgeMurk: Color;
  edgeThermal: Color;
  lampMurk: Color;
  lampThermal: Color;
  gritMurk: Color;
  gritThermal: Color;
  bedMurk: Color;
  bedThermal: Color;
};

export type HarbourEnvironment = {
  root: Group;
  update(cameraU: number, dt: number, camera: Camera): void;
};

const matrix = new Matrix4();
const quaternion = new Quaternion();
const puffScale = new Vector3();
const puffPosition = new Vector3();
const rollQuaternion = new Quaternion();
const rollAxis = new Vector3(0, 0, 1);

function wreckGeometry(rng: () => number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const hullLength = 20 + rng() * 22;
  const hull = new BoxGeometry(6 + rng() * 4, 5 + rng() * 3.5, hullLength);
  hull.rotateZ((rng() - 0.5) * 0.9);
  hull.rotateX((rng() - 0.5) * 0.5);
  parts.push(hull.toNonIndexed());
  hull.dispose();
  const ribs = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < ribs; i += 1) {
    const rib = new TorusGeometry(4 + rng() * 2, 0.32, 4, 10);
    rib.rotateY(Math.PI / 2);
    rib.translate((rng() - 0.5) * 6, (rng() - 0.5) * 3, -hullLength * 0.4 + i * (hullLength / ribs));
    parts.push(rib.toNonIndexed());
    rib.dispose();
  }
  const stack = new CylinderGeometry(1.3, 1.8, 7 + rng() * 5, 7);
  stack.translate((rng() - 0.5) * 4, 4.5, (rng() - 0.5) * 8);
  stack.rotateZ((rng() - 0.5) * 0.6);
  parts.push(stack.toNonIndexed());
  stack.dispose();
  return mergeGeometries(parts) ?? new BoxGeometry(8, 6, 20);
}

function gantryGeometry(rng: () => number): BufferGeometry {
  const positions: number[] = [];
  const width = 5 + rng() * 4;
  const height = 14 + rng() * 12;
  const bays = 4 + Math.floor(rng() * 4);
  const line = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    positions.push(ax, ay, az, bx, by, bz);
  };
  for (let i = 0; i < bays; i += 1) {
    const y0 = (i / bays) * height;
    const y1 = ((i + 1) / bays) * height;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      line(sx * width, y0, sz * width, sx * width, y1, sz * width);
    }
    for (let k = 0; k < 4; k += 1) {
      const a = [[-1, -1], [1, -1], [1, 1], [-1, 1]][k] as [number, number];
      const b = [[-1, -1], [1, -1], [1, 1], [-1, 1]][(k + 1) % 4] as [number, number];
      line(a[0] * width, y1, a[1] * width, b[0] * width, y1, b[1] * width);
      line(a[0] * width, y0, a[1] * width, b[0] * width, y1, b[1] * width);
    }
  }
  // A snapped boom hanging off the top.
  line(0, height, 0, (rng() - 0.5) * 26, height - 6 - rng() * 6, (rng() - 0.5) * 22);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

function chainGeometry(rng: () => number): BufferGeometry {
  const positions: number[] = [];
  const drop = 16 + rng() * 22;
  const links = 10;
  let x = 0;
  let z = 0;
  for (let i = 0; i < links; i += 1) {
    const y0 = -(i / links) * drop;
    const y1 = -((i + 1) / links) * drop;
    const nx = x + (rng() - 0.5) * 1.4;
    const nz = z + (rng() - 0.5) * 1.4;
    positions.push(x, y0, z, nx, y1, nz);
    x = nx;
    z = nz;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

function lampGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const pole = new CylinderGeometry(0.28, 0.36, 9, 6);
  pole.translate(0, -4.5, 0);
  parts.push(pole.toNonIndexed());
  pole.dispose();
  const arm = new BoxGeometry(3.4, 0.32, 0.32);
  arm.translate(1.5, 0, 0);
  parts.push(arm.toNonIndexed());
  arm.dispose();
  const hood = new CylinderGeometry(1.1, 0.5, 1.0, 8, 1, true);
  hood.translate(3.0, 0.3, 0);
  parts.push(hood.toNonIndexed());
  hood.dispose();
  return mergeGeometries(parts) ?? new BoxGeometry(1, 1, 1);
}

function siltGeometry(rng: () => number): BufferGeometry {
  const mound = new IcosahedronGeometry(9 + rng() * 14, 1);
  mound.scale(1 + rng(), 0.22 + rng() * 0.2, 1 + rng());
  return mound;
}

function motes(rng: () => number, count: number, near: number, far: number): BufferGeometry {
  const curve = createThermalInk4xmhRail();
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const frame = sampleRailFrame(curve, rng());
    const angle = rng() * Math.PI * 2;
    const radius = near + rng() * (far - near);
    const point = frame.position
      .clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius)
      .addScaledVector(frame.tangent, (rng() - 0.5) * 40);
    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

export function createHarbour(scene: Scene, skin: EnvironmentSkin): HarbourEnvironment {
  const root = new Group();
  const rng = mulberry32(20260725);
  const curve = createThermalInk4xmhRail();

  const steel = modalMesh(skin.steelMurk, skin.steelThermal, { swallow: 0.96, shade: 0.9, rim: 0.12 });
  const paint = modalMesh(skin.paintMurk, skin.paintThermal, { swallow: 0.96, shade: 0.9, rim: 0.1 });
  const edge = modalLine(skin.edgeMurk, skin.edgeThermal, { swallow: 0.97 });
  const surfaceLines = modalLine(skin.edgeMurk.clone().multiplyScalar(0.3), skin.edgeThermal.clone().multiplyScalar(0.25), { swallow: 0.98 });
  const lampGlass = modalMesh(skin.lampMurk, skin.lampThermal, { swallow: 0.5, additive: true });
  const bed = modalMesh(skin.bedMurk, skin.bedThermal, { swallow: 0.97, shade: 0.3 });
  const grit = modalPoints(skin.gritMurk, skin.gritThermal, 0.13, { swallow: 0.85, additive: true });
  const farGrit = modalPoints(skin.gritMurk, skin.gritThermal, 0.42, { swallow: 0.9, additive: true });

  // --- Seabed and the surface far overhead: the two planes that tell you which
  // way is up in water this dirty.
  const seabed = new Mesh(new PlaneGeometry(700, 700, 1, 1), bed);
  seabed.name = 'seabed';
  seabed.rotation.x = -Math.PI / 2;
  seabed.position.y = -46;
  seabed.userData.raildIgnoreOcclusion = true;
  root.add(seabed);

  // The underside of the surface, far overhead: a slack net of ripple lines, dim
  // enough that it stays a ceiling rather than a second light source.
  const surfacePositions: number[] = [];
  for (let i = -9; i <= 9; i += 1) {
    surfacePositions.push(i * 40, 0, -360, i * 40, 0, 360);
    surfacePositions.push(-360, 0, i * 40, 360, 0, i * 40);
  }
  const surfaceGeometry = new BufferGeometry();
  surfaceGeometry.setAttribute('position', new Float32BufferAttribute(surfacePositions, 3));
  const surface = new LineSegments(surfaceGeometry, surfaceLines);
  surface.position.y = 52;
  surface.frustumCulled = false;
  root.add(surface);

  const wrecks = scatterAlongRail(curve, {
    count: 18,
    seed: 20260726,
    rng,
    window: { behind: 90, ahead: 240 },
    alignToRail: false,
    make(_index, makeRng) {
      const group = new Group();
      const geometry = wreckGeometry(makeRng);
      const hull = new Mesh(geometry, makeRng() < 0.35 ? paint : steel);
      hull.name = 'harbour-wreck';
      const lines = new LineSegments(new EdgesGeometry(geometry, 28), edge);
      group.add(hull, lines);
      group.rotation.set(makeRng() * 0.4, makeRng() * Math.PI * 2, (makeRng() - 0.5) * 0.5);
      return group;
    },
    place(index, placeRng) {
      // Hulls sit well off the rail and below it: a wreck that drifts into the
      // flight path reads as a black wall, not as harbour.
      const side = index % 2 === 0 ? -1 : 1;
      return {
        u: placeRng(),
        offset: new Vector3(side * (42 + placeRng() * 40), -22 - placeRng() * 22, (placeRng() - 0.5) * 70),
      };
    },
  });
  root.add(wrecks.group);

  const gantries = scatterAlongRail(curve, {
    count: 9,
    seed: 20260727,
    rng,
    window: { behind: 80, ahead: 260 },
    alignToRail: false,
    make(_index, makeRng) {
      const lines = new LineSegments(gantryGeometry(makeRng), edge);
      lines.rotation.y = makeRng() * Math.PI;
      return lines;
    },
    place(index, placeRng) {
      const side = index % 2 === 0 ? 1 : -1;
      return { u: placeRng(), offset: new Vector3(side * (30 + placeRng() * 28), -34, (placeRng() - 0.5) * 40) };
    },
  });
  root.add(gantries.group);

  const chains = scatterAlongRail(curve, {
    count: 14,
    seed: 20260728,
    rng,
    window: { behind: 60, ahead: 210 },
    alignToRail: false,
    make(_index, makeRng) {
      const lines = new LineSegments(chainGeometry(makeRng), edge);
      lines.userData.sway = 0.4 + makeRng() * 0.8;
      return lines;
    },
    place(_index, placeRng) {
      return {
        u: placeRng(),
        offset: new Vector3((placeRng() - 0.5) * 66, 24 + placeRng() * 14, (placeRng() - 0.5) * 40),
      };
    },
  });
  root.add(chains.group);

  const lampShape = lampGeometry();
  const lamps = scatterAlongRail(curve, {
    count: 30,
    seed: 20260729,
    rng,
    window: { behind: 60, ahead: 260 },
    alignToRail: true,
    make(_index, makeRng) {
      const group = new Group();
      const housing = new Mesh(lampShape, steel);
      housing.name = 'lamp';
      const bulb = new Mesh(new SphereGeometry(0.52, 8, 6), lampGlass);
      bulb.position.set(3.0, -0.15, 0);
      const halo = new Mesh(new TorusGeometry(1.25, 0.07, 5, 14), lampGlass);
      halo.position.set(3.0, -0.15, 0);
      halo.rotation.y = Math.PI / 2;
      group.add(housing, bulb, halo);
      group.userData.bulb = bulb;
      group.userData.phase = makeRng() * Math.PI * 2;
      return group;
    },
    place(index, placeRng) {
      const side = index % 2 === 0 ? -1 : 1;
      return {
        u: placeRng(),
        offset: new Vector3(side * (18 + placeRng() * 12), 6 + placeRng() * 16, (placeRng() - 0.5) * 20),
      };
    },
  });
  root.add(lamps.group);

  const silt = scatterAlongRail(curve, {
    count: 10,
    seed: 20260730,
    rng,
    window: { behind: 100, ahead: 280 },
    alignToRail: false,
    make(_index, makeRng) {
      const mound = new Mesh(siltGeometry(makeRng), bed);
      mound.name = 'silt';
      return mound;
    },
    place(_index, placeRng) {
      return { u: placeRng(), offset: new Vector3((placeRng() - 0.5) * 120, -40, (placeRng() - 0.5) * 60) };
    },
  });
  silt.forEach((item) => {
    item.object.userData.raildIgnoreOcclusion = true;
  });
  root.add(silt.group);

  const nearGrit = new Points(motes(rng, 900, 2.5, 13), grit);
  nearGrit.frustumCulled = false;
  root.add(nearGrit);
  const hangingGrit = new Points(motes(rng, 700, 16, 60), farGrit);
  hangingGrit.frustumCulled = false;
  root.add(hangingGrit);

  // --- The clouds. Each one is placed where the camera will actually be during
  // its authored window, so flying into the blackout is a physical event and
  // not just a fade: you watch the wall of ink arrive and then swallow you.
  const puffMaterial = inkMesh(0.82);
  const puffs = new InstancedMesh(new CircleGeometry(1, 14), puffMaterial, PUFF_CAPACITY);
  puffs.frustumCulled = false;
  puffs.userData.raildIgnoreOcclusion = true;
  const puffData: Array<{ base: Vector3; radius: number; spin: number; drift: Vector3 }> = [];
  for (const window of THERMAL_INK_WINDOWS) {
    for (let i = 0; i < INK_PUFFS_PER_WINDOW; i += 1) {
      const t = MathUtils.lerp(window.from - 0.25, window.to + 0.5, i / (INK_PUFFS_PER_WINDOW - 1));
      const u = thermalInkRunProgress(t * THERMAL_INK_TIME.barSeconds);
      const frame = sampleRailFrame(curve, MathUtils.clamp(u, 0, 1));
      const angle = rng() * Math.PI * 2;
      const radius = rng() * 13;
      puffData.push({
        base: frame.position
          .clone()
          .addScaledVector(frame.right, Math.cos(angle) * radius)
          .addScaledVector(frame.up, Math.sin(angle) * radius * 0.8)
          .addScaledVector(frame.tangent, (rng() - 0.5) * 26),
        radius: 9 + rng() * 13,
        spin: (rng() - 0.5) * 0.5,
        drift: new Vector3((rng() - 0.5) * 0.6, (rng() - 0.5) * 0.4 + 0.25, (rng() - 0.5) * 0.5),
      });
    }
  }
  puffs.count = puffData.length;
  root.add(puffs);

  scene.add(root);
  let elapsed = 0;

  return {
    root,
    update(cameraU, dt, camera) {
      elapsed += dt;
      wrecks.update(cameraU, dt);
      gantries.update(cameraU, dt);
      chains.update(cameraU, dt);
      lamps.update(cameraU, dt);
      silt.update(cameraU, dt);

      chains.forEach((item) => {
        const sway = (item.object.userData.sway as number | undefined) ?? 0.5;
        item.object.rotation.z = Math.sin(elapsed * sway + item.index) * 0.09;
        item.object.rotation.x = Math.cos(elapsed * sway * 0.7 + item.index) * 0.06;
      });
      lamps.forEach((item) => {
        const bulb = item.object.userData.bulb as Mesh | undefined;
        if (!bulb) return;
        const phase = (item.object.userData.phase as number | undefined) ?? 0;
        // Sodium lamps in dirty water: a slow unsteady burn, never a strobe.
        bulb.scale.setScalar(0.9 + Math.sin(elapsed * 2.1 + phase) * 0.07 + Math.sin(elapsed * 7.3 + phase) * 0.03);
      });

      // Billboard the ink toward the camera and let it roll slowly.
      for (let i = 0; i < puffData.length; i += 1) {
        const puff = puffData[i];
        puffPosition.copy(puff.base).addScaledVector(puff.drift, Math.sin(elapsed * 0.25 + i) * 3.4 + elapsed * 0.35);
        quaternion.copy(camera.quaternion);
        rollQuaternion.setFromAxisAngle(rollAxis, elapsed * puff.spin + i);
        quaternion.multiply(rollQuaternion);
        puffScale.setScalar(puff.radius * (0.92 + Math.sin(elapsed * 0.7 + i * 1.3) * 0.08));
        matrix.compose(puffPosition, quaternion, puffScale);
        puffs.setMatrixAt(i, matrix);
      }
      puffs.instanceMatrix.needsUpdate = true;
      surface.position.x = camera.position.x;
      surface.position.z = camera.position.z;
      seabed.position.x = camera.position.x;
      seabed.position.z = camera.position.z;
    },
  };
}
