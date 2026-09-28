import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  BufferGeometry,
  Fog,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  cameraPosition,
  float,
  mix,
  positionLocal,
  positionView,
  positionWorld,
  smoothstep,
  time,
  uv,
  vec3,
} from 'three/tsl';
import { offsetFromRail } from '../../../engine/rail';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { STRANDLINE_TIMELINE } from '../gameplay';
import {
  BELL,
  CLIMB_FRACTION,
  createStrandlineRail,
  JELLY_MATRIX,
  RAIL_END_Y,
  RAIL_START_Y,
  strandlineRunProgress,
  SUN_DIRECTION,
  TIP_Y,
  toLocal,
  toWorld,
} from '../world';
import { createBell } from './jelly';
import {
  BELL_GOLD,
  mulberry32,
  SHAFT,
  SNOW,
  STRAND_DIM,
  STRAND_GOLD,
  STRAND_GREEN,
  VIOLET,
  VIOLET_DARK,
  VIOLET_HOT,
  WATER_CLEAN_TOP,
  WATER_DEEP,
  WATER_FOG,
  WATER_MID,
  WATER_TOP,
} from './palette';
import { buildStrandGeometry, strandCenter, strandClearOfRail, trimRootToChamber, type StrandRange, type StrandSpec } from './strands';
import { cleanseU, clarityU, gloomU, infectionU, pulseU, vitalityU } from './uniforms';

const AMBIENT_STRANDS = 200;
const CURTAIN_STRANDS = 96;
const SHAFT_COUNT = 28;
const SNOW_COUNT = 2600;
const PUSTULE_SITES = 84;

export type Environment = {
  root: Group;
  /** World-space anchors of the latched parasites' strands, by latch order. */
  heroAnchors: Vector3[];
  update(dt: number, camera: PerspectiveCamera, state: EnvironmentState): void;
  cleanseHero(index: number): void;
  dispose(): void;
};

export type EnvironmentState = {
  running: boolean;
  runTime: number;
  vitality: number;
  infection: number;
  cleanse: number;
  /** 0 open water … 1 the parent's chamber. */
  gloom: number;
  /** 0 normal … 1 the pull-back: fog thins so the whole animal shows. */
  reveal: number;
  vista: number;
};

export function createEnvironment(scene: Scene): Environment {
  scene.background = WATER_DEEP.clone();
  scene.fog = new Fog(WATER_FOG.clone(), 24, 235);
  const root = new Group();
  // Everything that lives on the jelly sits in its own frame.
  const jelly = new Group();
  jelly.matrixAutoUpdate = false;
  jelly.matrix.copy(JELLY_MATRIX);
  jelly.matrixWorldNeedsUpdate = true;
  root.add(jelly);

  const rng = mulberry32(20260905);
  const rail = createStrandlineRail();

  const dome = createWaterDome();
  root.add(dome.mesh);

  const bell = createBell();
  jelly.add(bell.group);

  const strandMaterial = createStrandMaterial();
  const ambient = createAmbientStrands(rng, strandMaterial);
  jelly.add(ambient.mesh);
  const hero = createHeroStrands(rail, strandMaterial);
  jelly.add(hero.mesh);
  const pustules = createPustules(rng, ambient.specs);
  jelly.add(pustules.group);
  const tips = createTipBeads(rng, ambient.specs);
  jelly.add(tips);

  const shafts = createShafts(rng, rail);
  root.add(shafts);
  const snow = createSnow(rng, rail);
  root.add(snow);

  scene.add(root);

  const fogFrom = WATER_FOG.clone();
  const fogClean = new Color(0.14, 0.52, 0.62);
  const fogGloom = new Color(0.05, 0.03, 0.14);
  const topColor = WATER_TOP.clone();

  return {
    root,
    heroAnchors: hero.anchors,
    update(dt, camera, state) {
      dome.update(camera);
      vitalityU.value = state.vitality;
      infectionU.value = state.infection;
      cleanseU.value = state.cleanse;
      clarityU.value = Math.max(state.vista, state.reveal);
      dome.setClean(state.cleanse * 0.6 + state.vitality * 0.35, state.vitality);
      gloomU.value = state.gloom;
      shafts.userData.intensity.value = (0.55 + state.vitality * 0.8 + state.cleanse * 0.6) * (1 - state.gloom * 0.85);
      hero.update(dt);
      pustules.update(dt, state.vitality + state.cleanse);

      // Fog thickens the deep and thins for the moon and the final reveal.
      const fog = scene.fog as Fog;
      const open = Math.max(state.vista * 0.55, state.reveal);
      fog.near = MathUtils.lerp(24, 220, open);
      fog.far = MathUtils.lerp(235, 1700, open);
      fog.color.copy(fogFrom).lerp(fogClean, Math.max(state.cleanse * 0.8, state.reveal * 0.5)).lerp(fogGloom, state.gloom * 0.75);
      void topColor;
    },
    cleanseHero: (index) => hero.cleanse(index),
    dispose() {
      scene.remove(root);
      scene.fog = null;
      bell.dispose();
    },
  };
}

