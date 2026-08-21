import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  NAVE_WINDOWS,
  ROSE_WINDOW,
  TOTAL_WINDOWS,
  WALL_X,
  WINDOW_CENTER_Y,
  naveWindowPair,
  naveWindowSide,
  naveWindowZ,
} from '../layout';
import { createVespersRail } from '../gameplay';
import { STONE, jewelForWindow } from './palette';

// The stained glass. Every window is born dead — stripped by the things that
// live here — and relights where its thief falls, staying lit for the rest of
// the run. The rose window at the west end is index ROSE_WINDOW and only ever
// lights when the Devourer breaks.

type WindowState = {
  group: Group;
  glassMaterial: MeshBasicMaterial;
  haloMaterial: MeshBasicMaterial;
  jewel: ReturnType<typeof jewelForWindow>;
  lit: number;
  target: number;
  flash: number;
};

type RoseState = {
  group: Group;
  paneMaterials: MeshBasicMaterial[];
  traceryMaterial: LineBasicMaterial;
  haloMaterial: MeshBasicMaterial;
  ignite: number;
  flash: number;
  ignited: boolean;
};

export type WindowField = {
  readonly group: Group;
  windowPosition(index: number): Vector3;
  relight(index: number): Vector3 | undefined;
  igniteAll(): Vector3;
  litCount(): number;
  reset(): void;
  update(dt: number): void;
};

const GLASS_HALF_W = 1.55;
const GLASS_TOP = 1.15;
const GLASS_APEX = 2.9;
const GLASS_BOTTOM = -2.2;

function glassShape(): Shape {
  const shape = new Shape();
  shape.moveTo(-GLASS_HALF_W, GLASS_BOTTOM);
  shape.lineTo(-GLASS_HALF_W, GLASS_TOP);
  shape.lineTo(0, GLASS_APEX);
  shape.lineTo(GLASS_HALF_W, GLASS_TOP);
  shape.lineTo(GLASS_HALF_W, GLASS_BOTTOM);
  shape.closePath();
  return shape;
}

