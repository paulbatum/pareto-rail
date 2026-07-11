import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  TorusGeometry,
  Vector3,
} from 'three';
import { LineBasicNodeMaterial } from 'three/webgpu';
import { attribute, float, positionLocal, smoothstep, uniform, vec3 } from 'three/tsl';
import { offsetFromRail, sampleRailFrame } from '../../../engine/rail';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  CANAL_TIME,
  createDownpourRail,
  HUNT_TIME,
  railU,
  SUMMIT_TIME,
  UNDERCITY_TIME,
} from '../gameplay';
import { AMBER, CYAN, HAZARD, hdr, INK, MAGENTA, MOON, mulberry32, RAIN_GREY, SLATE } from './palette';

// Shared shader/runtime knobs, written by the spine every frame.
export const beatUniform = uniform(0); // beat energy 0..1.5 — subtle signage pulse
export const rainOffsetUniform = uniform(0); // rain streak scroll (advanced by dt*speed)
export const rainGlowUniform = uniform(0.3); // rain streak brightness
export const lightningUniform = uniform(0); // 0..1.2 — cloud + skyline flash brightness

const RAIN_SPAN = 72;
const RAIN_BACK = 36;

type Train = { group: Group; u: number; side: number; speed: number; uMin: number; uMax: number };
type Searchlight = { pivot: Group; phase: number; speed: number };
type FlashMaterial = { material: MeshBasicMaterial; base: Color; gain: number };

export type Environment = {
  root: Group;
  rain: Group; // spine copies the camera transform onto this so rain rides the eye
  update(u: number, dt: number, elapsed: number, speed: number, running: boolean): void;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  const root = new Group();
  const rng = mulberry32(20260710);
  const curve = createDownpourRail();

  const rain = createRain(rng);
  rain.name = 'rain';
  rain.userData.raildIgnoreOcclusion = true;

  const flashMaterials: FlashMaterial[] = [];
  const signageMaterials: MeshBasicMaterial[] = [];

  const ceiling = createStormCeiling(rng, curve, flashMaterials);
  root.add(ceiling);

  root.add(createTowers(rng, curve, signageMaterials));
  root.add(createSkyways(rng, curve));

  const { group: undercity, trains } = createUndercity(curve);
  root.add(undercity);

  root.add(createCanal(curve));

  const { group: citadel, searchlights, strobes } = createCitadel(curve);
  root.add(citadel);

  root.add(createSkylineSilhouette(flashMaterials));

  scene.add(root);

  const scratch = new Vector3();

  return {
    root,
    rain,
    update(_u, dt, elapsed, _speed, running) {
      // --- clouds + distant skyline brighten from inside on each lightning flash
      const flash = lightningUniform.value;
      for (const fm of flashMaterials) {
        fm.material.color.copy(fm.base).multiplyScalar(1 + flash * fm.gain);
      }

      // --- signage breathes subtly with the beat
      const pulse = 1 + Math.min(1.5, beatUniform.value) * 0.22;
      for (const material of signageMaterials) {
        material.color.copy(material.userData.base as Color).multiplyScalar(pulse);
      }

      // --- undercity trains scream past against the flight direction, looping
      for (const train of trains) {
        if (running) train.u -= train.speed * dt;
        if (train.u < train.uMin) train.u += train.uMax - train.uMin;
        const frame = sampleRailFrame(curve, Math.min(0.999, Math.max(0.001, train.u)));
        train.group.position
          .copy(frame.position)
          .addScaledVector(frame.right, train.side)
          .addScaledVector(frame.up, -3.5);
        train.group.quaternion.setFromRotationMatrix(
          new Matrix4().makeBasis(frame.right, frame.up, frame.tangent),
        );
      }

      // --- citadel searchlights sweep slowly
      for (const light of searchlights) {
        light.pivot.rotation.y = Math.sin(elapsed * light.speed + light.phase) * 1.2;
      }

      // --- hazard strobe rings flicker on the beat
      const strobe = 0.5 + 0.5 * Math.sin(elapsed * 9) + beatUniform.value * 0.3;
      for (const ring of strobes) {
        (ring.material as MeshBasicMaterial).color.copy(ring.userData.base as Color).multiplyScalar(0.4 + strobe * 0.7);
      }

      void scratch;
    },
  };
}

