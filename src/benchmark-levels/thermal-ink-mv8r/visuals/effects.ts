import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { clamp, float, instancedDynamicBufferAttribute, mix, mx_noise_float, positionView, smoothstep, time, uv, vec3 } from 'three/tsl';
import { senseUniforms, surfaceMaterial } from './materials';
import { MURK, THERMAL } from './palette';

// Transient effects, all instanced so a busy volley costs a few draw calls:
// sparks (additive), rings (additive), ink puffs (dark, soft), debris chunks
// (lit, tumbling), and water columns. Leaf file: callers decide what bursts,
// where, what color, and how big.

type Spark = { position: Vector3; velocity: Vector3; color: Color; size: number; age: number; life: number; drag: number; gravity: number };
type RingFx = { position: Vector3; color: Color; radius: number; age: number; life: number; flat: boolean };
type Puff = { position: Vector3; velocity: Vector3; size: number; grow: number; age: number; life: number; opacity: number; hold: number; spin: number; target?: Vector3; travel: number };
type Chunk = { position: Vector3; velocity: Vector3; spin: Vector3; rotation: Quaternion; size: Vector3; age: number; life: number };
type Column = { position: Vector3; radius: number; height: number; age: number; life: number };

const SPARKS = 420;
const RINGS = 48;
const PUFFS = 360;
const CHUNKS = 90;
const COLUMNS = 14;

const hidden = new Matrix4().makeScale(0, 0, 0);

export type Effects = ReturnType<typeof createEffects>;

