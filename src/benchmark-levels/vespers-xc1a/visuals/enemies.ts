import {
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  TetrahedronGeometry,
  Vector2,
  Vector3,
} from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { Pane } from '../gameplay';
import { BLOOD, CANDLE, EMBER_RED, GOLD, hdr, PANE_COLORS, VOID, WHITE_HOT } from './palette';

// Everything hostile is a flat black shape with a stolen pane of glass
// burning in it. The silhouette is what you cannot see against black; the
// pane is what you can. Silhouette and motion carry identity: shades are
// lancets, moths are wings, censers hang on chains, petals are leaves off
// the rose, the eye is an iris.

export type TintKind = 'pane' | 'glow' | 'rim' | 'body';
export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; base: Color; kind: TintKind; intensity: number; follows: boolean };

const BODY_MATERIAL_COLOR = VOID.clone().multiplyScalar(1.6);

function tintable(group: Group): TintPart[] {
  return (group.userData.parts ??= []) as TintPart[];
}

export function lancetShape(width: number, height: number) {
  const arch = width * 0.866;
  const spring = height / 2 - arch;
  const shape = new Shape();
  shape.moveTo(-width / 2, -height / 2);
  shape.lineTo(width / 2, -height / 2);
  shape.lineTo(width / 2, spring);
  shape.absarc(-width / 2, spring, width, 0, Math.PI / 3, false);
  shape.absarc(width / 2, spring, width, (Math.PI * 2) / 3, Math.PI, false);
  shape.lineTo(-width / 2, -height / 2);
  return shape;
}

function petalShape(length: number, width: number, taper = 1) {
  const points: Vector2[] = [];
  const steps = 18;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    points.push(new Vector2(Math.sin(t * Math.PI) ** taper * width * 0.5, (t - 0.5) * length));
  }
  for (let i = steps - 1; i > 0; i -= 1) {
    const t = i / steps;
    points.push(new Vector2(-(Math.sin(t * Math.PI) ** taper) * width * 0.5, (t - 0.5) * length));
  }
  return new Shape(points);
}

function addBody(group: Group, geometry: BufferGeometry, z = 0) {
  const material = new MeshBasicMaterial({ color: BODY_MATERIAL_COLOR.clone(), side: DoubleSide });
  const mesh = new Mesh(geometry, material);
  mesh.position.z = z;
  group.add(mesh);
  tintable(group).push({ material, base: BODY_MATERIAL_COLOR.clone(), kind: 'body', intensity: 1, follows: false });
  return mesh;
}

// A faint rim of the pane's colour along the silhouette: light spilling
// around the edge of the shape, and the reason a shade reads at all.
function addRim(group: Group, shape: Shape, color: Color, intensity: number, z = 0.01) {
  const points = shape.getPoints(24);
  const positions: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    positions.push(a.x, a.y, z, b.x, b.y, z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(color, intensity) }));
  group.add(new LineSegments(geometry, material));
  tintable(group).push({ material, base: hdr(color, intensity), kind: 'rim', intensity, follows: true });
}

function addPane(group: Group, geometry: BufferGeometry, color: Color, intensity: number, glowScale: number, glowOpacity: number, z = 0.03) {
  const paneMaterial = new MeshBasicMaterial({ color: hdr(color, intensity), side: DoubleSide });
  const pane = new Mesh(geometry, paneMaterial);
  pane.position.z = z;
  group.add(pane);
  tintable(group).push({ material: paneMaterial, base: hdr(color, intensity), kind: 'pane', intensity, follows: true });
  const glowMaterial = createAdditiveBasicMaterial({ color: hdr(color, intensity * 0.35), opacity: glowOpacity, side: DoubleSide });
  const glow = new Mesh(geometry, glowMaterial);
  glow.scale.setScalar(glowScale);
  glow.position.z = z - 0.01;
  group.add(glow);
  tintable(group).push({ material: glowMaterial, base: hdr(color, intensity * 0.35), kind: 'glow', intensity: intensity * 0.35, follows: true });
  return pane;
}

