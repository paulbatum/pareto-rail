import {
  Camera,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { TABLE_Y } from '../gameplay';
import { GLUE, GLUE_SHEEN, LAMP_WARM } from './palette';

// Effect pools. Glue splats are dark, lit droplets that fall and shrink;
// sparkles are additive mint motes for the player's clean actions; rings
// and glints are thin billboards; puffs are dust kicked up on the table.

const DROPLET_CAPACITY = 420;
const SPARKLE_CAPACITY = 520;
const RING_CAPACITY = 24;
const GLINT_CAPACITY = 12;
const PUFF_CAPACITY = 24;

type Droplet = {
  position: Vector3;
  velocity: Vector3;
  scale: number;
  age: number;
  life: number;
};

type Sparkle = {
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
  gravity: number;
};

type RingEffect = { mesh: Mesh; color: Color; age: number; life: number; fromScale: number; toScale: number };
type GlintEffect = { group: Group; materials: MeshBasicMaterial[]; color: Color; age: number; life: number; scale: number };
type PuffEffect = { mesh: Mesh; age: number; life: number; scale: number };

const droplets: Droplet[] = [];
const sparkles: Sparkle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const puffs: PuffEffect[] = [];

let dropletMesh: InstancedMesh | null = null;
let sparkleMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const GRAVITY = 24;

export function createEffects(scene: Scene) {
  // Pools are module-level; a re-mounted level starts them fresh.
  droplets.length = 0;
  sparkles.length = 0;
  rings.length = 0;
  glints.length = 0;
  puffs.length = 0;
  dropletMesh = new InstancedMesh(
    new SphereGeometry(1, 7, 5),
    new MeshStandardMaterial({ color: GLUE.clone(), roughness: 0.3, metalness: 0.3, emissive: GLUE_SHEEN.clone().multiplyScalar(0.05) }),
    DROPLET_CAPACITY,
  );
  dropletMesh.count = 0;
  dropletMesh.frustumCulled = false;
  dropletMesh.userData.raildIgnoreOcclusion = true;
  scene.add(dropletMesh);

  sparkleMesh = new InstancedMesh(new TetrahedronGeometry(0.12, 0), createAdditiveBasicMaterial({ color: 0xffffff }), SPARKLE_CAPACITY);
  sparkleMesh.count = 0;
  sparkleMesh.frustumCulled = false;
  sparkleMesh.userData.raildIgnoreOcclusion = true;
  scene.add(sparkleMesh);

  const ringGeometry = new RingGeometry(0.955, 1, 56);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
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
    group.userData.raildIgnoreOcclusion = true;
    scene.add(group);
    glints.push({ group, materials, color: new Color(), age: 0, life: -1, scale: 1 });
  }

  const puffGeometry = new CircleGeometry(1, 18);
  for (let i = 0; i < PUFF_CAPACITY; i += 1) {
    const mesh = new Mesh(puffGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    mesh.renderOrder = 2;
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
    puffs.push({ mesh, age: 0, life: -1, scale: 1 });
  }
}

/** Glue splat: dark droplets fly out, fall, and shrink away. */
export function burstDroplets(position: Vector3, count: number, speed: number, scale: number) {
  for (let i = 0; i < count; i += 1) {
    if (droplets.length >= DROPLET_CAPACITY) droplets.shift();
    const direction = randomUnit();
    direction.y = Math.abs(direction.y) * 0.8 + 0.25;
    droplets.push({
      position: position.clone(),
      velocity: direction.normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.9)),
      scale: scale * (0.5 + Math.random() * 0.8),
      age: 0,
      life: 0.5 + Math.random() * 0.4,
    });
  }
}

export function burstSparkles(position: Vector3, color: Color, count: number, speed: number, gravity = 4) {
  for (let i = 0; i < count; i += 1) {
    if (sparkles.length >= SPARKLE_CAPACITY) sparkles.shift();
    const direction = randomUnit();
    sparkles.push({
      position: position.clone(),
      velocity: direction.clone().multiplyScalar(speed * (0.35 + Math.random() * 0.9)),
      axis: direction,
      rotation: new Quaternion(),
      spin: 8 + Math.random() * 14,
      color: color.clone(),
      size: 0.45 + Math.random() * 0.6,
      age: 0,
      life: 0.28 + Math.random() * 0.3,
      drag: 3,
      gravity,
    });
  }
}

