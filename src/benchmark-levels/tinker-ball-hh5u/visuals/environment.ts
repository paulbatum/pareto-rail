import {
  BackSide,
  BoxGeometry,
  CircleGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Scene,
  SphereGeometry,
  SpotLight,
  TorusGeometry,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import {
  abs,
  float,
  floor,
  fract,
  hash,
  mix,
  mx_noise_float,
  positionLocal,
  positionWorld,
  smoothstep,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../../engine/rng';
import type { Route } from '../route';
import {
  at,
  bake,
  getPieceMaterial,
  mergePlacedPieces,
  part,
  PIECE_RADIUS,
  withStaticTint,
  type PieceType,
} from './pieces';
import {
  CREAM,
  DOME_TOP,
  FOG,
  GLUE,
  KRAFT,
  LAMP_BULB,
  LAMP_WARM,
  MUSTARD,
  PINE,
  ROOM_GROUND,
  ROOM_SKY,
  SCRATCH,
  STEEL,
  TABLE_DARK,
  TABLE_OAK,
  TABLE_PALE,
  TOY_COLORS,
  WINDOW_COOL,
} from './palette';

// The worktable. One enormous honey-oak table under a single architect's
// lamp; the ball's route is worn into it as a pale scratch that widens as the
// ball grows. Clutter is placed at real size along the route, so the same
// spool that towers over a marble is a curb stone to a melon. This file owns
// its set dressing (placement density and zone lists) as well as geometry.

type Zone = { from: number; to: number; corridor: number; near: Array<[PieceType, number, number]>; far: Array<[PieceType, number, number]>; tallFrom: number };

// Zones by route distance: [piece, min scale, max scale].
const ZONES: Zone[] = [
  {
    from: 0, to: 175, corridor: 9, tallFrom: 26,
    near: [['button', 1.2, 2.2], ['bead', 0.9, 1.4], ['pin', 1.3, 1.6], ['paperclip', 1.8, 2.2], ['sequin', 1.4, 2.0], ['button', 1.6, 2.6]],
    far: [['spool', 3.0, 3.4], ['eraser', 3.2, 3.6], ['paintpot', 3.8, 4.4], ['block', 3.2, 4.0], ['crayon', 5, 5.6], ['pencil', 5.2, 5.4]],
  },
  {
    from: 175, to: 520, corridor: 17, tallFrom: 62,
    near: [['eraser', 3.2, 3.6], ['crayon', 5, 5.6], ['button', 2.0, 3.0], ['paperclip', 3.5, 4.2], ['sequin', 3.5, 4.5]],
    far: [['spool', 3.0, 3.4], ['paintpot', 3.8, 4.4], ['block', 3.0, 4.0], ['jar', 5.5, 6.5], ['ruler', 5, 5], ['card', 8, 12], ['pencil', 5.2, 5.4], ['block', 6, 8]],
  },
  {
    from: 520, to: 680, corridor: 26, tallFrom: 90,
    near: [['ruler', 5, 5], ['card', 7, 11], ['pencil', 5.2, 5.4], ['eraser', 5, 6]],
    far: [['jar', 6, 7], ['card', 12, 18], ['block', 8, 11]],
  },
];

export type Environment = ReturnType<typeof createEnvironment>;

export function createEnvironment(scene: Scene, route: Route) {
  const root = new Group();
  root.name = 'tinker-table';
  scene.add(root);
  scene.fog = new Fog(FOG, 150, 480);
  const pieceMaterial = getPieceMaterial(GLUE);
  const rng = mulberry32(8123);
  const center = route.spillCenter;

  // ── Light: a warm room, a cool window fill, and the lamp over the spill.
  const hemi = new HemisphereLight(ROOM_SKY, ROOM_GROUND, 2.1);
  root.add(hemi);
  const windowLight = new DirectionalLight(WINDOW_COOL, 0.9);
  windowLight.position.set(-300, 260, 200);
  root.add(windowLight);
  const lampHead = new Vector3(center.x + 40, 230, center.z + 30);
  const lamp = new SpotLight(LAMP_WARM, 1.6, 0, 0.95, 0.9, 0);
  lamp.position.copy(lampHead);
  lamp.target.position.set(center.x - 10, 0, center.z + 10);
  root.add(lamp, lamp.target);
  // Where fake contact shadows fall: away from the lamp.
  const lampShadowDirection = (point: Vector3, out: Vector3) => {
    out.set(point.x - lampHead.x, 0, point.z - lampHead.z);
    const length = out.length();
    return out.multiplyScalar(length > 0 ? 0.35 / Math.max(1, lampHead.y / Math.max(length, 1)) / length : 0);
  };

  // ── The room beyond the table: a dim warm wall fading up into dark.
  const domeMaterial = new MeshBasicNodeMaterial({ side: BackSide, fog: false, depthWrite: false });
  const elevation = positionLocal.normalize().y;
  domeMaterial.colorNode = mix(vec3(FOG.r, FOG.g, FOG.b), vec3(DOME_TOP.r, DOME_TOP.g, DOME_TOP.b), smoothstep(float(-0.02), float(0.45), elevation));
  const dome = new Mesh(new SphereGeometry(470, 32, 16), domeMaterial);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  root.add(dome);

  // ── The table: planked oak, grain, stains, and seams.
  const tableMaterial = new MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0 });
  const xz = positionWorld.xz;
  const plankWidth = 46;
  const plank = floor(xz.y.div(plankWidth));
  const plankRand = hash(plank.add(4000));
  const grainCoord = vec2(xz.x.mul(0.006).add(plankRand.mul(40)), xz.y.mul(0.07).add(plank.mul(7.3)));
  const warp = mx_noise_float(grainCoord).mul(5);
  const rings = fract(xz.y.mul(0.22).add(warp).add(plankRand.mul(9)));
  const grain = smoothstep(float(0.0), float(0.35), rings).mul(smoothstep(float(1.0), float(0.62), rings));
  const stain = mx_noise_float(xz.mul(0.008)).mul(0.5).add(0.5);
  const seam = smoothstep(float(0.012), float(0.0), abs(fract(xz.y.div(plankWidth)).sub(0.5)).sub(0.488).abs());
  const oak = vec3(TABLE_OAK.r, TABLE_OAK.g, TABLE_OAK.b);
  const dark = vec3(TABLE_DARK.r, TABLE_DARK.g, TABLE_DARK.b);
  const pale = vec3(TABLE_PALE.r, TABLE_PALE.g, TABLE_PALE.b);
  let wood = mix(dark, oak, grain.mul(0.55).add(0.35));
  wood = mix(wood, pale, stain.mul(0.18).add(plankRand.mul(0.12)));
  wood = wood.mul(float(0.88).add(plankRand.mul(0.2)));
  tableMaterial.colorNode = mix(wood, dark.mul(0.45), seam.mul(0.8));
  tableMaterial.roughnessNode = float(0.5).add(grain.mul(0.18));
  const table = new Mesh(new PlaneGeometry(3200, 3200, 1, 1), tableMaterial);
  table.name = 'table';
  table.rotation.x = -Math.PI / 2;
  table.position.set(center.x - 120, 0, center.z + 250);
  root.add(table);

  // ── Scratch roads: the route worn pale into the varnish, wider as the ball grows.
  const scratchMaterial = new MeshStandardNodeMaterial({ roughness: 0.85, transparent: true, depthWrite: false });
  scratchMaterial.color = SCRATCH.clone();
  const across = uv().x;
  const along = uv().y;
  const groove = smoothstep(float(0.5), float(0.36), abs(across.sub(0.5)));
  const sideLines = smoothstep(float(0.035), float(0.0), abs(abs(across.sub(0.5)).sub(0.44)));
  const breakup = mx_noise_float(vec2(along.mul(0.35), across.mul(3))).mul(0.5).add(0.5);
  scratchMaterial.opacityNode = groove.mul(0.36).add(sideLines.mul(0.4)).mul(breakup.mul(0.6).add(0.55));
  scratchMaterial.polygonOffset = true;
  scratchMaterial.polygonOffsetFactor = -1;
  const roadWidth = (s: number) => (s < 170 ? 2.2 : s < 520 ? 5.5 : 8.5);
  const road = ribbonAlong(route, 0, route.curveLength, 1.5, roadWidth, 0.02);
  const roadMesh = new Mesh(road, scratchMaterial);
  root.add(roadMesh);
  // Stray scratches all over the table, like the table has had a life.
  const strays: BufferGeometry[] = [];
  for (let i = 0; i < 70; i += 1) {
    const x = center.x - 500 + rng() * 900;
    const z = center.z - 300 + rng() * 900;
    const length = 20 + rng() * 110;
    const angle = rng() * Math.PI;
    const bend = (rng() - 0.5) * 0.02;
    strays.push(strayScratch(x, z, length, angle, bend, 0.6 + rng() * 1.8));
  }
  const strayMesh = new Mesh(mergeGeometries(strays), scratchMaterial);
  root.add(strayMesh);

  // ── The spotless patch past the spill: freshly polished, pale, and
  // glinting — where the ball coasts once the last glue snaps clean.
  const patchCenter = center.clone().addScaledVector(route.exitDirection, 70);
  const polishMaterial = new MeshStandardNodeMaterial({ roughness: 0.14, metalness: 0.05, transparent: true, depthWrite: false });
  const patchR = uv().sub(0.5).length().mul(2);
  const glint = smoothstep(float(0.93), float(1), mx_noise_float(positionWorld.xz.mul(0.9)).mul(0.5).add(0.5));
  polishMaterial.colorNode = mix(mix(oak, pale, float(0.45)), vec3(1, 0.97, 0.9), glint.mul(0.7));
  polishMaterial.opacityNode = smoothstep(float(1), float(0.55), patchR).mul(0.5);
  polishMaterial.polygonOffset = true;
  polishMaterial.polygonOffsetFactor = -1;
  const patch = new Mesh(new CircleGeometry(80, 48), polishMaterial);
  patch.name = 'spotless-patch';
  patch.rotation.x = -Math.PI / 2;
  patch.position.set(patchCenter.x, 0.012, patchCenter.z);
  root.add(patch);

  // ── Clutter at real size along the route.
  const placements: Array<{ type: PieceType; matrix: Matrix4; tint: Color }> = [];
  const shadowSpots: Array<{ position: Vector3; radius: number }> = [];
  const q = new Quaternion();
  const s = new Vector3();
  const pos = new Vector3();
  const place = (type: PieceType, scale: number, x: number, z: number, lying: boolean, tint: Color) => {
    const yaw = rng() * Math.PI * 2;
    q.setFromAxisAngle(Y, yaw);
    const radius = PIECE_RADIUS[type] * scale;
    let y = 0;
    const tall = type === 'spool' || type === 'paintpot' || type === 'jar' || type === 'block';
    if (lying && !tall) {
      if (type === 'pin' || type === 'crayon' || type === 'pencil') {
        q.multiply(new Quaternion().setFromAxisAngle(X, Math.PI / 2));
        y = (type === 'pin' ? 0.08 : 0.15) * scale;
      } else {
        y = type === 'bead' ? 0.34 * scale : type === 'eraser' ? 0.21 * scale : type === 'card' ? 0.04 * scale : type === 'ruler' ? 0.04 * scale : 0.07 * scale;
      }
    } else {
      y = type === 'spool' ? 0.81 * scale : type === 'paintpot' ? 0.35 * scale : type === 'jar' ? 0.7 * scale : type === 'block' ? 0.5 * scale : 0.2 * scale;
    }
    pos.set(x, y, z);
    placements.push({ type, matrix: new Matrix4().compose(pos, q, s.setScalar(scale)), tint });
    shadowSpots.push({ position: new Vector3(x, 0, z), radius: radius * 1.1 });
  };

  for (const zone of ZONES) {
    for (let d = zone.from; d < zone.to; d += 5) {
      const frame = route.frameAt(d);
      for (const side of [-1, 1]) {
        // Small loose supplies just outside the ball's corridor.
        if (rng() < 0.85) {
          const [type, min, max] = zone.near[Math.floor(rng() * zone.near.length)];
          const lateral = side * (zone.corridor + rng() * zone.corridor * 1.6);
          const along = (rng() - 0.5) * 5;
          const x = frame.position.x + frame.right.x * lateral + frame.tangent.x * along;
          const z = frame.position.z + frame.right.z * lateral + frame.tangent.z * along;
          if (!nearSpill(x, z)) place(type, min + rng() * (max - min), x, z, true, pickTint(type, rng));
        }
        // Bigger supplies standing well back from the road, like buildings.
        if (rng() < 0.45) {
          const [type, min, max] = zone.far[Math.floor(rng() * zone.far.length)];
          const lateral = side * (zone.tallFrom + rng() * zone.tallFrom * 1.5);
          const x = frame.position.x + frame.right.x * lateral;
          const z = frame.position.z + frame.right.z * lateral;
          if (!nearSpill(x, z)) place(type, min + rng() * (max - min), x, z, rng() < 0.4, pickTint(type, rng));
        }
      }
    }
  }
  // A ring of melon-scale junk around the spill orbit, and nothing inside it.
  for (let i = 0; i < 70; i += 1) {
    const angle = (i / 70) * Math.PI * 2 + rng() * 0.05;
    const radius = 150 + rng() * 90;
    const x = center.x + Math.cos(angle) * radius;
    const z = center.z + Math.sin(angle) * radius;
    const list: Array<[PieceType, number, number]> = [['jar', 6, 7.5], ['card', 12, 20], ['block', 8, 12], ['ruler', 5, 5], ['spool', 6, 8], ['paintpot', 7, 9]];
    const [type, min, max] = list[Math.floor(rng() * list.length)];
    if (!onRoute(route, x, z, 40)) place(type, min + rng() * (max - min), x, z, rng() < 0.35, pickTint(type, rng));
  }

  // Landmark props: mugs, tape, books, boxes, a cutting mat, the lamp.
  const props: BufferGeometry[] = [];
  const addProp = (geometry: BufferGeometry, x: number, z: number, yaw: number, scale = 1) => {
    geometry.applyMatrix4(new Matrix4().compose(new Vector3(x, 0, z), new Quaternion().setFromAxisAngle(Y, yaw), new Vector3(scale, scale, scale)));
    props.push(geometry);
  };
  const landmark = (s: number, lateral: number, build: () => BufferGeometry, yaw = rng() * Math.PI * 2, scale = 1, shadow = 8) => {
    const frame = route.frameAt(s);
    const x = frame.position.x + frame.right.x * lateral;
    const z = frame.position.z + frame.right.z * lateral;
    addProp(build(), x, z, yaw, scale);
    shadowSpots.push({ position: new Vector3(x, 0, z), radius: shadow * scale });
  };
  landmark(40, 42, () => mug(TOY_COLORS[0]), 0.3, 1, 6);
  landmark(95, -46, () => tapeRoll(), 1.2, 1, 7);
  landmark(130, 38, () => pencilCup(rng), 0, 1, 6);
  landmark(60, -30, () => lyingRuler(), 0.6, 1, 0);
  landmark(200, 70, () => bookStack(rng), 0.2, 1, 22);
  landmark(245, -30, () => cuttingMat(), 0.1, 1, 0);
  landmark(300, -75, () => mug(TOY_COLORS[2]), 1.1, 1.3, 8);
  landmark(360, 80, () => cardboardBox(), 0.5, 1, 22);
  landmark(420, -70, () => bookStack(rng), 2.1, 1, 22);
  landmark(470, 75, () => tapeRoll(), 0.4, 1.4, 9);
  landmark(600, 170, () => pencilCup(rng), 0, 1.6, 10);

  // The architect's lamp: base off the far side of the spill, arm arching
  // up and over, the shade hanging above the lake.
  const lampGroup = new Group();
  const lampBase = new Vector3(center.x + 190, 0, center.z + 150);
  const lampParts = architectLamp(lampBase, lampHead);
  const lampMesh = new Mesh(lampParts.body, pieceMaterial);
  lampMesh.name = 'lamp';
  lampGroup.add(lampMesh);
  const bulbMaterial = new MeshBasicMaterial({ color: LAMP_BULB.clone().multiplyScalar(3.2), fog: false, toneMapped: false });
  const bulb = new Mesh(new SphereGeometry(9, 16, 12), bulbMaterial);
  bulb.position.copy(lampHead).add(new Vector3(0, -6, 0));
  lampGroup.add(bulb);
  root.add(lampGroup);
  shadowSpots.push({ position: lampBase.clone(), radius: 34 });

  const clutterGeometry = mergePlacedPieces(placements);
  const clutter = new Mesh(clutterGeometry, pieceMaterial);
  clutter.name = 'clutter';
  clutter.frustumCulled = false;
  root.add(clutter);
  const propGeometry = mergeGeometries(props);
  const propMesh = new Mesh(propGeometry, pieceMaterial);
  propMesh.name = 'props';
  propMesh.frustumCulled = false;
  root.add(propMesh);

  return {
    root,
    dome,
    lamp,
    lampHead,
    bulbMaterial,
    shadowSpots,
    lampShadowDirection,
    hemi,
  };

  function nearSpill(x: number, z: number) {
    return Math.hypot(x - center.x, z - center.z) < 125;
  }
}

