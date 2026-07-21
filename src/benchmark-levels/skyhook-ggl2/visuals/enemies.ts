import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { HAZARD, HAZARD_HOT, hdr, ICE, PANEL, STEEL, WARN } from './palette';
import type { Color } from 'three';
import type { DebrisSpec } from './effects';

// Utilitarian hardware: white paneling, hazard orange, dark steel; nothing
// neon. Every enemy reads by silhouette AND motion. Opaque fills carry the
// shape with bloom off; additive edges and hot cores add the glow when it is on.

export type TintPart = { material: MeshBasicMaterial; base: Color; kind: 'fill' | 'edge' | 'core' };

type Build = { group: Group; parts: TintPart[]; debris: DebrisSpec[] };

function build(): Build {
  return { group: new Group(), parts: [], debris: [] };
}

function addFill(b: Build, mesh: Mesh, base: Color) {
  const material = mesh.material as MeshBasicMaterial;
  material.color.copy(base);
  b.parts.push({ material, base: base.clone(), kind: 'fill' });
  b.group.add(mesh);
  return mesh;
}

function addEdges(b: Build, geometry: BufferGeometry, base: Color, intensity = 1.2) {
  const edges = new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial(additiveMaterialParameters({ color: hdr(base, intensity) })));
  b.parts.push({ material: edges.material as unknown as MeshBasicMaterial, base: base.clone(), kind: 'edge' });
  b.group.add(edges);
  return edges;
}

function addCore(b: Build, mesh: Mesh, base: Color, intensity = 1.8) {
  const material = createAdditiveBasicMaterial({ color: hdr(base, intensity) });
  mesh.material = material;
  b.parts.push({ material, base: base.clone(), kind: 'core' });
  b.group.add(mesh);
  return mesh;
}

function finish(b: Build, accent: Color, kind: string, spinParts?: Mesh[]) {
  b.group.userData.parts = b.parts;
  b.group.userData.debrisSpecs = b.debris;
  b.group.userData.accent = accent.clone();
  b.group.userData.kind = kind;
  if (spinParts) b.group.userData.spinParts = spinParts;
  return b.group;
}

function debrisFromDirections(dirs: Array<[number, number, number]>, color: Color, size = 0.4): DebrisSpec[] {
  return dirs.map(([x, y, z]) => ({ direction: new Vector3(x, y, z), color: color.clone(), size }));
}

// --- pod: a drifting mine — round steel body, hazard band, stubby spikes ------
export function createPodMesh() {
  const b = build();
  const body = new Mesh(new OctahedronGeometry(0.82, 1), new MeshBasicMaterial());
  addFill(b, body, STEEL.clone().multiplyScalar(1.3));
  addEdges(b, body.geometry, PANEL, 0.8);
  const band = addCore(b, new Mesh(new TorusGeometry(0.72, 0.1, 8, 20)), HAZARD, 1.1);
  band.rotation.x = Math.PI / 2;
  const spikeGeometry = new ConeGeometry(0.12, 0.5, 6);
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const spike = addFill(b, new Mesh(spikeGeometry, new MeshBasicMaterial()), STEEL.clone().multiplyScalar(1.6));
    spike.position.set(Math.cos(angle) * 0.82, 0, Math.sin(angle) * 0.82);
    spike.rotation.set(0, -angle, Math.PI / 2);
  }
  const eye = addCore(b, new Mesh(new SphereGeometry(0.16, 10, 8)), WARN, 1.4);
  eye.position.set(0, 0, 0.7);
  b.debris = debrisFromDirections([[1, 0.4, 0.4], [-1, 0.4, -0.3], [0.3, 1, -0.4], [-0.4, -1, 0.5], [0.5, 0.2, 1], [-0.6, 0.1, -1]], HAZARD, 0.5);
  return finish(b, HAZARD, 'pod');
}