export function createEffects(scene: Scene) {
  // ---- sparks ---------------------------------------------------------------
  const sparkMaterial = new MeshBasicNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
  {
    const d = uv().sub(0.5).length().mul(2);
    sparkMaterial.colorNode = vec3(1, 1, 1).mul(clamp(float(1).sub(d), 0, 1).pow(1.8)).mul(2.2);
  }
  const sparkMesh = new InstancedMesh(new PlaneGeometry(1, 1), sparkMaterial, SPARKS);
  sparkMesh.frustumCulled = false;
  sparkMesh.instanceMatrix.setUsage(DynamicDrawUsage);
  const sparks: Spark[] = [];

  // ---- rings ----------------------------------------------------------------
  const ringMaterial = new MeshBasicNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false });
  ringMaterial.colorNode = vec3(1, 1, 1);
  const ringMesh = new InstancedMesh(new RingGeometry(0.9, 1, 48), ringMaterial, RINGS);
  ringMesh.frustumCulled = false;
  const rings: RingFx[] = [];

  // ---- ink puffs ------------------------------------------------------------
  const puffAlpha = new InstancedBufferAttribute(new Float32Array(PUFFS), 1);
  puffAlpha.setUsage(DynamicDrawUsage);
  const puffMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide, fog: false });
  {
    const q = uv().sub(0.5);
    const d = q.length().mul(2);
    const billow = mx_noise_float(vec3(q.x.mul(2.6), q.y.mul(2.6), time.mul(0.2))).mul(0.22);
    const mask = smoothstep(float(1), float(0.15), d.add(billow));
    // Puffs dissolve as the camera enters them instead of filling the lens.
    const near = smoothstep(float(3), float(14), positionView.z.negate());
    const sheen = clamp(float(1).sub(d), 0, 1).pow(4).mul(0.05);
    // Oil-black in murk with a faint bruised sheen; cold black in thermal.
    puffMaterial.colorNode = mix(vec3(0.012, 0.008, 0.012).add(vec3(0.08, 0.05, 0.1).mul(sheen)), vec3(0, 0, 0), senseUniforms.thermal);
    const alpha = instancedDynamicBufferAttribute(puffAlpha, 'float') as unknown as Node<'float'>;
    puffMaterial.opacityNode = mask.mul(alpha).mul(near).mul(mix(float(1), float(0.3), senseUniforms.thermal));
  }
  const puffMesh = new InstancedMesh(new PlaneGeometry(1, 1), puffMaterial, PUFFS);
  puffMesh.frustumCulled = false;
  puffMesh.userData.raildIgnoreOcclusion = true;
  const puffs: Puff[] = [];

  // ---- debris chunks ----------------------------------------------------------
  const chunkMaterial = surfaceMaterial({ color: new Color(1, 1, 1), heat: THERMAL.bodyCool, roughness: 0.7, metalness: 0.3 });
  const chunkMesh = new InstancedMesh(new BoxGeometry(1, 1, 1), chunkMaterial, CHUNKS);
  chunkMesh.frustumCulled = false;
  const chunks: Chunk[] = [];
  const chunkColors: Color[] = [];

  // ---- water columns ------------------------------------------------------------
  const columnMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: DoubleSide });
  {
    const q = uv();
    const foam = mx_noise_float(vec3(q.x.mul(9), q.y.mul(4).sub(time.mul(2)), time)).mul(0.5).add(0.5);
    columnMaterial.colorNode = mix(vec3(MURK.cream.r * 0.55, MURK.cream.g * 0.5, MURK.cream.b * 0.42), vec3(0.14, 0.14, 0.15), senseUniforms.thermal);
    columnMaterial.opacityNode = foam.mul(float(1).sub(q.y).pow(0.7)).mul(0.75);
  }
  const columnMesh = new InstancedMesh(new CylinderGeometry(0.6, 1, 1, 16, 1, true), columnMaterial, COLUMNS);
  columnMesh.frustumCulled = false;
  const columns: Column[] = [];

  for (let i = 0; i < SPARKS; i += 1) sparkMesh.setMatrixAt(i, hidden);
  for (let i = 0; i < RINGS; i += 1) ringMesh.setMatrixAt(i, hidden);
  for (let i = 0; i < PUFFS; i += 1) puffMesh.setMatrixAt(i, hidden);
  for (let i = 0; i < CHUNKS; i += 1) chunkMesh.setMatrixAt(i, hidden);
  for (let i = 0; i < COLUMNS; i += 1) columnMesh.setMatrixAt(i, hidden);
  sparkMesh.setColorAt(0, new Color(0, 0, 0));
  ringMesh.setColorAt(0, new Color(0, 0, 0));
  chunkMesh.setColorAt(0, new Color(0, 0, 0));
  scene.add(puffMesh, sparkMesh, ringMesh, chunkMesh, columnMesh);

  const random = () => Math.random();
  const randomDirection = (target: Vector3) => {
    const u = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    return target.set(r * Math.cos(angle), u, r * Math.sin(angle));
  };

  function burstSparks(position: Vector3, color: Color, count: number, speed: number, options: { size?: number; life?: number; gravity?: number; up?: number } = {}) {
    for (let i = 0; i < count; i += 1) {
      if (sparks.length >= SPARKS) sparks.shift();
      const velocity = randomDirection(new Vector3()).multiplyScalar(speed * (0.35 + random() * 0.65));
      velocity.y += options.up ?? 0;
      sparks.push({
        position: position.clone(),
        velocity,
        color: color.clone(),
        size: (options.size ?? 0.35) * (0.6 + random() * 0.8),
        age: 0,
        life: (options.life ?? 0.55) * (0.6 + random() * 0.7),
        drag: 2.2,
        gravity: options.gravity ?? 9,
      });
    }
  }

  function trail(position: Vector3, color: Color, size = 0.3, life = 0.28) {
    if (sparks.length >= SPARKS) sparks.shift();
    sparks.push({ position: position.clone(), velocity: new Vector3(), color: color.clone(), size, age: 0, life, drag: 0, gravity: 0 });
  }

  function ring(position: Vector3, color: Color, radius: number, life: number, flat = false) {
    if (rings.length >= RINGS) rings.shift();
    rings.push({ position: position.clone(), color: color.clone(), radius, age: 0, life, flat });
  }

  function ink(position: Vector3, options: { count: number; size: number; spread: number; life: number; speed?: number; hold?: number; opacity?: number; up?: number }) {
    for (let i = 0; i < options.count; i += 1) {
      if (puffs.length >= PUFFS) puffs.shift();
      const offset = randomDirection(new Vector3()).multiplyScalar(options.spread * random());
      const velocity = randomDirection(new Vector3()).multiplyScalar((options.speed ?? 2) * random());
      velocity.y += options.up ?? 0;
      puffs.push({
        position: position.clone().add(offset),
        velocity,
        size: options.size * (0.6 + random() * 0.7),
        grow: 0.5 + random() * 0.6,
        age: 0,
        life: options.life * (0.8 + random() * 0.4),
        opacity: options.opacity ?? 0.9,
        hold: options.hold ?? 0.3,
        spin: (random() - 0.5) * 0.6,
        travel: 0,
      });
    }
  }

  /** A jet puff that flies from `from` to `to` over `travel` seconds, then billows in place. */
  function inkJet(from: Vector3, to: Vector3, options: { size: number; travel: number; life: number; opacity?: number; delay?: number }) {
    if (puffs.length >= PUFFS) puffs.shift();
    puffs.push({
      position: from.clone(),
      velocity: new Vector3(),
      size: options.size,
      grow: 0.25 + random() * 0.3,
      age: -(options.delay ?? 0),
      life: options.life,
      opacity: options.opacity ?? 0.95,
      hold: 0.85,
      spin: (random() - 0.5) * 0.3,
      target: to.clone(),
      travel: options.travel,
    });
  }

  function debris(position: Vector3, color: Color, count: number, speed: number, size = 0.35) {
    for (let i = 0; i < count; i += 1) {
      if (chunks.length >= CHUNKS) {
        chunks.shift();
        chunkColors.shift();
      }
      const velocity = randomDirection(new Vector3()).multiplyScalar(speed * (0.4 + random() * 0.6));
      velocity.y += speed * 0.4;
      chunks.push({
        position: position.clone(),
        velocity,
        spin: randomDirection(new Vector3()).multiplyScalar(4 + random() * 8),
        rotation: new Quaternion(),
        size: new Vector3(size * (0.5 + random()), size * (0.3 + random() * 0.6), size * (0.5 + random())),
        age: 0,
        life: 2.4,
      });
      chunkColors.push(color.clone().multiplyScalar(0.8 + random() * 0.4));
    }
  }

  function splash(position: Vector3, radius: number, height: number) {
    if (columns.length >= COLUMNS) columns.shift();
    columns.push({ position: position.clone().setY(0), radius, height, age: 0, life: 1.6 });
    ring(position.clone().setY(0.1), MURK.cream.clone().multiplyScalar(0.5), radius * 2.2, 1.4, true);
  }

  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const color = new Color();
  const flatRing = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  const spinQ = new Quaternion();
  const zAxis = new Vector3(0, 0, 1);
  const step = new Quaternion();

  function update(dt: number, camera: Camera) {
    const thermal = senseUniforms.thermal.value as number;
    // In thermal the sparks read as white heat; the red cores keep their red.
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const spark = sparks[i];
      spark.age += dt;
      if (spark.age >= spark.life) sparks.splice(i, 1);
    }
    sparks.forEach((spark, index) => {
      spark.velocity.multiplyScalar(Math.max(0, 1 - spark.drag * dt));
      spark.velocity.y -= spark.gravity * dt;
      spark.position.addScaledVector(spark.velocity, dt);
      const t = spark.age / spark.life;
      matrix.compose(spark.position, camera.quaternion, scale.setScalar(spark.size * (1 - t * 0.6)));
      sparkMesh.setMatrixAt(index, matrix);
      const fade = (1 - t) * (1 - t);
      const grey = (spark.color.r + spark.color.g + spark.color.b) / 3;
      color.setRGB(
        (spark.color.r * (1 - thermal) + grey * thermal) * fade,
        (spark.color.g * (1 - thermal) + grey * thermal) * fade,
        (spark.color.b * (1 - thermal) + grey * thermal) * fade,
      );
      sparkMesh.setColorAt(index, color);
    });
    for (let i = sparks.length; i < SPARKS; i += 1) sparkMesh.setMatrixAt(i, hidden);

    for (let i = rings.length - 1; i >= 0; i -= 1) {
      rings[i].age += dt;
      if (rings[i].age >= rings[i].life) rings.splice(i, 1);
    }
    rings.forEach((fx, index) => {
      const t = fx.age / fx.life;
      const eased = 1 - (1 - t) ** 3;
      matrix.compose(fx.position, fx.flat ? flatRing : camera.quaternion, scale.setScalar(fx.radius * (0.15 + eased * 0.85)));
      ringMesh.setMatrixAt(index, matrix);
      ringMesh.setColorAt(index, color.copy(fx.color).multiplyScalar((1 - t) ** 1.5));
    });
    for (let i = rings.length; i < RINGS; i += 1) ringMesh.setMatrixAt(i, hidden);

    for (let i = puffs.length - 1; i >= 0; i -= 1) {
      puffs[i].age += dt;
      if (puffs[i].age >= puffs[i].life) puffs.splice(i, 1);
    }
    puffs.forEach((puff, index) => {
      if (puff.age < 0) {
        puffMesh.setMatrixAt(index, hidden);
        puffAlpha.setX(index, 0);
        return;
      }
      if (puff.target && puff.age < puff.travel) {
        const k = Math.min(1, dt * 3.2 / Math.max(0.05, puff.travel - puff.age + 0.05));
        puff.position.lerp(puff.target, k);
      } else {
        puff.velocity.multiplyScalar(Math.max(0, 1 - dt * 0.8));
        puff.position.addScaledVector(puff.velocity, dt);
      }
      const t = puff.age / puff.life;
      const size = puff.size * (1 + puff.grow * Math.sqrt(t) * 2.2);
      spinQ.setFromAxisAngle(zAxis, puff.spin * puff.age + index);
      quaternion.copy(camera.quaternion).multiply(spinQ);
      matrix.compose(puff.position, quaternion, scale.setScalar(size));
      puffMesh.setMatrixAt(index, matrix);
      const fadeIn = Math.min(1, puff.age / 0.18);
      const fadeOut = t < puff.hold ? 1 : 1 - (t - puff.hold) / (1 - puff.hold);
      puffAlpha.setX(index, puff.opacity * fadeIn * Math.max(0, fadeOut));
    });
    for (let i = puffs.length; i < PUFFS; i += 1) {
      puffMesh.setMatrixAt(i, hidden);
      puffAlpha.setX(i, 0);
    }
    puffAlpha.needsUpdate = true;

    for (let i = chunks.length - 1; i >= 0; i -= 1) {
      chunks[i].age += dt;
      if (chunks[i].age >= chunks[i].life || chunks[i].position.y < -3) {
        chunks.splice(i, 1);
        chunkColors.splice(i, 1);
      }
    }
    chunks.forEach((chunk, index) => {
      chunk.velocity.y -= 18 * dt;
      chunk.position.addScaledVector(chunk.velocity, dt);
      const angle = chunk.spin.length() * dt;
      if (angle > 0) {
        step.setFromAxisAngle(chunk.spin.clone().normalize(), angle);
        chunk.rotation.premultiply(step);
      }
      matrix.compose(chunk.position, chunk.rotation, chunk.size);
      chunkMesh.setMatrixAt(index, matrix);
      chunkMesh.setColorAt(index, chunkColors[index]);
    });
    for (let i = chunks.length; i < CHUNKS; i += 1) chunkMesh.setMatrixAt(i, hidden);

    for (let i = columns.length - 1; i >= 0; i -= 1) {
      columns[i].age += dt;
      if (columns[i].age >= columns[i].life) columns.splice(i, 1);
    }
    columns.forEach((column, index) => {
      const t = column.age / column.life;
      const rise = Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) * (1 - Math.max(0, t - 0.55) / 0.45);
      const height = Math.max(0.01, column.height * rise);
      matrix.compose(
        scale.copy(column.position).setY(height / 2),
        quaternion.identity(),
        new Vector3(column.radius * (1 + t * 0.8), height, column.radius * (1 + t * 0.8)),
      );
      columnMesh.setMatrixAt(index, matrix);
    });
    for (let i = columns.length; i < COLUMNS; i += 1) columnMesh.setMatrixAt(i, hidden);

    for (const mesh of [sparkMesh, ringMesh, puffMesh, chunkMesh, columnMesh]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  function clear() {
    sparks.length = 0;
    rings.length = 0;
    puffs.length = 0;
    chunks.length = 0;
    chunkColors.length = 0;
    columns.length = 0;
  }

  return { burstSparks, trail, ring, ink, inkJet, debris, splash, update, clear };
}
