import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Camera,
  CircleGeometry,
  Color,
  DoubleSide,
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
  Vector3,
} from 'three';
import type { FacetSpec } from './enemies';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { ION_WHITE, hdr } from './palette';

// Everything a hit throws off is electrical, and this is a vacuum barrel:
// no gravity on anything. Straight-flying splinter sparks aligned to their
// travel, thin expanding shockwave rings, cross-glints for player impacts,
// jagged arc-lightning polylines that snap between two points and flicker as
// they die, and camera-facing flash discs for the shot and the detonation.

const SPARK_CAPACITY = 700;
const RING_CAPACITY = 28;
const GLINT_CAPACITY = 12;
const ARC_CAPACITY = 18;
const ARC_POINTS = 9;
const FLASH_DISC_CAPACITY = 3;

type Spark = {
  position: Vector3;
  velocity: Vector3;
  color: Color;
  width: number;
  length: number;
  age: number;
  life: number;
};

type ShockRing = {
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

type ArcBolt = {
  line: Line;
  material: LineBasicMaterial;
  from: Vector3;
  to: Vector3;
  color: Color;
  amplitude: number;
  age: number;
  life: number;
  rejitterAt: number;
};

type FlashDisc = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  scale: number;
};

const sparks: Spark[] = [];
const rings: ShockRing[] = [];
const glints: Glint[] = [];
const arcs: ArcBolt[] = [];
const flashDiscs: FlashDisc[] = [];

let sparkMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchDirection = new Vector3();
const scratchColor = new Color();
const Z_AXIS = new Vector3(0, 0, 1);

export function createEffects(scene: Scene) {
  // Splinters are boxes stretched along local Z so they can align to travel.
  const sparkGeometry = new BoxGeometry(1, 1, 1);
  sparkMesh = new InstancedMesh(
    sparkGeometry,
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SPARK_CAPACITY,
  );
  sparkMesh.count = 0;
  sparkMesh.frustumCulled = false;
  scene.add(sparkMesh);

  const ringGeometry = new RingGeometry(0.955, 1, 48);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  const bladeGeometry = new PlaneGeometry(1.8, 0.05);
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
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(ARC_POINTS * 3), 3));
    const material = new LineBasicMaterial(additiveMaterialParameters({ color: 0x000000 }));
    const line = new Line(geometry, material);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    arcs.push({
      line,
      material,
      from: new Vector3(),
      to: new Vector3(),
      color: new Color(),
      amplitude: 1,
      age: 0,
      life: -1,
      rejitterAt: 0,
    });
  }

  const discGeometry = new CircleGeometry(1, 40);
  for (let i = 0; i < FLASH_DISC_CAPACITY; i += 1) {
    const mesh = new Mesh(discGeometry, createAdditiveBasicMaterial({ color: 0x000000 }));
    mesh.visible = false;
    scene.add(mesh);
    flashDiscs.push({ mesh, color: new Color(), age: 0, life: -1, scale: 1 });
  }
}

// ---- spawners --------------------------------------------------------------------

export function burstSparks(position: Vector3, color: Color, count: number, speed: number, length = 1) {
  for (let i = 0; i < count; i += 1) {
    if (sparks.length >= SPARK_CAPACITY) sparks.shift();
    const direction = randomUnit();
    const pace = speed * (0.5 + Math.random() * 0.9);
    sparks.push({
      position: position.clone().addScaledVector(direction, 0.2),
      velocity: direction.multiplyScalar(pace),
      color: color.clone(),
      width: 0.05 + Math.random() * 0.04,
      length: (0.4 + Math.random() * 0.5) * length,
      age: 0,
      life: 0.22 + Math.random() * 0.2,
    });
  }
}

/** The enemy blows apart along its own facets — no gravity, straight flight. */
export function burstShatter(position: Vector3, specs: FacetSpec[] | undefined, accent: Color, scale = 1) {
  const source = specs && specs.length > 0 ? specs : fallbackFacets(accent);
  for (const spec of source) {
    if (sparks.length >= SPARK_CAPACITY) sparks.shift();
    const jitter = randomUnit().multiplyScalar(1.6);
    sparks.push({
      position: position.clone().addScaledVector(spec.direction, 0.3),
      velocity: spec.direction.clone().multiplyScalar((9 + Math.random() * 7) * scale).add(jitter),
      color: spec.color.clone().multiplyScalar(1.1),
      width: 0.07 + spec.size * 0.08,
      length: 0.7 + spec.size * 1.1,
      age: 0,
      life: 0.4 + Math.random() * 0.25,
    });
  }
  burstSparks(position, hdr(ION_WHITE, 1.1), Math.round(5 * scale), 13 * scale, 0.7);
}

