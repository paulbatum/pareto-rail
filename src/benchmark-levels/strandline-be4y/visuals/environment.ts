import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  float,
  fract,
  mix,
  mx_noise_float,
  normalWorld,
  positionLocal,
  positionWorld,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { offsetFromRail } from '../../../engine/rail';
import {
  APPROACH_AZIMUTH,
  BELL_CUT_ANGLE,
  BELL_RADIUS,
  BELL_RIM_RADIUS,
  BELL_RIM_Y,
  BELL_Y_SCALE,
  CROWN,
  CROWN_RADIUS,
  WORLD_SCALE,
} from '../world';
import type { StrandlineEnemyKind } from '../gameplay';
import { createStrandlineRail, createStrandlineTimeline, strandLatchPoints } from '../gameplay';
import {
  CLEAN_WHITE,
  JELLY_DIM,
  JELLY_GOLD,
  JELLY_GREEN,
  JELLY_MEMBRANE,
  PARASITE_VIOLET,
  SUN_SHAFT,
  WATER_ABYSS,
  WATER_DEEP,
  WATER_HAZE,
  WATER_MID,
  WATER_SHALLOW,
  hdr,
  mulberry32,
  type Rng,
} from './palette';

// The animal and its water. One bell, one crown, ~110 strands merged into a
// single mesh whose vertex shader sways them and runs bioluminescence down
// their length; light shafts and plankton give the water depth and speed.
// `life` (0..1) is the whole level's arc in one number: strands brighten and
// the violet taint fades as it climbs, and the coda's cleanse sweep runs a
// wave of clean light out from the crown along every strand.

const S = WORLD_SCALE;

export const beatUniform = uniform(0);
export const lifeUniform = uniform(0.25);
export const sweepUniform = uniform(-1); // radius (world units) of the cleanse wave from the crown; negative = none
export const bellPulseUniform = uniform(0);
export const shaftGlowUniform = uniform(0.35);

type Strand = {
  points: Vector3[];
  radius: [number, number];
  taint: number;
  phase: number;
  swayScale: number;
  /** Power of the (1 - along) falloff applied to the taint: violet concentrated at the root or latch, clean toward the ends. */
  taintFalloff?: number;
  /** Vertex range in the merged geometry, for later taint rewrites. */
  vertexStart: number;
  vertexCount: number;
  latchKind?: StrandlineEnemyKind;
  latchPosition?: Vector3;
};

export type Environment = {
  root: Group;
  update(dt: number, frame: EnvironmentFrame): void;
  /** Strand index whose latch point is at `position`, if any. */
  strandAt(position: Vector3): number | null;
  /** Wash the violet out of one strand (a parasite died on it). */
  cleanseStrand(index: number): void;
  resetStrands(): void;
};

export type EnvironmentFrame = {
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  speed: number;
  beatEnergy: number;
  life: number;
  sweepRadius: number;
  serene: number; // 0..1 the coda's calm
};

