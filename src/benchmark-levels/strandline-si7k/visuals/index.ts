import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial, createAdornmentSlot, createPendingVisualRecords } from '../../../engine/visual-kit';

// ------- Palette -------
const STRAND_GLOW = new Color(0x88ff66);
const STRAND_DEEP = new Color(0x114422);
const WATER_BLUE = new Color(0x0a3a5c);
const PARASITE_VIOLET = new Color(0x6600aa);
const PARASITE_SICK = new Color(0x8800cc);
const HDR_WHITE = new Color(0xffffff);
const HDR_GOLD = new Color(0xffcc44);

const MATERIAL_REF = () => new MeshBasicMaterial({ color: STRAND_GLOW.clone().multiplyScalar(0.9), transparent: true, opacity: 0.15, side: DoubleSide });
const HDR_MAT = (col: Color, op?: number) => new MeshBasicMaterial({ color: col, transparent: op !== undefined, opacity: op ?? 1, side: DoubleSide });

// ------- Environment: glowing strands -------
export function createEnvironment(scene: Scene) {
  // Create a field of glowing vertical strand curves
  for (let i = 0; i < 24; i++) {
    const curvePoints = [
      new Vector3((Math.random() - 0.5) * 35, 0, -10 - Math.random() * 60),
      new Vector3((Math.random() - 0.5) * 25, 8 + Math.random() * 12, -60 - Math.random() * 80),
      new Vector3((Math.random() - 0.5) * 30, 4 + Math.random() * 14, -140 - Math.random() * 100),
    ];
    const strand = new Mesh(
      new SphereGeometry(0.35, 8, 6),
      new MeshBasicMaterial({ color: STRAND_GLOW.clone().multiplyScalar(1.4), emissive: STRAND_GLOW.clone().multiplyScalar(0.3), emissiveIntensity: 0.6 })
    );
    strand.position.copy(curvePoints[1]);
    strand.scale.set(0.25, 3.5, 0.25);
    scene.add(strand);
  }
  // Additional floating bioluminescent dots (deep water effect)
  for (let i = 0; i < 60; i++) {
    const dot = new Mesh(
      new SphereGeometry(0.08, 6, 4),
      new MeshBasicMaterial({ color: STRAND_GLOW.clone().multiplyScalar(0.7), emissive: STRAND_GLOW.clone().multiplyScalar(0.2) })
    );
    dot.position.set(
      (Math.random() - 0.5) * 50,
      Math.random() * 20 - 2,
      -20 - Math.random() * 200,
    );
    scene.add(dot);
  }
  // Background plane for water depth
  const bg = new Mesh(
    new PlaneGeometry(200, 200),
    new MeshBasicMaterial({ color: WATER_BLUE, transparent: true, opacity: 0.6, side: DoubleSide })
  );
  bg.rotation.x = Math.PI / 2;
  bg.position.set(0, -10, -120);
  scene.add(bg);
}

// ------- Visual bookkeeping -------
const enemyRecords = createPendingVisualRecords<Group>({
  createRecord: (mesh) => ({}),
  disposeRecord: () => {},
});

// ------- Enemy meshes -------
export function createEnemyMesh(kind: string, letter?: string) {
  if (kind === 'letter' || letter) return createLetterMesh(letter ?? 'A');
  const mesh = buildEnemyMesh(kind);
  mesh.scale.setScalar(0.001);
  enemyRecords.enqueue(mesh);
  return mesh;
}