// ---- 1. rain ----------------------------------------------------------------

// A camera-riding field of thin near-vertical streaks (slight slant) scrolling
// downward via rainOffsetUniform, dimmed by rainGlowUniform. Kept dim and thin
// so it never whites out.
function createRain(rng: () => number): Group {
  const COUNT = 400;
  const positions: number[] = [];
  const y0: number[] = [];
  const dy: number[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 4 + rng() * 26;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius - 6; // bias ahead of the eye
    const start = rng() * RAIN_SPAN;
    const length = 2.2 + rng() * 3.4;
    const slant = 0.35 + rng() * 0.3; // gentle lean off vertical
    // bottom vertex, then top vertex (leaning in +x): baked slant is static,
    // only y scrolls.
    positions.push(x, 0, z);
    y0.push(start);
    dy.push(0);
    positions.push(x + slant, 0, z);
    y0.push(start);
    dy.push(length);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('y0', new Float32BufferAttribute(y0, 1));
  geometry.setAttribute('dy', new Float32BufferAttribute(dy, 1));

  const material = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  const wrapped = attribute<'float'>('y0', 'float')
    .sub(rainOffsetUniform)
    .mod(RAIN_SPAN)
    .sub(RAIN_BACK);
  material.positionNode = vec3(
    positionLocal.x,
    wrapped.add(attribute<'float'>('dy', 'float')),
    positionLocal.z,
  );
  const envelope = smoothstep(float(-RAIN_BACK), float(-RAIN_BACK + 8), wrapped).mul(
    smoothstep(float(RAIN_SPAN - RAIN_BACK), float(RAIN_SPAN - RAIN_BACK - 6), wrapped),
  );
  material.colorNode = vec3(RAIN_GREY.r, RAIN_GREY.g, RAIN_GREY.b).mul(envelope).mul(rainGlowUniform);

  const streaks = new LineSegments(geometry, material);
  streaks.frustumCulled = false;
  const group = new Group();
  group.add(streaks);
  return group;
}

// ---- 2. storm ceiling + moon ------------------------------------------------

function createStormCeiling(
  rng: () => number,
  curve: ReturnType<typeof createDownpourRail>,
  flash: FlashMaterial[],
): Group {
  const group = new Group();
  const discGeometry = new CircleGeometry(1, 20);

  const addDeck = (uRange: [number, number], height: number, count: number, tint: Color, gain: number) => {
    for (let i = 0; i < count; i += 1) {
      const u = uRange[0] + (uRange[1] - uRange[0]) * rng();
      const frame = sampleRailFrame(curve, u);
      const base = tint.clone().multiplyScalar(0.2 + rng() * 0.18);
      const material = new MeshBasicMaterial({ color: base.clone(), transparent: true, opacity: 0.9, depthWrite: false });
      const disc = new Mesh(discGeometry, material);
      disc.name = 'cloud';
      disc.position
        .copy(frame.position)
        .addScaledVector(frame.right, (rng() - 0.5) * 240)
        .addScaledVector(frame.tangent, (rng() - 0.5) * 160);
      disc.position.y = height + (rng() - 0.5) * 12;
      disc.rotation.x = -Math.PI / 2 + (rng() - 0.5) * 0.3;
      disc.scale.setScalar(45 + rng() * 70);
      group.add(disc);
      flash.push({ material, base: base.clone(), gain });
    }
  };

  // Dark cloud deck above the towers near the start...
  addDeck([0, 0.2], 150, 26, SLATE, 2.6);
  // ...and a lower cloud floor around y≈95 for the summit climb.
  addDeck([0.85, 1], 96, 20, SLATE, 2.2);

  // Big pale moon disc high near the end of the rail — moonlit release.
  const summitFrame = sampleRailFrame(curve, 0.97);
  const moonMaterial = new MeshBasicMaterial({ color: hdr(MOON, 0.62), transparent: true, opacity: 0.95, depthWrite: false });
  const moon = new Mesh(discGeometry, moonMaterial);
  moon.name = 'moon';
  moon.userData.raildIgnoreOcclusion = true;
  moon.position
    .copy(summitFrame.position)
    .addScaledVector(summitFrame.right, -70)
    .add(new Vector3(0, 60, -260));
  moon.scale.setScalar(32);
  moon.lookAt(summitFrame.position);
  group.add(moon);

  return group;
}

// ---- 3. towers + windows + billboards --------------------------------------

function createTowers(
  rng: () => number,
  curve: ReturnType<typeof createDownpourRail>,
  signage: MeshBasicMaterial[],
): Group {
  const group = new Group();

  const towerMatrices: Matrix4[] = [];
  const windowMatrices: Matrix4[] = [];
  const windowColors: Color[] = [];
  const scratchQuat = new Quaternion();
  const up = new Vector3(0, 1, 0);

  const pushWindows = (center: Vector3, right: Vector3, height: number, width: number, quat: Quaternion, near: boolean) => {
    const cols = 3 + Math.floor(rng() * 3);
    const rows = Math.floor(height / 7);
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (rng() < (near ? 0.45 : 0.75)) continue; // most windows dark
        const roll = rng();
        const color = (roll < 0.45 ? CYAN : roll < 0.85 ? MAGENTA : AMBER).clone().multiplyScalar(near ? 0.9 : 0.5);
        const local = new Vector3(
          (c / (cols - 1) - 0.5) * width * 0.8,
          (r / Math.max(1, rows - 1) - 0.5) * height * 0.9,
          0,
        );
        const pos = center.clone().add(local.applyQuaternion(quat));
        const m = new Matrix4().compose(pos, quat, new Vector3(0.7, 1.4, 0.7));
        windowMatrices.push(m);
        windowColors.push(color);
        void right;
      }
    }
  };

  // Dense skyline along the whole midsection; canyon slice comes close.
  const COUNT = 120;
  for (let i = 0; i < COUNT; i += 1) {
    const u = 0.1 + (0.75 - 0.1) * (i / (COUNT - 1)) + (rng() - 0.5) * 0.02;
    const frame = sampleRailFrame(curve, u);
    const side = rng() < 0.5 ? -1 : 1;
    const canyon = u > 0.24 && u < 0.42;
    // Canyon walls slide past within ~15–25 units; elsewhere they recede.
    const dist = canyon ? 26 + rng() * 8 : 32 + rng() * 130;
    const width = canyon ? 10 + rng() * 8 : 12 + rng() * 26;
    const height = 60 + rng() * 160;
    const facing = frame.right.clone().multiplyScalar(-side); // face toward the rail
    const pos = frame.position
      .clone()
      .addScaledVector(frame.right, side * (dist + width * 0.5))
      .addScaledVector(frame.up, -height * 0.5 + (rng() - 0.5) * 30);
    scratchQuat.setFromUnitVectors(up, up); // upright boxes
    towerMatrices.push(new Matrix4().compose(pos, scratchQuat, new Vector3(width, height, width)));

    // Window face sits on the rail-facing side of the tower.
    const faceCenter = pos.clone().addScaledVector(facing, width * 0.5 + 0.2);
    const faceQuat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), facing);
    pushWindows(faceCenter, facing, height, width, faceQuat, canyon);
  }

  const towerMesh = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    new MeshBasicMaterial({ color: SLATE.clone().multiplyScalar(0.16) }),
    towerMatrices.length,
  );
  towerMesh.name = 'towers';
  towerMatrices.forEach((m, i) => towerMesh.setMatrixAt(i, m));
  towerMesh.instanceMatrix.needsUpdate = true;
  towerMesh.frustumCulled = false;
  group.add(towerMesh);

  const windowMesh = new InstancedMesh(
    new PlaneGeometry(1, 1),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    Math.max(1, windowMatrices.length),
  );
  windowMesh.name = 'windows';
  windowMatrices.forEach((m, i) => {
    windowMesh.setMatrixAt(i, m);
    windowMesh.setColorAt(i, windowColors[i]);
  });
  windowMesh.count = windowMatrices.length;
  windowMesh.instanceMatrix.needsUpdate = true;
  if (windowMesh.instanceColor) windowMesh.instanceColor.needsUpdate = true;
  windowMesh.frustumCulled = false;
  group.add(windowMesh);

  // A few big neon billboards angled toward the rail: thin additive frame over
  // a dim panel.
  for (let i = 0; i < 7; i += 1) {
    const u = 0.14 + rng() * 0.42;
    const frame = sampleRailFrame(curve, u);
    const side = rng() < 0.5 ? -1 : 1;
    const facing = frame.right.clone().multiplyScalar(-side);
    const neon = rng() < 0.5 ? CYAN : MAGENTA;
    const w = 16 + rng() * 14;
    const h = 9 + rng() * 8;
    const board = new Group();
    board.position
      .copy(frame.position)
      .addScaledVector(frame.right, side * (36 + rng() * 22))
      .addScaledVector(frame.up, 6 + rng() * 26);
    board.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), facing);
    board.rotateY((rng() - 0.5) * 0.4);

    const panel = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ color: neon.clone().multiplyScalar(0.12) }));
    panel.name = 'billboard';
    board.add(panel);
    const frameMat = createAdditiveBasicMaterial({ color: neon.clone().multiplyScalar(0.8) });
    frameMat.userData.base = neon.clone().multiplyScalar(0.8);
    signage.push(frameMat);
    const border = new Mesh(new PlaneGeometry(w * 1.04, 0.5), frameMat);
    border.position.y = h * 0.5;
    board.add(border);
    const border2 = new Mesh(new PlaneGeometry(w * 1.04, 0.5), frameMat);
    border2.position.y = -h * 0.5;
    board.add(border2);
    group.add(board);
  }

  return group;
}

