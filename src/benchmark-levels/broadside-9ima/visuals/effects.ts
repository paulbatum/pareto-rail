import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  CRIMSON_FIRE,
  CYAN_BOLT,
  FRIENDLY_CYAN_HOT,
  hdr,
  MOLTEN_ORANGE_HOT,
  SPARKS_GOLD,
} from './palette';

const MAX_SPARKS = 400;
const sparkPositions = new Float32Array(MAX_SPARKS * 3);
const sparkColors = new Float32Array(MAX_SPARKS * 3);

type Spark = {
  pos: Vector3;
  vel: Vector3;
  color: Color;
  age: number;
  life: number;
  size: number;
};

type RingEffect = {
  mesh: Mesh;
  age: number;
  life: number;
  startScale: number;
  endScale: number;
  baseColor: Color;
};

type BeamEffect = {
  mesh: Mesh;
  age: number;
  life: number;
  startRadius: number;
  baseColor: Color;
};

export type EffectsSystem = {
  root: Group;
  spawnExplosion(pos: Vector3, count?: number, color?: Color, speed?: number): void;
  spawnShockwave(pos: Vector3, maxRadius?: number, duration?: number, color?: Color): void;
  spawnBroadsideBeam(from: Vector3, to: Vector3, color?: Color, radius?: number, duration?: number): void;
  spawnFlash(pos: Vector3, size?: number, color?: Color, duration?: number): void;
  update(dt: number): void;
  clear(): void;
};