// ---- water --------------------------------------------------------------------------

function createWaterDome() {
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, depthTest: false, fog: false });
  const dir = positionLocal.normalize();
  const h = dir.y;
  const clean = float(0);
  const top = mix(vec3(WATER_TOP.r, WATER_TOP.g, WATER_TOP.b), vec3(WATER_CLEAN_TOP.r, WATER_CLEAN_TOP.g, WATER_CLEAN_TOP.b), cleanseU_dome.mul(1));
  const deep = vec3(WATER_DEEP.r, WATER_DEEP.g, WATER_DEEP.b);
  const mid = vec3(WATER_MID.r, WATER_MID.g, WATER_MID.b);
  let color = mix(deep, mid, smoothstep(float(-0.7), float(-0.02), h));
  color = mix(color, top, smoothstep(float(-0.04), float(0.92), h));
  // Sun: a broad green-gold bloom of light in the direction of the surface glare.
  const sunDot = dir.dot(vec3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z)).max(0);
  color = color
    .add(vec3(0.05, 0.11, 0.08).mul(sunDot.pow(4)))
    .add(vec3(0.24, 0.24, 0.12).mul(sunDot.pow(40)));
  // Slow caustic shimmer high in the water.
  const shimmer = dir.x.mul(23).add(dir.z.mul(17)).add(time.mul(0.35)).sin().mul(dir.z.mul(9).sub(time.mul(0.22)).sin()).mul(0.5).add(0.5);
  color = color.add(vec3(0.03, 0.06, 0.05).mul(shimmer).mul(smoothstep(float(0.2), float(0.9), h)));
  void clean;
  color = color.mul(domeLiftU.mul(0.85).add(0.42).mul(float(1).sub(gloomU.mul(0.5))));
  color = color.add(vec3(0.05, 0.0, 0.09).mul(gloomU));
  material.colorNode = color;

  const mesh = new Mesh(new SphereGeometry(1, 40, 24), material);
  mesh.scale.setScalar(2500);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;
  return {
    mesh,
    update(camera: PerspectiveCamera) {
      mesh.position.copy(camera.position);
    },
    setClean(value: number, lift: number) {
      cleanseU_dome.value = MathUtils.clamp(value, 0, 1);
      domeLiftU.value = lift;
    },
  };
}

import { uniform } from 'three/tsl';
const cleanseU_dome = uniform(0);
const domeLiftU = uniform(0.2);

// ---- strands ---------------------------------------------------------------------------

