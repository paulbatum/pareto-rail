import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  WireframeGeometry,
} from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { ARC_BLUE, GUNMETAL, GUNMETAL_EDGE, HAZARD_AMBER, ION_WHITE, VOLT_VIOLET, hdr } from './palette';

// Every hostile is machined from the same cold gunmetal, lit by thin electric
// edges and a small hot core, so silhouette and motion carry identity. Each
// factory returns a Group whose userData carries the shared tint handles —
// one tint pass in visuals/index drives every state (closeness, lock, denial,
// hit flash) for every kind.
//
// Geometries are shared module-wide (materials are per-enemy for tinting), so
// spawning never grows the geometry count over a run.

export type FacetSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

export type EnemyTintHandles = {
  fillMaterial: MeshBasicMaterial;
  edgeMaterial: LineBasicMaterial;
  coreMaterial: MeshBasicMaterial;
  glowMaterial: MeshBasicMaterial;
  baseFill: Color;
  baseEdge: Color;
  baseCore: Color;
  baseGlow: Color;
};

const geometryCache = new Map<string, BufferGeometry>();

function shared<T extends BufferGeometry>(key: string, make: () => T): T {
  let geometry = geometryCache.get(key);
  if (!geometry) {
    geometry = make();
    geometryCache.set(key, geometry);
  }
  return geometry as T;
}

function sharedEdges(key: string, make: () => BufferGeometry): EdgesGeometry {
  return shared(`${key}:edges`, () => new EdgesGeometry(make())) as EdgesGeometry;
}

type EnemyBuild = {
  group: Group;
  handles: EnemyTintHandles;
};

function startBuild(kind: string, edge: Color, core: Color, glow: Color): EnemyBuild {
  const group = new Group();
  const handles: EnemyTintHandles = {
    fillMaterial: new MeshBasicMaterial({ color: GUNMETAL.clone() }),
    edgeMaterial: new LineBasicMaterial(additiveMaterialParameters({ color: edge.clone() })),
    coreMaterial: new MeshBasicMaterial({ color: core.clone() }),
    glowMaterial: createAdditiveBasicMaterial({ color: glow.clone(), opacity: 0.55 }),
    baseFill: GUNMETAL.clone(),
    baseEdge: edge.clone(),
    baseCore: core.clone(),
    baseGlow: glow.clone(),
  };
  group.userData.kind = kind;
  group.userData.tint = handles;
  return { group, handles };
}

function hullPart(build: EnemyBuild, key: string, make: () => BufferGeometry) {
  const geometry = shared(key, make);
  const fill = new Mesh(geometry, build.handles.fillMaterial);
  const edges = new LineSegments(sharedEdges(key, make), build.handles.edgeMaterial);
  const part = new Group();
  part.add(fill, edges);
  return part;
}

function hotCore(build: EnemyBuild, radius: number, glowScale = 2.1) {
  const core = new Mesh(shared(`core-${radius}`, () => new SphereGeometry(radius, 10, 8)), build.handles.coreMaterial);
  const glow = new Mesh(
    shared(`core-glow-${radius}-${glowScale}`, () => new SphereGeometry(radius * glowScale, 10, 8)),
    build.handles.glowMaterial,
  );
  const part = new Group();
  part.add(core, glow);
  return part;
}

// ---- Coil — a wall-riding sentry ------------------------------------------------
// Hexagonal maintenance pod, arc-blue ring-lens eye, two violet-edged clamp
// hooks gripping the wall behind it, a small emitter nub. Faces inward (+Z).