/** Tiny mote dropped behind a projectile each frame. */
export function dropTrail(position: Vector3, color: Color) {
  if (sparkles.length >= SPARKLE_CAPACITY) sparkles.shift();
  sparkles.push({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2),
    axis: randomUnit(),
    rotation: new Quaternion(),
    spin: 4,
    color: color.clone(),
    size: 0.5,
    age: 0,
    life: 0.26,
    drag: 1,
    gravity: 0,
  });
}

export function spawnRing(position: Vector3, color: Color, toScale: number, life: number) {
  const ring = rings.find((r) => r.life < 0);
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

export function spawnGlint(position: Vector3, color: Color, scale = 1, life = 0.18) {
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

/** Dust kicked up on the table. */
export function puff(position: Vector3, scale: number, life = 0.45) {
  const item = puffs.find((p) => p.life < 0);
  if (!item) return;
  item.mesh.position.set(position.x, TABLE_Y + 0.09, position.z);
  item.mesh.scale.setScalar(0.01);
  item.mesh.visible = true;
  item.age = 0;
  item.life = life;
  item.scale = scale;
}

export function updateEffects(dt: number, camera: Camera) {
  if (dropletMesh) {
    let count = 0;
    for (let i = droplets.length - 1; i >= 0; i -= 1) {
      const droplet = droplets[i];
      droplet.age += dt;
      if (droplet.age >= droplet.life) {
        droplets.splice(i, 1);
        continue;
      }
      droplet.velocity.y -= GRAVITY * dt;
      droplet.velocity.multiplyScalar(Math.max(0, 1 - 1.4 * dt));
      droplet.position.addScaledVector(droplet.velocity, dt);
      const floor = TABLE_Y + droplet.scale * 0.5;
      if (droplet.position.y < floor) {
        droplet.position.y = floor;
        droplet.velocity.set(droplet.velocity.x * 0.5, 0, droplet.velocity.z * 0.5);
      }
      const fade = 1 - droplet.age / droplet.life;
      scratchScale.set(droplet.scale, droplet.scale * (0.6 + fade * 0.7), droplet.scale).multiplyScalar(0.3 + fade * 0.7);
      scratchMatrix.compose(droplet.position, scratchQuaternion.identity(), scratchScale);
      dropletMesh.setMatrixAt(count, scratchMatrix);
      count += 1;
    }
    dropletMesh.count = count;
    dropletMesh.instanceMatrix.needsUpdate = true;
  }

  if (sparkleMesh) {
    let count = 0;
    for (let i = sparkles.length - 1; i >= 0; i -= 1) {
      const sparkle = sparkles[i];
      sparkle.age += dt;
      if (sparkle.age >= sparkle.life) {
        sparkles.splice(i, 1);
        continue;
      }
      sparkle.velocity.y -= sparkle.gravity * dt;
      sparkle.velocity.multiplyScalar(Math.max(0, 1 - sparkle.drag * dt));
      sparkle.position.addScaledVector(sparkle.velocity, dt);
      scratchQuaternion.setFromAxisAngle(sparkle.axis, sparkle.spin * dt);
      sparkle.rotation.premultiply(scratchQuaternion).normalize();
      const fade = 1 - sparkle.age / sparkle.life;
      scratchScale.setScalar(sparkle.size * (0.35 + fade * 0.65));
      scratchMatrix.compose(sparkle.position, sparkle.rotation, scratchScale);
      sparkleMesh.setMatrixAt(count, scratchMatrix);
      scratchColor.copy(sparkle.color).multiplyScalar(fade * fade);
      sparkleMesh.setColorAt(count, scratchColor);
      count += 1;
    }
    sparkleMesh.count = count;
    sparkleMesh.instanceMatrix.needsUpdate = true;
    if (sparkleMesh.instanceColor) sparkleMesh.instanceColor.needsUpdate = true;
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

  for (const item of puffs) {
    if (item.life < 0) continue;
    item.age += dt;
    if (item.age >= item.life) {
      item.life = -1;
      item.mesh.visible = false;
      continue;
    }
    const progress = item.age / item.life;
    item.mesh.scale.setScalar(item.scale * (0.3 + progress * 0.7));
    (item.mesh.material as MeshBasicMaterial).color.copy(LAMP_WARM).multiplyScalar(0.28 * (1 - progress) ** 1.4);
  }
}

export function resetEffects() {
  droplets.length = 0;
  sparkles.length = 0;
  if (dropletMesh) dropletMesh.count = 0;
  if (sparkleMesh) sparkleMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
  for (const item of puffs) {
    item.life = -1;
    item.mesh.visible = false;
  }
}

function randomUnit(): Vector3 {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
