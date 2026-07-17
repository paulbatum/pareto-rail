import {
  BufferGeometry,
  Camera,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';

// Everything a hit throws off is electrical, and this is a vacuum barrel:
// no gravity on anything. Splinter sparks fly straight and align to their
// travel; shockwaves are thin expanding rings; player impacts are cold
// cross-glints; arc lightning is a jagged polyline snapped between two
// points, flickering as it dies; flash discs cover the muzzle whiteout and
// the detonation.

const SPARK_CAPACITY = 900;
const RING_CAPACITY = 30;
const GLINT_CAPACITY = 14;
const ARC_CAPACITY = 22;
const ARC_SEGMENTS = 9;
const DISC_CAPACITY = 6;

export type SparkSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

type Spark = {
  position: Vector3;
  velocity: Vector3;
  color: Color;
  size: number;
  age: number;
  life: number;
  drag: number;
};

type RingEffect = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  fromScale: number;
  toScale: number;
  billboard: boolean;
};

type GlintEffect = {
  group: Group;
  materials: MeshBasicMaterial[];
  color: Color;
  age: number;
  life: number;
  scale: number;
};

type ArcEffect = {
  line: Line;
  material: LineBasicMaterial;
  from: Vector3;
  to: Vector3;
  color: Color;
  age: number;
  life: number;
  jitter: number;
  rejitterAt: number;
};

type DiscEffect = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  scale: number;
};

const sparks: Spark[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const arcs: ArcEffect[] = [];
const discs: DiscEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const Z_AXIS = new Vector3(0, 0, 1);

export function createEffects(scene: Scene) {
  // Module pools survive level remounts; drop any stale entries from a
  // previous scene before repopulating.
  sparks.length = 0;
  rings.length = 0;
  glints.length = 0;
  arcs.length = 0;
  discs.length = 0;

  // Splinter sparks: a stretched sliver aligned to its travel.
  const sliver = new OctahedronGeometry(0.09, 0);
  sliver.scale(0.5, 0.5, 3.2);
  sparkMesh = new InstancedMesh(sliver, createAdditiveBasicMaterial({ color: 0xffffff }), SPARK_CAPACITY);
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  const ringGeometry = new RingGeometry(0.94, 1, 48);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1, billboard: true });
  }

  const bladeGeometry = new PlaneGeometry(1.6, 0.045);
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
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array((ARC_SEGMENTS + 1) * 3), 3));
    const material = new LineBasicMaterial(additiveMaterialParameters({ color: 0x000000 }));
    const line = new Line(geometry, material);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    arcs.push({ line, material, from: new Vector3(), to: new Vector3(), color: new Color(), age: 0, life: -1, jitter: 1, rejitterAt: 0 });
  }

  const discGeometry = new CircleGeometry(1, 40);
  for (let i = 0; i < DISC_CAPACITY; i += 1) {
    const mesh = new Mesh(discGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    (mesh.material as MeshBasicMaterial).fog = false;
    scene.add(mesh);
    discs.push({ mesh, color: new Color(), age: 0, life: -1, scale: 1 });
  }
}

function pushSpark(spark: Spark) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(spark);
}

/** Straight-flying splinter sparks that wink out fast. Vacuum: no gravity. */
export function burstSparks(position: Vector3, color: Color, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    pushSpark({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.45 + Math.random() * 0.9)),
      color: color.clone(),
      size: 0.5 + Math.random() * 0.6,
      age: 0,
      life: 0.24 + Math.random() * 0.28,
      drag: 0.9,
    });
  }
}

/** The enemy blows apart along its own facets. */
export function burstFacets(position: Vector3, specs: SparkSpec[], speed = 10) {
  for (const spec of specs) {
    pushSpark({
      position: position.clone().addScaledVector(spec.direction, 0.3),
      velocity: spec.direction.clone().multiplyScalar(speed * (0.7 + Math.random() * 0.6)),
      color: spec.color.clone(),
      size: 0.9 + spec.size * 1.9,
      age: 0,
      life: 0.5 + Math.random() * 0.35,
      drag: 1.4,
    });
  }
}

/** Cold, quickly fading streak dropped behind moving shots. */
export function dropTrail(position: Vector3, color: Color) {
  pushSpark({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8),
    color: color.clone(),
    size: 0.42,
    age: 0,
    life: 0.22,
    drag: 0.6,
  });
}

export function spawnRing(
  position: Vector3,
  color: Color,
  toScale: number,
  life: number,
  orientation?: Quaternion,
) {
  const ring = rings.find((r) => r.life < 0);
  if (!ring) return;
  ring.mesh.position.copy(position);
  ring.mesh.scale.setScalar(0.01);
  (ring.mesh.material as MeshBasicMaterial).color.set(0, 0, 0);
  ring.mesh.visible = true;
  ring.color.copy(color);
  ring.age = 0;
  ring.life = life;
  ring.fromScale = toScale * 0.14;
  ring.toScale = toScale;
  ring.billboard = orientation === undefined;
  if (orientation) ring.mesh.quaternion.copy(orientation);
}

