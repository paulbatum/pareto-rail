import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { HAZARD, HAZARD_DEEP, PANEL_DARK, PANEL_GREY, PANEL_WHITE, STEEL, hdr } from './palette';
import type { DebrisSpec } from './effects';

// Every hostile in Skyhook is built out of the same three ingredients as the
// climber itself — white panel, grey structure, hazard stripe — so the level
// reads as one industry. What separates them is silhouette: membrane, block,
// crab, faceted pod, splinter. Nothing here glows except working lights and
// cutting heads, which is what keeps the frame legible with bloom at zero.

export type TintKind = 'hull' | 'trim' | 'lamp';
export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; base: Color; kind: TintKind };

type Built = {
  group: Group;
  parts: TintPart[];
  debris: DebrisSpec[];
};

function build(): Built {
  return { group: new Group(), parts: [], debris: [] };
}

function panel(built: Built, mesh: Mesh, base: Color, kind: TintKind = 'hull') {
  const material = mesh.material as MeshBasicMaterial;
  material.color.copy(base);
  built.parts.push({ material, base: base.clone(), kind });
  built.group.add(mesh);
  return mesh;
}

/** Hard white edge lines keep silhouettes readable when the bloom slider is at zero. */
function outline(built: Built, source: Mesh, base: Color, scale = 1) {
  const geometry = new EdgesGeometry(source.geometry);
  const material = new LineBasicMaterial({ color: base.clone() });
  const lines = new LineSegments(geometry, material);
  lines.position.copy(source.position);
  lines.quaternion.copy(source.quaternion);
  lines.scale.copy(source.scale).multiplyScalar(scale);
  built.parts.push({ material, base: base.clone(), kind: 'trim' });
  built.group.add(lines);
  return lines;
}

function debrisFrom(built: Built, direction: Vector3, color: Color, size: number) {
  built.debris.push({ direction: direction.clone().normalize(), color: color.clone(), size });
}

function ringOfDebris(built: Built, count: number, color: Color, size: number, tilt = 0.5) {
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    debrisFrom(built, new Vector3(Math.cos(angle), Math.sin(angle), tilt * Math.sin(angle * 2)), color, size);
  }
}

function finish(built: Built, accent: Color, lockRingScale: number) {
  built.group.userData.parts = built.parts;
  built.group.userData.debrisSpecs = built.debris;
  built.group.userData.accent = accent.clone();
  built.group.userData.lockRingScale = lockRingScale;
  return built.group;
}

// ---- kite ---------------------------------------------------------------------
// A wind-rider: a taut membrane on a single spar with two long tail streamers.
// Wide, thin and always banking, so it reads instantly against the blocky pods.
export function createKiteMesh() {
  const built = build();

  const sailGeometry = new ConeGeometry(2.4, 3.6, 3);
  sailGeometry.rotateX(Math.PI / 2);
  sailGeometry.scale(1, 0.16, 1);
  const sail = new Mesh(sailGeometry, new MeshBasicMaterial({ side: DoubleSide }));
  panel(built, sail, PANEL_WHITE.clone().multiplyScalar(0.8));
  outline(built, sail, hdr(HAZARD, 0.55));

  const spar = new Mesh(new BoxGeometry(4.6, 0.18, 0.18), new MeshBasicMaterial());
  spar.position.z = 0.5;
  panel(built, spar, PANEL_GREY);

  for (const side of [-1, 1]) {
    const streamer = new Mesh(new PlaneGeometry(0.22, 3.4), new MeshBasicMaterial({ side: DoubleSide }));
    streamer.position.set(side * 1.5, 0, -2.0);
    streamer.rotation.x = Math.PI / 2;
    panel(built, streamer, HAZARD_DEEP.clone().multiplyScalar(1.4), 'trim');
  }

  const lamp = new Mesh(new CircleGeometry(0.22, 12), new MeshBasicMaterial({ side: DoubleSide }));
  lamp.position.set(0, 0.14, 1.5);
  lamp.rotation.x = -Math.PI / 2;
  panel(built, lamp, hdr(HAZARD, 1.4), 'lamp');

  ringOfDebris(built, 7, PANEL_WHITE, 0.42, 0.2);
  return finish(built, HAZARD, 1.5);
}

