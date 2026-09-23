import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { Material } from 'three';
import { glowMaterial, litMaterial } from './materials';

// Enemy construction. Silhouettes are distinct at a glance: the kite is a flat
// delta wing with a streaming tail, the grappler a hooked pod with four claws,
// the tick a ribbed shell on six legs, the sentinel a finned octahedron with a
// muzzle. Pose functions take the spine's numbers and move parts; they decide
// nothing about timing.

export type EnemyPalette = {
  membrane: Color;
  bone: Color;
  gunmetal: Color;
  frost: Color;
  glow: Color;
  hotGlow: Color;
  thruster: Color;
};

type Kit = ReturnType<typeof buildKit>;
let kit: Kit | null = null;

function flat<T extends BufferGeometry>(geometry: T) {
  const result = geometry.toNonIndexed();
  result.computeVertexNormals();
  return result;
}

function buildKit(p: EnemyPalette) {
  const wingGeometry = (() => {
    // One half-wing in the +x half-plane; mirrored for the other side.
    const g = new BufferGeometry();
    const v = [0, 1.0, 0, 1.45, -0.05, 0, 0.55, -0.32, 0, 0, 1.0, 0, 0.55, -0.32, 0, 0, -0.6, 0];
    g.setAttribute('position', new Float32BufferAttribute(v, 3));
    g.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    return g;
  })();
  const edgeGeometry = new BoxGeometry(1.6, 0.09, 0.09);
  edgeGeometry.translate(0.8, 0, 0);
  return {
    membrane: litMaterial(p.membrane, { side: DoubleSide }),
    bone: litMaterial(p.bone),
    gunmetal: litMaterial(p.gunmetal),
    frost: litMaterial(p.frost),
    glow: glowMaterial(p.glow),
    hot: glowMaterial(p.hotGlow),
    thruster: glowMaterial(p.thruster, { additive: true, opacity: 0.85 }),
    wingGeometry,
    edgeGeometry,
    tailGeometry: flat(new OctahedronGeometry(0.2, 0)).scale(0.9, 1.6, 0.3),
    eyeGeometry: new SphereGeometry(0.16, 10, 8),
    podGeometry: flat(new OctahedronGeometry(0.75, 0)).scale(0.85, 1.35, 0.7),
    plateGeometry: flat(new BoxGeometry(0.9, 0.7, 0.22)),
    clawSegment: flat(new BoxGeometry(0.16, 0.62, 0.16)).translate(0, -0.31, 0),
    clawTip: flat(new ConeGeometry(0.12, 0.42, 5)).rotateZ(Math.PI).translate(0, -0.2, 0),
    finGeometry: (() => {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute([0, 0.35, 0, 1.1, 0.15, 0, 0, -0.25, 0], 3));
      g.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
      return g;
    })(),
    shellGeometry: flat(new SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)).rotateX(-Math.PI / 2).scale(0.85, 0.65, 1.35),
    ridgeGeometry: flat(new BoxGeometry(1.75, 0.16, 0.18)),
    legGeometry: flat(new BoxGeometry(0.1, 0.1, 0.8)),
    coreGeometry: new SphereGeometry(0.42, 12, 8),
    sentinelCore: flat(new OctahedronGeometry(1.0, 0)).scale(1, 1.25, 1),
    sentinelFin: flat(new BoxGeometry(1.5, 0.2, 0.55)).translate(0.95, 0, 0),
    collarGeometry: flat(new TorusGeometry(0.95, 0.16, 5, 6)),
    muzzleGeometry: new CylinderGeometry(0.2, 0.28, 0.9, 8).rotateX(Math.PI / 2).translate(0, 0, 0.9),
    muzzleGlow: new SphereGeometry(0.22, 10, 8),
    plumeGeometry: new ConeGeometry(0.45, 2.4, 10, 1, true).translate(0, -1.2, 0).rotateZ(Math.PI),
    boltCore: new OctahedronGeometry(0.22, 0).scale(0.6, 0.6, 2.6),
    boltShell: new OctahedronGeometry(0.4, 0).scale(0.8, 0.8, 2.2),
    knuckleGeometry: flat(new OctahedronGeometry(1.0, 0)).scale(1.35, 1.1, 0.9),
    talonGeometry: flat(new ConeGeometry(0.34, 1.9, 5)).translate(0, 0.95, 0),
    jointGeometry: new SphereGeometry(0.46, 12, 10),
    kiteSpine: new BoxGeometry(0.12, 1.5, 0.12),
    tickSeam: new BoxGeometry(0.06, 0.08, 2.4),
  };
}

export function initEnemyKit(palette: EnemyPalette) {
  kit ??= buildKit(palette);
  return kit;
}

function k() {
  if (!kit) throw new Error('initEnemyKit must run before enemy meshes are built');
  return kit;
}