function buildEnemyMesh(kind: string): Group {
  const group = new Group();
  switch (kind) {
    case 'clamp': {
      // Small violet parasite clamped to strand: dark core with glowing violet tendrils
      const core = new Mesh(
        new SphereGeometry(0.45, 8, 6),
        new MeshBasicMaterial({ color: PARASITE_VIOLET.clone().multiplyScalar(0.9), emissive: PARASITE_SICK.clone().multiplyScalar(0.3) })
      );
      const ring = new Mesh(
        new RingGeometry(0.35, 0.55, 6),
        new MeshBasicMaterial({ color: PARASITE_SICK, side: DoubleSide })
      );
      ring.rotation.x = Math.PI / 2;
      group.add(core, ring);
      group.userData.accent = PARASITE_SICK;
      break;
    }
    case 'larva': {
      // Swimming larva: elongated violet body with bioluminescent tips
      const body = new Mesh(
        new SphereGeometry(0.55, 8, 8),
        new MeshBasicMaterial({ color: PARASITE_VIOLET, emissive: PARASITE_SICK, emissiveIntensity: 0.5 })
      );
      body.scale.set(1.2, 0.6, 0.6);
      const tip = new Mesh(
        new SphereGeometry(0.2, 6, 4),
        new MeshBasicMaterial({ color: HDR_WHITE.clone().lerp(PARASITE_SICK, 0.6), emissive: PARASITE_SICK })
      );
      tip.position.z = 0.5;
      group.add(body, tip);
      group.userData.accent = PARASITE_SICK;
      break;
    }
    case 'brood': {
      // Fresh brood: small pulsing violet orb
      const core = new Mesh(
        new SphereGeometry(0.35, 8, 6),
        new MeshBasicMaterial({ color: PARASITE_SICK.clone().multiplyScalar(0.7), emissive: PARASITE_VIOLET })
      );
      group.add(core);
      group.userData.accent = PARASITE_VIOLET;
      break;
    }
    case 'parent': {
      // Boss: large sphere with web-like lattice around it
      const core = new Mesh(
        new SphereGeometry(2.2, 16, 12),
        new MeshBasicMaterial({ color: PARASITE_VIOLET.clone().multiplyScalar(1.2), emissive: PARASITE_SICK })
      );
      // Web lattice: multiple rings
      for (let i = 0; i < 3; i++) {
        const ring = new Mesh(
          new RingGeometry(2.6 + i * 0.6, 2.7 + i * 0.6, 12),
          new MeshBasicMaterial({ color: PARASITE_SICK, transparent: true, opacity: 0.6, side: DoubleSide })
        );
        ring.rotation.x = Math.PI / 2 + i * 0.3;
        ring.rotation.y = i * 0.8;
        group.add(ring);
      }
      group.add(core);
      group.userData.accent = PARASITE_SICK;
      break;
    }
    case 'web': {
      // Web piece: a flat violet plate with glowing edges
      const plate = new Mesh(
        new PlaneGeometry(1.4, 1.4),
        new MeshBasicMaterial({ color: PARASITE_VIOLET.clone().multiplyScalar(0.6), transparent: true, opacity: 0.85, side: DoubleSide })
      );
      const edge = new Mesh(
        new RingGeometry(0.5, 0.7, 4),
        new MeshBasicMaterial({ color: PARASITE_SICK.clone().multiplyScalar(1.3), side: DoubleSide })
      );
      group.add(plate, edge);
      group.userData.accent = PARASITE_SICK;
      break;
    }
    default:
      const fallback = new Mesh(
        new SphereGeometry(0.6, 8, 6),
        new MeshBasicMaterial({ color: PARASITE_VIOLET })
      );
      group.add(fallback);
  }
  return group;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.userData.locked = locked;
  // Brighten the parasite's sick glow when locked
  const children = mesh.children;
  for (const child of children) {
    if (child instanceof Mesh && child.material instanceof MeshBasicMaterial) {
      if (locked) {
        child.material.color.copy(PARASITE_SICK.clone().multiplyScalar(1.6));
      } else {
        child.material.color.copy(PARASITE_VIOLET.clone().multiplyScalar(0.8));
      }
    }
  }
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.scale.setScalar(0.85);
  // Flash bright sick violet briefly
  for (const child of mesh.children) {
    if (child instanceof Mesh && child.material instanceof MeshBasicMaterial) {
      child.material.color.copy(PARASITE_SICK.clone().multiplyScalar(2.2));
    }
  }
}

export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(
    new SphereGeometry(0.18, 8, 6),
    new MeshBasicMaterial({ color: HDR_WHITE.clone().lerp(STRAND_GLOW, 0.3), emissive: HDR_WHITE, emissiveIntensity: 0.8 })
  );
  const trail = new Mesh(
    new SphereGeometry(0.28, 6, 4),
    new MeshBasicMaterial({ color: STRAND_GLOW, transparent: true, opacity: 0.35, side: DoubleSide })
  );
  group.add(core, trail);
  return group;
}

export function createReticle() {
  const group = new Group();
  const outer = new Mesh(
    new RingGeometry(0.55, 0.6, 24),
    new MeshBasicMaterial({ color: STRAND_GLOW, side: DoubleSide, transparent: true, opacity: 0.4 })
  );
  const inner = new Mesh(
    new RingGeometry(0.3, 0.33, 3),
    new MeshBasicMaterial({ color: HDR_WHITE, side: DoubleSide, transparent: true, opacity: 0.9 })
  );
  const center = new Mesh(
    new SphereGeometry(0.04, 8, 6),
    new MeshBasicMaterial({ color: HDR_GOLD })
  );
  group.add(outer, inner, center);
  group.scale.setScalar(0.001);
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  reticle.scale.setScalar(
    Math.max(0.001, 0.5 + lockCount * 0.15 + (active ? 0.2 : 0))
  );
  for (const child of reticle.children) {
    if (child instanceof Mesh && child.material instanceof MeshBasicMaterial) {
      if (child === reticle.children[0]) {
        child.material.opacity = active ? 0.8 : 0.3;
        child.material.color.copy(active ? HDR_GOLD.clone() : STRAND_GLOW.clone());
      } else if (child === reticle.children[1]) {
        child.material.opacity = Math.min(1, 0.4 + lockCount * 0.12);
      }
    }
  }
}

