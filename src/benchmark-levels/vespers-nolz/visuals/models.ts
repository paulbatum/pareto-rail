import { BoxGeometry, CircleGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, Shape, ShapeGeometry } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';

function silhouette(points: number[][], mat: MeshBasicMaterial) {
  const s = new Shape(); points.forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); s.closePath();
  return new Mesh(new ShapeGeometry(s), mat);
}
export function buildThief(kind: string, colors: number[], letter?: string) {
  const group = new Group();
  const black = new MeshBasicMaterial({ color: 0x010103, side: DoubleSide });
  const core = new MeshBasicMaterial({ color: new Color(colors[0]).multiplyScalar(1.7), side: DoubleSide });
  const rim = new MeshBasicMaterial({ color: 0x88827c, side: DoubleSide });
  group.userData.core = core;
  if (kind === 'letter') {
    const panel = silhouette([[-1.1, -1.4], [1.1, -1.4], [1.1, 0.9], [0, 1.65], [-1.1, 0.9]], black); panel.position.z = -0.13; group.add(panel);
    for (const { x, y } of glyphOnCells(letter ?? 'A')) {
      const m = new Mesh(new BoxGeometry(0.25, 0.25, 0.06), core); m.position.set((x - 2) * 0.3, (3 - y) * 0.3, 0.05); group.add(m);
    }
    for (const x of [-0.95, 0.95]) { const m = new Mesh(new BoxGeometry(0.025, 2.6, 0.05), rim); m.position.x = x; group.add(m); }
  } else if (kind === 'moth') {
    for (const side of [-1, 1]) {
      const wing = silhouette([[0, 0.2], [side * 2.8, 1.6], [side * 2.1, -0.3], [side * 1.1, -1.2], [0, -0.4]], black); wing.name = side < 0 ? 'left' : 'right'; group.add(wing);
      const seam = silhouette([[side * 0.4, 0], [side * 2.3, 1.22], [side * 1.2, 0.24]], core); seam.position.z = -0.02; wing.add(seam);
    }
    group.add(silhouette([[0, 1], [0.5, 0], [0, -1.3], [-0.5, 0]], black));
  } else if (kind === 'shroud') {
    group.add(silhouette([[0, 2.6], [0.95, 1.3], [1.4, -2], [0.65, -1.4], [0, -2.8], [-0.6, -1.5], [-1.4, -2], [-0.95, 1.3]], black));
    for (const side of [-1, 1]) { const arm = silhouette([[side * 0.6, 1.2], [side * 2.3, -0.2], [side * 1.8, -1.8], [side * 1.2, -0.2]], black); arm.name = 'veil'; group.add(arm); }
    const halo = new Mesh(new RingGeometry(0.5, 0.54, 32), rim); halo.position.set(0, 1.55, 0.02); group.add(halo);
  } else if (kind === 'thurible') {
    group.add(silhouette([[-1.7, 0.3], [0, 1.35], [1.7, 0.3], [1.1, -1.3], [0, -2], [-1.1, -1.3]], black));
    for (const x of [-0.85, 0, 0.85]) { const chain = new Mesh(new BoxGeometry(0.04, 2.4, 0.02), rim); chain.position.set(x * 0.6, 1.8, 0); chain.rotation.z = x * 0.18; group.add(chain); }
    const cap = new Mesh(new RingGeometry(1.3, 1.4, 4), rim); cap.scale.y = 0.6; cap.position.y = -0.2; group.add(cap);
  } else {
    group.add(new Mesh(new CircleGeometry(8.6, 48), black));
    const crown = new Group(); crown.name = 'crown'; group.add(crown);
    for (let i = 0; i < 12; i++) {
      const petal = silhouette([[-0.9, 2.1], [-2, 5.2], [-0.6, 10.6], [0, 8.8], [0.6, 10.6], [2, 5.2], [0.9, 2.1]], black); petal.rotation.z = i * Math.PI / 6; crown.add(petal);
      const jewel = new Mesh(new RingGeometry(4.4, 5.7, 4, 1, 0.06, 0.34), new MeshBasicMaterial({ color: new Color(colors[i % 4]).multiplyScalar(1.4), side: DoubleSide })); jewel.rotation.z = i * Math.PI / 6; jewel.position.z = 0.1; crown.add(jewel);
    }
    for (let i = 0; i < 3; i++) {
      const seal = new Mesh(new RingGeometry(2.1 + i * 1.5, 2.18 + i * 1.5, 12), core); seal.name = 'seal' + i; seal.position.z = 0.15; group.add(seal);
    }
  }
  if (kind !== 'letter') {
    const heart = silhouette([[0, 0.85], [0.46, 0], [0, -0.8], [-0.46, 0]], core); heart.position.z = 0.22; heart.scale.setScalar(kind === 'vesper' ? 2.4 : 1); group.add(heart);
    const split = new Mesh(new BoxGeometry(0.05, kind === 'vesper' ? 3.4 : 1.2, 0.02), black); split.position.z = 0.25; group.add(split);
  }
  const lock = new Group(); lock.name = 'lock'; lock.visible = false;
  const r = kind === 'vesper' ? 2.8 : 1.55;
  for (let i = 0; i < 4; i++) {
    const arc = new Mesh(new RingGeometry(r, r + 0.065, 8, 1, i * Math.PI / 2 + 0.15, 0.7), new MeshBasicMaterial({ color: 0xe9dfc6, side: DoubleSide, depthTest: false })); arc.position.z = 0.3; lock.add(arc);
  }
  group.add(lock);
  return group;
}
