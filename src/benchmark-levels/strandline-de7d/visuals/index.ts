import {
  BoxGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Fog,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Scene,
  ConeGeometry,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';

// Palette: sunlit water, glowing strands, sickly parasites
const WATER_DEEP = 0x002244;
const STRAND_GREEN = 0x55cc88;
const STRAND_GOLD = 0xddcc55;
const PARASITE_VIOLET = 0x8800aa;
const PARASITE_DARK = 0x440055;
const GLOW_GREEN = 0x77ffaa;
const GLOW_GOLD = 0xffdd77;

function addStrandMaterial() {
  return new MeshStandardMaterial({
    color: STRAND_GREEN,
    emissive: 0x224422,
    emissiveIntensity: 0.6,
  });
}

function parasiteMaterial() {
  return new MeshBasicMaterial({ color: PARASITE_VIOLET, side: DoubleSide });
}

export function createEnvironment(scene: Scene) {
  // Subtle glowing particle background
  for (let i = 0; i < 40; i++) {
    const x = (Math.random() - 0.5) * 30;
    const y = (Math.random() - 0.5) * 20;
    const z = -30 - Math.random() * 300;
    const dot = new Mesh(
      new SphereGeometry(0.04, 4, 4),
      new MeshBasicMaterial({ color: 0x55aa88, opacity: 0.25, transparent: true, side: DoubleSide })
    );
    dot.position.set(x, y, z);
    scene.add(dot);
  }

  scene.background = new Color(WATER_DEEP);
  scene.fog = new Fog(WATER_DEEP, 30, 180);
}

function createLetterMesh(character: string) {
  const group = new Group();
  const cells = glyphOnCells(character);
  const fillGeo = new BoxGeometry(0.22, 0.22, 0.05);
  const fillMat = new MeshBasicMaterial({ color: GLOW_GOLD, side: DoubleSide });
  for (const cell of cells) {
    const block = new Mesh(fillGeo, fillMat);
    block.position.set((cell.x - 2) * 0.28, (3 - cell.y) * 0.28, 0);
    group.add(block);
  }
  const ring = new Mesh(new TorusGeometry(0.92, 0.025, 6, 24), new MeshBasicMaterial({ color: GLOW_GREEN, side: DoubleSide }));
  group.add(ring);
  return group;
}

function createClingerMesh(): Group {
  const group = new Group();
  const core = new Mesh(new SphereGeometry(0.7, 12, 8), parasiteMaterial());
  group.add(core);
  // Spikes
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const spike = new Mesh(new CylinderGeometry(0.05, 0.02, 0.6), parasiteMaterial());
    spike.position.set(Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, 0);
    spike.rotation.z = angle + Math.PI / 2;
    group.add(spike);
  }
  group.scale.set(0.001, 0.001, 0.001);
  return group;
}

function createDartMesh(): Group {
  const group = new Group();
  const body = new Mesh(new CylinderGeometry(0.1, 0.35, 0.9, 8), parasiteMaterial());
  body.rotation.x = Math.PI / 2;
  group.add(body);
  const tip = new Mesh(new ConeGeometry(0.2, 0.35, 8), parasiteMaterial());
  tip.position.set(0.55, 0, 0);
  tip.rotation.z = -Math.PI / 2;
  group.add(tip);
  const tail = new Mesh(new CylinderGeometry(0.04, 0.08, 0.5), parasiteMaterial());
  tail.position.set(-0.55, 0, 0);
  group.add(tail);
  group.scale.set(0.001, 0.001, 0.001);
  return group;
}

function createBroodMesh(): Group {
  const group = new Group();
  // Central cluster of violet orbs
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const orb = new Mesh(new SphereGeometry(0.35, 8, 6), parasiteMaterial());
    orb.position.set(Math.cos(angle) * 0.4, Math.sin(angle) * 0.4, (i - 1) * 0.15);
    group.add(orb);
  }
  const ring = new Mesh(new TorusGeometry(0.7, 0.05, 8, 16), parasiteMaterial());
  ring.rotation.x = Math.PI / 2.5;
  group.add(ring);
  group.scale.set(0.001, 0.001, 0.001);
  return group;
}

function createCrownMesh(): Group {
  const group = new Group();
  // Large central web/lattice structure
  const lattice = new Mesh(new TorusGeometry(1.4, 0.35, 6, 16), parasiteMaterial());
  lattice.rotation.x = Math.PI / 4;
  group.add(lattice);
  const inner = new Mesh(new SphereGeometry(0.9, 10, 8), parasiteMaterial());
  group.add(inner);
  // Webbing strands radiating out
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const strand = new Mesh(new CylinderGeometry(0.06, 0.04, 1.8), parasiteMaterial());
    strand.position.set(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0);
    strand.rotation.z = angle;
    group.add(strand);
  }
  group.scale.set(0.001, 0.001, 0.001);
  return group;
}

export function createEnemyMesh(kind: string, letter?: string) {
  if (kind === 'letter' || letter) return createLetterMesh(letter ?? 'F');
  switch (kind) {
    case 'clinger': return createClingerMesh();
    case 'dart': return createDartMesh();
    case 'brood': return createBroodMesh();
    case 'crown': return createCrownMesh();
    default: return createClingerMesh();
  }
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.scale.setScalar(locked ? 1.15 : 1);
  const child = mesh.children[0] as Mesh | undefined;
  const mat = child?.material as MeshBasicMaterial | undefined;
  if (mat && mat.color) {
    mat.color.set(locked ? 0xaa55ff : PARASITE_VIOLET);
  }
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.scale.setScalar(0.6);
  const child = mesh.children[0] as Mesh | undefined;
  const mat = child?.material as MeshBasicMaterial | undefined;
  if (mat && mat.color) {
    mat.color.set(0xcc22ff);
  }
}

