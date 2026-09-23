import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  LineSegments,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import {
  abs,
  cameraPosition,
  float,
  fract,
  instanceIndex,
  length,
  mix,
  mx_noise_float,
  normalize,
  normalWorld,
  positionLocal,
  positionWorld,
  pow,
  smoothstep,
  step,
  uniform,
  vec3,
} from 'three/tsl';
import { mulberry32 } from '../../../engine/rng';
import { colorUniform, flashLightUniform, glowMaterial, hazardStripeMaterial, litMaterial, sunDirectionUniform, type ColorUniform } from './materials';

// Scenery construction. Every placement parameter (altitudes, counts, colors)
// arrives from the spine; this leaf only builds and animates geometry.

const floatUniform = (value: number) => uniform(value);
export type FloatUniform = ReturnType<typeof floatUniform>;

function cloudUniforms() {
  return { lit: colorUniform(new Color(1, 1, 1)), shadow: colorUniform(new Color(0.5, 0.5, 0.5)), opacity: floatUniform(0.8) };
}
export type CloudLayerUniforms = ReturnType<typeof cloudUniforms>;

/** Soft cloud puff: opaque in the middle, feathered at the silhouette, sun-shaded. */
function cloudMaterial(u: CloudLayerUniforms) {
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const facing = abs(normalWorld.dot(viewDir));
  const soft = pow(facing, float(1.7));
  const lightTerm = normalWorld.dot(sunDirectionUniform).mul(0.5).add(0.5);
  material.colorNode = mix(u.shadow, u.lit, lightTerm).add(flashLightUniform.mul(0.45));
  // Fade out right at the lens so flying through a puff is a veil, not a wall.
  const near = smoothstep(float(3), float(22), length(cameraPosition.sub(positionWorld)));
  // Break the ellipsoid silhouettes into billows.
  const billow = mx_noise_float(positionWorld.mul(0.045)).mul(0.6).add(mx_noise_float(positionWorld.mul(0.13)).mul(0.4)).mul(0.5).add(0.5);
  material.opacityNode = soft.mul(smoothstep(float(0.28), float(0.62), billow.add(facing.mul(0.35)).sub(0.12))).mul(u.opacity).mul(near);
  return material;
}

type PuffSpec = { position: Vector3; scale: Vector3 };

