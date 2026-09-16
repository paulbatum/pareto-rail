import { AmbientLight, BoxGeometry, BufferGeometry, Float32BufferAttribute, CatmullRomCurve3, Color, CylinderGeometry, DirectionalLight, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, RingGeometry, Shape, ShapeGeometry, TubeGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type Pane = { group: Group; material: MeshBasicMaterial; spill: MeshBasicMaterial; base: Color; value: number; goal: number; restored: boolean };
export function buildCathedral(colors: number[], roseZ: number, stoneColor: number) {
  const root = new Group(); const stones: BufferGeometry[] = [];
  const stone = new MeshStandardMaterial({ color: stoneColor, roughness: 1, metalness: 0.15 });
  function box(w: number, h: number, d: number, x: number, y: number, z: number) { stones.push(new BoxGeometry(w, h, d).translate(x, y, z)); }
  function rib(points: Vector3[], radius: number) { stones.push(new TubeGeometry(new CatmullRomCurve3(points), 24, radius, 5, false)); }
  box(62, 1, 430, 0, -17, -190);
  for (const side of [-1, 1]) {
    box(2, 60, 420, side * 25, 12, -190);
    for (const y of [-10, 12, 18, 32]) box(3, 0.6, 420, side * 21.5, y, -190);
  }
  const panes: Pane[] = [];
  for (let bay = 0; bay < 22; bay++) {
    const z = -18 - bay * 18;
    for (const side of [-1, 1]) {
      for (const dx of [-1, 0, 1]) stones.push(new CylinderGeometry(dx === 0 ? 0.9 : 0.36, dx === 0 ? 1.3 : 0.5, 48, 8).translate(side * (20 + dx * 0.65), 7, z - 8));
      box(4, 1, 4, side * 20, -15, z - 8);
      for (const y of [-3, 16, 29]) {
        rib([new Vector3(side * 20, y, z - 8), new Vector3(side * 20, y + 5, z - 5), new Vector3(side * 20, y + 7, z), new Vector3(side * 20, y + 5, z + 5), new Vector3(side * 20, y, z + 8)], 0.28);
      }
      for (let tier = 0; tier < 2; tier++) {
        const index = bay * 4 + (side > 0 ? 2 : 0) + tier;
        const group = new Group(); group.position.set(side * 23, tier ? 24 : 4, z); group.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        const base = new Color(colors[(bay + index % 4) % colors.length]);
        const material = new MeshBasicMaterial({ color: base, side: DoubleSide, vertexColors: true });
        const lead = new MeshBasicMaterial({ color: 0x050609, side: DoubleSide });
        const shape = new Shape(); shape.moveTo(-4, -6); shape.lineTo(4, -6); shape.lineTo(4, 2); shape.quadraticCurveTo(3.7, 5, 0, 7); shape.quadraticCurveTo(-3.7, 5, -4, 2); shape.closePath();
        const glass: BufferGeometry[] = [];
        const outline = new ShapeGeometry(shape).toNonIndexed();
        outline.setAttribute('color', new Float32BufferAttribute(Array.from({ length: outline.getAttribute('position').count * 3 }, () => 0.22), 3)); glass.push(outline);
        for (let row = 0; row < 6; row++) for (let col = 0; col < 4; col++) {
          const x = (col - 1.5) * 1.85, y = -5 + row * 1.65;
          if (row === 5 && (col === 0 || col === 3)) continue;
          const shard = new RingGeometry(0, 0.93, 4).toNonIndexed();
          shard.scale(0.91, 1.03, 1); shard.translate(x, y, 0.015);
          const shade = 0.55 + ((row * 3 + col * 7 + bay) % 7) * 0.11;
          shard.setAttribute('color', new Float32BufferAttribute(Array.from({ length: shard.getAttribute('position').count * 3 }, () => shade), 3)); glass.push(shard);
        }
        group.add(new Mesh(mergeGeometries(glass), material)); glass.forEach(g => g.dispose());
        for (let ix = -3; ix <= 3; ix += 2) { const m = new Mesh(new BoxGeometry(0.13, 11, 0.08), lead); m.position.set(ix, -0.5, 0.08); group.add(m); }
        for (let y = -5; y <= 3; y += 2) { const m = new Mesh(new BoxGeometry(8, 0.13, 0.08), lead); m.position.set(0, y, 0.09); group.add(m); }
        for (let y = -4; y <= 2; y += 3) {
          const m = new Mesh(new RingGeometry(1.1, 1.22, 4), lead); m.rotation.z = Math.PI / 4; m.position.set(0, y, 0.1); group.add(m);
        }
        const leading: BufferGeometry[] = [];
        for (const child of [...group.children]) {
          if (child instanceof Mesh && child.material === lead) {
            child.updateMatrix(); leading.push(child.geometry.clone().applyMatrix4(child.matrix));
            child.geometry.dispose(); group.remove(child);
          }
        }
        group.add(new Mesh(mergeGeometries(leading), lead)); leading.forEach(g => g.dispose());
        const spill = new MeshBasicMaterial({ color: base.clone().multiplyScalar(0.12), transparent: true, opacity: 0.5, side: DoubleSide, depthWrite: false });
        const wash = new Mesh(new PlaneGeometry(12, 19), spill); wash.position.z = -0.18; group.add(wash);
        root.add(group); panes[index] = { group, material, spill, base, value: 0.6, goal: 0.6, restored: false };
      }
    }
    rib([new Vector3(-20, 19, z - 8), new Vector3(-16, 30, z - 8), new Vector3(-8, 38, z - 8), new Vector3(0, 42, z - 8), new Vector3(8, 38, z - 8), new Vector3(16, 30, z - 8), new Vector3(20, 19, z - 8)], 0.38);
    for (const side of [-1, 1]) rib([new Vector3(side * 20, 20, z - 8), new Vector3(side * 12, 34, z), new Vector3(0, 42, z + 1)], 0.25);
  }
  box(0.35, 0.4, 420, 0, 42, -190);
  const merged = mergeGeometries(stones); root.add(new Mesh(merged, stone)); stones.forEach(g => g.dispose());
  const candleGeos: BufferGeometry[] = [], flameGeos: BufferGeometry[] = [];
  for (let i = 0; i < 1100; i++) {
    const row = Math.floor(i / 20), col = i % 20;
    const x = (col - 9.5) * 1.75, z = 8 - row * 7.5;
    const h = 0.22 + (i * 7 % 11) * 0.045;
    candleGeos.push(new CylinderGeometry(0.055, 0.075, h, 4).translate(x, -16.4 + h / 2, z));
    flameGeos.push(new PlaneGeometry(0.095, 0.22).translate(x, -16.35 + h, z));
  }
  root.add(new Mesh(mergeGeometries(candleGeos), new MeshBasicMaterial({ color: 0x38312a })));
  const candles = new Mesh(mergeGeometries(flameGeos), new MeshBasicMaterial({ color: new Color(0.75, 0.52, 0.25), side: DoubleSide })); root.add(candles);
  [...candleGeos, ...flameGeos].forEach(g => g.dispose());
  const rose = new Group(); rose.position.set(0, 0, roseZ); root.add(rose);
  const roseMaterials: MeshBasicMaterial[] = [];
  for (let ring = 0; ring < 3; ring++) {
    for (let i = 0; i < 24; i++) {
      const color = new Color(colors[(i + ring) % 4]);
      const mat = new MeshBasicMaterial({ color: color.clone().multiplyScalar(0.002), side: DoubleSide }); roseMaterials.push(mat);
      mat.userData.base = color;
      const wedge = new Mesh(new RingGeometry(2 + ring * 4.3, 5.9 + ring * 4.3, 3, 1, i * Math.PI / 12 + 0.026, Math.PI / 12 - 0.052), mat); rose.add(wedge);
    }
  }
  for (const r of [1.8, 6.1, 10.4, 14.7, 15.4]) rose.add(new Mesh(new RingGeometry(r, r + 0.22, 96), new MeshBasicMaterial({ color: 0x29292c, side: DoubleSide })));
  for (let i = 0; i < 24; i++) {
    const a = i * Math.PI / 12; const m = new Mesh(new RingGeometry(1.2, 1.32, 24), new MeshBasicMaterial({ color: 0x343236, side: DoubleSide })); m.position.set(Math.sin(a) * 16.4, Math.cos(a) * 16.4, 0); rose.add(m);
  }
  const ambient = new AmbientLight(0x8994b4, 0.65); root.add(ambient);
  const moon = new DirectionalLight(0xabb4ce, 1.1); moon.position.set(-5, 28, 4); root.add(moon);
  return { root, panes, rose, roseMaterials, ambient, candles };
}
