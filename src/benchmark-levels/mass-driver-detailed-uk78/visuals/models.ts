import {
  BoxGeometry,
  CircleGeometry,
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
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { Material, Object3D } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { MassDriverEnemyKind } from '../gameplay';
import { ARC_BLUE, GUNMETAL, GUNMETAL_LIGHT, HAZARD_AMBER, ION_WHITE, VOLT_VIOLET, hot } from './palette';

export type ChargePart = { material: MeshBasicMaterial; base: number };

function flat(color = GUNMETAL, opacity = 1) {
  return new MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: DoubleSide });
}

function edgeGeometry(geometry: BoxGeometry | CylinderGeometry | ConeGeometry, color = ARC_BLUE, intensity = 1) {
  return new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial({ color: hot(color, intensity), transparent: true, opacity: 0.9 }));
}

function addChargePart(root: Group, object: Object3D, material: MeshBasicMaterial, base = 1) {
  const parts = (root.userData.chargeParts ??= []) as ChargePart[];
  parts.push({ material, base });
  root.add(object);
}

function makeCore(radius: number, color = ION_WHITE, intensity = 2.2) {
  const group = new Group();
  const core = new Mesh(new SphereGeometry(radius, 12, 8), flat(hot(color, intensity)));
  const halo = new Mesh(new SphereGeometry(radius * 1.75, 12, 8), createAdditiveBasicMaterial({ color: hot(color, 0.8), opacity: 0.28 }));
  group.add(core, halo);
  return group;
}

function createCoil() {
  const root = new Group();
  const bodyGeometry = new CylinderGeometry(1.35, 1.35, 0.62, 6, 1, false);
  bodyGeometry.rotateX(Math.PI / 2);
  const body = new Mesh(bodyGeometry, flat());
  root.add(body, edgeGeometry(bodyGeometry, ARC_BLUE, 0.75));

  const lensMaterial = createAdditiveBasicMaterial({ color: hot(ARC_BLUE, 1.7), opacity: 0.95 });
  const lens = new Mesh(new TorusGeometry(0.62, 0.075, 6, 24), lensMaterial);
  lens.position.z = 0.38;
  addChargePart(root, lens, lensMaterial, 1.7);
  const eye = makeCore(0.18, ARC_BLUE, 2.1);
  eye.position.z = 0.41;
  root.add(eye);

  for (const side of [-1, 1]) {
    const hook = new Group();
    const arm = new Mesh(new BoxGeometry(0.2, 1.4, 0.22), flat(GUNMETAL_LIGHT));
    arm.position.set(side * 1.35, -0.15, -0.28);
    arm.rotation.z = side * 0.42;
    const edge = new Mesh(new BoxGeometry(0.055, 1.18, 0.25), createAdditiveBasicMaterial({ color: hot(VOLT_VIOLET, 0.8), opacity: 0.8 }));
    edge.position.copy(arm.position);
    edge.position.x += side * 0.13;
    edge.rotation.copy(arm.rotation);
    hook.add(arm, edge);
    root.add(hook);
  }
  const emitter = new Mesh(new CylinderGeometry(0.12, 0.18, 0.42, 8), flat(hot(ION_WHITE, 1.3)));
  emitter.rotation.x = Math.PI / 2;
  emitter.position.set(0, -0.95, 0.2);
  root.add(emitter);
  root.userData.lockRingScale = 1.1;
  return root;
}

