import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  FogExp2,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  hdr,
  JELLY_EMERALD,
  JELLY_GOLD,
  JELLY_MINT,
  OCEAN_ABYSS,
  OCEAN_CLEAR,
  PARASITE_BRUISE,
  PARASITE_TOXIC,
  PARASITE_VIOLET,
  SUNLIGHT_RAY,
} from './palette';

export type EnvironmentUpdateContext = {
  camera: PerspectiveCamera;
  runTime: number;
  running: boolean;
  elapsed: number;
  beatEnergy: number;
  bossLatticeHealth: number; // 1.0 down to 0.0
  purified: boolean;
};

export type StrandlineEnvironment = {
  root: Group;
  update(dt: number, ctx: EnvironmentUpdateContext): void;
  setBossLatticeLevel(level: number): void;
  setPurified(purified: boolean): void;
  dispose(): void;
};

const STRAND_COUNT = 52;
const STRAND_SEGMENTS = 24;
const PLANKTON_COUNT = 600;
const SUNRAY_COUNT = 12;

export function createEnvironmentInternal(scene: Scene): StrandlineEnvironment {
  const root = new Group();
  root.userData.raildIgnoreOcclusion = true;

  scene.background = OCEAN_ABYSS.clone();
  scene.fog = new FogExp2(OCEAN_ABYSS.clone().getHex(), 0.0075);

  // 1. THE COLOSSAL JELLYFISH BELL (Giant glowing emerald moon)
  const bellGroup = new Group();
  bellGroup.position.set(0, 35, -570);
  bellGroup.userData.raildIgnoreOcclusion = true;

  // Outer translucent canopy dome (radius 110, height 70)
  const domeGeom = new SphereGeometry(110, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const domeMat = new MeshBasicMaterial({
    color: JELLY_EMERALD.clone().multiplyScalar(0.7),
    transparent: true,
    opacity: 0.35,
    side: DoubleSide,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const domeMesh = new Mesh(domeGeom, domeMat);
  domeMesh.userData.raildIgnoreOcclusion = true;
  bellGroup.add(domeMesh);

  // Inner rib lines (luminous meridians running along bell)
  const ribGeom = new SphereGeometry(109, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const ribMat = new LineBasicMaterial(
    additiveMaterialParameters({ color: hdr(JELLY_MINT, 1.8), transparent: true, opacity: 0.6 }),
  );
  const ribMesh = new LineSegments(ribGeom, ribMat);
  ribMesh.userData.raildIgnoreOcclusion = true;
  bellGroup.add(ribMesh);

  // Bell rim frills / crown ring
  const rimGeom = new TorusGeometry(108, 2.5, 8, 48);
  rimGeom.rotateX(Math.PI / 2);
  const rimMat = new MeshBasicMaterial(
    additiveMaterialParameters({ color: hdr(JELLY_GOLD, 1.6), transparent: true, opacity: 0.75 }),
  );
  const rimMesh = new Mesh(rimGeom, rimMat);
  rimMesh.position.y = -8;
  rimMesh.userData.raildIgnoreOcclusion = true;
  bellGroup.add(rimMesh);

  // Central oral arms / frills hanging beneath bell
  const oralArms = new Group();
  oralArms.userData.raildIgnoreOcclusion = true;
  for (let i = 0; i < 4; i++) {
    const armGeom = new CylinderGeometry(4, 1.5, 90, 6);
    const armMat = new MeshBasicMaterial(
      additiveMaterialParameters({ color: hdr(JELLY_MINT, 1.2), transparent: true, opacity: 0.4 }),
    );
    const arm = new Mesh(armGeom, armMat);
    const ang = (i / 4) * Math.PI * 2;
    arm.position.set(Math.cos(ang) * 18, -45, Math.sin(ang) * 18);
    arm.rotation.z = Math.cos(ang) * 0.15;
    arm.rotation.x = Math.sin(ang) * 0.15;
    arm.userData.raildIgnoreOcclusion = true;
    oralArms.add(arm);
  }
  bellGroup.add(oralArms);
  root.add(bellGroup);

  // 2. FOREST OF TRAILING TENTACLES / STRANDS
  // Each strand is a segmented line strip trailing back from z = -530 to z = +40
  const strandLines: {
    line: LineSegments;
    geom: BufferGeometry;
    positions: Float32Array;
    baseX: number;
    baseY: number;
    radius: number;
    angle: number;
    wavePhase: number;
    waveSpeed: number;
    material: LineBasicMaterial;
  }[] = [];

  const strandGroup = new Group();
  strandGroup.userData.raildIgnoreOcclusion = true;

  for (let i = 0; i < STRAND_COUNT; i++) {
    const angle = (i / STRAND_COUNT) * Math.PI * 2;
    // Keep central corridor (radius 14m - 48m around z-axis)
    const rad = 15 + (i % 5) * 7.5;
    const baseX = Math.cos(angle) * rad;
    const baseY = Math.sin(angle) * rad + 20;

    const positions = new Float32Array(STRAND_SEGMENTS * 2 * 3);
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));

    // Outer strands are emerald/mint, infested sectors carry purple
    const isInfestedSector = i >= 12 && i <= 36;
    const col = isInfestedSector ? PARASITE_VIOLET.clone().lerp(JELLY_EMERALD, 0.2) : JELLY_EMERALD.clone();
    const mat = new LineBasicMaterial(
      additiveMaterialParameters({
        color: hdr(col, 1.3),
        transparent: true,
        opacity: 0.75,
      }),
    );

    const line = new LineSegments(geom, mat);
    line.userData.raildIgnoreOcclusion = true;
    strandGroup.add(line);

    strandLines.push({
      line,
      geom,
      positions,
      baseX,
      baseY,
      radius: rad,
      angle,
      wavePhase: Math.random() * Math.PI * 2,
      waveSpeed: 0.8 + Math.random() * 0.6,
      material: mat,
    });
  }
  root.add(strandGroup);

  // 3. SUNLIGHT GODRAYS (Ethereal beams streaming from ocean surface)
  const sunrayGroup = new Group();
  sunrayGroup.userData.raildIgnoreOcclusion = true;
  const rayGeom = new CylinderGeometry(0.8, 14, 180, 8, 1, true);
  rayGeom.rotateZ(0.22);
  rayGeom.rotateX(0.15);

  const rayMat = new MeshBasicMaterial({
    color: SUNLIGHT_RAY.clone(),
    transparent: true,
    opacity: 0.08,
    side: DoubleSide,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  const sunraysMesh = new InstancedMesh(rayGeom, rayMat, SUNRAY_COUNT);
  sunraysMesh.userData.raildIgnoreOcclusion = true;
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3(1, 1, 1);

  for (let i = 0; i < SUNRAY_COUNT; i++) {
    const p = new Vector3(
      (Math.random() - 0.5) * 160,
      60 + Math.random() * 20,
      -i * 50 + 20,
    );
    const scale = 0.8 + Math.random() * 0.8;
    s.set(scale, scale, scale);
    m.compose(p, q, s);
    sunraysMesh.setMatrixAt(i, m);
  }
  sunraysMesh.instanceMatrix.needsUpdate = true;
  sunrayGroup.add(sunraysMesh);
  root.add(sunrayGroup);

  // 4. MARINE SNOW / BIOLUMINESCENT PLANKTON PARTICLES
  const planktonGeom = new BufferGeometry();
  const planktonPos = new Float32Array(PLANKTON_COUNT * 3);
  for (let i = 0; i < PLANKTON_COUNT; i++) {
    planktonPos[i * 3 + 0] = (Math.random() - 0.5) * 80;
    planktonPos[i * 3 + 1] = (Math.random() - 0.5) * 60 + 20;
    planktonPos[i * 3 + 2] = -Math.random() * 600;
  }
  planktonGeom.setAttribute('position', new BufferAttribute(planktonPos, 3));
  const planktonMat = new PointsMaterial(
    additiveMaterialParameters({
      color: hdr(JELLY_MINT, 1.5),
      size: 0.5,
      transparent: true,
      opacity: 0.65,
    }),
  );
  const planktonMesh = new Points(planktonGeom, planktonMat);
  planktonMesh.userData.raildIgnoreOcclusion = true;
  root.add(planktonMesh);

  scene.add(root);

  let bossLatticeLevel = 1.0;
  let isPurified = false;

  return {
    root,
    setBossLatticeLevel(level: number) {
      bossLatticeLevel = Math.max(0, Math.min(1, level));
    },
    setPurified(purified: boolean) {
      isPurified = purified;
    },
    update(dt: number, ctx: EnvironmentUpdateContext) {
      const t = ctx.elapsed;

      // Bell rhythmic breathing contraction
      const breath = 1.0 + Math.sin(t * 2.8) * 0.045 + ctx.beatEnergy * 0.035;
      domeMesh.scale.set(breath, 1.0 + Math.sin(t * 2.8 + 1.2) * 0.03, breath);
      ribMesh.scale.copy(domeMesh.scale);

      // Bell color crossfade when purified
      if (isPurified) {
        domeMat.color.lerp(hdr(JELLY_GOLD, 1.2), dt * 1.5);
        ribMat.color.lerp(hdr(JELLY_MINT, 2.2), dt * 1.5);
        rimMat.color.lerp(hdr(JELLY_GOLD, 2.5), dt * 1.5);
      }

      // Trailing tentacles undulating wave motion
      for (let sIdx = 0; sIdx < strandLines.length; sIdx++) {
        const strand = strandLines[sIdx];
        const pos = strand.positions;
        const phase = strand.wavePhase + t * strand.waveSpeed;

        for (let seg = 0; seg < STRAND_SEGMENTS; seg++) {
          const u = seg / (STRAND_SEGMENTS - 1);
          const z = -530 + u * 570; // from crown z=-530 out to z=+40

          // Sine undulating waves
          const waveX = Math.sin(phase + z * 0.02) * (2.5 + u * 4.0);
          const waveY = Math.cos(phase * 0.8 + z * 0.025) * (2.0 + u * 3.5);

          const x = strand.baseX + waveX;
          const y = strand.baseY + waveY;

          const idx0 = seg * 6;
          pos[idx0 + 0] = x;
          pos[idx0 + 1] = y;
          pos[idx0 + 2] = z;

          // Connect segment to next
          if (seg < STRAND_SEGMENTS - 1) {
            const nextU = (seg + 1) / (STRAND_SEGMENTS - 1);
            const nextZ = -530 + nextU * 570;
            const nextWaveX = Math.sin(phase + nextZ * 0.02) * (2.5 + nextU * 4.0);
            const nextWaveY = Math.cos(phase * 0.8 + nextZ * 0.025) * (2.0 + nextU * 3.5);
            pos[idx0 + 3] = strand.baseX + nextWaveX;
            pos[idx0 + 4] = strand.baseY + nextWaveY;
            pos[idx0 + 5] = nextZ;
          } else {
            pos[idx0 + 3] = x;
            pos[idx0 + 4] = y;
            pos[idx0 + 5] = z;
          }
        }
        strand.geom.attributes.position.needsUpdate = true;

        // Color update: infested strands transition to radiant green/gold on purification
        if (isPurified) {
          strand.material.color.lerp(hdr(JELLY_MINT, 1.8), dt * 2.0);
        }
      }

      // Plankton motes drifting slowly
      const pAttr = planktonGeom.attributes.position as BufferAttribute;
      const pArray = pAttr.array as Float32Array;
      const camZ = ctx.camera.position.z;
      for (let i = 0; i < PLANKTON_COUNT; i++) {
        pArray[i * 3 + 1] += Math.sin(t + i) * dt * 0.4;
        // Keep particles wrapping relative to camera
        if (pArray[i * 3 + 2] > camZ + 10) {
          pArray[i * 3 + 2] -= 400;
        } else if (pArray[i * 3 + 2] < camZ - 390) {
          pArray[i * 3 + 2] += 400;
        }
      }
      pAttr.needsUpdate = true;
    },
    dispose() {
      root.removeFromParent();
      domeGeom.dispose();
      domeMat.dispose();
      ribGeom.dispose();
      ribMat.dispose();
      rimGeom.dispose();
      rimMat.dispose();
      rayGeom.dispose();
      rayMat.dispose();
      planktonGeom.dispose();
      planktonMat.dispose();
      for (const s of strandLines) {
        s.geom.dispose();
        s.material.dispose();
      }
    },
  };
}
