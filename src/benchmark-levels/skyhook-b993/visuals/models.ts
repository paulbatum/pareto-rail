import { BoxGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, OctahedronGeometry, RingGeometry, SphereGeometry, TorusGeometry } from 'three';
import type { ColorRepresentation, Object3D } from 'three';
import { batchSolid } from './batch';
import { glyphOnCells } from '../../../engine/glyphs';
export type Palette = { white: number; shadow: number; orange: number; dark: number; steel: number; lamp: number; ocean: number; land: number; cloud: number; atmosphere: number; stars: number; streak: number };
export function block(parent: Object3D, size: [number, number, number], position: [number, number, number], color: ColorRepresentation) {
  const mesh = new Mesh(new BoxGeometry(...size), new MeshBasicMaterial({ color }));
  mesh.position.set(...position); parent.add(mesh); return mesh;
}
export function ring(parent: Object3D, radius: number, width: number, color: ColorRepresentation, segments = 48) {
  const mesh = new Mesh(new RingGeometry(radius - width, radius, segments), new MeshBasicMaterial({ color, side: DoubleSide }));
  parent.add(mesh); return mesh;
}
export function lettering(text: string, color: ColorRepresentation, cellSize: number) {
  const group = new Group();
  const geometry = new BoxGeometry(cellSize * 0.81, cellSize * 0.81, cellSize * 0.12);
  const material = new MeshBasicMaterial({ color });
  for (let i = 0; i < text.length; i++) for (const cell of glyphOnCells(text[i])) {
    const m = new Mesh(geometry, material);
    m.position.set((i * 6 + cell.x - (text.length * 6 - 2) / 2) * cellSize, (3 - cell.y) * cellSize, 0);
    group.add(m);
  }
  return group;
}
export function buildLetter(letter: string, p: Palette) {
  const g = new Group();
  block(g, [1.65, 2.45, 0.16], [0, 0, -0.12], p.dark);
  block(g, [1.75, 0.09, 0.2], [0, 1.27, 0], p.orange);
  block(g, [1.75, 0.09, 0.2], [0, -1.27, 0], p.white);
  const pixels = lettering(letter, p.white, 0.27); g.add(pixels);
  for (const x of [-0.72, 0.72]) for (const y of [-1.08, 1.08]) block(g, [0.07, 0.07, 0.12], [x, y, 0.03], p.steel);
  pixels.userData.dynamic = true; batchSolid(g); g.userData.accent = pixels;
  return g;
}
export function buildEnemy(kind: string, p: Palette) {
  const g = new Group();
  const accent = new Group();
  const mechanism = new Group();
  if (kind === 'sail') {
    const body = new Mesh(new OctahedronGeometry(0.82), new MeshBasicMaterial({ color: p.dark })); body.scale.set(0.65, 0.8, 1.25); g.add(body);
    for (const side of [-1, 1]) {
      const wing = block(g, [2.4, 0.95, 0.12], [side * 1.32, 0.2, 0], p.white); wing.rotation.z = side * -0.3;
      const strip = block(accent, [2.35, 0.12, 0.14], [side * 1.34, -0.17, 0.1], p.orange); strip.rotation.z = side * -0.3;
      block(g, [0.06, 1.15, 0.2], [side * 1.75, 0.14, 0.08], p.shadow).rotation.z = side * -0.3;
    }
    block(accent, [0.3, 0.4, 0.2], [0, 0, 0.72], p.orange);
  } else if (kind === 'diver') {
    const body = new Mesh(new OctahedronGeometry(1.25), new MeshBasicMaterial({ color: p.white })); body.scale.set(0.62, 1.45, 0.6); g.add(body);
    block(g, [0.3, 1.3, 0.2], [0, 0.35, 0.62], p.dark);
    for (const side of [-1, 1]) {
      const fin = block(g, [1.2, 0.28, 0.28], [side * 0.8, -0.35, 0], p.shadow); fin.material.color.set(p.shadow); fin.rotation.z = side * -0.65;
      block(accent, [0.16, 1.4, 0.1], [side * 0.34, 0, 0.63], p.orange);
    }
    ring(accent, 0.36, 0.1, p.orange, 8).position.set(0, -0.78, 0.7);
  } else if (kind === 'satellite') {
    g.add(new Mesh(new SphereGeometry(0.8, 8, 6), new MeshBasicMaterial({ color: p.white })));
    for (const side of [-1, 1]) {
      block(g, [0.9, 0.12, 0.15], [side * 1.05, 0, 0], p.steel);
      block(g, [0.85, 2.8, 0.17], [side * 1.65, 0, 0], p.dark);
      for (let i = -2; i <= 2; i++) block(g, [0.77, 0.025, 0.05], [side * 1.65, i * 0.48, 0.12], p.steel);
      block(accent, [0.88, 0.12, 0.2], [side * 1.65, 1.4, 0], p.orange);
    }
    ring(accent, 0.52, 0.18, p.orange, 12).position.z = 0.78;
  } else if (kind === 'borer') {
    const body = new Mesh(new CylinderGeometry(0.95, 0.75, 1.8, 8), new MeshBasicMaterial({ color: p.white })); body.rotation.x = Math.PI / 2; g.add(body);
    for (let i = 0; i < 3; i++) {
      const spoke = new Group(); spoke.rotation.z = i * Math.PI * 2 / 3;
      block(spoke, [0.45, 1.8, 0.45], [0, 1, 0], p.shadow);
      block(spoke, [0.65, 0.45, 0.65], [0, 1.6, 0.1], p.orange); mechanism.add(spoke);
    }
    const drill = new Mesh(new OctahedronGeometry(0.8), new MeshBasicMaterial({ color: p.steel })); drill.scale.z = 1.8; g.add(drill);
    ring(accent, 0.73, 0.17, p.orange, 8).position.z = 0.95;
  } else if (kind === 'harvester') {
    // Six industrial clamp legs around a long armored carriage. Each stage sheds a pair of face plates.
    block(g, [7.4, 6.2, 7], [0, 0, -2], p.dark);
    for (const side of [-1, 1]) {
      block(g, [2.2, 7, 6], [side * 4, 0, -1.8], p.white);
      for (let j = 0; j < 3; j++) {
        const leg = new Group(); leg.position.set(side * 4.8, (j - 1) * 3.1, -j * 1.6);
        block(leg, [5.8, 0.65, 1], [side * 2.2, 0, 0], p.shadow).rotation.z = side * (j - 1) * 0.2;
        block(leg, [1, 2.4, 1.5], [side * 4.7, -0.6, 0], p.white);
        block(leg, [1.2, 0.6, 1.7], [side * 4.7, -1.65, 0], p.orange);
        const joint = new Mesh(new SphereGeometry(0.65, 8, 6), new MeshBasicMaterial({ color: p.steel })); leg.add(joint);
        leg.userData.phase = j * Math.PI * 0.7 + (side > 0 ? Math.PI : 0); mechanism.add(leg);
      }
      for (let i = 0; i < 6; i++) {
        const plate = block(g, [2.45, 0.8, 0.4], [side * 1.8, (i - 2.5) * 0.91, 1.75], i % 2 ? p.white : p.shadow);
        plate.userData.armorStage = i; plate.userData.dynamic = true;
      }
      for (let j = 0; j < 5; j++) block(g, [1.55, 0.12, 0.2], [side * 4, (j - 2) * 0.8, 1.4], p.dark);
    }
    const core = ring(accent, 1.45, 0.4, p.orange, 12); core.position.z = 2.2;
    ring(accent, 0.67, 0.18, p.lamp, 12).position.z = 2.3;
    const iris = block(g, [2.6, 2.6, 0.3], [0, 0, 2.5], p.steel); iris.visible = false; iris.userData.dynamic = true; g.userData.iris = iris;
    const label = lettering('06', p.dark, 0.18); label.position.set(0, 3.9, 1.5); g.add(label);
  } else {
    const bolt = new Mesh(new OctahedronGeometry(0.48), new MeshBasicMaterial({ color: p.orange })); bolt.scale.z = 2; accent.add(bolt);
    ring(g, 0.8, 0.06, p.white, 3);
  }
  accent.userData.dynamic = true; mechanism.userData.dynamic = true; g.add(accent, mechanism); batchSolid(g); g.userData.accent = accent; g.userData.mechanism = mechanism;
  return g;
}
