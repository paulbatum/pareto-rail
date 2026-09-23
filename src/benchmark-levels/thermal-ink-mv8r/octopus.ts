import { MathUtils, Quaternion, Vector3 } from 'three';

// The octopus rig: pure kinematics, no meshes. Gameplay drives it (arm
// attacks, severing, the rear-up, the collapse) and reads it to seat the arm
// nodes and the core; the visuals read the same spines to build the tentacle
// tubes. Nothing here decides *when* anything happens — gameplay passes the
// schedule in.

export const ARM_COUNT = 8;
export const ARM_POINTS = 40;
/** Samples 0..A_END hug the body, A_END..SUB_END run underwater, the rest emerge. */
const A_END = 6;
const SUB_END = 10;
const EMERGE_POINTS = ARM_POINTS - SUB_END;
/** Fraction of the emergent run where the node sits; the rest is the curling tip. */
const NODE_FRACTION = 0.74;
export const NODE_INDEX = SUB_END + Math.round(NODE_FRACTION * (EMERGE_POINTS - 1));

const UP = new Vector3(0, 1, 0);
const WATER_Y = 0;
/** The creature's size relative to its authored body plan. */
export const BODY_SCALE = 1.35;

export type ViewPose = {
  position: Vector3;
  forward: Vector3;
  right: Vector3;
  up: Vector3;
};

export type ArmAttack = {
  arm: number;
  /** Run time the arm starts to erupt from the water. */
  from: number;
  /** Seconds the eruption takes. */
  riseSeconds: number;
  /** Run time the window closes: an unsevered arm slams across the rail. */
  until: number;
  /** View-space emergence point: [x fraction of half-width, depth]. */
  root: readonly [number, number];
  /** View-space node hover point: [x fraction, y fraction, depth]. */
  node: readonly [number, number, number];
  /** Node sway amplitude in view fractions. */
  sway: readonly [number, number];
};

export type ArmPhase = 'idle' | 'reaching' | 'slamming' | 'severed' | 'retreating';

export type ArmState = {
  index: number;
  points: Vector3[];
  radii: Float32Array;
  phase: ArmPhase;
  phaseAt: number;
  attack: ArmAttack | null;
  /** 0 submerged → 1 fully risen, for the emergent part of a reaching arm. */
  rise: number;
  /** 0 idle drape → 1 attack path, eased. */
  reach: number;
  /** Stump length after severing (1 = whole arm). */
  lengthScale: number;
  /** Recoil impulse from hits, decays. */
  flinch: number;
  /** World position of the node's outer surface (where the target sits). */
  node: Vector3;
  /** Direction from the node toward the viewer, for seating adornments. */
  nodeNormal: Vector3;
  /** The severed piece, falling into the harbor. */
  piece: {
    active: boolean;
    age: number;
    points: Vector3[];
    velocities: Vector3[];
    radii: Float32Array;
    count: number;
    rest: Float32Array;
  };
  /** Lash progress while slamming (0..1). */
  lash: number;
};

export type OctopusRig = ReturnType<typeof createOctopusRig>;

/** Maps view-space fractions to world space. Must return a fresh vector. */
export type ViewToWorld = (xf: number, yf: number, depth: number) => Vector3;

