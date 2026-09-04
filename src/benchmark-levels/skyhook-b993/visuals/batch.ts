import { BufferAttribute, Matrix4, Mesh, MeshBasicMaterial } from 'three';
import type { BufferGeometry, Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function batchSolid(root: Object3D) {
  root.updateMatrixWorld(true);
  const inverse = new Matrix4().copy(root.matrixWorld).invert();
  const geometries: BufferGeometry[] = [];
  const meshes: Mesh<BufferGeometry, MeshBasicMaterial>[] = [];
  root.traverse(object => {
    if (!(object instanceof Mesh) || !(object.material instanceof MeshBasicMaterial)) return;
    for (let a: Object3D | null = object; a && a !== root; a = a.parent) if (a.userData.dynamic) return;
    if (object.material.transparent) return;
    const g = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    g.applyMatrix4(new Matrix4().multiplyMatrices(inverse, object.matrixWorld));
    const color = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) {
      const n = g.attributes.normal;
      const shade = 0.6 + 0.4 * Math.max(0, -n.getX(i) * 0.35 + n.getY(i) * 0.65 + n.getZ(i) * 0.7);
      color.set([object.material.color.r * shade, object.material.color.g * shade, object.material.color.b * shade], i * 3);
    }
    g.setAttribute('color', new BufferAttribute(color, 3));
    geometries.push(g); meshes.push(object as Mesh<BufferGeometry, MeshBasicMaterial>);
  });
  if (!geometries.length) return;
  const merged = mergeGeometries(geometries);
  for (const g of geometries) g.dispose();
  const disposed = new Set();
  for (const m of meshes) {
    m.removeFromParent();
    if (!disposed.has(m.geometry)) { m.geometry.dispose(); disposed.add(m.geometry); }
    if (!disposed.has(m.material)) { m.material.dispose(); disposed.add(m.material); }
  }
  if (merged) { const mesh = new Mesh(merged, new MeshBasicMaterial({ vertexColors: true })); mesh.name = root.name; root.add(mesh); }
}