// ---- 4. skyways / girders ---------------------------------------------------

function createSkyways(rng: () => number, curve: ReturnType<typeof createDownpourRail>): Group {
  const group = new Group();
  const matrices: Matrix4[] = [];
  const scratchQuat = new Quaternion();
  const up = new Vector3(0, 1, 0);

  // Horizontal beams crossing above/below the rail through plunge + canyon,
  // 6–12 units clear of the rail (rail x stays within ±16), never intersecting.
  const COUNT = 70;
  for (let i = 0; i < COUNT; i += 1) {
    const u = 0.12 + (0.46 - 0.12) * (i / (COUNT - 1)) + (rng() - 0.5) * 0.02;
    const frame = sampleRailFrame(curve, u);
    const above = rng() < 0.5;
    const clear = 6 + rng() * 6; // 6–12 units above/below
    const lift = above ? clear + 14 : -(clear + 14);
    const length = 70 + rng() * 60;
    const thick = 1.5 + rng() * 2.5;
    // beam runs along rail.right (crosses the flight path overhead/underneath)
    scratchQuat.setFromUnitVectors(up, up);
    const pos = frame.position.clone().addScaledVector(frame.up, lift).addScaledVector(frame.tangent, (rng() - 0.5) * 20);
    // orient beam long axis along world x-ish by aligning basis to rail
    const basis = new Matrix4().makeBasis(frame.right, frame.up, frame.tangent);
    scratchQuat.setFromRotationMatrix(basis);
    matrices.push(new Matrix4().compose(pos, scratchQuat, new Vector3(length, thick, thick)));
  }

  const mesh = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    new MeshBasicMaterial({ color: SLATE.clone().multiplyScalar(0.14) }),
    matrices.length,
  );
  mesh.name = 'skyways';
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  return group;
}

