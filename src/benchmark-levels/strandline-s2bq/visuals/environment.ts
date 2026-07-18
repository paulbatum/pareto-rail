import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  float,
  fract,
  mix,
  mx_noise_float,
  positionLocal,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import { scatterAlongRail } from '../../../engine/environment-kit';
import { offsetFromRail } from '../../../engine/rail';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  BELL_CENTER,
  BELL_RADIUS,
  bar,
  createStrandlineRail,
  railU,
  strandlineRunProgress,
} from '../gameplay';
import { BROOD_TOTAL } from '../matriarch';
import {
  ABYSS_BLUE,
  BIO_GOLD,
  BIO_GREEN,
  DEEP_BLUE,
  JELLY_FLESH,
  MID_BLUE,
  PARASITE_HOT,
  PARASITE_VIOLET,
  STRAND_GLOW,
  SUNLIT_TEAL,
  SUN_GOLD,
  WARM_WHITE,
  hdr,
  mulberry32,
  type Rng,
} from './palette';

// Shared shader knobs, written by the runtime every frame.
export const beatUniform = uniform(0); // beat energy 0..~1.6
export const cleanseUniform = uniform(0); // 0 infested → 1 every strand runs clean
export const sunUniform = uniform(1); // how much of the surface light survives here

const SUN_DIRECTION = new Vector3(0.28, 0.9, -0.34).normalize();

export type Environment = {
  root: Group;
  crownPoint: Vector3;
  update(dt: number, frame: EnvironmentFrame): void;
};

export type EnvironmentFrame = {
  camera: PerspectiveCamera;
  elapsed: number;
  runTime: number;
  running: boolean;
  speed: number;
  beatEnergy: number;
  cleanse: number; // 0..1 — broods and Matriarch cleared
  broodsAlive: boolean[];
  bossDead: boolean;
};

// Water keyframes over run progress: the color script of the level. Sunlit
// teal in the strands, bluer and deeper toward the crown, then — freed —
// clean and light again for the pull-back.
type WaterKey = { p: number; near: Color; far: Color; fog: number; sun: number };

function buildWaterKeys(): WaterKey[] {
  const at = (barTime: number) => strandlineRunProgress(barTime);
  return [
    { p: 0, near: SUNLIT_TEAL, far: DEEP_BLUE, fog: 0.011, sun: 1 },
    { p: at(bar(7.6)), near: SUNLIT_TEAL.clone().multiplyScalar(1.1), far: DEEP_BLUE, fog: 0.0085, sun: 1.15 },
    { p: at(bar(10)), near: MID_BLUE, far: DEEP_BLUE, fog: 0.012, sun: 0.8 },
    { p: at(bar(14.5)), near: MID_BLUE.clone().lerp(DEEP_BLUE, 0.4), far: ABYSS_BLUE, fog: 0.0135, sun: 0.6 },
    { p: at(bar(18)), near: DEEP_BLUE, far: ABYSS_BLUE, fog: 0.012, sun: 0.5 },
    { p: at(bar(22)), near: MID_BLUE, far: DEEP_BLUE, fog: 0.008, sun: 0.85 },
    { p: 1, near: SUNLIT_TEAL.clone().lerp(MID_BLUE, 0.35), far: DEEP_BLUE, fog: 0.005, sun: 1.1 },
  ];
}

