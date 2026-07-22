import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  Scene,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import { scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { offsetFromRail, sampleRailFrame } from '../../../engine/rail';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import { createPursePursuitTahrRail } from '../gameplay';
import { AMBER, ASPHALT, HOT_PINK, NIGHT, TAIL_RED, VIOLET, WHITE, hdr } from './palette';
import { createCarFlank } from './models';

export type PurseEnvironment = {
  root: Group;
  traffic: ScatterField;
  carRig: Group;
  lampMaterial: MeshBasicMaterial;
};

const rail = createPursePursuitTahrRail();
const railLength = rail.getLength();
const basis = new Matrix4();
const dummy = new Object3D();
const local = new Vector3();

function setRailTransform(object: Object3D, u: number, x: number, y: number, z = 0, scale = new Vector3(1, 1, 1)) {
  const frame = sampleRailFrame(rail, u);
  object.position.copy(frame.position).addScaledVector(frame.right, x).addScaledVector(frame.up, y).addScaledVector(frame.tangent, z);
  basis.makeBasis(frame.right, frame.up, frame.tangent);
  object.quaternion.setFromRotationMatrix(basis);
  object.scale.copy(scale);
  object.updateMatrix();
}

function roadRibbon() {
  const geometry = new BufferGeometry();
  const positions: number[] = [];
  const indices: number[] = [];
  const segments = 260;
  for (let i = 0; i <= segments; i += 1) {
    const u = i / segments;
    const left = offsetFromRail(rail, u, new Vector3(-10.2, -5.2, 0));
    const right = offsetFromRail(rail, u, new Vector3(10.2, -5.2, 0));
    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    if (i < segments) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new Mesh(geometry, new MeshLambertMaterial({ color: ASPHALT, side: DoubleSide, flatShading: true }));
}

function instancedLaneDashes() {
  const spacing = 13;
  const countPerLane = Math.floor(railLength / spacing);
  const lanes = [-5, 0, 5];
  const mesh = new InstancedMesh(new BoxGeometry(0.13, 0.025, 5.2), new MeshBasicMaterial({ color: 0x8b836f }), countPerLane * lanes.length);
  let index = 0;
  for (const lane of lanes) {
    for (let i = 0; i < countPerLane; i += 1) {
      setRailTransform(dummy, (i * spacing + (lane + 5) * 0.7) / railLength, lane, -5.14);
      mesh.setMatrixAt(index++, dummy.matrix);
    }
  }
  return mesh;
}

function instancedGuardrails() {
  const spacing = 12;
  const count = Math.floor(railLength / spacing) * 2;
  const mesh = new InstancedMesh(new BoxGeometry(0.18, 0.65, spacing * 1.04), new MeshLambertMaterial({ color: 0x7c7478, flatShading: true }), count);
  let index = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < count / 2; i += 1) {
      setRailTransform(dummy, i * spacing / railLength, side * 10.45, -4.15);
      mesh.setMatrixAt(index++, dummy.matrix);
    }
  }
  return mesh;
}

function instancedStreetlights(lampMaterial: MeshBasicMaterial) {
  const spacing = 32;
  const pairs = Math.floor(railLength / spacing);
  const poles = new InstancedMesh(new BoxGeometry(0.12, 8.4, 0.12), new MeshLambertMaterial({ color: 0x242028 }), pairs * 2);
  const heads = new InstancedMesh(new BoxGeometry(1.7, 0.16, 0.42), lampMaterial, pairs * 2);
  let index = 0;
  for (let i = 0; i < pairs; i += 1) {
    const u = i * spacing / railLength;
    for (const side of [-1, 1]) {
      setRailTransform(dummy, u, side * 11.6, -1.0);
      poles.setMatrixAt(index, dummy.matrix);
      setRailTransform(dummy, u, side * 10.9, 3.15);
      heads.setMatrixAt(index, dummy.matrix);
      index += 1;
    }
  }
  const group = new Group();
  group.add(poles, heads);
  return group;
}

function skyline() {
  const count = 78;
  const buildings = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshLambertMaterial({ color: 0x151225, flatShading: true }), count);
  const signs = new InstancedMesh(new PlaneGeometry(1, 1), createAdditiveBasicMaterial({ color: 0xffffff, vertexColors: true, side: DoubleSide }), count);
  for (let i = 0; i < count; i += 1) {
    const r1 = pseudo(i, 1);
    const r2 = pseudo(i, 2);
    const r3 = pseudo(i, 3);
    const side = i % 2 === 0 ? -1 : 1;
    const u = (i + 0.35) / count;
    const width = 8 + r1 * 17;
    const depth = 10 + r2 * 18;
    const height = 14 + r3 * 36;
    setRailTransform(dummy, u, side * (26 + r2 * 28), -5.2 + height * 0.5, 0, new Vector3(width, height, depth));
    buildings.setMatrixAt(i, dummy.matrix);
    const signY = -1 + height * (0.15 + r1 * 0.5);
    setRailTransform(dummy, u, side * (20.5 + r2 * 20), signY, -depth * 0.2, new Vector3(2.5 + r2 * 4.5, 0.4 + r3 * 1.2, 1));
    signs.setMatrixAt(i, dummy.matrix);
    const color = (i % 3 === 0 ? HOT_PINK : i % 3 === 1 ? AMBER : VIOLET).clone().multiplyScalar(0.65 + r1 * 0.65);
    signs.setColorAt(i, color);
  }
  const group = new Group();
  group.add(buildings, signs);
  return group;
}

