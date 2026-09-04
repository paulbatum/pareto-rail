import { BackSide, BufferAttribute, CircleGeometry, Color, CylinderGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { batchSolid } from './batch';
import { block, lettering, type Palette } from './models';
export type SkyPalette = { zenith: Color; horizon: Color; cloud: Color; ocean: Color };
export function buildEnvironment(p: Palette) {
  const root = new Group();
  const skyGeo = new SphereGeometry(1800, 40, 24);
  skyGeo.setAttribute('color', new BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
  const sky = new Mesh(skyGeo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, depthWrite: false, fog: false }));
  sky.renderOrder = -100; root.add(sky);
  const planetGeo = new SphereGeometry(1, 160, 96);
  const colors = new Float32Array(planetGeo.attributes.position.count * 3);
  const v = new Vector3();
  for (let i = 0; i < planetGeo.attributes.position.count; i++) {
    v.fromBufferAttribute(planetGeo.attributes.position, i);
    const terrain = noise(v.x * 3.2 + 8, v.y * 3.2, v.z * 3.2) * 0.65 + noise(v.x * 8, v.y * 8, v.z * 8) * 0.25 + noise(v.x * 19, v.y * 19, v.z * 19) * 0.1;
    const clouds = noise(v.x * 11 + 40 + Math.sin(v.y * 7), v.y * 11, v.z * 11) * 0.7 + noise(v.x * 29, v.y * 29, v.z * 29) * 0.3;
    const c = new Color(terrain > 0.53 ? p.land : p.ocean);
    c.lerp(new Color(p.cloud), Math.max(0, Math.min(0.92, (clouds - 0.54) * 5)));
    c.multiplyScalar(0.45 + Math.max(0, v.x * -0.6 + v.y * 0.65 + v.z * 0.7) * 0.65);
    c.toArray(colors, i * 3);
  }
  planetGeo.setAttribute('color', new BufferAttribute(colors, 3));
  const planet = new Mesh(planetGeo, new MeshBasicMaterial({ vertexColors: true, fog: false })); root.add(planet);
  const limb = new Mesh(new TorusGeometry(1, 0.003, 4, 160), new MeshBasicMaterial({ color: p.atmosphere, transparent: true, opacity: 0.55, depthWrite: false, fog: false })); root.add(limb);
  const stars = new InstancedMesh(new SphereGeometry(1.2, 4, 3), new MeshBasicMaterial({ color: p.stars, fog: false, transparent: true, opacity: 0 }), 380);
  const scratch = new Object3D();
  for (let i = 0; i < 380; i++) {
    const a = i * 2.3999632297, r = 700 * Math.sqrt((i + 0.5) / 380);
    scratch.position.set(Math.cos(a) * r, Math.sin(a) * r, -850 - (i % 9) * 50);
    scratch.scale.setScalar(0.4 + (i % 7) * 0.17); scratch.updateMatrix(); stars.setMatrixAt(i, scratch.matrix);
  }
  root.add(stars);
  const cloudGeo = new SphereGeometry(1, 12, 8);
  const cloudColors = new Float32Array(cloudGeo.attributes.position.count * 3);
  for (let i = 0; i < cloudGeo.attributes.position.count; i++) { const light = 0.4 + (cloudGeo.attributes.position.getY(i) + 1) * 0.3; cloudColors.set([light, light, light], i * 3); }
  cloudGeo.setAttribute('color', new BufferAttribute(cloudColors, 3));
  const clouds = new InstancedMesh(cloudGeo, new MeshBasicMaterial({ color: p.shadow, vertexColors: true, transparent: true, opacity: 0.74, depthWrite: false }), 96);
  clouds.userData.raildIgnoreOcclusion = true;
  root.add(clouds);
  const streaks = new InstancedMesh(new CylinderGeometry(0.025, 0.05, 5, 3), new MeshBasicMaterial({ color: p.streak, transparent: true, opacity: 0.5 }), 90); root.add(streaks);
  const tether = new Group(); tether.name = 'Tether ribbon';
  for (const x of [-1.15, 1.15]) {
    block(tether, [0.12, 0.12, 1150], [x, 4.8, -520], p.steel);
    block(tether, [0.035, 0.08, 1150], [x - 0.06, 4.75, -520], p.white);
  }
  for (let i = 0; i < 70; i++) {
    const z = -i * 16;
    block(tether, [2.7, 0.2, 0.22], [0, 4.8, z], p.shadow);
    block(tether, [0.22, 0.24, 0.65], [-1.15, 4.8, z], p.orange);
  }
  batchSolid(tether); root.add(tether);
  const car = new Group(); car.name = 'Climber deck';
  block(car, [10, 0.5, 8], [0, -3.75, -2.6], p.shadow);
  for (const side of [-1, 1]) {
    block(car, [1.35, 1.8, 5.8], [side * 4.5, -2.7, -2.9], p.white);
    block(car, [0.18, 0.35, 6.3], [side * 3.72, -2.3, -2.9], p.orange);
    block(car, [0.09, 0.12, 6.4], [side * 3.6, -1.8, -2.9], p.steel);
    block(car, [1.2, 0.2, 1.5], [side * 4.5, -1.75, -3.8], p.dark);
    for (let i = 0; i < 6; i++) block(car, [0.06, 0.2, 0.8], [side * 4.5 + (i - 2.5) * 0.16, -1.62, -3.8], p.steel);
    for (let i = 0; i < 8; i++) block(car, [0.4, 0.12, 0.3], [side * 4.5, -1.72, -i * 0.62], i % 2 ? p.dark : p.orange);
    // The gantry rises out of the car and connects it to the overhead ribbon.
    block(car, [0.22, 7.5, 0.26], [side * 4.7, 0.1, 0.3], p.white);
    block(car, [3.6, 0.24, 0.3], [side * 2.95, 4.05, 0.3], p.white);
  }
  for (let i = 0; i < 9; i++) block(car, [0.06, 0.03, 8], [(i - 4) * 0.9, -3.47, -2.6], p.steel);
  block(car, [3.4, 0.75, 0.24], [0, -3.0, -6.5], p.dark);
  const nose = lettering('SKYHOOK', p.white, 0.048); nose.position.set(0, -2.96, -6.3); car.add(nose);
  const lamps: Mesh[] = [];
  for (let i = 0; i < 8; i++) lamps.push(block(car, [0.19, 0.12, 0.05], [(i - 3.5) * 0.3, -2.72, -6.3], p.orange));
  for (const lamp of lamps) lamp.userData.dynamic = true; batchSolid(car); root.add(car);
  const station = new Group(); station.name = 'Station'; station.position.z = -884;
  for (const depth of [0, -12, -24, -40]) {
    const rim = new Mesh(new TorusGeometry(24, 2, 4, 24), new MeshBasicMaterial({ color: depth === 0 ? p.white : p.shadow })); rim.position.z = depth; station.add(rim);
    const lip = new Mesh(new TorusGeometry(21.7, 0.22, 4, 48), new MeshBasicMaterial({ color: p.orange })); lip.position.z = depth + 0.5; station.add(lip);
  }
  for (let i = 0; i < 12; i++) {
    const sector = new Group(); sector.rotation.z = i * Math.PI / 6;
    block(sector, [3.5, 8, 42], [0, 25, -20], i % 2 ? p.shadow : p.white);
    block(sector, [1.8, 0.15, 20], [0, 20.8, -12], p.lamp);
    if (i % 3 === 0) {
      block(sector, [2, 46, 3], [0, 48, -10], p.steel);
      block(sector, [22, 21, 2.5], [0, 73, -10], p.shadow);
      for (let j = 0; j < 7; j++) block(sector, [21, 0.16, 0.1], [0, 64 + j * 3, -8.6], p.steel);
    }
    station.add(sector);
  }
  const doors = [-1, 1].map(side => {
    const g = new Group(); g.position.set(side * 9.5, 0, -33);
    block(g, [19, 40, 1.4], [0, 0, 0], p.shadow);
    block(g, [0.5, 40, 1.7], [-side * 9, 0, 0], p.orange);
    for (const y of [-12, 0, 12]) block(g, [16, 0.15, 0.2], [0, y, 0.85], p.steel);
    batchSolid(g); g.userData.dynamic = true; station.add(g); return g;
  });
  const lining = new Mesh(new CylinderGeometry(24, 24, 65, 24, 1, true), new MeshBasicMaterial({ color: p.dark, side: BackSide }));
  lining.rotation.x = Math.PI / 2; lining.position.z = -32.5; lining.userData.dynamic = true; station.add(lining);
  const bulkhead = new Mesh(new CircleGeometry(24, 48), new MeshBasicMaterial({ color: p.dark })); bulkhead.position.z = -65; station.add(bulkhead);
  for (let i = -3; i <= 3; i++) block(station, [0.13, 35, 0.2], [i * 6, 0, -64.7], p.shadow);
  const berth = lettering('BERTH 07', p.steel, 0.42); berth.position.set(0, 5, -64.4); station.add(berth);
  const capture = lettering('CAPTURE', p.orange, 0.22); capture.position.set(0, 0, -64.4); station.add(capture);
  const sign = lettering('SKYHOOK', p.dark, 1); sign.position.set(0, 31, 2.2); station.add(sign);
  batchSolid(station); root.add(station);
  return { root, sky, planet, limb, clouds, stars, streaks, tether, car, lamps, station, doors, scratch };
}
export type Environment = ReturnType<typeof buildEnvironment>;
export function paintSky(env: Environment, palette: SkyPalette) {
  const positions = env.sky.geometry.attributes.position;
  const colors = env.sky.geometry.attributes.color;
  const c = new Color();
  for (let i = 0; i < positions.count; i++) {
    const height = Math.max(0, Math.min(1, positions.getY(i) / 1800 * 1.3 + 0.38));
    c.copy(palette.horizon).lerp(palette.zenith, height);
    colors.setXYZ(i, c.r, c.g, c.b);
  }
  colors.needsUpdate = true;
  env.clouds.material.color.copy(palette.cloud);
}

function noise(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const smooth = (n: number) => n * n * (3 - 2 * n);
  const tx = smooth(x - ix), ty = smooth(y - iy), tz = smooth(z - iz);
  let value = 0;
  for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++) {
    const seed = Math.sin((ix + dx) * 127.1 + (iy + dy) * 311.7 + (iz + dz) * 74.7) * 43758.5453;
    value += (seed - Math.floor(seed)) * (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
  }
  return value;
}
