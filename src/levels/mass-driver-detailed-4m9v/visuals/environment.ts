import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  Fog,
  Group,
  InstancedMesh,
  Line,
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
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LineBasicNodeMaterial } from 'three/webgpu';
import { attribute, float, mix, positionView, time, uniform, vec3 } from 'three/tsl';
import { sampleRailFrame } from '../../../engine/rail';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { BORE_RADIUS, createMassDriverRail, MUZZLE_U, railU } from '../gameplay';
import { MD_BEAT, RING_BEATS, SHOT_TIME } from '../timing';
import { ARC_BLUE, BLINDING, heatColor, hdr, ION_WHITE, mulberry32, VOID_BLUE, VOLT_VIOLET, type Rng } from './palette';

// Shared shader knobs, written by the runtime every frame.
export const beatUniform = uniform(0); // beat energy 0..~1.6
export const chargeUniform = uniform(0); // firing charge 0..1 through the interlock bars

const STREAK_SPAN = 64;
const STREAK_BACK = 56;
const streakOffsetUniform = uniform(0);
const streakGlowUniform = uniform(0.12);

const FOG_NEAR = 26;
const FOG_FAR_BARREL = 195;
const FOG_FAR_SPACE = 9000;

const BG_BREECH = VOID_BLUE.clone();
const BG_VIOLET = new Color(0.03, 0.014, 0.052);
const BG_CHARGE = new Color(0.1, 0.08, 0.15);
const BG_SPACE = new Color(0.0015, 0.002, 0.005);

export type EnvironmentUpdate = {
  scene: Scene;
  cameraPosition: Vector3;
  cameraQuaternion: Quaternion;
  elapsed: number;
  runTime: number;
  running: boolean;
  speedFactor: number;
  charge: number; // 0..1 firing charge through the interlock bars
  shotDone: boolean;
};

export type Environment = {
  root: Group;
  update(dt: number, ctx: EnvironmentUpdate): void;
  ringPosition(beat: number): Vector3;
  ringQuaternion(beat: number): Quaternion;
  muzzlePosition: Vector3;
  triggerStrobe(elapsed: number): void;
  reset(scene: Scene): void;
};

