import { BoxGeometry, BufferGeometry, Group, Mesh, PlaneGeometry, SphereGeometry, TorusGeometry, Vector3, type Material } from 'three';
import { box, merged, pipe, transformGeometry } from './models';

export function harbor(rust: Material, cream: Material, dark: Material, water: Material, lamp: Material) {
  const root = new Group();
  const steel: BufferGeometry[] = [], paint: BufferGeometry[] = [], black: BufferGeometry[] = [], lights: BufferGeometry[] = [];
  const sea = new Mesh(new PlaneGeometry(700, 700), water); sea.rotation.x = -Math.PI / 2; sea.position.y = -10; sea.name = 'harbor water'; root.add(sea);
  // Two half-submerged hulls pin the creature in the harbor's center.
  for (let k = 0; k < 2; k++) {
    const p = new Vector3(k ? 10 : -12, -7, -2); const a = k ? -0.7 : 0.4;
    for (const g of [box(0, 0, 0, 12, 5, 31), box(0, 3, -6, 10, 3, 14), box(0, 5.3, -6, 8, 1, 10)]) steel.push(transformGeometry(g, p, a));
    for (let j = 0; j < 10; j++) {
      paint.push(transformGeometry(box(0, 2.6, -14 + j * 3, 12.5, 0.16, 0.2), p, a));
      black.push(transformGeometry(box(-5.9, 0, -13 + j * 2.6, 0.15, 2.6, 0.9), p, a));
    }
    paint.push(transformGeometry(box(0, 3, 6, 12.6, 0.5, 11), p, a));
  }
  for (let i = 0; i < 20; i++) {
    const a = i * Math.PI * 2 / 20;
    const r = 61 + Math.sin(i * 4.7) * 6;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    const height = 14 + (i % 5) * 5;
    const p = new Vector3(x, 0, z);
    steel.push(transformGeometry(box(0, height / 2 - 4, 0, 1, height, 1), p, -a));
    paint.push(transformGeometry(box(0, height - 4, 0, 10, 0.65, 1), p, -a));
    lights.push(transformGeometry(box(-4, height - 4.5, 0, 1.5, 0.35, 0.8), p, -a));
    if (i % 2 === 0) {
      steel.push(transformGeometry(box(5, 0, 9, 14, 7, 10), p, -a));
      paint.push(transformGeometry(box(5, 3.6, 9, 14.3, 0.16, 10), p, -a));
      for (let j = 0; j < 6; j++) black.push(transformGeometry(box(j * 2 - 1, 0, 14.1, 0.08, 7, 0.1), p, -a));
    }
    // Gantry cranes, diagonal braces, and hanging cable silhouettes.
    if (i % 4 === 0) {
      steel.push(transformGeometry(box(0, 28, 0, 28, 1, 2), p, -a), transformGeometry(box(-8, 17, 0, 0.5, 24, 0.5, -0.55), p, -a));
      black.push(transformGeometry(box(11, 17, 0, 0.09, 21, 0.09), p, -a));
      paint.push(transformGeometry(box(0, 33, 0, 24, 0.35, 0.35), p, -a));
    }
  }
  // Broken pilings and rippled sodium reflections make the low passes readable.
  for (let i = 0; i < 70; i++) {
    const a = i * 2.399; const r = 27 + (i % 11) * 5;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (i % 3 === 0) steel.push(box(x, -3, z, 0.5, 4 + i % 5, 0.5, Math.sin(i) * 0.3));
    paint.push(box(x, -9.93 + (i % 3) * 0.012, z, 1 + i % 4, 0.025, 0.12));
  }
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9;
    const cable = pipe([new Vector3(Math.sin(a) * 7, -3, Math.cos(a) * 6), new Vector3(Math.sin(a) * 18, -6, Math.cos(a) * 20), new Vector3(Math.sin(a) * 35, -9, Math.cos(a) * 37), new Vector3(Math.sin(a) * 57, 8, Math.cos(a) * 58)], 0.10, dark);
    cable.name = 'dragged cable'; root.add(cable);
  }
  for (const [parts, material, name] of [[steel, rust, 'wrecks and gantries'], [paint, cream, 'hull paint'], [black, dark, 'cables'], [lights, lamp, 'lamps']] as const) {
    const mesh = merged(parts, material); mesh.name = name; root.add(mesh);
  }
  const ripples = new Group();
  for (let i = 0; i < 4; i++) {
    const ring = new Mesh(new TorusGeometry(12 + i * 5, 0.045, 3, 64), cream); ring.rotation.x = Math.PI / 2; ring.position.y = -9.85; ripples.add(ring);
  }
  root.add(ripples);
  return { root, ripples };
}

export function inkClouds(material: Material) {
  const root = new Group();
  const g = new SphereGeometry(1, 12, 8);
  for (let i = 0; i < 15; i++) {
    const m = new Mesh(g, material);
    const a = i * 2.399;
    m.position.set(Math.sin(a) * (2 + i % 4 * 3), Math.cos(a) * (1 + i % 3 * 3), -12 - i % 5);
    m.scale.set(4 + i % 3, 3 + i % 4, 2);
    root.add(m);
  }
  return root;
}
