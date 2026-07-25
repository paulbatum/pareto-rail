import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { FACE_COUNT } from './timing';

// The colossal twisting cube, as pure state. No meshes live here: gameplay drives
// it (so the headless simulator sees exactly the target positions a player does)
// and the visual layer mirrors `cubies` / `caps` onto geometry every frame.
//
// Geometry: 26 machined cubie bodies on a 3x3x3 lattice, plus 54 colour caps —
// one per outward cubie face. A layer turn rotates the nine cubies of a layer by
// 90 degrees and bakes the result back into the lattice, so caps ride their cubie
// exactly the way stickers ride a real cube.

export const CUBIE_PITCH = 6;
export const CUBIE_SIZE = 5.4;
export const CAP_SIZE = 4.5;
export const CAP_THICKNESS = 0.55;
/** Cap centre offset from its cubie centre, along the cubie-local face normal. */
export const CAP_LOCAL_OFFSET = CUBIE_SIZE / 2 + CAP_THICKNESS / 2;
/** Cap centre distance from the cube centre, for an untwisted outer layer. */
export const CAP_OUT = CUBIE_PITCH + CAP_LOCAL_OFFSET;

/** The face the cube shows on the way in, before it turns to present face 0. */
export const ARRIVAL_FACE = 4;

/** How long a layer turn takes: exactly one eighth note at the level tempo. */
export const TURN_SECONDS = 60 / 144 / 2;

const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

/**
 * Presentation order: front, right, back, left, top, bottom. `up` is the
 * cube-local direction that reads as screen-up while that face is presented.
 */
const FACE_SPEC: ReadonlyArray<{ out: Vector3; up: Vector3 }> = [
  { out: new Vector3(0, 0, 1), up: new Vector3(0, 1, 0) },
  { out: new Vector3(1, 0, 0), up: new Vector3(0, 1, 0) },
  { out: new Vector3(0, 0, -1), up: new Vector3(0, 1, 0) },
  { out: new Vector3(-1, 0, 0), up: new Vector3(0, 1, 0) },
  { out: new Vector3(0, 1, 0), up: new Vector3(0, 0, -1) },
  { out: new Vector3(0, -1, 0), up: new Vector3(0, 0, 1) },
];

export type FaceBasis = { out: Vector3; up: Vector3; right: Vector3 };

/** right = up x out, which makes (right, up, out) right-handed. */
export const FACE_BASES: readonly FaceBasis[] = FACE_SPEC.map(({ out, up }) => ({
  out: out.clone(),
  up: up.clone(),
  right: up.clone().cross(out).normalize(),
}));

/**
 * Brings a face's own basis onto the presentation basis: face normal to +Z (the
 * cube-root axis that points back at the camera), face right to +X, face up to +Y.
 */
export const FACE_PRESENT_QUATS: readonly Quaternion[] = FACE_BASES.map(({ right, up, out }) => {
  const basis = new Matrix4().makeBasis(right, up, out);
  return new Quaternion().setFromRotationMatrix(basis).invert();
});

/** Orientation of a plate lying flat on a face: local +Z points out of the cube. */
export const FACE_PLATE_QUATS: readonly Quaternion[] = FACE_BASES.map(({ right, up, out }) => (
  new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, out))
));

export type CubieState = {
  /** Committed lattice coordinate, each component in {-1, 0, 1}. */
  grid: Vector3;
  /** Committed orientation: the accumulated quarter turns this cubie has taken. */
  quat: Quaternion;
  /** Live cube-local position, including any in-flight turn and shell bloom. */
  position: Vector3;
  /** Live cube-local orientation, including any in-flight turn. */
  orientation: Quaternion;
  /** Per-cubie spin phase, used by the finale bloom. */
  drift: Vector3;
};

export type CapState = {
  cubie: number;
  /** Unit outward direction in the cubie's own frame; fixed for the cap's life. */
  dir: Vector3;
  /** Plate orientation in the cubie's own frame; local +Z is `dir`. */
  frame: Quaternion;
  /** Index into the level palette's solve colours. */
  color: number;
  visible: boolean;
  /** Cube time at which this cap last changed colour, for the riffle animation. */
  changedAt: number;
  /** Live cube-local cap centre. */
  position: Vector3;
  /** Live cube-local plate orientation. */
  orientation: Quaternion;
};