type RingRecord = {
  beat: number;
  base: Color;
  downbeat: boolean;
  position: Vector3;
  quaternion: Quaternion;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = BG_BREECH.clone();
  scene.fog = new Fog(BG_BREECH.clone(), FOG_NEAR, FOG_FAR_BARREL);

  const root = new Group();
  const rng = mulberry32(20260716);
  const curve = createMassDriverRail();
  const muzzleFrame = sampleRailFrame(curve, MUZZLE_U);
  const exitDirection = muzzleFrame.tangent.clone();

  // ---- accelerator rings: one per quarter-note beat --------------------------
  // Ring k sits exactly where the camera is at beat k, so every crossing lands
  // on a beat by construction. Downbeat rings are a touch larger and carry
  // four coil-housing lugs bolted at the diagonals.
  const rings: RingRecord[] = [];
  const scratchMatrix = new Matrix4();
  const scratchBasis = new Matrix4();
  const scratchColor = new Color();

  const bodyGeometry = new TorusGeometry(BORE_RADIUS, 0.26, 6, 42);
  const rimGeometry = new TorusGeometry(BORE_RADIUS + 0.02, 0.09, 4, 42);
  const bodyMesh = new InstancedMesh(bodyGeometry, new MeshBasicMaterial({ color: 0xffffff }), RING_BEATS);
  const rimMesh = new InstancedMesh(rimGeometry, createAdditiveBasicMaterial({ color: 0xffffff }), RING_BEATS);
  bodyMesh.frustumCulled = false;
  rimMesh.frustumCulled = false;

  const lugGeometries: BufferGeometry[] = [];
  for (let k = 1; k <= RING_BEATS; k += 1) {
    const u = railU(k * MD_BEAT);
    const frame = sampleRailFrame(curve, u);
    const downbeat = k % 4 === 0;
    scratchBasis.makeBasis(frame.right, frame.up, frame.tangent);
    const quaternion = new Quaternion().setFromRotationMatrix(scratchBasis);
    const scale = downbeat ? 1.045 : 1;
    scratchMatrix.compose(frame.position, quaternion, new Vector3(scale, scale, downbeat ? 1.7 : 1));
    bodyMesh.setMatrixAt(k - 1, scratchMatrix);
    rimMesh.setMatrixAt(k - 1, scratchMatrix);
    const base = heatColor(k / RING_BEATS);
    bodyMesh.setColorAt(k - 1, scratchColor.copy(base).multiplyScalar(0.32));
    rimMesh.setColorAt(k - 1, scratchColor.copy(base).multiplyScalar(0.7));
    rings.push({ beat: k, base, downbeat, position: frame.position.clone(), quaternion });

    if (downbeat) {
      for (let lug = 0; lug < 4; lug += 1) {
        const angle = Math.PI / 4 + (lug / 4) * Math.PI * 2;
        const box = new BoxGeometry(1.5, 1.1, 1.4);
        const offset = frame.position
          .clone()
          .addScaledVector(frame.right, Math.cos(angle) * (BORE_RADIUS + 0.9))
          .addScaledVector(frame.up, Math.sin(angle) * (BORE_RADIUS + 0.9));
        scratchMatrix.compose(offset, quaternion, new Vector3(1, 1, 1));
        lugGeometries.push(box.applyMatrix4(scratchMatrix));
      }
    }
  }
  root.add(bodyMesh, rimMesh);
  root.add(new Mesh(mergeGeometries(lugGeometries), new MeshBasicMaterial({ color: new Color(0.075, 0.082, 0.1) })));
  for (const geometry of lugGeometries) geometry.dispose();

  // ---- conductor rails: the actual railgun rails ------------------------------
  // Four thin bright tubes running the whole barrel at the diagonals, gradient
  // arc blue → violet down the bore, pulsing with the beat.
  const conductorMaterial = new LineBasicNodeMaterial(additiveMaterialParameters({}));
  const heat = attribute<'float'>('heat', 'float');
  const crawl = heat.mul(90).sub(time.mul(7)).sin().mul(0.5).add(0.5).pow(3);
  conductorMaterial.colorNode = mix(
    mix(
      vec3(ARC_BLUE.r, ARC_BLUE.g, ARC_BLUE.b),
      vec3(VOLT_VIOLET.r, VOLT_VIOLET.g, VOLT_VIOLET.b),
      heat,
    ),
    vec3(BLINDING.r, BLINDING.g, BLINDING.b),
    chargeUniform.mul(heat).mul(0.6),
  )
    .mul(crawl.mul(1.1).add(0.5))
    .mul(beatUniform.mul(0.55).add(1))
    .mul(positionView.z.negate().mul(-0.008).exp());
  for (let railIndex = 0; railIndex < 4; railIndex += 1) {
    const angle = Math.PI / 4 + (railIndex / 4) * Math.PI * 2;
    const points: Vector3[] = [];
    const heats: number[] = [];
    const SAMPLES = 150;
    for (let i = 0; i <= SAMPLES; i += 1) {
      const u = (MUZZLE_U * i) / SAMPLES;
      const frame = sampleRailFrame(curve, u);
      points.push(
        frame.position
          .clone()
          .addScaledVector(frame.right, Math.cos(angle) * (BORE_RADIUS - 0.65))
          .addScaledVector(frame.up, Math.sin(angle) * (BORE_RADIUS - 0.65)),
      );
      heats.push(u / MUZZLE_U);
    }
    const geometry = new BufferGeometry().setFromPoints(points);
    geometry.setAttribute('heat', new Float32BufferAttribute(heats, 1));
    const line = new Line(geometry, conductorMaterial);
    line.frustumCulled = false;
    root.add(line);
  }

  // ---- barrel wall: dark gunmetal rib panels ----------------------------------
  root.add(createBarrelWall(rng, curve));

  // ---- camera-riding speed streaks --------------------------------------------
  const streaks = createSpeedStreaks(rng);
  root.add(streaks);

  // ---- charge glow: the visible firing charge parked at the muzzle ------------
  const chargeGroup = new Group();
  chargeGroup.position.copy(muzzleFrame.position);
  chargeGroup.quaternion.setFromRotationMatrix(scratchBasis.makeBasis(muzzleFrame.right, muzzleFrame.up, muzzleFrame.tangent));
  const chargeOuterMaterial = createAdditiveBasicMaterial({ color: 0x000000, side: 2 });
  chargeOuterMaterial.fog = false;
  const chargeOuter = new Mesh(new CircleGeometry(8.2, 40), chargeOuterMaterial);
  const chargeCoreMaterial = createAdditiveBasicMaterial({ color: 0x000000, side: 2 });
  chargeCoreMaterial.fog = false;
  const chargeCore = new Mesh(new CircleGeometry(3.4, 32), chargeCoreMaterial);
  chargeCore.position.z = 0.5;
  chargeGroup.add(chargeOuter, chargeCore);
  root.add(chargeGroup);

  // ---- muzzle field: the open space beyond the gun -----------------------------
  const spaceCenter = muzzleFrame.position.clone().addScaledVector(exitDirection, 900);
  root.add(createStarfield(rng, spaceCenter));
  root.add(createStarStreaks(rng, curve));

  // One distant pulsing ion-white beacon dead ahead — the thing you were
  // launched toward. Fogged out until the shot.
  const railEnd = sampleRailFrame(curve, 1);
  const beaconPosition = railEnd.position.clone().addScaledVector(railEnd.tangent, 1600);
  const beacon = new Group();
  beacon.position.copy(beaconPosition);
  const beaconCoreMaterial = new MeshBasicMaterial({ color: hdr(ION_WHITE, 2.2) });
  const beaconGlowMaterial = createAdditiveBasicMaterial({ color: hdr(ION_WHITE, 0.5), opacity: 0.5 });
  beacon.add(new Mesh(new SphereGeometry(11, 18, 12), beaconCoreMaterial));
  beacon.add(new Mesh(new SphereGeometry(30, 18, 12), beaconGlowMaterial));
  root.add(beacon);

  scene.add(root);

  // ---- per-frame update ---------------------------------------------------------
  let strobeStart = -1;
  const fog = scene.fog as Fog;

  function update(dt: number, ctx: EnvironmentUpdate) {
    const beatFloat = ctx.running ? ctx.runTime / MD_BEAT : -1;

    // Rings: flash the just-passed ring, pre-glow the next, idle-shimmer in
    // attract, lean toward white with the charge, and run the interlocks-clear
    // white strobe sweep down the tunnel.
    const strobeAge = strobeStart >= 0 ? ctx.elapsed - strobeStart : -1;
    const strobeBeat = strobeAge >= 0 && strobeAge < 0.62 ? beatFloat + (strobeAge / 0.62) * 46 : -100;
    const from = Math.max(0, Math.floor(beatFloat) - 26);
    const to = Math.min(RING_BEATS - 1, Math.floor(beatFloat) + 60);
    for (let i = from; i <= to; i += 1) {
      const ring = rings[i];
      const d = ring.beat - beatFloat;
      let rim = 0.55;
      if (ctx.running) {
        if (d > 0 && d <= 1) rim += (1 - d) * 0.9; // pre-glow the next ring
        else if (d <= 0 && d > -1) rim += (1 + d) * (1 + d) * (ring.downbeat ? 2.4 : 1.7); // flash the just-passed
        rim *= 1 + ctx.charge * 0.7;
      } else {
        rim = 0.4 + Math.sin(ctx.elapsed * 2.1 + ring.beat * 0.6) * 0.18; // attract idle-shimmer
      }
      scratchColor.copy(ring.base);
      if (ctx.charge > 0 && d > 0) scratchColor.lerp(BLINDING, Math.min(0.7, ctx.charge * 0.7)); // rings ahead lean white
      if (Math.abs(ring.beat - strobeBeat) < 5) {
        scratchColor.copy(BLINDING);
        rim = 3.2;
      }
      rimMesh.setColorAt(i, scratchColor.clone().multiplyScalar(rim));
      bodyMesh.setColorAt(i, scratchColor.clone().multiplyScalar(0.3 + Math.max(0, 1 - Math.abs(d)) * 0.25));
    }
    if (rimMesh.instanceColor) rimMesh.instanceColor.needsUpdate = true;
    if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;

    // Speed streaks ride the camera; scroll rate is the felt airspeed.
    streaks.position.copy(ctx.cameraPosition);
    streaks.quaternion.copy(ctx.cameraQuaternion);
    streakOffsetUniform.value = (streakOffsetUniform.value + dt * ctx.speedFactor * 30) % 10000;
    const glowTarget = !ctx.running ? 0.1 : ctx.shotDone ? 1.6 : 0.16 + ctx.speedFactor * 0.28 + ctx.charge * 0.5;
    streakGlowUniform.value += (glowTarget - streakGlowUniform.value) * Math.min(1, dt * (ctx.shotDone ? 12 : 2.2));

    // Charge glow: grows and brightens through the interlock bars, capped so
    // the last interlocks stay legible; the true whiteout belongs to the shot.
    const chargeVisible = ctx.running && !ctx.shotDone;
    chargeGroup.visible = chargeVisible;
    if (chargeVisible) {
      const swell = 0.35 + ctx.charge * 0.65 + Math.sin(ctx.elapsed * 7) * 0.03 * ctx.charge;
      chargeGroup.scale.setScalar(Math.min(1.05, swell));
      chargeOuterMaterial.color.copy(VOLT_VIOLET).lerp(BLINDING, ctx.charge * 0.5).multiplyScalar(ctx.charge * ctx.charge * 1.5);
      chargeOuterMaterial.opacity = Math.min(0.85, ctx.charge * 1.1);
      chargeCoreMaterial.color.copy(ION_WHITE).multiplyScalar(ctx.charge * ctx.charge * 2.2);
    }

    // Beacon breathes.
    const pulse = 0.75 + Math.sin(ctx.elapsed * 2.5) * 0.35;
    beaconCoreMaterial.color.copy(ION_WHITE).multiplyScalar(1.6 + pulse);
    beaconGlowMaterial.opacity = 0.3 + pulse * 0.25;

    // Atmosphere: blue-black at the breech, warming toward violet by the
    // interlocks, whitening as the charge peaks — then a hard cut to
    // near-vacuum black past the muzzle.
    if (ctx.shotDone) {
      fog.near = 80;
      fog.far = FOG_FAR_SPACE;
      fog.color.copy(BG_SPACE);
      (ctx.scene.background as Color).copy(BG_SPACE);
    } else {
      const t = ctx.running ? MathUtils.clamp(ctx.runTime / SHOT_TIME, 0, 1) : 0;
      fog.near = FOG_NEAR;
      fog.far = FOG_FAR_BARREL + ctx.speedFactor * 26;
      scratchColor.copy(BG_BREECH).lerp(BG_VIOLET, MathUtils.smoothstep(t, 0.3, 0.75));
      scratchColor.lerp(BG_CHARGE, ctx.charge * ctx.charge * 0.8);
      fog.color.copy(scratchColor);
      (ctx.scene.background as Color).copy(scratchColor);
    }
  }

  return {
    root,
    update,
    ringPosition(beat: number) {
      const ring = rings[MathUtils.clamp(Math.round(beat) - 1, 0, rings.length - 1)];
      return ring.position;
    },
    ringQuaternion(beat: number) {
      const ring = rings[MathUtils.clamp(Math.round(beat) - 1, 0, rings.length - 1)];
      return ring.quaternion;
    },
    muzzlePosition: muzzleFrame.position.clone(),
    triggerStrobe(elapsed: number) {
      strobeStart = elapsed;
    },
    reset(hostScene: Scene) {
      strobeStart = -1;
      streakGlowUniform.value = 0.1;
      streakOffsetUniform.value = 0;
      fog.near = FOG_NEAR;
      fog.far = FOG_FAR_BARREL;
      fog.color.copy(BG_BREECH);
      (hostScene.background as Color).copy(BG_BREECH);
    },
  };
}

