import {
  BoxGeometry,
  BufferGeometry,
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
  Object3D,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Color } from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { cachedGeometry } from './geometry-cache';
import { ARC_BLUE, GUNMETAL, HAZARD_AMBER, ION_WHITE, VOLT_VIOLET, hdr } from './palette';

// One facet vocabulary for every hostile in the barrel: a dark gunmetal fill,
// thin bright edges, and a small hot core inside a glow shell. Because every
// enemy is assembled from the same three material roles, a single tint pass in
// the visual spine drives every state — closing, locked, denied, hit — and the
// silhouette alone still carries identity with bloom at zero.

export type HostileParts = {
  fills: MeshBasicMaterial[];
  edges: LineBasicMaterial[];
  cores: MeshBasicMaterial[];
  glows: MeshBasicMaterial[];
  /** Death-burst directions: each kind blows apart along its own facets. */
  facets: Vector3[];
  /** Parts that shear away when the armor stage falls. */
  shellParts: Object3D[];
  /** Parts the armor was hiding, revealed by the same stage break. */
  revealParts: Object3D[];
  lockRingScale: number;
  baseEdge: Color;
  baseCore: Color;
};

function parts(overrides: Partial<HostileParts> = {}): HostileParts {
  return {
    fills: [],
    edges: [],
    cores: [],
    glows: [],
    facets: [],
    shellParts: [],
    revealParts: [],
    lockRingScale: 1,
    baseEdge: ARC_BLUE,
    baseCore: ION_WHITE,
    ...overrides,
  };
}

/** A gunmetal solid wearing its own thin bright wire outline. */
function facetBody(
  key: string,
  make: () => BufferGeometry,
  hostile: HostileParts,
  edgeColor: Color,
  edgeIntensity = 1.4,
) {
  const geometry = cachedGeometry(key, make);
  const fill = new MeshBasicMaterial({ color: GUNMETAL.clone() });
  const body = new Mesh(geometry, fill);
  const outlineMaterial = new LineBasicMaterial({ color: hdr(edgeColor, edgeIntensity) });
  body.add(new LineSegments(cachedGeometry(`${key}:edges`, () => new EdgesGeometry(geometry, 24)), outlineMaterial));
  hostile.fills.push(fill);
  hostile.edges.push(outlineMaterial);
  return body;
}

/** A small hot core inside a soft additive glow shell. */
function hotCore(hostile: HostileParts, radius: number, coreColor: Color, glowColor: Color, glowScale = 2.3) {
  const group = new Group();
  const coreMaterial = new MeshBasicMaterial({ color: hdr(coreColor, 2.6) });
  const core = new Mesh(cachedGeometry(`core:${radius}`, () => new SphereGeometry(radius, 10, 8)), coreMaterial);
  const glowMaterial = createAdditiveBasicMaterial({ color: hdr(glowColor, 0.85), opacity: 0.6 });
  const glow = new Mesh(
    cachedGeometry(`glow:${radius}:${glowScale}`, () => new SphereGeometry(radius * glowScale, 10, 8)),
    glowMaterial,
  );
  group.add(core, glow);
  hostile.cores.push(coreMaterial);
  hostile.glows.push(glowMaterial);
  return group;
}

function ring(hostile: HostileParts, radius: number, tube: number, color: Color, intensity: number) {
  const material = createAdditiveBasicMaterial({ color: hdr(color, intensity), side: DoubleSide });
  hostile.glows.push(material);
  return new Mesh(cachedGeometry(`ring:${radius}:${tube}`, () => new TorusGeometry(radius, tube, 6, 26)), material);
}

function radialFacets(count: number, tilt = 0): Vector3[] {
  return Array.from({ length: count }, (_unused, index) => {
    const angle = (index / count) * Math.PI * 2;
    return new Vector3(Math.sin(angle), Math.cos(angle), tilt).normalize();
  });
}

// ---- coil: a wall-riding maintenance pod ------------------------------------
// Hexagonal pod, an arc-blue ring-lens eye staring inward, two violet-edged
// clamp hooks gripping the wall behind it, and a small emitter nub.

