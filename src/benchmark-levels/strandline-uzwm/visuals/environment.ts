import {
  BackSide,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { offsetFromRail } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { createStrandlineUzwmRail } from '../gameplay';
import { STRANDLINE_UZWM_BOSS_TIME } from '../timing';
import { createMoteField } from './effects';
import {
  BLOOM_GOLD,
  JELLY_GREEN,
  SHALLOW_TEAL,
  SUNLIT_AQUA,
  hdr,
} from './palette';

// The world: a forest of glowing strands in sunlit water. Forty procedural
// tentacles flank the rail for the whole run; two vista bells hang off the
// wide swings; the crown bell — the animal itself — waits at the end. Light
// shafts fall from somewhere above, motes drift up, and fog melts everything
// into deep blue with distance. When the parent dies the whole forest
// brightens to clean green-gold.

export type StrandlineEnvironment = {
  root: Group;
  update(
    dt: number,
    state: { elapsed: number; runProgress: number; runTime: number; beat: number; camera: Camera },
  ): void;
  setCleansed(cleansed: boolean): void;
};

type Strand = {
  mesh: Mesh;
  tip: Mesh;
  tipSize: number;
  phase: number;
  baseX: number;
  sway: number;
};

const STRAND_COUNT = 44;

export function createEnvironmentInternal(scene: Scene): StrandlineEnvironment {
  const root = new Group();
  scene.add(root);
  // Fog melts distance into the background itself: the fog color matches the
  // clear color exactly, so far strands and bells fade instead of blobbing.
  scene.fog = new FogExp2(new Color(0x06283d), 0.013);

  const rng = mulberry32(0x57a411);
  const curve = createStrandlineUzwmRail();

  // -- strand forest -----------------------------------------------------------
  const strandMatA = new MeshBasicMaterial({ color: SHALLOW_TEAL.clone().multiplyScalar(0.85) });
  const strandMatB = new MeshBasicMaterial({ color: SHALLOW_TEAL.clone().multiplyScalar(0.6) });
  const strandGlowMat = createAdditiveBasicMaterial({ color: hdr(JELLY_GREEN, 0.55), opacity: 0.5 });
  const tipMat = createAdditiveBasicMaterial({ color: hdr(BLOOM_GOLD, 1.1), opacity: 0.85 });
  const strands: Strand[] = [];
  const tipGeo = new SphereGeometry(1, 8, 6);
  const shaftGeo = new PlaneGeometry(4, 90);

  for (let i = 0; i < STRAND_COUNT; i += 1) {
    const u = 0.03 + (i / STRAND_COUNT) * 0.94;
    const side = i % 2 === 0 ? -1 : 1;
    // The central corridor stays clear: strands wall the water at ±16..29 so
    // long-range spawn sightlines never cross a foreground tube.
    const lateral = side * (16 + rng() * 13);
    const vertical = -14 + rng() * 22;
    const length = 22 + rng() * 22;
    const base = offsetFromRail(curve, u, new Vector3(lateral, vertical, -10 - rng() * 16));
    const points: Vector3[] = [];
    const segments = 5;
    for (let s = 0; s <= segments; s += 1) {
      const t = s / segments;
      points.push(
        new Vector3(
          base.x + Math.sin(t * 2.4 + i) * (2 + t * 5) * side,
          base.y - t * length * 0.4 + Math.cos(t * 1.8 + i * 0.7) * 2,
          base.z - t * length,
        ),
      );
    }
    const tube = new Mesh(
      new TubeGeometry(new CatmullRomCurve3(points), 20, 0.22 + rng() * 0.18, 5, false),
      side < 0 ? strandMatA : strandMatB,
    );
    const tipSize = 0.55 + rng() * 0.4;
    const tip = new Mesh(tipGeo, tipMat);
    tip.scale.setScalar(tipSize);
    tip.position.copy(points[segments]);
    root.add(tube, tip);
    strands.push({ mesh: tube, tip, tipSize, phase: rng() * Math.PI * 2, baseX: base.x, sway: 1 + rng() * 2 });
  }

  // -- vista bells ---------------------------------------------------------------
  // Two bells hang off the wide swings (bars 6 and 14); the crown bell fills
  // the end of the world. Translucent green domes with bright rim pulses.
  const bellMat = new MeshBasicMaterial({
    color: JELLY_GREEN.clone().multiplyScalar(0.5),
    transparent: true,
    opacity: 0.22,
    side: DoubleSide,
    depthWrite: false,
  });
  const bellRimMat = createAdditiveBasicMaterial({ color: hdr(JELLY_GREEN, 1.6), opacity: 0.7 });
  const bells: Array<{ dome: Mesh; rim: Mesh; phase: number }> = [];

  const addBell = (position: Vector3, radius: number, phase: number) => {
    const dome = new Mesh(new SphereGeometry(radius, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), bellMat);
    dome.position.copy(position);
    dome.rotation.x = Math.PI * 0.72;
    const rim = new Mesh(new TorusGeometry(radius * 0.98, radius * 0.03, 8, 48), bellRimMat);
    rim.position.copy(position);
    rim.rotation.x = Math.PI / 2 + 0.35;
    root.add(dome, rim);
    bells.push({ dome, rim, phase });
  };

  const vista1Anchor = curve.getPointAt(0.36);
  addBell(vista1Anchor.clone().add(new Vector3(62, 30, -30)), 22, 0);
  const vista2Anchor = curve.getPointAt(0.68);
  addBell(vista2Anchor.clone().add(new Vector3(-66, 34, -30)), 28, 2.1);
  // The crown: a green moon the rail climbs toward for the last third.
  const crownAnchor = curve.getPointAt(1);
  addBell(crownAnchor.clone().add(new Vector3(0, 72, -110)), 55, 4.2);

  // Root tendrils where the strands meet the bell: thin gold arcs hanging
  // from the bell's rim above the arena — framing, never crossing the fight.
  const rootMat = createAdditiveBasicMaterial({ color: hdr(BLOOM_GOLD, 0.65), opacity: 0.32 });
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const start = crownAnchor.clone().add(new Vector3(Math.cos(angle) * 30, 56 + Math.sin(angle) * 12, -60));
    const end = crownAnchor.clone().add(new Vector3(Math.cos(angle) * 14, 32 + Math.sin(angle) * 8, -100));
    const mid = start.clone().lerp(end, 0.5).add(new Vector3(0, -5, 0));
    const rootTube = new Mesh(
      new TubeGeometry(new CatmullRomCurve3([start, mid, end]), 12, 0.3, 5, false),
      rootMat,
    );
    root.add(rootTube);
  }

  // -- light shafts ----------------------------------------------------------------
  const shaftMat = createAdditiveBasicMaterial({ color: hdr(SUNLIT_AQUA, 0.16), opacity: 0.16, side: DoubleSide });
  const shafts: Mesh[] = [];
  for (let i = 0; i < 9; i += 1) {
    const u = 0.06 + (i / 9) * 0.88;
    const center = offsetFromRail(curve, u, new Vector3((rng() - 0.5) * 36, 0, -10));
    const shaft = new Mesh(shaftGeo, shaftMat);
    shaft.scale.x = 0.5 + rng() * 0.6;
    shaft.position.copy(center).add(new Vector3(0, 28, 0));
    shaft.rotation.z = 0.18 + rng() * 0.1;
    shaft.rotation.y = rng() * Math.PI;
    root.add(shaft);
    shafts.push(shaft);
  }

  // -- motes -----------------------------------------------------------------------
  const motes = createMoteField(320, 90);
  root.add(motes);

  // -- water backdrop: a vertex-colored gradient dome that follows the camera,
  // so no sightline ever hits flat void. Sunlit teal above, deep blue below.
  const skyGeo = new SphereGeometry(400, 32, 24);
  {
    const positions = skyGeo.getAttribute('position') as Float32BufferAttribute;
    const colors = new Float32Array(positions.count * 3);
    const top = new Color(0x2a7d8c);
    const mid = new Color(0x06283d);
    const bot = new Color(0x020d18);
    const tmp = new Color();
    for (let i = 0; i < positions.count; i += 1) {
      const h = positions.getY(i) / 400;
      if (h >= 0) tmp.copy(mid).lerp(top, h ** 0.6);
      else tmp.copy(mid).lerp(bot, Math.min(1, -h * 2) ** 0.5);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    skyGeo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  }
  const skyDome = new Mesh(
    skyGeo,
    new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }),
  );
  skyDome.renderOrder = -10;
  skyDome.frustumCulled = false;
  skyDome.userData.raildIgnoreOcclusion = true;
  root.add(skyDome);

  // -- far glow: the sunlit water above --------------------------------------------
  const sunMat = createAdditiveBasicMaterial({ color: hdr(SUNLIT_AQUA, 0.35), opacity: 0.3, side: BackSide });
  const sunDome = new Mesh(new SphereGeometry(300, 16, 12), sunMat);
  sunDome.userData.raildIgnoreOcclusion = true;
  root.add(sunDome);

  let cleansed = false;
  let cleanseT = 0;

  function update(
    dt: number,
    state: { elapsed: number; runProgress: number; runTime: number; beat: number; camera: Camera },
  ) {
    const { elapsed, runTime, beat, camera } = state;
    // The atmosphere travels with the camera: backdrop, sun glow, and motes
    // surround every meter of the run, not just the middle.
    skyDome.position.copy(camera.position);
    sunDome.position.copy(camera.position).add(new Vector3(0, 200, -120));
    motes.position.copy(camera.position);
    // The forest breathes: tips pulse green-gold, strands sway.
    const gold = 0.75 + 0.25 * Math.sin(elapsed * 0.9);
    tipMat.color.copy(hdr(BLOOM_GOLD, (1.0 + beat * 0.7) * gold * (cleansed ? 1.5 : 1)));
    strandGlowMat.color.copy(hdr(JELLY_GREEN, (0.5 + beat * 0.35) * (cleansed ? 1.6 : 1)));
    for (const strand of strands) {
      strand.mesh.position.x = Math.sin(elapsed * 0.4 + strand.phase) * strand.sway;
      strand.tip.position.x += Math.sin(elapsed * 0.4 + strand.phase) * strand.sway * dt * 0.4;
      const twinkle = 0.8 + 0.2 * Math.sin(elapsed * 2.2 + strand.phase * 3);
      strand.tip.scale.setScalar(strand.tipSize * twinkle);
    }
    for (const bell of bells) {
      const breathe = 1 + Math.sin(elapsed * 0.5 + bell.phase) * 0.02;
      bell.dome.scale.setScalar(breathe);
      bellRimMat.color.copy(hdr(JELLY_GREEN, (1.1 + beat * 0.5) * (cleansed ? 1.4 : 1)));
    }
    // The crown bell brightens as the run approaches the parent, and floods
    // clean when the animal is freed.
    if (runTime > STRANDLINE_UZWM_BOSS_TIME - 4 && !cleansed) {
      const approach = Math.min(1, (runTime - (STRANDLINE_UZWM_BOSS_TIME - 4)) / 4);
      bellMat.opacity = 0.34 + approach * 0.1;
    }
    if (cleansed) {
      cleanseT = Math.min(1, cleanseT + dt * 0.4);
      bellMat.opacity = 0.34 + cleanseT * 0.18;
      strandMatA.color.copy(SHALLOW_TEAL.clone().multiplyScalar(0.85 + cleanseT * 0.5));
      strandMatB.color.copy(SHALLOW_TEAL.clone().multiplyScalar(0.6 + cleanseT * 0.5));
    }
    // Motes drift upward, endlessly.
    motes.rotation.y += dt * 0.008;
  }

  return {
    root,
    update,
    setCleansed(value: boolean) {
      cleansed = value;
      if (!value) cleanseT = 0;
    },
  };
}
