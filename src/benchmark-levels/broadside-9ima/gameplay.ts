import { CatmullRomCurve3, MathUtils, Object3D, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { createMusicTime } from '../../engine/music-time';
import { createSpeedProfile } from '../../engine/speed-profile';
import { offsetFromRail, sampleRailFrame } from '../../engine/rail';
import { createRailPacer, type RailLead } from '../../engine/rail-pacer';

export const BROADSIDE_9IMA_BPM = 120;
export const BROADSIDE_9IMA_TIME = createMusicTime(BROADSIDE_9IMA_BPM, { stepsPerBar: 16 });
// Exactly 30 bars at 120 BPM = 60.0 seconds
export const BROADSIDE_9IMA_RUN_DURATION = BROADSIDE_9IMA_TIME.bar(30);

export type Broadside9imaEnemyKind = 'dart' | 'bomber' | 'turret' | 'shield' | 'core' | 'plasma' | 'letter';

export type Broadside9imaSpawnData = {
  engagement?: RailLead;
  lane: number;
  row: number;
  phase: number;
  motion: 'strafe' | 'dive' | 'mounted' | 'shield' | 'core' | 'hazard';
  radiusUnits?: number;
  shieldIndex?: number;
  coreIndex?: number;
};

// Variable speed profile creating contrast between quick fighter and colossal slow capital ships
const SPEED_KEYS = [
  [0.0, 0.65],   // Launch catapult acceleration
  [2.0, 1.0],    // Clear carrier flight deck into space
  [8.0, 1.05],   // Crossfire fleet dogfighting
  [20.0, 1.35],  // Flank run speed surge alongside Resolute
  [32.0, 1.1],   // High-speed pass along enemy cruiser underbelly
  [40.0, 0.85],  // Eye of the battle deceleration into open space
  [44.0, 1.0],   // Boss Phase 1 close-range hull run
  [50.0, 1.15],  // Turnaround loop through escort swarms
  [54.0, 1.3],   // Boss Phase 2 trench dive
  [58.0, 0.45],  // Reactor core detonation, speed slows as camera pulls out
  [60.0, 0.35],  // Final victory wide panorama
] as const;

export const broadsideSpeed = createSpeedProfile(SPEED_KEYS, BROADSIDE_9IMA_RUN_DURATION);
export const broadsideRunProgress = (t: number, d = BROADSIDE_9IMA_RUN_DURATION) => broadsideSpeed.runProgress(t, d);

// 3D Rail traversing the full fleet engagement
export function createBroadside9imaRail() {
  const points = [
    // 1. Launch off deck of friendly flagship "Aegis" (Bars 0-4, 0-8s)
    new Vector3(0, 0, 0),
    new Vector3(0, 0, -80),
    new Vector3(0, -2, -180),
    new Vector3(0, -8, -300),

    // 2. Crossfire corkscrew through the fleet gap (Bars 4-10, 8-20s)
    new Vector3(-18, -12, -440),
    new Vector3(22, -6, -580),
    new Vector3(8, 2, -700),

    // 3. Flank run down friendly cruiser "Resolute" (Bars 10-16, 20-32s)
    // Resolute is at X = +45, broadsides fire overhead across our path
    new Vector3(18, 6, -820),
    new Vector3(18, 8, -960),
    new Vector3(16, 6, -1100),

    // 4. Belly run along the underbelly of enemy cruiser "Obsidian Dread" (Bars 16-20, 32-40s)
    new Vector3(-6, 6, -1240),
    new Vector3(-6, 8, -1380),
    new Vector3(14, 14, -1500),

    // 5. The eye of the battle - breakout facing enemy flagship (Bars 20-22, 40-44s)
    new Vector3(44, 20, -1630),

    // 6. Boss Phase 1: Hull pass taking out shield generators (Bars 22-25, 44-50s)
    // Flagship Behemoth at Z = -2000, starboard shelf at X = 62, Y = 4
    new Vector3(48, 14, -1760),
    new Vector3(50, 10, -1880),
    new Vector3(48, 10, -1980),

    // 7. Turnaround hairpin loop through escort fighters (Bars 25-27, 50-54s)
    new Vector3(56, 26, -2040),
    new Vector3(22, 38, -2080),
    new Vector3(-16, 28, -2020),
    new Vector3(0, 22, -1940),

    // 8. Boss Phase 2: Trench dive destroying core power systems (Bars 27-29, 54-58s)
    // Centerline trench at X = 0, Y = 16
    new Vector3(0, 16, -2020),
    new Vector3(0, 14, -2140),
    new Vector3(0, 14, -2250),

    // 9. Victory pull-out: camera rises and pulls back overlooking both fleets (Bars 29-30, 58-60s)
    new Vector3(0, 48, -2290),
    new Vector3(0, 78, -2270),
  ];

  return new CatmullRomCurve3(points, false, 'catmullrom', 0.45);
}

const railCurve = createBroadside9imaRail();

export const broadsidePacer = createRailPacer({
  curve: railCurve,
  duration: BROADSIDE_9IMA_RUN_DURATION,
  runProgress: broadsideRunProgress,
  spawnAheadUnits: 48,
  defaultLeadSeconds: 2.6,
});

// Authored spawn waves choreographed to the space opera musical score
type SpawnWaveDef = {
  bar: number;
  beat?: number;
  kind: Broadside9imaEnemyKind;
  motion: Broadside9imaSpawnData['motion'];
  lanes: number[];
  row?: number;
  stepEvery?: number;
  leadSeconds?: number;
  hitPoints?: number;
  radiusUnits?: number;
  countsTowardTotal?: boolean;
  shieldIndex?: number;
  coreIndex?: number;
};

const WAVES: readonly SpawnWaveDef[] = [
  // ===========================================================================
  // SECTION 0: LAUNCH (Bars 1-4) - First waves off enemy carrier
  // ===========================================================================
  { bar: 1, beat: 1, kind: 'dart', motion: 'strafe', lanes: [-2.2, 2.2], row: 1.4, stepEvery: 2, radiusUnits: 4.6, leadSeconds: 2.7 },
  { bar: 2, beat: 0, kind: 'dart', motion: 'strafe', lanes: [2.3, -2.3, 1.5], row: -1.2, stepEvery: 2, radiusUnits: 4.5, leadSeconds: 2.7 },
  { bar: 3, beat: 1, kind: 'bomber', motion: 'dive', lanes: [-2.0, 2.0], row: 1.5, stepEvery: 3, hitPoints: 2, radiusUnits: 4.6, leadSeconds: 2.8 },

  // ===========================================================================
  // SECTION 1: CROSSFIRE (Bars 4-10) - Weaving through cruiser crossfire
  // ===========================================================================
  { bar: 4, beat: 2, kind: 'dart', motion: 'strafe', lanes: [-2.4, 2.4], row: 1.2, stepEvery: 2, radiusUnits: 4.6, leadSeconds: 2.7 },
  { bar: 5, beat: 2, kind: 'dart', motion: 'strafe', lanes: [2.4, 1.4, -1.4, -2.4], row: -1.4, stepEvery: 1, radiusUnits: 4.5, leadSeconds: 2.6 },
  { bar: 6, beat: 2, kind: 'bomber', motion: 'dive', lanes: [-2.2, 2.2], row: 1.4, stepEvery: 2, hitPoints: 2, radiusUnits: 4.6, leadSeconds: 2.7 },
  { bar: 7, beat: 1, kind: 'dart', motion: 'strafe', lanes: [-2.0, 2.0, -2.4, 2.4], row: -1.0, stepEvery: 2, radiusUnits: 4.5, leadSeconds: 2.6 },
  { bar: 8, beat: 2, kind: 'dart', motion: 'strafe', lanes: [2.3, -2.3, 1.6], row: 1.5, stepEvery: 2, radiusUnits: 4.6, leadSeconds: 2.7 },
  { bar: 9, beat: 1, kind: 'bomber', motion: 'dive', lanes: [-2.2, 2.2], row: -1.2, stepEvery: 2, hitPoints: 2, radiusUnits: 4.6, leadSeconds: 2.7 },

  // ===========================================================================
  // SECTION 2: FLANK RUN (Bars 10-16) - Resolute flank, broadsides overhead
  // ===========================================================================
  { bar: 10, beat: 2, kind: 'dart', motion: 'strafe', lanes: [-2.4, -1.5, 1.5, 2.4], row: 1.4, stepEvery: 1, radiusUnits: 4.5, leadSeconds: 2.6 },
  { bar: 11, beat: 2, kind: 'bomber', motion: 'dive', lanes: [-2.2, 2.2], row: -1.5, stepEvery: 2, hitPoints: 2, radiusUnits: 4.6, leadSeconds: 2.7 },
  { bar: 12, beat: 2, kind: 'dart', motion: 'strafe', lanes: [2.5, -2.5, 1.6, -1.6], row: 1.3, stepEvery: 2, radiusUnits: 4.5, leadSeconds: 2.6 },
  { bar: 13, beat: 2, kind: 'plasma', motion: 'hazard', lanes: [-1.8, 1.8], row: -1.0, stepEvery: 2, countsTowardTotal: false, radiusUnits: 4.2, leadSeconds: 2.5 },
  { bar: 14, beat: 1, kind: 'dart', motion: 'strafe', lanes: [-2.3, 2.3], row: 1.5, stepEvery: 2, radiusUnits: 4.6, leadSeconds: 2.6 },
  { bar: 15, beat: 1, kind: 'bomber', motion: 'dive', lanes: [2.2, -2.2], row: -1.2, stepEvery: 2, hitPoints: 2, radiusUnits: 4.6, leadSeconds: 2.7 },

  // ===========================================================================
  // SECTION 3: ENEMY BELLY (Bars 16-20) - Raking turrets under enemy cruiser
  // ===========================================================================
  { bar: 16, beat: 2, kind: 'turret', motion: 'mounted', lanes: [-2.2, 2.2], row: 1.5, stepEvery: 3, hitPoints: 1, radiusUnits: 4.5, leadSeconds: 2.7 },
  { bar: 17, beat: 2, kind: 'dart', motion: 'strafe', lanes: [-2.3, 2.3, 1.5], row: -1.4, stepEvery: 2, radiusUnits: 4.5, leadSeconds: 2.6 },
  { bar: 18, beat: 1, kind: 'turret', motion: 'mounted', lanes: [-2.3, 2.3], row: 1.5, stepEvery: 3, hitPoints: 1, radiusUnits: 4.6, leadSeconds: 2.7 },
  { bar: 19, beat: 1, kind: 'dart', motion: 'strafe', lanes: [2.4, -2.4, 1.5, -1.5], row: -1.2, stepEvery: 1, radiusUnits: 4.5, leadSeconds: 2.6 },

  // ===========================================================================
  // SECTION 4: THE EYE (Bars 20-22) - Brief calm before boss
  // ===========================================================================
  { bar: 21, beat: 0, kind: 'dart', motion: 'strafe', lanes: [-2.2, 2.2], row: 1.3, stepEvery: 2, radiusUnits: 4.6, leadSeconds: 2.7 },

  // ===========================================================================
  // SECTION 5: BOSS PHASE 1 (Bars 22-25) - Starboard hull pass: Shield Generators!
  // ===========================================================================
  { bar: 22, beat: 0, kind: 'turret', motion: 'mounted', lanes: [2.2], row: -1.4, hitPoints: 1, radiusUnits: 4.5, leadSeconds: 2.7 },
  { bar: 22, beat: 2, kind: 'shield', motion: 'shield', lanes: [2.4], row: 1.4, hitPoints: 2, leadSeconds: 2.9, radiusUnits: 4.6, shieldIndex: 0 },
  { bar: 23, beat: 1, kind: 'turret', motion: 'mounted', lanes: [-2.2], row: -1.4, hitPoints: 1, radiusUnits: 4.5, leadSeconds: 2.7 },
  { bar: 23, beat: 3, kind: 'shield', motion: 'shield', lanes: [-2.4], row: 1.4, hitPoints: 2, leadSeconds: 2.9, radiusUnits: 4.6, shieldIndex: 1 },
  { bar: 24, beat: 1, kind: 'plasma', motion: 'hazard', lanes: [2.0, -2.0], row: -0.8, stepEvery: 2, countsTowardTotal: false, radiusUnits: 4.2, leadSeconds: 2.6 },
  { bar: 24, beat: 3, kind: 'shield', motion: 'shield', lanes: [2.3], row: 1.2, hitPoints: 2, leadSeconds: 2.9, radiusUnits: 4.6, shieldIndex: 2 },

  // ===========================================================================
  // SECTION 6: TURNAROUND & ESCORT SWARM (Bars 25-27) - Shield falls!
  // ===========================================================================
  { bar: 25, beat: 1, kind: 'dart', motion: 'strafe', lanes: [-2.5, -1.4, 1.4, 2.5], row: 1.5, stepEvery: 1, radiusUnits: 4.5, leadSeconds: 2.6 },
  { bar: 26, beat: 0, kind: 'dart', motion: 'strafe', lanes: [2.3, -2.3, 1.4], row: -1.4, stepEvery: 2, radiusUnits: 4.6, leadSeconds: 2.6 },
  { bar: 26, beat: 2, kind: 'bomber', motion: 'dive', lanes: [-2.2, 2.2], row: 1.3, stepEvery: 2, hitPoints: 2, radiusUnits: 4.6, leadSeconds: 2.7 },

  // ===========================================================================
  // SECTION 7: BOSS PHASE 2 (Bars 27-29) - Trench Dive: Power Cores!
  // ===========================================================================
  { bar: 27, beat: 0, kind: 'core', motion: 'core', lanes: [-1.0], row: 0.1, hitPoints: 3, leadSeconds: 3.0, radiusUnits: 2.8, coreIndex: 0 },
  { bar: 27, beat: 2, kind: 'turret', motion: 'mounted', lanes: [-2.2, 2.2], row: 1.5, stepEvery: 2, hitPoints: 1, radiusUnits: 4.4, leadSeconds: 2.7 },
  { bar: 28, beat: 0, kind: 'core', motion: 'core', lanes: [1.0], row: 0.1, hitPoints: 3, leadSeconds: 3.0, radiusUnits: 2.8, coreIndex: 1 },
  { bar: 28, beat: 1, kind: 'dart', motion: 'strafe', lanes: [-2.2, 2.2], row: -1.3, stepEvery: 2, radiusUnits: 4.5, leadSeconds: 2.6 },
] as const;

function waveTime(wave: SpawnWaveDef, index: number) {
  const beat = wave.beat ?? 0;
  const stepEvery = wave.stepEvery ?? 1;
  return BROADSIDE_9IMA_TIME.bar(wave.bar, beat) + index * stepEvery * BROADSIDE_9IMA_TIME.stepSeconds;
}

function buildTimeline(): Array<LockOnSpawnEntry<Broadside9imaEnemyKind, Broadside9imaSpawnData>> {
  const entries: Array<LockOnSpawnEntry<Broadside9imaEnemyKind, Broadside9imaSpawnData>> = [];
  for (const wave of WAVES) {
    wave.lanes.forEach((lane, index) => {
      const time = waveTime(wave, index);
      entries.push({
        time,
        kind: wave.kind,
        hitPoints: wave.hitPoints ?? 1,
        countsTowardTotal: wave.countsTowardTotal ?? true,
        data: {
          engagement: broadsidePacer.resolve(time, wave.leadSeconds),
          lane,
          row: wave.row ?? 0,
          phase: index * 1.25 + wave.bar * 0.7,
          motion: wave.motion,
          radiusUnits: wave.radiusUnits ?? 4.2,
          shieldIndex: wave.shieldIndex,
          coreIndex: wave.coreIndex,
        },
      });
    });
  }
  // Clamp all spawns well before run duration so all targets have full playable windows
  return entries.filter((e) => e.time < BROADSIDE_9IMA_RUN_DURATION - 1.2).sort((a, b) => a.time - b.time);
}

export const BROADSIDE_9IMA_SPAWN_TIMELINE = buildTimeline();

const tempOffset = new Vector3();
let shieldsDestroyed = 0;
let coresDestroyed = 0;

export const broadside9imaGameplay: LockOnRunnerLevel<Broadside9imaEnemyKind, Broadside9imaSpawnData> = {
  duration: BROADSIDE_9IMA_RUN_DURATION,
  bpm: BROADSIDE_9IMA_BPM,
  startWord: 'LAUNCH',
  replayWord: 'ENGAGE',
  playerHealth: 4,
  lockRadiusNdc: 0.11,
  timing: {
    shotDelay: {
      maxGridSeconds: 0.65,
      gridRampGapGrowthThirtyseconds: 1,
    },
  },
  createRail: createBroadside9imaRail,
  spawnTimeline: BROADSIDE_9IMA_SPAWN_TIMELINE,
  easeRunProgress: broadsideRunProgress,

  scoreForKill(volleySize, enemy) {
    const base = enemy.kind === 'core' ? 600 : enemy.kind === 'shield' ? 350 : enemy.kind === 'bomber' ? 200 : enemy.kind === 'turret' ? 150 : 100;
    return Math.round(base * (1 + Math.max(0, volleySize - 1) * 0.15));
  },

  scoreForHit(_volleySize, enemy) {
    return enemy.kind === 'core' ? 100 : 50;
  },

  rankForRun(score, kills, totalEnemies) {
    const ratio = totalEnemies > 0 ? kills / totalEnemies : 0;
    if (ratio >= 0.88 && score >= 12000) return 'S';
    if (ratio >= 0.72 && score >= 8500) return 'A';
    if (ratio >= 0.55 && score >= 5500) return 'B';
    return 'C';
  },

  detailsForRun() {
    return [
      'Battle of the Magenta Veil',
      'Dual-Phase Flagship Assault',
    ];
  },

  updateCameraEffects({ camera, curve, runProgress, runTime }) {
    // Dynamic banking into high-G turns
    const clampedProgress = MathUtils.clamp(runProgress, 0, 1);
    const tangent = curve.getTangentAt(clampedProgress);
    const bank = MathUtils.degToRad(28) * MathUtils.clamp(-tangent.x * 2.5, -1, 1);
    camera.rotateZ(bank);

    // Finale camera tilt looking down upon the exploding flagship & fleets
    if (runTime > 58.0) {
      const pullT = Math.min(1, (runTime - 58.0) / 2.0);
      camera.rotateX(-pullT * 0.28);
    }
  },

  updateEnemy({ enemy, runTime, age, curve, camera }) {
    const data = enemy.entry.data;
    const paced = broadsidePacer.sample(enemy.entry.time, runTime, data.engagement);
    const anchorU = paced.anchorU;
    const laneX = data.lane * (data.radiusUnits ?? 4.2);
    const rowY = data.row * 2.2;

    if (data.motion === 'strafe') {
      // Swarm Dart: sweeping sinusoidal banking rolls
      const sweepX = Math.sin(age * 3.8 + data.phase) * 1.8;
      const sweepY = Math.cos(age * 2.6 + data.phase) * 1.2;
      tempOffset.set(laneX + sweepX, rowY + sweepY, 0);
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, tempOffset));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(data.phase + runTime * 2.8);
      enemy.mesh.rotateX(Math.sin(runTime * 2.0) * 0.15);
    } else if (data.motion === 'dive') {
      // Swarm Bomber: heavy angled descent
      const sinkY = Math.sin(Math.min(1, age * 0.9) * Math.PI) * -2.4;
      tempOffset.set(laneX + Math.sin(age * 1.5 + data.phase) * 1.2, rowY + sinkY, 0);
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, tempOffset));
      enemy.mesh.quaternion.copy(camera.quaternion);
      enemy.mesh.rotateZ(Math.sin(runTime * 1.4 + data.phase) * 0.25);
    } else if (data.motion === 'mounted') {
      // Capital Ship Turret: anchored to hull, tracking player
      tempOffset.set(laneX, rowY, 0);
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, tempOffset));
      enemy.mesh.lookAt(camera.position);
    } else if (data.motion === 'shield') {
      // Flagship Shield Generator: rotating energy rings
      tempOffset.set(laneX, rowY, 0);
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, tempOffset));
      enemy.mesh.lookAt(camera.position);

      const r1 = enemy.mesh.userData.ring1 as Object3D | undefined;
      const r2 = enemy.mesh.userData.ring2 as Object3D | undefined;
      if (r1) r1.rotation.z += 0.05;
      if (r2) r2.rotation.z -= 0.07;
    } else if (data.motion === 'core') {
      // Flagship Core: pulsing reactor inside trench
      tempOffset.set(laneX, rowY, 0);
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, tempOffset));
      enemy.mesh.quaternion.copy(camera.quaternion);
      const plasma = enemy.mesh.userData.plasma as Object3D | undefined;
      if (plasma) {
        const pulse = 1.0 + Math.sin(runTime * 10) * 0.12;
        plasma.scale.set(pulse, 1.0, pulse);
      }
    } else {
      // Hazard / Plasma bolt
      tempOffset.set(laneX, rowY, 0);
      enemy.mesh.position.copy(offsetFromRail(curve, anchorU, tempOffset));
      enemy.mesh.rotateZ(runTime * 6);
    }

    // Miss check
    return runTime > paced.passTime + 0.6;
  },
};
