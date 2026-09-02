import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../../engine/rng';
import { CUBE_HALF, CUBIE_PITCH, CUBIE_SIZE, HUB_RECESS, STICKER_INSET, type CubeFight } from '../cube';
import {
  CUBIE_COUNT,
  FACE_NORMALS,
  NO_COLOR,
  cubieCoords,
  cubiesInLayer,
  faceCenterCubie,
  hasSticker,
  slotIndex,
  type LayerMove,
} from '../cube-state';
import { burstLooseCubies, spawnGlint, spawnRing, throwCubie } from './effects';
import { CUBIE_BODY, HOT_WHITE, MACHINE_DARK, MACHINE_GREY, MACHINE_WHITE, SEAM, SOLVE_COLORS, hdr, solveColor } from './palette';

// Leaf: the colossal cube itself. 27 rounded cubies and 54 sticker plates in two
// instanced draws, driven every frame from the fight's sticker state and layer
// animation. Fallen faces render their stickers as recessed grey machinery and
// grow a white frame with a gear ring; the shell blow hides everything and
// reveals the mechanism: six gear rings on struts around the core.

const PLATE_SIZE = CUBIE_SIZE - STICKER_INSET * 2;
const PLATE_THICKNESS = 0.24;
const IDLE_SNAP_SECONDS = 0.2;

type IdleSnap = { move: LayerMove; start: number; land: number };

const scratchMatrix = new Matrix4();
const scratchRotation = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchAxis = new Vector3();
const scratchPosition = new Vector3();
const scratchScale = new Vector3();
const scratchColor = new Color();
const scratchNormal = new Vector3();

