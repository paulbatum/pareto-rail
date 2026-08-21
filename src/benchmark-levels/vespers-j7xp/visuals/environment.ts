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
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { attribute, float, positionView, positionWorld, smoothstep, time, uniform, vec3 } from 'three/tsl';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  BACKGROUND,
  CANDLE_WARMTH,
  COBALT,
  CRIMSON,
  EMERALD,
  GLASS_COLOR_LIST,
  GOLD,
  hdr,
  LEAD_CAME,
  PURE_LIGHT,
  STONE_BLACK,
  STONE_DARK,
  STONE_HIGHLIGHT,
  STONE_RIB,
  type GlassColorName,
} from './palette';

export const beatUniform = uniform(0);
export const roseIgniteUniform = uniform(0);

const BAY_COUNT = 32;
const BAY_SPACING = 14;
const NAVE_HALF_WIDTH = 13;
const FLOOR_Y = -12;
const VAULT_APEX_Y = 32;
const WEST_END_Z = -430;

export type StainedWindowBay = {
  mesh: Mesh;
  glowMesh: Mesh;
  color: Color;
  colorName: GlassColorName;
  position: Vector3;
  lit: boolean;
  intensity: number;
};

export type CathedralEnvironment = {
  root: Group;
  windows: StainedWindowBay[];
  roseWindow: Group;
  roseGlassPanels: Mesh[];
  roseLightBeams: Group;
  candles: Points;
  restoreWindow(colorName: GlassColorName, position?: Vector3): void;
  igniteRoseWindow(): void;
  update(dt: number, elapsed: number): void;
};

let envInstance: CathedralEnvironment | null = null;

export function getCathedralEnvironment(): CathedralEnvironment | null {
  return envInstance;
}

