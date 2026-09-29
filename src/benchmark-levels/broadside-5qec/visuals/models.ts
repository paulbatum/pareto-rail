import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, EdgesGeometry, Float32BufferAttribute, Group, InstancedMesh, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, OctahedronGeometry, TorusGeometry } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';

export type Palette = { hull: number; enemy: number; orange: number; crimson: number; cyan: number; white: number; gold: number; magenta: number; friendlyDark: number; enemyDark: number; panel: number; friendlyRim: number; enemyRim: number; nebulaBase: number; nebulaPink: number; nebulaGold: number; stars: number; socket: number; debris: number };
export const boxGeometry = new BoxGeometry(1, 1, 1);
const octa = new OctahedronGeometry(1, 0);
export function solid(color: number, hot = 1) { return new MeshBasicMaterial({ color: new Color(color).multiplyScalar(hot) }); }
export function box(parent: Group, size: [number, number, number], pos: [number, number, number], material: MeshBasicMaterial) {
  const mesh = new Mesh(boxGeometry, material); mesh.scale.set(...size); mesh.position.set(...pos); parent.add(mesh); return mesh;
}
function wedge(width: number, height: number, length: number) {
  const geometry = new BufferGeometry();
  const verts = [ [-width, -height, length * 0.5], [width, -height, length * 0.5], [width, height, length * 0.4], [-width, height, length * 0.4], [-width * 0.17, -height * 0.25, -length * 0.5], [width * 0.17, -height * 0.25, -length * 0.5], [width * 0.17, height * 0.2, -length * 0.5], [-width * 0.17, height * 0.2, -length * 0.5] ];
  geometry.setAttribute('position', new Float32BufferAttribute(verts.flat(), 3));
  geometry.setIndex([0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,0,4,7,0,7,3,1,2,6,1,6,5]);
  geometry.computeVertexNormals(); return geometry;
}
export function createCapitalShip(friendly: boolean, flagship: boolean, p: Palette) {
  const group = new Group();
  const hull = solid(friendly ? p.hull : p.enemy);
  const edge = solid(friendly ? p.white : p.orange, friendly ? 0.45 : 0.55);
  const light = solid(friendly ? p.cyan : p.orange, 1.5);
  const dark = solid(friendly ? p.friendlyDark : p.enemyDark);
  const geo = wedge(flagship ? 122 : 100, flagship ? 47 : 42, flagship ? 1540 : 1180);
  const body = new Mesh(geo, hull); body.name = flagship ? 'flagship-keel' : 'cruiser-hull'; group.add(body);
  const rims = new LineSegments(new EdgesGeometry(geo, 20), new LineBasicMaterial({ color: friendly ? p.friendlyRim : p.enemyRim })); group.add(rims);
  for (const side of [-1, 1]) {
    box(group, [25, 28, 700], [side * 97, -8, 30], dark);
    box(group, [3, 2, 790], [side * 112, 5, 20], light);
    for (let i = 0; i < 9; i++) {
      const z = 480 - i * 102;
      const turret = new Group(); turret.position.set(side * 103, 20, z);
      box(turret, [25, 17, 27], [0, 0, 0], dark);
      box(turret, [40, 4, 4], [side * 19, 3, -7], edge);
      box(turret, [40, 4, 4], [side * 19, 3, 7], edge);
      box(turret, [3, 5, 14], [side * 38, 3, 0], light);
      group.add(turret);
      box(group, [3, 9, 55], [side * 115, -18, z], edge);
    }
  }
  // Layered bridge, hangar apertures, armored outriggers and a visible engine bank.
  box(group, [105, 20, 160], [0, 52, 350], dark);
  box(group, [65, 35, 92], [0, 73, 388], hull);
  box(group, [69, 3, 5], [0, 80, 340], light);
  box(group, [3, 78, 3], [0, 125, 410], edge);
  for (let i = -2; i <= 2; i++) {
    box(group, [27, 27, 25], [i * 38, -5, flagship ? 765 : 588], dark);
    const engine = new Mesh(new CylinderGeometry(9, 11, 3, 10), light); engine.rotation.x = Math.PI / 2; engine.position.set(i * 38, -5, flagship ? 780 : 602); group.add(engine);
    box(group, [17, 13, 40], [i * 38, -5, flagship ? 803 : 624], solid(friendly ? p.cyan : p.crimson, 0.8));
  }
  for (let i = 0; i < 18; i++) {
    const z = 540 - i * 57;
    const w = Math.max(13, 87 - i * 3);
    for (const side of [-1, 1]) {
      box(group, [w * 0.8, 2, 44], [side * w * 0.5, 43 - i * 1.5, z], i % 3 ? hull : dark);
      box(group, [w * 0.8, 0.7, 0.8], [side * w * 0.5, 45 - i * 1.5, z - 22], edge);
      box(group, [3, 2, 3], [side * w, 47 - i * 1.5, z], light);
    }
  }
  if (flagship) {
    // Raised armor banks make a real open trench over the central keel.
    for (const side of [-1, 1]) {
      box(group, [45, 70, 1080], [side * 78, 52, -30], hull);
      box(group, [2, 2, 1090], [side * 55, 88, -30], light);
      for (let i = 0; i < 17; i++) {
        box(group, [12, 30, 22], [side * 51, 52, 480 - i * 64], dark);
        box(group, [2, 16, 2], [side * 43, 61, 480 - i * 64], edge);
      }
    }
  }
  group.updateMatrixWorld(true);
  const batches = new Map<MeshBasicMaterial, Mesh[]>();
  group.traverse((o) => { if (o instanceof Mesh && o.geometry === boxGeometry) { const m = o.material as MeshBasicMaterial; const list = batches.get(m) ?? []; list.push(o); batches.set(m, list); } });
  for (const [material, meshes] of batches) {
    const batch = new InstancedMesh(boxGeometry, material, meshes.length);
    meshes.forEach((mesh, i) => { batch.setMatrixAt(i, mesh.matrixWorld); mesh.removeFromParent(); });
    group.add(batch);
  }
  return group;
}
export function createCraft(kind: string, p: Palette, letter?: string) {
  const group = new Group();
  const body = solid(p.enemy), rim = solid(p.orange), core = solid(p.crimson, 1.5), white = solid(p.white, 1.3);
  if (kind === 'letter') {
    const panel = box(group, [2.35, 3.05, 0.24], [0, 0, -0.1], solid(p.panel));
    panel.userData.panel = true;
    for (const { x, y } of glyphOnCells(letter ?? 'A')) box(group, [0.27, 0.28, 0.12], [(x - 2) * 0.37, (3 - y) * 0.37, 0.13], white);
    for (const side of [-1, 1]) {
      box(group, [0.1, 3.2, 0.12], [side * 1.28, 0, 0], solid(p.cyan));
      box(group, [0.6, 0.08, 0.12], [side * 0.98, -1.6, 0], solid(p.cyan));
    }
  } else if (kind === 'dart') {
    const mesh = new Mesh(wedge(3.2, 0.48, 6.3), body); group.add(mesh);
    box(group, [6.8, 0.16, 0.35], [0, 0.15, 0.7], rim);
    box(group, [0.65, 0.4, 3], [0, 0.6, 0], core);
    for (const s of [-1, 1]) box(group, [0.3, 0.3, 2.8], [s * 2.6, 0, 1], rim);
  } else if (kind === 'helix') {
    group.add(new Mesh(octa, body)); group.children[0].scale.set(2, 2, 3);
    for (let i = 0; i < 3; i++) {
      const wing = new Group(); wing.rotation.z = i * Math.PI * 2 / 3;
      box(wing, [0.55, 4.5, 1.6], [0, 2.4, 0], body);
      box(wing, [0.25, 4.4, 0.2], [0, 2.4, 0.9], rim); group.add(wing);
    }
    group.add(new Mesh(new TorusGeometry(2.05, 0.16, 4, 18), core));
  } else if (kind === 'bomber') {
    box(group, [5.2, 2.6, 4.8], [0, 0, 0], body);
    for (const s of [-1, 1]) { box(group, [2.2, 2, 6], [s * 3.8, -0.2, 0.4], body); box(group, [1.6, 0.25, 4.8], [s * 3.8, 0.9, 0.2], rim); }
    box(group, [4.2, 0.55, 0.5], [0, 0.5, -2.6], core);
  } else if (kind === 'bolt') {
    group.add(new Mesh(new OctahedronGeometry(1.1), core));
    const ring = new Mesh(new TorusGeometry(1.8, 0.12, 4, 12), rim); group.add(ring);
  } else if (kind === 'turret') {
    box(group, [6, 3.5, 4], [0, 0, 0], body);
    for (const s of [-1, 1]) { box(group, [1, 1, 6], [s * 2, 1, -2], rim); box(group, [1.2, 1.2, 0.3], [s * 2, 1, -5], core); }
    box(group, [5, 0.3, 1], [0, -1.9, -1.8], rim);
  } else {
    const large = kind === 'power';
    const cage = new Mesh(new TorusGeometry(large ? 5 : 4.5, 0.65, 5, 8), body); group.add(cage);
    group.add(new Mesh(new TorusGeometry(large ? 4.2 : 3.8, 0.18, 4, 24), rim));
    const orb = new Mesh(new OctahedronGeometry(large ? 2.7 : 2), core); group.add(orb);
    if (large) for (const s of [-1, 1]) { const armor = box(group, [1.5, 5.5, 0.6], [s * 1.9, 0, 2.2], rim); armor.name = s < 0 ? 'armor-left' : 'armor-right'; }
    for (const s of [-1, 1]) { box(group, [1.5, 7, 1.4], [s * 4, 0, 0], body); box(group, [0.35, 5, 0.4], [s * 4, 0, 1], rim); }
  }
  // Four acquisition brackets have geometry even at bloom zero.
  const brackets = new Group(); brackets.name = 'acquisition'; brackets.visible = false;
  const r = kind === 'letter' ? 1.9 : kind === 'generator' || kind === 'power' ? 6.8 : 5.5;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    box(brackets, [r * 0.45, 0.13, 0.13], [sx * r, sy * r, 0.4], solid(p.cyan, 1.8));
    box(brackets, [0.13, r * 0.45, 0.13], [sx * r, sy * r, 0.4], solid(p.cyan, 1.8));
  }
  group.add(brackets); group.userData.kind = kind; group.userData.core = core; group.userData.rim = rim;
  return group;
}