const NEAR_SCRATCH = new Color();
const FAR_SCRATCH = new Color();

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = DEEP_BLUE.clone();
  scene.fog = new FogExp2(MID_BLUE.clone(), 0.011);

  const root = new Group();
  const rng = mulberry32(20260718);
  const curve = createStrandlineRail();
  const waterKeys = buildWaterKeys();
  const crownPoint = offsetFromRail(curve, strandlineRunProgress(bar(21.9)), new Vector3(0, 11.5, 0));

  const dome = createWaterDome();
  root.add(dome);

  const shafts = createLightShafts(rng);
  root.add(shafts.group);

  const strandField = createStrandForest(rng, curve);
  root.add(strandField.group);

  const motes = createMoteClusters(rng, curve);
  root.add(motes.group);

  const bell = createBell(rng);
  root.add(bell.group);

  const webbing = createWebbing(rng, crownPoint);
  root.add(webbing.group);

  scene.add(root);

  function applyWater(progress: number) {
    let a = waterKeys[0];
    let b = waterKeys[waterKeys.length - 1];
    for (let i = 1; i < waterKeys.length; i += 1) {
      if (progress <= waterKeys[i].p) {
        a = waterKeys[i - 1];
        b = waterKeys[i];
        break;
      }
      a = waterKeys[i];
      b = waterKeys[i];
    }
    const span = Math.max(0.0001, b.p - a.p);
    const t = Math.min(1, Math.max(0, (progress - a.p) / span));
    NEAR_SCRATCH.copy(a.near).lerp(b.near, t);
    FAR_SCRATCH.copy(a.far).lerp(b.far, t);
    // The cleansed animal lends the water its own green-gold.
    const clean = cleanseUniform.value as number;
    NEAR_SCRATCH.lerp(new Color(0.2, 0.55, 0.5), clean * 0.25);
    (scene.background as Color).copy(FAR_SCRATCH);
    const fog = scene.fog as FogExp2;
    fog.color.copy(NEAR_SCRATCH).lerp(FAR_SCRATCH, 0.45);
    fog.density = (a.fog + (b.fog - a.fog) * t) * (1 - clean * 0.25);
    sunUniform.value = (a.sun + (b.sun - a.sun) * t) * (1 + clean * 0.2);
  }

  return {
    root,
    crownPoint,
    update(dt, frame) {
      const cameraPos = frame.camera.position;
      const progress = frame.running ? strandlineRunProgress(frame.runTime) : 0;

      applyWater(progress);

      dome.position.copy(cameraPos);
      shafts.update(dt, cameraPos, frame.elapsed);
      strandField.update(progress, dt, frame.elapsed);
      motes.update(progress, dt);
      bell.update(dt, frame);
      webbing.update(dt, frame);
    },
  };
}

// ---- the water itself ------------------------------------------------------------

function createWaterDome() {
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
  const direction = positionLocal.normalize();
  const up = smoothstep(float(-0.25), float(0.75), direction.y);
  const nearColor = vec3(SUNLIT_TEAL.r, SUNLIT_TEAL.g, SUNLIT_TEAL.b);
  const deepColor = vec3(ABYSS_BLUE.r, ABYSS_BLUE.g, ABYSS_BLUE.b);
  let color = mix(deepColor, nearColor, up.pow(1.4).mul(sunUniform.clamp(0, 1.4)));
  // The surface far overhead: a caustic shimmer that never fully resolves.
  const shimmer = mx_noise_float(direction.mul(9).add(vec3(time.mul(0.05), 0, time.mul(0.035))))
    .mul(0.5)
    .add(mx_noise_float(direction.mul(23).add(vec3(0, time.mul(0.07), 0))).mul(0.25));
  color = color.add(vec3(0.35, 0.5, 0.42).mul(shimmer.max(0)).mul(up.pow(3)).mul(sunUniform).mul(0.5));
  // Sunball: the bright blur where the light comes from.
  const sunGlow = direction.dot(vec3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z)).max(0).pow(24);
  color = color.add(vec3(0.9, 0.85, 0.6).mul(sunGlow).mul(sunUniform).mul(0.55));
  material.colorNode = color;
  const dome = new Mesh(new SphereGeometry(430, 36, 24), material);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  dome.userData.raildIgnoreOcclusion = true;
  return dome;
}

// ---- god rays ---------------------------------------------------------------------

function createLightShafts(rng: Rng) {
  const group = new Group();
  const geometry = new PlaneGeometry(1, 1);
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
  });
  // A soft-edged blade of light, brightest at the top, gone at the bottom.
  const edge = smoothstep(float(0), float(0.34), uv().x).mul(smoothstep(float(1), float(0.66), uv().x));
  const falloff = smoothstep(float(0.02), float(0.85), uv().y);
  material.colorNode = vec3(0.5, 0.62, 0.5)
    .mul(edge.mul(falloff))
    .mul(sunUniform.mul(0.16).add(beatUniform.mul(0.012)));

  const shafts: Array<{ mesh: Mesh; offset: Vector3; spin: number }> = [];
  for (let i = 0; i < 7; i += 1) {
    const mesh = new Mesh(geometry, material);
    const width = 9 + rng() * 16;
    mesh.scale.set(width, 150, 1);
    const offset = new Vector3((rng() - 0.5) * 120, 62, -30 - rng() * 110);
    mesh.rotation.y = rng() * Math.PI;
    mesh.rotation.z = (rng() - 0.5) * 0.28;
    mesh.userData.raildIgnoreOcclusion = true;
    group.add(mesh);
    shafts.push({ mesh, offset, spin: (rng() - 0.5) * 0.05 });
  }

  return {
    group,
    update(dt: number, cameraPos: Vector3, _elapsed: number) {
      for (const shaft of shafts) {
        shaft.mesh.position.set(
          cameraPos.x + shaft.offset.x,
          cameraPos.y + shaft.offset.y,
          cameraPos.z + shaft.offset.z,
        );
        shaft.mesh.rotation.y += shaft.spin * dt;
      }
    },
  };
}