// ---- kite: wind-rider --------------------------------------------------------------

export function createKiteMesh() {
  const m = k();
  const root = new Group();
  const body = new Group();
  root.add(body);
  const wings: Group[] = [];
  for (const side of [1, -1]) {
    const hinge = new Group();
    hinge.scale.x = side;
    const wing = new Mesh(m.wingGeometry, m.membrane);
    hinge.add(wing);
    // Leading edge from nose to tip, in pale bone.
    const edge = new Mesh(m.edgeGeometry, m.bone);
    edge.position.set(0, 1.0, 0.03);
    edge.rotation.z = Math.atan2(-1.05, 1.45);
    hinge.add(edge);
    body.add(hinge);
    wings.push(hinge);
  }
  const spine = new Mesh(m.kiteSpine, m.bone);
  spine.position.set(0, 0.25, 0.04);
  body.add(spine);
  const eye = new Mesh(m.eyeGeometry, m.glow);
  eye.position.set(0, 0.82, 0.12);
  body.add(eye);
  const tail: Mesh[] = [];
  for (let i = 0; i < 4; i += 1) {
    const segment = new Mesh(m.tailGeometry, i % 2 ? m.bone : m.membrane);
    segment.position.set(0, -0.8 - i * 0.42, 0);
    segment.scale.setScalar(1 - i * 0.16);
    body.add(segment);
    tail.push(segment);
  }
  root.userData.parts = { body, wings, tail, eye };
  return root;
}

/** flap: wing fold angle; bank: roll about the flight axis; wave: tail phase. */
export function poseKite(root: Group, flap: number, bank: number, wave: number) {
  const { body, wings, tail } = root.userData.parts as { body: Group; wings: Group[]; tail: Mesh[] };
  wings[0].rotation.y = -flap;
  wings[1].rotation.y = flap;
  body.rotation.y = bank;
  tail.forEach((segment, i) => {
    segment.position.x = Math.sin(wave - i * 0.9) * 0.14 * (i + 1);
    segment.rotation.z = Math.sin(wave - i * 0.9 + 0.6) * 0.5;
  });
}

// ---- grappler: goes for the car --------------------------------------------------------

export function createGrapplerMesh() {
  const m = k();
  const root = new Group();
  const body = new Group();
  root.add(body);
  body.add(new Mesh(m.podGeometry, m.gunmetal));
  const plate = new Mesh(m.plateGeometry, m.bone);
  plate.position.set(0, 0.35, 0.42);
  plate.rotation.x = -0.35;
  body.add(plate);
  const eyes: Mesh[] = [];
  for (const x of [-0.22, 0.22]) {
    const eye = new Mesh(m.eyeGeometry, m.glow);
    eye.position.set(x, -0.1, 0.5);
    eye.scale.setScalar(0.8);
    body.add(eye);
    eyes.push(eye);
  }
  const claws: Group[] = [];
  for (let i = 0; i < 4; i += 1) {
    const pivot = new Group();
    const angle = -Math.PI / 2 + (i - 1.5) * 0.5;
    pivot.position.set(Math.cos(angle) * 0.45, -0.75 + Math.abs(i - 1.5) * 0.12, 0);
    pivot.rotation.z = angle + Math.PI / 2;
    const segment = new Mesh(m.clawSegment, m.bone);
    pivot.add(segment);
    const tip = new Mesh(m.clawTip, m.bone);
    tip.position.y = -0.6;
    tip.rotation.z = (i < 2 ? -1 : 1) * 0.7;
    pivot.add(tip);
    body.add(pivot);
    claws.push(pivot);
  }
  const fins: Mesh[] = [];
  for (const side of [1, -1]) {
    const fin = new Mesh(m.finGeometry, m.membrane);
    fin.scale.x = side;
    fin.position.set(side * 0.45, 0.2, -0.1);
    body.add(fin);
    fins.push(fin);
  }
  root.userData.parts = { body, claws, fins, eyes };
  return root;
}

/** open: claw spread 0..1; tuck: fins folded for the dive; hot: telegraph glow. */
export function poseGrappler(root: Group, open: number, tuck: number, hot: boolean) {
  const { claws, fins, eyes } = root.userData.parts as { claws: Group[]; fins: Mesh[]; eyes: Mesh[] };
  claws.forEach((pivot, i) => {
    const angle = -Math.PI / 2 + (i - 1.5) * (0.5 + open * 0.55);
    pivot.rotation.z = angle + Math.PI / 2;
  });
  fins.forEach((fin) => {
    fin.rotation.y = tuck * 1.2;
  });
  const material: Material = hot ? k().hot : k().glow;
  for (const eye of eyes) eye.material = material;
}

// ---- tick: crawls down the ribbon ---------------------------------------------------------

