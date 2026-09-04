import {
  BufferGeometry, CatmullRomCurve3, DoubleSide, Group, Mesh, MeshBasicMaterial,
  SphereGeometry, TubeGeometry, Vector3, TorusGeometry, RingGeometry, BoxGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import type { Palette } from './index';

function merged(parts: BufferGeometry[]) {
  const geometry = mergeGeometries(parts)!;
  parts.forEach((part) => part.dispose());
  return geometry;
}
function ellipsoid(x: number, y: number, z: number, sx: number, sy: number, sz: number) {
  return new SphereGeometry(1, 12, 8).scale(sx, sy, sz).translate(x, y, z);
}
function tendril(points: number[][], radius: number, segments = 20) {
  return new TubeGeometry(new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x, y, z))), segments, radius, 5, false);
}

export function buildParasite(kind: string, palette: Palette) {
  const group = new Group();
  group.name = `Parasite / ${kind}`;
  const shell = new MeshBasicMaterial({ color: palette.shell });
  const flesh = new MeshBasicMaterial({ color: palette.violet });
  const hot = new MeshBasicMaterial({ color: palette.hostileLight });
  const membrane = new MeshBasicMaterial({ color: palette.violet, transparent: true, opacity: 0.42, side: DoubleSide, depthWrite: false });
  const shells: BufferGeometry[] = [], limbs: BufferGeometry[] = [], organs: BufferGeometry[] = [];
  const fins: Mesh[] = [];
  if (kind === 'louse') {
    for (let i = 0; i < 4; i++) {
      shells.push(ellipsoid(0, 0.72 - i * 0.43, 0, 0.69 - i * 0.09, 0.38, 0.42));
      organs.push(ellipsoid(0, 0.74 - i * 0.43, 0.39, 0.12, 0.13, 0.09));
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) limbs.push(tendril([
        [side * 0.4, 0.65 - i * 0.5, 0], [side * 1.05, 0.8 - i * 0.55, 0.15],
        [side * 1.4, 0.05 - i * 0.45, 0.35], [side * 1.05, -0.35 - i * 0.4, 0.4],
      ], 0.105));
      limbs.push(tendril([[side * 0.3, 0.9, 0], [side * 0.8, 1.5, 0.1], [side * 0.3, 1.6, 0.25]], 0.1));
    }
  } else if (kind === 'ribbon') {
    shells.push(ellipsoid(0, 0.15, 0, 0.38, 1.18, 0.35));
    organs.push(ellipsoid(0, 0.54, 0.33, 0.14, 0.38, 0.12));
    for (const side of [-1, 1]) {
      const fin = new Mesh(new SphereGeometry(1, 12, 8).scale(0.56, 1.6, 0.14), membrane);
      fin.position.set(side * 0.9, -0.15, -0.12);
      fin.rotation.z = side * -0.85;
      group.add(fin); fins.push(fin);
      limbs.push(tendril([[side * 0.23, 0.8, 0], [side * 1.6, 0.4, 0], [side * 2.1, -1, -0.2]], 0.065));
    }
    for (let i = 0; i < 3; i++) limbs.push(tendril([
      [0, -0.8, 0], [(i - 1) * 0.28, -1.8, 0.1], [(i - 1) * 0.7, -2.7, -0.3], [(i - 1) * 1.1, -3.3, 0.1],
    ], 0.055));
  } else if (kind === 'cyst') {
    shells.push(ellipsoid(0, 0, 0, 1.02, 1.1, 0.9));
    organs.push(ellipsoid(0, 0, 0.81, 0.44, 0.52, 0.27));
    for (let i = 0; i < 10; i++) {
      const a = i * Math.PI / 5;
      const x = Math.cos(a), y = Math.sin(a);
      limbs.push(tendril([[x * 0.6, y * 0.6, 0.55], [x * 1.08, y * 1.08, 0.35], [x * 1.7, y * 1.7, -0.35], [x * 1.45, y * 1.45, -0.55]], 0.13));
      organs.push(ellipsoid(x * 0.83, y * 0.83, 0.56, 0.09, 0.09, 0.09));
    }
  } else if (kind === 'brood') {
    shells.push(ellipsoid(0, 0, 0, 0.7, 0.82, 0.54));
    organs.push(ellipsoid(0, 0, 0.53, 0.3, 0.3, 0.2));
    for (let i = 0; i < 3; i++) {
      const angle = i * Math.PI * 2 / 3;
      const fin = new Mesh(new SphereGeometry(1, 10, 8).scale(0.45, 1.07, 0.21), flesh);
      fin.position.set(Math.sin(angle) * 0.73, Math.cos(angle) * 0.73, 0);
      fin.rotation.z = -angle;
      group.add(fin); fins.push(fin);
      const x = Math.sin(angle), y = Math.cos(angle);
      limbs.push(tendril([[0, 0, 0], [x, y, 0], [x * 1.55, y * 1.55, 0.4]], 0.09));
    }
  } else {
    shells.push(ellipsoid(0, 0, 0, 3.6, 4.3, 2.4));
    shells.push(ellipsoid(0, -3, -0.7, 2.5, 2.7, 1.8));
    organs.push(ellipsoid(0, 0.7, 2.23, 1.1, 1.7, 0.46));
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const x = Math.cos(a), y = Math.sin(a);
      limbs.push(tendril([[x * 2, y * 2, 0], [x * 5.8, y * 5.2, -0.4], [x * 8.2, y * 6.3, -2], [x * 7.5, y * 7.6, -3.5]], 0.24, 28));
      organs.push(ellipsoid(x * 2.4, y * 3.1, 1.6, 0.28, 0.3, 0.2));
    }
    const webs: Group[] = [];
    for (let sector = 0; sector < 3; sector++) {
      const web = new Group();
      const parts: BufferGeometry[] = [];
      const start = sector * Math.PI * 2 / 3;
      for (let radial = 0; radial < 7; radial++) {
        const a = start + radial / 6 * Math.PI * 2 / 3;
        parts.push(tendril(Array.from({ length: 10 }, (_, j) => {
          const r = 1 + j * 0.92;
          const ang = a + Math.sin(j * 2.3) * 0.025;
          return [Math.cos(ang) * r, Math.sin(ang) * r, 3.1 + Math.sin(j * 0.5) * 0.45];
        }), radial % 2 ? 0.09 : 0.16, 30));
      }
      for (let ring = 1; ring <= 6; ring++) {
        const r = 1 + ring * 1.27;
        parts.push(tendril(Array.from({ length: 19 }, (_, j) => {
          const a = start + j / 18 * Math.PI * 2 / 3;
          const scallop = Math.sin(j / 18 * Math.PI * 6) * 0.2;
          return [Math.cos(a) * (r + scallop), Math.sin(a) * (r + scallop), 3.2];
        }), 0.085, 38));
      }
      const material = new MeshBasicMaterial({ color: palette.violet, transparent: true, opacity: 0.94, depthWrite: false });
      web.add(new Mesh(merged(parts), material));
      group.add(web); webs.push(web);
    }
    group.userData.webs = webs;
    const healthPips: Mesh<SphereGeometry, MeshBasicMaterial>[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI * 0.17 + i / 5 * Math.PI * 0.66;
      const pip = new Mesh(new SphereGeometry(0.18, 8, 6), new MeshBasicMaterial({ color: palette.hostileLight }));
      pip.visible = false;
      pip.position.set(Math.cos(angle) * 4.3, Math.sin(angle) * 4.9, 2.9);
      group.add(pip); healthPips.push(pip);
    }
    group.userData.healthPips = healthPips;
  }
  const shellMesh = new Mesh(merged(shells), shell);
  const legMesh = new Mesh(merged(limbs), flesh);
  group.add(shellMesh, legMesh, new Mesh(merged(organs), hot));
  const halo = new Mesh(new TorusGeometry(kind === 'parent' ? 4.8 : kind === 'cyst' ? 1.48 : 1.36, 0.035, 5, 48), new MeshBasicMaterial({ color: palette.gold, transparent: true, opacity: 0.9, depthWrite: false }));
  halo.position.z = kind === 'parent' ? 3.5 : 0.72;
  halo.visible = false; group.add(halo);
  group.userData.halo = halo;
  group.userData.fins = fins;
  group.userData.shell = shell;
  group.userData.flesh = flesh;
  group.userData.hot = hot;
  group.userData.shellMesh = shellMesh;
  group.userData.legMesh = legMesh;
  group.userData.kind = kind;
  group.userData.denied = 0;
  group.userData.hitFlash = 0;
  return group;
}

