import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { mulberry32 } from '../../../engine/rng';

// The sky is the level's colour script. Everything below is keyed to run time
// (bars of the score), so the climb always reads: storm grey → whiteout →
// sunlit blue → indigo → black, stars, and the planet curving away below.
// The dome is one vertex-coloured sphere recoloured every frame; it follows the
// camera so it can never be reached.

const DEG = Math.PI / 180;
const DOME_RADIUS = 470;
const SEGMENTS = 84;

type SkyKey = {
  t: number;
  zenith: Color;
  horizon: Color;
  fog: Color;
  density: number;
  below: Color; // what lies under the horizon: storm floor, cloud sea, planet
  mottle: Color;
  dip: number; // degrees the limb sits below the geometric horizon
  rim: number; // thin atmospheric rim above the limb (space phases)
  stars: number;
  sun: number; // sun disc + glare
  hemiSky: Color;
  hemiGround: Color;
  hemi: number;
  lamp: number; // directional (sun) light intensity
  lampColor: Color;
  cloud: Color; // tint of the cloud puffs
};

const c = (r: number, g: number, b: number) => new Color(r, g, b);

const KEYS: SkyKey[] = [
  // Storm cell over the anchor platform.
  { t: 0, zenith: c(0.03, 0.034, 0.045), horizon: c(0.2, 0.21, 0.235), fog: c(0.15, 0.16, 0.185), density: 0.0052, below: c(0.06, 0.066, 0.078), mottle: c(0.1, 0.11, 0.125), dip: 0, rim: 0, stars: 0, sun: 0, hemiSky: c(0.42, 0.46, 0.52), hemiGround: c(0.12, 0.13, 0.15), hemi: 1.0, lamp: 0.35, lampColor: c(0.7, 0.75, 0.85), cloud: c(0.19, 0.2, 0.235) },
  { t: 9, zenith: c(0.028, 0.03, 0.04), horizon: c(0.17, 0.18, 0.205), fog: c(0.13, 0.14, 0.165), density: 0.0064, below: c(0.06, 0.066, 0.078), mottle: c(0.09, 0.1, 0.115), dip: 0, rim: 0, stars: 0, sun: 0, hemiSky: c(0.36, 0.4, 0.46), hemiGround: c(0.1, 0.11, 0.13), hemi: 0.95, lamp: 0.3, lampColor: c(0.7, 0.75, 0.85), cloud: c(0.16, 0.17, 0.2) },
  // Into the cloud deck: the storm goes pale and blind, then white.
  { t: 12.4, zenith: c(0.26, 0.28, 0.32), horizon: c(0.36, 0.39, 0.44), fog: c(0.34, 0.37, 0.42), density: 0.0085, below: c(0.24, 0.26, 0.3), mottle: c(0.3, 0.33, 0.38), dip: 0, rim: 0, stars: 0, sun: 0, hemiSky: c(0.55, 0.58, 0.63), hemiGround: c(0.27, 0.29, 0.33), hemi: 1.05, lamp: 0.42, lampColor: c(0.9, 0.92, 0.95), cloud: c(0.46, 0.49, 0.54) },
  { t: 13.7, zenith: c(0.5, 0.53, 0.58), horizon: c(0.6, 0.63, 0.68), fog: c(0.58, 0.61, 0.66), density: 0.0135, below: c(0.5, 0.53, 0.58), mottle: c(0.58, 0.61, 0.66), dip: 0, rim: 0, stars: 0, sun: 0, hemiSky: c(0.75, 0.78, 0.83), hemiGround: c(0.5, 0.53, 0.58), hemi: 1.1, lamp: 0.55, lampColor: c(1, 0.98, 0.94), cloud: c(0.56, 0.59, 0.64) },
  { t: 14.7, zenith: c(0.7, 0.73, 0.78), horizon: c(0.76, 0.79, 0.84), fog: c(0.74, 0.77, 0.82), density: 0.019, below: c(0.68, 0.71, 0.76), mottle: c(0.74, 0.77, 0.82), dip: 0, rim: 0, stars: 0, sun: 0, hemiSky: c(0.85, 0.88, 0.93), hemiGround: c(0.66, 0.69, 0.74), hemi: 1.1, lamp: 0.7, lampColor: c(1, 0.98, 0.94), cloud: c(0.6, 0.63, 0.68) },
  // Punch-through: sunlit blue over a sea of cloud.
  { t: 15.75, zenith: c(0.07, 0.27, 0.72), horizon: c(0.46, 0.63, 0.87), fog: c(0.46, 0.62, 0.86), density: 0.0011, below: c(0.44, 0.53, 0.68), mottle: c(0.72, 0.77, 0.86), dip: 0, rim: 0, stars: 0, sun: 1, hemiSky: c(0.45, 0.62, 0.95), hemiGround: c(0.6, 0.66, 0.78), hemi: 0.95, lamp: 1.25, lampColor: c(1, 0.94, 0.82), cloud: c(0.94, 0.96, 1.0) },
  { t: 22, zenith: c(0.05, 0.21, 0.62), horizon: c(0.4, 0.57, 0.84), fog: c(0.38, 0.54, 0.8), density: 0.0006, below: c(0.4, 0.5, 0.68), mottle: c(0.66, 0.72, 0.84), dip: 0.6, rim: 0, stars: 0.05, sun: 1, hemiSky: c(0.35, 0.52, 0.9), hemiGround: c(0.5, 0.58, 0.72), hemi: 0.9, lamp: 1.3, lampColor: c(1, 0.95, 0.85), cloud: c(0.9, 0.93, 0.98) },
  // The air gives out.
  { t: 29, zenith: c(0.03, 0.09, 0.4), horizon: c(0.26, 0.38, 0.74), fog: c(0.22, 0.32, 0.62), density: 0.0004, below: c(0.24, 0.34, 0.6), mottle: c(0.36, 0.48, 0.72), dip: 1.6, rim: 0.2, stars: 0.3, sun: 1, hemiSky: c(0.2, 0.3, 0.62), hemiGround: c(0.3, 0.4, 0.62), hemi: 0.78, lamp: 1.45, lampColor: c(1, 0.96, 0.88), cloud: c(0.7, 0.76, 0.88) },
  { t: 35, zenith: c(0.006, 0.014, 0.09), horizon: c(0.07, 0.1, 0.32), fog: c(0.05, 0.07, 0.2), density: 0.0001, below: c(0.06, 0.12, 0.36), mottle: c(0.16, 0.26, 0.5), dip: 3, rim: 0.7, stars: 0.75, sun: 1, hemiSky: c(0.08, 0.11, 0.26), hemiGround: c(0.16, 0.24, 0.46), hemi: 0.62, lamp: 1.6, lampColor: c(1, 0.97, 0.92), cloud: c(0.6, 0.68, 0.84) },
  { t: 44, zenith: c(0.0, 0.0, 0.018), horizon: c(0.02, 0.035, 0.11), fog: c(0.0, 0.0, 0.0), density: 0.0, below: c(0.025, 0.07, 0.24), mottle: c(0.15, 0.24, 0.42), dip: 4.5, rim: 1, stars: 1, sun: 1, hemiSky: c(0.04, 0.05, 0.12), hemiGround: c(0.12, 0.2, 0.42), hemi: 0.55, lamp: 1.75, lampColor: c(1, 0.98, 0.94), cloud: c(0.55, 0.65, 0.85) },
  { t: 60, zenith: c(0.0, 0.0, 0.012), horizon: c(0.015, 0.03, 0.09), fog: c(0.0, 0.0, 0.0), density: 0.0, below: c(0.02, 0.06, 0.22), mottle: c(0.13, 0.22, 0.4), dip: 5, rim: 1, stars: 1, sun: 1, hemiSky: c(0.05, 0.06, 0.14), hemiGround: c(0.12, 0.2, 0.42), hemi: 0.55, lamp: 1.75, lampColor: c(1, 0.98, 0.94), cloud: c(0.55, 0.65, 0.85) },
];

