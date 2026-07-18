import {
  BoxGeometry,
  BufferGeometry,
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
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';

// This is a vacuum barrel, so nothing an impact throws off ever falls: every
// particle here flies straight and winks out. The signature effect is the arc
// bolt — a jagged polyline that snaps between two points and flickers as it
// dies. It fires on kills, armor chips, capacitor crackle, and denials.

const SPLINTER_CAPACITY = 900;
const SHOCKWAVE_CAPACITY = 30;
const GLINT_CAPACITY = 16;
const BOLT_CAPACITY = 20;
const BOLT_SEGMENTS = 14;
const DISC_CAPACITY = 8;

const FORWARD = new Vector3(0, 0, 1);

type Splinter = {
  position: Vector3;
  velocity: Vector3;
  rotation: Quaternion;
  color: Color;
  length: number;
  width: number;
  age: number;
  life: number;
  drag: number;
};

type Shockwave = {
  mesh: Mesh;
  color: Color;
  age: number;
  life: number;
  fromScale: number;
  toScale: number;
  /** 0 = camera-facing, 1 = held on the axis it was authored with. */
  fixed: boolean;
};

type Glint = {
  group: Group;
  materials: MeshBasicMaterial[];
  color: Color;
  age: number;
  life: number;
  scale: number;
};

type Bolt = {
  line: Line;
  material: LineBasicMaterial;
  from: Vector3;
  to: Vector3;
  spread: number;
  color: Color;
  age: number;
  life: number;
  nextJitter: number;
};

type Disc = {
  mesh: Mesh;
  material: MeshBasicMaterial;
  color: Color;
  age: number;
  life: number;
  scale: number;
};

const splinters: Splinter[] = [];
const shockwaves: Shockwave[] = [];
const glints: Glint[] = [];
const bolts: Bolt[] = [];
const discs: Disc[] = [];

let splinterMesh: InstancedMesh | null = null;

const scratchMatrix = new Matrix4();
const scratchScale = new Vector3();
const scratchColor = new Color();
const scratchDirection = new Vector3();
const scratchQuaternion = new Quaternion();
const scratchA = new Vector3();
const scratchB = new Vector3();

export function createEffects(scene: Scene) {
  splinterMesh = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    createAdditiveBasicMaterial({ color: 0xffffff }),
    SPLINTER_CAPACITY,
  );
  splinterMesh.count = 0;
  splinterMesh.frustumCulled = false;
  scene.add(splinterMesh);

  // Thin rims only: a fat ring under bloom reads as a wall of light.
  const ringGeometry = new RingGeometry(0.962, 1, 64);
  for (let i = 0; i < SHOCKWAVE_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    shockwaves.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1, fixed: false });
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
    group.frustumCulled = false;
    scene.add(group);
    glints.push({ group, materials, color: new Color(), age: 0, life: -1, scale: 1 });
  }

  for (let i = 0; i < BOLT_CAPACITY; i += 1) {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(BOLT_SEGMENTS * 3), 3));
    const material = new LineBasicMaterial(additiveMaterialParameters({ color: 0x000000 }));
    const line = new Line(geometry, material);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    bolts.push({
      line,
      material,
      from: new Vector3(),
      to: new Vector3(),
      spread: 1,
      color: new Color(),
      age: 0,
      life: -1,
      nextJitter: 0,
    });
  }

  const discGeometry = new CircleGeometry(1, 40);
  for (let i = 0; i < DISC_CAPACITY; i += 1) {
    const material = createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide });
    const mesh = new Mesh(discGeometry, material);
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    discs.push({ mesh, material, color: new Color(), age: 0, life: -1, scale: 1 });
  }
}

function randomUnit(target: Vector3) {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return target.set(Math.cos(angle) * r, Math.sin(angle) * r, z);
}

