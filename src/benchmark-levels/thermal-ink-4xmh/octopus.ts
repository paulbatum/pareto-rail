import { MathUtils, Vector3 } from 'three';
import type { CatmullRomCurve3 } from 'three';
import { sampleRailFrame } from '../../engine/rail';
import type { EventBus } from '../../events';
import type { LockOnSpawnEntry } from '../../engine/lock-on-runner';

// The creature. It is never "spawned in": it is already here, wrapped around
// the wreck, and the run is one long argument with it. Gameplay drives the pose
// once per frame (before enemies move) and the visuals read it; the arm targets
// simply sit where this module says their tips are.

export const ARM_COUNT = 4;
/** Distance the mantle holds ahead of the camera along the rail. */
export const MANTLE_DEPTH = 44;

export type ArmConfig = {
  /** Screen-plane sweep, in rail-frame units at the mantle's depth. */
  centre: [number, number];
  radius: [number, number];
  speed: number;
  phase: number;
  /** Vertical figure multiplier: 1 draws a circle, 2 draws a lazy figure-eight. */
  verticalBeat: number;
  /** How far the tip reaches back toward the camera. */
  reach: number;
  breath: number;
  bar: number;
};

// Four arms, four different pieces of the screen. Nothing here orbits the
// middle: the low sweep rakes the bottom edge, the coil owns the left, the whip
// cracks across the top, and the wide arm circles the whole frame.
export const ARM_CONFIGS: readonly ArmConfig[] = [
  { centre: [0.5, -6.6], radius: [15.5, 2.4], speed: 0.60, phase: 0.0, verticalBeat: 2, reach: 16.0, breath: 1.15, bar: 3 },
  { centre: [-9.0, 1.2], radius: [8.0, 7.4], speed: -0.52, phase: 1.9, verticalBeat: 1, reach: 14.0, breath: 0.9, bar: 6.25 },
  { centre: [4.5, 7.6], radius: [11.5, 3.2], speed: 0.86, phase: 3.4, verticalBeat: 1, reach: 17.5, breath: 1.4, bar: 10.75 },
  { centre: [1.5, -1.2], radius: [18.5, 10.6], speed: 0.40, phase: 4.7, verticalBeat: 1, reach: 13.0, breath: 0.75, bar: 15.5 },
];

export type ArmPose = {
  /** Lockable point: the curled tip, nearest the camera. */
  tip: Vector3;
  /** Where the limb leaves the mantle. */
  shoulder: Vector3;
  /** Bezier control point that gives the limb its coil. */
  bulge: Vector3;
  alive: boolean;
  /** 0 while tucked in the wreck, 1 once fully uncoiled. */
  uncoil: number;
  /** Rises as the arm takes damage. */
  hurt: number;
};

export type OctopusPose = {
  anchor: Vector3;
  right: Vector3;
  up: Vector3;
  forward: Vector3;
  /** Unit vector from the mantle toward the eye of the player, lagged. */
  facing: Vector3;
  arms: ArmPose[];
  breath: number;
  /** 0 shut, 1 split wide with the core showing. */
  shell: number;
  core: Vector3;
  coreExposed: boolean;
  coreHurt: number;
  /** Spikes when the creature is struck; drives the body flinch. */
  flinch: number;
  armsSevered: number;
};

const emptyArm = (): ArmPose => ({
  tip: new Vector3(),
  shoulder: new Vector3(),
  bulge: new Vector3(),
  alive: false,
  uncoil: 0,
  hurt: 0,
});

export const octopusPose: OctopusPose = {
  anchor: new Vector3(),
  right: new Vector3(1, 0, 0),
  up: new Vector3(0, 1, 0),
  forward: new Vector3(0, 0, -1),
  facing: new Vector3(0, 0, 1),
  arms: ARM_CONFIGS.map(emptyArm),
  breath: 0,
  shell: 0,
  core: new Vector3(),
  coreExposed: false,
  coreHurt: 0,
  flinch: 0,
  armsSevered: 0,
};

export type OctopusSpawnData =
  | { role: 'arm'; index: number }
  | { role: 'core' };

export type OctopusPoseInput = {
  curve: CatmullRomCurve3;
  /** Rail progress the mantle hangs off. */
  u: number;
  time: number;
  dt: number;
  cameraPosition: Vector3;
};

