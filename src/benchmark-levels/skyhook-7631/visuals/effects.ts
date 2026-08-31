import {
  AdditiveBlending,
  Camera,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';

const PARTICLE_CAPACITY = 420;
const RING_CAPACITY = 28;

type Particle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  rotation: Quaternion;
  color: Color;
  size: number;
  spin: number;
  age: number;
  life: number;
  drag: number;
};

type Ring = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  from: number;
  to: number;
};

const particles: Particle[] = [];
const rings: Ring[] = [];
let particleMesh: InstancedMesh | null = null;
const matrix = new Matrix4();
const scale = new Vector3();

export function createEffects(scene: Scene) {
  particles.length = 0;
  rings.length = 0;
  particleMesh = null;
  particleMesh = new InstancedMesh(
    new OctahedronGeometry(0.5, 0),
    new MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
    PARTICLE_CAPACITY,
  );
  particleMesh.count = 0;
  particleMesh.frustumCulled = false;
  scene.add(particleMesh);

  const geometry = new RingGeometry(0.955, 1, 48);
  for (let index = 0; index < RING_CAPACITY; index += 1) {
    const mesh = new Mesh(geometry, new MeshBasicMaterial({
      color: 0x000000,
      side: DoubleSide,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    }));
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, from: 0, to: 1 });
  }
}

export function resetEffects() {
  particles.length = 0;
  if (particleMesh) particleMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
}

export function spawnBurst(
  position: Vector3,
  color: Color,
  count: number,
  speed = 8,
  life = 0.8,
  bias?: Vector3,
) {
  for (let index = 0; index < count; index += 1) {
    if (particles.length >= PARTICLE_CAPACITY) particles.shift();
    const direction = randomUnit();
    const axis = randomUnit();
    const velocity = direction.multiplyScalar(speed * (0.42 + Math.random() * 0.74));
    if (bias) velocity.add(bias);
    particles.push({
      position: position.clone(),
      velocity,
      axis,
      rotation: new Quaternion(),
      color: color.clone(),
      size: 0.08 + Math.random() * 0.22,
      spin: (Math.random() - 0.5) * 13,
      age: 0,
      life: life * (0.68 + Math.random() * 0.56),
      drag: 1.5 + Math.random() * 1.5,
    });
  }
}

export function spawnRing(position: Vector3, color: Color, to: number, life = 0.42, from = 0.25) {
  const ring = rings.find((candidate) => candidate.life < 0) ?? rings.reduce((oldest, candidate) =>
    candidate.age / Math.max(0.001, candidate.life) > oldest.age / Math.max(0.001, oldest.life) ? candidate : oldest,
  );
  ring.mesh.visible = true;
  ring.mesh.position.copy(position);
  ring.color.copy(color);
  ring.age = 0;
  ring.life = life;
  ring.from = from;
  ring.to = to;
}

export function updateEffects(dt: number, camera: Camera) {
  for (let index = particles.length - 1; index >= 0; index -= 1) {
    const particle = particles[index];
    particle.age += dt;
    if (particle.age >= particle.life) {
      particles.splice(index, 1);
      continue;
    }
    particle.position.addScaledVector(particle.velocity, dt);
    particle.velocity.multiplyScalar(Math.exp(-particle.drag * dt));
    particle.rotation.premultiply(new Quaternion().setFromAxisAngle(particle.axis, particle.spin * dt));
  }

  if (particleMesh) {
    particleMesh.count = Math.min(PARTICLE_CAPACITY, particles.length);
    for (let index = 0; index < particleMesh.count; index += 1) {
      const particle = particles[index];
      const t = particle.age / particle.life;
      const size = particle.size * (1 - t) * (1 + t * 2.2);
      scale.set(size, size * 0.48, size * 3.2);
      matrix.compose(particle.position, particle.rotation, scale);
      particleMesh.setMatrixAt(index, matrix);
      particleMesh.setColorAt(index, particle.color.clone().multiplyScalar(0.55 + (1 - t) * 0.8));
    }
    particleMesh.instanceMatrix.needsUpdate = true;
    if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;
  }

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
    ring.mesh.quaternion.copy(camera.quaternion);
    ring.mesh.scale.setScalar(ring.from + (ring.to - ring.from) * eased);
    const material = ring.mesh.material as MeshBasicMaterial;
    material.color.copy(ring.color).multiplyScalar(0.65 + (1 - t) * 0.65);
    material.opacity = (1 - t) ** 1.5 * 0.82;
  }
}

function randomUnit() {
  const vector = new Vector3(
    Math.random() * 2 - 1,
    Math.random() * 2 - 1,
    Math.random() * 2 - 1,
  );
  if (vector.lengthSq() < 0.0001) vector.set(1, 0, 0);
  return vector.normalize();
}
