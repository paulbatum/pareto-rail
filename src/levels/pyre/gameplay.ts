import { MathUtils } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';
import { createCameraPath, type CameraKey } from './camera-path';
import { framePoint } from './frame';

export const PYRE_BPM = 120;
export const PYRE_TIME = createMusicTime(PYRE_BPM, { stepsPerBar: 16 });
export const PYRE_RUN_DURATION = PYRE_TIME.bar(21);

/**
 * The one moment the level is composed for: the camera holds the reference
 * framing here, and the picture is stable for half a second either side. It sits
 * early so the compare loop stays cheap to run.
 */
export const PYRE_HERO_TIME = 5;

/** A point on the hero camera's forward axis: aiming here reproduces the hero pose exactly. */
const HERO_FOCUS = framePoint(960, 540, 100);
const HERO_AIM: readonly [number, number, number] = [HERO_FOCUS.x, HERO_FOCUS.y, HERO_FOCUS.z];

/**
 * The showcase path: hold the reference framing, then arc left across the front
 * of the basin, rise to look down into the trench, and come back along the right
 * flank past the pale monolith group.
 *
 * The sweep deliberately stays in front of the scene and under about fifty units
 * of altitude. The massing is authored to one frame, so from behind or from
 * directly overhead it reads as the shell it is; this arc keeps the
 * megastructure and the sky behind the subject at every vantage.
 *
 * The keys around the hero moment share one focus point, so the aim is genuinely
 * still there rather than merely passing through.
 */
const PYRE_CAMERA_KEYS: CameraKey[] = [
  { time: 0, position: [0, 7, 15], focus: HERO_AIM },
  { time: 3, position: [0, 5.7, 5], focus: HERO_AIM },
  { time: PYRE_HERO_TIME, position: [0, 5, 0], focus: HERO_AIM },
  { time: 7, position: [0, 5.1, -5], focus: HERO_AIM },
  { time: 9, position: [0, 6.5, -11], focus: HERO_AIM },
  { time: 13, position: [-34, 12, -8], focus: [-14, -6, -96] },
  { time: 18, position: [-96, 22, 10], focus: [-30, -4, -110] },
  { time: 23, position: [-120, 40, 34], focus: [-46, 2, -128] },
  { time: 28, position: [-40, 52, 46], focus: [-8, 0, -138] },
  { time: 33, position: [56, 44, 40], focus: [10, 0, -132] },
  { time: 38, position: [126, 26, 14], focus: [24, -4, -118] },
  { time: 42, position: [78, 14, -14], focus: [-6, -6, -120] },
];

const cameraPath = createCameraPath(PYRE_CAMERA_KEYS);

const TARGET_LEAD_SECONDS = 4;

export type PyreEnemyKind = 'ember';
export type PyreSpawnData = { offsetX: number; offsetY: number };

export const createPyreRail = cameraPath.createRail;

/** Placeholder engagements only, kept clear of the hero window. */
export const PYRE_SPAWN_TIMELINE: Array<LockOnSpawnEntry<PyreEnemyKind, PyreSpawnData>> = [
  { time: 12, kind: 'ember', data: { offsetX: -9, offsetY: 10 } },
  { time: 15, kind: 'ember', data: { offsetX: 7, offsetY: 14 } },
  { time: 18, kind: 'ember', data: { offsetX: -4, offsetY: 18 } },
  { time: 30, kind: 'ember', data: { offsetX: 11, offsetY: 9 } },
  { time: 33, kind: 'ember', data: { offsetX: 0, offsetY: 16 } },
  { time: 36, kind: 'ember', data: { offsetX: -8, offsetY: 12 } },
];

export const pyreGameplay: LockOnRunnerLevel<PyreEnemyKind, PyreSpawnData> = {
  duration: PYRE_RUN_DURATION,
  bpm: PYRE_BPM,
  createRail: createPyreRail,
  spawnTimeline: PYRE_SPAWN_TIMELINE,
  // Rail progress is authored per keyframe time rather than run fraction, so the
  // camera reaches each vantage on the second it is written for.
  easeRunProgress: (time) => cameraPath.runProgress(time),
  updateCameraEffects({ camera, curve, runProgress, runTime }) {
    cameraPath.aim(camera, curve, runProgress, runTime);
  },
  updateAttractCamera({ camera }) {
    cameraPath.aimDirect(camera, 0);
  },
  updateEnemy({ enemy, curve, railAnchor, runProgress }) {
    const anchor = railAnchor(TARGET_LEAD_SECONDS);
    const seat = curve.getPointAt(MathUtils.clamp(anchor, 0, 1));
    const { offsetX, offsetY } = enemy.entry.data;
    enemy.mesh.position.set(seat.x + offsetX, seat.y + offsetY, seat.z);
    return runProgress > anchor + 0.02;
  },
};