export function createCubeVisual(fight: CubeFight, scene: Scene) {
  const group = new Group();
  scene.add(group);
  const rng = mulberry32(0xc0b1e);

  const cubies = new InstancedMesh(
    new RoundedBoxGeometry(CUBIE_SIZE, CUBIE_SIZE, CUBIE_SIZE, 3, 0.55),
    new MeshStandardMaterial({ color: CUBIE_BODY.clone(), roughness: 0.55, metalness: 0.05 }),
    CUBIE_COUNT,
  );
  cubies.frustumCulled = false;
  cubies.name = 'cubies';
  group.add(cubies);

  const plates = new InstancedMesh(
    new RoundedBoxGeometry(PLATE_SIZE, PLATE_SIZE, PLATE_THICKNESS, 2, 0.42),
    new MeshBasicMaterial({ color: 0xffffff }),
    CUBIE_COUNT * 6,
  );
  plates.frustumCulled = false;
  plates.name = 'plates';
  group.add(plates);
  // Prime the colour attribute so setColorAt has a buffer from the first frame.
  for (let i = 0; i < CUBIE_COUNT * 6; i += 1) plates.setColorAt(i, scratchColor.set(0, 0, 0));

  // The dark interior showing through the seams.
  const interior = new Mesh(new BoxGeometry(CUBE_HALF * 2 - 1.2, CUBE_HALF * 2 - 1.2, CUBE_HALF * 2 - 1.2), new MeshBasicMaterial({ color: SEAM.clone() }));
  interior.name = 'cube-interior';
  group.add(interior);

  // Machinery panels revealed when a face falls: a white frame, a gear ring
  // around the axle hole, four grey struts.
  const panels: Group[] = [];
  for (let face = 0; face < 6; face += 1) {
    const panel = createPanel();
    orientToFace(panel, face);
    panel.visible = false;
    panel.name = `panel-${face}`;
    group.add(panel);
    panels.push(panel);
  }

  // The mechanism inside: six gear rings on off-axis struts around the core.
  const mechanism = createMechanism();
  mechanism.name = 'mechanism';
  mechanism.visible = false;
  group.add(mechanism);

  let idle: IdleSnap | null = null;
  let shudder = 0;
  let shellBlown = false;
  let lastRunning = false;
  const hubGone = new Array<boolean>(6).fill(false);

  function slotColor(cubie: number, face: number, lit: boolean, locked: boolean, elapsed: number, out: Color) {
    const color = fight.state[slotIndex(cubie, face)];
    if (color === NO_COLOR) return out.set(0, 0, 0);
    if (fight.fallen[face]) return out.copy(MACHINE_DARK).lerp(MACHINE_GREY, 0.25);
    out.copy(SOLVE_COLORS[color]);
    if (lit) {
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 9);
      out.multiplyScalar(1.45 + pulse * 0.35);
      if (locked) out.lerp(hdr(HOT_WHITE, 2.2), 0.5);
    }
    return out;
  }

  function layerRotation(cubie: number, elapsed: number) {
    // The fight owns the run-time animation; idle snaps are visual-only.
    const runAngle = fight.animation ? fight.layerAngle(fight.animation.move, cubie) : 0;
    if (runAngle !== 0 && fight.animation) {
      scratchAxis.set(0, 0, 0).setComponent(fight.animation.move.axis, 1);
      return scratchRotation.makeRotationAxis(scratchAxis, runAngle);
    }
    if (idle) {
      const p = cubieCoords(cubie);
      if (p[idle.move.axis] === idle.move.depth) {
        const t = Math.min(1, Math.max(0, (elapsed - idle.start) / (idle.land - idle.start)));
        const eased = t * t * (3 - 2 * t);
        scratchAxis.set(0, 0, 0).setComponent(idle.move.axis, 1);
        return scratchRotation.makeRotationAxis(scratchAxis, idle.move.dir * (Math.PI / 2) * eased);
      }
    }
    return scratchRotation.identity();
  }

  function writeInstances(elapsed: number, lockedCubies: ReadonlySet<number>, activeFace: number) {
    const lit = activeFace >= 0 ? fight.litCubies(activeFace) : null;
    for (let cubie = 0; cubie < CUBIE_COUNT; cubie += 1) {
      const p = cubieCoords(cubie);
      const centerFace = centerFaceOf(cubie);
      const hidden = shellBlown || (centerFace >= 0 && fight.ejectedCenters[centerFace]) || cubie === 13;
      const rotation = layerRotation(cubie, elapsed);
      scratchPosition.set(p[0], p[1], p[2]).multiplyScalar(CUBIE_PITCH).applyMatrix4(rotation);
      // Hidden instances park far below the arena: a degenerate instance at the
      // origin would still catch the occlusion raycast against the core.
      if (hidden) scratchPosition.set(0, -5000, 0);
      scratchQuaternion.setFromRotationMatrix(rotation);
      scratchScale.setScalar(hidden ? 0.0001 : 1);
      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
      cubies.setMatrixAt(cubie, scratchMatrix);

      for (let face = 0; face < 6; face += 1) {
        const slot = slotIndex(cubie, face);
        if (!hasSticker(p, face) || hidden) {
          scratchScale.setScalar(0.0001);
          scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
          plates.setMatrixAt(slot, scratchMatrix);
          continue;
        }
        const n = FACE_NORMALS[face];
        const recess = fight.fallen[face] ? 0.9 : 0;
        scratchNormal.set(n[0], n[1], n[2]);
        const plateLocal = new Vector3(p[0], p[1], p[2]).multiplyScalar(CUBIE_PITCH)
          .addScaledVector(scratchNormal, CUBIE_SIZE / 2 + PLATE_THICKNESS / 2 - 0.05 - recess);
        plateLocal.applyMatrix4(rotation);
        scratchNormal.applyMatrix4(rotation);
        plateQuaternion(scratchNormal, scratchQuaternion);
        scratchScale.setScalar(fight.fallen[face] ? 0.82 : 1);
        scratchMatrix.compose(plateLocal, scratchQuaternion, scratchScale);
        plates.setMatrixAt(slot, scratchMatrix);
        const isLit = lit !== null && face === activeFace && lit.has(cubie);
        plates.setColorAt(slot, slotColor(cubie, face, isLit, isLit && lockedCubies.has(cubie), elapsed, scratchColor));
      }
    }
    cubies.instanceMatrix.needsUpdate = true;
    plates.instanceMatrix.needsUpdate = true;
    if (plates.instanceColor) plates.instanceColor.needsUpdate = true;
  }

  function update(dt: number, elapsed: number, running: boolean, lockedCubies: ReadonlySet<number>) {
    if (running && !lastRunning) {
      // Fresh run: shell back on, panels hidden, idle animation dropped.
      shellBlown = false;
      idle = null;
      hubGone.fill(false);
      mechanism.visible = false;
      interior.visible = true;
      for (const panel of panels) panel.visible = false;
    }
    lastRunning = running;

    if (idle && elapsed >= idle.land) {
      fight.applyIdleMove(idle.move);
      idle = null;
    }

    shudder = Math.max(0, shudder - dt * 9);
    group.scale.setScalar(1 + shudder * 0.012);
    writeInstances(elapsed, lockedCubies, fight.activeFace());

    for (let face = 0; face < 6; face += 1) {
      const panel = panels[face];
      panel.visible = !shellBlown && fight.fallen[face];
      if (panel.visible) {
        const gear = panel.userData.gear as Mesh;
        gear.rotation.z += dt * (hubGone[face] ? 0.2 : 1.3);
      }
    }

    if (shellBlown) {
      // Spin about the finale view axis only, so no strut ever crosses the
      // line of sight to the core.
      mechanism.rotation.z += dt * 0.4;
      const rings = mechanism.userData.rings as Mesh[];
      for (const ring of rings) ring.rotation.z += dt * 1.8;
    }
  }

  function startIdleSnap(elapsed: number) {
    if (idle || fight.running) return;
    const face = Math.floor(rng() * 6);
    const dir: 1 | -1 = rng() < 0.5 ? 1 : -1;
    const axis = Math.floor(face / 2) as 0 | 1 | 2;
    const depth = (face % 2 === 0 ? 1 : -1) as 1 | -1;
    idle = { move: { axis, depth, dir }, start: elapsed, land: elapsed + IDLE_SNAP_SECONDS };
  }

  /** Seam flash and shudder when a layer lands. */
  function onSnapLand(move: LayerMove, face: number, kind: 'arm' | 'solve' | 'idle') {
    shudder = Math.max(shudder, kind === 'solve' ? 1 : 0.6);
    const n = FACE_NORMALS[face];
    scratchNormal.set(n[0], n[1], n[2]);
    const center = scratchNormal.clone().multiplyScalar(CUBE_HALF + 0.3);
    const quaternion = plateQuaternion(scratchNormal, new Quaternion());
    spawnRing(center, hdr(HOT_WHITE, kind === 'solve' ? 0.9 : 0.55), CUBE_HALF * 1.35, 0.22, quaternion);
    void move;
  }

  /** The face falls away: plates and the centre cubie fly out, machinery shows. */
  function onFaceFall(face: number) {
    const n = FACE_NORMALS[face];
    const normal = new Vector3(n[0], n[1], n[2]);
    const color = solveColor(face);
    const plateColor = [color];
    for (let u = -1; u <= 1; u += 1) {
      for (let v = -1; v <= 1; v += 1) {
        const position = faceGridPosition(face, u, v, CUBE_HALF + 0.2);
        burstLooseCubies(position, normal, 1, { size: PLATE_SIZE * 0.72, speed: 9, spread: 2.2, life: 1.5, drag: 0.9, colors: plateColor, flat: true, rng });
      }
    }
    const centerPosition = normal.clone().multiplyScalar(CUBIE_PITCH);
    throwCubie(centerPosition, normal.clone().multiplyScalar(12).add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(3)), CUBIE_SIZE, CUBIE_BODY.clone().lerp(color, 0.35), 1.8, rng);
    burstLooseCubies(normal.clone().multiplyScalar(CUBE_HALF), normal, 26, { size: 0.55, speed: 13, spread: 5, life: 1.3, drag: 1.2, rng });
    const quaternion = plateQuaternion(normal, new Quaternion());
    spawnRing(normal.clone().multiplyScalar(CUBE_HALF + 0.4), hdr(HOT_WHITE, 1.2), CUBE_HALF * 2.1, 0.5, quaternion);
    spawnGlint(normal.clone().multiplyScalar(CUBE_HALF + 1), hdr(HOT_WHITE, 1.8), 4, 0.25);
    shudder = 1.6;
    panels[face].visible = true;
    void faceCenterCubie;
  }

  function onHubGone(face: number) {
    hubGone[face] = true;
  }

  /** Bar 24: the shell blows off and every remaining cubie becomes debris. */
  function onShellBlow() {
    if (shellBlown) return;
    shellBlown = true;
    interior.visible = false;
    for (const panel of panels) panel.visible = false;
    for (let cubie = 0; cubie < CUBIE_COUNT; cubie += 1) {
      if (cubie === 13) continue;
      const centerFace = centerFaceOf(cubie);
      if (centerFace >= 0 && fight.ejectedCenters[centerFace]) continue;
      const p = cubieCoords(cubie);
      const position = new Vector3(p[0], p[1], p[2]).multiplyScalar(CUBIE_PITCH);
      const direction = position.clone().normalize();
      const color = dominantColor(cubie);
      throwCubie(
        position,
        direction.multiplyScalar(16 + rng() * 10).add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(6)),
        CUBIE_SIZE * 0.92,
        color,
        2.6 + rng() * 0.8,
        rng,
      );
    }
    burstLooseCubies(new Vector3(), new Vector3(0, 1, 0), 80, { size: 0.6, speed: 6, spread: 22, life: 2.2, drag: 0.8, rng });
    mechanism.visible = true;
    const rings = mechanism.userData.rings as Mesh[];
    for (let face = 0; face < 6; face += 1) {
      const spindle = rings[face].userData.spindle as Mesh;
      spindle.visible = false;
    }
    shudder = 2.5;
  }

  function dominantColor(cubie: number) {
    const p = cubieCoords(cubie);
    for (let face = 0; face < 6; face += 1) {
      if (!hasSticker(p, face)) continue;
      const color = fight.state[slotIndex(cubie, face)];
      if (color !== NO_COLOR) return SOLVE_COLORS[color].clone();
    }
    return CUBIE_BODY.clone();
  }

  return {
    group,
    update,
    startIdleSnap,
    onSnapLand,
    onFaceFall,
    onHubGone,
    onShellBlow,
    isShellBlown: () => shellBlown,
  };
}

