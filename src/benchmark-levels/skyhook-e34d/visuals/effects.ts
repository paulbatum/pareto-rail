import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  LineSegments,
  Mesh,
  Object3D,
  Quaternion,
  RingGeometry,
  Scene,
  TetrahedronGeometry,
  Vector3,
} from 'three';
import type { Camera } from 'three';
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from 'three/webgpu';
import { float, max, normalWorld } from 'three/tsl';
import { ambientUniform, flashLightUniform, sunColorUniform, sunDirectionUniform } from './materials';

// Transient effects in three pooled draw calls plus a few billboard rings.
// Fragments and sparks are simulated in world space: they inherit the velocity
// of what broke, then air drag bleeds that away. With thick air, debris is
// whipped down and away below the climbing car; in vacuum it keeps drifting.

type Fragment = {
  alive: boolean;
  position: Vector3;
  velocity: Vector3;
  axis: Vector3;
  spin: number;
  angle: number;
  size: number;
  age: number;
  life: number;
  gravity: number;
  drag: number;
  color: Color;
};

type Spark = {
  alive: boolean;
  position: Vector3;
  velocity: Vector3;
  age: number;
  life: number;
  length: number;
  gravity: number;
  drag: number;
  color: Color;
};

type Ring = {
  mesh: Mesh;
  material: MeshBasicNodeMaterial;
  age: number;
  life: number;
  from: number;
  to: number;
  color: Color;
  follow?: Object3D;
};

export type BurstOptions = {
  count: number;
  color: Color;
  /** World velocity the fragments inherit (what broke was moving). */
  carry?: Vector3;
  speed: number;
  size: number;
  life: number;
  gravity: number;
  drag: number;
};

export type SparkOptions = {
  count: number;
  color: Color;
  carry?: Vector3;
  speed: number;
  life: number;
  length: number;
  gravity: number;
  drag: number;
  direction?: Vector3;
  cone?: number;
};

export type RingOptions = {
  color: Color;
  from: number;
  to: number;
  life: number;
  follow?: Object3D;
  filled?: boolean;
};

export type Effects = ReturnType<typeof createEffects>;

const DOWN = new Vector3(0, 0, 1);

