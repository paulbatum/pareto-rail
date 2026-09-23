import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import type { Camera } from 'three';

// Leaf: instanced systems for the ambient battle. The spine decides who
// shoots whom, how often, and in what color; these only fly, fade, and
// recycle. Distant tracers and fighters are widened with camera distance so a
// kilometer-scale battle still reads as lines and specks instead of vanishing.

const Z_AXIS = new Vector3(0, 0, 1);
const tmpMatrix = new Matrix4();
const tmpQuat = new Quaternion();
const tmpPos = new Vector3();
const tmpScale = new Vector3();
const tmpVec = new Vector3();
const HIDDEN = new Matrix4().makeScale(0, 0, 0);

// ---- tracers ---------------------------------------------------------------------------

type Tracer = {
  active: boolean;
  origin: Vector3;
  direction: Vector3;
  quaternion: Quaternion;
  distance: number;
  speed: number;
  length: number;
  width: number;
  age: number;
  onImpact?: (point: Vector3) => void;
};

export type TracerSystem = ReturnType<typeof createTracerSystem>;

export function createTracerSystem(capacity: number) {
  const geometry = new BoxGeometry(1, 1, 1);
  geometry.translate(0, 0, -0.5);
  const material = new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false });
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;
  const tracers: Tracer[] = [];
  for (let i = 0; i < capacity; i += 1) {
    tracers.push({ active: false, origin: new Vector3(), direction: new Vector3(), quaternion: new Quaternion(), distance: 0, speed: 0, length: 0, width: 0, age: 0 });
    mesh.setMatrixAt(i, HIDDEN);
    mesh.setColorAt(i, new Color(0, 0, 0));
  }
  let cursor = 0;

  function fire(from: Vector3, to: Vector3, color: Color, options: { speed?: number; length?: number; width?: number; onImpact?: (point: Vector3) => void } = {}) {
    let index = -1;
    for (let k = 0; k < capacity; k += 1) {
      const candidate = (cursor + k) % capacity;
      if (!tracers[candidate].active) {
        index = candidate;
        break;
      }
    }
    if (index < 0) index = cursor;
    cursor = (index + 1) % capacity;
    const tracer = tracers[index];
    tracer.active = true;
    tracer.origin.copy(from);
    tracer.direction.copy(to).sub(from);
    tracer.distance = tracer.direction.length();
    tracer.direction.divideScalar(Math.max(1e-6, tracer.distance));
    tracer.quaternion.setFromUnitVectors(Z_AXIS, tracer.direction);
    tracer.speed = options.speed ?? 900;
    tracer.length = options.length ?? 46;
    tracer.width = options.width ?? 0.9;
    tracer.age = 0;
    tracer.onImpact = options.onImpact;
    mesh.setColorAt(index, color);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function update(dt: number, camera: Camera) {
    for (let i = 0; i < capacity; i += 1) {
      const tracer = tracers[i];
      if (!tracer.active) continue;
      tracer.age += dt;
      const head = tracer.age * tracer.speed;
      if (head - tracer.length > tracer.distance) {
        tracer.active = false;
        mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      if (tracer.onImpact && head >= tracer.distance) {
        tracer.onImpact(tmpPos.copy(tracer.origin).addScaledVector(tracer.direction, tracer.distance));
        tracer.onImpact = undefined;
      }
      const clippedHead = Math.min(head, tracer.distance);
      const tail = Math.max(0, head - tracer.length);
      const length = Math.max(0.01, clippedHead - tail);
      tmpPos.copy(tracer.origin).addScaledVector(tracer.direction, clippedHead);
      const cameraDistance = tmpPos.distanceTo(camera.position);
      const width = Math.max(tracer.width, cameraDistance * 0.0024);
      tmpScale.set(width, width, length);
      // Local +z maps onto the flight direction and the box extends along local
      // −z, so it runs from the head back toward the tail.
      tmpMatrix.compose(tmpPos, tracer.quaternion, tmpScale);
      mesh.setMatrixAt(i, tmpMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  function clear() {
    for (let i = 0; i < capacity; i += 1) {
      tracers[i].active = false;
      mesh.setMatrixAt(i, HIDDEN);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { mesh, fire, update, clear };
}

// ---- billboard flashes -------------------------------------------------------------------

type Flash = {
  active: boolean;
  position: Vector3;
  color: Color;
  size: number;
  grow: number;
  life: number;
  age: number;
  minPixels: number;
};

export type FlashSystem = ReturnType<typeof createFlashSystem>;

/** Additive camera-facing discs: muzzle flashes, hull impacts, distant explosions. */
export function createFlashSystem(capacity: number, geometry: BufferGeometry = new PlaneGeometry(1, 1)) {
  const material = new MeshBasicMaterial({ color: 0xffffff, vertexColors: geometry.hasAttribute('color'), transparent: true, blending: AdditiveBlending, depthWrite: false });
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;
  const flashes: Flash[] = [];
  for (let i = 0; i < capacity; i += 1) {
    flashes.push({ active: false, position: new Vector3(), color: new Color(), size: 1, grow: 1, life: 1, age: 0, minPixels: 0 });
    mesh.setMatrixAt(i, HIDDEN);
    mesh.setColorAt(i, new Color(0, 0, 0));
  }
  let cursor = 0;
  const scratch = new Color();

  function spawn(position: Vector3, color: Color, size: number, life: number, options: { grow?: number; minAngular?: number } = {}) {
    const flash = flashes[cursor];
    flash.active = true;
    flash.position.copy(position);
    flash.color.copy(color);
    flash.size = size;
    flash.grow = options.grow ?? 1.6;
    flash.life = life;
    flash.age = 0;
    flash.minPixels = options.minAngular ?? 0.004;
    cursor = (cursor + 1) % capacity;
  }

  function update(dt: number, camera: Camera) {
    for (let i = 0; i < capacity; i += 1) {
      const flash = flashes[i];
      if (!flash.active) continue;
      flash.age += dt;
      if (flash.age >= flash.life) {
        flash.active = false;
        mesh.setMatrixAt(i, HIDDEN);
        scratch.setRGB(0, 0, 0);
        mesh.setColorAt(i, scratch);
        continue;
      }
      const t = flash.age / flash.life;
      const distance = flash.position.distanceTo(camera.position);
      const size = Math.max(flash.size * (1 + (flash.grow - 1) * Math.sqrt(t)), distance * flash.minPixels);
      tmpScale.setScalar(size);
      tmpMatrix.compose(flash.position, camera.quaternion, tmpScale);
      mesh.setMatrixAt(i, tmpMatrix);
      const fade = (1 - t) * (1 - t);
      scratch.copy(flash.color).multiplyScalar(fade);
      mesh.setColorAt(i, scratch);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function clear() {
    for (let i = 0; i < capacity; i += 1) {
      flashes[i].active = false;
      mesh.setMatrixAt(i, HIDDEN);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { mesh, spawn, update, clear };
}

// ---- knotted swarms --------------------------------------------------------------------

export type SwarmKnot = {
  center: Vector3;
  radius: Vector3;
  count: number;
  side: 'ally' | 'enemy';
  speed: number;
  /** Knot frame rotation. */
  quaternion: Quaternion;
};

type SwarmPilot = {
  knot: SwarmKnot;
  phase: Vector3;
  rates: Vector3;
  wobble: number;
};

/**
 * Distant dogfights: fighters tie Lissajous knots through the gaps between
 * the capital ships. Hulls are tiny darts; engines are camera-scaled glints
 * so a swarm reads as a shoal of sparks at any distance.
 */
export function createSwarmSystem(knots: SwarmKnot[], colors: { allyHull: Color; enemyHull: Color; allyEngine: Color; enemyEngine: Color }, rng: () => number) {
  const pilots: SwarmPilot[] = [];
  for (const knot of knots) {
    for (let i = 0; i < knot.count; i += 1) {
      pilots.push({
        knot,
        phase: new Vector3(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2),
        rates: new Vector3(1 + Math.floor(rng() * 2), 2 + Math.floor(rng() * 2), 1 + Math.floor(rng() * 3)).multiplyScalar(0.18 + rng() * 0.08),
        wobble: rng() * Math.PI * 2,
      });
    }
  }
  const hullGeometry = new ConeGeometry(1, 4, 3);
  hullGeometry.rotateX(-Math.PI / 2);
  const hulls = new InstancedMesh(hullGeometry, new MeshBasicMaterial({ color: 0xffffff }), pilots.length);
  const engines = new InstancedMesh(new OctahedronGeometry(1, 0), new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false }), pilots.length);
  hulls.frustumCulled = false;
  engines.frustumCulled = false;
  hulls.userData.raildIgnoreOcclusion = true;
  engines.userData.raildIgnoreOcclusion = true;
  hulls.instanceMatrix.setUsage(DynamicDrawUsage);
  engines.instanceMatrix.setUsage(DynamicDrawUsage);
  pilots.forEach((pilot, index) => {
    hulls.setColorAt(index, pilot.knot.side === 'ally' ? colors.allyHull : colors.enemyHull);
    engines.setColorAt(index, pilot.knot.side === 'ally' ? colors.allyEngine : colors.enemyEngine);
  });
  const group = new Object3D();
  group.add(hulls, engines);

  const position = new Vector3();
  const ahead = new Vector3();
  const forward = new Vector3();

  function pathPoint(pilot: SwarmPilot, t: number, target: Vector3) {
    const k = pilot.knot;
    target.set(
      Math.sin(t * pilot.rates.x + pilot.phase.x) * k.radius.x,
      Math.sin(t * pilot.rates.y + pilot.phase.y) * k.radius.y,
      Math.sin(t * pilot.rates.z + pilot.phase.z) * k.radius.z,
    );
    return target.applyQuaternion(k.quaternion).add(k.center);
  }

  function update(time: number, camera: Camera) {
    pilots.forEach((pilot, index) => {
      const t = time * pilot.knot.speed;
      pathPoint(pilot, t, position);
      pathPoint(pilot, t + 0.05, ahead);
      forward.copy(ahead).sub(position);
      if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1);
      forward.normalize();
      tmpQuat.setFromUnitVectors(Z_AXIS, forward.clone().negate());
      const distance = position.distanceTo(camera.position);
      const hullScale = Math.max(1.4, distance * 0.0016);
      tmpScale.setScalar(hullScale);
      tmpMatrix.compose(position, tmpQuat, tmpScale);
      hulls.setMatrixAt(index, tmpMatrix);
      const engineScale = Math.max(0.7, distance * 0.0018) * (0.8 + 0.2 * Math.sin(time * 23 + pilot.wobble));
      tmpPos.copy(position).addScaledVector(forward, -hullScale * 2.4);
      tmpScale.setScalar(engineScale);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      engines.setMatrixAt(index, tmpMatrix);
    });
    hulls.instanceMatrix.needsUpdate = true;
    engines.instanceMatrix.needsUpdate = true;
  }

  return { group, update, count: pilots.length };
}

// ---- space dust ------------------------------------------------------------------------

/** World-fixed motes recycled around the camera and drawn as streaks along the flight. */
export function createDustField(count: number, color: Color, rng: () => number) {
  const positions = new Float32Array(count * 6);
  const colors = new Float32Array(count * 6);
  const motes: Vector3[] = [];
  const shades: number[] = [];
  for (let i = 0; i < count; i += 1) {
    motes.push(new Vector3((rng() - 0.5) * 120, (rng() - 0.5) * 80, -rng() * 220));
    shades.push(0.35 + rng() * 0.65);
  }
  const geometry = new BufferGeometry();
  const positionAttribute = new Float32BufferAttribute(positions, 3);
  positionAttribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false });
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.userData.raildIgnoreOcclusion = true;
  const cameraForward = new Vector3();
  const lastCamera = new Vector3();
  const velocity = new Vector3();
  let initialized = false;

  function update(dt: number, camera: Camera, brightness: number) {
    camera.getWorldDirection(cameraForward);
    if (!initialized) {
      lastCamera.copy(camera.position);
      for (const mote of motes) mote.add(camera.position);
      initialized = true;
    }
    velocity.copy(camera.position).sub(lastCamera).divideScalar(Math.max(1e-4, dt));
    if (velocity.lengthSq() > 400 * 400) velocity.setLength(400);
    lastCamera.copy(camera.position);
    const streak = Math.min(9, velocity.length() * 0.03);
    const colorAttribute = geometry.getAttribute('color') as Float32BufferAttribute;
    for (let i = 0; i < count; i += 1) {
      const mote = motes[i];
      tmpVec.copy(mote).sub(camera.position);
      const depth = tmpVec.dot(cameraForward);
      if (depth < -6 || depth > 240 || tmpVec.lengthSq() > 260 * 260) {
        // Respawn ahead of the camera, spread across the view.
        mote.copy(camera.position)
          .addScaledVector(cameraForward, 90 + rng() * 150)
          .add(tmpVec.set((rng() - 0.5) * 150, (rng() - 0.5) * 100, (rng() - 0.5) * 150));
      }
      positions[i * 6] = mote.x;
      positions[i * 6 + 1] = mote.y;
      positions[i * 6 + 2] = mote.z;
      const speed = Math.max(1, velocity.length());
      positions[i * 6 + 3] = mote.x - (velocity.x / speed) * streak;
      positions[i * 6 + 4] = mote.y - (velocity.y / speed) * streak;
      positions[i * 6 + 5] = mote.z - (velocity.z / speed) * streak;
      const shade = shades[i] * brightness;
      colorAttribute.array[i * 6] = color.r * shade;
      colorAttribute.array[i * 6 + 1] = color.g * shade;
      colorAttribute.array[i * 6 + 2] = color.b * shade;
      colorAttribute.array[i * 6 + 3] = color.r * shade * 0.1;
      colorAttribute.array[i * 6 + 4] = color.g * shade * 0.1;
      colorAttribute.array[i * 6 + 5] = color.b * shade * 0.1;
    }
    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
  }

  function reset() {
    initialized = false;
  }

  return { lines, update, reset };
}

/** A disc whose vertex colors fall from white at the center to black at the rim: a soft additive glow. */
export function createGlowDiscGeometry(segments = 20, core = 0.25) {
  const positions: number[] = [];
  const colors: number[] = [];
  const ring = (radius: number, shade: number) => {
    const points: Array<[number, number, number]> = [];
    for (let i = 0; i < segments; i += 1) {
      const a = (i / segments) * Math.PI * 2;
      points.push([Math.cos(a) * radius, Math.sin(a) * radius, shade]);
    }
    return points;
  };
  const inner = ring(core * 0.5, 0.75);
  const outer = ring(0.5, 0);
  for (let i = 0; i < segments; i += 1) {
    const j = (i + 1) % segments;
    positions.push(0, 0, 0, inner[i][0], inner[i][1], 0, inner[j][0], inner[j][1], 0);
    colors.push(1, 1, 1, 0.75, 0.75, 0.75, 0.75, 0.75, 0.75);
    positions.push(inner[i][0], inner[i][1], 0, outer[i][0], outer[i][1], 0, outer[j][0], outer[j][1], 0);
    colors.push(0.75, 0.75, 0.75, 0, 0, 0, 0, 0, 0);
    positions.push(inner[i][0], inner[i][1], 0, outer[j][0], outer[j][1], 0, inner[j][0], inner[j][1], 0);
    colors.push(0.75, 0.75, 0.75, 0, 0, 0, 0.75, 0.75, 0.75);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

// ---- particles -------------------------------------------------------------------------

type Particle = {
  active: boolean;
  position: Vector3;
  velocity: Vector3;
  spin: Vector3;
  rotation: Quaternion;
  color: Color;
  size: number;
  life: number;
  age: number;
  drag: number;
};

export type ParticleSystem = ReturnType<typeof createParticleSystem>;

/**
 * Ballistic particles with drag: additive sparks, or opaque tumbling hull
 * shards whose color cools from `color` toward black as they age.
 */
export function createParticleSystem(capacity: number, geometry: BufferGeometry, options: { additive: boolean }) {
  const material = options.additive
    ? new MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: AdditiveBlending, depthWrite: false })
    : new MeshBasicMaterial({ color: 0xffffff });
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;
  const particles: Particle[] = [];
  for (let i = 0; i < capacity; i += 1) {
    particles.push({ active: false, position: new Vector3(), velocity: new Vector3(), spin: new Vector3(), rotation: new Quaternion(), color: new Color(), size: 1, life: 1, age: 0, drag: 1 });
    mesh.setMatrixAt(i, HIDDEN);
    mesh.setColorAt(i, new Color(0, 0, 0));
  }
  let cursor = 0;
  const scratch = new Color();
  const spinQuat = new Quaternion();
  const axis = new Vector3();

  function emit(position: Vector3, velocity: Vector3, color: Color, size: number, life: number, drag = 1.6, spin = 6) {
    const particle = particles[cursor];
    particle.active = true;
    particle.position.copy(position);
    particle.velocity.copy(velocity);
    particle.color.copy(color);
    particle.size = size;
    particle.life = life;
    particle.age = 0;
    particle.drag = drag;
    particle.spin.set((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin);
    particle.rotation.setFromAxisAngle(axis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), Math.random() * Math.PI);
    cursor = (cursor + 1) % capacity;
  }

  function burst(origin: Vector3, count: number, speed: number, color: Color, size: number, life: number, options2: { drag?: number; inherit?: Vector3; jitter?: number } = {}) {
    for (let i = 0; i < count; i += 1) {
      const direction = tmpVec.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      const v = direction.multiplyScalar(speed * (0.35 + Math.random() * 0.75));
      if (options2.inherit) v.add(options2.inherit);
      emit(origin, v, color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), options2.drag ?? 1.6);
    }
  }

  function update(dt: number, camera: Camera) {
    for (let i = 0; i < capacity; i += 1) {
      const particle = particles[i];
      if (!particle.active) continue;
      particle.age += dt;
      if (particle.age >= particle.life) {
        particle.active = false;
        mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      const t = particle.age / particle.life;
      particle.velocity.multiplyScalar(Math.exp(-particle.drag * dt));
      particle.position.addScaledVector(particle.velocity, dt);
      const spinAmount = particle.spin.length();
      if (spinAmount > 1e-4) {
        spinQuat.setFromAxisAngle(axis.copy(particle.spin).divideScalar(spinAmount), spinAmount * dt);
        particle.rotation.multiply(spinQuat);
      }
      const distance = particle.position.distanceTo(camera.position);
      const size = Math.max(particle.size * (options.additive ? 1 - t * 0.6 : 1), options.additive ? distance * 0.0022 : 0);
      tmpScale.setScalar(size);
      tmpMatrix.compose(particle.position, particle.rotation, tmpScale);
      mesh.setMatrixAt(i, tmpMatrix);
      if (options.additive) scratch.copy(particle.color).multiplyScalar((1 - t) * (1 - t));
      else scratch.copy(particle.color).multiplyScalar(Math.max(0.08, 1 - t * 1.8)).lerp(new Color(0.02, 0.015, 0.02), Math.min(1, t * 1.4));
      mesh.setColorAt(i, scratch);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  function clear() {
    for (let i = 0; i < capacity; i += 1) {
      particles[i].active = false;
      mesh.setMatrixAt(i, HIDDEN);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { mesh, emit, burst, update, clear };
}
