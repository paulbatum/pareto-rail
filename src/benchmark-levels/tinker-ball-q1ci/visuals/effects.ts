import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import type { Camera, Material, Object3D } from 'three';
import { createSupplyPiece } from './models';
import { CORAL, CREAM, CYAN, GLUE_BLACK, SUPPLY_COLORS, hdr } from './palette';

type RingEffect = {
  mesh: Mesh;
  age: number;
  life: number;
  from: number;
  to: number;
};

type SparkEffect = {
  mesh: Mesh;
  velocity: Vector3;
  spin: Vector3;
  age: number;
  life: number;
  gravity: number;
};

type DebrisEffect = {
  object: Object3D;
  kind: string;
  velocity: Vector3;
  spin: Vector3;
  age: number;
  mode: 'scatter' | 'collect';
  collectT: number;
  collectFrom: Vector3;
  direction: Vector3;
  surfaceOffset: number;
};

type AttachedPiece = {
  object: Object3D;
  direction: Vector3;
  surfaceOffset: number;
};

export type WorkshopEffects = {
  ring(position: Vector3, color: Color, from?: number, to?: number, life?: number): void;
  sparks(position: Vector3, color: Color, count?: number, speed?: number): void;
  glueSplash(position: Vector3, count?: number): void;
  rescuedDebris(position: Vector3, kind: string, count?: number): void;
  trail(position: Vector3, color?: Color): void;
  update(dt: number, elapsed: number, camera: Camera): void;
  reset(): void;
  attachedCount(): number;
  dispose(): void;
};

const ringGeometry = new RingGeometry(0.72, 0.82, 32);
const sparkGeometry = new BoxGeometry(0.12, 0.12, 0.46);
const trailGeometry = new SphereGeometry(0.09, 6, 4);

function deterministicDirection(index: number, salt: number) {
  const angle = index * 2.399963 + salt * 0.731;
  const y = 0.2 + ((index * 37 + salt * 17) % 11) / 10;
  return new Vector3(Math.cos(angle), y, Math.sin(angle)).normalize();
}

function surfaceDirection(index: number, salt: number) {
  const angle = index * 2.399963 + salt * 0.517;
  const y = -0.82 + ((index * 29 + salt * 13) % 18) / 10;
  const radial = Math.sqrt(Math.max(0.05, 1 - Math.min(0.95, y * y)));
  return new Vector3(Math.cos(angle) * radial, y, Math.sin(angle) * radial).normalize();
}

function disposeMaterials(object: Object3D) {
  const materials = new Set<Material>();
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of childMaterials) materials.add(material);
  });
  for (const material of materials) material.dispose();
}

