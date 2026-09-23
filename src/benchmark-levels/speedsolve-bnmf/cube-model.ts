// Leaf: the puzzle cube as a sticker permutation. Fifty-four sticker slots sit
// on twenty-six cubies; a quarter turn of one slice is a fixed permutation of
// slots. Nothing here decides a plan, a timing, or a color — gameplay hands
// in the solve plan and this module derives which sticker belongs to which
// face so the plan is exactly solvable in order.

export type Vec3i = readonly [number, number, number];
export type Axis = 0 | 1 | 2;

export type CubeSlot = {
  /** Cubie coordinate, each component in {-1, 0, 1}. */
  p: Vec3i;
  /** Outward sticker normal. */
  n: Vec3i;
  /** Face index (see FACE_NORMALS) the slot sits on. */
  face: number;
};

/** Face order is the solve order: F, R, U, B, L, D — each a quarter swing from the last. */
export const FACE_NORMALS: readonly Vec3i[] = [
  [0, 0, 1],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, -1],
  [-1, 0, 0],
  [0, -1, 0],
];
/** Screen-right as the camera faces each face; the U and D views inherit the roll of the swing that reaches them. */
export const FACE_RIGHT: readonly Vec3i[] = [
  [1, 0, 0],
  [0, 0, -1],
  [0, 0, -1],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, 1],
];
export const FACE_UP: readonly Vec3i[] = [
  [0, 1, 0],
  [0, 1, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, 1, 0],
  [-1, 0, 0],
];

export type PlanStep = {
  /** Slice axis; each face is solved by parallel slices, so turns commute. */
  axis: Axis;
  /** Signed quarter turns for layers -1, 0, +1 (2 = half turn, two quarter snaps). */
  quarters: readonly [number, number, number];
};

const eq = (a: Vec3i, b: Vec3i) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
export const dot = (a: Vec3i, b: Vec3i) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const CUBE_SLOTS: readonly CubeSlot[] = buildSlots();
export const SLOT_COUNT = CUBE_SLOTS.length;
export const FACE_SLOTS: readonly (readonly number[])[] = FACE_NORMALS.map((n) =>
  CUBE_SLOTS.map((slot, index) => (eq(slot.n, n) ? index : -1)).filter((index) => index >= 0),
);
/** Every cubie except the hidden core, keyed by its coordinate. */
export const CUBIES: readonly Vec3i[] = buildCubies();

function buildSlots(): CubeSlot[] {
  const slots: CubeSlot[] = [];
  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        const p: Vec3i = [x, y, z];
        for (let axis = 0; axis < 3; axis += 1) {
          for (const sign of [-1, 1]) {
            if (p[axis] !== sign) continue;
            const n: [number, number, number] = [0, 0, 0];
            n[axis] = sign;
            const face = FACE_NORMALS.findIndex((normal) => eq(normal, n));
            slots.push({ p, n, face });
          }
        }
      }
    }
  }
  return slots;
}

function buildCubies(): Vec3i[] {
  const cubies: Vec3i[] = [];
  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        if (x !== 0 || y !== 0 || z !== 0) cubies.push([x, y, z]);
      }
    }
  }
  return cubies;
}

/** Right-handed quarter turns about +axis. */
export function rotateVec(v: Vec3i, axis: Axis, quarters: number): Vec3i {
  let [x, y, z] = v;
  const q = ((quarters % 4) + 4) % 4;
  for (let i = 0; i < q; i += 1) {
    if (axis === 0) [x, y, z] = [x, -z, y];
    else if (axis === 1) [x, y, z] = [z, y, -x];
    else [x, y, z] = [-y, x, z];
  }
  return [x, y, z];
}

const slotKey = (p: Vec3i, n: Vec3i) => `${p.join(',')}|${n.join(',')}`;
const SLOT_INDEX = new Map(CUBE_SLOTS.map((slot, index) => [slotKey(slot.p, slot.n), index]));

