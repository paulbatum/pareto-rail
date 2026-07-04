import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { EventBus } from '../../events';
import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { sampleRailFrame } from '../../engine/rail';
import { createAudio } from './audio';
import { createGlyphMesh, setGlyphLocked } from './glyphs';
import { createRezdleGameplay, createRezdleRail } from './gameplay';

const INK = new Color(0.015, 0.018, 0.04);
const ICE = new Color(0.68, 0.96, 1.0);
const VIOLET = new Color(0.74, 0.45, 1.0);
const GREEN = new Color(0.44, 1.0, 0.62);
const GOLD = new Color(1.0, 0.66, 0.2);
const ROSE = new Color(1.0, 0.35, 0.52);

const hdr = (color: Color, intensity: number) => color.clone().multiplyScalar(intensity);

export const rezdleLevel: LevelDefinition = {
  id: 'rezdle',
  title: 'Rezdle',
  description: 'Spell words from locked letter targets.',
  post: {
    clearColor: 0x040714,
    bloom: { strength: 0.85, threshold: 0.25, radius: 0.55 },
    vignette: { inner: 0.22, outer: 1.05, strength: 0.9 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    createEnvironment(scene);
    installVisualEventHandlers(bus, scene);
    const game = createLockOnRunner({
      scene,
      camera,
      canvas,
      bus,
      hud,
      onPause,
      onFullscreen,
      startTip,
      level: createRezdleGameplay(bus, hud),
      visuals: {
        createEnemyMesh,
        setEnemyLocked,
        createProjectileMesh,
        createReticle,
        setReticleActive,
      },
    });

    return {
      update(dt, elapsed) {
        game.update(dt);
        updateVisuals(dt, elapsed, camera);
      },
      dispose() {
        game.dispose();
      },
    };
  },
};

function createEnvironment(scene: Scene) {
  scene.background = INK;
  const root = new Group();
  const rail = createRezdleRail();
  const positions: number[] = [];
  const colors: number[] = [];

  const push = (a: Vector3, b: Vector3, color: Color, intensity: number) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    for (let i = 0; i < 2; i += 1) colors.push(color.r * intensity, color.g * intensity, color.b * intensity);
  };

  for (let i = 0; i < 96; i += 1) {
    const frame = sampleRailFrame(rail, i / 95);
    const width = 11 + Math.sin(i * 0.31) * 1.8;
    const low = frame.position.clone().addScaledVector(frame.up, -4.8);
    push(low.clone().addScaledVector(frame.right, -width), low.clone().addScaledVector(frame.right, width), ICE, i % 8 === 0 ? 0.9 : 0.18);
    if (i % 3 === 0) {
      push(
        frame.position.clone().addScaledVector(frame.right, -width).addScaledVector(frame.up, -4.8),
        frame.position.clone().addScaledVector(frame.right, -width * 0.65).addScaledVector(frame.up, 5.8),
        VIOLET,
        0.22,
      );
      push(
        frame.position.clone().addScaledVector(frame.right, width).addScaledVector(frame.up, -4.8),
        frame.position.clone().addScaledVector(frame.right, width * 0.65).addScaledVector(frame.up, 5.8),
        GREEN,
        0.22,
      );
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  root.add(new LineSegments(
    geometry,
    new LineBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }),
  ));

  scene.add(root);
  return root;
}

function accentForKind(kind: string) {
  if (kind === 'vowel') return GREEN;
  if (kind === 'bonus') return GOLD;
  if (kind === 'letter') return ICE;
  return VIOLET;
}

