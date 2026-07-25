import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  Shape,
  ShapeGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { createVespersR7axRail } from '../gameplay';
import {
  CANDLE,
  CORE_WHITE,
  JEWELS,
  LEAD,
  NIGHT,
  STONE,
  STONE_EDGE,
  VOID,
  hdr,
  jewelAt,
  mulberry32,
} from './palette';

const BAY_COUNT = 22;
const BAY_SPACING = 32;
const NAVE_HALF_WIDTH = 21;
const FLOOR_Y = -14;
const VAULT_Y = 34;

type WindowRecord = {
  pane: MeshBasicMaterial;
  glow: MeshBasicMaterial;
  color: Color;
  energy: number;
  target: number;
};

type RosePane = {
  material: MeshBasicMaterial;
  color: Color;
  energy: number;
  target: number;
};

export type VespersEnvironment = ReturnType<typeof createEnvironmentInternal>;

export function createEnvironmentInternal(scene: Scene) {
  scene.background = VOID.clone();
  scene.fog = new FogExp2(VOID.clone(), 0.0087);
  const root = new Group();
  root.name = 'vespers-cathedral';
  const windows: WindowRecord[] = [];
  const rosePanes: RosePane[] = [];
  const rng = mulberry32(0x7e5e2);

  const stoneMaterial = new MeshBasicMaterial({ color: STONE.clone() });
  const nearStoneMaterial = new MeshBasicMaterial({ color: STONE_EDGE.clone().multiplyScalar(0.42) });
  const leadMaterial = new MeshBasicMaterial({ color: LEAD.clone(), side: DoubleSide });

  root.add(createFloor(stoneMaterial));
  root.add(createNave(stoneMaterial, nearStoneMaterial, leadMaterial, windows));
  const candles = createCandles(rng);
  const dust = createDust(rng);
  root.add(candles, dust);

  const rosePosition = createVespersR7axRail()
    .getPointAt(1)
    .add(new Vector3(0, 2.2, -31));
  // The rail tangent is effectively -Z at the end; the boss uses +31 units
  // along that tangent, hence -31 in this straight architectural frame.
  const westEnd = createWestEnd(rosePosition, stoneMaterial, leadMaterial, rosePanes);
  root.add(westEnd);
  scene.add(root);

  let beatEnergy = 0;
  let quiet = 0;
  let illumination = 0;
  let restoredCount = 0;

  function reset() {
    beatEnergy = 0;
    illumination = 0;
    restoredCount = 0;
    windows.forEach((window, index) => {
      window.color.copy(jewelAt(index));
      window.target = index < 4 ? 0.78 : 0.012;
      window.energy = window.target;
      applyWindow(window, 0);
    });
    rosePanes.forEach((pane) => {
      pane.target = 0.008;
      pane.energy = pane.target;
      pane.material.color.copy(hdr(pane.color, pane.energy));
    });
    stoneMaterial.color.copy(STONE);
    nearStoneMaterial.color.copy(STONE_EDGE).multiplyScalar(0.42);
    (candles.material as PointsMaterial).opacity = 0.74;
    (dust.material as PointsMaterial).opacity = 0.42;
  }

  function steal(index: number) {
    const window = windows[(index + 12) % windows.length];
    if (!window) return;
    window.target = 0.006;
  }

  function restore(index: number, color: Color) {
    const window = windows[(index + 12) % windows.length];
    if (!window) return;
    window.color.copy(color);
    window.target = 1.18;
    restoredCount += 1;
  }

  function chargeRose(slot: number, color: Color) {
    const pane = rosePanes[slot % rosePanes.length];
    if (!pane) return;
    pane.color.copy(color);
    pane.target = 0.18;
  }

  function igniteRose() {
    illumination = 1;
    windows.forEach((window, index) => {
      if (window.target < 0.4) window.color.copy(jewelAt(index));
      window.target = 1.24;
    });
    rosePanes.forEach((pane, index) => {
      pane.color.copy(jewelAt(index));
      pane.target = 1.02;
    });
  }

  function update(dt: number, runProgress: number, nextBeatEnergy: number) {
    beatEnergy = Math.max(nextBeatEnergy, beatEnergy - dt * 2.8);
    const runTime = runProgress * 60;
    const quietTarget = runTime >= 34.5 && runTime < 45 ? 1 : 0;
    quiet += (quietTarget - quiet) * Math.min(1, dt * 1.6);
    const windowPulse = 1 + beatEnergy * 0.055;
    for (const window of windows) {
      window.energy += (window.target - window.energy) * Math.min(1, dt * (window.target > window.energy ? 2.8 : 5.5));
      applyWindow(window, windowPulse - 1);
    }
    for (const pane of rosePanes) {
      pane.energy += (pane.target - pane.energy) * Math.min(1, dt * (illumination ? 3.8 : 1.8));
      pane.material.color.copy(hdr(pane.color, pane.energy * windowPulse));
    }

    const candleOpacity = 0.72 * (1 - quiet * 0.78) + illumination * 0.24;
    (candles.material as PointsMaterial).opacity = candleOpacity * (1 + beatEnergy * 0.08);
    (dust.material as PointsMaterial).opacity = 0.38 * (1 - quiet * 0.72) + illumination * 0.16;
    stoneMaterial.color.copy(STONE).lerp(new Color(0x171726), illumination * 0.74);
    nearStoneMaterial.color.copy(STONE_EDGE).multiplyScalar(0.42 + illumination * 0.28);
  }

  function applyWindow(window: WindowRecord, pulse: number) {
    const energy = window.energy * (1 + pulse);
    window.pane.color.copy(hdr(window.color, energy));
    window.glow.color.copy(hdr(window.color, energy * 0.42));
    window.glow.opacity = Math.min(0.66, energy * 0.45);
  }

  function dispose() {
    root.removeFromParent();
    scene.fog = null;
  }

  reset();
  return {
    root,
    rosePosition,
    reset,
    steal,
    restore,
    chargeRose,
    igniteRose,
    update,
    dispose,
    get restoredCount() {
      return restoredCount;
    },
  };
}