export function createWorkshopEffects(scene: Scene, ball: Group): WorkshopEffects {
  const rings: RingEffect[] = [];
  const sparks: SparkEffect[] = [];
  const debris: DebrisEffect[] = [];
  const attached: AttachedPiece[] = [];
  let trailCursor = 0;

  const removeRing = (index: number) => {
    const [effect] = rings.splice(index, 1);
    scene.remove(effect.mesh);
    (effect.mesh.material as Material).dispose();
  };

  const removeSpark = (index: number) => {
    const [effect] = sparks.splice(index, 1);
    scene.remove(effect.mesh);
    (effect.mesh.material as Material).dispose();
  };

  const dropDebris = (index: number, keepMaterials = false) => {
    const [effect] = debris.splice(index, 1);
    scene.remove(effect.object);
    if (!keepMaterials) disposeMaterials(effect.object);
  };

  const api: WorkshopEffects = {
    ring(position, color, from = 0.5, to = 3.2, life = 0.42) {
      if (rings.length >= 54) removeRing(0);
      const material = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(ringGeometry, material);
      mesh.position.copy(position);
      mesh.scale.setScalar(from);
      mesh.userData.raildIgnoreOcclusion = true;
      scene.add(mesh);
      rings.push({ mesh, age: 0, life, from, to });
    },
    sparks(position, color, count = 8, speed = 4) {
      for (let index = 0; index < count; index += 1) {
        if (sparks.length >= 190) removeSpark(0);
        const material = new MeshBasicMaterial({
          color: hdr(color, 0.9 + (index % 3) * 0.25),
          transparent: true,
          opacity: 0.96,
          depthWrite: false,
        });
        const mesh = new Mesh(sparkGeometry, material);
        mesh.position.copy(position);
        mesh.scale.setScalar(0.65 + (index % 4) * 0.14);
        mesh.userData.raildIgnoreOcclusion = true;
        scene.add(mesh);
        const direction = deterministicDirection(index, Math.round(position.x + position.z));
        sparks.push({
          mesh,
          velocity: direction.multiplyScalar(speed * (0.55 + (index % 5) * 0.12)),
          spin: deterministicDirection(index + 7, 3).multiplyScalar(5 + index % 3),
          age: 0,
          life: 0.48 + (index % 4) * 0.08,
          gravity: 4.5,
        });
      }
    },
    glueSplash(position, count = 7) {
      api.ring(position, GLUE_BLACK, 0.35, 2.5, 0.36);
      api.sparks(position, GLUE_BLACK, count, 2.6);
      api.sparks(position, CORAL, Math.max(2, Math.floor(count / 3)), 3.2);
    },
    rescuedDebris(position, kind, count = 5) {
      // One rescued object seats immediately so the ball's silhouette records
      // every kill even before the rest of that body's debris has caught up.
      if (attached.length < 116) {
        const object = createSupplyPiece(kind, attached.length + count);
        const direction = surfaceDirection(attached.length, kind.length);
        const surfaceOffset = 0.4 + (attached.length % 4) * 0.12;
        object.userData.raildIgnoreOcclusion = true;
        object.userData.collectedPiece = true;
        object.scale.multiplyScalar(1.08);
        ball.add(object);
        object.position.copy(direction).multiplyScalar(Number(ball.userData.radius ?? 1) + surfaceOffset);
        attached.push({ object, direction, surfaceOffset });
        ball.userData.collectedCount = attached.length;
      }

      for (let index = 0; index < Math.max(1, count - 1); index += 1) {
        if (debris.length >= 150) dropDebris(0);
        const object = createSupplyPiece(kind, index);
        object.position.copy(position);
        object.position.add(deterministicDirection(index, kind.length).multiplyScalar(0.2 + index * 0.04));
        object.scale.multiplyScalar(0.78 + (index % 4) * 0.09);
        object.userData.raildIgnoreOcclusion = true;
        scene.add(object);
        const direction = deterministicDirection(index, kind.length + Math.round(position.x));
        debris.push({
          object,
          kind,
          velocity: direction.multiplyScalar(2.8 + (index % 4) * 0.75),
          spin: deterministicDirection(index + 9, kind.length).multiplyScalar(2.5 + index * 0.3),
          age: 0,
          mode: 'scatter',
          collectT: 0,
          collectFrom: new Vector3(),
          direction: surfaceDirection(index + attached.length, kind.length * 3),
          surfaceOffset: 0.3 + (index % 4) * 0.105,
        });
      }
    },
    trail(position, color = CYAN) {
      trailCursor += 1;
      if (trailCursor % 3 !== 0) return;
      if (sparks.length >= 190) removeSpark(0);
      const material = new MeshBasicMaterial({
        color: hdr(color, 1.4),
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      });
      const mesh = new Mesh(trailGeometry, material);
      mesh.position.copy(position);
      mesh.userData.raildIgnoreOcclusion = true;
      scene.add(mesh);
      sparks.push({
        mesh,
        velocity: new Vector3(0, 0.12, 0),
        spin: new Vector3(),
        age: 0,
        life: 0.22,
        gravity: 0,
      });
    },
    update(dt, elapsed, camera) {
      for (let index = rings.length - 1; index >= 0; index -= 1) {
        const effect = rings[index];
        effect.age += dt;
        if (effect.age >= effect.life) {
          removeRing(index);
          continue;
        }
        const t = effect.age / effect.life;
        const eased = 1 - (1 - t) ** 3;
        effect.mesh.scale.setScalar(effect.from + (effect.to - effect.from) * eased);
        effect.mesh.quaternion.copy(camera.quaternion);
        (effect.mesh.material as MeshBasicMaterial).opacity = (1 - t) * 0.82;
      }

      for (let index = sparks.length - 1; index >= 0; index -= 1) {
        const effect = sparks[index];
        effect.age += dt;
        if (effect.age >= effect.life) {
          removeSpark(index);
          continue;
        }
        effect.velocity.y -= effect.gravity * dt;
        effect.mesh.position.addScaledVector(effect.velocity, dt);
        effect.mesh.rotation.x += effect.spin.x * dt;
        effect.mesh.rotation.y += effect.spin.y * dt;
        effect.mesh.rotation.z += effect.spin.z * dt;
        const t = effect.age / effect.life;
        effect.mesh.scale.multiplyScalar(Math.max(0.86, 1 - dt * 2.2));
        (effect.mesh.material as MeshBasicMaterial).opacity = (1 - t) * 0.9;
      }

      for (let index = debris.length - 1; index >= 0; index -= 1) {
        const piece = debris[index];
        piece.age += dt;
        piece.object.rotation.x += piece.spin.x * dt;
        piece.object.rotation.y += piece.spin.y * dt;
        piece.object.rotation.z += piece.spin.z * dt;

        if (piece.mode === 'scatter') {
          piece.velocity.y -= 7.2 * dt;
          piece.object.position.addScaledVector(piece.velocity, dt);
          if (piece.object.position.y < 0.24) {
            piece.object.position.y = 0.24;
            piece.velocity.y = Math.abs(piece.velocity.y) * 0.32;
            piece.velocity.x *= 0.82;
            piece.velocity.z *= 0.82;
          }
          const ballDistance = piece.object.position.distanceTo(ball.position);
          if ((piece.age > 0.65 && ballDistance < 19) || piece.age > 1.85) {
            piece.mode = 'collect';
            piece.collectFrom.copy(piece.object.position);
            piece.collectT = 0;
          }
          continue;
        }

        piece.collectT = Math.min(1, piece.collectT + dt / 0.62);
        const t = piece.collectT;
        const eased = t * t * (3 - 2 * t);
        const radius = Number(ball.userData.radius ?? 1);
        const localTarget = piece.direction.clone().multiplyScalar(radius + piece.surfaceOffset);
        const worldTarget = ball.localToWorld(localTarget.clone());
        const arcTarget = piece.collectFrom.clone().lerp(worldTarget, eased);
        arcTarget.y += Math.sin(Math.PI * t) * (1.4 + piece.surfaceOffset * 2);
        piece.object.position.copy(arcTarget);
        piece.object.scale.multiplyScalar(1 + dt * 0.28);

        if (t < 1) continue;
        if (attached.length < 116) {
          scene.remove(piece.object);
          ball.add(piece.object);
          piece.object.userData.collectedPiece = true;
          piece.object.position.copy(piece.direction).multiplyScalar(radius + piece.surfaceOffset);
          piece.object.scale.multiplyScalar(0.95);
          attached.push({
            object: piece.object,
            direction: piece.direction.clone(),
            surfaceOffset: piece.surfaceOffset,
          });
          debris.splice(index, 1);
          ball.userData.collectedCount = attached.length;
          api.ring(ball.position, SUPPLY_COLORS[attached.length % SUPPLY_COLORS.length], radius * 0.35, radius * 0.78, 0.24);
        } else {
          dropDebris(index);
        }
      }

      const radius = Number(ball.userData.radius ?? 1);
      for (const piece of attached) {
        piece.object.position.copy(piece.direction).multiplyScalar(radius + piece.surfaceOffset);
        piece.object.rotation.y += dt * 0.15;
      }

      // A tiny cream glint near the collected mass sells stickiness without
      // turning the ball into a bloom-only read.
      if (attached.length > 0 && Math.floor(elapsed * 4) % 9 === 0 && sparks.length < 175) {
        const direction = deterministicDirection(Math.floor(elapsed * 7), attached.length);
        const world = ball.localToWorld(direction.multiplyScalar(radius + 0.2));
        api.trail(world, CREAM);
      }
    },
    reset() {
      while (rings.length) removeRing(rings.length - 1);
      while (sparks.length) removeSpark(sparks.length - 1);
      while (debris.length) dropDebris(debris.length - 1);
      for (const piece of attached) {
        ball.remove(piece.object);
        disposeMaterials(piece.object);
      }
      attached.length = 0;
      ball.userData.collectedCount = 0;
      trailCursor = 0;
    },
    attachedCount() {
      return attached.length;
    },
    dispose() {
      api.reset();
      ringGeometry.dispose();
      sparkGeometry.dispose();
      trailGeometry.dispose();
    },
  };

  return api;
}
