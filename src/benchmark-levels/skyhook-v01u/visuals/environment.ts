import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  FogExp2,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { createAtmosphereRamp, scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { disposeObject3D } from '../../../engine/visual-kit';
import { createSkyhookV01uRail, skyhookSpeedFactorAt } from '../gameplay';

const STORM = new Color(0.055, 0.09, 0.14);
const STORM_FOG = new Color(0.12, 0.17, 0.21);
const CLOUD_BLUE = new Color(0.2, 0.4, 0.58);
const SUNLIT_CLOUD = new Color(0.46, 0.6, 0.64);
const INDIGO = new Color(0.045, 0.07, 0.2);
const BLACK_SKY = new Color(0.002, 0.005, 0.016);
const PANEL = new Color(0.68, 0.74, 0.73);
const PANEL_DARK = new Color(0.095, 0.13, 0.15);
const HAZARD = new Color(1.0, 0.26, 0.035);
const HAZARD_HOT = new Color(1.7, 0.42, 0.05);
const STAR_WHITE = new Color(0.78, 0.88, 0.92);
const PLANET_BLUE = new Color(0.018, 0.075, 0.13);
const PLANET_LINE = new Color(0.12, 0.32, 0.38);
const planetForward = new Vector3();
const planetUp = new Vector3();

type CloudRecord = {
  group: Group;
  u: number;
  materials: MeshBasicMaterial[];
  base: Color;
};

type StreakRecord = {
  line: Line;
  base: number;
  speed: number;
};

type StationParts = {
  root: Group;
  leftDoor: Mesh;
  rightDoor: Mesh;
  halo: Mesh;
  lights: Mesh[];
};

export type SkyhookEnvironment = {
  root: Group;
  setBossDefeated(defeated: boolean): void;
  update(runProgress: number, runTime: number, elapsed: number, camera: { position: Vector3; quaternion: Quaternion }, running: boolean, dt: number): void;
  dispose(): void;
};

export function createSkyhookEnvironment(scene: Scene): SkyhookEnvironment {
  const curve = createSkyhookV01uRail();
  scene.background = STORM.clone();
  scene.fog = new FogExp2(STORM_FOG.clone(), 0.012);

  const root = new Group();
  root.name = 'skyhook-world';
  // The elevator is intentionally non-occluding scenery. Target visibility is
  // carried by the target silhouettes and the thin cables never hide a lock.
  root.userData.raildIgnoreOcclusion = true;

  const atmosphere = createAtmosphereRamp(scene, [
    { progress: 0, background: STORM, fog: STORM_FOG, density: 0.012 },
    { progress: 0.17, background: new Color(0.19, 0.36, 0.52), fog: new Color(0.24, 0.43, 0.55), density: 0.009 },
    { progress: 0.37, background: CLOUD_BLUE, fog: new Color(0.2, 0.37, 0.52), density: 0.006 },
    { progress: 0.54, background: INDIGO, fog: new Color(0.055, 0.08, 0.2), density: 0.0038 },
    { progress: 0.72, background: BLACK_SKY, fog: new Color(0.006, 0.012, 0.04), density: 0.0024 },
    { progress: 1, background: new Color(0.002, 0.008, 0.022), fog: new Color(0.004, 0.009, 0.026), density: 0.0018 },
  ]);

  const tether = createTether(curve);
  root.add(tether);

  const clouds = createClouds(curve);
  root.add(...clouds.map((cloud) => cloud.group));
  const cloudDeck = createCloudDeck(curve);
  root.add(cloudDeck);

  const debris = createDebris(curve);
  root.add(debris.group);

  const stars = createStars(curve);
  root.add(stars.points);

  const earth = createPlanet(curve);
  root.add(earth.root);

  const station = createStation(curve);
  root.add(station.root);
  let bossDefeated = false;

  const carriage = createCarriage();
  root.add(carriage);

  const streaks = createSpeedStreaks();
  root.add(streaks.group);

  scene.add(root);

  return {
    root,
    setBossDefeated(defeated) {
      bossDefeated = defeated;
    },
    update(runProgress, runTime, elapsed, camera, running, dt) {
      const progress = running ? clamp01(runProgress) : 0;
      atmosphere(progress);
      debris.update(progress, dt);

      const frame = sampleRailFrame(curve, progress);
      carriage.position.copy(frame.position);
      carriage.quaternion.copy(frameQuaternion(frame));
      // Keep the planetary limb below the moving car instead of leaving it
      // behind at the final rail sample. The camera should still read a
      // curved world under the station when the climb is nearly complete.
      planetForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
      planetUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      earth.root.position.copy(camera.position)
        .addScaledVector(planetForward, 240)
        .addScaledVector(planetUp, -300);
      earth.root.quaternion.copy(camera.quaternion);

      const cloudFade = 1 - smoothstep(0.22, 0.55, progress);
      for (const cloud of clouds) {
        cloud.group.visible = cloudFade > 0.01 && cloud.u >= progress - 0.05;
        const color = cloud.base.clone().lerp(SUNLIT_CLOUD, Math.min(1, progress * 2.6));
        for (const material of cloud.materials) {
          material.color.copy(color);
          material.opacity = (0.1 + cloudFade * 0.13) * cloudFade;
        }
      }
      const deckFade = (1 - smoothstep(0.17, 0.48, progress)) * 0.7;
      (cloudDeck.children[0] as Mesh).scale.setScalar(0.85 + deckFade * 0.2);
      ((cloudDeck.children[0] as Mesh).material as MeshBasicMaterial).opacity = deckFade;

      const starFade = smoothstep(0.34, 0.66, progress);
      stars.material.opacity = starFade * 0.82;
      stars.points.rotation.y = elapsed * 0.004;

      const planetFade = smoothstep(0.43, 0.73, progress);
      earth.root.visible = planetFade > 0.01;
      earth.material.opacity = planetFade * 0.86;
      earth.linesMaterial.opacity = planetFade * 0.78;
      earth.rimMaterial.opacity = planetFade * 0.48;
      earth.root.rotateY(dt * 0.018);

      // The station is visible as a promise, but its mouth only opens after
      // the Skyhook is severed. A doomed run therefore keeps the final threat
      // in the frame instead of silently getting a victory state.
      const docking = bossDefeated ? smoothstep(0.86, 0.985, progress) : 0;
      station.leftDoor.position.x = -4.7 - docking * 8.4;
      station.rightDoor.position.x = 4.7 + docking * 8.4;
      station.halo.scale.setScalar(0.85 + docking * 0.22);
      (station.halo.material as MeshBasicMaterial).opacity = 0.22 + docking * 0.46;
      for (const [index, light] of station.lights.entries()) {
        const material = light.material as MeshBasicMaterial;
        material.opacity = 0.25 + (0.35 + Math.sin(elapsed * 4 + index) * 0.18) * docking;
      }

      streaks.group.position.copy(camera.position);
      streaks.group.quaternion.copy(camera.quaternion);
      const speed = running ? skyhookSpeedFactorAt(runTime) : 0.28;
      streaks.phase += dt * speed * 24;
      for (const streak of streaks.records) streak.line.position.z = ((streak.base + streaks.phase * streak.speed) % 72) - 54;
    },
    dispose() {
      debris.dispose();
      root.removeFromParent();
      disposeObject3D(root);
      root.clear();
    },
  };
}

function createTether(curve: ReturnType<typeof createSkyhookV01uRail>) {
  const group = new Group();
  group.name = 'tether-and-guide-rails';
  const centralPoints: Vector3[] = [];
  const leftPoints: Vector3[] = [];
  const rightPoints: Vector3[] = [];
  for (let index = 0; index <= 120; index += 1) {
    const frame = sampleRailFrame(curve, index / 120);
    centralPoints.push(frame.position.clone().addScaledVector(frame.tangent, 1.4));
    leftPoints.push(frame.position.clone().addScaledVector(frame.right, -2.4).addScaledVector(frame.up, -0.8));
    rightPoints.push(frame.position.clone().addScaledVector(frame.right, 2.4).addScaledVector(frame.up, -0.8));
  }
  group.add(new Line(new BufferGeometry().setFromPoints(centralPoints), new LineBasicMaterial({ color: PANEL_DARK, transparent: true, opacity: 0.88 })));
  group.add(new Line(new BufferGeometry().setFromPoints(leftPoints), new LineBasicMaterial({ color: PANEL, transparent: true, opacity: 0.48 })));
  group.add(new Line(new BufferGeometry().setFromPoints(rightPoints), new LineBasicMaterial({ color: PANEL, transparent: true, opacity: 0.48 })));

  for (let index = 0; index < 26; index += 1) {
    const u = index / 25;
    const frame = sampleRailFrame(curve, u);
    const collar = new Mesh(new TorusGeometry(3.0, 0.1, 6, 22), new MeshBasicMaterial({ color: index % 4 === 0 ? HAZARD_HOT : PANEL_DARK, transparent: true, opacity: index % 4 === 0 ? 0.82 : 0.6 }));
    collar.position.copy(frame.position);
    collar.quaternion.copy(frameQuaternion(frame));
    group.add(collar);
  }

  // Small rectangular service boxes at intervals make the central line read
  // as engineered infrastructure, not an abstract rail.
  for (let index = 2; index < 24; index += 2) {
    const frame = sampleRailFrame(curve, index / 25);
    const box = new Mesh(new BoxGeometry(1.6, 0.7, 1.3), new MeshBasicMaterial({ color: PANEL_DARK }));
    box.position.copy(frame.position).addScaledVector(frame.right, 3.9).addScaledVector(frame.up, -1.1);
    box.quaternion.copy(frameQuaternion(frame));
    group.add(box);
  }
  return group;
}

function createClouds(curve: ReturnType<typeof createSkyhookV01uRail>) {
  const clouds: CloudRecord[] = [];
  let seed = 27;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let index = 0; index < 34; index += 1) {
    const u = 0.015 + random() * 0.42;
    const frame = sampleRailFrame(curve, u);
    const group = new Group();
    group.name = `cloud-bank-${index}`;
    group.position.copy(frame.position)
      .addScaledVector(frame.right, (random() < 0.5 ? -1 : 1) * (16 + random() * 42))
      .addScaledVector(frame.up, (random() - 0.35) * 28)
      .addScaledVector(frame.tangent, (random() - 0.5) * 18);
    group.quaternion.copy(frameQuaternion(frame));
    const base = index % 4 === 0 ? new Color(0.13, 0.2, 0.25) : new Color(0.23, 0.34, 0.4);
    const material = new MeshBasicMaterial({ color: base.clone(), transparent: true, opacity: 0.22, depthWrite: false, side: DoubleSide });
    const materials = [material];
    const puffs = 4 + (index % 3);
    for (let puff = 0; puff < puffs; puff += 1) {
      const cloud = new Mesh(new SphereGeometry(4.5 + random() * 5.8, 8, 5), material);
      cloud.position.set((random() - 0.5) * 20, (random() - 0.5) * 8, (random() - 0.5) * 6);
      cloud.scale.set(1.25 + random() * 0.8, 0.46 + random() * 0.25, 0.62 + random() * 0.3);
      group.add(cloud);
    }
    clouds.push({ group, u, materials, base });
  }
  return clouds;
}