export function createOctopusRig() {
  const body = {
    position: new Vector3(0, 0, 0),
    quaternion: new Quaternion(),
    yaw: 0,
    /** 0 crouched on the wreck → 1 reared up, crown facing the viewer. */
    rear: 0,
    /** 0 alive → 1 slumped dead. */
    collapse: 0,
    /** 0 → 1 as it sinks away into the ink (escape ending). */
    sink: 0,
    breath: 0,
    /** Crown curl: the arms fold over the core while it regrows its membrane. */
    guard: 0,
  };
  const core = { position: new Vector3(), normal: new Vector3(0, 0, 1), open: 0 };
  const eyes = [new Vector3(), new Vector3()];
  const mantle = { center: new Vector3(), quaternion: new Quaternion() };

  const arms: ArmState[] = Array.from({ length: ARM_COUNT }, (_, index) => ({
    index,
    points: Array.from({ length: ARM_POINTS }, () => new Vector3()),
    radii: new Float32Array(ARM_POINTS),
    phase: 'idle' as ArmPhase,
    phaseAt: 0,
    attack: null,
    rise: 0,
    reach: 0,
    lengthScale: 1,
    flinch: 0,
    node: new Vector3(),
    nodeNormal: new Vector3(0, 0, 1),
    piece: {
      active: false,
      age: 0,
      points: Array.from({ length: ARM_POINTS }, () => new Vector3()),
      velocities: Array.from({ length: ARM_POINTS }, () => new Vector3()),
      radii: new Float32Array(ARM_POINTS),
      count: 0,
      rest: new Float32Array(ARM_POINTS),
    },
    lash: 0,
  }));

  // Scratch space, reused every frame.
  const tmpA = new Vector3();
  const tmpB = new Vector3();
  const tmpC = new Vector3();
  const tmpD = new Vector3();
  const dir = new Vector3();
  const axis = new Vector3();
  const idle = Array.from({ length: ARM_POINTS }, () => new Vector3());
  const attackPath = Array.from({ length: ARM_POINTS }, () => new Vector3());
  const yawQ = new Quaternion();
  const pitchQ = new Quaternion();
  const X_AXIS = new Vector3(1, 0, 0);

  function localToWorld(local: Vector3, target: Vector3) {
    return target.copy(local).multiplyScalar(BODY_SCALE).applyQuaternion(body.quaternion).add(body.position);
  }

  function reset() {
    body.yaw = 0;
    body.rear = 0;
    body.collapse = 0;
    body.sink = 0;
    body.guard = 0;
    core.open = 0;
    for (const arm of arms) {
      arm.phase = 'idle';
      arm.phaseAt = 0;
      arm.attack = null;
      arm.rise = 0;
      arm.reach = 0;
      arm.lengthScale = 1;
      arm.flinch = 0;
      arm.lash = 0;
      arm.piece.active = false;
    }
  }

  // ---- body ------------------------------------------------------------------

  function updateBody(time: number, dt: number, viewer: Vector3) {
    // Turn to keep the viewer in reach: a heavy, rate-limited yaw.
    const desired = Math.atan2(viewer.x - body.position.x, viewer.z - body.position.z);
    let delta = desired - body.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const maxTurn = 0.7 * dt;
    body.yaw += MathUtils.clamp(delta * Math.min(1, dt * 1.6), -maxTurn, maxTurn);

    body.breath = Math.sin(time * Math.PI * 0.8) * 0.5 + 0.5;
    const lift = (2 + body.rear * 9 - body.collapse * 13 - body.sink * 34) * BODY_SCALE;
    body.position.set(0, lift, 0);
    yawQ.setFromAxisAngle(UP, body.yaw);
    // Rearing pitches the crown up toward the viewer; the collapse throws it
    // back and down.
    const pitch = -body.rear * 1.05 * (1 - body.collapse * 0.55) - body.collapse * 0.35;
    pitchQ.setFromAxisAngle(X_AXIS, pitch);
    body.quaternion.copy(yawQ).multiply(pitchQ);

    localToWorld(tmpA.set(0, 11 + body.breath * 0.8, -5), mantle.center);
    mantle.quaternion.copy(body.quaternion);
    localToWorld(tmpA.set(-5.2, 6.2, 5.2), eyes[0]);
    localToWorld(tmpA.set(5.2, 6.2, 5.2), eyes[1]);

    localToWorld(tmpA.set(0, 0.4, 3.2), core.position);
    // The core faces out of the crown: local -y, pushed forward.
    core.normal.set(0, -0.55, 0.84).normalize().applyQuaternion(body.quaternion);
    core.position.addScaledVector(core.normal, 6 * BODY_SCALE * core.open);
  }

  // ---- arms ------------------------------------------------------------------

  function armBase(index: number, target: Vector3, out: Vector3) {
    const phi = ((index + 0.5) / ARM_COUNT) * Math.PI * 2;
    localToWorld(tmpA.set(Math.sin(phi) * 5.4, 0.8, 3 + Math.cos(phi) * 5.4), target);
    out.set(Math.sin(phi), 0.3 - body.guard * 0.6, Math.cos(phi)).applyQuaternion(body.quaternion).normalize();
  }

  // Idle drape: integrate a direction down the arm; gravity pulls it into the
  // water, travelling waves ripple it, and the tip curls back on itself.
  function computeIdle(arm: ArmState, time: number, points: Vector3[], lengthScale: number) {
    armBase(arm.index, points[0], dir);
    const seed = arm.index * 1.7;
    const length = 40 * BODY_SCALE * lengthScale;
    const ds = length / (ARM_POINTS - 1);
    const droop = 0.055 * (1 - body.rear * 0.55) * (1 + body.collapse * 1.6);
    const curl = (2.8 + Math.sin(time * 0.6 + seed) * 0.8) * (1 - body.collapse * 0.8);
    const limp = body.collapse;
    for (let k = 1; k < ARM_POINTS; k += 1) {
      const s = k / (ARM_POINTS - 1);
      dir.y -= droop * ds * (0.5 + s);
      dir.normalize();
      axis.crossVectors(dir, UP);
      if (axis.lengthSq() < 1e-4) axis.set(1, 0, 0);
      axis.normalize();
      const wave = Math.sin(time * 1.9 - s * 7 + seed) * 0.05 * (1 - limp);
      const bend = (curl * MathUtils.smoothstep(s, 0.45, 1) * 0.12 + wave + body.guard * 0.09 * (1 - s)) * (1 - limp * 0.7);
      dir.applyAxisAngle(axis, bend);
      dir.applyAxisAngle(UP, Math.sin(time * 0.7 + s * 3 + seed) * 0.03 * (1 - limp));
      dir.normalize();
      points[k].copy(points[k - 1]).addScaledVector(dir, ds);
    }
  }

  function computeAttack(arm: ArmState, time: number, toWorld: ViewToWorld, attack: ArmAttack) {
    const p = attackPath;
    armBase(arm.index, p[0], dir);
    // Part A: out of the crown and down into the harbor beside the wreck.
    const entry = tmpA.copy(p[0]).addScaledVector(tmpB.set(dir.x, 0, dir.z).normalize(), 9 * BODY_SCALE);
    entry.y = WATER_Y - 9;
    for (let k = 1; k < A_END; k += 1) {
      const t = k / (A_END - 1);
      const arch = Math.sin(t * Math.PI) * 4;
      p[k].copy(p[0]).lerp(entry, t);
      p[k].y += arch;
    }

    // The emergent run is authored in the viewer's frame, so the arm always
    // rises somewhere the player can reach — the creature turns to keep you in.
    const sinkDepth = (1 - arm.rise) * 26;
    const root = toWorld(attack.root[0], 0, attack.root[1]);
    root.y = WATER_Y - 7 - sinkDepth;
    const swayT = time - attack.from;
    const nx = attack.node[0] + Math.sin(swayT * 1.3 + arm.index) * attack.sway[0];
    const ny = attack.node[1] + Math.sin(swayT * 0.9 + arm.index * 2) * attack.sway[1];
    const recoil = arm.flinch * 7 + arm.lash * -attack.node[2] * 0.72;
    const node = toWorld(nx * (1 - arm.lash * 0.8), ny * (1 - arm.lash) - arm.lash * 0.5, attack.node[2] + recoil);
    node.y -= sinkDepth;

    // Underwater run from the wreck to the emergence point.
    for (let k = A_END; k < SUB_END; k += 1) {
      const t = (k - A_END + 1) / (SUB_END - A_END + 1);
      p[k].copy(entry).lerp(root, t);
      p[k].y = WATER_Y - 10 - Math.sin(t * Math.PI) * 4;
    }

    // Emergence: a cubic from under the surface up to the node, arriving from
    // outside-and-above so the arm arches over rather than jabbing straight in.
    const c1 = tmpB.copy(root).addScaledVector(UP, 16 + arm.rise * 8);
    const fromNodeOut = tmpC.copy(node).sub(root);
    fromNodeOut.y = 0;
    if (fromNodeOut.lengthSq() < 1e-4) fromNodeOut.set(1, 0, 0);
    fromNodeOut.normalize();
    const c2 = tmpD.copy(node).addScaledVector(UP, 9).addScaledVector(fromNodeOut, -6);
    const nodeSamples = NODE_INDEX - SUB_END;
    const side = axis.crossVectors(fromNodeOut, UP).normalize();
    for (let k = 0; k <= nodeSamples; k += 1) {
      const t = k / nodeSamples;
      const it = 1 - t;
      const point = p[SUB_END + k];
      point.set(0, 0, 0)
        .addScaledVector(root, it * it * it)
        .addScaledVector(c1, 3 * it * it * t)
        .addScaledVector(c2, 3 * it * t * t)
        .addScaledVector(node, t * t * t);
      const wave = Math.sin(time * 3.1 - t * 6 + arm.index) * Math.sin(t * Math.PI) * 2.4 * (1 - arm.lash);
      point.addScaledVector(side, wave);
    }

    // The tip: keep going past the node and curl up and away from the viewer.
    const tipDir = dir.copy(p[NODE_INDEX]).sub(p[NODE_INDEX - 1]).normalize();
    const away = tmpC.copy(p[NODE_INDEX]).sub(toWorld(0, 0, 0)).normalize();
    const tipAxis = axis.crossVectors(tipDir, away);
    if (tipAxis.lengthSq() < 1e-4) tipAxis.set(1, 0, 0);
    tipAxis.normalize();
    const tipSamples = ARM_POINTS - 1 - NODE_INDEX;
    const tipLength = 9;
    for (let k = 1; k <= tipSamples; k += 1) {
      const s = k / tipSamples;
      tipDir.applyAxisAngle(tipAxis, (0.34 + Math.sin(time * 4 + arm.index) * 0.1) * (0.5 + s));
      tipDir.normalize();
      p[NODE_INDEX + k].copy(p[NODE_INDEX + k - 1]).addScaledVector(tipDir, tipLength / tipSamples);
    }
  }

  function writeRadii(arm: ArmState, attackBlend: number) {
    for (let k = 0; k < ARM_POINTS; k += 1) {
      const s = k / (ARM_POINTS - 1);
      const idleRadius = MathUtils.lerp(2.5 * BODY_SCALE, 0.22, Math.pow(s, 0.8));
      let attackRadius: number;
      if (k < SUB_END) attackRadius = 2.5 * BODY_SCALE;
      else if (k <= NODE_INDEX) attackRadius = MathUtils.lerp(2.5 * BODY_SCALE, 1.15, (k - SUB_END) / (NODE_INDEX - SUB_END));
      else attackRadius = MathUtils.lerp(1.05, 0.18, (k - NODE_INDEX) / (ARM_POINTS - 1 - NODE_INDEX));
      let radius = MathUtils.lerp(idleRadius, attackRadius, attackBlend);
      // A severed stump ends thick and ragged.
      if (arm.lengthScale < 1) radius = MathUtils.lerp(2.5 * BODY_SCALE, 1.3 * BODY_SCALE, s);
      arm.radii[k] = radius * (1 + body.breath * 0.04);
    }
  }

  function updateArm(arm: ArmState, time: number, dt: number, toWorld: ViewToWorld) {
    arm.flinch = Math.max(0, arm.flinch - dt * 3.2);
    const attack = arm.attack;
    const reaching = arm.phase === 'reaching' || arm.phase === 'slamming';
    if (attack && reaching) {
      arm.rise = MathUtils.clamp((time - attack.from) / attack.riseSeconds, 0, 1);
      arm.rise = 1 - (1 - arm.rise) ** 3;
      arm.reach = Math.min(1, arm.reach + dt * 2.5);
    } else if (arm.phase === 'severed' || arm.phase === 'retreating') {
      arm.rise = Math.max(0, arm.rise - dt * 1.1);
      if (arm.rise <= 0) arm.reach = Math.max(0, arm.reach - dt * 1.4);
      if (arm.reach <= 0 && arm.rise <= 0) arm.phase = 'idle';
    }
    if (arm.phase === 'slamming' && attack) arm.lash = Math.min(1, arm.lash + dt / 0.42);
    else arm.lash = Math.max(0, arm.lash - dt * 2);

    computeIdle(arm, time, idle, arm.lengthScale);
    if (attack && arm.reach > 0) {
      computeAttack(arm, time, toWorld, attack);
      const blend = arm.reach * arm.reach * (3 - 2 * arm.reach);
      for (let k = 0; k < ARM_POINTS; k += 1) {
        // The body end blends first so the crown never snaps.
        const local = MathUtils.clamp(blend * 1.4 - (k / ARM_POINTS) * 0.4, 0, 1);
        arm.points[k].copy(idle[k]).lerp(attackPath[k], k < SUB_END ? local : blend);
      }
      writeRadii(arm, blend);
    } else {
      for (let k = 0; k < ARM_POINTS; k += 1) arm.points[k].copy(idle[k]);
      writeRadii(arm, 0);
    }

    const center = arm.points[NODE_INDEX];
    arm.nodeNormal.copy(toWorld(0, 0, 0)).sub(center).normalize();
    arm.node.copy(center).addScaledVector(arm.nodeNormal, arm.radii[NODE_INDEX] * 0.9);

    updatePiece(arm, dt);
  }

  function updatePiece(arm: ArmState, dt: number) {
    const piece = arm.piece;
    if (!piece.active) return;
    piece.age += dt;
    for (let k = 0; k < piece.count; k += 1) {
      const velocity = piece.velocities[k];
      velocity.y -= 22 * dt;
      const point = piece.points[k];
      point.addScaledVector(velocity, dt);
      if (point.y < WATER_Y - 1) {
        velocity.multiplyScalar(Math.max(0, 1 - dt * 6));
        velocity.y = Math.max(velocity.y, -2.5);
      }
    }
    // Keep the chain from stretching apart as it tumbles.
    for (let k = 1; k < piece.count; k += 1) {
      const a = piece.points[k - 1];
      const b = piece.points[k];
      tmpA.copy(b).sub(a);
      const rest = piece.rest[k];
      const length = tmpA.length();
      if (length > rest) b.copy(a).addScaledVector(tmpA, rest / length);
    }
    if (piece.age > 4.5) piece.active = false;
  }

  function update(time: number, dt: number, viewer: Vector3, toWorld: ViewToWorld) {
    updateBody(time, dt, viewer);
    for (const arm of arms) updateArm(arm, time, dt, toWorld);
  }

  // ---- commands from gameplay -----------------------------------------------

  function beginAttack(attack: ArmAttack, time: number) {
    const arm = arms[attack.arm];
    arm.attack = attack;
    arm.phase = 'reaching';
    arm.phaseAt = time;
    arm.lengthScale = 1;
  }

  function slam(armIndex: number, time: number) {
    const arm = arms[armIndex];
    if (arm.phase !== 'reaching') return;
    arm.phase = 'slamming';
    arm.phaseAt = time;
  }

  function retreat(armIndex: number, time: number) {
    const arm = arms[armIndex];
    if (arm.phase !== 'reaching' && arm.phase !== 'slamming') return;
    arm.phase = 'retreating';
    arm.phaseAt = time;
  }

  function sever(armIndex: number, time: number) {
    const arm = arms[armIndex];
    const piece = arm.piece;
    const cut = NODE_INDEX - 3;
    piece.active = true;
    piece.age = 0;
    piece.count = ARM_POINTS - cut;
    const kick = tmpB.copy(arm.nodeNormal).multiplyScalar(-3);
    for (let k = 0; k < piece.count; k += 1) {
      piece.points[k].copy(arm.points[cut + k]);
      piece.radii[k] = arm.radii[cut + k];
      piece.rest[k] = k === 0 ? 0 : arm.points[cut + k].distanceTo(arm.points[cut + k - 1]);
      piece.velocities[k].copy(kick).add(tmpC.set(Math.sin(k * 1.3) * 2.5, 4 + k * 0.35, Math.cos(k * 0.9) * 2.5));
    }
    arm.phase = 'severed';
    arm.phaseAt = time;
    arm.lengthScale = 0.42;
    arm.flinch = 1;
  }

  function flinch(armIndex: number, amount = 1) {
    arms[armIndex].flinch = Math.min(1.4, arms[armIndex].flinch + amount);
  }

  return {
    body,
    core,
    eyes,
    mantle,
    arms,
    reset,
    update,
    beginAttack,
    slam,
    retreat,
    sever,
    flinch,
  };
}