export type CubeVisual = ReturnType<typeof createCubeVisual>;

function centerFaceOf(cubie: number) {
  const p = cubieCoords(cubie);
  const nonZero = Math.abs(p[0]) + Math.abs(p[1]) + Math.abs(p[2]);
  if (nonZero !== 1) return -1;
  for (let face = 0; face < 6; face += 1) {
    const n = FACE_NORMALS[face];
    if (n[0] === p[0] && n[1] === p[1] && n[2] === p[2]) return face;
  }
  return -1;
}

const PLATE_FORWARD = new Vector3(0, 0, 1);

function plateQuaternion(normal: Vector3, out: Quaternion) {
  return out.setFromUnitVectors(PLATE_FORWARD, normal.clone().normalize());
}

function orientToFace(object: Group, face: number) {
  const n = FACE_NORMALS[face];
  const normal = new Vector3(n[0], n[1], n[2]);
  object.quaternion.copy(plateQuaternion(normal, new Quaternion()));
  object.position.copy(normal).multiplyScalar(CUBE_HALF);
}

export function faceGridPosition(face: number, u: number, v: number, distance: number) {
  const axis = Math.floor(face / 2);
  const sign = face % 2 === 0 ? 1 : -1;
  const uAxis = (axis + 1) % 3;
  const vAxis = (axis + 2) % 3;
  const p = [0, 0, 0];
  p[axis] = sign * distance;
  p[uAxis] = u * CUBIE_PITCH;
  p[vAxis] = v * CUBIE_PITCH;
  return new Vector3(p[0], p[1], p[2]);
}