function createCloudDeck(curve: ReturnType<typeof createSkyhookV01uRail>) {
  const frame = sampleRailFrame(curve, 0.34);
  const group = new Group();
  group.name = 'cloud-deck-ring';
  group.position.copy(frame.position);
  group.quaternion.copy(frameQuaternion(frame));
  const deck = new Mesh(new TorusGeometry(34, 4.2, 8, 48), new MeshBasicMaterial({ color: new Color(0.42, 0.58, 0.64), transparent: true, opacity: 0.3, depthWrite: false, side: DoubleSide }));
  group.add(deck);
  return group;
}

function createDebris(curve: ReturnType<typeof createSkyhookV01uRail>): ScatterField {
  return scatterAlongRail(curve, {
    count: 96,
    seed: 8117,
    window: { behind: 70, ahead: 190 },
    place(_index, random) {
      const angle = random() * Math.PI * 2;
      const radius = 22 + random() * 48;
      return {
        u: random(),
        offset: new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.68, (random() - 0.5) * 34),
      };
    },
    make(_index, random) {
      const geometry = new BoxGeometry(0.24 + random() * 0.5, 0.18 + random() * 0.34, 1.2 + random() * 4.4);
      const material = new MeshBasicMaterial({ color: random() < 0.16 ? HAZARD : PANEL_DARK, transparent: true, opacity: 0.3 + random() * 0.3 });
      return new Mesh(geometry, material);
    },
    onUpdate(item, dt) {
      item.object.rotation.x += dt * (1.2 + item.index % 4);
      item.object.rotation.z += dt * (0.6 + item.index % 3);
    },
  });
}