function createEnemyMesh(kind: string, letter?: string) {
  const group = new Group();
  const accent = accentForKind(kind);
  const glyph = createGlyphMesh(letter ?? 'A');
  glyph.scale.setScalar(kind === 'letter' ? 1.25 : 1.05);
  group.add(glyph);

  const haloMaterial = new MeshBasicMaterial({
    color: hdr(accent, kind === 'bonus' ? 2.0 : 1.4),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  haloMaterial.userData.baseColor = haloMaterial.color.clone();
  const halo = new Mesh(new RingGeometry(1.0, 1.08, 6), haloMaterial);
  halo.position.z = -0.08;
  halo.rotation.z = Math.PI / 6;
  group.add(halo);

  if (kind !== 'letter') {
    const markerMaterial = new MeshBasicMaterial({
      color: hdr(accent, 1.6),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    markerMaterial.userData.baseColor = markerMaterial.color.clone();
    const marker = new Mesh(kind === 'bonus' ? new OctahedronGeometry(0.16, 0) : new SphereGeometry(0.11, 8, 4), markerMaterial);
    marker.position.set(0.86, -0.86, 0.06);
    group.add(marker);
    group.userData.materials = [haloMaterial, markerMaterial];
  } else {
    group.userData.materials = [haloMaterial];
  }

  group.userData.glyph = glyph;
  group.userData.accent = accent;
  return group;
}

function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  setGlyphLocked(mesh, locked);
  const materials = mesh.userData.materials as MeshBasicMaterial[] | undefined;
  for (const material of materials ?? []) {
    const base = material.userData.baseColor as Color | undefined;
    material.color.copy(locked ? hdr(ROSE, 2.5) : (base ?? hdr(ICE, 1.2)));
  }
}

function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(
    new OctahedronGeometry(0.18, 0),
    new MeshBasicMaterial({ color: hdr(GOLD, 2.4), transparent: true, blending: AdditiveBlending, depthWrite: false }),
  );
  core.scale.set(0.65, 0.65, 2.4);
  const ring = new Mesh(
    new RingGeometry(0.32, 0.36, 6),
    new MeshBasicMaterial({ color: hdr(ICE, 1.5), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
  );
  group.add(core, ring);
  return group;
}

function createReticle() {
  const group = new Group();
  const outer = new Mesh(
    new RingGeometry(0.56, 0.6, 24),
    new MeshBasicMaterial({ color: hdr(ICE, 1.2), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
  );
  const inner = new Mesh(
    new RingGeometry(0.16, 0.19, 16),
    new MeshBasicMaterial({ color: hdr(GOLD, 1.4), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
  );
  group.add(outer, inner);
  return group;
}

function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.08 : 0));
}

const pulses: Array<{ mesh: Mesh; age: number; life: number }> = [];

function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('lock', ({ worldPosition }) => pulse(scene, worldPosition, ROSE, 0.24));
  bus.on('fire', ({ worldPosition }) => pulse(scene, worldPosition, GOLD, 0.18));
  bus.on('kill', ({ worldPosition }) => pulse(scene, worldPosition, GREEN, 0.34));
  bus.on('volley', ({ scoreAwarded }) => {
    if (scoreAwarded <= 0) return;
    pulse(scene, new Vector3(0, 0, -18), GOLD, 0.5);
  });
}

function pulse(scene: Scene, position: Vector3, color: Color, life: number) {
  const mesh = new Mesh(
    new TorusGeometry(0.35, 0.018, 4, 32),
    new MeshBasicMaterial({ color: hdr(color, 2.0), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
  );
  mesh.position.copy(position);
  scene.add(mesh);
  pulses.push({ mesh, age: 0, life });
}

function updateVisuals(dt: number, elapsed: number, camera: PerspectiveCamera) {
  for (let i = pulses.length - 1; i >= 0; i -= 1) {
    const item = pulses[i];
    item.age += dt;
    const t = item.age / item.life;
    item.mesh.quaternion.copy(camera.quaternion);
    item.mesh.scale.setScalar(1 + t * 2.4);
    const material = item.mesh.material as MeshBasicMaterial;
    material.opacity = Math.max(0, 1 - t);
    if (t >= 1) {
      item.mesh.removeFromParent();
      pulses.splice(i, 1);
    }
  }

  const wobble = Math.sin(elapsed * 0.8) * 0.02;
  camera.fov = 62 + wobble;
  camera.updateProjectionMatrix();
}
