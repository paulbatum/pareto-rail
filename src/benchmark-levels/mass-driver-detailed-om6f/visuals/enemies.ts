import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { ARC_BLUE, GUNMETAL, HAZARD_AMBER, IGNITION, ION_WHITE, VOLT_VIOLET, hdr } from './palette';

// Everything hostile in the bore is machined from one vocabulary: a gunmetal
// fill, thin bright edges, and a small hot core inside a glow shell. Because
// every kind exposes the same four materials, a single tint pass in the visual
// spine drives every state — closing, locked, denied, hit — and silhouette plus
// motion are left to carry identity. Each kind also declares the facets it
// blows apart along, so a death reads as that specific machine coming apart.

export type Facet = { direction: Vector3; size: number };

export type HostileVisual = {
  fill: MeshBasicMaterial;
  edge: LineBasicMaterial;
  core: MeshBasicMaterial;
  glow: MeshBasicMaterial;
  accentBase: Color;
  coreBase: Color;
  facets: Facet[];
  /** Multiplier applied to the shared lock clamp so it fits this silhouette. */
  lockScale: number;
  /** Parts that gameplay stages hide or reveal. */
  cowl?: Object3D;
  staves?: Object3D;
  hazard?: MeshBasicMaterial;
  wireShells?: Mesh[];
  eye?: MeshBasicMaterial;
};

type BodySpec = {
  solids: BufferGeometry[];
  accent: Color;
  edgeIntensity?: number;
};

function buildBody(group: Group, spec: BodySpec) {
  const merged = mergeGeometries(spec.solids, false);
  const fill = new MeshBasicMaterial({ color: GUNMETAL.clone() });
  const edge = new LineBasicMaterial(additiveMaterialParameters({
    color: hdr(spec.accent, spec.edgeIntensity ?? 1.25),
  }));
  group.add(new Mesh(merged, fill));
  group.add(new LineSegments(new EdgesGeometry(merged, 24), edge));
  for (const geometry of spec.solids) geometry.dispose();
  return { fill, edge };
}

function buildCore(group: Group, position: Vector3, radius: number, coreColor: Color, glowColor: Color) {
  const core = new MeshBasicMaterial({ color: hdr(coreColor, 2.4) });
  const glow = createAdditiveBasicMaterial({ color: hdr(glowColor, 0.85), opacity: 0.55 });
  const coreMesh = new Mesh(new IcosahedronGeometry(radius, 1), core);
  const glowMesh = new Mesh(new IcosahedronGeometry(radius * 2.5, 1), glow);
  coreMesh.position.copy(position);
  glowMesh.position.copy(position);
  group.add(coreMesh, glowMesh);
  return { core, glow };
}

function translated(geometry: BufferGeometry, x: number, y: number, z: number) {
  return geometry.applyMatrix4(new Matrix4().makeTranslation(x, y, z));
}

function transformed(geometry: BufferGeometry, matrix: Matrix4) {
  return geometry.applyMatrix4(matrix);
}

const ROTATE_X_90 = new Matrix4().makeRotationX(Math.PI / 2);

function radialFacets(count: number, size: number, plane: 'xy' | 'yz' = 'xy'): Facet[] {
  return Array.from({ length: count }, (_unused, index) => {
    const angle = (index / count) * Math.PI * 2;
    const direction = plane === 'xy'
      ? new Vector3(Math.cos(angle), Math.sin(angle), 0.22)
      : new Vector3(0.22, Math.cos(angle), Math.sin(angle));
    return { direction: direction.normalize(), size };
  });
}

// ---------------------------------------------------------------------------
// Coil — a wall-riding maintenance pod. Hexagonal, one ring-lens eye, two
// clamp hooks gripping the wall behind it, one emitter nub.
// ---------------------------------------------------------------------------