// A fallen face's machinery: white frame, grey struts, a gear ring around the
// axle hole. Sits at the face plane; the hub target lives in the hole.
function createPanel() {
  const panel = new Group();
  const white = new MeshStandardMaterial({ color: MACHINE_WHITE.clone(), roughness: 0.4, metalness: 0.25 });
  const grey = new MeshStandardMaterial({ color: MACHINE_GREY.clone(), roughness: 0.6 });
  const dark = new MeshStandardMaterial({ color: MACHINE_DARK.clone(), roughness: 0.6 });
  const size = CUBE_HALF * 2 - 0.6;
  const beamGeometries: BufferGeometry[] = [];
  const beam = new BoxGeometry(size, 0.55, 0.5);
  for (const [x, y, rot] of [[0, size / 2 - 0.275, 0], [0, -size / 2 + 0.275, 0], [size / 2 - 0.275, 0, Math.PI / 2], [-size / 2 + 0.275, 0, Math.PI / 2]] as const) {
    beamGeometries.push(beam.clone().rotateZ(rot).translate(x, y, 0.1));
  }
  panel.add(new Mesh(mergeGeometries(beamGeometries), white));
  const strutGeometries: BufferGeometry[] = [];
  const strut = new BoxGeometry(0.3, 8.2, 0.3);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    strutGeometries.push(strut.clone().translate(0, 6.6, -0.5).rotateZ(angle));
  }
  panel.add(new Mesh(mergeGeometries(strutGeometries), grey));
  const gear = new Mesh(new TorusGeometry(2.55, 0.32, 8, 40), white);
  gear.position.z = -HUB_RECESS + 0.3;
  const teeth: BufferGeometry[] = [];
  const tooth = new BoxGeometry(0.5, 0.45, 0.6);
  for (let i = 0; i < 14; i += 1) {
    const angle = (i / 14) * Math.PI * 2;
    teeth.push(tooth.clone().rotateZ(angle).translate(Math.cos(angle) * 3.05, Math.sin(angle) * 3.05, 0));
  }
  const teethMesh = new Mesh(mergeGeometries(teeth), white);
  gear.add(teethMesh);
  panel.add(gear);
  const wellGeometry = new CylinderGeometry(2.3, 2.3, 1.6, 24, 1, true);
  const well = new Mesh(wellGeometry, dark);
  well.rotation.x = Math.PI / 2;
  well.position.z = -1.2;
  panel.add(well);
  const boltGeometries: BufferGeometry[] = [];
  const bolt = new CylinderGeometry(0.3, 0.3, 0.3, 8);
  for (const [x, y] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    boltGeometries.push(bolt.clone().rotateX(Math.PI / 2).translate(x * (size / 2 - 0.9), y * (size / 2 - 0.9), 0.35));
  }
  panel.add(new Mesh(mergeGeometries(boltGeometries), dark));
  panel.userData.gear = gear;
  panel.userData.raildIgnoreOcclusion = false;
  return panel;
}