// ---- barrel wall ----------------------------------------------------------------

// Dark gunmetal rib panels scattered around the bore just outside the drones'
// reach, so threaders weave in front of the wall; a scattered few carry a dim
// arc-blue service light.
function createBarrelWall(rng: Rng, curve: ReturnType<typeof createMassDriverRail>) {
  const group = new Group();
  const fills: BufferGeometry[] = [];
  const lightPositions: number[] = [];
  const lightColors: number[] = [];
  const scratch = new Matrix4();
  const basis = new Matrix4();
  const PANELS = 360;
  for (let i = 0; i < PANELS; i += 1) {
    const u = (i / PANELS) * MUZZLE_U + rng() * 0.002;
    const frame = sampleRailFrame(curve, u);
    const angle = rng() * Math.PI * 2;
    const radius = 13.4 + rng() * 2.2;
    const position = frame.position
      .clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius);
    // Basis: x circumferential, y radial, z along the bore.
    const radial = frame.right.clone().multiplyScalar(Math.cos(angle)).addScaledVector(frame.up, Math.sin(angle));
    const circumferential = new Vector3().crossVectors(frame.tangent, radial).normalize();
    basis.makeBasis(circumferential, radial, frame.tangent);
    const quaternion = new Quaternion().setFromRotationMatrix(basis);
    const panel = new BoxGeometry(2.4 + rng() * 3.6, 0.5 + rng() * 0.7, 5 + rng() * 9);
    scratch.compose(position, quaternion, new Vector3(1, 1, 1));
    fills.push(panel.applyMatrix4(scratch));

    if (rng() < 0.16) {
      const light = position.clone().addScaledVector(radial, -0.9);
      lightPositions.push(light.x, light.y, light.z);
      const glow = 0.25 + rng() * 0.5;
      lightColors.push(ARC_BLUE.r * glow, ARC_BLUE.g * glow, ARC_BLUE.b * glow);
    }
  }
  const shade = new Color(0.85, 0.92, 1.15);
  group.add(new Mesh(
    mergeGeometries(fills),
    new MeshBasicMaterial({ color: new Color(0.055, 0.06, 0.075).multiply(shade) }),
  ));
  for (const geometry of fills) geometry.dispose();

  const lightGeometry = new BufferGeometry();
  lightGeometry.setAttribute('position', new Float32BufferAttribute(lightPositions, 3));
  lightGeometry.setAttribute('color', new Float32BufferAttribute(lightColors, 3));
  const lights = new Points(lightGeometry, new PointsMaterial(additiveMaterialParameters({
    size: 0.7,
    vertexColors: true,
    sizeAttenuation: true,
  })));
  lights.frustumCulled = false;
  group.add(lights);
  return group;
}

