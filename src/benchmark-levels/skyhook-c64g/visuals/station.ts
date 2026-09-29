import {
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  RingGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { CatmullRomCurve3 } from 'three';
import { sampleRailFrame } from '../../../engine/rail';
import { BAY_END_S, CLIMB_LENGTH, DOOR_S } from '../space';
import { letterGeometry } from './letters';
import { MergeBuilder, addMerged } from './merge';
import { CHARCOAL, GUNMETAL, HAZARD, KEYLINE, PANEL_SHADE, PANEL_WHITE, hdr } from './palette';

// The station at the top of the tether. From below it is a wall of grey paneling
// with SKYHOOK across it in giant white plates and a hazard-framed mouth; the
// mouth's doors slide apart as the climb closes, and the car is swallowed by a
// bay whose ribs and light strips slow to a walk as the run decelerates. The
// far end clamps shut. Built in a local frame at the door: x right, y up, +Z
// toward the approaching car, the bay running away down −Z.

const BAY_LENGTH = BAY_END_S - DOOR_S;
const HALF_W = 30;
const FLOOR = -16;
const CEIL = 26;

const scratchMatrix = new Matrix4();
const scratchQuat = new Quaternion();
const scratchScale = new Vector3(1, 1, 1);

export type Station = {
  group: Group;
  /** `bayDepth`: how far the camera is inside the door (negative while still approaching). */
  update(time: number, beat: number, bayDepth: number): void;
};

/** Giant signage: letters from the shared glyph plates, baked into a handful of meshes. */
function addWord(builder: MergeBuilder, word: string, scale: number, spacing: number, y: number, z: number, x0 = 0) {
  word.split('').forEach((char, index) => {
    const geometry = letterGeometry(char);
    const placement = { position: [x0 + (index - (word.length - 1) / 2) * spacing, y, z] as [number, number, number], scale };
    builder.add(geometry.back, 'lbBack', placement);
    builder.add(geometry.face, 'lbFace', placement);
    builder.add(geometry.rivet, 'lbRivet', placement);
    builder.add(geometry.stripeA, 'lbStripeA', placement);
    builder.add(geometry.stripeB, 'lbStripeB', placement);
  });
}

export function createStation(curve: CatmullRomCurve3): Station {
  const group = new Group();
  const frame = sampleRailFrame(curve, DOOR_S / CLIMB_LENGTH);
  const basis = new Matrix4().makeBasis(frame.right, frame.up, frame.tangent.clone().negate());
  group.quaternion.setFromRotationMatrix(basis);
  group.position.copy(frame.position);

  const wallMaterial = new MeshLambertMaterial({ color: new Color(0.62, 0.66, 0.72), emissive: new Color(0.16, 0.17, 0.19) });
  const paneling = new MeshLambertMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.95), emissive: new Color(0.08, 0.085, 0.09) });
  const dark = new MeshLambertMaterial({ color: GUNMETAL.clone().multiplyScalar(2), emissive: new Color(0.02, 0.02, 0.025) });
  const bayMaterial = new MeshLambertMaterial({ color: PANEL_SHADE.clone().lerp(PANEL_WHITE, 0.55), emissive: new Color(0.1, 0.105, 0.115) });
  const hazardMaterial = new MeshBasicMaterial({ color: hdr(HAZARD, 0.95) });
  const darkStripe = new MeshBasicMaterial({ color: CHARCOAL.clone().multiplyScalar(2.6) });
  const lampMaterial = new MeshBasicMaterial({ color: new Color(1.7, 1.55, 1.25) });

  const builder = new MergeBuilder();

  // Face wall around the mouth: a slab far larger than the mouth, so the station
  // reads as a structure and not a door.
  builder.add(new BoxGeometry(200, 340, 6), 'wall', { position: [-130, 15, -3] });
  builder.add(new BoxGeometry(200, 340, 6), 'wall', { position: [130, 15, -3] });
  builder.add(new BoxGeometry(60, 160, 6), 'wall', { position: [0, 106, -3] });
  builder.add(new BoxGeometry(60, 140, 6), 'wall', { position: [0, -86, -3] });
  // A raised course of paneling: seams that catch the light, and a bright rim.
  for (const [x, y, w, h] of [[-130, 130, 190, 3.6], [130, 130, 190, 3.6], [-130, -100, 190, 3.6], [130, -100, 190, 3.6], [-130, 15, 3.6, 300], [130, 15, 3.6, 300], [-186, 15, 3.6, 300], [186, 15, 3.6, 300], [0, 60, 60, 3.6]] as const) {
    builder.add(new BoxGeometry(w, h, 1.4), 'paneling', { position: [x, y, 0.6] });
  }
  builder.add(new BoxGeometry(424, 4, 3), 'rim', { position: [0, 185, 1.5] });
  builder.add(new BoxGeometry(424, 4, 3), 'rim', { position: [0, -155, 1.5] });
  builder.add(new BoxGeometry(4, 344, 3), 'rim', { position: [-232, 15, 1.5] });
  builder.add(new BoxGeometry(4, 344, 3), 'rim', { position: [232, 15, 1.5] });
  // Giant lettering across the wall, and the bay number on the far wall.
  addWord(builder, 'SKYHOOK', 6.6, 18.4, 100, 1.6);
  const wallZ = -BAY_LENGTH;
  addWord(builder, '07', 2.1, 6, 18, wallZ + 2.4);

  // Solar wings, a radiator truss and the habitat ring behind the wall.
  for (const side of [-1, 1]) {
    builder.add(new BoxGeometry(320, 2, 120), 'solar', { position: [side * 390, 60, -70] });
    builder.add(new BoxGeometry(320, 3, 4), 'paneling', { position: [side * 390, 60, -8] });
    for (let i = 1; i < 8; i += 1) builder.add(new BoxGeometry(1.6, 2.6, 120), 'paneling', { position: [side * (232 + i * 40), 60, -70] });
    builder.add(new BoxGeometry(80, 7, 7), 'dark', { position: [side * 260, 60, -70] });
  }
  builder.add(new BoxGeometry(840, 8, 10), 'dark', { position: [0, 205, -50] });
  const ringTilt = Math.PI / 2 - 0.5;
  builder.add(new TorusGeometry(330, 22, 10, 72), 'paneling', { position: [0, 190, -200], rotation: [ringTilt, 0, 0] });

  // The bay.
  const midZ = -BAY_LENGTH / 2;
  builder.add(new BoxGeometry(HALF_W * 2 + 4, 2, BAY_LENGTH), 'bay', { position: [0, FLOOR - 1, midZ] });
  builder.add(new BoxGeometry(HALF_W * 2 + 4, 2, BAY_LENGTH), 'bay', { position: [0, CEIL + 1, midZ] });
  builder.add(new BoxGeometry(2, CEIL - FLOOR + 4, BAY_LENGTH), 'bay', { position: [-HALF_W - 1, (CEIL + FLOOR) / 2, midZ] });
  builder.add(new BoxGeometry(2, CEIL - FLOOR + 4, BAY_LENGTH), 'bay', { position: [HALF_W + 1, (CEIL + FLOOR) / 2, midZ] });
  builder.add(new BoxGeometry(HALF_W * 2 + 4, CEIL - FLOOR + 4, 4), 'bay', { position: [0, (CEIL + FLOOR) / 2, -BAY_LENGTH - 2] });
  builder.add(new RingGeometry(9, 11, 40), 'hazard', { position: [0, 5, wallZ + 0.35] });
  // The light at the end of the tunnel: a warm-lit docking port the car settles toward.
  builder.add(new BoxGeometry(46, 30, 0.6), 'port', { position: [0, 5, wallZ + 0.1] });
  for (const side of [-1, 1]) builder.add(new BoxGeometry(2.2, 34, 1.2), 'hazard', { position: [side * 25.5, 5, wallZ + 0.6] });

  addMerged(group, builder, {
    wall: wallMaterial,
    rim: new MeshBasicMaterial({ color: new Color(1.5, 1.45, 1.3) }),
    port: new MeshBasicMaterial({ color: new Color(0.85, 0.8, 0.7) }),
    paneling,
    solar: new MeshLambertMaterial({ color: new Color(0.03, 0.06, 0.16), emissive: new Color(0.01, 0.02, 0.06) }),
    dark,
    bay: bayMaterial,
    hazard: hazardMaterial,
    lbBack: new MeshBasicMaterial({ color: KEYLINE.clone().multiplyScalar(1.2) }),
    lbFace: new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(1.05) }),
    lbRivet: new MeshBasicMaterial({ color: hdr(HAZARD, 1.5) }),
    lbStripeA: hazardMaterial,
    lbStripeB: darkStripe,
  }, { ignoreOcclusion: true });

  // Habitat ring windows (instanced).
  const windows = new InstancedMesh(new BoxGeometry(5, 5, 2.4), lampMaterial, 80);
  const ringQuat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), ringTilt);
  for (let i = 0; i < 80; i += 1) {
    const a = (i / 80) * Math.PI * 2;
    const p = new Vector3(Math.cos(a) * 330, Math.sin(a) * 330, 0).applyQuaternion(ringQuat).add(new Vector3(0, 190, -200));
    scratchMatrix.compose(p, ringQuat, scratchScale);
    windows.setMatrixAt(i, scratchMatrix);
  }
  windows.userData.raildIgnoreOcclusion = true;
  group.add(windows);

  // Hazard-chevron frame around the mouth (instanced).
  const chevrons: Array<[number, number]> = [];
  for (let i = 0; i < 13; i += 1) {
    const x = -HALF_W + 2.6 + i * ((HALF_W * 2 - 5.2) / 12);
    chevrons.push([x, CEIL + 2.6], [x, FLOOR - 2.6]);
  }
  for (let i = 0; i < 9; i += 1) {
    const y = FLOOR + 2 + i * ((CEIL - FLOOR - 4) / 8);
    chevrons.push([-HALF_W - 2.6, y], [HALF_W + 2.6, y]);
  }
  const frameChevrons = new InstancedMesh(new BoxGeometry(4.4, 4.4, 1.6), new MeshBasicMaterial({ color: 0xffffff }), chevrons.length);
  chevrons.forEach(([x, y], i) => {
    scratchMatrix.compose(new Vector3(x, y, 1.0), scratchQuat.identity(), scratchScale);
    frameChevrons.setMatrixAt(i, scratchMatrix);
    frameChevrons.setColorAt(i, i % 2 === 0 ? hdr(HAZARD, 0.95) : CHARCOAL.clone().multiplyScalar(2.6));
  });
  frameChevrons.userData.raildIgnoreOcclusion = true;
  group.add(frameChevrons);

  // Door leaves: paneling with hazard stripes baked in.
  const leafBuilder = new MergeBuilder();
  for (let i = 0; i < 6; i += 1) leafBuilder.add(new BoxGeometry(3.2, CEIL - FLOOR + 0.6, 0.5), i % 2 === 0 ? 'hazard' : 'dark', { position: [(i - 2.5) * 5.2, 0, 1.75] });
  leafBuilder.add(new BoxGeometry(HALF_W + 0.6, CEIL - FLOOR + 0.4, 3), 'panel', { position: [0, 0, 0] });
  const leafGeometries = leafBuilder.build();
  const doors: Group[] = [];
  for (const side of [-1, 1]) {
    const door = new Group();
    for (const [tag, material] of [['panel', paneling], ['hazard', hazardMaterial], ['dark', darkStripe]] as const) {
      const mesh = new Mesh(leafGeometries.get(tag), material);
      mesh.userData.raildIgnoreOcclusion = true;
      door.add(mesh);
    }
    door.position.set((side * HALF_W) / 2, (CEIL + FLOOR) / 2, 1.6);
    group.add(door);
    doors.push(door);
  }
  const [leftDoor, rightDoor] = doors;

  // Docking lamps beside the mouth (instanced, recoloured every frame).
  const lampCount = 16;
  const lamps = new InstancedMesh(new BoxGeometry(2.4, 2.4, 1.2), new MeshBasicMaterial({ color: 0xffffff }), lampCount);
  const lampColor = new Color();
  for (let i = 0; i < lampCount; i += 1) {
    const side = i < 8 ? -1 : 1;
    scratchMatrix.compose(new Vector3(side * (HALF_W + 12), FLOOR + 3 + (i % 8) * 5.6, 0.9), scratchQuat.identity(), scratchScale);
    lamps.setMatrixAt(i, scratchMatrix);
    lamps.setColorAt(i, lampColor.setRGB(0.02, 0.02, 0.025));
  }
  lamps.userData.raildIgnoreOcclusion = true;
  group.add(lamps);

  // Ribs and their light strips: they whip past, then slow to a walk.
  const ribCount = Math.floor(BAY_LENGTH / 18);
  const ribs = new InstancedMesh(new BoxGeometry(1, 1, 1), paneling, ribCount * 4);
  const strips = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0xffffff }), ribCount * 3);
  for (let k = 0; k < ribCount; k += 1) {
    const z = -8 - k * 18;
    const parts: Array<[number, number, number, number, number]> = [
      [0, CEIL - 0.8, HALF_W * 2 + 4, 2.6, 1.6],
      [0, FLOOR + 0.8, HALF_W * 2 + 4, 2.6, 1.6],
      [-HALF_W + 0.8, (CEIL + FLOOR) / 2, 2.6, CEIL - FLOOR, 1.6],
      [HALF_W - 0.8, (CEIL + FLOOR) / 2, 2.6, CEIL - FLOOR, 1.6],
    ];
    parts.forEach(([x, y, w, h, d], i) => {
      scratchMatrix.compose(new Vector3(x, y, z), scratchQuat.identity(), new Vector3(w, h, d));
      ribs.setMatrixAt(k * 4 + i, scratchMatrix);
    });
    const lights: Array<[number, number, number, number, number]> = [
      [0, CEIL - 1.1, 18, 0.5, 1.0],
      [-HALF_W + 1.7, 5, 0.5, 26, 1.0],
      [HALF_W - 1.7, 5, 0.5, 26, 1.0],
    ];
    lights.forEach(([x, y, w, h, d], i) => {
      scratchMatrix.compose(new Vector3(x, y, z + 3), scratchQuat.identity(), new Vector3(w, h, d));
      strips.setMatrixAt(k * 3 + i, scratchMatrix);
      strips.setColorAt(k * 3 + i, new Color(1.5, 1.4, 1.2));
    });
  }
  ribs.userData.raildIgnoreOcclusion = true;
  strips.userData.raildIgnoreOcclusion = true;
  group.add(ribs, strips);

  // Floor hazard edges.
  const edgeCount = Math.floor(BAY_LENGTH / 10);
  const edges = new InstancedMesh(new BoxGeometry(2.6, 0.3, 5), new MeshBasicMaterial({ color: 0xffffff }), edgeCount * 2);
  for (let k = 0; k < edgeCount; k += 1) {
    for (const [i, side] of [[0, -1], [1, 1]] as const) {
      scratchMatrix.compose(new Vector3(side * (HALF_W - 4), FLOOR + 0.2, -6 - k * 10), scratchQuat.identity(), scratchScale);
      edges.setMatrixAt(k * 2 + i, scratchMatrix);
      edges.setColorAt(k * 2 + i, k % 2 === 0 ? hdr(HAZARD, 0.95) : CHARCOAL.clone().multiplyScalar(2.6));
    }
  }
  edges.userData.raildIgnoreOcclusion = true;
  group.add(edges);

  // The clamps that close on the docked car.
  const clampBuilder = new MergeBuilder();
  clampBuilder.add(new BoxGeometry(10, 12, 30), 'panel');
  clampBuilder.add(new BoxGeometry(10.4, 3, 9), 'hazard', { position: [0, 0, 8] });
  const clampGeometries = clampBuilder.build();
  const clamps: Group[] = [];
  for (const side of [-1, 1]) {
    const clamp = new Group();
    for (const [tag, material] of [['panel', paneling], ['hazard', hazardMaterial]] as const) {
      const mesh = new Mesh(clampGeometries.get(tag), material);
      mesh.userData.raildIgnoreOcclusion = true;
      clamp.add(mesh);
    }
    clamp.position.set(side * 42, 4, wallZ + 16);
    group.add(clamp);
    clamps.push(clamp);
  }
  const [clampL, clampR] = clamps;

  group.traverse((object) => {
    object.userData.raildIgnoreOcclusion = true;
  });

  return {
    group,
    update(time, beat, bayDepth) {
      group.visible = time > 30;
      // Doors part as the car closes on the station.
      const open = MathUtils.smoothstep(time, 50.6, 53.4);
      leftDoor.position.x = -HALF_W / 2 - open * (HALF_W + 2);
      rightDoor.position.x = HALF_W / 2 + open * (HALF_W + 2);
      // Docking lamps chase toward the mouth on the beat.
      for (let i = 0; i < lampCount; i += 1) {
        const wave = (Math.sin(time * 6.5 - (i % 8) * 0.7) + 1) / 2;
        const lit = time > 44 ? 0.25 + wave * 1.4 + beat * 0.5 : 0.03;
        lamps.setColorAt(i, lampColor.setRGB(1.6 * lit, 1.05 * lit, 0.3 * lit));
      }
      if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
      // The bay's strips brighten as the car nears the far wall, then hold.
      const inside = MathUtils.smoothstep(bayDepth, 20, 140);
      (strips.material as MeshBasicMaterial).color.setScalar(0.85 + inside * 0.25);
      // The clamps close on the docked car.
      const close = MathUtils.smoothstep(time, 58.3, 59.8);
      clampL.position.x = -42 + close * 24;
      clampR.position.x = 42 - close * 24;
    },
  };
}
