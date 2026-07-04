import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  Vector3,
} from 'three';
import type { EventBus } from '../../events';
import type { LevelDefinition } from '../../engine/types';
import { createLockOnRunner } from '../../engine/lock-on-runner';
import { sampleRailFrame } from '../../engine/rail';
import { createAudio } from './audio';
import { createGlyphMesh, setGlyphLocked } from './glyphs';
import { createRezdleGameplay, createRezdleRail } from './gameplay';
import { BONE, BRASS, hdr, INK_BLACK, PLATE, SMOKE, VERMILLION } from './palette';

export const rezdleLevel: LevelDefinition = {
  id: 'rezdle',
  title: 'Rezdle',
  description: 'Set words from loose type drifting off a midnight press.',
  post: {
    clearColor: 0x070502,
    bloom: { strength: 0.7, threshold: 0.3, radius: 0.5 },
    vignette: { inner: 0.2, outer: 1.1, strength: 0.95 },
  },
  createAudio,
  createRuntime({ scene, camera, canvas, bus, hud, onPause, onFullscreen, startTip }) {
    const environment = createEnvironment(scene);
    const effects = createEffects(scene, bus, environment);
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
        effects.update(dt, camera);
        environment.update(dt, elapsed);
      },
      dispose() {
        game.dispose();
        effects.dispose();
        environment.dispose();
      },
    };
  },
};

// --- Enemies: pieces of movable type -----------------------------------

function platePartsForKind(kind: string) {
  if (kind === 'vowel') {
    const geometry = new CylinderGeometry(1.35, 1.35, 0.12, 28);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }
  if (kind === 'bonus') {
    const geometry = new CylinderGeometry(1.75, 1.75, 0.12, 4);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }
  return new BoxGeometry(2.0, 2.6, 0.12);
}

function createEnemyMesh(kind: string, letter?: string) {
  const group = new Group();
  const glyph = createGlyphMesh(letter ?? 'A');
  group.add(glyph);

  if (kind === 'letter') {
    // START/REPLAY title type: bare bone letters over a brass underline.
    glyph.scale.setScalar(1.25);
    const underline = new Mesh(new BoxGeometry(1.7, 0.07, 0.06), new MeshBasicMaterial({ color: hdr(BRASS, 1.5) }));
    underline.position.y = -1.35;
    group.add(underline);
    group.userData.edgeMaterial = underline.material;
    return group;
  }

  // The sort: a dark metal plate behind the letter face, silhouette by kind
  // (circle for vowels, square for consonants, diamond for rare letters),
  // rimmed with a thin brass edge that catches the bloom.
  const plateGeometry = platePartsForKind(kind);
  const plate = new Mesh(plateGeometry, new MeshBasicMaterial({ color: PLATE.clone() }));
  plate.position.z = -0.12;
  const edgeMaterial = new LineBasicMaterial({
    color: hdr(kind === 'bonus' ? BRASS : SMOKE, kind === 'bonus' ? 1.6 : 1.1),
    transparent: true,
  });
  edgeMaterial.userData.baseColor = edgeMaterial.color.clone();
  const edges = new LineSegments(new EdgesGeometry(plateGeometry), edgeMaterial);
  edges.position.z = -0.12;
  group.add(plate, edges);
  group.userData.edgeMaterial = edgeMaterial;
  return group;
}

function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  setGlyphLocked(mesh, locked);
  const edgeMaterial = mesh.userData.edgeMaterial as LineBasicMaterial | MeshBasicMaterial | undefined;
  if (edgeMaterial) {
    const base = edgeMaterial.userData.baseColor as Color | undefined;
    edgeMaterial.color.copy(locked ? hdr(VERMILLION, 2.2) : (base ?? edgeMaterial.color));
  }
}

// --- Projectile and reticle ---------------------------------------------

function createProjectileMesh() {
  const group = new Group();
  const drop = new Mesh(
    new CylinderGeometry(0, 0.14, 0.9, 6),
    new MeshBasicMaterial({ color: hdr(VERMILLION, 2.6) }),
  );
  drop.rotation.x = Math.PI / 2;
  const glint = new Mesh(
    new CircleGeometry(0.1, 8),
    new MeshBasicMaterial({ color: hdr(BONE, 2.2), transparent: true, blending: AdditiveBlending, depthWrite: false }),
  );
  group.add(drop, glint);
  return group;
}