function createFloor(material: MeshBasicMaterial) {
  const group = new Group();
  const floor = new Mesh(new PlaneGeometry(NAVE_HALF_WIDTH * 2, BAY_COUNT * BAY_SPACING + 50), material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FLOOR_Y, -(BAY_COUNT * BAY_SPACING) / 2 + 12);
  group.add(floor);

  // Long brass-inlaid processional lines turn forward motion into readable
  // parallax and lead the eye to the dead rose.
  const lineMaterial = new MeshBasicMaterial({ color: hdr(CANDLE, 0.13) });
  const lineGeometry = new PlaneGeometry(0.055, BAY_COUNT * BAY_SPACING + 30);
  for (const x of [-10, -5, 0, 5, 10]) {
    const line = new Mesh(lineGeometry, lineMaterial);
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, FLOOR_Y + 0.025, -(BAY_COUNT * BAY_SPACING) / 2 + 8);
    group.add(line);
  }
  return group;
}

function createNave(
  stoneMaterial: MeshBasicMaterial,
  edgeMaterial: MeshBasicMaterial,
  leadMaterial: MeshBasicMaterial,
  windows: WindowRecord[],
) {
  const group = new Group();
  const pierGeometry = new BoxGeometry(2.7, 39, 2.7);
  const innerPierGeometry = new BoxGeometry(1.25, 22, 1.5);
  const galleryRailGeometry = new BoxGeometry(1.15, 1.2, BAY_SPACING);
  const ribGeometry = new CylinderGeometry(0.22, 0.3, 1, 7);
  const archGeometry = new CylinderGeometry(0.45, 0.62, 1, 7);
  const arcadeGeometry = new TorusGeometry(4.2, 0.34, 7, 24, Math.PI);
  const windowGeometry = new ShapeGeometry(pointedShape(5.6, 10.5));
  const mullionVertical = new BoxGeometry(0.26, 8.1, 0.16);
  const mullionHorizontal = new BoxGeometry(4.7, 0.24, 0.16);
  const mullionOculus = new RingGeometry(0.72, 0.91, 18);
  const stoneParts: BufferGeometry[] = [];
  const edgeParts: BufferGeometry[] = [];
  const leadParts: BufferGeometry[] = [];

  for (let bay = 0; bay < BAY_COUNT; bay += 1) {
    const z = 6 - bay * BAY_SPACING;

    for (const side of [-1, 1]) {
      stoneParts.push(transformGeometry(
        pierGeometry,
        new Matrix4().makeTranslation(side * NAVE_HALF_WIDTH, 5.5, z),
      ));
      edgeParts.push(transformGeometry(
        innerPierGeometry,
        new Matrix4().makeTranslation(side * 15.5, -2.5, z),
      ));

      for (const level of [9.8, 20.5]) {
        edgeParts.push(transformGeometry(
          galleryRailGeometry,
          new Matrix4().makeTranslation(side * 20.7, level, z - BAY_SPACING / 2),
        ));
      }

      createSideWindow(
        group,
        windows,
        leadParts,
        side,
        z - BAY_SPACING * 0.32,
        5.5,
        jewelAt(bay * 4 + (side > 0 ? 1 : 0)),
        windowGeometry,
        mullionVertical,
        mullionHorizontal,
        mullionOculus,
      );
      createSideWindow(
        group,
        windows,
        leadParts,
        side,
        z - BAY_SPACING * 0.68,
        19,
        jewelAt(bay * 4 + (side > 0 ? 3 : 2)),
        windowGeometry,
        mullionVertical,
        mullionHorizontal,
        mullionOculus,
      );
    }

    // Great pointed transverse arch.
    const archPoints = [
      new Vector3(-NAVE_HALF_WIDTH, 11, z),
      new Vector3(-10.5, 26, z),
      new Vector3(0, VAULT_Y, z),
      new Vector3(10.5, 26, z),
      new Vector3(NAVE_HALF_WIDTH, 11, z),
    ];
    for (let index = 0; index < archPoints.length - 1; index += 1) {
      edgeParts.push(transformGeometry(
        archGeometry,
        cylinderMatrix(archPoints[index], archPoints[index + 1]),
      ));
    }

    // Diagonal rib vault: two sets cross half a bay ahead, closing a dark
    // stone canopy above the flight path.
    const crossingZ = z - BAY_SPACING / 2;
    for (const side of [-1, 1]) {
      edgeParts.push(transformGeometry(
        ribGeometry,
        cylinderMatrix(
          new Vector3(side * NAVE_HALF_WIDTH, 19, z),
          new Vector3(0, VAULT_Y, crossingZ),
        ),
      ));
      edgeParts.push(transformGeometry(
        ribGeometry,
        cylinderMatrix(
          new Vector3(side * NAVE_HALF_WIDTH, 19, z - BAY_SPACING),
          new Vector3(0, VAULT_Y, crossingZ),
        ),
      ));
    }

    // Tiered arcade and triforium teeth give the walls a dense readable
    // rhythm even when every pane in a bay is dark.
    for (const side of [-1, 1]) {
      for (const y of [-5, 7, 17]) {
        const rotation = new Matrix4()
          .makeRotationY(side * Math.PI / 2)
          .multiply(new Matrix4().makeRotationZ(Math.PI / 2));
        rotation.setPosition(side * 20.2, y, z - BAY_SPACING / 2);
        edgeParts.push(transformGeometry(arcadeGeometry, rotation));
      }
    }
  }

  addMerged(group, stoneParts, stoneMaterial);
  addMerged(group, edgeParts, edgeMaterial);
  addMerged(group, leadParts, leadMaterial);
  return group;
}