// ---- the strand forest -----------------------------------------------------------

// Each strand is one trailing tentacle: a long, gently bent tube with a
// bioluminescent pulse climbing it. The pulse rate and brightness grow with
// the cleanse — the animal coming back to life is literally the level
// getting brighter.
function makeStrandMaterial(phase: number) {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  const along = positionLocal.y.mul(0.011).add(phase);
  const chase = fract(along.sub(time.mul(0.13).add(cleanseUniform.mul(time).mul(0.1)))).pow(7);
  const base = float(0.16).add(cleanseUniform.mul(0.3)).add(beatUniform.mul(0.05));
  const glow = mix(
    vec3(STRAND_GLOW.r, STRAND_GLOW.g, STRAND_GLOW.b),
    vec3(BIO_GOLD.r, BIO_GOLD.g, BIO_GOLD.b),
    fract(along.mul(0.5)),
  ).mul(chase.mul(float(0.55).add(cleanseUniform.mul(0.9))).add(base));
  material.colorNode = glow;
  return material;
}

function makeStrandGeometry(rng: Rng, height: number) {
  const points: Vector3[] = [];
  const bendX = (rng() - 0.5) * 14;
  const bendZ = (rng() - 0.5) * 14;
  for (let i = 0; i <= 4; i += 1) {
    const t = i / 4;
    points.push(new Vector3(
      Math.sin(t * Math.PI) * bendX,
      (t - 0.5) * height,
      Math.sin(t * Math.PI * 0.7 + 1) * bendZ,
    ));
  }
  return new TubeGeometry(new CatmullRomCurve3(points), 12, 0.32 + rng() * 0.3, 6, false);
}

function createStrandForest(rng: Rng, curve: ReturnType<typeof createStrandlineRail>) {
  // Three material phases so neighbouring strands never pulse in sync.
  const materials = [makeStrandMaterial(0), makeStrandMaterial(0.37), makeStrandMaterial(0.71)];
  const revealFrom = railU(bar(7.2));
  const revealTo = railU(bar(9.8));

  const field = scatterAlongRail(curve, {
    count: 46,
    seed: 20260718,
    rng,
    window: { behind: 45, ahead: 190 },
    alignToRail: false,
    make(index, makeRng) {
      const strand = new Mesh(makeStrandGeometry(makeRng, 150 + makeRng() * 60), materials[index % materials.length]);
      strand.userData.raildIgnoreOcclusion = true;
      strand.userData.swayPhase = makeRng() * Math.PI * 2;
      strand.userData.swayRate = 0.24 + makeRng() * 0.18;
      return strand;
    },
    place(_index, placeRng) {
      let u = placeRng();
      // The reveal keeps its vista: strands there sit far off the rail.
      const inReveal = u > revealFrom && u < revealTo;
      const side = placeRng() < 0.5 ? -1 : 1;
      const radius = (inReveal ? 30 : 9) + placeRng() * (inReveal ? 26 : 30);
      return {
        u,
        offset: new Vector3(side * radius, (placeRng() - 0.5) * 24, 0),
      };
    },
    onUpdate(item, dt) {
      void dt;
      const phase = item.object.userData.swayPhase as number;
      const rate = item.object.userData.swayRate as number;
      item.object.rotation.z = Math.sin(performanceTime * rate + phase) * 0.06;
      item.object.rotation.x = Math.cos(performanceTime * rate * 0.7 + phase) * 0.04;
    },
  });

  let performanceTime = 0;

  return {
    group: field.group,
    update(progress: number, dt: number, elapsed: number) {
      performanceTime = elapsed;
      field.update(progress, dt);
    },
  };
}

