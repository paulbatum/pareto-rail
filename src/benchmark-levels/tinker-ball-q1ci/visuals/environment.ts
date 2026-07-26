import {
  AmbientLight,
  BoxGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { PerspectiveCamera, Scene } from 'three';
import { disposeObject3D } from '../../../engine/visual-kit';
import { createSupplyPiece } from './models';
import {
  BLUE,
  CARDBOARD,
  CORAL,
  CREAM,
  CYAN,
  GLUE_BLACK,
  GLUE_RIM,
  GRAPHITE,
  MINT,
  ORANGE,
  PAPER,
  SUPPLY_COLORS,
  VIOLET,
  WOOD,
  WOOD_DARK,
  WOOD_LIGHT,
  YELLOW,
} from './palette';

export type WorkshopEnvironment = {
  root: Group;
  ball: Group;
  update(dt: number, elapsed: number, camera: PerspectiveCamera, runProgress: number, beatEnergy: number): void;
  reset(): void;
  defeatSpill(): void;
  dispose(): void;
};

type RoutePiece = {
  object: import('three').Object3D;
  direction: Vector3;
  offset: number;
};

const tempMatrix = new Matrix4();
const tempPosition = new Vector3();
const tempScale = new Vector3();
const tempQuaternion = new Quaternion();

function standard(
  color: number | Color,
  roughness = 0.72,
  metalness = 0.02,
  transparent = false,
  opacity = 1,
) {
  return new MeshStandardMaterial({ color, roughness, metalness, transparent, opacity });
}

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function setInstance(
  mesh: InstancedMesh,
  index: number,
  position: Vector3,
  rotation: Quaternion,
  scale: Vector3,
  color?: Color,
) {
  tempMatrix.compose(position, rotation, scale);
  mesh.setMatrixAt(index, tempMatrix);
  if (color) mesh.setColorAt(index, color);
}

function createTabletop(root: Group) {
  const slab = new Mesh(
    new BoxGeometry(220, 2.2, 540),
    standard(WOOD, 0.78),
  );
  slab.position.set(0, -1.2, -230);
  slab.receiveShadow = true;
  root.add(slab);

  const edge = new Mesh(
    new BoxGeometry(224, 3.8, 5),
    standard(WOOD_DARK, 0.78),
  );
  edge.position.set(0, -2.1, -498);
  root.add(edge);

  // Paper-clear finishing patch: same wood, sanded lighter and entirely free
  // of the clutter fields used everywhere else.
  const cleanPatch = new Mesh(
    new CircleGeometry(23, 48),
    standard(WOOD_LIGHT, 0.66),
  );
  cleanPatch.rotation.x = -Math.PI / 2;
  cleanPatch.scale.set(1.55, 0.78, 1);
  cleanPatch.position.set(-7, 0.04, -480);
  root.add(cleanPatch);
  for (let index = 0; index < 5; index += 1) {
    const shine = new Mesh(
      new PlaneGeometry(8 - index * 0.7, 0.045),
      new MeshBasicMaterial({ color: CREAM, transparent: true, opacity: 0.2, side: DoubleSide }),
    );
    shine.rotation.x = -Math.PI / 2;
    shine.rotation.z = 0.35;
    shine.position.set(-16 + index * 5, 0.075, -481 + index * 1.1);
    root.add(shine);
  }
}

function createScratchRoads(root: Group, rail: CatmullRomCurve3) {
  const points = Array.from({ length: 90 }, (_, index) => {
    const point = rail.getPointAt(index / 89);
    return new Vector3(point.x, 0.05, point.z);
  });
  for (const [offset, radius, color] of [
    [-0.42, 0.045, 0x5a2c20],
    [0.38, 0.03, 0xe2a568],
    [1.15, 0.018, 0x6d3526],
  ] as const) {
    const shifted = points.map((point, index) => point.clone().add(new Vector3(
      offset + Math.sin(index * 0.43) * 0.08,
      index % 7 === 0 ? 0.018 : 0,
      Math.cos(index * 0.31) * 0.12,
    )));
    const scratch = new Mesh(
      new TubeGeometry(new CatmullRomCurve3(shifted), 280, radius, 4, false),
      new MeshBasicMaterial({ color, transparent: true, opacity: offset === 0.38 ? 0.5 : 0.74 }),
    );
    root.add(scratch);
  }

  const random = seeded(99173);
  for (let index = 0; index < 80; index += 1) {
    const scratch = new Mesh(
      new PlaneGeometry(1.4 + random() * 5.5, 0.025 + random() * 0.045),
      new MeshBasicMaterial({
        color: index % 3 === 0 ? 0xe5a163 : 0x5e2d23,
        transparent: true,
        opacity: 0.25 + random() * 0.35,
        side: DoubleSide,
      }),
    );
    scratch.rotation.x = -Math.PI / 2;
    scratch.rotation.z = (random() - 0.5) * Math.PI;
    scratch.position.set(-96 + random() * 192, 0.055, 12 - random() * 485);
    root.add(scratch);
  }
}

function createSmallClutter(root: Group) {
  const random = seeded(424242);
  const count = 72;
  const buttons = new InstancedMesh(
    new CylinderGeometry(0.48, 0.48, 0.13, 14),
    standard(0xffffff, 0.52),
    count,
  );
  const beads = new InstancedMesh(
    new SphereGeometry(0.28, 9, 6),
    standard(0xffffff, 0.38),
    count,
  );
  const clips = new InstancedMesh(
    new TorusGeometry(0.42, 0.05, 6, 18),
    standard(0xb8c4c1, 0.3, 0.65),
    count,
  );
  const pins = new InstancedMesh(
    new CylinderGeometry(0.028, 0.028, 1.65, 6),
    standard(0xd5ddda, 0.25, 0.78),
    count,
  );
  const pinHeads = new InstancedMesh(
    new SphereGeometry(0.12, 8, 5),
    standard(0xffffff, 0.4),
    count,
  );

  for (let index = 0; index < count; index += 1) {
    const zone = index / count;
    const z = 8 - zone * 310 - random() * 22;
    const x = (random() < 0.5 ? -1 : 1) * (13 + random() * 82);
    const size = 0.68 + zone * 0.75 + random() * 0.25;
    const color = SUPPLY_COLORS[index % SUPPLY_COLORS.length];
    tempQuaternion.setFromAxisAngle(new Vector3(0, 1, 0), random() * Math.PI * 2);
    setInstance(buttons, index, tempPosition.set(x, 0.14, z), tempQuaternion, tempScale.setScalar(size), color);

    const bx = x + (random() - 0.5) * 6;
    const bz = z + (random() - 0.5) * 7;
    setInstance(
      beads,
      index,
      tempPosition.set(bx, 0.25 * size, bz),
      tempQuaternion,
      tempScale.setScalar(size),
      SUPPLY_COLORS[(index + 2) % SUPPLY_COLORS.length],
    );

    tempQuaternion.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    tempQuaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), random() * Math.PI));
    setInstance(
      clips,
      index,
      tempPosition.set(x + (random() - 0.5) * 9, 0.11, z + (random() - 0.5) * 9),
      tempQuaternion,
      tempScale.set(size * 1.4, size * 0.62, size),
    );

    const pinAngle = random() * Math.PI;
    tempQuaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    tempQuaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), pinAngle));
    const pinX = x + (random() - 0.5) * 11;
    const pinZ = z + (random() - 0.5) * 11;
    setInstance(pins, index, tempPosition.set(pinX, 0.14, pinZ), tempQuaternion, tempScale.setScalar(size));
    setInstance(
      pinHeads,
      index,
      tempPosition.set(pinX + Math.cos(pinAngle) * 0.78 * size, 0.16, pinZ + Math.sin(pinAngle) * 0.78 * size),
      tempQuaternion,
      tempScale.setScalar(size),
      SUPPLY_COLORS[(index + 4) % SUPPLY_COLORS.length],
    );
  }
  buttons.instanceMatrix.needsUpdate = true;
  beads.instanceMatrix.needsUpdate = true;
  clips.instanceMatrix.needsUpdate = true;
  pins.instanceMatrix.needsUpdate = true;
  pinHeads.instanceMatrix.needsUpdate = true;
  if (buttons.instanceColor) buttons.instanceColor.needsUpdate = true;
  if (beads.instanceColor) beads.instanceColor.needsUpdate = true;
  if (pinHeads.instanceColor) pinHeads.instanceColor.needsUpdate = true;
  root.add(buttons, beads, clips, pins, pinHeads);
}

