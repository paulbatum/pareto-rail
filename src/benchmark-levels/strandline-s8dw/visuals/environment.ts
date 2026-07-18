import {
  AdditiveBlending,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
} from 'three';
import type { Camera, CatmullRomCurve3 as RailCurve } from 'three';
import { sampleRailFrame } from '../../../engine/rail';
import { disposeObject3D } from '../../../engine/visual-kit';
import { STRANDLINE_DURATION, STRANDLINE_MARKERS } from '../timing';
import type { StrandlinePalette } from './models';

type EnvironmentOptions = {
  rail: RailCurve;
  palette: StrandlinePalette;
};

export function createStrandlineEnvironment(scene: Scene, options: EnvironmentOptions) {
  const { rail, palette } = options;
  const root = new Group();
  const organism = new Group();
  const strandForest = createStrandForest(palette);
  const bell = createBell(palette);
  const crown = createCrownLattice(palette);
  const plankton = createPlankton(palette);
  const caustics = createCausticField(rail, palette);
  const lightShafts = createLightShafts(palette);
  organism.add(strandForest.root, bell.root, crown.root);
  root.add(organism, plankton.root, caustics.root, lightShafts.root);
  root.traverse((child) => { child.raycast = () => {}; });
  scene.add(root);

  const baseBackground = palette.deep.clone().lerp(palette.water, 0.36);
  scene.background = baseBackground.clone();
  scene.fog = new FogExp2(baseBackground.clone(), 0.0048);

  let broodSectors = 3;
  let parentReleased = false;
  let releaseAge = 0;
  let flash = 0;
  let restored = 0;
  const activeWebSectors = [true, true, true];

  return {
    root,
    setBroodSectors(count: number) {
      broodSectors = Math.max(0, Math.min(3, count));
      crown.setWebSectors(broodSectors);
    },
    clearWebSector(slot: number) {
      if (slot >= 0 && slot < activeWebSectors.length) activeWebSectors[slot] = false;
      broodSectors = activeWebSectors.filter(Boolean).length;
      crown.setWebMask(activeWebSectors);
    },
    setParentReleased(released: boolean) {
      parentReleased = released;
      releaseAge = 0;
      flash = Math.max(flash, released ? 0.85 : 0);
      strandForest.setClean(released);
    },
    flash(amount = 0.28) {
      flash = Math.max(flash, amount);
    },
    restore(amount = 0.02) {
      restored = Math.min(1, restored + amount);
    },
    reset() {
      broodSectors = 3;
      parentReleased = false;
      releaseAge = 0;
      flash = 0;
      restored = 0;
      activeWebSectors.fill(true);
      crown.setWebSectors(3);
      strandForest.setClean(false);
      organism.position.set(0, 0, 0);
      organism.rotation.set(0, 0, 0);
      organism.scale.setScalar(1);
      caustics.root.visible = true;
    },
    update(dt: number, runTime: number, running: boolean, beatEnergy: number, camera: Camera) {
      if (parentReleased) releaseAge += dt;
      const progress = running ? Math.min(1, runTime / STRANDLINE_DURATION) : 0;
      const life = Math.min(1, progress * 0.64 + restored * 0.14 + (3 - broodSectors) * 0.06 + (parentReleased ? 0.22 : 0));
      const pulse = 0.5 + 0.5 * Math.sin(runTime * (128 / 60) * Math.PI * 0.5);
      const revealMood = smoothBand(runTime, 20.8, 22.6, 28.3, 30.2);
      const deepMood = smoothBand(runTime, 29.2, 32.2, 39.4, 42.1);
      const crownMood = smooth01((runTime - 40.5) / 3.2);

      strandForest.update(dt, runTime, life, beatEnergy, parentReleased);
      bell.update(dt, runTime, life, beatEnergy, parentReleased);
      crown.update(dt, runTime, broodSectors, parentReleased);
      plankton.update(dt, runTime, camera, progress);
      caustics.update(dt, runTime, beatEnergy, life);
      lightShafts.update(runTime, life, parentReleased, 1 - deepMood * 0.64);
      caustics.root.visible = !parentReleased || releaseAge < 1.1;

      if (parentReleased) {
        const drift = Math.min(1, releaseAge / 4);
        organism.position.x = drift * 2.4;
        organism.position.y = drift * 5.2;
        organism.position.z = -drift * 1.6;
        organism.rotation.z = Math.sin(releaseAge * 0.32) * 0.018;
      }

      flash = Math.max(0, flash - dt * 1.35);
      const mood = baseBackground.clone()
        .lerp(palette.water, revealMood * 0.3)
        .lerp(palette.deep, deepMood * 0.32)
        .lerp(palette.jade, crownMood * 0.09)
        .lerp(palette.water, parentReleased ? Math.min(0.42, releaseAge * 0.11) : 0);
      const clear = mood.lerp(palette.jade, life * 0.16 + pulse * 0.022);
      const flashColor = palette.sun;
      (scene.background as Color).copy(clear).lerp(flashColor, flash * 0.18);
      if (scene.fog instanceof FogExp2) {
        scene.fog.color.copy(scene.background as Color);
        scene.fog.density = 0.0048 - life * 0.00125 - (parentReleased ? Math.min(0.00265, releaseAge * 0.00078) : 0);
      }
    },
    dispose() {
      root.removeFromParent();
      disposeObject3D(root);
      scene.fog = null;
    },
  };
}

