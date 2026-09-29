import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';
import type { LockOnRunnerLevel, LockOnSpawnEntry } from '../../engine/lock-on-runner';
import { offsetFromRail } from '../../engine/rail';
import { createMusicTime } from '../../engine/music-time';
import type { EventBus } from '../../events';

export const STRANDLINE_2JV4_BPM = 96;
export const TIME = createMusicTime(STRANDLINE_2JV4_BPM, { stepsPerBar: 16 });
export const DURATION = TIME.bar(24); // 24 four-beat phrases; exactly one minute.
export const CROWN = new Vector3(0, 78, -40);
export const BOSS_CAMERA = new Vector3(0, 56, 8);
export type Kind = 'clamp' | 'skate' | 'spore' | 'brood' | 'parent';
export type SpawnData = { x: number; y: number; phase: number; lead?: number; cohort?: number };
type Entry = LockOnSpawnEntry<Kind, SpawnData>;
const clamp = MathUtils.clamp;
const smooth = (x: number) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// A climb through the skirt; the fifth turn leaves the forest to see the moon.
const RAIL_POINTS = [
  [0,-78,34], [18,-63,12], [28,-48,-22], [6,-31,-55], [-30,-18,-44],
  [-76,-4,-4], [-66,18,50], [-28,29,25], [16,34,-4], [25,47,-28],
  [0,56,8], [0,56,8.5], [0,56,9], [0,56,10], [28,42,70], [0,-3,228],
];
export function createStrandline2jv4Rail() {
  const rail = new CatmullRomCurve3(RAIL_POINTS.map(p => new Vector3(...p as [number,number,number])), false, 'catmullrom', 0.35);
  rail.arcLengthDivisions = 1200;
  return rail;
}
const rail = createStrandline2jv4Rail();
const lengths = rail.getLengths(1200);
export function runProgress(time: number) {
  const k = clamp(time / 4, 0, 15);
  const i = Math.min(14, Math.floor(k));
  return MathUtils.lerp(lengths[i * 80], lengths[(i + 1) * 80], k - i) / lengths[1200];
}

function makeTimeline(): Entry[] {
  const entries: Entry[] = [];
  const wave = (bar: number, kind: Kind, sockets: number[][], stagger = TIME.stepSeconds) => {
    sockets.forEach(([x,y], i) => entries.push({time: TIME.bar(bar) + stagger * i, kind,
      data: { x, y, phase: i * 1.7 + bar, lead: bar >= 10 ? 3.6 : kind === 'clamp' ? 4.8 : 4.5 },
      hitPoints: kind === 'clamp' && bar >= 11 ? 2 : 1 }));
  };
  wave(0.5, 'clamp', [[-9,5],[9,-4],[-3,-7]]);
  wave(2, 'skate', [[-11,-5],[10,5],[0,8],[7,-6]]);
  wave(3.75, 'spore', [[-10,6],[10,6],[-9,-6],[9,-6]]);
  wave(5.25, 'clamp', [[-12,2],[12,-2],[-5,7],[5,-7]]);
  wave(6.5, 'skate', [[-10,-7],[11,7],[-11,6],[10,-5]]);
  // The wide swing is a breath in the score. A small arc keeps it playable.
  wave(8.5, 'spore', [[-12,-6],[12,5],[-5,8]], TIME.beatSeconds / 2);
  wave(10, 'clamp', [[-12,6],[12,-6],[-9,-6],[9,6]]);
  wave(11.5, 'skate', [[-12,0],[12,0],[-5,8],[5,-8],[10,6]], TIME.stepSeconds / 2);
  wave(13, 'spore', [[-12,7],[12,7],[-12,-7],[12,-7],[0,8],[0,-8]], TIME.stepSeconds / 2);
  wave(14.25, 'clamp', [[-11,5],[11,-5],[-8,-7],[8,7]], TIME.stepSeconds);
  for (const [i,[x,y]] of [[-11,7],[11,7],[-10,-6],[10,-6]].entries()) entries.push({time:TIME.step(16,2+i),kind:'brood',data:{x,y,phase:i*1.8,cohort:0}});
  return entries.sort((a,b) => a.time - b.time);
}

