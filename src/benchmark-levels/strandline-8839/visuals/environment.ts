import { BufferGeometry, CatmullRomCurve3, Color, DoubleSide, Float32BufferAttribute, Group, HemisphereLight, LatheGeometry, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshPhongMaterial, PointLight, Points, PointsMaterial, SphereGeometry, TubeGeometry, Vector2, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Life } from '../gameplay';
import type { Palette } from './index';

export function buildAnimal(p: Palette) {
  const root = new Group();
  root.position.z = -160;
  const membrane = new MeshPhongMaterial({ color: p.membrane, emissive: p.green, emissiveIntensity: 0.16, transparent: true, opacity: 0.38, side: DoubleSide, depthWrite: false, shininess: 70 });
  const profile: Vector2[] = [];
  for (let i = 0; i <= 32; i++) { const a = i / 32 * Math.PI / 2; profile.push(new Vector2(Math.cos(a) * (42 + Math.sin(a * 5) * 1.5), Math.sin(a) * 28)); }
  const bell = new Mesh(new LatheGeometry(profile, 96), membrane);
  bell.position.y = 59;
  root.add(bell);
  const veinPoints: number[] = [];
  const line = (a: Vector3, b: Vector3) => veinPoints.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const tubes: BufferGeometry[] = [];
  const tendrilCurves: CatmullRomCurve3[] = [];
  for (let j = 0; j < 48; j++) {
    const theta = j / 48 * Math.PI * 2;
    const radius = j % 4 === 0 ? 18 : 34 + 6 * Math.sin(j * 1.7);
    const points: Vector3[] = [];
    for (let k = 0; k <= 24; k++) {
      const f = k / 24;
      const wobble = Math.sin(f * 10 + j * 2.4) * (3 + f * 8);
      points.push(new Vector3(Math.cos(theta) * radius + wobble + f * f * 12, 59 - f * (155 + (j % 7) * 7), Math.sin(theta) * radius + Math.cos(f * 12 + j) * (3 + 5 * f)));
    }
    const curve = new CatmullRomCurve3(points);
    tendrilCurves.push(curve);
    tubes.push(new TubeGeometry(curve, 88, j % 4 === 0 ? 0.8 : 0.3, 5, false));
    for (let k = 0; k < 120; k++) line(curve.getPoint(k / 120), curve.getPoint((k + 1) / 120));
    for (let k = 0; k < 32; k++) {
      const a = k / 32 * Math.PI / 2, b = (k + 1) / 32 * Math.PI / 2;
      const r = (t: number) => new Vector3(Math.cos(theta) * Math.cos(t) * 42, 59 + Math.sin(t) * 28, Math.sin(theta) * Math.cos(t) * 42);
      line(r(a), r(b));
    }
  }
  for (let i = 0; i < 360; i++) {
    const point = (n: number) => { const a = n / 360 * Math.PI * 2; return new Vector3(Math.cos(a) * 42, 59 + Math.sin(a * 24) * 1.1, Math.sin(a) * 42); };
    line(point(i), point(i + 1));
  }
  const strandMaterial = new MeshPhongMaterial({ color: p.strandBody, emissive: p.green, emissiveIntensity: 0.18, shininess: 80, transparent: true, opacity: 0.68, depthWrite: false });
  const merged = mergeGeometries(tubes);
  tubes.forEach(g => g.dispose());
  root.add(new Mesh(merged, strandMaterial));
  const veinGeometry = new BufferGeometry();
  veinGeometry.setAttribute('position', new Float32BufferAttribute(veinPoints, 3));
  const veins = new LineSegments(veinGeometry, new LineBasicMaterial({ color: new Color(p.gold).multiplyScalar(1.15), transparent: true, opacity: 0.7, depthWrite: false }));
  root.add(veins);
  const ribbonPositions: number[] = [];
  const ribbonColors: number[] = [];
  for (let j = 0; j < 8; j++) {
    const angle = j / 8 * Math.PI * 2;
    const pt = (t: number, side: number) => {
      const width = (1 - t * 0.7) * (3.8 + Math.sin(t * 60) * 1.4);
      return new Vector3(Math.cos(angle) * (10 + Math.sin(t * 8 + j) * 8) + Math.cos(t * 17 + j) * width * side, 57 - t * 143, Math.sin(angle) * 15 + Math.sin(t * 17 + j) * width * side + Math.sin(t * 9) * 4);
    };
    for (let k = 0; k < 90; k++) {
      const a = pt(k / 90, -1), b = pt(k / 90, 1), c = pt((k + 1) / 90, -1), d = pt((k + 1) / 90, 1);
      for (const v of [a, b, c, b, d, c]) { ribbonPositions.push(v.x, v.y, v.z); const color = new Color(p.membrane).lerp(new Color(p.gold), k / 150); ribbonColors.push(color.r, color.g, color.b); }
    }
  }
  const ribbons = new BufferGeometry();
  ribbons.setAttribute('position', new Float32BufferAttribute(ribbonPositions, 3));
  ribbons.setAttribute('color', new Float32BufferAttribute(ribbonColors, 3)); ribbons.computeVertexNormals();
  root.add(new Mesh(ribbons, new MeshPhongMaterial({ vertexColors: true, side: DoubleSide, transparent: true, opacity: 0.23, depthWrite: false, emissive: p.green, emissiveIntensity: 0.1 })));
  const organs = new Group();
  for (let i = 0; i < 4; i++) {
    const organ = new Mesh(new SphereGeometry(6, 18, 12), new MeshBasicMaterial({ color: p.gold, transparent: true, opacity: 0.2, depthWrite: false }));
    organ.scale.set(1, 0.4, 1.7); organ.rotation.y = i * Math.PI / 2;
    organ.position.set(Math.cos(i * Math.PI / 2) * 12, 65, Math.sin(i * Math.PI / 2) * 12); organs.add(organ);
  }
  root.add(organs);
  const infectionGeometry: BufferGeometry[] = [];
  for (let j = 0; j < 28; j++) {
    const curve = tendrilCurves[(j * 7) % tendrilCurves.length];
    const t = 0.14 + (j % 8) * 0.09;
    const pos = curve.getPoint(t);
    const growth = new SphereGeometry(0.75 + (j % 3) * 0.2, 8, 6);
    growth.scale(1.4, 0.5, 1.1); growth.translate(pos.x, pos.y, pos.z); infectionGeometry.push(growth);
  }
  const infectionMat = new MeshBasicMaterial({ color: p.violet, transparent: true, opacity: 0.8, depthWrite: false });
  const infection = new Mesh(mergeGeometries(infectionGeometry), infectionMat);
  infectionGeometry.forEach(g => g.dispose()); root.add(infection);
  return { root, update(time: number, life: Life) {
    const drift = life.freed ? Math.max(0, time - life.freedAt) : 0;
    root.position.set(drift * 0.9, drift * 0.55, -160 - drift * 0.4);
    const health = life.freed ? 1 : Math.min(0.8, life.kills / 65);
    strandMaterial.emissiveIntensity = 0.1 + health * 0.35;
    membrane.emissiveIntensity = 0.08 + health * 0.18;
    veins.material.opacity = 0.4 + health * 0.26 + Math.sin(time * 1.3) * 0.06;
    infectionMat.opacity = life.freed ? Math.max(0, 1 - (time - life.freedAt)) : 0.8 - health * 0.45;
    bell.scale.set(1 + Math.sin(time * 0.85) * 0.017, 1 + Math.sin(time * 0.85 + 0.5) * 0.035, 1 + Math.sin(time * 0.85) * 0.017);
    organs.rotation.y = Math.sin(time * 0.25) * 0.06;
  } };
}

