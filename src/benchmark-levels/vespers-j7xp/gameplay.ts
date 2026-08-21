import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { LockOnEnemyUpdate, LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createSpeedProfile } from '../../engine/speed-profile';
import type { EventBus } from '../../events';
import {
  VESPERS_BARS,
  VESPERS_BPM,
  VESPERS_MARKERS,
  VESPERS_RUN_DURATION,
  VESPERS_RUN_SECTIONS,
  VESPERS_SCORE_SECTIONS,
  VESPERS_TIME,
} from './timing';

export {
  VESPERS_BARS,
  VESPERS_BPM,
  VESPERS_MARKERS,
  VESPERS_RUN_DURATION,
  VESPERS_RUN_SECTIONS,
  VESPERS_SCORE_SECTIONS,
  VESPERS_TIME,
};

export type VespersEnemyKind =
  | 'lancet-cobalt'
  | 'lancet-crimson'
  | 'lancet-emerald'
  | 'lancet-gold'
  | 'gargoyle-crimson'
  | 'gargoyle-gold'
  | 'gargoyle-cobalt'
  | 'seraph-emerald'
  | 'seraph-gold'
  | 'seraph-cobalt'
  | 'boss-shard-cobalt'
  | 'boss-shard-crimson'
  | 'boss-shard-emerald'
  | 'boss-shard-gold'
  | 'boss-core'
  | 'ember';

export type VespersSpawnData =
  | { role: 'lancet'; lead: number; startX: number; startY: number; freq: number; ampX: number; ampY: number }
  | { role: 'gargoyle'; lead: number; offsetX: number; offsetY: number; bankPhase: number }
  | { role: 'seraph'; lead: number; radius: number; speed: number; phase: number }
  | { role: 'boss-shard'; index: number; total: number; radius: number }
  | { role: 'boss-core' }
  | { role: 'ember'; origin: Vector3; velocity: Vector3 };

export type VespersSpawnEntry = LockOnSpawnEntry<VespersEnemyKind, VespersSpawnData>;

// ---- Rail: Sweeping flight down the cathedral nave to the west Rose Window ----
export function createVespersJ7xpRail() {
  return new CatmullRomCurve3(
    [
      new Vector3(0, 8, 20),      // Attract start
      new Vector3(0, 6, 0),       // Bar 0: Introitus entrance
      new Vector3(-2, 8, -60),    // Bar 3: Clerestory glide Left
      new Vector3(3, 10, -120),   // Bar 6: High arcade drift Right
      new Vector3(-3, 12, -180),  // Bar 9: Vault apex climb Left
      new Vector3(2, 8, -240),    // Bar 12: Nave center swoop Right
      new Vector3(0, 6, -300),    // Bar 15: Quiet Nave crossing
      new Vector3(0, 10, -360),   // Bar 18: Ascending to the Rose Window
      new Vector3(0, 16, -395),   // Bar 24: Front center facing the Rose Window
      new Vector3(0, 16, -405),   // Finish: Hovering in front of the illuminated cathedral
    ],
    false,
    'catmullrom',
    0.45,
  );
}

// Speed profile: smooth majestic pacing with reverent slowing in the quiet nave
const SPEED_KEYS: Array<[number, number]> = [
  [VESPERS_TIME.bar(0), 0.85],
  [VESPERS_TIME.bar(4), 1.0],
  [VESPERS_TIME.bar(8), 1.15],
  [VESPERS_TIME.bar(12), 1.2],
  [VESPERS_TIME.bar(14), 0.75], // Quiet nave deceleration
  [VESPERS_TIME.bar(18), 0.9],  // Rose Window approach
  [VESPERS_TIME.bar(24), 0.85],
];

const speedProfile = createSpeedProfile(SPEED_KEYS, VESPERS_RUN_DURATION);

export function vespersRunProgress(t: number, dur = VESPERS_RUN_DURATION) {
  return speedProfile.runProgress(t, dur);
}

