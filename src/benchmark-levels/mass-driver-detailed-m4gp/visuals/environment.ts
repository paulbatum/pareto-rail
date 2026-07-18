import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  InstancedMesh,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { attribute, float, mix, positionLocal, positionWorld, smoothstep, uniform, vec3 } from 'three/tsl';
import { createAtmosphereRamp, scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { createMassDriverRail, massDriverRunProgress, MUZZLE_U, speedFactorAt } from '../gameplay';
import { INTERLOCK_TIME, RING_BEATS, ringBeatTime, SHOT_TIME } from '../timing';
import {
  ARC_BLUE,
  BLINDING,
  GUNMETAL,
  heatColor,
  hdr,
  ION_WHITE,
  mulberry32,
  VOID,
  VOLT_VIOLET,
  type Rng,
} from './palette';

// Shared shader knobs, written by the runtime every frame.
export const beatUniform = uniform(0); // beat energy 0..~1.6
export const streakOffsetUniform = uniform(0); // accumulated travel distance
export const streakGlowUniform = uniform(0.12); // streak brightness by section

const STREAK_SPAN = 60;
const STREAK_BACK = 50;

export type EnvUpdateContext = {
  camera: PerspectiveCamera;
  runTime: number;
  running: boolean;
  elapsed: number;
  beatEnergy: number;
  onRingPass?: (ringIndex: number, position: Vector3, isDownbeat: boolean) => void;
};

export type MassDriverEnvironment = {
  root: Group;
  muzzlePosition: Vector3;
  update(dt: number, ctx: EnvUpdateContext): void;
  /** Full-tunnel white strobe sweep: the interlocks are down, the gun is committed. */
  strobeRings(): void;
  reset(): void;
};

const scratchMatrix = new Matrix4();
const scratchQuat = new Quaternion();
const scratchColor = new Color();
const scratchColorB = new Color();
const WHITE = new Color(1, 1, 1);

export function createEnvironmentInternal(scene: Scene): MassDriverEnvironment {
  const root = new Group();
  const curve = createMassDriverRail();
  const rng = mulberry32(0x4d417);

  scene.background = VOID.clone();
  scene.fog = new FogExp2(VOID.clone().multiplyScalar(1.6).getHex(), 0.021);

  const muzzleFrame = sampleRailFrame(curve, MUZZLE_U);
  const muzzlePosition = muzzleFrame.position.clone();

  const rings = createRings(curve);
  root.add(rings.group);

  root.add(createConductorRails(curve));
  const wall = createBarrelWall(curve, rng);
  root.add(wall.group);

  const streaks = createSpeedStreaks(rng);
  root.add(streaks);

  const { group: muzzleField, beacon } = createMuzzleField(curve, muzzlePosition, rng);
  root.add(muzzleField);

  const chargeGlow = createChargeGlow();
  root.add(chargeGlow);

  scene.add(root);

  // Atmosphere is keyed on run progress (the same u the rings sit on): the void
  // warms from blue-black toward violet, whitens as the charge builds through
  // the interlock bars, then cuts to near-vacuum black once past the muzzle.
  const interlockU = massDriverRunProgress(INTERLOCK_TIME);
  const chargeU = MUZZLE_U - 0.02;
  const applyAtmosphere = createAtmosphereRamp(scene, [
    { progress: 0, background: VOID, fog: VOID.clone().multiplyScalar(1.7), density: 0.022 },
    { progress: interlockU * 0.6, background: new Color(0.02, 0.014, 0.04), fog: new Color(0.05, 0.03, 0.11), density: 0.02 },
    { progress: interlockU, background: new Color(0.05, 0.03, 0.1), fog: new Color(0.12, 0.07, 0.2), density: 0.022 },
    { progress: chargeU, background: new Color(0.11, 0.08, 0.18), fog: new Color(0.3, 0.24, 0.42), density: 0.028 },
    { progress: MUZZLE_U, background: new Color(0, 0, 0), fog: new Color(0, 0, 0), density: 0.0006 },
    { progress: 1, background: new Color(0, 0, 0), fog: new Color(0, 0, 0), density: 0.0006 },
  ]);

  let strobeTimer = 0;

  const environment: MassDriverEnvironment = {
    root,
    muzzlePosition,
    strobeRings() {
      strobeTimer = 0.7;
    },
    reset() {
      rings.reset();
      strobeTimer = 0;
      streakOffsetUniform.value = 0;
      applyAtmosphere(0);
    },
    update(dt, ctx) {
      const camera = ctx.camera;
      const cameraU = ctx.running ? massDriverRunProgress(ctx.runTime) : 0;
      const speed = ctx.running ? speedFactorAt(ctx.runTime) : 0.5;
      beatUniform.value = ctx.beatEnergy;

      strobeTimer = Math.max(0, strobeTimer - dt);
      const charge = ctx.running
        ? MathUtils.clamp((ctx.runTime - INTERLOCK_TIME) / Math.max(0.001, SHOT_TIME - INTERLOCK_TIME), 0, 1)
        : 0;
      const pastMuzzle = ctx.running && ctx.runTime >= SHOT_TIME;

      applyAtmosphere(cameraU);
      rings.update(dt, {
        cameraU,
        running: ctx.running,
        elapsed: ctx.elapsed,
        charge,
        strobe: strobeTimer > 0 ? strobeTimer / 0.7 : 0,
        pastMuzzle,
        onRingPass: ctx.onRingPass,
      });

      // Speed streaks ride the camera; scroll rate is the felt airspeed, so the
      // ~3× post-shot surge visibly slams them on.
      streaks.position.copy(camera.position);
      streaks.quaternion.copy(camera.quaternion);
      streakOffsetUniform.value = (streakOffsetUniform.value + dt * speed * 30) % 100000;
      const glowTarget = !ctx.running ? 0.06 : pastMuzzle ? 1.4 : 0.12 + charge * 0.35 + (speed - 0.5) * 0.16;
      streakGlowUniform.value += (glowTarget - streakGlowUniform.value) * Math.min(1, dt * 3);

      // Charge glow: a white-hot disc growing far down the bore as the gun spools.
      chargeGlow.position.copy(muzzlePosition);
      chargeGlow.quaternion.copy(camera.quaternion);
      const glow = pastMuzzle ? 0 : charge;
      chargeGlow.visible = glow > 0.01;
      if (chargeGlow.visible) {
        // Cap the disc's angular size as the camera closes on the muzzle: the
        // last interlocks must stay visible against it, and the true whiteout
        // belongs to the shot flash, not the buildup.
        const distanceToMuzzle = camera.position.distanceTo(muzzlePosition);
        chargeGlow.scale.setScalar(Math.min(6 + glow * glow * 22, Math.max(4, distanceToMuzzle * 0.3)));
        (chargeGlow.material as MeshBasicMaterial).color.copy(BLINDING).multiplyScalar(glow ** 3 * 1.2);
      }

      // The muzzle beacon slowly pulses; it only surfaces once the fog clears.
      const beaconPulse = 1.4 + Math.sin(ctx.elapsed * 1.7) * 0.4;
      (beacon.material as MeshBasicMaterial).color.copy(ION_WHITE).multiplyScalar(beaconPulse);
    },
  };

  return environment;
}

// ---- accelerator rings (the level's soul) -----------------------------------

type RingUpdateContext = {
  cameraU: number;
  running: boolean;
  elapsed: number;
  charge: number;
  strobe: number;
  pastMuzzle: boolean;
  onRingPass?: (ringIndex: number, position: Vector3, isDownbeat: boolean) => void;
};

function createRings(curve: CatmullRomCurve3) {
  const group = new Group();
  const count = RING_BEATS;

  const ringU: number[] = [];
  const ringPos: Vector3[] = [];
  const ringHeat: Color[] = [];
  const ringDown: boolean[] = [];
  const boost = new Float32Array(count);

  const bodyMesh = new InstancedMesh(
    new TorusGeometry(11, 0.16, 8, 40),
    new MeshBasicMaterial({ color: 0xffffff }),
    count,
  );
  const rimMesh = new InstancedMesh(
    new TorusGeometry(11, 0.05, 6, 40),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    count,
  );
  bodyMesh.frustumCulled = false;
  rimMesh.frustumCulled = false;
  bodyMesh.name = 'ring-body';
  rimMesh.name = 'ring-rim';
  // A 0.3-unit ring wire cannot meaningfully hide a target; a center-point
  // occlusion ray through it would claim otherwise. Lugs and wall still count.
  bodyMesh.userData.raildIgnoreOcclusion = true;
  rimMesh.userData.raildIgnoreOcclusion = true;

  // Coil-housing lugs bolted onto the downbeat rings — four per ring.
  const downbeatIndices: number[] = [];
  for (let b = 0; b < count; b += 1) if (b % 4 === 0) downbeatIndices.push(b);
  const lugMesh = new InstancedMesh(
    new BoxGeometry(1.4, 0.9, 0.7),
    new MeshBasicMaterial({ color: 0xffffff }),
    downbeatIndices.length * 4,
  );
  lugMesh.frustumCulled = false;
  lugMesh.name = 'ring-lug';

  let lugCursor = 0;
  for (let b = 0; b < count; b += 1) {
    const u = massDriverRunProgress(ringBeatTime(b));
    const frame = sampleRailFrame(curve, u);
    const down = b % 4 === 0;
    ringU.push(u);
    ringPos.push(frame.position.clone());
    ringHeat.push(heatColor(b / (count - 1)).clone());
    ringDown.push(down);

    scratchMatrix.makeBasis(frame.right, frame.up, frame.tangent);
    scratchQuat.setFromRotationMatrix(scratchMatrix);
    const ringScale = down ? 1.05 : 1;
    scratchMatrix.compose(frame.position, scratchQuat, new Vector3(ringScale, ringScale, down ? 1.7 : 1));
    bodyMesh.setMatrixAt(b, scratchMatrix);
    rimMesh.setMatrixAt(b, scratchMatrix);

    if (down) {
      for (let k = 0; k < 4; k += 1) {
        const angle = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const lugPos = frame.position
          .clone()
          .addScaledVector(frame.right, Math.cos(angle) * 11)
          .addScaledVector(frame.up, Math.sin(angle) * 11);
        const lugQuat = scratchQuat.clone();
        scratchMatrix.compose(lugPos, lugQuat, new Vector3(1, 1, 1));
        lugMesh.setMatrixAt(lugCursor, scratchMatrix);
        const lugColor = ringHeat[b].clone().multiplyScalar(0.5);
        lugMesh.setColorAt(lugCursor, lugColor);
        lugCursor += 1;
      }
    }
  }
  bodyMesh.instanceMatrix.needsUpdate = true;
  rimMesh.instanceMatrix.needsUpdate = true;
  lugMesh.instanceMatrix.needsUpdate = true;
  if (lugMesh.instanceColor) lugMesh.instanceColor.needsUpdate = true;

  group.add(bodyMesh, rimMesh, lugMesh);

  let lastPassed = -1;

  const setColors = (ctx: RingUpdateContext) => {
    const aheadIndex = lastPassed + 1;
    for (let b = 0; b < count; b += 1) {
      scratchColor.copy(ringHeat[b]);
      // Charge strobe: rings ahead of the camera run hotter toward white as the
      // firing charge peaks through the interlock bars.
      if (ctx.running && ctx.charge > 0 && b >= aheadIndex) {
        scratchColor.lerp(WHITE, ctx.charge * 0.55);
      }
      // Full-tunnel strobe sweep on the commit.
      if (ctx.strobe > 0) scratchColor.lerp(WHITE, ctx.strobe * 0.9);

      const idle = ctx.running ? 1 : 0.5 + 0.12 * Math.sin(ctx.elapsed * 1.6 + b * 0.5);
      const b0 = boost[b];
      scratchColorB.copy(scratchColor).multiplyScalar((0.42 + b0 * 0.5) * idle);
      bodyMesh.setColorAt(b, scratchColorB);
      scratchColorB.copy(scratchColor).multiplyScalar((1.25 + b0 * 2.4) * idle);
      rimMesh.setColorAt(b, scratchColorB);
    }
    if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
    if (rimMesh.instanceColor) rimMesh.instanceColor.needsUpdate = true;
  };

  return {
    group,
    reset() {
      lastPassed = -1;
      boost.fill(0);
      group.visible = true;
    },
    update(dt: number, ctx: RingUpdateContext) {
      group.visible = !ctx.pastMuzzle;
      if (ctx.pastMuzzle) return;

      // Ring crossings: one per beat by construction. Flash the just-passed ring
      // and pre-glow the next one down the bore.
      if (ctx.running) {
        while (lastPassed < count - 1 && ringU[lastPassed + 1] <= ctx.cameraU) {
          lastPassed += 1;
          boost[lastPassed] = 1;
          ctx.onRingPass?.(lastPassed, ringPos[lastPassed], ringDown[lastPassed]);
          if (lastPassed + 1 < count) boost[lastPassed + 1] = Math.max(boost[lastPassed + 1], 0.45);
        }
      } else if (lastPassed !== -1) {
        lastPassed = -1;
        boost.fill(0);
      }

      for (let b = 0; b < count; b += 1) boost[b] = Math.max(0, boost[b] - dt * 3.2);
      setColors(ctx);
    },
  };
}

// ---- conductor rails --------------------------------------------------------

// Four thin HDR tubes running the barrel at the ±45° diagonals: the actual
// railgun rails, blue → violet down the bore. A strong speed cue.
function createConductorRails(curve: CatmullRomCurve3) {
  const group = new Group();
  const barrelLength = 1600 * MUZZLE_U;
  const material = new MeshBasicNodeMaterial(additiveMaterialParameters({}));
  const t = smoothstep(float(0), float(barrelLength), positionWorld.z.negate());
  material.colorNode = mix(vec3(ARC_BLUE.r, ARC_BLUE.g, ARC_BLUE.b), vec3(VOLT_VIOLET.r, VOLT_VIOLET.g, VOLT_VIOLET.b), t)
    .mul(1.25)
    .mul(beatUniform.mul(0.25).add(1));

  for (const baseAngle of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    const points: Vector3[] = [];
    const SEGMENTS = 90;
    for (let i = 0; i <= SEGMENTS; i += 1) {
      const u = (MUZZLE_U * i) / SEGMENTS;
      const frame = sampleRailFrame(curve, u);
      points.push(
        frame.position
          .clone()
          .addScaledVector(frame.right, Math.cos(baseAngle) * 10.4)
          .addScaledVector(frame.up, Math.sin(baseAngle) * 10.4),
      );
    }
    const railCurve = new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
    const tube = new TubeGeometry(railCurve, 240, 0.09, 6, false);
    const mesh = new Mesh(tube, material);
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return group;
}

// ---- barrel wall ------------------------------------------------------------

// Dark faceted rib panels tiled around the bore at radius ~12.5, recycled along
// the rail as the camera advances. A few carry a dim blue service light.
function createBarrelWall(curve: CatmullRomCurve3, rng: Rng) {
  const angles: number[] = [];
  const wallMaterial = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(0.45) });
  const lightMaterial = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 0.7) });
  const ribGeometry = new BoxGeometry(0.6, 2.4, 7);
  const lightGeometry = new SphereGeometry(0.16, 6, 5);

  const field = scatterAlongRail(curve, {
    count: 64,
    seed: 0x2b17,
    rng,
    window: { behind: 60, ahead: 90 },
    alignToRail: true,
    make(index, makeRng) {
      const angle = makeRng() * Math.PI * 2;
      angles[index] = angle;
      const rib = new Mesh(ribGeometry, wallMaterial);
      rib.name = 'wall-rib';
      rib.rotation.z = angle; // lie tangent to the bore wall
      if (makeRng() < 0.28) {
        const light = new Mesh(lightGeometry, lightMaterial);
        light.position.set(0, -1.4, 0);
        rib.add(light);
      }
      return rib;
    },
    place(index, placeRng) {
      const angle = angles[index];
      // Outside the threaders' widest reach (~13.6) so drones weave in front of
      // the wall instead of winking out behind it.
      const radius = 14.6 + placeRng() * 0.9;
      const u = placeRng();
      return {
        u,
        offset: new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0),
      };
    },
  });
  return { group: field.group, field };
}