// --- kite: a wind-rider — wide flat delta wing, hazard leading edge ----------
export function createKiteMesh() {
  const b = build();
  const wing = new Mesh(new ConeGeometry(1.15, 2.3, 3), new MeshBasicMaterial());
  wing.geometry.scale(1, 0.16, 1);
  wing.rotation.x = Math.PI / 2;
  addFill(b, wing, PANEL.clone().multiplyScalar(0.85));
  addEdges(b, wing.geometry, HAZARD, 1.1);
  const spineMesh = new Mesh(new BoxGeometry(0.12, 0.12, 2.1), new MeshBasicMaterial());
  addFill(b, spineMesh, STEEL.clone().multiplyScalar(1.5));
  const core = addCore(b, new Mesh(new OctahedronGeometry(0.2, 0)), HAZARD_HOT, 1.6);
  core.position.set(0, 0, 0.5);
  b.debris = debrisFromDirections([[1.2, 0.2, 0], [-1.2, 0.2, 0], [0, 0.2, 1.1], [0.4, -0.3, -0.9], [-0.4, 0.4, 0.6]], PANEL, 0.42);
  return finish(b, HAZARD, 'kite');
}

// --- husk: vacuum-hardened drone — jagged spiky body, warn-red eye ----------
export function createHuskMesh() {
  const b = build();
  const body = new Mesh(new IcosahedronGeometry(0.72, 0), new MeshBasicMaterial());
  addFill(b, body, STEEL.clone().multiplyScalar(1.15));
  addEdges(b, body.geometry, HAZARD, 1.0);
  const spikeGeometry = new TetrahedronGeometry(0.4, 0);
  for (const [x, y, z] of [[0, 0, 1], [0.9, 0.3, -0.3], [-0.9, 0.3, -0.3], [0, -0.9, 0.2], [0.3, 0.9, -0.2]] as const) {
    const spike = new Mesh(spikeGeometry, new MeshBasicMaterial());
    addFill(b, spike, STEEL.clone().multiplyScalar(1.7));
    spike.position.set(x * 0.72, y * 0.72, z * 0.72);
    spike.lookAt(new Vector3(x, y, z).multiplyScalar(2));
  }
  const eye = addCore(b, new Mesh(new SphereGeometry(0.2, 10, 8)), WARN, 1.9);
  eye.position.set(0, 0, 0.62);
  const ring = addCore(b, new Mesh(new TorusGeometry(0.34, 0.05, 6, 18)), WARN, 1.3);
  ring.position.set(0, 0, 0.5);
  b.debris = debrisFromDirections([[1, 0.3, 0.5], [-1, 0.2, 0.4], [0.2, 1, -0.4], [-0.3, -1, 0.3], [0.4, 0.3, 1], [-0.5, 0.4, -0.9]], HAZARD, 0.5);
  return finish(b, WARN, 'husk');
}

// --- grapnel: goes for the car — a claw with three curved hazard arms --------
export function createGrapnelMesh() {
  const b = build();
  const hub = new Mesh(new CylinderGeometry(0.34, 0.42, 0.7, 8), new MeshBasicMaterial());
  hub.rotation.x = Math.PI / 2;
  addFill(b, hub, STEEL.clone().multiplyScalar(1.4));
  addEdges(b, hub.geometry, PANEL, 0.7);
  const armGeometry = new BoxGeometry(0.16, 0.95, 0.16);
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const upper = addFill(b, new Mesh(armGeometry, new MeshBasicMaterial()), HAZARD.clone());
    upper.position.set(cos * 0.42, sin * 0.42, 0.34);
    upper.rotation.set(0.5, 0, angle);
    const claw = addFill(b, new Mesh(new ConeGeometry(0.1, 0.5, 5), new MeshBasicMaterial()), HAZARD_HOT.clone());
    claw.position.set(cos * 0.82, sin * 0.82, 0.62);
    claw.rotation.set(1.1, 0, angle);
  }
  const core = addCore(b, new Mesh(new SphereGeometry(0.22, 10, 8)), WARN, 1.8);
  core.position.set(0, 0, 0.45);
  b.debris = debrisFromDirections([[1, 0.6, 0.4], [-1, 0.6, 0.4], [0, -1, 0.4], [0.5, 0.2, 1], [-0.5, 0.2, 1]], HAZARD, 0.55);
  return finish(b, HAZARD, 'grapnel');
}

