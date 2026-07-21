import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Scene,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { createAtmosphereRamp } from '../../../engine/environment-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { mulberry32 } from '../../../engine/rng';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  BARREL_RADIUS,
  CONDUCTOR_RADIUS,
  createMassDriverRail,
  MUZZLE_U,
  RING_RADIUS,
  RING_US,
} from '../gameplay';
import { ARC_BLUE, BORE_FOG, BORE_WALL, hdr, STEEL, VOID, WHITE_HOT } from './palette';

// The bore. Everything in here is planted once at construction and never moves
// again — the barrel is a building, not a particle system. Per-frame work is
// only ever writing instance colours, which is what makes a 137-coil tunnel
// cost two draw calls.

const STUD_ROWS = [Math.PI / 6, (5 * Math.PI) / 6, (7 * Math.PI) / 6, (11 * Math.PI) / 6];
const STUD_SPACING = 6;
const STUD_RADIUS = BARREL_RADIUS - 0.55;
const CONDUCTOR_SEGMENT = 18;
// Diagonals, deliberately not the horizontal or vertical axes. A conductor at
// the payload's own eye level projects to a flat bar straight across the frame;
// on the diagonals the four rails converge on the vanishing point instead, and
// the convergence is the single strongest speed cue in the level.
const CONDUCTOR_ANGLES = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
const STAR_COUNT = 900;
const STAR_SHELL = 400;

export type Barrel = {
  root: Group;
  /** Bright coil filament, one instance per beat. */
  coilCore: InstancedMesh;
  /** Soft bloom shell around each coil. */
  coilGlow: InstancedMesh;
  /** The two conductor rails running the length of the bore. */
  conductors: InstancedMesh;
  /** Arc length along the rail of each coil, for distance falloff. */
  coilArc: number[];
  /** Arc length along the rail of each conductor segment. */
  conductorArc: number[];
  muzzleRing: Mesh;
  muzzleGlow: Mesh;
  /** Star field and destination beacon, parented to follow the camera. */
  sky: Group;
  starMaterial: PointsMaterial;
  beacon: Mesh;
  beaconMaterial: MeshBasicMaterial;
  railLength: number;
  applyAtmosphere(progress: number): void;
};