// ------- Letter glyphs -------
export function createLetterMesh(character: string) {
  const group = new Group();
  const cells = glyphOnCells(character);
  const fillGeo = new BoxGeometry(0.22, 0.22, 0.06);
  const edgeGeo = new BoxGeometry(0.26, 0.26, 0.02);
  for (const cell of cells) {
    const block = new Mesh(fillGeo, new MeshBasicMaterial({ color: STRAND_GLOW, emissive: HDR_GOLD, emissiveIntensity: 0.3 }));
    block.position.set((cell.x - 2) * 0.28, (3 - cell.y) * 0.28, 0);
    group.add(block);
  }
  // Glowing border ring
  const ring = new Mesh(
    new RingGeometry(0.85, 0.9, 4),
    new MeshBasicMaterial({ color: HDR_GOLD, transparent: true, opacity: 0.5, side: DoubleSide })
  );
  group.add(ring);
  return group;
}

// ------- Visual event handlers -------
export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ worldPosition }) => {
    const pulse = new Mesh(
      new RingGeometry(1.2, 1.5, 8),
      new MeshBasicMaterial({ color: STRAND_GLOW.clone().multiplyScalar(2), transparent: true, opacity: 0.6, side: DoubleSide })
    );
    pulse.position.copy(worldPosition);
    pulse.scale.setScalar(0.01);
    scene.add(pulse);
    setTimeout(() => {
      pulse.scale.setScalar(2);
      (pulse.material as MeshBasicMaterial).opacity = 0.05;
    }, 80);
    setTimeout(() => scene.remove(pulse), 500);
  });

  bus.on('lock', ({ worldPosition, lockCount }) => {
    const ring = new Mesh(
      new RingGeometry(0.7, 0.8, 4),
      new MeshBasicMaterial({ color: PARASITE_SICK.clone().multiplyScalar(1.5 + lockCount * 0.4), transparent: true, opacity: 0.7, side: DoubleSide })
    );
    ring.position.copy(worldPosition);
    scene.add(ring);
    setTimeout(() => scene.remove(ring), 350);
  });

  bus.on('unlock', ({ worldPosition }) => {
    // Fade out ring
  });

  bus.on('fire', ({ worldPosition }) => {
    const flash = new Mesh(
      new SphereGeometry(1.0, 8, 6),
      new MeshBasicMaterial({ color: HDR_WHITE.clone(), transparent: true, opacity: 0.4 })
    );
    flash.position.copy(worldPosition);
    scene.add(flash);
    setTimeout(() => scene.remove(flash), 120);
  });

  bus.on('hit', ({ worldPosition, lethal }) => {
    const sparkCount = lethal ? 8 : 4;
    for (let i = 0; i < sparkCount; i++) {
      const spark = new Mesh(
        new SphereGeometry(0.1, 6, 4),
        new MeshBasicMaterial({ color: lethal ? PARASITE_SICK : HDR_GOLD.clone(), emissive: lethal ? PARASITE_SICK : HDR_GOLD })
      );
      spark.position.copy(worldPosition);
      spark.position.add(new Vector3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2));
      scene.add(spark);
      setTimeout(() => scene.remove(spark), 300 + Math.random() * 200);
    }
  });

  bus.on('kill', ({ worldPosition }) => {
    const burst = new Mesh(
      new SphereGeometry(2.5, 12, 8),
      new MeshBasicMaterial({ color: PARASITE_SICK.clone().multiplyScalar(0.5), emissive: PARASITE_VIOLET, emissiveIntensity: 0.8, transparent: true, opacity: 0.5 })
    );
    burst.position.copy(worldPosition);
    scene.add(burst);
    setTimeout(() => scene.remove(burst), 600);
    // Additional ring
    const ring = new Mesh(      new RingGeometry(2.0, 2.3, 8),
      new MeshBasicMaterial({ color: PARASITE_SICK.clone().multiplyScalar(2), transparent: true, opacity: 0.5 })
    );
    ring.position.copy(worldPosition);
    scene.add(ring);
    setTimeout(() => scene.remove(ring), 400);
  });

  bus.on('miss', ({ worldPosition }) => {
    const fadeRing = new Mesh(
      new RingGeometry(1.0, 1.4, 8),
      new MeshBasicMaterial({ color: STRAND_GLOW.clone().multiplyScalar(0.4), transparent: true, opacity: 0.25 })
    );
    fadeRing.position.copy(worldPosition);
    scene.add(fadeRing);
    setTimeout(() => scene.remove(fadeRing), 350);
  });

  bus.on('stage', ({ worldPosition }) => {
    const ring = new Mesh(
      new RingGeometry(1.4, 1.7, 6),
      new MeshBasicMaterial({ color: HDR_GOLD, transparent: true, opacity: 0.7 })
    );
    ring.position.copy(worldPosition);
    scene.add(ring);
    setTimeout(() => scene.remove(ring), 500);
  });

  bus.on('reject', () => {
    // Flash reticle red briefly handled by setEnemyDenied; no extra scene effect needed
  });

  bus.on('beat', ({ isDownbeat }) => {
    // Subtle scene pulse on downbeat could be added here; minimal for clarity
  });

  bus.on('playerhit', () => {
    // Red flash handled by engine HUD; we add a brief scene vignette tint via post
  });
}