// --- bolt: hostile shot — a small warn-red dart -----------------------------
export function createBoltMesh() {
  const b = build();
  const core = new Mesh(new OctahedronGeometry(0.26, 0), new MeshBasicMaterial({ color: hdr(WARN, 2.4) }));
  core.geometry.scale(0.5, 0.5, 2.0);
  b.parts.push({ material: core.material as MeshBasicMaterial, base: WARN.clone(), kind: 'core' });
  b.group.add(core);
  const shell = new Mesh(new OctahedronGeometry(0.42, 0), createAdditiveBasicMaterial({ color: hdr(HAZARD, 0.9), opacity: 0.5 }));
  shell.geometry.scale(0.55, 0.55, 1.8);
  b.parts.push({ material: shell.material as MeshBasicMaterial, base: HAZARD.clone(), kind: 'edge' });
  b.group.add(shell);
  b.group.userData.isHostileShot = true;
  b.group.userData.trailColor = hdr(WARN, 0.7);
  return finish(b, WARN, 'bolt');
}

// --- descender: the boss — a heavy hauler gripping the tether ----------------
export function createDescenderMesh() {
  const b = build();
  // Central armoured body: layered steel drums with hazard stripes.
  const core = new Mesh(new CylinderGeometry(1.5, 1.9, 3.0, 10), new MeshBasicMaterial());
  core.rotation.x = Math.PI / 2;
  addFill(b, core, STEEL.clone().multiplyScalar(1.2));
  addEdges(b, core.geometry, PANEL, 0.9);
  for (const z of [-0.8, 0.0, 0.8]) {
    const stripe = new Mesh(new TorusGeometry(1.62, 0.14, 8, 24), new MeshBasicMaterial({ color: hdr(HAZARD, 0.9) }));
    b.parts.push({ material: stripe.material as MeshBasicMaterial, base: HAZARD.clone(), kind: 'edge' });
    stripe.position.z = z;
    b.group.add(stripe);
  }
  // Gripping arms reaching forward down the cable toward the player.
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const arm = new Mesh(new BoxGeometry(0.4, 0.4, 2.6), new MeshBasicMaterial());
    addFill(b, arm, STEEL.clone().multiplyScalar(1.5));
    arm.position.set(Math.cos(angle) * 1.4, Math.sin(angle) * 1.4, 1.7);
    arm.rotation.x = -0.4;
    const claw = new Mesh(new ConeGeometry(0.28, 0.9, 6), new MeshBasicMaterial({ color: hdr(HAZARD_HOT, 0.9) }));
    b.parts.push({ material: claw.material as MeshBasicMaterial, base: HAZARD_HOT.clone(), kind: 'edge' });
    claw.position.set(Math.cos(angle) * 1.4, Math.sin(angle) * 1.4, 3.0);
    claw.rotation.x = -Math.PI / 2 - 0.4;
    b.group.add(claw);
  }
  // The core: caged, glows hotter as the armour cracks.
  const eye = addCore(b, new Mesh(new SphereGeometry(0.7, 16, 12)), WARN, 1.2);
  eye.position.set(0, 0, 1.4);
  b.group.userData.bossCore = eye;
  const cage = addCore(b, new Mesh(new TorusGeometry(0.85, 0.08, 8, 20)), HAZARD, 1.0);
  cage.position.set(0, 0, 1.4);
  b.debris = debrisFromDirections(
    [[1, 0.5, 0.5], [-1, 0.5, 0.5], [0.5, 1, 0.3], [-0.5, -1, 0.3], [0, 0.3, 1.2], [1, -0.5, -0.4], [-1, -0.5, -0.4], [0, -1, -0.4]],
    HAZARD,
    0.8,
  );
  return finish(b, WARN, 'descender');
}
