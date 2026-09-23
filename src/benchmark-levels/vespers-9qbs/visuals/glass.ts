import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  type Object3D,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { cameraPosition, float, positionWorld, smoothstep, vec3 } from 'three/tsl';
import { mulberry32 } from '../../../engine/rng';
import type { WindowSlot } from '../cathedral';

// Leaf: stained glass. Each window is a mosaic of small vertex-coloured
// panes separated by lead (gaps that show the black night behind). One
// InstancedMesh per (shape, hue); a window's brightness is its instance
// colour, a grey scalar that multiplies the mosaic, so HDR values bloom.

export type GlassPalette = {
  jewels: readonly Color[];
  accents: readonly (readonly number[])[];
  highlight: Color;
};

type Builder = { positions: number[]; colors: number[] };

function pushQuad(builder: Builder, a: [number, number], b: [number, number], c: [number, number], d: [number, number], color: Color) {
  for (const [x, y] of [a, b, c, a, c, d]) {
    builder.positions.push(x, y, 0);
    builder.colors.push(color.r, color.g, color.b);
  }
}

function pushTriangle(builder: Builder, a: [number, number], b: [number, number], c: [number, number], color: Color) {
  for (const [x, y] of [a, b, c]) {
    builder.positions.push(x, y, 0);
    builder.colors.push(color.r, color.g, color.b);
  }
}