// ---- speed streaks ------------------------------------------------------------

// A dense shell of thin streaks around the camera, scrolled faster the faster
// the gun runs — dim at idle, brightening with speed and charge, blazing past
// the muzzle.
function createSpeedStreaks(rng: Rng) {
  const COUNT = 260;
  const positions: number[] = [];
  const z0: number[] = [];
  const dz: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 3.5 + rng() * 8.5;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const start = rng() * STREAK_SPAN;
    const length = 3 + rng() * 6;
    const roll = rng();
    const color = (roll < 0.55 ? ARC_BLUE : roll < 0.85 ? VOLT_VIOLET : ION_WHITE).clone().multiplyScalar(0.2 + rng() * 0.5);
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
  material.fog = false;
  const wrapped = attribute<'float'>('z0', 'float')
    .add(streakOffsetUniform)
    .mod(STREAK_SPAN)
    .sub(STREAK_BACK);
  material.positionNode = vec3(
    attribute<'vec3'>('position', 'vec3').x,
    attribute<'vec3'>('position', 'vec3').y,
    wrapped.add(attribute<'float'>('dz', 'float')),
  );
  const envelope = wrapped.add(STREAK_BACK).smoothstep(float(0), float(9)).mul(
    wrapped.smoothstep(float(STREAK_SPAN - STREAK_BACK), float(STREAK_SPAN - STREAK_BACK - 7)),
  );
  material.colorNode = attribute<'vec3'>('color', 'vec3').mul(envelope).mul(streakGlowUniform);

  const streaks = new LineSegments(geometry, material);
  streaks.frustumCulled = false;
  const group = new Group();
  group.add(streaks);
  return group;
}