// ---- marine snow -----------------------------------------------------------------

function createMoteClusters(rng: Rng, curve: ReturnType<typeof createStrandlineRail>) {
  const clusterGeometry = (clusterRng: Rng) => {
    const COUNT = 70;
    const positions = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i += 1) {
      positions[i * 3] = (clusterRng() - 0.5) * 44;
      positions[i * 3 + 1] = (clusterRng() - 0.5) * 34;
      positions[i * 3 + 2] = (clusterRng() - 0.5) * 44;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    return geometry;
  };
  const material = new PointsMaterial(additiveMaterialParameters({
    color: new Color(0.5, 0.62, 0.55),
    size: 0.09,
    sizeAttenuation: true,
    opacity: 0.6,
  }));
  material.fog = true;

  const field = scatterAlongRail(curve, {
    count: 8,
    seed: 20260719,
    rng,
    window: { behind: 30, ahead: 150 },
    alignToRail: false,
    make(_index, makeRng) {
      const points = new Points(clusterGeometry(makeRng), material);
      points.userData.raildIgnoreOcclusion = true;
      return points;
    },
    place(_index, placeRng) {
      return {
        u: placeRng(),
        offset: new Vector3((placeRng() - 0.5) * 30, (placeRng() - 0.5) * 16, 0),
      };
    },
    onUpdate(item, dt) {
      item.object.rotation.y += dt * 0.012;
    },
  });
  return field;
}

// ---- the bell ---------------------------------------------------------------------

// The animal itself: a vast dome of translucent flesh, rim frill, inner core
// light, and long trailing ribbons that visually seed the strand forest. It
// breathes on a two-bar period; freed, the breath brightens from murk-green
// to full green-gold.
function createBell(rng: Rng) {
  const group = new Group();
  group.position.copy(BELL_CENTER);

  // Dome flesh: translucent, deeper color toward the rim.
  const fleshMaterial = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const height = positionLocal.y.div(BELL_RADIUS).clamp(0, 1);
  const fleshColor = mix(
    vec3(JELLY_FLESH.r, JELLY_FLESH.g, JELLY_FLESH.b),
    vec3(BIO_GREEN.r, BIO_GREEN.g, BIO_GREEN.b),
    height.pow(2).mul(0.5),
  ).mul(float(0.4).add(cleanseUniform.mul(0.8)).add(beatUniform.mul(0.03)));
  fleshMaterial.colorNode = fleshColor;
  fleshMaterial.opacityNode = float(0.42).add(height.mul(0.2));
  const dome = new Mesh(new SphereGeometry(BELL_RADIUS, 40, 22, 0, Math.PI * 2, 0, Math.PI * 0.58), fleshMaterial);
  dome.userData.raildIgnoreOcclusion = true;
  group.add(dome);

  // Inner light: the heart of the animal, visible through the flesh.
  const heartMaterial = createAdditiveBasicMaterial({ color: hdr(BIO_GREEN, 0.35) });
  heartMaterial.fog = false;
  const heart = new Mesh(new SphereGeometry(BELL_RADIUS * 0.45, 24, 16), heartMaterial);
  heart.position.y = BELL_RADIUS * 0.3;
  heart.userData.raildIgnoreOcclusion = true;
  group.add(heart);

  // Rim frill: a wavy skirt of glow at the bell margin.
  const frillMaterial = createAdditiveBasicMaterial({ color: hdr(STRAND_GLOW, 0.5) });
  const frill = new Mesh(new TorusGeometry(BELL_RADIUS * 0.92, 2.6, 10, 60), frillMaterial);
  frill.rotation.x = Math.PI / 2;
  frill.position.y = BELL_RADIUS * 0.12;
  frill.userData.raildIgnoreOcclusion = true;
  group.add(frill);

  // Trailing ribbons: the tentacles this whole level lives inside, seen from
  // outside during the reveals.
  const ribbonMaterial = makeStrandMaterial(0.5);
  for (let i = 0; i < 14; i += 1) {
    const angle = (i / 14) * Math.PI * 2 + rng() * 0.3;
    const radius = BELL_RADIUS * (0.4 + rng() * 0.5);
    const ribbon = new Mesh(makeStrandGeometry(rng, 240 + rng() * 120), ribbonMaterial);
    ribbon.position.set(Math.cos(angle) * radius, -125 - rng() * 40, Math.sin(angle) * radius);
    ribbon.userData.raildIgnoreOcclusion = true;
    group.add(ribbon);
  }

  return {
    group,
    update(dt: number, frame: EnvironmentFrame) {
      void dt;
      // Breath: a two-bar swell. Freed, the pulse settles — slower, deeper.
      const period = bar(2) * (frame.bossDead ? 1.5 : 1);
      const phase = ((frame.running ? frame.runTime : frame.elapsed) % period) / period;
      const breath = Math.sin(phase * Math.PI * 2);
      const clean = frame.cleanse;
      group.scale.set(1 + breath * 0.025, 1 - breath * 0.035, 1 + breath * 0.025);
      group.position.copy(BELL_CENTER);
      group.position.y += breath * 2.2;
      heartMaterial.color.copy(hdr(BIO_GREEN.clone().lerp(BIO_GOLD, clean * 0.5), 0.22 + clean * 0.5 + Math.max(0, breath) * (0.1 + clean * 0.2)));
      frillMaterial.color.copy(hdr(STRAND_GLOW.clone().lerp(BIO_GOLD, clean * 0.4), 0.35 + clean * 0.55 + frame.beatEnergy * 0.06));
    },
  };
}

