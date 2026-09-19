import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Euler,
  Group,
  InstancedMesh,
  MathUtils,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import type { Color } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshStandardNodeMaterial, type UniformNode } from 'three/webgpu';
import { attribute, float, fract, mix, positionWorld, smoothstep, uniform, vec2, vec3 } from 'three/tsl';
import { fractal } from './noise';
import { bathtubRing } from './rock';
import { DAM, LIP_A, WATER_LEVEL, archFaceA, chuteFloor } from '../route';

// The arch dam, its gated spillway and the chute, built in the dam's local
// frame: x is `l` (right), y is height above the lake, z is -a (downstream is
// -z). The radial gates are separate groups pivoting on their trunnions so the
// boss can wrench at them and the breach can throw them down the chute.

export type DamColors = { concrete: Color; stain: Color; wet: Color; bleached: Color; gate: Color; rust: Color; rail: Color };

export type DamGate = {
  index: number;
  object: Group;
  /** Trunnion position in dam-local coordinates. */
  pivot: Vector3;
};

export type DamModel = {
  group: Group;
  gates: DamGate[];
  /** Twist a gate on its trunnion, 0 at rest to 1 half torn out. The boss drives this. */
  setGateStrain(index: number, amount: number, time: number): void;
  /** Throws the gates down the chute, starting `elapsed` seconds ago. Negative restores them. */
  updateBreach(elapsed: number): void;
};

const BOTTOM = -104;
const CREST = DAM.crestHeight;
const ARCH_PROFILE: Array<[offset: number, height: number]> = [
  [-4, BOTTOM], [-1.5, -40], [0, CREST], [DAM.crestWidth, CREST], [DAM.crestWidth + 1, CREST - 5], [19, -12], [32, -58], [46, BOTTOM],
];

/** Upstream face point and downstream unit direction of the arch at angle `psi`. */
function archFrame(psi: number) {
  const r = DAM.archRadius;
  return { a: r * (1 - Math.cos(psi)), l: r * Math.sin(psi), da: Math.cos(psi), dl: -Math.sin(psi) };
}

const toLocal = (a: number, l: number, y: number, out: number[]) => out.push(l, y, -a);