function puffField(specs: PuffSpec[], material: Material) {
  const geometry = new IcosahedronGeometry(1, 2);
  const mesh = new InstancedMesh(geometry, material, specs.length);
  const matrix = new Matrix4();
  const q = new Quaternion();
  specs.forEach((spec, index) => {
    matrix.compose(spec.position, q, spec.scale);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;
  return mesh;
}

export type CloudLayout = {
  seed: number;
  tetherX: number;
  tetherY: number;
  scud: { count: number; from: number; to: number };
  deck: { count: number; base: number; top: number };
  cirrus: { count: number; from: number; to: number };
};

export type Clouds = {
  root: Group;
  scud: CloudLayerUniforms;
  deck: CloudLayerUniforms;
  ceiling: CloudLayerUniforms;
  cirrus: CloudLayerUniforms;
};

export function createClouds(layout: CloudLayout): Clouds {
  const rng = mulberry32(layout.seed);
  const root = new Group();
  const ring = (min: number, max: number) => {
    const angle = rng() * Math.PI * 2;
    const radius = min + (max - min) * Math.sqrt(rng());
    return new Vector2(layout.tetherX + Math.cos(angle) * radius, layout.tetherY + Math.sin(angle) * radius);
  };

  const scud = cloudUniforms();
  const scudSpecs: PuffSpec[] = [];
  for (let i = 0; i < layout.scud.count; i += 1) {
    const p = i % 3 === 0 ? ring(40, 260) : ring(10, 90);
    const altitude = layout.scud.from + rng() * (layout.scud.to - layout.scud.from);
    const s = 8 + rng() * 24;
    scudSpecs.push({ position: new Vector3(p.x, p.y, -altitude), scale: new Vector3(s * (1 + rng() * 0.8), s * (1 + rng() * 0.8), s * (0.45 + rng() * 0.35)) });
  }
  root.add(puffField(scudSpecs, cloudMaterial(scud)));

  const deck = cloudUniforms();
  const deckSpecs: PuffSpec[] = [];
  for (let i = 0; i < layout.deck.count; i += 1) {
    const p = i < 26 ? ring(3, 40) : ring(20, 700);
    const altitude = layout.deck.base + rng() * (layout.deck.top - layout.deck.base);
    const s = i < 26 ? 12 + rng() * 14 : 30 + rng() * 55;
    deckSpecs.push({ position: new Vector3(p.x, p.y, -altitude), scale: new Vector3(s * (1.2 + rng()), s * (1.2 + rng()), s * (0.35 + rng() * 0.3)) });
  }
  root.add(puffField(deckSpecs, cloudMaterial(deck)));

  // The deck's underside: a vast ceiling we climb toward and punch through.
  const ceiling = cloudUniforms();
  const ceilingMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  const cp = positionWorld.mul(0.012);
  const ceilingNoise = mx_noise_float(cp).mul(0.6).add(mx_noise_float(cp.mul(2.9)).mul(0.3)).add(mx_noise_float(cp.mul(8)).mul(0.1)).mul(0.5).add(0.5);
  ceilingMaterial.colorNode = mix(ceiling.shadow, ceiling.lit, ceilingNoise).add(flashLightUniform.mul(0.5));
  ceilingMaterial.opacityNode = ceiling.opacity.mul(smoothstep(float(0.25), float(0.65), ceilingNoise).mul(0.55).add(0.45));
  const ceilingMesh = new Mesh(new CircleGeometry(2600, 48), ceilingMaterial);
  ceilingMesh.position.set(layout.tetherX, layout.tetherY, -layout.deck.base + 6);
  ceilingMesh.userData.raildIgnoreOcclusion = true;
  root.add(ceilingMesh);

  const cirrus = cloudUniforms();
  const cirrusSpecs: PuffSpec[] = [];
  for (let i = 0; i < layout.cirrus.count; i += 1) {
    const p = ring(40, 520);
    const altitude = layout.cirrus.from + rng() * (layout.cirrus.to - layout.cirrus.from);
    const s = 12 + rng() * 16;
    const drift = rng() * Math.PI;
    for (let k = 0; k < 3; k += 1) {
      const along = (k - 1) * s * 1.6;
      cirrusSpecs.push({
        position: new Vector3(p.x + Math.cos(drift) * along, p.y + Math.sin(drift) * along + (rng() - 0.5) * s * 0.6, -altitude + (rng() - 0.5) * 6),
        scale: new Vector3(s * (2 + rng() * 1.4), s * (0.14 + rng() * 0.12), s * 0.08),
      });
    }
  }
  root.add(puffField(cirrusSpecs, cloudMaterial(cirrus)));

  return { root, scud, deck, ceiling, cirrus };
}

// ---- the tether ------------------------------------------------------------------

export type TetherLayout = {
  x: number;
  y: number;
  from: number;
  to: number;
  markerSpacing: number;
  lampSpacing: number;
};

export type Tether = { root: Group; lampGlow: FloatUniform };

export function createTether(layout: TetherLayout, colors: { ribbon: Color; rail: Color; marker: Color; lamp: Color }): Tether {
  const root = new Group();
  const length = layout.to - layout.from;
  const center = -(layout.from + layout.to) / 2;

  // The ribbon: graphite with panel seams every few metres — the fastest thing
  // on screen, and the truest speedometer.
  const ribbonMaterial = new MeshBasicNodeMaterial();
  const seam = step(float(0.94), fract(positionWorld.z.mul(1 / 6)));
  const ribbonBase = vec3(colors.ribbon.r, colors.ribbon.g, colors.ribbon.b);
  const lightTerm = normalWorld.dot(sunDirectionUniform).mul(0.5).add(0.5);
  ribbonMaterial.colorNode = ribbonBase.mul(lightTerm.mul(0.8).add(0.5)).mul(float(1).sub(seam.mul(0.5))).add(flashLightUniform.mul(0.3));
  const ribbon = new Mesh(new BoxGeometry(0.7, 0.12, length), ribbonMaterial);
  ribbon.position.set(layout.x, layout.y, center);
  ribbon.userData.raildIgnoreOcclusion = true;
  root.add(ribbon);

  // Edge rails catch the light so the ribbon reads against any sky.
  const railMaterial = glowMaterial(colors.rail);
  for (const side of [-1, 1]) {
    const rail = new Mesh(new BoxGeometry(0.04, 0.18, length), railMaterial);
    rail.position.set(layout.x + side * 0.37, layout.y, center);
    rail.userData.raildIgnoreOcclusion = true;
    root.add(rail);
  }

  // Hazard marker bands and guide lamps along the whole climb.
  const markerCount = Math.floor(length / layout.markerSpacing);
  const markers = new InstancedMesh(new BoxGeometry(1.08, 0.3, 0.55), litMaterial(colors.marker), markerCount);
  const matrix = new Matrix4();
  for (let i = 0; i < markerCount; i += 1) {
    matrix.makeTranslation(layout.x, layout.y, -(layout.from + i * layout.markerSpacing));
    markers.setMatrixAt(i, matrix);
  }
  markers.frustumCulled = false;
  markers.userData.raildIgnoreOcclusion = true;
  root.add(markers);

  const lampGlow = floatUniform(1);
  const lampMaterial = new MeshBasicNodeMaterial();
  lampMaterial.colorNode = vec3(colors.lamp.r, colors.lamp.g, colors.lamp.b).mul(lampGlow);
  const lampCount = Math.floor(length / layout.lampSpacing);
  const lamps = new InstancedMesh(new SphereGeometry(0.16, 8, 6), lampMaterial, lampCount * 2);
  for (let i = 0; i < lampCount; i += 1) {
    for (const side of [0, 1]) {
      matrix.makeTranslation(layout.x + (side ? 0.55 : -0.55), layout.y + 0.12, -(layout.from + i * layout.lampSpacing + 3));
      lamps.setMatrixAt(i * 2 + side, matrix);
    }
  }
  lamps.frustumCulled = false;
  lamps.userData.raildIgnoreOcclusion = true;
  root.add(lamps);

  return { root, lampGlow };
}

// ---- the climber's drive head -------------------------------------------------------

export type DriveHead = {
  root: Group;
  beacon: Mesh;
  strobe: Mesh;
  beams: Object3D;
  wheels: Mesh[];
  damage: Group;
};

export function createDriveHead(colors: { hull: Color; graphite: Color; hazard: Color; steel: Color }): DriveHead {
  const root = new Group();
  const hull = litMaterial(colors.hull);
  const dark = litMaterial(colors.graphite);
  const steel = litMaterial(colors.steel);

  // Local frame: +z is down the tether, −z is up; the ribbon runs through x=0,y=0.
  const housing = new Mesh(new BoxGeometry(3.0, 1.9, 1.7), hull);
  housing.position.set(0, 0, 0.4);
  root.add(housing);
  const band = new Mesh(new BoxGeometry(3.08, 1.98, 0.5), hazardStripeMaterial(colors.hazard, colors.graphite, 2.4));
  band.position.set(0, 0, 1.15);
  root.add(band);
  const cap = new Mesh(new BoxGeometry(2.4, 1.5, 0.3), steel);
  cap.position.set(0, 0, -0.55);
  root.add(cap);
  // Vent slats on the camera-facing flank.
  for (let i = 0; i < 4; i += 1) {
    const slat = new Mesh(new BoxGeometry(0.42, 0.06, 0.9), dark);
    slat.position.set(-0.9 + i * 0.6, 0.98, 0.35);
    root.add(slat);
  }

  // Drive wheels clamp the ribbon above the housing and spin with the climb.
  const wheels: Mesh[] = [];
  const wheelGeometry = new CylinderGeometry(0.46, 0.46, 0.5, 18);
  for (const [y, z] of [[0.52, -1.05], [-0.52, -1.05], [0.52, -1.95], [-0.52, -1.95]] as const) {
    const wheel = new Mesh(wheelGeometry, dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(0, y, z);
    root.add(wheel);
    wheels.push(wheel);
    const hub = new Mesh(new CylinderGeometry(0.2, 0.2, 0.54, 10), hull);
    hub.rotation.z = Math.PI / 2;
    hub.position.copy(wheel.position);
    root.add(hub);
  }
  for (const x of [-0.42, 0.42]) {
    const cheek = new Mesh(new BoxGeometry(0.1, 1.9, 1.5), steel);
    cheek.position.set(x, 0, -1.5);
    root.add(cheek);
  }

  const mast = new Mesh(new BoxGeometry(0.08, 0.08, 2.4), steel);
  mast.position.set(1.3, 0.7, -1.2);
  root.add(mast);
  const beacon = new Mesh(new SphereGeometry(0.17, 12, 8), glowMaterial(colors.hazard.clone()));
  beacon.position.set(1.3, 0.7, -2.45);
  root.add(beacon);
  const strobe = new Mesh(new BoxGeometry(0.5, 0.12, 0.2), glowMaterial(colors.hazard.clone()));
  strobe.position.set(-1.05, 0.99, -0.3);
  root.add(strobe);

  // Floodlights up the ribbon; the beams only exist while there is air to catch them.
  const beamGeometry = new ConeGeometry(4.5, 90, 20, 1, true);
  beamGeometry.translate(0, -45, 0);
  beamGeometry.rotateX(-Math.PI / 2);
  const beamMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
  const along = positionLocal.z.negate().div(90);
  const edge = abs(normalWorld.dot(normalize(cameraPosition.sub(positionWorld))));
  beamMaterial.colorNode = vec3(1.0, 0.92, 0.78);
  beamMaterial.opacityNode = float(1).sub(along).mul(edge.mul(edge)).mul(0.1);
  const beams = new Group();
  for (const x of [-1.0, 1.0]) {
    const beam = new Mesh(beamGeometry, beamMaterial);
    beam.position.set(x, 0.5, -0.6);
    beam.userData.raildIgnoreOcclusion = true;
    beams.add(beam);
  }
  root.add(beams);

  const damage = new Group();
  root.add(damage);
  root.traverse((child) => {
    child.userData.raildIgnoreOcclusion = true;
  });
  return { root, beacon, strobe, beams, wheels, damage };
}

// ---- the launch complex -----------------------------------------------------------

export function createLaunchPad(layout: { x: number; y: number }, colors: { hull: Color; hazard: Color; graphite: Color; lamp: Color }) {
  const root = new Group();
  root.position.set(layout.x, layout.y, 0);

  const deck = new Mesh(new CylinderGeometry(46, 50, 4, 40), litMaterial(colors.graphite));
  deck.rotation.x = Math.PI / 2;
  deck.position.z = 3.5;
  root.add(deck);
  const ring = new Mesh(new TorusGeometry(12, 0.5, 6, 48), glowMaterial(colors.hazard.clone().multiplyScalar(1.4)));
  ring.position.z = 1.4;
  root.add(ring);

  // Four truss towers, banded orange and white like any tall thing near a pad.
  const trussParts: BufferGeometry[] = [];
  const height = 78;
  const half = 1.6;
  for (let seg = 0; seg < height / 6; seg += 1) {
    const z0 = -seg * 6;
    for (const [cx, cy] of [[-half, -half], [half, -half], [half, half], [-half, half]] as const) {
      const post = new BoxGeometry(0.34, 0.34, 6.1);
      post.translate(cx, cy, z0 - 3);
      setColor(post, seg % 2 === 0 ? colors.hazard : colors.hull);
      trussParts.push(post);
    }
    for (const [ax, ay, len, rot] of [[0, -half, half * 2, 0], [0, half, half * 2, 0], [-half, 0, half * 2, 1], [half, 0, half * 2, 1]] as const) {
      const rung = new BoxGeometry(rot ? 0.18 : len, rot ? len : 0.18, 0.18);
      rung.translate(ax, ay, z0);
      setColor(rung, colors.hull);
      trussParts.push(rung);
      const brace = new BoxGeometry(0.14, 0.14, 7.6);
      brace.rotateX(rot ? 0 : 0.7);
      brace.rotateY(rot ? 0.7 : 0);
      brace.translate(ax, ay, z0 - 3);
      setColor(brace, colors.hull);
      trussParts.push(brace);
    }
  }
  const truss = mergeGeometries(trussParts.map((g) => g.toNonIndexed()));
  const towerMaterial = litMaterial(new Color(1, 1, 1), { vertexColors: true });
  const lampMaterial = glowMaterial(colors.lamp.clone().multiplyScalar(1.6));
  const lamps: Mesh[] = [];
  for (const [angle, radius] of [[0.5, 24], [2.2, 30], [3.7, 26], [5.2, 32]] as const) {
    const tower = new Mesh(truss, towerMaterial);
    tower.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    root.add(tower);
    for (const level of [height * 0.5, height]) {
      const lamp = new Mesh(new SphereGeometry(0.42, 10, 8), lampMaterial);
      lamp.position.set(tower.position.x, tower.position.y, -level - 0.5);
      root.add(lamp);
      lamps.push(lamp);
    }
    // A gantry arm reaching toward the ribbon at the tower top.
    const arm = new Mesh(new BoxGeometry(radius - 4, 0.5, 0.5), litMaterial(colors.graphite));
    arm.position.set(Math.cos(angle) * (radius / 2 + 2), Math.sin(angle) * (radius / 2 + 2), -height + 2);
    arm.rotation.z = angle;
    root.add(arm);
  }
  root.traverse((child) => {
    child.userData.raildIgnoreOcclusion = true;
  });
  return { root, lampMaterial, lamps };
}

function setColor(geometry: BufferGeometry, color: Color) {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) colors.set([color.r, color.g, color.b], i * 3);
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
}

// ---- weather streaks and falling debris ------------------------------------------------

export type Streaks = {
  root: LineSegments;
  color: ColorUniform;
  update(cameraZ: number, relativeFall: number, windX: number, amount: number, dt: number): void;
};

export function createStreaks(count: number, seed: number): Streaks {
  const rng = mulberry32(seed);
  const base = new Float32Array(count * 3);
  const shade = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = 3 + Math.sqrt(rng()) * 70;
    base.set([Math.cos(angle) * radius, Math.sin(angle) * radius - 10, rng() * 240], i * 3);
    shade[i] = 0.35 + rng() * 0.65;
  }
  const positions = new Float32Array(count * 6);
  const colors = new Float32Array(count * 6);
  for (let i = 0; i < count; i += 1) {
    colors.set([shade[i], shade[i], shade[i], 0, 0, 0], i * 6);
  }
  const geometry = new BufferGeometry();
  const positionAttribute = new BufferAttribute(positions, 3);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const color = colorUniform(new Color(1, 1, 1));
  const material = new LineBasicNodeMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending });
  material.colorNode = color.mul(float(1));
  material.fog = false;
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.userData.raildIgnoreOcclusion = true;
  let scroll = 0;

  return {
    root: lines,
    color,
    update(cameraZ, relativeFall, windX, amount, dt) {
      lines.visible = amount > 0.01;
      if (!lines.visible) return;
      scroll += relativeFall * dt;
      const streakLength = Math.min(16, 0.6 + relativeFall * 0.05);
      const visibleCount = Math.floor(count * Math.min(1, amount));
      for (let i = 0; i < count; i += 1) {
        const o = i * 6;
        if (i >= visibleCount) {
          positions.fill(0, o, o + 6);
          positions[o + 2] = positions[o + 5] = cameraZ + 500;
          continue;
        }
        const z = cameraZ + ((((base[i * 3 + 2] + scroll) % 240) + 240) % 240) - 190;
        const x = base[i * 3];
        const y = base[i * 3 + 1];
        positions[o] = x;
        positions[o + 1] = y;
        positions[o + 2] = z;
        positions[o + 3] = x - windX * streakLength * 0.08;
        positions[o + 4] = y;
        positions[o + 5] = z - streakLength;
      }
      positionAttribute.needsUpdate = true;
    },
  };
}