// ---- the Matriarch's webbing ------------------------------------------------------

// Six curtains of violet lattice fanned around the crown, one per brood.
// A brood's death kills the curtain it fed: it flickers, starves, and
// shrivels back into the crown over a couple of seconds.
function createWebbing(rng: Rng, crownPoint: Vector3) {
  const group = new Group();
  group.position.copy(crownPoint);
  group.visible = true;

  const curtains: Array<{ pivot: Group; material: LineBasicMaterial; life: number; flicker: number }> = [];
  for (let i = 0; i < BROOD_TOTAL; i += 1) {
    const angle = (i / BROOD_TOTAL) * Math.PI * 2 + 0.35;
    const pivot = new Group();
    const material = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(PARASITE_VIOLET, 0.8) }));
    const positions: number[] = [];
    // An irregular fan: spokes out and down, cross-threads between them.
    const spokes: Vector3[] = [];
    for (let s = 0; s < 5; s += 1) {
      const spread = (s / 4 - 0.5) * 1.1;
      const tip = new Vector3(
        Math.cos(angle + spread) * (11 + rng() * 7),
        -3 - rng() * 13,
        Math.sin(angle + spread) * (9 + rng() * 6),
      );
      spokes.push(tip);
      positions.push(0, 0, 0, tip.x, tip.y, tip.z);
    }
    for (let s = 0; s < spokes.length - 1; s += 1) {
      for (const k of [0.35, 0.7]) {
        const a = spokes[s].clone().multiplyScalar(k + (rng() - 0.5) * 0.08);
        const b = spokes[s + 1].clone().multiplyScalar(k + (rng() - 0.5) * 0.08);
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const lines = new LineSegments(geometry, material);
    lines.userData.raildIgnoreOcclusion = true;
    pivot.add(lines);
    group.add(pivot);
    curtains.push({ pivot, material, life: 1, flicker: rng() * Math.PI * 2 });
  }

  return {
    group,
    update(dt: number, frame: EnvironmentFrame) {
      let any = false;
      for (const [index, curtain] of curtains.entries()) {
        const alive = frame.broodsAlive[index] !== false && !frame.bossDead;
        curtain.life = Math.max(0, Math.min(1, curtain.life + (alive ? dt * 0.5 : -dt * 0.55)));
        const visible = curtain.life > 0.01;
        curtain.pivot.visible = visible;
        if (!visible) continue;
        any = true;
        const pulse = 0.55 + Math.max(0, Math.sin(frame.elapsed * 2.1 + curtain.flicker)) * 0.4;
        // Starving webbing gutters before it goes.
        const gutter = curtain.life < 0.6 ? 0.4 + Math.abs(Math.sin(frame.elapsed * 13 + curtain.flicker)) * 0.6 : 1;
        curtain.material.color.copy(hdr(PARASITE_VIOLET.clone().lerp(PARASITE_HOT, 0.25), (0.5 + pulse * 0.4) * gutter * curtain.life));
        curtain.pivot.scale.setScalar(0.25 + curtain.life * 0.75);
      }
      group.visible = any;
    },
  };
}

export { WARM_WHITE, SUN_GOLD };