// ---- muzzle field: open space past the barrel -------------------------------

function createMuzzleField(curve: CatmullRomCurve3, muzzlePosition: Vector3, rng: Rng) {
  const group = new Group();

  // A deep starfield spanning the open space beyond the muzzle. Hidden by fog
  // until the density cuts on the shot, then it's all that's out there.
  const count = 1400;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const endFrame = sampleRailFrame(curve, 1);
  for (let i = 0; i < count; i += 1) {
    const along = rng();
    const center = muzzlePosition.clone().lerp(endFrame.position, along).addScaledVector(new Vector3(0, 0, -1), rng() * 900);
    const point = center
      .add(new Vector3((rng() - 0.5) * 900, (rng() - 0.5) * 700, (rng() - 0.5) * 300));
    positions[i * 3] = point.x;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z;
    const roll = rng();
    const base = roll < 0.7 ? ION_WHITE : roll < 0.88 ? ARC_BLUE : VOLT_VIOLET;
    const intensity = rng() < 0.06 ? 1.6 : 0.25 + rng() * 0.5;
    colors[i * 3] = base.r * intensity;
    colors[i * 3 + 1] = base.g * intensity;
    colors[i * 3 + 2] = base.b * intensity;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const starMaterial = new PointsMaterial(additiveMaterialParameters({ size: 1.1, vertexColors: true, sizeAttenuation: true }));
  const stars = new Points(geometry, starMaterial);
  stars.frustumCulled = false;
  group.add(stars);

  // Thin star-streak sprites: the felt speed of the muzzle exit against the void.
  group.add(createStarStreaks(muzzlePosition, endFrame.position, rng));

  // One distant beacon dead ahead — the thing you were launched toward.
  const beacon = new Mesh(new SphereGeometry(2.4, 12, 10), new MeshBasicMaterial({ color: hdr(ION_WHITE, 1.4) }));
  beacon.position.copy(endFrame.position).addScaledVector(new Vector3(0, 0, -1), 1600).add(new Vector3(60, 120, 0));
  group.add(beacon);

  return { group, beacon };
}

function createStarStreaks(from: Vector3, to: Vector3, rng: Rng) {
  const positions: number[] = [];
  const colors: number[] = [];
  const COUNT = 120;
  for (let i = 0; i < COUNT; i += 1) {
    const base = from.clone().lerp(to, rng()).addScaledVector(new Vector3(0, 0, -1), rng() * 1400);
    base.add(new Vector3((rng() - 0.5) * 700, (rng() - 0.5) * 520, 0));
    const length = 6 + rng() * 26;
    const tail = base.clone().add(new Vector3(0, 0, length));
    const color = (rng() < 0.75 ? ION_WHITE : ARC_BLUE).clone().multiplyScalar(0.4 + rng() * 0.6);
    positions.push(base.x, base.y, base.z, tail.x, tail.y, tail.z);
    for (let k = 0; k < 2; k += 1) colors.push(color.r, color.g, color.b);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  material.colorNode = attribute<'vec3'>('color', 'vec3');
  const streaks = new LineSegments(geometry, material);
  streaks.frustumCulled = false;
  return streaks;
}

// ---- camera-attached speed streaks ------------------------------------------

function createSpeedStreaks(rng: Rng) {
  const COUNT = 260;
  const positions: number[] = [];
  const z0: number[] = [];
  const dz: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 3 + rng() * 9;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const start = rng() * STREAK_SPAN;
    const length = 3 + rng() * 6;
    const color = (rng() < 0.6 ? ARC_BLUE : rng() < 0.85 ? VOLT_VIOLET : ION_WHITE).clone().multiplyScalar(0.25 + rng() * 0.5);
    for (const delta of [0, length]) {
      positions.push(x, y, 0);
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
  const wrapped = attribute<'float'>('z0', 'float').add(streakOffsetUniform).mod(STREAK_SPAN).sub(STREAK_BACK);
  material.positionNode = vec3(positionLocal.x, positionLocal.y, wrapped.add(attribute<'float'>('dz', 'float')));
  const envelope = smoothstep(float(-STREAK_BACK), float(-STREAK_BACK + 12), wrapped).mul(
    smoothstep(float(STREAK_SPAN - STREAK_BACK), float(STREAK_SPAN - STREAK_BACK - 8), wrapped),
  );
  material.colorNode = attribute<'vec3'>('color', 'vec3').mul(envelope).mul(streakGlowUniform);

  const streaks = new LineSegments(geometry, material);
  streaks.frustumCulled = false;
  const group = new Group();
  group.add(streaks);
  return group;
}

// ---- charge glow ------------------------------------------------------------

function createChargeGlow() {
  const mesh = new Mesh(
    new CircleGeometry(1, 32),
    createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }),
  );
  mesh.visible = false;
  return mesh;
}