export function createEffects(scene: Scene, options: { fragments: number; sparks: number; rings: number }) {
  const root = new Group();
  root.userData.raildIgnoreOcclusion = true;
  scene.add(root);

  // ---- fragments ----
  const fragmentGeometry = new TetrahedronGeometry(1, 0).toNonIndexed();
  fragmentGeometry.computeVertexNormals();
  const fragmentMaterial = new MeshBasicNodeMaterial();
  const diffuse = max(float(0), normalWorld.dot(sunDirectionUniform));
  fragmentMaterial.colorNode = ambientUniform.add(sunColorUniform.mul(diffuse.add(0.2))).add(flashLightUniform).add(0.25);
  const fragmentMesh = new InstancedMesh(fragmentGeometry, fragmentMaterial, options.fragments);
  fragmentMesh.frustumCulled = false;
  root.add(fragmentMesh);
  const fragments: Fragment[] = Array.from({ length: options.fragments }, () => ({
    alive: false,
    position: new Vector3(),
    velocity: new Vector3(),
    axis: new Vector3(0, 1, 0),
    spin: 0,
    angle: 0,
    size: 0,
    age: 0,
    life: 1,
    gravity: 0,
    drag: 0,
    color: new Color(),
  }));
  const hidden = new Object3D();
  hidden.scale.setScalar(0.00001);
  hidden.updateMatrix();
  for (let i = 0; i < options.fragments; i += 1) {
    fragmentMesh.setMatrixAt(i, hidden.matrix);
    fragmentMesh.setColorAt(i, new Color(1, 1, 1));
  }
  let fragmentCursor = 0;

  // ---- sparks ----
  const sparkPositions = new Float32Array(options.sparks * 6);
  const sparkColors = new Float32Array(options.sparks * 6);
  const sparkGeometry = new BufferGeometry();
  const sparkPositionAttribute = new BufferAttribute(sparkPositions, 3);
  const sparkColorAttribute = new BufferAttribute(sparkColors, 3);
  sparkGeometry.setAttribute('position', sparkPositionAttribute);
  sparkGeometry.setAttribute('color', sparkColorAttribute);
  const sparkMaterial = new LineBasicNodeMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false });
  sparkMaterial.fog = false;
  const sparkLines = new LineSegments(sparkGeometry, sparkMaterial);
  sparkLines.frustumCulled = false;
  root.add(sparkLines);
  const sparks: Spark[] = Array.from({ length: options.sparks }, () => ({
    alive: false,
    position: new Vector3(),
    velocity: new Vector3(),
    age: 0,
    life: 1,
    length: 1,
    gravity: 0,
    drag: 0,
    color: new Color(),
  }));
  let sparkCursor = 0;

  // ---- rings & flashes ----
  const ringGeometry = new RingGeometry(0.86, 1, 40);
  const discGeometry = new CircleGeometry(1, 28);
  const rings: Ring[] = Array.from({ length: options.rings }, () => {
    const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
    material.fog = false;
    const mesh = new Mesh(ringGeometry, material);
    mesh.visible = false;
    root.add(mesh);
    return { mesh, material, age: 0, life: 1, from: 1, to: 1, color: new Color() };
  });
  let ringCursor = 0;

  const scratch = new Vector3();
  const scratchQ = new Quaternion();
  const dummy = new Object3D();
  const tint = new Color();

  function randomUnit(out: Vector3) {
    do {
      out.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
    } while (out.lengthSq() > 1 || out.lengthSq() < 0.01);
    return out.normalize();
  }

  function burst(origin: Vector3, opts: BurstOptions) {
    for (let n = 0; n < opts.count; n += 1) {
      const f = fragments[fragmentCursor];
      fragmentCursor = (fragmentCursor + 1) % fragments.length;
      f.alive = true;
      f.position.copy(origin);
      randomUnit(f.velocity).multiplyScalar(opts.speed * (0.35 + Math.random() * 0.65));
      if (opts.carry) f.velocity.add(opts.carry);
      randomUnit(f.axis);
      f.spin = 4 + Math.random() * 12;
      f.angle = Math.random() * 6;
      f.size = opts.size * (0.4 + Math.random() * 0.8);
      f.age = 0;
      f.life = opts.life * (0.7 + Math.random() * 0.6);
      f.gravity = opts.gravity;
      f.drag = opts.drag;
      f.color.copy(opts.color).multiplyScalar(0.75 + Math.random() * 0.35);
    }
  }

  function sparkBurst(origin: Vector3, opts: SparkOptions) {
    for (let n = 0; n < opts.count; n += 1) {
      const s = sparks[sparkCursor];
      sparkCursor = (sparkCursor + 1) % sparks.length;
      s.alive = true;
      s.position.copy(origin);
      randomUnit(s.velocity);
      if (opts.direction) s.velocity.multiplyScalar(opts.cone ?? 0.5).add(opts.direction).normalize();
      s.velocity.multiplyScalar(opts.speed * (0.4 + Math.random() * 0.6));
      if (opts.carry) s.velocity.add(opts.carry);
      s.age = 0;
      s.life = opts.life * (0.6 + Math.random() * 0.6);
      s.length = opts.length;
      s.gravity = opts.gravity;
      s.drag = opts.drag;
      s.color.copy(opts.color);
    }
  }

  function ring(position: Vector3, opts: RingOptions) {
    const r = rings[ringCursor];
    ringCursor = (ringCursor + 1) % rings.length;
    r.mesh.geometry = opts.filled ? discGeometry : ringGeometry;
    r.mesh.position.copy(position);
    r.mesh.visible = true;
    r.age = 0;
    r.life = opts.life;
    r.from = opts.from;
    r.to = opts.to;
    r.color.copy(opts.color);
    r.follow = opts.follow;
  }

  function update(dt: number, camera: Camera, airVelocity: Vector3) {
    // Fragments.
    for (let i = 0; i < fragments.length; i += 1) {
      const f = fragments[i];
      if (!f.alive) continue;
      f.age += dt;
      if (f.age >= f.life) {
        f.alive = false;
        fragmentMesh.setMatrixAt(i, hidden.matrix);
        continue;
      }
      scratch.subVectors(airVelocity, f.velocity).multiplyScalar(Math.min(1, f.drag * dt));
      f.velocity.add(scratch).addScaledVector(DOWN, f.gravity * dt);
      f.position.addScaledVector(f.velocity, dt);
      f.angle += f.spin * dt;
      const fade = 1 - (f.age / f.life) ** 3;
      dummy.position.copy(f.position);
      dummy.quaternion.copy(scratchQ.setFromAxisAngle(f.axis, f.angle));
      dummy.scale.setScalar(f.size * fade);
      dummy.updateMatrix();
      fragmentMesh.setMatrixAt(i, dummy.matrix);
      fragmentMesh.setColorAt(i, f.color);
    }
    fragmentMesh.instanceMatrix.needsUpdate = true;
    if (fragmentMesh.instanceColor) fragmentMesh.instanceColor.needsUpdate = true;

    // Sparks.
    for (let i = 0; i < sparks.length; i += 1) {
      const s = sparks[i];
      const o = i * 6;
      if (!s.alive) {
        sparkColors.fill(0, o, o + 6);
        continue;
      }
      s.age += dt;
      if (s.age >= s.life) {
        s.alive = false;
        sparkColors.fill(0, o, o + 6);
        continue;
      }
      scratch.subVectors(airVelocity, s.velocity).multiplyScalar(Math.min(1, s.drag * dt));
      s.velocity.add(scratch).addScaledVector(DOWN, s.gravity * dt);
      s.position.addScaledVector(s.velocity, dt);
      const fade = 1 - s.age / s.life;
      sparkPositions[o] = s.position.x;
      sparkPositions[o + 1] = s.position.y;
      sparkPositions[o + 2] = s.position.z;
      scratch.copy(s.velocity).sub(airVelocity).multiplyScalar(-s.length * 0.02).add(s.position);
      sparkPositions[o + 3] = scratch.x;
      sparkPositions[o + 4] = scratch.y;
      sparkPositions[o + 5] = scratch.z;
      sparkColors[o] = s.color.r * fade;
      sparkColors[o + 1] = s.color.g * fade;
      sparkColors[o + 2] = s.color.b * fade;
      sparkColors[o + 3] = 0;
      sparkColors[o + 4] = 0;
      sparkColors[o + 5] = 0;
    }
    sparkPositionAttribute.needsUpdate = true;
    sparkColorAttribute.needsUpdate = true;

    // Rings face the camera.
    for (const r of rings) {
      if (!r.mesh.visible) continue;
      r.age += dt;
      if (r.age >= r.life) {
        r.mesh.visible = false;
        continue;
      }
      const t = r.age / r.life;
      if (r.follow) r.mesh.position.copy(r.follow.position);
      r.mesh.quaternion.copy(camera.quaternion);
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * (1 - (1 - t) ** 2));
      tint.copy(r.color).multiplyScalar(1 - t);
      r.material.color.copy(tint);
    }
  }

  function clear() {
    for (let i = 0; i < fragments.length; i += 1) {
      fragments[i].alive = false;
      fragmentMesh.setMatrixAt(i, hidden.matrix);
    }
    fragmentMesh.instanceMatrix.needsUpdate = true;
    for (const s of sparks) s.alive = false;
    sparkColors.fill(0);
    sparkColorAttribute.needsUpdate = true;
    for (const r of rings) r.mesh.visible = false;
  }

  return { root, burst, sparkBurst, ring, update, clear };
}