export type SkyState = {
  zenith: Color;
  horizon: Color;
  fog: Color;
  density: number;
  below: Color;
  mottle: Color;
  dip: number;
  rim: number;
  stars: number;
  sun: number;
  hemiSky: Color;
  hemiGround: Color;
  hemi: number;
  lamp: number;
  lampColor: Color;
  cloud: Color;
};

function makeState(): SkyState {
  return {
    zenith: new Color(),
    horizon: new Color(),
    fog: new Color(),
    density: 0,
    below: new Color(),
    mottle: new Color(),
    dip: 0,
    rim: 0,
    stars: 0,
    sun: 0,
    hemiSky: new Color(),
    hemiGround: new Color(),
    hemi: 1,
    lamp: 1,
    lampColor: new Color(),
    cloud: new Color(),
  };
}

const COLOR_FIELDS = ['zenith', 'horizon', 'fog', 'below', 'mottle', 'hemiSky', 'hemiGround', 'lampColor', 'cloud'] as const;
const NUMBER_FIELDS = ['density', 'dip', 'rim', 'stars', 'sun', 'hemi', 'lamp'] as const;

export function sampleSky(time: number, out: SkyState) {
  const t = MathUtils.clamp(time, 0, KEYS[KEYS.length - 1].t);
  let i = 1;
  while (i < KEYS.length - 1 && t > KEYS[i].t) i += 1;
  const a = KEYS[i - 1];
  const b = KEYS[i];
  const k = MathUtils.clamp((t - a.t) / Math.max(1e-6, b.t - a.t), 0, 1);
  const e = k * k * (3 - 2 * k);
  for (const field of COLOR_FIELDS) out[field].copy(a[field]).lerp(b[field], e);
  for (const field of NUMBER_FIELDS) out[field] = MathUtils.lerp(a[field], b[field], e);
  return out;
}

