import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Quaternion,
  RingGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import type { Camera, Object3D, Scene } from 'three';
import { float, positionView, smoothstep, vec3 } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { createRibbonTrail, type RibbonTrail } from '../../../engine/ribbon-trail';
import { chamferBox } from './machine-kit';

// Effects in the level's language: painted debris and steel shards that
// tumble and splash into the river, sparks off struck steel, flat rings on the
// water, ribbon trails (the flare's smoke and glow, the skiffs' wakes) and the
// cables themselves. Every pool is fixed-size and allocated up front.

const DEBRIS_CAPACITY = 360;
const SPARK_CAPACITY = 420;
const RING_CAPACITY = 20;
const CABLE_SEGMENTS = 128;
const UP = new Vector3(0, 1, 0);

export type EffectColors = {
  paint: Color;
  steel: Color;
  darkSteel: Color;
  spark: Color;
  smoke: Color;
  flareGlow: Color;
  heat: Color;
  wake: Color;
  cable: Color;
};

export type EffectsWorld = {
  /** Water surface height under a point. */
  waterAt(x: number, z: number): number;
  /** Splash a burst of spray at a point on the water. */
  splash(at: Vector3, count: number, speed: number, size: number): void;
};

type Chunk = {
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  rotation: Quaternion;
  spin: number;
  size: number;
  color: Color;
  age: number;
  life: number;
  water: number;
};

type Spark = { position: Vector3; velocity: Vector3; color: Color; age: number; life: number; width: number };

type Ring = { mesh: Mesh; color: Color; age: number; life: number; size: number; flat: boolean };

type Trail = { ribbon: RibbonTrail; busy: boolean; retiredAt: number; linger: number };

export type TrailHandle = { push(point: Vector3): void; retire(): void };

export type CableDraw = { points: Vector3[]; radius: number };