// The exposed mechanism: a gear ring at each axle end, held to the core by four
// off-axis struts so the line of sight to the core centre stays clear.
function createMechanism() {
  const mechanism = new Group();
  const white = new MeshStandardMaterial({ color: MACHINE_WHITE.clone(), roughness: 0.4, metalness: 0.3 });
  const grey = new MeshStandardMaterial({ color: MACHINE_GREY.clone(), roughness: 0.6 });
  const rings: Mesh[] = [];
  const strutGeometries: BufferGeometry[] = [];
  for (let face = 0; face < 6; face += 1) {
    const n = FACE_NORMALS[face];
    const normal = new Vector3(n[0], n[1], n[2]);
    const ring = new Mesh(new TorusGeometry(2.1, 0.28, 8, 32), white);
    ring.quaternion.copy(plateQuaternion(normal, new Quaternion()));
    ring.position.copy(normal).multiplyScalar(6.4);
    const spindle = new Mesh(new CylinderGeometry(0.55, 0.55, 1.4, 12), grey);
    spindle.rotation.x = Math.PI / 2;
    ring.add(spindle);
    ring.userData.spindle = spindle;
    mechanism.add(ring);
    rings.push(ring);
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const strut = new CylinderGeometry(0.16, 0.16, 3.6, 6)
        .rotateX(Math.PI / 2)
        .translate(Math.cos(angle) * 1.95, Math.sin(angle) * 1.95, 4.6)
        .applyQuaternion(plateQuaternion(normal, new Quaternion()));
      strutGeometries.push(strut);
    }
  }
  mechanism.add(new Mesh(mergeGeometries(strutGeometries), grey));
  mechanism.userData.rings = rings;
  return mechanism;
}