function createMediumClutter(root: Group) {
  const random = seeded(12832);
  const spoolCount = 34;
  const spools = new InstancedMesh(
    new CylinderGeometry(0.8, 0.8, 1.1, 16),
    standard(0xffffff, 0.66),
    spoolCount,
  );
  const blocks = new InstancedMesh(
    new BoxGeometry(1.25, 0.9, 1.05),
    standard(0xffffff, 0.82),
    spoolCount,
  );
  const erasers = new InstancedMesh(
    new BoxGeometry(1.2, 0.38, 0.58),
    standard(0xffffff, 0.91),
    spoolCount,
  );

  for (let index = 0; index < spoolCount; index += 1) {
    const z = -142 - random() * 238;
    const x = (random() < 0.5 ? -1 : 1) * (17 + random() * 74);
    const size = 0.8 + random() * 0.9;
    tempQuaternion.setFromAxisAngle(new Vector3(0, 1, 0), random() * Math.PI);
    setInstance(spools, index, tempPosition.set(x, 0.55 * size, z), tempQuaternion, tempScale.setScalar(size), SUPPLY_COLORS[index % SUPPLY_COLORS.length]);
    setInstance(
      blocks,
      index,
      tempPosition.set(x + (random() - 0.5) * 10, 0.48 * size, z + (random() - 0.5) * 10),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), random() * Math.PI),
      tempScale.setScalar(size),
      index % 2 ? WOOD_LIGHT : SUPPLY_COLORS[(index + 3) % SUPPLY_COLORS.length],
    );
    setInstance(
      erasers,
      index,
      tempPosition.set(x + (random() - 0.5) * 13, 0.22 * size, z + (random() - 0.5) * 13),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), random() * Math.PI),
      tempScale.setScalar(size),
      index % 2 ? CORAL : BLUE,
    );
  }
  spools.instanceMatrix.needsUpdate = true;
  blocks.instanceMatrix.needsUpdate = true;
  erasers.instanceMatrix.needsUpdate = true;
  if (spools.instanceColor) spools.instanceColor.needsUpdate = true;
  if (blocks.instanceColor) blocks.instanceColor.needsUpdate = true;
  if (erasers.instanceColor) erasers.instanceColor.needsUpdate = true;
  root.add(spools, blocks, erasers);
}