export function createCoilMesh(): Group {
  const build = startBuild('coil', hdr(ARC_BLUE, 1.15), hdr(ION_WHITE, 2.0), hdr(ARC_BLUE, 0.8));
  const { group } = build;

  const body = hullPart(build, 'coil-body', () => new CylinderGeometry(0.8, 0.92, 0.52, 6));
  body.rotation.x = Math.PI / 2;
  group.add(body);

  // Ring-lens eye on the inward face.
  const eye = new Mesh(
    shared('coil-eye', () => new TorusGeometry(0.34, 0.055, 8, 24)),
    createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.9) }),
  );
  eye.position.z = 0.32;
  group.add(eye, hotCore(build, 0.14).translateZ(0.34));

  // Emitter nub.
  const nub = hullPart(build, 'coil-nub', () => new ConeGeometry(0.16, 0.34, 6));
  nub.rotation.x = Math.PI / 2;
  nub.position.z = 0.52;
  group.add(nub);

  // Two clamp hooks gripping the wall behind.
  const hookMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(VOLT_VIOLET, 1.0) }));
  for (const side of [-1, 1]) {
    const hook = new Mesh(shared('coil-hook', () => new BoxGeometry(0.2, 0.66, 0.7)), build.handles.fillMaterial);
    const hookEdges = new LineSegments(sharedEdges('coil-hook', () => new BoxGeometry(0.2, 0.66, 0.7)), hookMaterial);
    hook.add(hookEdges);
    hook.position.set(side * 0.72, 0, -0.5);
    hook.rotation.x = -0.5;
    group.add(hook);
  }

  group.userData.facetSpecs = hexFacets(ARC_BLUE, 0.5, [
    new Vector3(0, 0, 1),
    new Vector3(0, 0, -1),
  ]);
  group.userData.lockRingScale = 1.0;
  return group;
}

// ---- Threader — a needle drone corkscrewing through the bore ---------------------
// Long stretched nose (+Z is travel), ion-white hot core near the tip, three
// swept tail fins, and a translucent violet ion-tail.

export function createThreaderMesh(): Group {
  const build = startBuild('threader', hdr(ARC_BLUE, 1.05), hdr(ION_WHITE, 2.4), hdr(ION_WHITE, 0.9));
  const { group } = build;

  const nose = hullPart(build, 'threader-nose', () => new ConeGeometry(0.3, 2.0, 6));
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 0.55;
  group.add(nose);

  const body = hullPart(build, 'threader-body', () => new CylinderGeometry(0.3, 0.22, 1.1, 6));
  body.rotation.x = Math.PI / 2;
  body.position.z = -0.55;
  group.add(body);

  group.add(hotCore(build, 0.16).translateZ(1.1));

  // Three swept tail fins.
  for (let i = 0; i < 3; i += 1) {
    const fin = hullPart(build, 'threader-fin', () => new BoxGeometry(0.08, 0.72, 0.9));
    const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
    fin.position.set(Math.cos(angle) * 0.34, Math.sin(angle) * 0.34, -1.05);
    fin.rotation.z = angle + Math.PI / 2;
    fin.rotation.x = -0.42;
    group.add(fin);
  }

  // Translucent violet ion-tail.
  const tailGeometry = shared('threader-tail', () => new PlaneGeometry(0.5, 2.6));
  const tail = new Mesh(
    tailGeometry,
    createAdditiveBasicMaterial({ color: hdr(VOLT_VIOLET, 0.55), opacity: 0.5, side: DoubleSide }),
  );
  tail.rotation.x = Math.PI / 2;
  tail.position.z = -2.2;
  const tailCross = tail.clone();
  tailCross.rotation.y = Math.PI / 2;
  group.add(tail, tailCross);

  group.userData.facetSpecs = [
    facet(new Vector3(0, 0, 1), ION_WHITE, 0.7),
    facet(new Vector3(0.87, 0.5, -0.5), ARC_BLUE, 0.4),
    facet(new Vector3(-0.87, 0.5, -0.5), ARC_BLUE, 0.4),
    facet(new Vector3(0, -1, -0.5), VOLT_VIOLET, 0.4),
    facet(new Vector3(0, 0, -1), VOLT_VIOLET, 0.5),
  ];
  group.userData.lockRingScale = 1.05;
  return group;
}