// ---- Spawn Timeline Choreography ----
export function createVespersSpawnTimeline(): VespersSpawnEntry[] {
  const entries: VespersSpawnEntry[] = [];

  // Act 1: Introitus & Awakening (Bars 1.5–3.5)
  // Umbral Lancets swooping from high clerestory windows with wide screen sweeps
  entries.push(
    {
      time: VESPERS_TIME.bar(1, 2),
      kind: 'lancet-cobalt',
      data: { role: 'lancet', lead: 4.0, startX: -9.5, startY: 11.0, freq: 1.2, ampX: 2.5, ampY: 3.0 },
    },
    {
      time: VESPERS_TIME.bar(2, 0),
      kind: 'lancet-emerald',
      data: { role: 'lancet', lead: 4.0, startX: 9.5, startY: 11.0, freq: 1.1, ampX: 2.5, ampY: 3.0 },
    },
    {
      time: VESPERS_TIME.bar(2, 3),
      kind: 'lancet-gold',
      data: { role: 'lancet', lead: 3.8, startX: -9.5, startY: 0.5, freq: 1.4, ampX: 2.5, ampY: 2.5 },
    },
    {
      time: VESPERS_TIME.bar(3, 2),
      kind: 'lancet-crimson',
      data: { role: 'lancet', lead: 3.8, startX: 9.5, startY: 0.5, freq: 1.3, ampX: 2.5, ampY: 2.5 },
    },
  );

  // Act 2: Polyphony & Counterpoint (Bars 4–7.5)
  // Mixed formations of Gargoyle Shades and Umbral Lancets
  entries.push(
    {
      time: VESPERS_TIME.bar(4, 0),
      kind: 'gargoyle-crimson',
      hitPoints: 2,
      data: { role: 'gargoyle', lead: 4.5, offsetX: -9.0, offsetY: 1.5, bankPhase: 0.0 },
    },
    {
      time: VESPERS_TIME.bar(4, 2),
      kind: 'lancet-gold',
      data: { role: 'lancet', lead: 4.0, startX: 9.0, startY: 11.0, freq: 1.5, ampX: 2.5, ampY: 2.5 },
    },
    {
      time: VESPERS_TIME.bar(5, 0),
      kind: 'gargoyle-gold',
      hitPoints: 2,
      data: { role: 'gargoyle', lead: 4.5, offsetX: 9.0, offsetY: 1.5, bankPhase: 1.5 },
    },
    {
      time: VESPERS_TIME.bar(5, 2),
      kind: 'lancet-cobalt',
      data: { role: 'lancet', lead: 3.8, startX: -9.0, startY: 11.0, freq: 1.4, ampX: 2.5, ampY: 2.5 },
    },
    {
      time: VESPERS_TIME.bar(6, 0),
      kind: 'lancet-emerald',
      data: { role: 'lancet', lead: 3.6, startX: -9.5, startY: 0.5, freq: 1.6, ampX: 2.5, ampY: 2.5 },
    },
    {
      time: VESPERS_TIME.bar(6, 1),
      kind: 'lancet-crimson',
      data: { role: 'lancet', lead: 3.6, startX: 9.5, startY: 11.5, freq: 1.6, ampX: 2.5, ampY: 2.5 },
    },
    {
      time: VESPERS_TIME.bar(6, 3),
      kind: 'gargoyle-cobalt',
      hitPoints: 2,
      data: { role: 'gargoyle', lead: 4.2, offsetX: -8.5, offsetY: 11.5, bankPhase: 3.0 },
    },
    {
      time: VESPERS_TIME.bar(7, 0),
      kind: 'lancet-emerald',
      data: { role: 'lancet', lead: 3.6, startX: -9.5, startY: 10.0, freq: 1.4, ampX: 2.5, ampY: 2.5 },
    },
    {
      time: VESPERS_TIME.bar(7, 2),
      kind: 'lancet-gold',
      data: { role: 'lancet', lead: 3.5, startX: 9.0, startY: 0.5, freq: 1.3, ampX: 2.5, ampY: 2.0 },
    },
  );

  // Act 3: The Swell & Arcade Climax (Bars 8–13.5)
  // Seraph Shades descending from vaults, wide sweeping polyphonic waves
  entries.push(
    {
      time: VESPERS_TIME.bar(8, 0),
      kind: 'seraph-emerald',
      hitPoints: 3,
      data: { role: 'seraph', lead: 5.0, radius: 9.5, speed: 1.2, phase: 0.0 },
    },
    {
      time: VESPERS_TIME.bar(8, 3),
      kind: 'lancet-cobalt',
      data: { role: 'lancet', lead: 3.8, startX: 9.0, startY: 0.5, freq: 1.4, ampX: 2.5, ampY: 2.5 },
    },
    {
      time: VESPERS_TIME.bar(9, 0),
      kind: 'lancet-crimson',
      data: { role: 'lancet', lead: 3.6, startX: -9.5, startY: 1.0, freq: 1.5, ampX: 2.5, ampY: 2.5 },
    },
    {
      time: VESPERS_TIME.bar(9, 1),
      kind: 'gargoyle-crimson',
      hitPoints: 2,
      data: { role: 'gargoyle', lead: 4.2, offsetX: -9.0, offsetY: 11.5, bankPhase: 0.8 },
    },
    {
      time: VESPERS_TIME.bar(9, 3),
      kind: 'lancet-gold',
      data: { role: 'lancet', lead: 3.6, startX: 9.0, startY: 11.5, freq: 1.5, ampX: 2.5, ampY: 2.5 },
    },
    {
      time: VESPERS_TIME.bar(10, 0),
      kind: 'seraph-gold',
      hitPoints: 3,
      data: { role: 'seraph', lead: 5.0, radius: 10.0, speed: 1.3, phase: Math.PI },
    },
    {
      time: VESPERS_TIME.bar(10, 3),
      kind: 'lancet-emerald',
      data: { role: 'lancet', lead: 3.5, startX: -9.0, startY: 1.5, freq: 1.3, ampX: 2.5, ampY: 2.5 },
    },
    {
      time: VESPERS_TIME.bar(11, 0),
      kind: 'lancet-cobalt',
      data: { role: 'lancet', lead: 3.5, startX: 9.5, startY: 11.5, freq: 1.4, ampX: 2.5, ampY: 2.5 },
    },
    {
      time: VESPERS_TIME.bar(11, 1),
      kind: 'gargoyle-gold',
      hitPoints: 2,
      data: { role: 'gargoyle', lead: 4.0, offsetX: 9.0, offsetY: 1.0, bankPhase: 2.1 },
    },
    {
      time: VESPERS_TIME.bar(11, 3),
      kind: 'lancet-crimson',
      data: { role: 'lancet', lead: 3.5, startX: -9.0, startY: 11.5, freq: 1.5, ampX: 2.5, ampY: 2.5 },
    },
    {
      time: VESPERS_TIME.bar(12, 1),
      kind: 'seraph-cobalt',
      hitPoints: 3,
      data: { role: 'seraph', lead: 4.8, radius: 9.5, speed: 1.4, phase: Math.PI * 0.5 },
    },
    {
      time: VESPERS_TIME.bar(12, 3),
      kind: 'gargoyle-crimson',
      hitPoints: 2,
      data: { role: 'gargoyle', lead: 4.0, offsetX: -9.0, offsetY: 5.5, bankPhase: 1.0 },
    },
    {
      time: VESPERS_TIME.bar(13, 0),
      kind: 'gargoyle-gold',
      hitPoints: 2,
      data: { role: 'gargoyle', lead: 3.8, offsetX: -9.0, offsetY: 1.0, bankPhase: 2.5 },
    },
    {
      time: VESPERS_TIME.bar(13, 1),
      kind: 'lancet-gold',
      data: { role: 'lancet', lead: 3.5, startX: 9.5, startY: 1.5, freq: 1.4, ampX: 2.5, ampY: 2.0 },
    },
  );

  // Act 4: The Quiet Nave (Bars 14–17.5)
  // "Past the middle, the nave goes quiet: a long dark empty span, one voice..."
  entries.push(
    {
      time: VESPERS_TIME.bar(15, 0),
      kind: 'lancet-cobalt',
      data: { role: 'lancet', lead: 4.5, startX: -8.5, startY: 10.5, freq: 0.8, ampX: 2.0, ampY: 2.0 },
    },
    {
      time: VESPERS_TIME.bar(16, 2),
      kind: 'lancet-gold',
      data: { role: 'lancet', lead: 4.0, startX: 8.5, startY: 1.5, freq: 0.8, ampX: 2.0, ampY: 2.0 },
    },
  );

  // Act 5: Boss — The Oculus Eater at the Rose Window (Bars 17.5–23.5)
  // Phase 1: 4 Orbiting Stained Glass Petal Shields
  entries.push(
    {
      time: VESPERS_TIME.bar(17, 2),
      kind: 'boss-shard-cobalt',
      hitPoints: 2,
      data: { role: 'boss-shard', index: 0, total: 4, radius: 11.0 },
    },
    {
      time: VESPERS_TIME.bar(17, 2),
      kind: 'boss-shard-crimson',
      hitPoints: 2,
      data: { role: 'boss-shard', index: 1, total: 4, radius: 11.0 },
    },
    {
      time: VESPERS_TIME.bar(17, 2),
      kind: 'boss-shard-emerald',
      hitPoints: 2,
      data: { role: 'boss-shard', index: 2, total: 4, radius: 11.0 },
    },
    {
      time: VESPERS_TIME.bar(17, 2),
      kind: 'boss-shard-gold',
      hitPoints: 2,
      data: { role: 'boss-shard', index: 3, total: 4, radius: 11.0 },
    },
  );

  // Phase 2: The Exposed Arch-Umbra Heart Core (Multi-stage)
  entries.push(
    {
      time: VESPERS_TIME.bar(18, 2),
      kind: 'boss-core',
      hitStages: [2, 3],
      data: { role: 'boss-core' },
    },
  );

  return entries;
}

