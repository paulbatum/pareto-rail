import type { Vector3 } from 'three';
import type { HostileShotImpactState } from '../../engine/hostile-shot';
import type { LockOnEnemyUpdate, LockOnSpawnEntry } from '../../engine/lock-on-runner';

// Six species. Four are parasites you meet along the strands; two belong to the
// parent at the crown.
export type StrandlineKind =
  | 'clamper' //  latched on a strand, peels off and pounces in a sweeping arc
  | 'leech' //    free swimmer: an S-wave crossing the frame in schools
  | 'brooder' //  armoured sac on a strand that spits spores as you close
  | 'spore' //    homing hostile shot (interceptable)
  | 'brood' //    larvae hatched onto the parent's webbing
  | 'parent'; //  the boss at the crown

export type StrandlineData =
  | { role: 'clamper'; lead: number; x: number; y: number; detachAt: number; sweep: number }
  | {
    role: 'leech';
    frame: 'rail' | 'camera';
    lead: number;
    fromX: number;
    toX: number;
    y: number;
    depth: number;
    toDepth: number;
    amp: number;
    freq: number;
    delay: number;
    crossTime: number;
  }
  | { role: 'brooder'; lead: number; x: number; y: number; firstSpore: number; period: number }
  | { role: 'spore'; position: Vector3; velocity: Vector3; lastAge: number; impact: HostileShotImpactState }
  | { role: 'parent' }
  | { role: 'brood'; veil: number; slot: number; count: number };

export type StrandlineEntry = LockOnSpawnEntry<StrandlineKind, StrandlineData>;
export type StrandlineUpdate = LockOnEnemyUpdate<StrandlineKind, StrandlineData>;