// ---- lock brackets ----------------------------------------------------------------

const bracketGeometry = (() => {
  // Four L-shaped corner marks around a unit square, as line segments.
  const v: number[] = [];
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    v.push(sx, sy, 0, sx - sx * 0.42, sy, 0);
    v.push(sx, sy, 0, sx, sy - sy * 0.42, 0);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(v), 3));
  return g;
})();
const bracketMaterials = new Map<string, LineBasicNodeMaterial>();

export function createBracket(color: Color) {
  const key = color.getHexString();
  let material = bracketMaterials.get(key);
  if (!material) {
    material = new LineBasicNodeMaterial({ color, transparent: true, depthTest: false, depthWrite: false });
    material.fog = false;
    bracketMaterials.set(key, material);
  }
  const lines = new LineSegments(bracketGeometry, material);
  lines.renderOrder = 20;
  lines.frustumCulled = false;
  const group = new Group();
  group.add(lines);
  // A second, inner set rotated 45° reads as a turning lock ring.
  const inner = new LineSegments(bracketGeometry, material);
  inner.scale.setScalar(0.62);
  inner.rotation.z = Math.PI / 4;
  inner.renderOrder = 20;
  group.add(inner);
  group.userData.raildIgnoreOcclusion = true;
  return group;
}

// ---- telegraph lines ----------------------------------------------------------------

export function createTelegraphLines(count: number) {
  const positions = new Float32Array(count * 6);
  const colors = new Float32Array(count * 6);
  const geometry = new BufferGeometry();
  const positionAttribute = new BufferAttribute(positions, 3);
  const colorAttribute = new BufferAttribute(colors, 3);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('color', colorAttribute);
  const material = new LineBasicNodeMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false });
  material.fog = false;
  const lines = new LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.userData.raildIgnoreOcclusion = true;
  let used = 0;
  return {
    root: lines,
    begin() {
      used = 0;
    },
    add(from: Vector3, to: Vector3, color: Color, strength: number) {
      if (used >= count) return;
      const o = used * 6;
      positions.set([from.x, from.y, from.z, to.x, to.y, to.z], o);
      colors.set([color.r * strength * 0.3, color.g * strength * 0.3, color.b * strength * 0.3, color.r * strength, color.g * strength, color.b * strength], o);
      used += 1;
    },
    end() {
      for (let i = used; i < count; i += 1) colors.fill(0, i * 6, i * 6 + 6);
      positionAttribute.needsUpdate = true;
      colorAttribute.needsUpdate = true;
    },
  };
}