function createLargeProps(root: Group) {
  const paperMaterial = standard(PAPER, 0.94);
  const cardMaterial = standard(CARDBOARD, 0.9);
  const placements = [
    [-63, -205, -0.22, PAPER],
    [70, -270, 0.36, CARDBOARD],
    [-62, -352, 0.15, PAPER],
    [68, -417, -0.42, CARDBOARD],
  ] as const;
  placements.forEach(([x, z, rotation, color], index) => {
    const sheet = new Mesh(new BoxGeometry(22 + index * 2, 0.18, 16 + index), color === PAPER ? paperMaterial : cardMaterial);
    sheet.position.set(x, 0.11, z);
    sheet.rotation.y = rotation;
    root.add(sheet);
    for (let line = 0; line < 5; line += 1) {
      const rule = new Mesh(new PlaneGeometry(11 + index, 0.07), new MeshBasicMaterial({ color: color === PAPER ? BLUE : WOOD_DARK }));
      rule.rotation.x = -Math.PI / 2;
      rule.rotation.z = rotation;
      rule.position.set(x, 0.215, z - 4 + line * 2);
      root.add(rule);
    }
  });

  const rulerPlacements = [
    [-82, -330, 0.72],
    [75, -360, -0.64],
    [-76, -426, 0.25],
    [55, -454, -0.2],
  ] as const;
  for (const [x, z, rotation] of rulerPlacements) {
    const ruler = new Group();
    const body = new Mesh(new BoxGeometry(4.2, 0.34, 34), standard(YELLOW, 0.7));
    ruler.add(body);
    for (let index = -7; index <= 7; index += 1) {
      const tick = new Mesh(
        new BoxGeometry(index % 2 === 0 ? 2.1 : 1.2, 0.12, 0.09),
        new MeshBasicMaterial({ color: GRAPHITE }),
      );
      tick.position.set(0.8, 0.22, index * 2);
      ruler.add(tick);
    }
    ruler.position.set(x, 0.22, z);
    ruler.rotation.y = rotation;
    root.add(ruler);
  }

  const potColors = [CORAL, CYAN, VIOLET, MINT];
  for (let index = 0; index < 8; index += 1) {
    const pot = new Group();
    const body = new Mesh(new CylinderGeometry(2.4, 2.1, 4.2, 18), standard(potColors[index % potColors.length], 0.5));
    const rim = new Mesh(new TorusGeometry(2.38, 0.22, 8, 24), standard(CREAM, 0.55));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 2.15;
    pot.add(body, rim);
    pot.position.set((index % 2 ? 1 : -1) * (68 + (index % 3) * 8), 2.1, -255 - index * 27);
    root.add(pot);
  }
}