function pointedShape(width: number, height: number) {
  const shape = new Shape();
  shape.moveTo(-width / 2, -height / 2);
  shape.lineTo(width / 2, -height / 2);
  shape.lineTo(width / 2, height * 0.18);
  shape.quadraticCurveTo(width * 0.45, height * 0.38, 0, height / 2);
  shape.quadraticCurveTo(-width * 0.45, height * 0.38, -width / 2, height * 0.18);
  shape.closePath();
  return shape;
}

function createSideWindow(
  parent: Group,
  windows: WindowRecord[],
  leadParts: BufferGeometry[],
  side: number,
  z: number,
  y: number,
  color: Color,
  geometry: ShapeGeometry,
  mullionVertical: BoxGeometry,
  mullionHorizontal: BoxGeometry,
  mullionOculus: RingGeometry,
) {
  const frame = new Group();
  const paneMaterial = new MeshBasicMaterial({
    color: hdr(color, 0.01),
    side: DoubleSide,
  });
  const pane = new Mesh(geometry, paneMaterial);
  frame.add(pane);

  const glowMaterial = createAdditiveBasicMaterial({
    color: hdr(color, 0.004),
    opacity: 0.01,
    side: DoubleSide,
  });
  const glow = new Mesh(geometry, glowMaterial);
  glow.scale.set(1.18, 1.12, 1);
  glow.position.z = -0.1;
  frame.add(glow);

  // Lead tracery: a cross and a small oculus. Their near-black shapes remain
  // crisp when bloom is disabled.
  frame.position.set(side * 23.1, y, z);
  frame.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  frame.updateMatrix();
  const frameMatrix = frame.matrix.clone();
  leadParts.push(transformGeometry(
    mullionVertical,
    frameMatrix.clone().multiply(new Matrix4().makeTranslation(0, 0, 0.06)),
  ));
  leadParts.push(transformGeometry(
    mullionHorizontal,
    frameMatrix.clone().multiply(new Matrix4().makeTranslation(0, -0.5, 0.06)),
  ));
  leadParts.push(transformGeometry(
    mullionOculus,
    frameMatrix.clone().multiply(new Matrix4().makeTranslation(0, 2.4, 0.07)),
  ));
  frame.userData.raildIgnoreOcclusion = true;
  parent.add(frame);
  windows.push({
    pane: paneMaterial,
    glow: glowMaterial,
    color: color.clone(),
    energy: 0.01,
    target: 0.01,
  });
}

