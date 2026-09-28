import {
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  Group,
} from 'three';
import type { Camera } from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';

// The effect vocabulary is water: bubbles that rise, motes that drift up the
// strands toward the bell, sun-gold sparks that hang and fade instead of
// falling, rings that spread like a stone dropped in a pond.

const PARTICLE_CAPACITY = 1500;
const RING_CAPACITY = 30;
const GLINT_CAPACITY = 16;
const WAVE_CAPACITY = 5;

export type ParticleSpec = {
  position: Vector3;
  velocity: Vector3;
  color: Color;
  size: number;
  life: number;
  drag: number;
  /** Acceleration in world space: buoyancy (up), or drift toward the bell. */
  accel: Vector3;
  /** 0 = fade linearly, 1 = hold then pop out (sparks), −1 = swell in then fade (motes). */
  shape: -1 | 0 | 1;
};

type Particle = ParticleSpec & { age: number };
type RingEffect = { mesh: Mesh; color: Color; age: number; life: number; fromScale: number; toScale: number };
type GlintEffect = { group: Group; materials: MeshBasicMaterial[]; color: Color; age: number; life: number; scale: number };
type WaveEffect = { mesh: Mesh; color: Color; age: number; life: number; fromScale: number; toScale: number };

const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const ZERO_QUATERNION = new Quaternion();

