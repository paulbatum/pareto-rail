import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { glowMaterial, litMaterial } from './materials';

// The Descender's body. Local frame matches the world: +z is down the tether
// toward the car, −z is up. The origin is the maw — the target point — on the
// tether axis; the carapace stacks upward from it and four legs reach out to
// the claw sockets, then back in to grip the ribbon below.

export type DescenderPalette = {
  carapace: Color;
  frost: Color;
  bone: Color;
  glow: Color;
  hotGlow: Color;
};

export type DescenderPose = {
  /** 0→1 through the current grip step. */
  step: number;
  clawsAlive: readonly boolean[];
  /** 0 sealed → 1 fully open maw. */
  open: number;
  /** Shudder after a slip or a hit. */
  shudder: number;
  time: number;
  /** Claw socket geometry, shared with gameplay. */
  clawRadius: number;
  clawDrop: number;
  clawAngle(socket: number): number;
};

const UP = new Vector3(0, 1, 0);
const q = new Quaternion();
const a = new Vector3();
const b = new Vector3();
const d = new Vector3();

function placeSegment(mesh: Mesh, from: Vector3, to: Vector3) {
  d.subVectors(to, from);
  const length = Math.max(0.001, d.length());
  mesh.position.addVectors(from, to).multiplyScalar(0.5);
  q.setFromUnitVectors(UP, d.multiplyScalar(1 / length));
  mesh.quaternion.copy(q);
  mesh.scale.set(1, length, 1);
}

export function createDescenderMesh(p: DescenderPalette) {
  const root = new Group();
  const carapace = litMaterial(p.carapace);
  const frost = litMaterial(p.frost);
  const bone = litMaterial(p.bone);
  const glow = glowMaterial(p.glow);
  const hot = glowMaterial(p.hotGlow);

  const body = new Group();
  root.add(body);
  // Stacked carapace rings, faceted like forged plate.
  const rings: Array<[number, number, number, boolean]> = [
    [7.2, -2.2, 3.2, false],
    [8.4, -5.6, 3.6, true],
    [7.6, -9.4, 3.8, false],
    [6.2, -13.2, 3.6, true],
    [4.4, -16.6, 3.2, false],
    [2.6, -19.4, 2.6, true],
  ];
  for (const [radius, z, height, light] of rings) {
    const ring = new Mesh(new CylinderGeometry(radius * 0.86, radius, height, 9, 1).toNonIndexed(), light ? frost : carapace);
    ring.geometry.computeVertexNormals();
    ring.rotation.x = -Math.PI / 2;
    ring.position.z = z;
    body.add(ring);
    const seam = new Mesh(new TorusGeometry(radius * 0.93, 0.12, 4, 9), glow);
    seam.position.z = z + height / 2;
    body.add(seam);
  }
  // Spines raking downward off the widest ring.
  const spineGeometry = new ConeGeometry(0.55, 5.5, 5).toNonIndexed();
  spineGeometry.computeVertexNormals();
  for (let i = 0; i < 9; i += 1) {
    const angle = (i / 9) * Math.PI * 2 + 0.2;
    const spine = new Mesh(spineGeometry, bone);
    spine.position.set(Math.cos(angle) * 8.6, Math.sin(angle) * 8.6, -4.8);
    a.set(Math.cos(angle) * 0.7, Math.sin(angle) * 0.7, 0.7).normalize();
    spine.quaternion.setFromUnitVectors(UP, a);
    body.add(spine);
  }

  // The maw: six jaw plates over a burning core.
  const core = new Mesh(new SphereGeometry(2.6, 20, 14), hot);
  core.position.z = -1.6;
  body.add(core);
  const throat = new Mesh(new TorusGeometry(3.4, 0.35, 6, 24), glow);
  throat.position.z = -0.6;
  body.add(throat);
  const jaws: Group[] = [];
  const jawGeometry = new ConeGeometry(3.6, 1.1, 3, 1).toNonIndexed();
  jawGeometry.computeVertexNormals();
  jawGeometry.rotateX(Math.PI / 2);
  jawGeometry.scale(1, 0.55, 1);
  jawGeometry.translate(0, 2.6, 0);
  const toothGeometry = new ConeGeometry(0.28, 1.3, 4);
  for (let i = 0; i < 6; i += 1) {
    const hinge = new Group();
    hinge.rotation.z = (i / 6) * Math.PI * 2;
    const pivot = new Group();
    pivot.position.y = 4.4;
    const jaw = new Mesh(jawGeometry, i % 2 ? frost : carapace);
    jaw.position.y = -4.4;
    pivot.add(jaw);
    for (const x of [-0.7, 0.7]) {
      const tooth = new Mesh(toothGeometry, bone);
      tooth.position.set(x, -3.6, 0.5);
      tooth.rotation.x = Math.PI / 2;
      pivot.add(tooth);
    }
    hinge.add(pivot);
    hinge.position.z = 0.3;
    body.add(hinge);
    jaws.push(pivot);
  }
  // A ring of eyes around the maw.
  const eyes: Mesh[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const eye = new Mesh(new SphereGeometry(i % 2 ? 0.34 : 0.5, 10, 8), glow);
    eye.position.set(Math.cos(angle) * 5.6, Math.sin(angle) * 5.6, -0.8);
    body.add(eye);
    eyes.push(eye);
  }
  // Collar clamped on the ribbon above the maw.
  const collar = new Mesh(new BoxGeometry(3.4, 2.2, 3), carapace);
  collar.position.z = -21;
  body.add(collar);

  // Legs: shoulder → knee (claw socket) → foot on the ribbon.
  const legGeometry = new CylinderGeometry(0.55, 0.8, 1, 6);
  const shinGeometry = new CylinderGeometry(0.28, 0.55, 1, 6);
  const footGeometry = new ConeGeometry(0.5, 1.6, 5);
  const legs = Array.from({ length: 4 }, (_, index) => {
    const thigh = new Mesh(legGeometry, index % 2 ? carapace : frost);
    const shin = new Mesh(shinGeometry, bone);
    const foot = new Mesh(footGeometry, bone);
    root.add(thigh, shin, foot);
    return { thigh, shin, foot, sag: 0 };
  });

  root.traverse((child) => {
    child.userData.descenderPart = true;
  });
  root.userData.parts = { body, jaws, eyes, core, legs };
  return root;
}