function createStrandForest(palette: StrandlinePalette) {
  const root = new Group();
  const outerMaterial = new MeshBasicMaterial({
    color: palette.jade.clone().multiplyScalar(0.5),
    transparent: true,
    opacity: 0.52,
    side: DoubleSide,
    depthWrite: false,
  });
  const glowMaterial = new MeshBasicMaterial({
    color: palette.gold.clone().multiplyScalar(1.08),
    transparent: true,
    opacity: 0.32,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const cleanMaterial = new MeshBasicMaterial({
    color: palette.sun.clone().multiplyScalar(1.3),
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const strands: Array<{ mesh: Mesh; core?: Mesh; phase: number; rootX: number; rootY: number }> = [];
  const strandCount = 46;
  for (let i = 0; i < strandCount; i += 1) {
    const ring = i % 3;
    const angle = i / strandCount * Math.PI * 2 * 4.5 + ring * 0.4;
    const radius = 8 + (i % 11) * 2.55;
    const rootX = Math.cos(angle) * radius;
    const rootY = 39 + Math.sin(angle) * radius * 0.38;
    const lateral = Math.sin(i * 2.17) * 10;
    const points = [
      new Vector3(rootX, rootY, -438),
      new Vector3(rootX * 0.86 + lateral, rootY - 15, -345),
      new Vector3(rootX * 0.72 - lateral * 0.55, rootY - 26 + Math.cos(i) * 7, -250),
      new Vector3(rootX * 0.58 + lateral * 0.7, rootY - 40 + Math.sin(i * 1.4) * 8, -145),
      new Vector3(rootX * 0.48 - lateral * 0.45, rootY - 56 + Math.cos(i * 0.8) * 7, -36),
      new Vector3(rootX * 0.42 + Math.sin(i) * 5, rootY - 67, 32),
    ];
    const curve = new CatmullRomCurve3(points, false, 'catmullrom', 0.42);
    const radiusScale = i % 9 === 0 ? 0.52 : i % 4 === 0 ? 0.32 : 0.18;
    const mesh = new Mesh(new TubeGeometry(curve, 56, radiusScale, 5, false), outerMaterial);
    mesh.userData.phase = i * 0.73;
    root.add(mesh);
    let core: Mesh | undefined;
    if (i % 3 === 0) {
      core = new Mesh(new TubeGeometry(curve, 56, radiusScale * 0.28, 4, false), i % 6 === 0 ? cleanMaterial : glowMaterial);
      root.add(core);
    }
    strands.push({ mesh, core, phase: i * 0.73, rootX, rootY });

    // Muscle nodes make the strands read as living anatomy, not cables.
    if (i % 5 === 0) {
      for (let node = 1; node <= 3; node += 1) {
        const u = node * 0.22 + (i % 3) * 0.035;
        const bead = new Mesh(
          new SphereGeometry(radiusScale * 1.8, 7, 5),
          new MeshBasicMaterial({ color: palette.gold.clone().multiplyScalar(1.1), transparent: true, opacity: 0.64, blending: AdditiveBlending, depthWrite: false }),
        );
        bead.position.copy(curve.getPointAt(u));
        bead.userData.phase = i + node;
        bead.userData.muscleNode = true;
        root.add(bead);
      }
    }
  }

  let clean = false;
  return {
    root,
    setClean(value: boolean) { clean = value; },
    update(dt: number, runTime: number, life: number, beatEnergy: number, released: boolean) {
      outerMaterial.color.copy(palette.jade).multiplyScalar(0.44 + life * 0.42);
      outerMaterial.opacity = 0.42 + life * 0.18;
      glowMaterial.color.copy(palette.gold).lerp(palette.sun, life * 0.34).multiplyScalar(0.92 + life * 0.42 + beatEnergy * 0.08);
      glowMaterial.opacity = 0.22 + life * 0.24;
      cleanMaterial.opacity = clean ? Math.min(0.86, cleanMaterial.opacity + dt * 0.32) : Math.max(0, cleanMaterial.opacity - dt);
      strands.forEach(({ mesh, core, phase }, index) => {
        const breathe = 1 + Math.sin(runTime * 0.72 + phase) * (0.012 + life * 0.008);
        mesh.scale.x = breathe;
        mesh.scale.y = breathe;
        if (core) core.visible = !released || index % 2 === 0;
      });
      root.children.forEach((child) => {
        if (!child.userData.muscleNode) return;
        const pulse = 1 + Math.sin(runTime * 1.6 + Number(child.userData.phase)) * 0.18 + beatEnergy * 0.08;
        child.scale.setScalar(pulse);
      });
    },
  };
}

function createBell(palette: StrandlinePalette) {
  const root = new Group();
  const center = new Vector3(0, 48, -452);
  const shellMaterial = new MeshBasicMaterial({
    color: palette.jade.clone().multiplyScalar(0.82),
    transparent: true,
    opacity: 0.16,
    side: DoubleSide,
    depthWrite: false,
  });
  const rimMaterial = new MeshBasicMaterial({
    color: palette.gold.clone().multiplyScalar(1.45),
    transparent: true,
    opacity: 0.55,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const innerMaterial = new MeshBasicMaterial({
    color: palette.sun.clone().multiplyScalar(1.15),
    transparent: true,
    opacity: 0.19,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const shell = new Mesh(new SphereGeometry(55, 48, 28, 0, Math.PI * 2, 0, Math.PI * 0.63), shellMaterial);
  shell.position.copy(center);
  shell.scale.set(1, 0.62, 0.78);
  const inner = new Mesh(new SphereGeometry(42, 36, 22, 0, Math.PI * 2, 0, Math.PI * 0.62), innerMaterial);
  inner.position.copy(center).add(new Vector3(0, -1.5, 3));
  inner.scale.set(1, 0.58, 0.75);
  const rim = new Mesh(new TorusGeometry(51, 0.42, 6, 96), rimMaterial);
  rim.position.copy(center).add(new Vector3(0, -7, 0));
  rim.rotation.x = Math.PI * 0.5;
  rim.scale.y = 0.78;
  root.add(shell, inner, rim);
  const meridians: Mesh[] = [];
  for (let i = 0; i < 12; i += 1) {
    const ring = new Mesh(new TorusGeometry(38 - i % 3 * 3.5, 0.09, 4, 64, Math.PI * 1.25), rimMaterial);
    ring.position.copy(center);
    ring.rotation.y = i / 12 * Math.PI * 2;
    ring.rotation.z = Math.PI * 0.38;
    ring.scale.set(1, 0.68, 0.8);
    ring.raycast = () => {};
    root.add(ring);
    meridians.push(ring);
  }
  return {
    root,
    update(_dt: number, runTime: number, life: number, beatEnergy: number, released: boolean) {
      const breathe = 1 + Math.sin(runTime * 0.67) * 0.022 + (released ? Math.sin(runTime * 1.05) * 0.014 : 0);
      shell.scale.set(breathe, 0.62 * breathe, 0.78 * breathe);
      inner.scale.set(breathe * 0.97, 0.58 * breathe, 0.75 * breathe);
      shellMaterial.opacity = 0.12 + life * 0.12;
      shellMaterial.color.copy(palette.jade).lerp(palette.gold, life * 0.2).multiplyScalar(0.72 + life * 0.48);
      innerMaterial.opacity = 0.11 + life * 0.17 + beatEnergy * 0.018;
      rimMaterial.opacity = 0.34 + life * 0.35;
      rimMaterial.color.copy(palette.gold).lerp(palette.sun, released ? 0.72 : life * 0.25).multiplyScalar(1.1 + beatEnergy * 0.18);
      meridians.forEach((ring, index) => { ring.rotation.y += 0.00008 * (index % 2 ? 1 : -1); });
    },
  };
}

function createCrownLattice(palette: StrandlinePalette) {
  const root = new Group();
  const webMaterial = new MeshBasicMaterial({
    color: palette.parasite.clone().multiplyScalar(1.3),
    transparent: true,
    opacity: 0.68,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const nodeMaterial = new MeshBasicMaterial({ color: palette.sour.clone().multiplyScalar(1.7), transparent: true, opacity: 0.75, blending: AdditiveBlending, depthWrite: false });
  const center = new Vector3(0, 41.5, -438);
  const sectors: Group[] = [];
  const sectorAngles = [150, 30, 270].map((degrees) => degrees / 180 * Math.PI);
  for (let sector = 0; sector < 3; sector += 1) {
    const group = new Group();
    const a0 = sectorAngles[sector];
    for (let strand = 0; strand < 7; strand += 1) {
      const a = a0 + (strand - 3) * 0.12;
      const curve = new CatmullRomCurve3([
        center.clone().add(new Vector3(Math.cos(a) * 2, Math.sin(a) * 2, 0)),
        center.clone().add(new Vector3(Math.cos(a + 0.35) * 8, Math.sin(a + 0.35) * 6, 1)),
        center.clone().add(new Vector3(Math.cos(a - 0.18) * 16, Math.sin(a - 0.18) * 11, 2)),
      ]);
      group.add(new Mesh(new TubeGeometry(curve, 16, 0.05, 3, false), webMaterial));
    }
    const node = new Mesh(new IcosahedronGeometry(0.6, 1), nodeMaterial);
    node.position.copy(center).add(new Vector3(Math.cos(a0) * 14, Math.sin(a0) * 9, 2));
    group.add(node);
    root.add(group);
    sectors.push(group);
  }
  return {
    root,
    setWebSectors(count: number) {
      sectors.forEach((sector, index) => { sector.visible = index < count; });
    },
    setWebMask(mask: readonly boolean[]) {
      sectors.forEach((sector, index) => { sector.visible = mask[index] ?? false; });
    },
    update(_dt: number, runTime: number, count: number, released: boolean) {
      webMaterial.opacity = released ? Math.max(0, webMaterial.opacity - 0.02) : 0.5 + count * 0.07 + Math.sin(runTime * 4) * 0.04;
      nodeMaterial.opacity = 0.55 + Math.sin(runTime * 3.4) * 0.18;
      sectors.forEach((sector, index) => { sector.rotation.z = Math.sin(runTime * 0.55 + index * 2) * 0.035; });
    },
  };
}

function createPlankton(palette: StrandlinePalette) {
  const root = new Group();
  const count = 1050;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const seed = hash(i * 3.17);
    positions[i * 3] = (hash(i * 7.1) - 0.5) * 180;
    positions[i * 3 + 1] = (hash(i * 11.4) - 0.5) * 120 + 12;
    positions[i * 3 + 2] = 35 - seed * 540;
    const color = (i % 9 === 0 ? palette.gold : palette.water).clone().lerp(palette.sun, hash(i * 2.9) * 0.35);
    colors.set([color.r, color.g, color.b], i * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const material = new PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, opacity: 0.58, blending: AdditiveBlending, depthWrite: false, sizeAttenuation: true });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  const streakPositions: number[] = [];
  for (let i = 0; i < 180; i += 1) {
    const x = (hash(i * 13.7) - 0.5) * 150;
    const y = (hash(i * 5.3) - 0.5) * 100 + 10;
    const z = 35 - hash(i * 8.9) * 520;
    const length = 0.35 + hash(i * 19.1) * 2.8;
    streakPositions.push(x, y, z, x + Math.sin(i) * 0.12, y + length * 0.22, z + length);
  }
  const streakGeometry = new BufferGeometry();
  streakGeometry.setAttribute('position', new Float32BufferAttribute(streakPositions, 3));
  const streakMaterial = new LineBasicMaterial({
    color: palette.sun.clone().multiplyScalar(0.78),
    transparent: true,
    opacity: 0.2,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const streaks = new LineSegments(streakGeometry, streakMaterial);
  streaks.frustumCulled = false;
  root.add(points, streaks);
  return {
    root,
    update(dt: number, runTime: number, camera: Camera, progress: number) {
      points.rotation.z += dt * 0.0015;
      points.position.y = Math.sin(runTime * 0.15) * 1.4;
      material.opacity = 0.46 + progress * 0.18;
      streaks.position.y = Math.sin(runTime * 0.21 + 1.3) * 1.1;
      streakMaterial.opacity = 0.12 + progress * 0.14;
      // A small camera-relative drift sells suspended particulate without
      // pinning the whole field to the cockpit.
      points.position.x = camera.position.x * 0.025;
    },
  };
}

function createCausticField(rail: RailCurve, palette: StrandlinePalette) {
  const root = new Group();
  const lines: Mesh[] = [];
  const material = new MeshBasicMaterial({ color: palette.sun.clone().multiplyScalar(0.9), transparent: true, opacity: 0.1, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  for (let i = 0; i < 34; i += 1) {
    const u = (i + 1) / 36;
    const frame = sampleRailFrame(rail, u);
    const ring = new Mesh(new RingGeometry(13 + i % 4 * 2.8, 13.08 + i % 4 * 2.8, 42, 1, i * 0.23, Math.PI * (0.6 + i % 3 * 0.18)), material);
    ring.position.copy(frame.position).addScaledVector(frame.up, 6 + i % 5 * 2);
    ring.lookAt(frame.position.clone().add(frame.tangent));
    ring.rotateZ(i * 0.87);
    root.add(ring);
    lines.push(ring);
  }
  return {
    root,
    update(dt: number, _runTime: number, beatEnergy: number, life: number) {
      material.opacity = 0.055 + life * 0.08 + beatEnergy * 0.028;
      material.color.copy(palette.sun).lerp(palette.gold, 0.35).multiplyScalar(0.75 + life * 0.45);
      lines.forEach((line, index) => { line.rotation.z += dt * (index % 2 ? 0.016 : -0.012); });
    },
  };
}

function createLightShafts(palette: StrandlinePalette) {
  const root = new Group();
  const materials: MeshBasicMaterial[] = [];
  for (let i = 0; i < 9; i += 1) {
    const material = new MeshBasicMaterial({ color: palette.sun.clone().multiplyScalar(0.75), transparent: true, opacity: 0.035, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    const cone = new Mesh(new ConeGeometry(10 + i % 3 * 5, 155, 10, 1, true), material);
    cone.position.set((i - 4) * 24 + Math.sin(i) * 8, 82, -45 - i * 48);
    cone.rotation.z = Math.sin(i * 1.8) * 0.12;
    root.add(cone);
    materials.push(material);
  }
  return {
    root,
    update(runTime: number, life: number, released: boolean, sunlight: number) {
      materials.forEach((material, index) => {
        const base = (0.024 + life * 0.025 + Math.sin(runTime * 0.32 + index) * 0.006) * sunlight;
        material.opacity = released ? base * 0.32 : base;
      });
    },
  };
}

function hash(n: number) {
  const value = Math.sin(n * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function smooth01(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function smoothBand(value: number, fadeInStart: number, fadeInEnd: number, fadeOutStart: number, fadeOutEnd: number) {
  return smooth01((value - fadeInStart) / Math.max(0.001, fadeInEnd - fadeInStart))
    * (1 - smooth01((value - fadeOutStart) / Math.max(0.001, fadeOutEnd - fadeOutStart)));
}
