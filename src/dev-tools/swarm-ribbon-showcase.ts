import { Box3, Color, Group, OctahedronGeometry, Sphere, Vector3 } from 'three';
import { float, mix, positionLocal, sin, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { createSwarm } from '../engine/instanced-swarm';
import { createRibbonTrail } from '../engine/ribbon-trail';

/**
 * Snapshot factory that exercises `createSwarm` and `createRibbonTrail`
 * together: an orbiting shell of animated instances and several ribbons on
 * sinusoidal paths, pre-run for `seconds` at 60 fps so a still frame shows the
 * trails extended. The ribbons face the camera the snapshot tool places at its
 * first orbit angle. The returned group exposes `userData.step(dt, cameraPosition)`
 * for a probe that wants to keep the scene moving.
 *
 *   npm run snapshot -- --module src/dev-tools/swarm-ribbon-showcase.ts --export createSwarmRibbonShowcase --args '[300, 6]'
 */
export function createSwarmRibbonShowcase(instanceCount = 300, ribbonCount = 6, seconds = 2) {
  const root = new Group();
  const geometry = new OctahedronGeometry(0.28);
  const material = new MeshBasicNodeMaterial();
  const swarm = createSwarm({
    geometry,
    material,
    capacity: instanceCount,
    attributes: { phase: 'float', tint: 'vec3', flashAt: 'float' },
  });
  const { phase, tint, flashAt, time } = swarm.nodes;
  const cycle = phase.mul(6.2832);
  const pulse = sin(time.mul(4).add(cycle)).mul(0.5).add(0.5);
  const flash = time.sub(flashAt).mul(-6).exp();
  material.colorNode = mix(tint.mul(0.45), tint.mul(1.7), pulse).add(vec3(flash.mul(2.5)));
  material.positionNode = positionLocal.add(vec3(0, sin(time.mul(3).add(cycle)).mul(0.12), 0));
  root.add(swarm.mesh);

  const palette = [new Color(0.2, 0.7, 1), new Color(1, 0.45, 0.2), new Color(0.6, 1, 0.5)];
  const shell: Array<{ proxy: Group; index: number; azimuth: number; elevation: number; radius: number; rate: number }> = [];
  for (let i = 0; i < instanceCount; i += 1) {
    const slot = swarm.acquire();
    if (!slot) break;
    root.add(slot.proxy);
    const elevation = Math.acos(1 - (2 * (i + 0.5)) / instanceCount) - Math.PI / 2;
    const azimuth = i * 2.399963;
    shell.push({ ...slot, azimuth, elevation, radius: 5 + (i % 7) * 0.25, rate: 0.25 + (i % 5) * 0.08 });
    const color = palette[i % palette.length];
    swarm.write(slot.index, 'phase', (i * 0.618034) % 1);
    swarm.write(slot.index, 'tint', color.r, color.g, color.b);
    swarm.write(slot.index, 'flashAt', -10);
  }

  const ribbons: Array<{ trail: ReturnType<typeof createRibbonTrail>; offset: number; radius: number; lift: number }> = [];
  for (let r = 0; r < ribbonCount; r += 1) {
    const color = palette[r % palette.length];
    const trail = createRibbonTrail({
      points: 48,
      minSpacing: 0.04,
      color,
      width: ({ t }) => float(0.32).mul(float(1).sub(t)).add(0.03),
    });
    root.add(trail.mesh);
    ribbons.push({ trail, offset: (r / ribbonCount) * Math.PI * 2, radius: 3.2 + r * 0.35, lift: 1.2 + r * 0.3 });
  }

  let elapsed = 0;
  const point = new Vector3();
  function step(dt: number, cameraPosition?: Vector3) {
    elapsed += dt;
    for (const entry of shell) {
      const angle = entry.azimuth + elapsed * entry.rate;
      const flat = Math.cos(entry.elevation) * entry.radius;
      entry.proxy.position.set(Math.cos(angle) * flat, Math.sin(entry.elevation) * entry.radius, Math.sin(angle) * flat);
      entry.proxy.rotation.set(elapsed * 0.7, angle, 0);
    }
    if (shell.length > 0) {
      const flashing = shell[Math.floor(elapsed * 40) % shell.length];
      swarm.write(flashing.index, 'flashAt', swarm.time);
    }
    swarm.update(dt);
    for (const ribbon of ribbons) {
      const a = ribbon.offset + elapsed * 1.6;
      point.set(Math.cos(a) * ribbon.radius, Math.sin(a * 3) * ribbon.lift, Math.sin(a) * ribbon.radius);
      ribbon.trail.pushPoint(point);
      ribbon.trail.update(dt, cameraPosition);
    }
  }

  for (let frame = 0; frame < seconds * 60; frame += 1) step(1 / 60);
  step(0, snapshotCameraPosition(root));
  root.userData.step = step;
  return root;
}

/** Where `src/dev-tools/snapshot.ts` puts its camera for yaw 0, pitch -12, fov 45, fill 0.7. */
function snapshotCameraPosition(object: Group) {
  const sphere = new Box3().setFromObject(object).getBoundingSphere(new Sphere());
  const radius = Math.max(sphere.radius, 0.5) / (Math.sin(Math.PI / 8) * 0.7);
  const pitch = (-12 * Math.PI) / 180;
  return new Vector3(sphere.center.x, sphere.center.y + Math.sin(pitch) * radius, sphere.center.z + Math.cos(pitch) * radius);
}