export function createProjectileMesh() {
  const group = new Group();
  const core = new Mesh(
    new OctahedronGeometry(0.3, 0),
    new MeshBasicMaterial({ color: GLOW_GREEN, side: DoubleSide })
  );
  core.scale.set(0.5, 0.3, 1.8);
  const glow = new Mesh(
    new RingGeometry(0.55, 0.65, 12),
    createAdditiveBasicMaterial({ color: GLOW_GOLD, opacity: 0.5, side: DoubleSide })
  );
  glow.scale.set(0.8, 0.5, 1);
  group.add(core, glow);
  return group;
}

export function createReticle() {
  const group = new Group();
  const outer = new Mesh(
    new RingGeometry(0.6, 0.66, 48),
    createAdditiveBasicMaterial({ color: GLOW_GOLD, opacity: 0.9, side: DoubleSide })
  );
  const inner = new Mesh(
    new RingGeometry(0.32, 0.36, 24),
    createAdditiveBasicMaterial({ color: GLOW_GREEN, opacity: 0.95, side: DoubleSide })
  );
  const dot = new Mesh(new SphereGeometry(0.05, 10, 6), new MeshBasicMaterial({ color: GLOW_GOLD }));
  group.add(outer, inner, dot);
  group.userData.parts = [outer, inner, dot];
  return group;
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  reticle.scale.setScalar(1 + lockCount * 0.06 + (active ? 0.08 : 0));
  const parts = reticle.userData.parts as Object3D[];
  for (const part of parts) {
    const mat = (part as Mesh).material as MeshBasicMaterial;
    if (mat && mat.color) {
      mat.color.set(active ? 0x77ffaa : 0x55aa88);
      mat.opacity = active ? 0.95 : 0.6;
    }
  }
}

export function installVisualEventHandlers(bus: EventBus, scene: Scene) {
  bus.on('spawn', ({ worldPosition }) => {
    // Small green-gold ring at spawn
    const ring = new Mesh(
      new RingGeometry(1.2, 1.35, 16),
      createAdditiveBasicMaterial({ color: GLOW_GREEN, opacity: 0.75, side: DoubleSide })
    );
    ring.position.copy(worldPosition);
    scene.add(ring);
    setTimeout(() => scene.remove(ring), 500);
  });

  bus.on('lock', ({ worldPosition, lockCount }) => {
    const ring = new Mesh(
      new RingGeometry(0.9 + lockCount * 0.15, 1.0 + lockCount * 0.15, 16),
      createAdditiveBasicMaterial({ color: GLOW_GOLD, opacity: 0.8, side: DoubleSide })
    );
    ring.position.copy(worldPosition);
    scene.add(ring);
    setTimeout(() => scene.remove(ring), 350);
  });

  bus.on('unlock', () => {
    // Visual handled by setEnemyLocked
  });

  bus.on('fire', ({ worldPosition }) => {
    const glint = new Mesh(
      new SphereGeometry(0.15, 8, 6),
      new MeshBasicMaterial({ color: GLOW_GOLD })
    );
    glint.position.copy(worldPosition);
    scene.add(glint);
    setTimeout(() => scene.remove(glint), 200);
  });

  bus.on('hit', ({ worldPosition, lethal }) => {
    const sparks = new Group();
    for (let i = 0; i < 6; i++) {
      const p = new Mesh(new SphereGeometry(0.08, 6, 4), new MeshBasicMaterial({ color: lethal ? 0xaa55ff : 0x77ffaa }));
      p.position.copy(worldPosition);
      p.position.x += (Math.random() - 0.5) * 0.8;
      p.position.y += (Math.random() - 0.5) * 0.8;
      sparks.add(p);
    }
    scene.add(sparks);
    setTimeout(() => scene.remove(sparks), 300);
  });

  bus.on('kill', ({ worldPosition }) => {
    const burst = new Group();
    for (let i = 0; i < 10; i++) {
      const p = new Mesh(new SphereGeometry(0.1, 6, 4), new MeshBasicMaterial({ color: 0xddcc55 }));
      p.position.copy(worldPosition);
      const angle = (i / 10) * Math.PI * 2;
      p.userData.dir = new Vector3(Math.cos(angle), Math.sin(angle), 0.2);
      burst.add(p);
    }
    scene.add(burst);
    const start = Date.now();
    const anim = () => {
      const dt = (Date.now() - start) / 1000;
      for (const child of burst.children) {
        const dir = (child as any).userData.dir as Vector3;
        child.position.add(dir.clone().multiplyScalar(dt * 3));
        child.scale.multiplyScalar(0.92);
      }
      if (dt < 0.6) requestAnimationFrame(anim); else scene.remove(burst);
    };
    anim();
  });

  bus.on('miss', ({ worldPosition }) => {
    const missRing = new Mesh(
      new RingGeometry(1.0, 1.15, 12),
      new MeshBasicMaterial({ color: 0xcc22ff, opacity: 0.5, side: DoubleSide })
    );
    missRing.position.copy(worldPosition);
    scene.add(missRing);
    setTimeout(() => scene.remove(missRing), 300);
  });

  bus.on('beat', ({ isDownbeat }) => {
    // Subtle background pulse handled in update if needed
  });

  bus.on('runstart', () => {
    // Clear transient effects handled above
  });
}