// ---- ballast ------------------------------------------------------------------
// Tether hardware gone feral: a counterweight pod, all right angles and warning
// stripes. This is the formation target, so it is compact and high-contrast.
export function createBallastMesh() {
  const built = build();

  const body = new Mesh(new BoxGeometry(2.5, 2.5, 2.2), new MeshBasicMaterial());
  panel(built, body, PANEL_WHITE);
  outline(built, body, hdr(PANEL_DARK, 0.4), 1.001);

  const band = new Mesh(new BoxGeometry(2.62, 0.62, 2.32), new MeshBasicMaterial());
  panel(built, band, HAZARD, 'trim');

  const yoke = new Mesh(new TorusGeometry(1.85, 0.13, 6, 16), new MeshBasicMaterial());
  yoke.rotation.y = Math.PI / 2;
  panel(built, yoke, STEEL);

  const weight = new Mesh(new CylinderGeometry(0.7, 0.9, 1.0, 6), new MeshBasicMaterial());
  weight.position.y = -2.0;
  panel(built, weight, PANEL_GREY);

  const lamp = new Mesh(new CircleGeometry(0.3, 12), new MeshBasicMaterial({ side: DoubleSide }));
  lamp.position.z = 1.16;
  panel(built, lamp, hdr(HAZARD, 1.8), 'lamp');

  ringOfDebris(built, 9, PANEL_WHITE, 0.5, 0.7);
  ringOfDebris(built, 4, HAZARD, 0.34, 1.1);
  return finish(built, HAZARD, 1.5);
}

// ---- latcher ------------------------------------------------------------------
// The thing that wants the car and not you: a flat crab with four splayed grabs
// and a cutting head that only lights once it is actually chewing.
export function createLatcherMesh() {
  const built = build();

  const shellGeometry = new OctahedronGeometry(1.7, 0);
  shellGeometry.scale(1.5, 0.55, 1.1);
  const shell = new Mesh(shellGeometry, new MeshBasicMaterial());
  panel(built, shell, PANEL_GREY.clone().multiplyScalar(1.5));
  outline(built, shell, hdr(HAZARD, 0.7));

  const stripe = new Mesh(new BoxGeometry(3.3, 0.3, 0.5), new MeshBasicMaterial());
  stripe.position.set(0, 0.42, 0.2);
  panel(built, stripe, HAZARD, 'trim');

  const legs = new Group();
  for (let i = 0; i < 4; i += 1) {
    const side = i < 2 ? -1 : 1;
    const front = i % 2 === 0 ? 1 : -1;
    const leg = new Mesh(new BoxGeometry(0.24, 0.24, 2.6), new MeshBasicMaterial());
    leg.position.set(side * 1.5, -0.2, front * 0.9);
    leg.rotation.set(front * 0.5, side * 0.7, 0);
    panel(built, leg, STEEL);
    const claw = new Mesh(new ConeGeometry(0.34, 0.9, 4), new MeshBasicMaterial());
    claw.position.set(side * 2.5, -0.55, front * 1.9);
    claw.rotation.x = Math.PI / 2;
    panel(built, claw, PANEL_WHITE.clone().multiplyScalar(0.7));
  }
  built.group.add(legs);

  const head = new Mesh(new CylinderGeometry(0.34, 0.14, 0.9, 8), new MeshBasicMaterial());
  head.rotation.x = Math.PI / 2;
  head.position.set(0, -0.35, 1.5);
  panel(built, head, hdr(HAZARD, 1.2), 'lamp');
  head.name = 'cutter';

  const eye = new Mesh(new RingGeometry(0.42, 0.6, 12), new MeshBasicMaterial({ side: DoubleSide }));
  eye.position.set(0, 0.5, 0.9);
  panel(built, eye, hdr(HAZARD, 0.9), 'lamp');

  ringOfDebris(built, 8, PANEL_GREY.clone().multiplyScalar(2), 0.44, 0.4);
  ringOfDebris(built, 4, HAZARD, 0.3, 0.9);
  built.group.userData.isLatcher = true;
  return finish(built, HAZARD, 1.9);
}

// ---- sentry -------------------------------------------------------------------
// Vacuum hardware: a faceted ceramic pod with a shuttered iris. It is the only
// enemy with radial symmetry, which is exactly why the wind-up reads.
export function createSentryMesh() {
  const built = build();

  const pod = new Mesh(new OctahedronGeometry(1.5, 1), new MeshBasicMaterial({}));
  panel(built, pod, PANEL_WHITE.clone().multiplyScalar(0.92));
  outline(built, pod, hdr(PANEL_DARK, 0.6), 1.002);

  const collar = new Mesh(new TorusGeometry(1.42, 0.16, 6, 18), new MeshBasicMaterial());
  panel(built, collar, HAZARD_DEEP.clone().multiplyScalar(1.6), 'trim');

  for (let i = 0; i < 3; i += 1) {
    const fin = new Mesh(new BoxGeometry(0.16, 1.5, 0.8), new MeshBasicMaterial());
    const angle = (i / 3) * Math.PI * 2;
    fin.position.set(Math.cos(angle) * 1.3, Math.sin(angle) * 1.3, -0.5);
    fin.rotation.z = angle;
    panel(built, fin, STEEL);
  }

  const iris = new Mesh(new RingGeometry(0.3, 0.72, 8), new MeshBasicMaterial({ side: DoubleSide }));
  iris.position.z = 1.35;
  panel(built, iris, hdr(HAZARD, 1.1), 'lamp');
  iris.name = 'iris';

  const pupil = new Mesh(new CircleGeometry(0.26, 10), new MeshBasicMaterial({ side: DoubleSide }));
  pupil.position.z = 1.4;
  panel(built, pupil, hdr(HAZARD, 0.4), 'lamp');
  pupil.name = 'pupil';

  ringOfDebris(built, 10, PANEL_WHITE, 0.42, 0.6);
  return finish(built, HAZARD, 1.5);
}