const RADIAL_SEGMENTS = 5;

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = WATER_DEEP.clone();
  scene.fog = new FogExp2(WATER_HAZE.clone(), 0.0052);

  const root = new Group();
  const rng = mulberry32(20260901);
  const curve = createStrandlineRail();
  const timeline = createStrandlineTimeline().timeline;

  const waterDome = createWaterDome();
  root.add(waterDome);
  const overhead = createOverheadLight();
  root.add(overhead.group);

  const bell = createBell();
  root.add(bell.group);

  const strands = buildStrands(rng, curve, strandLatchPoints(curve, timeline));
  root.add(strands.mesh);

  const shafts = createLightShafts(rng);
  root.add(shafts.group);

  const plankton = createPlankton(rng);
  root.add(plankton.points);

  scene.add(root);

  const cameraForward = new Vector3();
  let smoothedPulse = 0;

  return {
    root,
    strandAt(position) {
      let best: number | null = null;
      let bestDistance = 1.5;
      for (const [index, strand] of strands.list.entries()) {
        if (!strand.latchPosition) continue;
        const distance = strand.latchPosition.distanceTo(position);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
      return best;
    },
    cleanseStrand(index) {
      strands.setTaint(index, 0);
    },
    resetStrands() {
      strands.resetTaints();
    },
    update(dt, frame) {
      const cameraPos = frame.camera.position;
      frame.camera.getWorldDirection(cameraForward);

      // Water: clearer and greener as the animal comes back to life.
      const fog = scene.fog as FogExp2;
      const clarity = frame.life * 0.45 + frame.serene * 0.3;
      fog.density = MathUtils.lerp(0.0052, 0.0028, Math.min(1, clarity));
      fog.color.copy(WATER_HAZE).lerp(WATER_SHALLOW, frame.life * 0.2 + frame.serene * 0.2);
      (scene.background as Color).copy(WATER_DEEP).lerp(WATER_MID, frame.life * 0.25);

      // The water rides the camera; its gradient is by world height, so the
      // light above never moves and the deep stays below.
      waterDome.position.copy(cameraPos);
      overhead.group.position.copy(cameraPos).add(new Vector3(0, 260, 0));

      lifeUniform.value = frame.life;
      sweepUniform.value = frame.sweepRadius;
      beatUniform.value = frame.beatEnergy;
      shaftGlowUniform.value = 0.28 + frame.life * 0.28 + frame.serene * 0.25;

      // The bell breathes: on the beat during the fight, slow and serene after.
      const targetPulse = frame.serene > 0.5
        ? Math.max(0, Math.sin(frame.elapsed * 1.4)) * 0.8
        : frame.beatEnergy;
      smoothedPulse += (targetPulse - smoothedPulse) * Math.min(1, dt * 6);
      bellPulseUniform.value = smoothedPulse;
      const squeeze = 1 + smoothedPulse * 0.035;
      bell.group.scale.set(1 / Math.sqrt(squeeze), squeeze, 1 / Math.sqrt(squeeze));
      bell.rim.rotation.y = frame.elapsed * 0.01;

      shafts.update(cameraPos, frame.elapsed);
      plankton.update(dt, cameraPos, cameraForward, frame.speed);
    },
  };
}

// ---- water dome and the light above -----------------------------------------------------

const WATER_DOME_RADIUS = 300;

function createWaterDome() {
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
  // Height relative to the animal, not the camera: the surface light stays put.
  const h = positionWorld.y.add(60).div(WATER_DOME_RADIUS);
  const up = smoothstep(float(-0.15), float(0.9), h);
  const shallow = vec3(WATER_SHALLOW.r, WATER_SHALLOW.g, WATER_SHALLOW.b);
  const mid = vec3(WATER_MID.r, WATER_MID.g, WATER_MID.b);
  const deep = vec3(WATER_DEEP.r, WATER_DEEP.g, WATER_DEEP.b);
  const abyss = vec3(WATER_ABYSS.r, WATER_ABYSS.g, WATER_ABYSS.b);
  const lit = mix(mid, shallow, up.pow(1.6).mul(lifeUniform.mul(0.5).add(0.6)));
  const down = smoothstep(float(0.05), float(-0.7), h);
  let color = mix(lit, deep, down);
  color = mix(color, abyss, smoothstep(float(-0.6), float(-1), h));
  // A slow caustic shimmer near the surface.
  const caustic = mx_noise_float(positionWorld.mul(0.02).add(vec3(time.mul(0.05), 0, time.mul(0.03)))).mul(0.5).add(0.5);
  color = color.add(shallow.mul(caustic.mul(up.pow(2)).mul(0.12)));
  material.colorNode = color;
  const dome = new Mesh(new SphereGeometry(WATER_DOME_RADIUS, 36, 24), material);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  dome.userData.raildIgnoreOcclusion = true;
  return dome;
}

function createOverheadLight() {
  const group = new Group();
  const nodeMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide, fog: false }));
  const falloff = smoothstep(float(0.5), float(0.05), uv().sub(0.5).length());
  nodeMaterial.colorNode = vec3(SUN_SHAFT.r, SUN_SHAFT.g, SUN_SHAFT.b).mul(falloff.pow(1.5)).mul(lifeUniform.mul(0.5).add(0.5)).mul(0.9);
  const disc = new Mesh(new CircleGeometry(150, 32), nodeMaterial);
  disc.rotation.x = Math.PI / 2;
  disc.userData.raildIgnoreOcclusion = true;
  disc.frustumCulled = false;
  group.add(disc);
  group.userData.raildIgnoreOcclusion = true;
  return { group };
}