// ---- Capacitor — a fat two-stage insulated bank ----------------------------------
// A hot violet core cylinder caged by six gunmetal insulator staves with
// ribbed end caps. Two hits shear the staves off; the exposed core brightens.

export function createCapacitorMesh(): Group {
  const build = startBuild('capacitor', hdr(ARC_BLUE, 0.95), hdr(VOLT_VIOLET, 2.2), hdr(VOLT_VIOLET, 0.9));
  const { group } = build;

  // The hot core column.
  const coreColumn = new Mesh(
    shared('capacitor-core', () => new CylinderGeometry(0.42, 0.42, 1.5, 10)),
    build.handles.coreMaterial,
  );
  const coreGlow = new Mesh(
    shared('capacitor-glow', () => new CylinderGeometry(0.62, 0.62, 1.6, 10)),
    build.handles.glowMaterial,
  );
  const coreHeart = new Mesh(
    shared('capacitor-heart', () => new SphereGeometry(0.2, 8, 6)),
    new MeshBasicMaterial({ color: hdr(ION_WHITE, 2.6) }),
  );
  group.add(coreColumn, coreGlow, coreHeart);

  // Six insulator staves in a cage — the shear-away armor stage.
  const staves = new Group();
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const stave = hullPart(build, 'capacitor-stave', () => new BoxGeometry(0.2, 2.1, 0.2));
    stave.position.set(Math.cos(angle) * 0.92, 0, Math.sin(angle) * 0.92);
    staves.add(stave);
  }
  group.add(staves);
  group.userData.staves = staves;

  // Ribbed end caps.
  for (const side of [-1, 1]) {
    const cap = hullPart(build, 'capacitor-cap', () => new CylinderGeometry(1.08, 1.08, 0.26, 6));
    cap.position.y = side * 1.18;
    group.add(cap);
    const rib = hullPart(build, 'capacitor-rib', () => new CylinderGeometry(0.78, 0.78, 0.16, 6));
    rib.position.y = side * 0.98;
    group.add(rib);
  }

  group.userData.facetSpecs = hexFacets(VOLT_VIOLET, 0.6, [
    new Vector3(0, 1, 0),
    new Vector3(0, -1, 0),
  ]);
  group.userData.lockRingScale = 1.35;
  return group;
}

// ---- Arc — ball lightning ---------------------------------------------------------
// An ion-white hot core inside two jagged wire shells that re-randomize their
// rotation and scale every frame — the unstable "this is incoming" tell.

export function createArcMesh(): Group {
  const build = startBuild('arc', hdr(ARC_BLUE, 1.4), hdr(ION_WHITE, 3.0), hdr(ARC_BLUE, 1.3));
  const { group } = build;

  group.add(hotCore(build, 0.2, 2.6));

  const shells: LineSegments[] = [];
  for (const [radius, color] of [
    [0.46, hdr(ARC_BLUE, 1.6)],
    [0.6, hdr(VOLT_VIOLET, 1.1)],
  ] as const) {
    const shell = new LineSegments(
      shared(`arc-shell-${radius}`, () => new WireframeGeometry(new IcosahedronGeometry(radius, 0))),
      new LineBasicMaterial(additiveMaterialParameters({ color })),
    );
    group.add(shell);
    shells.push(shell);
  }
  group.userData.arcShells = shells;

  group.userData.facetSpecs = [
    facet(new Vector3(1, 0, 0), ARC_BLUE, 0.35),
    facet(new Vector3(-0.5, 0.87, 0), ION_WHITE, 0.35),
    facet(new Vector3(-0.5, -0.87, 0), VOLT_VIOLET, 0.35),
    facet(new Vector3(0, 0.3, 1), ARC_BLUE, 0.3),
    facet(new Vector3(0, -0.3, -1), ARC_BLUE, 0.3),
  ];
  group.userData.lockRingScale = 0.8;
  return group;
}

