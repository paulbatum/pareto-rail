import { Color, Group, Mesh, Quaternion, SphereGeometry, Vector3 } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { abs, float, mix, normalize, positionLocal, smoothstep, vec3 } from 'three/tsl';

// Leaf: the Tinker Ball itself — a toy rubber ball (ivory, a red equator
// band, blue stars) that rolls by its own velocity. Collected pieces are
// parented to `group` so they roll with it.

const STAR_DIRECTIONS = [
  new Vector3(0.62, 0.55, 0.56),
  new Vector3(-0.7, 0.45, -0.55),
  new Vector3(0.1, -0.6, 0.79),
  new Vector3(-0.35, -0.5, -0.79),
  new Vector3(0.85, -0.45, -0.28),
  new Vector3(-0.8, 0.5, 0.33),
].map((v) => v.normalize());

export function createBallView(options: { ivory: Color; stripe: Color; star: Color }) {
  const group = new Group();
  const material = new MeshStandardNodeMaterial({ roughness: 0.32, metalness: 0 });
  const n = normalize(positionLocal);
  const band = smoothstep(float(0.2), float(0.15), abs(n.y));
  const star = (dir: Vector3) => smoothstep(float(0.955), float(0.965), n.dot(vec3(dir.x, dir.y, dir.z)));
  let starMask = star(STAR_DIRECTIONS[0]);
  for (const dir of STAR_DIRECTIONS.slice(1)) starMask = starMask.max(star(dir));
  const base = vec3(options.ivory.r, options.ivory.g, options.ivory.b);
  const withBand = mix(base, vec3(options.stripe.r, options.stripe.g, options.stripe.b), band);
  material.colorNode = mix(withBand, vec3(options.star.r, options.star.g, options.star.b), starMask);
  const core = new Mesh(new SphereGeometry(1, 48, 32), material);
  group.name = 'tinker-ball';
  core.name = 'ball-core';
  group.add(core);
  const spin = new Quaternion();
  const axis = new Vector3();
  const up = new Vector3(0, 1, 0);

  return {
    group,
    core,
    material,
    /** Roll without slipping along `velocity` (world units per second). */
    update(position: Vector3, radius: number, velocity: Vector3, dt: number) {
      group.position.copy(position);
      core.scale.setScalar(radius);
      const speed = Math.hypot(velocity.x, velocity.z);
      if (speed > 1e-4 && dt > 0) {
        axis.set(velocity.x, 0, velocity.z).normalize().cross(up).negate().normalize();
        spin.setFromAxisAngle(axis, (speed * dt) / Math.max(0.2, radius));
        group.quaternion.premultiply(spin);
        group.quaternion.normalize();
      }
    },
  };
}
