import { BoxGeometry, CylinderGeometry, DoubleSide, EdgesGeometry, Group, InstancedMesh, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, RingGeometry, TetrahedronGeometry, TorusGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { FACES } from '../timing';

export type Palette = { colors: number[]; ink: number; white: number; metal: number; casing: number; void: number };
export function frame(size: number, width: number, color: number) {
  const root = new Group();
  const material = new MeshBasicMaterial({ color });
  const geometry = new BoxGeometry(1, 1, 0.025);
  for (const sign of [-1, 1]) {
    const h = new Mesh(geometry, material); h.scale.set(size, width, 1); h.position.y = sign * size / 2;
    const v = new Mesh(geometry, material); v.scale.set(width, size, 1); v.position.x = sign * size / 2;
    root.add(h, v);
  }
  return root;
}
export function brackets(size: number, color: number) {
  const root = new Group(), geo = new BoxGeometry(1, 1, 0.05), mat = new MeshBasicMaterial({ color });
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    const h = new Mesh(geo, mat); h.scale.set(0.43, 0.12, 1); h.position.set(x * (size / 2 - 0.16), y * size / 2, 0);
    const v = new Mesh(geo, mat); v.scale.set(0.12, 0.43, 1); v.position.set(x * size / 2, y * (size / 2 - 0.16), 0);
    root.add(h, v);
  }
  return root;
}
export function createGlyph(letter: string, palette: Palette) {
  const root = new Group();
  const plate = new Mesh(new RoundedBoxGeometry(1.65, 2.15, 0.3, 2, 0.1), new MeshStandardMaterial({ color: palette.white, roughness: 0.45 }));
  root.add(plate);
  const geo = new BoxGeometry(0.20, 0.20, 0.09), mat = new MeshBasicMaterial({ color: palette.ink });
  for (const { x, y } of glyphOnCells(letter)) {
    const cell = new Mesh(geo, mat); cell.position.set((x - 2) * 0.255, (3 - y) * 0.255, 0.20); root.add(cell);
  }
  const underline = new Mesh(new BoxGeometry(1.25, 0.08, 0.06), new MeshBasicMaterial({ color: palette.colors['STARTREPLY'.indexOf(letter) % 6] ?? palette.colors[0] }));
  underline.position.set(0, -0.99, 0.19); root.add(underline);
  const lock = brackets(2.4, palette.ink); lock.scale.set(0.81, 1, 1); lock.position.z = 0.25; lock.visible = false; root.add(lock);
  root.userData.lockFrame = lock;
  return root;
}
export function createTarget(kind: string, palette: Palette, letter?: string) {
  if (kind === 'letter') return createGlyph(letter ?? 'S', palette);
  const root = new Group();
  const paint = new MeshStandardMaterial({ color: palette.colors[0], roughness: 0.30, metalness: 0.15, flatShading: true });
  const porcelain = new MeshStandardMaterial({ color: palette.white, metalness: 0.3, roughness: 0.35 });
  const dark = new MeshBasicMaterial({ color: palette.ink });
  root.userData.paint = paint;
  if (kind === 'square') {
    const rim = brackets(4.25, palette.ink); root.add(rim);
    const lights = brackets(3.97, palette.white); lights.position.z = 0.055; root.add(lights);
    ((lights.children[0] as Mesh).material as MeshBasicMaterial).color.multiplyScalar(1.6);
    const inset = new Mesh(new BoxGeometry(0.43, 0.43, 0.035), dark); inset.rotation.z = Math.PI / 4; root.add(inset);
    const dot = new Mesh(new BoxGeometry(0.18, 0.18, 0.05), new MeshBasicMaterial({ color: palette.white })); dot.position.z = 0.045; root.add(dot);
    root.userData.pulse = lights;
  } else if (kind === 'spindle') {
    const axle = new Mesh(new CylinderGeometry(0.75, 0.75, 1.1, 12), paint); axle.rotation.x = Math.PI / 2; root.add(axle);
    root.add(new Mesh(new TorusGeometry(1.12, 0.18, 6, 20), porcelain));
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const tooth = new Mesh(new BoxGeometry(0.38, 0.52, 0.55), porcelain);
      tooth.position.set(Math.cos(a) * 1.42, Math.sin(a) * 1.42, 0); tooth.rotation.z = a; root.add(tooth);
    }
    const cross = frame(0.62, 0.10, palette.white); cross.position.z = 0.62; root.add(cross);
  } else if (kind === 'core') {
    const body = new Mesh(new RoundedBoxGeometry(2.6, 2.6, 2.6, 2, 0.2), porcelain); root.add(body);
    const inside = new Mesh(new OctahedronGeometry(2.05, 0), paint); root.add(inside);
    for (let i = 0; i < 3; i++) {
      const hoop = new Mesh(new TorusGeometry(2.4 + i * 0.20, 0.07, 6, 40), dark);
      hoop.rotation.set(i * 0.7, i * 1.05, i * 0.3); root.add(hoop);
    }
  } else if (kind === 'bolt') {
    const body = new Mesh(new OctahedronGeometry(0.6, 0), paint); body.scale.set(0.8, 0.8, 1.4); root.add(body);
    root.add(new Mesh(new TorusGeometry(0.75, 0.065, 4, 16), dark));
  } else {
    const geo = kind === 'tetra' ? new TetrahedronGeometry(1.35, 0) : kind === 'octa' ? new OctahedronGeometry(1.15, 0) : new CylinderGeometry(0.85, 0.85, 2.0, 3);
    const body = new Mesh(geo, paint); root.add(body);
    root.add(new LineSegments(new EdgesGeometry(geo), new LineBasicMaterial({ color: palette.ink })));
    if (kind === 'tetra') {
      const fin = new Mesh(new TetrahedronGeometry(0.70, 0), porcelain); fin.position.set(0, -0.2, -0.8); root.add(fin);
    } else if (kind === 'octa') {
      const orbit = new Mesh(new TorusGeometry(1.47, 0.065, 5, 24), porcelain); orbit.rotation.x = 0.5; root.add(orbit);
    } else {
      for (const y of [-1.08, 1.08]) {
        const cap = new Mesh(new CylinderGeometry(1.04, 1.04, 0.19, 3), porcelain); cap.position.y = y; root.add(cap);
      }
    }
    const eye = new Mesh(new BoxGeometry(0.22, 0.22, 0.12), dark); eye.position.z = 1.05; root.add(eye);
  }
  const lock = brackets(kind === 'square' ? 3.3 : kind === 'core' ? 5.8 : kind === 'spindle' ? 3.6 : 3.05, palette.ink);
  lock.position.z = kind === 'square' ? 0.15 : kind === 'core' ? 3 : 1.6;
  lock.visible = false; root.add(lock); root.userData.lockFrame = lock;
  const confirm = frame(kind === 'square' ? 3.5 : 2.7, 0.04, palette.white);
  confirm.position.z = lock.position.z + 0.04; confirm.visible = false; root.add(confirm); root.userData.confirm = confirm;
  return root;
}
export function createCube(palette: Palette) {
  const root = new Group();
  const cases = new InstancedMesh(new RoundedBoxGeometry(4.96, 4.96, 1.3, 2, 0.16), new MeshStandardMaterial({ color: palette.casing, roughness: 0.4, metalness: 0.26 }), 54);
  const tiles = new InstancedMesh(new RoundedBoxGeometry(4.60, 4.60, 0.20, 2, 0.13), new MeshBasicMaterial(), 54);
  cases.name = 'Cubie housings'; tiles.name = 'Colored tiles';
  cases.frustumCulled = false; tiles.frustumCulled = false;
  root.add(cases, tiles);
  const machine = new Group(); machine.name = 'Inner machine'; root.add(machine);
  const chassis = new Group(); chassis.name = 'Outer chassis'; machine.add(chassis);
  const white = new MeshStandardMaterial({ color: palette.white, roughness: 0.35, metalness: 0.35 });
  const metal = new MeshStandardMaterial({ color: palette.metal, roughness: 0.33, metalness: 0.6 });
  const strutGeo = new BoxGeometry(0.32, 0.32, 12.7);
  for (let axis = 0; axis < 3; axis++) for (const a of [-1, 1]) for (const b of [-1, 1]) {
    const strut = new Mesh(strutGeo, white);
    strut.name = 'Frame strut';
    if (axis === 0) strut.position.set(a * 6.35, b * 6.35, 0);
    if (axis === 1) { strut.rotation.y = Math.PI / 2; strut.position.set(0, a * 6.35, b * 6.35); }
    if (axis === 2) { strut.rotation.x = Math.PI / 2; strut.position.set(a * 6.35, 0, b * 6.35); }
    chassis.add(strut);
  }
  const gears: Group[] = [], sockets: Group[] = [];
  for (const face of FACES) {
    const socket = new Group(); socket.position.copy(face.normal).multiplyScalar(5.0); socket.quaternion.copy(face.quaternion);
    socket.name = `Socket ${gears.length}`;
    sockets.push(socket);
    const gear = new Group(); socket.add(gear); gears.push(gear);
    gear.add(new Mesh(new TorusGeometry(3.35, 0.19, 6, 32), white));
    gear.add(new Mesh(new TorusGeometry(2.8, 0.075, 5, 32), metal));
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      const cog = new Mesh(new BoxGeometry(0.55, 0.65, 0.6), i % 3 ? white : metal);
      cog.position.set(Math.cos(a) * 3.4, Math.sin(a) * 3.4, 0); cog.rotation.z = a; gear.add(cog);
    }
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const arm = new Mesh(new BoxGeometry(0.3, 4.8, 0.3), metal); arm.rotation.z = a;
      arm.position.set(-Math.sin(a) * 4.2, Math.cos(a) * 4.2, -0.3); socket.add(arm);
    }
    machine.add(socket);
  }
  const heart = new Group(); heart.name = 'Core gimbals'; machine.add(heart);
  const center = new Mesh(new RoundedBoxGeometry(2.5, 2.5, 2.5, 2, 0.16), white); heart.add(center);
  const hoops: Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const hoop = new Mesh(new TorusGeometry(2.4 + i * 0.35, 0.10, 6, 40), i === 1 ? white : metal);
    hoop.rotation.set(i * 0.6, i * 1.1, 0); heart.add(hoop); hoops.push(hoop);
  }
  return { root, cases, tiles, machine, chassis, sockets, gears, heart, hoops, center };
}