function finish(group: Group, kind: string, accent: Color, shardDirections: Vector3[], lockRingScale: number) {
  group.userData.kind = kind;
  group.userData.accent = accent.clone();
  group.userData.shardDirections = shardDirections;
  group.userData.lockRingScale = lockRingScale;
  return group;
}

function radialDirections(count: number, spread = 1) {
  const directions: Vector3[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    directions.push(new Vector3(Math.cos(angle) * spread, Math.sin(angle), (Math.random() - 0.5) * 0.4).normalize());
  }
  return directions;
}

// ---- shade: a lancet-shaped figure ---------------------------------------------------------

export function createShadeMesh(pane: Pane = 'gold') {
  const group = new Group();
  const color = PANE_COLORS[pane];
  const body = lancetShape(1.35, 2.9);
  addBody(group, new ShapeGeometry(body));
  // Shoulders: two small black wings so it reads as a figure, not a window.
  const shoulder = new Shape([new Vector2(0, 0.2), new Vector2(0.75, -0.25), new Vector2(0.55, -0.9), new Vector2(0, -0.55)]);
  const left = addBody(group, new ShapeGeometry(shoulder), -0.005);
  left.position.x = -0.6;
  const right = addBody(group, new ShapeGeometry(shoulder), -0.005);
  right.position.x = 0.6;
  right.scale.x = -1;
  addRim(group, body, color, 0.38);
  addPane(group, new ShapeGeometry(lancetShape(0.58, 1.25)), color, 1.45, 1.55, 0.28);
  return finish(group, 'shade', color, radialDirections(9, 0.7), 1.35);
}

// ---- moth: wings that flap -------------------------------------------------------------------

export function createMothMesh(pane: Pane = 'gold') {
  const group = new Group();
  const color = PANE_COLORS[pane];
  const body = petalShape(1.3, 0.42, 1.4);
  addBody(group, new ShapeGeometry(body));
  addRim(group, body, color, 0.3);
  const wingShape = new Shape([new Vector2(0, 0.1), new Vector2(1.35, 0.6), new Vector2(1.55, 0.05), new Vector2(1.15, -0.55), new Vector2(0, -0.25)]);
  const wings: Group[] = [];
  for (const side of [-1, 1]) {
    const wing = new Group();
    const mesh = addBody(wing, new ShapeGeometry(wingShape));
    mesh.scale.x = side;
    addRim(wing, wingShape, color, 0.24);
    if (side < 0) wing.children[1].scale.x = -1;
    wing.position.x = side * 0.12;
    group.add(wing);
    wings.push(wing);
  }
  group.userData.wings = wings;
  addPane(group, new CircleGeometry(0.27, 16), color, 1.5, 1.7, 0.3);
  return finish(group, 'moth', color, radialDirections(7, 1.4), 1.15);
}

// ---- censer: a lantern on a chain --------------------------------------------------------------

export function createCenserMesh() {
  const group = new Group();
  const color = GOLD;
  const bodyGeometry = new CircleGeometry(0.9, 6);
  bodyGeometry.scale(1, 1.3, 1);
  addBody(group, bodyGeometry);
  const lid = new Shape([new Vector2(-0.55, 1.1), new Vector2(0.55, 1.1), new Vector2(0, 1.65)]);
  addBody(group, new ShapeGeometry(lid));
  const hexagon = new Shape();
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const x = Math.cos(angle) * 0.9;
    const y = Math.sin(angle) * 1.17;
    if (i === 0) hexagon.moveTo(x, y);
    else hexagon.lineTo(x, y);
  }
  hexagon.closePath();
  addRim(group, hexagon, color, 0.42);
  // Three slits of light and a hot foot.
  const slits: Mesh[] = [];
  for (const x of [-0.42, 0, 0.42]) {
    const slit = addPane(group, new PlaneGeometry(0.13, 0.95), color, 1.5, 1.9, 0.25);
    slit.position.x = x;
    for (const part of tintable(group).slice(-2)) {
      const mesh = group.children.find((child) => child instanceof Mesh && child.material === part.material) as Mesh | undefined;
      if (mesh) mesh.position.x = x;
    }
    slits.push(slit);
  }
  const foot = addPane(group, new CircleGeometry(0.24, 6), color, 1.7, 2.2, 0.3);
  foot.position.y = -1.32;
  for (const part of tintable(group).slice(-2)) {
    const mesh = group.children.find((child) => child instanceof Mesh && child.material === part.material) as Mesh | undefined;
    if (mesh) mesh.position.y = -1.32;
  }
  // The chain up to the vault.
  const chainPositions: number[] = [];
  for (const dx of [-0.07, 0.07]) chainPositions.push(dx, 1.6, 0, dx, 7.5, 0);
  for (let i = 0; i < 12; i += 1) chainPositions.push(-0.07, 1.6 + i * 0.5, 0, 0.07, 1.6 + i * 0.5 + 0.25, 0);
  const chainGeometry = new BufferGeometry();
  chainGeometry.setAttribute('position', new Float32BufferAttribute(chainPositions, 3));
  const chainMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: GOLD.clone().multiplyScalar(0.22) }));
  group.add(new LineSegments(chainGeometry, chainMaterial));
  tintable(group).push({ material: chainMaterial, base: GOLD.clone().multiplyScalar(0.22), kind: 'rim', intensity: 0.22, follows: false });
  group.userData.slits = slits;
  return finish(group, 'censer', color, radialDirections(10, 1), 1.5);
}