function toGeometry(builder: Builder) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(builder.positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(builder.colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function paneColor(rng: () => number, hue: number, palette: GlassPalette, accentBias = 0) {
  const roll = rng();
  let base: Color;
  if (roll < 0.02) base = palette.highlight;
  else if (roll < 0.1 + accentBias) base = palette.jewels[palette.accents[hue][Math.floor(rng() * palette.accents[hue].length)]];
  else base = palette.jewels[hue];
  return base.clone().multiplyScalar(0.45 + rng() * 0.55);
}

function inset(point: [number, number], center: [number, number], amount: number): [number, number] {
  const dx = point[0] - center[0];
  const dy = point[1] - center[1];
  const length = Math.hypot(dx, dy) || 1;
  return [point[0] - (dx / length) * amount, point[1] - (dy / length) * amount];
}

/** A unit lancet (x ±0.5, y ±0.5) with its pointed head starting at `spring`. */
export function createLancetMosaic(hue: number, palette: GlassPalette, seed: number) {
  const rng = mulberry32(seed);
  const builder: Builder = { positions: [], colors: [] };
  const spring = 0.27;
  const columns = 4;
  const rows = 16;
  const gapX = 0.05;
  const gapY = 0.009;
  const bottom = -0.5;
  const rowHeight = (spring - bottom) / rows;
  for (let row = 0; row < rows; row += 1) {
    // Medallions: every fifth pair of rows carries the accent colours.
    const medallion = row % 5 === 2 || row % 5 === 3;
    for (let column = 0; column < columns; column += 1) {
      const x0 = -0.5 + column / columns + gapX / 2;
      const x1 = -0.5 + (column + 1) / columns - gapX / 2;
      const y0 = bottom + row * rowHeight + gapY / 2;
      const y1 = bottom + (row + 1) * rowHeight - gapY / 2;
      const color = paneColor(rng, hue, palette, medallion && (column === 1 || column === 2) ? 0.55 : 0);
      pushQuad(builder, [x0, y0], [x1, y0], [x1, y1], [x0, y1], color);
    }
  }
  // Pointed head: a fan of wedges under the two arcs.
  const apex: [number, number] = [0, 0.5];
  const headCenter: [number, number] = [0, spring + 0.08];
  const arc: Array<[number, number]> = [];
  const segments = 8;
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    // Right arc (center at left springer) from 0 to 60 degrees, then left arc.
    const angle = t * (Math.PI / 3);
    arc.push([-0.5 + Math.cos(angle), spring + Math.sin(angle) * (0.5 - spring) / Math.sin(Math.PI / 3)]);
  }
  for (let i = segments - 1; i >= 0; i -= 1) {
    const [x, y] = arc[i];
    arc.push([-x, y]);
  }
  arc.push([-0.5, spring]);
  arc[segments] = apex;
  for (let i = 0; i < arc.length - 1; i += 1) {
    const a = inset(arc[i], headCenter, 0.02);
    const b = inset(arc[i + 1], headCenter, 0.02);
    const c = inset(headCenter, arc[i], -0.0);
    const color = paneColor(rng, hue, palette, 0.25);
    pushTriangle(builder, c, a, b, i % 2 === 0 ? color : color.clone().multiplyScalar(0.8));
  }
  return toGeometry(builder);
}

/** A unit round window (radius 0.5): a centre boss and two rings of panes. */
export function createRoundMosaic(hue: number, palette: GlassPalette, seed: number) {
  const rng = mulberry32(seed);
  const builder: Builder = { positions: [], colors: [] };
  const center = palette.jewels[palette.accents[hue][0]].clone().multiplyScalar(0.9);
  const hub = 10;
  for (let i = 0; i < hub; i += 1) {
    const a0 = (i / hub) * Math.PI * 2;
    const a1 = ((i + 1) / hub) * Math.PI * 2;
    pushTriangle(builder, [0, 0], [Math.cos(a0) * 0.13, Math.sin(a0) * 0.13], [Math.cos(a1) * 0.13, Math.sin(a1) * 0.13], center);
  }
  const rings = [
    { inner: 0.155, outer: 0.31, count: 6 },
    { inner: 0.33, outer: 0.5, count: 12 },
  ];
  for (const ring of rings) {
    for (let i = 0; i < ring.count; i += 1) {
      const gap = 0.05;
      const a0 = (i / ring.count) * Math.PI * 2 + gap / (ring.outer * 8);
      const a1 = ((i + 1) / ring.count) * Math.PI * 2 - gap / (ring.outer * 8);
      const color = paneColor(rng, hue, palette, ring.count === 6 ? 0.3 : 0);
      const steps = 3;
      for (let s = 0; s < steps; s += 1) {
        const b0 = a0 + ((a1 - a0) * s) / steps;
        const b1 = a0 + ((a1 - a0) * (s + 1)) / steps;
        pushQuad(
          builder,
          [Math.cos(b0) * ring.inner, Math.sin(b0) * ring.inner],
          [Math.cos(b0) * ring.outer, Math.sin(b0) * ring.outer],
          [Math.cos(b1) * ring.outer, Math.sin(b1) * ring.outer],
          [Math.cos(b1) * ring.inner, Math.sin(b1) * ring.inner],
          color,
        );
      }
    }
  }
  return toGeometry(builder);
}

/**
 * A light shaft: two crossed ribbons, brightest along their spine and at the
 * glass, fading to nothing at the edges and the far end — soft from any angle.
 */
export function createShaftGeometry() {
  const positions: number[] = [];
  const colors: number[] = [];
  const spread = 1.35;
  const planes: Array<[number, number]> = [[1, 0], [0, 1]];
  for (const [ax, ay] of planes) {
    for (const side of [-1, 1]) {
      // From the spine (bright) out to one edge (dark), near end to far end.
      const spineNear = [0, 0, 0];
      const edgeNear = [ax * 0.5 * side, ay * 0.5 * side, 0];
      const spineFar = [0, 0, 1];
      const edgeFar = [ax * 0.5 * side * spread, ay * 0.5 * side * spread, 1];
      const quad: Array<[number[], number]> = [[spineNear, 1], [edgeNear, 0], [edgeFar, 0], [spineFar, 0]];
      for (const index of [0, 1, 2, 0, 2, 3]) {
        const [point, brightness] = quad[index];
        positions.push(point[0], point[1], point[2]);
        colors.push(brightness, brightness, brightness);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

export type GlassField = {
  readonly meshes: InstancedMesh[];
  setBrightness(index: number, value: number): void;
  setShaft(index: number, color: Color | null): void;
  commit(): void;
};

const ORIENT = new Matrix4();
const QUATERNION = new Quaternion();
const SCALE = new Vector3();
const COLOR = new Color();

function orientation(slot: WindowSlot) {
  const forward = slot.inward.clone().normalize();
  const up = new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(up, forward).normalize();
  const trueUp = new Vector3().crossVectors(forward, right).normalize();
  ORIENT.makeBasis(right, trueUp, forward);
  return QUATERNION.setFromRotationMatrix(ORIENT).clone();
}

/**
 * Builds the glass for every slot. `shaftTilt` tips each shaft downward (radians);
 * `shaftLength` is how far the light reaches into the building.
 */
export function createGlassField(parent: Object3D, slots: readonly WindowSlot[], palette: GlassPalette, shaftLength: number, shaftTilt: number): GlassField {
  const groups = new Map<string, WindowSlot[]>();
  for (const slot of slots) {
    const key = `${slot.shape}:${slot.hue}`;
    const list = groups.get(key);
    if (list) list.push(slot);
    else groups.set(key, [slot]);
  }

  const lookup: Array<{ mesh: InstancedMesh; id: number }> = [];
  const meshes: InstancedMesh[] = [];
  let seed = 7;
  for (const [key, members] of groups) {
    const [shape, hueText] = key.split(':');
    const hue = Number(hueText);
    const geometry = shape === 'round' ? createRoundMosaic(hue, palette, (seed += 31)) : createLancetMosaic(hue, palette, (seed += 31));
    const material = new MeshBasicMaterial({ vertexColors: true, side: DoubleSide });
    const mesh = new InstancedMesh(geometry, material, members.length);
    mesh.frustumCulled = false;
    members.forEach((slot, id) => {
      const matrix = new Matrix4().compose(
        slot.position.clone().addScaledVector(slot.inward, -0.35),
        orientation(slot),
        SCALE.set(slot.width, slot.height, 1),
      );
      mesh.setMatrixAt(id, matrix);
      mesh.setColorAt(id, COLOR.setScalar(0.04));
      lookup[slot.index] = { mesh, id };
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    parent.add(mesh);
    meshes.push(mesh);
  }

  // Shafts share one mesh; an unlit window's shaft has zero scale.
  const shaftMaterial = new MeshBasicNodeMaterial({
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  // Fade shafts out as the camera flies into them, so they never slab the frame.
  shaftMaterial.colorNode = vec3(smoothstep(float(4), float(22), positionWorld.distance(cameraPosition)));
  const shafts = new InstancedMesh(createShaftGeometry(), shaftMaterial, slots.length);
  shafts.frustumCulled = false;
  shafts.userData.raildIgnoreOcclusion = true;
  const shaftMatrices: Matrix4[] = [];
  const zero = new Matrix4().makeScale(0, 0, 0);
  for (const slot of slots) {
    const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), shaftTilt);
    const rotation = orientation(slot).multiply(tilt);
    const matrix = new Matrix4().compose(
      slot.position.clone().addScaledVector(slot.inward, 0.2),
      rotation,
      SCALE.set(slot.width * 0.95, slot.height * 0.8, shaftLength * (slot.tier === 'aisle' ? 0.6 : 1)),
    );
    shaftMatrices[slot.index] = matrix;
    shafts.setMatrixAt(slot.index, zero);
    shafts.setColorAt(slot.index, COLOR.setScalar(0));
  }
  shafts.instanceMatrix.needsUpdate = true;
  parent.add(shafts);
  meshes.push(shafts);

  const dirtyMeshes = new Set<InstancedMesh>();
  let shaftsDirty = false;

  return {
    meshes,
    setBrightness(index, value) {
      const entry = lookup[index];
      if (!entry) return;
      entry.mesh.setColorAt(entry.id, COLOR.setScalar(value));
      dirtyMeshes.add(entry.mesh);
    },
    setShaft(index, color) {
      if (!shaftMatrices[index]) return;
      shafts.setMatrixAt(index, color ? shaftMatrices[index] : zero);
      shafts.setColorAt(index, color ?? COLOR.setScalar(0));
      shaftsDirty = true;
    },
    commit() {
      for (const mesh of dirtyMeshes) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      dirtyMeshes.clear();
      if (shaftsDirty) {
        shafts.instanceMatrix.needsUpdate = true;
        if (shafts.instanceColor) shafts.instanceColor.needsUpdate = true;
        shaftsDirty = false;
      }
    },
  };
}