function createCandles(rng: () => number) {
  const count = 720;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const aisle = Math.floor(rng() * 7) - 3;
    positions[index * 3] = aisle * 4.4 + (rng() - 0.5) * 2.2;
    positions[index * 3 + 1] = FLOOR_Y + 0.16 + rng() * 0.2;
    positions[index * 3 + 2] = 12 - rng() * (BAY_COUNT * BAY_SPACING + 20);
    const intensity = 0.55 + rng() * 0.8;
    colors[index * 3] = CANDLE.r * intensity;
    colors[index * 3 + 1] = CANDLE.g * intensity;
    colors[index * 3 + 2] = CANDLE.b * intensity;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const points = new Points(
    geometry,
    new PointsMaterial({
      size: 0.24,
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.74,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  points.userData.raildIgnoreOcclusion = true;
  return points;
}

function createDust(rng: () => number) {
  const count = 560;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (rng() - 0.5) * 45;
    positions[index * 3 + 1] = FLOOR_Y + rng() * (VAULT_Y - FLOOR_Y);
    positions[index * 3 + 2] = 18 - rng() * (BAY_COUNT * BAY_SPACING + 45);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const points = new Points(
    geometry,
    new PointsMaterial({
      color: hdr(CORE_WHITE, 0.16),
      size: 0.12,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  points.userData.raildIgnoreOcclusion = true;
  return points;
}

function createWestEnd(
  position: Vector3,
  stoneMaterial: MeshBasicMaterial,
  leadMaterial: MeshBasicMaterial,
  rosePanes: RosePane[],
) {
  const group = new Group();
  group.position.copy(position);

  const wall = new Mesh(new PlaneGeometry(58, 64), stoneMaterial);
  wall.position.set(0, 8, -1.8);
  group.add(wall);

  const outer = new Mesh(new TorusGeometry(14.5, 1.15, 10, 64), leadMaterial);
  group.add(outer);
  const middle = new Mesh(new TorusGeometry(8.3, 0.52, 8, 52), leadMaterial);
  group.add(middle);
  const hub = new Mesh(new RingGeometry(2.1, 2.65, 28), leadMaterial);
  group.add(hub);

  const petalShape = new Shape();
  petalShape.moveTo(-1.55, 2.1);
  petalShape.quadraticCurveTo(-2.2, 6.7, 0, 11.9);
  petalShape.quadraticCurveTo(2.2, 6.7, 1.55, 2.1);
  petalShape.closePath();
  const petalGeometry = new ShapeGeometry(petalShape);
  const spokeGeometry = new BoxGeometry(0.34, 12.8, 0.24);
  for (let index = 0; index < 12; index += 1) {
    const color = jewelAt(index);
    const material = new MeshBasicMaterial({
      color: hdr(color, 0.008),
      side: DoubleSide,
    });
    const pane = new Mesh(petalGeometry, material);
    pane.rotation.z = (index / 12) * Math.PI * 2;
    pane.position.z = 0.04;
    group.add(pane);
    rosePanes.push({ material, color, energy: 0.008, target: 0.008 });

    const spoke = new Mesh(spokeGeometry, leadMaterial);
    spoke.position.y = 6.4;
    spoke.position.z = 0.12;
    spoke.rotation.z = (index / 12) * Math.PI * 2;
    group.add(spoke);
  }

  const centerColors = [JEWELS[0], JEWELS[1], JEWELS[2], JEWELS[3]];
  centerColors.forEach((color, index) => {
    const material = new MeshBasicMaterial({ color: hdr(color, 0.008), side: DoubleSide });
    const pane = new Mesh(new RingGeometry(0.4 + index * 0.42, 0.74 + index * 0.42, 24), material);
    pane.position.z = 0.08;
    group.add(pane);
    rosePanes.push({ material, color: color.clone(), energy: 0.008, target: 0.008 });
  });

  const tracery = new LineSegments(
    new BufferGeometry().setFromPoints([
      new Vector3(-18, -14, 0.2), new Vector3(0, 18, 0.2),
      new Vector3(0, 18, 0.2), new Vector3(18, -14, 0.2),
      new Vector3(-18, -14, 0.2), new Vector3(18, -14, 0.2),
    ]),
    new LineBasicMaterial({ color: STONE_EDGE.clone() }),
  );
  group.add(tracery);
  return group;
}

function cylinderMatrix(start: Vector3, end: Vector3) {
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const direction = end.clone().sub(start);
  const quaternion = new Mesh().quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize());
  return new Matrix4().compose(
    midpoint,
    quaternion,
    new Vector3(1, direction.length(), 1),
  );
}

function transformGeometry(geometry: BufferGeometry, matrix: Matrix4) {
  return geometry.clone().applyMatrix4(matrix);
}

function addMerged(
  parent: Group,
  parts: BufferGeometry[],
  material: MeshBasicMaterial,
) {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('Could not merge Vespers cathedral geometry.');
  parent.add(new Mesh(merged, material));
  for (const geometry of parts) geometry.dispose();
}
