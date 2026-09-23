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
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { Camera, Material } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  clamp,
  float,
  mix,
  mx_noise_float,
  normalLocal,
  normalView,
  positionLocal,
  positionViewDirection,
  time,
  uv,
  vec3,
} from 'three/tsl';
import { ARM_COUNT, ARM_POINTS, BODY_SCALE, NODE_INDEX, type OctopusRig } from '../octopus';
import { senseUniforms, surfaceMaterial } from './materials';
import { MURK, THERMAL, hdr } from './palette';

// The creature's body: an oily mantle, a lamp-eyed head, and eight dynamic
// tentacle tubes rebuilt every frame from the rig's spines. Leaf file — the
// rig decides where everything is; this only skins it.

const RADIAL = 12;

/** A tube skinned over a moving spine, updated in place every frame. */
export class TubeSkin {
  readonly mesh: Mesh;
  private readonly positions: Float32Array;
  private readonly normals: Float32Array;
  private readonly pointCount: number;
  private readonly tangent = new Vector3();
  private readonly normal = new Vector3();
  private readonly binormal = new Vector3();
  private readonly offset = new Vector3();

  constructor(pointCount: number, material: Material) {
    this.pointCount = pointCount;
    const ring = RADIAL + 1;
    this.positions = new Float32Array(pointCount * ring * 3);
    this.normals = new Float32Array(pointCount * ring * 3);
    const uvs = new Float32Array(pointCount * ring * 2);
    const indices: number[] = [];
    for (let k = 0; k < pointCount; k += 1) {
      for (let j = 0; j < ring; j += 1) {
        uvs[(k * ring + j) * 2] = k / (pointCount - 1);
        uvs[(k * ring + j) * 2 + 1] = j / RADIAL;
        if (k < pointCount - 1 && j < RADIAL) {
          const a = k * ring + j;
          const b = (k + 1) * ring + j;
          indices.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new BufferAttribute(this.normals, 3));
    geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
  }

  update(points: readonly Vector3[], radii: ArrayLike<number>, count = this.pointCount) {
    const ring = RADIAL + 1;
    const used = Math.max(2, Math.min(count, this.pointCount));
    for (let k = 0; k < this.pointCount; k += 1) {
      const index = Math.min(k, used - 1);
      const prev = points[Math.max(0, index - 1)];
      const next = points[Math.min(used - 1, index + 1)];
      this.tangent.copy(next).sub(prev);
      if (this.tangent.lengthSq() < 1e-8) this.tangent.set(0, 1, 0);
      this.tangent.normalize();
      if (k === 0) {
        this.normal.set(0, 1, 0);
        if (Math.abs(this.tangent.y) > 0.9) this.normal.set(1, 0, 0);
      }
      // Parallel transport keeps the skin from twisting along the arm.
      this.normal.addScaledVector(this.tangent, -this.tangent.dot(this.normal)).normalize();
      this.binormal.crossVectors(this.tangent, this.normal);
      const center = points[index];
      const radius = k >= used ? 0.001 : radii[index];
      for (let j = 0; j < ring; j += 1) {
        const angle = (j / RADIAL) * Math.PI * 2;
        this.offset.copy(this.normal).multiplyScalar(Math.cos(angle)).addScaledVector(this.binormal, Math.sin(angle));
        const vertex = (k * ring + j) * 3;
        this.positions[vertex] = center.x + this.offset.x * radius;
        this.positions[vertex + 1] = center.y + this.offset.y * radius;
        this.positions[vertex + 2] = center.z + this.offset.z * radius;
        this.normals[vertex] = this.offset.x;
        this.normals[vertex + 1] = this.offset.y;
        this.normals[vertex + 2] = this.offset.z;
      }
    }
    const geometry = this.mesh.geometry;
    geometry.getAttribute('position').needsUpdate = true;
    geometry.getAttribute('normal').needsUpdate = true;
  }
}

/** Oily creature skin: wet highlights and an oil-slick sheen in murk, graded white heat in thermal. */
function creatureSkin(options: { base: Color; mottle: Color; heatNear: Color; heatFar: Color; sheen: number; roughness: number; along?: boolean }) {
  const material = new MeshStandardNodeMaterial({ roughness: options.roughness, metalness: 0.2 });
  const seen = senseUniforms.veil.oneMinus();
  const murk = senseUniforms.thermal.oneMinus();
  const q = uv();
  const mottle = mx_noise_float(vec3(q.x.mul(34), q.y.mul(5), float(1.3))).mul(0.5).add(0.5);
  const albedo = mix(
    vec3(options.base.r, options.base.g, options.base.b),
    vec3(options.mottle.r, options.mottle.g, options.mottle.b),
    mottle.pow(2.2),
  );
  material.colorNode = albedo.mul(murk).mul(seen);
  const facing = clamp(normalView.dot(positionViewDirection), 0, 1);
  const rim = float(1).sub(facing).pow(4.5);
  // Oil-slick: the rim hue drifts through bruise-violet, bile, and brass.
  const hue = mx_noise_float(vec3(q.x.mul(6), q.y.mul(2), time.mul(0.15))).mul(0.5).add(0.5);
  const slick = mix(vec3(0.34, 0.16, 0.5), vec3(0.5, 0.52, 0.12), hue).mul(rim).mul(options.sheen);
  const heatGrade = options.along
    ? mix(vec3(options.heatNear.r, options.heatNear.g, options.heatNear.b), vec3(options.heatFar.r, options.heatFar.g, options.heatFar.b), q.x.pow(1.4))
    : vec3(options.heatNear.r, options.heatNear.g, options.heatNear.b);
  const heat = heatGrade
    .mul(mix(float(0.55), float(1), facing.pow(0.6)))
    .mul(senseUniforms.bodyHeat.mul(0.9).add(0.1));
  material.emissiveNode = slick.mul(seen).mul(senseUniforms.lamps.mul(0.6).add(0.4)).mul(murk).add(heat.mul(senseUniforms.thermal));
  return material;
}

export type OctopusVisual = {
  root: Group;
  update(dt: number, camera: Camera): void;
};

export function createOctopusVisual(rig: OctopusRig): OctopusVisual {
  const root = new Group();
  root.name = 'octopus';

  const armMaterial = creatureSkin({
    base: MURK.oil,
    mottle: MURK.fleshDark.clone().multiplyScalar(0.8),
    heatNear: THERMAL.body,
    heatFar: THERMAL.bodyCool.clone().multiplyScalar(1.3),
    sheen: 0.16,
    roughness: 0.34,
    along: true,
  });
  const arms = rig.arms.map(() => {
    const skin = new TubeSkin(ARM_POINTS, armMaterial);
    skin.mesh.name = 'octopus-arm';
    root.add(skin.mesh);
    return skin;
  });
  const pieces = rig.arms.map(() => {
    const skin = new TubeSkin(ARM_POINTS, armMaterial);
    skin.mesh.name = 'octopus-severed';
    skin.mesh.visible = false;
    root.add(skin.mesh);
    return skin;
  });

  // Snapped harbor cables the reaching arms drag up out of the water. Cold
  // steel: they stay dark in thermal against the white-hot flesh.
  const CABLE_POINTS = 14;
  const cableMaterial = surfaceMaterial({ color: MURK.iron, heat: THERMAL.steel, roughness: 0.45, metalness: 0.7 });
  const cables = rig.arms.map(() => {
    const skin = new TubeSkin(CABLE_POINTS, cableMaterial);
    skin.mesh.name = 'octopus-cable';
    skin.mesh.visible = false;
    root.add(skin.mesh);
    return skin;
  });
  const cablePoints = Array.from({ length: CABLE_POINTS }, () => new Vector3());
  const cableRadii = new Float32Array(CABLE_POINTS).fill(0.16);
  let cableClock = 0;

  // Suckers: pale cream rings turned toward the viewer along every arm.
  const SUCKERS_PER_ARM = 16;
  const suckerMaterial = surfaceMaterial({
    color: MURK.flesh.clone().multiplyScalar(1.15),
    heat: THERMAL.bodyCool,
    roughness: 0.55,
    veil: true,
    bodyHeat: true,
  });
  const suckers = new InstancedMesh(new TorusGeometry(0.5, 0.2, 5, 10), suckerMaterial, ARM_COUNT * SUCKERS_PER_ARM * 2);
  suckers.name = 'octopus-suckers';
  suckers.frustumCulled = false;
  root.add(suckers);

  // Body: head bulb, mantle, siphon. Grouped under one transform from the rig.
  const body = new Group();
  const bodyScaled = new Group();
  bodyScaled.scale.setScalar(BODY_SCALE);
  body.add(bodyScaled);
  root.add(body);
  const mantleMaterial = creatureSkin({
    base: MURK.oil.clone().multiplyScalar(1.3),
    mottle: MURK.fleshDark,
    heatNear: THERMAL.hot,
    heatFar: THERMAL.hot,
    sheen: 0.3,
    roughness: 0.3,
  });
  // The mantle breathes and crawls: slow noise swells along its surface.
  mantleMaterial.positionNode = positionLocal.add(
    normalLocal.mul(
      mx_noise_float(positionLocal.mul(1.7).add(vec3(0, time.mul(0.25), 0))).mul(0.12)
        .add(senseUniforms.beat.mul(0.03)),
    ),
  );
  const mantle = new Mesh(new SphereGeometry(1, 40, 28), mantleMaterial);
  mantle.name = 'octopus-mantle';
  mantle.scale.set(8.5, 11, 10);
  mantle.position.set(0, 11, -5);
  mantle.rotation.x = -0.45;
  bodyScaled.add(mantle);
  const head = new Mesh(new SphereGeometry(1, 32, 20), mantleMaterial);
  head.name = 'octopus-head';
  head.scale.set(8, 6, 7.2);
  head.position.set(0, 4.8, 1.6);
  bodyScaled.add(head);
  const siphon = new Mesh(new CylinderGeometry(1.2, 2.1, 5, 12, 1, true), mantleMaterial);
  siphon.position.set(6.6, 3.2, -1);
  siphon.rotation.set(0.3, 0, -1.1);
  bodyScaled.add(siphon);

  // Eyes: bile-gold eyeshine catching the lamps, a horizontal slit pupil that
  // tracks the player. In thermal they burn hot.
  const eyeMaterial = surfaceMaterial({
    color: MURK.bile.clone().multiplyScalar(0.5),
    heat: THERMAL.hot,
    emissive: hdr(MURK.bile, 0.9),
    roughness: 0.15,
    veil: true,
    bodyHeat: true,
  });
  const pupilMaterial = surfaceMaterial({ color: new Color(0.01, 0.01, 0.01), heat: THERMAL.bodyCool, roughness: 0.1, veil: true });
  const eyes = [-1, 1].map((side) => {
    const socket = new Group();
    socket.position.set(side * 5.2, 6.2, 5.2);
    const ball = new Mesh(new SphereGeometry(1.75, 20, 14), eyeMaterial);
    const pupil = new Mesh(new BoxGeometry(2.3, 0.42, 0.4), pupilMaterial);
    pupil.position.z = 1.62;
    const lid = new Mesh(new SphereGeometry(2.05, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), mantleMaterial);
    lid.rotation.x = -0.35;
    socket.add(ball, pupil, lid);
    bodyScaled.add(socket);
    return socket;
  });

  const tmpMatrix = new Matrix4();
  const tmpQuat = new Quaternion();
  const tmpPos = new Vector3();
  const tmpScale = new Vector3();
  const toViewer = new Vector3();
  const along = new Vector3();
  const side = new Vector3();
  const zAxis = new Vector3(0, 0, 1);
  const worldQuat = new Quaternion();

  function placeSuckers(armIndex: number, points: readonly Vector3[], radii: ArrayLike<number>, count: number, slot: number, camera: Camera) {
    for (let s = 0; s < SUCKERS_PER_ARM; s += 1) {
      const instance = (armIndex * 2 + slot) * SUCKERS_PER_ARM + s;
      const k = Math.floor(4 + (s / SUCKERS_PER_ARM) * (count - 5));
      if (count < 6 || k >= count - 1) {
        suckers.setMatrixAt(instance, tmpMatrix.makeScale(0, 0, 0));
        continue;
      }
      const point = points[k];
      along.copy(points[k + 1]).sub(points[k - 1]).normalize();
      toViewer.copy(camera.position).sub(point);
      toViewer.addScaledVector(along, -toViewer.dot(along)).normalize();
      // Two staggered rows, the way real suckers run.
      side.crossVectors(along, toViewer).normalize();
      const radius = radii[k];
      const row = (s % 2 === 0 ? 1 : -1) * radius * 0.38;
      tmpPos.copy(point).addScaledVector(toViewer, radius * 0.86).addScaledVector(side, row);
      tmpQuat.setFromUnitVectors(zAxis, toViewer);
      const size = Math.max(0.1, radius * 0.3);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale.setScalar(size));
      suckers.setMatrixAt(instance, tmpMatrix);
    }
  }

  const eyeGlow = (eyeMaterial.userData.surface as { emissive: { value: Color } }).emissive.value;
  const eyeBase = eyeGlow.clone();

  function updateCable(index: number) {
    const arm = rig.arms[index];
    const skin = cables[index];
    skin.mesh.visible = arm.reach > 0.3 && arm.rise > 0.2;
    if (!skin.mesh.visible) return;
    // Wrapped at a coil near the node, it hangs in a swaying catenary back
    // down into the harbor behind the arm.
    const anchor = arm.points[NODE_INDEX - 6];
    const back = tmpPos.copy(arm.points[NODE_INDEX - 12]).sub(anchor).setY(0);
    if (back.lengthSq() < 1e-4) back.set(1, 0, 0);
    back.normalize();
    const sway = Math.sin(cableClock * 1.7 + index) * 1.8;
    for (let k = 0; k < CABLE_POINTS; k += 1) {
      const t = k / (CABLE_POINTS - 1);
      cablePoints[k].copy(anchor)
        .addScaledVector(back, t * 9 + Math.sin(t * Math.PI) * sway)
        .add(side.set(Math.sin(t * 5 + cableClock) * 0.4 * t, 0, Math.cos(t * 4 + cableClock) * 0.4 * t));
      // Gravity pulls it down past the waterline.
      cablePoints[k].y = anchor.y * (1 - t) + -3 * t - Math.sin(t * Math.PI) * 3;
      // A few loops of cable bitten into the arm near the anchor.
      if (k < 3) cablePoints[k].addScaledVector(arm.nodeNormal, (arm.radii[NODE_INDEX - 6] + 0.1) * (1 - k / 3));
    }
    skin.update(cablePoints, cableRadii);
  }

  function update(_dt: number, camera: Camera) {
    cableClock += _dt;
    for (let index = 0; index < ARM_COUNT; index += 1) updateCable(index);
    // The eyeshine goes out as it dies.
    eyeGlow.copy(eyeBase).multiplyScalar(1 - rig.body.collapse);
    body.position.copy(rig.body.position);
    body.quaternion.copy(rig.body.quaternion);

    rig.arms.forEach((arm, index) => {
      arms[index].update(arm.points, arm.radii);
      placeSuckers(index, arm.points, arm.radii, ARM_POINTS, 0, camera);
      const piece = arm.piece;
      pieces[index].mesh.visible = piece.active;
      if (piece.active) {
        pieces[index].update(piece.points, piece.radii, piece.count);
        placeSuckers(index, piece.points, piece.radii, piece.count, 1, camera);
      } else {
        placeSuckers(index, piece.points, piece.radii, 0, 1, camera);
      }
    });
    suckers.instanceMatrix.needsUpdate = true;

    // Eyes track the viewer (with the lids fixed to the head).
    body.updateMatrixWorld();
    for (const socket of eyes) {
      const ball = socket.children[0];
      const pupil = socket.children[1];
      socket.getWorldQuaternion(worldQuat);
      socket.getWorldPosition(tmpPos);
      toViewer.copy(camera.position).sub(tmpPos).normalize();
      // Rotate the pupil around the ball toward the viewer, in socket space.
      const local = toViewer.applyQuaternion(worldQuat.invert());
      local.z = Math.max(0.35, local.z);
      local.normalize();
      pupil.position.copy(local).multiplyScalar(1.62);
      pupil.quaternion.setFromUnitVectors(zAxis, local);
      ball.rotation.set(0, 0, 0);
    }
  }

  return { root, update };
}