type TurnState = {
  axis: Vector3;
  layer: number;
  sign: number;
  members: number[];
  elapsed: number;
};

const scratchVector = new Vector3();
const scratchQuat = new Quaternion();
const bloomVector = new Vector3();
const bloomQuat = new Quaternion();

function axisFor(direction: Vector3) {
  if (Math.abs(direction.x) > 0.5) return AXIS_X;
  if (Math.abs(direction.y) > 0.5) return AXIS_Y;
  return AXIS_Z;
}

export function createSolveCube() {
  const cubies: CubieState[] = [];
  const caps: CapState[] = [];

  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        if (x === 0 && y === 0 && z === 0) continue;
        cubies.push({
          grid: new Vector3(x, y, z),
          quat: new Quaternion(),
          position: new Vector3(x, y, z).multiplyScalar(CUBIE_PITCH),
          orientation: new Quaternion(),
          drift: new Vector3(x || 0.3, y || 0.5, z || 0.7).normalize(),
        });
      }
    }
  }

  // One cap per (face, column, row). Column/row are measured in the face's own
  // right/up basis, so slot (0, 0) is always the immovable face centre.
  for (let face = 0; face < FACE_COUNT; face += 1) {
    const basis = FACE_BASES[face];
    for (let row = 1; row >= -1; row -= 1) {
      for (let col = -1; col <= 1; col += 1) {
        const grid = basis.right.clone().multiplyScalar(col)
          .addScaledVector(basis.up, row)
          .add(basis.out)
          .round();
        const cubie = cubies.findIndex((candidate) => candidate.grid.equals(grid));
        caps.push({
          cubie,
          dir: basis.out.clone(),
          frame: FACE_PLATE_QUATS[face].clone(),
          color: face,
          visible: true,
          changedAt: -99,
          position: new Vector3(),
          orientation: new Quaternion(),
        });
      }
    }
  }

  const center = new Vector3();
  const rootQuat = new Quaternion();
  const presentQuat = new Quaternion().copy(FACE_PRESENT_QUATS[ARRIVAL_FACE]);
  const fromQuat = new Quaternion();
  const toQuat = new Quaternion();

  let time = 0;
  // The cube arrives showing its top face, so the first swing is a real quarter
  // turn onto the front face rather than a no-op.
  let faceIndex = ARRIVAL_FACE;
  let swingElapsed = 0;
  let swingSeconds = 0;
  let turn: TurnState | null = null;
  let bloom = 0;
  let bloomTarget = 0;
  let arrival = 1;

  function reset() {
    time = 0;
    faceIndex = ARRIVAL_FACE;
    swingElapsed = 0;
    swingSeconds = 0;
    turn = null;
    bloom = 0;
    bloomTarget = 0;
    arrival = 0;
    presentQuat.copy(FACE_PRESENT_QUATS[ARRIVAL_FACE]);
    fromQuat.copy(presentQuat);
    toQuat.copy(presentQuat);
    for (const cubie of cubies) {
      cubie.quat.identity();
      cubie.orientation.identity();
      cubie.position.copy(cubie.grid).multiplyScalar(CUBIE_PITCH);
    }
    for (let index = 0; index < caps.length; index += 1) {
      const cap = caps[index];
      const face = Math.floor(index / 9);
      cap.cubie = initialCubieFor(index);
      cap.dir.copy(FACE_BASES[face].out);
      cap.frame.copy(FACE_PLATE_QUATS[face]);
      cap.color = face;
      cap.visible = true;
      cap.changedAt = -99;
    }
    refreshLive();
  }

  function initialCubieFor(capIndex: number) {
    const face = Math.floor(capIndex / 9);
    const slot = capIndex % 9;
    const basis = FACE_BASES[face];
    const row = 1 - Math.floor(slot / 3);
    const col = (slot % 3) - 1;
    const grid = basis.right.clone().multiplyScalar(col)
      .addScaledVector(basis.up, row)
      .add(basis.out)
      .round();
    return cubies.findIndex((candidate) => candidate.grid.equals(grid));
  }

  /** Rotation that a turn currently applies to its member cubies. */
  function turnRotation(target: Quaternion, state: TurnState, progress: number) {
    return target.setFromAxisAngle(state.axis, state.sign * (Math.PI / 2) * progress);
  }

  function refreshLive() {
    const progress = turn ? MathUtils.clamp(turn.elapsed / TURN_SECONDS, 0, 1) : 0;
    const eased = progress * progress * (3 - 2 * progress);
    if (turn) turnRotation(scratchQuat, turn, eased);

    for (let index = 0; index < cubies.length; index += 1) {
      const cubie = cubies[index];
      const spinning = turn?.members.includes(index) === true;
      cubie.position.copy(cubie.grid).multiplyScalar(CUBIE_PITCH);
      cubie.orientation.copy(cubie.quat);
      if (spinning) {
        cubie.position.applyQuaternion(scratchQuat);
        cubie.orientation.premultiply(scratchQuat);
      }
      if (bloom > 0.0005) applyBloom(cubie);
    }

    for (const cap of caps) {
      const cubie = cubies[cap.cubie];
      cap.position.copy(cap.dir)
        .applyQuaternion(cubie.orientation)
        .multiplyScalar(CAP_LOCAL_OFFSET)
        .add(cubie.position);
      cap.orientation.copy(cubie.orientation).multiply(cap.frame);
    }
  }

  /**
   * The finale opens the shell into a ring rather than a sphere: each cubie's
   * outward direction is flattened away from the view axis (cube-local Z) so the
   * naked core is never behind a block.
   */
  function applyBloom(cubie: CubieState) {
    bloomVector.copy(cubie.grid);
    bloomVector.z *= 0.12;
    if (bloomVector.lengthSq() < 0.05) bloomVector.set(0.8, 0.6, 0);
    bloomVector.normalize();
    const spread = 22 + bloom * 26;
    const wobble = Math.sin(time * 1.7 + cubie.drift.x * 6) * 1.6;
    cubie.position.lerp(bloomVector.multiplyScalar(spread + wobble), bloom);
    bloomQuat.setFromAxisAngle(cubie.drift, time * 1.15 * bloom);
    cubie.orientation.premultiply(bloomQuat);
  }

  function faceCaps(face: number) {
    const basis = FACE_BASES[face];
    const found: number[] = new Array(9).fill(-1);
    for (let index = 0; index < caps.length; index += 1) {
      const cap = caps[index];
      const cubie = cubies[cap.cubie];
      scratchVector.copy(cap.dir).applyQuaternion(cubie.quat);
      if (scratchVector.dot(basis.out) < 0.9) continue;
      const col = Math.round(cubie.grid.dot(basis.right));
      const row = Math.round(cubie.grid.dot(basis.up));
      const slot = (1 - row) * 3 + (col + 1);
      if (slot >= 0 && slot < 9 && found[slot] === -1) found[slot] = index;
    }
    return found;
  }

  function commitTurn(state: TurnState) {
    turnRotation(scratchQuat, state, 1);
    for (const index of state.members) {
      const cubie = cubies[index];
      cubie.grid.applyQuaternion(scratchQuat).round();
      cubie.quat.premultiply(scratchQuat).normalize();
    }
  }

  return {
    cubies: cubies as readonly CubieState[],
    caps: caps as readonly CapState[],
    center,
    rootQuat,

    get time() {
      return time;
    },
    get faceIndex() {
      return faceIndex;
    },
    get presentQuat() {
      return presentQuat;
    },
    get turning() {
      return turn !== null;
    },
    get turnProgress() {
      return turn ? MathUtils.clamp(turn.elapsed / TURN_SECONDS, 0, 1) : 1;
    },
    get swinging() {
      return swingSeconds > 0 && swingElapsed < swingSeconds;
    },
    get bloom() {
      return bloom;
    },
    get arrival() {
      return arrival;
    },

    reset,

    /** Begin the quantized swing that brings `index` round to face the player. */
    presentFace(index: number, seconds: number) {
      faceIndex = MathUtils.clamp(index, 0, FACE_COUNT - 1);
      fromQuat.copy(presentQuat);
      toQuat.copy(FACE_PRESENT_QUATS[faceIndex]);
      swingElapsed = 0;
      swingSeconds = Math.max(0.0001, seconds);
    },

    /** Start a quarter turn of the presented face's own layer. */
    startTurn(sign: number) {
      if (turn) commitTurn(turn);
      const basis = FACE_BASES[faceIndex];
      const axis = axisFor(basis.out);
      const layer = Math.round(basis.out.dot(axis));
      const members: number[] = [];
      for (let index = 0; index < cubies.length; index += 1) {
        if (Math.round(cubies[index].grid.dot(axis)) === layer) members.push(index);
      }
      turn = { axis, layer, sign, members, elapsed: 0 };
    },

    openShell(target: number) {
      bloomTarget = MathUtils.clamp(target, 0, 1);
    },

    setArrival(value: number) {
      arrival = MathUtils.clamp(value, 0, 1);
    },

    /** Cap indices currently sitting on `face`, ordered by slot (row-major, top-left first). */
    faceCaps,

    slotCap(face: number, col: number, row: number) {
      const index = faceCaps(face)[(1 - row) * 3 + (col + 1)];
      return index === undefined || index < 0 ? -1 : index;
    },

    /**
     * Re-seat a spare (hidden) cap into an empty slot. Layer turns migrate caps
     * between faces, so a face can arrive one cap short after an earlier face was
     * stripped; this keeps every presented face a full nine squares.
     */
    fillSlot(face: number, col: number, row: number) {
      const spare = caps.findIndex((cap) => !cap.visible);
      if (spare < 0) return -1;
      const basis = FACE_BASES[face];
      const grid = basis.right.clone().multiplyScalar(col)
        .addScaledVector(basis.up, row)
        .add(basis.out)
        .round();
      const cubie = cubies.findIndex((candidate) => candidate.grid.equals(grid));
      if (cubie < 0) return -1;
      const cap = caps[spare];
      const inverse = scratchQuat.copy(cubies[cubie].quat).invert();
      cap.cubie = cubie;
      cap.dir.copy(basis.out).applyQuaternion(inverse).normalize();
      cap.frame.copy(inverse).multiply(FACE_PLATE_QUATS[face]).normalize();
      cap.visible = true;
      return spare;
    },

    setCapColor(index: number, color: number) {
      const cap = caps[index];
      if (!cap) return;
      cap.color = color;
      cap.changedAt = time;
    },

    setCapVisible(index: number, visible: boolean) {
      const cap = caps[index];
      if (!cap) return;
      cap.visible = visible;
      cap.changedAt = time;
    },

    /** World position of a cap centre, including any in-flight turn. */
    capWorld(index: number, target: Vector3) {
      const cap = caps[index];
      if (!cap) return target.copy(center);
      return target.copy(cap.position).applyQuaternion(rootQuat).add(center);
    },

    /** World orientation of a cap plate, including any in-flight turn. */
    capQuat(index: number, target: Quaternion) {
      const cap = caps[index];
      if (!cap) return target.copy(rootQuat);
      return target.copy(rootQuat).multiply(cap.orientation).normalize();
    },

    /** World orientation of a plate lying flat on `face`. */
    faceQuat(face: number, target: Quaternion) {
      return target.copy(rootQuat).multiply(FACE_PLATE_QUATS[face]).normalize();
    },

    /** World position of a point authored in the presented face's own basis. */
    faceWorld(face: number, col: number, row: number, out: number, target: Vector3) {
      const basis = FACE_BASES[face];
      target.copy(basis.right).multiplyScalar(col * CUBIE_PITCH)
        .addScaledVector(basis.up, row * CUBIE_PITCH)
        .addScaledVector(basis.out, out);
      return target.applyQuaternion(rootQuat).add(center);
    },

    advance(dt: number) {
      time += dt;
      bloom += (bloomTarget - bloom) * Math.min(1, dt * 1.6);
      if (swingSeconds > 0 && swingElapsed < swingSeconds) {
        swingElapsed = Math.min(swingSeconds, swingElapsed + dt);
        const t = swingElapsed / swingSeconds;
        // Mechanical snap: hold, accelerate, arrive dead on the beat.
        const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
        presentQuat.copy(fromQuat).slerp(toQuat, eased).normalize();
      }
      if (turn) {
        turn.elapsed += dt;
        if (turn.elapsed >= TURN_SECONDS) {
          commitTurn(turn);
          turn = null;
        }
      }
      refreshLive();
    },

    /** Place the cube: `base` already carries the rail frame, camera roll and hover tilt. */
    place(worldCenter: Vector3, base: Quaternion) {
      center.copy(worldCenter);
      rootQuat.copy(base).multiply(presentQuat).normalize();
      refreshLive();
    },
  };
}

export type SolveCube = ReturnType<typeof createSolveCube>;