// ---- hostile shots ---------------------------------------------------------------------------------

// A cinder thrown from a censer: a hot coal in a dark crust.
export function createCinderMesh() {
  const group = new Group();
  const core = new Mesh(new OctahedronGeometry(0.3, 0), new MeshBasicMaterial({ color: hdr(WHITE_HOT, 2.2) }));
  group.add(core);
  tintable(group).push({ material: core.material as MeshBasicMaterial, base: hdr(WHITE_HOT, 2.2), kind: 'pane', intensity: 2.2, follows: false });
  const glowMaterial = createAdditiveBasicMaterial({ color: hdr(CANDLE, 0.8), opacity: 0.45 });
  group.add(new Mesh(new OctahedronGeometry(0.5, 1), glowMaterial));
  tintable(group).push({ material: glowMaterial, base: hdr(CANDLE, 0.8), kind: 'glow', intensity: 0.8, follows: false });
  const crust = new Group();
  for (let i = 0; i < 4; i += 1) {
    const bit = new Mesh(new TetrahedronGeometry(0.28, 0), new MeshBasicMaterial({ color: BODY_MATERIAL_COLOR.clone() }));
    const angle = (i / 4) * Math.PI * 2;
    bit.position.set(Math.cos(angle) * 0.34, Math.sin(angle) * 0.34, 0.1);
    bit.rotation.set(angle, angle * 0.7, 0);
    crust.add(bit);
  }
  group.add(crust);
  group.userData.crust = crust;
  group.userData.isHostileShot = true;
  group.userData.trailColor = CANDLE.clone().multiplyScalar(0.9);
  return finish(group, 'cinder', CANDLE, radialDirections(5, 1), 0.75);
}

// Dark glass thrown by the eye: a black sliver with a blood-red edge.
export function createShardMesh() {
  const group = new Group();
  const sliver = petalShape(1.5, 0.42, 0.8);
  addBody(group, new ShapeGeometry(sliver));
  addRim(group, sliver, BLOOD, 0.6);
  const pane = addPane(group, new PlaneGeometry(0.16, 1.0), BLOOD, 1.8, 2.4, 0.4);
  pane.rotation.z = 0.15;
  group.userData.isHostileShot = true;
  group.userData.trailColor = EMBER_RED.clone().multiplyScalar(0.7);
  return finish(group, 'shard', BLOOD, radialDirections(5, 0.6), 0.8);
}

// ---- the rose: petals and the eye ------------------------------------------------------------------

