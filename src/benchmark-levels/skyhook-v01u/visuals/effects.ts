import {
  AdditiveBlending,
  Camera,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  TetrahedronGeometry,
  Vector3,
} from 'three';

const SPARK_CAPACITY = 520;
const RING_CAPACITY = 32;
const GLINT_CAPACITY = 18;

type Spark = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  rotation: Quaternion;
  color: Color;
  size: number;
  age: number;
  life: number;
  drag: number;
};

type Ring = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  fromScale: number;
  toScale: number;
};

type Glint = {
  group: Group;
  materials: MeshBasicMaterial[];
  color: Color;
  age: number;
  life: number;
  scale: number;
};

const sparks: Spark[] = [];
const rings: Ring[] = [];
const glints: Glint[] = [];
let sparkMesh: InstancedMesh | null = null;
let ringGeometry: RingGeometry | null = null;
let glintGeometry: PlaneGeometry | null = null;

const scratchMatrix = new Matrix4();
const scratchScale = new Vector3();
const scratchRotation = new Quaternion();

export function createEffects(scene: Scene) {
  disposeEffects();
  const sparkMaterial = new MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
  sparkMesh = new InstancedMesh(new TetrahedronGeometry(0.12, 0), sparkMaterial, SPARK_CAPACITY);
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  sparkMesh.userData.raildRole = 'effect';
  scene.add(sparkMesh);

  ringGeometry = new RingGeometry(0.96, 1.0, 48);
  for (let index = 0; index < RING_CAPACITY; index += 1) {
    const material = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const mesh = new Mesh(ringGeometry, material);
    mesh.visible = false;
    mesh.userData.raildRole = 'effect';
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  glintGeometry = new PlaneGeometry(1.8, 0.05);
  for (let index = 0; index < GLINT_CAPACITY; index += 1) {
    const group = new Group();
    group.userData.raildRole = 'effect';
    const materials: MeshBasicMaterial[] = [];
    for (const rotation of [0, Math.PI / 2]) {
      const material = new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });
      const blade = new Mesh(glintGeometry, material);
      blade.rotation.z = rotation;
      group.add(blade);
      materials.push(material);
    }
    group.visible = false;
    scene.add(group);
    glints.push({ group, materials, color: new Color(), age: 0, life: -1, scale: 1 });
  }
}

export function resetEffects() {
  sparks.length = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
  if (sparkMesh) sparkMesh.count = 0;
}

export function disposeEffects() {
  if (sparkMesh) {
    sparkMesh.removeFromParent();
    sparkMesh.geometry.dispose();
    (sparkMesh.material as MeshBasicMaterial).dispose();
  }
  sparkMesh = null;
  for (const ring of rings) {
    ring.mesh.removeFromParent();
    (ring.mesh.material as MeshBasicMaterial).dispose();
    ring.mesh.visible = false;
  }
  rings.length = 0;
  for (const glint of glints) {
    glint.group.removeFromParent();
    for (const material of glint.materials) material.dispose();
    glint.group.visible = false;
  }
  glints.length = 0;
  ringGeometry?.dispose();
  glintGeometry?.dispose();
  ringGeometry = null;
  glintGeometry = null;
}

export function spawnRing(position: Vector3, color: Color, scale: number, life = 0.38) {
  const ring = rings.find((candidate) => candidate.life < 0);
  if (!ring) return;
  ring.mesh.position.copy(position);
  ring.mesh.scale.setScalar(0.01);
  ring.mesh.visible = true;
  ring.color.copy(color);
  ring.age = 0;
  ring.life = life;
  ring.fromScale = Math.max(0.04, scale * 0.1);
  ring.toScale = scale;
}

export function spawnGlint(position: Vector3, color: Color, scale = 1, life = 0.18) {
  const glint = glints.find((candidate) => candidate.life < 0);
  if (!glint) return;
  glint.group.position.copy(position);
  glint.group.scale.setScalar(0.01);
  glint.group.visible = true;
  glint.color.copy(color);
  glint.age = 0;
  glint.life = life;
  glint.scale = scale;
}

