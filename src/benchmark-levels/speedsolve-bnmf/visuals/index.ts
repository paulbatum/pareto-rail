import { BoxGeometry, Color, Group, MathUtils, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import type { Camera, Object3D, PerspectiveCamera, Scene } from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import { createPendingVisualRecords } from '../../../engine/visual-kit';
import type { EventBus } from '../../../events';
import { CUBE_SLOTS, FACE_NORMALS, FACE_SLOTS, type Axis } from '../cube-model';
import {
  CUBIE_PITCH,
  DERIVED_PLAN,
  FACE_PLANE,
  SOLVE_PLAN,
  slotWorldPosition,
  type SpeedsolveGameplay,
} from '../gameplay';
import { assemblyBeats, onCubeSignal, type CubeSignal } from '../signals';
import { BEAT, FACE_BEATS, faceBeat } from '../timing';
import { createCubeVisual, paintSticker, type CubeLook } from './cube';
import { createEffects } from './effects';
import {
  createCoreTarget,
  createLockMark,
  createOcta,
  createPrism,
  createProjectile,
  createReticle as buildReticle,
  createShard,
  createTetra,
  createTileTarget,
  createWeakpoint,
  disposeMaterials,
  tint,
  type Ink,
} from './enemies';
import { createVoid } from './environment';
import { createLetterMesh } from './letters';
import {
  BODY,
  BODY_EDGE,
  FACE_COLORS,
  HAZE,
  INK,
  MACHINE,
  MACHINE_GREY,
  STEEL,
  VOID,
  VOID_DEEP,
  WHITE,
  hdr,
} from './palette';

// Spine: palette use and event choreography. The cube is animated straight
// from the live solve machine — a slice spins in with rising speed and lands
// on its snap beat with a small recoil — so what the player sees snapping is
// exactly what the score is playing.

const CUBE_LOOK: CubeLook = {
  pitch: CUBIE_PITCH,
  cubieSize: CUBIE_PITCH * 0.93,
  faceColors: FACE_COLORS,
  body: BODY,
  machine: MACHINE,
  machineDetail: MACHINE_GREY,
  steel: STEEL,
};
const INKS: Ink = { ink: INK, white: WHITE, machine: MACHINE, steel: STEEL };
const GREY_SPECKS = [MACHINE_GREY, HAZE, MACHINE];
const INK_SPECKS = [INK, BODY_EDGE];

const ZERO = new Vector3();
const TURN_RECOIL = { amplitude: 0.1, frequency: 34, damping: 11, seconds: 0.45 };
const ASSEMBLY = { launchRadius: 34, launchSeconds: 0.45, flyBeats: 1.25 };
const HALO = { radius: 13.2, depth: 2.2, spreadBeats: 1.25, spin: 0.16 };
const CORE_BLOOM_SCALE = 1.9;
/** After the run the camera backs off and the cube re-forms above the REPLAY letters. */
const REPLAY_STAGE = { camera: new Vector3(0, 0, 42), cubeLift: new Vector3(0, 12.5, 0), response: 1.4 };

type EnemyRecord = {
  mesh: Group;
  kind: string;
  bornAt: number | null;
  hue: number;
  lockMark: Group | null;
  lockCount: number;
  deniedAt: number;
  flashAt: number;
};

type StripKey = `${number}:${number}`;
type Strip = { group: Group; glow: MeshBasicMaterial; remaining: number; visible: boolean; flashAt: number };

type CubeMode = 'rest' | 'assemble' | 'halo' | 'burst' | 'reform';

export type SpeedsolveVisuals = ReturnType<typeof createSpeedsolveVisuals>;

export function createSpeedsolveVisuals(scene: Scene, bus: EventBus, gameplay: SpeedsolveGameplay, feel: CameraFeelRig) {
  const environment = createVoid(scene, {
    top: new Color('#f6f7fa'),
    bottom: VOID_DEEP,
    fog: VOID,
    fogNear: 80,
    fogFar: 230,
    ring: new Color('#c3c8d2'),
    dust: new Color('#d0d5de'),
    hemiSky: new Color('#ffffff'),
    hemiGround: new Color('#b9c0cc'),
    rings: [
      { radius: 38, tube: 0.07, tilt: [0.35, 0.2, 0], speed: 0.05, beads: 6 },
      { radius: 52, tube: 0.09, tilt: [-0.9, 0.5, 0.2], speed: -0.035, beads: 9 },
      { radius: 70, tube: 0.12, tilt: [1.45, -0.3, 0.6], speed: 0.025, beads: 12 },
      { radius: 96, tube: 0.16, tilt: [0.1, 1.2, -0.4], speed: -0.018, beads: 16 },
    ],
    dustCount: 260,
  });
  const cube = createCubeVisual(CUBE_LOOK);
  scene.add(cube.root);
  const effects = createEffects(scene);

  let now = 0;
  let beatEnergy = 0;
  let cubeMode: CubeMode = 'rest';
  let modeStartedAt = 0;
  let modeBeat = 0;
  let paintedVersion = -1;
  let coreSpin = 0;
  let coreVisible = true;
  let confettiUntil = -1;
  let lastCommitted = new Set<object>();
  let fidget: { axis: Axis; layer: number; at: number; dir: number } | null = null;
  const assembly: Array<{ from: Vector3; launch: Vector3; land: number; hidden: boolean }> = [];
  const reform: Array<{ from: Vector3; land: number }> = [];
  const haloFrom: Vector3[] = cube.cubies.map((cubie) => cubie.rest.clone());
  const burstVelocity: Vector3[] = cube.cubies.map(() => new Vector3());
  const strips = new Map<StripKey, Strip>();
  const records = createPendingVisualRecords<Group, EnemyRecord, [string]>({
    createRecord: (mesh, kind) => ({ mesh, kind, bornAt: null, hue: -1, lockMark: null, lockCount: 0, deniedAt: -1, flashAt: -1 }),
    disposeRecord: (record) => {
      detachLock(record);
      disposeMaterials(record.mesh);
    },
  });
  const projectiles = createPendingVisualRecords<Group, { mesh: Group; lastSpeck: number }>({
    createRecord: (mesh) => ({ mesh, lastSpeck: 0 }),
  });
  let letterIndex = 0;

  buildStrips();

  // ---- factories ------------------------------------------------------------------

  function createEnemyMesh(kind: string, letter?: string): Object3D {
    let mesh: Group;
    switch (kind) {
      case 'letter': {
        const color = FACE_COLORS[letterIndex % FACE_COLORS.length];
        letterIndex += 1;
        mesh = createLetterMesh(letter ?? '?', color, BODY, MACHINE);
        break;
      }
      case 'tetra':
        mesh = createTetra(FACE_COLORS[0], INKS);
        break;
      case 'octa':
        mesh = createOcta(FACE_COLORS[0], INKS);
        break;
      case 'prism':
        mesh = createPrism(FACE_COLORS[0], INKS);
        break;
      case 'shard':
        mesh = createShard(FACE_COLORS[0], INKS);
        break;
      case 'tile':
        mesh = createTileTarget(INKS);
        break;
      case 'weakpoint':
        mesh = createWeakpoint(INKS);
        break;
      case 'core':
        mesh = createCoreTarget(INKS, FACE_COLORS);
        break;
      default:
        mesh = new Group();
    }
    mesh.userData.kind = kind;
    if (kind !== 'conductor') mesh.scale.setScalar(0.001);
    records.enqueue(mesh);
    return mesh;
  }

  function setEnemyLocked(mesh: Object3D, locked: boolean) {
    const record = findRecord(mesh);
    if (mesh.userData.isLetter) {
      (mesh.userData.letterPlate as MeshStandardMaterial).color.copy(locked ? MACHINE : BODY);
      (mesh.userData.letterRim as MeshStandardMaterial).color.copy(locked ? INK : MACHINE);
    }
    if (!record) return;
    if (locked) {
      record.lockCount += 1;
      if (!record.lockMark) {
        record.lockMark = createLockMark(INKS);
        scene.add(record.lockMark);
      }
      record.lockMark.userData.bornAt = now;
    } else {
      record.lockCount = 0;
      detachLock(record);
    }
  }

  function setEnemyDenied(mesh: Object3D) {
    const record = findRecord(mesh);
    if (record) record.deniedAt = now;
    mesh.userData.deniedAt = now;
    effects.ring(mesh.getWorldPosition(new Vector3()), INK, 2.6, 0.35, 0.9);
  }

  function createProjectileMesh() {
    const mesh = createProjectile(INKS);
    projectiles.enqueue(mesh);
    return mesh;
  }

  function createReticle() {
    return buildReticle(INKS);
  }

  function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
    reticle.scale.setScalar((active ? 1.12 : 1) + lockCount * 0.035);
    const notches = reticle.userData.notches as Mesh[];
    notches.forEach((notch, index) => {
      (notch.material as MeshBasicMaterial).color.copy(index < lockCount ? INK : MACHINE);
      notch.scale.setScalar(index < lockCount ? 1.25 : 1);
    });
    reticle.userData.active = active;
  }

  // ---- bus choreography ------------------------------------------------------------

  const offs = [
    bus.on('spawn', ({ enemyId, kind, worldPosition }) => {
      const record = records.claim(enemyId, kind);
      if (!record) return;
      if (kind === 'tile') effects.ring(worldPosition, INK, 3.4, 0.4, 0.8);
      if (kind === 'weakpoint') {
        effects.burst({ position: worldPosition, colors: [MACHINE, MACHINE_GREY], count: 14, speed: 7, size: 0.28, life: 0.6, drag: 3, direction: awayFromCamera(worldPosition), spread: 1.3 });
      }
      if (kind === 'core') {
        // The spider is the core: it rides inside the target from here on.
        record.mesh.add(cube.core.group);
        record.mesh.scale.setScalar(1);
        effects.ring(worldPosition, WHITE, 9, 0.8, 0.9);
      }
    }),
    bus.on('lock', ({ worldPosition }) => {
      effects.ring(worldPosition, INK, 1.9, 0.22, 0.7);
    }),
    bus.on('unlock', ({ enemyId }) => {
      const record = records.get(enemyId);
      if (record && record.lockCount === 0) detachLock(record);
    }),
    bus.on('fire', ({ projectileId, worldPosition }) => {
      projectiles.claim(projectileId);
      effects.speck(worldPosition, INK, 0.35, 0.18);
    }),
    bus.on('hit', ({ enemyId, projectileId, worldPosition, lethal }) => {
      projectiles.delete(projectileId);
      const record = records.get(enemyId);
      if (!record) return;
      record.flashAt = now;
      if (!lethal) {
        const near = MathUtils.clamp(worldPosition.distanceTo(gameplay.pose.position) / 11, 0.3, 1);
        effects.burst({ position: worldPosition, colors: [MACHINE, INK], count: 6, speed: 7 * near, size: 0.2 * near, life: 0.35, drag: 4, direction: awayFromCamera(worldPosition), spread: 1.3 });
        effects.ring(worldPosition, WHITE, record.kind === 'core' ? 6 : 3, 0.3, 0.9);
        if (record.kind === 'core') feel.shake(0.18);
      }
    }),
    bus.on('stage', ({ enemyId, worldPosition }) => {
      const record = records.get(enemyId);
      if (record?.kind !== 'core') return;
      // The armoured caps pop off the spider.
      cube.core.caps.forEach((cap) => {
        if (!cap.visible) return;
        cap.visible = false;
        const at = cap.getWorldPosition(new Vector3());
        const color = (cap.material as MeshStandardMaterial).color;
        effects.burst({ position: at, colors: [color, WHITE], count: 14, speed: 12, size: 0.4, life: 1.1, direction: at.clone().sub(worldPosition).normalize(), spread: 0.5, drag: 2 });
      });
      effects.ring(worldPosition, INK, 10, 0.6, 1);
      feel.shake(0.45);
      feel.kickFov(-2.2);
    }),
    bus.on('kill', ({ enemyId, worldPosition }) => {
      const record = records.get(enemyId);
      if (!record) return;
      const away = awayFromCamera(worldPosition);
      // Debris is sized for mid-range; close kills shed proportionally smaller bits.
      const near = MathUtils.clamp(worldPosition.distanceTo(gameplay.pose.position) / 11, 0.3, 1);
      const color = record.hue >= 0 ? FACE_COLORS[record.hue] : WHITE;
      switch (record.kind) {
        case 'tile':
          effects.burst({ position: worldPosition, colors: INK_SPECKS, count: 10, speed: 9, size: 0.26, life: 0.5, drag: 3, direction: away, spread: 1.4 });
          effects.ring(worldPosition, WHITE, 4.2, 0.35, 1);
          break;
        case 'weakpoint':
          effects.burst({ position: worldPosition, colors: [color, color, MACHINE, MACHINE_GREY, INK], count: 40, speed: 13 * near, size: 0.36 * near, life: 1.1, drag: 2.2, direction: away, spread: 1.1 });
          effects.ring(worldPosition, color, 9, 0.6, 1);
          effects.ring(worldPosition, INK, 6, 0.45, 1);
          feel.shake(0.55);
          feel.kickFov(-2.5);
          break;
        case 'letter':
          effects.burst({ position: worldPosition, colors: [(record.mesh.userData.letterColor as Color) ?? WHITE, BODY], count: 16, speed: 9, size: 0.26, life: 0.7, drag: 2.5 });
          break;
        case 'core':
          break;
        default:
          effects.burst({ position: worldPosition, colors: [color, color, MACHINE, INK], count: 14, speed: 10 * near, size: 0.3 * near, life: 0.7, drag: 2.6, direction: away, spread: 1.2 });
          effects.ring(worldPosition, color, 3.4, 0.35, 0.9);
      }
      records.delete(enemyId, { dispose: true });
    }),
    bus.on('miss', ({ enemyId, worldPosition }) => {
      const record = records.get(enemyId);
      // A run that ends mid-fight takes the core target with it; keep the spider.
      if (record?.kind === 'core') cube.root.add(cube.core.group);
      if (record && record.kind !== 'conductor') {
        effects.burst({ position: worldPosition, colors: GREY_SPECKS, count: 5, speed: 3, size: 0.26, life: 0.45, drag: 3 });
      }
      if (record) records.delete(enemyId, { dispose: true });
    }),
    bus.on('reject', () => {
      feel.shake(0.12);
    }),
    bus.on('playerhit', () => {
      feel.shake(0.9);
      feel.kickFov(3);
    }),
    bus.on('beat', ({ isDownbeat }) => {
      beatEnergy = isDownbeat ? 1 : 0.5;
      if (gameplay.pose && !runningNow && isDownbeat && cubeMode === 'rest') {
        // Idle fidget on the attract screen: one slice ticks and settles.
        fidget = { axis: Math.floor(Math.random() * 3) as Axis, layer: Math.floor(Math.random() * 3) - 1, at: now, dir: Math.random() < 0.5 ? -1 : 1 };
      }
    }),
    bus.on('runstart', () => {
      effects.clear();
      records.clear({ dispose: true, pending: false });
      projectiles.clear({ pending: false });
      for (const strip of strips.values()) hideStrip(strip, false);
      paintedVersion = -1;
      fidget = null;
      confettiUntil = -1;
      resetCore();
      letterIndex = 0;
    }),
    bus.on('runend', () => {
      letterIndex = 0;
    }),
    onCubeSignal(handleSignal),
  ];

  let runningNow = false;

  function handleSignal(signal: CubeSignal) {
    switch (signal.type) {
      case 'assemble':
        beginAssembly(signal.beat, signal.pieces, signal.spanBeats);
        break;
      case 'arm':
        for (const { layer, quarters } of DERIVED_PLAN.wrongLayers[signal.face]) {
          const strip = strips.get(`${signal.face}:${layer}`);
          if (!strip) continue;
          strip.remaining = Math.abs(quarters);
          strip.visible = true;
          strip.group.visible = true;
          strip.flashAt = now;
        }
        break;
      case 'turn': {
        const strip = strips.get(`${signal.face}:${signal.layer}`);
        if (strip) {
          strip.remaining -= 1;
          strip.flashAt = now;
          if (strip.remaining <= 0) hideStrip(strip, true);
        }
        break;
      }
      case 'fall':
        shedFace(signal.face);
        break;
      case 'expose': {
        const center = new Vector3(...FACE_NORMALS[signal.face]).multiplyScalar(FACE_PLANE + 0.5);
        effects.ring(center, WHITE, 6, 0.5, 1);
        effects.ring(center, INK, 4, 0.4, 1);
        break;
      }
      case 'shell':
        cubeMode = 'halo';
        modeStartedAt = now;
        modeBeat = signal.beat;
        cube.cubies.forEach((cubie, index) => haloFrom[index].copy(cubie.group.position));
        effects.ring(new Vector3(), WHITE, 22, 0.9, 1);
        effects.ring(new Vector3(), INK, 14, 0.7, 1);
        feel.shake(0.5);
        break;
      case 'burst':
        burstCore(signal.destroyed);
        break;
      case 'reform':
        beginReform(signal.delaySeconds, signal.pieces, signal.spanBeats);
        break;
      default:
        break;
    }
  }

  // ---- row strips ----------------------------------------------------------------------

  function buildStrips() {
    const glowColor = hdr(WHITE, 2.4);
    SOLVE_PLAN.forEach((step, face) => {
      for (const { layer } of DERIVED_PLAN.wrongLayers[face]) {
        const slots = FACE_SLOTS[face].filter((slot) => CUBE_SLOTS[slot].p[step.axis] === layer);
        const points = slots.map((slot) => slotWorldPosition(slot, 0.32));
        const center = points.reduce((sum, point) => sum.add(point), new Vector3()).multiplyScalar(1 / points.length);
        const normal = new Vector3(...FACE_NORMALS[face]);
        const across = new Vector3(0, 0, 0).setComponent(step.axis, 1);
        const along = new Vector3().crossVectors(across, normal).normalize();
        const group = new Group();
        group.userData.raildIgnoreOcclusion = true;
        const basis = new Matrix4().makeBasis(along, across, normal);
        group.quaternion.setFromRotationMatrix(basis);
        group.position.copy(center);
        const glow = new MeshBasicMaterial({ color: glowColor, transparent: true, depthWrite: false });
        const inkMaterial = new MeshBasicMaterial({ color: INK });
        const length = CUBIE_PITCH * 3 + 0.1;
        const width = CUBIE_PITCH + 0.1;
        addFrame(group, length, width, 0.2, glow, 0.02);
        addFrame(group, length + 0.5, width + 0.5, 0.14, inkMaterial, 0);
        group.visible = false;
        scene.add(group);
        strips.set(`${face}:${layer}`, { group, glow, remaining: 0, visible: false, flashAt: -1 });
      }
    });
  }

  function addFrame(group: Group, length: number, width: number, thickness: number, material: MeshBasicMaterial, z: number) {
    const long = new BoxGeometry(length, thickness, 0.08);
    const short = new BoxGeometry(thickness, width, 0.08);
    for (const sign of [-1, 1]) {
      const a = new Mesh(long, material);
      a.position.set(0, sign * width / 2, z);
      const b = new Mesh(short, material);
      b.position.set(sign * length / 2, 0, z);
      group.add(a, b);
    }
  }

  function hideStrip(strip: Strip, flash: boolean) {
    strip.visible = false;
    strip.remaining = 0;
    if (!flash) strip.group.visible = false;
    else strip.flashAt = now;
  }

  // ---- cube motion ---------------------------------------------------------------------

  function beginAssembly(fromBeat: number, pieces: number, spanBeats: number) {
    cubeMode = 'assemble';
    modeStartedAt = now;
    modeBeat = fromBeat;
    const landings = assemblyBeats(pieces, spanBeats);
    const view = gameplay.pose.position.clone().normalize();
    // Back pieces first; the face the camera meets snaps in last.
    const order = cube.cubies.map((cubie, index) => ({ index, depth: cubie.rest.dot(view) + Math.random() * 0.5 })).sort((a, b) => a.depth - b.depth);
    assembly.length = 0;
    order.forEach(({ index }, rank) => {
      const cubie = cube.cubies[index];
      const hidden = cubie.group.scale.x < 0.5 || !cubie.group.visible;
      const launch = cubie.rest.clone().normalize().multiplyScalar(ASSEMBLY.launchRadius)
        .add(new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8));
      assembly[index] = { from: cubie.group.position.clone(), launch, land: fromBeat + landings[Math.min(rank, landings.length - 1)], hidden };
      cubie.group.visible = true;
    });
  }

  function beginReform(delaySeconds: number, pieces: number, spanBeats: number) {
    cubeMode = 'reform';
    modeStartedAt = now;
    const landings = assemblyBeats(pieces, spanBeats);
    reform.length = 0;
    cube.cubies.forEach((cubie, index) => {
      const hidden = cubie.group.scale.x < 0.5 || !cubie.group.visible;
      const from = hidden
        ? cubie.rest.clone().normalize().multiplyScalar(44).add(new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(16))
        : cubie.group.position.clone();
      reform[index] = { from, land: now + delaySeconds + landings[(index * 7) % landings.length] * BEAT };
      cubie.group.visible = true;
      if (hidden) cubie.group.scale.setScalar(0.001);
    });
  }

  function shedFace(face: number) {
    const normal = new Vector3(...FACE_NORMALS[face]);
    const color = FACE_COLORS[face];
    const center = normal.clone().multiplyScalar(FACE_PLANE);
    // The stickers spill off the face and drop down the screen, away from the lens.
    const down = new Vector3(0, -1, 0).applyQuaternion(gameplay.pose.quaternion);
    for (const slot of FACE_SLOTS[face]) {
      const position = slotWorldPosition(slot, 0.2);
      const outward = position.clone().sub(center);
      if (outward.lengthSq() < 0.01) outward.copy(down);
      outward.normalize().multiplyScalar(0.8).addScaledVector(normal, 0.45).addScaledVector(down, 0.5);
      effects.burst({
        position,
        colors: [color, color, color, MACHINE_GREY],
        count: 8,
        speed: 7,
        size: 0.55,
        life: 1.6,
        direction: outward.normalize(),
        spread: 0.45,
        gravity: down.clone().multiplyScalar(16),
        drag: 0.6,
        spin: 7,
        jitter: 1.1,
      });
    }
    effects.ring(center.clone().addScaledVector(normal, 0.3), color, 13, 0.7, 1);
    for (const strip of strips.values()) if (strip.group.visible && strip.group.position.dot(normal) > FACE_PLANE - 1) hideStrip(strip, false);
    feel.shake(0.3);
  }

  function burstCore(destroyed: boolean) {
    cubeMode = 'burst';
    modeStartedAt = now;
    coreVisible = false;
    cube.core.group.visible = false;
    cube.root.add(cube.core.group);
    const origin = new Vector3();
    effects.burst({
      position: origin,
      colors: FACE_COLORS,
      count: destroyed ? 900 : 520,
      speed: destroyed ? 30 : 20,
      size: 0.36,
      life: 5,
      drag: 1.1,
      gravity: new Vector3(0, -3.2, 0),
      spin: 9,
      jitter: 2,
    });
    effects.burst({ position: origin, colors: [MACHINE, MACHINE_GREY, WHITE], count: 90, speed: 24, size: 0.55, life: 2.4, drag: 1.5, spin: 6 });
    cube.cubies.forEach((cubie, index) => {
      burstVelocity[index].copy(cubie.group.position).normalize().multiplyScalar(20 + Math.random() * 14);
    });
    effects.ring(origin, WHITE, 30, 1.1, 1);
    effects.ring(origin, INK, 18, 0.8, 1);
    feel.shake(destroyed ? 1 : 0.6);
    feel.kickFov(destroyed ? 5 : 3);
    confettiUntil = now + 7;
  }

  function resetCore() {
    cube.root.add(cube.core.group);
    cube.core.group.position.set(0, 0, 0);
    coreVisible = true;
    cube.core.group.visible = true;
    cube.core.spinner.rotation.set(0, 0, 0);
    cube.core.spinner.scale.setScalar(1);
    for (const cap of cube.core.caps) cap.visible = true;
    cube.core.heartMaterial.emissive.setRGB(0, 0, 0);
    coreSpin = 0;
  }

  const axisVector = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
  const rotation = new Quaternion();
  const slabAngles = new Map<string, number>();

  function updateCube(dt: number, beat: number, running: boolean) {
    // Repaint from the puzzle when it changes.
    const state = gameplay.machine.state;
    if (state.version !== paintedVersion) {
      paintedVersion = state.version;
      cube.stickers.forEach((sticker) => paintSticker(sticker, state.colorAt(sticker.slot), CUBE_LOOK));
    }

    // Slab angles: spinning turns ease in to the snap; landed turns recoil.
    slabAngles.clear();
    const committed = new Set<object>();
    if (running) {
      for (const turn of gameplay.machine.turns) {
        const key = `${turn.axis}:${turn.layer}`;
        let angle = 0;
        if (!turn.committed) {
          if (beat < turn.startBeat) continue;
          const p = Math.min(0.999, (beat - turn.startBeat) / Math.max(0.01, turn.snapBeat - turn.startBeat));
          angle = turn.dir * (Math.PI / 2) * Math.pow(p, 2.1);
        } else {
          committed.add(turn);
          if (!lastCommitted.has(turn)) landTurn(turn.face, turn.axis, turn.layer, turn.auto);
          const t = (beat - turn.snapBeat) * BEAT;
          if (t > TURN_RECOIL.seconds) continue;
          angle = turn.dir * TURN_RECOIL.amplitude * Math.sin(t * TURN_RECOIL.frequency) * Math.exp(-t * TURN_RECOIL.damping);
        }
        slabAngles.set(key, (slabAngles.get(key) ?? 0) + angle);
      }
    } else if (fidget && cubeMode === 'rest') {
      const t = now - fidget.at;
      if (t < 0.6) slabAngles.set(`${fidget.axis}:${fidget.layer}`, fidget.dir * 0.16 * Math.sin(Math.min(1, t / 0.12) * Math.PI / 2) * Math.exp(-Math.max(0, t - 0.12) * 9));
      else fidget = null;
    }
    lastCommitted = committed;

    // The cube drifts up above the REPLAY letters after a run and home again for the next.
    cube.root.position.lerp(cubeMode === 'reform' ? REPLAY_STAGE.cubeLift : ZERO, 1 - Math.exp(-dt * 2.2));

    cube.cubies.forEach((cubie, index) => {
      const group = cubie.group;
      if (cubeMode === 'reform') {
        const plan = reform[index];
        if (!plan) return;
        const flyFrom = plan.land - 0.8;
        group.quaternion.identity();
        if (now < flyFrom) {
          group.position.copy(plan.from);
          group.scale.setScalar(Math.max(0.001, Math.min(1, (now - modeStartedAt) / 0.6)));
        } else if (now < plan.land) {
          const p = (now - flyFrom) / 0.8;
          group.position.copy(plan.from).lerp(cubie.rest, p * p * p);
          group.scale.setScalar(1);
        } else {
          const landed = now - plan.land;
          group.position.copy(cubie.rest);
          group.scale.setScalar(1 + 0.08 * Math.exp(-landed * 14) * Math.cos(landed * 30));
        }
        return;
      }
      if (cubeMode === 'assemble') {
        const plan = assembly[index];
        if (plan) {
          const since = now - modeStartedAt;
          const flyFrom = plan.land - ASSEMBLY.flyBeats;
          if (beat < flyFrom) {
            const k = Math.min(1, since / ASSEMBLY.launchSeconds);
            if (plan.hidden) {
              group.position.copy(plan.launch);
              group.scale.setScalar(Math.max(0.001, k));
            } else {
              group.position.copy(plan.from).lerp(plan.launch, 1 - (1 - k) ** 3);
              group.scale.setScalar(1);
            }
            group.quaternion.setFromAxisAngle(axisVector[index % 3], (1 - k) * 0 + Math.sin(now * 2 + index) * 0.4);
            return;
          }
          if (beat < plan.land) {
            const p = (beat - flyFrom) / ASSEMBLY.flyBeats;
            group.position.copy(plan.launch).lerp(cubie.rest, p * p * p);
            group.scale.setScalar(1);
            group.quaternion.setFromAxisAngle(axisVector[index % 3], (1 - p) * (1 - p) * 0.4 * Math.sin(now * 2 + index));
            return;
          }
          const landed = (beat - plan.land) * BEAT;
          group.scale.setScalar(1 + 0.08 * Math.exp(-landed * 14) * Math.cos(landed * 30));
        }
        if (assembly.every((entry) => beat >= entry.land + 1)) cubeMode = 'rest';
      }

      if (cubeMode === 'halo' || cubeMode === 'burst') {
        const angleBase = (index / cube.cubies.length) * Math.PI * 2 + (now - modeStartedAt) * HALO.spin * (1 + coreSpin * 0.25);
        const halo = new Vector3(Math.cos(angleBase) * HALO.radius, Math.sin(angleBase) * HALO.radius, (index % 2 === 0 ? 1 : -1) * HALO.depth);
        if (cubeMode === 'halo') {
          const p = Math.min(1, (beat - modeBeat) / HALO.spreadBeats);
          const eased = 1 - (1 - p) ** 3;
          group.position.copy(haloFrom[index]).lerp(halo, eased);
          rotation.setFromAxisAngle(axisVector[(index + 1) % 3], eased * (now - modeStartedAt) * 0.8);
          group.quaternion.copy(rotation);
        } else {
          group.position.addScaledVector(burstVelocity[index], dt);
          burstVelocity[index].multiplyScalar(Math.exp(-dt * 0.6));
          const s = Math.max(0, 1 - (now - modeStartedAt) / 1.4);
          group.scale.setScalar(Math.max(0.001, s));
          group.visible = s > 0.01;
          group.rotateOnAxis(axisVector[index % 3], dt * 6);
        }
        return;
      }

      group.scale.setScalar(cubeMode === 'assemble' ? group.scale.x : 1);
      group.position.copy(cubie.rest);
      group.quaternion.identity();
      for (const [key, angle] of slabAngles) {
        const [axis, layer] = key.split(':').map(Number);
        if (cubie.coord[axis] !== layer || angle === 0) continue;
        rotation.setFromAxisAngle(axisVector[axis], angle);
        group.position.applyQuaternion(rotation);
        group.quaternion.premultiply(rotation);
      }
    });

    // Core: invisible behind the shell until the halo opens; spins with the fight.
    if (coreVisible) {
      const spin = cubeMode === 'halo' ? Math.max(0.9, coreSpin) : 0.25;
      const grow = cubeMode === 'halo' ? Math.min(1, (beat - modeBeat) / HALO.spreadBeats) : 0;
      cube.core.spinner.scale.setScalar(1 + (CORE_BLOOM_SCALE - 1) * (1 - (1 - grow) ** 3));
      cube.core.spinner.rotation.y += dt * spin;
      cube.core.spinner.rotation.x += dt * spin * 0.37;
    }
  }

  function landTurn(face: number, axis: Axis, layer: number, auto: boolean) {
    // Every snap is a small physical hit on the beat.
    feel.kickFov(auto ? -0.4 : -0.9);
    const normal = new Vector3(...FACE_NORMALS[face]);
    const color = FACE_COLORS[face];
    const slots = FACE_SLOTS[face].filter((slot) => CUBE_SLOTS[slot].p[axis] === layer);
    for (const slot of slots) {
      const at = slotWorldPosition(slot, 0.4);
      effects.burst({ position: at, colors: auto ? GREY_SPECKS : [color, WHITE], count: 3, speed: 5, size: 0.24, life: 0.4, direction: normal, spread: 0.9, drag: 4 });
    }
    const strip = strips.get(`${face}:${layer}`);
    if (strip) strip.flashAt = now;
  }

  // ---- per-frame -----------------------------------------------------------------------

  const worldScratch = new Vector3();

  /** Runs before the runner on the REPLAY screen, so the letters follow the camera as it backs off. */
  function beforeRunner(dt: number, camera: PerspectiveCamera, ended: boolean) {
    if (!ended) return;
    camera.position.lerp(REPLAY_STAGE.camera, 1 - Math.exp(-dt * REPLAY_STAGE.response));
  }

  function update(dt: number, context: { camera: PerspectiveCamera; elapsed: number; running: boolean }) {
    now = context.elapsed;
    runningNow = context.running;
    beatEnergy = Math.max(0, beatEnergy - dt * 3.2);
    const runTime = gameplay.currentRunTime();
    const beat = context.running ? gameplay.clock.beatAt(runTime) : 0;
    const camera = context.camera;

    updateCube(dt, beat, context.running);
    updateStrips(beat);
    updateEnemies(dt, camera, beat);
    updateProjectiles();
    updateReticleSpin(dt);

    if (confettiUntil > now && Math.random() < dt * 30) {
      // Lingering confetti drifting down through the frame.
      const origin = new Vector3((Math.random() - 0.5) * 40, 16, (Math.random() - 0.5) * 10 - 18).applyQuaternion(camera.quaternion).add(camera.position);
      effects.burst({ position: origin, colors: FACE_COLORS, count: 3, speed: 1.2, size: 0.3, life: 4, gravity: new Vector3(0, -2.2, 0), drag: 0.5, spin: 5, jitter: 6 });
    }

    effects.update(dt, camera);
    environment.update(dt, camera, beatEnergy);
    feel.setFovOffset(beatEnergy * 0.35);
    feel.update(dt, { shake: { pitchDegrees: 0.6, yawDegrees: 0.5, rollDegrees: 1.1 } });
  }

  function updateStrips(beat: number) {
    for (const [key, strip] of strips) {
      // Two beats before the machine takes over, the pulse doubles and inks in.
      const face = Number(key.split(':')[0]);
      const local = beat - faceBeat(face);
      const warning = local >= FACE_BEATS.tileDeadline - 2 && local < FACE_BEATS.tileDeadline;
      const pulse = 0.5 + 0.5 * Math.cos(beat * Math.PI * (warning ? 4 : 2));
      if (!strip.group.visible) continue;
      const flash = Math.max(0, 1 - (now - strip.flashAt) / 0.3);
      if (!strip.visible) {
        strip.glow.opacity = flash;
        strip.group.scale.setScalar(1 + (1 - flash) * 0.08);
        if (flash <= 0) {
          strip.group.visible = false;
          strip.group.scale.setScalar(1);
        }
        continue;
      }
      strip.glow.opacity = 0.55 + pulse * 0.45;
      strip.glow.color.copy(WHITE).multiplyScalar(1.4 + pulse * 1.2 + flash * 2);
      if (warning) strip.glow.color.lerp(INK, pulse * 0.85);
      strip.group.scale.setScalar(1 + flash * 0.04);
    }
  }

  function updateEnemies(dt: number, camera: Camera, beat: number) {
    for (const [enemyId, record] of records.entries()) {
      const mesh = record.mesh;
      if (!mesh.parent) {
        records.delete(enemyId, { dispose: true });
        continue;
      }
      if (record.kind === 'conductor') continue;
      if (record.bornAt === null) record.bornAt = now;
      const age = now - record.bornAt;
      const hue = mesh.userData.hue as number | undefined;
      if (hue !== undefined && hue !== record.hue) {
        record.hue = hue;
        tint(mesh, FACE_COLORS[hue]);
        if (record.kind === 'weakpoint') {
          const lens = mesh.userData.lens as MeshStandardMaterial;
          lens.color.copy(FACE_COLORS[hue]);
        }
      }
      let scale = easeOutBack(Math.min(1, age / 0.32));
      if (record.kind === 'tile') scale = 1 + Math.max(0, 1 - age / 0.22) * 0.6;
      if (record.kind === 'core') scale = 1;
      const flash = Math.max(0, 1 - (now - record.flashAt) / 0.22);
      const denied = Math.max(0, 1 - (now - record.deniedAt) / 0.45);
      const baseScale = (mesh.userData.baseScale as number | undefined) ?? 1;
      mesh.scale.setScalar(Math.max(0.001, baseScale * scale * (1 + flash * 0.18)));
      if (denied > 0) mesh.rotateZ(Math.sin(now * 60) * 0.12 * denied);

      switch (record.kind) {
        case 'tile': {
          const hp = (mesh.userData.hp as number | undefined) ?? 1;
          (mesh.userData.pips as Mesh[]).forEach((pip, index) => {
            pip.visible = index < hp;
          });
          const pulse = 0.5 + 0.5 * Math.cos(beat * Math.PI * 2);
          (mesh.userData.glow as MeshBasicMaterial).color.copy(WHITE).multiplyScalar(1.3 + pulse * 1.4 + flash * 2);
          ((mesh.userData.wash as Mesh).material as MeshBasicMaterial).opacity = 0.12 + pulse * 0.16 + flash * 0.4;
          break;
        }
        case 'octa': {
          const charge = (mesh.userData.charge as number | undefined) ?? 0;
          const eye = mesh.userData.eye as MeshStandardMaterial;
          const color = FACE_COLORS[Math.max(0, record.hue)];
          eye.emissive.copy(color).multiplyScalar(charge * 2.4);
          eye.color.copy(MACHINE).lerp(color, charge);
          break;
        }
        case 'weakpoint': {
          (mesh.userData.gear as Group).rotation.z -= dt * 3.2;
          const lens = mesh.userData.lens as MeshStandardMaterial;
          const color = FACE_COLORS[Math.max(0, record.hue)];
          lens.emissive.copy(color).multiplyScalar(1.1 + (0.5 + 0.5 * Math.cos(beat * Math.PI * 2)) * 1.2 + flash * 2.5);
          break;
        }
        case 'core': {
          coreSpin = (mesh.userData.spin as number | undefined) ?? coreSpin;
          const damage = (mesh.userData.damage as number | undefined) ?? 0;
          const rings = mesh.userData.rings as Group[];
          rings[0].rotation.z += dt * coreSpin * 0.8;
          rings[1].rotation.z -= dt * coreSpin * 1.1;
          rings[0].rotation.y += dt * 0.4;
          const heartGlow = mesh.userData.heartGlow as MeshBasicMaterial;
          heartGlow.opacity = 0.08 + damage * 0.25 + flash * 0.4;
          cube.core.heartMaterial.emissive.copy(FACE_COLORS[5]).multiplyScalar(damage * 1.6 + flash * 1.5);
          break;
        }
        case 'shard': {
          // Shrinks as it closes so the last stretch reads as a hit, not a wall.
          const closeness = (mesh.userData.closeness as number | undefined) ?? 0;
          mesh.scale.multiplyScalar(1 - closeness * 0.6);
          const halo = mesh.userData.shardHalo as Mesh;
          halo.quaternion.copy(mesh.quaternion).invert().multiply(camera.quaternion);
          halo.scale.setScalar(1 + 0.25 * Math.sin(now * 20));
          break;
        }
        case 'letter': {
          const cells = mesh.userData.letterCells as MeshStandardMaterial;
          const base = mesh.userData.letterColor as Color;
          cells.emissive.copy(base).multiplyScalar(0.18 + beatEnergy * 0.35 + (record.lockMark ? 0.6 : 0));
          if (denied > 0) (mesh.userData.letterPlate as MeshStandardMaterial).color.copy(BODY).lerp(INK, denied);
          break;
        }
        default:
          break;
      }

      if (record.lockMark) {
        mesh.getWorldPosition(worldScratch);
        record.lockMark.position.copy(worldScratch);
        record.lockMark.quaternion.copy(camera.quaternion);
        const born = (record.lockMark.userData.bornAt as number | undefined) ?? now;
        const snap = Math.max(0, 1 - (now - born) / 0.16);
        const fit = (mesh.userData.lockScale as number | undefined) ?? 1.5;
        const extra = Math.min(5, record.lockCount - 1) * 0.12;
        record.lockMark.scale.setScalar(fit * (1 + extra + snap * 0.6));
        record.lockMark.rotateZ(now * 1.4 + snap);
      }
    }
  }

  function updateProjectiles() {
    for (const [projectileId, record] of projectiles.entries()) {
      if (!record.mesh.parent) {
        projectiles.delete(projectileId);
        continue;
      }
      if (now - record.lastSpeck > 0.02) {
        record.lastSpeck = now;
        effects.speck(record.mesh.position, INK, 0.16, 0.22);
      }
    }
  }

  function updateReticleSpin(dt: number) {
    const reticle = scene.children.find((child) => child.userData.raildRole === 'reticle');
    if (!reticle) return;
    const spinner = reticle.userData.spinner as Group | undefined;
    if (spinner) spinner.rotation.z += dt * (reticle.userData.active ? 3.2 : 0.7);
  }

  function detachLock(record: EnemyRecord) {
    if (!record.lockMark) return;
    record.lockMark.removeFromParent();
    disposeMaterials(record.lockMark);
    record.lockMark = null;
  }

  function awayFromCamera(position: Vector3) {
    return position.clone().sub(gameplay.pose.position).normalize();
  }

  function findRecord(mesh: Object3D) {
    const id = mesh.userData.raildEnemyId as number | undefined;
    return id === undefined ? undefined : records.get(id);
  }

  function dispose() {
    for (const off of offs) off();
    records.clear({ dispose: true, pending: true });
  }

  return {
    factories: {
      createEnemyMesh,
      setEnemyLocked,
      setEnemyDenied,
      createProjectileMesh,
      createReticle,
      setReticleActive,
    },
    update,
    beforeRunner,
    dispose,
  };
}

function easeOutBack(t: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
