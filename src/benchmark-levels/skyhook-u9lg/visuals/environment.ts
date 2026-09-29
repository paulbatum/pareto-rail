import { BackSide, BufferAttribute, BufferGeometry, Color, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Points, PointsMaterial, SphereGeometry } from 'three';
import type { Scene } from 'three';
import { makeCar, makeStation, panel } from './hardware';

export type EnvironmentOptions = {
  white: MeshBasicMaterial; orange: MeshBasicMaterial; dark: MeshBasicMaterial; steel: MeshBasicMaterial;
  cloudColor: number; ocean: number; land: number; atmosphere: number; cloudCount: number; starCount: number;
};
export function buildEnvironment(scene: Scene, o: EnvironmentOptions) {
  const root = new Group(); scene.add(root);
  const skyGeometry = new SphereGeometry(1400, 32, 16);
  skyGeometry.setAttribute('color', new BufferAttribute(new Float32Array(skyGeometry.attributes.position.count * 3), 3));
  const sky = new Mesh(skyGeometry, new MeshBasicMaterial({ vertexColors: true, side: BackSide, depthWrite: false, fog: false })); root.add(sky);
  const clouds = new InstancedMesh(new SphereGeometry(1, 10, 6), new MeshBasicMaterial({ color: o.cloudColor, transparent: true, opacity: 0.34, depthWrite: false, fog: false }), o.cloudCount);
  clouds.frustumCulled = false; root.add(clouds);
  const cloudData = Array.from({ length: o.cloudCount }, (_, i) => ({
    x: Math.sin(Math.floor(i / 4) * 94.13) * 70 + Math.sin(i * 7) * 6, y: Math.sin(Math.floor(i / 4) * 13.59) * 38 + Math.cos(i * 5) * 3, z: -180 + ((Math.floor(i / 4) * 79.31) % 210) + i % 4 * 2,
    sx: 7 + (i % 7) * 1.8, sy: 3 + (i % 4) * 0.7, sz: 5 + (i % 3) * 2,
  }));
  const starGeometry = new BufferGeometry();
  const starsArray: number[] = [];
  for (let i = 0; i < o.starCount; i++) {
    const a = i * 2.399963, z = 1 - 2 * (i + 0.5) / o.starCount, r = Math.sqrt(1 - z * z);
    starsArray.push(Math.cos(a) * r * 1100, Math.sin(a) * r * 1100, z * 1100);
  }
  starGeometry.setAttribute('position', new BufferAttribute(new Float32Array(starsArray), 3));
  const stars = new Points(starGeometry, new PointsMaterial({ color: 0xdce3e7, size: 1.8, transparent: true, opacity: 0, depthWrite: false, fog: false })); root.add(stars);
  const globeGeometry = new SphereGeometry(480, 128, 64);
  const globeColors: number[] = [];
  const pos = globeGeometry.attributes.position;
  const ocean = new Color(o.ocean), land = new Color(o.land), snow = new Color(0xc6d8de);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / 480, y = pos.getY(i) / 480, z = pos.getZ(i) / 480;
    const lon = Math.atan2(z, x), lat = Math.asin(y);
    const geography = Math.sin(lon * 3 + Math.sin(lat * 7)) + Math.cos(lat * 6 + lon * 2) + Math.sin(lon * 11 + lat * 9) * 0.3;
    const c = (Math.abs(lat) > 1.49 ? snow : geography > 0.6 ? land : ocean).clone();
    const cloud = Math.sin(lon * 16 + lat * 25 + Math.sin(lon * 4) * 3) + Math.sin(lon * 9 - lat * 19);
    if (cloud > 1.15) c.lerp(snow, 0.32);
    c.multiplyScalar(0.55 + Math.max(0, x * -0.35 + y * 0.7 + z * 0.4) * 0.45);
    globeColors.push(c.r, c.g, c.b);
  }
  globeGeometry.setAttribute('color', new BufferAttribute(new Float32Array(globeColors), 3));
  const planet = new Group();
  planet.add(new Mesh(globeGeometry, new MeshBasicMaterial({ vertexColors: true, fog: false })));
  planet.add(new Mesh(new SphereGeometry(485, 64, 32), new MeshBasicMaterial({ color: o.atmosphere, side: BackSide, transparent: true, opacity: 0.25, depthWrite: false, fog: false })));
  const skin = new Group(); planet.add(skin); root.add(planet);
  const tether = new Group();
  for (const x of [2.98, 3.42]) panel(tether, o.steel, [0.07, 0.14, 940], [x, 0, -400]);
  panel(tether, o.dark, [0.42, 0.07, 940], [3.2, 0, -400]);
  for (let i = 0; i < 94; i++) panel(tether, i % 5 === 0 ? o.orange : o.white, [0.42, 0.09, 0.09], [3.2, 0.05, 40 - i * 10]);
  tether.position.y = -4.9; root.add(tether); tether.traverse((m) => { if (m instanceof Mesh) m.name = 'elevator-tether'; });
  const car = makeCar(o.white, o.orange, o.dark, o.steel); root.add(car); car.traverse((m) => { if (m instanceof Mesh) m.name = 'climber-hardware'; });
  const station = makeStation(o.white, o.orange, o.dark, o.steel); station.position.z = -702; root.add(station); station.traverse((m) => { if (m instanceof Mesh) m.name = 'station'; });
  const debris = new InstancedMesh(new SphereGeometry(1, 4, 2), o.steel, 60); debris.frustumCulled = false; root.add(debris); debris.name = 'falling-debris';
  const dummy = new Object3D();
  return { root, sky, skyGeometry, stars, clouds, cloudData, planet, tether, car, station, debris, dummy, skin };
}