/** Straight-flying splinter sparks that align to their travel and wink out fast. */
export function burstSplinters(
  position: Vector3,
  color: Color,
  count: number,
  speed: number,
  options: { life?: number; length?: number; cone?: Vector3 } = {},
) {
  for (let i = 0; i < count; i += 1) {
    if (splinters.length >= SPLINTER_CAPACITY) splinters.shift();
    const direction = randomUnit(new Vector3());
    if (options.cone) direction.lerp(options.cone, 0.55).normalize();
    const velocity = direction.clone().multiplyScalar(speed * (0.45 + Math.random() * 0.95));
    splinters.push({
      position: position.clone(),
      velocity,
      rotation: new Quaternion().setFromUnitVectors(FORWARD, direction),
      color: color.clone(),
      length: (options.length ?? 0.9) * (0.6 + Math.random() * 0.9),
      width: 0.05 + Math.random() * 0.045,
      age: 0,
      life: (options.life ?? 0.3) * (0.7 + Math.random() * 0.6),
      // No gravity in the barrel; only a light drag so tracks stay straight.
      drag: 1.1,
    });
  }
}

/** A thin expanding shockwave ring. */
export function spawnShockwave(
  position: Vector3,
  color: Color,
  toScale: number,
  life: number,
  options: { axis?: Vector3 } = {},
) {
  const wave = shockwaves.find((candidate) => candidate.life < 0);
  if (!wave) return;
  wave.mesh.position.copy(position);
  wave.mesh.scale.setScalar(0.01);
  (wave.mesh.material as MeshBasicMaterial).color.setRGB(0, 0, 0);
  wave.mesh.visible = true;
  wave.color.copy(color);
  wave.age = 0;
  wave.life = life;
  wave.fromScale = toScale * 0.1;
  wave.toScale = toScale;
  wave.fixed = options.axis !== undefined;
  if (options.axis) wave.mesh.quaternion.setFromUnitVectors(FORWARD, options.axis.clone().normalize());
}

/** A cross-glint: the player's own impacts get this and nothing else does. */
export function spawnGlint(position: Vector3, color: Color, scale = 1, life = 0.16) {
  const glint = glints.find((candidate) => candidate.life < 0);
  if (!glint) return;
  glint.group.position.copy(position);
  glint.group.scale.setScalar(0.01);
  for (const material of glint.materials) material.color.setRGB(0, 0, 0);
  glint.group.visible = true;
  glint.color.copy(color);
  glint.age = 0;
  glint.life = life;
  glint.scale = scale;
}

/** A jagged arc that snaps between two points and flickers as it dies. */
export function spawnArcBolt(from: Vector3, to: Vector3, color: Color, life = 0.24, spread = 1) {
  const bolt = bolts.find((candidate) => candidate.life < 0);
  if (!bolt) return;
  bolt.from.copy(from);
  bolt.to.copy(to);
  bolt.color.copy(color);
  bolt.spread = spread;
  bolt.age = 0;
  bolt.life = life;
  bolt.nextJitter = 0;
  bolt.line.visible = true;
  jitterBolt(bolt);
}

/** A whip of lightning thrown outward from a point in a random direction. */
export function whipArcBolt(position: Vector3, color: Color, reach: number, life = 0.26, spread = 1) {
  randomUnit(scratchDirection).multiplyScalar(reach);
  scratchA.copy(position).sub(scratchDirection.clone().multiplyScalar(0.25));
  scratchB.copy(position).add(scratchDirection);
  spawnArcBolt(scratchA, scratchB, color, life, spread);
}

/** A camera-facing flash disc: the muzzle whiteout and the detonation. */
export function spawnFlashDisc(position: Vector3, color: Color, scale: number, life: number) {
  const disc = discs.find((candidate) => candidate.life < 0);
  if (!disc) return;
  disc.mesh.position.copy(position);
  disc.mesh.scale.setScalar(0.01);
  disc.material.color.setRGB(0, 0, 0);
  disc.mesh.visible = true;
  disc.color.copy(color);
  disc.age = 0;
  disc.life = life;
  disc.scale = scale;
}

