import {
  BufferGeometry,
  Camera,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { COBALT, CORE_WHITE, GOLD, hdr, mulberry32 } from './palette';

const PARTICLE_CAPACITY = 720;
const RING_CAPACITY = 32;
const GLINT_CAPACITY = 18;

type Particle = {
  position: Vector3;
  velocity: Vector3;
  color: Color;
  age: number;
  life: number;
  drag: number;
  gravity: number;
};

type RingEffect = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  from: number;
  to: number;
};

type GlintEffect = {
  group: Group;
  materials: MeshBasicMaterial[];
  color: Color;
  age: number;
  life: number;
  size: number;
};

export type VespersEffects = ReturnType<typeof createEffects>;

export function createEffects(scene: Scene) {
  const root = new Group();
  root.name = 'vespers-effects';
  root.userData.raildIgnoreOcclusion = true;

  const positionArray = new Float32Array(PARTICLE_CAPACITY * 3);
  const colorArray = new Float32Array(PARTICLE_CAPACITY * 3);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positionArray, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colorArray, 3));
  geometry.setDrawRange(0, 0);
  const points = new Points(
    geometry,
    new PointsMaterial(additiveMaterialParameters({
      color: 0xffffff,
      size: 0.34,
      sizeAttenuation: true,
      vertexColors: true,
      opacity: 0.92,
    })),
  );
  points.frustumCulled = false;
  root.add(points);

  const rings: RingEffect[] = [];
  const ringGeometry = new RingGeometry(0.94, 1, 52);
  for (let index = 0; index < RING_CAPACITY; index += 1) {
    const mesh = new Mesh(
      ringGeometry,
      createAdditiveBasicMaterial({ color: 0x000000, opacity: 0, side: DoubleSide }),
    );
    mesh.visible = false;
    root.add(mesh);
    rings.push({
      mesh,
      color: new Color(),
      age: 0,
      life: -1,
      from: 0,
      to: 1,
    });
  }

  const glints: GlintEffect[] = [];
  const bladeGeometry = new PlaneGeometry(1, 0.045);
  for (let index = 0; index < GLINT_CAPACITY; index += 1) {
    const group = new Group();
    const materials: MeshBasicMaterial[] = [];
    for (const angle of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
      const material = createAdditiveBasicMaterial({ color: 0x000000, opacity: 0, side: DoubleSide });
      const blade = new Mesh(bladeGeometry, material);
      blade.rotation.z = angle;
      group.add(blade);
      materials.push(material);
    }
    group.visible = false;
    root.add(group);
    glints.push({
      group,
      materials,
      color: new Color(),
      age: 0,
      life: -1,
      size: 1,
    });
  }

  scene.add(root);
  const particles: Particle[] = [];
  const rng = mulberry32(0x5e5a11);

  function pushParticle(particle: Particle) {
    if (particles.length >= PARTICLE_CAPACITY) particles.shift();
    particles.push(particle);
  }

  function burstGlass(position: Vector3, color: Color, count = 18, speed = 8) {
    for (let index = 0; index < count; index += 1) {
      const theta = rng() * Math.PI * 2;
      const z = rng() * 2 - 1;
      const planar = Math.sqrt(Math.max(0, 1 - z * z));
      const direction = new Vector3(
        Math.cos(theta) * planar,
        Math.sin(theta) * planar,
        z,
      );
      pushParticle({
        position: position.clone(),
        velocity: direction.multiplyScalar(speed * (0.38 + rng() * 0.82)),
        color: color.clone().multiplyScalar(0.6 + rng() * 0.8),
        age: 0,
        life: 0.55 + rng() * 0.75,
        drag: 1.3 + rng() * 1.5,
        gravity: 2.4 + rng() * 3.5,
      });
    }
  }

  function dropTrail(position: Vector3, color: Color) {
    pushParticle({
      position: position.clone(),
      velocity: new Vector3((rng() - 0.5) * 0.6, (rng() - 0.5) * 0.6, (rng() - 0.5) * 0.6),
      color: color.clone().multiplyScalar(0.8),
      age: 0,
      life: 0.22,
      drag: 2.8,
      gravity: 0,
    });
  }

  function spawnRing(position: Vector3, color: Color, size: number, life = 0.5, from = 0.12) {
    const ring = rings.find((candidate) => candidate.life < 0) ?? rings[0];
    ring.mesh.position.copy(position);
    ring.mesh.scale.setScalar(from * size);
    ring.mesh.visible = true;
    ring.color.copy(color);
    ring.age = 0;
    ring.life = life;
    ring.from = from * size;
    ring.to = size;
  }

  function spawnGlint(position: Vector3, color: Color, size: number, life = 0.22) {
    const glint = glints.find((candidate) => candidate.life < 0) ?? glints[0];
    glint.group.position.copy(position);
    glint.group.scale.setScalar(0.01);
    glint.group.visible = true;
    glint.color.copy(color);
    glint.age = 0;
    glint.life = life;
    glint.size = size;
  }

  function reset() {
    particles.length = 0;
    geometry.setDrawRange(0, 0);
    for (const ring of rings) {
      ring.life = -1;
      ring.mesh.visible = false;
    }
    for (const glint of glints) {
      glint.life = -1;
      glint.group.visible = false;
    }
  }

  function update(dt: number, camera: Camera) {
    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index];
      particle.age += dt;
      if (particle.age >= particle.life) {
        particles.splice(index, 1);
        continue;
      }
      particle.velocity.multiplyScalar(Math.exp(-particle.drag * dt));
      particle.velocity.y -= particle.gravity * dt;
      particle.position.addScaledVector(particle.velocity, dt);
    }

    for (let index = 0; index < particles.length; index += 1) {
      const particle = particles[index];
      const alpha = Math.max(0, 1 - particle.age / particle.life);
      positionArray[index * 3] = particle.position.x;
      positionArray[index * 3 + 1] = particle.position.y;
      positionArray[index * 3 + 2] = particle.position.z;
      colorArray[index * 3] = particle.color.r * alpha;
      colorArray[index * 3 + 1] = particle.color.g * alpha;
      colorArray[index * 3 + 2] = particle.color.b * alpha;
    }
    geometry.setDrawRange(0, particles.length);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;

    for (const ring of rings) {
      if (ring.life < 0) continue;
      ring.age += dt;
      if (ring.age >= ring.life) {
        ring.life = -1;
        ring.mesh.visible = false;
        continue;
      }
      const t = ring.age / ring.life;
      const eased = 1 - (1 - t) ** 3;
      ring.mesh.scale.setScalar(ring.from + (ring.to - ring.from) * eased);
      ring.mesh.quaternion.copy(camera.quaternion);
      (ring.mesh.material as MeshBasicMaterial).color.copy(ring.color).multiplyScalar(1 - t);
      (ring.mesh.material as MeshBasicMaterial).opacity = 1 - t;
    }

    for (const glint of glints) {
      if (glint.life < 0) continue;
      glint.age += dt;
      if (glint.age >= glint.life) {
        glint.life = -1;
        glint.group.visible = false;
        continue;
      }
      const t = glint.age / glint.life;
      glint.group.quaternion.copy(camera.quaternion);
      glint.group.scale.setScalar(glint.size * Math.sin(Math.PI * Math.min(1, t * 1.1)));
      for (const material of glint.materials) {
        material.color.copy(glint.color).multiplyScalar(1 - t);
        material.opacity = 1 - t;
      }
    }
  }

  function dispose() {
    root.removeFromParent();
    geometry.dispose();
    (points.material as PointsMaterial).dispose();
    ringGeometry.dispose();
    bladeGeometry.dispose();
    for (const ring of rings) (ring.mesh.material as MeshBasicMaterial).dispose();
    for (const glint of glints) for (const material of glint.materials) material.dispose();
  }

  return {
    root,
    burstGlass,
    dropTrail,
    spawnRing,
    spawnGlint,
    reset,
    update,
    dispose,
    flareRose(position: Vector3) {
      spawnRing(position, hdr(GOLD, 1.05), 13, 0.92, 0.08);
      spawnRing(position, hdr(COBALT, 0.72), 20, 1.18, 0.05);
      spawnGlint(position, hdr(CORE_WHITE, 1.45), 6, 0.48);
      burstGlass(position, CORE_WHITE, 72, 13);
    },
  };
}