export type DebrisField = {
  root: InstancedMesh;
  update(cameraZ: number, relativeFall: number, amount: number, dt: number, elapsed: number): void;
};

export function createDebris(count: number, seed: number, color: Color): DebrisField {
  const rng = mulberry32(seed);
  const geometry = new DodecahedronGeometry(1, 0).toNonIndexed();
  geometry.computeVertexNormals();
  const mesh = new InstancedMesh(geometry, litMaterial(color), count);
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;
  const items = Array.from({ length: count }, () => {
    const angle = rng() * Math.PI * 2;
    const radius = 12 + Math.sqrt(rng()) * 120;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius - 20,
      z: rng() * 420,
      size: 0.15 + rng() ** 3 * 1.6,
      spin: new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize(),
      rate: 1 + rng() * 4,
      fall: 8 + rng() * 26,
    };
  });
  const dummy = new Object3D();
  let scroll = 0;
  return {
    root: mesh,
    update(cameraZ, relativeFall, amount, dt, elapsed) {
      mesh.visible = amount > 0.01;
      if (!mesh.visible) return;
      scroll += dt;
      items.forEach((item, index) => {
        const travel = (item.z + scroll * (relativeFall + item.fall)) % 420;
        dummy.position.set(item.x, item.y, cameraZ - 330 + travel);
        dummy.quaternion.setFromAxisAngle(item.spin, elapsed * item.rate + index);
        dummy.scale.setScalar(index < count * amount ? item.size : 0.0001);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ---- the station ------------------------------------------------------------------

export type Station = {
  root: Group;
  dockLampColor: ColorUniform;
  petals: Mesh[];
  approachLamps: InstancedMesh;
  throatLamps: FloatUniform;
  chase: FloatUniform;
  update(open: number, elapsed: number): void;
};

export function createStation(
  layout: { x: number; y: number; altitude: number; throatRadius: number },
  colors: { hull: Color; panel: Color; hazard: Color; graphite: Color; steel: Color; solar: Color; lamp: Color; beacon: Color },
): Station {
  const root = new Group();
  root.position.set(layout.x, layout.y, -layout.altitude);
  const hull = litMaterial(colors.hull);
  const panel = litMaterial(colors.panel);
  const steel = litMaterial(colors.steel);
  const r0 = layout.throatRadius;

  // Hub: a thick lathe ring whose hole is the docking throat. Lathe +y is altitude.
  const profile = [
    new Vector2(r0, -12), new Vector2(r0 + 6, -14), new Vector2(24, -14), new Vector2(32, -8),
    new Vector2(34, 2), new Vector2(30, 10), new Vector2(18, 14), new Vector2(r0 + 1, 16), new Vector2(r0, 40),
  ];
  const hub = new Mesh(new LatheGeometry(profile, 48), hull);
  hub.rotation.x = -Math.PI / 2;
  root.add(hub);
  // Throat lining, seen from inside, banded with panel seams.
  const liningMaterial = new MeshBasicNodeMaterial({ side: DoubleSide });
  const seam = step(float(0.9), fract(positionLocal.y.mul(1 / 5)));
  const panelTone = vec3(colors.panel.r, colors.panel.g, colors.panel.b);
  liningMaterial.colorNode = panelTone.mul(float(0.55).sub(seam.mul(0.3))).add(flashLightUniform.mul(0.2));
  const lining = new Mesh(new CylinderGeometry(r0 - 0.2, r0 - 0.2, 52, 40, 1, true), liningMaterial);
  lining.rotation.x = -Math.PI / 2;
  lining.position.z = -14;
  root.add(lining);
  // The inner bulkhead that closes the throat, striped for the clamps.
  const bulkhead = new Mesh(new CircleGeometry(r0, 40), hazardStripeMaterial(colors.hazard, colors.graphite, 0.6));
  bulkhead.position.z = -36;
  root.add(bulkhead);
  // Clamp status lamps ringing the bulkhead: hazard while docking, green when sealed.
  const dockLampMaterial = new MeshBasicNodeMaterial();
  const dockLampColor = colorUniform(colors.lamp);
  dockLampMaterial.colorNode = dockLampColor;
  const dockLamps = new InstancedMesh(new SphereGeometry(0.5, 10, 8), dockLampMaterial, 12);
  const lampMatrix = new Matrix4();
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    lampMatrix.makeTranslation(Math.cos(angle) * (r0 - 1.6), Math.sin(angle) * (r0 - 1.6), -35.6);
    dockLamps.setMatrixAt(i, lampMatrix);
  }
  root.add(dockLamps);

  // Habitat ring, spokes, and solar wings.
  const ring = new Mesh(new TorusGeometry(56, 5, 16, 96), hull);
  ring.position.z = -4;
  root.add(ring);
  const ringBand = new Mesh(new TorusGeometry(56, 5.12, 6, 96, Math.PI * 2), hazardStripeMaterial(colors.hazard, colors.hull, 0.35));
  ringBand.scale.set(1, 1, 0.18);
  ringBand.position.z = -4;
  root.add(ringBand);
  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (i * Math.PI) / 2;
    const spoke = new Mesh(new BoxGeometry(24, 2.6, 2.6), steel);
    spoke.position.set(Math.cos(angle) * 43, Math.sin(angle) * 43, -4);
    spoke.rotation.z = angle;
    root.add(spoke);
  }
  const solarMaterial = new MeshBasicNodeMaterial();
  const grid = step(float(0.9), fract(positionLocal.x.mul(0.5))).max(step(float(0.86), fract(positionLocal.y.mul(0.25))));
  const lightTerm = normalWorld.dot(sunDirectionUniform).mul(0.5).add(0.5);
  solarMaterial.colorNode = mix(vec3(colors.solar.r, colors.solar.g, colors.solar.b), vec3(0.6, 0.62, 0.66), grid.mul(0.6)).mul(lightTerm.add(0.35));
  solarMaterial.side = DoubleSide;
  for (const side of [-1, 1]) {
    const truss = new Mesh(new BoxGeometry(84, 1.4, 1.4), steel);
    truss.position.set(side * 100, 0, -4);
    root.add(truss);
    for (const offset of [-1, 1]) {
      const wing = new Mesh(new BoxGeometry(76, 15, 0.5), solarMaterial);
      wing.position.set(side * 102, offset * 9, -4);
      root.add(wing);
    }
  }
  // Panel detailing on the hub underside: radial plates in two greys.
  for (let i = 0; i < 16; i += 1) {
    const angle = (i / 16) * Math.PI * 2;
    const plate = new Mesh(new BoxGeometry(9, 3.4, 0.6), i % 2 ? panel : hull);
    plate.position.set(Math.cos(angle) * 23, Math.sin(angle) * 23, 13.4);
    plate.rotation.z = angle;
    root.add(plate);
  }

  // Iris petals over the throat mouth: they slide outward as the dock opens.
  const petals: Mesh[] = [];
  const petalShape = new CylinderGeometry(r0 + 1.4, r0 + 1.4, 0.8, 12, 1, false, 0, Math.PI / 3);
  petalShape.rotateX(Math.PI / 2);
  for (let i = 0; i < 6; i += 1) {
    const material = i % 2 === 0 ? hazardStripeMaterial(colors.hazard, colors.graphite, 1.1) : hull;
    const petal = new Mesh(petalShape, material);
    petal.rotation.z = (i * Math.PI) / 3;
    petal.position.z = 12.5;
    root.add(petal);
    petals.push(petal);
  }

  // Approach lamps ringing the mouth chase inward to guide the car home.
  const chase = floatUniform(0);
  const lampCount = 24;
  const lampMaterial = new MeshBasicNodeMaterial();
  const lampPhase = fract(chase.sub(float(instanceIndex).div(lampCount)));
  const lampOn = step(lampPhase, float(0.2)).mul(0.9).add(0.1);
  lampMaterial.colorNode = vec3(colors.lamp.r, colors.lamp.g, colors.lamp.b).mul(lampOn.mul(1.6));
  const approachLamps = new InstancedMesh(new SphereGeometry(0.45, 8, 6), lampMaterial, lampCount);
  const m = new Matrix4();
  for (let i = 0; i < lampCount; i += 1) {
    const angle = (i / lampCount) * Math.PI * 2;
    m.makeTranslation(Math.cos(angle) * (r0 + 3.2), Math.sin(angle) * (r0 + 3.2), 14.2);
    approachLamps.setMatrixAt(i, m);
  }
  root.add(approachLamps);
  const throatLamps = floatUniform(1);
  const throatLampMaterial = new MeshBasicNodeMaterial();
  throatLampMaterial.colorNode = vec3(1.0, 0.86, 0.62).mul(throatLamps);
  const throatRings = new Group();
  for (let k = 0; k < 7; k += 1) {
    const band = new Mesh(new TorusGeometry(r0 - 0.35, 0.12, 4, 40), throatLampMaterial);
    band.position.z = 8 - k * 6.2;
    throatRings.add(band);
  }
  root.add(throatRings);
  const beaconMaterial = glowMaterial(colors.beacon.clone().multiplyScalar(2));
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const beacon = new Mesh(new SphereGeometry(0.9, 8, 6), beaconMaterial);
    beacon.position.set(Math.cos(angle) * 56, Math.sin(angle) * 56, 2);
    root.add(beacon);
  }

  root.traverse((child) => {
    child.userData.raildIgnoreOcclusion = true;
  });

  return {
    root,
    dockLampColor,
    petals,
    approachLamps,
    throatLamps,
    chase,
    update(open, elapsed) {
      petals.forEach((petal, i) => {
        const angle = (i * Math.PI) / 3 - Math.PI / 3;
        const slide = open * (r0 + 2.5);
        petal.position.x = Math.cos(angle) * slide;
        petal.position.y = Math.sin(angle) * slide;
      });
      chase.value = elapsed * 1.6;
    },
  };
}

export { Color, Vector3 };