function createLamp(root: Group) {
  const lamp = new Group();
  const base = new Mesh(new CylinderGeometry(7.5, 8.6, 2.4, 24), standard(GRAPHITE, 0.28, 0.5));
  const stem = new Mesh(new CylinderGeometry(0.9, 1.2, 38, 14), standard(0x7d7d76, 0.25, 0.72));
  stem.position.set(0, 19, 0);
  stem.rotation.z = -0.25;
  const shade = new Mesh(
    new ConeGeometry(9.5, 10, 28, 1, true),
    standard(ORANGE, 0.46, 0.05, false),
  );
  shade.position.set(5.1, 38, 0);
  shade.rotation.z = Math.PI;
  const bulb = new Mesh(
    new SphereGeometry(2.2, 16, 10),
    new MeshBasicMaterial({ color: 0xffe6a8 }),
  );
  bulb.position.set(5.1, 34, 0);
  lamp.add(base, stem, shade, bulb);
  lamp.position.set(82, 0, -248);
  root.add(lamp);
}

function createSpill(root: Group, rail: CatmullRomCurve3) {
  const spill = new Group();
  const point = rail.getPointAt(0.947);
  const material = standard(GLUE_BLACK, 0.16, 0.15, true, 0.96);
  const rimMaterial = new MeshBasicMaterial({ color: GLUE_RIM, transparent: true, opacity: 0.46, side: DoubleSide });
  const lobes = [
    [0, 0, 14, 8],
    [-10, 3, 10, 6],
    [11, -2, 12, 7],
    [-3, -8, 9, 5],
    [6, 8, 8, 5],
  ] as const;
  for (const [x, z, sx, sz] of lobes) {
    const lobe = new Mesh(new SphereGeometry(1, 20, 10), material.clone());
    lobe.scale.set(sx, 0.28, sz);
    lobe.position.set(x, 0.1, z);
    spill.add(lobe);
  }
  for (let index = 0; index < 3; index += 1) {
    const rim = new Mesh(new RingGeometry(7 + index * 4, 7.3 + index * 4, 36), rimMaterial.clone());
    rim.rotation.x = -Math.PI / 2;
    rim.scale.set(1.35, 0.72, 1);
    rim.position.y = 0.29;
    spill.add(rim);
  }
  spill.position.set(point.x, 0, point.z);
  spill.userData.materials = spill.children.flatMap((child) => {
    if (!(child instanceof Mesh)) return [];
    return Array.isArray(child.material) ? child.material : [child.material];
  });
  root.add(spill);
  return spill;
}

function createBall(root: Group) {
  const ball = new Group();
  const bodyMaterial = new MeshStandardMaterial({
    color: 0xe94957,
    roughness: 0.62,
    metalness: 0.02,
    emissive: 0x3b0710,
    emissiveIntensity: 0.08,
  });
  const body = new Mesh(new SphereGeometry(1, 28, 18), bodyMaterial);
  body.userData.permanentBallPart = true;
  const equator = new Mesh(
    new TorusGeometry(1.01, 0.035, 7, 40),
    new MeshBasicMaterial({ color: YELLOW }),
  );
  equator.userData.permanentBallPart = true;
  const highlight = new Mesh(
    new SphereGeometry(0.18, 10, 7),
    new MeshBasicMaterial({ color: 0xffffff }),
  );
  highlight.scale.set(1, 0.45, 0.3);
  highlight.position.set(-0.38, 0.44, 0.82);
  highlight.userData.permanentBallPart = true;
  ball.add(body, equator, highlight);
  ball.userData.body = body;
  ball.userData.equator = equator;
  ball.userData.radius = 0.72;
  ball.userData.raildIgnoreOcclusion = true;
  ball.renderOrder = 4;
  root.add(ball);
  return ball;
}

function createRoutePieces(ball: Group) {
  const kinds = ['button-beetle', 'pencil-walker', 'clothespin-bird', 'spool-crab', 'block-golem'];
  const pieces: RoutePiece[] = [];
  for (let index = 0; index < 36; index += 1) {
    const object = createSupplyPiece(kinds[index % kinds.length], index);
    const y = -0.82 + ((index * 29) % 18) / 10;
    const angle = index * 2.399963;
    const radial = Math.sqrt(Math.max(0.05, 1 - Math.min(0.95, y * y)));
    const direction = new Vector3(Math.cos(angle) * radial, y, Math.sin(angle) * radial).normalize();
    const offset = 0.34 + (index % 5) * 0.085;
    object.scale.multiplyScalar(0.78 + (index % 4) * 0.08);
    object.visible = false;
    object.userData.permanentBallPart = true;
    object.userData.routePiece = true;
    object.userData.raildIgnoreOcclusion = true;
    ball.add(object);
    pieces.push({ object, direction, offset });
  }
  return pieces;
}