export function createCoilMesh(): Group {
  const group = new Group();
  const solids: BufferGeometry[] = [];

  solids.push(transformed(new CylinderGeometry(1.02, 1.16, 0.62, 6), ROTATE_X_90.clone()));
  solids.push(transformed(new CylinderGeometry(0.72, 0.86, 0.26, 6), ROTATE_X_90.clone().setPosition(0, 0, 0.4)));
  // Clamp hooks: two braced fingers that reach back into the bore wall.
  for (const side of [-1, 1]) {
    const hook = new Matrix4().makeRotationZ(side * 0.45);
    hook.setPosition(side * 0.95, 0, -0.42);
    solids.push(transformed(new CylinderGeometry(0.17, 0.13, 1.05, 4), hook.clone().multiply(ROTATE_X_90)));
    solids.push(transformed(new CylinderGeometry(0.2, 0.2, 0.34, 4), new Matrix4().makeTranslation(side * 1.05, 0, -0.9)));
  }
  // Emitter nub, off-center so the silhouette is never symmetric.
  solids.push(transformed(new ConeGeometry(0.19, 0.5, 5), ROTATE_X_90.clone().setPosition(0.42, 0.46, 0.62)));

  const { fill, edge } = buildBody(group, { solids, accent: ARC_BLUE, edgeIntensity: 1.35 });

  // The ring-lens eye: the coil's whole read at distance.
  const eye = createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 2.2) });
  const eyeRing = new Mesh(new TorusGeometry(0.46, 0.075, 6, 20), eye);
  eyeRing.position.z = 0.56;
  group.add(eyeRing);

  const { core, glow } = buildCore(group, new Vector3(0, 0, 0.56), 0.17, ION_WHITE, ARC_BLUE);

  // Violet-edged clamp hooks: a second accent that only the coil carries.
  const hookEdge = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(VOLT_VIOLET, 1.5) }));
  const hookGeometry = mergeGeometries([
    translated(new CylinderGeometry(0.21, 0.21, 0.36, 4), -1.05, 0, -0.9),
    translated(new CylinderGeometry(0.21, 0.21, 0.36, 4), 1.05, 0, -0.9),
  ], false);
  group.add(new LineSegments(new EdgesGeometry(hookGeometry, 24), hookEdge));

  const visual: HostileVisual = {
    fill,
    edge,
    core,
    glow,
    accentBase: ARC_BLUE.clone(),
    coreBase: ION_WHITE.clone(),
    facets: radialFacets(6, 0.72),
    lockScale: 1.5,
    eye,
  };
  group.userData.md = visual;
  group.userData.mdKind = 'coil';
  return group;
}

// ---------------------------------------------------------------------------
// Threader — a needle drone that corkscrews through the bore. Stretched nose,
// hot core near the tip, three swept tail fins, a translucent ion tail.
// ---------------------------------------------------------------------------

export function createThreaderMesh(): Group {
  const group = new Group();
  const solids: BufferGeometry[] = [];

  solids.push(transformed(new ConeGeometry(0.4, 2.3, 6), ROTATE_X_90.clone().setPosition(0, 0, 0.95)));
  solids.push(transformed(new CylinderGeometry(0.34, 0.44, 1.5, 6), ROTATE_X_90.clone().setPosition(0, 0, -0.55)));
  solids.push(transformed(new CylinderGeometry(0.46, 0.3, 0.3, 6), ROTATE_X_90.clone().setPosition(0, 0, -1.4)));
  // Three swept tail fins.
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const fin = new Matrix4().makeRotationZ(angle);
    fin.multiply(new Matrix4().makeTranslation(0, 0.62, -1.0));
    fin.multiply(new Matrix4().makeRotationX(-0.42));
    solids.push(transformed(new CylinderGeometry(0.06, 0.28, 1.15, 3), fin.clone().multiply(ROTATE_X_90)));
  }

  const { fill, edge } = buildBody(group, { solids, accent: ARC_BLUE, edgeIntensity: 1.5 });
  const { core, glow } = buildCore(group, new Vector3(0, 0, 1.45), 0.2, ION_WHITE, ION_WHITE);

  // The ion tail: a translucent violet cone streaming off the back.
  const tail = new Mesh(
    new ConeGeometry(0.36, 3.0, 6),
    createAdditiveBasicMaterial({ color: hdr(VOLT_VIOLET, 0.75), opacity: 0.4 }),
  );
  tail.geometry.applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2));
  tail.position.z = -3.0;
  group.add(tail);

  const visual: HostileVisual = {
    fill,
    edge,
    core,
    glow,
    accentBase: ARC_BLUE.clone(),
    coreBase: ION_WHITE.clone(),
    // A needle comes apart along its length, not radially.
    facets: [
      { direction: new Vector3(0, 0, 1), size: 1.1 },
      { direction: new Vector3(0, 0.35, 0.9).normalize(), size: 0.8 },
      { direction: new Vector3(0.85, 0.3, -0.4).normalize(), size: 0.7 },
      { direction: new Vector3(-0.85, 0.3, -0.4).normalize(), size: 0.7 },
      { direction: new Vector3(0, -0.9, -0.45).normalize(), size: 0.7 },
      { direction: new Vector3(0, 0, -1), size: 0.9 },
    ],
    lockScale: 1.5,
  };
  group.userData.md = visual;
  group.userData.mdKind = 'threader';
  return group;
}