function createStrandMaterial() {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, side: DoubleSide });
  const aux = attribute<'vec3'>('aux', 'vec3');
  const base = attribute<'vec3'>('strandColor', 'vec3');
  const phase = aux.y;
  const blight = aux.z;

  // Beads of light travel up every strand toward the bell — faster and brighter
  // as more of the animal comes back to life.
  const wave = positionLocal.y.mul(0.0105).sub(time.mul(0.11).add(vitalityU.mul(0.2))).add(phase).fract();
  const beadDistance = positionView.z.negate();
  const bead = wave.mul(Math.PI).sin().max(0).pow(46).mul(smoothstep(float(12), float(60), beadDistance).mul(0.9).add(0.1));
  const slow = positionLocal.y.mul(0.0031).sub(time.mul(0.05)).add(phase.mul(3.1)).fract().mul(Math.PI).sin().max(0).pow(10);
  const life = vitalityU.mul(0.75).add(0.25);

  const gold = vec3(STRAND_GOLD.r, STRAND_GOLD.g, STRAND_GOLD.b);
  const green = vec3(STRAND_GREEN.r, STRAND_GREEN.g, STRAND_GREEN.b);
  const dim = vec3(STRAND_DIM.r, STRAND_DIM.g, STRAND_DIM.b);
  const violet = vec3(VIOLET.r * 0.9, VIOLET.g * 0.7, VIOLET.b * 1.0);
  const hot = vec3(VIOLET_HOT.r, VIOLET_HOT.g, VIOLET_HOT.b);

  const sick = blight.mul(float(1).sub(cleanseU)).mul(time.mul(3.4).add(phase.mul(19)).sin().mul(0.18).add(0.82));
  let color = mix(dim, base.mul(green).mul(0.85), life);
  color = mix(color, gold, bead.mul(0.85).add(slow.mul(0.08)).mul(life).clamp(0, 1));
  color = color.add(gold.mul(bead).mul(life).mul(0.95)).add(green.mul(slow).mul(life).mul(0.35));
  color = mix(color, violet, sick.clamp(0, 1));
  color = color.add(hot.mul(sick.pow(3)).mul(0.5));
  color = mix(color, gold.mul(1.1), cleanseU.mul(0.3));
  // the heartbeat runs through every strand
  material.colorNode = color.mul(float(1).sub(gloomU.mul(0.4))).mul(cleanseU.mul(0.5).add(1)).mul(pulseU.mul(0.28).add(1));

  const dist = positionView.z.negate();
  const fade = dist.mul(float(-0.0105).mul(float(1).sub(clarityU.mul(0.85)))).exp().mul(smoothstep(float(2.5), float(13), dist).mul(0.8).add(0.2));
  material.opacityNode = fade.mul(smoothstep(float(0), float(22), aux.x)).mul(life.mul(0.3).add(0.32)).mul(float(1).add(sick.mul(0.5))).clamp(0, 0.9);
  return material;
}

function createAmbientStrands(rng: () => number, material: MeshBasicNodeMaterial) {
  const specs: StrandSpec[] = [];
  const depthSpan = -TIP_Y;
  function pickClear(make: () => StrandSpec, tries?: number, allowNull?: false): StrandSpec;
  function pickClear(make: () => StrandSpec, tries: number, allowNull: true): StrandSpec | null;
  function pickClear(make: () => StrandSpec, tries = 220, allowNull = false): StrandSpec | null {
    let last = make();
    for (let attempt = 0; attempt < tries; attempt += 1) {
      if (strandClearOfRail(last, last.clearance)) return last;
      last = make();
    }
    return allowNull ? null : last;
  }
  const tint = (t: number) => new Color().copy(STRAND_GREEN).lerp(STRAND_GOLD, t * 0.35).multiplyScalar(0.8 + rng() * 0.4);

  for (let i = 0; i < AMBIENT_STRANDS; i += 1) {
    const make = (): StrandSpec => {
      const radial = 48 * Math.pow(rng(), 0.74);
      const angle = rng() * Math.PI * 2;
      const yRoot = innerBellY(radial) - 1;
      const fraction = 0.4 + 0.6 * rng();
      return {
        x0: Math.cos(angle) * radial,
        z0: Math.sin(angle) * radial,
        yRoot,
        yEnd: yRoot - depthSpan * fraction * 1.02,
        radiusRoot: 0.32 + rng() * 0.38,
        radiusTip: 0.07 + rng() * 0.07,
        flare: 0.18 + rng() * 0.2,
        sway: [1.6 + rng() * 3.2, 70 + rng() * 90, rng() * 6.28, 1 + rng() * 2.2, 130 + rng() * 120, rng() * 6.28],
        color: tint(rng()),
        phase: rng(),
        clearance: 3.8,
      };
    };
    specs.push(pickClear(make));
  }
  for (const spec of specs) trimRootToChamber(spec);

  // The margin curtain: a ring of long, pale tentacles hanging from the bell's rim.
  for (let i = 0; i < CURTAIN_STRANDS; i += 1) {
    const base = (i / CURTAIN_STRANDS) * Math.PI * 2;
    const make = (): StrandSpec => {
      const angle = base + (rng() - 0.5) * 0.12;
      const radial = BELL.radius - 8 + rng() * 6;
      const yRoot = BELL.marginY - 2;
      return {
        x0: Math.cos(angle) * radial,
        z0: Math.sin(angle) * radial,
        yRoot,
        yEnd: yRoot - 110 - rng() * 190,
        radiusRoot: 0.5 + rng() * 0.3,
        radiusTip: 0.1,
        flare: 0.03,
        sway: [2 + rng() * 3, 90 + rng() * 80, rng() * 6.28, 1.4, 160 + rng() * 100, rng() * 6.28],
        color: new Color().copy(STRAND_GREEN).lerp(STRAND_GOLD, 0.25).multiplyScalar(0.7 + rng() * 0.3),
        phase: rng(),
        clearance: 3.4,
      };
    };
    // Where the rail parts the curtain there is simply a gap.
    const spec = pickClear(make, 24, true);
    if (spec) specs.push(spec);
  }

  const { geometry } = buildStrandGeometry(specs, 6);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.userData.raildIgnoreOcclusion = true;
  return { mesh, specs };
}

