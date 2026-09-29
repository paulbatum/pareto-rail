import { CatmullRomCurve3, Vector3 } from 'three';
import type { EventBus } from '../../events';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner-types';
import { createMusicTime } from '../../engine/music-time';
import { createRailPacer, type RailLead } from '../../engine/rail-pacer';
import { offsetFromRail, sampleRailFrame } from '../../engine/rail';
import { shotBehindCamera, updateHostileShotImpact, type HostileShotImpactState } from '../../engine/hostile-shot';

export const BPM = 128;
export const TIME = createMusicTime(BPM, { stepsPerBar: 16 });
export const DURATION = TIME.bar(32);
export const MARKERS = { launch: 0, crossfire: TIME.bar(4), broadside: TIME.bar(8), belly: TIME.bar(12), eye: TIME.bar(15), shields: TIME.bar(17), escorts: TIME.bar(23), trench: TIME.bar(25), victory: TIME.bar(30) };

// Time knots are also the scenic placement contract. Arc-length remapping makes
// each set piece occur at its authored musical instant despite unequal distances.
const KNOTS: Array<[number, number, number, number]> = [
  [0, 0, 8, 350], [2, 0, 30, 100], [5, -40, 50, -350],
  [7.5, 110, 90, -750], [10, -120, -40, -1150], [12, 100, 60, -1450],
  [15, -35, -5, -1850], [18, -35, -5, -2450], [21, 65, -90, -2900],
  [24, 30, -70, -3400], [28, 230, 180, -3750], [31.875, 180, -10, -4150],
  [34, 180, -10, -4410], [37, 180, -10, -4750], [40, 180, -10, -5100],
  [43.125, 240, 10, -5490], [45, 250, 140, -5800], [46.875, 0, 180, -5800],
  [48.5, 0, 87, -5510], [51, 0, 87, -5470], [53.5, 0, 87, -5430], [55, 0, 87, -5400],
  [56.25, 0, 130, -4400], [58, 750, 650, -3550], [60, 1900, 1450, -2100],
];
export function createRail() {
  const curve = new CatmullRomCurve3(KNOTS.map(([, x, y, z]) => new Vector3(x, y, z).multiplyScalar(0.55)), false, 'catmullrom', 0.2);
  curve.arcLengthDivisions = 2400;
  return curve;
}
const rail = createRail();
const lengths = rail.getLengths(2400);
const distances = KNOTS.map((_, i) => {
  const p = i / (KNOTS.length - 1) * 2400;
  const j = Math.floor(p);
  return ((lengths[j] ?? 0) + ((lengths[Math.min(2400, j + 1)] ?? 0) - (lengths[j] ?? 0)) * (p - j)) / rail.getLength();
});
export function runProgress(time: number) {
  const t = Math.max(0, Math.min(DURATION, time));
  const i = Math.max(0, KNOTS.findIndex((k) => k[0] >= t) - 1);
  if (t >= DURATION) return 1;
  const f = (t - KNOTS[i][0]) / (KNOTS[i + 1][0] - KNOTS[i][0]);
  return distances[i] + (distances[i + 1] - distances[i]) * f;
}
export type Kind = 'dart' | 'bomber' | 'helix' | 'turret' | 'generator' | 'power' | 'bolt';
export type Data = { x: number; y: number; phase: number; lead: number; engagement?: RailLead; index?: number; position?: Vector3 };
export type BattleState = { shields: number; cores: number; victory: boolean; victoryAt: number; failed: boolean; shieldIds: Set<number>; coreIds: Set<number>; kinds: Map<number, string> };
export function createBattleState(): BattleState {
  return { shields: 0, cores: 0, victory: false, victoryAt: -1, failed: false, shieldIds: new Set(), coreIds: new Set(), kinds: new Map() };
}
const pacer = createRailPacer({ curve: rail, duration: DURATION, runProgress, spawnAheadUnits: 76, defaultLeadSeconds: 5.2 });
export function buildTimeline() {
  const entries: Array<LockOnSpawnEntry<Kind, Data>> = [];
  function wave(bar: number, kind: Kind, count: number, shape: 'fan' | 'diagonal' | 'ring', flip = 1) {
    for (let i = 0; i < count; i++) {
      const t = TIME.bar(bar) + TIME.step(0, i % 3);
      const a = i / count * Math.PI * 2;
      const x = shape === 'ring' ? Math.cos(a) * 32 : (i - (count - 1) / 2) * 15 * flip;
      const y = shape === 'ring' ? Math.sin(a) * 21 : shape === 'diagonal' ? (i - (count - 1) / 2) * 9 * flip : (i % 2 ? -1 : 1) * 17;
      entries.push({ time: t, kind, hitPoints: kind === 'bomber' || kind === 'turret' ? 2 : 1, data: { x, y, phase: a, lead: 5.2, engagement: pacer.resolve(t, 5.2) } });
    }
  }
  wave(1, 'dart', 4, 'diagonal'); wave(3, 'helix', 5, 'ring');
  wave(5, 'dart', 6, 'fan', -1); wave(6.5, 'bomber', 3, 'diagonal');
  wave(8, 'helix', 6, 'ring'); wave(10, 'dart', 6, 'diagonal', -1);
  wave(12, 'turret', 4, 'fan'); wave(13.5, 'bomber', 3, 'diagonal', -1);
  // The eye of the battle deliberately leaves a two-bar breath in the score.
  wave(16, 'helix', 4, 'ring');
  for (let i = 0; i < 4; i++) {
    const t = TIME.bar(17 + i);
    entries.push({ time: t, kind: 'generator', hitPoints: 3, data: { x: -25, y: i % 2 ? 16 : -15, phase: i, lead: 3.5, index: i } });
  }
  wave(18, 'dart', 4, 'diagonal', -1); wave(20.5, 'helix', 4, 'ring');
  wave(23, 'dart', 6, 'fan'); wave(24, 'bomber', 3, 'diagonal', -1);
  for (let i = 0; i < 3; i++) {
    const t = TIME.bar(25) + TIME.step(0, i * 2);
    entries.push({ time: t, kind: 'power', hitStages: [2, 2], lockable: false, data: { x: i === 1 ? 0 : (i - 1) * 18, y: i === 1 ? -12 : 12, phase: i, lead: 8.2, index: i, position: new Vector3((1 - i) * 22, i === 1 ? 35 : 61, -5350 * 0.55) } });
  }
  wave(27.5, 'dart', 4, 'fan');
  for (const e of entries) {
    if (e.time >= TIME.bar(16) && e.time < TIME.bar(23) && e.kind !== 'generator') e.data.x += 42;
    if (e.time >= TIME.bar(20) && e.time < TIME.bar(23) && e.kind === 'helix') e.data.x += 18;
    if (e.time >= TIME.bar(27) && e.kind === 'dart') { e.data.x *= 0.5; e.data.y = e.data.y > 0 ? 14 : -5; }
  }
  return entries.sort((a, b) => a.time - b.time);
}
export const TIMELINE = buildTimeline();
export function bossPosition(entry: LockOnSpawnEntry<Kind, Data>) {
  if (entry.data.position) return entry.data.position.clone();
  return offsetFromRail(rail, runProgress(entry.time + entry.data.lead), new Vector3(entry.data.x, entry.data.y, 0));
}