// ---- shard --------------------------------------------------------------------
// Shed ice and torn paint falling planetward. Sharp, cold, and the only hostile
// silhouette with no straight edges left on it.
export function createShardMesh() {
  const built = build();

  const coreGeometry = new TetrahedronGeometry(1.25, 0);
  coreGeometry.scale(1.3, 1.0, 0.42);
  const core = new Mesh(coreGeometry, new MeshBasicMaterial({}));
  panel(built, core, PANEL_WHITE.clone().multiplyScalar(1.05));
  outline(built, core, hdr(PANEL_DARK, 0.5), 1.003);

  const flake = new Mesh(new TetrahedronGeometry(0.72, 0), new MeshBasicMaterial({}));
  flake.position.set(0.5, -0.6, 0.2);
  flake.rotation.set(0.8, 1.2, 0.4);
  panel(built, flake, STEEL.clone().multiplyScalar(1.15));

  const rim = new Mesh(new PlaneGeometry(2.9, 0.1), new MeshBasicMaterial({ side: DoubleSide }));
  rim.position.set(0, 0.1, 0.28);
  rim.rotation.z = 0.42;
  panel(built, rim, hdr(HAZARD, 0.55), 'trim');

  ringOfDebris(built, 6, PANEL_WHITE, 0.36, 0.5);
  return finish(built, PANEL_WHITE, 1.3);
}

// ---- slug ---------------------------------------------------------------------
// A sentry's homing round. Lockable, so it needs to be visibly a target and not
// a particle: a stubby finned dart with a hot tail.
export function createSlugMesh() {
  const built = build();

  const bodyGeometry = new ConeGeometry(0.34, 1.5, 6);
  bodyGeometry.rotateX(Math.PI / 2);
  const body = new Mesh(bodyGeometry, new MeshBasicMaterial());
  panel(built, body, hdr(HAZARD, 0.5), 'trim');

  for (let i = 0; i < 3; i += 1) {
    const fin = new Mesh(new PlaneGeometry(0.5, 0.5), new MeshBasicMaterial({ side: DoubleSide }));
    const angle = (i / 3) * Math.PI * 2;
    fin.position.set(Math.cos(angle) * 0.24, Math.sin(angle) * 0.24, -0.55);
    fin.rotation.z = angle;
    panel(built, fin, PANEL_WHITE.clone().multiplyScalar(0.8));
  }

  const tail = new Mesh(new CircleGeometry(0.3, 10), new MeshBasicMaterial(additiveMaterialParameters({
    color: hdr(HAZARD, 1.6),
    side: DoubleSide,
    opacity: 0.85,
  })));
  tail.position.z = -0.78;
  built.parts.push({ material: tail.material as MeshBasicMaterial, base: hdr(HAZARD, 1.6), kind: 'lamp' });
  built.group.add(tail);

  built.group.userData.isHostileShot = true;
  built.group.userData.trailColor = HAZARD.clone().multiplyScalar(0.85);
  ringOfDebris(built, 5, HAZARD, 0.28, 0.4);
  return finish(built, HAZARD, 1.1);
}

// ---- descender clamp arm ------------------------------------------------------
// One of the four grabs holding the walker to the ribbon: a jaw on the end of a
// hydraulic strut. Big enough to sweep across as separate screen targets once
// the machine is close.
export function createClampMesh() {
  const built = build();

  const strut = new Mesh(new BoxGeometry(1.5, 1.5, 9), new MeshBasicMaterial());
  strut.position.z = -4;
  panel(built, strut, PANEL_GREY.clone().multiplyScalar(1.4));
  outline(built, strut, hdr(HAZARD, 0.6), 1.001);

  const knuckle = new Mesh(new BoxGeometry(3.4, 3.4, 2.6), new MeshBasicMaterial());
  panel(built, knuckle, PANEL_WHITE.clone().multiplyScalar(0.85));
  outline(built, knuckle, hdr(PANEL_DARK, 0.5), 1.002);

  for (const side of [-1, 1]) {
    const jaw = new Mesh(new BoxGeometry(0.9, 3.6, 2.4), new MeshBasicMaterial());
    jaw.position.set(side * 2.1, 0, 1.2);
    jaw.rotation.z = side * 0.28;
    panel(built, jaw, STEEL.clone().multiplyScalar(1.1));
    jaw.name = side < 0 ? 'jawL' : 'jawR';
  }

  const chevron = new Mesh(new BoxGeometry(3.6, 0.7, 0.4), new MeshBasicMaterial());
  chevron.position.set(0, 1.9, 1.0);
  panel(built, chevron, HAZARD, 'trim');

  const lamp = new Mesh(new CircleGeometry(0.5, 12), new MeshBasicMaterial({ side: DoubleSide }));
  lamp.position.set(0, -1.5, 1.4);
  panel(built, lamp, hdr(HAZARD, 1.5), 'lamp');

  ringOfDebris(built, 12, PANEL_WHITE, 1.1, 0.5);
  ringOfDebris(built, 6, HAZARD, 0.8, 1.0);
  return finish(built, HAZARD, 2.6);
}