export function spawnGlint(position: Vector3, color: Color, scale = 1, life = 0.16) {
  const glint = glints.find((g) => g.life < 0);
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

/** Jagged arc-lightning polyline snapped between two points; flickers as it dies. */
export function spawnArcLightning(from: Vector3, to: Vector3, color: Color, life = 0.26, jitter = 1) {
  const arc = arcs.find((a) => a.life < 0);
  if (!arc) return;
  arc.from.copy(from);
  arc.to.copy(to);
  arc.color.copy(color);
  arc.age = 0;
  arc.life = life;
  arc.jitter = jitter;
  arc.rejitterAt = 0;
  arc.line.visible = true;
  rejitterArc(arc);
}

/** A short lightning whip flying off a point in a rough direction. */
export function spawnArcWhip(origin: Vector3, color: Color, reach = 3.2, life = 0.3) {
  const direction = randomUnit(Math.random);
  spawnArcLightning(origin, origin.clone().addScaledVector(direction, reach), color, life, reach * 0.22);
}

function rejitterArc(arc: ArcEffect) {
  const attribute = arc.line.geometry.getAttribute('position');
  const span = arc.to.clone().sub(arc.from);
  const step = span.clone().divideScalar(ARC_SEGMENTS);
  const point = arc.from.clone();
  for (let i = 0; i <= ARC_SEGMENTS; i += 1) {
    const edge = i === 0 || i === ARC_SEGMENTS ? 0 : 1;
    attribute.setXYZ(
      i,
      point.x + (Math.random() - 0.5) * arc.jitter * edge,
      point.y + (Math.random() - 0.5) * arc.jitter * edge,
      point.z + (Math.random() - 0.5) * arc.jitter * edge,
    );
    point.add(step);
  }
  attribute.needsUpdate = true;
}

/** Camera-facing flash disc: the muzzle whiteout and the detonation. */
export function spawnFlashDisc(position: Vector3, color: Color, scale: number, life: number) {
  const disc = discs.find((d) => d.life < 0);
  if (!disc) return;
  disc.mesh.position.copy(position);
  disc.mesh.scale.setScalar(0.01);
  (disc.mesh.material as MeshBasicMaterial).color.set(0, 0, 0);
  disc.mesh.visible = true;
  disc.color.copy(color);
  disc.age = 0;
  disc.life = life;
  disc.scale = scale;
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
      spark.velocity.multiplyScalar(Math.max(0, 1 - spark.drag * dt));
      spark.position.addScaledVector(spark.velocity, dt);

      // Align the sliver to its travel.
      const speed = spark.velocity.length();
      if (speed > 0.001) {
        scratchQuaternion.setFromUnitVectors(Z_AXIS, spark.velocity.clone().divideScalar(speed));
      }
      const fade = 1 - spark.age / spark.life;
      scratchScale.setScalar(spark.size * (0.4 + fade * 0.6));
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
    ring.mesh.scale.setScalar(ring.fromScale + (ring.toScale - ring.fromScale) * eased);
    if (ring.billboard) ring.mesh.quaternion.copy(camera.quaternion);
    (ring.mesh.material as MeshBasicMaterial).color.copy(ring.color).multiplyScalar((1 - progress) ** 1.6);
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
    glint.group.rotation.z += dt * 2.4;
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
    if (arc.age >= arc.rejitterAt) {
      rejitterArc(arc);
      arc.rejitterAt = arc.age + 0.036;
    }
    const fade = 1 - arc.age / arc.life;
    // Flicker: strobing brightness as it dies.
    const flicker = 0.55 + Math.random() * 0.45;
    arc.material.color.copy(arc.color).multiplyScalar(fade * flicker);
  }

  for (const disc of discs) {
    if (disc.life < 0) continue;
    disc.age += dt;
    if (disc.age >= disc.life) {
      disc.life = -1;
      disc.mesh.visible = false;
      continue;
    }
    const progress = disc.age / disc.life;
    const envelope = Math.sin(Math.min(1, progress * 1.2) * Math.PI) ** 0.6;
    disc.mesh.scale.setScalar(Math.max(0.01, disc.scale * (0.5 + progress * 0.5)));
    disc.mesh.quaternion.copy(camera.quaternion);
    (disc.mesh.material as MeshBasicMaterial).color.copy(disc.color).multiplyScalar(envelope);
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
    arc.line.visible = false;
  }
  for (const disc of discs) {
    disc.life = -1;
    disc.mesh.visible = false;
  }
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
