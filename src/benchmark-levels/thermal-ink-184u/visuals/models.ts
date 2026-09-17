import { BoxGeometry, BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, Group, Matrix4, Mesh, SphereGeometry, TorusGeometry, TubeGeometry, Vector3, type Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';

export function merged(parts: BufferGeometry[], material: Material) {
  const geometry = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  return new Mesh(geometry, material);
}
export function box(x: number, y: number, z: number, sx: number, sy: number, sz: number, angle = 0) {
  return new BoxGeometry(sx, sy, sz).rotateZ(angle).translate(x, y, z);
}
export function pipe(points: Vector3[], radius: number, material: Material) {
  return new Mesh(new TubeGeometry(new CatmullRomCurve3(points), 40, radius, 7, false), material);
}
function tapered(points: Vector3[], radius: number) {
  const curve = new CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(50, false);
  const positions: number[] = [], indices: number[] = [];
  for (let i = 0; i <= 50; i++) {
    const p = curve.getPointAt(i / 50);
    const r = radius * Math.pow(1 - i / 52, 0.7);
    for (let j = 0; j <= 10; j++) {
      const a = j / 10 * Math.PI * 2;
      const v = p.clone().addScaledVector(frames.normals[i], Math.cos(a) * r).addScaledVector(frames.binormals[i], Math.sin(a) * r);
      positions.push(v.x, v.y, v.z);
      if (i < 50 && j < 10) { const k = i * 11 + j; indices.push(k, k + 11, k + 1, k + 1, k + 11, k + 12); }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals();
  return { geometry: g, curve };
}
export function octopus(skin: Material, underside: Material, metal: Material, eye: Material) {
  const root = new Group();
  const mantle = new Mesh(new SphereGeometry(1, 36, 24), skin); mantle.scale.set(6.5, 8.4, 5.3); mantle.position.y = 3.4; root.add(mantle);
  const brow = new Mesh(new SphereGeometry(1, 24, 16), skin); brow.scale.set(7, 3.4, 4.5); brow.position.set(0, -0.8, 1.8); root.add(brow);
  for (const s of [-1, 1]) {
    const socket = new Mesh(new SphereGeometry(1, 16, 12), underside); socket.scale.set(1.7, 1.3, 0.7); socket.position.set(s * 3.9, 2.1, 4.8); root.add(socket);
    const iris = new Mesh(new SphereGeometry(1, 16, 12), eye); iris.scale.set(0.72, 0.94, 0.32); iris.position.set(s * 3.9, 2.1, 5.4); root.add(iris);
    const pupil = new Mesh(new BoxGeometry(0.15, 1.4, 0.1), metal); pupil.position.set(s * 3.9, 2.1, 5.72); root.add(pupil);
  }
  const arms: Group[] = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + Math.PI / 8;
    const tip = new Vector3(Math.cos(a) * 14.3, Math.sin(a) * 8.8 - 2, 10);
    const pts = [new Vector3(Math.cos(a) * 4, -2 + Math.sin(a) * 2, 1), new Vector3(Math.cos(a) * 9, Math.sin(a) * 6 - 3, 1), new Vector3(Math.cos(a) * 17, Math.sin(a) * 12 - 3, 5), tip, tip.clone().add(new Vector3(-Math.sin(a) * 2, Math.cos(a) * 2, 2))];
    const arm = new Group(); const tube = tapered(pts, 1.9); const armMesh = new Mesh(tube.geometry, skin); armMesh.name = `arm body ${i}`; arm.add(armMesh);
    const suckers: BufferGeometry[] = [];
    for (let j = 3; j < 23; j++) {
      const t = j / 25; const p = tube.curve.getPointAt(t); const r = 0.65 * (1 - t) + 0.15;
      for (const s of [-1, 1]) suckers.push(new TorusGeometry(r, r * 0.32, 5, 10).translate(p.x + s * r * 0.8, p.y, p.z + 1.45 * (1 - t)));
    }
    arm.add(merged(suckers, underside));
    root.add(arm); arms.push(arm);
  }
  const scars: BufferGeometry[] = [];
  for (let i = 0; i < 18; i++) scars.push(new SphereGeometry(0.15 + i % 3 * 0.12, 6, 4).translate(Math.sin(i * 2.4) * 4, 1 + (i % 6) * 1.5, 5 + Math.cos(i) * 0.2));
  root.add(merged(scars, underside));
  return { root, arms, mantle };
}
export function target(kind: string, flesh: Material, shell: Material, signal: Material, trim: Material) {
  const g = new Group(); const body: BufferGeometry[] = [], scrap: BufferGeometry[] = [];
  if (kind === 'crab') {
    body.push(new SphereGeometry(0.8, 12, 8).scale(1.4, 0.65, 0.7));
    scrap.push(box(0, 0.15, 0, 1.8, 0.6, 0.8, 0.15));
    for (const s of [-1, 1]) for (let j = 0; j < 3; j++) {
      body.push(box(s * (1.25 + j * 0.12), (j - 1) * 0.48, 0, 1.4, 0.18, 0.22, s * (j - 1) * 0.65));
      scrap.push(box(s * 1.9, (j - 1) * 0.85, 0, 0.4, 0.7, 0.3, s * 0.5));
    }
  } else if (kind === 'eel') {
    for (let i = 0; i < 7; i++) body.push(new SphereGeometry(0.55 - i * 0.055, 10, 6).translate(-i * 0.45, Math.sin(i * 0.9) * 0.45, 0));
    scrap.push(box(0.2, 0, 0, 1.1, 0.8, 0.7, 0.3), box(-1.2, 0.5, 0, 1.6, 0.12, 0.7, 0.35));
  } else if (kind === 'bell') {
    body.push(new SphereGeometry(1.05, 16, 10).scale(1, 0.75, 0.7));
    scrap.push(new TorusGeometry(1.1, 0.16, 6, 16));
    for (let j = 0; j < 5; j++) body.push(box((j - 2) * 0.35, -1.2, 0, 0.1, 1.9 - Math.abs(j - 2) * 0.3, 0.1, (j - 2) * 0.13));
  } else {
    const r = kind === 'core' ? 1.9 : 1.1;
    body.push(new SphereGeometry(r, 20, 14));
    scrap.push(new TorusGeometry(r * 1.25, 0.13, 6, 24));
  }
  g.add(merged(body, flesh), merged(scrap, shell));
  const r = kind === 'core' ? 1.2 : kind === 'arm' ? 0.62 : 0.28;
  const core = new Mesh(new SphereGeometry(r, 12, 8), signal); core.position.z = kind === 'core' ? 1.4 : 0.75; g.add(core);
  const ring = new Mesh(new TorusGeometry(kind === 'core' ? 2.6 : 1.65, 0.045, 4, 32), trim); ring.name = 'lock'; ring.visible = false; g.add(ring);
  return g;
}
export function letterMesh(char: string, face: Material, frame: Material) {
  const g = new Group(); const cells = glyphOnCells(char).map(c => box((c.x - 2) * 0.34, (3 - c.y) * 0.34, 0.14, 0.29, 0.29, 0.12));
  g.add(merged(cells, face));
  g.add(merged([box(0, -1.42, 0, 2.05, 0.09, 0.1), box(-1.08, 0, 0, 0.06, 2.8, 0.1), box(1.08, 0, 0, 0.06, 2.8, 0.1)], frame));
  g.userData.isLetter = true;
  return g;
}
export function transformGeometry(g: BufferGeometry, position: Vector3, angle: number) {
  return g.applyMatrix4(new Matrix4().makeRotationY(angle)).translate(position.x, position.y, position.z);
}