/** Fixed sun direction: up and to the left of the climb, in the frame during the emergence. */
export const SUN_DIRECTION = new Vector3(-0.42, 0.5, -0.76).normalize();
/** Direction the hardware is lit from: over the left shoulder, so panels facing the camera stay readable. */
const LAMP_DIRECTION = new Vector3(-0.45, 0.7, 0.55).normalize();

// ---- dome geometry ------------------------------------------------------------------

function domeRows() {
  const rows: number[] = [];
  for (let e = -90; e < -24; e += 11) rows.push(e);
  for (let e = -24; e < -10; e += 3.5) rows.push(e);
  for (let e = -10; e < 12; e += 1.1) rows.push(e);
  for (let e = 12; e < 34; e += 4) rows.push(e);
  for (let e = 34; e < 90; e += 11) rows.push(e);
  rows.push(90);
  return rows;
}

export type Sky = {
  group: Group;
  state: SkyState;
  update(time: number, camera: Camera, flash: number, beat: number, interior?: number): void;
};

export function createSky(scene: Scene): Sky {
  const group = new Group();
  const state = makeState();

  // dome ------------------------------------------------------------------------
  const rows = domeRows();
  const rowCount = rows.length;
  const vertexCount = rowCount * (SEGMENTS + 1);
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const elevations = new Float32Array(vertexCount);
  const azimuths = new Float32Array(vertexCount);
  const directions: Vector3[] = [];
  for (let r = 0; r < rowCount; r += 1) {
    const el = rows[r] * DEG;
    for (let s = 0; s <= SEGMENTS; s += 1) {
      const az = (s / SEGMENTS) * Math.PI * 2;
      const index = r * (SEGMENTS + 1) + s;
      const dir = new Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
      directions.push(dir);
      positions[index * 3] = dir.x * DOME_RADIUS;
      positions[index * 3 + 1] = dir.y * DOME_RADIUS;
      positions[index * 3 + 2] = dir.z * DOME_RADIUS;
      elevations[index] = rows[r];
      azimuths[index] = az;
    }
  }
  const indices: number[] = [];
  for (let r = 0; r < rowCount - 1; r += 1) {
    for (let s = 0; s < SEGMENTS; s += 1) {
      const a = r * (SEGMENTS + 1) + s;
      const b = a + 1;
      const c2 = a + SEGMENTS + 1;
      const d = c2 + 1;
      indices.push(a, c2, b, b, c2, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  const dome = new Mesh(
    geometry,
    new MeshBasicMaterial({ vertexColors: true, side: BackSide, depthWrite: false, fog: false }),
  );
  dome.frustumCulled = false;
  dome.renderOrder = -30;
  dome.userData.raildIgnoreOcclusion = true;
  group.add(dome);

  // stars -------------------------------------------------------------------------
  const rng = mulberry32(0x5ca1ab1e);
  const starCount = 1100;
  const starGeometry = new PlaneGeometry(1, 1);
  const starMaterial = new MeshBasicMaterial({ color: 0xffffff, fog: false, depthWrite: false, side: DoubleSide });
  const stars = new InstancedMesh(starGeometry, starMaterial, starCount);
  const scratchMatrix = new Matrix4();
  const scratchQuat = new Quaternion();
  const scratchScale = new Vector3();
  const scratchPos = new Vector3();
  const scratchColor = new Color();
  const facing = new Matrix4();
  for (let i = 0; i < starCount; i += 1) {
    // Denser toward the zenith, none below the limb.
    const el = Math.asin(MathUtils.lerp(0.04, 1, Math.pow(rng(), 0.8)));
    const az = rng() * Math.PI * 2;
    scratchPos.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).multiplyScalar(DOME_RADIUS - 6);
    facing.lookAt(scratchPos, new Vector3(0, 0, 0), new Vector3(0, 1, 0));
    scratchQuat.setFromRotationMatrix(facing);
    const bright = Math.pow(rng(), 3.2);
    const size = 0.75 + bright * 1.6;
    scratchScale.set(size, size, size);
    scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
    stars.setMatrixAt(i, scratchMatrix);
    const tint = rng();
    scratchColor.setRGB(0.55 + bright * 1.4, 0.6 + bright * 1.3 - tint * 0.1, 0.75 + bright * 1.2 + tint * 0.15);
    stars.setColorAt(i, scratchColor);
  }
  stars.frustumCulled = false;
  stars.renderOrder = -20;
  stars.userData.raildIgnoreOcclusion = true;
  group.add(stars);

  // sun -----------------------------------------------------------------------------
  const sun = new Group();
  const discMaterial = new MeshBasicMaterial({ color: new Color(2.6, 2.4, 1.9), fog: false, depthWrite: false });
  const disc = new Mesh(new CircleGeometry(5.5, 40), discMaterial);
  const glowGeometry = new CircleGeometry(48, 48);
  const glowColors = new Float32Array((glowGeometry.attributes.position.count) * 3);
  for (let i = 0; i < glowGeometry.attributes.position.count; i += 1) {
    const x = glowGeometry.attributes.position.getX(i);
    const y = glowGeometry.attributes.position.getY(i);
    const fall = Math.max(0, 1 - Math.hypot(x, y) / 48);
    const v = Math.pow(fall, 2.2);
    glowColors[i * 3] = 0.32 * v;
    glowColors[i * 3 + 1] = 0.27 * v;
    glowColors[i * 3 + 2] = 0.19 * v;
  }
  glowGeometry.setAttribute('color', new BufferAttribute(glowColors, 3));
  const glowMaterial = new MeshBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const glow = new Mesh(glowGeometry, glowMaterial);
  glow.position.z = -0.5;
  sun.add(glow, disc);
  sun.renderOrder = -10;
  sun.traverse((o) => {
    o.renderOrder = -10;
    o.userData.raildIgnoreOcclusion = true;
  });
  group.add(sun);

  // lights ----------------------------------------------------------------------------
  const hemi = new HemisphereLight(0xffffff, 0x888888, 1);
  const lamp = new DirectionalLight(0xffffff, 1);
  lamp.position.copy(LAMP_DIRECTION).multiplyScalar(100);
  scene.add(hemi, lamp, lamp.target);
  scene.add(group);

  const fog = new FogExp2(0x000000, 0.001);
  scene.fog = fog;
  scene.background = new Color(0, 0, 0);

  const tint = new Color();
  const tmp = new Color();
  const glare = new Color();

  function recolor(flash: number) {
    const horizonDip = state.dip;
    for (let i = 0; i < vertexCount; i += 1) {
      const eDeg = elevations[i];
      const eRel = eDeg + horizonDip;
      const dir = directions[i];
      const az = azimuths[i];
      if (eRel >= 0) {
        const k = Math.min(1, eRel / 78);
        tint.copy(state.horizon).lerp(state.zenith, Math.pow(k, 0.48));
        if (state.rim > 0) {
          // The airglow line hugging the limb: the last thin stripe of atmosphere.
          const glow2 = Math.exp(-eRel / 2.6) * state.rim;
          tint.r += 0.06 * glow2;
          tint.g += 0.22 * glow2;
          tint.b += 0.62 * glow2;
        }
      } else {
        const depth = -eRel;
        const mott = Math.min(1, 0.5 + 0.5 * Math.sin(az * 9 + depth * 0.33) * Math.sin(az * 4.3 - depth * 0.21 + 1.3) + 0.22 * Math.sin(az * 23 + depth * 0.9) * Math.exp(-depth / 14));
        tint.copy(state.below).lerp(state.mottle, mott);
        const haze = Math.exp(-depth / 6);
        tint.lerp(state.horizon, haze * 0.4);
        if (state.rim > 0) {
          const limb = Math.exp(-depth / 3.2) * state.rim;
          tint.r += 0.05 * limb;
          tint.g += 0.18 * limb;
          tint.b += 0.5 * limb;
        }
      }
      if (state.sun > 0) {
        const d = Math.max(0, dir.dot(SUN_DIRECTION));
        const g = Math.pow(d, 26) * 0.1 + Math.pow(d, 220) * 0.1;
        glare.setRGB(1.0, 0.9, 0.72).multiplyScalar(g * state.sun);
        tint.add(glare);
      }
      if (flash > 0) tint.add(tmp.setRGB(0.9, 0.93, 1).multiplyScalar(flash * 0.35));
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
    }
    (geometry.attributes.color as BufferAttribute).needsUpdate = true;
  }

  const sunPosition = new Vector3();

  return {
    group,
    state,
    update(time, camera, flash, beat, interior = 0) {
      sampleSky(time, state);
      group.position.copy(camera.position);
      recolor(flash);

      fog.color.copy(state.fog);
      fog.density = state.density;
      (scene.background as Color).copy(state.horizon);

      hemi.color.copy(state.hemiSky);
      hemi.groundColor.copy(state.hemiGround);
      hemi.intensity = state.hemi * (1 + flash * 0.6) * (1 - interior * 0.5);
      lamp.color.copy(state.lampColor);
      lamp.intensity = state.lamp * (1 + flash * 0.4) * (1 - interior * 0.62);

      starMaterial.color.setScalar(state.stars * (0.9 + beat * 0.12));
      stars.visible = state.stars > 0.01;

      sunPosition.copy(SUN_DIRECTION).multiplyScalar(DOME_RADIUS - 30);
      sun.position.copy(sunPosition);
      sun.lookAt(camera.position);
      sun.visible = state.sun > 0.01;
      sun.scale.setScalar(0.6 + state.sun * 0.4);
      glowMaterial.opacity = state.sun;
      discMaterial.color.set(2.6, 2.4, 1.9).multiplyScalar(0.3 + state.sun * 0.7);
    },
  };
}
