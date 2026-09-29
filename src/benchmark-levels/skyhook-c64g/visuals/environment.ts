import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  RingGeometry,
  Vector3,
} from 'three';
import type { CatmullRomCurve3 } from 'three';
import { sampleRailFrame } from '../../../engine/rail';
import { BOSS_GRIP } from '../boss';
import { CLIMB_LENGTH, DOOR_S, PYLON_SPACING, TETHER_DROP, TETHER_HALF_WIDTH } from '../space';
import { MergeBuilder, addMerged } from './merge';
import { CHARCOAL, GUNMETAL, HAZARD, PANEL_SHADE, PANEL_WHITE, hdr } from './palette';

// The hardware of the climb: the tether ribbon with its hazard edges and light
// dashes, the four guy cables the boss grips, the X-frame pylons that whip past
// (each with beacons that flash on the beat), and the anchor platform the run
// starts from. White paneling and hazard orange; nothing neon.

const Z = new Vector3(0, 0, 1);
export const GUY_OFFSETS = BOSS_GRIP;

type ColorFn = (segment: number, face: number) => Color;

/** A rectangular tube following the rail: 4 flat-shaded faces per segment. */
function pathPrism(
  curve: CatmullRomCurve3,
  s0: number,
  s1: number,
  step: number,
  halfW: number,
  halfH: number,
  offsetX: number,
  offsetY: number,
  color: ColorFn,
) {
  const count = Math.max(1, Math.round((s1 - s0) / step));
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const corners = [
    [-halfW, -halfH],
    [halfW, -halfH],
    [halfW, halfH],
    [-halfW, halfH],
  ];
  const faceNormals: Array<[number, number]> = [
    [0, -1], // bottom (between corner 0 and 1)
    [1, 0], // right
    [0, 1], // top
    [-1, 0], // left
  ];
  const ring = (s: number) => {
    const frame = sampleRailFrame(curve, s / CLIMB_LENGTH);
    return {
      frame,
      points: corners.map(([x, y]) =>
        frame.position.clone().addScaledVector(frame.right, offsetX + x).addScaledVector(frame.up, offsetY + y),
      ),
    };
  };
  let previous = ring(s0);
  for (let i = 0; i < count; i += 1) {
    const s = s0 + ((i + 1) / count) * (s1 - s0);
    const next = ring(s);
    for (let face = 0; face < 4; face += 1) {
      const a = face;
      const b = (face + 1) % 4;
      const normal = previous.frame.right.clone().multiplyScalar(faceNormals[face][0]).addScaledVector(previous.frame.up, faceNormals[face][1]);
      const base = positions.length / 3;
      for (const p of [previous.points[a], previous.points[b], next.points[b], next.points[a]]) {
        positions.push(p.x, p.y, p.z);
        normals.push(normal.x, normal.y, normal.z);
        const c = color(i, face);
        colors.push(c.r, c.g, c.b);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    previous = next;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(indices);
  return geometry;
}

export type Tether = {
  group: Group;
  update(beatEnergy: number, time: number, distanceCamera: number): void;
};

const scratchMatrix = new Matrix4();
const scratchQuat = new Quaternion();
const scratchScale = new Vector3();
const basisMatrix = new Matrix4();
const tmpColor = new Color();

export function createTether(curve: CatmullRomCurve3): Tether {
  const group = new Group();
  const shade = new Color();

  // the ribbon --------------------------------------------------------------------
  const ribbonMaterial = new MeshLambertMaterial({ vertexColors: true, emissive: new Color(0.1, 0.105, 0.115) });
  const ribbon = new Mesh(
    pathPrism(curve, -30, CLIMB_LENGTH + 40, 12, TETHER_HALF_WIDTH, 0.28, 0, TETHER_DROP, (segment, face) => {
      const panel = segment % 2 === 0 ? PANEL_WHITE : PANEL_SHADE.clone().lerp(PANEL_WHITE, 0.55);
      shade.copy(panel);
      if (face === 0 || face === 1 || face === 3) shade.multiplyScalar(0.6);
      return shade;
    }),
    ribbonMaterial,
  );
  ribbon.frustumCulled = false;
  ribbon.userData.raildIgnoreOcclusion = true;
  group.add(ribbon);

  // hazard edge strips (unlit: they must read in storm and sun alike) ---------------
  const edgeGeometry = (side: number) =>
    pathPrism(curve, -30, CLIMB_LENGTH + 40, 12, 0.14, 0.14, side * (TETHER_HALF_WIDTH - 0.14), TETHER_DROP + 0.06, (segment) =>
      segment % 2 === 0 ? tmpColor.copy(HAZARD).multiplyScalar(0.9) : tmpColor.copy(CHARCOAL).multiplyScalar(2.5),
    );
  for (const side of [-1, 1]) {
    const strip = new Mesh(edgeGeometry(side), new MeshBasicMaterial({ vertexColors: true }));
    strip.frustumCulled = false;
    strip.userData.raildIgnoreOcclusion = true;
    group.add(strip);
  }

  // centre light dashes: HDR white so they carry bloom, fading with fog distance ----
  const dashMaterial = new MeshBasicMaterial({ vertexColors: true });
  const dashes = new Mesh(
    pathPrism(curve, -30, CLIMB_LENGTH + 40, 8, 0.13, 0.22, 0, TETHER_DROP + 0.04, (segment) =>
      segment % 3 === 0 ? tmpColor.setRGB(1.6, 1.5, 1.2) : tmpColor.setRGB(0.02, 0.022, 0.026),
    ),
    dashMaterial,
  );
  dashes.frustumCulled = false;
  dashes.userData.raildIgnoreOcclusion = true;
  group.add(dashes);

  // the four guy cables ----------------------------------------------------------------
  for (const [x, y] of GUY_OFFSETS) {
    const cable = new Mesh(
      pathPrism(curve, -30, CLIMB_LENGTH + 40, 18, 0.55, 0.55, x, TETHER_DROP + y, (segment) =>
        segment % 5 === 0 ? shade.copy(PANEL_WHITE) : shade.setRGB(0.3, 0.32, 0.36),
      ),
      ribbonMaterial,
    );
    cable.frustumCulled = false;
    cable.userData.raildIgnoreOcclusion = true;
    group.add(cable);
  }

  // X-frame pylons -----------------------------------------------------------------------
  const frames: number[] = [];
  for (let s = PYLON_SPACING; s < DOOR_S - 40; s += PYLON_SPACING) frames.push(s);
  const armLength = Math.hypot(BOSS_GRIP[0][0], BOSS_GRIP[0][1]);
  const armGeometry = new BoxGeometry(0.5, 0.5, 1);
  const armMaterial = new MeshLambertMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.92), emissive: PANEL_WHITE.clone().multiplyScalar(0.08) });
  const arms = new InstancedMesh(armGeometry, armMaterial, frames.length * 4);
  const nodes = new InstancedMesh(new BoxGeometry(2.0, 2.0, 3.2), new MeshLambertMaterial({ color: PANEL_WHITE, emissive: PANEL_WHITE.clone().multiplyScalar(0.1) }), frames.length * 4);
  const hubs = new InstancedMesh(new BoxGeometry(1.8, 1.2, 2.6), new MeshLambertMaterial({ color: PANEL_SHADE.clone().lerp(PANEL_WHITE, 0.5), emissive: new Color(0.06, 0.06, 0.07) }), frames.length);
  const beaconMaterial = new MeshBasicMaterial({ color: 0xffffff });
  const beacons = new InstancedMesh(new BoxGeometry(1.3, 1.3, 0.6), beaconMaterial, frames.length * 4);
  const beaconPhase: number[] = [];
  frames.forEach((s, frameIndex) => {
    const frame = sampleRailFrame(curve, s / CLIMB_LENGTH);
    basisMatrix.makeBasis(frame.right, frame.up, frame.tangent.clone().negate());
    const frameQuat = new Quaternion().setFromRotationMatrix(basisMatrix);
    const hubPos = frame.position.clone().addScaledVector(frame.up, TETHER_DROP);
    scratchMatrix.compose(hubPos, frameQuat, scratchScale.set(1, 1, 1));
    hubs.setMatrixAt(frameIndex, scratchMatrix);
    GUY_OFFSETS.forEach(([x, y], corner) => {
      const cornerPos = frame.position.clone().addScaledVector(frame.right, x).addScaledVector(frame.up, TETHER_DROP + y);
      const mid = hubPos.clone().add(cornerPos).multiplyScalar(0.5);
      const dir = cornerPos.clone().sub(hubPos).normalize();
      scratchQuat.setFromUnitVectors(Z, dir);
      scratchMatrix.compose(mid, scratchQuat, scratchScale.set(1, 1, armLength));
      const index = frameIndex * 4 + corner;
      arms.setMatrixAt(index, scratchMatrix);
      scratchMatrix.compose(cornerPos, frameQuat, scratchScale.set(1, 1, 1));
      nodes.setMatrixAt(index, scratchMatrix);
      // The beacon sits on the node's car-facing end.
      const beaconPos = cornerPos.clone().addScaledVector(frame.tangent, -2.1);
      scratchMatrix.compose(beaconPos, frameQuat, scratchScale.set(1, 1, 1));
      beacons.setMatrixAt(index, scratchMatrix);
      beaconPhase[index] = (frameIndex + corner) % 2;
      beacons.setColorAt(index, tmpColor.copy(HAZARD));
    });
  });
  for (const mesh of [arms, nodes, hubs, beacons]) {
    mesh.frustumCulled = false;
    mesh.userData.raildIgnoreOcclusion = true;
    group.add(mesh);
  }

  return {
    group,
    update(beatEnergy, _time, _distance) {
      // Beacons chase: alternate corners flash on alternate halves of the beat.
      for (let i = 0; i < beaconPhase.length; i += 1) {
        const lit = beaconPhase[i] === 0 ? beatEnergy : 0.25 + (1 - beatEnergy) * 0.35;
        beacons.setColorAt(i, tmpColor.copy(HAZARD).multiplyScalar(0.28 + lit * 2.2));
      }
      if (beacons.instanceColor) beacons.instanceColor.needsUpdate = true;
    },
  };
}