export function buildWater(p: Palette) {
  const root = new Group();
  root.add(new HemisphereLight(p.skyLight, p.seaLight, 1.6));
  const sun = new PointLight(p.sun, 3200, 400, 1.5); sun.position.set(-50, 145, -100); root.add(sun);
  const positions: number[] = [], colors: number[] = [];
  for (let i = 0; i < 1400; i++) {
    const n = (k: number) => { const f = Math.sin(k * 127.1 + 311.7) * 43758.5453; return f - Math.floor(f); };
    positions.push((n(i * 3) - 0.5) * 340, (n(i * 3 + 1) - 0.5) * 300, n(i * 3 + 2) * -420 + 50);
    const c = new Color(p.strand).lerp(new Color(p.plankton), n(i)); colors.push(c.r, c.g, c.b);
  }
  const geo = new BufferGeometry(); geo.setAttribute('position', new Float32BufferAttribute(positions, 3)); geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  root.add(new Points(geo, new PointsMaterial({ size: 0.23, vertexColors: true, transparent: true, opacity: 0.65, depthWrite: false })));
  const shafts: number[] = [];
  for (let i = 0; i < 14; i++) {
    const x = (i - 7) * 24, z = -110 - (i % 4) * 45;
    shafts.push(x, 175, z, x + 4, 175, z, x + 70, -150, z - 35, x + 4, 175, z, x + 100, -150, z - 35, x + 70, -150, z - 35);
  }
  const rays = new BufferGeometry(); rays.setAttribute('position', new Float32BufferAttribute(shafts, 3));
  root.add(new Mesh(rays, new MeshBasicMaterial({ color: p.sunbeam, transparent: true, opacity: 0.012, depthWrite: false, side: DoubleSide })));
  return root;
}