function jitterBolt(bolt: Bolt) {
  const attribute = bolt.line.geometry.getAttribute('position') as Float32BufferAttribute;
  const array = attribute.array as Float32Array;
  scratchDirection.copy(bolt.to).sub(bolt.from);
  const length = scratchDirection.length();
  // Two perpendiculars to the bolt axis: the jag lives in that plane.
  scratchA.set(scratchDirection.y, -scratchDirection.x, scratchDirection.z * 0.3);
  if (scratchA.lengthSq() < 0.0001) scratchA.set(1, 0, 0);
  scratchA.normalize();
  scratchB.crossVectors(scratchDirection, scratchA).normalize();
  const amplitude = Math.max(0.25, length * 0.13) * bolt.spread;

  for (let i = 0; i < BOLT_SEGMENTS; i += 1) {
    const t = i / (BOLT_SEGMENTS - 1);
    // Pinned at both ends, wildest in the middle.
    const taper = Math.sin(t * Math.PI) ** 0.6;
    const jagA = (Math.random() - 0.5) * 2 * amplitude * taper;
    const jagB = (Math.random() - 0.5) * 2 * amplitude * taper;
    array[i * 3] = bolt.from.x + scratchDirection.x * t + scratchA.x * jagA + scratchB.x * jagB;
    array[i * 3 + 1] = bolt.from.y + scratchDirection.y * t + scratchA.y * jagA + scratchB.y * jagB;
    array[i * 3 + 2] = bolt.from.z + scratchDirection.z * t + scratchA.z * jagA + scratchB.z * jagB;
  }
  attribute.needsUpdate = true;
}

export function updateEffects(dt: number, camera: Camera) {
  if (splinterMesh) {
    let count = 0;
    for (let i = splinters.length - 1; i >= 0; i -= 1) {
      const splinter = splinters[i];
      splinter.age += dt;
      if (splinter.age >= splinter.life) {
        splinters.splice(i, 1);
        continue;
      }
      splinter.velocity.multiplyScalar(Math.max(0, 1 - splinter.drag * dt));
      splinter.position.addScaledVector(splinter.velocity, dt);
      const fade = 1 - splinter.age / splinter.life;
      scratchScale.set(splinter.width, splinter.width, splinter.length * (0.4 + fade * 0.8));
      scratchMatrix.compose(splinter.position, splinter.rotation, scratchScale);
      splinterMesh.setMatrixAt(count, scratchMatrix);
      // Additive blending: fading to black is fading to invisible.
      scratchColor.copy(splinter.color).multiplyScalar(fade * fade);
      splinterMesh.setColorAt(count, scratchColor);
      count += 1;
    }
    splinterMesh.count = count;
    splinterMesh.instanceMatrix.needsUpdate = true;
    if (splinterMesh.instanceColor) splinterMesh.instanceColor.needsUpdate = true;
  }

  for (const wave of shockwaves) {
    if (wave.life < 0) continue;
    wave.age += dt;
    if (wave.age >= wave.life) {
      wave.life = -1;
      wave.mesh.visible = false;
      continue;
    }
    const progress = wave.age / wave.life;
    const eased = 1 - (1 - progress) ** 2;
    wave.mesh.scale.setScalar(wave.fromScale + (wave.toScale - wave.fromScale) * eased);
    if (!wave.fixed) wave.mesh.quaternion.copy(camera.quaternion);
    (wave.mesh.material as MeshBasicMaterial).color.copy(wave.color).multiplyScalar((1 - progress) ** 1.6);
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
    glint.group.rotation.z += dt * 3.4;
    for (const material of glint.materials) material.color.copy(glint.color).multiplyScalar(envelope);
  }

  for (const bolt of bolts) {
    if (bolt.life < 0) continue;
    bolt.age += dt;
    if (bolt.age >= bolt.life) {
      bolt.life = -1;
      bolt.line.visible = false;
      continue;
    }
    bolt.nextJitter -= dt;
    if (bolt.nextJitter <= 0) {
      bolt.nextJitter = 0.026 + Math.random() * 0.024;
      jitterBolt(bolt);
    }
    // Flicker: an uneven strobe under the fade, so it dies like a real arc.
    const progress = bolt.age / bolt.life;
    const flicker = 0.45 + 0.55 * Math.abs(Math.sin(bolt.age * 61 + bolt.spread));
    bolt.material.color.copy(bolt.color).multiplyScalar((1 - progress) ** 1.4 * flicker);
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
    disc.mesh.quaternion.copy(camera.quaternion);
    disc.mesh.scale.setScalar(Math.max(0.01, disc.scale * (0.25 + progress * 1.1)));
    disc.material.color.copy(disc.color).multiplyScalar((1 - progress) ** 2.2);
  }
}

export function resetEffects() {
  splinters.length = 0;
  if (splinterMesh) splinterMesh.count = 0;
  for (const wave of shockwaves) {
    wave.life = -1;
    wave.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
  for (const bolt of bolts) {
    bolt.life = -1;
    bolt.line.visible = false;
  }
  for (const disc of discs) {
    disc.life = -1;
    disc.mesh.visible = false;
  }
}