export function createEffects(scene: Scene, colors: EffectColors, world: EffectsWorld) {
  const root: Object3D[] = [];
  let clock = 0;

  // ---- debris: painted chunks and steel shards ----
  const chunkMaterial = new MeshStandardNodeMaterial({ metalness: 0.5, roughness: 0.55 });
  const debris = new InstancedMesh(chamferBox(1, 0.7, 0.9, 0.15), chunkMaterial, DEBRIS_CAPACITY);
  const chunks: Chunk[] = [];

  // ---- sparks: additive streaks stretched along their velocity ----
  const sparkMaterial = new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false });
  const sparksMesh = new InstancedMesh(new TetrahedronGeometry(0.5, 0).scale(0.25, 0.25, 1.6), sparkMaterial, SPARK_CAPACITY);
  const sparks: Spark[] = [];

  for (const mesh of [debris, sparksMesh]) {
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.userData.raildIgnoreOcclusion = true;
    mesh.setColorAt(0, new Color());
    root.push(mesh);
  }

  // ---- rings: flat on the water for splashes, facing the camera in the air ----
  const ringGeometry = new RingGeometry(0.9, 1, 48);
  const rings: Ring[] = [];
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeometry, new MeshBasicMaterial({ color: 0x000000, transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }));
    mesh.visible = false;
    mesh.userData.raildIgnoreOcclusion = true;
    rings.push({ mesh, color: new Color(), age: 0, life: -1, size: 1, flat: false });
    root.push(mesh);
  }

  // ---- ribbon trails ----
  // Trails the camera flies into would fill the lens: they thin out close up.
  const nearFade = (near: number, far: number) => smoothstep(near, far, positionView.z.negate());
  const createPool = (count: number, make: () => RibbonTrail, linger: number): Trail[] =>
    Array.from({ length: count }, () => {
      const ribbon = make();
      ribbon.mesh.userData.raildIgnoreOcclusion = true;
      root.push(ribbon.mesh);
      return { ribbon, busy: false, retiredAt: -1, linger };
    });
  const smoke = createPool(16, () => createRibbonTrail({
    points: 30,
    minSpacing: 0.45,
    blending: NormalBlending,
    fog: true,
    color: colors.smoke,
    width: ({ age }) => age.mul(0.6).add(0.08).min(0.6),
    fade: ({ t, age }) => float(1).sub(t).mul(age.mul(-2).exp()).mul(nearFade(6, 18)).mul(0.4),
  }), 1.1);
  const glow = createPool(16, () => createRibbonTrail({
    points: 10,
    minSpacing: 0.3,
    color: colors.flareGlow,
    width: ({ t }) => float(0.2).mul(float(1).sub(t)),
    fade: ({ t, age }) => float(1).sub(t).pow(2).mul(age.mul(-7).exp()).mul(nearFade(2, 6)),
  }), 0.35);
  // A rivet's short, fat orange heat trail: wider and duller than the flare's thin red glow.
  const heat = createPool(10, () => createRibbonTrail({
    points: 12,
    minSpacing: 0.35,
    color: colors.heat,
    width: ({ t }) => float(0.55).mul(float(1).sub(t).pow(0.6)),
    fade: ({ t, age }) => float(1).sub(t).pow(1.5).mul(age.mul(-5).exp()).mul(nearFade(3, 9)),
  }), 0.4);
  const wakes = createPool(18, () => createRibbonTrail({
    points: 40,
    minSpacing: 0.7,
    blending: NormalBlending,
    fog: true,
    color: colors.wake,
    width: ({ age }) => age.mul(0.8).add(0.3).min(1.8),
    fade: ({ t, age }) => float(1).sub(t).mul(age.mul(-0.9).exp()).mul(nearFade(3, 10)).mul(0.5),
  }), 2.5);

  function claim(pool: Trail[]): TrailHandle | null {
    const trail = pool.find((entry) => !entry.busy);
    if (!trail) return null;
    trail.busy = true;
    trail.retiredAt = -1;
    trail.ribbon.reset();
    return {
      push: (point) => {
        if (trail.retiredAt < 0) trail.ribbon.pushPoint(point);
      },
      retire: () => {
        if (trail.retiredAt < 0) trail.retiredAt = clock;
      },
    };
  }

  // ---- cables: steel segments between the points gameplay reports ----
  const cableMaterial = new MeshStandardNodeMaterial({ metalness: 0.7, roughness: 0.45 });
  cableMaterial.colorNode = vec3(colors.cable.r, colors.cable.g, colors.cable.b);
  const cableMesh = new InstancedMesh(new CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0), cableMaterial, CABLE_SEGMENTS);
  cableMesh.instanceMatrix.setUsage(DynamicDrawUsage);
  cableMesh.count = 0;
  cableMesh.frustumCulled = false;
  cableMesh.userData.raildIgnoreOcclusion = true;
  root.push(cableMesh);

  for (const object of root) scene.add(object);

  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const color = new Color();
  const direction = new Vector3();
  const along = new Vector3();
  const overhead = new Vector3();

  function randomUnit(out = new Vector3()) {
    const z = Math.random() * 2 - 1;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - z * z);
    return out.set(Math.cos(angle) * r, Math.sin(angle) * r, z);
  }

  return {
    /** Chunks of the machine: painted plate and bare steel, thrown up and falling into the river. */
    debris(at: Vector3, count: number, speed: number, size: number, tint: Array<Color> = [colors.paint, colors.steel, colors.darkSteel]) {
      for (let i = 0; i < count; i += 1) {
        if (chunks.length >= DEBRIS_CAPACITY) chunks.shift();
        const velocity = randomUnit();
        velocity.y = Math.abs(velocity.y) * 0.8 + 0.35;
        chunks.push({
          position: at.clone(),
          velocity: velocity.multiplyScalar(speed * (0.35 + Math.random() * 0.8)),
          axis: randomUnit(),
          rotation: new Quaternion(),
          spin: 4 + Math.random() * 10,
          size: size * (0.35 + Math.random() * 0.8),
          color: tint[i % tint.length],
          age: 0,
          life: 1.4 + Math.random() * 0.6,
          water: world.waterAt(at.x, at.z),
        });
      }
    },

    sparks(at: Vector3, count: number, speed: number, tint = colors.spark, life = 0.4) {
      for (let i = 0; i < count; i += 1) {
        if (sparks.length >= SPARK_CAPACITY) sparks.shift();
        sparks.push({
          position: at.clone(),
          velocity: randomUnit().multiplyScalar(speed * (0.4 + Math.random() * 0.8)),
          color: tint,
          age: 0,
          life: life * (0.6 + Math.random() * 0.7),
          width: 0.6 + Math.random() * 0.6,
        });
      }
    },

    /** A ring that grows and fades: `flat` lies on the water, otherwise it faces the camera. */
    ring(at: Vector3, tint: Color, size: number, life: number, flat = false) {
      const ring = rings.find((entry) => entry.life < 0) ?? rings.reduce((oldest, entry) => (entry.age / entry.life > oldest.age / oldest.life ? entry : oldest));
      ring.mesh.position.copy(at);
      ring.mesh.visible = true;
      ring.color.copy(tint);
      ring.age = 0;
      ring.life = life;
      ring.size = size;
      ring.flat = flat;
    },

    smokeTrail: () => claim(smoke),
    glowTrail: () => claim(glow),
    heatTrail: () => claim(heat),
    wake: () => claim(wakes),

    update(dt: number, camera: Camera, cables: CableDraw[]) {
      clock += dt;

      let count = 0;
      for (let i = chunks.length - 1; i >= 0; i -= 1) {
        const chunk = chunks[i];
        chunk.age += dt;
        if (chunk.age >= chunk.life) {
          chunks.splice(i, 1);
          continue;
        }
        chunk.velocity.y -= 22 * dt;
        chunk.velocity.multiplyScalar(Math.max(0, 1 - dt * 0.4));
        chunk.position.addScaledVector(chunk.velocity, dt);
        if (chunk.position.y < chunk.water && chunk.velocity.y < 0) {
          // Into the river: a small splash, then it sinks out of sight.
          if (chunk.velocity.y < -4) world.splash(chunk.position, 6, 3, 0.35);
          chunk.velocity.multiplyScalar(0.15);
          chunk.life = Math.min(chunk.life, chunk.age + 0.4);
        }
        quaternion.setFromAxisAngle(chunk.axis, chunk.spin * dt);
        chunk.rotation.premultiply(quaternion).normalize();
        // Shrink out at the end of life and near the lens: the camera flies through the debris field.
        const shrink = Math.min(1, (chunk.life - chunk.age) / 0.4, Math.max(0, chunk.position.distanceTo(camera.position) - 2) / 5);
        matrix.compose(chunk.position, chunk.rotation, scale.setScalar(chunk.size * shrink));
        debris.setMatrixAt(count, matrix);
        debris.setColorAt(count, chunk.color);
        count += 1;
      }
      debris.count = count;
      debris.instanceMatrix.needsUpdate = true;
      if (debris.instanceColor) debris.instanceColor.needsUpdate = true;

      count = 0;
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const spark = sparks[i];
        spark.age += dt;
        if (spark.age >= spark.life) {
          sparks.splice(i, 1);
          continue;
        }
        spark.velocity.y -= 14 * dt;
        spark.velocity.multiplyScalar(Math.max(0, 1 - dt * 2.5));
        spark.position.addScaledVector(spark.velocity, dt);
        const fade = 1 - spark.age / spark.life;
        const speed = spark.velocity.length();
        direction.copy(spark.velocity).divideScalar(Math.max(speed, 1e-3));
        quaternion.setFromUnitVectors(along.set(0, 0, 1), direction);
        matrix.compose(spark.position, quaternion, scale.set(spark.width * fade, spark.width * fade, 0.3 + speed * 0.05));
        sparksMesh.setMatrixAt(count, matrix);
        sparksMesh.setColorAt(count, color.copy(spark.color).multiplyScalar(fade));
        count += 1;
      }
      sparksMesh.count = count;
      sparksMesh.instanceMatrix.needsUpdate = true;
      if (sparksMesh.instanceColor) sparksMesh.instanceColor.needsUpdate = true;

      for (const ring of rings) {
        if (ring.life < 0) continue;
        ring.age += dt;
        if (ring.age >= ring.life) {
          ring.life = -1;
          ring.mesh.visible = false;
          continue;
        }
        const progress = ring.age / ring.life;
        ring.mesh.scale.setScalar(ring.size * (0.15 + 0.85 * (1 - (1 - progress) ** 2)));
        if (ring.flat) ring.mesh.quaternion.setFromUnitVectors(along.set(0, 0, 1), UP);
        else ring.mesh.quaternion.copy(camera.quaternion);
        (ring.mesh.material as MeshBasicMaterial).color.copy(ring.color).multiplyScalar((1 - progress) ** 1.5);
      }

      // Wakes face a point high overhead, which lays them flat on the water.
      overhead.copy(camera.position).y += 400;
      for (const pool of [smoke, glow, heat, wakes]) {
        for (const trail of pool) {
          if (!trail.busy) continue;
          if (trail.retiredAt >= 0 && clock - trail.retiredAt > trail.linger) {
            trail.busy = false;
            trail.ribbon.reset();
            continue;
          }
          trail.ribbon.update(dt, pool === wakes ? overhead : camera.position);
        }
      }

      count = 0;
      for (const cable of cables) {
        for (let i = 1; i < cable.points.length && count < CABLE_SEGMENTS; i += 1) {
          const from = cable.points[i - 1];
          direction.subVectors(cable.points[i], from);
          const length = direction.length();
          if (length < 1e-3) continue;
          quaternion.setFromUnitVectors(UP, direction.divideScalar(length));
          matrix.compose(from, quaternion, scale.set(cable.radius, length, cable.radius));
          cableMesh.setMatrixAt(count, matrix);
          count += 1;
        }
      }
      cableMesh.count = count;
      cableMesh.instanceMatrix.needsUpdate = true;
    },

    reset() {
      chunks.length = 0;
      sparks.length = 0;
      debris.count = 0;
      sparksMesh.count = 0;
      cableMesh.count = 0;
      for (const ring of rings) {
        ring.life = -1;
        ring.mesh.visible = false;
      }
      for (const pool of [smoke, glow, heat, wakes]) {
        for (const trail of pool) {
          trail.busy = false;
          trail.ribbon.reset();
        }
      }
    },

    dispose() {
      for (const object of root) object.removeFromParent();
      for (const pool of [smoke, glow, heat, wakes]) for (const trail of pool) trail.ribbon.dispose();
      debris.dispose();
      sparksMesh.dispose();
      cableMesh.dispose();
    },
  };
}

export type Effects = ReturnType<typeof createEffects>;
