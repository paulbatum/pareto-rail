import {
  BoxGeometry, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DoubleSide, EdgesGeometry,
  Group, IcosahedronGeometry, InstancedMesh, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial,
  Object3D, OctahedronGeometry, RingGeometry, TorusGeometry, Vector3,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { ARC_BLUE, GUNMETAL, HAZARD_AMBER, ION_BLUE, ION_WHITE, STEEL, VIOLET, hdr } from './palette';

export type TintPart = { material: MeshBasicMaterial; base: Color; role: 'fill' | 'edge' | 'core' | 'hazard' };

function addFaceted(group: Group, geometry: BoxGeometry | ConeGeometry | CylinderGeometry | IcosahedronGeometry | OctahedronGeometry | TorusGeometry, options: { color?: Color; edge?: Color; opacity?: number; role?: TintPart['role']; name?: string } = {}) {
  const base = options.color ?? GUNMETAL;
  const material = new MeshBasicMaterial({ color: base, transparent: (options.opacity ?? 1) < 1, opacity: options.opacity ?? 1, side: DoubleSide });
  const mesh = new Mesh(geometry, material); mesh.name = options.name ?? ''; group.add(mesh);
  const edgeBase = options.edge ?? ION_BLUE;
  const edgeMaterial = new LineBasicMaterial({ color: hdr(edgeBase, 1.25), transparent: true, opacity: 0.86 });
  const edges = new LineSegments(new EdgesGeometry(geometry, 24), edgeMaterial); mesh.add(edges);
  const parts = (group.userData.tintParts ??= []) as TintPart[];
  parts.push({ material, base: base.clone(), role: options.role ?? 'fill' });
  return mesh;
}

function addGlow(group: Group, geometry: CircleGeometry | CylinderGeometry | IcosahedronGeometry | RingGeometry | TorusGeometry, color = ION_WHITE, opacity = 0.9, name = '') {
  const material = createAdditiveBasicMaterial({ color: hdr(color, 1.6), opacity, side: DoubleSide });
  const mesh = new Mesh(geometry, material); mesh.name = name; group.add(mesh);
  ((group.userData.tintParts ??= []) as TintPart[]).push({ material, base: color.clone(), role: 'core' });
  return mesh;
}

export function createCoilMesh() {
  const root = new Group();
  const pod = addFaceted(root, new CylinderGeometry(0.88, 1.02, 0.7, 6, 1, false), { edge: ARC_BLUE }); pod.rotation.x = Math.PI / 2;
  const eye = addGlow(root, new TorusGeometry(0.42, 0.075, 6, 18), ARC_BLUE, 0.95); eye.position.z = 0.42;
  const pupil = addGlow(root, new CircleGeometry(0.12, 10), ION_WHITE, 1); pupil.position.z = 0.46;
  for (const side of [-1, 1]) {
    const hook = addFaceted(root, new BoxGeometry(0.26, 1.25, 0.22), { edge: VIOLET });
    hook.position.set(side * 1.08, 0.55, -0.24); hook.rotation.z = side * 0.5;
    const claw = addFaceted(root, new BoxGeometry(0.5, 0.22, 0.28), { edge: VIOLET });
    claw.position.set(side * 1.34, 1.05, -0.24); claw.rotation.z = side * 0.55;
  }
  const emitter = addGlow(root, new IcosahedronGeometry(0.16, 0), VIOLET, 0.85); emitter.position.set(0, -0.73, 0.2);
  root.userData.kindScale = 1.15; return root;
}

export function createThreaderMesh() {
  const root = new Group();
  const nose = addFaceted(root, new ConeGeometry(0.42, 3.4, 6), { edge: ION_BLUE }); nose.rotation.z = -Math.PI / 2; nose.position.x = 0.55;
  const core = addGlow(root, new IcosahedronGeometry(0.24, 1), ION_WHITE, 1); core.position.x = 1.25;
  for (let i = 0; i < 3; i += 1) {
    const fin = addFaceted(root, new ConeGeometry(0.34, 1.0, 3), { edge: VIOLET });
    const angle = i * Math.PI * 2 / 3; fin.position.set(-1.15, Math.cos(angle) * 0.52, Math.sin(angle) * 0.52); fin.rotation.z = Math.PI / 2;
  }
  const tail = new Mesh(new ConeGeometry(0.48, 2.6, 8, 1, true), createAdditiveBasicMaterial({ color: hdr(VIOLET, 1.1), opacity: 0.3, side: DoubleSide }));
  tail.rotation.z = Math.PI / 2; tail.position.x = -2.2; root.add(tail);
  root.userData.ionTail = tail; root.userData.kindScale = 1.12; return root;
}

export function createCapacitorMesh() {
  const root = new Group();
  const core = addGlow(root, new CylinderGeometry(0.72, 0.72, 2.8, 12), VIOLET, 0.28, 'exposed-core'); core.rotation.x = Math.PI / 2;
  for (let i = 0; i < 6; i += 1) {
    const a = i * Math.PI / 3;
    const stave = addFaceted(root, new BoxGeometry(0.34, 0.38, 3.35), { edge: ION_BLUE, name: 'armor-stave' });
    stave.position.set(Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0); stave.rotation.z = a;
  }
  for (const z of [-1.55, 1.55]) {
    const cap = addFaceted(root, new TorusGeometry(1.08, 0.22, 6, 12), { edge: ARC_BLUE, name: 'end-cap' }); cap.position.z = z;
  }
  root.userData.kindScale = 1.1; return root;
}

export function createArcMesh() {
  const root = new Group();
  addGlow(root, new IcosahedronGeometry(0.3, 1), ION_WHITE, 1);
  for (let i = 0; i < 2; i += 1) {
    const shell = new Mesh(new IcosahedronGeometry(0.62 + i * 0.18, 1), new MeshBasicMaterial({ color: hdr(i ? VIOLET : ARC_BLUE, 1.35), wireframe: true, transparent: true, opacity: 0.72 }));
    shell.name = 'arc-shell'; shell.rotation.set(i * 0.6, i * 0.9, i * 0.4); root.add(shell);
  }
  root.userData.kindScale = 1.25; return root;
}

export function createInterlockMesh() {
  const root = new Group();
  const braceAngles = [-Math.PI / 4, Math.PI / 4];
  for (const angle of braceAngles) {
    const brace = addFaceted(root, new BoxGeometry(0.62, 4.5, 0.52), { edge: HAZARD_AMBER, name: 'brace' }); brace.rotation.z = angle;
  }
  const chevronMaterial = new MeshBasicMaterial({ color: hdr(HAZARD_AMBER, 1.15) });
  const chevrons = new InstancedMesh(new BoxGeometry(0.42, 0.13, 0.58), chevronMaterial, braceAngles.length * 5 * 2);
  const transform = new Object3D(); const zAxis = new Vector3(0, 0, 1); let chevronIndex = 0;
  for (const angle of braceAngles) for (let j = -2; j <= 2; j += 1) for (const side of [-1, 1]) {
    transform.position.set(side * 0.14, j * 0.72, 0.04).applyAxisAngle(zAxis, angle);
    transform.rotation.set(0, 0, angle + side * 0.55); transform.updateMatrix(); chevrons.setMatrixAt(chevronIndex++, transform.matrix);
  }
  chevrons.instanceMatrix.needsUpdate = true; chevrons.name = 'hazard-chevrons'; root.add(chevrons);
  ((root.userData.tintParts ??= []) as TintPart[]).push({ material: chevronMaterial, base: HAZARD_AMBER.clone(), role: 'hazard' });
  const cowl = addFaceted(root, new CylinderGeometry(1.04, 1.22, 0.75, 6), { color: STEEL, edge: HAZARD_AMBER, name: 'cowl' }); cowl.rotation.x = Math.PI / 2;
  const core = addGlow(root, new IcosahedronGeometry(0.62, 1), ION_WHITE, 1, 'actuator-core'); core.visible = false;
  const warning = addGlow(root, new RingGeometry(1.32, 1.44, 6), HAZARD_AMBER, 0.78); warning.position.z = 0.45;
  root.userData.isInterlock = true; root.userData.kindScale = 1.18; return root;
}

export function exposeArmor(root: Group) {
  root.userData.exposed = true;
  if (root.userData.kind === 'capacitor') {
    root.traverse((child) => {
      if (child.name === 'armor-stave') child.visible = false;
      if (child.name === 'exposed-core' && child instanceof Mesh && child.material instanceof MeshBasicMaterial) child.material.opacity = 0.95;
    });
  }
  if (root.userData.kind === 'interlock') root.traverse((child) => { if (child.name === 'cowl') child.visible = false; if (child.name === 'actuator-core') child.visible = true; });
}

export function createLetterMesh(character: string) {
  const root = new Group(); root.userData.isLetter = true;
  const plate = addFaceted(root, new BoxGeometry(1.9, 2.65, 0.22), { color: GUNMETAL, edge: ARC_BLUE }); plate.position.z = -0.14;
  const cellGeo = new BoxGeometry(0.23, 0.23, 0.12);
  const cellMat = new MeshBasicMaterial({ color: hdr(ARC_BLUE, 1.35) });
  for (const cell of glyphOnCells(character)) {
    const block = new Mesh(cellGeo, cellMat.clone()); block.position.set((cell.x - 2) * 0.3, (3 - cell.y) * 0.3, 0.08); root.add(block);
    ((root.userData.tintParts ??= []) as TintPart[]).push({ material: block.material as MeshBasicMaterial, base: ARC_BLUE.clone(), role: 'edge' });
  }
  for (let i = -2; i <= 2; i += 1) for (let j = -3; j <= 3; j += 1) {
    const cell = new Mesh(new RingGeometry(0.055, 0.065, 4), createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 0.35), opacity: 0.38 }));
    cell.position.set(i * 0.3, j * 0.3, 0.07); cell.rotation.z = Math.PI / 4; root.add(cell);
  }
  return root;
}

export function createPlayerProjectile() {
  const root = new Group();
  const core = new Mesh(new OctahedronGeometry(0.2, 0), new MeshBasicMaterial({ color: hdr(ION_WHITE, 2.4) })); core.scale.set(0.65, 0.65, 3.1); root.add(core);
  const shell = new Mesh(new OctahedronGeometry(0.36, 0), createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.25), opacity: 0.42 })); shell.scale.set(0.7, 0.7, 2.6); root.add(shell);
  const trail = new Mesh(new ConeGeometry(0.26, 3.2, 8, 1, true), createAdditiveBasicMaterial({ color: hdr(ARC_BLUE, 1.05), opacity: 0.24, side: DoubleSide }));
  trail.rotation.x = Math.PI / 2; trail.position.z = 1.85; root.add(trail);
  return root;
}
