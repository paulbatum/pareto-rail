import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  Scene,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAtmosphereRamp, scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { additiveMaterialParameters, createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import {
  MUZZLE_PROGRESS,
  RAIL_LENGTH,
  createMassDriverRail,
  ringProgress,
} from '../gameplay';
import { BEAT_SECONDS, MUZZLE_BEAT } from '../timing';
import { ARC_BLUE, BACKGROUND, GUNMETAL, ION_WHITE, VOLT_VIOLET, hdr, heatRamp } from './palette';

// The gun is the instrument, and the rings are the level's soul: one thin
// glowing accelerator ring at every quarter-note beat, breech to muzzle, so
// each crossing lands exactly on a beat by construction. Colors climb the
// electrical heat ramp down the bore. Everything past the muzzle is silent
// open space hidden behind the fog wall until THE SHOT tears it open.

const RING_RADIUS = 11.3;
const RING_VIEW_BEHIND = 30;
const RING_VIEW_AHEAD = 95;
const RAIL_SEGMENT_LENGTH = 9;
const STREAK_COUNT = 150;

export type EnvironmentState = {
  dt: number;
  elapsed: number;
  running: boolean;
  runTime: number;
  runProgress: number;
  camera: PerspectiveCamera;
  /** World units per second — drives streak scroll and length. */
  cameraSpeed: number;
  /** 0–1 firing-charge build through the interlock bars. */
  charge: number;
  /** True from THE SHOT onward (success path). */
  postShot: boolean;
  /** Elapsed timestamp of the sixth interlock kill, or -1. */
  strobeStart: number;
  beatPulse: number;
};

export type Environment = {
  root: Group;
  update(state: EnvironmentState): void;
  /** World position of ring k — for crossing shockwaves. */
  ringPosition(beatIndex: number): Vector3 | null;
  muzzlePosition: Vector3;
  dispose(): void;
};

type RingRecord = {
  mesh: Mesh;
  material: MeshBasicMaterial;
  glowMaterial: MeshBasicMaterial;
  position: Vector3;
  u: number;
  heat: number;
  isDownbeat: boolean;
  flash: number;
};

export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = BACKGROUND.clone();
  scene.fog = new Fog(0x05070f, 16, 96);

  const root = new Group();
  const curve = createMassDriverRail();
  const rng = mulberry32(0x4d445256);
  const barrelLength = RAIL_LENGTH * MUZZLE_PROGRESS;

  // --- Accelerator rings: one per beat, breech to muzzle. Downbeat rings are
  // a touch larger and deeper and carry four coil-housing lugs at the diagonals.
  const ringGeometry = new TorusGeometry(RING_RADIUS, 0.1, 8, 42);
  const downbeatGeometry = new TorusGeometry(RING_RADIUS + 0.35, 0.16, 8, 42);
  const glowRingGeometry = new RingGeometry(RING_RADIUS - 0.55, RING_RADIUS + 0.55, 42);
  const lugGeometry = new BoxGeometry(0.8, 0.8, 1.1);
  const lugMaterial = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(1.6) });
  const rings: RingRecord[] = [];
  const frameMatrix = new Matrix4();

  for (let k = 0; k <= MUZZLE_BEAT; k += 1) {
    const u = ringProgress(k);
    const frame = sampleRailFrame(curve, u);
    const isDownbeat = k % 4 === 0;
    const heat = k / MUZZLE_BEAT;
    const material = createAdditiveBasicMaterial({ color: 0x000000 });
    const mesh = new Mesh(isDownbeat ? downbeatGeometry : ringGeometry, material);
    // Additive rim sheet behind the torus makes the ring read as light.
    const glowMaterial = createAdditiveBasicMaterial({ color: 0x000000, opacity: 0.1, side: DoubleSide });
    const glow = new Mesh(glowRingGeometry, glowMaterial);
    mesh.add(glow);
    if (isDownbeat) {
      for (let d = 0; d < 4; d += 1) {
        const angle = Math.PI / 4 + (d / 4) * Math.PI * 2;
        const lug = new Mesh(lugGeometry, lugMaterial);
        lug.position.set(Math.cos(angle) * (RING_RADIUS + 0.9), Math.sin(angle) * (RING_RADIUS + 0.9), 0);
        lug.rotation.z = angle;
        mesh.add(lug);
      }
    }
    frameMatrix.makeBasis(frame.right, frame.up, frame.tangent);
    mesh.quaternion.setFromRotationMatrix(frameMatrix);
    mesh.position.copy(frame.position);
    mesh.visible = false;
    root.add(mesh);
    rings.push({ mesh, material, glowMaterial, position: frame.position.clone(), u, heat, isDownbeat, flash: 0 });
  }

  // --- Conductor rails: four thin bright tubes at the diagonals running the
  // whole barrel, gradient arc blue → violet down the bore, pulsing with the beat.
  const railPieces: BufferGeometry[] = [];
  const railColor = new Color();
  const segmentCount = Math.floor(barrelLength / RAIL_SEGMENT_LENGTH);
  for (let i = 0; i < segmentCount; i += 1) {
    const u0 = (i * RAIL_SEGMENT_LENGTH) / RAIL_LENGTH;
    const u1 = ((i + 1) * RAIL_SEGMENT_LENGTH) / RAIL_LENGTH;
    const f0 = sampleRailFrame(curve, u0);
    const f1 = sampleRailFrame(curve, u1);
    railColor.copy(heatRamp((i / segmentCount) * 0.85)).multiplyScalar(0.7);
    for (let d = 0; d < 4; d += 1) {
      const angle = Math.PI / 4 + (d / 4) * Math.PI * 2;
      const a = f0.position.clone()
        .addScaledVector(f0.right, Math.cos(angle) * (RING_RADIUS - 0.5))
        .addScaledVector(f0.up, Math.sin(angle) * (RING_RADIUS - 0.5));
      const b = f1.position.clone()
        .addScaledVector(f1.right, Math.cos(angle) * (RING_RADIUS - 0.5))
        .addScaledVector(f1.up, Math.sin(angle) * (RING_RADIUS - 0.5));
      const length = a.distanceTo(b);
      const piece = new BoxGeometry(0.09, 0.09, length);
      const colors = new Float32Array(piece.getAttribute('position').count * 3);
      for (let c = 0; c < colors.length; c += 3) {
        colors[c] = railColor.r;
        colors[c + 1] = railColor.g;
        colors[c + 2] = railColor.b;
      }
      piece.setAttribute('color', new BufferAttribute(colors, 3));
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const orient = new Matrix4().lookAt(a, b, f0.up);
      piece.applyQuaternion(new Quaternion().setFromRotationMatrix(orient));
      piece.translate(mid.x, mid.y, mid.z);
      railPieces.push(piece);
    }
  }
  const railMaterial = createAdditiveBasicMaterial({ color: 0xffffff });
  railMaterial.vertexColors = true;
  const conductorRails = new Mesh(mergeGeometries(railPieces), railMaterial);
  conductorRails.frustumCulled = false;
  for (const piece of railPieces) piece.dispose();
  root.add(conductorRails);

  // --- Barrel wall: dark gunmetal rib panels scattered just outside the
  // drones' reach; a scattered few carry a dim arc-blue service light.
  const ribMaterial = new MeshBasicMaterial({ color: GUNMETAL.clone() });
  const ribGeometry = new BoxGeometry(3.6, 0.55, 7.2);
  const ribAngles: number[] = [];
  const ribs: ScatterField = scatterAlongRail(curve, {
    count: 88,
    seed: 0x52494253,
    window: { behind: 40, ahead: 150 },
    place(index, placeRng) {
      const angle = placeRng() * Math.PI * 2;
      ribAngles[index] = angle;
      // Solid gunmetal must sit outside every ray to a lockable target:
      // threaders reach radius ~14.9 at the ends of their crossings.
      return {
        u: (placeRng() * 0.985 + 0.005) * MUZZLE_PROGRESS,
        offset: new Vector3(Math.cos(angle) * 15.6, Math.sin(angle) * 15.6, 0),
      };
    },
    make(index, makeRng) {
      const panel = new Mesh(ribGeometry, ribMaterial);
      const holder = new Group();
      holder.add(panel);
      if (makeRng() < 0.28) {
        const light = new Mesh(
          new CircleGeometry(0.16, 8),
          createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 0.75), side: DoubleSide }),
        );
        light.position.set(0.9, -0.3, 1.6);
        light.rotation.x = Math.PI / 2;
        holder.add(light);
      }
      void index;
      return holder;
    },
    onUpdate(item) {
      item.object.visible = item.u <= MUZZLE_PROGRESS;
      item.object.rotateZ(ribAngles[item.index] - Math.PI / 2);
    },
  });
  root.add(ribs.group);

  // --- Muzzle crown: the barrel visibly ends here; rings, rails, and wall
  // all stop at the muzzle by construction.
  const muzzleFrame = sampleRailFrame(curve, MUZZLE_PROGRESS);
  const crown = new Group();
  const crownMaterial = createAdditiveBasicMaterial({ color: hdr(ION_WHITE, 0.9) });
  crown.add(new Mesh(new TorusGeometry(RING_RADIUS + 0.8, 0.26, 8, 48), crownMaterial));
  crown.add(new Mesh(new TorusGeometry(RING_RADIUS + 1.7, 0.14, 8, 48), crownMaterial));
  frameMatrix.makeBasis(muzzleFrame.right, muzzleFrame.up, muzzleFrame.tangent);
  crown.quaternion.setFromRotationMatrix(frameMatrix);
  crown.position.copy(muzzleFrame.position);
  root.add(crown);

  // --- Charge glow: the visible firing charge parked at the muzzle through
  // the interlock bars. Its apparent size is capped so the last interlocks
  // stay legible against it; the true whiteout belongs to the shot.
  const chargeMaterial = createAdditiveBasicMaterial({ color: 0x000000 });
  const chargeDisc = new Mesh(new CircleGeometry(1, 40), chargeMaterial);
  chargeDisc.position.copy(muzzleFrame.position);
  chargeDisc.visible = false;
  root.add(chargeDisc);

  // --- Camera-riding speed streaks: a dense shell of thin streaks scrolled
  // faster the faster the gun runs, slammed hard by the post-shot surge.
  const streakShell = new Group();
  const streakMesh = new InstancedMesh(
    new BoxGeometry(0.05, 0.05, 1),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    STREAK_COUNT,
  );
  streakMesh.frustumCulled = false;
  streakShell.add(streakMesh);
  root.add(streakShell);
  type Streak = { angle: number; radius: number; z: number; jitter: number };
  const streaks: Streak[] = [];
  for (let i = 0; i < STREAK_COUNT; i += 1) {
    streaks.push({
      angle: rng() * Math.PI * 2,
      radius: 3.6 + rng() * 6.4,
      z: -40 + rng() * 48,
      jitter: 0.5 + rng() * 0.8,
    });
  }
  const streakMatrix = new Matrix4();
  const streakColor = new Color();
  const streakQuaternion = new Quaternion();

  // --- Muzzle field: a deep starfield with arc-blue and violet stars, star
  // streaks, and one distant pulsing ion-white beacon dead ahead — hidden by
  // the fog wall until the shot.
  const spaceRoot = new Group();
  spaceRoot.visible = false;
  const railEnd = curve.getPointAt(1);
  const endTangent = curve.getTangentAt(1).normalize();
  spaceRoot.add(makeStars(railEnd, endTangent, rng, 1600, 240, 1500));

  const streakFieldPieces: BufferGeometry[] = [];
  for (let i = 0; i < 90; i += 1) {
    const along = railEnd.clone().addScaledVector(endTangent, -(rng() * (RAIL_LENGTH - barrelLength) + 40));
    const angle = rng() * Math.PI * 2;
    const radius = 26 + rng() * 130;
    const offset = new Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.7, 0);
    const piece = new BoxGeometry(0.14, 0.14, 14 + rng() * 26);
    const roll = rng();
    const color = (roll < 0.55 ? ARC_BLUE : roll < 0.85 ? VOLT_VIOLET : ION_WHITE).clone().multiplyScalar(0.5 + rng() * 0.8);
    const colors = new Float32Array(piece.getAttribute('position').count * 3);
    for (let c = 0; c < colors.length; c += 3) {
      colors[c] = color.r;
      colors[c + 1] = color.g;
      colors[c + 2] = color.b;
    }
    piece.setAttribute('color', new BufferAttribute(colors, 3));
    const orient = new Matrix4().lookAt(new Vector3(), endTangent, new Vector3(0, 1, 0));
    piece.applyQuaternion(new Quaternion().setFromRotationMatrix(orient));
    piece.translate(along.x + offset.x, along.y + offset.y, along.z + offset.z);
    streakFieldPieces.push(piece);
  }
  const starStreakMaterial = createAdditiveBasicMaterial({ color: 0xffffff });
  starStreakMaterial.vertexColors = true;
  const starStreaks = new Mesh(mergeGeometries(streakFieldPieces), starStreakMaterial);
  starStreaks.frustumCulled = false;
  for (const piece of streakFieldPieces) piece.dispose();
  spaceRoot.add(starStreaks);

  // The thing you were launched toward.
  const beacon = new Group();
  const beaconCore = new Mesh(new CircleGeometry(3.2, 24), createAdditiveBasicMaterial({ color: hdr(ION_WHITE, 2.4), side: DoubleSide }));
  const beaconHalo = new Mesh(new CircleGeometry(9, 24), createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 0.5), opacity: 0.4, side: DoubleSide }));
  beacon.add(beaconCore, beaconHalo);
  beacon.position.copy(railEnd).addScaledVector(endTangent, 620);
  spaceRoot.add(beacon);
  root.add(spaceRoot);

  // --- Atmosphere: blue-black at the breech, warming toward violet by the
  // interlocks, whitening as the charge peaks, then a hard cut to vacuum.
  const atmosphere = createAtmosphereRamp(scene, [
    { progress: 0, background: 0x01020a, fog: 0x05070f, near: 16, far: 96 },
    { progress: ringProgress(48), background: 0x040313, fog: 0x0a0718, near: 16, far: 92 },
    { progress: ringProgress(80), background: 0x070420, fog: 0x140b26, near: 14, far: 88 },
    { progress: Math.max(0, MUZZLE_PROGRESS - 0.005), background: 0x0d0a24, fog: 0x2a1f42, near: 12, far: 82 },
    { progress: Math.min(1, MUZZLE_PROGRESS + 0.002), background: 0x000103, fog: 0x000103, near: 90, far: 2600 },
    { progress: 1, background: 0x000103, fog: 0x000103, near: 90, far: 2600 },
  ]);

  scene.add(root);

  let lastBeatIndex = -1;

  function update(state: EnvironmentState) {
    const { camera, runProgress, runTime, running, elapsed, dt } = state;
    atmosphere(running ? runProgress : 0);

    const camDistance = runProgress * RAIL_LENGTH;
    const beatIndex = running ? Math.floor(runTime / BEAT_SECONDS + 1e-4) : -1;
    if (beatIndex !== lastBeatIndex) lastBeatIndex = beatIndex;

    // Rings: visibility window, heat colors climbing the bore, crossing
    // flash/pre-glow, charge lean toward white, the sixth-lock strobe sweep,
    // and an idle shimmer on the attract screen.
    const strobeAge = state.strobeStart >= 0 ? elapsed - state.strobeStart : -1;
    const strobeHead = strobeAge >= 0 ? camDistance + strobeAge * 950 : -1;
    for (const ring of rings) {
      const distance = ring.u * RAIL_LENGTH - camDistance;
      const visible = !state.postShot && distance > -RING_VIEW_BEHIND && distance < RING_VIEW_AHEAD;
      ring.mesh.visible = visible;
      if (!visible) continue;

      ring.flash = Math.max(0, ring.flash - dt * 5);
      const ringBeat = Math.round(ring.u === MUZZLE_PROGRESS ? MUZZLE_BEAT : ring.heat * MUZZLE_BEAT);
      if (beatIndex === ringBeat && running) ring.flash = Math.max(ring.flash, 1);
      const isNext = running && ringBeat === beatIndex + 1;

      const heat = Math.min(1, ring.heat + state.charge * 0.4);
      const base = heatRamp(heat);
      let intensity = ring.isDownbeat ? 1.0 : 0.72;
      if (!running) intensity *= 0.55 + 0.18 * Math.sin(elapsed * 2.1 + ring.heat * 60);
      intensity += ring.flash * (ring.isDownbeat ? 1.6 : 1.1);
      if (isNext) intensity += 0.45;
      if (strobeHead >= 0 && strobeAge < 0.55) {
        const head = Math.abs(ring.u * RAIL_LENGTH - strobeHead);
        if (head < 60) intensity += (1 - head / 60) * 2.6;
      }
      // Dim hard with distance so far rings don't stack into a white wash.
      const depthDim = 0.16 + 0.84 * Math.max(0, 1 - Math.max(0, distance) / RING_VIEW_AHEAD) ** 1.7;
      ring.material.color.copy(base).multiplyScalar((0.75 + intensity) * depthDim);
      ring.glowMaterial.color.copy(base).multiplyScalar(intensity * 0.32 * depthDim);
    }

    // Conductor rails pulse with the beat and vanish past the muzzle.
    conductorRails.visible = !state.postShot;
    railMaterial.color.setScalar(0.8 + state.beatPulse * 0.7 + state.charge * 0.5);
    crown.visible = true;
    crownMaterial.color.copy(heatRamp(0.75 + state.charge * 0.25)).multiplyScalar(0.55 + state.charge * 1.05 + state.beatPulse * 0.25);

    // Barrel wall recycles inside the barrel only.
    ribs.update(Math.min(runProgress, MUZZLE_PROGRESS), dt);
    ribs.group.visible = !state.postShot;

    // Charge glow at the muzzle: grows and brightens through the interlock
    // bars, capped in apparent size, extinguished by the shot itself.
    if (state.charge > 0.01 && !state.postShot) {
      chargeDisc.visible = true;
      const toMuzzle = muzzleFrame.position.distanceTo(camera.position);
      // Cap the charge's apparent size so the last interlocks stay legible;
      // the true whiteout belongs to the shot, not the buildup.
      const cap = Math.max(2.0, toMuzzle * 0.105);
      chargeDisc.scale.setScalar(Math.min(cap, 1.2 + state.charge * 7));
      chargeDisc.quaternion.copy(camera.quaternion);
      chargeMaterial.color
        .copy(heatRamp(0.55 + state.charge * 0.45))
        .multiplyScalar(0.25 + state.charge * 0.85 + state.beatPulse * 0.18);
    } else {
      chargeDisc.visible = false;
    }

    // Speed streaks ride the camera; dim at idle, brightening with speed and
    // charge, blazing past the muzzle.
    streakShell.position.copy(camera.position);
    streakShell.quaternion.copy(camera.quaternion);
    const speed = state.running ? state.cameraSpeed : 6;
    const streakLength = Math.min(15, Math.max(1.1, speed * 0.085));
    const streakGain = Math.min(1.6, 0.12 + speed / 90 + state.charge * 0.3 + (state.postShot ? 0.55 : 0));
    streakColor.copy(heatRamp(Math.min(1, 0.1 + state.charge * 0.6 + (state.postShot ? 0.5 : 0))));
    for (let i = 0; i < streaks.length; i += 1) {
      const streak = streaks[i];
      streak.z += speed * dt * 0.92;
      if (streak.z > 8) {
        streak.z = -44 - Math.random() * 8;
        streak.angle = Math.random() * Math.PI * 2;
        streak.radius = 3.6 + Math.random() * 6.4;
      }
      const position = new Vector3(
        Math.cos(streak.angle) * streak.radius,
        Math.sin(streak.angle) * streak.radius,
        -streak.z,
      );
      streakMatrix.compose(
        position,
        streakQuaternion.identity(),
        new Vector3(1, 1, streakLength * streak.jitter),
      );
      streakMesh.setMatrixAt(i, streakMatrix);
      streakMesh.setColorAt(i, scratchStreakColor.copy(streakColor).multiplyScalar(streakGain * streak.jitter));
    }
    streakMesh.instanceMatrix.needsUpdate = true;
    if (streakMesh.instanceColor) streakMesh.instanceColor.needsUpdate = true;

    // Open space: stars and the beacon appear only once the shot breaks the
    // fog wall; the beacon pulses dead ahead.
    spaceRoot.visible = state.postShot;
    if (state.postShot) {
      beacon.quaternion.copy(camera.quaternion);
      const pulse = 0.75 + 0.25 * Math.sin(elapsed * 3.4);
      beaconCore.scale.setScalar(pulse);
      beaconHalo.scale.setScalar(0.8 + pulse * 0.3);
    }
  }

  return {
    root,
    update,
    ringPosition(beatIndex: number) {
      const ring = rings[beatIndex];
      return ring ? ring.position : null;
    },
    muzzlePosition: muzzleFrame.position.clone(),
    dispose() {
      root.removeFromParent();
      ribs.dispose();
      disposeObject3D(root);
    },
  };
}

const scratchStreakColor = new Color();

function makeStars(
  center: Vector3,
  forward: Vector3,
  rng: () => number,
  count: number,
  minRadius: number,
  maxRadius: number,
): Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const direction = new Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
    // Bias the shell forward along the flight path so the sky ahead is full.
    direction.addScaledVector(forward, rng() * 0.9).normalize();
    const radius = minRadius + rng() * (maxRadius - minRadius);
    positions[i * 3] = center.x + direction.x * radius;
    positions[i * 3 + 1] = center.y + direction.y * radius;
    positions[i * 3 + 2] = center.z + direction.z * radius;
    const roll = rng();
    const base = roll < 0.58 ? ARC_BLUE : roll < 0.88 ? VOLT_VIOLET : ION_WHITE;
    const intensity = rng() < 0.05 ? 2.2 : 0.16 + rng() * 0.4;
    colors[i * 3] = base.r * intensity;
    colors[i * 3 + 1] = base.g * intensity;
    colors[i * 3 + 2] = base.b * intensity;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial(additiveMaterialParameters({ size: 1.6, vertexColors: true, sizeAttenuation: true }));
  material.fog = false;
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  return points;
}