export function buildLetter(character: string, palette: Palette) {
  const group = new Group();
  const cells = glyphOnCells(character);
  const parts = cells.map(({ x, y }) => new BoxGeometry(0.26, 0.26, 0.13).translate((x - 2) * 0.32, (3 - y) * 0.32, 0.12));
  const hot = new MeshBasicMaterial({ color: palette.letter });
  group.add(new Mesh(merged(parts), hot));
  const leaf = new Mesh(new SphereGeometry(1, 24, 16).scale(0.94, 1.45, 0.1), new MeshBasicMaterial({ color: palette.deep, transparent: true, opacity: 0.82, depthWrite: false }));
  leaf.position.z = -0.09;
  group.add(leaf);
  const frame = new Mesh(new TorusGeometry(1, 0.025, 5, 64), new MeshBasicMaterial({ color: palette.green }));
  frame.scale.set(0.94, 1.45, 1);
  group.add(frame);
  for (const side of [-1, 1]) {
    const root = new Mesh(tendril([[side * 0.1, -1.42, 0], [side * 0.25, -1.8, 0], [side * 0.1, -2.2, 0]], 0.018), frame.material);
    group.add(root);
  }
  const halo = new Mesh(new RingGeometry(1.07, 1.115, 64), new MeshBasicMaterial({ color: palette.gold, side: DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }));
  halo.scale.set(0.94, 1.45, 1); halo.visible = false;
  group.add(halo);
  group.userData.kind = 'letter'; group.userData.hot = hot; group.userData.halo = halo;
  group.userData.denied = 0; group.userData.hitFlash = 0;
  return group;
}