export function createEffects(scene: Scene) {
  const particles: Particle[] = [];
  const rings: RingEffect[] = [];
  const glints: GlintEffect[] = [];
  const waves: WaveEffect[] = [];
  const root = new Group();
  root.userData.raildIgnoreOcclusion = true;
  // Transparent order: water −100 · strands 1 · bell 2–3 · shafts 4 · halos 6 · crown web 7–8 · effects 10 · lock rings 11.
  root.renderOrder = 10;
  scene.add(root);

  const mesh = new InstancedMesh(
    new SphereGeometry(0.5, 6, 4),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    PARTICLE_CAPACITY,
  );
  mesh.count = 0;
  mesh.frustumCulled = false;
  root.add(mesh);

  const ringGeometry = new RingGeometry(0.94, 1, 56);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const ring = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    ring.visible = false;
    root.add(ring);
    rings.push({ mesh: ring, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  const bladeGeometry = new PlaneGeometry(1.8, 0.06);
  for (let i = 0; i < GLINT_CAPACITY; i += 1) {
    const group = new Group();
    const materials: MeshBasicMaterial[] = [];
    for (const rotation of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
      const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
      const blade = new Mesh(bladeGeometry, material);
      blade.rotation.z = rotation;
      blade.scale.setScalar(rotation % (Math.PI / 2) === 0 ? 1 : 0.55);
      group.add(blade);
      materials.push(material);
    }
    group.visible = false;
    root.add(group);
    glints.push({ group, materials, color: new Color(), age: 0, life: -1, scale: 1 });
  }

  const waveGeometry = new SphereGeometry(1, 32, 20);
  for (let i = 0; i < WAVE_CAPACITY; i += 1) {
    const wave = new Mesh(waveGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    wave.visible = false;
    root.add(wave);
    waves.push({ mesh: wave, color: new Color(), age: 0, life: -1, fromScale: 1, toScale: 2 });
  }

  function push(spec: ParticleSpec) {
    if (particles.length >= PARTICLE_CAPACITY) particles.shift();
    particles.push({ ...spec, age: 0 });
  }

  return {
    particle: push,

    /** A radial burst. `bias` shoves the whole cloud one way (e.g. up the strand). */
    burst(
      position: Vector3,
      color: Color,
      count: number,
      speed: number,
      options: { life?: number; size?: number; drag?: number; accel?: Vector3; shape?: -1 | 0 | 1; bias?: Vector3; spread?: number } = {},
    ) {
      for (let i = 0; i < count; i += 1) {
        const direction = randomUnit();
        const velocity = direction.multiplyScalar(speed * (0.35 + Math.random() * 0.85));
        if (options.bias) velocity.add(options.bias);
        push({
          position: position.clone().addScaledVector(direction, (options.spread ?? 0.3) * Math.random()),
          velocity,
          color: color.clone(),
          size: (options.size ?? 0.34) * (0.6 + Math.random() * 0.8),
          life: (options.life ?? 0.7) * (0.7 + Math.random() * 0.6),
          drag: options.drag ?? 2.2,
          accel: options.accel ?? new Vector3(0, 0.7, 0),
          shape: options.shape ?? 0,
        });
      }
    },

    ring(position: Vector3, orientation: Quaternion, color: Color, toScale: number, life: number, fromScale = 0.12) {
      const ring = rings.find((candidate) => candidate.life < 0);
      if (!ring) return;
      ring.mesh.position.copy(position);
      ring.mesh.quaternion.copy(orientation);
      ring.mesh.scale.setScalar(0.01);
      ring.mesh.visible = true;
      ring.color.copy(color);
      ring.age = 0;
      ring.life = life;
      ring.fromScale = toScale * fromScale;
      ring.toScale = toScale;
    },

    glint(position: Vector3, orientation: Quaternion, color: Color, scale = 1, life = 0.2) {
      const glint = glints.find((candidate) => candidate.life < 0);
      if (!glint) return;
      glint.group.position.copy(position);
      glint.group.quaternion.copy(orientation);
      glint.group.visible = true;
      glint.color.copy(color);
      glint.age = 0;
      glint.life = life;
      glint.scale = scale;
    },

    /** A spherical shockwave: the animal answering a blow. */
    wave(position: Vector3, color: Color, toScale: number, life: number, fromScale = 0.2) {
      const wave = waves.find((candidate) => candidate.life < 0);
      if (!wave) return;
      wave.mesh.position.copy(position);
      wave.mesh.visible = true;
      wave.color.copy(color);
      wave.age = 0;
      wave.life = life;
      wave.fromScale = fromScale * toScale;
      wave.toScale = toScale;
    },

    update(dt: number, camera: Camera) {
      void camera;
      let count = 0;
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life) {
          particles.splice(i, 1);
          continue;
        }
        p.velocity.addScaledVector(p.accel, dt);
        p.velocity.multiplyScalar(Math.max(0, 1 - p.drag * dt));
        p.position.addScaledVector(p.velocity, dt);
      }
      for (const p of particles) {
        const t = p.age / p.life;
        let fade: number;
        if (p.shape === 1) fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
        else if (p.shape === -1) fade = Math.min(1, t * 4) * (1 - t);
        else fade = 1 - t;
        scratchScale.setScalar(p.size * (0.4 + 0.6 * Math.sqrt(Math.max(0, fade))));
        scratchMatrix.compose(p.position, ZERO_QUATERNION, scratchScale);
        mesh.setMatrixAt(count, scratchMatrix);
        mesh.setColorAt(count, scratchColor.copy(p.color).multiplyScalar(Math.max(0, fade)));
        count += 1;
      }
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      for (const ring of rings) {
        if (ring.life < 0) continue;
        ring.age += dt;
        const t = ring.age / ring.life;
        if (t >= 1) {
          ring.life = -1;
          ring.mesh.visible = false;
          continue;
        }
        const eased = 1 - (1 - t) ** 3;
        ring.mesh.scale.setScalar(ring.fromScale + (ring.toScale - ring.fromScale) * eased);
        (ring.mesh.material as MeshBasicMaterial).color.copy(ring.color).multiplyScalar((1 - t) ** 1.4);
      }

      for (const glint of glints) {
        if (glint.life < 0) continue;
        glint.age += dt;
        const t = glint.age / glint.life;
        if (t >= 1) {
          glint.life = -1;
          glint.group.visible = false;
          continue;
        }
        glint.group.scale.setScalar(glint.scale * (0.5 + t * 0.9));
        for (const material of glint.materials) material.color.copy(glint.color).multiplyScalar((1 - t) ** 1.5);
      }

      for (const wave of waves) {
        if (wave.life < 0) continue;
        wave.age += dt;
        const t = wave.age / wave.life;
        if (t >= 1) {
          wave.life = -1;
          wave.mesh.visible = false;
          continue;
        }
        const eased = 1 - (1 - t) ** 2.4;
        wave.mesh.scale.setScalar(wave.fromScale + (wave.toScale - wave.fromScale) * eased);
        (wave.mesh.material as MeshBasicMaterial).color.copy(wave.color).multiplyScalar((1 - t) ** 2 * 0.5);
      }
    },

    clear() {
      particles.length = 0;
      mesh.count = 0;
      for (const ring of rings) {
        ring.life = -1;
        ring.mesh.visible = false;
      }
      for (const glint of glints) {
        glint.life = -1;
        glint.group.visible = false;
      }
      for (const wave of waves) {
        wave.life = -1;
        wave.mesh.visible = false;
      }
    },

    dispose() {
      scene.remove(root);
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
      ringGeometry.dispose();
      bladeGeometry.dispose();
      waveGeometry.dispose();
    },
  };
}

export type Effects = ReturnType<typeof createEffects>;

function randomUnit() {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return new Vector3(r * Math.cos(angle), r * Math.sin(angle), z);
}

void scratchQuaternion;