function createThreader() {
  const root = new Group();
  const noseGeometry = new ConeGeometry(0.48, 3.4, 8);
  noseGeometry.rotateZ(-Math.PI / 2);
  const nose = new Mesh(noseGeometry, flat(GUNMETAL_LIGHT));
  root.add(nose, edgeGeometry(noseGeometry, ARC_BLUE, 0.65));
  const coreMaterial = createAdditiveBasicMaterial({ color: hot(ION_WHITE, 2.0), opacity: 0.96 });
  const core = new Mesh(new OctahedronGeometry(0.34, 0), coreMaterial);
  core.scale.set(1.7, 0.8, 0.8);
  core.position.x = 1.25;
  addChargePart(root, core, coreMaterial, 2.0);

  for (let index = 0; index < 3; index += 1) {
    const fin = new Mesh(new ConeGeometry(0.34, 1.15, 3), flat(GUNMETAL));
    fin.rotation.z = Math.PI / 2;
    fin.rotation.x = index / 3 * Math.PI * 2;
    fin.position.x = -1.25;
    root.add(fin);
  }
  const tail = new Mesh(new ConeGeometry(0.48, 2.8, 10, 1, true), createAdditiveBasicMaterial({ color: hot(VOLT_VIOLET, 0.9), opacity: 0.22, side: DoubleSide }));
  tail.rotation.z = -Math.PI / 2;
  tail.position.x = -2.4;
  root.add(tail);
  root.userData.lockRingScale = 1.0;
  return root;
}

function createCapacitor() {
  const root = new Group();
  const coreMaterial = createAdditiveBasicMaterial({ color: hot(VOLT_VIOLET, 1.9), opacity: 0.9 });
  const core = new Mesh(new CylinderGeometry(0.72, 0.72, 2.5, 16), coreMaterial);
  core.rotation.x = Math.PI / 2;
  core.name = 'capacitor-core';
  addChargePart(root, core, coreMaterial, 1.9);
  const coreHalo = new Mesh(new CylinderGeometry(1.05, 1.05, 2.35, 16, 1, true), createAdditiveBasicMaterial({ color: hot(VOLT_VIOLET, 0.7), opacity: 0.18, side: DoubleSide }));
  coreHalo.rotation.x = Math.PI / 2;
  root.add(coreHalo);

  for (let index = 0; index < 6; index += 1) {
    const angle = index / 6 * Math.PI * 2;
    const staveGeometry = new BoxGeometry(0.34, 0.5, 3.15);
    const stave = new Mesh(staveGeometry, flat(GUNMETAL));
    stave.position.set(Math.cos(angle) * 1.15, Math.sin(angle) * 1.15, 0);
    stave.rotation.z = angle;
    stave.name = 'capacitor-stave';
    stave.add(edgeGeometry(staveGeometry, ARC_BLUE, 0.48));
    root.add(stave);
  }
  for (const z of [-1.5, 1.5]) {
    const cap = new Mesh(new TorusGeometry(1.35, 0.22, 6, 18), flat(GUNMETAL_LIGHT));
    cap.position.z = z;
    root.add(cap);
  }
  root.userData.lockRingScale = 1.45;
  return root;
}

function createArc() {
  const root = new Group();
  const coreMaterial = createAdditiveBasicMaterial({ color: hot(ION_WHITE, 2.8), opacity: 1 });
  const core = new Mesh(new SphereGeometry(0.42, 10, 7), coreMaterial);
  addChargePart(root, core, coreMaterial, 2.8);
  const shellMaterial = new MeshBasicMaterial({ color: hot(ARC_BLUE, 1.6), wireframe: true, transparent: true, opacity: 0.78 });
  const shellA = new Mesh(new IcosahedronGeometry(0.8, 1), shellMaterial);
  shellA.name = 'arc-shell-a';
  const shellB = new Mesh(new IcosahedronGeometry(1.05, 0), shellMaterial.clone());
  shellB.name = 'arc-shell-b';
  root.add(shellA, shellB);
  root.userData.lockRingScale = 0.8;
  root.userData.hostileShot = true;
  return root;
}