export function createBarrel(scene: Scene): Barrel {
  const curve = createMassDriverRail();
  const railLength = curve.getLength();
  const root = new Group();

  scene.background = VOID.clone();
  scene.fog = new FogExp2(BORE_FOG.getHex(), 0.0062);

  root.add(createBoreWall(curve));

  const { mesh: studs } = createStuds(curve, railLength);
  root.add(studs);

  const conductors = createConductors(curve, railLength);
  root.add(conductors.mesh);

  const coilCore = createCoilLayer(new TorusGeometry(RING_RADIUS, 0.19, 5, 24), 1);
  const coilGlow = createCoilLayer(new TorusGeometry(RING_RADIUS, 0.85, 4, 20), 0.5);
  const coilArc = plantCoils(curve, railLength, coilCore, coilGlow);
  root.add(coilCore, coilGlow);

  const { ring: muzzleRing, glow: muzzleGlow } = createMuzzle(curve);
  root.add(muzzleRing, muzzleGlow);

  const sky = new Group();
  const starMaterial = new PointsMaterial({
    color: hdr(WHITE_HOT, 0.9),
    size: 1.7,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  sky.add(new Points(createStarGeometry(), starMaterial));

  // What the gun is aimed at. Visible straight down the bore once the muzzle
  // opens, and the only warm-white thing in the level that is not a fault.
  const beaconMaterial = new MeshBasicMaterial({
    color: hdr(WHITE_HOT, 1.5),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const beacon = new Mesh(new TorusGeometry(7, 2.4, 4, 24), beaconMaterial);
  beacon.position.set(0, 0, -STAR_SHELL * 0.92);
  sky.add(beacon);
  sky.renderOrder = -1;
  root.add(sky);

  scene.add(root);

  const applyAtmosphere = createAtmosphereRamp(scene, [
    { progress: 0, background: VOID, fog: BORE_FOG, density: 0.0062 },
    { progress: MUZZLE_U * 0.94, background: VOID, fog: BORE_FOG, density: 0.0058 },
    // The muzzle: the bore stops holding the light in.
    { progress: MUZZLE_U, background: VOID, fog: BORE_FOG, density: 0.0014 },
    { progress: 1, background: VOID, fog: VOID, density: 0.0002 },
  ]);

  return {
    root,
    coilCore,
    coilGlow,
    conductors: conductors.mesh,
    coilArc,
    conductorArc: conductors.arc,
    muzzleRing,
    muzzleGlow,
    sky,
    starMaterial,
    beacon,
    beaconMaterial,
    railLength,
    applyAtmosphere,
  };
}

/**
 * The bore wall. Vertex colours bake a fake ambient occlusion around the tube
 * so the barrel has a floor and a ceiling instead of reading as a flat sleeve,
 * and so it still has shape with bloom turned all the way off.
 */
function createBoreWall(curve: CatmullRomCurve3) {
  const points: Vector3[] = [];
  const samples = 180;
  for (let i = 0; i <= samples; i += 1) points.push(curve.getPointAt((i / samples) * MUZZLE_U));
  const boreCurve = new CatmullRomCurve3(points, false, 'catmullrom', 0.5);

  const radialSegments = 14;
  const geometry = new TubeGeometry(boreCurve, 240, BARREL_RADIUS, radialSegments, false);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const tint = new Color();
  for (let i = 0; i < position.count; i += 1) {
    // TubeGeometry lays out (tubular+1) rings of (radial+1) vertices.
    const radialIndex = i % (radialSegments + 1);
    const theta = (radialIndex / radialSegments) * Math.PI * 2;
    // Brightest along the conductor lanes at 0 and pi, darkest at the crown.
    const shade = 0.34 + 0.66 * Math.abs(Math.cos(theta)) ** 1.6;
    tint.copy(BORE_WALL).multiplyScalar(shade);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const mesh = new Mesh(geometry, new MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: DoubleSide }));
  mesh.frustumCulled = false;
  return mesh;
}

/** Service ribbing on the wall. Nothing to shoot — pure velocity read. */
function createStuds(curve: CatmullRomCurve3, railLength: number) {
  const boreLength = railLength * MUZZLE_U;
  const perRow = Math.floor(boreLength / STUD_SPACING);
  const count = perRow * STUD_ROWS.length;
  const geometry = new BoxGeometry(0.9, 0.55, 2.6);
  const mesh = new InstancedMesh(geometry, new MeshBasicMaterial({ color: hdr(STEEL, 0.85) }), count);
  mesh.frustumCulled = false;

  const matrix = new Matrix4();
  let index = 0;
  for (let step = 0; step < perRow; step += 1) {
    const u = (step * STUD_SPACING) / railLength;
    const frame = sampleRailFrame(curve, u);
    for (const angle of STUD_ROWS) {
      matrix.makeBasis(frame.right, frame.up, frame.tangent);
      matrix.setPosition(frame.position.clone()
        .addScaledVector(frame.right, Math.cos(angle) * STUD_RADIUS)
        .addScaledVector(frame.up, Math.sin(angle) * STUD_RADIUS));
      mesh.setMatrixAt(index, matrix);
      index += 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  return { mesh };
}

/**
 * The two conductor rails. Segments butt end to end so they read as one
 * unbroken line down the bore — the single strongest speed cue in the level.
 */
function createConductors(curve: CatmullRomCurve3, railLength: number) {
  const boreLength = railLength * MUZZLE_U;
  const perRail = Math.floor(boreLength / CONDUCTOR_SEGMENT);
  const count = perRail * CONDUCTOR_ANGLES.length;
  const geometry = new BoxGeometry(0.34, 0.34, CONDUCTOR_SEGMENT);
  const mesh = new InstancedMesh(geometry, createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.1) }), count);
  mesh.material.fog = false;
  mesh.frustumCulled = false;

  const matrix = new Matrix4();
  const arc: number[] = [];
  let index = 0;
  for (let step = 0; step < perRail; step += 1) {
    const distance = (step + 0.5) * CONDUCTOR_SEGMENT;
    const frame = sampleRailFrame(curve, distance / railLength);
    for (const angle of CONDUCTOR_ANGLES) {
      matrix.makeBasis(frame.right, frame.up, frame.tangent);
      matrix.setPosition(frame.position.clone()
        .addScaledVector(frame.right, Math.cos(angle) * CONDUCTOR_RADIUS)
        .addScaledVector(frame.up, Math.sin(angle) * CONDUCTOR_RADIUS));
      mesh.setMatrixAt(index, matrix);
      arc.push(distance);
      index += 1;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  return { mesh, arc };
}

function createCoilLayer(geometry: TorusGeometry, opacity: number) {
  const mesh = new InstancedMesh(
    geometry,
    createAdditiveBasicMaterial({ color: 0xffffff, opacity }),
    RING_US.length,
  );
  mesh.material.fog = false;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Plant one coil per beat at the rail parameter the camera will occupy on that
 * beat. This is the level's central claim, and it is made exactly once, here.
 */
function plantCoils(curve: CatmullRomCurve3, railLength: number, core: InstancedMesh, glow: InstancedMesh) {
  const matrix = new Matrix4();
  const arc: number[] = [];
  for (let index = 0; index < RING_US.length; index += 1) {
    const u = RING_US[index];
    const frame = sampleRailFrame(curve, u);
    matrix.makeBasis(frame.right, frame.up, frame.tangent);
    matrix.setPosition(frame.position);
    core.setMatrixAt(index, matrix);
    glow.setMatrixAt(index, matrix);
    arc.push(u * railLength);
  }
  core.instanceMatrix.needsUpdate = true;
  glow.instanceMatrix.needsUpdate = true;
  return arc;
}

/** The mouth of the gun, visible down the bore long before you reach it. */
function createMuzzle(curve: CatmullRomCurve3) {
  const frame = sampleRailFrame(curve, MUZZLE_U);
  const orient = new Matrix4().makeBasis(frame.right, frame.up, frame.tangent);

  const ring = new Mesh(
    new TorusGeometry(BARREL_RADIUS - 0.4, 0.55, 6, 40),
    createAdditiveBasicMaterial({ color: hdr(WHITE_HOT, 1.4) }),
  );
  const glow = new Mesh(
    new TorusGeometry(BARREL_RADIUS - 0.4, 3.4, 4, 28),
    createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 0.7), opacity: 0.5 }),
  );
  for (const mesh of [ring, glow]) {
    mesh.quaternion.setFromRotationMatrix(orient);
    mesh.position.copy(frame.position);
    (mesh.material as MeshBasicMaterial).fog = false;
    mesh.frustumCulled = false;
  }
  glow.material.blending = AdditiveBlending;
  return { ring, glow };
}

function createStarGeometry() {
  const random = mulberry32(0x5a17);
  const positions = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i += 1) {
    // Cosine-free uniform shell sampling; the bias does not matter at this size.
    const theta = random() * Math.PI * 2;
    const z = random() * 2 - 1;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const radius = STAR_SHELL * (0.85 + random() * 0.15);
    positions[i * 3] = Math.cos(theta) * r * radius;
    positions[i * 3 + 1] = Math.sin(theta) * r * radius;
    positions[i * 3 + 2] = z * radius;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}
