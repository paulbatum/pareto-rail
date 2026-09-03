import {
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import type { CatmullRomCurve3 } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, instancedDynamicBufferAttribute, mix, vec3 } from 'three/tsl';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { TABLE_Y } from '../gameplay';
import { createSupplyGeometry, SUPPLY_SPEC, SUPPLY_TYPES, type SupplyType } from './supplies';

// Rescued supplies. When a glue creature breaks, its body parts become loose
// pieces that arc onto the road ahead, bounce, and settle. The ball rolls
// over them and they stick to its surface, riding its roll for the rest of
// the run. Everything renders through one instanced mesh per supply type, so
// a few hundred pieces cost thirteen draw calls.

const CAPACITY = 120;
const GRAVITY = 26;
const MAX_STUCK = 240;
const MAX_LOOSE_PER_TYPE = 64;

type PieceState = 'loose' | 'stuck' | 'sucked' | 'sinking';

type Piece = {
  type: SupplyType;
  state: PieceState;
  position: Vector3;
  quaternion: Quaternion;
  velocity: Vector3;
  spinAxis: Vector3;
  spin: number;
  scale: number;
  tint: Color;
  age: number;
  bounces: number;
  resting: boolean;
  stuckDir: Vector3;
  stuckQuat: Quaternion;
  stuckAt: number;
  from: Vector3;
  target: Vector3;
  life: number;
  sink: number;
};

export type PieceSpawn = { type: SupplyType; tint: Color; position: Vector3; quaternion: Quaternion; scale: number };

export type BallSnapshot = {
  center: Vector3;
  radius: number;
  quaternion: Quaternion;
  tangent: Vector3;
  right: Vector3;
  /** Rail fraction of the ball, and its speed in world units per second. */
  u: number;
  speed: number;
};

export type PieceSystemOptions = {
  onStick(type: SupplyType, position: Vector3, count: number): void;
  onLand(position: Vector3, scale: number): void;
};

export type PieceSystem = ReturnType<typeof createPieceSystem>;

const UP = new Vector3(0, 1, 0);
const scratchMatrix = new Matrix4();
const scratchScale = new Vector3();
const scratchVector = new Vector3();
const scratchQuaternion = new Quaternion();

