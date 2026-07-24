import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
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
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';

// Construction and bookkeeping only; the spine picks every colour, count and
// lifetime. The particle language is electric rather than fiery: sparks fly in
// straight lines with heavy drag and no gravity, shockwaves are thin rings, and
// the signature element is a jagged arc — the barrel's own discharge, reused for
// the lock grip, the impact crackle and the interlock rupture.

const SPARK_CAPACITY = 900;
const SHOCK_CAPACITY = 22;
const ARC_CAPACITY = 20;
const GLINT_CAPACITY = 12;
const ARC_SEGMENTS = 9;

export type SparkSpec = { direction: Vector3; color: Color; size: number };

type Spark = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  rotation: Quaternion;
  spin: number;
  color: Color;
  size: number;
  age: number;
  life: number;
  drag: number;
};

type Shock = { mesh: Mesh; color: Color; age: number; life: number; from: number; to: number };
type Glint = { group: Group; materials: MeshBasicMaterial[]; color: Color; age: number; life: number; scale: number };
type Arc = {
  line: LineSegments;
  material: LineBasicMaterial;
  from: Vector3;
  to: Vector3;
  right: Vector3;
  up: Vector3;
  amplitude: number;
  seed: number;
  color: Color;
  age: number;
  life: number;
};

const sparks: Spark[] = [];
const shocks: Shock[] = [];
const glints: Glint[] = [];
const arcs: Arc[] = [];

let sparkMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const scratchPoint = new Vector3();
const scratchAxis = new Vector3();

export function createEffects(scene: Scene) {
  if (sparkMesh) {
    // The level was rebuilt (a new scene): move the existing pools across rather
    // than allocating a second set.
    resetEffects();
    scene.add(sparkMesh);
    for (const shock of shocks) scene.add(shock.mesh);
    for (const glint of glints) scene.add(glint.group);
    for (const arc of arcs) scene.add(arc.line);
    return;
  }

  const sparkGeometry = new TetrahedronGeometry(0.11, 0);
  sparkGeometry.scale(0.6, 0.6, 2.4);
  sparkMesh = new InstancedMesh(sparkGeometry, createAdditiveBasicMaterial({ color: 0xffffff }), SPARK_CAPACITY);
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  const shockGeometry = new RingGeometry(0.94, 1, 64);
  for (let index = 0; index < SHOCK_CAPACITY; index += 1) {
    const mesh = new Mesh(shockGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    shocks.push({ mesh, color: new Color(), age: 0, life: -1, from: 0, to: 1 });
  }

  const bladeGeometry = new PlaneGeometry(1.9, 0.045);
  for (let index = 0; index < GLINT_CAPACITY; index += 1) {
    const group = new Group();
    const materials: MeshBasicMaterial[] = [];
    for (const rotation of [0, Math.PI / 2]) {
      const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
      const blade = new Mesh(bladeGeometry, material);
      blade.rotation.z = rotation;
      group.add(blade);
      materials.push(material);
    }
    group.visible = false;
    group.frustumCulled = false;
    scene.add(group);
    glints.push({ group, materials, color: new Color(), age: 0, life: -1, scale: 1 });
  }

  for (let index = 0; index < ARC_CAPACITY; index += 1) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(ARC_SEGMENTS * 6), 3));
    const material = new LineBasicMaterial(additiveMaterialParameters({ color: 0x000000 }));
    const line = new LineSegments(geometry, material);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    arcs.push({
      line,
      material,
      from: new Vector3(),
      to: new Vector3(),
      right: new Vector3(),
      up: new Vector3(),
      amplitude: 0.3,
      seed: index * 7.31,
      color: new Color(),
      age: 0,
      life: -1,
    });
  }
}

function pushSpark(spark: Spark) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(spark);
}

/** Straight-line spark burst: no gravity, hard drag. Vacuum, not a bonfire. */
export function burstSparks(position: Vector3, color: Color, count: number, speed: number, life = 0.34) {
  for (let index = 0; index < count; index += 1) {
    const direction = randomUnit();
    pushSpark({
      position: position.clone(),
      velocity: direction.clone().multiplyScalar(speed * (0.45 + Math.random() * 1.1)),
      axis: randomUnit(),
      rotation: new Quaternion(),
      spin: 10 + Math.random() * 22,
      color: color.clone(),
      size: 0.5 + Math.random() * 0.7,
      age: 0,
      life: life * (0.7 + Math.random() * 0.6),
      drag: 3.2,
    });
  }
}

/** The target comes apart into its own plating, each piece thrown along its mount. */
export function burstDebris(position: Vector3, specs: readonly SparkSpec[], speed = 13) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushSpark({
      position: position.clone().addScaledVector(outward, 0.4),
      velocity: outward.multiplyScalar(speed * (0.6 + Math.random() * 0.8)),
      axis: randomUnit(),
      rotation: new Quaternion(),
      spin: 5 + Math.random() * 12,
      color: spec.color.clone(),
      size: 1.4 + spec.size * 3.2,
      age: 0,
      life: 0.5 + Math.random() * 0.4,
      drag: 2.4,
    });
  }
}

export function dropTrail(position: Vector3, color: Color) {
  pushSpark({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.4),
    axis: randomUnit(),
    rotation: new Quaternion(),
    spin: 4,
    color: color.clone(),
    size: 0.62,
    age: 0,
    life: 0.2,
    drag: 1.2,
  });
}