// ---- the bell --------------------------------------------------------------------------------

function createBell() {
  const group = new Group();

  // The dome: a luminous membrane, lit through from above, rim-lit green-gold,
  // mottled by noise. Additive, so it reads as a body of light — the green
  // moon — from outside and as a glowing ceiling from underneath.
  const membrane = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide }));
  membrane.opacity = 0.3; // JS-side value: reads as non-occluding to the audit; the node drives rendering
  const viewDirection = cameraPosition.sub(positionWorld).normalize();
  const facing = normalWorld.dot(viewDirection).abs();
  const fresnel = float(1).sub(facing).pow(2.2);
  const litFromAbove = normalWorld.y.abs().mul(0.55).add(0.45);
  const mottle = mx_noise_float(positionLocal.mul(0.06).add(vec3(0, time.mul(0.04), 0))).mul(0.5).add(0.5);
  const membraneColor = vec3(JELLY_MEMBRANE.r, JELLY_MEMBRANE.g, JELLY_MEMBRANE.b);
  const rimColor = vec3(JELLY_GREEN.r, JELLY_GREEN.g, JELLY_GREEN.b).mul(0.6).add(vec3(JELLY_GOLD.r, JELLY_GOLD.g, JELLY_GOLD.b).mul(0.4));
  const life = lifeUniform.mul(0.6).add(0.55);
  const pulse = bellPulseUniform.mul(0.35).add(1);
  membrane.colorNode = membraneColor.mul(float(0.22).add(mottle.mul(0.16))).mul(litFromAbove).mul(life)
    .add(rimColor.mul(fresnel).mul(0.7).mul(pulse).mul(life));
  const dome = new Mesh(new SphereGeometry(BELL_RADIUS, 72, 36, 0, Math.PI * 2, 0, BELL_CUT_ANGLE), membrane);
  dome.scale.set(1, BELL_Y_SCALE, 1);
  dome.userData.raildIgnoreOcclusion = true;
  group.add(dome);

  // Radial canals: bioluminescence running from the apex to the rim.
  const canalGeometries: BufferGeometry[] = [];
  const canalCount = 16;
  for (let i = 0; i < canalCount; i += 1) {
    const azimuth = (i / canalCount) * Math.PI * 2;
    const points: Vector3[] = [];
    const steps = 14;
    for (let s = 0; s <= steps; s += 1) {
      const polar = (s / steps) * BELL_CUT_ANGLE * 0.98 + 0.06;
      points.push(new Vector3(
        Math.sin(polar) * Math.cos(azimuth) * BELL_RADIUS * 1.004,
        Math.cos(polar) * BELL_RADIUS * BELL_Y_SCALE * 1.004,
        Math.sin(polar) * Math.sin(azimuth) * BELL_RADIUS * 1.004,
      ));
    }
    canalGeometries.push(tubeGeometry(points, () => 0.32 * S, RADIAL_SEGMENTS, { along: true, phase: i / canalCount }));
  }
  const canalMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide }));
  const canalAlong = attribute<'float'>('along', 'float');
  const canalPhase = attribute<'float'>('phase', 'float');
  const canalRun = fract(canalAlong.mul(2.2).sub(time.mul(0.32)).add(canalPhase)).pow(9).mul(1.6);
  const canalColor = vec3(JELLY_GREEN.r, JELLY_GREEN.g, JELLY_GREEN.b).mul(0.6).add(vec3(JELLY_GOLD.r, JELLY_GOLD.g, JELLY_GOLD.b).mul(0.4));
  canalMaterial.colorNode = canalColor
    .mul(float(0.3).add(canalRun).add(bellPulseUniform.mul(0.35)))
    .mul(lifeUniform.mul(0.8).add(0.45));
  const canals = new Mesh(mergeGeometries(canalGeometries), canalMaterial);
  canals.userData.raildIgnoreOcclusion = true;
  group.add(canals);
  for (const geometry of canalGeometries) geometry.dispose();

  // Gonad lobes: four gold horseshoes under the apex — the moon's markings.
  const lobeGeometries: BufferGeometry[] = [];
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2;
    const lobe = new TorusGeometry(BELL_RADIUS * 0.2, BELL_RADIUS * 0.05, 8, 28, Math.PI * 1.3);
    const matrix = new Matrix4()
      .makeTranslation(Math.cos(angle) * BELL_RADIUS * 0.34, BELL_RADIUS * BELL_Y_SCALE * 0.62, Math.sin(angle) * BELL_RADIUS * 0.34)
      .multiply(new Matrix4().makeRotationY(-angle))
      .multiply(new Matrix4().makeRotationX(Math.PI / 2))
      .multiply(new Matrix4().makeRotationZ(Math.PI * 0.35));
    lobe.applyMatrix4(matrix);
    lobeGeometries.push(lobe);
  }
  const lobeMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide }));
  lobeMaterial.colorNode = vec3(JELLY_GOLD.r, JELLY_GOLD.g, JELLY_GOLD.b)
    .mul(float(0.1).add(bellPulseUniform.mul(0.1)))
    .mul(lifeUniform.mul(0.7).add(0.5));
  const lobes = new Mesh(mergeGeometries(lobeGeometries), lobeMaterial);
  lobes.userData.raildIgnoreOcclusion = true;
  group.add(lobes);
  for (const geometry of lobeGeometries) geometry.dispose();

  // The rim frill: a wavy ring of light where the strands root.
  const rimGeometry = new TorusGeometry(BELL_RIM_RADIUS, 0.9 * S, 6, 128);
  const rimPositions = rimGeometry.attributes.position as BufferAttribute;
  for (let i = 0; i < rimPositions.count; i += 1) {
    const x = rimPositions.getX(i);
    const z = rimPositions.getY(i);
    const azimuth = Math.atan2(z, x);
    const wave = Math.sin(azimuth * 24) * 1.4 * S;
    rimPositions.setZ(i, rimPositions.getZ(i) + wave);
  }
  rimGeometry.computeVertexNormals();
  const rimMaterial = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide }));
  rimMaterial.colorNode = vec3(JELLY_GREEN.r, JELLY_GREEN.g, JELLY_GREEN.b).mul(0.7).add(vec3(JELLY_GOLD.r, JELLY_GOLD.g, JELLY_GOLD.b).mul(0.3))
    .mul(float(0.45).add(bellPulseUniform.mul(0.4)))
    .mul(lifeUniform.mul(0.8).add(0.45));
  const rim = new Mesh(rimGeometry, rimMaterial);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = BELL_RIM_Y;
  rim.userData.raildIgnoreOcclusion = true;
  group.add(rim);

  // The crown bulb: the manubrium the oral arms hang from, and the Parent's seat.
  const crownMaterial = new MeshBasicNodeMaterial({ side: DoubleSide });
  const crownView = cameraPosition.sub(positionWorld).normalize();
  const crownRim = float(1).sub(normalWorld.dot(crownView).abs()).pow(2);
  const crownTaint = smoothstep(float(0), float(CROWN_RADIUS * 4), sweepUniform).oneMinus().mul(float(1).sub(lifeUniform.mul(0.5)));
  const crownBase = mix(
    vec3(JELLY_DIM.r, JELLY_DIM.g, JELLY_DIM.b).mul(1.6),
    vec3(PARASITE_VIOLET.r, PARASITE_VIOLET.g, PARASITE_VIOLET.b).mul(0.35),
    crownTaint,
  );
  crownMaterial.colorNode = crownBase.mul(0.7).add(vec3(JELLY_GOLD.r, JELLY_GOLD.g, JELLY_GOLD.b).mul(crownRim).mul(lifeUniform.mul(0.6).add(0.15)));
  const crown = new Mesh(new SphereGeometry(CROWN_RADIUS, 20, 14), crownMaterial);
  crown.scale.set(1, 0.8, 1);
  crown.position.copy(CROWN);
  group.add(crown);

  return { group, rim, dome };
}

