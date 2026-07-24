import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  TorusGeometry,
  Vector3,
} from 'three';
import {
  CUBE_CENTER,
  CUBE_HALF,
  FACE_COUNT,
  FACE_FRAMES,
  FACE_QUATS,
  RING_ORDER,
  TILE_DEPTH,
  TILE_PITCH,
  TILE_SIZE,
  tileCenter,
} from '../structure';
import { CORE_TIME, SOLVE_DEADLINE_BEATS, beats, faceStart } from '../timing';
import {
  CHASSIS_DARK,
  CHASSIS_LIGHT,
  CHASSIS_MID,
  HOT_ORANGE,
  INK,
  MACHINE_DARK,
  SOLVE_COLORS,
  hdr,
  mulberry32,
} from './palette';

// The cube itself: six 3×3 faces of chunky colored tiles over white-and-grey
// machinery. It is not simulated — it is choreographed. Each face carries five
// authored color states, generated backwards from uniform, so every ratchet
// provably walks the face toward a single color. A ratchet is a real layer
// rotation: the eight outer tiles physically snap 90° around the face normal,
// landing exactly on a beat, while the tiles that change color flip like
// reversi chips under cover of the motion.

const RATCHET_DURATION = 0.2;
const RATCHET_LEAD = RATCHET_DURATION; // start so the snap LANDS on the beat

type TileFly = {
  velocity: Vector3;
  spinAxis: Vector3;
  spin: number;
  age: number;
  life: number;
};

type Tile = {
  group: Group;
  capMaterial: MeshBasicMaterial;
  basePos: Vector3;
  baseQuat: Quaternion;
  fly: TileFly | null;
};

type RatchetAnim = {
  start: number;
  next: number[];
  flips: Set<number>;
  colorsSwapped: boolean;
  advanceStep: boolean;
};

type FaceState = {
  face: number;
  tiles: Tile[];
  states: number[][];
  live: number[];
  step: number;
  anim: RatchetAnim | null;
  pendingStarts: number[];
  lastScheduledStart: number;
  fallen: boolean;
  hatchPopped: boolean;
  assembly: Group;
  assemblyFly: TileFly | null;
  socketGlow: MeshBasicMaterial;
  ribMaterial: MeshBasicMaterial;
};

export type CubeUpdateContext = {
  elapsed: number;
  runTime: number;
  running: boolean;
  beatEnergy: number;
};

export type SpeedsolveCube = ReturnType<typeof createCube>;

const FLIP_PLAN_SIZES = [2, 2, 3, 2];

const scratchQuat = new Quaternion();
const scratchVec = new Vector3();

function ringRotate(colors: number[]): number[] {
  const next = colors.slice();
  for (let i = 0; i < RING_ORDER.length; i += 1) {
    next[RING_ORDER[(i + 2) % 8]] = colors[RING_ORDER[i]];
  }
  return next;
}

function ringRotateInverse(colors: number[]): number[] {
  const previous = colors.slice();
  for (let i = 0; i < RING_ORDER.length; i += 1) {
    previous[RING_ORDER[i]] = colors[RING_ORDER[(i + 2) % 8]];
  }
  return previous;
}

// Generate the five authored color states for a face, backwards from uniform:
// un-rotate, then corrupt the tiles that the matching forward ratchet will
// flip back. Forward play is then guaranteed to end on a single color.
function generateStates(face: number): number[][] {
  const rng = mulberry32(face * 97 + 13);
  const states: number[][] = new Array(5);
  states[4] = new Array(9).fill(face);
  for (let step = 3; step >= 0; step -= 1) {
    const current = ringRotateInverse(states[step + 1]);
    const flipCount = FLIP_PLAN_SIZES[step];
    const picked = new Set<number>();
    while (picked.size < flipCount) picked.add(Math.floor(rng() * 9));
    for (const index of picked) {
      let other = Math.floor(rng() * (FACE_COUNT - 1));
      if (other >= face) other += 1;
      current[index] = other;
    }
    states[step] = current;
  }
  return states;
}