export function createPieceSystem(scene: Scene, curve: CatmullRomCurve3, options: PieceSystemOptions) {
  const rng = mulberry32(777);
  const railLength = curve.getLength();
  const pieces: Piece[] = [];
  const meshes = new Map<SupplyType, { mesh: InstancedMesh; tints: InstancedBufferAttribute }>();
  let stuckCount = 0;

  for (const type of SUPPLY_TYPES) {
    const tints = new InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3);
    tints.setUsage(DynamicDrawUsage);
    const finish = SUPPLY_SPEC[type].finish;
    const material = new MeshStandardNodeMaterial({
      roughness: finish === 'matte' ? 0.72 : finish === 'gloss' ? 0.28 : 0.32,
      metalness: finish === 'metal' ? 0.75 : 0.03,
    });
    material.colorNode = attribute<'vec3'>('color', 'vec3').mul(mix(vec3(1, 1, 1), instancedDynamicBufferAttribute(tints, 'vec3'), attribute<'float'>('tintMask', 'float')));
    const mesh = new InstancedMesh(createSupplyGeometry(type), material, CAPACITY);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
    meshes.set(type, { mesh, tints });
  }

  function makePiece(type: SupplyType, tint: Color, position: Vector3, quaternion: Quaternion, scale: number): Piece {
    return {
      type,
      state: 'loose',
      position: position.clone(),
      quaternion: quaternion.clone(),
      velocity: new Vector3(),
      spinAxis: randomUnit(),
      spin: 0,
      scale,
      tint: tint.clone(),
      age: 0,
      bounces: 0,
      resting: false,
      stuckDir: new Vector3(0, 1, 0),
      stuckQuat: new Quaternion(),
      stuckAt: 0,
      from: new Vector3(),
      target: new Vector3(),
      life: 0,
      sink: 1,
    };
  }

  function admit(piece: Piece) {
    // Keep each type's loose count bounded: the oldest loose piece of that
    // type quietly leaves (it is far behind by then).
    const loose = pieces.filter((candidate) => candidate.type === piece.type && candidate.state !== 'stuck');
    if (loose.length >= MAX_LOOSE_PER_TYPE) {
      const oldest = loose.reduce((a, b) => (a.age > b.age ? a : b));
      pieces.splice(pieces.indexOf(oldest), 1);
    }
    pieces.push(piece);
  }

  /** Scatter a creature's parts so they land on the road ahead of the ball. */
  function scatter(spawns: PieceSpawn[], ball: BallSnapshot, burst: number) {
    spawns.forEach((spawn, index) => {
      const piece = makePiece(spawn.type, spawn.tint, spawn.position, spawn.quaternion, spawn.scale);
      const aheadSeconds = Math.min(3.2, 0.9 + index * 0.24 + rng() * 0.3);
      const landU = Math.min(1, ball.u + (ball.speed * aheadSeconds) / railLength);
      const frame = sampleRailFrame(curve, landU);
      const lateral = (rng() - 0.5) * 2 * (ball.radius * 2.2 + 1.2);
      const target = frame.position.clone().addScaledVector(frame.right, lateral);
      target.y = TABLE_Y + SUPPLY_SPEC[spawn.type].rest * spawn.scale;
      const flight = 0.55 + rng() * 0.35;
      piece.velocity.copy(target).sub(piece.position).divideScalar(flight);
      piece.velocity.y += 0.5 * GRAVITY * flight;
      piece.velocity.add(randomUnit().multiplyScalar(burst * (0.4 + rng() * 0.8)));
      piece.spin = 4 + rng() * 9;
      admit(piece);
    });
  }

  /** A loose supply pulled into the Spill, spiralling in and sinking. */
  function suck(type: SupplyType, tint: Color, from: Vector3, center: Vector3, scale: number) {
    const start = from.clone();
    start.y = TABLE_Y + SUPPLY_SPEC[type].rest * scale;
    const piece = makePiece(type, tint, start, new Quaternion().setFromAxisAngle(UP, rng() * Math.PI * 2), scale);
    piece.state = 'sucked';
    piece.from.copy(start);
    piece.target.copy(center);
    piece.life = 1.7 + rng() * 0.6;
    admit(piece);
  }

  function stick(piece: Piece, ball: BallSnapshot) {
    piece.state = 'stuck';
    piece.resting = false;
    scratchQuaternion.copy(ball.quaternion).invert();
    piece.stuckDir.copy(piece.position).sub(ball.center);
    if (piece.stuckDir.lengthSq() < 1e-4) piece.stuckDir.set(0, 1, 0);
    piece.stuckDir.normalize().applyQuaternion(scratchQuaternion);
    piece.stuckQuat.copy(scratchQuaternion).multiply(piece.quaternion);
    piece.stuckAt = piece.age;
    stuckCount += 1;
    options.onStick(piece.type, piece.position, stuckCount);
    if (stuckCount > MAX_STUCK) {
      const oldest = pieces.find((candidate) => candidate.state === 'stuck');
      if (oldest) {
        oldest.state = 'sinking';
        oldest.sink = 1;
        stuckCount -= 1;
      }
    }
  }

  function settleFlat(piece: Piece, dt: number) {
    // Ease toward a yaw-only orientation so pieces come to rest lying flat.
    scratchVector.set(1, 0, 0).applyQuaternion(piece.quaternion);
    if (Math.abs(scratchVector.y) > 0.9) scratchVector.set(0, 0, 1).applyQuaternion(piece.quaternion);
    const yaw = Math.atan2(-scratchVector.z, scratchVector.x);
    scratchQuaternion.setFromAxisAngle(UP, yaw);
    piece.quaternion.slerp(scratchQuaternion, Math.min(1, dt * (piece.bounces > 0 ? 7 : 2.5)));
  }

  function updateLoose(piece: Piece, dt: number, ball: BallSnapshot) {
    const rest = TABLE_Y + SUPPLY_SPEC[piece.type].rest * piece.scale;
    if (!piece.resting) {
      piece.velocity.y -= GRAVITY * dt;
      piece.position.addScaledVector(piece.velocity, dt);
      if (piece.spin > 0.01) {
        scratchQuaternion.setFromAxisAngle(piece.spinAxis, piece.spin * dt);
        piece.quaternion.premultiply(scratchQuaternion).normalize();
      }
      if (piece.position.y < rest) {
        piece.position.y = rest;
        piece.velocity.y = -piece.velocity.y * 0.36;
        piece.velocity.x *= 0.62;
        piece.velocity.z *= 0.62;
        piece.spin *= 0.45;
        piece.bounces += 1;
        if (piece.bounces === 1) options.onLand(piece.position, piece.scale);
        if (piece.velocity.length() < 0.7) {
          piece.velocity.set(0, 0, 0);
          piece.spin = 0;
          piece.resting = true;
        }
      }
      settleFlat(piece, dt);
    }
    // Contact with the ball: stick to its surface.
    const reach = ball.radius + SUPPLY_SPEC[piece.type].radius * piece.scale * 0.55;
    if (piece.position.distanceToSquared(ball.center) < reach * reach) stick(piece, ball);
  }

  function updateStuck(piece: Piece, ball: BallSnapshot) {
    const lift = ball.radius + SUPPLY_SPEC[piece.type].rest * piece.scale * 0.9;
    piece.position.copy(piece.stuckDir).applyQuaternion(ball.quaternion).multiplyScalar(lift).add(ball.center);
    piece.quaternion.copy(ball.quaternion).multiply(piece.stuckQuat);
  }

  function updateSucked(piece: Piece) {
    const t = Math.min(1, piece.age / piece.life);
    const pull = 1 - (1 - t) ** 1.6;
    const angle = t * 3.2;
    scratchVector.copy(piece.from).sub(piece.target);
    const distance = scratchVector.length() * (1 - pull);
    const base = Math.atan2(scratchVector.z, scratchVector.x);
    piece.position.set(
      piece.target.x + Math.cos(base + angle) * distance,
      TABLE_Y + SUPPLY_SPEC[piece.type].rest * piece.scale * (1 - t * 0.9),
      piece.target.z + Math.sin(base + angle) * distance,
    );
    scratchQuaternion.setFromAxisAngle(UP, -angle * 2);
    piece.quaternion.copy(scratchQuaternion);
    piece.sink = 1 - t * 0.95;
    return t >= 1;
  }

  function update(dt: number, ball: BallSnapshot, cameraPosition: Vector3, cameraForward: Vector3) {
    for (let i = pieces.length - 1; i >= 0; i -= 1) {
      const piece = pieces[i];
      piece.age += dt;
      let remove = false;
      switch (piece.state) {
        case 'loose':
          updateLoose(piece, dt, ball);
          if (piece.age > 2) {
            scratchVector.copy(piece.position).sub(cameraPosition);
            if (scratchVector.dot(cameraForward) < -12) remove = true;
          }
          break;
        case 'stuck':
          updateStuck(piece, ball);
          break;
        case 'sucked':
          remove = updateSucked(piece);
          break;
        case 'sinking':
          updateStuck(piece, ball);
          piece.sink -= dt * 1.6;
          if (piece.sink <= 0.02) remove = true;
          break;
      }
      if (remove) pieces.splice(i, 1);
    }
    writeInstances();
  }

  function writeInstances() {
    for (const { mesh } of meshes.values()) mesh.count = 0;
    for (const piece of pieces) {
      const slot = meshes.get(piece.type);
      if (!slot || slot.mesh.count >= CAPACITY) continue;
      const index = slot.mesh.count;
      scratchScale.setScalar(piece.scale * piece.sink);
      scratchMatrix.compose(piece.position, piece.quaternion, scratchScale);
      slot.mesh.setMatrixAt(index, scratchMatrix);
      slot.tints.setXYZ(index, piece.tint.r, piece.tint.g, piece.tint.b);
      slot.mesh.count = index + 1;
    }
    for (const { mesh, tints } of meshes.values()) {
      mesh.instanceMatrix.needsUpdate = true;
      tints.needsUpdate = true;
    }
  }

  /** Lateral offset of the nearest resting piece on the road ahead, or null. */
  function nearestLooseAhead(ball: BallSnapshot, maxAhead: number, maxLateral: number): number | null {
    let best: number | null = null;
    let bestAhead = Infinity;
    for (const piece of pieces) {
      if (piece.state !== 'loose' || !piece.resting) continue;
      scratchVector.copy(piece.position).sub(ball.center);
      const ahead = scratchVector.dot(ball.tangent);
      if (ahead < 1 || ahead > maxAhead) continue;
      const lateral = scratchVector.dot(ball.right);
      if (Math.abs(lateral) > maxLateral) continue;
      if (ahead < bestAhead) {
        bestAhead = ahead;
        best = lateral;
      }
    }
    return best;
  }

  function reset() {
    pieces.length = 0;
    stuckCount = 0;
    writeInstances();
  }

  function dispose() {
    for (const { mesh } of meshes.values()) {
      mesh.removeFromParent();
      mesh.dispose();
    }
    meshes.clear();
    pieces.length = 0;
  }

  function randomUnit() {
    const z = rng() * 2 - 1;
    const angle = rng() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
  }

  return {
    scatter,
    suck,
    update,
    nearestLooseAhead,
    reset,
    dispose,
    stuckCount: () => stuckCount,
    looseCount: () => pieces.filter((piece) => piece.state === 'loose').length,
  };
}