function createReticle() {
  const group = new Group();
  const ring = new Mesh(
    new RingGeometry(0.52, 0.56, 32),
    new MeshBasicMaterial({ color: hdr(BONE, 1.3), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
  );
  const ticks = new Group();
  for (let i = 0; i < 4; i += 1) {
    const tick = new Mesh(
      new BoxGeometry(0.05, 0.2, 0.02),
      new MeshBasicMaterial({ color: hdr(BRASS, 1.8), transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    const angle = (i / 4) * Math.PI * 2;
    tick.position.set(Math.sin(angle) * 0.72, Math.cos(angle) * 0.72, 0);
    tick.rotation.z = -angle;
    ticks.add(tick);
  }
  group.add(ring, ticks);
  group.userData.ticks = ticks;
  return group;
}

function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  reticle.scale.setScalar(1 + lockCount * 0.05 + (active ? 0.06 : 0));
  const ticks = reticle.userData.ticks as Group;
  // The composing stick tightens: ticks wind around as locks accumulate.
  ticks.rotation.z = lockCount * (Math.PI / 8);
}

// --- Environment: the midnight press room -------------------------------

function createEnvironment(scene: Scene) {
  scene.background = INK_BLACK.clone();
  const root = new Group();
  const rail = createRezdleRail();

  // Ledger ruling: dim warm baselines running the length of the room below
  // the rail, with cross-rules like leading between lines of type.
  const positions: number[] = [];
  const railSamples = 180;
  const guides = [
    { x: -10.5, y: -4.2 },
    { x: -6.5, y: -5.4 },
    { x: 6.5, y: -5.4 },
    { x: 10.5, y: -4.2 },
  ];
  const samplePoint = (u: number, guide: { x: number; y: number }) => {
    const frame = sampleRailFrame(rail, u);
    return frame.position.clone().addScaledVector(frame.right, guide.x).addScaledVector(frame.up, guide.y);
  };
  for (const guide of guides) {
    for (let i = 0; i < railSamples - 1; i += 1) {
      const a = samplePoint(i / (railSamples - 1), guide);
      const b = samplePoint((i + 1) / (railSamples - 1), guide);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  for (let i = 0; i < railSamples; i += 6) {
    const u = i / (railSamples - 1);
    const a = samplePoint(u, guides[1]);
    const b = samplePoint(u, guides[2]);
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const ruleGeometry = new BufferGeometry();
  ruleGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const ruleMaterial = new LineBasicMaterial({
    color: SMOKE.clone().multiplyScalar(0.4),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  root.add(new LineSegments(ruleGeometry, ruleMaterial));

  // Dust motes hanging in the shop air.
  const motes: Points[] = [];
  for (const cloud of [
    { count: 360, size: 0.07, color: SMOKE.clone().multiplyScalar(0.9), phase: 0 },
    { count: 180, size: 0.12, color: BRASS.clone().multiplyScalar(0.5), phase: Math.PI },
  ]) {
    const points: number[] = [];
    for (let i = 0; i < cloud.count; i += 1) {
      const u = (i / cloud.count + 0.002) % 1;
      const frame = sampleRailFrame(rail, u);
      const angle = i * 2.399963;
      const radius = 3.5 + (i % 11);
      points.push(
        frame.position.x + Math.cos(angle) * radius,
        frame.position.y + Math.sin(angle) * radius * 0.65 + 1,
        frame.position.z + ((i * 7919) % 13) - 6.5,
      );
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(points, 3));
    const material = new PointsMaterial({
      color: cloud.color,
      size: cloud.size,
      transparent: true,
      opacity: 0.5,
      blending: AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    material.userData.phase = cloud.phase;
    const mesh = new Points(geometry, material);
    motes.push(mesh);
    root.add(mesh);
  }

  // Ghost glyphs: enormous faded letters standing far off in the murk.
  const ghosts: Mesh[] = [];
  const ghostLetters = [...'TYPESETINK'];
  ghostLetters.forEach((letter, index) => {
    const u = (index + 0.5) / ghostLetters.length;
    const frame = sampleRailFrame(rail, u);
    const side = index % 2 === 0 ? 1 : -1;
    const glyph = createGlyphMesh(letter, 'print');
    const material = glyph.userData.glyphMaterial as MeshBasicMaterial;
    material.color.copy(SMOKE.clone().multiplyScalar(0.32));
    material.opacity = 0.85;
    glyph.scale.setScalar(9 + (index % 3) * 3);
    glyph.position
      .copy(frame.position)
      .addScaledVector(frame.right, side * (34 + (index % 4) * 8))
      .addScaledVector(frame.up, 6 + (index % 5) * 3);
    glyph.rotation.y = side * 0.7;
    const mesh = glyph.children[0] as Mesh;
    mesh.userData.spin = (index % 2 === 0 ? 1 : -1) * 0.02;
    ghosts.push(mesh);
    root.add(glyph);
  });

  scene.add(root);
  let pulse = 0;

  return {
    flash(strength: number) {
      pulse = Math.max(pulse, strength);
    },
    update(dt: number, elapsed: number) {
      pulse = Math.max(0, pulse - dt * 1.6);
      ruleMaterial.color.copy(SMOKE).multiplyScalar(0.4 + pulse * 1.4);
      for (const cloud of motes) {
        const material = cloud.material as PointsMaterial;
        material.opacity = 0.35 + Math.sin(elapsed * 0.4 + (material.userData.phase as number)) * 0.15 + pulse * 0.3;
      }
      for (const ghost of ghosts) {
        ghost.parent!.rotation.y += (ghost.userData.spin as number) * dt;
      }
    },
    dispose() {
      scene.remove(root);
    },
  };
}

// --- Event-driven effects: ink, stamps, printed words --------------------

type Environment = ReturnType<typeof createEnvironment>;

type Effect = {
  object: Object3D;
  age: number;
  life: number;
  billboard: boolean;
  tick(t: number, dt: number): void;
  cleanup?(): void;
};

const RING_GEOMETRY = new RingGeometry(0.3, 0.36, 24);
const SHARD_GEOMETRY = new CircleGeometry(0.16, 3);

function createEffects(scene: Scene, bus: EventBus, environment: Environment) {
  const effects: Effect[] = [];
  const volleyKills = new Map<number, Vector3[]>();
  const unsubscribes: Array<() => void> = [];

  function ringPulse(position: Vector3, color: Color, intensity: number, life: number, scaleTo: number) {
    const material = new MeshBasicMaterial({
      color: hdr(color, intensity),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const mesh = new Mesh(RING_GEOMETRY, material);
    mesh.position.copy(position);
    scene.add(mesh);
    effects.push({
      object: mesh,
      age: 0,
      life,
      billboard: true,
      tick(t) {
        mesh.scale.setScalar(1 + t * scaleTo);
        material.opacity = Math.max(0, 1 - t);
      },
      cleanup: () => material.dispose(),
    });
  }

  function inkSplat(position: Vector3) {
    const group = new Group();
    const shards: Array<{ mesh: Mesh; velocity: Vector3; spin: number }> = [];
    for (let i = 0; i < 7; i += 1) {
      const material = new MeshBasicMaterial({
        color: hdr(VERMILLION, 1.5),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(SHARD_GEOMETRY, material);
      const angle = (i / 7) * Math.PI * 2 + position.x;
      shards.push({
        mesh,
        velocity: new Vector3(Math.cos(angle) * (3 + (i % 3)), Math.sin(angle) * (3 + ((i + 1) % 3)), 0),
        spin: (i % 2 === 0 ? 1 : -1) * (4 + i),
      });
      group.add(mesh);
    }
    const flash = new Mesh(
      new CircleGeometry(0.3, 12),
      new MeshBasicMaterial({ color: hdr(BONE, 3), transparent: true, blending: AdditiveBlending, depthWrite: false }),
    );
    group.add(flash);
    group.position.copy(position);
    scene.add(group);
    effects.push({
      object: group,
      age: 0,
      life: 0.5,
      billboard: true,
      tick(t, dt) {
        for (const shard of shards) {
          shard.velocity.y -= dt * 6;
          shard.mesh.position.addScaledVector(shard.velocity, dt);
          shard.mesh.rotation.z += shard.spin * dt;
          (shard.mesh.material as MeshBasicMaterial).opacity = Math.max(0, 1 - t * 1.4);
        }
        (flash.material as MeshBasicMaterial).opacity = Math.max(0, 1 - t * 5);
        flash.scale.setScalar(1 + t * 2);
      },
      cleanup() {
        for (const shard of shards) (shard.mesh.material as MeshBasicMaterial).dispose();
        (flash.material as MeshBasicMaterial).dispose();
        flash.geometry.dispose();
      },
    });
  }

  function printedLetter(position: Vector3, letter: string) {
    const glyph = createGlyphMesh(letter, 'print');
    const material = glyph.userData.glyphMaterial as MeshBasicMaterial;
    glyph.position.copy(position);
    scene.add(glyph);
    effects.push({
      object: glyph,
      age: 0,
      life: 1.0,
      billboard: true,
      tick(t, dt) {
        glyph.scale.setScalar(1 + t * 0.35);
        glyph.position.y += dt * 0.4;
        material.opacity = Math.max(0, 1 - t * t);
      },
      cleanup() {
        material.dispose();
        for (const child of glyph.children) if (child instanceof Mesh) child.geometry.dispose();
      },
    });
  }

  unsubscribes.push(
    bus.on('lock', ({ worldPosition }) => ringPulse(worldPosition, VERMILLION, 2.0, 0.3, 1.6)),
    bus.on('unlock', ({ worldPosition }) => ringPulse(worldPosition, SMOKE, 1.0, 0.25, 0.9)),
    bus.on('fire', ({ worldPosition }) => ringPulse(worldPosition, BRASS, 1.6, 0.2, 1.1)),
    bus.on('miss', ({ worldPosition }) => ringPulse(worldPosition, SMOKE, 0.7, 0.3, 0.7)),
    bus.on('hit', ({ worldPosition }) => inkSplat(worldPosition)),
    bus.on('kill', ({ worldPosition, letter, volleyId }) => {
      if (letter) printedLetter(worldPosition, letter);
      if (volleyId !== undefined) {
        const bucket = volleyKills.get(volleyId) ?? [];
        bucket.push(worldPosition.clone());
        volleyKills.set(volleyId, bucket);
      }
    }),
    bus.on('volley', ({ volleyId, scoreAwarded }) => {
      const positions = volleyKills.get(volleyId) ?? [];
      volleyKills.delete(volleyId);
      if (scoreAwarded <= 0 || positions.length === 0) return;
      const centroid = positions
        .reduce((sum, position) => sum.add(position), new Vector3())
        .divideScalar(positions.length);
      // The word goes to print: a brass pressure wave and the room flashes.
      ringPulse(centroid, BRASS, 2.4, 0.9, 9);
      ringPulse(centroid, VERMILLION, 1.8, 0.6, 5);
      environment.flash(0.9);
    }),
    bus.on('beat', ({ isDownbeat, beatNumber }) => {
      if (beatNumber % 16 === 0) environment.flash(0.5);
      else if (isDownbeat) environment.flash(0.22);
    }),
    bus.on('runend', () => volleyKills.clear()),
  );

  return {
    update(dt: number, camera: PerspectiveCamera) {
      for (let i = effects.length - 1; i >= 0; i -= 1) {
        const effect = effects[i];
        effect.age += dt;
        const t = Math.min(1, effect.age / effect.life);
        if (effect.billboard) effect.object.quaternion.copy(camera.quaternion);
        effect.tick(t, dt);
        if (t >= 1) {
          effect.object.removeFromParent();
          effect.cleanup?.();
          effects.splice(i, 1);
        }
      }
    },
    dispose() {
      for (const unsubscribe of unsubscribes) unsubscribe();
      for (const effect of effects) {
        effect.object.removeFromParent();
        effect.cleanup?.();
      }
      effects.length = 0;
      volleyKills.clear();
    },
  };
}