// ---------------------------------------------------------------------------
// Capacitor — a fat two-stage insulated bank. A hot violet core cylinder caged
// by six gunmetal insulator staves with ribbed end caps.
// ---------------------------------------------------------------------------

const STAVE_COUNT = 6;

export function createCapacitorMesh(): Group {
  const group = new Group();

  // Stage 2 lives underneath: the core cylinder plus its ribbed end caps.
  const shellSolids: BufferGeometry[] = [
    new CylinderGeometry(0.62, 0.62, 2.0, 12),
    translated(new CylinderGeometry(1.02, 0.86, 0.3, 12), 0, 1.16, 0),
    translated(new CylinderGeometry(0.86, 1.02, 0.3, 12), 0, -1.16, 0),
    translated(new CylinderGeometry(1.1, 1.1, 0.1, 12), 0, 1.36, 0),
    translated(new CylinderGeometry(1.1, 1.1, 0.1, 12), 0, -1.36, 0),
  ];
  const { fill, edge } = buildBody(group, { solids: shellSolids, accent: VOLT_VIOLET, edgeIntensity: 1.2 });

  const staves = new Group();
  const staveSolids: BufferGeometry[] = [];
  for (let i = 0; i < STAVE_COUNT; i += 1) {
    const angle = (i / STAVE_COUNT) * Math.PI * 2;
    const matrix = new Matrix4().makeRotationY(angle);
    matrix.multiply(new Matrix4().makeTranslation(0, 0, 0.98));
    staveSolids.push(transformed(new CylinderGeometry(0.2, 0.2, 2.3, 4), matrix.clone()));
    staveSolids.push(transformed(new CylinderGeometry(0.26, 0.26, 0.16, 4), matrix.clone().multiply(new Matrix4().makeTranslation(0, 0.85, 0))));
    staveSolids.push(transformed(new CylinderGeometry(0.26, 0.26, 0.16, 4), matrix.clone().multiply(new Matrix4().makeTranslation(0, -0.85, 0))));
  }
  const staveGeometry = mergeGeometries(staveSolids, false);
  const staveFill = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(1.15) });
  const staveEdge = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(ARC_BLUE, 1.15) }));
  staves.add(new Mesh(staveGeometry, staveFill));
  staves.add(new LineSegments(new EdgesGeometry(staveGeometry, 24), staveEdge));
  for (const geometry of staveSolids) geometry.dispose();
  group.add(staves);

  const { core, glow } = buildCore(group, new Vector3(0, 0, 0), 0.42, VOLT_VIOLET, VOLT_VIOLET);

  const visual: HostileVisual = {
    fill,
    edge,
    core,
    glow,
    accentBase: VOLT_VIOLET.clone(),
    coreBase: VOLT_VIOLET.clone(),
    // The bank sheds along its six stave directions.
    facets: radialFacets(STAVE_COUNT, 1.0, 'xy'),
    lockScale: 2.1,
    staves,
  };
  group.userData.md = visual;
  group.userData.mdKind = 'capacitor';
  return group;
}

// ---------------------------------------------------------------------------
// Interlock — the boss. A heavy hazard-striped X-clamp jamming the safety ring:
// two crossed braces around a cowl that hides an ion-white actuator core.
// ---------------------------------------------------------------------------

