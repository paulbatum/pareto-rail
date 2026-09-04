import {
  BackSide, BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, DoubleSide, FogExp2,
  Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene,
  SphereGeometry, TubeGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BELL, BELL_HEIGHT, BELL_RADIUS, STRAND_COUNT, strandPoint, strandRoot } from '../world';
import type { Palette } from './index';

function merge(parts: BufferGeometry[]) {
  const geometry = mergeGeometries(parts)!;
  parts.forEach((part) => part.dispose());
  return geometry;
}
function tube(points: Vector3[], radius: number, segments = 72, radial = 5) {
  return new TubeGeometry(new CatmullRomCurve3(points), segments, radius, radial, false);
}
function skinGeometry(palette: Palette) {
  const vertices: number[] = [], colors: number[] = [], indices: number[] = [];
  const color = new Color();
  for (let row = 0; row <= 32; row++) {
    const t = row / 32 * Math.PI * 0.525;
    for (let column = 0; column <= 112; column++) {
      const a = column / 112 * Math.PI * 2;
      const scallop = Math.sin(a * 24) * Math.pow(row / 32, 8);
      const r = BELL_RADIUS * Math.sin(t) + scallop * 1.1;
      vertices.push(Math.cos(a) * r, BELL_HEIGHT * Math.cos(t) + scallop * 0.6, Math.sin(a) * r);
      const rim = Math.pow(row / 32, 5);
      color.copy(palette.bell).lerp(palette.gold, rim * 0.3);
      color.multiplyScalar(0.6 + Math.sin(a * 16) ** 2 * 0.18 + Math.cos(t) * 0.24);
      colors.push(color.r, color.g, color.b);
      if (row < 32 && column < 112) {
        const i = row * 113 + column;
        indices.push(i, i + 113, i + 1, i + 1, i + 113, i + 114);
      }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geo.setIndex(indices); geo.computeVertexNormals();
  return geo;
}
function frillGeometry(index: number, palette: Palette) {
  const pos: number[] = [], col: number[] = [], ids: number[] = [];
  const color = new Color();
  const strand = index * 6 + 1;
  const root = strandRoot(strand);
  for (let i = 0; i <= 104; i++) {
    const t = i / 104;
    const center = strandPoint(strand, t).sub(root);
    const a = t * 10 + index * 1.7;
    for (let j = 0; j <= 6; j++) {
      const side = j / 3 - 1;
      const width = (0.45 + Math.sin(t * Math.PI) * 2.7) * side;
      const crimp = Math.sin(t * 95 + j * 1.2) * Math.abs(side) ** 3 * 0.75;
      pos.push(center.x + Math.cos(a) * width, center.y + crimp, center.z + Math.sin(a) * width);
      color.copy(palette.green).lerp(palette.gold, Math.abs(side) * 0.65).multiplyScalar(0.48 + Math.abs(side) * 0.35);
      col.push(color.r, color.g, color.b);
      if (i < 104 && j < 6) {
        const k = i * 7 + j;
        ids.push(k, k + 1, k + 7, k + 1, k + 8, k + 7);
      }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  geo.setIndex(ids); geo.computeVertexNormals();
  return geo;
}

export function buildEnvironment(scene: Scene, palette: Palette, dustCount: number) {
  const root = new Group();
  root.name = 'Strandline / clear water';
  scene.add(root);
  const fog = new FogExp2(palette.water, 0.0048);
  scene.fog = fog;
  scene.background = palette.water.clone();

  const skyGeo = new SphereGeometry(440, 32, 24);
  const skyPos = skyGeo.getAttribute('position');
  const skyColors = new Float32Array(skyPos.count * 3);
  const skyColor = new Color();
  for (let i = 0; i < skyPos.count; i++) {
    const y = skyPos.getY(i) / 440;
    skyColor.copy(palette.deep).lerp(palette.water, Math.max(0, Math.min(1, y + 0.4)));
    if (y > 0) skyColor.lerp(palette.surface, y * 0.7);
    skyColors.set([skyColor.r, skyColor.g, skyColor.b], i * 3);
  }
  skyGeo.setAttribute('color', new BufferAttribute(skyColors, 3));
  const sky = new Mesh(skyGeo, new MeshBasicMaterial({ vertexColors: true, side: BackSide, depthWrite: false, fog: false }));
  sky.renderOrder = -100;
  root.add(sky);

  const animal = new Group();
  animal.name = 'The animal';
  root.add(animal);
  const bell = new Group();
  bell.position.copy(BELL);
  animal.add(bell);
  const skin = new Mesh(skinGeometry(palette), new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.48, side: DoubleSide, depthWrite: false }));
  bell.add(skin);
  const inner = skin.clone();
  inner.scale.set(0.93, 0.74, 0.93);
  inner.material = new MeshBasicMaterial({ color: palette.green, transparent: true, opacity: 0.075, side: DoubleSide, depthWrite: false });
  bell.add(inner);

  const veins: BufferGeometry[] = [], margins: BufferGeometry[] = [];
  for (let i = 0; i < 40; i++) {
    const a = i / 40 * Math.PI * 2;
    veins.push(tube(Array.from({ length: 25 }, (_, j) => {
      const t = j / 24 * Math.PI * 0.52;
      const phi = a + Math.sin(t * 3) * 0.03;
      return new Vector3(Math.cos(phi) * (BELL_RADIUS + 0.1) * Math.sin(t), BELL_HEIGHT * Math.cos(t) + 0.1, Math.sin(phi) * (BELL_RADIUS + 0.1) * Math.sin(t));
    }), i % 5 === 0 ? 0.19 : 0.08, 42));
  }
  for (let layer = 0; layer < 3; layer++) {
    margins.push(tube(Array.from({ length: 145 }, (_, i) => {
      const a = i / 144 * Math.PI * 2;
      const r = BELL_RADIUS - layer * 0.7 + Math.sin(a * 24) * 1.05;
      return new Vector3(Math.cos(a) * r, -2.4 + Math.sin(a * 24) * 0.8 - layer * 0.65, Math.sin(a) * r);
    }), layer === 0 ? 0.3 : 0.12, 192));
  }
  const veinMat = new MeshBasicMaterial({ color: palette.green.clone().multiplyScalar(0.8), transparent: true, opacity: 0.7, depthWrite: false });
  bell.add(new Mesh(merge(veins), veinMat));
  bell.add(new Mesh(merge(margins), new MeshBasicMaterial({ color: palette.gold.clone().multiplyScalar(0.72), transparent: true, opacity: 0.82, depthWrite: false })));

  const organs: BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const phi = k * Math.PI / 2 + Math.PI / 4;
    organs.push(tube(Array.from({ length: 49 }, (_, i) => {
      const a = i / 48 * Math.PI * 2;
      const r = 10 + Math.cos(a) * 7;
      return new Vector3(Math.cos(phi) * r + Math.sin(phi) * Math.sin(a) * 5, 5 + Math.sin(a) * 2, Math.sin(phi) * r - Math.cos(phi) * Math.sin(a) * 5);
    }), 0.9, 64, 6));
  }
  bell.add(new Mesh(merge(organs), new MeshBasicMaterial({ color: palette.gold.clone().multiplyScalar(0.55), transparent: true, opacity: 0.45, depthWrite: false })));

  const strands: Array<{ group: Group; light: MeshBasicMaterial; sheath: MeshBasicMaterial }> = [];
  for (let i = 0; i < STRAND_COUNT; i++) {
    const group = new Group();
    group.position.copy(strandRoot(i));
    const points = Array.from({ length: 33 }, (_, j) => strandPoint(i, j / 32).sub(group.position));
    const light = new MeshBasicMaterial({ color: palette.green.clone().multiplyScalar(0.62), transparent: true, opacity: 0.92, depthWrite: false });
    const sheath = new MeshBasicMaterial({ color: palette.green, transparent: true, opacity: 0.12, depthWrite: false });
    const thickness = i % 6 === 0 ? 0.28 : 0.095 + i % 4 * 0.022;
    group.add(new Mesh(tube(points, thickness, 92), light));
    group.add(new Mesh(tube(points, thickness * 3.3, 92, 6), sheath));
    animal.add(group);
    strands.push({ group, light, sheath });
  }
  for (let i = 0; i < 8; i++) {
    const strand = i * 6 + 1;
    const ribbon = new Mesh(frillGeometry(i, palette), new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.36, side: DoubleSide, depthWrite: false }));
    strands[strand].group.add(ribbon);
  }

  const pearls = new InstancedMesh(new SphereGeometry(0.15, 6, 4), new MeshBasicMaterial({ color: palette.gold.clone().multiplyScalar(1.3), transparent: true, opacity: 0.85, depthWrite: false }), STRAND_COUNT * 4);
  pearls.instanceMatrix.setUsage(35048);
  animal.add(pearls);
  const dust = new InstancedMesh(new SphereGeometry(0.07, 4, 3), new MeshBasicMaterial({ color: palette.silt, transparent: true, opacity: 0.48, depthWrite: false }), dustCount);
  const matrix = new Matrix4();
  for (let i = 0; i < dustCount; i++) {
    const x = Math.sin(i * 127.1) * 230;
    const y = Math.sin(i * 311.7 + 2) * 220;
    const z = Math.cos(i * 74.7) * 190 - 70;
    matrix.makeScale(0.45 + i % 4 * 0.4, 0.55 + i % 7 * 0.12, 1);
    matrix.setPosition(x, y, z); dust.setMatrixAt(i, matrix);
  }
  root.add(dust);

  const shafts = new Group();
  for (let i = 0; i < 14; i++) {
    const x = (i - 6) * 25;
    const z = -160 + (i % 4) * 57;
    const g = new BufferGeometry();
    const positions: number[] = [], colors: number[] = [], indices: number[] = [];
    for (let row = 0; row <= 20; row++) {
      const t = row / 20;
      for (let column = 0; column <= 4; column++) {
        const side = column / 2 - 1;
        positions.push(x - t * 116 + side * (2 + t * 23), 245 - t * 640, z - t * 36);
        const alpha = Math.sin(column / 4 * Math.PI) ** 2 * Math.sin(t * Math.PI) ** 2 * 0.035;
        colors.push(palette.surface.r, palette.surface.g, palette.surface.b, alpha);
        if (row < 20 && column < 4) {
          const k = row * 5 + column;
          indices.push(k, k + 1, k + 5, k + 1, k + 6, k + 5);
        }
      }
    }
    g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 4));
    g.setIndex(indices);
    const mat = new MeshBasicMaterial({ vertexColors: true, transparent: true, side: DoubleSide, depthWrite: false });
    shafts.add(new Mesh(g, mat));
  }
  root.add(shafts);
  const sun = new Mesh(new SphereGeometry(13, 24, 12), new MeshBasicMaterial({ color: palette.surface, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
  sun.position.set(-82, 410, -50);
  root.add(sun);

  return { root, animal, bell, strands, pearls, dust, sky, fog, veinMat,
    updateSky(camera: PerspectiveCamera) { sky.position.copy(camera.position); },
  };
}