/** Local y of the subumbrella at radius r (where strands root). */
function innerBellY(r: number) {
  const innerR = BELL.radius - 10;
  const innerH = BELL.height - BELL.thicknessAtApex;
  const k = MathUtils.clamp(r / innerR, 0, 0.999);
  return BELL.center.y + innerH * Math.sqrt(1 - k * k);
}

function createHeroStrands(rail: ReturnType<typeof createStrandlineRail>, material: MeshBasicNodeMaterial) {
  const anchors: Vector3[] = [];
  const specs: StrandSpec[] = [];
  const rng = mulberry32(90210);
  for (const entry of STRANDLINE_TIMELINE) {
    const data = entry.data;
    if (data.role !== 'clamper' && data.role !== 'brooder') continue;
    const u = strandlineRunProgress(entry.time + data.lead);
    const world = offsetFromRail(rail, u, new Vector3(data.x, data.y, 0));
    const local = toLocal(world);
    anchors.push(world);
    const pinY = local.y;
    const brooder = data.role === 'brooder';
    const make = (): StrandSpec => ({
      x0: local.x,
      z0: local.z,
      yRoot: Math.min(innerBellY(Math.hypot(local.x, local.z)) - 1, pinY + 120),
      yEnd: Math.max(TIP_Y, pinY - 130),
      radiusRoot: brooder ? 0.6 : 0.45,
      radiusTip: 0.2,
      flare: 0,
      sway: [1.4 + rng() * 2.6, 60 + rng() * 80, rng() * 6.28, 0.8 + rng(), 120 + rng() * 60, rng() * 6.28],
      color: new Color().copy(STRAND_GREEN).lerp(STRAND_GOLD, 0.15).multiplyScalar(1.05),
      phase: rng(),
      clearance: 3.2,
      pin: { x: local.x, y: pinY, z: local.z, falloff: 40 },
      blight: (y) => Math.exp(-(((y - pinY) / 11) ** 2)),
    });
    let spec = make();
    for (let attempt = 0; attempt < 120 && !strandClearOfRail(spec, spec.clearance); attempt += 1) spec = make();
    specs.push(spec);
  }
  const { geometry, ranges } = buildStrandGeometry(specs, 5);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.userData.raildIgnoreOcclusion = true;
  const auxAttribute = geometry.getAttribute('aux') as Float32BufferAttribute;
  const progress = ranges.map(() => 0);
  const active = new Set<number>();
  const applyRange = (index: number) => {
    const range: StrandRange = ranges[index];
    const k = 1 - progress[index];
    for (let i = 0; i < range.count; i += 1) auxAttribute.setZ(range.start + i, range.blightBase[i] * k);
    auxAttribute.needsUpdate = true;
  };
  return {
    mesh,
    anchors,
    update(dt: number) {
      for (const index of active) {
        progress[index] = Math.min(1, progress[index] + dt * 0.8);
        applyRange(index);
        if (progress[index] >= 1) active.delete(index);
      }
    },
    cleanse(index: number) {
      if (index < 0 || index >= ranges.length || progress[index] >= 1) return;
      active.add(index);
    },
  };
}