// MOVES[axis][layer + 1][quarters] maps a source slot to its destination slot.
const MOVES: Int16Array[][][] = ([0, 1, 2] as Axis[]).map((axis) =>
  [-1, 0, 1].map((layer) =>
    [0, 1, 2, 3].map((quarters) => {
      const table = new Int16Array(SLOT_COUNT);
      CUBE_SLOTS.forEach((slot, index) => {
        table[index] = slot.p[axis] === layer
          ? SLOT_INDEX.get(slotKey(rotateVec(slot.p, axis, quarters), rotateVec(slot.n, axis, quarters))) ?? index
          : index;
      });
      return table;
    }),
  ),
);

/** at[slot] = sticker id. Returns a new arrangement after one slice turn. */
export function turnArrangement(at: Int16Array, axis: Axis, layer: number, quarters: number) {
  const table = MOVES[axis][layer + 1][((quarters % 4) + 4) % 4];
  const next = new Int16Array(SLOT_COUNT);
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) next[table[slot]] = at[slot];
  return next;
}

export function identityArrangement() {
  const at = new Int16Array(SLOT_COUNT);
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) at[slot] = slot;
  return at;
}

export type DerivedPlan = {
  /** Sticker id -> the face whose solve consumes it (its display color). */
  owner: Int8Array;
  /** Per face, the slots (in solve-start arrangement) of each wrong layer. */
  wrongLayers: Array<Array<{ layer: number; quarters: number }>>;
};

/**
 * Runs the plan once on sticker identities. Whatever lands on face k when
 * its turns finish is, by definition, colored k — so the plan is solvable
 * exactly, and every sticker belongs to exactly one face.
 */
export function derivePlan(plan: readonly PlanStep[]): DerivedPlan {
  if (plan.length !== FACE_NORMALS.length) throw new Error('A solve plan needs one step per face');
  const owner = new Int8Array(SLOT_COUNT).fill(-1);
  let at = identityArrangement();
  plan.forEach((step, face) => {
    if (FACE_NORMALS[face][step.axis] !== 0) throw new Error(`Face ${face} cannot turn about its own normal`);
    step.quarters.forEach((quarters, index) => {
      if (quarters !== 0) at = turnArrangement(at, step.axis, index - 1, quarters);
    });
    for (const slot of FACE_SLOTS[face]) {
      const sticker = at[slot];
      if (owner[sticker] !== -1) throw new Error(`Solve plan reuses sticker ${sticker} on face ${face}`);
      owner[sticker] = face;
    }
  });
  const wrongLayers = plan.map((step) =>
    step.quarters
      .map((quarters, index) => ({ layer: index - 1, quarters }))
      .filter((entry) => entry.quarters !== 0),
  );
  return { owner, wrongLayers };
}

/** Mutable puzzle state: arrangement plus which stickers have fallen away. */
export function createCubeState(owner: Int8Array) {
  let at = identityArrangement();
  const consumed = new Uint8Array(SLOT_COUNT);
  let version = 0;

  return {
    get version() {
      return version;
    },
    /** Display color of a slot: face index, or -1 for bare machinery. */
    colorAt(slot: number) {
      const sticker = at[slot];
      return consumed[sticker] ? -1 : owner[sticker];
    },
    turn(axis: Axis, layer: number, quarters: number) {
      at = turnArrangement(at, axis, layer, quarters);
      version += 1;
    },
    /** A solved face sheds its stickers; whatever rotates there later is machinery. */
    strip(face: number) {
      for (const slot of FACE_SLOTS[face]) consumed[at[slot]] = 1;
      version += 1;
    },
    faceMatches(face: number) {
      return FACE_SLOTS[face].every((slot) => !consumed[at[slot]] && owner[at[slot]] === face);
    },
    reset() {
      at = identityArrangement();
      consumed.fill(0);
      version += 1;
    },
  };
}

export type CubeState = ReturnType<typeof createCubeState>;
