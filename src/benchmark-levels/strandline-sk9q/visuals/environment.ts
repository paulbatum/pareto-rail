import {
  AdditiveBlending,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { createAtmosphereRamp, scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { mulberry32 } from '../../../engine/rng';
import { disposeObject3D } from '../../../engine/visual-kit';
import { createStrandlineRail, strandlineRunProgress } from '../gameplay';
import {
  BELL_CENTER_Y,
  BELL_CENTER_Z,
  BELL_RADIUS,
  CROWN_X,
  CROWN_Y,
  CROWN_Z,
  STRANDLINE_SK9Q_BARS,
  bar,
} from '../timing';
import { BELL_MEMBRANE, GOLD, JADE, JADE_DEEP, JADE_SICK, VIOLET, WATER_CROWN, WATER_DEEP, WATER_LIT, WATER_SERENE, hdr } from './palette';

// STRANDLINE environment — leaf construction. The whole level is one animal:
// the bell and crown hang at the end of the rail; its trailing strands run all
// the way back along the corridor the player flies. The jellyRig owns the
// bell, crown, and hero strands so the coda ascent lifts the entire animal
// away in one motion. The spine passes run progress, cleanse, beat pulse, and
// release timing in through update().

export type StrandlineEnvironmentFrame = {
  dt: number;
  elapsed: number;
  progress: number;
  speed: number;
  running: boolean;
  cleanse: number;
  beatPulse: number;
  releaseT: number;
  cameraPosition: Vector3;
};

export type StrandlineEnvironment = {
  update(frame: StrandlineEnvironmentFrame): void;
  dispose(): void;
};

const rail = createStrandlineRail();
const railLength = rail.getLength();

// Rail x/y lookup by world z (rail z is monotonic) for strand-corridor rejection.
const RAIL_SAMPLES = 160;
const railSamplePoints: Vector3[] = [];
for (let i = 0; i <= RAIL_SAMPLES; i += 1) railSamplePoints.push(rail.getPointAt(i / RAIL_SAMPLES));

function railXYAtZ(z: number) {
  // Binary search the sample bracketing z (samples descend in z).
  let lo = 0;
  let hi = RAIL_SAMPLES;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (railSamplePoints[mid].z > z) lo = mid;
    else hi = mid;
  }
  const a = railSamplePoints[lo];
  const b = railSamplePoints[hi];
  const t = (z - a.z) / (b.z - a.z || -1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// A soft tapering tube along a curve, in the curve's own space, with a
// root→tip vertex-color gradient. MeshBasicMaterial needs no normals.
function buildTaperedTube(
  curve: CatmullRomCurve3,
  tubularSegments: number,
  radialSegments: number,
  radiusStart: number,
  radiusEnd: number,
  colorRoot: Color,
  colorTip: Color,
) {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const point = new Vector3();
  const tangent = new Vector3();
  const normal = new Vector3();
  const binormal = new Vector3();
  const up = new Vector3(0, 1, 0);
  const color = new Color();

  for (let i = 0; i <= tubularSegments; i += 1) {
    const t = i / tubularSegments;
    curve.getPointAt(t, point);
    curve.getTangentAt(t, tangent).normalize();
    normal.crossVectors(up, tangent);
    if (normal.lengthSq() < 1e-6) normal.set(1, 0, 0);
    normal.normalize();
    binormal.crossVectors(tangent, normal).normalize();
    const radius = radiusStart + (radiusEnd - radiusStart) * t;
    color.copy(colorRoot).lerp(colorTip, t);
    for (let j = 0; j <= radialSegments; j += 1) {
      const angle = (j / radialSegments) * Math.PI * 2;
      const cx = Math.cos(angle) * radius;
      const cy = Math.sin(angle) * radius;
      positions.push(
        point.x + normal.x * cx + binormal.x * cy,
        point.y + normal.y * cx + binormal.y * cy,
        point.z + normal.z * cx + binormal.z * cy,
      );
      colors.push(color.r, color.g, color.b);
    }
  }

  const ringVerts = radialSegments + 1;
  for (let i = 0; i < tubularSegments; i += 1) {
    for (let j = 0; j < radialSegments; j += 1) {
      const a = i * ringVerts + j;
      const b = a + ringVerts;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

// ---- the bell -----------------------------------------------------------------

function createBell() {
  const group = new Group();

  const membrane = new Mesh(
    new SphereGeometry(BELL_RADIUS, 48, 26, 0, Math.PI * 2, 0, 1.9),
    new MeshBasicMaterial({
      color: BELL_MEMBRANE.clone().multiplyScalar(0.5),
      transparent: true,
      opacity: 0.38,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      // The bell is self-lit: fog on a huge additive surface just stacks the
      // bright water color into a whiteout at close range.
      fog: false,
    }),
  );
  membrane.userData.raildIgnoreOcclusion = true;
  group.add(membrane);

  // A faint solid inner body so the dome reads at bloom 0. Kept dark: the
  // underside of a bell is shadow, and it anchors the dome at close range.
  const inner = new Mesh(
    new SphereGeometry(BELL_RADIUS * 0.84, 24, 14, 0, Math.PI * 2, 0, 1.75),
    new MeshBasicMaterial({ color: JADE_DEEP.clone().multiplyScalar(0.55), transparent: true, opacity: 0.32, depthWrite: false, side: DoubleSide, fog: false }),
  );
  inner.userData.raildIgnoreOcclusion = true;
  group.add(inner);

  // The organ cluster: warm gold hearts hanging inside the dome.
  const organs = new Group();
  const organSpecs: Array<[number, number, number, number, number]> = [
    [0, -4, 0, 5, 1.5],
    [-4.5, -7, 2, 3.4, 1.7],
    [4, -7.5, -1.5, 3.6, 1.6],
    [0.5, -9.5, 4, 2.6, 1.9],
  ];
  for (const [x, y, z, r, intensity] of organSpecs) {
    const organ = new Mesh(new SphereGeometry(r, 14, 10), new MeshBasicMaterial({ color: hdr(GOLD, intensity), fog: false }));
    organ.position.set(x, y, z);
    organs.add(organ);
  }
  group.add(organs);

  // Rim ring at the dome's open edge.
  const rimRadius = BELL_RADIUS * Math.sin(1.9);
  const rim = new Mesh(
    new TorusGeometry(rimRadius, 0.55, 8, 64),
    new MeshBasicMaterial({ color: hdr(GOLD, 1.3), fog: false }),
  );
  rim.position.y = BELL_RADIUS * Math.cos(1.9);
  rim.rotation.x = Math.PI / 2;
  group.add(rim);

  // Radial canals from the apex down to the rim. NOT additive: from below they
  // tile the whole underside, and stacked additive arcs blow out to white.
  const canals = new Group();
  for (let i = 0; i < 8; i += 1) {
    const canal = new Mesh(
      new TorusGeometry(BELL_RADIUS * 0.97, 0.14, 4, 24, 1.9),
      new MeshBasicMaterial({ color: hdr(JADE, 0.85), transparent: true, opacity: 0.5, depthWrite: false, fog: false }),
    );
    canal.rotation.z = Math.PI / 2;
    canal.rotation.y = (i / 8) * Math.PI * 2;
    canals.add(canal);
  }
  group.add(canals);

  const rimMaterial = rim.material as MeshBasicMaterial;
  const canalMaterials = canals.children.map((canal) => (canal as Mesh).material as MeshBasicMaterial);

  const innerMaterial = inner.material as MeshBasicMaterial;

  return { group, membrane, organs, rim, rimMaterial, canalMaterials, innerMaterial };
}

// ---- the crown -----------------------------------------------------------------

function createCrown() {
  const group = new Group();
  const bulbs = new Group();
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    const radius = 8.5 + (i % 3) * 1.8;
    const bulb = new Mesh(
      new SphereGeometry(1.2 + ((i * 7) % 5) * 0.22, 10, 8),
      new MeshBasicMaterial({ color: hdr(i % 2 === 0 ? JADE : GOLD, 1.0) }),
    );
    // Ringed ABOVE the crown's root line so the parent hanging below is never
    // hidden behind its own perch.
    bulb.position.set(Math.cos(angle) * radius, 1.2 + (i % 4) * 1.0, Math.sin(angle) * radius);
    bulbs.add(bulb);
  }
  group.add(bulbs);

  // A soft glow disc under the crown so the root cluster reads at distance.
  const glowDisc = new Mesh(
    new RingGeometry(0.2, 14, 48),
    new MeshBasicMaterial({ color: hdr(GOLD, 0.7), transparent: true, opacity: 0.28, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }),
  );
  glowDisc.rotation.x = Math.PI / 2;
  glowDisc.position.y = -0.5;
  glowDisc.userData.raildIgnoreOcclusion = true;
  group.add(glowDisc);

  return { group, bulbs, glowDisc };
}

// ---- hero strands ----------------------------------------------------------------

type HeroStrand = {
  group: Group;
  material: MeshBasicMaterial;
  phase: number;
  index: number;
  clumps: Mesh[];
};

function createHeroStrands(rig: Group, rng: () => number): HeroStrand[] {
  const strands: HeroStrand[] = [];
  const count = 14;
  for (let i = 0; i < count; i += 1) {
    const rootAngle = (i / count) * Math.PI * 2 + rng() * 0.4;
    const rootRadius = 7 + rng() * 4.5;
    // Rig-local root, just under the crown.
    const root = new Vector3(Math.cos(rootAngle) * rootRadius, -1.5 - rng() * 2, Math.sin(rootAngle) * rootRadius);

    // Walk back along the corridor (+z), drooping and wandering, staying clear
    // of the flight path by a safe margin.
    const points: Vector3[] = [new Vector3(0, 0, 0)];
    let x = 0;
    let y = 0;
    let z = 0;
    while (z < 430) {
      z += 34 + rng() * 26;
      x += (rng() - 0.5) * 30;
      y -= 3 + rng() * 8 - z * 0.002;
      x = Math.max(-46, Math.min(46, x));
      y = Math.max(-42, Math.min(20, y));
      // World-space corridor rejection against the rail.
      const worldX = root.x + x + CROWN_X;
      const worldY = root.y + y + CROWN_Y;
      const worldZ = root.z + z + CROWN_Z;
      const railAt = railXYAtZ(worldZ);
      const dx = worldX - railAt.x;
      const dy = worldY - railAt.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 7.5) {
        const push = (7.5 - dist) / Math.max(0.001, dist);
        x += dx * push;
        y += dy * push * 0.6;
      }
      points.push(new Vector3(x, y, z));
    }

    const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0.5);
    const radius = 0.4 + rng() * 0.5;
    const geometry = buildTaperedTube(
      curve,
      42,
      5,
      radius,
      radius * 0.28,
      hdr(JADE, 1.1),
      hdr(GOLD.clone().lerp(JADE, 0.55), 0.85),
    );
    const material = new MeshBasicMaterial({ vertexColors: true, color: JADE_SICK.clone() });
    const mesh = new Mesh(geometry, material);

    const group = new Group();
    group.position.copy(root);
    group.add(mesh);
    // Strands are hairline scenery: they never meaningfully cover a target, so
    // they are exempt from the target-occlusion gate.
    group.userData.raildIgnoreOcclusion = true;

    // Parasite clumps: violet scabs on the strands, shrinking with cleansing.
    const clumps: Mesh[] = [];
    if (i % 3 !== 2) {
      const clumpCount = 2 + Math.floor(rng() * 3);
      for (let c = 0; c < clumpCount; c += 1) {
        const t = 0.15 + rng() * 0.7;
        const onStrand = curve.getPointAt(t);
        const clump = new Mesh(
          new SphereGeometry(0.28 + rng() * 0.3, 7, 5),
          new MeshBasicMaterial({ color: VIOLET.clone().multiplyScalar(0.7 + rng() * 0.4) }),
        );
        clump.position.copy(onStrand).add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.3));
        clump.scale.set(1, 0.6 + rng() * 0.3, 1);
        group.add(clump);
        clumps.push(clump);
      }
    }

    rig.add(group);
    strands.push({ group, material, phase: rng() * Math.PI * 2, index: i, clumps });
  }
  return strands;
}

// ---- wild strands (near-field threading) ------------------------------------------

function createWildStrandField(): ScatterField {
  return scatterAlongRail(rail, {
    count: 56,
    seed: 0x57a9d,
    window: { behind: 30, ahead: 115 },
    place: (_index, rng) => {
      const side = rng() < 0.5 ? -1 : 1;
      return {
        u: rng(),
        offset: new Vector3(side * (5.5 + rng() * 20), -7 + rng() * 22, (rng() - 0.5) * 10),
      };
    },
    make: (_index, rng) => {
      const group = new Group();
      group.userData.raildIgnoreOcclusion = true;
      const filaments = 1 + Math.floor(rng() * 3);
      for (let f = 0; f < filaments; f += 1) {
        const length = 4 + rng() * 10;
        const material = new MeshBasicMaterial({ color: hdr(JADE, 0.5 + rng() * 0.5) });
        const filament = new Mesh(
          buildTaperedTube(
            new CatmullRomCurve3([
              new Vector3(0, 0, 0),
              new Vector3((rng() - 0.5) * 2, -length * 0.4, (rng() - 0.5) * 2),
              new Vector3((rng() - 0.5) * 3, -length, (rng() - 0.5) * 3),
            ]),
            6,
            4,
            0.09 + rng() * 0.08,
            0.02,
            JADE.clone(),
            GOLD.clone(),
          ),
          material,
        );
        filament.position.set((rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3);
        group.add(filament);
      }
      // A glowing tip bead so the filament reads at distance.
      const bead = new Mesh(
        new SphereGeometry(0.1 + rng() * 0.08, 6, 5),
        new MeshBasicMaterial({ color: hdr(GOLD, 1.1) }),
      );
      bead.position.y = -2 - rng() * 4;
      group.add(bead);
      return group;
    },
    onUpdate: (item, dt) => {
      item.object.rotation.z = Math.sin(item.u * 40 + item.index) * 0.08;
      item.object.rotation.x += dt * 0.008 * (item.index % 2 === 0 ? 1 : -1);
    },
  });
}

// ---- marine snow -------------------------------------------------------------------

function createMarineSnow() {
  const count = 620;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (Math.random() - 0.5) * 120;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 70;
    positions[i * 3 + 2] = -Math.random() * 130;
    seeds[i] = Math.random() * Math.PI * 2;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new PointsMaterial({
    color: new Color(0.55, 0.85, 0.8),
    size: 0.16,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new Points(geometry, material);
  points.userData.raildIgnoreOcclusion = true;
  return { points, seeds, count };
}

// ---- god rays ------------------------------------------------------------------------

function createGodRays() {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;
  const rays: Array<{ mesh: Mesh; baseX: number; phase: number }> = [];
  for (let i = 0; i < 6; i += 1) {
    const width = 24 + (i % 3) * 16;
    const material = new MeshBasicMaterial({
      color: WATER_LIT.clone().multiplyScalar(0.65),
      transparent: true,
      opacity: 0.05,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    material.fog = false;
    const ray = new Mesh(new PlaneGeometry(width, 260), material);
    const baseX = -60 + i * 24;
    ray.position.set(baseX, 60, -80 - i * 70);
    ray.rotation.z = 0.28;
    ray.rotation.y = 0.15;
    group.add(ray);
    rays.push({ mesh: ray, baseX, phase: i * 1.3 });
  }
  return { group, rays };
}

// ---- environment assembly ---------------------------------------------------------------

export function createEnvironmentInternal(scene: Scene) {
  scene.fog = new FogExp2(WATER_LIT.getHex(), 0.0085);
  scene.background = WATER_LIT.clone().multiplyScalar(0.72);

  const jellyRig = new Group();
  jellyRig.position.set(CROWN_X, CROWN_Y, CROWN_Z);
  scene.add(jellyRig);

  const rng = mulberry32(0x9e11f);

  const bell = createBell();
  bell.group.position.set(0, BELL_CENTER_Y - CROWN_Y, BELL_CENTER_Z - CROWN_Z);
  jellyRig.add(bell.group);

  const crown = createCrown();
  jellyRig.add(crown.group);

  const heroStrands = createHeroStrands(jellyRig, rng);

  const wildStrands = createWildStrandField();
  scene.add(wildStrands.group);

  const snow = createMarineSnow();
  scene.add(snow.points);

  const godRays = createGodRays();
  scene.add(godRays.group);

  const sickColor = JADE_SICK.clone();
  const cleanColor = new Color(0.85, 1.05, 0.9);

  // Atmosphere: water color and fog density follow run progress. Reveals lift
  // the fog so the bell hangs in clear water; the coda turns serene.
  const p = (barIndex: number) => strandlineRunProgress(bar(barIndex));
  const sunlit = WATER_LIT.clone().multiplyScalar(0.72);
  const applyAtmosphere = createAtmosphereRamp(scene, [
    // Baseline is SUNLIT water; only the souring goes genuinely deep.
    { progress: 0, background: sunlit, fog: WATER_LIT, density: 0.0085 },
    { progress: p(STRANDLINE_SK9Q_BARS.strandwood), background: sunlit, fog: WATER_LIT, density: 0.009 },
    { progress: p(STRANDLINE_SK9Q_BARS.reveal1), background: WATER_LIT, fog: WATER_LIT, density: 0.006 },
    { progress: p(10.5), background: sunlit, fog: WATER_LIT, density: 0.0084 },
    { progress: p(13.5), background: WATER_DEEP.clone().multiplyScalar(0.75), fog: WATER_DEEP, density: 0.011 },
    { progress: p(STRANDLINE_SK9Q_BARS.reveal2), background: WATER_LIT, fog: WATER_LIT, density: 0.0066 },
    { progress: p(STRANDLINE_SK9Q_BARS.parent), background: WATER_CROWN, fog: WATER_CROWN, density: 0.0088 },
    { progress: p(STRANDLINE_SK9Q_BARS.deadline[0]), background: WATER_CROWN, fog: WATER_CROWN, density: 0.008 },
    { progress: p(STRANDLINE_SK9Q_BARS.release + 0.5), background: WATER_SERENE, fog: WATER_SERENE, density: 0.0056 },
    { progress: 1, background: WATER_SERENE, fog: WATER_SERENE, density: 0.0052 },
  ]);

  let disposed = false;
  const baseRigY = CROWN_Y;
  const baseRigZ = CROWN_Z;

  return {
    update(frame: StrandlineEnvironmentFrame) {
      if (disposed) return;
      const { dt, elapsed, progress, running, cleanse, beatPulse, releaseT } = frame;

      applyAtmosphere(running ? progress : 0);

      // The animal drifts on in the coda: the whole rig recedes into the blue
      // ahead and climbs a little, so the camera falls back and the ENTIRE
      // animal — bell, crown, and every trailing strand — is in frame at once.
      const ascend = releaseT * releaseT * (3 - 2 * releaseT);
      jellyRig.position.y = baseRigY + ascend * 26;
      jellyRig.position.z = baseRigZ - ascend * 110;
      jellyRig.rotation.z = Math.sin(elapsed * 0.21) * 0.01;

      // Bell swim pulse: strong on the beat, slow breathing between. Hot parts
      // dim with camera distance so the close-range coda never whites out.
      const swim = Math.sin(elapsed * 1.05) * 0.5 + 0.5;
      const pulseAmp = 0.035 + beatPulse * 0.05 + releaseT * 0.05;
      bell.group.scale.set(1 + swim * pulseAmp, 1 - swim * pulseAmp * 0.8, 1 + swim * pulseAmp);
      bell.group.position.y = BELL_CENTER_Y - CROWN_Y + Math.sin(elapsed * 0.4) * 0.6 - swim * 0.8;
      const bellWorld = new Vector3(CROWN_X, jellyRig.position.y + BELL_CENTER_Y - CROWN_Y, jellyRig.position.z + BELL_CENTER_Z - CROWN_Z);
      const bellDistance = bellWorld.distanceTo(frame.cameraPosition);
      const dim = MathUtils.clamp((bellDistance - 30) / 120, 0.22, 1);
      const membraneMaterial = bell.membrane.material as MeshBasicMaterial;
      membraneMaterial.opacity = (0.3 + swim * 0.07 + cleanse * 0.08 + releaseT * 0.1) * dim * dim;
      bell.innerMaterial.opacity = 0.32 * dim;
      bell.organs.children.forEach((child, index) => {
        const material = (child as Mesh).material as MeshBasicMaterial;
        const base = 1.15 + index * 0.1;
        material.color.copy(GOLD).multiplyScalar((base + swim * 0.3 + beatPulse * 0.5 + cleanse * 0.4) * dim);
      });
      bell.rimMaterial.color.copy(GOLD).multiplyScalar((1.0 + swim * 0.25 + cleanse * 0.3) * dim);
      for (const material of bell.canalMaterials) material.opacity = 0.45 * dim;

      crown.bulbs.children.forEach((child, index) => {
        const material = (child as Mesh).material as MeshBasicMaterial;
        const baseColor = index % 2 === 0 ? JADE : GOLD;
        material.color.copy(baseColor).multiplyScalar(0.6 + cleanse * 0.7 + beatPulse * 0.4);
      });
      (crown.glowDisc.material as MeshBasicMaterial).opacity = 0.26 * dim;

      // Hero strands: pendulum sway, cleanse from sick dim to clean gold-jade,
      // staggered along the corridor so the cleanse visibly sweeps the forest.
      for (const strand of heroStrands) {
        const stagger = strand.index / heroStrands.length;
        const ci = Math.max(0, Math.min(1, cleanse * 1.5 - stagger * 0.5));
        const pulse = 0.82 + 0.26 * Math.sin(elapsed * 1.6 + strand.phase) + beatPulse * 0.25;
        strand.material.color.copy(sickColor).lerp(cleanColor, ci).multiplyScalar(pulse);
        strand.group.rotation.z = Math.sin(elapsed * 0.45 + strand.phase) * 0.035;
        strand.group.rotation.x = Math.cos(elapsed * 0.38 + strand.phase * 1.3) * 0.03;
        for (const clump of strand.clumps) {
          const s = Math.max(0.05, 1 - ci * 1.2);
          clump.scale.set(s, s * 0.7, s);
        }
      }

      wildStrands.update(progress, dt);

      // Marine snow: sink and drift; wrap around the camera as it advances.
      const positions = snow.points.geometry.getAttribute('position');
      const array = positions.array as Float32Array;
      const camZ = frame.cameraPosition.z;
      for (let i = 0; i < snow.count; i += 1) {
        const j = i * 3;
        array[j + 1] -= dt * (0.35 + (i % 5) * 0.08);
        array[j] += Math.sin(elapsed * 0.5 + snow.seeds[i]) * dt * 0.35;
        if (array[j + 2] > camZ + 8) array[j + 2] -= 130;
        if (array[j + 1] < -42) array[j + 1] += 80;
      }
      positions.needsUpdate = true;

      for (const ray of godRays.rays) {
        (ray.mesh.material as MeshBasicMaterial).opacity = 0.07 + 0.035 * Math.sin(elapsed * 0.23 + ray.phase);
        ray.mesh.position.x = ray.baseX + Math.sin(elapsed * 0.11 + ray.phase) * 6;
      }
    },
    dispose() {
      disposed = true;
      wildStrands.dispose();
      disposeObject3D(jellyRig);
      jellyRig.removeFromParent();
      disposeObject3D(snow.points);
      snow.points.removeFromParent();
      disposeObject3D(godRays.group);
      godRays.group.removeFromParent();
    },
  };
}

export type StrandlineEnvironmentInternal = ReturnType<typeof createEnvironmentInternal>;

export function resetEnvironment(_environment: StrandlineEnvironmentInternal) {
  // All environment motion is derived from per-frame inputs; nothing to reset.
}
