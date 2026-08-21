import { CatmullRomCurve3, Color, Group, MathUtils, Mesh, MeshBasicMaterial, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import type { Scene } from 'three';
import { sampleRailFrame } from '../../../engine/rail';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { TINKER_TABLE_Y } from '../gameplay';
import { TINKER_BARS, TINKER_RUN_DURATION } from '../timing';
import { BUTTON_RED, CREAM, hdr, LAMP, WOOD_DARK } from './palette';

// The tinker ball. It rolls its own route along the rail, a fixed beat ahead
// of the camera and down on the table surface. Every enemy dismantled adds a
// stuck piece to its surface and a little girth, and at each act turn it
// grows to the next scale: marble → tennis ball → melon.

const ACT_RADII = [0.34, 0.58, 0.92] as const;
const PIECE_CAP = 44;
const FLY_TIME = 0.42;
const BAR_U = TINKER_RUN_DURATION / 28;
const ACT2_U = TINKER_BARS.act2 * BAR_U;
const ACT3_U = TINKER_BARS.act3 * BAR_U;

type StuckPiece = { mesh: Mesh; age: number };
type FlyingPiece = { mesh: Mesh; startLocal: Vector3; target: Vector3; age: number };

let actIndex = 0;
let collected = 0;
let radius: number = ACT_RADII[0];
let lastU = 0;
let initialized = false;

const ballRoot = new Group();
// The ball is a companion character rolling with the player, not cover — the
// occlusion checker should not treat it as a blocker.
ballRoot.userData.raildIgnoreOcclusion = true;
const spinGroup = new Group();
const bodyMaterial = new MeshBasicMaterial({ color: 0xd9c49a });
const bandMaterial = new MeshBasicMaterial({ color: BUTTON_RED });
const flying: FlyingPiece[] = [];
const stuck: StuckPiece[] = [];
const scratchQuaternion = new Quaternion();
const scratchVector = new Vector3();

export function createBall(scene: Scene) {
  const body = new Mesh(new SphereGeometry(1, 20, 16), bodyMaterial);
  // A red toy-band around the equator makes the rolling readable.
  const band = new Mesh(new TorusGeometry(1.001, 0.07, 8, 40), bandMaterial);
  band.rotation.x = Math.PI / 2;
  const glint = new Mesh(
    new SphereGeometry(0.11, 8, 6),
    createAdditiveBasicMaterial({ color: hdr(LAMP, 1.4) }),
  );
  glint.position.set(0.42, 0.5, 0.72);
  spinGroup.add(body, band, glint);
  ballRoot.add(spinGroup);

  // Soft contact shadow on the table.
  const shadow = new Mesh(
    new SphereGeometry(1, 16, 8),
    new MeshBasicMaterial({ color: WOOD_DARK, transparent: true, opacity: 0.4, depthWrite: false }),
  );
  shadow.scale.set(1.15, 0.12, 1.15);
  shadow.position.y = -0.82;
  ballRoot.add(shadow);

  scene.add(ballRoot);
  return ballRoot;
}

export function resetBall() {
  actIndex = 0;
  collected = 0;
  radius = ACT_RADII[0];
  initialized = false;
  flying.length = 0;
  for (const piece of stuck) {
    piece.mesh.removeFromParent();
    (piece.mesh.material as MeshBasicMaterial).dispose();
  }
  stuck.length = 0;
}

/** The ball grows one scale at each act boundary. */
export function setBallAct(act: number) {
  const next = MathUtils.clamp(act, 0, ACT_RADII.length - 1);
  if (next === actIndex) return;
  actIndex = next;
  radius = ACT_RADII[actIndex];
}

export function ballActForProgress(progress: number): number {
  if (progress < ACT2_U) return 0;
  if (progress < ACT3_U) return 1;
  return 2;
}

const PIECE_GEOMETRY = new SphereGeometry(0.16, 6, 5);

/** A rescued supply flies in from a kill and sticks to the ball's surface. */
export function ballCollect(worldPosition: Vector3, accent: Color) {
  collected += 1;
  const mesh = new Mesh(
    PIECE_GEOMETRY,
    new MeshBasicMaterial({ color: accent.clone().lerp(CREAM, 0.2) }),
  );
  const direction = new Vector3(
    Math.random() - 0.5,
    Math.random() * 0.7 + 0.15,
    Math.random() - 0.5,
  ).normalize();
  const target = direction.multiplyScalar(1.02);
  mesh.position.copy(target);
  mesh.scale.setScalar(0.01);
  spinGroup.add(mesh);

  if (stuck.length >= PIECE_CAP) {
    const oldest = stuck.shift();
    oldest?.mesh.removeFromParent();
  }
  const startLocal = ballRoot.worldToLocal(worldPosition.clone());
  flying.push({ mesh, startLocal, target, age: 0 });
}

export function updateBall(dt: number, context: {
  curve: CatmullRomCurve3;
  runProgress: number;
  running: boolean;
  elapsed: number;
  duration: number;
}) {
  const { curve, runProgress, running, elapsed, duration } = context;

  // Seat the ball on the rail a fixed beat ahead of the camera, then drop it
  // onto the table plane so it stays glued to the surface through the rises.
  const leadSeconds = running ? 0.8 : 0;
  const u = running
    ? MathUtils.clamp(runProgress + leadSeconds / duration, 0, 1)
    : 0.012;
  const frame = sampleRailFrame(curve, u);
  ballRoot.position.set(frame.position.x, TINKER_TABLE_Y + radius, frame.position.z);

  // Rolling: rotate the spin group around the rail-right axis by the ground
  // distance covered.
  if (!initialized) {
    lastU = u;
    initialized = true;
  }
  const deltaU = u - lastU;
  lastU = u;
  if (deltaU !== 0) {
    const groundDistance = deltaU * curve.getLength();
    scratchVector.copy(frame.right).negate();
    scratchQuaternion.setFromAxisAngle(scratchVector, groundDistance / radius);
    spinGroup.quaternion.premultiply(scratchQuaternion);
  }

  // Girth grows gently with every rescue, on top of the act radius.
  const gatherBoost = 1 + Math.min(0.45, collected * 0.008);
  ballRoot.scale.setScalar(radius * gatherBoost);

  // Fly-in animation: from the kill point to the surface, then stuck.
  for (let i = flying.length - 1; i >= 0; i -= 1) {
    const piece = flying[i];
    piece.age += dt;
    const t = Math.min(1, piece.age / FLY_TIME);
    const eased = t * t * (3 - 2 * t);
    piece.mesh.position.copy(piece.startLocal).lerp(piece.target, eased);
    piece.mesh.scale.setScalar(0.25 + eased * 0.75);
    if (t >= 1) {
      stuck.push({ mesh: piece.mesh, age: 0 });
      flying.splice(i, 1);
    }
  }
}

export function ballStats() {
  return { collected, radius, actIndex };
}