// ---- strands ----------------------------------------------------------------------------------

function buildStrands(rng: Rng, curve: ReturnType<typeof createStrandlineRail>, latches: ReturnType<typeof strandLatchPoints>) {
  const list: Strand[] = [];
  const geometries: BufferGeometry[] = [];

  const addStrand = (strand: Omit<Strand, 'vertexStart' | 'vertexCount'>) => {
    const radiusAt = (t: number) => MathUtils.lerp(strand.radius[0], strand.radius[1], t);
    const geometry = tubeGeometry(strand.points, radiusAt, RADIAL_SEGMENTS, {
      along: true,
      phase: strand.phase,
      taint: strand.taint,
      taintFalloff: strand.taintFalloff,
      swayScale: strand.swayScale,
      alongCenter: strand.latchPosition ? strand.points.findIndex((point) => point === strand.latchPosition) / (strand.points.length - 1) : undefined,
    });
    const vertexCount = geometry.attributes.position.count;
    list.push({ ...strand, vertexStart: 0, vertexCount });
    geometries.push(geometry);
  };

  // Rim tentacles: long, trailing down and out, swaying.
  const tentacleCount = 44;
  for (let i = 0; i < tentacleCount; i += 1) {
    const azimuth = (i / tentacleCount) * Math.PI * 2 + (rng() - 0.5) * 0.08;
    const length = (200 + rng() * 110) * S;
    const drift = (14 + rng() * 26) * S;
    const lateral = (rng() - 0.5) * 30 * S;
    const points: Vector3[] = [];
    const steps = 20;
    const rootRadius = BELL_RIM_RADIUS * (0.96 + rng() * 0.04);
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const radial = rootRadius + drift * t ** 1.5;
      const swing = lateral * t * t;
      points.push(new Vector3(
        Math.cos(azimuth) * radial - Math.sin(azimuth) * swing,
        BELL_RIM_Y - length * t + Math.sin(t * 5 + i) * 2.5 * S * t,
        Math.sin(azimuth) * radial + Math.cos(azimuth) * swing,
      ));
    }
    addStrand({ points, radius: [0.7 * S, 0.2 * S], taint: 0.04 + rng() * 0.1, phase: rng() * Math.PI * 2, swayScale: 1 });
  }

  // Oral arms: eight thick frilled strands from the crown, leaving the approach corridor open.
  const armCount = 8;
  for (let i = 0; i < armCount; i += 1) {
    let azimuth = (i / armCount) * Math.PI * 2 + 0.2;
    const gap = Math.atan2(Math.sin(azimuth - APPROACH_AZIMUTH), Math.cos(azimuth - APPROACH_AZIMUTH));
    if (Math.abs(gap) < 0.9) azimuth += Math.sign(gap || 1) * (0.9 - Math.abs(gap));
    const length = (140 + rng() * 60) * S;
    const points: Vector3[] = [];
    const steps = 18;
    const rootRadius = (22 + rng() * 10) * S;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      const radial = rootRadius + 26 * S * t ** 1.3;
      points.push(new Vector3(
        Math.cos(azimuth) * radial + Math.sin(t * 9 + i) * 2 * S * t,
        CROWN.y - 2 * S - length * t,
        Math.sin(azimuth) * radial + Math.cos(t * 7 + i * 2) * 2 * S * t,
      ));
    }
    addStrand({ points, radius: [0.7 * S, 0.3 * S], taint: 0.7 + rng() * 0.25, phase: rng() * Math.PI * 2, swayScale: 0.7, taintFalloff: 1.3 });
  }

  // Host strands: one through every latch point, so each clamped parasite
  // visibly sits on a strand. Sway is pinned at the latch point.
  for (const latch of latches) {
    const half = (55 + rng() * 25) * S;
    const points: Vector3[] = [];
    const steps = 14;
    const tilt = new Vector3((rng() - 0.5) * 0.25, 1, (rng() - 0.5) * 0.25).normalize();
    const bend = new Vector3((rng() - 0.5) * 8, 0, (rng() - 0.5) * 8).multiplyScalar(S);
    let latchPoint: Vector3 | undefined;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps - 0.5;
      const point = latch.position.clone().addScaledVector(tilt, t * half * 2).addScaledVector(bend, t * t * 4);
      if (s === steps / 2) {
        point.copy(latch.position);
        latchPoint = point;
      }
      points.push(point);
    }
    addStrand({
      points,
      radius: [0.5 * S, 0.5 * S],
      taint: latch.kind === 'spinner' ? 0.7 : 1.0,
      phase: rng() * Math.PI * 2,
      swayScale: 0.55,
      taintFalloff: 2.2,
      latchKind: latch.kind,
      latchPosition: latchPoint,
    });
  }

  // Near strands: pass close beside the rail so the camera threads between them.
  for (let i = 0; i < 26; i += 1) {
    const u = 0.04 + rng() * 0.9;
    const side = rng() < 0.5 ? -1 : 1;
    const offset = new Vector3(side * (7 + rng() * 7), (rng() - 0.5) * 12, 0);
    const anchor = offsetFromRail(curve, u, offset);
    const half = (50 + rng() * 30) * S;
    const points: Vector3[] = [];
    const steps = 14;
    const tilt = new Vector3((rng() - 0.5) * 0.3, 1, (rng() - 0.5) * 0.3).normalize();
    const bend = new Vector3((rng() - 0.5) * 10, 0, (rng() - 0.5) * 10).multiplyScalar(S);
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps - 0.5;
      points.push(anchor.clone().addScaledVector(tilt, t * half * 2).addScaledVector(bend, t * t * 4));
    }
    addStrand({ points, radius: [0.42 * S, 0.24 * S], taint: 0.04 + rng() * 0.1, phase: rng() * Math.PI * 2, swayScale: 0.8 });
  }

  // Assign vertex ranges before merging.
  let cursor = 0;
  for (const [index, strand] of list.entries()) {
    strand.vertexStart = cursor;
    cursor += strand.vertexCount;
    void index;
  }
  const merged = mergeGeometries(geometries);
  merged.computeVertexNormals();
  for (const geometry of geometries) geometry.dispose();
  const taintAttribute = merged.attributes.taint as BufferAttribute;
  const baseTaint = new Float32Array(taintAttribute.array as Float32Array);

  // The strand shader: sway in the vertex stage, bioluminescence in the fragment stage.
  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  const along = attribute<'float'>('along', 'float');
  const phase = attribute<'float'>('phase', 'float');
  const taint = attribute<'float'>('taint', 'float');
  const swayScale = attribute<'float'>('swayScale', 'float');
  const swayT = time.mul(0.55).add(phase);
  const swayAmount = along.mul(swayScale).mul(2.2 * S);
  const sway = vec3(
    swayT.add(along.mul(3.1)).sin().mul(swayAmount),
    swayT.mul(0.6).add(along.mul(2.3)).cos().mul(swayAmount.mul(0.3)),
    swayT.mul(0.8).add(along.mul(2.7)).cos().mul(swayAmount),
  );
  material.positionNode = positionLocal.add(sway);

  const crownDistance = positionLocal.distance(vec3(CROWN.x, CROWN.y, CROWN.z));
  const cleanWave = smoothstep(crownDistance.sub(14), crownDistance.add(14), sweepUniform);
  const infest = taint.mul(float(1).sub(lifeUniform.mul(0.55))).mul(float(1).sub(cleanWave));
  const green = vec3(JELLY_GREEN.r, JELLY_GREEN.g, JELLY_GREEN.b);
  const gold = vec3(JELLY_GOLD.r, JELLY_GOLD.g, JELLY_GOLD.b);
  const dim = vec3(JELLY_DIM.r, JELLY_DIM.g, JELLY_DIM.b);
  const violet = vec3(PARASITE_VIOLET.r, PARASITE_VIOLET.g, PARASITE_VIOLET.b);
  const white = vec3(CLEAN_WHITE.r, CLEAN_WHITE.g, CLEAN_WHITE.b);
  const brightness = lifeUniform.mul(0.7).add(0.35);
  const rootGlow = float(1).sub(along).pow(2).mul(0.4);
  const run = fract(along.mul(3.0).sub(time.mul(0.28)).add(phase)).pow(14).mul(1.5);
  const beatGlow = beatUniform.mul(0.25);
  // Rounded shading: a tube's edges fall dark so it reads as a strand, not a ribbon.
  const viewDirection = cameraPosition.sub(positionWorld).normalize();
  const facing = normalWorld.dot(viewDirection).abs();
  const shade = float(0.35).add(facing.pow(0.8).mul(0.65));
  const healthy = mix(dim.mul(0.6), green.mul(0.7), brightness.mul(0.45)).mul(shade)
    .add(green.mul(rootGlow.add(beatGlow)).mul(brightness).mul(shade))
    .add(mix(green, gold, float(0.45)).mul(run).mul(brightness));
  const sick = mix(dim.mul(0.2), violet, float(0.8)).mul(shade).add(violet.mul(run.mul(0.6)));
  // The cleanse wave carries a crest of white light with it.
  const crest = smoothstep(float(22), float(0), sweepUniform.sub(crownDistance).abs()).mul(smoothstep(float(0), float(1), sweepUniform));
  material.colorNode = mix(healthy, sick, infest).add(white.mul(crest).mul(1.6));

  const mesh = new Mesh(merged, material);
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;

  return {
    mesh,
    list,
    setTaint(index: number, value: number) {
      const strand = list[index];
      if (!strand) return;
      for (let v = strand.vertexStart; v < strand.vertexStart + strand.vertexCount; v += 1) taintAttribute.setX(v, value);
      taintAttribute.needsUpdate = true;
    },
    resetTaints() {
      (taintAttribute.array as Float32Array).set(baseTaint);
      taintAttribute.needsUpdate = true;
    },
  };
}