// ---- descender core -----------------------------------------------------------
// The walker itself: a ribbed drum of hull plate with a shell that splits open
// on the first stage break and a working eye that never stops looking at you.
export function createDescenderCoreMesh() {
  const built = build();

  const drumGeometry = new CylinderGeometry(11, 13, 17, 8, 1);
  drumGeometry.rotateX(Math.PI / 2);
  const drum = new Mesh(drumGeometry, new MeshBasicMaterial({}));
  panel(built, drum, PANEL_WHITE.clone().multiplyScalar(0.72));
  outline(built, drum, hdr(PANEL_DARK, 0.55), 1.002);

  for (let i = 0; i < 4; i += 1) {
    const rib = new Mesh(new TorusGeometry(11.6 - i * 0.5, 0.55, 5, 8), new MeshBasicMaterial());
    rib.position.z = 6 - i * 4;
    panel(built, rib, PANEL_GREY.clone().multiplyScalar(1.5));
  }

  const shell = new Group();
  shell.name = 'shell';
  for (const side of [-1, 1]) {
    const halfGeometry = new BoxGeometry(11, 20, 6);
    const half = new Mesh(halfGeometry, new MeshBasicMaterial());
    half.position.set(side * 6.5, 0, 7.5);
    half.rotation.z = side * 0.12;
    const material = half.material as MeshBasicMaterial;
    material.color.copy(PANEL_WHITE);
    built.parts.push({ material, base: PANEL_WHITE.clone(), kind: 'hull' });
    shell.add(half);
    const band = new Mesh(new BoxGeometry(11.2, 2.4, 6.2), new MeshBasicMaterial());
    band.position.set(side * 6.5, side * 5.5, 7.5);
    band.rotation.z = side * 0.12;
    const bandMaterial = band.material as MeshBasicMaterial;
    bandMaterial.color.copy(HAZARD);
    built.parts.push({ material: bandMaterial, base: HAZARD.clone(), kind: 'trim' });
    shell.add(band);
  }
  built.group.add(shell);

  const eye = new Mesh(new RingGeometry(2.4, 4.4, 8), new MeshBasicMaterial({ side: DoubleSide }));
  eye.position.z = 9.2;
  panel(built, eye, hdr(HAZARD, 0.9), 'lamp');
  eye.name = 'eye';

  const pupil = new Mesh(new CircleGeometry(2.1, 14), new MeshBasicMaterial({ side: DoubleSide }));
  pupil.position.z = 9.4;
  panel(built, pupil, hdr(HAZARD, 1.6), 'lamp');
  pupil.name = 'pupil';

  // Trailing gantry: the mass it drags behind it up the ribbon.
  for (let i = 0; i < 3; i += 1) {
    const boom = new Mesh(new BoxGeometry(1.2, 1.2, 14), new MeshBasicMaterial());
    const angle = (i / 3) * Math.PI * 2 + 0.4;
    boom.position.set(Math.cos(angle) * 9, Math.sin(angle) * 9, -14);
    panel(built, boom, PANEL_GREY);
  }

  ringOfDebris(built, 16, PANEL_WHITE, 3.2, 0.6);
  ringOfDebris(built, 10, HAZARD, 2.4, 1.2);
  built.group.userData.isDescenderCore = true;
  return finish(built, HAZARD, 4.6);
}

/** Split the walker's shell open — called when its first hit stage breaks. */
export function breakDescenderShell(mesh: Group) {
  const shell = mesh.getObjectByName('shell');
  if (!shell || shell.userData.broken) return;
  shell.userData.broken = true;
  for (const [index, half] of shell.children.entries()) {
    const side = index % 2 === 0 ? -1 : 1;
    half.position.x += side * 5.5;
    half.position.z -= 3;
    half.rotation.z += side * 0.7;
  }
}