export function createCathedralEnvironment(scene: Scene): CathedralEnvironment {
  scene.background = BACKGROUND;
  const root = new Group();
  const windows: StainedWindowBay[] = [];

  // 1. Massive Gothic Compound Piers (Stone Columns) - ALL MERGED INTO 1 MESH
  const pierGeometries: BufferGeometry[] = [];
  const basePlinthGeom = new BoxGeometry(2.6, 2.0, 2.6);
  const mainShaftGeom = new CylinderGeometry(0.9, 0.95, 44, 8);
  const clusterShaftGeom = new CylinderGeometry(0.32, 0.32, 44, 6);
  const capitalGeom = new BoxGeometry(2.4, 1.2, 2.4);

  for (let side = -1; side <= 1; side += 2) {
    const x = side * NAVE_HALF_WIDTH;
    for (let b = 0; b < BAY_COUNT; b += 1) {
      const z = -b * BAY_SPACING;
      pierGeometries.push(basePlinthGeom.clone().translate(x, FLOOR_Y + 1.0, z));
      pierGeometries.push(mainShaftGeom.clone().translate(x, FLOOR_Y + 22, z));
      for (const [ox, oz] of [[0.75, 0.75], [-0.75, 0.75], [0.75, -0.75], [-0.75, -0.75]]) {
        pierGeometries.push(clusterShaftGeom.clone().translate(x + ox, FLOOR_Y + 22, z + oz));
      }
      pierGeometries.push(capitalGeom.clone().translate(x, 14, z));
    }
  }

  const mergedPiers = mergeGeometries(pierGeometries);
  const pierMaterial = new MeshBasicMaterial({ color: STONE_DARK });
  const pierMesh = new Mesh(mergedPiers, pierMaterial);
  pierMesh.userData.raildIgnoreOcclusion = true;
  root.add(pierMesh);

  const pierEdges = new LineSegments(
    new EdgesGeometry(mergedPiers, 28),
    new LineBasicMaterial({ color: STONE_RIB }),
  );
  pierEdges.userData.raildIgnoreOcclusion = true;
  root.add(pierEdges);

  for (const g of pierGeometries) g.dispose();

  // 2. Ribbed Vaulting Overhead, Transverse & Longitudinal Pointed Arches - MERGED INTO 1 LINE SEGMENTS
  const ribPositions: number[] = [];
  const ribColors: number[] = [];

  const pushRibSegment = (a: Vector3, b: Vector3, col: Color, intensity = 1.0) => {
    ribPositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    for (let k = 0; k < 2; k += 1) {
      ribColors.push(col.r * intensity, col.g * intensity, col.b * intensity);
    }
  };

  for (let b = 0; b < BAY_COUNT; b += 1) {
    const z0 = -b * BAY_SPACING;
    const z1 = -(b + 1) * BAY_SPACING;
    const zMid = (z0 + z1) / 2;

    const pL0 = new Vector3(-NAVE_HALF_WIDTH, 14, z0);
    const pR0 = new Vector3(NAVE_HALF_WIDTH, 14, z0);
    const pL1 = new Vector3(-NAVE_HALF_WIDTH, 14, z1);
    const pR1 = new Vector3(NAVE_HALF_WIDTH, 14, z1);

    const vApex0 = new Vector3(0, VAULT_APEX_Y, z0);
    const vApexMid = new Vector3(0, VAULT_APEX_Y, zMid);
    const vApex1 = new Vector3(0, VAULT_APEX_Y, z1);

    // Longitudinal ridge rib
    pushRibSegment(vApex0, vApex1, STONE_HIGHLIGHT, 0.9);

    // Transverse pointed arch (pL0 -> vApex0 -> pR0)
    for (let s = 0; s < 8; s += 1) {
      const tA = s / 8;
      const tB = (s + 1) / 8;
      const yA_L = 14 + (VAULT_APEX_Y - 14) * Math.sin(tA * Math.PI * 0.5);
      const xA_L = -NAVE_HALF_WIDTH + NAVE_HALF_WIDTH * tA;
      const yB_L = 14 + (VAULT_APEX_Y - 14) * Math.sin(tB * Math.PI * 0.5);
      const xB_L = -NAVE_HALF_WIDTH + NAVE_HALF_WIDTH * tB;
      pushRibSegment(new Vector3(xA_L, yA_L, z0), new Vector3(xB_L, yB_L, z0), STONE_RIB, 0.85);

      const yA_R = 14 + (VAULT_APEX_Y - 14) * Math.sin((1 - tA) * Math.PI * 0.5);
      const xA_R = NAVE_HALF_WIDTH * tA;
      const yB_R = 14 + (VAULT_APEX_Y - 14) * Math.sin((1 - tB) * Math.PI * 0.5);
      const xB_R = NAVE_HALF_WIDTH * tB;
      pushRibSegment(new Vector3(xA_R, yA_R, z0), new Vector3(xB_R, yB_R, z0), STONE_RIB, 0.85);
    }

    // Longitudinal Arcade Arches along the left and right walls (between piers)
    for (let s = 0; s < 6; s += 1) {
      const tA = s / 6;
      const tB = (s + 1) / 6;
      const arcYA = 14 + 5.0 * Math.sin(tA * Math.PI);
      const arcYB = 14 + 5.0 * Math.sin(tB * Math.PI);
      const zA = z0 + (z1 - z0) * tA;
      const zB = z0 + (z1 - z0) * tB;

      pushRibSegment(new Vector3(-NAVE_HALF_WIDTH, arcYA, zA), new Vector3(-NAVE_HALF_WIDTH, arcYB, zB), STONE_RIB, 0.7);
      pushRibSegment(new Vector3(NAVE_HALF_WIDTH, arcYA, zA), new Vector3(NAVE_HALF_WIDTH, arcYB, zB), STONE_RIB, 0.7);
    }

    // Diagonal quadripartite ribs
    for (let s = 0; s < 6; s += 1) {
      const tA = s / 6;
      const tB = (s + 1) / 6;

      const pA1 = new Vector3().lerpVectors(pL0, vApexMid, tA);
      pA1.y = 14 + (VAULT_APEX_Y - 14) * Math.sin(tA * Math.PI * 0.5);
      const pB1 = new Vector3().lerpVectors(pL0, vApexMid, tB);
      pB1.y = 14 + (VAULT_APEX_Y - 14) * Math.sin(tB * Math.PI * 0.5);
      pushRibSegment(pA1, pB1, STONE_RIB, 0.75);

      const pA2 = new Vector3().lerpVectors(pR0, vApexMid, tA);
      pA2.y = 14 + (VAULT_APEX_Y - 14) * Math.sin(tA * Math.PI * 0.5);
      const pB2 = new Vector3().lerpVectors(pR0, vApexMid, tB);
      pB2.y = 14 + (VAULT_APEX_Y - 14) * Math.sin(tB * Math.PI * 0.5);
      pushRibSegment(pA2, pB2, STONE_RIB, 0.75);

      const pA3 = new Vector3().lerpVectors(vApexMid, pR1, tA);
      pA3.y = VAULT_APEX_Y - (VAULT_APEX_Y - 14) * (1 - Math.cos(tA * Math.PI * 0.5));
      const pB3 = new Vector3().lerpVectors(vApexMid, pR1, tB);
      pB3.y = VAULT_APEX_Y - (VAULT_APEX_Y - 14) * (1 - Math.cos(tB * Math.PI * 0.5));
      pushRibSegment(pA3, pB3, STONE_RIB, 0.75);

      const pA4 = new Vector3().lerpVectors(vApexMid, pL1, tA);
      pA4.y = VAULT_APEX_Y - (VAULT_APEX_Y - 14) * (1 - Math.cos(tA * Math.PI * 0.5));
      const pB4 = new Vector3().lerpVectors(vApexMid, pL1, tB);
      pB4.y = VAULT_APEX_Y - (VAULT_APEX_Y - 14) * (1 - Math.cos(tB * Math.PI * 0.5));
      pushRibSegment(pA4, pB4, STONE_RIB, 0.75);
    }
  }

  const ribGeometry = new BufferGeometry();
  ribGeometry.setAttribute('position', new Float32BufferAttribute(ribPositions, 3));
  ribGeometry.setAttribute('color', new Float32BufferAttribute(ribColors, 3));
  const ribMaterial = new LineBasicMaterial({ vertexColors: true });
  const ribLines = new LineSegments(ribGeometry, ribMaterial);
  ribLines.userData.raildIgnoreOcclusion = true;
  root.add(ribLines);

  // 3. Stained Glass Windows: 1 Merged Mesh per Window Bay (Left Lancet + Right Lancet + Rose Oculus)
  // All window leaded tracery merged into ONE single LineSegments
  const allWindowTraceryLines: BufferGeometry[] = [];
  const glowGeom = new PlaneGeometry(12.0, 16.0);

  // Single unit bay window geometry (merged 2 lancets + 1 oculus)
  const unitBayPanels: BufferGeometry[] = [];
  const lancetL = new PlaneGeometry(2.4, 7.5).translate(-1.4, -0.8, 0);
  const lancetR = new PlaneGeometry(2.4, 7.5).translate(1.4, -0.8, 0);
  const oculus = new CircleGeometry(1.5, 16).translate(0, 4.0, 0);
  unitBayPanels.push(lancetL, lancetR, oculus);
  const unitBayGeometry = mergeGeometries(unitBayPanels);
  for (const g of unitBayPanels) g.dispose();

  // Unit bay tracery edges
  const unitTraceryPieces: BufferGeometry[] = [];
  unitTraceryPieces.push(new EdgesGeometry(new PlaneGeometry(2.4, 7.5)).translate(-1.4, -0.8, 0.05));
  unitTraceryPieces.push(new EdgesGeometry(new PlaneGeometry(2.4, 7.5)).translate(1.4, -0.8, 0.05));
  unitTraceryPieces.push(new EdgesGeometry(new RingGeometry(1.4, 1.5, 16)).translate(0, 4.0, 0.05));
  unitTraceryPieces.push(new EdgesGeometry(new PlaneGeometry(6.2, 11.5)).translate(0, 1.0, 0.02));
  const unitBayTracery = mergeGeometries(unitTraceryPieces);
  for (const g of unitTraceryPieces) g.dispose();

  for (let b = 0; b < BAY_COUNT; b += 1) {
    const z = -(b + 0.5) * BAY_SPACING;
    const colorName = GLASS_COLOR_LIST[b % GLASS_COLOR_LIST.length];
    const baseColor = colorName === 'cobalt' ? COBALT
      : colorName === 'crimson' ? CRIMSON
      : colorName === 'emerald' ? EMERALD
      : GOLD;

    for (const side of [-1, 1]) {
      const x = side * (NAVE_HALF_WIDTH + 1.2);
      const pos = new Vector3(x, 16.0, z);
      const rotY = side > 0 ? -Math.PI / 2 : Math.PI / 2;

      // Window Glass Mesh (1 per bay)
      const winMat = createAdditiveBasicMaterial({
        color: baseColor.clone().multiplyScalar(0.04),
        side: DoubleSide,
      });
      const winMesh = new Mesh(unitBayGeometry, winMat);
      winMesh.position.copy(pos);
      winMesh.rotation.y = rotY;
      winMesh.userData.raildIgnoreOcclusion = true;
      root.add(winMesh);

      // Add to merged tracery lines
      const matrix = new Matrix4()
        .makeRotationY(rotY)
        .setPosition(pos);
      allWindowTraceryLines.push(unitBayTracery.clone().applyMatrix4(matrix));

      // Glow Mesh
      const glowMat = createAdditiveBasicMaterial({
        color: baseColor.clone().multiplyScalar(0.0),
        side: DoubleSide,
      });
      const glowMesh = new Mesh(glowGeom, glowMat);
      glowMesh.position.set(x - side * 0.8, 16.0, z);
      glowMesh.rotation.y = rotY;
      glowMesh.userData.raildIgnoreOcclusion = true;
      root.add(glowMesh);

      windows.push({
        mesh: winMesh,
        glowMesh,
        color: baseColor.clone(),
        colorName,
        position: pos,
        lit: false,
        intensity: 0.04,
      });
    }
  }

  // Add all merged window traceries in ONE draw call
  const mergedWindowTracery = mergeGeometries(allWindowTraceryLines);
  const traceryMesh = new LineSegments(mergedWindowTracery, new LineBasicMaterial({ color: LEAD_CAME }));
  traceryMesh.userData.raildIgnoreOcclusion = true;
  root.add(traceryMesh);
  for (const g of allWindowTraceryLines) g.dispose();

  // 4. Monumental West-End Rose Window
  const roseWindow = new Group();
  roseWindow.position.set(0, 16.0, WEST_END_Z);
  root.add(roseWindow);

  const westWallGeom = new PlaneGeometry(46, 56);
  const westWallMesh = new Mesh(westWallGeom, new MeshBasicMaterial({ color: STONE_BLACK }));
  westWallMesh.position.set(0, 15, WEST_END_Z - 1.0);
  westWallMesh.userData.raildIgnoreOcclusion = true;
  root.add(westWallMesh);

  // Circular stone frame
  const roseFrameGeom = new TorusGeometry(13.0, 1.2, 12, 48);
  const roseFrameMesh = new Mesh(roseFrameGeom, new MeshBasicMaterial({ color: STONE_DARK }));
  roseWindow.add(roseFrameMesh);

  // Concentric lead tracery rings
  const roseTraceryPieces: BufferGeometry[] = [];
  for (const radius of [3.5, 7.5, 11.5]) {
    roseTraceryPieces.push(new TorusGeometry(radius, 0.15, 6, 48));
  }

  // 12 Petal Segments with multi-colored stained glass panels
  const roseGlassPanels: Mesh[] = [];
  const PETAL_COUNT = 12;
  for (let i = 0; i < PETAL_COUNT; i += 1) {
    const angle = (i / PETAL_COUNT) * Math.PI * 2;
    const colorName = GLASS_COLOR_LIST[i % GLASS_COLOR_LIST.length];
    const col = colorName === 'cobalt' ? COBALT
      : colorName === 'crimson' ? CRIMSON
      : colorName === 'emerald' ? EMERALD
      : GOLD;

    // Outer petal glass plane
    const petalGeom = new CylinderGeometry(1.6, 0.4, 4.0, 3, 1);
    petalGeom.rotateZ(angle + Math.PI / 2);
    petalGeom.translate(Math.cos(angle) * 8.5, Math.sin(angle) * 8.5, 0);

    const petalMat = createAdditiveBasicMaterial({
      color: col.clone().multiplyScalar(0.05),
      side: DoubleSide,
    });
    const petalMesh = new Mesh(petalGeom, petalMat);
    roseGlassPanels.push(petalMesh);
    roseWindow.add(petalMesh);

    // Inner petal glass plane
    const innerPetalGeom = new OctahedronGeometry(1.2, 0);
    innerPetalGeom.rotateZ(angle);
    innerPetalGeom.translate(Math.cos(angle) * 4.8, Math.sin(angle) * 4.8, 0);
    const innerPetalMat = createAdditiveBasicMaterial({
      color: col.clone().multiplyScalar(0.05),
      side: DoubleSide,
    });
    const innerMesh = new Mesh(innerPetalGeom, innerPetalMat);
    roseGlassPanels.push(innerMesh);
    roseWindow.add(innerMesh);

    // Radial tracery spokes
    const spokeGeom = new BoxGeometry(0.18, 12.5, 0.2);
    spokeGeom.rotateZ(angle);
    spokeGeom.translate(Math.cos(angle) * 6.25, Math.sin(angle) * 6.25, 0.1);
    roseTraceryPieces.push(spokeGeom);
  }

  // Merge all rose tracery pieces into 1 mesh
  const mergedRoseTracery = mergeGeometries(roseTraceryPieces);
  roseWindow.add(new Mesh(mergedRoseTracery, new MeshBasicMaterial({ color: LEAD_CAME })));
  for (const g of roseTraceryPieces) g.dispose();

  // Central Grand Rose Oculus
  const centerOculusGeom = new CircleGeometry(2.8, 32);
  const centerOculusMat = createAdditiveBasicMaterial({
    color: GOLD.clone().multiplyScalar(0.05),
    side: DoubleSide,
  });
  const centerOculusMesh = new Mesh(centerOculusGeom, centerOculusMat);
  roseGlassPanels.push(centerOculusMesh);
  roseWindow.add(centerOculusMesh);

  // Volumetric Finale Light Beams shooting out of the Rose Window
  const roseLightBeams = new Group();
  roseLightBeams.position.set(0, 16.0, WEST_END_Z + 1.0);
  roseLightBeams.visible = false;
  root.add(roseLightBeams);

  const beamConeGeom = new CylinderGeometry(0.2, 12.0, 60.0, 12, 1, true);
  beamConeGeom.rotateX(Math.PI / 2);
  for (let i = 0; i < 8; i += 1) {
    const bAngle = (i / 8) * Math.PI * 2;
    const bColor = colorForGlass(GLASS_COLOR_LIST[i % GLASS_COLOR_LIST.length]);
    const bMat = createAdditiveBasicMaterial({
      color: bColor.clone().multiplyScalar(0.15),
      side: DoubleSide,
    });
    const bMesh = new Mesh(beamConeGeom, bMat);
    bMesh.rotation.z = bAngle;
    bMesh.position.set(Math.cos(bAngle) * 3, Math.sin(bAngle) * 3, 30);
    roseLightBeams.add(bMesh);
  }

  // 5. Sea of Flickering Candles across the floor (Far below) - MERGED POINTS (1 draw call)
  const CANDLE_COUNT = 1500;
  const candlePositions = new Float32Array(CANDLE_COUNT * 3);
  const candleColors = new Float32Array(CANDLE_COUNT * 3);

  let cIdx = 0;
  for (let i = 0; i < CANDLE_COUNT; i += 1) {
    const z = -Math.random() * (BAY_COUNT * BAY_SPACING);
    const x = (Math.random() - 0.5) * (NAVE_HALF_WIDTH * 2 - 2);
    const y = FLOOR_Y + 0.1 + Math.random() * 0.4;

    candlePositions[cIdx * 3] = x;
    candlePositions[cIdx * 3 + 1] = y;
    candlePositions[cIdx * 3 + 2] = z;

    const flicker = 0.6 + Math.random() * 0.8;
    candleColors[cIdx * 3] = CANDLE_WARMTH.r * flicker;
    candleColors[cIdx * 3 + 1] = CANDLE_WARMTH.g * flicker;
    candleColors[cIdx * 3 + 2] = CANDLE_WARMTH.b * flicker;
    cIdx += 1;
  }

  const candleGeometry = new BufferGeometry();
  candleGeometry.setAttribute('position', new Float32BufferAttribute(candlePositions, 3));
  candleGeometry.setAttribute('color', new Float32BufferAttribute(candleColors, 3));

  const candleMaterial = new PointsMaterial(additiveMaterialParameters({
    size: 0.9,
    vertexColors: true,
    sizeAttenuation: true,
  }));
  const candles = new Points(candleGeometry, candleMaterial);
  candles.userData.raildIgnoreOcclusion = true;
  root.add(candles);

  scene.add(root);

  let roseIgnited = false;
  let roseIgniteProgress = 0;

  function colorForGlass(name: GlassColorName): Color {
    return name === 'cobalt' ? COBALT
      : name === 'crimson' ? CRIMSON
      : name === 'emerald' ? EMERALD
      : GOLD;
  }

  const environment: CathedralEnvironment = {
    root,
    windows,
    roseWindow,
    roseGlassPanels,
    roseLightBeams,
    candles,
    restoreWindow(colorName: GlassColorName, pos?: Vector3) {
      let bestBay: StainedWindowBay | null = null;
      let minDistance = Infinity;

      for (const w of windows) {
        if (!w.lit && w.colorName === colorName) {
          const dist = pos ? w.position.distanceTo(pos) : Math.abs(w.position.z);
          if (dist < minDistance) {
            minDistance = dist;
            bestBay = w;
          }
        }
      }

      if (!bestBay) {
        for (const w of windows) {
          if (!w.lit) {
            bestBay = w;
            break;
          }
        }
      }

      if (bestBay) {
        bestBay.lit = true;
      }
    },
    igniteRoseWindow() {
      roseIgnited = true;
      roseLightBeams.visible = true;
      for (const w of windows) {
        w.lit = true;
      }
    },
    update(dt: number, elapsed: number) {
      // Update individual window lighting transitions
      for (const w of windows) {
        const targetIntensity = w.lit ? 1.6 : 0.04;
        w.intensity += (targetIntensity - w.intensity) * Math.min(1, dt * 4.0);

        const winMat = w.mesh.material as MeshBasicMaterial;
        winMat.color.copy(w.color).multiplyScalar(w.intensity);

        const glowMat = w.glowMesh.material as MeshBasicMaterial;
        glowMat.color.copy(w.color).multiplyScalar(w.lit ? w.intensity * 0.45 : 0.0);
      }

      // Update Rose Window Climax Ignition
      if (roseIgnited) {
        roseIgniteProgress = Math.min(1.0, roseIgniteProgress + dt * 1.5);
        roseIgniteUniform.value = roseIgniteProgress;

        const pulse = 1.0 + 0.15 * Math.sin(elapsed * 8.0);
        const intensity = (0.05 + roseIgniteProgress * 3.4) * pulse;

        for (let i = 0; i < roseGlassPanels.length; i += 1) {
          const p = roseGlassPanels[i];
          const mat = p.material as MeshBasicMaterial;
          const colorName = GLASS_COLOR_LIST[i % GLASS_COLOR_LIST.length];
          const baseCol = colorForGlass(colorName);
          mat.color.copy(baseCol).multiplyScalar(intensity);
        }

        // Slowly rotate volumetric light beams
        roseLightBeams.rotation.z += dt * 0.2;
      }

      // Candle shimmer
      const candleColorsAttr = candleGeometry.getAttribute('color') as Float32BufferAttribute;
      const array = candleColorsAttr.array as Float32Array;
      const shimmer = Math.sin(elapsed * 6.0) * 0.08;
      for (let i = 0; i < CANDLE_COUNT; i += 1) {
        const baseFlicker = 0.8 + Math.sin(elapsed * 3.5 + i) * 0.25 + shimmer;
        array[i * 3] = CANDLE_WARMTH.r * baseFlicker;
        array[i * 3 + 1] = CANDLE_WARMTH.g * baseFlicker;
        array[i * 3 + 2] = CANDLE_WARMTH.b * baseFlicker;
      }
      candleColorsAttr.needsUpdate = true;
    },
  };

  envInstance = environment;
  return environment;
}