const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);

function pickTint(type: PieceType, rng: () => number) {
  if (type === 'ruler') return [PINE, MUSTARD, STEEL, CREAM][Math.floor(rng() * 4)];
  if (type === 'card') return KRAFT;
  if (type === 'pencil') return [MUSTARD, TOY_COLORS[0], TOY_COLORS[3], TOY_COLORS[8]][Math.floor(rng() * 4)];
  return TOY_COLORS[Math.floor(rng() * TOY_COLORS.length)];
}

function onRoute(route: Route, x: number, z: number, clearance: number) {
  for (let d = 0; d < route.curveLength; d += 12) {
    const p = route.frameAt(d).position;
    if (Math.hypot(p.x - x, p.z - z) < clearance) return true;
  }
  return false;
}

/** A flat ribbon along the route (uv.x across, uv.y along in world units). */
function ribbonAlong(route: Route, from: number, to: number, step: number, width: (s: number) => number, y: number) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let i = 0;
  for (let d = from; d <= to; d += step) {
    const frame = route.frameAt(d);
    const w = width(d) * 0.5;
    for (const side of [-1, 1]) {
      positions.push(frame.position.x + frame.right.x * w * side, y, frame.position.z + frame.right.z * w * side);
      normals.push(0, 1, 0);
      uvs.push(side < 0 ? 0 : 1, d);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    i += 1;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  return geometry;
}

function strayScratch(x: number, z: number, length: number, angle: number, bend: number, width: number) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const steps = Math.max(2, Math.round(length / 4));
  let heading = angle;
  let px = x;
  let pz = z;
  for (let i = 0; i <= steps; i += 1) {
    const rx = Math.cos(heading);
    const rz = -Math.sin(heading);
    for (const side of [-1, 1]) {
      positions.push(px + rx * width * 0.5 * side, 0.015, pz + rz * width * 0.5 * side);
      normals.push(0, 1, 0);
      uvs.push(side < 0 ? 0 : 1, (i / steps) * length);
    }
    if (i > 0) {
      const a = (i - 1) * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    heading += bend * 4;
    px += Math.sin(heading) * (length / steps);
    pz += Math.cos(heading) * (length / steps);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  return geometry;
}

const WHITE = new Color(0xffffff);

function staticProp(parts: ReturnType<typeof part>[]) {
  return withStaticTint(bake(parts), WHITE);
}

function mug(color: Color) {
  return staticProp([
    part(at(new CylinderGeometry(4.6, 4.3, 10, 28, 1, true), 0, 5, 0), color, 0, 0.3),
    part(at(new CylinderGeometry(4.2, 4.2, 0.3, 28), 0, 8.6, 0), 0x3b2416, 0, 0.2),
    part(at(new CylinderGeometry(4.3, 4.3, 0.4, 28), 0, 0.2, 0), color, 0, 0.3),
    part(at(new TorusGeometry(2.4, 0.7, 10, 20, Math.PI * 1.2), 4.8, 5.2, 0, 0, 0, -Math.PI * 0.6), color, 0, 0.3),
  ]);
}

function tapeRoll() {
  return staticProp([
    part(at(new CylinderGeometry(5.2, 5.2, 2.6, 30, 1, true), 0, 5.2, 0, Math.PI / 2), 0xd8c49a, 0, 0.35),
    part(at(new CylinderGeometry(3.4, 3.4, 2.62, 30, 1, true), 0, 5.2, 0, Math.PI / 2), 0xe9dcc0, 0, 0.8),
    part(at(new TorusGeometry(4.3, 0.95, 6, 30), 0, 5.2, 1.25), 0xcfb88b, 0, 0.4),
    part(at(new TorusGeometry(4.3, 0.95, 6, 30), 0, 5.2, -1.25), 0xcfb88b, 0, 0.4),
  ]);
}

function pencilCup(rng: () => number) {
  const parts = [
    part(at(new CylinderGeometry(4, 4, 11, 24, 1, true), 0, 5.5, 0), 0x2f5fd0, 0, 0.5),
    part(at(new CylinderGeometry(4, 4, 0.4, 24), 0, 0.2, 0), 0x2f5fd0, 0, 0.5),
  ];
  const colors = [0xf2b632, 0xe8452c, 0x1fa39a, 0x4f9d3a, 0x8c4a9e];
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * Math.PI * 2;
    const tilt = 0.12 + rng() * 0.15;
    parts.push(part(at(new CylinderGeometry(0.5, 0.5, 18, 6), Math.cos(a) * 2.2, 10 + rng() * 2, Math.sin(a) * 2.2, Math.sin(a) * tilt, 0, -Math.cos(a) * tilt), colors[i % colors.length], 0, 0.55));
    parts.push(part(at(new ConeGeometry(0.5, 1.5, 6), Math.cos(a) * 3.4, 19.8 + rng(), Math.sin(a) * 3.4, Math.sin(a) * tilt, 0, -Math.cos(a) * tilt), 0xd9ae78, 0, 0.8));
  }
  return staticProp(parts);
}

function lyingRuler() {
  const parts = [part(at(new BoxGeometry(30, 0.4, 3.2), 0, 0.2, 0), 0xf2cf6b, 0, 0.5)];
  for (let i = 0; i <= 60; i += 1) {
    const long = i % 5 === 0;
    parts.push(part(at(new BoxGeometry(0.12, 0.05, long ? 1.2 : 0.6), -14.5 + i * 0.483, 0.42, 1.6 - (long ? 0.6 : 0.3)), 0x2e2d33, 0, 0.9));
  }
  return staticProp(parts);
}

function bookStack(rng: () => number) {
  const covers = [0x2f5fd0, 0xe8452c, 0x1f7a52, 0x8c4a9e, 0xf2b632];
  const parts = [];
  let y = 0;
  for (let i = 0; i < 3; i += 1) {
    const h = 3.5 + rng() * 2;
    const w = 22 + rng() * 5;
    const d = 30 + rng() * 5;
    const yaw = (rng() - 0.5) * 0.3;
    parts.push(part(at(new BoxGeometry(w, h, d), 0, y + h / 2, 0, 0, yaw, 0), covers[Math.floor(rng() * covers.length)], 0, 0.7));
    parts.push(part(at(new BoxGeometry(w - 0.8, h - 0.9, d - 0.3), 0.6, y + h / 2, 0, 0, yaw, 0), 0xf3ead6, 0, 0.9));
    y += h;
  }
  return staticProp(parts);
}

function cardboardBox() {
  return staticProp([
    part(at(new BoxGeometry(28, 22, 30), 0, 11, 0), 0xb9895a, 0, 0.95),
    part(at(new BoxGeometry(6, 0.3, 30.4), 0, 22.1, 0), 0xd8c49a, 0, 0.3),
    part(at(new BoxGeometry(28.4, 3, 6), 0, 18, 0), 0xa87a4c, 0, 0.95),
  ]);
}

function cuttingMat() {
  const parts = [part(at(new BoxGeometry(90, 0.3, 60), 0, 0.15, 0), 0x2f6b4f, 0, 0.8)];
  for (let i = 0; i <= 18; i += 1) parts.push(part(at(new BoxGeometry(0.18, 0.04, 60), -45 + i * 5, 0.32, 0), 0x9fd3b9, 0, 0.8));
  for (let i = 0; i <= 12; i += 1) parts.push(part(at(new BoxGeometry(90, 0.04, 0.18), 0, 0.32, -30 + i * 5), 0x9fd3b9, 0, 0.8));
  return staticProp(parts);
}

function architectLamp(base: Vector3, head: Vector3) {
  const parts = [];
  const metal = 0x3a3f47;
  parts.push(part(at(new CylinderGeometry(24, 27, 6, 36), base.x, 3, base.z), metal, 0, 0.35, 0.6));
  const elbow = new Vector3().lerpVectors(base, head, 0.5).add(new Vector3(40, 150, 40));
  const shoulder = base.clone().add(new Vector3(0, 8, 0));
  const knuckle = head.clone().add(new Vector3(0, 30, 0));
  for (const [from, to] of [[shoulder, elbow], [elbow, knuckle]] as const) {
    const dir = to.clone().sub(from);
    const length = dir.length();
    const mid = from.clone().add(to).multiplyScalar(0.5);
    const q = new Quaternion().setFromUnitVectors(Y, dir.normalize());
    for (const offset of [-3.2, 3.2]) {
      const g = new CylinderGeometry(1.4, 1.4, length, 8);
      g.applyMatrix4(new Matrix4().compose(mid.clone().add(new Vector3(offset, 0, -offset)), q, new Vector3(1, 1, 1)));
      parts.push(part(g, 0xd9dde3, 0, 0.25, 0.9));
    }
    const spring = new CylinderGeometry(1.1, 1.1, length * 0.45, 8);
    spring.applyMatrix4(new Matrix4().compose(mid.clone().add(new Vector3(0, -4, 0)), q, new Vector3(1, 1, 1)));
    parts.push(part(spring, 0x8a8f99, 0, 0.3, 0.9));
  }
  for (const joint of [shoulder, elbow, knuckle]) parts.push(part(at(new SphereGeometry(4.2, 12, 10), joint.x, joint.y, joint.z), metal, 0, 0.3, 0.6));
  const shade = new ConeGeometry(34, 44, 32, 1, true);
  shade.applyMatrix4(new Matrix4().makeTranslation(head.x, head.y + 18, head.z));
  parts.push(part(shade, 0xd23b2b, 0, 0.4, 0.2));
  const neck = new CylinderGeometry(5, 5, 26, 12);
  neck.applyMatrix4(new Matrix4().makeTranslation(head.x, head.y + 38, head.z));
  parts.push(part(neck, metal, 0, 0.3, 0.6));
  return { body: staticProp(parts) };
}