export function createTickMesh() {
  const m = k();
  const root = new Group();
  const shell = new Group();
  shell.add(new Mesh(m.shellGeometry, m.frost));
  for (let i = 0; i < 3; i += 1) {
    const ridge = new Mesh(m.ridgeGeometry, m.gunmetal);
    ridge.position.set(0, 0.36 + (i === 1 ? 0.24 : 0.1), -0.7 + i * 0.7);
    ridge.scale.x = i === 1 ? 1 : 0.8;
    shell.add(ridge);
  }
  const seam = new Mesh(m.tickSeam, m.glow);
  seam.position.set(0, 0.66, 0);
  shell.add(seam);
  root.add(shell);
  const core = new Mesh(m.coreGeometry, m.hot);
  core.position.y = 0.15;
  core.visible = false;
  root.add(core);
  const legs: Mesh[] = [];
  for (let i = 0; i < 6; i += 1) {
    const side = i % 2 ? 1 : -1;
    const leg = new Mesh(m.legGeometry, m.gunmetal);
    leg.position.set(side * 0.78, 0.02, -0.9 + Math.floor(i / 2) * 0.9);
    leg.rotation.y = side * 0.9;
    root.add(leg);
    legs.push(leg);
  }
  root.userData.parts = { shell, core, legs };
  return root;
}

export function poseTick(root: Group, stride: number, cracked: boolean) {
  const { shell, core, legs } = root.userData.parts as { shell: Group; core: Mesh; legs: Mesh[] };
  shell.visible = !cracked;
  core.visible = cracked;
  legs.forEach((leg, i) => {
    leg.rotation.x = Math.sin(stride * Math.PI * 2 + i * 1.3) * 0.45;
  });
}

// ---- sentinel: vacuum gun platform --------------------------------------------------------

export function createSentinelMesh() {
  const m = k();
  const root = new Group();
  const body = new Group();
  root.add(body);
  body.add(new Mesh(m.sentinelCore, m.gunmetal));
  const collar = new Mesh(m.collarGeometry, m.frost);
  body.add(collar);
  for (let i = 0; i < 3; i += 1) {
    const fin = new Mesh(m.sentinelFin, m.frost);
    fin.rotation.z = Math.PI / 2 + (i * Math.PI * 2) / 3;
    body.add(fin);
  }
  const muzzle = new Mesh(m.muzzleGeometry, m.gunmetal);
  body.add(muzzle);
  const muzzleGlow = new Mesh(m.muzzleGlow, m.hot);
  muzzleGlow.position.z = 1.4;
  body.add(muzzleGlow);
  const plume = new Mesh(m.plumeGeometry, m.thruster);
  plume.position.y = -1.2;
  root.add(plume);
  root.userData.parts = { body, muzzleGlow, plume };
  return root;
}

export function poseSentinel(root: Group, charge: number, thrust: number, flicker: number, spin: number) {
  const { body, muzzleGlow, plume } = root.userData.parts as { body: Group; muzzleGlow: Mesh; plume: Mesh };
  body.rotation.z = spin;
  muzzleGlow.scale.setScalar(0.4 + charge * 1.4);
  plume.visible = thrust > 0.05;
  plume.scale.set(0.7 + thrust * 0.5, (0.4 + thrust * 1.6) * (0.85 + flicker * 0.3), 0.7 + thrust * 0.5);
}

// ---- bolt ------------------------------------------------------------------------------

export function createBoltMesh() {
  const m = k();
  const root = new Group();
  root.add(new Mesh(m.boltCore, m.hot));
  root.add(new Mesh(m.boltShell, m.thruster));
  return root;
}

// ---- Descender claw -------------------------------------------------------------------------

export function createClawMesh() {
  const m = k();
  const root = new Group();
  const body = new Group();
  root.add(body);
  body.add(new Mesh(m.knuckleGeometry, m.frost));
  const joint = new Mesh(m.jointGeometry, m.glow);
  joint.position.z = 0.55;
  joint.scale.setScalar(0.8);
  body.add(joint);
  const talon = new Mesh(m.talonGeometry, m.bone);
  talon.position.set(0, 0.6, 0);
  talon.rotation.x = -0.5;
  body.add(talon);
  const hook = new Mesh(m.talonGeometry, m.bone);
  hook.scale.setScalar(0.55);
  hook.position.set(0, 2.2, -0.9);
  hook.rotation.x = -2.2;
  body.add(hook);
  root.userData.parts = { body, joint };
  return root;
}

export function poseClaw(root: Group, outward: number, pulse: number) {
  const { body, joint } = root.userData.parts as { body: Group; joint: Mesh };
  body.rotation.z = outward;
  joint.scale.setScalar(0.7 + pulse * 0.3);
}