export function spawnShock(position: Vector3, color: Color, toScale: number, life: number) {
  const shock = shocks.find((candidate) => candidate.life < 0);
  if (!shock) return;
  shock.mesh.position.copy(position);
  shock.mesh.scale.setScalar(0.01);
  (shock.mesh.material as MeshBasicMaterial).color.set(0, 0, 0);
  shock.mesh.visible = true;
  shock.color.copy(color);
  shock.age = 0;
  shock.life = life;
  shock.from = toScale * 0.1;
  shock.to = toScale;
}

export function spawnGlint(position: Vector3, color: Color, scale = 1, life = 0.16) {
  const glint = glints.find((candidate) => candidate.life < 0);
  if (!glint) return;
  glint.group.position.copy(position);
  glint.group.scale.setScalar(0.01);
  for (const material of glint.materials) material.color.set(0, 0, 0);
  glint.group.visible = true;
  glint.color.copy(color);
  glint.age = 0;
  glint.life = life;
  glint.scale = scale;
}

/** A jagged discharge between two points; re-jittered every frame so it crackles. */
export function spawnArc(from: Vector3, to: Vector3, color: Color, life: number, amplitude = 0.35) {
  const arc = arcs.find((candidate) => candidate.life < 0);
  if (!arc) return;
  arc.from.copy(from);
  arc.to.copy(to);
  scratchAxis.copy(to).sub(from);
  if (scratchAxis.lengthSq() < 0.0001) scratchAxis.set(0, 0, 1);
  scratchAxis.normalize();
  arc.right.set(-scratchAxis.y, scratchAxis.x, 0);
  if (arc.right.lengthSq() < 0.0001) arc.right.set(1, 0, 0);
  arc.right.normalize();
  arc.up.crossVectors(scratchAxis, arc.right).normalize();
  arc.amplitude = amplitude;
  arc.color.copy(color);
  arc.age = 0;
  arc.life = life;
  arc.line.visible = true;
}

export function updateEffects(dt: number, camera: Camera, elapsed: number) {
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
      scratchQuaternion.setFromAxisAngle(spark.axis, spark.spin * dt);
      spark.rotation.premultiply(scratchQuaternion).normalize();
      const fade = 1 - spark.age / spark.life;
      scratchScale.setScalar(spark.size * (0.3 + fade * 0.7));
      scratchMatrix.compose(spark.position, spark.rotation, scratchScale);
      sparkMesh.setMatrixAt(count, scratchMatrix);
      scratchColor.copy(spark.color).multiplyScalar(fade * fade);
      sparkMesh.setColorAt(count, scratchColor);
      count += 1;
    }
    sparkMesh.count = count;
    sparkMesh.instanceMatrix.needsUpdate = true;
    if (sparkMesh.instanceColor) sparkMesh.instanceColor.needsUpdate = true;
  }

  for (const shock of shocks) {
    if (shock.life < 0) continue;
    shock.age += dt;
    if (shock.age >= shock.life) {
      shock.life = -1;
      shock.mesh.visible = false;
      continue;
    }
    const progress = shock.age / shock.life;
    const eased = 1 - (1 - progress) ** 2.4;
    shock.mesh.scale.setScalar(shock.from + (shock.to - shock.from) * eased);
    shock.mesh.quaternion.copy(camera.quaternion);
    (shock.mesh.material as MeshBasicMaterial).color.copy(shock.color).multiplyScalar((1 - progress) ** 1.6);
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
    const envelope = Math.sin(Math.min(1, progress * 1.15) * Math.PI);
    glint.group.scale.setScalar(Math.max(0.01, glint.scale * envelope));
    glint.group.quaternion.copy(camera.quaternion);
    glint.group.rotation.z += dt * 5;
    for (const material of glint.materials) material.color.copy(glint.color).multiplyScalar(envelope);
  }

  for (const arc of arcs) {
    if (arc.life < 0) continue;
    arc.age += dt;
    if (arc.age >= arc.life) {
      arc.life = -1;
      arc.line.visible = false;
      continue;
    }
    const progress = arc.age / arc.life;
    const attribute = arc.line.geometry.getAttribute('position') as BufferAttribute;
    const array = attribute.array as Float32Array;
    for (let segment = 0; segment < ARC_SEGMENTS; segment += 1) {
      for (const end of [0, 1]) {
        const t = (segment + end) / ARC_SEGMENTS;
        scratchPoint.copy(arc.from).lerp(arc.to, t);
        const taper = Math.sin(t * Math.PI);
        const wobbleA = Math.sin(elapsed * 47 + arc.seed + t * 21) * arc.amplitude * taper;
        const wobbleB = Math.cos(elapsed * 39 + arc.seed * 1.7 + t * 26) * arc.amplitude * taper;
        scratchPoint.addScaledVector(arc.right, wobbleA).addScaledVector(arc.up, wobbleB);
        const slot = (segment * 2 + end) * 3;
        array[slot] = scratchPoint.x;
        array[slot + 1] = scratchPoint.y;
        array[slot + 2] = scratchPoint.z;
      }
    }
    attribute.needsUpdate = true;
    arc.material.color.copy(arc.color).multiplyScalar((1 - progress) ** 1.3);
  }
}

export function resetEffects() {
  sparks.length = 0;
  if (sparkMesh) sparkMesh.count = 0;
  for (const shock of shocks) {
    shock.life = -1;
    shock.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
  for (const arc of arcs) {
    arc.life = -1;
    arc.line.visible = false;
  }
}

function randomUnit() {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const planar = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * planar, Math.sin(angle) * planar, z);
}
