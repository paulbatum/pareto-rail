import {
  BufferGeometry,
  Camera,
  Color,
  DoubleSide,
  Float32BufferAttribute,
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

// Everything a hit throws off is electrical, and this is a vacuum barrel — no
// gravity on particles. Splinter sparks align to their travel, shockwave rings
// expand thin, glints cross-flash, and jagged arc-lightning polylines snap
// between two points and flicker as they die.

const SPARK_CAPACITY = 700;
const RING_CAPACITY = 28;
const GLINT_CAPACITY = 10;
const ARC_CAPACITY = 14;
const ARC_POINTS = 9;

type Spark = {
  position: Vector3;
  velocity: Vector3;
  color: Color;
  size: number;
  age: number;
  life: number;
};

type RingFx = { mesh: Mesh; color: Color; age: number; life: number; toScale: number };
type GlintFx = { group: Group; materials: MeshBasicMaterial[]; color: Color; age: number; life: number; scale: number };
type ArcFx = {
  lines: LineSegments;
  material: LineBasicMaterial;
  from: Vector3;
  to: Vector3;
  color: Color;
  age: number;
  life: number;
};

const sparks: Spark[] = [];
const rings: RingFx[] = [];
const glints: GlintFx[] = [];
const arcs: ArcFx[] = [];
let sparkMesh: InstancedMesh | null = null;

const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const UP = new Vector3(0, 1, 0);

export function createEffects(scene: Scene) {
  sparkMesh = new InstancedMesh(
    new TetrahedronGeometry(0.12, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SPARK_CAPACITY,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  const ringGeometry = new RingGeometry(0.96, 1, 48);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, toScale: 1 });
  }

  const bladeGeometry = new PlaneGeometry(1.7, 0.05);
  for (let i = 0; i < GLINT_CAPACITY; i += 1) {
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
    scene.add(group);
    glints.push({ group, materials, color: new Color(), age: 0, life: -1, scale: 1 });
  }

  for (let i = 0; i < ARC_CAPACITY; i += 1) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array((ARC_POINTS - 1) * 2 * 3), 3));
    const material = new LineBasicMaterial(additiveMaterialParameters({ color: 0x000000 }));
    const lines = new LineSegments(geometry, material);
    lines.visible = false;
    lines.frustumCulled = false;
    scene.add(lines);
    arcs.push({ lines, material, from: new Vector3(), to: new Vector3(), color: new Color(), age: 0, life: -1 });
  }
}

export function burstSparks(position: Vector3, color: Color, count: number, speed: number, life = 0.3) {
  for (let i = 0; i < count; i += 1) {
    if (sparks.length >= SPARK_CAPACITY) sparks.shift();
    const direction = randomUnit();
    sparks.push({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.5 + Math.random() * 0.9)),
      color: color.clone(),
      size: 0.4 + Math.random() * 0.5,
      age: 0,
      life: life * (0.7 + Math.random() * 0.6),
    });
  }
}

export function dropTrail(position: Vector3, color: Color) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push({
    position: position.clone(),
    velocity: randomUnit().multiplyScalar(0.7),
    color: color.clone(),
    size: 0.5,
    age: 0,
    life: 0.26,
  });
}

export function spawnRing(position: Vector3, color: Color, toScale: number, life: number) {
  const ring = rings.find((r) => r.life < 0);
  if (!ring) return;
  ring.mesh.position.copy(position);
  ring.mesh.scale.setScalar(0.01);
  ring.mesh.visible = true;
  ring.color.copy(color);
  ring.age = 0;
  ring.life = life;
  ring.toScale = toScale;
}

export function spawnGlint(position: Vector3, color: Color, scale = 1, life = 0.16) {
  const glint = glints.find((g) => g.life < 0);
  if (!glint) return;
  glint.group.position.copy(position);
  glint.group.scale.setScalar(0.01);
  glint.group.visible = true;
  glint.color.copy(color);
  glint.age = 0;
  glint.life = life;
  glint.scale = scale;
}

