import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  Object3D,
  PlaneGeometry,
  PointLight,
  Points,
  Quaternion,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import { MeshBasicNodeMaterial, PointsNodeMaterial } from 'three/webgpu';
import {
  cameraPosition,
  clamp,
  float,
  mix,
  mx_noise_float,
  positionLocal,
  positionWorld,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import { mulberry32 } from '../../../engine/rng';
import { catenary, GeometryBucket } from './geometry';
import { senseUniforms, surfaceMaterial } from './materials';
import { MURK, THERMAL, hdr } from './palette';

// The drowned harbor. Leaf construction: a basin of tobacco water ringed by
// quays, cranes, and warehouses; wrecks jutting from it; a capsized freighter
// at its heart for the creature to wrap; sodium lamps everywhere. Static steel
// is merged by material so the whole yard costs a handful of draw calls.

export type Lamp = {
  position: Vector3;
  /** Relight order during the finale (0 first). */
  order: number;
  flicker: number;
  size: number;
};

export type Harbor = {
  root: Group;
  lamps: Lamp[];
  lampPower: Float32Array;
  crane: { pivot: Group; base: Vector3; axis: Vector3 };
  lights: { hemi: HemisphereLight; key: DirectionalLight; points: PointLight[] };
  update(dt: number, camera: Object3D): void;
};

const WATER_SIZE = 1400;

export function createHarbor(scene: Scene): Harbor {
  const root = new Group();
  root.name = 'harbor';
  const rng = mulberry32(0x7e41a);
  const rand = (min: number, max: number) => min + (max - min) * rng();

  const rust = new GeometryBucket();
  const rustDark = new GeometryBucket();
  const cream = new GeometryBucket();
  const iron = new GeometryBucket();
  const concrete = new GeometryBucket();
  const windows = new GeometryBucket();
  const lamps: Lamp[] = [];

  const addLamp = (position: Vector3, size = 1) => {
    lamps.push({ position: position.clone(), order: 0, flicker: rng(), size });
  };

  // ---- the capsized freighter the creature has wrapped ---------------------------
  {
    const hullCenter = new Vector3(0, -2.8, -13);
    const hull = new CylinderGeometry(8.5, 8.5, 78, 18, 1, false);
    rust.add(hull, hullCenter, new Euler(0, 0, Math.PI / 2), new Vector3(1, 1, 0.82));
    // Keel, bilge keels, the boot-top stripe in dirty cream paint.
    rustDark.box(78, 1.2, 1.1, new Vector3(0, 5.8, -13));
    rustDark.box(52, 0.4, 0.6, new Vector3(0, 3.6, -8.2), new Euler(0.6, 0, 0));
    rustDark.box(52, 0.4, 0.6, new Vector3(0, 3.6, -17.8), new Euler(-0.6, 0, 0));
    cream.box(74, 0.7, 0.3, new Vector3(0, 0.9, -6.2));
    cream.box(74, 0.7, 0.3, new Vector3(0, 0.9, -19.8));
    // Bow cone and stern with rudder and a four-blade screw in the air.
    rust.add(new CylinderGeometry(0.4, 8.5, 14, 18, 1), new Vector3(46, -2.8, -13), new Euler(0, 0, Math.PI / 2), new Vector3(1, 1, 0.82));
    rustDark.box(1, 9, 7, new Vector3(-41.5, 3.5, -13));
    iron.cylinder(1.1, 1.1, 3, new Vector3(-40, 1.5, -13), new Euler(0, 0, Math.PI / 2));
    for (let i = 0; i < 4; i += 1) {
      const angle = (i / 4) * Math.PI * 2 + 0.3;
      iron.box(0.4, 4.2, 1.6, new Vector3(-40.8, 1.5 + Math.cos(angle) * 2, -13 + Math.sin(angle) * 2), new Euler(angle, 0, 0));
    }
    // Hull plating seams.
    for (let x = -34; x <= 34; x += 8.5) rustDark.box(0.25, 0.3, 14, new Vector3(x, 5.2, -13));
    // Work lamps the salvage crew left burning on the keel.
    addLamp(new Vector3(-24, 7.8, -13), 1.1);
    addLamp(new Vector3(22, 7.8, -13), 1.1);
    iron.cylinder(0.12, 0.12, 2, new Vector3(-24, 6.8, -13));
    iron.cylinder(0.12, 0.12, 2, new Vector3(22, 6.8, -13));
  }

  // ---- low debris between the rail and the creature -------------------------------
  const container = (bucket: GeometryBucket, position: Vector3, yaw: number, roll = 0) => {
    bucket.box(12, 2.6, 2.5, position, new Euler(roll, yaw, 0));
    for (let i = -5; i <= 5; i += 1.25) {
      rustDark.box(0.12, 2.62, 2.56, position.clone().add(new Vector3(Math.cos(yaw) * i, 0, -Math.sin(yaw) * i)), new Euler(roll, yaw, 0));
    }
  };
  // Floating containers ride low, below the brood's waterline.
  container(rust, new Vector3(-30, -0.5, 32), 0.7, 0.2);
  container(cream, new Vector3(31, -0.6, -33), -0.4, -0.25);
  container(rust, new Vector3(-26, -0.6, -40), 1.2, 0.3);
  container(cream, new Vector3(34, -0.5, 30), 2.1, 0.1);
  // A half-sunk barge.
  rustDark.box(26, 2.2, 9, new Vector3(-40, 0.4, 62), new Euler(0.05, 0.4, 0.06));
  cream.box(6, 3, 5, new Vector3(-48, 2.6, 58), new Euler(0.05, 0.4, 0.06));

  // ---- wreck superstructures poking from the basin ---------------------------------
  const wreck = (x: number, z: number, yaw: number, tilt: number, scale: number) => {
    const base = new Vector3(x, 0, z);
    const rot = new Euler(tilt, yaw, tilt * 0.6);
    const q = new Quaternion().setFromEuler(rot);
    const at = (dx: number, dy: number, dz: number) => base.clone().add(new Vector3(dx, dy, dz).multiplyScalar(scale).applyQuaternion(q));
    rust.add(new CylinderGeometry(1, 1, 1, 4), at(0, 1, 0), rot, new Vector3(18 * scale, 5 * scale, 11 * scale));
    cream.box(12 * scale, 6 * scale, 8 * scale, at(-2, 6, 0), rot);
    cream.box(8 * scale, 3 * scale, 7.5 * scale, at(-2, 10.5, 0), rot);
    // Bridge windows: a row of dim sodium-lit panes.
    for (let i = -2; i <= 2; i += 1) windows.box(1.1 * scale, 0.9 * scale, 0.1, at(-2 + i * 1.5, 10.8, 3.8), rot);
    rustDark.cylinder(1.2 * scale, 1.5 * scale, 7 * scale, at(4, 9.5, 0), rot);
    cream.cylinder(1.25 * scale, 1.25 * scale, 1.2 * scale, at(4, 11.5, 0), rot);
    iron.beam(at(-2, 12, 0), at(-2.5, 24, 0.5), 0.3 * scale, true);
    iron.beam(at(-2.5, 20, 0.5), at(-6, 18, 0.5), 0.12 * scale, true);
    addLamp(at(-2.5, 24.4, 0.5), 0.8 * scale);
  };
  wreck(-60, 110, 0.6, 0.14, 1.2);
  wreck(95, 90, -0.9, -0.2, 1.1);
  wreck(112, -62, 2.2, 0.12, 1.3);
  wreck(-104, -72, -2.4, 0.18, 1.2);
  wreck(-112, 40, 1.4, -0.1, 1);
  wreck(42, -122, 0.2, 0.22, 1.1);
  wreck(-32, -126, 2.9, -0.16, 1.2);

  // ---- quays, warehouses, container stacks ------------------------------------------
  const quay = (from: Vector3, to: Vector3) => {
    const direction = to.clone().sub(from);
    const length = direction.length();
    const yaw = Math.atan2(direction.x, direction.z);
    const middle = from.clone().add(to).multiplyScalar(0.5);
    concrete.box(10, 5, length, middle.clone().setY(1.5), new Euler(0, yaw, 0));
    rustDark.box(0.6, 0.5, length, middle.clone().add(new Vector3(0, 0.2, 0)).setY(-0.2), new Euler(0, yaw, 0));
    // Tire fenders and bollards along the face.
    const steps = Math.floor(length / 16);
    for (let i = 0; i <= steps; i += 1) {
      const point = from.clone().lerp(to, i / Math.max(1, steps));
      iron.cylinder(0.5, 0.6, 1.2, point.clone().setY(4.6));
      if (i % 3 === 0) {
        iron.cylinder(0.18, 0.18, 12, point.clone().setY(10));
        addLamp(point.clone().setY(16.2), 0.9);
      }
    }
    // Warehouses and stacks behind the quay line.
    const back = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const outward = middle.clone().setY(0).normalize();
    if (back.dot(outward) < 0) back.negate();
    const blocks = Math.floor(length / 34);
    for (let i = 0; i < blocks; i += 1) {
      const point = from.clone().lerp(to, (i + 0.5) / blocks).addScaledVector(back, rand(18, 34));
      const height = rand(8, 22);
      const bucket = rng() < 0.5 ? concrete : rng() < 0.5 ? rust : cream;
      bucket.box(rand(18, 28), height, rand(14, 22), point.clone().setY(height / 2), new Euler(0, yaw, 0));
      if (rng() < 0.6) {
        // A chimney with a lamp.
        const chimney = point.clone().addScaledVector(back, 4).setY(height + 9);
        rustDark.cylinder(1.4, 2, 18, chimney);
        addLamp(chimney.clone().setY(height + 18.6), 1.2);
      }
      for (let s = 0; s < 3; s += 1) {
        const stack = from.clone().lerp(to, (i + 0.2 + s * 0.28) / blocks).addScaledVector(back, rand(6, 10));
        const layers = 1 + Math.floor(rng() * 4);
        for (let l = 0; l < layers; l += 1) {
          const containerBucket = rng() < 0.45 ? rust : rng() < 0.6 ? cream : rustDark;
          containerBucket.box(12, 2.6, 2.5, stack.clone().setY(3 + l * 2.65), new Euler(0, yaw + Math.PI / 2 + rand(-0.05, 0.05), 0));
        }
      }
    }
  };
  quay(new Vector3(-240, 0, -235), new Vector3(240, 0, -235));
  quay(new Vector3(235, 0, -235), new Vector3(235, 0, 250));
  quay(new Vector3(-235, 0, 250), new Vector3(-235, 0, -235));
  quay(new Vector3(-235, 0, 262), new Vector3(-55, 0, 262));
  quay(new Vector3(80, 0, 262), new Vector3(235, 0, 262));
  // Breakwater light at the harbor mouth, behind the start.
  concrete.cylinder(4, 5, 16, new Vector3(12, 8, 290));
  cream.cylinder(2.2, 2.6, 8, new Vector3(12, 20, 290));
  addLamp(new Vector3(12, 25, 290), 2.2);

  // ---- harbor cranes ------------------------------------------------------------------
  const crane = (bucket: GeometryBucket, base: Vector3, yaw: number, height: number, reach: number, detail: GeometryBucket) => {
    const q = new Quaternion().setFromEuler(new Euler(0, yaw, 0));
    const at = (dx: number, dy: number, dz: number) => base.clone().add(new Vector3(dx, dy, dz).applyQuaternion(q));
    const legs: Array<[number, number]> = [[-6, -5], [6, -5], [-6, 5], [6, 5]];
    for (const [lx, lz] of legs) bucket.beam(at(lx, 0, lz), at(lx * 0.7, height, lz * 0.7), 1.1);
    for (let y = 8; y < height; y += 9) {
      bucket.beam(at(-6 * (1 - y / height * 0.3), y, -5), at(6 * (1 - y / height * 0.3), y, -5), 0.5);
      bucket.beam(at(-6 * (1 - y / height * 0.3), y, 5), at(6 * (1 - y / height * 0.3), y, 5), 0.5);
      bucket.beam(at(-6 * (1 - y / height * 0.3), y, -5), at(6 * (1 - (y + 9) / height * 0.3), y + 9, 5), 0.3);
    }
    bucket.box(8, 3, reach + 20, at(0, height + 1.5, reach / 2 - 10));
    detail.box(5, 4, 6, at(0, height + 4, -6));
    for (let z = -8; z < reach + 8; z += 6) detail.beam(at(-3.5, height + 3, z), at(3.5, height, z + 3), 0.18, true);
    addLamp(at(0, height + 6.5, -6), 1.3);
    addLamp(at(0, height - 0.6, reach + 8), 1.1);
    // Cables hanging from the trolley, one snapped and swinging short.
    const trolley = at(0, height, reach * 0.62);
    detail.cable(catenary(trolley, trolley.clone().setY(base.y - 2), 0, 6), 0.12, 8);
    const snapped = at(2, height, reach * 0.3);
    detail.cable([snapped, snapped.clone().add(new Vector3(0.6, -8, 0.4)), snapped.clone().add(new Vector3(1.8, -15, 1.4))], 0.1, 10);
  };
  crane(rustDark, new Vector3(150, 0, -170), -2.3, 52, 58, iron);
  crane(rust, new Vector3(-165, 0, -158), 2.4, 56, 62, iron);
  crane(rustDark, new Vector3(195, 0, 30), -1.6, 48, 54, iron);
  crane(rust, new Vector3(-196, 0, -22), 1.6, 50, 56, iron);
  crane(rustDark, new Vector3(128, 0, 176), -0.7, 46, 52, iron);
  crane(rust, new Vector3(-150, 0, 160), 0.8, 50, 52, iron);

  // Long pipes along the east quay, broken where they meet the water.
  rustDark.beam(new Vector3(208, 3, -200), new Vector3(208, 3, 180), 1.6, true);
  rustDark.beam(new Vector3(212, 5.5, -200), new Vector3(212, 5.5, 120), 1.2, true);
  rustDark.beam(new Vector3(212, 5.5, 120), new Vector3(190, -3, 132), 1.2, true);

  // Mooring dolphins with lamps along the approach and the circling.
  const dolphin = (position: Vector3) => {
    for (let i = 0; i < 3; i += 1) {
      const angle = (i / 3) * Math.PI * 2;
      rustDark.cylinder(0.7, 0.8, 9, position.clone().add(new Vector3(Math.cos(angle) * 1.4, 3, Math.sin(angle) * 1.4)));
    }
    concrete.box(4.4, 0.8, 4.4, position.clone().setY(7.6));
    iron.cylinder(0.12, 0.12, 5, position.clone().setY(10.4));
    addLamp(position.clone().setY(13.1), 0.9);
  };
  for (const position of [
    new Vector3(-44, 0, 176), new Vector3(52, 0, 150), new Vector3(-34, 0, 120), new Vector3(58, 0, 102),
    new Vector3(84, 0, 44), new Vector3(96, 0, -8), new Vector3(88, 0, -62), new Vector3(34, 0, -100),
    new Vector3(-24, 0, -104), new Vector3(-82, 0, -76), new Vector3(-96, 0, -10), new Vector3(-86, 0, 44),
  ]) dolphin(position);

  // Chains strung between dolphins and the wreck, sagging into the water.
  iron.cable(catenary(new Vector3(-24, 5, -13), new Vector3(-26, -1, -40), 3), 0.22, 16);
  iron.cable(catenary(new Vector3(24, 5, -13), new Vector3(31, -1, -33), 2), 0.22, 16);
  iron.cable(catenary(new Vector3(-39, 5, -13), new Vector3(-30, -1, 32), 4), 0.22, 16);

  // ---- materials -------------------------------------------------------------------
  const steel = (color: Color, heat: Color, roughness: number, metalness: number) =>
    surfaceMaterial({ color, heat, roughness, metalness, cooling: 0.5 });
  const meshes: Array<[GeometryBucket, ReturnType<typeof surfaceMaterial>, string]> = [
    [rust, steel(MURK.rust, THERMAL.steel, 0.86, 0.35), 'rust'],
    [rustDark, steel(MURK.rustDark, THERMAL.steel.clone().multiplyScalar(0.8), 0.9, 0.4), 'rust-dark'],
    [cream, steel(MURK.cream, THERMAL.steelWarm, 0.8, 0.1), 'cream'],
    [iron, steel(MURK.iron, THERMAL.steel.clone().multiplyScalar(0.7), 0.6, 0.7), 'iron'],
    [concrete, steel(MURK.concrete, THERMAL.steel, 0.95, 0), 'concrete'],
    [windows, surfaceMaterial({ color: MURK.iron, heat: THERMAL.steelWarm, emissive: hdr(MURK.sodium, 0.7), lampPowered: true, lit: false }), 'windows'],
  ];
  for (const [bucket, material, name] of meshes) {
    if (bucket.size === 0) continue;
    const mesh = new Mesh(bucket.merge(), material);
    mesh.name = `harbor-${name}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    root.add(mesh);
  }

  // ---- the collapsing crane (animated by the spine) --------------------------------
  const craneBase = new Vector3(28, 0, -48);
  const cranePivot = new Group();
  cranePivot.name = 'collapsing-crane';
  cranePivot.position.copy(craneBase);
  {
    const collapsing = new GeometryBucket();
    crane(collapsing, new Vector3(0, 0, 0), Math.PI / 2 + 0.2, 34, 40, collapsing);
    const mesh = new Mesh(collapsing.merge(), steel(MURK.rust, THERMAL.steel, 0.85, 0.35));
    cranePivot.add(mesh);
  }
  // Its lamps were registered at the local origin; move them with the pivot.
  const craneLamps = lamps.splice(lamps.length - 2, 2);
  root.add(cranePivot);

  // ---- water -------------------------------------------------------------------------
  const waterMaterial = new MeshBasicNodeMaterial();
  const wp = positionWorld;
  const ripple = mx_noise_float(vec3(wp.x.mul(0.05), wp.z.mul(0.16), time.mul(0.22)))
    .add(mx_noise_float(vec3(wp.x.mul(0.21), wp.z.mul(0.5), time.mul(0.5))).mul(0.5));
  const toEye = cameraPosition.sub(wp).normalize();
  const grazing = float(1).sub(toEye.y.abs()).pow(4);
  const sheen = smoothstep(float(0.35), float(1.1), ripple).mul(grazing.mul(0.9).add(0.1));
  const murkWater = vec3(MURK.water.r, MURK.water.g, MURK.water.b)
    .add(vec3(MURK.waterSheen.r, MURK.waterSheen.g, MURK.waterSheen.b).mul(sheen).mul(senseUniforms.lamps.mul(0.75).add(0.25)));
  const thermalWater = vec3(THERMAL.water.r, THERMAL.water.g, THERMAL.water.b)
    .add(vec3(0.05, 0.05, 0.052).mul(smoothstep(float(0.6), float(1.2), ripple)));
  waterMaterial.colorNode = mix(murkWater, thermalWater, senseUniforms.thermal);
  const water = new Mesh(new PlaneGeometry(WATER_SIZE, WATER_SIZE, 1, 1), waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.name = 'harbor-water';
  root.add(water);

  // ---- lamps: bulbs, halos, water streaks ---------------------------------------------
  // Relight order: sweep from the creature outward so the harbor comes back
  // like a wave of breakers being thrown.
  const allLamps = [...lamps, ...craneLamps];
  const byDistance = [...allLamps].sort((a, b) => a.position.length() - b.position.length());
  byDistance.forEach((lamp, index) => {
    lamp.order = index / Math.max(1, byDistance.length - 1);
  });
  const staticLamps = lamps;
  const lampPower = new Float32Array(staticLamps.length).fill(1);

  const bulbMaterial = surfaceMaterial({ color: new Color(0, 0, 0), heat: THERMAL.lampDull, emissive: hdr(MURK.sodiumHot, 2.6), lit: false });
  const bulbs = new InstancedMesh(new SphereGeometry(0.55, 8, 6), bulbMaterial, staticLamps.length);
  bulbs.name = 'harbor-bulbs';
  const haloMaterial = new MeshBasicNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
  {
    const d = uv().sub(0.5).length().mul(2);
    const core = clamp(float(1).sub(d), 0, 1).pow(5);
    const wide = clamp(float(1).sub(d), 0, 1).pow(2).mul(0.12);
    haloMaterial.colorNode = vec3(MURK.sodium.r, MURK.sodium.g, MURK.sodium.b)
      .mul(core.mul(1.1).add(wide))
      .mul(senseUniforms.thermal.oneMinus());
  }
  const halos = new InstancedMesh(new PlaneGeometry(1, 1), haloMaterial, staticLamps.length);
  halos.name = 'harbor-halos';
  halos.frustumCulled = false;
  const streakMaterial = new MeshBasicNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
  {
    const q = uv();
    const across = float(1).sub(q.x.sub(0.5).abs().mul(2)).pow(2);
    const along = float(1).sub(q.y).pow(1.6);
    const shimmer = mx_noise_float(vec3(q.x.mul(3), q.y.mul(16).sub(time.mul(1.4)), time.mul(0.6))).mul(0.5).add(0.55);
    streakMaterial.colorNode = vec3(MURK.sodium.r, MURK.sodium.g, MURK.sodium.b)
      .mul(across.mul(along).mul(shimmer).mul(0.55))
      .mul(senseUniforms.thermal.oneMinus());
  }
  const streaks = new InstancedMesh(new PlaneGeometry(1, 1), streakMaterial, staticLamps.length);
  streaks.name = 'harbor-lamp-streaks';
  streaks.frustumCulled = false;
  const powerColor = new Color();
  staticLamps.forEach((lamp, index) => {
    bulbs.setMatrixAt(index, new Matrix4().compose(lamp.position, new Quaternion(), new Vector3(1, 1, 1).multiplyScalar(lamp.size)));
    bulbs.setColorAt(index, powerColor.setScalar(1));
    halos.setColorAt(index, powerColor);
    streaks.setColorAt(index, powerColor);
  });
  root.add(bulbs, halos, streaks);

  // The collapsing crane carries its own two lamps as children.
  const craneBulbs: Mesh[] = [];
  for (const lamp of craneLamps) {
    const bulb = new Mesh(new SphereGeometry(0.6, 8, 6), bulbMaterial);
    bulb.position.copy(lamp.position);
    const halo = new Mesh(new PlaneGeometry(1, 1), haloMaterial);
    halo.scale.setScalar(9);
    bulb.add(halo);
    halo.userData.billboard = true;
    cranePivot.add(bulb);
    craneBulbs.push(bulb);
  }

  // ---- floodlight cones cutting through the grit ----------------------------------------
  const coneMaterial = new MeshBasicNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
  {
    const q = uv();
    const fade = q.y.pow(1.8);
    const dust = mx_noise_float(vec3(positionLocal.x.mul(0.35), positionLocal.y.mul(0.2).add(time.mul(0.3)), positionLocal.z.mul(0.35))).mul(0.35).add(0.8);
    coneMaterial.colorNode = vec3(MURK.sodium.r, MURK.sodium.g, MURK.sodium.b)
      .mul(fade.mul(dust).mul(0.07))
      .mul(senseUniforms.lamps)
      .mul(senseUniforms.thermal.oneMinus());
  }
  const cone = (apex: Vector3, target: Vector3, radius: number) => {
    const direction = target.clone().sub(apex);
    const length = direction.length();
    const geometry = new CylinderGeometry(0.4, radius, length, 20, 1, true);
    geometry.translate(0, -length / 2, 0);
    const mesh = new Mesh(geometry, coneMaterial);
    mesh.position.copy(apex);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), direction.normalize());
    mesh.userData.raildIgnoreOcclusion = true;
    root.add(mesh);
  };
  cone(new Vector3(-24, 7.8, -13), new Vector3(-6, 0, 10), 9);
  cone(new Vector3(22, 7.8, -13), new Vector3(8, 0, 12), 9);
  cone(new Vector3(150, 58, -170), new Vector3(120, 0, -120), 20);
  cone(new Vector3(-165, 62, -158), new Vector3(-130, 0, -110), 22);
  cone(new Vector3(195, 54, 30), new Vector3(150, 0, 40), 20);
  cone(new Vector3(-150, 56, 160), new Vector3(-118, 0, 128), 20);

  // ---- grit hanging in the lamplight ------------------------------------------------------
  const GRIT = 2400;
  const gritBox = 70;
  const gritPositions = new Float32Array(GRIT * 3);
  for (let i = 0; i < GRIT; i += 1) {
    gritPositions[i * 3] = rng() * gritBox;
    gritPositions[i * 3 + 1] = rng() * gritBox;
    gritPositions[i * 3 + 2] = rng() * gritBox;
  }
  const gritGeometry = new BufferGeometry();
  gritGeometry.setAttribute('position', new Float32BufferAttribute(gritPositions, 3));
  const gritOrigin = uniform(new Vector3());
  const gritMaterial = new PointsNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false });
  const drift = vec3(time.mul(0.6), time.mul(-0.35), time.mul(0.25));
  // Offset by a whole number of boxes so the wrap never sees a negative value.
  const wrapped = positionLocal.add(drift).sub(gritOrigin).add(gritBox * 100).mod(gritBox).add(gritOrigin).sub(gritBox / 2);
  gritMaterial.positionNode = wrapped;
  const gritFade = float(1).sub(wrapped.sub(cameraPosition).length().div(gritBox * 0.5)).clamp(0, 1);
  gritMaterial.colorNode = mix(
    vec3(MURK.sodiumHot.r, MURK.sodiumHot.g, MURK.sodiumHot.b).mul(0.55).mul(senseUniforms.lamps.mul(0.7).add(0.3)),
    vec3(0.3, 0.3, 0.3),
    senseUniforms.thermal,
  ).mul(gritFade);
  const grit = new Points(gritGeometry, gritMaterial);
  grit.frustumCulled = false;
  grit.name = 'harbor-grit';
  root.add(grit);

  // ---- lights -------------------------------------------------------------------------------
  const hemi = new HemisphereLight(new Color(0.75, 0.52, 0.26), new Color(0.12, 0.07, 0.03), 1.6);
  const key = new DirectionalLight(new Color(1.0, 0.72, 0.42), 1.1);
  key.position.set(60, 90, 140);
  const points: PointLight[] = [];
  for (const [x, y, z, intensity] of [
    [-24, 9, -10, 520],
    [22, 9, -10, 520],
    [0, 30, 26, 900],
    [40, 14, 40, 600],
    [-40, 16, -40, 600],
  ] as const) {
    const light = new PointLight(new Color(1.0, 0.6, 0.26), intensity, 0, 2);
    light.position.set(x, y, z);
    light.userData.base = intensity;
    points.push(light);
    root.add(light);
  }
  root.add(hemi, key);

  scene.add(root);

  const baseHemi = hemi.intensity;
  const baseKey = key.intensity;
  const tmpMatrix = new Matrix4();
  const tmpQuat = new Quaternion();
  const tmpScale = new Vector3();
  const tmpPos = new Vector3();
  const toViewer = new Vector3();
  const UP = new Vector3(0, 1, 0);
  const flatten = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  let clock = 0;

  function update(dt: number, camera: Object3D) {
    clock += dt;
    const thermal = senseUniforms.thermal.value as number;
    const lampsOn = senseUniforms.lamps.value as number;
    // The yard's lamps throb faintly with the industrial pulse.
    const throb = 1 + (senseUniforms.beat.value as number) * 0.14;
    hemi.intensity = baseHemi * (1 - thermal) * (0.35 + 0.65 * lampsOn);
    key.intensity = baseKey * (1 - thermal) * (0.4 + 0.6 * lampsOn);
    for (const light of points) light.intensity = (light.userData.base as number) * (1 - thermal) * lampsOn;

    gritOrigin.value.copy(camera.position);

    staticLamps.forEach((lamp, index) => {
      const power = lampPower[index];
      const flicker = 0.88 + 0.12 * Math.sin(clock * (7 + lamp.flicker * 9) + lamp.flicker * 40) * Math.sin(clock * 2.3 + lamp.flicker * 11);
      const level = power * flicker * throb;
      powerColor.setScalar(level);
      bulbs.setColorAt(index, powerColor);
      halos.setColorAt(index, powerColor);
      streaks.setColorAt(index, powerColor);
      const distance = lamp.position.distanceTo(camera.position);
      // Halos keep a minimum screen size so distant lamps still read as stains.
      const haloSize = lamp.size * Math.max(4.5, distance * 0.05) * (0.6 + 0.4 * power);
      tmpMatrix.compose(lamp.position, camera.quaternion, tmpScale.setScalar(haloSize));
      halos.setMatrixAt(index, tmpMatrix);
      // The glitter path lies flat on the water, running from under the lamp
      // toward the viewer; foreshortening stands it up in the image.
      const streakLength = Math.min(lamp.position.y * 1.8 + 8, 55);
      toViewer.set(camera.position.x - lamp.position.x, 0, camera.position.z - lamp.position.z);
      if (toViewer.lengthSq() < 1e-4) toViewer.set(0, 0, 1);
      toViewer.normalize();
      tmpPos.copy(lamp.position).setY(0.06).addScaledVector(toViewer, streakLength / 2);
      tmpQuat.setFromAxisAngle(UP, Math.atan2(-toViewer.x, -toViewer.z)).multiply(flatten);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale.set(lamp.size * 2.6 + distance * 0.01, streakLength, 1));
      streaks.setMatrixAt(index, tmpMatrix);
    });
    for (const mesh of [bulbs, halos, streaks]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const bulb of craneBulbs) {
      const halo = bulb.children[0];
      bulb.updateMatrixWorld();
      bulb.getWorldQuaternion(tmpQuat);
      halo.quaternion.copy(tmpQuat.invert().multiply(camera.quaternion));
    }
  }

  return {
    root,
    lamps: staticLamps,
    lampPower,
    crane: { pivot: cranePivot, base: craneBase, axis: new Vector3(0.35, 0, -1).normalize() },
    lights: { hemi, key, points },
    update,
  };
}