export function createEffectsSystem(scene: Scene): EffectsSystem {
  const root = new Group();
  root.userData.raildIgnoreOcclusion = true;

  // Particle sparks system
  const sparksGeometry = new BufferGeometry();
  sparksGeometry.setAttribute('position', new Float32BufferAttribute(sparkPositions, 3));
  sparksGeometry.setAttribute('color', new Float32BufferAttribute(sparkColors, 3));

  const sparksMaterial = new PointsMaterial({
    size: 0.8,
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });

  const sparksPoints = new Points(sparksGeometry, sparksMaterial);
  sparksPoints.frustumCulled = false;
  sparksPoints.userData.raildIgnoreOcclusion = true;
  root.add(sparksPoints);

  const sparks: Spark[] = [];

  // Ring shockwaves pool
  const ringGeometry = new RingGeometry(0.8, 1.0, 32);
  const ringPool: RingEffect[] = [];

  // Beam pool
  const beamGeometry = new CylinderGeometry(1, 1, 1, 8, 1, true);
  const beamPool: BeamEffect[] = [];

  // Flash pool
  const flashGeometry = new SphereGeometry(1, 12, 8);
  const flashPool: RingEffect[] = [];

  scene.add(root);

  function spawnExplosion(pos: Vector3, count = 24, color = MOLTEN_ORANGE_HOT, speed = 18) {
    const burstCount = Math.min(count, MAX_SPARKS - sparks.length);
    for (let i = 0; i < burstCount; i += 1) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const spd = (0.3 + Math.random() * 0.7) * speed;
      const vel = new Vector3(
        Math.sin(phi) * Math.cos(theta) * spd,
        Math.sin(phi) * Math.sin(theta) * spd,
        Math.cos(phi) * spd,
      );
      sparks.push({
        pos: pos.clone(),
        vel,
        color: color.clone(),
        age: 0,
        life: 0.4 + Math.random() * 0.5,
        size: 0.6 + Math.random() * 0.6,
      });
    }
  }

  function spawnShockwave(pos: Vector3, maxRadius = 12, duration = 0.6, color = FRIENDLY_CYAN_HOT) {
    const mat = createAdditiveBasicMaterial({ color: hdr(color, 2.0), opacity: 0.9 });
    const mesh = new Mesh(ringGeometry, mat);
    mesh.position.copy(pos);
    mesh.quaternion.random();
    mesh.userData.raildIgnoreOcclusion = true;
    root.add(mesh);

    ringPool.push({
      mesh,
      age: 0,
      life: duration,
      startScale: 0.5,
      endScale: maxRadius,
      baseColor: color.clone(),
    });
  }

  function spawnFlash(pos: Vector3, size = 4, color = SPARKS_GOLD, duration = 0.25) {
    const mat = createAdditiveBasicMaterial({ color: hdr(color, 2.2), opacity: 1.0 });
    const mesh = new Mesh(flashGeometry, mat);
    mesh.position.copy(pos);
    mesh.scale.setScalar(size);
    mesh.userData.raildIgnoreOcclusion = true;
    root.add(mesh);

    flashPool.push({
      mesh,
      age: 0,
      life: duration,
      startScale: size * 0.5,
      endScale: size * 1.8,
      baseColor: color.clone(),
    });
  }

  function spawnBroadsideBeam(from: Vector3, to: Vector3, color = CYAN_BOLT, radius = 1.4, duration = 0.35) {
    const dir = new Vector3().subVectors(to, from);
    const length = dir.length();
    if (length < 0.1) return;

    const mid = new Vector3().addVectors(from, to).multiplyScalar(0.5);
    const mat = createAdditiveBasicMaterial({ color: hdr(color, 2.5), opacity: 1.0 });
    const mesh = new Mesh(beamGeometry, mat);
    mesh.position.copy(mid);
    mesh.scale.set(radius, length, radius);
    mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
    mesh.userData.raildIgnoreOcclusion = true;
    root.add(mesh);

    beamPool.push({
      mesh,
      age: 0,
      life: duration,
      startRadius: radius,
      baseColor: color.clone(),
    });
  }

  function update(dt: number) {
    // Update sparks
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const spark = sparks[i];
      spark.age += dt;
      if (spark.age >= spark.life) {
        sparks.splice(i, 1);
        continue;
      }
      spark.vel.multiplyScalar(Math.max(0, 1 - dt * 2.5));
      spark.pos.addScaledVector(spark.vel, dt);
    }

    // Fill points buffer
    const posAttr = sparksGeometry.attributes.position as Float32BufferAttribute;
    const colAttr = sparksGeometry.attributes.color as Float32BufferAttribute;
    const pArr = posAttr.array as Float32Array;
    const cArr = colAttr.array as Float32Array;

    for (let i = 0; i < MAX_SPARKS; i += 1) {
      if (i < sparks.length) {
        const s = sparks[i];
        pArr[i * 3] = s.pos.x;
        pArr[i * 3 + 1] = s.pos.y;
        pArr[i * 3 + 2] = s.pos.z;
        const progress = s.age / s.life;
        const alpha = Math.max(0, 1 - progress);
        cArr[i * 3] = s.color.r * alpha;
        cArr[i * 3 + 1] = s.color.g * alpha;
        cArr[i * 3 + 2] = s.color.b * alpha;
      } else {
        pArr[i * 3] = 0;
        pArr[i * 3 + 1] = -99999;
        pArr[i * 3 + 2] = 0;
      }
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    // Update rings
    for (let i = ringPool.length - 1; i >= 0; i -= 1) {
      const r = ringPool[i];
      r.age += dt;
      if (r.age >= r.life) {
        r.mesh.removeFromParent();
        (r.mesh.material as MeshBasicMaterial).dispose();
        ringPool.splice(i, 1);
        continue;
      }
      const t = r.age / r.life;
      const s = r.startScale + (r.endScale - r.startScale) * Math.sin(t * (Math.PI / 2));
      r.mesh.scale.setScalar(s);
      const mat = r.mesh.material as MeshBasicMaterial;
      mat.opacity = (1 - t) * 0.9;
    }

    // Update beams
    for (let i = beamPool.length - 1; i >= 0; i -= 1) {
      const b = beamPool[i];
      b.age += dt;
      if (b.age >= b.life) {
        b.mesh.removeFromParent();
        (b.mesh.material as MeshBasicMaterial).dispose();
        beamPool.splice(i, 1);
        continue;
      }
      const t = b.age / b.life;
      const r = b.startRadius * Math.max(0, 1 - t);
      b.mesh.scale.x = r;
      b.mesh.scale.z = r;
      const mat = b.mesh.material as MeshBasicMaterial;
      mat.opacity = Math.max(0, 1 - t * 0.8);
    }

    // Update flashes
    for (let i = flashPool.length - 1; i >= 0; i -= 1) {
      const f = flashPool[i];
      f.age += dt;
      if (f.age >= f.life) {
        f.mesh.removeFromParent();
        (f.mesh.material as MeshBasicMaterial).dispose();
        flashPool.splice(i, 1);
        continue;
      }
      const t = f.age / f.life;
      const s = f.startScale + (f.endScale - f.startScale) * t;
      f.mesh.scale.setScalar(s);
      const mat = f.mesh.material as MeshBasicMaterial;
      mat.opacity = Math.max(0, 1 - t);
    }
  }

  function clear() {
    sparks.length = 0;
    for (const r of ringPool) {
      r.mesh.removeFromParent();
      (r.mesh.material as MeshBasicMaterial).dispose();
    }
    ringPool.length = 0;
    for (const b of beamPool) {
      b.mesh.removeFromParent();
      (b.mesh.material as MeshBasicMaterial).dispose();
    }
    beamPool.length = 0;
    for (const f of flashPool) {
      f.mesh.removeFromParent();
      (f.mesh.material as MeshBasicMaterial).dispose();
    }
    flashPool.length = 0;
  }

  return {
    root,
    spawnExplosion,
    spawnShockwave,
    spawnBroadsideBeam,
    spawnFlash,
    update,
    clear,
  };
}
