import { Euler, MathUtils, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { GAME_FOV_DEGREES } from '../../engine/lock-on-runner';

/**
 * Pyre is authored against a single held composition. Every mass in the level
 * is placed by naming where it lands in that 1920x1080 frame and how far away
 * it sits, so the source reads as the picture it builds.
 *
 * The hero camera stands on the snow plain (ground plane y = 0) at the world
 * origin, looks down -Z, and is pitched up so the horizon falls low in frame.
 * The engine owns the field of view, so the pitch and the eye height are the
 * two knobs this level uses to seat the framing.
 */
export const FRAME_WIDTH = 1920;
export const FRAME_HEIGHT = 1080;
export const EYE_HEIGHT = 5;
export const HERO_PITCH_DEGREES = 16;

const TAN_V = Math.tan(MathUtils.degToRad(GAME_FOV_DEGREES) / 2);
const TAN_H = TAN_V * (FRAME_WIDTH / FRAME_HEIGHT);
const PITCH = MathUtils.degToRad(HERO_PITCH_DEGREES);
const SIN_P = Math.sin(PITCH);
const COS_P = Math.cos(PITCH);

export interface FrameRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** World point that lands on frame pixel (px, py) when it sits `depth` ahead of the hero camera. */
export function framePoint(px: number, py: number, depth: number): Vector3 {
  const ndcX = (2 * px) / FRAME_WIDTH - 1;
  const ndcY = 1 - (2 * py) / FRAME_HEIGHT;
  const k = ndcY * TAN_V;
  const rise = (depth * (SIN_P + k * COS_P)) / (COS_P - k * SIN_P);
  const forward = rise * SIN_P + depth * COS_P;
  return new Vector3(ndcX * TAN_H * forward, EYE_HEIGHT + rise, -depth);
}

export interface FrameBox {
  center: Vector3;
  width: number;
  height: number;
}

/** Camera-facing box that fills the given frame rectangle at the given depth. */
export function frameBox(rect: FrameRect, depth: number): FrameBox {
  const midX = (rect.x0 + rect.x1) / 2;
  const midY = (rect.y0 + rect.y1) / 2;
  const left = framePoint(rect.x0, midY, depth);
  const right = framePoint(rect.x1, midY, depth);
  const top = framePoint(midX, rect.y0, depth);
  const bottom = framePoint(midX, rect.y1, depth);
  return {
    center: new Vector3((left.x + right.x) / 2, (top.y + bottom.y) / 2, -depth),
    width: Math.abs(right.x - left.x),
    height: Math.abs(top.y - bottom.y),
  };
}

/** Screen-space roll of the segment (x0,y0)-(x1,y1), for beams authored as frame diagonals. */
export function frameAngle(rect: FrameRect, depth: number): number {
  const from = framePoint(rect.x0, rect.y0, depth);
  const to = framePoint(rect.x1, rect.y1, depth);
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** Length of that same segment in world units at the given depth. */
export function frameLength(rect: FrameRect, depth: number): number {
  const from = framePoint(rect.x0, rect.y0, depth);
  const to = framePoint(rect.x1, rect.y1, depth);
  return from.distanceTo(to);
}

/** Midpoint of that segment. */
export function frameMid(rect: FrameRect, depth: number): Vector3 {
  const from = framePoint(rect.x0, rect.y0, depth);
  const to = framePoint(rect.x1, rect.y1, depth);
  return from.add(to).multiplyScalar(0.5);
}

/** The hero pose, so authored geometry can be measured against the frame it is drawn for. */
export const referenceCamera = new PerspectiveCamera(GAME_FOV_DEGREES, FRAME_WIDTH / FRAME_HEIGHT, 0.1, 500);
referenceCamera.position.set(0, EYE_HEIGHT, 0);
referenceCamera.lookAt(0, EYE_HEIGHT, -10);
referenceCamera.rotateX(PITCH);
referenceCamera.updateMatrixWorld(true);

const CORNERS = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sy) => [-1, 1].map((sz) => new Vector3(sx, sy, sz))));
const scratch = new Vector3();
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchEuler = new Euler();
const scratchScale = new Vector3();

export interface SolvedBox {
  position: Vector3;
  width: number;
  height: number;
}

/**
 * A rotated box's outline is not its front face: its far corners fall inward
 * toward the horizon centre and its near corners fall outward, by a margin that
 * grows with thickness over depth. Rather than approximate that, the box is
 * measured against the hero camera and nudged until its outline lands on the
 * authored rectangle.
 */
export function solveFrameBox(
  rect: FrameRect,
  depth: number,
  thickness: number,
  rollDegrees = 0,
  yawDegrees = 0,
): SolvedBox {
  const seed = frameBox(rect, depth);
  const position = new Vector3(seed.center.x, seed.center.y, -depth - thickness / 2);
  let width = seed.width;
  let height = seed.height;
  scratchQuaternion.setFromEuler(scratchEuler.set(0, MathUtils.degToRad(yawDegrees), MathUtils.degToRad(rollDegrees)));

  const targetWidth = rect.x1 - rect.x0;
  const targetHeight = rect.y1 - rect.y0;
  const targetX = (rect.x0 + rect.x1) / 2;
  const targetY = (rect.y0 + rect.y1) / 2;

  for (let pass = 0; pass < 8; pass += 1) {
    scratchScale.set(width / 2, height / 2, thickness / 2);
    scratchMatrix.compose(position, scratchQuaternion, scratchScale);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const corner of CORNERS) {
      scratch.copy(corner).applyMatrix4(scratchMatrix).project(referenceCamera);
      const px = ((scratch.x + 1) / 2) * FRAME_WIDTH;
      const py = ((1 - scratch.y) / 2) * FRAME_HEIGHT;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    const gotWidth = maxX - minX;
    const gotHeight = maxY - minY;
    if (gotWidth < 1e-3 || gotHeight < 1e-3) break;
    position.x += ((targetX - (minX + maxX) / 2) / gotWidth) * width;
    position.y -= ((targetY - (minY + maxY) / 2) / gotHeight) * height;
    // A box thicker than its outline is wide cannot be narrowed into that
    // outline: past a point the side face alone overruns it. Clamping keeps a
    // too-thick mass merely oversized instead of collapsing it to a sliver.
    width = Math.max(width * (targetWidth / gotWidth), seed.width * 0.2);
    height = Math.max(height * (targetHeight / gotHeight), seed.height * 0.2);
  }

  return { position, width, height };
}
