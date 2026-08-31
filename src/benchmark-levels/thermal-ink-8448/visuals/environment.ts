import {
  BoxGeometry,
  BufferGeometry,
  Camera,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import { offsetFromRail, sampleRailFrame } from '../../../engine/rail';
import { createThermalInk8448Rail } from '../gameplay';
import {
  applyThermalMode,
  createThermalRoot,
  registerThermalPart,
  type ObjectWithThermalParts,
  type ThermalPart,
} from './enemies';
import {
  BONE,
  CREAM,
  IR_BACKGROUND,
  IR_CHARCOAL,
  IR_INK,
  IR_RED,
  IR_STEEL,
  IR_WHITE_EDGE,
  IR_WHITE_HOT,
  INK,
  LAMP,
  MUD,
  OCHRE,
  OILY,
  RUST,
  RUST_DARK,
  SIGNAL,
  WATER,
  WATER_DEEP,
  hdr,
} from './palette';

type Lamp = {
  material: MeshBasicMaterial;
  normal: Color;
  infrared: Color;
  phase: number;
};

export type ThermalInkEnvironment = {
  root: Group;
  boss: ObjectWithThermalParts;
  update(runProgress: number, time: number, dt: number, camera: Camera, infrared: boolean): void;
  setMode(infrared: boolean): void;
  reset(): void;
};

const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

export function createEnvironment(scene: Scene): ThermalInkEnvironment {
  const rail = createThermalInk8448Rail();
  const root = createThermalRoot();
  root.userData.raildIgnoreOcclusion = true;
  scene.background = WATER_DEEP.clone();
  scene.add(root);

  const modeObjects: ObjectWithThermalParts[] = [root];
  const lamps: Lamp[] = [];
  createWater(root);
  createGrit(root, lamps);
  createHarbourStructures(root, rail, lamps);
  createWreckage(root, rail);

  const boss = createOctopus();
  boss.userData.raildIgnoreOcclusion = true;
  root.add(boss);
  modeObjects.push(boss);

  let infrared = false;
  let timeNow = 0;
  let beatBreath = 0;

  function setMode(next: boolean) {
    infrared = next;
    scene.background = (next ? IR_BACKGROUND : WATER_DEEP).clone();
    for (const object of modeObjects) applyThermalMode(object, next);
    const grit = root.userData.gritMaterial as PointsMaterial | undefined;
    if (grit) grit.color.copy(next ? IR_CHARCOAL : hdr(OCHRE, 0.38));
  }

  function reset() {
    timeNow = 0;
    beatBreath = 0;
    boss.visible = true;
    setMode(false);
  }

  function update(runProgress: number, time: number, dt: number, camera: Camera, mode: boolean) {
    timeNow = time;
    beatBreath = Math.max(0, beatBreath - dt * 3.8);
    if (mode !== infrared) setMode(mode);

    const bossU = MathUtils.clamp(runProgress + (runProgress < 0.002 ? 0.045 : 0.075), 0.03, 0.92);
    const bossLead = runProgress < 0.002 ? 14 : 18;
    boss.position.copy(offsetFromRail(rail, bossU, new Vector3(0, -0.9, bossLead)));
    boss.quaternion.copy(camera.quaternion);
    const lateScale = MathUtils.lerp(1, 0.64, MathUtils.clamp((runProgress - 0.76) / 0.24, 0, 1));
    const bossPulse = lateScale * (1 + Math.sin(timeNow * 1.05) * 0.035 + beatBreath * 0.018);
    boss.scale.setScalar(bossPulse);
    const tentacles = boss.userData.tentacles as Group[] | undefined;
    if (tentacles) {
      for (const [index, tentacle] of tentacles.entries()) {
        tentacle.rotation.z = Math.sin(timeNow * (0.55 + index * 0.035) + index) * (0.06 + index * 0.006);
        tentacle.rotation.x = Math.cos(timeNow * 0.42 + index * 0.7) * 0.035;
      }
    }

    for (const lamp of lamps) {
      const flicker = 0.72 + Math.sin(timeNow * 2.1 + lamp.phase) * 0.12 + Math.sin(timeNow * 11.7 + lamp.phase * 1.7) * 0.045;
      lamp.material.color.copy(lamp.normal).multiplyScalar(infrared ? 1 : flicker);
      if (infrared) lamp.material.color.copy(lamp.infrared).multiplyScalar(0.78 + beatBreath * 0.12);
    }
  }

  return { root, boss, update, setMode, reset };
}

function createWater(root: Group) {
  const material = new MeshBasicMaterial({ color: WATER, transparent: true, opacity: 0.72, side: DoubleSide, depthWrite: false });
  registerThermalPart(root, material, WATER, IR_CHARCOAL, 0.72, 0.32);
  const water = new Mesh(new BoxGeometry(190, 0.35, 680), material);
  water.position.set(0, -9, -290);
  water.userData.raildIgnoreOcclusion = true;
  root.add(water);

  const reflectionMaterial = new MeshBasicMaterial({ color: hdr(OCHRE, 0.22), transparent: true, opacity: 0.26, side: DoubleSide, depthWrite: false });
  registerThermalPart(root, reflectionMaterial, hdr(OCHRE, 0.22), IR_INK, 0.26, 0.08);
  const reflection = new Mesh(new BoxGeometry(150, 0.035, 650), reflectionMaterial);
  reflection.position.set(0, -8.76, -290);
  reflection.userData.raildIgnoreOcclusion = true;
  root.add(reflection);
}

function createGrit(root: Group, lamps: Lamp[]) {
  const count = 720;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let seed = 8448;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (random() - 0.5) * 130;
    positions[index * 3 + 1] = -5 + random() * 28;
    positions[index * 3 + 2] = 15 - random() * 610;
    const brightness = 0.12 + random() * 0.3;
    const color = random() < 0.72 ? OCHRE : CREAM;
    colors[index * 3] = color.r * brightness;
    colors[index * 3 + 1] = color.g * brightness;
    colors[index * 3 + 2] = color.b * brightness;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial({ color: hdr(OCHRE, 0.38), size: 0.22, vertexColors: true, transparent: true, opacity: 0.62, depthWrite: false });
  registerThermalPart(root, material, hdr(OCHRE, 0.38), IR_CHARCOAL, 0.62, 0.2);
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.userData.raildIgnoreOcclusion = true;
  root.userData.gritMaterial = material;
  root.add(points);

}

function createHarbourStructures(root: Group, rail: ReturnType<typeof createThermalInk8448Rail>, lamps: Lamp[]) {
  const frameMaterial = new MeshBasicMaterial({ color: RUST_DARK, side: DoubleSide });
  registerThermalPart(root, frameMaterial, RUST_DARK, IR_STEEL);
  const edgeMaterial = new MeshBasicMaterial({ color: hdr(RUST, 0.8), side: DoubleSide });
  registerThermalPart(root, edgeMaterial, hdr(RUST, 0.8), IR_CHARCOAL);
  const lampBase = new MeshBasicMaterial({ color: hdr(LAMP, 1.2), transparent: true, opacity: 0.9, depthWrite: false });
  registerThermalPart(root, lampBase, hdr(LAMP, 1.2), IR_CHARCOAL, 0.9, 0.25);

  for (let index = 0; index < 18; index += 1) {
    const u = 0.025 + index * 0.053;
    const frame = sampleRailFrame(rail, u);
    const side = index % 2 === 0 ? -1 : 1;
    const x = side * (10.5 + (index % 3) * 1.3);
    const postPosition = frame.position.clone().addScaledVector(frame.right, x).addScaledVector(frame.up, 2.7);
    const post = new Mesh(new BoxGeometry(0.42, 6.3, 0.42), frameMaterial);
    post.position.copy(postPosition);
    post.userData.raildIgnoreOcclusion = true;
    root.add(post);

    const cap = new Mesh(new BoxGeometry(0.7, 0.2, 0.7), edgeMaterial);
    cap.position.copy(postPosition).addScaledVector(frame.up, 3.1);
    cap.userData.raildIgnoreOcclusion = true;
    root.add(cap);

    const light = new Mesh(new SphereGeometry(0.3, 8, 6), lampBase);
    light.position.copy(postPosition).addScaledVector(frame.up, 2.85);
    light.userData.raildIgnoreOcclusion = true;
    root.add(light);
    lamps.push({ material: lampBase, normal: hdr(LAMP, 1.2), infrared: IR_CHARCOAL.clone(), phase: index * 0.87 });

    if (index % 3 === 0) {
      const beamGroup = new Group();
      beamGroup.position.copy(frame.position).addScaledVector(frame.up, 6.1);
      beamGroup.lookAt(beamGroup.position.clone().add(frame.tangent));
      const beam = new Mesh(new BoxGeometry(24, 0.34, 0.46), frameMaterial);
      beam.userData.raildIgnoreOcclusion = true;
      beamGroup.add(beam);
      const warning = new Mesh(new BoxGeometry(11, 0.09, 0.5), edgeMaterial);
      warning.position.y = -0.32;
      warning.userData.raildIgnoreOcclusion = true;
      beamGroup.add(warning);
      root.add(beamGroup);
    }

    if (index % 2 === 0) {
      const pipe = new Mesh(new CylinderGeometry(0.12, 0.12, 14, 7), edgeMaterial);
      pipe.position.copy(frame.position).addScaledVector(frame.right, side * 14).addScaledVector(frame.up, -1.5);
      pipe.quaternion.setFromUnitVectors(AXIS_Y, frame.tangent);
      pipe.userData.raildIgnoreOcclusion = true;
      root.add(pipe);
    }
  }
}

function createWreckage(root: Group, rail: ReturnType<typeof createThermalInk8448Rail>) {
  const hullMaterial = new MeshBasicMaterial({ color: MUD, side: DoubleSide });
  registerThermalPart(root, hullMaterial, MUD, IR_CHARCOAL);
  const plateMaterial = new MeshBasicMaterial({ color: RUST, side: DoubleSide });
  registerThermalPart(root, plateMaterial, RUST, IR_STEEL);
  const paintMaterial = new MeshBasicMaterial({ color: hdr(CREAM, 0.68), side: DoubleSide });
  registerThermalPart(root, paintMaterial, hdr(CREAM, 0.68), IR_WHITE_EDGE);
  const chainMaterial = new MeshBasicMaterial({ color: hdr(OCHRE, 0.72), side: DoubleSide });
  registerThermalPart(root, chainMaterial, hdr(OCHRE, 0.72), IR_STEEL);

  for (let index = 0; index < 13; index += 1) {
    const u = 0.045 + index * 0.071;
    const frame = sampleRailFrame(rail, u);
    const side = index % 2 === 0 ? -1 : 1;
    const position = frame.position.clone()
      .addScaledVector(frame.right, side * (15 + (index % 4) * 3.5))
      .addScaledVector(frame.up, -1.5 + (index % 3) * 1.6)
      .addScaledVector(frame.tangent, (index % 3 - 1) * 4);
    const hull = new Group();
    hull.position.copy(position);
    hull.lookAt(position.clone().add(frame.tangent));
    hull.rotateZ(side * (0.18 + (index % 3) * 0.15));
    const body = new Mesh(new BoxGeometry(8 + (index % 3) * 3, 2.2 + (index % 2), 14), hullMaterial);
    body.userData.raildIgnoreOcclusion = true;
    hull.add(body);
    const plate = new Mesh(new BoxGeometry(5.5, 0.16, 7), plateMaterial);
    plate.position.y = 1.2;
    plate.rotation.z = 0.12 * side;
    plate.userData.raildIgnoreOcclusion = true;
    hull.add(plate);
    if (index % 2 === 0) {
      const stripe = new Mesh(new BoxGeometry(3.5, 0.08, 0.12), paintMaterial);
      stripe.position.set(0, 1.34, 0.2);
      stripe.userData.raildIgnoreOcclusion = true;
      hull.add(stripe);
    }
    root.add(hull);

    if (index % 3 === 1) {
      for (let link = 0; link < 7; link += 1) {
        const chain = new Mesh(new TorusGeometry(0.32, 0.06, 6, 10), chainMaterial);
        chain.position.copy(position)
          .addScaledVector(frame.right, side * (5 + link * 0.55))
          .addScaledVector(frame.up, 3.6 - link * 0.35)
          .addScaledVector(frame.tangent, link * 0.3);
        chain.quaternion.copy(new Quaternion().setFromUnitVectors(AXIS_Z, frame.tangent));
        chain.rotateZ(link % 2 === 0 ? 0.45 : -0.45);
        chain.userData.raildIgnoreOcclusion = true;
        root.add(chain);
      }
    }
  }
}

function createOctopus() {
  const root = createThermalRoot() as ObjectWithThermalParts;
  root.userData.raildIgnoreOcclusion = true;
  const bodyMaterial = new MeshBasicMaterial({ color: hdr(OILY, 2.0), side: DoubleSide });
  registerThermalPart(root, bodyMaterial, hdr(OILY, 2.0), hdr(IR_WHITE_HOT, 1.25));
  const body = new Mesh(new SphereGeometry(5.3, 20, 14), bodyMaterial);
  body.scale.set(1.4, 0.88, 0.64);
  body.position.z = -0.8;
  root.add(body);

  const mantleEdgeMaterial = new MeshBasicMaterial({ color: hdr(RUST, 1.0), side: DoubleSide });
  registerThermalPart(root, mantleEdgeMaterial, hdr(RUST, 1.0), hdr(IR_WHITE_EDGE, 1.1));
  const mantleEdge = new Mesh(new TorusGeometry(5.15, 0.12, 8, 42), mantleEdgeMaterial);
  mantleEdge.scale.set(1.4, 0.86, 0.6);
  mantleEdge.rotation.x = Math.PI / 2;
  mantleEdge.position.z = -0.7;
  root.add(mantleEdge);

  const tentacles: Group[] = [];
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2 + 0.18;
    const side = index % 2 === 0 ? 1 : -1;
    const start = new Vector3(Math.cos(angle) * 3.7, Math.sin(angle) * 2.5, 0.1);
    const end = new Vector3(Math.cos(angle) * (8.5 + (index % 3) * 1.7), Math.sin(angle) * (5.5 + (index % 2) * 2.2), -0.4);
    const path = new CatmullRomCurve3([
      start,
      start.clone().lerp(end, 0.3).add(new Vector3(0, side * 1.1, 0)),
      start.clone().lerp(end, 0.68).add(new Vector3(0, -side * 0.8, 0)),
      end,
    ]);
    const tentacleGroup = new Group();
    const material = new MeshBasicMaterial({ color: hdr(RUST_DARK, 1.2), side: DoubleSide });
    registerThermalPart(root, material, hdr(RUST_DARK, 1.2), hdr(IR_WHITE_HOT, 1.28));
    const tube = new Mesh(new TubeGeometry(path, 18, 0.62 - index * 0.035, 9, false), material);
    tentacleGroup.add(tube);
    const seamMaterial = new MeshBasicMaterial({ color: hdr(OCHRE, 0.78), side: DoubleSide });
    registerThermalPart(root, seamMaterial, hdr(OCHRE, 0.78), hdr(IR_WHITE_EDGE, 0.95));
    for (let cup = 1; cup < 5; cup += 1) {
      const point = start.clone().lerp(end, cup / 5);
      const suction = new Mesh(new SphereGeometry(0.16, 7, 5), seamMaterial);
      suction.position.copy(point).add(new Vector3(0, -side * 0.43, 0.18));
      suction.scale.set(1, 0.55, 0.38);
      tentacleGroup.add(suction);
    }
    root.add(tentacleGroup);
    tentacles.push(tentacleGroup);
  }
  root.userData.tentacles = tentacles;

  const eyeMaterial = new MeshBasicMaterial({ color: hdr(SIGNAL, 1.6), side: DoubleSide });
  registerThermalPart(root, eyeMaterial, hdr(SIGNAL, 1.6), hdr(IR_RED, 3));
  for (const x of [-1.25, 1.25]) {
    const eye = new Mesh(new SphereGeometry(0.34, 10, 8), eyeMaterial);
    eye.position.set(x, 0.9, 2.4);
    root.add(eye);
  }
  const wreckRing = new Mesh(new TorusGeometry(8.7, 0.16, 7, 48), mantleEdgeMaterial);
  wreckRing.scale.y = 0.62;
  wreckRing.rotation.x = Math.PI / 2;
  wreckRing.position.z = -0.4;
  root.add(wreckRing);
  root.userData.accent = RUST.clone();
  return root;
}