export function createPetalMesh(pane: Pane = 'gold') {
  const group = new Group();
  const color = PANE_COLORS[pane];
  const leaf = petalShape(4.0, 1.7, 1.1);
  addBody(group, new ShapeGeometry(leaf));
  addRim(group, leaf, color, 0.42);
  addPane(group, new ShapeGeometry(petalShape(2.4, 0.85, 1.2)), color, 1.5, 1.5, 0.28);
  // A dark vein down the middle of the pane.
  const vein = new Mesh(new PlaneGeometry(0.08, 2.2), new MeshBasicMaterial({ color: BODY_MATERIAL_COLOR.clone() }));
  vein.position.z = 0.05;
  group.add(vein);
  return finish(group, 'petal', color, radialDirections(8, 0.5), 1.75);
}

export function createEyeMesh() {
  const group = new Group();
  // The black iris and its ring of teeth.
  addBody(group, new CircleGeometry(3.3, 48));
  const teeth = new Group();
  for (let i = 0; i < 14; i += 1) {
    const angle = (i / 14) * Math.PI * 2;
    const tooth = new Shape([new Vector2(-0.55, 3.0), new Vector2(0.55, 3.0), new Vector2(0, 4.6)]);
    const mesh = addBody(teeth, new ShapeGeometry(tooth), -0.01);
    mesh.rotation.z = angle;
  }
  group.add(teeth);
  group.userData.teeth = teeth;
  // The iris ring is the visible part: dead red glass, brightening as it wakes.
  const irisMaterial = createAdditiveBasicMaterial({ color: hdr(BLOOD, 0.45), side: DoubleSide });
  const iris = new Mesh(new RingGeometry(1.75, 2.55, 48), irisMaterial);
  iris.position.z = 0.02;
  group.add(iris);
  tintable(group).push({ material: irisMaterial, base: hdr(BLOOD, 0.45), kind: 'rim', intensity: 0.45, follows: false });
  // Veins: thin red spokes across the iris.
  const veins = new Group();
  for (let i = 0; i < 9; i += 1) {
    const vein = new Mesh(new PlaneGeometry(0.06, 1.3), createAdditiveBasicMaterial({ color: hdr(BLOOD, 0.5), side: DoubleSide }));
    const angle = (i / 9) * Math.PI * 2 + 0.3;
    vein.position.set(Math.cos(angle) * 2.15, Math.sin(angle) * 2.15, 0.03);
    vein.rotation.z = angle + Math.PI / 2;
    veins.add(vein);
  }
  group.add(veins);
  group.userData.veins = veins;
  // The pupil: shut black, then a white-hot hole when it opens.
  const pupilMaterial = new MeshBasicMaterial({ color: BODY_MATERIAL_COLOR.clone(), side: DoubleSide });
  const pupil = new Mesh(new CircleGeometry(1.5, 40), pupilMaterial);
  pupil.position.z = 0.04;
  group.add(pupil);
  const pupilGlowMaterial = createAdditiveBasicMaterial({ color: new Color(0, 0, 0), opacity: 0.6, side: DoubleSide });
  const pupilGlow = new Mesh(new CircleGeometry(2.6, 40), pupilGlowMaterial);
  pupilGlow.position.z = 0.035;
  group.add(pupilGlow);
  group.userData.eye = { pupil, pupilMaterial, pupilGlowMaterial, iris, irisMaterial };
  group.userData.isEye = true;
  return finish(group, 'eye', WHITE_HOT, radialDirections(16, 1), 2.6);
}

// ---- the player's shot: a thrown flame ----------------------------------------------------------------

export function createFlameShotMesh() {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.3, 0);
  coreGeometry.scale(0.45, 0.45, 2.3);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(WHITE_HOT, 2.6) })));
  const haloGeometry = new OctahedronGeometry(0.5, 0);
  haloGeometry.scale(0.6, 0.6, 1.9);
  group.add(new Mesh(haloGeometry, createAdditiveBasicMaterial({ color: hdr(CANDLE, 1.0), opacity: 0.5 })));
  return group;
}

// The mesh factory never sees spawn data, so a shade, moth, or petal is built
// in gold and retinted to its stolen pane on its first frame.
export function applyPane(group: Group, color: Color) {
  for (const part of tintable(group)) {
    if (!part.follows) continue;
    part.base.copy(hdr(color, part.intensity));
    part.material.color.copy(part.base);
  }
  (group.userData.accent as Color).copy(color);
}