// ---- 5. undercity tunnel ----------------------------------------------------

function createUndercity(curve: ReturnType<typeof createDownpourRail>): { group: Group; trains: Train[] } {
  const group = new Group();
  const uStart = railU(UNDERCITY_TIME);
  const uEnd = railU(CANAL_TIME);

  // Rib cage: AMBER-edged arches every few units around the rail.
  const ARCHES = 44;
  const ribGeometry = new TorusGeometry(15, 0.32, 6, 20, Math.PI * 1.2);
  const ribMaterial = createAdditiveBasicMaterial({ color: AMBER.clone().multiplyScalar(0.26) });
  const lampMaterial = createAdditiveBasicMaterial({ color: AMBER.clone().multiplyScalar(0.7) });
  const lampGeometry = new CircleGeometry(0.4, 8);
  for (let i = 0; i < ARCHES; i += 1) {
    const u = uStart + (uEnd - uStart) * (i / (ARCHES - 1));
    const frame = sampleRailFrame(curve, u);
    const rib = new Mesh(ribGeometry, ribMaterial);
    rib.name = 'tunnel-rib';
    rib.position.copy(frame.position).addScaledVector(frame.up, -2);
    rib.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(frame.right, frame.up, frame.tangent));
    rib.rotateZ(Math.PI * 0.9); // open at the bottom
    group.add(rib);
    // dim sodium lamp dots on either side
    for (const side of [-1, 1]) {
      const lamp = new Mesh(lampGeometry, lampMaterial);
      lamp.position.copy(offsetFromRail(curve, u, new Vector3(side * 13, 6, 0)));
      lamp.quaternion.copy(rib.quaternion);
      group.add(lamp);
    }
  }

  // 2–3 trains: dark boxes carrying long lit AMBER window strips.
  const trains: Train[] = [];
  const trainSpecs = [
    { side: 14, speed: 0.05, len: 60 },
    { side: -15, speed: 0.06, len: 74 },
    { side: 13, speed: 0.045, len: 52 },
  ];
  for (let t = 0; t < trainSpecs.length; t += 1) {
    const spec = trainSpecs[t];
    const trainGroup = new Group();
    const body = new Mesh(
      new BoxGeometry(4, 5, spec.len),
      new MeshBasicMaterial({ color: INK.clone().multiplyScalar(1.4) }),
    );
    body.name = 'train';
    trainGroup.add(body);
    // Lit window strip running the length of the car, on the rail-facing side.
    const strip = new Mesh(
      new PlaneGeometry(spec.len, 1.2),
      createAdditiveBasicMaterial({ color: AMBER.clone().multiplyScalar(0.28) }),
    );
    strip.rotation.y = Math.PI / 2;
    strip.position.x = -Math.sign(spec.side) * 2.05;
    strip.position.y = 0.6;
    trainGroup.add(strip);
    group.add(trainGroup);
    trains.push({
      group: trainGroup,
      u: uStart + (uEnd - uStart) * (0.2 + 0.3 * t),
      side: spec.side,
      speed: spec.speed,
      uMin: uStart,
      uMax: uEnd,
    });
  }

  return { group, trains };
}

