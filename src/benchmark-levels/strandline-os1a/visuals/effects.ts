import {
  Camera,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { PARASITE_DARK } from './palette';

// Strandline's particle language is water, not fire. Nothing is thrown; every-
// thing is *released* — motes push out, stall against drag almost immediately,
// then sink. Debris does not fall, it settles. The one fast thing in the whole
// vocabulary is the strand flash: when a parasite dies, the length of strand it
// was gripping snaps clean along its whole visible height.

const MOTE_CAPACITY = 1100;
const RING_CAPACITY = 26;
const GLINT_CAPACITY = 14;
const FLASH_CAPACITY = 14;
const HUSK_CAPACITY = 5;

export type ShardSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

type Mote = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3; // unit length — feeds setFromAxisAngle every frame
  rotation: Quaternion;
  spin: number;
  color: Color;
  fadeTo: Color | null;
  size: number;
  age: number;
  life: number;
  drag: number;
  sink: number;
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

/** The signature: a length of strand relighting where a parasite let go of it. */
type FlashEffect = {
  mesh: Mesh;
  material: MeshBasicMaterial;
  color: Color;
  age: number;
  life: number;
  height: number;
};

type HuskEffect = {
  group: Group;
  velocity: Vector3;
  spinAxis: Vector3;
  spin: number;
  age: number;
  life: number;
};

const motes: Mote[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];
const flashes: FlashEffect[] = [];
const husks: HuskEffect[] = [];

let moteMesh: InstancedMesh | null = null;
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();

export function createEffects(scene: Scene) {
  moteMesh = new InstancedMesh(
    new IcosahedronGeometry(0.13, 0),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    MOTE_CAPACITY,
  );
  moteMesh.count = 0;
  moteMesh.frustumCulled = false;
  scene.add(moteMesh);

  const ringGeometry = new RingGeometry(0.93, 1, 48);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  const bladeGeometry = new PlaneGeometry(1.5, 0.045);
  for (let i = 0; i < GLINT_CAPACITY; i += 1) {
    const group = new Group();
    const materials: MeshBasicMaterial[] = [];
    for (const rotation of [0, Math.PI / 2, Math.PI / 4]) {
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

  const flashGeometry = new PlaneGeometry(1, 1);
  for (let i = 0; i < FLASH_CAPACITY; i += 1) {
    const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
    const mesh = new Mesh(flashGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    flashes.push({ mesh, material, color: new Color(), age: 0, life: -1, height: 20 });
  }

  // Husk pool: a dead parasite keeps its shape and simply stops swimming.
  for (let i = 0; i < HUSK_CAPACITY; i += 1) {
    const group = new Group();
    const shell = new MeshBasicMaterial({ color: PARASITE_DARK.clone().multiplyScalar(1.4) });
    const body = new Mesh(new SphereGeometry(0.8, 8, 6), shell);
    body.scale.set(1, 0.5, 1);
    group.add(body);
    for (let leg = 0; leg < 5; leg += 1) {
      const spine = new Mesh(new ConeGeometry(0.16, 1.5, 5), shell);
      const angle = (leg / 5) * Math.PI * 2;
      spine.position.set(Math.cos(angle) * 0.8, -0.2, Math.sin(angle) * 0.8);
      spine.rotation.z = Math.cos(angle) * 1.1;
      spine.rotation.x = -Math.sin(angle) * 1.1;
      group.add(spine);
    }
    group.visible = false;
    scene.add(group);
    husks.push({ group, velocity: new Vector3(), spinAxis: new Vector3(1, 0, 0), spin: 1, age: 0, life: -1 });
  }
}

function pushMote(mote: Mote) {
  if (motes.length >= MOTE_CAPACITY) motes.shift();
  motes.push(mote);
}

/** Released matter: quick push out, hard drag, slow sink. Never a spark shower. */
export function burstMotes(position: Vector3, color: Color, count: number, speed: number, sink = 1.4) {
  for (let i = 0; i < count; i += 1) {
    const direction = randomUnit(Math.random);
    pushMote({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.35 + Math.random() * 0.95)),
      axis: randomUnit(Math.random),
      rotation: new Quaternion(),
      spin: 1.5 + Math.random() * 4,
      color: color.clone(),
      fadeTo: null,
      size: 0.5 + Math.random() * 0.7,
      age: 0,
      life: 0.55 + Math.random() * 0.75,
      drag: 3.4,
      sink,
    });
  }
}

/** The parasite comes apart into its own plating, which then settles out. */
export function burstShards(position: Vector3, specs: ShardSpec[], rng: () => number = Math.random) {
  for (const spec of specs) {
    const outward = spec.direction.clone().normalize();
    pushMote({
      position: position.clone().addScaledVector(outward, 0.3),
      velocity: outward
        .clone()
        .multiplyScalar(4.5 + rng() * 5)
        .add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(2)),
      axis: randomUnit(rng),
      rotation: new Quaternion(),
      spin: 1.6 + rng() * 4,
      color: spec.color.clone(),
      fadeTo: PARASITE_DARK.clone(),
      size: 1 + spec.size * 2,
      age: 0,
      life: 1.1 + rng() * 0.7,
      drag: 2.6,
      sink: 2.6,
    });
  }
}

/** Wake left behind the player's shots — a thin line of stirred water. */
export function dropTrail(position: Vector3, color: Color) {
  pushMote({
    position: position.clone(),
    velocity: new Vector3((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.5),
    axis: randomUnit(Math.random),
    rotation: new Quaternion(),
    spin: 1.4,
    color: color.clone(),
    fadeTo: null,
    size: 0.42,
    age: 0,
    life: 0.3,
    drag: 1.2,
    sink: 0,
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
  ring.fromScale = toScale * 0.1;
  ring.toScale = toScale;
}

export function spawnGlint(position: Vector3, color: Color, scale = 1, life = 0.2) {
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

/**
 * A parasite dies and the strand it was riding comes back on: a tall, thin
 * column of the animal's own light, snapping up from the kill and fading.
 */
export function spawnStrandFlash(position: Vector3, color: Color, height = 26, life = 0.5) {
  const flash = flashes.find((candidate) => candidate.life < 0);
  if (!flash) return;
  flash.mesh.position.copy(position);
  flash.material.color.set(0, 0, 0);
  flash.mesh.visible = true;
  flash.color.copy(color);
  flash.age = 0;
  flash.life = life;
  flash.height = height;
}

export function spawnHusk(position: Vector3, scale: number, drift: Vector3) {
  const husk = husks.find((candidate) => candidate.life < 0);
  if (!husk) return;
  husk.group.position.copy(position);
  husk.group.scale.setScalar(scale);
  husk.group.visible = true;
  husk.velocity.copy(drift);
  husk.spinAxis.copy(randomUnit(Math.random));
  husk.spin = 0.6 + Math.random() * 1.4;
  husk.age = 0;
  husk.life = 3.4;
}

export function updateEffects(dt: number, camera: Camera) {
  if (moteMesh) {
    let count = 0;
    for (let i = motes.length - 1; i >= 0; i -= 1) {
      const mote = motes[i];
      mote.age += dt;
      if (mote.age >= mote.life) {
        motes.splice(i, 1);
        continue;
      }
      // Water: drag dominates immediately, then a slow settle downward.
      mote.velocity.multiplyScalar(Math.max(0, 1 - mote.drag * dt));
      mote.velocity.y -= mote.sink * dt;
      mote.position.addScaledVector(mote.velocity, dt);
      scratchQuaternion.setFromAxisAngle(mote.axis, mote.spin * dt);
      mote.rotation.premultiply(scratchQuaternion).normalize();

      const fade = 1 - mote.age / mote.life;
      scratchScale.setScalar(mote.size * (0.45 + fade * 0.55));
      scratchMatrix.compose(mote.position, mote.rotation, scratchScale);
      moteMesh.setMatrixAt(count, scratchMatrix);
      if (mote.fadeTo) scratchColor.copy(mote.color).lerp(mote.fadeTo, 1 - fade).multiplyScalar(0.25 + fade * 0.75);
      else scratchColor.copy(mote.color).multiplyScalar(fade * fade);
      moteMesh.setColorAt(count, scratchColor);
      count += 1;
    }
    moteMesh.count = count;
    moteMesh.instanceMatrix.needsUpdate = true;
    if (moteMesh.instanceColor) moteMesh.instanceColor.needsUpdate = true;
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
    const envelope = Math.sin(Math.min(1, progress * 1.15) * Math.PI);
    glint.group.scale.setScalar(Math.max(0.01, glint.scale * envelope));
    glint.group.quaternion.copy(camera.quaternion);
    glint.group.rotation.z += dt * 2.2;
    for (const material of glint.materials) material.color.copy(glint.color).multiplyScalar(envelope);
  }

  for (const flash of flashes) {
    if (flash.life < 0) continue;
    flash.age += dt;
    if (flash.age >= flash.life) {
      flash.life = -1;
      flash.mesh.visible = false;
      continue;
    }
    const progress = flash.age / flash.life;
    // Runs open fast (the light travels), then fades over the whole tail.
    const grow = Math.min(1, progress * 3.4);
    flash.mesh.quaternion.copy(camera.quaternion);
    flash.mesh.scale.set(0.9 + progress * 1.8, flash.height * grow, 1);
    flash.material.color.copy(flash.color).multiplyScalar((1 - progress) ** 1.8 * 0.85);
  }

  for (const husk of husks) {
    if (husk.life < 0) continue;
    husk.age += dt;
    if (husk.age >= husk.life) {
      husk.life = -1;
      husk.group.visible = false;
      continue;
    }
    husk.velocity.multiplyScalar(Math.max(0, 1 - 0.9 * dt));
    husk.velocity.y -= 3.2 * dt;
    husk.group.position.addScaledVector(husk.velocity, dt);
    scratchQuaternion.setFromAxisAngle(husk.spinAxis, husk.spin * dt);
    husk.group.quaternion.premultiply(scratchQuaternion);
  }
}

export function resetEffects() {
  motes.length = 0;
  if (moteMesh) moteMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
  for (const flash of flashes) {
    flash.life = -1;
    flash.mesh.visible = false;
  }
  for (const husk of husks) {
    husk.life = -1;
    husk.group.visible = false;
  }
}


function randomUnit(rng: () => number): Vector3 {
  const z = rng() * 2 - 1;
  const angle = rng() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
