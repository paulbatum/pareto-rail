import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
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
  TubeGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { offsetFromRail, sampleRailFrame } from '../../../engine/rail';
import { disposeObject3D } from '../../../engine/visual-kit';
import { createVespersN3lyRail } from '../gameplay';
import { BLOOD, BOTTLE, CANDLE, COBALT, GLASS_COLORS, GOLD, LEAD, STONE, STONE_EDGE, VOID, hdr } from './palette';

type WindowState = {
  group: Group;
  paneMaterial: MeshBasicMaterial;
  haloMaterial: MeshBasicMaterial;
  color: Color;
  position: Vector3;
  target: number;
  brightness: number;
  flare: number;
};

export type VespersEnvironment = {
  root: Group;
  stealNearest(worldPosition: Vector3): number | undefined;
  restore(index: number): void;
  reset(): void;
  exposeRose(): void;
  igniteRose(): void;
  update(dt: number, context: { camera: Camera; elapsed: number; runTime: number; beatEnergy: number }): void;
  dispose(): void;
};

const stoneMaterial = () => new MeshBasicMaterial({ color: STONE });
const edgeMaterial = () => new MeshBasicMaterial({ color: STONE_EDGE });
const leadMaterial = () => new MeshBasicMaterial({ color: LEAD, side: DoubleSide });

function createPointedPaneGeometry(width: number, height: number) {
  const shape = new Shape();
  const half = width / 2;
  const shoulder = height * 0.3;
  shape.moveTo(-half, -height / 2);
  shape.lineTo(half, -height / 2);
  shape.lineTo(half, height / 2 - shoulder);
  shape.quadraticCurveTo(half * 0.9, height / 2 - shoulder * 0.2, 0, height / 2);
  shape.quadraticCurveTo(-half * 0.9, height / 2 - shoulder * 0.2, -half, height / 2 - shoulder);
  shape.closePath();
  return new ShapeGeometry(shape);
}

function orientToRail(group: Group, curve: CatmullRomCurve3, u: number) {
  const frame = sampleRailFrame(curve, u);
  const basis = new Matrix4().makeBasis(frame.right, frame.up, frame.tangent.clone().negate());
  group.position.copy(frame.position);
  group.quaternion.setFromRotationMatrix(basis);
}