const scratch = new Vector3();

export function poseOctopus(input: OctopusPoseInput, live: readonly boolean[], uncoil: readonly number[]) {
  const frame = sampleRailFrame(input.curve, MathUtils.clamp(input.u, 0, 1));
  const pose = octopusPose;
  pose.right.copy(frame.right);
  pose.up.copy(frame.up);
  pose.forward.copy(frame.tangent);

  // The creature drifts across the channel while it holds station ahead of the
  // rail, so it crosses the frame instead of sitting nailed to the centre.
  const drift = Math.sin(input.time * 0.31) * 6.2 + Math.sin(input.time * 0.13 + 1.1) * 3.4;
  const rise = Math.sin(input.time * 0.24 + 0.7) * 3.1 + Math.cos(input.time * 0.41) * 1.2;
  pose.breath = Math.sin(input.time * 1.05) * 0.5 + 0.5;
  const flinch = pose.flinch;
  pose.anchor
    .copy(frame.position)
    .addScaledVector(frame.right, drift + Math.sin(input.time * 3.9) * flinch * 1.3)
    .addScaledVector(frame.up, rise + 3.6 + Math.cos(input.time * 4.6) * flinch)
    .addScaledVector(frame.tangent, MANTLE_DEPTH + flinch * 2.2);

  // It turns to keep the player in reach: the mantle rolls toward the eye with
  // a heavy lag, so a hard rail turn visibly drags its head around.
  scratch.copy(input.cameraPosition).sub(pose.anchor);
  if (scratch.lengthSq() > 0.0001) {
    scratch.normalize();
    pose.facing.lerp(scratch, Math.min(1, input.dt * 1.6)).normalize();
  }

  for (let index = 0; index < ARM_CONFIGS.length; index += 1) {
    const config = ARM_CONFIGS[index];
    const arm = pose.arms[index];
    arm.alive = live[index] === true;
    arm.uncoil = uncoil[index] ?? 0;
    const open = arm.uncoil;
    const angle = config.phase + input.time * config.speed;
    const swell = 0.74 + 0.26 * Math.sin(input.time * config.breath + config.phase);
    const radiusX = MathUtils.lerp(2.6, config.radius[0], open);
    const radiusY = MathUtils.lerp(2.0, config.radius[1], open);
    const centreX = config.centre[0] * open;
    const centreY = MathUtils.lerp(-1.5, config.centre[1], open);
    const x = centreX + Math.cos(angle) * radiusX * swell;
    const y = centreY + Math.sin(angle * config.verticalBeat + config.phase * 0.5) * radiusY * swell;
    // Even a coiled arm keeps its tip well clear of the mantle: a lock point that
    // slips behind the creature's own bulk is a lock point the player cannot take.
    const reach = MathUtils.lerp(9, config.reach, open) * (0.82 + 0.18 * Math.sin(input.time * 1.7 + index));

    arm.shoulder
      .copy(pose.anchor)
      .addScaledVector(frame.right, Math.cos(config.phase) * 3.1)
      .addScaledVector(frame.up, Math.sin(config.phase) * 2.4 - 0.4);
    arm.tip
      .copy(pose.anchor)
      .addScaledVector(frame.right, x)
      .addScaledVector(frame.up, y)
      .addScaledVector(frame.tangent, -reach);
    // The control point sits outboard and deeper than the midpoint, which is
    // what makes the limb read as a coil rather than a stretched cable.
    arm.bulge
      .copy(arm.shoulder)
      .lerp(arm.tip, 0.55)
      .addScaledVector(frame.right, Math.cos(angle + 1.9) * 4.6 * open)
      .addScaledVector(frame.up, Math.sin(angle * 0.7 + 2.6) * 3.4 * open + 1.2)
      .addScaledVector(frame.tangent, 3.4 * open);
  }

  pose.core
    .copy(pose.anchor)
    .addScaledVector(frame.tangent, -12.5 - pose.shell * 2.0)
    .addScaledVector(frame.up, -1.6 + Math.sin(input.time * 1.9) * 0.55)
    .addScaledVector(frame.right, Math.sin(input.time * 1.35) * 0.9);
}