// ---- Interlock — the jammed safety clamp (the boss, ×6) ---------------------------
// Two crossed gunmetal braces banded with amber hazard chevrons, around a
// central cowl hiding an ion-white actuator core. Hazard amber is reserved
// for these and for denial — nothing else in the level wears it.

export function createInterlockMesh(): Group {
  const build = startBuild('interlock', hdr(GUNMETAL_EDGE, 1.0), hdr(ION_WHITE, 2.6), hdr(ION_WHITE, 1.0));
  const { group } = build;

  const chevronMaterial = createAdditiveBasicMaterial({ color: hdr(HAZARD_AMBER, 1.35) });
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const brace = hullPart(build, 'interlock-brace', () => new BoxGeometry(3.6, 0.56, 0.44));
    brace.rotation.z = angle;
    group.add(brace);
    // Amber hazard chevrons banded along the brace.
    for (let i = -3; i <= 3; i += 1) {
      if (i === 0) continue;
      const chevron = new Mesh(shared('interlock-chevron', () => new BoxGeometry(0.2, 0.6, 0.1)), chevronMaterial);
      chevron.position.set(Math.cos(angle) * i * 0.48, Math.sin(angle) * i * 0.48, 0.24);
      chevron.rotation.z = angle + (i > 0 ? 0.5 : -0.5);
      group.add(chevron);
    }
  }

  // The actuator core, hidden behind the cowl until the first hit pops it.
  const core = hotCore(build, 0.3, 2.0);
  core.visible = false;
  group.add(core);
  group.userData.hiddenCore = core;

  const cowl = new Group();
  const cowlBody = hullPart(build, 'interlock-cowl', () => new CylinderGeometry(0.72, 0.8, 0.5, 6));
  cowlBody.rotation.x = Math.PI / 2;
  cowl.add(cowlBody);
  const cowlRing = new Mesh(
    shared('interlock-cowl-ring', () => new TorusGeometry(0.62, 0.05, 8, 24)),
    createAdditiveBasicMaterial({ color: hdr(HAZARD_AMBER, 1.6) }),
  );
  cowlRing.position.z = 0.28;
  cowl.add(cowlRing);
  cowl.position.z = 0.14;
  group.add(cowl);
  group.userData.cowl = cowl;

  group.userData.facetSpecs = [
    facet(new Vector3(0.71, 0.71, 0), HAZARD_AMBER, 0.7),
    facet(new Vector3(-0.71, -0.71, 0), HAZARD_AMBER, 0.7),
    facet(new Vector3(0.71, -0.71, 0), HAZARD_AMBER, 0.7),
    facet(new Vector3(-0.71, 0.71, 0), HAZARD_AMBER, 0.7),
    facet(new Vector3(0, 0, 1), ION_WHITE, 0.6),
    facet(new Vector3(0, 1, 0), VOLT_VIOLET, 0.45),
    facet(new Vector3(0, -1, 0), VOLT_VIOLET, 0.45),
  ];
  // Oversized clamp ring on the boss.
  group.userData.lockRingScale = 1.8;
  return group;
}

// ---- helpers ----------------------------------------------------------------------

function facet(direction: Vector3, color: Color, size: number): FacetSpec {
  return { direction: direction.clone().normalize(), color: color.clone(), size };
}

function hexFacets(color: Color, size: number, extra: Vector3[]): FacetSpec[] {
  const specs: FacetSpec[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    specs.push(facet(new Vector3(Math.cos(angle), Math.sin(angle), 0), color, size));
  }
  for (const direction of extra) specs.push(facet(direction, ION_WHITE, size * 0.8));
  return specs;
}

/** Shared geometries for the ion-dart player shot. */
export function projectileGeometry(key: 'core' | 'shell') {
  return shared(`projectile-${key}`, () => new OctahedronGeometry(key === 'core' ? 0.3 : 0.48, 0));
}
