import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
} from 'three';
import type { CameraFeelRig } from '../../../engine/camera-feel';
import type { EventBus } from '../../../events';
import { disposeObject3D } from '../../../engine/visual-kit';
import type { MassDriverEnvironment } from './environment';
import { MD_AMBER, MD_ARC, MD_RED, MD_VIOLET, MD_WHITE, heatColor } from './palette';

type Transient = {
  object: Object3D;
  age: number;
  life: number;
  velocity?: Vector3;
  grow?: number;
  spin?: number;
  material?: MeshBasicMaterial | LineBasicMaterial;
  line?: Line;
  start?: Vector3;
  end?: Vector3;
  seed?: number;
};

const ROUND_RING_GEOMETRY = new RingGeometry(0.78, 1, 32);
const HEX_RING_GEOMETRY = new RingGeometry(0.78, 1, 6);
const SPARK_GEOMETRY = new OctahedronGeometry(0.1, 0);
const GLINT_HORIZONTAL_GEOMETRY = new PlaneGeometry(2.8, 0.045);
const GLINT_VERTICAL_GEOMETRY = new PlaneGeometry(0.045, 2.8);

function effectMaterial(color: number | Color, intensity = 1, opacity = 1) {
  const value = color instanceof Color ? color.clone() : new Color(color);
  value.multiplyScalar(intensity);
  return new MeshBasicMaterial({ color: value, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
}

export function createMassDriverEffects(
  bus: EventBus,
  scene: Scene,
  feel: CameraFeelRig,
  environment: MassDriverEnvironment,
) {
  const root = new Group();
  root.name = 'mass-driver-detailed-effects';
  root.userData.raildIgnoreOcclusion = true;
  scene.add(root);
  const effects: Transient[] = [];
  const disposers: Array<() => void> = [];
  const enemyKinds = new Map<number, string>();

  function ring(position: Vector3, color: number | Color, radius: number, life: number, grow: number, sides = 32) {
    const material = effectMaterial(color, 1.45, 0.92);
    const mesh = new Mesh(sides === 6 ? HEX_RING_GEOMETRY : ROUND_RING_GEOMETRY, material);
    mesh.position.copy(position);
    mesh.scale.setScalar(radius);
    mesh.userData.faceCamera = true;
    root.add(mesh);
    effects.push({ object: mesh, age: 0, life, grow, spin: sides === 6 ? 2.8 : 0.7, material });
  }

  function crossGlint(position: Vector3, color: number | Color, scale = 1) {
    const material = effectMaterial(color, 2.1, 0.95);
    const group = new Group();
    const horizontal = new Mesh(GLINT_HORIZONTAL_GEOMETRY, material);
    const vertical = new Mesh(GLINT_VERTICAL_GEOMETRY, material);
    group.add(horizontal, vertical);
    group.scale.setScalar(scale);
    group.position.copy(position);
    group.userData.faceCamera = true;
    root.add(group);
    effects.push({ object: group, age: 0, life: 0.2, grow: 2.4, material });
  }

  function splinters(position: Vector3, color: number | Color, count: number, force: number) {
    for (let index = 0; index < count; index += 1) {
      const material = effectMaterial(color, 1.4 + index % 3 * 0.2, 0.9);
      const spark = new Mesh(SPARK_GEOMETRY, material);
      const sparkScale = 0.75 + index % 4 * 0.25;
      spark.scale.set(sparkScale, sparkScale, sparkScale * 3.8);
      const angle = index / count * Math.PI * 2 + (index % 3) * 0.19;
      const velocity = new Vector3(
        Math.cos(angle) * force * (0.65 + index % 5 * 0.11),
        Math.sin(angle) * force * (0.65 + (index + 2) % 5 * 0.1),
        ((index * 7) % 9 - 4) * force * 0.15,
      );
      spark.position.copy(position);
      spark.lookAt(position.clone().add(velocity));
      root.add(spark);
      effects.push({ object: spark, age: 0, life: 0.32 + index % 4 * 0.045, velocity, spin: index % 2 ? 8 : -8, material });
    }
  }

  function lightning(start: Vector3, end: Vector3, color: number | Color, life = 0.22, seed = 0) {
    const positions = new Float32Array(11 * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const value = color instanceof Color ? color.clone() : new Color(color);
    const material = new LineBasicMaterial({ color: value.multiplyScalar(1.9), transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false });
    const line = new Line(geometry, material);
    root.add(line);
    effects.push({ object: line, line, start: start.clone(), end: end.clone(), seed, age: 0, life, material });
  }

  function localArc(position: Vector3, color: number | Color, scale: number, seed: number) {
    const offset = new Vector3(
      Math.sin(seed * 2.3) * scale,
      Math.cos(seed * 1.7) * scale,
      Math.sin(seed * 4.1) * scale * 0.4,
    );
    lightning(position.clone().sub(offset), position.clone().add(offset), color, 0.24, seed);
  }

  disposers.push(bus.on('spawn', ({ worldPosition, kind, enemyId }) => {
    enemyKinds.set(enemyId, kind);
    if (kind === 'interlock') {
      ring(worldPosition, MD_AMBER, 0.65, 0.5, 7.5, 6);
      ring(worldPosition, MD_AMBER, 1.05, 0.72, 10, 6);
      splinters(worldPosition, MD_AMBER, 8, 5.2);
      feel.shake(0.16, { maxTrauma: 0.7, decay: 3.2 });
    } else {
      ring(worldPosition, kind === 'arc' ? MD_WHITE : MD_ARC, 0.2, 0.25, 2.6, kind === 'coil' ? 6 : 24);
    }
    if (kind === 'arc') localArc(worldPosition, MD_VIOLET, 0.85, enemyId);
  }));
  disposers.push(bus.on('lock', ({ worldPosition, lockCount, enemyId }) => {
    const color = heatColor(Math.min(1, lockCount / 6), 1.5);
    const bossScale = enemyKinds.get(enemyId) === 'interlock' ? 1.65 : 1;
    ring(worldPosition, color, (0.42 + lockCount * 0.045) * bossScale, 0.32, 4.4, 6);
    ring(worldPosition, lockCount === 6 ? MD_WHITE : MD_ARC, (0.62 + lockCount * 0.04) * bossScale, 0.38, 2.2, 6);
    if (lockCount === 6) {
      environment.pumpFlash(0.24);
      feel.kickFov(2.4, { decay: 6 });
    }
  }));
  disposers.push(bus.on('unlock', ({ worldPosition }) => ring(worldPosition, MD_ARC, 0.62, 0.2, -1.8, 6)));
  disposers.push(bus.on('fire', ({ worldPosition, targetPosition, volleySize, indexInVolley }) => {
    if ((indexInVolley ?? 0) === 0) {
      ring(worldPosition, volleySize === 6 ? MD_WHITE : MD_ARC, 0.22, 0.28, 9, 6);
      feel.kickFov(volleySize === 6 ? 3.8 : 1.2, { decay: 7 });
    }
    lightning(worldPosition, targetPosition, MD_ARC, 0.08, volleySize * 11 + (indexInVolley ?? 0));
  }));
  disposers.push(bus.on('hit', ({ worldPosition, lethal, stageCompleted, enemyId }) => {
    crossGlint(worldPosition, lethal ? MD_WHITE : MD_ARC, lethal ? 1.15 : 0.72);
    ring(worldPosition, lethal ? MD_WHITE : MD_VIOLET, 0.24, 0.36, 6, 24);
    localArc(worldPosition, stageCompleted ? MD_WHITE : MD_VIOLET, stageCompleted ? 1.8 : 0.85, enemyId * 1.7);
    if (!lethal) splinters(worldPosition, MD_VIOLET, stageCompleted ? 9 : 4, stageCompleted ? 7 : 4);
  }));
  disposers.push(bus.on('stage', ({ worldPosition, enemyId }) => {
    const kind = enemyKinds.get(enemyId);
    if (kind === 'interlock') {
      ring(worldPosition, MD_AMBER, 0.9, 0.72, 10.5, 6);
      ring(worldPosition, MD_WHITE, 0.56, 0.48, 7.5, 6);
      splinters(worldPosition, MD_AMBER, 16, 9.2);
      localArc(worldPosition, MD_WHITE, 2.8, enemyId * 1.3);
      localArc(worldPosition, MD_VIOLET, 2.2, enemyId * 2.7);
      environment.pumpFlash(0.2);
      feel.shake(0.2, { maxTrauma: 0.82, decay: 2.8 });
    } else if (kind === 'capacitor') {
      ring(worldPosition, MD_VIOLET, 0.78, 0.6, 8.5, 6);
      splinters(worldPosition, MD_ARC, 12, 7.6);
      for (let branch = 0; branch < 3; branch += 1) localArc(worldPosition, branch % 2 ? MD_WHITE : MD_VIOLET, 1.6 + branch * 0.35, enemyId + branch * 4.1);
      feel.shake(0.12, { maxTrauma: 0.72, decay: 3.4 });
    } else {
      ring(worldPosition, MD_VIOLET, 0.78, 0.6, 8.5, 6);
      lightning(worldPosition.clone().add(new Vector3(-2.2, 0.5, 0)), worldPosition.clone().add(new Vector3(2.2, -0.4, 0)), MD_WHITE, 0.3, enemyId);
      feel.shake(0.12, { maxTrauma: 0.72, decay: 3.4 });
    }
  }));
  disposers.push(bus.on('kill', ({ worldPosition, enemyId }) => {
    const kind = enemyKinds.get(enemyId);
    if (kind === 'interlock') {
      ring(worldPosition, MD_AMBER, 0.8, 0.88, 15, 6);
      ring(worldPosition, MD_WHITE, 0.48, 0.74, 18, 30);
      splinters(worldPosition, MD_AMBER, 20, 11);
      splinters(worldPosition, MD_WHITE, 10, 7.5);
      localArc(worldPosition, MD_WHITE, 3.4, enemyId * 2.1);
      localArc(worldPosition, MD_VIOLET, 2.8, enemyId * 3.7);
      environment.pumpFlash(0.24);
      feel.shake(0.18, { maxTrauma: 0.9, decay: 2.7 });
    } else {
      ring(worldPosition, MD_WHITE, 0.55, 0.72, 12, 30);
      splinters(worldPosition, kind === 'arc' ? MD_WHITE : MD_ARC, kind === 'capacitor' ? 20 : 15, kind === 'capacitor' ? 10 : 8.5);
      localArc(worldPosition, MD_WHITE, 2.4, enemyId * 2.1);
      localArc(worldPosition, MD_VIOLET, 1.8, enemyId * 3.7);
      feel.shake(0.09, { maxTrauma: 0.78, decay: 3.6 });
    }
    enemyKinds.delete(enemyId);
  }));
  disposers.push(bus.on('miss', ({ worldPosition, enemyId }) => {
    ring(worldPosition, MD_ARC, 0.25, 0.4, 2.2, 6);
    splinters(worldPosition, MD_ARC, 3, 2.6);
    enemyKinds.delete(enemyId);
  }));
  disposers.push(bus.on('reject', () => {
    environment.pumpFlash(0.08);
    ring(new Vector3(0, 0, -4.5), MD_RED, 0.75, 0.34, 6.5, 6);
    feel.shake(0.05, { maxTrauma: 0.4, decay: 5 });
  }));
  disposers.push(bus.on('playerhit', () => {
    environment.pumpFlash(0.12);
    for (let index = 0; index < 4; index += 1) ring(new Vector3(0, 0, -2.5 - index * 1.2), MD_RED, 1.2 + index, 0.5, 12, 6);
    feel.shake(0.5, { maxTrauma: 1, decay: 1.1 });
  }));
  disposers.push(bus.on('volley', ({ size, kills }) => {
    if (size === 6 && kills === 6) environment.pumpFlash(0.34);
  }));

  return {
    update(dt: number, camera: PerspectiveCamera) {
      for (let index = effects.length - 1; index >= 0; index -= 1) {
        const effect = effects[index];
        effect.age += dt;
        const t = Math.min(1, effect.age / effect.life);
        if (effect.object.userData.faceCamera) effect.object.quaternion.copy(camera.quaternion);
        if (effect.velocity) effect.object.position.addScaledVector(effect.velocity, dt);
        if (effect.grow) effect.object.scale.addScalar(effect.grow * dt);
        if (effect.spin) effect.object.rotation.z += effect.spin * dt;
        if (effect.line && effect.start && effect.end) {
          const array = effect.line.geometry.attributes.position.array as Float32Array;
          for (let point = 0; point < 11; point += 1) {
            const fraction = point / 10;
            const base = effect.start.clone().lerp(effect.end, fraction);
            const envelope = Math.sin(fraction * Math.PI);
            base.x += Math.sin((point + 1) * 12.7 + effect.age * 83 + (effect.seed ?? 0)) * envelope * 0.2;
            base.y += Math.cos((point + 2) * 9.3 + effect.age * 71 + (effect.seed ?? 0)) * envelope * 0.2;
            base.z += Math.sin(point * 7.1 + effect.age * 97) * envelope * 0.08;
            array.set([base.x, base.y, base.z], point * 3);
          }
          effect.line.geometry.attributes.position.needsUpdate = true;
        }
        if (effect.material) effect.material.opacity = Math.max(0, (1 - t) * (effect.line ? 0.95 : 0.9));
        if (effect.age >= effect.life) {
          effect.object.removeFromParent();
          if (effect.line) effect.line.geometry.dispose();
          effect.material?.dispose();
          effects.splice(index, 1);
        }
      }
    },
    dispose() {
      for (const dispose of disposers) dispose();
      enemyKinds.clear();
      root.removeFromParent();
      disposeObject3D(root);
    },
  };
}