export function createVespersGameplay(bus: EventBus): LockOnRunnerLevel<VespersEnemyKind, VespersSpawnData> {
  const curve = createVespersJ7xpRail();
  const spawnTimeline = createVespersSpawnTimeline();

  let bossPhaseEmitted = false;
  let bossDestroyedEmitted = false;

  return {
    duration: VESPERS_RUN_DURATION,
    bpm: VESPERS_BPM,
    createRail: createVespersJ7xpRail,
    spawnTimeline,
    easeRunProgress: (t, dur) => vespersRunProgress(t, dur),
    scoreForKill(_volleySize, enemy) {
      const kind = enemy.kind;
      if (kind === 'boss-core') return 5000;
      if (kind.startsWith('boss-shard')) return 1200;
      if (kind.startsWith('seraph')) return 800;
      if (kind.startsWith('gargoyle')) return 500;
      return 250;
    },
    scoreForVolley(results) {
      const count = results.filter((r) => r.killed).length;
      return Math.round(count * 150 * Math.pow(1.35, Math.max(0, count - 1)));
    },
    updateEnemy({ enemy, age, railAnchor, curve }) {
      const data = enemy.entry.data;

      // 1. Umbral Lancet: Swooping sinusoidal diving path
      if (data.role === 'lancet') {
        if (age > data.lead + 1.2) return true; // Despawn after overtaking

        const anchor = railAnchor(data.lead);
        const wave = Math.sin(age * data.freq * Math.PI * 2);
        const cosWave = Math.cos(age * data.freq * Math.PI * 2);

        const x = data.startX + wave * data.ampX;
        const y = data.startY + cosWave * data.ampY;

        enemy.mesh.position.copy(offsetFromRail(curve, anchor, new Vector3(x, y, 0)));
        enemy.mesh.rotation.z = -wave * 0.45;
        return false;
      }

      // 2. Gargoyle Shade: Heavy gliding along arcade with lateral bank dodges
      if (data.role === 'gargoyle') {
        if (age > data.lead + 1.5) return true;

        const anchor = railAnchor(data.lead);
        const bank = Math.sin(age * 1.8 + data.bankPhase);
        const x = data.offsetX + bank * 2.8;
        const y = data.offsetY + Math.sin(age * 2.5) * 1.5;

        enemy.mesh.position.copy(offsetFromRail(curve, anchor, new Vector3(x, y, 0)));
        enemy.mesh.rotation.z = bank * 0.35;
        return false;
      }

      // 3. Seraph Shade: Sacred geometry figure-8 orbit in upper vaulting
      if (data.role === 'seraph') {
        if (age > data.lead + 1.8) return true;

        const anchor = railAnchor(data.lead);
        const t = age * data.speed + data.phase;
        // Lemniscate / figure-8 pattern
        const x = Math.sin(t) * data.radius;
        const y = 10.0 + Math.sin(t * 2) * (data.radius * 0.45);

        enemy.mesh.position.copy(offsetFromRail(curve, anchor, new Vector3(x, y, 0)));
        enemy.mesh.rotation.z = Math.cos(t) * 0.4;
        return false;
      }

      // 4. Boss Petal Shards: Orbiting the Rose Window (x=0, y=16, z=-420)
      if (data.role === 'boss-shard') {
        const orbitSpeed = 0.8;
        const currentAngle = (data.index / data.total) * Math.PI * 2 + age * orbitSpeed;
        const x = Math.cos(currentAngle) * data.radius;
        const y = 16.0 + Math.sin(currentAngle) * data.radius;
        const z = -420.0 + Math.sin(age * 2.0 + data.index) * 1.2;

        enemy.mesh.position.set(x, y, z);
        enemy.mesh.rotation.z = currentAngle + Math.PI / 2;
        return false;
      }

      // 5. Boss Core: Nested in the center of the Rose Window
      if (data.role === 'boss-core') {
        if (!bossPhaseEmitted) {
          bossPhaseEmitted = true;
          bus.emit('bossphase', { phase: 'summoned' });
        }

        const pulse = Math.sin(age * 4.0) * 0.4;
        const hoverX = Math.sin(age * 1.5) * 1.2;
        const hoverY = 16.0 + Math.cos(age * 1.2) * 0.8;
        const hoverZ = -418.0 + pulse;

        enemy.mesh.position.set(hoverX, hoverY, hoverZ);
        enemy.mesh.rotation.z += 0.005;

        // If dead or run ending
        if (enemy.hitPointsRemaining <= 0 && !bossDestroyedEmitted) {
          bossDestroyedEmitted = true;
          bus.emit('bossphase', { phase: 'destroyed' });
        }

        return false;
      }

      // 6. Stolen Ember: Lockable projectile hazard
      if (data.role === 'ember') {
        if (age > 4.0) return true;
        enemy.mesh.position.addScaledVector(data.velocity, 0.016);
        return false;
      }

      return false;
    },
  };
}
