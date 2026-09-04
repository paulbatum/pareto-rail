import { BoxGeometry, BufferGeometry, Color, ConeGeometry, DoubleSide, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, OctahedronGeometry, SphereGeometry, TorusGeometry, Vector3, CatmullRomCurve3, TubeGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import type { Palette } from './index';

export function makeTarget(kind: string, letter: string | undefined, p: Palette) {
  const group = new Group();
  const skin = new MeshBasicMaterial({ color: p.violet });
  const dark = new MeshBasicMaterial({ color: p.parasite });
  const bright = new MeshBasicMaterial({ color: new Color(p.pink).multiplyScalar(1.15), transparent: true, depthWrite: false });
  group.userData.materials = { skin, bright };
  group.userData.letter = !!letter;
  if (kind === 'letter' || letter) {
    const pieces = glyphOnCells(letter ?? 'A').map(cell => new BoxGeometry(0.26, 0.26, 0.13).translate((cell.x - 2) * 0.32, (3 - cell.y) * 0.32, 0));
    skin.color.set(p.gold); bright.color.set(p.strand);
    group.add(new Mesh(mergeGeometries(pieces), bright)); pieces.forEach(g => g.dispose());
    const back = new Mesh(new SphereGeometry(1.4, 28, 14), new MeshBasicMaterial({ color: p.letterShadow, transparent: true, opacity: 0.72, depthWrite: false })); back.scale.set(0.78, 1, 0.18); back.position.z = -0.2; group.add(back);
    const rim = new Mesh(new TorusGeometry(1.32, 0.022, 5, 48), skin); rim.scale.x = 0.78; group.add(rim);
    return group;
  }
  const body = new Group(); group.add(body);
  const core = new Mesh(new IcosahedronGeometry(kind === 'parent' ? 2.7 : 0.68, 1), dark); body.add(core);
  const eye = new Mesh(new SphereGeometry(kind === 'parent' ? 1.25 : 0.34, 14, 10), bright); eye.scale.z = 0.45; eye.position.z = kind === 'parent' ? 2.4 : 0.62; body.add(eye);
  if (kind === 'clasp' || kind === 'brood' || kind === 'parent') {
    const count = kind === 'parent' ? 10 : 6, size = kind === 'parent' ? 3 : 1;
    for (let i = 0; i < count; i++) {
      const a = i / count * Math.PI * 2;
      const curve = new CatmullRomCurve3([new Vector3(Math.cos(a) * 0.45, Math.sin(a) * 0.45, 0), new Vector3(Math.cos(a) * 1.45, Math.sin(a) * 1.45, 0.2), new Vector3(Math.cos(a + 0.3) * 1.15, Math.sin(a + 0.3) * 1.15, 0.9)]);
      const leg = new Mesh(new TubeGeometry(curve, 10, 0.11, 5, false), skin); leg.scale.setScalar(size); body.add(leg);
    }
  }
  if (kind === 'ribbon') {
    for (let side = -1; side <= 1; side += 2) {
      const wing = new Mesh(new ConeGeometry(0.75, 2.6, 3), skin); wing.rotation.z = -side * 1.05; wing.position.x = side * 1.05; wing.scale.z = 0.24; body.add(wing);
    }
    for (let i = 0; i < 4; i++) { const tail = new Mesh(new OctahedronGeometry(0.44 - i * 0.07), bright); tail.position.set(Math.sin(i) * 0.3, -0.9 - i * 0.45, 0); body.add(tail); }
  }
  if (kind === 'urchin') {
    const ring = new Mesh(new TorusGeometry(1.05, 0.13, 6, 20), skin); body.add(ring);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const spike = new Mesh(new ConeGeometry(0.23, 1.1, 5), bright); spike.position.set(Math.cos(a) * 1.25, Math.sin(a) * 1.25, 0); spike.rotation.z = a - Math.PI / 2; body.add(spike); }
  }
  if (kind === 'parent') {
    const webs: Group[] = [];
    for (let layer = 0; layer < 3; layer++) {
      const web = new Group();
      const mat = new MeshBasicMaterial({ color: p.violet, transparent: true, opacity: 0.7, depthWrite: false, side: DoubleSide });
      for (let ring = 0; ring < 3; ring++) { const mesh = new Mesh(new TorusGeometry(3.3 + ring * 0.8, 0.08, 5, 9), mat); mesh.rotation.z = layer * 0.7; mesh.position.z = 3.1 + layer * 0.45; mesh.scale.x = 1 - layer * 0.14; web.add(mesh); }
      for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + layer; const strand = new Mesh(new BoxGeometry(0.065, 9.5, 0.08), mat); strand.rotation.z = a; strand.position.z = 3.3 + layer * 0.45; web.add(strand); }
      consolidate(web);
      group.add(web); webs.push(web);
    }
    group.userData.webs = webs;
  } else {
    const tether = new Mesh(new TubeGeometry(new CatmullRomCurve3([new Vector3(0, -5, -0.7), new Vector3(0.5, 0, -0.7), new Vector3(0, 5, -0.7)]), 12, 0.045, 4, false), new MeshBasicMaterial({ color: p.green })); tether.name = 'tether'; group.add(tether);
  }
  consolidate(body);
  body.children.forEach(child => { if ((child as Mesh).material === bright) child.renderOrder = 3; });
  const lock = new Mesh(new TorusGeometry(kind === 'parent' ? 3.1 : 1.65, 0.045, 5, 36), new MeshBasicMaterial({ color: p.gold, depthTest: false }));
  lock.name = 'lock'; lock.visible = false; lock.position.z = kind === 'parent' ? 5 : 1; group.add(lock);
  return group;
}

function consolidate(group: Group) {
  const batches = new Map<MeshBasicMaterial, BufferGeometry[]>();
  for (const child of [...group.children]) {
    if (!(child instanceof Mesh) || !(child.material instanceof MeshBasicMaterial)) continue;
    child.updateMatrix();
    const geometry = (child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone()).applyMatrix4(child.matrix);
    const batch = batches.get(child.material) ?? [];
    batch.push(geometry); batches.set(child.material, batch);
    child.geometry.dispose(); group.remove(child);
  }
  for (const [material, geometries] of batches) {
    group.add(new Mesh(mergeGeometries(geometries), material));
    geometries.forEach(geometry => geometry.dispose());
  }
}