// ---- 6. canal ---------------------------------------------------------------

function createCanal(curve: ReturnType<typeof createDownpourRail>): Group {
  const group = new Group();
  const uStart = railU(CANAL_TIME);
  const uEnd = railU(HUNT_TIME);
  const mid = sampleRailFrame(curve, (uStart + uEnd) / 2);

  // Wide dark water plane slightly below the rail.
  const water = new Mesh(
    new PlaneGeometry(120, 320),
    new MeshBasicMaterial({ color: INK.clone().multiplyScalar(1.0) }),
  );
  water.name = 'water';
  water.rotation.x = -Math.PI / 2;
  water.position.copy(mid.position).addScaledVector(mid.up, -6);
  group.add(water);

  // Faint CYAN/MAGENTA specular streak lines on the water.
  for (let i = 0; i < 24; i += 1) {
    const u = uStart + (uEnd - uStart) * (i / 23);
    const frame = sampleRailFrame(curve, u);
    const color = i % 2 === 0 ? CYAN : MAGENTA;
    const streak = new Mesh(
      new PlaneGeometry(0.4, 8 + Math.random() * 14),
      createAdditiveBasicMaterial({ color: color.clone().multiplyScalar(0.35) }),
    );
    streak.rotation.x = -Math.PI / 2;
    streak.position.copy(frame.position).addScaledVector(frame.right, (Math.random() - 0.5) * 60).addScaledVector(frame.up, -5.9);
    group.add(streak);
  }

  // Embankment walls both sides + occasional AMBER lamp posts.
  const wallMaterial = new MeshBasicMaterial({ color: SLATE.clone().multiplyScalar(0.15) });
  const lampMaterial = createAdditiveBasicMaterial({ color: AMBER.clone().multiplyScalar(0.4) });
  for (const side of [-1, 1]) {
    for (let i = 0; i < 14; i += 1) {
      const u = uStart + (uEnd - uStart) * (i / 13);
      const wall = new Mesh(new BoxGeometry(6, 16, 30), wallMaterial);
      wall.name = 'canal-wall';
      wall.position.copy(offsetFromRail(curve, u, new Vector3(side * 34, -6, 0)));
      group.add(wall);
      if (i % 3 === 0) {
        const lamp = new Mesh(new CylinderGeometry(0.22, 0.22, 5, 6), lampMaterial);
        lamp.position.copy(offsetFromRail(curve, u, new Vector3(side * 30, 2, 0)));
        group.add(lamp);
      }
    }
  }

  return group;
}