export function resetOctopusPose() {
  const pose = octopusPose;
  pose.breath = 0;
  pose.shell = 0;
  pose.coreExposed = false;
  pose.coreHurt = 0;
  pose.flinch = 0;
  pose.armsSevered = 0;
  for (const arm of pose.arms) {
    arm.alive = false;
    arm.uncoil = 0;
    arm.hurt = 0;
  }
}

export type OctopusBrain = ReturnType<typeof createOctopusBrain>;

export function createOctopusBrain(bus: EventBus) {
  const live = ARM_CONFIGS.map(() => false);
  const uncoil = ARM_CONFIGS.map(() => 0);
  const armIds = new Map<number, number>();
  let coreId = -1;
  let coreEntry: LockOnSpawnEntry<string, unknown> | undefined;
  let severed = 0;
  let coreOpened = false;
  let coreKilled = false;

  bus.on('runstart', () => {
    for (let i = 0; i < live.length; i += 1) {
      live[i] = false;
      uncoil[i] = 0;
    }
    armIds.clear();
    coreId = -1;
    severed = 0;
    coreOpened = false;
    coreKilled = false;
    if (coreEntry) coreEntry.lockable = false;
    resetOctopusPose();
  });

  bus.on('kill', ({ enemyId }) => {
    const index = armIds.get(enemyId);
    if (index !== undefined) {
      armIds.delete(enemyId);
      live[index] = false;
      severed += 1;
      octopusPose.armsSevered = severed;
      octopusPose.flinch = Math.min(1.6, octopusPose.flinch + 1.1);
    }
    if (enemyId === coreId && !coreKilled) {
      coreKilled = true;
      bus.emit('bossphase', { phase: 'destroyed' });
    }
  });

  bus.on('hit', ({ enemyId, lethal }) => {
    if (lethal) return;
    const index = armIds.get(enemyId);
    if (index !== undefined) {
      octopusPose.arms[index].hurt = Math.min(1, octopusPose.arms[index].hurt + 0.34);
      octopusPose.flinch = Math.min(1.6, octopusPose.flinch + 0.42);
    }
    if (enemyId === coreId) {
      octopusPose.coreHurt = Math.min(1, octopusPose.coreHurt + 0.16);
      octopusPose.flinch = Math.min(1.6, octopusPose.flinch + 0.6);
    }
  });

  return {
    live,
    uncoil,
    get severed() {
      return severed;
    },
    get coreKilled() {
      return coreKilled;
    },
    get coreId() {
      return coreId;
    },
    registerArm(enemyId: number, index: number) {
      armIds.set(enemyId, index);
      live[index] = true;
    },
    registerCore(enemyId: number, entry: LockOnSpawnEntry<string, unknown>) {
      if (coreId === enemyId) return;
      coreId = enemyId;
      coreEntry = entry;
      entry.lockable = coreOpened;
    },
    /** The shell splits once every arm is gone, or once the creature commits. */
    updatePhase(runTime: number, dt: number, forceOpenAt: number) {
      const shouldOpen = severed >= ARM_COUNT || runTime >= forceOpenAt;
      if (shouldOpen && !coreOpened) {
        coreOpened = true;
        if (coreEntry) coreEntry.lockable = true;
        octopusPose.coreExposed = true;
        bus.emit('bossphase', { phase: 'exposed' });
      }
      const shellTarget = coreOpened ? 1 : 0;
      octopusPose.shell += (shellTarget - octopusPose.shell) * Math.min(1, dt * 1.9);
      octopusPose.flinch = Math.max(0, octopusPose.flinch - dt * 2.6);
      for (let i = 0; i < live.length; i += 1) {
        const target = live[i] ? 1 : 0;
        uncoil[i] += (target - uncoil[i]) * Math.min(1, dt * (live[i] ? 2.4 : 6));
      }
      for (const arm of octopusPose.arms) arm.hurt = Math.max(0, arm.hurt - dt * 0.5);
      octopusPose.coreHurt = Math.max(0, octopusPose.coreHurt - dt * 0.12);
    },
    summary() {
      if (coreKilled) return 'Core ruptured';
      if (coreOpened) return `Core exposed, ${severed}/${ARM_COUNT} arms severed`;
      return `${severed}/${ARM_COUNT} arms severed — it kept the dark`;
    },
  };
}