export function burstSparks(position: Vector3, color: Color, count: number, speed: number) {
  for (let index = 0; index < count; index += 1) {
    if (sparks.length >= SPARK_CAPACITY) sparks.shift();
    const direction = randomDirection();
    sparks.push({
      position: position.clone(),
      velocity: direction.clone().multiplyScalar(speed * (0.45 + Math.random() * 0.9)),
      axis: direction,
      rotation: new Quaternion(),
      color: color.clone(),
      size: 0.16 + Math.random() * 0.16,
      age: 0,
      life: 0.24 + Math.random() * 0.34,
      drag: 2.2,
    });
  }
}

export function dropTrail(position: Vector3, color: Color) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  const direction = randomDirection();
  sparks.push({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 1.1, (Math.random() - 0.5) * 1.1, (Math.random() - 0.5) * 1.1),
    axis: direction,
    rotation: new Quaternion(),
    color: color.clone(),
    size: 0.08,
    age: 0,
    life: 0.2,
    drag: 1.5,
  });
}

export function burstHardware(position: Vector3, color: Color, size = 1) {
  burstSparks(position, color, Math.round(12 * size), 5.8 * size);
  spawnRing(position, color, 2.8 * size, 0.34 + size * 0.08);
  spawnGlint(position, color, 1.0 * size, 0.16 + size * 0.04);
}

export function updateEffects(dt: number, camera: Camera) {
  if (sparkMesh) {
    let count = 0;
    for (let index = sparks.length - 1; index >= 0; index -= 1) {
      const spark = sparks[index];
      spark.age += dt;
      if (spark.age >= spark.life) {
        sparks.splice(index, 1);
        continue;
      }
      spark.velocity.multiplyScalar(Math.max(0, 1 - spark.drag * dt));
      spark.position.addScaledVector(spark.velocity, dt);
      scratchRotation.setFromAxisAngle(spark.axis, dt * 8.5);
      spark.rotation.premultiply(scratchRotation).normalize();
      const fade = 1 - spark.age / spark.life;
      scratchScale.setScalar(spark.size * (0.45 + fade * 0.8));
      scratchMatrix.compose(spark.position, spark.rotation, scratchScale);
      sparkMesh.setMatrixAt(count, scratchMatrix);
      sparkMesh.setColorAt(count, spark.color.clone().multiplyScalar(0.4 + fade * 1.4));
      count += 1;
    }
    sparkMesh.count = count;
    sparkMesh.instanceMatrix.needsUpdate = true;
    if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;
  }

  for (const ring of rings) {
    if (ring.life < 0) continue;
    ring.age += dt;
    if (ring.age >= ring.life) {
      ring.life = -1;
      ring.mesh.visible = false;
      continue;
    }
    const progress = ring.age / ring.life;
    const eased = 1 - (1 - progress) ** 2;
    const fade = Math.sin(Math.PI * progress);
    ring.mesh.scale.setScalar(lerp(ring.fromScale, ring.toScale, eased));
    ring.mesh.quaternion.copy(camera.quaternion);
    const material = ring.mesh.material as MeshBasicMaterial;
    material.color.copy(ring.color).multiplyScalar(0.32 + fade * 1.25);
    material.opacity = fade;
  }

  for (const glint of glints) {
    if (glint.life < 0) continue;
    glint.age += dt;
    if (glint.age >= glint.life) {
      glint.life = -1;
      glint.group.visible = false;
      continue;
    }
    const progress = glint.age / glint.life;
    const fade = Math.sin(Math.PI * progress);
    glint.group.quaternion.copy(camera.quaternion);
    glint.group.scale.setScalar(glint.scale * (0.4 + fade * 0.9));
    for (const material of glint.materials) {
      material.color.copy(glint.color).multiplyScalar(0.45 + fade * 1.5);
      material.opacity = fade;
    }
  }
}

function randomDirection() {
  return new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
}

function lerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}