// ---- 7. citadel -------------------------------------------------------------

function createCitadel(curve: ReturnType<typeof createDownpourRail>): {
  group: Group;
  searchlights: Searchlight[];
  strobes: Mesh[];
} {
  const group = new Group();
  const uStart = railU(HUNT_TIME);
  const uEnd = railU(SUMMIT_TIME);
  const base = sampleRailFrame(curve, (uStart + uEnd) / 2);

  // One massive dark tower the rail spirals up beside.
  const towerHeight = 260;
  const tower = new Mesh(
    new BoxGeometry(34, towerHeight, 34),
    new MeshBasicMaterial({ color: SLATE.clone().multiplyScalar(0.15) }),
  );
  const center = base.position.clone().addScaledVector(base.right, 46).addScaledVector(base.up, 20);
  tower.name = 'citadel-tower';
  tower.position.copy(center);
  group.add(tower);

  // HAZARD-white strobe rings at intervals up the mass.
  const strobes: Mesh[] = [];
  const ringGeometry = new TorusGeometry(20, 0.6, 6, 32);
  for (let i = 0; i < 7; i += 1) {
    const ringBase = HAZARD.clone().multiplyScalar(0.6);
    const material = createAdditiveBasicMaterial({ color: ringBase.clone() });
    const ring = new Mesh(ringGeometry, material);
    ring.userData.base = ringBase;
    ring.position.copy(center).add(new Vector3(0, -towerHeight * 0.4 + (towerHeight * 0.8 * i) / 6, 0));
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    strobes.push(ring);
  }

  // 2–3 slowly sweeping searchlight beams (long thin additive cones).
  const searchlights: Searchlight[] = [];
  for (let i = 0; i < 3; i += 1) {
    const pivot = new Group();
    pivot.position.copy(center).add(new Vector3(0, -towerHeight * 0.2 + i * 70, 0));
    const beam = new Mesh(
      new CylinderGeometry(0.5, 4.5, 130, 10, 1, true),
      createAdditiveBasicMaterial({ color: HAZARD.clone().multiplyScalar(0.1), opacity: 0.2, side: 2 }),
    );
    beam.position.z = 65;
    beam.rotation.x = Math.PI / 2;
    beam.raycast = () => {}; // translucent glow — never blocks aim or sight
    beam.userData.raildIgnoreOcclusion = true;
    pivot.add(beam);
    pivot.rotation.z = (i - 1) * 0.3;
    group.add(pivot);
    searchlights.push({ pivot, phase: i * 2.1, speed: 0.4 + i * 0.12 });
  }

  return { group, searchlights, strobes };
}

// ---- 8. distant skyline silhouette ------------------------------------------

// A very dark ring of distant towers so the horizon is never empty void. Reads
// darker than the sky and brightens faintly with lightning.
function createSkylineSilhouette(flash: FlashMaterial[]): Group {
  const group = new Group();
  const rng = mulberry32(99);
  const matrices: Matrix4[] = [];
  const quat = new Quaternion();
  // Centered on the rail's midpoint and wider than the whole run, so the
  // ring never crosses the flight path.
  const RADIUS = 1150;
  const CENTER = new Vector3(0, 0, -580);
  const COUNT = 160;
  for (let i = 0; i < COUNT; i += 1) {
    const angle = (i / COUNT) * Math.PI * 2 + (rng() - 0.5) * 0.05;
    const height = 120 + rng() * 340;
    const width = 30 + rng() * 60;
    const pos = new Vector3(CENTER.x + Math.cos(angle) * RADIUS, height * 0.5 - 40, CENTER.z + Math.sin(angle) * RADIUS);
    matrices.push(new Matrix4().compose(pos, quat, new Vector3(width, height, width)));
  }
  const base = INK.clone().multiplyScalar(2.2);
  const material = new MeshBasicMaterial({ color: base.clone() });
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, matrices.length);
  mesh.name = 'skyline';
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  flash.push({ material, base: base.clone(), gain: 0.8 });
  return group;
}
