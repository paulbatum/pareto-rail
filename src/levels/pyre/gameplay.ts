import { MathUtils } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';
import { createCameraPath, type CameraKey } from './camera-path';

export const PYRE_BPM = 120;
export const PYRE_TIME = createMusicTime(PYRE_BPM, { stepsPerBar: 16 });
export const PYRE_RUN_DURATION = PYRE_TIME.bar(21);

/**
 * The one moment the level is composed for: the camera holds the reference
 * framing here, and the picture is stable for half a second either side. It sits
 * early so the compare loop stays cheap to run.
 */
export const PYRE_HERO_TIME = 5;

/**
 * The hero pose, matched to the reference frame rather than to the geometry.
 *
 * The reference's horizon sits 76% down the frame; at the game's 62° vertical
 * field of view that is a 16° upward pitch. Its near rim sits at 91%, which is
 * 9.7° below horizontal — so the eye has to stand about 5.9 rim-distances high.
 * 60 m over a rim 350 m ahead is that ratio. Nothing in the world is built to
 * this pose: it is one vantage among the fly-around's.
 */
export const PYRE_HERO_EYE: readonly [number, number, number] = [0, 60, 200];
export const PYRE_HERO_PITCH_DEGREES = 16;

const PITCH = MathUtils.degToRad(PYRE_HERO_PITCH_DEGREES);
const AIM_REACH = 1000;
const HERO_AIM: readonly [number, number, number] = [
  PYRE_HERO_EYE[0],
  PYRE_HERO_EYE[1] + AIM_REACH * Math.sin(PITCH),
  PYRE_HERO_EYE[2] - AIM_REACH * Math.cos(PITCH),
];

/**
 * The showcase path: hold the hero framing, cross the rim, then swing wide and
 * high around the left flank, over the pit, and back down the right — the range
 * a real place has to survive. Altitudes run to a few hundred metres so the
 * sweep looks down into the cut rather than across it.
 *
 * The keys around the hero moment share one focus point, so the aim is genuinely
 * still there rather than merely passing through.
 */
const PYRE_CAMERA_KEYS: CameraKey[] = [
  { time: 0, position: [0, 90, 800], focus: HERO_AIM },
  { time: 3, position: [0, 70, 400], focus: HERO_AIM },
  { time: PYRE_HERO_TIME, position: PYRE_HERO_EYE, focus: HERO_AIM },
  { time: 7, position: [0, 70, -60], focus: HERO_AIM },
  { time: 9, position: [0, 140, -300], focus: HERO_AIM },
  { time: 13, position: [-1500, 320, -400], focus: [0, -120, -1300] },
  { time: 18, position: [-1900, 420, 300], focus: [0, -100, -1400] },
  { time: 23, position: [-1500, 500, 900], focus: [0, -80, -1400] },
  { time: 28, position: [-500, 620, 1200], focus: [0, -100, -1350] },
  { time: 33, position: [900, 560, 1100], focus: [0, -90, -1400] },
  { time: 38, position: [1800, 380, 500], focus: [0, -100, -1400] },
  { time: 42, position: [1300, 200, -200], focus: [0, -120, -1200] },
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
