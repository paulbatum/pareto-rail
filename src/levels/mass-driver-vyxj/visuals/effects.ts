import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
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

// Electric particle language: sparks fly hard and die fast (no gravity in a
// railgun barrel — drag owns everything), shockwaves are hexagonal because
// the collar and the coils are hexagonal, player impacts are amber glints,
// and the signature is the arc pool: jagged lightning strung between points,
// flickering per-frame like a bad contact.

const SPARK_CAPACITY = 1200;
const RING_CAPACITY = 26;
const GLINT_CAPACITY = 14;
const ARC_CAPACITY = 18;
const ARC_POINTS = 12;

export type SparkSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

type SparkParticle = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3; // unit length — feeds setFromAxisAngle every frame
  rotation: Quaternion;
  spin: number;
  color: Color;
  coolTo: Color | null;
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
  color: Color;
  age: number;
  life: number;
  flickerSeed: number;
};

const sparks: SparkParticle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const arcs: ArcEffect[] = [];

let sparkMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const scratchDirection = new Vector3();
const scratchPerpA = new Vector3();
const scratchPerpB = new Vector3();
const COOL_DARK = new Color(0.01, 0.012, 0.03);

export function createEffects(scene: Scene) {
  sparkMesh = new InstancedMesh(
    new TetrahedronGeometry(0.11, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SPARK_CAPACITY,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  // Hexagonal shockwaves: six segments, matching the coil language.
  const ringGeometry = new RingGeometry(0.94, 1, 6);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(
      ringGeometry,
      createAdditiveBasicMaterial({ color: 0x000000, side: 2 }),
    );
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  const bladeGeometry = new PlaneGeometry(1.7, 0.05);
  for (let i = 0; i < GLINT_CAPACITY; i += 1) {
    const group = new Group();
    const materials: MeshBasicMaterial[] = [];
    for (const rotation of [0, Math.PI / 2]) {
      const material = createAdditiveBasicMaterial({ color: 0x000000, side: 2 });
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
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(ARC_POINTS * 3), 3));
    const material = new LineBasicMaterial(additiveMaterialParameters({ color: 0x000000 }));
    const line = new Line(geometry, material);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    arcs.push({ line, material, color: new Color(), age: 0, life: -1, flickerSeed: i * 2.13 });
  }
}

function pushSpark(particle: SparkParticle) {
  if (sparks.length >= SPARK_CAPACITY) sparks.shift();
  sparks.push(particle);
}

// Hot electric sparks: fast, weightless, killed by drag.
export function burstSparks(position: Vector3, color: Color, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    pushSpark({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.4 + Math.random() * 0.9)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 10 + Math.random() * 16,
      color: color.clone(),
      coolTo: null,
      size: 0.35 + Math.random() * 0.45,
      age: 0,
      life: 0.28 + Math.random() * 0.32,
      drag: 2.4,
    });
  }
}

// The target decompresses into its own panels, cooling to dead metal.
export function burstDebris(position: Vector3, specs: SparkSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushSpark({
      position: position.clone().addScaledVector(outward, 0.3),
      velocity: outward
        .clone()
        .multiplyScalar(7 + rng() * 8)
        .add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(3)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 4 + rng() * 9,
      color: spec.color.clone(),
      coolTo: COOL_DARK.clone(),
      size: 1.1 + spec.size * 2,
      age: 0,
      life: 0.7 + rng() * 0.45,
      drag: 2.0,
    });
  }
}

// Slow-fading streak dropped behind moving shots.
export function dropTrail(position: Vector3, color: Color) {
  pushSpark({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5), (Math.random() - 0.5), (Math.random() - 0.5)),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 3,
    color: color.clone(),
    coolTo: null,
    size: 0.5,
    age: 0,
    life: 0.24,
    drag: 1,
  });
}

export function spawnRing(position: Vector3, color: Color, toScale: number, life: number) {
  const ring = rings.find((candidate) => candidate.life < 0);
  if (!ring) return;
  ring.mesh.position.copy(position);
  ring.mesh.scale.setScalar(0.01);
  (ring.mesh.material as MeshBasicMaterial).color.set(0, 0, 0);
  ring.mesh.visible = true;
  ring.color.copy(color);
  ring.age = 0;
  ring.life = life;
  ring.fromScale = toScale * 0.12;
  ring.toScale = toScale;
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

// Lightning strung between two points: jagged midpoints offset perpendicular
// to the span, regenerated once at spawn and strobed by the update loop.
export function spawnArc(from: Vector3, to: Vector3, color: Color, life = 0.22, jag = 1) {
  const arc = arcs.find((candidate) => candidate.life < 0);
  if (!arc) return;
  scratchDirection.copy(to).sub(from);
  const length = scratchDirection.length();
  if (length < 0.01) return;
  scratchDirection.normalize();
  scratchPerpA.set(-scratchDirection.y, scratchDirection.x, scratchDirection.z * 0.3).normalize();
  scratchPerpB.crossVectors(scratchDirection, scratchPerpA).normalize();
  const positions = arc.line.geometry.getAttribute('position') as BufferAttribute;
  const amplitude = Math.min(1.6, length * 0.14) * jag;
  for (let i = 0; i < ARC_POINTS; i += 1) {
    const t = i / (ARC_POINTS - 1);
    const envelope = Math.sin(t * Math.PI);
    const offsetA = (Math.random() - 0.5) * 2 * amplitude * envelope;
    const offsetB = (Math.random() - 0.5) * 2 * amplitude * envelope;
    positions.setXYZ(
      i,
      from.x + scratchDirection.x * length * t + scratchPerpA.x * offsetA + scratchPerpB.x * offsetB,
      from.y + scratchDirection.y * length * t + scratchPerpA.y * offsetA + scratchPerpB.y * offsetB,
      from.z + scratchDirection.z * length * t + scratchPerpA.z * offsetA + scratchPerpB.z * offsetB,
    );
  }
  positions.needsUpdate = true;
  arc.line.visible = true;
  arc.material.color.copy(color);
  arc.color.copy(color);
  arc.age = 0;
  arc.life = life;
}

export function updateEffects(dt: number, camera: Camera, elapsed: number) {
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
      scratchQuaternion.setFromAxisAngle(spark.axis, spark.spin * dt);
      spark.rotation.premultiply(scratchQuaternion).normalize();

      const fade = 1 - spark.age / spark.life;
      scratchScale.setScalar(spark.size * (0.35 + fade * 0.65));
      scratchMatrix.compose(spark.position, spark.rotation, scratchScale);
      sparkMesh.setMatrixAt(count, scratchMatrix);
      if (spark.coolTo) scratchColor.copy(spark.color).lerp(spark.coolTo, 1 - fade).multiplyScalar(0.3 + fade * 0.7);
      else scratchColor.copy(spark.color).multiplyScalar(fade * fade);
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
    ring.mesh.quaternion.copy(camera.quaternion);
    ring.mesh.rotation.z += progress * 0.5;
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
    const progress = glint.age / glint.life;
    const envelope = Math.sin(Math.min(1, progress * 1.15) * Math.PI);
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
      arc.line.visible = false;
      continue;
    }
    const progress = arc.age / arc.life;
    // Bad-contact strobe: brightness snaps between frames instead of fading.
    const flicker = 0.45 + 0.55 * Math.abs(Math.sin(elapsed * 61 + arc.flickerSeed * 17));
    arc.material.color.copy(arc.color).multiplyScalar((1 - progress) * flicker);
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
}

function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
