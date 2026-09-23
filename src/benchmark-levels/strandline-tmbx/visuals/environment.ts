import {
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  MathUtils,
  Scene,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import { mulberry32 } from '../../../engine/rng';
import { strandForest } from '../forest';
import {
  BELL_AXIS_X,
  BELL_AXIS_Z,
  BELL_HEIGHT,
  BELL_MARGIN_Y,
  BELL_RADIUS,
} from '../world';
import { createBellMesh, createBellUniforms, bellContraction } from './bell-mesh';
import {
  JELLY_DEEP,
  JELLY_GOLD,
  JELLY_GREEN,
  JELLY_SICK,
  PARASITE,
  PARASITE_HOT,
  SUNLIGHT,
  WATER_DEEP,
  WATER_FOG,
  WATER_MID,
  WATER_SURFACE,
  hdr,
} from './palette';
import { createStrandField, createStrandUniforms, type StrandField } from './strand-mesh';
import { createLightShafts, createMarineSnow, createWaterDome, createWaterUniforms, type ShaftPlacement } from './water';

// The world around the rail: the animal (bell + every strand), the water it
// hangs in, the light coming down through it. Placement decisions live here;
// construction lives in the leaves.

export const SUN_DIRECTION = new Vector3(0.22, 1, 0.3).normalize();

// ---- the environment ----------------------------------------------------------------------

export type EnvironmentState = {
  clock: number;
  beat: number;
  pulse: number;
  life: number;
  hostLife: number;
  bellVisibility: number;
  stain: number;
  strandFade: number;
  strandGlow: number;
  strandInflate: number;
  strandFlash: number;
  strandWaveAt: number;
  drift: Vector3;
  surface: Color;
  horizon: Color;
  abyss: Color;
  sunStrength: number;
  shafts: number;
  fogDensity: number;
  fogColor: Color;
};

export type Environment = {
  root: Group;
  jelly: Group;
  strands: StrandField;
  update(camera: PerspectiveCamera, state: EnvironmentState): void;
};

export function createEnvironment(scene: Scene): Environment {
  const root = new Group();
  scene.add(root);
  scene.background = WATER_MID.clone();
  scene.fog = new FogExp2(WATER_FOG.clone(), 0.0085);

  const hemi = new HemisphereLight(new Color(0.62, 0.92, 0.88), new Color(0.02, 0.07, 0.16), 1.25);
  const sun = new DirectionalLight(new Color(0.9, 1, 0.94), 1.8);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(200);
  root.add(hemi, sun, sun.target);

  const waterUniforms = createWaterUniforms({ surface: WATER_SURFACE, horizon: WATER_MID, abyss: WATER_DEEP, sunlight: SUNLIGHT });
  const dome = createWaterDome(470, SUN_DIRECTION, waterUniforms);
  root.add(dome);

  // The jellyfish: everything that drifts on together at the end.
  const jelly = new Group();
  root.add(jelly);

  const forest = strandForest();
  const strandUniforms = createStrandUniforms();
  const strands = createStrandField(forest.specs, forest.hosts, {
    sick: JELLY_SICK,
    healthy: JELLY_GREEN,
    band: JELLY_GOLD,
    infection: hdr(PARASITE, 1.6).lerp(PARASITE_HOT, 0.3),
    flash: new Color(1.0, 0.95, 0.6),
    radialSegments: 5,
    segmentLength: 6,
    beadFrequency: 0.55,
    beadSwell: 0.7,
    bandsPerStrand: 11,
  }, strandUniforms);
  jelly.add(strands.mesh);

  const bellUniforms = createBellUniforms();
  const bell = createBellMesh({
    radius: BELL_RADIUS,
    height: BELL_HEIGHT,
    body: JELLY_DEEP,
    rim: JELLY_GREEN.clone().multiplyScalar(0.85),
    canal: JELLY_GREEN.clone().lerp(JELLY_GOLD, 0.3),
    gonad: JELLY_GOLD,
    stain: PARASITE,
    canalCount: 16,
  }, bellUniforms);
  bell.group.position.set(BELL_AXIS_X, BELL_MARGIN_Y, BELL_AXIS_Z);
  jelly.add(bell.group);

  // Sun shafts slanting down through the whole animal.
  const shaftRng = mulberry32(0x5a4f7);
  const shafts: ShaftPlacement[] = [];
  for (let i = 0; i < 16; i += 1) {
    const angle = shaftRng() * Math.PI * 2;
    const radius = 40 + shaftRng() * 190;
    shafts.push({
      base: new Vector3(BELL_AXIS_X + Math.cos(angle) * radius, -170 + shaftRng() * 60, BELL_AXIS_Z + 60 + Math.sin(angle) * radius),
      radius: 1.5 + shaftRng() * 4,
      length: 420,
      strength: 0.5 + shaftRng() * 0.7,
      seed: shaftRng(),
    });
  }
  root.add(createLightShafts(shafts, SUN_DIRECTION, waterUniforms));
  root.add(createMarineSnow(900, 56, mulberry32(0x5e0), new Color(0.55, 0.8, 0.78), waterUniforms));

  const fog = scene.fog as FogExp2;

  return {
    root,
    jelly,
    strands,
    update(camera, state) {
      dome.position.copy(camera.position);
      waterUniforms.clock.value = state.clock;
      waterUniforms.surface.value.copy(state.surface);
      waterUniforms.horizon.value.copy(state.horizon);
      waterUniforms.abyss.value.copy(state.abyss);
      waterUniforms.sunStrength.value = state.sunStrength;
      waterUniforms.shafts.value = state.shafts;
      fog.density = state.fogDensity;
      fog.color.copy(state.fogColor);

      strandUniforms.clock.value = state.clock;
      strandUniforms.beat.value = state.beat;
      strandUniforms.life.value = state.life;
      strandUniforms.hostLife.value = state.hostLife;
      strandUniforms.fade.value = state.strandFade;
      strandUniforms.glow.value = state.strandGlow;
      strandUniforms.inflate.value = state.strandInflate;
      strandUniforms.flashGain.value = state.strandFlash;
      strandUniforms.waveAt.value = state.strandWaveAt;
      strandUniforms.pulse.value = state.pulse;

      bellUniforms.clock.value = state.clock;
      bellUniforms.pulse.value = state.pulse;
      bellUniforms.visibility.value = state.bellVisibility;
      bellUniforms.life.value = state.life;
      bellUniforms.stain.value = state.stain;
      const squeeze = bellContraction(state.pulse);
      bell.group.scale.set(squeeze.radial, squeeze.vertical, squeeze.radial);

      jelly.position.copy(state.drift);
    },
  };
}

export function lerpColor(out: Color, a: Color, b: Color, t: number) {
  return out.copy(a).lerp(b, MathUtils.clamp(t, 0, 1));
}