function createStars(curve: ReturnType<typeof createSkyhookV01uRail>) {
  const count = 330;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let seed = 901;
  const random = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 0x100000000;
  };
  for (let index = 0; index < count; index += 1) {
    const u = 0.37 + random() * 0.63;
    const frame = sampleRailFrame(curve, u);
    const angle = random() * Math.PI * 2;
    const radius = 58 + random() * 260;
    const point = frame.position
      .clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius)
      .addScaledVector(frame.tangent, (random() - 0.5) * 90);
    positions[index * 3] = point.x;
    positions[index * 3 + 1] = point.y;
    positions[index * 3 + 2] = point.z;
    const brightness = random() < 0.13 ? 1.35 : 0.42 + random() * 0.48;
    colors[index * 3] = STAR_WHITE.r * brightness;
    colors[index * 3 + 1] = STAR_WHITE.g * brightness;
    colors[index * 3 + 2] = STAR_WHITE.b * brightness;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial({ color: 0xffffff, size: 0.8, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.name = 'first-stars';
  return { points, material };
}

function createPlanet(curve: ReturnType<typeof createSkyhookV01uRail>) {
  const frame = sampleRailFrame(curve, 0.96);
  const root = new Group();
  root.name = 'planet-limb';
  root.position.copy(frame.position)
    .addScaledVector(frame.up, -285)
    .addScaledVector(frame.tangent, -36);
  const geometry = new SphereGeometry(255, 36, 20);
  const material = new MeshBasicMaterial({ color: PLANET_BLUE, transparent: true, opacity: 0, side: DoubleSide });
  root.add(new Mesh(geometry, material));
  const linesMaterial = new LineBasicMaterial({ color: PLANET_LINE, transparent: true, opacity: 0 });
  const lines = new LineSegments(new EdgesGeometry(geometry), linesMaterial);
  lines.scale.setScalar(1.002);
  root.add(lines);
  const rimMaterial = new MeshBasicMaterial({ color: new Color(0.18, 0.42, 0.46), transparent: true, opacity: 0, side: DoubleSide });
  const rim = new Mesh(new TorusGeometry(255, 1.4, 6, 72), rimMaterial);
  rim.rotation.x = Math.PI * 0.48;
  root.add(rim);
  return { root, material, linesMaterial, rimMaterial };
}

function createStation(curve: ReturnType<typeof createSkyhookV01uRail>): StationParts {
  const frame = sampleRailFrame(curve, 1);
  const root = new Group();
  root.name = 'station-docking-mouth';
  root.position.copy(frame.position).addScaledVector(frame.tangent, 22);
  root.quaternion.copy(frameQuaternion(frame));

  const dark = new MeshBasicMaterial({ color: new Color(0.004, 0.007, 0.012), side: DoubleSide });
  root.add(new Mesh(new BoxGeometry(30, 18, 2.2), dark));

  const frameMaterial = new MeshBasicMaterial({ color: PANEL });
  const beamLeft = new Mesh(new BoxGeometry(1.8, 19, 2.2), frameMaterial);
  beamLeft.position.x = -14;
  const beamRight = new Mesh(new BoxGeometry(1.8, 19, 2.2), frameMaterial);
  beamRight.position.x = 14;
  const beamTop = new Mesh(new BoxGeometry(29, 1.8, 2.2), frameMaterial);
  beamTop.position.y = 9;
  const beamBottom = new Mesh(new BoxGeometry(29, 1.8, 2.2), frameMaterial);
  beamBottom.position.y = -9;
  root.add(beamLeft, beamRight, beamTop, beamBottom);

  const doorMaterial = new MeshBasicMaterial({ color: PANEL_DARK });
  const leftDoor = new Mesh(new BoxGeometry(9.4, 14.6, 1.1), doorMaterial);
  leftDoor.position.set(-4.7, 0, -1.2);
  const rightDoor = new Mesh(new BoxGeometry(9.4, 14.6, 1.1), doorMaterial.clone());
  rightDoor.position.set(4.7, 0, -1.2);
  root.add(leftDoor, rightDoor);

  const hazardMaterial = new MeshBasicMaterial({ color: HAZARD_HOT });
  const stripes = new Mesh(new BoxGeometry(25, 0.48, 2.5), hazardMaterial);
  stripes.position.y = 7.45;
  const stripeBottom = new Mesh(new BoxGeometry(25, 0.48, 2.5), hazardMaterial.clone());
  stripeBottom.position.y = -7.45;
  root.add(stripes, stripeBottom);

  const halo = new Mesh(new TorusGeometry(14.7, 0.16, 6, 48), new MeshBasicMaterial({ color: HAZARD_HOT, transparent: true, opacity: 0.24, side: DoubleSide }));
  halo.position.z = -2.4;
  root.add(halo);
  const lights: Mesh[] = [];
  for (let index = 0; index < 6; index += 1) {
    const light = new Mesh(new SphereGeometry(0.23, 8, 5), new MeshBasicMaterial({ color: STAR_WHITE, transparent: true, opacity: 0.45 }));
    light.position.set(-10 + index * 4, index % 2 === 0 ? 6.2 : -6.2, -2.6);
    root.add(light);
    lights.push(light);
  }
  return { root, leftDoor, rightDoor, halo, lights };
}

function createCarriage() {
  const group = new Group();
  group.name = 'climber-car';
  const white = new MeshBasicMaterial({ color: PANEL });
  const dark = new MeshBasicMaterial({ color: PANEL_DARK });
  const orange = new MeshBasicMaterial({ color: HAZARD_HOT });
  const left = new Mesh(new BoxGeometry(0.48, 0.5, 4.8), white);
  left.position.set(-4.1, -2.35, -0.8);
  const right = new Mesh(new BoxGeometry(0.48, 0.5, 4.8), white);
  right.position.set(4.1, -2.35, -0.8);
  const lower = new Mesh(new BoxGeometry(8.6, 0.32, 1.1), dark);
  lower.position.set(0, -3.0, -1.0);
  const dash = new Mesh(new BoxGeometry(6.8, 0.13, 0.16), orange);
  dash.position.set(0, -2.8, 0.05);
  const center = new Mesh(new CylinderGeometry(0.16, 0.16, 3.7, 8), dark);
  center.rotation.z = Math.PI * 0.5;
  center.position.set(0, -1.9, -0.3);
  group.add(left, right, lower, dash, center);
  return group;
}

function createSpeedStreaks() {
  const group = new Group();
  group.name = 'near-air-streaks';
  const records: StreakRecord[] = [];
  let seed = 313;
  const random = () => {
    seed = (seed * 22695477 + 1) >>> 0;
    return seed / 0x100000000;
  };
  for (let index = 0; index < 72; index += 1) {
    const x = (random() - 0.5) * 28;
    const y = (random() - 0.5) * 20;
    const length = 0.8 + random() * 3.7;
    const line = new Line(
      new BufferGeometry().setFromPoints([new Vector3(x, y, 0), new Vector3(x, y, length)]),
      new LineBasicMaterial({ color: random() < 0.7 ? new Color(0.34, 0.51, 0.58) : HAZARD, transparent: true, opacity: 0.14 + random() * 0.2 }),
    );
    line.position.z = -54;
    group.add(line);
    records.push({ line, base: random() * 72, speed: 0.7 + random() * 1.5 });
  }
  return { group, records, phase: 0 };
}

function frameQuaternion(frame: { right: Vector3; up: Vector3; tangent: Vector3 }) {
  const matrix = new Matrix4().makeBasis(frame.right, frame.up, frame.tangent);
  return new Quaternion().setFromRotationMatrix(matrix);
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = clamp01((value - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}