/** A jagged arc-lightning polyline that snaps between two points and flickers as it dies. */
export function spawnArcLightning(from: Vector3, to: Vector3, color: Color, life = 0.22) {
  const arc = arcs.find((a) => a.life < 0);
  if (!arc) return;
  arc.from.copy(from);
  arc.to.copy(to);
  arc.color.copy(color);
  arc.age = 0;
  arc.life = life;
  arc.lines.visible = true;
  rebuildArc(arc);
}

function rebuildArc(arc: ArcFx) {
  const attribute = arc.lines.geometry.getAttribute('position') as Float32BufferAttribute;
  const span = arc.to.clone().sub(arc.from);
  const jitter = Math.min(1.4, span.length() * 0.18);
  let previous = arc.from.clone();
  for (let i = 1; i < ARC_POINTS; i += 1) {
    const t = i / (ARC_POINTS - 1);
    const point = arc.from.clone().addScaledVector(span, t);
    if (i < ARC_POINTS - 1) point.add(randomUnit().multiplyScalar(jitter * Math.random()));
    const base = (i - 1) * 6;
    attribute.array[base] = previous.x;
    attribute.array[base + 1] = previous.y;
    attribute.array[base + 2] = previous.z;
    attribute.array[base + 3] = point.x;
    attribute.array[base + 4] = point.y;
    attribute.array[base + 5] = point.z;
    previous = point;
  }
  attribute.needsUpdate = true;
}

export function updateEffects(dt: number, camera: Camera) {
  if (sparkMesh) {
    let count = 0;
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const spark = sparks[i];
      spark.age += dt;
      if (spark.age >= spark.life) {
        sparks.splice(i, 1);
        continue;
      }
      // Straight flight, no gravity, aligned to travel; wink out fast.
      spark.position.addScaledVector(spark.velocity, dt);
      const fade = 1 - spark.age / spark.life;
      const direction = spark.velocity.lengthSq() > 0.001 ? spark.velocity.clone().normalize() : UP;
      scratchQuaternion.setFromUnitVectors(UP, direction);
      scratchScale.set(spark.size * 0.28, spark.size * (0.6 + fade), spark.size * 0.28);
      scratchMatrix.compose(spark.position, scratchQuaternion, scratchScale);
      sparkMesh.setMatrixAt(count, scratchMatrix);
      scratchColor.copy(spark.color).multiplyScalar(fade * fade);
      sparkMesh.setColorAt(count, scratchColor);
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
    const eased = 1 - (1 - progress) * (1 - progress);
    ring.mesh.scale.setScalar(Math.max(0.01, ring.toScale * (0.12 + 0.88 * eased)));
    ring.mesh.quaternion.copy(camera.quaternion);
    (ring.mesh.material as MeshBasicMaterial).color.copy(ring.color).multiplyScalar((1 - progress) ** 1.5);
  }

  for (const glint of glints) {
    if (glint.life < 0) continue;
    glint.age += dt;
    if (glint.age >= glint.life) {
      glint.life = -1;
      glint.group.visible = false;
      continue;
    }
    const envelope = Math.sin(Math.min(1, (glint.age / glint.life) * 1.15) * Math.PI);
    glint.group.scale.setScalar(Math.max(0.01, glint.scale * envelope));
    glint.group.quaternion.copy(camera.quaternion);
    glint.group.rotation.z += dt * 3;
    for (const material of glint.materials) material.color.copy(glint.color).multiplyScalar(envelope);
  }

  for (const arc of arcs) {
    if (arc.life < 0) continue;
    arc.age += dt;
    if (arc.age >= arc.life) {
      arc.life = -1;
      arc.lines.visible = false;
      continue;
    }
    // Re-snap the polyline while alive: the flicker IS the lightning.
    if (Math.random() < 0.55) rebuildArc(arc);
    const fade = (1 - arc.age / arc.life) * (Math.random() < 0.25 ? 0.4 : 1);
    arc.material.color.copy(arc.color).multiplyScalar(fade);
  }
}

export function resetEffects() {
  sparks.length = 0;
  if (sparkMesh) sparkMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
  for (const arc of arcs) {
    arc.life = -1;
    arc.lines.visible = false;
  }
}

function randomUnit(): Vector3 {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