export function createWorkshopEnvironment(
  scene: Scene,
  rail: CatmullRomCurve3,
): WorkshopEnvironment {
  const previousBackground = scene.background;
  const previousFog = scene.fog;
  const root = new Group();
  root.name = 'Tinker Ball worktable';
  root.userData.raildIgnoreOcclusion = true;
  scene.background = new Color(0x21121b);
  scene.fog = new Fog(0x3a1d23, 52, 135);

  createTabletop(root);
  createScratchRoads(root, rail);
  createSmallClutter(root);
  createMediumClutter(root);
  createLargeProps(root);
  createLamp(root);

  const hemisphere = new HemisphereLight(0xffdca6, 0x3d1f2c, 1.35);
  const ambient = new AmbientLight(0xffc98f, 0.28);
  const key = new DirectionalLight(0xffd29a, 2.15);
  key.position.set(50, 65, 25);
  key.target.position.set(0, 0, -250);
  const lampLight = new PointLight(0xffa449, 55, 170, 1.45);
  lampLight.position.set(79, 35, -248);
  root.add(hemisphere, ambient, key, key.target, lampLight);

  const spill = createSpill(root, rail);
  const ball = createBall(root);
  const routePieces = createRoutePieces(ball);
  scene.add(root);

  let spillDefeated = false;
  let spillFade = 0;

  const reset = () => {
    spillDefeated = false;
    spillFade = 0;
    spill.visible = true;
    spill.scale.setScalar(1);
    const materials = spill.userData.materials as Array<MeshStandardMaterial | MeshBasicMaterial>;
    for (const material of materials) material.opacity = material instanceof MeshBasicMaterial ? 0.46 : 0.96;
    for (const child of [...ball.children]) {
      if (child.userData.collectedPiece === true) ball.remove(child);
    }
    for (const piece of routePieces) piece.object.visible = false;
  };

  return {
    root,
    ball,
    reset,
    defeatSpill() {
      spillDefeated = true;
    },
    update(dt, elapsed, camera, runProgress, beatEnergy) {
      const radius = 0.7 + runProgress * 1.55 + Math.min(0.26, Number(ball.userData.collectedCount ?? 0) * 0.0024);
      ball.userData.radius = radius;
      const body = ball.userData.body as Mesh;
      const equator = ball.userData.equator as Mesh;
      body.scale.setScalar(radius);
      equator.scale.setScalar(radius);
      const visibleRoutePieces = Math.floor(runProgress * routePieces.length);
      for (let index = 0; index < routePieces.length; index += 1) {
        const piece = routePieces[index];
        piece.object.visible = index < visibleRoutePieces;
        if (piece.object.visible) {
          piece.object.position.copy(piece.direction).multiplyScalar(radius + piece.offset);
        }
      }
      const cameraOffset = new Vector3(
        -1.05 + Math.sin(elapsed * 1.7) * (0.24 + runProgress * 0.38),
        -2.55 - radius * 0.18 + Math.abs(Math.sin(elapsed * 5.2)) * 0.12,
        -7.9 - radius * 0.66,
      ).applyQuaternion(camera.quaternion);
      ball.position.copy(camera.position).add(cameraOffset);
      ball.rotation.x += dt * (4.2 - runProgress * 1.4);
      ball.rotation.z += dt * (1.15 + Math.sin(elapsed * 0.7) * 0.35);
      const bodyMaterial = body.material as MeshStandardMaterial;
      bodyMaterial.emissiveIntensity = 0.08 + beatEnergy * 0.055;
      lampLight.intensity = 52 + beatEnergy * 16;

      if (spillDefeated) {
        spillFade = Math.min(1, spillFade + dt * 0.42);
        spill.scale.setScalar(1 + spillFade * 0.2);
        const materials = spill.userData.materials as Array<MeshStandardMaterial | MeshBasicMaterial>;
        for (const material of materials) {
          const base = material instanceof MeshBasicMaterial ? 0.46 : 0.96;
          material.opacity = base * (1 - spillFade);
        }
        if (spillFade >= 1) spill.visible = false;
      }
    },
    dispose() {
      scene.remove(root);
      disposeObject3D(root);
      scene.background = previousBackground;
      scene.fog = previousFog;
    },
  };
}