// ---- anchor platform ----------------------------------------------------------------

export function createPlatform(curve: CatmullRomCurve3): Group {
  const group = new Group();
  const origin = curve.getPointAt(0);
  group.position.set(origin.x, origin.y - 6.4, origin.z + 14);

  const builder = new MergeBuilder();
  builder.add(new CylinderGeometry(132, 126, 4, 8), 'deck', { position: [0, -2, 0] });
  builder.add(new RingGeometry(112, 124, 8, 1, 0, Math.PI * 2), 'rim', { position: [0, 0.05, 0], rotation: [-Math.PI / 2, 0, Math.PI / 8] });
  // radial seams and landing lines
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    builder.add(new BoxGeometry(0.5, 0.06, 104), 'seam', { position: [Math.sin(angle) * 54, 0.04, Math.cos(angle) * 54], rotation: [0, angle, 0] });
  }
  // a launch cradle around the tether root and floodlight masts along the rim
  builder.add(new BoxGeometry(26, 3, 26), 'paint', { position: [0, 1.5, -14] });
  builder.add(new BoxGeometry(26.4, 0.8, 26.4), 'rim', { position: [0, 2.6, -14] });
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    builder.add(new CylinderGeometry(0.5, 0.8, 30, 6), 'paint', { position: [Math.sin(angle) * 104, 15, Math.cos(angle) * 104] });
    builder.add(new BoxGeometry(3, 1.2, 3), 'lamp', { position: [Math.sin(angle) * 104, 30.5, Math.cos(angle) * 104] });
  }
  addMerged(group, builder, {
    deck: new MeshLambertMaterial({ color: PANEL_SHADE.clone().lerp(PANEL_WHITE, 0.6), emissive: new Color(0.05, 0.05, 0.055) }),
    rim: new MeshBasicMaterial({ color: HAZARD.clone().multiplyScalar(0.85) }),
    seam: new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(2) }),
    paint: new MeshLambertMaterial({ color: PANEL_WHITE, emissive: new Color(0.05, 0.05, 0.055) }),
    lamp: new MeshBasicMaterial({ color: hdr(new Color(1, 0.82, 0.55), 2.2) }),
  }, { ignoreOcclusion: true });
  return group;
}
