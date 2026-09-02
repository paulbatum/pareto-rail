import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial, disposeObject3D } from '../../../engine/visual-kit';
import {
  hdr,
  JELLY_AMBER,
  JELLY_BELL_DEEP,
  JELLY_BELL_LIGHT,
  JELLY_EMERALD,
  JELLY_GOLD,
  JELLY_MINT,
  PARASITE_WEB,
} from './palette';

export type JellyfishRig = {
  group: Group;
  crownPosition: Vector3;
  setBossInfested(infested: boolean): void;
  setFreed(freed: boolean): void;
  update(elapsed: number, dt: number, beatPulse: number): void;
  dispose(): void;
};

// Procedural Giant Jellyfish:
// A colossal organism spanning hundreds of units.
// - Bell: Translucent umbrella dome with glowing radial canals, sensory rhopalia, and golden gonads.
// - Crown: Central muscular root where tentacles anchor (the boss's nest).
// - Strands: Trailing bioluminescent forest weaving alongside the player's rail.
export function createJellyfish(scene: Scene): JellyfishRig {
  const group = new Group();

  // Anchor the jellyfish bell at the culmination of the rail
  const crownPosition = new Vector3(0, 115, -740);
  const bellCenter = new Vector3(0, 150, -780);

  // 1. Bell Dome (Translucent umbrella)
  const bellRadius = 68;
  const bellGeo = new SphereGeometry(bellRadius, 36, 18, 0, Math.PI * 2, 0, Math.PI * 0.52);
  const bellMat = createAdditiveBasicMaterial({
    color: JELLY_BELL_LIGHT.clone().multiplyScalar(0.55),
    side: DoubleSide,
    opacity: 0.65,
  });
  const bellMesh = new Mesh(bellGeo, bellMat);
  bellMesh.position.copy(bellCenter);
  bellMesh.rotation.x = Math.PI * 0.16; // tilted gracefully toward the player's approach
  group.add(bellMesh);

  // Inner subumbrella dome for deep internal glow
  const innerBellGeo = new SphereGeometry(bellRadius * 0.88, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.48);
  const innerBellMat = createAdditiveBasicMaterial({
    color: hdr(JELLY_BELL_DEEP, 1.1),
    side: DoubleSide,
    opacity: 0.55,
  });
  const innerBellMesh = new Mesh(innerBellGeo, innerBellMat);
  bellMesh.add(innerBellMesh);

  // 2. Bell Rim Lappets & Glowing Margin
  const rimGeo = new TorusGeometry(bellRadius * 0.98, 1.2, 12, 48);
  const rimMat = createAdditiveBasicMaterial({
    color: hdr(JELLY_MINT, 1.4),
    opacity: 0.9,
  });
  const rimMesh = new Mesh(rimGeo, rimMat);
  rimMesh.rotation.x = Math.PI / 2;
  rimMesh.position.y = -bellRadius * 0.48;
  bellMesh.add(rimMesh);

  // 3. Radial Canals (24 glowing lines radiating from the apex down to the rim)
  const canalPositions: number[] = [];
  for (let i = 0; i < 24; i += 1) {
    const angle = (i / 24) * Math.PI * 2;
    for (let seg = 0; seg < 12; seg += 1) {
      const phi1 = (seg / 12) * Math.PI * 0.5;
      const phi2 = ((seg + 1) / 12) * Math.PI * 0.5;
      const r1 = bellRadius * Math.sin(phi1);
      const y1 = bellRadius * Math.cos(phi1);
      const r2 = bellRadius * Math.sin(phi2);
      const y2 = bellRadius * Math.cos(phi2);

      canalPositions.push(
        Math.cos(angle) * r1, y1 - bellRadius * 0.5, Math.sin(angle) * r1,
        Math.cos(angle) * r2, y2 - bellRadius * 0.5, Math.sin(angle) * r2,
      );
    }
  }
  const canalGeo = new BufferGeometry();
  canalGeo.setAttribute('position', new BufferAttribute(new Float32Array(canalPositions), 3));
  const canalMat = new LineBasicMaterial({
    color: hdr(JELLY_EMERALD, 1.5),
    transparent: true,
    opacity: 0.85,
    blending: AdditiveBlending,
  });
  const canalLines = new LineSegments(canalGeo, canalMat);
  bellMesh.add(canalLines);

  // 4. Internal Gonads (4 glowing golden horseshoe organs inside the bell)
  const gonadGroup = new Group();
  const gonadGeo = new TorusGeometry(11, 2.2, 10, 24, Math.PI * 1.5);
  const gonadMat = createAdditiveBasicMaterial({
    color: hdr(JELLY_GOLD, 1.5),
    opacity: 0.8,
  });
  for (let i = 0; i < 4; i += 1) {
    const gMesh = new Mesh(gonadGeo, gonadMat);
    const ang = (i / 4) * Math.PI * 2;
    gMesh.position.set(Math.cos(ang) * 16, 4, Math.sin(ang) * 16);
    gMesh.rotation.x = Math.PI / 2;
    gMesh.rotation.z = ang + Math.PI / 4;
    gonadGroup.add(gMesh);
  }
  bellMesh.add(gonadGroup);

  // 5. Crown (Root of the strands and manubrium)
  const crownGroup = new Group();
  crownGroup.position.copy(crownPosition);
  group.add(crownGroup);

  const crownCoreGeo = new TorusGeometry(9, 2.4, 12, 32);
  const crownCoreMat = createAdditiveBasicMaterial({
    color: hdr(JELLY_EMERALD, 1.2),
    opacity: 0.8,
  });
  const crownRing = new Mesh(crownCoreGeo, crownCoreMat);
  crownRing.rotation.x = Math.PI / 2;
  crownGroup.add(crownRing);

  // 6. Parasitic Webbing on Crown (visible while infested, dissolves on boss kill)
  const webGeo = new TorusGeometry(12, 0.4, 8, 24);
  const webMat = createAdditiveBasicMaterial({
    color: hdr(PARASITE_WEB, 1.4),
    opacity: 0.85,
  });
  const webRing1 = new Mesh(webGeo, webMat);
  webRing1.rotation.x = Math.PI / 2;
  const webRing2 = new Mesh(webGeo, webMat);
  webRing2.rotation.y = Math.PI / 4;
  webRing2.rotation.x = Math.PI / 3;
  crownGroup.add(webRing1, webRing2);

  // 7. Oral Arms (4 twisting luminous ribbons descending from the crown)
  const oralArmCount = 4;
  const oralArmLength = 120;
  const oralArmSegments = 24;
  const oralArmPositions: number[] = [];
  for (let a = 0; a < oralArmCount; a += 1) {
    const armAngle = (a / oralArmCount) * Math.PI * 2;
    for (let s = 0; s < oralArmSegments; s += 1) {
      const t1 = s / oralArmSegments;
      const t2 = (s + 1) / oralArmSegments;
      const z1 = t1 * oralArmLength;
      const z2 = t2 * oralArmLength;
      const r1 = 8 * (1 - t1 * 0.5);
      const r2 = 8 * (1 - t2 * 0.5);
      const curl1 = armAngle + t1 * 2.5;
      const curl2 = armAngle + t2 * 2.5;

      oralArmPositions.push(
        crownPosition.x + Math.cos(curl1) * r1, crownPosition.y - t1 * 30, crownPosition.z + z1,
        crownPosition.x + Math.cos(curl2) * r2, crownPosition.y - t2 * 30, crownPosition.z + z2,
      );
    }
  }
  const oralArmGeo = new BufferGeometry();
  oralArmGeo.setAttribute('position', new BufferAttribute(new Float32Array(oralArmPositions), 3));
  const oralArmMat = new LineBasicMaterial({
    color: hdr(JELLY_MINT, 1.1),
    transparent: true,
    opacity: 0.7,
    blending: AdditiveBlending,
  });
  const oralArmsLines = new LineSegments(oralArmGeo, oralArmMat);
  group.add(oralArmsLines);

  // 8. Trailing Tentacle Strands (Forest of luminous strands extending along the entire rail)
  // We generate 52 flowing strands spanning along Z from -740 to +20, clustered around the rail corridor.
  const strandCount = 52;
  const strandSegs = 20;
  const strandPositions: number[] = [];
  const strandRoots: Array<{ x: number; y: number; z: number; waveOffset: number; freq: number }> = [];

  for (let i = 0; i < strandCount; i += 1) {
    // Distribute strands around the crown and outward along the rail corridor
    const radialDist = 6 + Math.pow(Math.random(), 0.7) * 55;
    const angle = (i / strandCount) * Math.PI * 2 + Math.random() * 0.3;
    const rootX = crownPosition.x + Math.cos(angle) * radialDist;
    const rootY = crownPosition.y + Math.sin(angle) * (radialDist * 0.6) - 10;
    const rootZ = crownPosition.z;

    strandRoots.push({
      x: rootX,
      y: rootY,
      z: rootZ,
      waveOffset: Math.random() * Math.PI * 2,
      freq: 0.8 + Math.random() * 0.6,
    });

    const strandLength = 760 + Math.random() * 80;
    for (let s = 0; s < strandSegs; s += 1) {
      const t1 = s / strandSegs;
      const t2 = (s + 1) / strandSegs;

      const z1 = rootZ + t1 * strandLength;
      const z2 = rootZ + t2 * strandLength;

      // Slight curve toward center at the start, spreading out
      const spread1 = 1 + t1 * 0.6;
      const spread2 = 1 + t2 * 0.6;

      strandPositions.push(
        rootX * spread1, rootY - t1 * 40, z1,
        rootX * spread2, rootY - t2 * 40, z2,
      );
    }
  }

  const strandGeo = new BufferGeometry();
  const strandPosAttr = new BufferAttribute(new Float32Array(strandPositions), 3);
  strandGeo.setAttribute('position', strandPosAttr);
  const strandMat = new LineBasicMaterial({
    color: hdr(JELLY_EMERALD, 1.2),
    transparent: true,
    opacity: 0.75,
    blending: AdditiveBlending,
  });
  const strandLines = new LineSegments(strandGeo, strandMat);
  group.add(strandLines);

  scene.add(group);

  let isInfested = true;
  let isFreed = false;
  let cleanGlow = 0;

  return {
    group,
    crownPosition,
    setBossInfested(infested: boolean) {
      isInfested = infested;
      webRing1.visible = infested;
      webRing2.visible = infested;
    },
    setFreed(freed: boolean) {
      isFreed = freed;
      if (freed) {
        webRing1.visible = false;
        webRing2.visible = false;
      }
    },
    update(elapsed: number, dt: number, beatPulse: number) {
      if (isFreed) {
        cleanGlow = Math.min(2.2, cleanGlow + dt * 0.8);
      }

      // Jellyfish rhythmic pulsation (period = 2.5s = 1 bar at 96 BPM!)
      const pulsePhase = (elapsed / 2.5) * Math.PI * 2;
      const contraction = Math.max(0, Math.sin(pulsePhase));
      const contractedPow = Math.pow(contraction, 3.0); // sharp rhythmic contraction, slow expansion

      // Scale bell: contract radially, stretch vertically
      const radialScale = 1.0 - contractedPow * 0.12;
      const axialScale = 1.0 + contractedPow * 0.15;
      bellMesh.scale.set(radialScale, axialScale, radialScale);

      // Bell glow pulse
      const bellIntensity = 0.4 + contractedPow * 0.35 + beatPulse * 0.2 + cleanGlow * 0.4;
      bellMat.color.copy(JELLY_BELL_LIGHT).multiplyScalar(bellIntensity);
      gonadMat.color.copy(JELLY_GOLD).multiplyScalar(1.0 + contractedPow * 0.6 + cleanGlow * 0.5);

      // Webbing twitching if infested
      if (isInfested && !isFreed) {
        const webPulse = 1.0 + Math.sin(elapsed * 6.0) * 0.2;
        webMat.color.copy(PARASITE_WEB).multiplyScalar(webPulse);
        webRing1.rotation.z += dt * 0.4;
        webRing2.rotation.z -= dt * 0.3;
      }

      // Animate strand wave undulation and traveling light waves
      const posArray = strandPosAttr.array as Float32Array;
      let ptr = 0;
      for (let i = 0; i < strandCount; i += 1) {
        const root = strandRoots[i];
        const strandLength = 760;

        for (let s = 0; s < strandSegs; s += 1) {
          const t1 = s / strandSegs;
          const t2 = (s + 1) / strandSegs;

          const z1 = root.z + t1 * strandLength;
          const z2 = root.z + t2 * strandLength;

          // Gentle aquatic drift undulation
          const wave1 = Math.sin(elapsed * root.freq + t1 * 4 + root.waveOffset) * (3.0 * t1);
          const wave2 = Math.sin(elapsed * root.freq + t2 * 4 + root.waveOffset) * (3.0 * t2);

          const spread1 = 1 + t1 * 0.6;
          const spread2 = 1 + t2 * 0.6;

          posArray[ptr] = root.x * spread1 + wave1;
          posArray[ptr + 1] = root.y - t1 * 40;
          posArray[ptr + 2] = z1;

          posArray[ptr + 3] = root.x * spread2 + wave2;
          posArray[ptr + 4] = root.y - t2 * 40;
          posArray[ptr + 5] = z2;

          ptr += 6;
        }
      }
      strandPosAttr.needsUpdate = true;

      // Color pulse along strands
      const strandGlow = 0.9 + beatPulse * 0.4 + cleanGlow * 0.8;
      strandMat.color.copy(isFreed ? JELLY_GOLD : JELLY_EMERALD).multiplyScalar(strandGlow);
    },
    dispose() {
      group.removeFromParent();
      disposeObject3D(group);
    },
  };
}
