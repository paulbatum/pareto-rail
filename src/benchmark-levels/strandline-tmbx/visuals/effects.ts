import {
  CircleGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { UniformNode } from 'three/webgpu';
import { float, smoothstep, uniform, uv } from 'three/tsl';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';

type FloatUniform = UniformNode<'float', number>;
type ColorUniform = UniformNode<'color', Color>;

// Leaf: pooled transient effects. One instanced mesh carries every particle
// (bursts, bubbles, trails) and small fixed pools carry rings and glints, so
// the scene's object count never grows with the fight.

export type BurstOptions = {
  count: number;
  speed: number;
  from: Color;
  to: Color;
  size: number;
  life: number;
  buoyancy?: number;
  drag?: number;
  spread?: Vector3;
  direction?: Vector3;
  cone?: number;
};

const PARTICLE_CAPACITY = 900;
const RING_POOL = 28;
const GLINT_POOL = 18;

type Particle = {
  active: boolean;
  position: Vector3;
  velocity: Vector3;
  age: number;
  life: number;
  size: number;
  from: Color;
  to: Color;
  buoyancy: number;
  drag: number;
  wobble: number;
};

type Ring = {
  mesh: Mesh;
  material: MeshBasicMaterial;
  active: boolean;
  age: number;
  life: number;
  radius: number;
  color: Color;
};

type Glint = {
  mesh: Mesh;
  strength: FloatUniform;
  tint: ColorUniform;
  active: boolean;
  age: number;
  life: number;
  size: number;
};

export type Effects = ReturnType<typeof createEffects>;

export function createEffects(scene: Scene) {
  const particleMesh = new InstancedMesh(
    new IcosahedronGeometry(1, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    PARTICLE_CAPACITY,
  );
  particleMesh.instanceMatrix.setUsage(DynamicDrawUsage);
  particleMesh.frustumCulled = false;
  particleMesh.userData.raildIgnoreOcclusion = true;
  const hidden = new Matrix4().makeScale(0, 0, 0);
  const white = new Color(1, 1, 1);
  for (let i = 0; i < PARTICLE_CAPACITY; i += 1) {
    particleMesh.setMatrixAt(i, hidden);
    particleMesh.setColorAt(i, white);
  }
  scene.add(particleMesh);

  const particles: Particle[] = Array.from({ length: PARTICLE_CAPACITY }, () => ({
    active: false,
    position: new Vector3(),
    velocity: new Vector3(),
    age: 0,
    life: 1,
    size: 0.1,
    from: new Color(),
    to: new Color(),
    buoyancy: 0,
    drag: 1,
    wobble: 0,
  }));
  let cursor = 0;

  const ringGeometry = new RingGeometry(0.93, 1, 64);
  const rings: Ring[] = Array.from({ length: RING_POOL }, () => {
    const material = createAdditiveBasicMaterial({ color: 0xffffff, side: DoubleSide });
    const mesh = new Mesh(ringGeometry, material);
    mesh.visible = false;
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
    return { mesh, material, active: false, age: 0, life: 1, radius: 1, color: new Color() };
  });

  const glintGeometry = new CircleGeometry(1, 24);
  const glints: Glint[] = Array.from({ length: GLINT_POOL }, () => {
    const strength = uniform(0);
    const tint = uniform(new Color(1, 1, 1));
    const material = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: DoubleSide, fog: false }));
    const radial = uv().sub(0.5).length().mul(2);
    material.colorNode = tint.mul(smoothstep(float(1), float(0), radial).pow(2.2)).mul(strength);
    const mesh = new Mesh(glintGeometry, material);
    mesh.visible = false;
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
    return { mesh, strength, tint, active: false, age: 0, life: 1, size: 1 };
  });

  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const color = new Color();
  const random = () => Math.random() * 2 - 1;

  function burst(position: Vector3, options: BurstOptions) {
    for (let n = 0; n < options.count; n += 1) {
      const particle = particles[cursor];
      cursor = (cursor + 1) % PARTICLE_CAPACITY;
      particle.active = true;
      particle.position.copy(position);
      if (options.spread) particle.position.add(new Vector3(random() * options.spread.x, random() * options.spread.y, random() * options.spread.z));
      const direction = new Vector3(random(), random(), random()).normalize();
      if (options.direction) direction.lerp(options.direction, 1 - (options.cone ?? 0.5)).normalize();
      particle.velocity.copy(direction).multiplyScalar(options.speed * (0.35 + Math.random() * 0.65));
      particle.age = 0;
      particle.life = options.life * (0.6 + Math.random() * 0.5);
      particle.size = options.size * (0.5 + Math.random() * 0.7);
      particle.from.copy(options.from);
      particle.to.copy(options.to);
      particle.buoyancy = options.buoyancy ?? 0;
      particle.drag = options.drag ?? 2.2;
      particle.wobble = Math.random() * 10;
    }
  }

  function ring(position: Vector3, tint: Color, radius: number, life: number) {
    const item = rings.find((candidate) => !candidate.active) ?? rings[0];
    item.active = true;
    item.age = 0;
    item.life = life;
    item.radius = radius;
    item.color.copy(tint);
    item.mesh.position.copy(position);
    item.mesh.visible = true;
  }

  function glint(position: Vector3, tint: Color, size: number, life: number) {
    const item = glints.find((candidate) => !candidate.active) ?? glints[0];
    item.active = true;
    item.age = 0;
    item.life = life;
    item.size = size;
    item.tint.value.copy(tint);
    item.mesh.position.copy(position);
    item.mesh.visible = true;
  }

  function update(dt: number, camera: Camera) {
    let touched = false;
    for (let i = 0; i < PARTICLE_CAPACITY; i += 1) {
      const particle = particles[i];
      if (!particle.active) continue;
      touched = true;
      particle.age += dt;
      if (particle.age >= particle.life) {
        particle.active = false;
        particleMesh.setMatrixAt(i, hidden);
        continue;
      }
      const k = particle.age / particle.life;
      particle.velocity.multiplyScalar(Math.exp(-particle.drag * dt));
      particle.velocity.y += particle.buoyancy * dt;
      if (particle.buoyancy > 0) particle.velocity.x += Math.sin(particle.age * 7 + particle.wobble) * dt * 0.8;
      particle.position.addScaledVector(particle.velocity, dt);
      const size = particle.size * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85 * 0.8);
      scale.setScalar(Math.max(0.0001, size));
      matrix.compose(particle.position, quaternion, scale);
      particleMesh.setMatrixAt(i, matrix);
      color.copy(particle.from).lerp(particle.to, Math.min(1, k * 1.4)).multiplyScalar(1 - k * k);
      particleMesh.setColorAt(i, color);
    }
    if (touched) {
      particleMesh.instanceMatrix.needsUpdate = true;
      if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
    }

    for (const item of rings) {
      if (!item.active) continue;
      item.age += dt;
      const k = item.age / item.life;
      if (k >= 1) {
        item.active = false;
        item.mesh.visible = false;
        continue;
      }
      const eased = 1 - (1 - k) ** 3;
      item.mesh.scale.setScalar(Math.max(0.01, item.radius * (0.2 + eased * 0.8)));
      item.mesh.quaternion.copy(camera.quaternion);
      item.material.color.copy(item.color).multiplyScalar((1 - k) ** 1.5);
    }

    for (const item of glints) {
      if (!item.active) continue;
      item.age += dt;
      const k = item.age / item.life;
      if (k >= 1) {
        item.active = false;
        item.mesh.visible = false;
        continue;
      }
      item.mesh.quaternion.copy(camera.quaternion);
      item.mesh.scale.setScalar(item.size * (0.6 + 0.4 * Math.sin(Math.min(1, k * 2) * Math.PI * 0.5)));
      item.strength.value = (1 - k) ** 2;
    }
  }

  function clear() {
    for (let i = 0; i < PARTICLE_CAPACITY; i += 1) {
      particles[i].active = false;
      particleMesh.setMatrixAt(i, hidden);
    }
    particleMesh.instanceMatrix.needsUpdate = true;
    for (const item of rings) {
      item.active = false;
      item.mesh.visible = false;
    }
    for (const item of glints) {
      item.active = false;
      item.mesh.visible = false;
    }
  }

  return { burst, ring, glint, update, clear };
}