/** Strips over `psi` for each consecutive pair of profile points; flat across the profile, smooth along the arch. */
function buildArch(from: number, to: number, steps: number, profile: Array<[number, number]>) {
  const parts: BufferGeometry[] = [];
  for (let k = 0; k < profile.length - 1; k += 1) {
    const positions: number[] = [];
    const along: number[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const psi = MathUtils.lerp(from, to, i / steps);
      const f = archFrame(psi);
      for (const [offset, height] of [profile[k], profile[k + 1]]) {
        toLocal(f.a + f.da * offset, f.l + f.dl * offset, height, positions);
        along.push(psi * DAM.archRadius);
      }
    }
    const indices: number[] = [];
    for (let i = 0; i < steps; i += 1) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('along', new BufferAttribute(new Float32Array(along), 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    parts.push(geometry.toNonIndexed());
  }
  return parts;
}

/** A closed polygon cap of the arch profile at `psi`, where the arch meets the spillway. */
function buildCap(psi: number) {
  const f = archFrame(psi);
  const positions: number[] = [];
  const centre = ARCH_PROFILE.reduce((sum, [o, h]) => [sum[0] + o / ARCH_PROFILE.length, sum[1] + h / ARCH_PROFILE.length], [0, 0]);
  for (let k = 0; k < ARCH_PROFILE.length; k += 1) {
    const p0 = ARCH_PROFILE[k];
    const p1 = ARCH_PROFILE[(k + 1) % ARCH_PROFILE.length];
    // Both windings: the cap is seen from the spillway side and, past the piers, from the crest.
    for (const [offset, height] of [centre, p0, p1, centre, p1, p0]) toLocal(f.a + f.da * offset, f.l + f.dl * offset, height, positions);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('along', new BufferAttribute(new Float32Array(positions.length / 3).fill(psi * DAM.archRadius), 1));
  geometry.computeVertexNormals();
  return geometry;
}

const chuteHalfWidth = (a: number) => MathUtils.clamp(DAM.spillwayHalfWidth - (a / 40) * (DAM.spillwayHalfWidth - DAM.chuteHalfWidth), DAM.chuteHalfWidth, DAM.spillwayHalfWidth);

/** The chute: floor, training walls and the mass below, from the sill to the lip. */
function buildChute() {
  const wall = 3;
  const wallHeight = 11;
  const stations: number[] = [];
  for (let a = -7; a < LIP_A; a += 2) stations.push(a);
  stations.push(LIP_A);
  // Cross-section, left to right: outer foot, outer top, inner top, floor edge ... mirrored.
  const section = (a: number): Array<[number, number]> => {
    const w = chuteHalfWidth(a);
    const floor = chuteFloor(a);
    return [
      [-w - wall, BOTTOM], [-w - wall, floor + wallHeight], [-w, floor + wallHeight], [-w, floor],
      [w, floor], [w, floor + wallHeight], [w + wall, floor + wallHeight], [w + wall, BOTTOM],
    ];
  };
  const parts: BufferGeometry[] = [];
  const count = section(0).length;
  for (let k = 0; k < count - 1; k += 1) {
    const positions: number[] = [];
    const along: number[] = [];
    for (const a of stations) {
      const s = section(a);
      for (const [l, y] of [s[k], s[k + 1]]) {
        toLocal(a, l, y, positions);
        along.push(k === 3 ? l : a);
      }
    }
    const indices: number[] = [];
    for (let i = 0; i < stations.length - 1; i += 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('along', new BufferAttribute(new Float32Array(along), 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    parts.push(geometry.toNonIndexed());
  }
  // End face under the lip.
  const end = section(LIP_A);
  const positions: number[] = [];
  const quad = (p: [number, number], q: [number, number]) => {
    const corners: Array<[number, number]> = [p, [q[0], p[1]], q, p, q, [p[0], q[1]]];
    for (const [l, y] of [...corners, ...corners.reverse()]) toLocal(LIP_A, l, y, positions);
  };
  quad([end[0][0], BOTTOM], [end[7][0], chuteFloor(LIP_A)]);
  const face = new BufferGeometry();
  face.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  face.setAttribute('along', new BufferAttribute(new Float32Array(positions.length / 3), 1));
  face.computeVertexNormals();
  parts.push(face);
  return parts;
}

function withAlong(geometry: BufferGeometry, value = 0) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  flat.deleteAttribute('uv');
  flat.setAttribute('along', new BufferAttribute(new Float32Array(flat.getAttribute('position').count).fill(value), 1));
  return flat;
}

function box(width: number, height: number, depth: number, l: number, y: number, a: number) {
  const geometry = new BoxGeometry(width, height, depth);
  geometry.translate(l, y, -a);
  return withAlong(geometry, l);
}

/**
 * The gated spillway: tall piers with rounded upstream noses from the sill to the
 * crest, a road bridge across their tops, and a hoist house on every pier that
 * gives the dam its skyline from far up the lake.
 */
function buildSpillwayStructure() {
  const parts: BufferGeometry[] = [];
  const pitch = DAM.gateWidth + DAM.pierWidth;
  const piers = DAM.gateCount + 1;
  const height = CREST - DAM.sillHeight;
  const middle = (CREST + DAM.sillHeight) / 2;
  for (let i = 0; i < piers; i += 1) {
    const l = (i - (piers - 1) / 2) * pitch;
    // End piers are thicker: they are the arch's abutments against the spillway.
    const width = i === 0 || i === piers - 1 ? DAM.pierWidth + 3 : DAM.pierWidth;
    const shift = i === 0 ? -1.5 : i === piers - 1 ? 1.5 : 0;
    parts.push(box(width, height, 30, l + shift, middle, 11));
    const nose = new CylinderGeometry(width / 2, width / 2, height, 14, 1, false, Math.PI / 2, Math.PI);
    nose.translate(l + shift, middle, 4);
    parts.push(withAlong(nose, l));
    // Hoist house: a concrete block with a roof slab, straddling the pier over the trunnions.
    const houseWidth = width + 4;
    parts.push(box(houseWidth, 11, 12, l + shift, CREST + 5.5, 15));
    parts.push(box(houseWidth + 1.2, 1, 13.4, l + shift, CREST + 11.5, 15));
    parts.push(box(houseWidth - 1.5, 0.6, 12.3, l + shift, CREST + 7.5, 15));
  }
  // The road bridge: deck, deep girders under it, and parapets.
  const span = (piers - 1) * pitch + DAM.pierWidth + 6;
  parts.push(box(span, 1.4, 10, 0, CREST - 0.7, 3));
  parts.push(box(span, 2.6, 1.1, 0, CREST - 2.6, -0.6));
  parts.push(box(span, 2.6, 1.1, 0, CREST - 2.6, 6.6));
  parts.push(box(span, 1.1, 0.5, 0, CREST + 0.55, -1.6));
  parts.push(box(span, 1.1, 0.5, 0, CREST + 0.55, 7.6));
  return parts;
}

/** One radial gate in its trunnion frame: curved skin plate, girders, arms and hubs. */
function buildGate() {
  const r = DAM.gateRadius;
  const t = DAM.trunnion;
  const alpha0 = Math.asin((DAM.sillHeight - t.y) / r);
  const alpha1 = Math.asin((DAM.gateTop - t.y) / r);
  const half = DAM.gateWidth / 2 - 0.35;
  const parts: BufferGeometry[] = [];
  const steps = 10;
  // Skin plate: two arcs of radius r and r - 0.5, stitched into a curved slab.
  const positions: number[] = [];
  const arc = (radius: number, alpha: number): [number, number] => [-radius * Math.cos(alpha), radius * Math.sin(alpha)];
  for (let i = 0; i < steps; i += 1) {
    const a0 = MathUtils.lerp(alpha0, alpha1, i / steps);
    const a1 = MathUtils.lerp(alpha0, alpha1, (i + 1) / steps);
    const [za0, y0] = arc(r, a0);
    const [za1, y1] = arc(r, a1);
    // Upstream face (toward -a, i.e. +z in the trunnion frame, since a = -z).
    positions.push(-half, y0, -za0, half, y0, -za0, half, y1, -za1, -half, y0, -za0, half, y1, -za1, -half, y1, -za1);
    const [zb0, yb0] = arc(r - 0.5, a0);
    const [zb1, yb1] = arc(r - 0.5, a1);
    positions.push(-half, yb0, -zb0, half, yb1, -zb1, half, yb0, -zb0, -half, yb0, -zb0, -half, yb1, -zb1, half, yb1, -zb1);
  }
  const plate = new BufferGeometry();
  plate.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  plate.computeVertexNormals();
  parts.push(withAlong(plate));
  for (const alpha of [MathUtils.lerp(alpha0, alpha1, 0.15), MathUtils.lerp(alpha0, alpha1, 0.5), MathUtils.lerp(alpha0, alpha1, 0.85)]) {
    const girder = new BoxGeometry(half * 2, 0.9, 0.9);
    const [za, y] = arc(r - 1, alpha);
    girder.translate(0, y, -za);
    parts.push(withAlong(girder));
  }
  // Arms: from the plate's ends at the upper and lower girders back to the trunnion hub.
  for (const side of [-1, 1]) {
    for (const alpha of [MathUtils.lerp(alpha0, alpha1, 0.2), MathUtils.lerp(alpha0, alpha1, 0.8)]) {
      const [za, y] = arc(r - 1, alpha);
      const end = new Vector3(side * (half - 0.8), y, -za);
      const start = new Vector3(side * (half - 0.8), 0, 0);
      const length = end.distanceTo(start);
      const arm = new BoxGeometry(0.7, 0.9, length);
      arm.translate(0, 0, length / 2);
      arm.lookAt(end.clone().sub(start));
      arm.translate(start.x, start.y, start.z);
      parts.push(withAlong(arm));
    }
    const hub = new CylinderGeometry(0.9, 0.9, 1.2, 10);
    hub.rotateZ(Math.PI / 2);
    hub.translate(side * (half - 0.8), 0, 0);
    parts.push(withAlong(hub));
  }
  return mergeGeometries(parts);
}

function createConcreteMaterial(colors: DamColors, bathtubHeight: number, soak: UniformNode<'float', number>) {
  const material = new MeshStandardNodeMaterial({ roughness: 0.86, metalness: 0 });
  material.name = 'concrete';
  const p = positionWorld;
  const along = attribute<'float'>('along', 'float');
  const variation = fractal(p.mul(0.08), 2);
  const lift = smoothstep(0.04, 0, fract(p.y.div(2.4)).sub(0.5).abs().sub(0.47));
  const joint = smoothstep(0.035, 0, fract(along.div(15)).sub(0.5).abs().sub(0.47));
  const streaks = smoothstep(0.5, 0.78, fractal(vec3(p.x.mul(0.45), p.y.mul(0.028), p.z.mul(0.45)), 2));
  let color = vec3(colors.concrete.r, colors.concrete.g, colors.concrete.b).mul(variation.mul(0.24).add(0.88));
  color = mix(color, vec3(colors.stain.r, colors.stain.g, colors.stain.b), streaks.mul(0.55).add(lift.mul(0.3)).add(joint.mul(0.35)).clamp(0, 0.8));
  // The bathtub ring only on concrete the reservoir touches: upstream of the arch face and the gates.
  const offset = vec2(p.x.sub(DAM.center.x), p.z.sub(DAM.center.z));
  const a = offset.dot(vec2(DAM.axis.x, DAM.axis.z));
  const l = offset.dot(vec2(DAM.right.x, DAM.right.z)).abs().min(DAM.archRadius * 0.95);
  const face = float(DAM.archRadius).sub(float(DAM.archRadius * DAM.archRadius).sub(l.mul(l)).sqrt());
  const upstream = smoothstep(face.add(2), face.add(0.5), a);
  const { ring, scum } = bathtubRing({ level: WATER_LEVEL, height: bathtubHeight, color: colors.bleached }, p.y, float(WATER_LEVEL));
  color = mix(color, vec3(colors.bleached.r, colors.bleached.g, colors.bleached.b).mul(variation.mul(0.16).add(0.92)), ring.mul(upstream).mul(0.9));
  color = mix(color, vec3(colors.stain.r, colors.stain.g, colors.stain.b), scum.mul(upstream));
  // Once the gates burst, the piers and the sill run with water: dark, glossy streaks
  // on everything around the spillway up to well above the torn gates.
  const spillway = smoothstep(DAM.spillwayHalfWidth + 8, DAM.spillwayHalfWidth, offset.dot(vec2(DAM.right.x, DAM.right.z)).abs());
  const runs = smoothstep(0.35, 0.6, fractal(vec3(p.x.mul(0.7), p.y.mul(0.04), p.z.mul(0.7)), 2));
  const soaked = soak.mul(spillway).mul(smoothstep(WATER_LEVEL + DAM.gateTop + 12, WATER_LEVEL + DAM.gateTop - 2, p.y)).mul(runs.mul(0.5).add(0.5));
  const wet = smoothstep(WATER_LEVEL + 0.8, WATER_LEVEL - 0.2, p.y).max(soaked);
  material.colorNode = mix(color, vec3(colors.wet.r, colors.wet.g, colors.wet.b), wet);
  material.roughnessNode = mix(float(0.86), float(0.4), wet);
  return material;
}

export function createDam(colors: DamColors, bathtubHeight: number): DamModel {
  const group = new Group();
  group.name = 'dam';
  group.position.copy(DAM.center);
  group.rotation.y = -DAM.heading;

  const soak = uniform(0);
  const concrete = createConcreteMaterial(colors, bathtubHeight, soak);
  const psiSpill = Math.asin((DAM.spillwayHalfWidth + 1) / DAM.archRadius);
  const psiEnd = Math.asin((DAM.halfSpan + 40) / DAM.archRadius);
  const parts: BufferGeometry[] = [];
  for (const sign of [-1, 1]) {
    const from = sign < 0 ? -psiEnd : psiSpill;
    const to = sign < 0 ? -psiSpill : psiEnd;
    parts.push(...buildArch(from, to, 48, ARCH_PROFILE));
    // Parapets on both edges of the crest road.
    parts.push(...buildArch(from, to, 48, [[0, CREST], [0, CREST + 1.3], [0.6, CREST + 1.3], [0.6, CREST]]));
    parts.push(...buildArch(from, to, 48, [[DAM.crestWidth - 0.6, CREST], [DAM.crestWidth - 0.6, CREST + 1.3], [DAM.crestWidth, CREST + 1.3], [DAM.crestWidth, CREST]]));
    // A cornice under the upstream parapet, so the crest reads as a line from far up the lake.
    parts.push(...buildArch(from, to, 48, [[-1.2, CREST - 1.8], [-1.2, CREST - 0.4], [0, CREST - 0.4], [0, CREST - 1.8]]));
    parts.push(buildCap(sign < 0 ? -psiSpill : psiSpill));
  }
  parts.push(...buildChute(), ...buildSpillwayStructure());
  // An intake tower out in the lake by the right abutment, with its access bridge to the crest.
  const intakeL = 96;
  const intakeA = archFaceA(intakeL) - 26;
  const tower = new CylinderGeometry(6, 7.5, 62, 16);
  tower.translate(intakeL, CREST - 31, -intakeA);
  parts.push(withAlong(tower, intakeL));
  parts.push(box(15, 7, 15, intakeL, CREST + 3.5, intakeA));
  parts.push(box(16.5, 0.9, 16.5, intakeL, CREST + 7.45, intakeA));
  parts.push(box(3.2, 1.4, 26 - 6, intakeL, CREST - 0.7, intakeA + 13));
  // A gatehouse on the crest near the left abutment.
  const house = archFrame(-Math.asin((DAM.halfSpan - 22) / DAM.archRadius));
  parts.push(box(12, 8, 8, house.l, CREST + 4, house.a + DAM.crestWidth / 2));
  parts.push(box(13, 0.9, 9.2, house.l, CREST + 8.45, house.a + DAM.crestWidth / 2));
  const body = new Mesh(mergeGeometries(parts), concrete);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Lamp posts along both parapets, staggered.
  const postGeometry = mergeGeometries([withAlong(new CylinderGeometry(0.14, 0.2, 6, 6).translate(0, 3, 0)), withAlong(new BoxGeometry(0.5, 0.35, 1.8).translate(0, 6, 0.7))]);
  const metal = new MeshStandardNodeMaterial({ color: colors.rail, roughness: 0.5, metalness: 0.6 });
  metal.name = 'dam-metal';
  const postPlaces: Array<[psi: number, offset: number, yaw: number]> = [];
  let flip = false;
  for (let psi = -psiEnd + 0.12; psi < psiEnd - 0.12; psi += 14 / DAM.archRadius) {
    if (Math.abs(psi) < psiSpill + 0.03) continue;
    postPlaces.push(flip ? [psi, DAM.crestWidth - 0.3, psi] : [psi, 0.3, psi + Math.PI]);
    flip = !flip;
  }
  const posts = new InstancedMesh(postGeometry, metal, postPlaces.length);
  const m = new Matrix4();
  postPlaces.forEach(([psi, offset, yaw], index) => {
    const f = archFrame(psi);
    m.makeRotationY(yaw).setPosition(f.l + f.dl * offset, CREST, -(f.a + f.da * offset));
    posts.setMatrixAt(index, m);
  });
  posts.castShadow = true;
  group.add(posts);

  // Radial gates.
  const gateMaterial = new MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.35, side: 2 });
  gateMaterial.name = 'dam-gates';
  const gp = positionWorld;
  const rust = smoothstep(0.55, 0.8, fractal(vec3(gp.x.mul(0.6), gp.y.mul(0.12), gp.z.mul(0.6)), 2));
  gateMaterial.colorNode = mix(vec3(colors.gate.r, colors.gate.g, colors.gate.b), vec3(colors.rust.r, colors.rust.g, colors.rust.b), rust.mul(0.7));
  const gateGeometry = buildGate();
  const pitch = DAM.gateWidth + DAM.pierWidth;
  const gates: DamGate[] = [];
  for (let i = 0; i < DAM.gateCount; i += 1) {
    const object = new Group();
    object.name = `dam-gate-${i}`;
    const pivot = new Vector3((i - (DAM.gateCount - 1) / 2) * pitch, DAM.trunnion.y, -DAM.trunnion.a);
    object.position.copy(pivot);
    const mesh = new Mesh(gateGeometry, gateMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    object.add(mesh);
    group.add(object);
    gates.push({ index: i, object, pivot });
  }

  // Breach motion: each gate is flung downstream, lands on the chute and rides the flood to the lip.
  const order = [2, 1, 3, 0, 4];
  const spin = new Euler();
  const q = new Quaternion();
  const state = gates.map((gate) => ({ gate, strain: 0 }));
  return {
    group,
    gates,
    setGateStrain(index, amount, time) {
      const entry = state[index];
      if (!entry) return;
      entry.strain = amount;
      const gate = entry.gate.object;
      gate.position.copy(entry.gate.pivot);
      gate.position.x += Math.sin(time * 37 + index) * 0.08 * amount;
      gate.rotation.set(-amount * 0.22 + Math.sin(time * 23 + index * 2) * 0.012 * amount, 0, Math.sin(time * 17 + index) * 0.03 * amount);
    },
    updateBreach(elapsed) {
      soak.value = elapsed < 0 ? 0 : MathUtils.smoothstep(elapsed, 0, 1.5);
      for (const entry of state) {
        const gate = entry.gate.object;
        const delay = order.indexOf(entry.gate.index) * 0.14;
        const t = elapsed - delay;
        if (t < 0) {
          if (elapsed < 0) {
            gate.visible = true;
            gate.position.copy(entry.gate.pivot);
            gate.rotation.set(0, 0, 0);
          }
          continue;
        }
        // Axial travel: a fast shove, then carried at the flood's pace, accelerating down the chute.
        const a = DAM.trunnion.a + 16 * t + 6 * t * t;
        const floor = chuteFloor(a) + 2.5;
        const flight = DAM.trunnion.y + 7 * t - 14 * t * t;
        const y = a > LIP_A ? chuteFloor(LIP_A) + 2.5 + (a - LIP_A) * 0.35 - 8 * Math.max(0, t - 2.4) ** 2 : Math.max(flight, floor);
        const side = (entry.gate.index - 2) * (1 + 0.9 * t);
        gate.position.set(entry.gate.pivot.x + side, y, -a);
        spin.set(-t * (2.2 + entry.gate.index * 0.2), Math.sin(entry.gate.index * 1.7) * t * 0.6, Math.cos(entry.gate.index * 2.3) * t * 0.5);
        gate.quaternion.copy(q.setFromEuler(spin));
        gate.visible = t < 7;
      }
    },
  };
}