function snapEase(t: number) {
  return 1 - (1 - MathUtils.clamp(t, 0, 1)) ** 4;
}

export function createCube(scene: Scene) {
  const root = new Group();
  scene.add(root);

  // Solid machinery interior: keeps open hatches from seeing clean through
  // the cube, and reads as the grey machine the theme promises. It leaves
  // with the shells at the core reveal.
  const innerBox = new Mesh(new BoxGeometry(19, 19, 19), new MeshBasicMaterial({ color: MACHINE_DARK.clone().multiplyScalar(0.85) }));
  innerBox.name = 'cube-interior';
  innerBox.quaternion.copy(FACE_QUATS[0]);
  root.add(innerBox);

  const tileCapGeometry = new BoxGeometry(TILE_SIZE, TILE_SIZE, TILE_DEPTH);
  const tileFrameGeometry = new BoxGeometry(TILE_SIZE + 0.62, TILE_SIZE + 0.62, TILE_DEPTH * 0.6);
  const faces: FaceState[] = [];

  // Gyro: the machine that remains when the shells blast off. Hidden until
  // the finale.
  const gyro = new Group();
  gyro.name = 'gyro';
  // A thin spinning ring cage — visually busy, never meaningful cover.
  gyro.userData.raildIgnoreOcclusion = true;
  const gyroRings: Array<{ mesh: Mesh; axis: Vector3; rate: number; fly: TileFly | null }> = [];
  {
    const specs: Array<[number, Vector3, number, MeshBasicMaterial]> = [
      [8.2, new Vector3(1, 0.2, 0).normalize(), 0.9, new MeshBasicMaterial({ color: CHASSIS_LIGHT.clone() })],
      [9.6, new Vector3(0.1, 1, 0.25).normalize(), -0.7, new MeshBasicMaterial({ color: CHASSIS_MID.clone() })],
      [11.0, new Vector3(0.3, 0.1, 1).normalize(), 0.5, new MeshBasicMaterial({ color: INK.clone() })],
    ];
    for (const [radius, axis, rate, material] of specs) {
      const mesh = new Mesh(new TorusGeometry(radius, 0.32, 8, 48), material);
      gyro.add(mesh);
      gyroRings.push({ mesh, axis, rate, fly: null });
    }
    gyro.visible = false;
    root.add(gyro);
  }

  for (let face = 0; face < FACE_COUNT; face += 1) {
    const frame = FACE_FRAMES[face];
    const quat = FACE_QUATS[face];

    // Face assembly: chassis plate, ink rim, corner bolts, machinery ribs,
    // and the central hatch socket — everything that blasts off at bar 24.
    const assembly = new Group();
    assembly.name = `cube-face-${face}`;
    assembly.quaternion.copy(quat);

    const plateMaterial = new MeshBasicMaterial({ color: CHASSIS_LIGHT.clone() });
    const plate = new Mesh(new BoxGeometry(25, 25, 2.0), plateMaterial);
    plate.position.z = CUBE_HALF - 1.0;
    assembly.add(plate);

    const ribMaterial = new MeshBasicMaterial({ color: CHASSIS_DARK.clone() });
    for (const offset of [-TILE_PITCH / 2, TILE_PITCH / 2]) {
      const horizontal = new Mesh(new BoxGeometry(24.6, 0.5, 0.5), ribMaterial);
      horizontal.position.set(0, offset * 2, CUBE_HALF + 0.1);
      const vertical = new Mesh(new BoxGeometry(0.5, 24.6, 0.5), ribMaterial);
      vertical.position.set(offset * 2, 0, CUBE_HALF + 0.1);
      assembly.add(horizontal, vertical);
    }

    const rimMaterial = new MeshBasicMaterial({ color: INK.clone() });
    for (const [w, h, x, y] of [
      [25.4, 0.7, 0, 12.7],
      [25.4, 0.7, 0, -12.7],
      [0.7, 25.4, 12.7, 0],
      [0.7, 25.4, -12.7, 0],
    ] as const) {
      const bar = new Mesh(new BoxGeometry(w, h, 1.1), rimMaterial);
      bar.position.set(x, y, CUBE_HALF - 0.2);
      assembly.add(bar);
    }

    const boltMaterial = new MeshBasicMaterial({ color: MACHINE_DARK.clone() });
    for (const [x, y] of [[10.6, 10.6], [-10.6, 10.6], [10.6, -10.6], [-10.6, -10.6]] as const) {
      const bolt = new Mesh(new CylinderGeometry(0.65, 0.65, 0.9, 8), boltMaterial);
      bolt.rotation.x = Math.PI / 2;
      bolt.position.set(x, y, CUBE_HALF + 0.15);
      assembly.add(bolt);
    }

    // Hatch socket under the center tile: dark throat plus a glow ring that
    // wakes when the machinery is exposed.
    const throat = new Mesh(new CylinderGeometry(2.9, 3.3, 1.6, 14), new MeshBasicMaterial({ color: MACHINE_DARK.clone() }));
    throat.rotation.x = Math.PI / 2;
    throat.position.z = CUBE_HALF - 0.4;
    assembly.add(throat);
    const socketGlow = new MeshBasicMaterial({ color: MACHINE_DARK.clone() });
    const socketRing = new Mesh(new TorusGeometry(3.1, 0.4, 8, 24), socketGlow);
    socketRing.position.z = CUBE_HALF + 0.3;
    assembly.add(socketRing);

    root.add(assembly);

    const states = generateStates(face);
    const tiles: Tile[] = [];
    for (let index = 0; index < 9; index += 1) {
      const group = new Group();
      group.name = `cube-tile-${face}-${index}`;
      const capMaterial = new MeshBasicMaterial({ color: SOLVE_COLORS[states[0][index]].clone() });
      const cap = new Mesh(tileCapGeometry, capMaterial);
      const frameMesh = new Mesh(tileFrameGeometry, new MeshBasicMaterial({ color: INK.clone() }));
      frameMesh.position.z = -0.44;
      group.add(cap, frameMesh);
      const basePos = tileCenter(face, index, 0);
      group.position.copy(basePos);
      group.quaternion.copy(quat);
      root.add(group);
      tiles.push({ group, capMaterial, basePos, baseQuat: quat.clone(), fly: null });
    }

    faces.push({
      face,
      tiles,
      states,
      live: states[0].slice(),
      step: 0,
      anim: null,
      pendingStarts: [],
      lastScheduledStart: -Infinity,
      fallen: false,
      hatchPopped: false,
      assembly,
      assemblyFly: null,
      socketGlow,
      ribMaterial,
    });
  }

  let shellsBlown = false;
  let gyroDead = false;
  let gyroSealed = false;
  let coreCharge = 0;
  const flyRng = mulberry32(4242);

  function applyTileColors(state: FaceState) {
    for (let i = 0; i < 9; i += 1) state.tiles[i].capMaterial.color.copy(SOLVE_COLORS[state.live[i]]);
  }

  function restoreTile(tile: Tile) {
    tile.fly = null;
    tile.group.visible = true;
    tile.group.userData.raildIgnoreOcclusion = false;
    tile.group.position.copy(tile.basePos);
    tile.group.quaternion.copy(tile.baseQuat);
    tile.group.scale.setScalar(1);
  }

  function launchTile(state: FaceState, index: number, energetic: boolean) {
    const tile = state.tiles[index];
    if (tile.fly || !tile.group.visible) return;
    // Once a tile is loose it is spectacle, not cover.
    tile.group.userData.raildIgnoreOcclusion = true;
    const frame = FACE_FRAMES[state.face];
    const radial = scratchVec.copy(tile.basePos).sub(CUBE_CENTER).addScaledVector(frame.normal, -CUBE_HALF).normalize();
    tile.fly = {
      velocity: frame.normal.clone().multiplyScalar(energetic ? 13 + flyRng() * 6 : 5 + flyRng() * 2)
        .addScaledVector(radial, energetic ? 5 + flyRng() * 3 : 1.5)
        .add(new Vector3(flyRng() - 0.5, flyRng() - 0.2, flyRng() - 0.5).multiplyScalar(3)),
      spinAxis: new Vector3(flyRng() - 0.5, flyRng() - 0.5, flyRng() - 0.5).normalize(),
      spin: 2.5 + flyRng() * 5,
      age: 0,
      life: energetic ? 1.7 : 1.3,
    };
  }

  function scheduleRatchet(state: FaceState, now: number, nextBeatTime: (t: number) => number, beatSeconds: number) {
    let start = Math.max(now, nextBeatTime(now) - RATCHET_LEAD);
    const earliest = state.lastScheduledStart + beatSeconds;
    while (start < earliest) start += beatSeconds;
    state.lastScheduledStart = start;
    state.pendingStarts.push(start);
  }

  function beginRatchet(state: FaceState, start: number, advanceStep: boolean) {
    const next = advanceStep ? state.states[state.step + 1] : ringRotate(state.live);
    const flips = new Set<number>();
    for (let i = 0; i < RING_ORDER.length; i += 1) {
      const from = RING_ORDER[i];
      const to = RING_ORDER[(i + 2) % 8];
      if (next[to] !== state.live[from]) flips.add(from);
    }
    if (next[4] !== state.live[4]) flips.add(4);
    state.anim = { start, next, flips, colorsSwapped: false, advanceStep };
  }

  function finishRatchet(state: FaceState) {
    const anim = state.anim;
    if (!anim) return;
    state.live = anim.next.slice();
    if (anim.advanceStep) state.step += 1;
    state.anim = null;
    for (const tile of state.tiles) {
      if (tile.fly) continue;
      tile.group.position.copy(tile.basePos);
      tile.group.quaternion.copy(tile.baseQuat);
    }
    applyTileColors(state);
  }

  function updateRatchet(state: FaceState, elapsed: number) {
    const anim = state.anim;
    if (!anim) return;
    const t = (elapsed - anim.start) / RATCHET_DURATION;
    if (t >= 1) {
      finishRatchet(state);
      return;
    }
    if (t < 0) return;
    const angle = (Math.PI / 2) * snapEase(t);
    const frame = FACE_FRAMES[state.face];
    scratchQuat.setFromAxisAngle(frame.normal, angle);
    for (let i = 0; i < RING_ORDER.length; i += 1) {
      const index = RING_ORDER[i];
      const tile = state.tiles[index];
      if (tile.fly || !tile.group.visible) continue;
      tile.group.position.copy(tile.basePos).sub(CUBE_CENTER).applyQuaternion(scratchQuat).add(CUBE_CENTER);
      tile.group.quaternion.copy(scratchQuat).multiply(tile.baseQuat);
      if (anim.flips.has(index)) applyFlip(state, tile, index, t, angle);
    }
    const centerTile = state.tiles[4];
    if (anim.flips.has(4) && !centerTile.fly && centerTile.group.visible) applyFlip(state, centerTile, 4, t, 0);
  }

  function applyFlip(state: FaceState, tile: Tile, index: number, t: number, ringAngle: number) {
    const frame = FACE_FRAMES[state.face];
    const flip = new Quaternion().setFromAxisAngle(frame.right, Math.PI * snapEase(t));
    scratchQuat.setFromAxisAngle(frame.normal, ringAngle);
    tile.group.quaternion.copy(scratchQuat).multiply(flip).multiply(tile.baseQuat);
    if (t >= 0.5 && state.anim && !state.anim.colorsSwapped) {
      // Under cover of the flip, every flipping tile takes its landed color.
      for (let i = 0; i < RING_ORDER.length; i += 1) {
        const from = RING_ORDER[i];
        if (!state.anim.flips.has(from)) continue;
        state.tiles[from].capMaterial.color.copy(SOLVE_COLORS[state.anim.next[RING_ORDER[(i + 2) % 8]]]);
      }
      if (state.anim.flips.has(4)) state.tiles[4].capMaterial.color.copy(SOLVE_COLORS[state.anim.next[4]]);
      state.anim.colorsSwapped = true;
    }
  }

  function fallFace(state: FaceState) {
    if (state.fallen) return;
    state.fallen = true;
    state.hatchPopped = true;
    if (state.anim) finishRatchet(state);
    for (let index = 0; index < 9; index += 1) launchTile(state, index, true);
    state.socketGlow.color.copy(hdr(HOT_ORANGE, 1.1));
  }

  function popHatch(state: FaceState) {
    if (state.hatchPopped || state.fallen) return;
    state.hatchPopped = true;
    launchTile(state, 4, false);
    state.socketGlow.color.copy(hdr(HOT_ORANGE, 0.9));
  }

  function blowShells() {
    if (shellsBlown) return;
    shellsBlown = true;
    for (const state of faces) {
      if (state.anim) finishRatchet(state);
      for (let index = 0; index < 9; index += 1) launchTile(state, index, true);
      state.assembly.userData.raildIgnoreOcclusion = true;
      const frame = FACE_FRAMES[state.face];
      state.assemblyFly = {
        velocity: frame.normal.clone().multiplyScalar(24 + flyRng() * 8)
          .add(new Vector3(flyRng() - 0.5, flyRng() - 0.3, flyRng() - 0.5).multiplyScalar(5)),
        spinAxis: new Vector3(flyRng() - 0.5, flyRng() - 0.5, flyRng() - 0.5).normalize(),
        spin: 1.6 + flyRng() * 2.4,
        age: 0,
        life: 2.6,
      };
    }
    innerBox.visible = false;
    gyro.visible = true;
    gyro.scale.setScalar(0.01);
  }

  function updateFly(object: { visible: boolean; position: Vector3; quaternion: Quaternion; scale: Vector3 }, fly: TileFly, dt: number): boolean {
    fly.age += dt;
    if (fly.age >= fly.life) {
      object.visible = false;
      return true;
    }
    fly.velocity.y -= 7 * dt;
    fly.velocity.multiplyScalar(Math.max(0, 1 - 0.5 * dt));
    object.position.addScaledVector(fly.velocity, dt);
    scratchQuat.setFromAxisAngle(fly.spinAxis, fly.spin * dt);
    object.quaternion.premultiply(scratchQuat);
    const fade = 1 - fly.age / fly.life;
    object.scale.setScalar(Math.max(0.01, Math.min(1, fade * 2.2)));
    return false;
  }

  return {
    root,

    reset() {
      shellsBlown = false;
      gyroDead = false;
      gyroSealed = false;
      coreCharge = 0;
      innerBox.visible = true;
      gyro.visible = false;
      gyro.scale.setScalar(1);
      for (const ring of gyroRings) {
        ring.fly = null;
        ring.mesh.visible = true;
        ring.mesh.position.set(0, 0, 0);
        ring.mesh.scale.setScalar(1);
      }
      for (const state of faces) {
        state.anim = null;
        state.pendingStarts.length = 0;
        state.lastScheduledStart = -Infinity;
        state.step = 0;
        state.live = state.states[0].slice();
        state.fallen = false;
        state.hatchPopped = false;
        state.assemblyFly = null;
        state.assembly.visible = true;
        state.assembly.userData.raildIgnoreOcclusion = false;
        state.assembly.position.set(0, 0, 0);
        state.assembly.quaternion.copy(FACE_QUATS[state.face]);
        state.assembly.scale.setScalar(1);
        state.socketGlow.color.copy(MACHINE_DARK);
        for (const tile of state.tiles) restoreTile(tile);
        applyTileColors(state);
      }
    },

    /** A solve square died: ratchet the layer onto the next beat. */
    onPanelKilled(face: number, now: number, nextBeatTime: (t: number) => number, beatSeconds: number) {
      const state = faces[face];
      if (!state || state.fallen || state.step + (state.pendingStarts.length + (state.anim ? 1 : 0)) >= 4) return;
      scheduleRatchet(state, now, nextBeatTime, beatSeconds);
    },

    /** Attract idle: a cosmetic layer rotation, colors shuffling forever. */
    idleRatchet(now: number) {
      const state = faces[Math.floor(flyRng() * FACE_COUNT)];
      if (!state || state.anim || state.fallen) return;
      state.anim = { start: now, next: ringRotate(state.live), flips: new Set(), colorsSwapped: true, advanceStep: false };
    },

    /** The weakpoint is arriving — make sure its hatch is open. */
    ensureHatch(face: number) {
      const state = faces[face];
      if (state) popHatch(state);
    },

    isFaceSolved(face: number) {
      return faces[face]?.step >= 4;
    },

    setCoreCharge(level: number) {
      coreCharge = MathUtils.clamp(level, 0, 1);
    },

    onCoreKilled() {
      gyroDead = true;
      for (const ring of gyroRings) {
        ring.fly = {
          velocity: ring.axis.clone().multiplyScalar(18).add(new Vector3(flyRng() - 0.5, flyRng() + 0.3, flyRng() - 0.5).multiplyScalar(8)),
          spinAxis: ring.axis.clone(),
          spin: 5,
          age: 0,
          life: 1.6,
        };
      }
    },

    sealCore() {
      gyroSealed = true;
    },

    update(dt: number, ctx: CubeUpdateContext) {
      const { elapsed, runTime, running } = ctx;

      for (const state of faces) {
        // Begin any due ratchet.
        if (!state.anim && state.pendingStarts.length > 0 && elapsed >= state.pendingStarts[0] - 0.001) {
          const start = state.pendingStarts.shift() as number;
          beginRatchet(state, start, true);
        }
        updateRatchet(state, elapsed);

        // The fourth ratchet leaves the face uniform: it falls away.
        if (!state.fallen && state.step >= 4 && !state.anim && state.pendingStarts.length === 0) {
          fallFace(state);
        }

        // Deadline: the machinery forces the hatch even on an unsolved face.
        if (running && !state.hatchPopped && runTime >= faceStart(state.face) + beats(SOLVE_DEADLINE_BEATS)) {
          popHatch(state);
        }

        // Socket glow breathes while exposed.
        if (state.hatchPopped && !shellsBlown) {
          const pulse = 0.85 + Math.sin(elapsed * 6.7) * 0.25 + ctx.beatEnergy * 0.3;
          state.socketGlow.color.copy(HOT_ORANGE).multiplyScalar(pulse);
        }
        state.ribMaterial.color.copy(CHASSIS_DARK).multiplyScalar(1 + ctx.beatEnergy * 0.18);

        for (const tile of state.tiles) {
          if (tile.fly) updateFly(tile.group, tile.fly, dt);
        }
        if (state.assemblyFly) updateFly(state.assembly, state.assemblyFly, dt);
      }

      if (running && runTime >= CORE_TIME) blowShells();

      if (gyro.visible) {
        if (gyro.scale.x < 1 && !gyroDead) gyro.scale.setScalar(Math.min(1, gyro.scale.x + dt * 2.2));
        const rate = gyroSealed ? 0.15 : 0.7 + coreCharge * 2.6;
        for (const ring of gyroRings) {
          if (ring.fly) {
            updateFly(ring.mesh, ring.fly, dt);
            continue;
          }
          scratchQuat.setFromAxisAngle(ring.axis, ring.rate * rate * dt);
          ring.mesh.quaternion.premultiply(scratchQuat);
        }
        if (gyroSealed) {
          for (const ring of gyroRings) {
            (ring.mesh.material as MeshBasicMaterial).color.lerp(MACHINE_DARK, Math.min(1, dt * 1.5));
          }
        }
      }
    },
  };
}