function createInterlock() {
  const root = new Group();
  for (const sign of [-1, 1]) {
    const braceGeometry = new BoxGeometry(5.1, 0.68, 0.72);
    const brace = new Mesh(braceGeometry, flat(GUNMETAL_LIGHT));
    brace.rotation.z = sign * Math.PI / 4;
    brace.add(edgeGeometry(braceGeometry, HAZARD_AMBER, 0.9));
    root.add(brace);

    for (let index = -2; index <= 2; index += 1) {
      const chevron = new Mesh(new PlaneGeometry(0.32, 0.46), flat(hot(HAZARD_AMBER, 1.25)));
      chevron.position.set(index * 0.72, 0, 0.38);
      chevron.rotation.z = sign * Math.PI / 4;
      chevron.rotateZ(index % 2 === 0 ? 0.15 : -0.15);
      root.add(chevron);
    }
  }
  const cowl = new Mesh(new CylinderGeometry(1.18, 1.18, 0.8, 8), flat(GUNMETAL));
  cowl.geometry.rotateX(Math.PI / 2);
  cowl.name = 'interlock-cowl';
  cowl.add(edgeGeometry(cowl.geometry, HAZARD_AMBER, 1.1));
  root.add(cowl);
  const core = makeCore(0.55, ION_WHITE, 2.6);
  core.name = 'interlock-core';
  core.visible = false;
  core.position.z = 0.5;
  root.add(core);
  const halo = new Mesh(new RingGeometry(2.9, 3.12, 48), createAdditiveBasicMaterial({ color: hot(HAZARD_AMBER, 0.8), opacity: 0.35, side: DoubleSide }));
  halo.position.z = -0.1;
  root.add(halo);
  root.userData.lockRingScale = 2.3;
  root.userData.isInterlock = true;
  return root;
}

export function createHostileModel(kind: MassDriverEnemyKind) {
  const root = kind === 'coil'
    ? createCoil()
    : kind === 'threader'
      ? createThreader()
      : kind === 'capacitor'
        ? createCapacitor()
        : kind === 'arc'
          ? createArc()
          : createInterlock();
  root.userData.kind = kind;
  root.userData.baseScale = kind === 'interlock' ? 1 : kind === 'capacitor' ? 1.05 : 1;
  return root;
}

export function createLetterModel(character: string) {
  const root = new Group();
  const plate = new Mesh(new BoxGeometry(2.15, 2.8, 0.18), flat(GUNMETAL));
  const plateEdge = edgeGeometry(plate.geometry, ARC_BLUE, 0.7);
  root.add(plate, plateEdge);
  const cells = glyphOnCells(character);
  for (const cell of cells) {
    const cellRoot = new Group();
    const cellGeometry = new BoxGeometry(0.25, 0.25, 0.09);
    const cellMaterial = flat(GUNMETAL_LIGHT);
    const block = new Mesh(cellGeometry, cellMaterial);
    const routed = edgeGeometry(cellGeometry, ARC_BLUE, 1.25);
    cellRoot.position.set((cell.x - 2) * 0.34, (3 - cell.y) * 0.34, 0.18);
    cellRoot.add(block, routed);
    root.add(cellRoot);
  }
  root.userData.kind = 'letter';
  root.userData.lockRingScale = 1.05;
  return root;
}

export function createPlayerProjectile() {
  const root = new Group();
  const coreGeometry = new OctahedronGeometry(0.22, 0);
  coreGeometry.scale(0.55, 0.55, 3.1);
  const core = new Mesh(coreGeometry, flat(hot(ION_WHITE, 3)));
  const shellGeometry = new OctahedronGeometry(0.4, 0);
  shellGeometry.scale(0.65, 0.65, 2.7);
  const shell = new Mesh(shellGeometry, createAdditiveBasicMaterial({ color: hot(ARC_BLUE, 1.35), opacity: 0.48 }));
  root.add(core, shell);
  return root;
}

export function materialsIn(root: Object3D) {
  const materials: Material[] = [];
  root.traverse((child) => {
    if (!(child instanceof Mesh) && !(child instanceof LineSegments)) return;
    const value = child.material;
    if (Array.isArray(value)) materials.push(...value);
    else materials.push(value);
  });
  return materials;
}