export function poseDescender(root: Group, pose: DescenderPose) {
  const { body, jaws, eyes, core, legs } = root.userData.parts as {
    body: Group;
    jaws: Group[];
    eyes: Mesh[];
    core: Mesh;
    legs: Array<{ thigh: Mesh; shin: Mesh; foot: Mesh; sag: number }>;
  };
  const shake = pose.shudder;
  body.position.set(Math.sin(pose.time * 41) * 0.25 * shake, Math.cos(pose.time * 37) * 0.25 * shake, 0);
  // Heave with each grip: the body hauls itself down as the step lands.
  body.position.z = -Math.sin(pose.step * Math.PI) * 0.8;

  jaws.forEach((pivot, i) => {
    const breathe = Math.sin(pose.time * 3 + i) * 0.04;
    pivot.rotation.x = -(0.08 + pose.open * 1.05 + breathe);
  });
  core.scale.setScalar(0.55 + pose.open * 0.5 + Math.sin(pose.time * 6) * 0.04);
  eyes.forEach((eye, i) => {
    eye.scale.setScalar(0.8 + Math.max(0, Math.sin(pose.time * 2.3 + i * 1.7)) * 0.4);
  });

  legs.forEach((leg, socket) => {
    const alive = pose.clawsAlive[socket] ?? true;
    const angle = pose.clawAngle(socket);
    const flex = Math.sin(pose.step * Math.PI) * 0.9;
    a.set(Math.cos(angle) * 5.5, Math.sin(angle) * 5.5, -7 + body.position.z);
    // Knee sits exactly where gameplay puts the claw target.
    b.set(Math.cos(angle) * (pose.clawRadius - flex), Math.sin(angle) * (pose.clawRadius - flex) * 0.92, pose.clawDrop + flex * 0.6);
    const foot = new Vector3();
    if (alive) {
      leg.sag = Math.max(0, leg.sag - 0.05);
      // Alternate pairs reach while the others hold.
      const reach = socket % 2 === 0 ? pose.step : 1 - pose.step;
      foot.set(Math.cos(angle) * 1.2, Math.sin(angle) * 1.2, 7 + reach * 4.5);
    } else {
      // Severed grip: the leg hangs and swings.
      leg.sag = Math.min(1, leg.sag + 0.03);
      b.x *= 1 - leg.sag * 0.15;
      b.y *= 1 - leg.sag * 0.15;
      b.z += leg.sag * 4;
      foot.copy(b).add(new Vector3(Math.sin(pose.time * 1.7 + socket) * 1.5, Math.cos(pose.time * 1.3 + socket) * 1.5, 7));
    }
    placeSegment(leg.thigh, a, b);
    placeSegment(leg.shin, b, foot);
    leg.foot.position.copy(foot);
    leg.foot.quaternion.setFromUnitVectors(UP, d.subVectors(foot, b).normalize());
  });
}