// ---- decor: parasite pustules on the background strands -----------------------------------

function createPustules(rng: () => number, specs: StrandSpec[]) {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;
  const sites: Array<{ position: Vector3; radius: number; threshold: number; scale: number; color: Color }> = [];
  const pool = specs.slice(0, AMBIENT_STRANDS);
  for (let i = 0; i < PUSTULE_SITES; i += 1) {
    const spec = pool[Math.floor(rng() * pool.length)];
    const y = MathUtils.lerp(RAIL_START_Y + 20, RAIL_END_Y - 8, Math.pow(rng(), 0.9));
    if (y > spec.yRoot - 4 || y < spec.yEnd + 4) continue;
    const c = strandCenter(spec, y);
    const cluster = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < cluster; k += 1) {
      sites.push({
        position: new Vector3(c.x + (rng() - 0.5) * 1.4, y + (rng() - 0.5) * 3, c.z + (rng() - 0.5) * 1.4),
        radius: 0.4 + rng() * 0.6,
        threshold: 0.12 + rng() * 0.8,
        scale: 1,
        color: new Color().copy(VIOLET_DARK).multiplyScalar(1.6 + rng() * 1.0).lerp(new Color(0.16, 0.22, 0.3), 0.35),
      });
    }
  }
  const body = new InstancedMesh(new SphereGeometry(1, 9, 7), new MeshBasicMaterial({ color: 0xffffff }), sites.length);
  const glow = new InstancedMesh(new SphereGeometry(1, 6, 5), new MeshBasicMaterial(additiveMaterialParameters({ color: 0xffffff })), sites.length);
  body.frustumCulled = false;
  glow.frustumCulled = false;
  body.userData.raildIgnoreOcclusion = true;
  glow.userData.raildIgnoreOcclusion = true;
  const matrix = new Matrix4();
  const scale = new Vector3();
  const identity = new Quaternion();
  const hotColor = new Color();
  sites.forEach((site, index) => {
    body.setColorAt(index, site.color);
    glow.setColorAt(index, hotColor.copy(VIOLET_HOT).multiplyScalar(0.08));
  });
  group.add(body, glow);
  let clock = 0;
  const write = () => {
    sites.forEach((site, index) => {
      const s = site.radius * site.scale;
      scale.setScalar(Math.max(0.0001, s));
      matrix.compose(site.position, identity, scale);
      body.setMatrixAt(index, matrix);
      scale.setScalar(Math.max(0.0001, s * (0.5 + 0.12 * Math.sin(clock * 3 + index))));
      matrix.compose(site.position, identity, scale);
      glow.setMatrixAt(index, matrix);
    });
    body.instanceMatrix.needsUpdate = true;
    glow.instanceMatrix.needsUpdate = true;
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
  };
  write();
  return {
    group,
    update(dt: number, recovery: number) {
      clock += dt;
      for (const site of sites) {
        const target = recovery > site.threshold ? 0 : 1;
        site.scale += (target - site.scale) * Math.min(1, dt * 1.6);
      }
      write();
    },
  };
}

// ---- glow beads at the strands' tips ---------------------------------------------------------

function createTipBeads(rng: () => number, specs: StrandSpec[]) {
  const geometries: BufferGeometry[] = [];
  const bead = new SphereGeometry(0.55, 6, 5);
  const scratch = { x: 0, z: 0 };
  const matrix = new Matrix4();
  for (const spec of specs.slice(0, AMBIENT_STRANDS)) {
    if (rng() < 0.5) continue;
    strandCenter(spec, spec.yEnd, scratch);
    geometries.push(bead.clone().applyMatrix4(matrix.makeTranslation(scratch.x, spec.yEnd, scratch.z)));
  }
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  const dist = positionView.z.negate();
  material.colorNode = vec3(STRAND_GOLD.r, STRAND_GOLD.g, STRAND_GOLD.b)
    .mul(time.mul(1.7).add(positionLocal.x.mul(0.3)).sin().mul(0.3).add(0.9))
    .mul(vitalityU.mul(1.6).add(0.3));
  material.opacityNode = dist.mul(-0.006).exp();
  const mesh = new Mesh(mergeGeometries(geometries), material);
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;
  for (const geometry of geometries) geometry.dispose();
  return mesh;
}