function createLancetWindow(color: Color, side: -1 | 1) {
  const group = new Group();
  const frameGeometry = createPointedPaneGeometry(4.1, 9.4);
  const paneGeometry = createPointedPaneGeometry(3.45, 8.7);
  const frame = new Mesh(frameGeometry, leadMaterial());
  frame.name = 'lancet-frame';
  const paneMaterial = new MeshBasicMaterial({ color: hdr(color, 1.4), side: DoubleSide });
  const pane = new Mesh(paneGeometry, paneMaterial);
  pane.name = 'lancet-pane';
  pane.position.z = 0.035;

  const mullion = new Mesh(new PlaneGeometry(0.2, 7.6), leadMaterial());
  mullion.name = 'lancet-mullion';
  mullion.position.z = 0.075;
  const haloMaterial = new MeshBasicMaterial({
    color: color.clone(),
    transparent: true,
    opacity: 0.05,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const halo = new Mesh(new PlaneGeometry(8.8, 13.5), haloMaterial);
  halo.name = 'lancet-light';
  halo.position.z = -0.12 * side;
  halo.userData.raildIgnoreOcclusion = true;
  group.add(halo, frame, pane, mullion);
  return { group, paneMaterial, haloMaterial };
}

function createBlindLancet(side: -1 | 1) {
  const group = new Group();
  const frame = new Mesh(createPointedPaneGeometry(4.1, 9.4), leadMaterial());
  const voidPane = new Mesh(createPointedPaneGeometry(3.45, 8.7), new MeshBasicMaterial({ color: 0x010103, side: DoubleSide }));
  voidPane.position.z = 0.035 * side;
  const bar = new Mesh(new PlaneGeometry(3.3, 0.23), leadMaterial());
  bar.position.z = 0.07 * side;
  group.add(frame, voidPane, bar);
  return group;
}

function createRoseWindow() {
  const group = new Group();
  const panes: Array<{ material: MeshBasicMaterial; color: Color }> = [];

  const backing = new Mesh(new CircleGeometry(14.8, 64), new MeshBasicMaterial({ color: 0x010103, side: DoubleSide }));
  backing.position.z = -0.22;
  group.add(backing);

  for (let index = 0; index < 12; index += 1) {
    const color = GLASS_COLORS[index % GLASS_COLORS.length];
    const material = new MeshBasicMaterial({ color: 0x010103, side: DoubleSide });
    const petal = new Mesh(new CircleGeometry(3.25, 18), material);
    const angle = index / 12 * Math.PI * 2;
    petal.scale.set(0.52, 1.45, 1);
    petal.position.set(Math.cos(angle) * 8.1, Math.sin(angle) * 8.1, 0);
    petal.rotation.z = angle - Math.PI / 2;
    group.add(petal);
    panes.push({ material, color });
  }
  GLASS_COLORS.forEach((color, index) => {
    const material = new MeshBasicMaterial({ color: 0x010103, side: DoubleSide });
    const center = new Mesh(new RingGeometry(0.4, 3.65, 32, 1, index * Math.PI / 2 + 0.02, Math.PI / 2 - 0.04), material);
    center.position.z = 0.04;
    group.add(center);
    panes.push({ material, color });
  });

  const frameMaterial = leadMaterial();
  for (const radius of [3.8, 7.1, 11.4, 14.4]) {
    const ring = new Mesh(new TorusGeometry(radius, radius === 14.4 ? 0.6 : 0.34, 6, 72), frameMaterial);
    ring.position.z = 0.16;
    group.add(ring);
  }
  for (let index = 0; index < 12; index += 1) {
    const spoke = new Mesh(new PlaneGeometry(0.33, 22.8), frameMaterial);
    spoke.position.z = 0.18;
    spoke.rotation.z = index / 12 * Math.PI;
    group.add(spoke);
  }

  const haloMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const halo = new Mesh(new CircleGeometry(21, 64), haloMaterial);
  halo.position.z = -0.5;
  halo.userData.raildIgnoreOcclusion = true;
  group.add(halo);

  return { group, panes, haloMaterial, brightness: 0, target: 0, shock: 0 };
}

export function createVespersEnvironment(scene: Scene): VespersEnvironment {
  scene.background = VOID;
  scene.fog = new Fog(VOID, 18, 148);

  const root = new Group();
  root.name = 'vespers-cathedral';
  const rail = createVespersN3lyRail();
  const windows: WindowState[] = [];

  const floor = new Mesh(new BoxGeometry(50, 0.8, 660), new MeshBasicMaterial({ color: 0x040407 }));
  floor.name = 'candle-floor';
  floor.position.set(0, -10.8, -310);
  root.add(floor);
  const leftWall = new Mesh(new BoxGeometry(2, 31, 660), new MeshBasicMaterial({ color: 0x05060a }));
  leftWall.name = 'nave-wall-left';
  leftWall.position.set(-22, 4.2, -310);
  const rightWall = leftWall.clone();
  rightWall.name = 'nave-wall-right';
  rightWall.position.x = 22;
  root.add(leftWall, rightWall);

  const pierGeometry = new BoxGeometry(2.15, 29, 2.25);
  const archGeometry = new TorusGeometry(4.2, 0.36, 5, 24, Math.PI);
  const ribCurve = new CatmullRomCurve3([
    new Vector3(-14.4, 6.8, 0),
    new Vector3(-10.5, 14.2, 0),
    new Vector3(-4.2, 18.2, 0),
    new Vector3(0, 19.8, 0),
    new Vector3(4.2, 18.2, 0),
    new Vector3(10.5, 14.2, 0),
    new Vector3(14.4, 6.8, 0),
  ]);
  const ribGeometry = new TubeGeometry(ribCurve, 36, 0.29, 5, false);

  // Continuous gallery ledges carry the long horizontal read in four draw
  // calls; the piers, arches, and ribs provide the repeated bay rhythm.
  for (const side of [-1, 1] as const) {
    for (const y of [5.8, 11.8]) {
      const ledge = new Mesh(new BoxGeometry(1.3, 0.7, 660), edgeMaterial());
      ledge.name = `gallery-ledge-${side}-${y}`;
      ledge.position.set(side * 14.85, y, -310);
      ledge.userData.raildIgnoreOcclusion = true;
      root.add(ledge);
    }
  }

  const bayCount = 28;
  for (let index = 0; index < bayCount; index += 1) {
    const u = 0.02 + index / (bayCount - 1) * 0.94;
    const bay = new Group();
    orientToRail(bay, rail, u);

    for (const side of [-1, 1] as const) {
      const pier = new Mesh(pierGeometry, stoneMaterial());
      pier.name = `pier-${index}-${side}`;
      pier.position.set(side * 14.6, 3.6, 0);
      bay.add(pier);
      const arcade = new Mesh(archGeometry, edgeMaterial());
      arcade.name = `arcade-${index}-${side}`;
      arcade.position.set(side * 14.45, 4.4, 0);
      arcade.rotation.y = side * Math.PI / 2;
      // These are thin openwork lines. A center-ray hit does not hide the
      // broad target silhouette, so exclude that checker false positive.
      arcade.userData.raildIgnoreOcclusion = true;
      bay.add(arcade);

      const quietBay = u > 0.54 && u < 0.69;
      if (quietBay) {
        const blind = createBlindLancet(side);
        blind.position.set(side * 14.18, 7.9, 0);
        blind.rotation.y = side * Math.PI / 2;
        bay.add(blind);
      } else {
        const color = GLASS_COLORS[(index + (side === 1 ? 1 : 3)) % GLASS_COLORS.length];
        const lancet = createLancetWindow(color, side);
        lancet.group.position.set(side * 14.18, 7.9, 0);
        lancet.group.rotation.y = side * Math.PI / 2;
        bay.add(lancet.group);
        windows.push({
          ...lancet,
          color: color.clone(),
          position: new Vector3(),
          target: 1,
          brightness: 1,
          flare: 0,
        });
      }
    }

    const rib = new Mesh(ribGeometry, edgeMaterial());
    rib.name = `vault-rib-${index}`;
    rib.position.z = 0.1;
    rib.userData.raildIgnoreOcclusion = true;
    bay.add(rib);
    root.add(bay);
  }

  // Candle sea far below: warm, pale pinpricks, deliberately less saturated
  // than the stained glass. One draw call keeps the nave full without cost.
  const candleCount = 1500;
  const candlePositions = new Float32Array(candleCount * 3);
  for (let index = 0; index < candleCount; index += 1) {
    const a = Math.sin((index + 11) * 12.9898) * 43758.5453;
    const b = Math.sin((index + 71) * 78.233) * 23421.631;
    const c = Math.sin((index + 131) * 41.117) * 19531.337;
    candlePositions[index * 3] = (a - Math.floor(a) - 0.5) * 25.5;
    candlePositions[index * 3 + 1] = -9.95 + (b - Math.floor(b)) * 0.22;
    candlePositions[index * 3 + 2] = -8 - (c - Math.floor(c)) * 612;
  }
  const candleGeometry = new BufferGeometry();
  candleGeometry.setAttribute('position', new Float32BufferAttribute(candlePositions, 3));
  const candles = new Points(candleGeometry, new PointsMaterial({
    color: CANDLE,
    size: 0.2,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  }));
  candles.userData.raildIgnoreOcclusion = true;
  root.add(candles);

  // The west wall and its dead rose are authored at the rail terminus.
  const endFrame = sampleRailFrame(rail, 0.997);
  const westWall = new Mesh(new PlaneGeometry(58, 43), new MeshBasicMaterial({ color: 0x020205, side: DoubleSide }));
  const westGroup = new Group();
  westGroup.position.copy(endFrame.position).addScaledVector(endFrame.tangent, 1.3).addScaledVector(endFrame.up, 5);
  westGroup.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(endFrame.right, endFrame.up, endFrame.tangent.clone().negate()));
  westWall.position.y = 0;
  westWall.position.z = -0.8;
  westGroup.add(westWall);
  const rose = createRoseWindow();
  rose.group.position.y = 0;
  westGroup.add(rose.group);
  root.add(westGroup);

  scene.add(root);
  root.updateMatrixWorld(true);
  for (const window of windows) window.group.getWorldPosition(window.position);

  function setWindow(index: number, target: number) {
    const window = windows[index];
    if (!window) return;
    window.target = target;
    if (target > 0.5) window.flare = Math.max(window.flare, 1);
  }

  function stealNearest(worldPosition: Vector3) {
    let bestIndex = -1;
    let bestDistance = Infinity;
    for (const [index, window] of windows.entries()) {
      if (window.target < 0.5) continue;
      const distance = window.position.distanceToSquared(worldPosition);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) return undefined;
    setWindow(bestIndex, 0);
    return bestIndex;
  }

  function updateWindow(window: WindowState, dt: number, beatEnergy: number) {
    const response = 1 - Math.exp(-dt * (window.target > window.brightness ? 7.5 : 12));
    window.brightness += (window.target - window.brightness) * response;
    window.flare = Math.max(0, window.flare - dt * 1.45);
    const pulse = 1 + beatEnergy * 0.035;
    const intensity = 0.035 + window.brightness * (1.34 + window.flare * 2.1) * pulse;
    window.paneMaterial.color.copy(hdr(window.color, intensity));
    window.haloMaterial.color.copy(window.color);
    window.haloMaterial.opacity = window.brightness * (0.025 + window.flare * 0.11);
  }

  return {
    root,
    stealNearest,
    restore(index) {
      setWindow(index, 1);
    },
    reset() {
      for (const window of windows) {
        window.target = 1;
        window.brightness = 1;
        window.flare = 0;
      }
      rose.target = 0;
      rose.brightness = 0;
      rose.shock = 0;
    },
    exposeRose() {
      rose.shock = Math.max(rose.shock, 0.32);
    },
    igniteRose() {
      rose.target = 1;
      rose.shock = 1;
      for (const window of windows) {
        window.target = 1;
        window.flare = 1;
      }
    },
    update(dt, context) {
      for (const window of windows) updateWindow(window, dt, context.beatEnergy);
      const roseResponse = 1 - Math.exp(-dt * (rose.target > rose.brightness ? 4.2 : 8));
      rose.brightness += (rose.target - rose.brightness) * roseResponse;
      rose.shock = Math.max(0, rose.shock - dt * 0.55);
      for (const { material, color } of rose.panes) {
        material.color.copy(hdr(color, 0.018 + rose.brightness * (1.75 + rose.shock * 3.2)));
      }
      rose.haloMaterial.opacity = rose.brightness * (0.06 + rose.shock * 0.24);
      rose.group.scale.setScalar(1 + rose.shock * 0.04);
      rose.group.rotation.z = Math.sin(context.elapsed * 0.08) * 0.006;
      candles.material.opacity = 0.62 + Math.sin(context.elapsed * 4.7) * 0.08 + context.beatEnergy * 0.05;
    },
    dispose() {
      root.removeFromParent();
      disposeObject3D(root);
      if (scene.fog instanceof Fog) scene.fog = null;
    },
  };
}
