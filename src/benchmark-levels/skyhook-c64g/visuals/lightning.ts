import { BufferAttribute, BufferGeometry, Color, Group, LineBasicMaterial, LineSegments, Scene, Vector3 } from 'three';
import type { Camera } from 'three';
import { mulberry32 } from '../../../engine/rng';

// Lightning in the storm: a jagged main channel with a couple of forks, drawn as
// hot thin lines a few hundred units out. It strikes on the score's downbeats
// (see LIGHTNING_TIMES in index.ts) and holds for a stutter of flicker.

const SEGMENTS = 22;
const MAX_VERTS = (SEGMENTS + 24) * 2 * 2;

export type Lightning = {
  group: Group;
  strike(camera: Camera, viewForward: Vector3, seed: number): void;
  update(dt: number): void;
  reset(): void;
};

export function createLightning(scene: Scene): Lightning {
  const group = new Group();
  const positions = new Float32Array(MAX_VERTS * 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0);
  const material = new LineBasicMaterial({ color: new Color(3.2, 3.2, 3.8), fog: false });
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.userData.raildIgnoreOcclusion = true;
  lines.visible = false;
  group.add(lines);
  scene.add(group);

  let life = 0;
  let age = 0;

  return {
    group,
    strike(camera, viewForward, seed) {
      const rng = mulberry32(seed * 7919 + 13);
      const forward = viewForward.clone().normalize();
      const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
      // A point off to one side, well up-cloud, and a channel down to the sea.
      const side = (rng() < 0.5 ? -1 : 1) * (60 + rng() * 140);
      const distance = 260 + rng() * 120;
      const top = camera.position.clone().addScaledVector(forward, distance).addScaledVector(right, side);
      top.y += 230 + rng() * 60;
      const bottom = top.clone();
      bottom.y = camera.position.y - 80 - rng() * 60;
      bottom.x += (rng() - 0.5) * 40;

      let count = 0;
      const push = (a: Vector3, b: Vector3) => {
        if (count + 2 > MAX_VERTS) return;
        positions.set([a.x, a.y, a.z, b.x, b.y, b.z], count * 3);
        count += 2;
      };
      const channel: Vector3[] = [];
      for (let i = 0; i <= SEGMENTS; i += 1) {
        const t = i / SEGMENTS;
        const p = top.clone().lerp(bottom, t);
        const wander = Math.sin(t * Math.PI) * 26;
        p.x += (rng() - 0.5) * wander;
        p.z += (rng() - 0.5) * wander * 0.6;
        channel.push(p);
      }
      for (let i = 0; i < SEGMENTS; i += 1) push(channel[i], channel[i + 1]);
      // Forks.
      for (let f = 0; f < 3; f += 1) {
        const at = 4 + Math.floor(rng() * (SEGMENTS - 9));
        let p = channel[at].clone();
        const dir = new Vector3((rng() - 0.5) * 1.6, -0.6 - rng() * 0.5, (rng() - 0.5) * 0.6).normalize();
        for (let s = 0; s < 6; s += 1) {
          const next = p.clone().addScaledVector(dir, 16 + rng() * 10);
          next.x += (rng() - 0.5) * 12;
          push(p, next);
          p = next;
        }
      }
      (geometry.attributes.position as BufferAttribute).needsUpdate = true;
      geometry.setDrawRange(0, count);
      life = 0.34;
      age = 0;
      lines.visible = true;
    },
    update(dt) {
      if (life <= 0) return;
      age += dt;
      life -= dt;
      // Flicker: on, off, on, fading.
      const phase = age / 0.34;
      const on = phase < 0.22 || (phase > 0.32 && phase < 0.55) || (phase > 0.66 && phase < 0.78);
      lines.visible = life > 0 && on;
      material.color.setRGB(3.2, 3.2, 3.8).multiplyScalar(1 - phase * 0.5);
      if (life <= 0) lines.visible = false;
    },
    reset() {
      life = 0;
      lines.visible = false;
    },
  };
}
