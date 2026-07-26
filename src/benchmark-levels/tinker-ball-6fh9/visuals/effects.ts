import {
  Camera,
  Color,
  CylinderGeometry,
  BoxGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { PieceShape, PieceSpec } from './creatures';
import { GLUE_BLACK } from './palette';

// Transient effects: rescued pieces that scatter, bounce on the table, then
// zip into the rolling ball; dark glue droplets that splat; expanding rings;
// and star glints. Pieces are the level's signature loop — every kill feeds
// the ball — so they get the richest behavior.

const PIECE_CAPACITY = 96;
const GOO_CAPACITY = 96;
const RING_CAPACITY = 24;
const GLINT_CAPACITY = 12;

const GRAVITY = -26;

type PiecePhase = 'fly' | 'rest' | 'magnet';

type PieceParticle = {
  shape: PieceShape;
  position: Vector3;
  velocity: Vector3;
  axis: Vector3; // unit length: feeds setFromAxisAngle every frame
  rotation: Quaternion;
  spin: number;
  color: Color;
  size: number;
  age: number;
  life: number;
  phase: PiecePhase;
  restTimer: number;
};

type GooParticle = {
  position: Vector3;
  velocity: Vector3;
  size: number;
  age: number;
  life: number;
  grounded: boolean;
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

const pieces: PieceParticle[] = [];
const goo: GooParticle[] = [];
const rings: RingEffect[] = [];
const glints: GlintEffect[] = [];

let pieceMeshes: Record<PieceShape, InstancedMesh> | null = null;
let gooMesh: InstancedMesh | null = null;

const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchScale = new Vector3();
const scratchColor = new Color();
const toBall = new Vector3();

export function createEffects(scene: Scene) {
  pieceMeshes = {
    disc: new InstancedMesh(
      new CylinderGeometry(0.5, 0.47, 0.16, 10),
      new MeshBasicMaterial({ blending: NormalBlending, depthWrite: true }),
      PIECE_CAPACITY,
    ),
    box: new InstancedMesh(
      new BoxGeometry(0.5, 0.34, 0.42),
      new MeshBasicMaterial({ blending: NormalBlending, depthWrite: true }),
      PIECE_CAPACITY,
    ),
    stick: new InstancedMesh(
      new CylinderGeometry(0.05, 0.05, 1, 6),
      new MeshBasicMaterial({ blending: NormalBlending, depthWrite: true }),
      PIECE_CAPACITY,
    ),
    ball: new InstancedMesh(
      new SphereGeometry(0.5, 8, 6),
      new MeshBasicMaterial({ blending: NormalBlending, depthWrite: true }),
      PIECE_CAPACITY,
    ),
  };
  for (const mesh of Object.values(pieceMeshes)) {
    mesh.count = 0;
    mesh.frustumCulled = false;
    // Sub-unit transient particles: exclude them from target-occlusion
    // analysis the same way the engine excludes projectiles.
    mesh.userData.raildIgnoreOcclusion = true;
    scene.add(mesh);
  }

  gooMesh = new InstancedMesh(
    new SphereGeometry(0.5, 7, 5),
    new MeshBasicMaterial({ color: GLUE_BLACK.clone().multiplyScalar(1.4), blending: NormalBlending, depthWrite: true }),
    GOO_CAPACITY,
  );
  gooMesh.count = 0;
  gooMesh.frustumCulled = false;
  gooMesh.userData.raildIgnoreOcclusion = true;
  scene.add(gooMesh);

  const ringGeometry = new RingGeometry(0.96, 1, 48);
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, createAdditiveBasicMaterial({ color: 0x000000, side: DoubleSide }));
    mesh.visible = false;
    scene.add(mesh);
    rings.push({ mesh, color: new Color(), age: 0, life: -1, fromScale: 0, toScale: 1 });
  }

  const bladeGeometry = new PlaneGeometry(1.7, 0.055);
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
}

/** A defeated body breaks into its own pieces; they scatter, land, then chase the ball. */
export function scatterPieces(position: Vector3, specs: PieceSpec[] | undefined) {
  if (!specs) return;
  for (const spec of specs) {
    if (pieces.length >= PIECE_CAPACITY) pieces.shift();
    const outward = spec.direction.clone().normalize();
    pieces.push({
      shape: spec.shape,
      position: position.clone().addScaledVector(outward, 0.3),
      velocity: outward.multiplyScalar(4.5 + Math.random() * 4).add(new Vector3(0, 3.5 + Math.random() * 3, 0)),
      axis: randomUnit(),
      rotation: new Quaternion().setFromAxisAngle(randomUnit(), Math.random() * Math.PI * 2),
      spin: 5 + Math.random() * 9,
      color: spec.color.clone(),
      size: spec.size,
      age: 0,
      life: 8,
      phase: 'fly',
      restTimer: 0.4 + Math.random() * 0.9,
    });
  }
}