export function createInterlockMesh(): Group {
  const group = new Group();
  const solids: BufferGeometry[] = [];

  for (const sign of [-1, 1]) {
    const brace = new Matrix4().makeRotationZ(sign * 0.72);
    solids.push(transformed(new CylinderGeometry(0.34, 0.34, 5.4, 4), brace.clone().multiply(new Matrix4().makeRotationZ(Math.PI / 2))));
    for (const end of [-1, 1]) {
      const foot = brace.clone().multiply(new Matrix4().makeTranslation(end * 2.6, 0, 0));
      solids.push(transformed(new CylinderGeometry(0.55, 0.42, 0.7, 6), foot.clone().multiply(ROTATE_X_90)));
    }
  }
  const { fill, edge } = buildBody(group, { solids, accent: ARC_BLUE, edgeIntensity: 1.0 });

  // Hazard chevrons: the one place in the level amber is allowed on hardware.
  const chevronSolids: BufferGeometry[] = [];
  for (const sign of [-1, 1]) {
    for (const step of [-1.9, -1.15, 1.15, 1.9]) {
      const matrix = new Matrix4().makeRotationZ(sign * 0.72);
      matrix.multiply(new Matrix4().makeTranslation(step, 0, 0));
      matrix.multiply(new Matrix4().makeRotationZ(Math.PI / 2));
      chevronSolids.push(transformed(new CylinderGeometry(0.38, 0.38, 0.3, 4), matrix));
    }
  }
  const hazard = new MeshBasicMaterial({ color: hdr(HAZARD_AMBER, 1.15) });
  const chevronGeometry = mergeGeometries(chevronSolids, false);
  group.add(new Mesh(chevronGeometry, hazard));
  for (const geometry of chevronSolids) geometry.dispose();

  // The cowl hides the actuator until the first hit pops it.
  const cowl = new Group();
  const cowlGeometry = new OctahedronGeometry(1.15, 0);
  const cowlFill = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(1.4) });
  const cowlEdge = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(HAZARD_AMBER, 1.5) }));
  cowl.add(new Mesh(cowlGeometry, cowlFill));
  cowl.add(new LineSegments(new EdgesGeometry(cowlGeometry, 24), cowlEdge));
  cowl.position.z = 0.35;
  group.add(cowl);

  const { core, glow } = buildCore(group, new Vector3(0, 0, 0.35), 0.5, ION_WHITE, IGNITION);

  const visual: HostileVisual = {
    fill,
    edge,
    core,
    glow,
    accentBase: ARC_BLUE.clone(),
    coreBase: ION_WHITE.clone(),
    facets: [
      ...radialFacets(4, 1.4, 'xy'),
      { direction: new Vector3(0, 0, 1), size: 1.1 },
      { direction: new Vector3(0, 0, -1), size: 1.1 },
    ],
    lockScale: 3.4,
    cowl,
    hazard,
  };
  group.userData.md = visual;
  group.userData.mdKind = 'interlock';
  return group;
}

// ---------------------------------------------------------------------------
// Arc — ball lightning. An ion-white hot core inside two jagged wire shells
// that re-randomize their rotation and scale every frame: the unstable tell.
// ---------------------------------------------------------------------------

export function createArcMesh(): Group {
  const group = new Group();
  const wireShells: Mesh[] = [];
  for (const [radius, color, intensity] of [[0.72, ION_WHITE, 1.7], [0.95, VOLT_VIOLET, 1.3]] as const) {
    const shell = new Mesh(
      new IcosahedronGeometry(radius, 0),
      createAdditiveBasicMaterial({ color: hdr(color, intensity) }),
    );
    (shell.material as MeshBasicMaterial).wireframe = true;
    group.add(shell);
    wireShells.push(shell);
  }
  const core = new MeshBasicMaterial({ color: hdr(ION_WHITE, 3.2) });
  const glow = createAdditiveBasicMaterial({ color: hdr(VOLT_VIOLET, 1.1), opacity: 0.5 });
  group.add(new Mesh(new SphereGeometry(0.26, 10, 8), core));
  group.add(new Mesh(new SphereGeometry(0.62, 10, 8), glow));

  const visual: HostileVisual = {
    fill: core,
    edge: new LineBasicMaterial(additiveMaterialParameters({ color: hdr(VOLT_VIOLET, 1.2) })),
    core,
    glow,
    accentBase: VOLT_VIOLET.clone(),
    coreBase: ION_WHITE.clone(),
    facets: radialFacets(5, 0.4, 'yz'),
    lockScale: 1.3,
    wireShells,
  };
  group.userData.md = visual;
  group.userData.mdKind = 'arc';
  return group;
}