export function createGameplay(bus: EventBus, state: BattleState = createBattleState()): LockOnRunnerLevel<Kind, Data> {
  const ids = state.kinds;
  let liveTime = 0;
  let pullFrom: Vector3 | undefined;
  bus.on('runstart', () => { state.shields = 0; state.cores = 0; state.victory = false; state.victoryAt = -1; state.failed = false; liveTime = 0; pullFrom = undefined; state.shieldIds.clear(); state.coreIds.clear(); ids.clear(); });
  bus.on('spawn', ({ kind, enemyId }) => { ids.set(enemyId, kind); if (kind === 'generator') state.shieldIds.add(enemyId); if (kind === 'power') state.coreIds.add(enemyId); });
  bus.on('kill', ({ enemyId }) => {
    if (state.shieldIds.delete(enemyId)) { state.shields++; if (state.shields === 4) bus.emit('bossphase', { phase: 'exposed' }); }
    if (state.coreIds.delete(enemyId)) { state.cores++; if (state.cores === 3) { state.victory = true; state.victoryAt = liveTime; bus.emit('bossphase', { phase: 'destroyed' }); } }
  });
  // Clone entries: phase locks are per-run state, never shared with another runtime.
  const timeline = buildTimeline();
  return {
    duration: DURATION, bpm: BPM, createRail, easeRunProgress: runProgress, spawnTimeline: timeline,
    playerHealth: 5, lockRadiusNdc: 0.14,
    timing: { shotDelay: { maxGridSeconds: 0.15 }, actionSfx: { enabled: true, gridThirtyseconds: 1 } },
    updateEnemy(c) {
      const { enemy, age, runTime, camera, curve, enemyState, spawnEnemy, damagePlayer } = c;
      liveTime = runTime;
      if (state.victory) return true;
      const d = enemy.entry.data;
      if (enemy.kind === 'bolt') {
        const s = enemyState(() => {
          const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
          const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
          const relative = (d.position ?? camera.position).clone().sub(camera.position);
          return { velocity: new Vector3(), x: Math.max(-30, Math.min(30, relative.dot(right))), y: Math.max(-20, Math.min(20, relative.dot(up))), last: age, ...( {} as HostileShotImpactState) };
        });
        const dt = Math.max(0, Math.min(0.05, age - s.last)); s.last = age;
        const forward = new Vector3(); camera.getWorldDirection(forward);
        const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        const f = Math.max(0, 1 - age / 2.7);
        enemy.mesh.position.copy(camera.position).addScaledVector(forward, Math.max(4, 72 - age * 24)).addScaledVector(right, s.x * f).addScaledVector(up, s.y * f);
        const hit = updateHostileShotImpact({ age, camera, position: enemy.mesh.position, velocity: s.velocity, state: s, config: { hitDistance: 7, damageDistance: 1.5, impactBrake: 0.6 } });
        if (hit.phase === 'braking' && hit.damaged) { damagePlayer(); return true; }
        enemy.mesh.rotateZ(dt * 4);
        return age > 5.5 || shotBehindCamera(camera, enemy.mesh.position, 10);
      }
      const boss = enemy.kind === 'generator' || enemy.kind === 'power';
      const u = boss ? runProgress(enemy.spawnTime + d.lead) : pacer.sample(enemy.spawnTime, runTime, d.engagement).anchorU;
      let x = d.x, y = d.y;
      if (enemy.kind === 'dart') { x += Math.sin(age * 2.3 + d.phase) * 11; y += Math.sin(age * 1.6 + d.phase) * 3; }
      if (enemy.kind === 'helix') { x += Math.cos(age * 1.6 + d.phase) * 12; y += Math.sin(age * 1.6 + d.phase) * 11; }
      if (enemy.kind === 'bomber') { y += Math.sin(age * 0.9 + d.phase) * 5; x += Math.sin(age * 0.7 + d.phase) * 3; }
      if (enemy.kind === 'turret') { y -= Math.max(0, 1 - age) * 17; }
      enemy.mesh.position.copy(d.position ?? offsetFromRail(curve, u, new Vector3(x, y, 0)));
      const f = sampleRailFrame(curve, u);
      enemy.mesh.lookAt(enemy.mesh.position.clone().sub(f.tangent));
      enemy.mesh.rotateZ(enemy.kind === 'helix' ? age * 1.2 : Math.sin(age * 2 + d.phase) * (enemy.kind === 'dart' ? 0.5 : 0.08));
      if (enemy.kind === 'power') {
        enemy.entry.lockable = state.shields === 4;
        enemy.mesh.userData.shielded = !enemy.entry.lockable;
        for (const side of ['armor-left', 'armor-right']) { const armor = enemy.mesh.getObjectByName(side); if (armor) { armor.visible = enemy.hitStageIndex === 0; armor.rotation.z = Math.sin(age * 2) * 0.1; } }
      }
      if (enemy.kind === 'bomber' || enemy.kind === 'turret' || enemy.kind === 'generator') {
        const s = enemyState(() => ({ fired: 0 }));
        const shotAge = enemy.kind === 'generator' ? 2.0 + s.fired * 1.7 : 3.1;
        if (age >= shotAge && s.fired < (enemy.kind === 'generator' ? 2 : 1)) {
          s.fired++;
          spawnEnemy({ time: runTime, kind: 'bolt', countsTowardTotal: false, data: { x: 0, y: 0, phase: 0, lead: 3, position: enemy.mesh.position.clone() } });
        }
      }
      if (boss) { if (age > d.lead + 0.8) { state.failed = true; return true; } return false; }
      return age > d.lead + 0.5;
    },
    updateCameraEffects({ camera, runTime }) {
      const t = runTime;
      let roll = Math.sin(t * 0.75) * 0.08;
      if (t > 7.5 && t < 12) roll += (((t - 7.5) / 4.5) ** 2 * (3 - 2 * (t - 7.5) / 4.5)) * Math.PI * 2;
      if (t > 20 && t < 26) roll -= Math.sin((t - 20) / 6 * Math.PI) * 0.8;
      camera.rotateZ(roll);
      camera.fov = 64 + (t > 14 && t < 20 ? 10 : t > 56 ? 8 : 0);
      if (state.victory) {
        pullFrom ??= camera.position.clone();
        const f = Math.max(0, Math.min(1, (t - state.victoryAt) / (DURATION - state.victoryAt)));
        const eased = f * f * (3 - 2 * f);
        camera.position.copy(pullFrom).lerp(new Vector3(1045, 797, -1155), eased);
        camera.position.x += Math.sin(f * Math.PI) * 350;
        camera.position.y += Math.sin(f * Math.PI) * 180;
        camera.lookAt(new Vector3(0, 0, -2530));
      } else if (t > 56.25) camera.lookAt(new Vector3(0, 0, -2530));
      camera.updateProjectionMatrix();
    },
    scoreForHit: (_n, e) => e.kind === 'power' ? 160 : 60,
    scoreForKill: (n, e) => (e.kind === 'power' ? 1200 : e.kind === 'generator' ? 650 : e.kind === 'bolt' ? 90 : 140) * (1 + (n - 1) * 0.22),
    scoreForVolley: (results) => results.length >= 6 && results.every((r) => r.killed) ? 1500 : 0,
    rankForRun: (_score, kills, total) => state.victory && kills / total > 0.9 ? 'ADMIRAL' : state.victory ? 'ACE' : kills / total > 0.6 ? 'PILOT' : 'CADET',
    detailsForRun: () => [`SHIELD GENERATORS ${state.shields}/4`, `POWER SYSTEMS ${state.cores}/3`, state.victory ? 'ENEMY FLAGSHIP DESTROYED' : 'FLAGSHIP SURVIVED — REARM AND RETURN'],
  };
}
