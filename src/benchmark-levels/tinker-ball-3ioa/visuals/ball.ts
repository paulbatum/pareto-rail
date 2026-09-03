import { CircleGeometry, Color, Group, Mesh, MeshBasicMaterial, Quaternion, Scene, SphereGeometry, Vector3 } from 'three';
import type { CatmullRomCurve3 } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { float, mix, mx_noise_float, positionLocal, smoothstep, vec3 } from 'three/tsl';
import { sampleRailFrame } from '../../../engine/rail';
import { disposeObject3D } from '../../../engine/visual-kit';
import { ballProfileAt, TABLE_Y } from '../gameplay';
import { createGlueMaterial } from './enemies';
import { GOLD, MINT } from './palette';
import type { BallSnapshot } from './pieces';

// The player's ball. A glass marble with a mint cat's-eye ribbon, rolling on
// the table a little ahead of the camera. It grows through the run, swerves
// toward rescued pieces lying on the road, and wears whatever sticks to it.

export type BallUpdateContext = {
  curve: CatmullRomCurve3;
  runProgress: number;
  running: boolean;
  elapsed: number;
  swerveTarget: number | null;
};

export type Ball = ReturnType<typeof createBall>;

const UP = new Vector3(0, 1, 0);

export function createBall(scene: Scene, curve: CatmullRomCurve3) {
  const railLength = curve.getLength();
  const group = new Group();
  const spin = new Group();
  group.add(spin);
  group.userData.raildIgnoreOcclusion = true;

  const material = new MeshStandardNodeMaterial({ roughness: 0.3, metalness: 0.05 });
  const p = positionLocal;
  const swirl = p.y.mul(5.5).add(p.x.mul(3.2)).add(mx_noise_float(p.mul(2.6)).mul(2.4)).sin();
  const ribbon = smoothstep(float(0.62), float(0.92), swirl);
  const thread = smoothstep(float(0.9), float(0.985), p.z.mul(7).add(p.y.mul(2)).sin());
  const pearl = vec3(0.93, 0.9, 0.86);
  const mint = vec3(MINT.r * 0.85, MINT.g * 0.85, MINT.b * 0.85);
  const gold = vec3(GOLD.r, GOLD.g, GOLD.b);
  material.colorNode = mix(mix(pearl, mint, ribbon.mul(0.85)), gold, thread.mul(0.6));
  const sphere = new Mesh(new SphereGeometry(1, 40, 28), material);
  spin.add(sphere);

  const shadow = new Mesh(
    new CircleGeometry(1.08, 22),
    new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(-0.3, -0.985, 0.3);
  shadow.renderOrder = 1;
  group.add(shadow);

  scene.add(group);

  const state: BallSnapshot & { velocity: Vector3; visualRadius: number } = {
    center: new Vector3(0, 1, 0),
    radius: 0.45,
    visualRadius: 0.45,
    quaternion: new Quaternion(),
    tangent: new Vector3(0, 0, -1),
    right: new Vector3(1, 0, 0),
    u: 0,
    speed: 0,
    velocity: new Vector3(),
  };
  const previous = new Vector3();
  let swerve = 0;
  let pulse = 0;
  let idle = 0;
  const goo: Mesh[] = [];
  const glue = createGlueMaterial(0.04);

  function update(dt: number, context: BallUpdateContext) {
    const profile = ballProfileAt(context.runProgress);
    state.radius = profile.radius;
    const u = Math.min(1, context.runProgress + (profile.ahead * (context.running ? 1 : 2.1)) / railLength);
    const frame = sampleRailFrame(context.curve, u);
    state.u = u;
    state.tangent.copy(frame.tangent);
    state.tangent.y = 0;
    state.tangent.normalize();
    state.right.copy(frame.right);
    state.right.y = 0;
    state.right.normalize();

    // Swerve toward pieces on the road; drift home otherwise. In attract mode
    // the marble idles with a lazy back-and-forth wobble.
    const maxSwerve = state.radius * 2.2 + 1.2;
    let target = context.swerveTarget === null ? 0 : Math.max(-maxSwerve, Math.min(maxSwerve, context.swerveTarget));
    if (!context.running) {
      idle += dt;
      target = Math.sin(idle * 0.7) * 0.5;
    }
    swerve += (target - swerve) * Math.min(1, dt * (context.running ? 3.6 : 1.5));

    previous.copy(state.center);
    state.center.copy(frame.position).addScaledVector(state.right, swerve);
    state.center.y = TABLE_Y + state.radius;
    if (dt > 0) state.velocity.copy(state.center).sub(previous).divideScalar(dt);
    state.speed = state.velocity.length();

    // Roll: the sphere turns about the axis perpendicular to its motion.
    const distance = state.center.distanceTo(previous);
    if (distance > 1e-5 && distance < 20) {
      const direction = state.center.clone().sub(previous).normalize();
      const axis = new Vector3().crossVectors(UP, direction);
      if (axis.lengthSq() > 1e-6) {
        axis.normalize();
        const turn = new Quaternion().setFromAxisAngle(axis, distance / state.radius);
        state.quaternion.premultiply(turn).normalize();
      }
    }

    pulse = Math.max(0, pulse - dt * 2.2);
    state.visualRadius = state.radius * (1 + pulse * 0.1);
    group.position.copy(state.center);
    group.scale.setScalar(state.visualRadius);
    spin.quaternion.copy(state.quaternion);
  }

  /** A growth pulse: the ball swells for a beat when a shell showers it. */
  function grow(amount = 1) {
    pulse = Math.min(1.5, pulse + amount);
  }

  /** A glue glob landed: a black smear rides the ball from now on. */
  function gum() {
    if (goo.length >= 4) return;
    const blob = new Mesh(new SphereGeometry(0.34, 12, 8), glue);
    const direction = new Vector3(Math.random() - 0.5, Math.random() * 0.6 + 0.2, Math.random() - 0.5).normalize();
    blob.position.copy(direction).applyQuaternion(state.quaternion.clone().invert()).multiplyScalar(0.94);
    blob.scale.set(1.2, 0.55, 1.2);
    blob.quaternion.setFromUnitVectors(UP, blob.position.clone().normalize());
    spin.add(blob);
    goo.push(blob);
  }

  function reset() {
    for (const blob of goo) {
      blob.removeFromParent();
      blob.geometry.dispose();
    }
    goo.length = 0;
    pulse = 0;
    swerve = 0;
    state.quaternion.identity();
  }

  function dispose() {
    reset();
    group.removeFromParent();
    disposeObject3D(group);
  }

  return { group, state, update, grow, gum, reset, dispose, tint: (color: Color) => material.color.copy(color) };
}