export function createGameState(bus: EventBus) {
  const timeline = makeTimeline();

  const state = { parentId: -1, broodIds: new Set<number>(), killed: 0, cohort: 0,
    cleared: 0, parentDead: false, exposed: false, victoryTime: -1, time: 0 };
  let spawn: ((entry:Entry)=>number) | undefined;
  const nextBrood=() => { if(!spawn)return; state.cohort=2; [[-11,7],[11,7],[-10,-6],[10,-6]].forEach(([x,y],i)=>spawn!({time:state.time,kind:'brood',data:{x,y,phase:i*1.8,cohort:1}})); };
  const off = [
    bus.on('runstart', () => { state.parentId = -1; state.broodIds.clear(); state.killed = 0;
      state.cohort = 0; state.cleared = 0; state.parentDead = false; state.exposed = false;
      state.victoryTime = -1; state.time = 0; spawn=undefined; }),
    bus.on('spawn', e => { if(e.kind === 'parent') state.parentId = e.enemyId;
      if(e.kind === 'brood') { state.broodIds.add(e.enemyId); if(state.cohort===0) {state.cohort=1;bus.emit('bossphase',{phase:'summoned'});} } }),
    bus.on('kill', e => { state.killed++; if(state.broodIds.delete(e.enemyId)) {
        state.cleared++;
        if(state.cleared===4 && state.cohort===1 && state.time>=TIME.bar(17)) nextBrood();
        if(state.cleared===8 && !state.exposed && spawn) {state.exposed=true;spawn({time:state.time,kind:'parent',hitStages:[3,3],data:{x:0,y:0,phase:0}});bus.emit('bossphase',{phase:'exposed'});}
      }
      if(e.enemyId === state.parentId) { state.parentDead = true; state.victoryTime = state.time;
        bus.emit('bossphase', {phase:'destroyed'}); } }),
    bus.on('miss', e => { if(state.broodIds.delete(e.enemyId) && spawn && state.time<51) {
      const i=state.cleared%4;spawn({time:state.time,kind:'brood',data:{x:i%2?11:-11,y:i<2?7:-6,phase:i,cohort:state.cohort-1}});
    } }),
  ];
  const level: LockOnRunnerLevel<Kind,SpawnData> = {
    duration: DURATION, bpm: STRANDLINE_2JV4_BPM, createRail: createStrandline2jv4Rail,
    easeRunProgress: runProgress, spawnTimeline: timeline, playerHealth: 4, allowLockUndo: true,
    lockRadiusNdc: 0.13,
    timing: { shotDelay: {pattern:'linear',gapThirtyseconds:1,releaseShare:.35},actionSfx:{enabled:true,gridThirtyseconds:1} },
    updateEnemy(c) {
      const {enemy, age, runTime, curve, camera} = c;
      state.time = runTime; spawn=c.spawnEnemy;
      const d = enemy.entry.data;
      if(enemy.kind === 'parent') {
        enemy.mesh.position.copy(CROWN);
        enemy.mesh.quaternion.copy(camera.quaternion);
        enemy.mesh.userData.webFraction = 1 - state.cleared / 8;
        enemy.mesh.userData.damage = 1 - enemy.hitPointsRemaining / 6;
        enemy.mesh.scale.setScalar(1 + Math.sin(runTime * 2.1) * 0.025);
        if(runTime > 54) return true;
        return false;
      }
      if(enemy.kind === 'brood') {
        const detach = .62 + .38 * smooth(age / 1.4);
        enemy.mesh.position.copy(CROWN).add(new Vector3(d.x * detach, d.y * detach - 2, 9 + 7 * detach));
        enemy.mesh.position.x += Math.sin(age * 1.8 + d.phase) * 1.7;
        enemy.mesh.position.y += Math.cos(age * 1.5 + d.phase) * 1.3;
        enemy.mesh.quaternion.copy(camera.quaternion);
        enemy.mesh.rotateZ(Math.sin(age * 2 + d.phase) * .35);
        if(age > 7.0) { c.damagePlayer(); return true; }
        return false;
      }
      const lead = d.lead ?? 5;
      let x = d.x, y = d.y;
      if(enemy.kind === 'clamp') {
        // Attached initially, then unhooks and lunges across its strand.
        const detach = smooth((age - 1.4) / 1.4);
        x += Math.sin(d.phase) * 3 * detach;
        y += Math.sin(age * 1.7 + d.phase) * .6 * detach;
        enemy.mesh.rotation.set(0, Math.sin(age * .8 + d.phase) * .2, Math.sin(d.phase) * .4 + detach * .5);
      } else if(enemy.kind === 'skate') {
        const detached=smooth((age-.7)/1.1);
        x += Math.sin(age * 1.5 + d.phase) * 4 * detached;
        y += Math.sin(age * .7 + d.phase) * 1.3 * detached;
        enemy.mesh.rotation.set(.2, .1, Math.cos(age * 1.5 + d.phase) * .55);
      } else {
        const detached=smooth((age-.6)/.9);
        x += Math.cos(age * 2 + d.phase) * 2 * detached;
        y += Math.sin(age * 2 + d.phase) * 2 * detached;
        enemy.mesh.rotation.set(age * .6, age * .4, age * .8);
      }
      if(enemy.mesh.userData.attachment) {const attachment=enemy.mesh.userData.attachment;attachment.scale.y=Math.max(0,1-smooth((age-.75)/.85));attachment.visible=age<1.6;}
      enemy.mesh.position.copy(offsetFromRail(curve,c.railAnchor(lead),new Vector3(x,y,0)));
      if(age > lead + .7) { if(enemy.kind === 'clamp') c.damagePlayer(); return true; }
      return false;
    },
    updateAttractCamera({camera, modeTime}) {
      camera.position.set(0 + Math.sin(modeTime * .22) * 1.2,-77,35);
      camera.lookAt(18,-54,5);
    },
    updateCameraEffects({camera,runTime}) {
      state.time = runTime;
      // Keep brood scheduling on the run clock, including muted or unavailable audio.
      if(state.cleared===4&&state.cohort===1&&runTime>=TIME.bar(17))nextBrood();
      if(runTime >= 38 && runTime < 54) {
        const t = smooth((runTime - 38) / 2);
        camera.position.lerp(BOSS_CAMERA,t);
        const gaze = CROWN.clone();
        if(t < 1) { const forward = camera.getWorldDirection(new Vector3()); gaze.lerp(camera.position.clone().addScaledVector(forward,45),1-t); }
        camera.lookAt(gaze);
      }
      if(state.parentDead || runTime >= 54) {
        const start=state.parentDead ? state.victoryTime : 54;
        const t = smooth((runTime-start)/(60-start));
        camera.position.copy(BOSS_CAMERA).lerp(new Vector3(0,-3,228),t);
        camera.lookAt(CROWN.clone().lerp(new Vector3(0,-3,-40),t));
      } else if(runTime >= 19 && runTime <= 25.5) {
        const t=smooth((runTime-19)/1.5)*smooth((25.5-runTime)/1.5);
        const gaze=camera.position.clone().addScaledVector(camera.getWorldDirection(new Vector3()),100).lerp(new Vector3(0,88,-40),t);
        camera.lookAt(gaze);
      } else if(runTime < 38) {
        camera.rotateZ(Math.sin(runTime * .31) * .085);
      }
      camera.updateMatrixWorld();
    },
    scoreForKill: (size,e) => (e.kind === 'parent' ? 1800 : e.kind === 'brood' ? 180 : 100) * (1 + .18 * (size-1)),
    scoreForHit: (size) => 35 * size,
    scoreForVolley: hits => hits.length === 6 && hits.every(h => h.killed) ? 500 : 0,
    rankForRun: (_s,k,total) => k/total > .93 ? 'S' : k/total > .76 ? 'A' : k/total > .5 ? 'B' : 'C',
    detailsForRun: () => [state.parentDead ? 'PARENT REMOVED · STRANDLINE RESTORED' : 'THE CROWN STILL CARRIES THE COLONY', `${state.cleared}/8 brood webs severed`],
  };
  return { level, state, dispose: () => off.forEach(f=>f()) };
}

export function createStrandlineGameplay(bus: EventBus) { return createGameState(bus).level; }
