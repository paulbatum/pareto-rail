import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, ConeGeometry, BufferGeometry, Float32BufferAttribute } from 'three';
import type { Material, Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
const cache = new Map<string, BufferGeometry>();
const mergedMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: .12 });
export function bake(group: Group) {
  group.updateMatrixWorld(true);
  const list: BufferGeometry[] = [];
  const meshes: Mesh[] = [];
  group.traverse(o => { if (o instanceof Mesh && o.material instanceof MeshStandardMaterial) {
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    const c = o.material.color;
    const data = [];
    const old = geo.getAttribute('color');
    for (let i = 0; i < geo.attributes.position.count; i++)
      data.push(c.r * (old ? old.getX(i) : 1), c.g * (old ? old.getY(i) : 1), c.b * (old ? old.getZ(i) : 1));
    geo.setAttribute('color', new Float32BufferAttribute(data, 3));
    list.push(geo);
    meshes.push(o);
  } });
  const geo = mergeGeometries(list);
  list.forEach(g => g.dispose());
  meshes.forEach(m => m.removeFromParent());
  if (geo)
    group.add(Object.assign(new Mesh(geo, mergedMaterial), { name: 'supply-or-scenery' }));
  return geo;
}
export const box = new BoxGeometry(1, 1, 1), sphere = new SphereGeometry(1, 16, 10);
export function piece(parent: Object3D, geometry: typeof box | typeof sphere, material: Material, p: number[], s: number[]) {
  const m = new Mesh(geometry, material);
  m.position.set(p[0], p[1], p[2]);
  m.scale.set(s[0], s[1], s[2]);
  parent.add(m);
  return m;
}
export function supply(type: number, color: number, wood: number, metal: number, ink: number) {
  const g = new Group();
  const key = [type % 8, color, wood, metal, ink].join(':');
  const cached = cache.get(key);
  if (cached) {
    g.add(new Mesh(cached, mergedMaterial));
    return g;
  }
  const mat = new MeshStandardMaterial({ color, roughness: .43, metalness: .1 });
  const timber = new MeshStandardMaterial({ color: wood, roughness: .85 });
  const steel = new MeshStandardMaterial({ color: metal, roughness: .28, metalness: .65 });
  if (type === 7) {
    const jar = new Mesh(new CylinderGeometry(.48, .43, 1.1, 18), mat);
    g.add(jar);
    const lid = new Mesh(new CylinderGeometry(.51, .51, .14, 18), steel);
    lid.position.y = .62;
    g.add(lid);
    piece(g, box, timber, [0, 0, .45], [.6, .5, .035]);
    piece(g, box, mat, [0, 0, .48], [.38, .12, .015]);
  }
  else if (type % 7 === 0) {
    const b = new Mesh(new CylinderGeometry(.55, .55, .16, 20), mat);
    b.rotation.x = Math.PI / 2;
    g.add(b);
    const rim = new Mesh(new TorusGeometry(.44, .025, 5, 20), timber);
    rim.position.z = .09;
    g.add(rim);
    const dark = new MeshStandardMaterial({ color: ink });
    for (const x of [-.13, .13])
      for (const y of [-.13, .13])
        piece(g, sphere, dark, [x, y, .09], [.064, .064, .04]);
  }
  else if (type % 7 === 1) {
    piece(g, sphere, mat, [0, 0, 0], [.34, .34, .34]);
    piece(g, sphere, steel, [.11, .14, .23], [.065, .065, .04]);
  }
  else if (type % 7 === 2) {
    const p = new Mesh(new CylinderGeometry(.105, .105, 2.3, 6), mat);
    g.add(p);
    const nib = new Mesh(new ConeGeometry(.105, .36, 6), timber);
    nib.position.y = 1.32;
    g.add(nib);
    piece(g, box, steel, [0, -1.05, 0], [.23, .18, .23]);
    piece(g, box, mat, [0, -1.25, 0], [.22, .22, .22]);
  }
  else if (type % 7 === 3) {
    const c = new Mesh(new CylinderGeometry(.3, .3, .7, 16), mat);
    g.add(c);
    for (const y of [-.4, .4]) {
      const r = new Mesh(new CylinderGeometry(.48, .48, .12, 16), timber);
      r.position.y = y;
      g.add(r);
    }
    for (let i = 0; i < 7; i++) {
      const r = new Mesh(new TorusGeometry(.305, .018, 4, 16), mat);
      r.rotation.x = Math.PI / 2;
      r.position.y = i * .09 - .27;
      g.add(r);
    }
  }
  else if (type % 7 === 4) {
    piece(g, box, timber, [0, 0, 0], [.5, 2.8, .13]);
    for (let i = 0; i < 12; i++)
      piece(g, box, steel, [-.15, i * .21 - 1.18, .08], [i % 3 === 0 ? .2 : .1, .024, .015]);
  }
  else if (type % 7 === 5) {
    piece(g, box, timber, [0, 0, 0], [1.2, .72, .13]);
    piece(g, box, mat, [0, 0, .08], [.83, .15, .015]);
  }
  else {
    const ring = new Mesh(new TorusGeometry(.32, .045, 5, 16), steel);
    ring.scale.y = 2;
    g.add(ring);
    const inner = new Mesh(new TorusGeometry(.2, .045, 5, 16, Math.PI * 1.6), steel);
    inner.scale.y = 2.5;
    inner.position.y = -.05;
    g.add(inner);
  }
  const merged = bake(g);
  if (merged)
    cache.set(key, merged);
  return g;
}