// ---- the muzzle field ------------------------------------------------------------

// A deep starfield with a scatter of arc-blue and violet stars and a few
// bright ones. Fog hides all of it until the shot.
function createStarfield(rng: Rng, center: Vector3) {
  const COUNT = 1100;
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i += 1) {
    const direction = randomUnit(rng);
    const distance = 320 + rng() ** 0.6 * 2400;
    positions[i * 3] = center.x + direction.x * distance;
    positions[i * 3 + 1] = center.y + direction.y * distance;
    positions[i * 3 + 2] = center.z + direction.z * distance;
    const roll = rng();
    const base = roll < 0.42 ? ARC_BLUE : roll < 0.7 ? VOLT_VIOLET : ION_WHITE;
    const intensity = rng() < 0.06 ? 1.9 : 0.2 + rng() * 0.5;
    colors[i * 3] = base.r * intensity;
    colors[i * 3 + 1] = base.g * intensity;
    colors[i * 3 + 2] = base.b * intensity;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const points = new Points(geometry, new PointsMaterial(additiveMaterialParameters({
    size: 1.6,
    vertexColors: true,
    sizeAttenuation: true,
  })));
  points.frustumCulled = false;
  return points;
}

// Star-streaks scattered along the post-muzzle flight corridor.
function createStarStreaks(rng: Rng, curve: ReturnType<typeof createMassDriverRail>) {
  const positions: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < 130; i += 1) {
    const u = MUZZLE_U + rng() * (1 - MUZZLE_U);
    const frame = sampleRailFrame(curve, u);
    const angle = rng() * Math.PI * 2;
    const radius = 26 + rng() * 130;
    const start = frame.position
      .clone()
      .addScaledVector(frame.right, Math.cos(angle) * radius)
      .addScaledVector(frame.up, Math.sin(angle) * radius);
    const end = start.clone().addScaledVector(frame.tangent, 9 + rng() * 20);
    positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
    const color = (rng() < 0.6 ? ARC_BLUE : ION_WHITE).clone().multiplyScalar(0.25 + rng() * 0.45);
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

function randomUnit(rng: Rng): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