function overpasses() {
  const group = new Group();
  for (const u of [0.24, 0.49, 0.69, 0.83]) {
    const bridge = new Group();
    const deck = new Mesh(new BoxGeometry(31, 1.1, 8), new MeshLambertMaterial({ color: 0x1c1922, flatShading: true }));
    deck.position.y = 3.5;
    const underside = new Mesh(new BoxGeometry(28, 0.12, 6.8), createAdditiveBasicMaterial({ color: hdr(AMBER, 0.34) }));
    underside.position.y = 2.9;
    bridge.add(deck, underside);
    for (const x of [-12, 12]) {
      const column = new Mesh(new BoxGeometry(1.4, 8.2, 1.4), new MeshLambertMaterial({ color: 0x24212a }));
      column.position.set(x, -0.5, 0);
      bridge.add(column);
    }
    setRailTransform(bridge, u, 0, 0);
    group.add(bridge);
  }
  return group;
}

function trafficCar(index: number) {
  const root = new Group();
  const bodyColors = [0x191922, 0x34212b, 0x20252c, 0x3a3127];
  const body = new Mesh(new BoxGeometry(3.0, 1.05, 5.6), new MeshLambertMaterial({ color: bodyColors[index % bodyColors.length], flatShading: true }));
  const cabin = new Mesh(new BoxGeometry(2.35, 0.85, 2.75), new MeshLambertMaterial({ color: 0x262432, flatShading: true }));
  cabin.position.set(0, 0.78, -0.15);
  const plate = new Mesh(new BoxGeometry(0.75, 0.25, 0.06), createAdditiveBasicMaterial({ color: hdr(WHITE, 0.55) }));
  plate.position.set(0, -0.12, 2.84);
  root.add(body, cabin, plate);
  for (const x of [-0.92, 0.92]) {
    const tail = new Mesh(new BoxGeometry(0.48, 0.22, 0.08), createAdditiveBasicMaterial({ color: hdr(TAIL_RED, 1.7) }));
    tail.position.set(x, 0.12, 2.86);
    root.add(tail);
  }
  root.userData.speed = 9 + pseudo(index, 7) * 9;
  return root;
}

function trafficField() {
  const lanes = [-7.4, -2.45, 2.45, 7.4];
  return scatterAlongRail(rail, {
    count: 34,
    seed: 8831,
    window: { behind: 38, ahead: 205 },
    place(index) {
      return { u: (index + 0.35) / 34, offset: new Vector3(lanes[index % lanes.length], -4.45, 0) };
    },
    make(index) { return trafficCar(index); },
    onUpdate(item, dt) { item.u += Number(item.object.userData.speed ?? 12) * dt / railLength; },
  });
}

export function createPurseEnvironment(scene: Scene): PurseEnvironment {
  const root = new Group();
  // Traffic and overpasses are purposeful speed wipes. Locking remains
  // screen-space and should not be diagnosed as blocked when they cross a
  // target for a few frames.
  root.userData.raildIgnoreOcclusion = true;
  scene.background = NIGHT;
  scene.fog = new Fog(0x090612, 48, 225);
  root.add(new AmbientLight(0x302542, 1.35));
  root.add(new HemisphereLight(0x714c72, 0x11070d, 1.8));
  const key = new DirectionalLight(0xffd8ae, 2.8);
  key.position.set(-2, 5, 3);
  root.add(key);
  const rim = new DirectionalLight(0xd13a86, 1.7);
  rim.position.set(5, 2, -4);
  root.add(rim);

  const lampMaterial = createAdditiveBasicMaterial({ color: hdr(AMBER, 1.05) });
  const traffic = trafficField();
  const carRig = createCarFlank();
  root.add(roadRibbon(), instancedLaneDashes(), instancedGuardrails(), instancedStreetlights(lampMaterial), skyline(), overpasses(), traffic.group, carRig);
  scene.add(root);
  return { root, traffic, carRig, lampMaterial };
}

export function updatePurseEnvironment(environment: PurseEnvironment, context: { camera: PerspectiveCamera; runProgress: number; dt: number; elapsed: number; beat: number }) {
  environment.traffic.update(context.runProgress, context.dt);
  environment.lampMaterial.color.copy(hdr(AMBER, 0.82 + Math.max(0, context.beat) * 1.05));
  local.set(4.7, -3.35, -5.7).applyQuaternion(context.camera.quaternion);
  environment.carRig.position.copy(context.camera.position).add(local);
  environment.carRig.quaternion.copy(context.camera.quaternion);
  environment.carRig.rotation.z += -0.035 + Math.sin(context.elapsed * 1.7) * 0.006;
}

export function disposePurseEnvironment(environment: PurseEnvironment | null) {
  if (!environment) return;
  environment.traffic.dispose();
  environment.root.removeFromParent();
  disposeObject3D(environment.root);
}

function pseudo(index: number, salt: number) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}