export function spawnShockRing(position: Vector3, color: Color, toScale: number, life: number) {
  const ring = rings.find((candidate) => candidate.life < 0);
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

/** A jagged arc-lightning polyline snapped between two points, flickering as it dies. */
export function spawnArcLightning(from: Vector3, to: Vector3, color: Color, life = 0.24, amplitude = 0.9) {
  const bolt = arcs.find((candidate) => candidate.life < 0);
  if (!bolt) return;
  bolt.from.copy(from);
  bolt.to.copy(to);
  bolt.color.copy(color);
  bolt.amplitude = amplitude;
  bolt.age = 0;
  bolt.life = life;
  bolt.rejitterAt = 0;
  bolt.line.visible = true;
  jitterArc(bolt);
}

/** A short arc whipped off a point in a random direction — the kill signature. */
export function spawnArcWhip(position: Vector3, color: Color, reach = 3.4, life = 0.26) {
  const direction = randomUnit();
  spawnArcLightning(position, position.clone().addScaledVector(direction, reach), color, life, reach * 0.22);
}

/** Camera-facing flash disc — the muzzle whiteout and the detonation. */
export function spawnFlashDisc(position: Vector3, color: Color, scale: number, life: number) {
  const disc = flashDiscs.find((candidate) => candidate.life < 0);
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

// ---- update ------------------------------------------------------------------------

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
      spark.position.addScaledVector(spark.velocity, dt);
      const fade = 1 - spark.age / spark.life;
      // Align the splinter to its travel.
      scratchDirection.copy(spark.velocity).normalize();
      scratchQuaternion.setFromUnitVectors(Z_AXIS, scratchDirection);
      const thickness = spark.width * (0.4 + fade * 0.6);
      scratchScale.set(thickness, thickness, spark.length);
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
    ring.mesh.quaternion.copy(camera.quaternion);
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
    const envelope = Math.sin(Math.min(1, progress * 1.12) * Math.PI);
    glint.group.scale.setScalar(Math.max(0.01, glint.scale * envelope));
    glint.group.quaternion.copy(camera.quaternion);
    glint.group.rotation.z += dt * 2.6;
    for (const material of glint.materials) material.color.copy(glint.color).multiplyScalar(envelope);
  }

  for (const bolt of arcs) {
    if (bolt.life < 0) continue;
    bolt.age += dt;
    if (bolt.age >= bolt.life) {
      bolt.life = -1;
      bolt.line.visible = false;
      continue;
    }
    // Flicker: re-snap the polyline every few frames as it dies.
    if (bolt.age >= bolt.rejitterAt) {
      bolt.rejitterAt = bolt.age + 0.035;
      jitterArc(bolt);
    }
    const fade = (1 - bolt.age / bolt.life) ** 1.3;
    const strobe = Math.random() < 0.22 ? 0.35 : 1;
    bolt.material.color.copy(bolt.color).multiplyScalar(fade * strobe);
  }

  for (const disc of flashDiscs) {
    if (disc.life < 0) continue;
    disc.age += dt;
    if (disc.age >= disc.life) {
      disc.life = -1;
      disc.mesh.visible = false;
      continue;
    }
    const progress = disc.age / disc.life;
    const envelope = progress < 0.12 ? progress / 0.12 : (1 - progress) ** 1.4;
    disc.mesh.scale.setScalar(disc.scale * (0.5 + progress * 0.7));
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
  for (const bolt of arcs) {
    bolt.life = -1;
    bolt.line.visible = false;
  }
  for (const disc of flashDiscs) {
    disc.life = -1;
    disc.mesh.visible = false;
  }
}

// ---- helpers -------------------------------------------------------------------------

function jitterArc(bolt: ArcBolt) {
  const positions = bolt.line.geometry.getAttribute('position') as BufferAttribute;
  const along = bolt.to.clone().sub(bolt.from);
  const left = along.clone().cross(new Vector3(0, 1, 0.13)).normalize();
  if (left.lengthSq() < 0.001) left.set(1, 0, 0);
  const up = along.clone().cross(left).normalize();
  for (let i = 0; i < ARC_POINTS; i += 1) {
    const t = i / (ARC_POINTS - 1);
    const spread = Math.sin(t * Math.PI) * bolt.amplitude;
    const point = bolt.from.clone().addScaledVector(along, t)
      .addScaledVector(left, (Math.random() - 0.5) * spread)
      .addScaledVector(up, (Math.random() - 0.5) * spread);
    positions.setXYZ(i, point.x, point.y, point.z);
  }
  positions.needsUpdate = true;
}

function fallbackFacets(accent: Color): FacetSpec[] {
  const specs: FacetSpec[] = [];
  for (let i = 0; i < 8; i += 1) {
    specs.push({ direction: randomUnit(), color: accent.clone(), size: 0.4 + Math.random() * 0.4 });
  }
  return specs;
}

function randomUnit(): Vector3 {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
