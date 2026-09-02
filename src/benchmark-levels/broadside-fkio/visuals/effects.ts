import {
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import {
  CRIMSON_FIRE,
  CRIMSON_GLOW,
  CYAN_BEAM,
  CYAN_FIRE,
  CYAN_GLOW,
  MOLTEN_ORANGE,
  OBSIDIAN_HULL,
  RETICLE_LOCKED,
} from './palette';

const PARTICLE_CAPACITY = 600;
const RING_CAPACITY = 24;
const BEAM_CAPACITY = 16;

type Particle = {
  position: Vector3;
  velocity: Vector3;
  size: number;
  color: Color;
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

type BroadsideBeam = {
  mesh: Mesh;
  color: Color;
  start: Vector3;
  end: Vector3;
  age: number;
  life: number;
};

export type EffectsSystem = {
  group: Group;
  spawnExplosion(pos: Vector3, isBoss?: boolean): void;
  spawnShockwave(pos: Vector3, color?: Color, maxScale?: number): void;
  spawnBroadsideBeam(from: Vector3, to: Vector3, color?: Color): void;
  update(dt: number): void;
  reset(): void;
};

export function createEffects(scene: Scene): EffectsSystem {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;
  scene.add(group);

  // ---- Instanced Particles ------------------------------------------------
  const particleGeom = new TetrahedronGeometry(0.35, 0);
  const particleMat = new MeshBasicMaterial(additiveMaterialParameters({
    color: 0xffffff,
    depthWrite: false,
  }));
  const instancedParticles = new InstancedMesh(particleGeom, particleMat, PARTICLE_CAPACITY);
  instancedParticles.instanceMatrix.setUsage(DynamicDrawUsage);
  instancedParticles.instanceColor = instancedParticles.instanceColor ?? null;
  group.add(instancedParticles);

  const particles: Particle[] = [];
  for (let i = 0; i < PARTICLE_CAPACITY; i += 1) {
    particles.push({
      position: new Vector3(0, -9999, 0),
      velocity: new Vector3(),
      size: 0,
      color: new Color(),
      age: 999,
      life: 1,
    });
  }
  let nextParticleIdx = 0;

  // ---- Shockwave Rings ----------------------------------------------------
  const ringGeom = new RingGeometry(0.8, 1.0, 32);
  const ringMat = new MeshBasicMaterial(additiveMaterialParameters({
    color: 0xffffff,
    side: DoubleSide,
    depthWrite: false,
    transparent: true,
  }));

  const rings: ShockRing[] = [];
  for (let i = 0; i < RING_CAPACITY; i += 1) {
    const mesh = new Mesh(ringGeom, ringMat.clone());
    mesh.visible = false;
    group.add(mesh);
    rings.push({
      mesh,
      color: new Color(),
      age: 999,
      life: 1,
      fromScale: 0.1,
      toScale: 8.0,
    });
  }
  let nextRingIdx = 0;

  // ---- Broadside Beams ----------------------------------------------------
  const beamGeom = new CylinderGeometry(0.8, 0.8, 1.0, 6);
  beamGeom.rotateX(Math.PI / 2);
  const beamMat = new MeshBasicMaterial(additiveMaterialParameters({
    color: 0xffffff,
    depthWrite: false,
    transparent: true,
  }));

  const beams: BroadsideBeam[] = [];
  for (let i = 0; i < BEAM_CAPACITY; i += 1) {
    const mesh = new Mesh(beamGeom, beamMat.clone());
    mesh.visible = false;
    group.add(mesh);
    beams.push({
      mesh,
      color: new Color(),
      start: new Vector3(),
      end: new Vector3(),
      age: 999,
      life: 0.5,
    });
  }
  let nextBeamIdx = 0;

  const dummyMatrix = new Matrix4();
  const dummyQuat = new Quaternion();
  const dummyScale = new Vector3();

  function spawnExplosion(pos: Vector3, isBoss = false) {
    const count = isBoss ? 60 : 20;
    const speedBase = isBoss ? 28 : 16;
    const baseColor = isBoss ? MOLTEN_ORANGE : CRIMSON_FIRE;

    for (let i = 0; i < count; i += 1) {
      const p = particles[nextParticleIdx];
      nextParticleIdx = (nextParticleIdx + 1) % PARTICLE_CAPACITY;

      p.position.copy(pos);
      // Random unit direction
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const speed = (0.5 + Math.random() * 1.2) * speedBase;
      p.velocity.set(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi),
      ).multiplyScalar(speed);

      p.size = (0.5 + Math.random() * 0.8) * (isBoss ? 2.2 : 1.0);
      p.color.copy(Math.random() > 0.3 ? baseColor : RETICLE_LOCKED);
      p.age = 0;
      p.life = 0.4 + Math.random() * (isBoss ? 1.0 : 0.6);
    }

    spawnShockwave(pos, isBoss ? MOLTEN_ORANGE : CRIMSON_GLOW, isBoss ? 22 : 10);
  }

  function spawnShockwave(pos: Vector3, color = CYAN_FIRE, maxScale = 10) {
    const r = rings[nextRingIdx];
    nextRingIdx = (nextRingIdx + 1) % RING_CAPACITY;

    r.mesh.position.copy(pos);
    r.mesh.visible = true;
    (r.mesh.material as MeshBasicMaterial).color.copy(color);
    r.color.copy(color);
    r.age = 0;
    r.life = 0.65;
    r.fromScale = 0.2;
    r.toScale = maxScale;
  }

  function spawnBroadsideBeam(from: Vector3, to: Vector3, color = CYAN_BEAM) {
    const b = beams[nextBeamIdx];
    nextBeamIdx = (nextBeamIdx + 1) % BEAM_CAPACITY;

    b.start.copy(from);
    b.end.copy(to);
    b.color.copy(color);
    (b.mesh.material as MeshBasicMaterial).color.copy(color);
    b.age = 0;
    b.life = 0.35;
    b.mesh.visible = true;

    // Orient and scale beam between points
    const delta = to.clone().sub(from);
    const dist = delta.length();
    b.mesh.position.copy(from).addScaledVector(delta, 0.5);
    b.mesh.lookAt(to);
    b.mesh.scale.set(1, 1, dist);
  }

  function update(dt: number) {
    // Update particles
    let dirtyParticles = false;
    for (let i = 0; i < PARTICLE_CAPACITY; i += 1) {
      const p = particles[i];
      if (p.age < p.life) {
        p.age += dt;
        p.position.addScaledVector(p.velocity, dt);
        const progress = p.age / p.life;
        const currentSize = p.size * (1 - progress);

        dummyScale.setScalar(Math.max(0.001, currentSize));
        dummyMatrix.compose(p.position, dummyQuat, dummyScale);
        instancedParticles.setMatrixAt(i, dummyMatrix);

        dirtyParticles = true;
      } else if (p.age - dt < p.life) {
        // Just died: move away
        dummyScale.set(0, 0, 0);
        dummyMatrix.compose(new Vector3(0, -9999, 0), dummyQuat, dummyScale);
        instancedParticles.setMatrixAt(i, dummyMatrix);
        dirtyParticles = true;
      }
    }
    if (dirtyParticles) instancedParticles.instanceMatrix.needsUpdate = true;

    // Update shockwave rings
    for (const r of rings) {
      if (r.age < r.life) {
        r.age += dt;
        const t = r.age / r.life;
        const s = r.fromScale + (r.toScale - r.fromScale) * Math.sin(t * (Math.PI / 2));
        r.mesh.scale.setScalar(s);
        (r.mesh.material as MeshBasicMaterial).opacity = 1 - t * t;
      } else {
        r.mesh.visible = false;
      }
    }

    // Update broadside beams
    for (const b of beams) {
      if (b.age < b.life) {
        b.age += dt;
        const t = b.age / b.life;
        (b.mesh.material as MeshBasicMaterial).opacity = Math.sin((1 - t) * Math.PI);
      } else {
        b.mesh.visible = false;
      }
    }
  }

  function reset() {
    for (let i = 0; i < PARTICLE_CAPACITY; i += 1) {
      particles[i].age = 999;
      dummyScale.set(0, 0, 0);
      dummyMatrix.compose(new Vector3(0, -9999, 0), dummyQuat, dummyScale);
      instancedParticles.setMatrixAt(i, dummyMatrix);
    }
    instancedParticles.instanceMatrix.needsUpdate = true;

    for (const r of rings) {
      r.age = 999;
      r.mesh.visible = false;
    }
    for (const b of beams) {
      b.age = 999;
      b.mesh.visible = false;
    }
  }

  return {
    group,
    spawnExplosion,
    spawnShockwave,
    spawnBroadsideBeam,
    update,
    reset,
  };
}