function traceryGeometry(): BufferGeometry {
  const positions: number[] = [];
  const seg = (a: [number, number], b: [number, number]) => {
    positions.push(a[0], a[1], 0.02, b[0], b[1], 0.02);
  };
  seg([0, GLASS_BOTTOM], [0, 1.6]); // center mullion
  seg([-GLASS_HALF_W, 0.2], [GLASS_HALF_W, 0.2]); // lower transom
  seg([-GLASS_HALF_W * 0.72, 1.55], [GLASS_HALF_W * 0.72, 1.55]); // upper transom
  // Small rose at the head of the light.
  for (let i = 0; i < 8; i += 1) {
    const a0 = (i / 8) * Math.PI * 2;
    const a1 = ((i + 1) / 8) * Math.PI * 2;
    seg([Math.cos(a0) * 0.34, 2.1 + Math.sin(a0) * 0.34], [Math.cos(a1) * 0.34, 2.1 + Math.sin(a1) * 0.34]);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

export function createWindowField(): WindowField {
  const group = new Group();
  const curve = createVespersRail();
  const windows: WindowState[] = [];
  const shape = glassShape();
  const glassGeometry = new ShapeGeometry(shape);
  const tracery = traceryGeometry();
  const outline = new BufferGeometry().setFromPoints(
    shape.getPoints(24).map((point) => new Vector3(point.x, point.y, 0.01)),
  );

  for (let index = 0; index < NAVE_WINDOWS; index += 1) {
    const side = naveWindowSide(index);
    const z = naveWindowZ(naveWindowPair(index));
    const jewel = jewelForWindow(index);

    const windowGroup = new Group();
    windowGroup.position.set(side * WALL_X, WINDOW_CENTER_Y, z);
    windowGroup.rotation.y = side === -1 ? Math.PI / 2 : -Math.PI / 2;

    // Dead glass: the jewel color barely there, like leaded glass at night.
    const glassMaterial = new MeshBasicMaterial({ color: jewel.clone().multiplyScalar(0.05), side: DoubleSide });
    const glass = new Mesh(glassGeometry, glassMaterial);
    windowGroup.add(glass);

    // Lead tracery silhouettes against lit glass.
    const traceryLines = new LineSegments(tracery, new LineBasicMaterial({
      color: 0x05050a,
      transparent: true,
      opacity: 0.85,
    }));
    windowGroup.add(traceryLines);

    // Stone frame: the shape's outline, readable even when dead.
    const frame = new LineSegments(outline, new LineBasicMaterial(
      additiveMaterialParameters({ color: STONE.clone().multiplyScalar(0.5) }),
    ));
    windowGroup.add(frame);

    // Halo: the color the lit glass throws onto the stone around it.
    const haloMaterial = createAdditiveBasicMaterial({
      color: jewel.clone().multiplyScalar(0.3),
      opacity: 0,
      side: DoubleSide,
    });
    const halo = new Mesh(new PlaneGeometry(1, 1), haloMaterial);
    halo.scale.set(4.6, 6.8, 1);
    halo.position.z = -0.05;
    windowGroup.add(halo);

    group.add(windowGroup);
    windows.push({ group: windowGroup, glassMaterial, haloMaterial, jewel, lit: 0, target: 0, flash: 0 });
  }

  // The dead rose window at the west end.
  const rose = createRose(curve);
  group.add(rose.group);

  let roseState = rose;

  const field: WindowField = {
    group,
    windowPosition(index: number) {
      if (index === ROSE_WINDOW) return roseState.group.position.clone();
      return windows[index]?.group.position.clone() ?? new Vector3();
    },
    relight(index: number) {
      const state = windows[index];
      if (!state || state.target === 1) return undefined;
      state.target = 1;
      state.flash = 1;
      return state.group.position.clone();
    },
    igniteAll() {
      roseState.ignited = true;
      roseState.flash = 1;
      // The heart held every colour: whatever is still dark comes up with it.
      for (const state of windows) {
        state.target = 1;
        state.flash = Math.max(state.flash, 0.7);
      }
      return roseState.group.position.clone();
    },
    litCount() {
      return windows.filter((state) => state.target === 1).length;
    },
    reset() {
      for (const state of windows) {
        state.target = 0;
        state.flash = 0;
      }
      roseState.ignited = false;
      roseState.flash = 0;
      roseState.ignite = 0;
    },
    update(dt: number) {
      for (const state of windows) {
        state.lit += (state.target - state.lit) * Math.min(1, dt * 2.4);
        state.flash = Math.max(0, state.flash - dt * 1.4);
        const energy = state.lit * (1.05 + state.flash * 1.5);
        state.glassMaterial.color.copy(state.jewel).multiplyScalar(0.07 + energy);
        state.haloMaterial.opacity = Math.min(0.55, state.lit * (0.16 + state.flash * 0.35));
        state.haloMaterial.color.copy(state.jewel).multiplyScalar(0.32 + state.flash * 0.5);
      }
      const rose = roseState;
      rose.flash = Math.max(0, rose.flash - dt * 0.55);
      rose.ignite += ((rose.ignited ? 1 : 0) - rose.ignite) * Math.min(1, dt * 1.8);
      const energy = rose.ignite * (1.3 + rose.flash * 2.2);
      rose.paneMaterials.forEach((material, index) => {
        const jewel = jewelForWindow(index);
        material.color.copy(jewel).multiplyScalar(0.035 + energy);
      });
      rose.traceryMaterial.color.setScalar(0.06 + rose.ignite * (0.5 + rose.flash * 0.8));
      rose.haloMaterial.opacity = rose.ignite * (0.3 + rose.flash * 0.4);
    },
  };

  return field;
}

function createRose(curve: ReturnType<typeof createVespersRail>): RoseState {
  const group = new Group();
  const end = curve.getPointAt(1);
  const tangent = curve.getTangentAt(1).normalize();
  group.position.copy(end).addScaledVector(tangent, 30);
  group.position.y += 3.5;
  // Face back down the nave toward the player.
  group.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), tangent.clone().negate());

  const RADIUS = 9.2;
  const panes: Mesh[] = [];
  const paneMaterials: MeshBasicMaterial[] = [];
  const PETALS = 12;

  // Twelve annulus-sector panes between the inner rosette and the rim.
  for (let index = 0; index < PETALS; index += 1) {
    const a0 = (index / PETALS) * Math.PI * 2;
    const a1 = ((index + 1) / PETALS) * Math.PI * 2;
    const shape = new Shape();
    shape.moveTo(Math.cos(a0) * 2.4, Math.sin(a0) * 2.4);
    shape.absarc(0, 0, RADIUS * 0.86, a0, a1, false);
    shape.lineTo(Math.cos(a1) * 2.4, Math.sin(a1) * 2.4);
    shape.absarc(0, 0, 2.4, a1, a0, true);
    const material = new MeshBasicMaterial({ color: 0x020207, side: DoubleSide });
    panes.push(new Mesh(new ShapeGeometry(shape), material));
    paneMaterials.push(material);
    group.add(panes[panes.length - 1]);
  }

  // Center rosette: a dark eye with a ring of small circles.
  const centerMaterial = new MeshBasicMaterial({ color: 0x030309, side: DoubleSide });
  const center = new Mesh(new RingGeometry(0, 2.4, 24), centerMaterial);
  group.add(center);
  paneMaterials.push(centerMaterial);

  // Stone tracery over everything: spokes and rims.
  const traceryPositions: number[] = [];
  const pushSeg = (a: Vector3, b: Vector3) => {
    traceryPositions.push(a.x, a.y, 0.04, b.x, b.y, 0.04);
  };
  for (let index = 0; index < PETALS; index += 1) {
    const angle = (index / PETALS) * Math.PI * 2;
    pushSeg(
      new Vector3(Math.cos(angle) * 2.3, Math.sin(angle) * 2.3, 0),
      new Vector3(Math.cos(angle) * RADIUS * 0.88, Math.sin(angle) * RADIUS * 0.88, 0),
    );
    const a0 = angle;
    const a1 = ((index + 1) / PETALS) * Math.PI * 2;
    for (let s = 0; s < 4; s += 1) {
      const t0 = a0 + ((a1 - a0) * s) / 4;
      const t1 = a0 + ((a1 - a0) * (s + 1)) / 4;
      pushSeg(
        new Vector3(Math.cos(t0) * RADIUS * 0.88, Math.sin(t0) * RADIUS * 0.88, 0),
        new Vector3(Math.cos(t1) * RADIUS * 0.88, Math.sin(t1) * RADIUS * 0.88, 0),
      );
      pushSeg(
        new Vector3(Math.cos(t0) * 2.35, Math.sin(t0) * 2.35, 0),
        new Vector3(Math.cos(t1) * 2.35, Math.sin(t1) * 2.35, 0),
      );
    }
  }
  const traceryGeometry = new BufferGeometry();
  traceryGeometry.setAttribute('position', new Float32BufferAttribute(traceryPositions, 3));
  const traceryMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: 0x101018 }));
  group.add(new LineSegments(traceryGeometry, traceryMaterial));

  // Outer stone rim, always faintly readable.
  const rim = new LineSegments(
    new RingGeometry(RADIUS * 0.985, RADIUS, 64).toNonIndexed(),
    new LineBasicMaterial(additiveMaterialParameters({ color: STONE.clone().multiplyScalar(0.55) })),
  );
  group.add(rim);

  const haloMaterial = createAdditiveBasicMaterial({
    color: 0xffffff,
    opacity: 0,
    side: DoubleSide,
  });
  const halo = new Mesh(new PlaneGeometry(2, 2), haloMaterial);
  halo.scale.setScalar(RADIUS * 0.78);
  halo.position.z = -0.1;
  group.add(halo);

  return {
    group,
    paneMaterials,
    traceryMaterial,
    haloMaterial,
    ignite: 0,
    flash: 0,
    ignited: false,
  };
}

export const WINDOW_TOTAL = TOTAL_WINDOWS;