export function createCoilMesh(): Group {
  const group = new Group();
  const hostile = parts({ facets: radialFacets(6, 0.4), lockRingScale: 1.15, baseEdge: ARC_BLUE });

  const pod = facetBody('coil:pod', () => new CylinderGeometry(1.15, 0.95, 0.75, 6), hostile, ARC_BLUE, 1.5);
  pod.rotation.x = Math.PI / 2;
  group.add(pod);

  // The eye: a lens ring around a lit iris, facing down the bore at the player.
  const lens = ring(hostile, 0.62, 0.075, ARC_BLUE, 2.2);
  lens.position.z = 0.42;
  group.add(lens);
  const iris = hotCore(hostile, 0.22, ION_WHITE, ARC_BLUE, 1.7);
  iris.position.z = 0.44;
  group.add(iris);

  // Clamp hooks: the thing that actually grips the barrel wall.
  for (const side of [-1, 1]) {
    const hook = facetBody('coil:hook', () => new BoxGeometry(0.26, 1.5, 0.34), hostile, VOLT_VIOLET, 1.6);
    hook.position.set(side * 0.95, 0, -0.5);
    hook.rotation.z = side * 0.42;
    group.add(hook);
  }

  const nub = facetBody('coil:nub', () => new CylinderGeometry(0.13, 0.2, 0.5, 5), hostile, ARC_BLUE, 1.3);
  nub.rotation.x = Math.PI / 2;
  nub.position.set(0, -0.85, 0.2);
  group.add(nub);

  group.userData.hostile = hostile;
  group.userData.kind = 'coil';
  return group;
}

// ---- threader: a needle drone corkscrewing through the bore ------------------

export function createThreaderMesh(): Group {
  const group = new Group();
  const hostile = parts({ facets: radialFacets(3, 0.8), lockRingScale: 1.0, baseEdge: VOLT_VIOLET });

  const nose = facetBody('threader:nose', () => new ConeGeometry(0.42, 2.6, 5), hostile, VOLT_VIOLET, 1.7);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 0.5;
  group.add(nose);

  const core = hotCore(hostile, 0.19, ION_WHITE, ARC_BLUE, 2.4);
  core.position.z = 1.15;
  group.add(core);

  // Three swept tail fins.
  for (let i = 0; i < 3; i += 1) {
    const fin = facetBody('threader:fin', () => new BoxGeometry(0.07, 0.86, 0.62), hostile, ARC_BLUE, 1.5);
    const angle = (i / 3) * Math.PI * 2;
    fin.position.set(Math.sin(angle) * 0.4, Math.cos(angle) * 0.4, -0.72);
    fin.rotation.z = -angle;
    fin.rotation.x = -0.32;
    group.add(fin);
  }

  // A translucent ion tail: the only large soft shape on the drone, kept dim.
  const tailMaterial = createAdditiveBasicMaterial({ color: hdr(VOLT_VIOLET, 0.5), opacity: 0.38 });
  const tail = new Mesh(cachedGeometry('threader:tail', () => new ConeGeometry(0.3, 2.4, 6, 1, true)), tailMaterial);
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -1.85;
  hostile.glows.push(tailMaterial);
  group.add(tail);

  group.userData.hostile = hostile;
  group.userData.kind = 'threader';
  return group;
}

// ---- capacitor: a fat two-stage insulated bank -------------------------------
// Six gunmetal insulator staves with ribbed end caps cage a hot violet core.
// Two hits shear the staves off along the six stave directions; the exposed core
// then takes two more.

export function createCapacitorMesh(): Group {
  const group = new Group();
  const staveDirections = radialFacets(6);
  const hostile = parts({ facets: staveDirections, lockRingScale: 1.5, baseEdge: VOLT_VIOLET });

  const core = facetBody('cap:core', () => new CylinderGeometry(0.62, 0.62, 2.0, 12), hostile, VOLT_VIOLET, 1.8);
  core.rotation.x = Math.PI / 2;
  group.add(core);
  group.add(hotCore(hostile, 0.44, VOLT_VIOLET, VOLT_VIOLET, 2.6));

  const cage = new Group();
  staveDirections.forEach((direction, index) => {
    const stave = facetBody('cap:stave', () => new BoxGeometry(0.34, 0.34, 2.3), hostile, ARC_BLUE, 1.4);
    stave.position.set(direction.x * 1.1, direction.y * 1.1, 0);
    stave.rotation.z = (index / 6) * Math.PI * 2;
    cage.add(stave);
  });
  for (const end of [-1, 1]) {
    const cap = facetBody('cap:end', () => new CylinderGeometry(1.35, 1.15, 0.42, 12), hostile, ARC_BLUE, 1.5);
    cap.rotation.x = Math.PI / 2;
    cap.position.z = end * 1.22;
    cage.add(cap);
    const rib = ring(hostile, 1.22, 0.055, ARC_BLUE, 1.5);
    rib.position.z = end * 1.22;
    cage.add(rib);
  }
  group.add(cage);

  hostile.shellParts.push(cage);
  group.userData.hostile = hostile;
  group.userData.kind = 'capacitor';
  return group;
}