// Tapered tube along a polyline with per-vertex `along`, `phase`, `taint`, and
// `swayScale`. `alongCenter` pins sway to zero at that parameter (host strands).
function tubeGeometry(
  points: Vector3[],
  radiusAt: (t: number) => number,
  radialSegments: number,
  options: { along: boolean; phase: number; taint?: number; taintFalloff?: number; swayScale?: number; alongCenter?: number },
) {
  const positions: number[] = [];
  const alongs: number[] = [];
  const phases: number[] = [];
  const taints: number[] = [];
  const sways: number[] = [];
  const indices: number[] = [];
  const segments = points.length - 1;
  const up = new Vector3(0, 1, 0);
  const tangent = new Vector3();
  const normal = new Vector3();
  const binormal = new Vector3();
  const previousNormal = new Vector3(1, 0, 0);

  for (let s = 0; s <= segments; s += 1) {
    const t = s / segments;
    const point = points[s];
    if (s < segments) tangent.subVectors(points[s + 1], point).normalize();
    else tangent.subVectors(point, points[s - 1]).normalize();
    // Parallel-transport-ish frame: keep the normal close to the previous ring's.
    normal.copy(previousNormal).sub(tangent.clone().multiplyScalar(previousNormal.dot(tangent)));
    if (normal.lengthSq() < 0.001) normal.crossVectors(tangent, up);
    if (normal.lengthSq() < 0.001) normal.set(1, 0, 0);
    normal.normalize();
    previousNormal.copy(normal);
    binormal.crossVectors(tangent, normal).normalize();
    const radius = radiusAt(t);
    const alongValue = options.alongCenter === undefined ? t : Math.abs(t - options.alongCenter) * 2;
    for (let r = 0; r <= radialSegments; r += 1) {
      const angle = (r / radialSegments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      positions.push(
        point.x + (normal.x * cos + binormal.x * sin) * radius,
        point.y + (normal.y * cos + binormal.y * sin) * radius,
        point.z + (normal.z * cos + binormal.z * sin) * radius,
      );
      alongs.push(alongValue);
      phases.push(options.phase);
      const falloff = options.taintFalloff === undefined ? 1 : Math.max(0, 1 - alongValue) ** options.taintFalloff;
      taints.push((options.taint ?? 0) * falloff);
      sways.push(options.swayScale ?? 1);
    }
  }
  for (let s = 0; s < segments; s += 1) {
    for (let r = 0; r < radialSegments; r += 1) {
      const a = s * (radialSegments + 1) + r;
      const b = a + radialSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('along', new Float32BufferAttribute(alongs, 1));
  geometry.setAttribute('phase', new Float32BufferAttribute(phases, 1));
  geometry.setAttribute('taint', new Float32BufferAttribute(taints, 1));
  geometry.setAttribute('swayScale', new Float32BufferAttribute(sways, 1));
  geometry.setIndex(indices);
  return geometry;
}

// ---- light shafts -------------------------------------------------------------------------------

function createLightShafts(rng: Rng) {
  const group = new Group();
  const geometry = new PlaneGeometry(1, 1);
  const material = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide, fog: false }));
  const shaftUv = uv();
  const vertical = smoothstep(float(0.05), float(0.55), shaftUv.y).mul(smoothstep(float(1), float(0.8), shaftUv.y));
  const horizontal = smoothstep(float(0), float(0.5), shaftUv.x).mul(smoothstep(float(1), float(0.5), shaftUv.x));
  const flicker = time.mul(0.3).add(positionWorld.x.mul(0.05)).sin().mul(0.25).add(0.75);
  material.colorNode = vec3(SUN_SHAFT.r, SUN_SHAFT.g, SUN_SHAFT.b).mul(vertical).mul(horizontal).mul(flicker).mul(shaftGlowUniform).mul(0.4);
  const shafts: Array<{ mesh: Mesh; offset: Vector3; phase: number }> = [];
  for (let i = 0; i < 18; i += 1) {
    const mesh = new Mesh(geometry, material);
    const angle = rng() * Math.PI * 2;
    const radius = 26 + rng() * 70;
    const offset = new Vector3(Math.cos(angle) * radius, 60 + rng() * 60, Math.sin(angle) * radius);
    mesh.scale.set(5 + rng() * 9, 220 + rng() * 120, 1);
    mesh.rotation.z = (rng() - 0.5) * 0.18;
    mesh.userData.raildIgnoreOcclusion = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    shafts.push({ mesh, offset, phase: rng() * Math.PI * 2 });
  }
  group.userData.raildIgnoreOcclusion = true;
  return {
    group,
    update(cameraPos: Vector3, elapsed: number) {
      for (const shaft of shafts) {
        shaft.mesh.position.copy(cameraPos).add(shaft.offset);
        shaft.mesh.position.x += Math.sin(elapsed * 0.07 + shaft.phase) * 6;
        shaft.mesh.position.z += Math.cos(elapsed * 0.05 + shaft.phase) * 6;
        // Face the camera around the vertical axis.
        shaft.mesh.rotation.y = Math.atan2(cameraPos.x - shaft.mesh.position.x, cameraPos.z - shaft.mesh.position.z);
      }
    },
  };
}