// ---- god rays --------------------------------------------------------------------------------

function createShafts(rng: () => number, rail: ReturnType<typeof createStrandlineRail>) {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;
  const intensity = uniform(0.6);
  group.userData.intensity = intensity;

  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false });
  const coord = uv();
  const across = coord.x.mul(Math.PI).sin().max(0).pow(2.2);
  const along = coord.y.pow(1.3).mul(float(1).sub(coord.y.sub(0.96).max(0).mul(20)).max(0));
  const flicker = time.mul(0.45).add(positionWorld.x.mul(0.05)).add(positionWorld.z.mul(0.035)).sin().mul(0.3).add(0.7);
  const dist = positionView.z.negate();
  const near = smoothstep(float(4), float(38), dist);
  const far = dist.mul(-0.004).exp();
  material.colorNode = vec3(SHAFT.r, SHAFT.g, SHAFT.b).mul(across).mul(along).mul(flicker).mul(near).mul(far).mul(intensity).mul(0.11);

  const plane = new PlaneGeometry(1, 1, 1, 1).translate(0, 0.5, 0);
  const crossPlane = plane.clone().rotateY(Math.PI / 2);
  const geometry = mergeGeometries([plane, crossPlane]);
  const up = new Vector3(0, 1, 0);
  const orientation = new Quaternion().setFromUnitVectors(up, SUN_DIRECTION);
  const matrix = new Matrix4();
  for (let i = 0; i < SHAFT_COUNT; i += 1) {
    const u = rng() * 0.97 * CLIMB_FRACTION;
    const point = rail.getPointAt(u);
    const angle = rng() * Math.PI * 2;
    const offset = 22 + rng() * 80;
    const base = point.clone().add(new Vector3(Math.cos(angle) * offset, -30 - rng() * 30, Math.sin(angle) * offset));
    const width = 6 + rng() * 14;
    const length = 240 + rng() * 140;
    const mesh = new Mesh(geometry, material);
    mesh.position.copy(base);
    mesh.quaternion.copy(orientation);
    mesh.quaternion.multiply(new Quaternion().setFromAxisAngle(up, rng() * Math.PI));
    mesh.scale.set(width, length, width);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    group.add(mesh);
  }
  void matrix;
  return group;
}

// ---- marine snow --------------------------------------------------------------------------------

function createSnow(rng: () => number, rail: ReturnType<typeof createStrandlineRail>) {
  const positions = new Float32Array(SNOW_COUNT * 3);
  const colors = new Float32Array(SNOW_COUNT * 3);
  for (let i = 0; i < SNOW_COUNT; i += 1) {
    const u = Math.pow(rng(), 0.92) * 0.985 * CLIMB_FRACTION;
    const point = rail.getPointAt(u);
    const angle = rng() * Math.PI * 2;
    const radius = 5 + rng() * 70;
    positions[i * 3] = point.x + Math.cos(angle) * radius;
    positions[i * 3 + 1] = point.y + (rng() - 0.5) * 90;
    positions[i * 3 + 2] = point.z + Math.sin(angle) * radius;
    const intensity = 0.16 + rng() * 0.4;
    colors[i * 3] = SNOW.r * intensity;
    colors[i * 3 + 1] = SNOW.g * intensity;
    colors[i * 3 + 2] = SNOW.b * intensity;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial(additiveMaterialParameters({ size: 0.34, vertexColors: true, sizeAttenuation: true, fog: false }));
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.userData.raildIgnoreOcclusion = true;
  return points;
}

void Object3D;
void BELL_GOLD;
void toWorld;
void pulseU;
void VIOLET_HOT;
void cameraPosition;