/** Dark glue droplets for glob deaths, shell chips, and the spill itself. */
export function burstGoo(position: Vector3, count: number, speed: number) {
  for (let i = 0; i < count; i += 1) {
    if (goo.length >= GOO_CAPACITY) goo.shift();
    const direction = randomUnit();
    direction.y = Math.abs(direction.y) * 0.7 + 0.25;
    goo.push({
      position: position.clone(),
      velocity: direction.multiplyScalar(speed * (0.5 + Math.random() * 0.8)),
      size: 0.14 + Math.random() * 0.2,
      age: 0,
      life: 0.9 + Math.random() * 0.5,
      grounded: false,
    });
  }
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

export type CollectPiece = (shape: PieceShape, color: Color, size: number) => void;

export function updateEffects(
  dt: number,
  camera: Camera,
  ballPosition: Vector3,
  ballRadius: number,
  onCollect: CollectPiece,
) {
  if (pieceMeshes) {
    for (let i = pieces.length - 1; i >= 0; i -= 1) {
      const piece = pieces[i];
      piece.age += dt;
      if (piece.age >= piece.life) {
        pieces.splice(i, 1);
        continue;
      }

      if (piece.phase === 'magnet') {
        // Chase the ball and vanish into it: the collect moment.
        toBall.copy(ballPosition).sub(piece.position);
        const distance = toBall.length();
        if (distance < ballRadius * 1.05) {
          onCollect(piece.shape, piece.color, piece.size);
          pieces.splice(i, 1);
          continue;
        }
        const pull = Math.min(34, 10 + piece.age * 22);
        piece.velocity.lerp(toBall.normalize().multiplyScalar(pull), Math.min(1, dt * 6));
        piece.position.addScaledVector(piece.velocity, dt);
      } else {
        piece.velocity.y += GRAVITY * dt;
        piece.position.addScaledVector(piece.velocity, dt);
        const floor = piece.size * 0.22;
        if (piece.position.y <= floor) {
          piece.position.y = floor;
          if (Math.abs(piece.velocity.y) > 2.4) {
            piece.velocity.y = Math.abs(piece.velocity.y) * 0.38;
            piece.velocity.x *= 0.7;
            piece.velocity.z *= 0.7;
            piece.spin *= 0.6;
          } else {
            piece.velocity.set(0, 0, 0);
            piece.spin = 0;
            piece.phase = 'rest';
            piece.restTimer -= dt;
            if (piece.restTimer <= 0) piece.phase = 'magnet';
          }
        }
      }

      if (piece.spin > 0) {
        scratchQuaternion.setFromAxisAngle(piece.axis, piece.spin * dt);
        piece.rotation.premultiply(scratchQuaternion).normalize();
      }
    }
    writePieceInstances(pieceMeshes);
  }

  if (gooMesh) {
    let count = 0;
    for (let i = goo.length - 1; i >= 0; i -= 1) {
      const drop = goo[i];
      drop.age += dt;
      if (drop.age >= drop.life) {
        goo.splice(i, 1);
        continue;
      }
      if (!drop.grounded) {
        drop.velocity.y += GRAVITY * dt;
        drop.position.addScaledVector(drop.velocity, dt);
        if (drop.position.y <= drop.size * 0.4) {
          drop.position.y = drop.size * 0.4;
          drop.grounded = true;
        }
      }
      const progress = drop.age / drop.life;
      const squash = drop.grounded ? 0.3 : 1;
      scratchScale.set(drop.size * (1 + progress * (drop.grounded ? 1.6 : 0.2)), drop.size * squash * (1 - progress * 0.6), drop.size * (1 + progress * (drop.grounded ? 1.6 : 0.2)));
      scratchMatrix.compose(drop.position, scratchQuaternion.identity(), scratchScale);
      gooMesh.setMatrixAt(count, scratchMatrix);
      count += 1;
    }
    gooMesh.count = count;
    gooMesh.instanceMatrix.needsUpdate = true;
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
    for (const material of glint.materials) {
      material.color.copy(glint.color).multiplyScalar(envelope);
    }
  }
}

function writePieceInstances(meshes: Record<PieceShape, InstancedMesh>) {
  for (const shape of Object.keys(meshes) as PieceShape[]) {
    const mesh = meshes[shape];
    let count = 0;
    for (const piece of pieces) {
      if (piece.shape !== shape) continue;
      const fadeIn = Math.min(1, piece.age / 0.08);
      scratchScale.setScalar(piece.size * 2 * fadeIn);
      if (shape === 'stick') scratchScale.y = piece.size * 2.4;
      scratchMatrix.compose(piece.position, piece.rotation, scratchScale);
      mesh.setMatrixAt(count, scratchMatrix);
      scratchColor.copy(piece.color);
      mesh.setColorAt(count, scratchColor);
      count += 1;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

export function resetEffects() {
  pieces.length = 0;
  goo.length = 0;
  if (pieceMeshes) for (const mesh of Object.values(pieceMeshes)) mesh.count = 0;
  if (gooMesh) gooMesh.count = 0;
  for (const ring of rings) {
    ring.life = -1;
    ring.mesh.visible = false;
  }
  for (const glint of glints) {
    glint.life = -1;
    glint.group.visible = false;
  }
}

function randomUnit(): Vector3 {
  const z = Math.random() * 2 - 1;
  const angle = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return new Vector3(Math.cos(angle) * r, Math.sin(angle) * r, z);
}