// ---- arc: ball lightning, and the tell is that it will not hold still --------

export function createArcMesh(): Group {
  const group = new Group();
  const hostile = parts({ facets: radialFacets(5, 0.5), lockRingScale: 0.9, baseEdge: ION_WHITE });

  group.add(hotCore(hostile, 0.22, ION_WHITE, ARC_BLUE, 1.8));

  // Two jagged wire shells. The visual spine re-randomizes their rotation and
  // scale EVERY FRAME — this is the "incoming, unstable" read.
  const shells: LineSegments[] = [];
  for (const [radius, detail, color, intensity] of [[0.62, 0, ARC_BLUE, 2.4], [0.86, 1, VOLT_VIOLET, 1.6]] as const) {
    const material = new LineBasicMaterial({ color: hdr(color, intensity) });
    const shell = new LineSegments(
      cachedGeometry(`arc:shell:${radius}`, () => new EdgesGeometry(new IcosahedronGeometry(radius, detail), 24)),
      material,
    );
    hostile.edges.push(material);
    shells.push(shell);
    group.add(shell);
  }

  group.userData.hostile = hostile;
  group.userData.arcShells = shells;
  group.userData.kind = 'arc';
  return group;
}

// ---- interlock: the jammed safety clamp, and the only amber in the barrel ----

export function createInterlockMesh(): Group {
  const group = new Group();
  const hostile = parts({ facets: radialFacets(4, 0.3), lockRingScale: 2.4, baseEdge: HAZARD_AMBER });

  // Two crossed braces, banded with hazard chevrons.
  for (const sign of [-1, 1]) {
    const brace = facetBody('lock:brace', () => new BoxGeometry(6.4, 0.86, 0.62), hostile, HAZARD_AMBER, 1.5);
    brace.rotation.z = sign * Math.PI * 0.25;
    group.add(brace);
    // Chevrons live outboard of the cowl, or the cowl would hide the hazard read.
    for (const i of [-2.4, -1.6, 1.6, 2.4]) {
      const chevronMaterial = new MeshBasicMaterial({ color: hdr(HAZARD_AMBER, 1.25), side: DoubleSide });
      const chevron = new Mesh(
        cachedGeometry('lock:chevron', () => new BoxGeometry(0.4, 0.88, 0.02)),
        chevronMaterial,
      );
      chevron.position.set(i, 0, 0.33);
      chevron.rotation.z = 0.5;
      hostile.glows.push(chevronMaterial);
      brace.add(chevron);
    }
  }

  // The cowl hides the actuator core until the first hit pops it.
  const cowl = new Group();
  const shell = facetBody('lock:cowl', () => new CylinderGeometry(1.1, 1.1, 0.9, 8), hostile, HAZARD_AMBER, 1.7);
  shell.rotation.x = Math.PI / 2;
  cowl.add(shell);
  const collar = ring(hostile, 1.18, 0.08, HAZARD_AMBER, 1.8);
  collar.position.z = 0.46;
  cowl.add(collar);
  group.add(cowl);

  // The actuator core is genuinely hidden by the cowl, not merely dark: an
  // additive glow would otherwise shine straight through its own armour.
  const actuator = hotCore(hostile, 0.44, ION_WHITE, VOLT_VIOLET, 1.7);
  actuator.visible = false;
  group.add(actuator);

  hostile.shellParts.push(cowl);
  hostile.revealParts.push(actuator);
  group.userData.hostile = hostile;
  group.userData.kind = 'interlock';
  return group;
}

export function hostilePartsOf(mesh: Object3D): HostileParts | undefined {
  return mesh.userData.hostile as HostileParts | undefined;
}