// ---- plankton -------------------------------------------------------------------------------------

function createPlankton(rng: Rng) {
  const COUNT = 700;
  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const SPAN = 70;
  const local: Vector3[] = [];
  for (let i = 0; i < COUNT; i += 1) {
    const offset = new Vector3((rng() - 0.5) * SPAN * 2, (rng() - 0.5) * SPAN, (rng() - 0.5) * SPAN * 2);
    local.push(offset);
    const warm = rng();
    const intensity = 0.25 + rng() * 0.6;
    colors[i * 3] = intensity * (warm > 0.75 ? 0.95 : 0.55);
    colors[i * 3 + 1] = intensity * 0.95;
    colors[i * 3 + 2] = intensity * (warm > 0.75 ? 0.6 : 0.8);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial(additiveMaterialParameters({
    size: 0.42,
    vertexColors: true,
    sizeAttenuation: true,
    opacity: 0.75,
    fog: true,
  }));
  material.transparent = true;
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.userData.raildIgnoreOcclusion = true;
  const center = new Vector3();
  const positionAttribute = geometry.attributes.position as BufferAttribute;
  const scratch = new Vector3();

  return {
    points,
    update(dt: number, cameraPos: Vector3, forward: Vector3, speed: number) {
      // Keep the cloud centred a little ahead of the camera; wrap motes that fall
      // behind so the field is endless. Slow upward drift: the water is alive.
      center.copy(cameraPos).addScaledVector(forward, SPAN * 0.5);
      for (let i = 0; i < COUNT; i += 1) {
        const offset = local[i];
        offset.y += dt * (0.35 + speed * 0.1);
        scratch.copy(center).add(offset);
        const behind = scratch.clone().sub(cameraPos).dot(forward);
        if (behind < -18 || Math.abs(offset.y) > SPAN * 0.5 || Math.abs(offset.x) > SPAN || Math.abs(offset.z) > SPAN) {
          offset.set((rng() - 0.5) * SPAN * 2, (rng() - 0.5) * SPAN, (rng() - 0.5) * SPAN * 2);
          scratch.copy(center).add(offset);
        }
        positionAttribute.setXYZ(i, scratch.x, scratch.y, scratch.z);
      }
      positionAttribute.needsUpdate = true;
    },
  };
}
