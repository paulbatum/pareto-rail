import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  COBALT,
  CRIMSON,
  EMERALD,
  GOLD,
  hdr,
  LEAD_CAME,
  PURE_LIGHT,
  STONE_BLACK,
  STONE_DARK,
  colorForGlass,
  type GlassColorName,
} from './palette';

// Pitch black matte silhouette material — absorbs all light
const SHADOW_BODY_MATERIAL = new MeshBasicMaterial({ color: STONE_BLACK });
const SHADOW_EDGE_MATERIAL = new LineBasicMaterial({ color: STONE_DARK });

export type VespersEnemyVisualState = {
  kind: string;
  colorName: GlassColorName;
  baseColor: Color;
  coreMesh: Mesh;
  haloMesh?: Mesh;
  edgeLines?: LineSegments;
  rotationSpeed?: number;
};

// 1. Umbral Lancet: sleek pointed blade silhouette with glowing lancet pane in chest
export function createLancetMesh(colorName: GlassColorName = 'cobalt'): Group {
  const group = new Group();
  const baseColor = colorForGlass(colorName);

  // Black silhouette body: pointed central blade and swept angular wings
  const bodyGeometries: BufferGeometry[] = [];
  
  // Central lancet spine
  const spineGeom = new ConeGeometry(0.4, 2.2, 4);
  spineGeom.rotateY(Math.PI / 4);
  bodyGeometries.push(spineGeom);

  // Swept side wings
  const wingGeomL = new ConeGeometry(0.25, 1.4, 3);
  wingGeomL.rotateZ(Math.PI * 0.35);
  wingGeomL.translate(-0.8, -0.3, 0);
  bodyGeometries.push(wingGeomL);

  const wingGeomR = new ConeGeometry(0.25, 1.4, 3);
  wingGeomR.rotateZ(-Math.PI * 0.35);
  wingGeomR.translate(0.8, -0.3, 0);
  bodyGeometries.push(wingGeomR);

  const mergedBody = mergeGeometries(bodyGeometries);
  const bodyMesh = new Mesh(mergedBody, SHADOW_BODY_MATERIAL);
  const edges = new LineSegments(new EdgesGeometry(mergedBody), SHADOW_EDGE_MATERIAL);
  group.add(bodyMesh, edges);

  for (const g of bodyGeometries) g.dispose();

  // Stolen stained glass jewel burning in its chest
  const gemGeom = new OctahedronGeometry(0.38, 0);
  gemGeom.scale(0.8, 1.4, 0.4);
  const coreMaterial = createAdditiveBasicMaterial({ color: hdr(baseColor, 1.6) });
  const coreMesh = new Mesh(gemGeom, coreMaterial);
  coreMesh.position.set(0, 0, 0.12);
  group.add(coreMesh);

  // Leaded came frame around the gem
  const gemFrame = new LineSegments(new EdgesGeometry(gemGeom), new LineBasicMaterial({ color: LEAD_CAME }));
  gemFrame.position.set(0, 0, 0.12);
  group.add(gemFrame);

  // Radiant jewel glow halo
  const haloGeom = new RingGeometry(0.42, 0.58, 16);
  const haloMaterial = createAdditiveBasicMaterial({ color: hdr(baseColor, 0.45), side: DoubleSide });
  const haloMesh = new Mesh(haloGeom, haloMaterial);
  haloMesh.position.set(0, 0, 0.05);
  group.add(haloMesh);

  group.userData.visualState = {
    kind: 'lancet',
    colorName,
    baseColor,
    coreMesh,
    haloMesh,
    edgeLines: edges,
  } satisfies VespersEnemyVisualState;
  group.userData.accent = baseColor.clone();
  group.userData.raildIgnoreOcclusion = true;

  return group;
}

// 2. Gargoyle Shade: heavy winged gothic chimera with large shield chest pane
export function createGargoyleMesh(colorName: GlassColorName = 'crimson'): Group {
  const group = new Group();
  const baseColor = colorForGlass(colorName);

  const bodyGeometries: BufferGeometry[] = [];

  // Heavy hunched torso
  const torsoGeom = new BoxGeometry(1.2, 1.4, 0.6);
  torsoGeom.translate(0, 0, 0);
  bodyGeometries.push(torsoGeom);

  // Horned gothic crest
  const hornL = new ConeGeometry(0.2, 0.8, 4);
  hornL.rotateZ(Math.PI * 0.2);
  hornL.translate(-0.5, 0.9, 0);
  bodyGeometries.push(hornL);

  const hornR = new ConeGeometry(0.2, 0.8, 4);
  hornR.rotateZ(-Math.PI * 0.2);
  hornR.translate(0.5, 0.9, 0);
  bodyGeometries.push(hornR);

  // Wide jagged bat-wings
  const wingL = new BoxGeometry(1.6, 0.8, 0.15);
  wingL.rotateZ(Math.PI * 0.15);
  wingL.translate(-1.4, 0.2, -0.2);
  bodyGeometries.push(wingL);

  const wingR = new BoxGeometry(1.6, 0.8, 0.15);
  wingR.rotateZ(-Math.PI * 0.15);
  wingR.translate(1.4, 0.2, -0.2);
  bodyGeometries.push(wingR);

  const mergedBody = mergeGeometries(bodyGeometries);
  const bodyMesh = new Mesh(mergedBody, SHADOW_BODY_MATERIAL);
  const edges = new LineSegments(new EdgesGeometry(mergedBody), SHADOW_EDGE_MATERIAL);
  group.add(bodyMesh, edges);

  for (const g of bodyGeometries) g.dispose();

  // Heraldic stained glass shield burning in the chest
  const shieldGeom = new CylinderGeometry(0.55, 0.1, 0.8, 5);
  shieldGeom.rotateY(Math.PI / 5);
  shieldGeom.scale(1.0, 1.0, 0.3);
  const coreMaterial = createAdditiveBasicMaterial({ color: hdr(baseColor, 1.8) });
  const coreMesh = new Mesh(shieldGeom, coreMaterial);
  coreMesh.position.set(0, -0.1, 0.32);
  group.add(coreMesh);

  // Leaded border
  const shieldEdges = new LineSegments(new EdgesGeometry(shieldGeom), new LineBasicMaterial({ color: LEAD_CAME }));
  shieldEdges.position.set(0, -0.1, 0.32);
  group.add(shieldEdges);

  // Pulsing shield halo
  const haloGeom = new RingGeometry(0.65, 0.85, 24);
  const haloMaterial = createAdditiveBasicMaterial({ color: hdr(baseColor, 0.5), side: DoubleSide });
  const haloMesh = new Mesh(haloGeom, haloMaterial);
  haloMesh.position.set(0, -0.1, 0.2);
  group.add(haloMesh);

  group.userData.visualState = {
    kind: 'gargoyle',
    colorName,
    baseColor,
    coreMesh,
    haloMesh,
    edgeLines: edges,
  } satisfies VespersEnemyVisualState;
  group.userData.accent = baseColor.clone();
  group.userData.raildIgnoreOcclusion = true;

  return group;
}

// 3. Seraph Shade / Oculus Ward: sacred geometry rings with spinning rosette jewel core
export function createSeraphMesh(colorName: GlassColorName = 'emerald'): Group {
  const group = new Group();
  const baseColor = colorForGlass(colorName);

  // Shadow sacred geometry outer wings / rings
  const ringGeom = new TorusGeometry(1.6, 0.08, 6, 24);
  const ringMesh = new Mesh(ringGeom, SHADOW_BODY_MATERIAL);
  const ringEdges = new LineSegments(new EdgesGeometry(ringGeom), SHADOW_EDGE_MATERIAL);
  group.add(ringMesh, ringEdges);

  // 6 radial shadow feathers
  const featherGeometries: BufferGeometry[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    const feather = new ConeGeometry(0.22, 1.8, 3);
    feather.rotateZ(angle + Math.PI / 2);
    feather.translate(Math.cos(angle) * 1.5, Math.sin(angle) * 1.5, 0);
    featherGeometries.push(feather);
  }
  const mergedFeathers = mergeGeometries(featherGeometries);
  const feathersMesh = new Mesh(mergedFeathers, SHADOW_BODY_MATERIAL);
  group.add(feathersMesh);

  for (const g of featherGeometries) g.dispose();

  // Central ornate Rosette Stained Glass Core
  const rosetteGeom = new IcosahedronGeometry(0.65, 1);
  const coreMaterial = createAdditiveBasicMaterial({ color: hdr(baseColor, 2.0) });
  const coreMesh = new Mesh(rosetteGeom, coreMaterial);
  group.add(coreMesh);

  const rosetteEdges = new LineSegments(new EdgesGeometry(rosetteGeom), new LineBasicMaterial(additiveMaterialParameters({ color: hdr(PURE_LIGHT, 1.5) })));
  group.add(rosetteEdges);

  // Concentric jewel light rings
  const haloGeom = new RingGeometry(1.1, 1.35, 32);
  const haloMaterial = createAdditiveBasicMaterial({ color: hdr(baseColor, 0.6), side: DoubleSide });
  const haloMesh = new Mesh(haloGeom, haloMaterial);
  group.add(haloMesh);

  group.userData.visualState = {
    kind: 'seraph',
    colorName,
    baseColor,
    coreMesh,
    haloMesh,
    edgeLines: ringEdges,
  } satisfies VespersEnemyVisualState;
  group.userData.accent = baseColor.clone();
  group.userData.raildIgnoreOcclusion = true;

  return group;
}

// 4. Stolen Ember (hazard / hostile shot)
export function createEmberMesh(colorName: GlassColorName = 'crimson'): Group {
  const group = new Group();
  const baseColor = colorForGlass(colorName);

  const needle = new ConeGeometry(0.12, 0.9, 4);
  needle.rotateX(Math.PI / 2);
  const needleMesh = new Mesh(needle, SHADOW_BODY_MATERIAL);
  group.add(needleMesh);

  const flameGeom = new OctahedronGeometry(0.22, 0);
  const flameMaterial = createAdditiveBasicMaterial({ color: hdr(baseColor, 2.4) });
  const flameMesh = new Mesh(flameGeom, flameMaterial);
  group.add(flameMesh);

  group.userData.visualState = {
    kind: 'ember',
    colorName,
    baseColor,
    coreMesh: flameMesh,
  } satisfies VespersEnemyVisualState;
  group.userData.accent = baseColor.clone();
  group.userData.raildIgnoreOcclusion = true;

  return group;
}

// 5. Boss: Rose Petal Shield (1 of 4 orbiting quadrants)
export function createBossShardMesh(colorName: GlassColorName = 'gold'): Group {
  const group = new Group();
  const baseColor = colorForGlass(colorName);

  // Curved gothic tracery petal frame
  const petalGeom = new CylinderGeometry(1.4, 0.3, 3.2, 4, 1, true);
  petalGeom.scale(1.2, 1.0, 0.4);
  const frameMesh = new Mesh(petalGeom, SHADOW_BODY_MATERIAL);
  const frameEdges = new LineSegments(new EdgesGeometry(petalGeom), new LineBasicMaterial({ color: LEAD_CAME }));
  group.add(frameMesh, frameEdges);

  // Stained glass panel inside the petal
  const glassGeom = new PlaneGeometry(1.6, 2.8);
  const glassMaterial = createAdditiveBasicMaterial({ color: hdr(baseColor, 1.7), side: DoubleSide });
  const glassMesh = new Mesh(glassGeom, glassMaterial);
  glassMesh.position.set(0, 0, 0.05);
  group.add(glassMesh);

  // Outer halo
  const haloGeom = new RingGeometry(1.5, 1.9, 24);
  const haloMaterial = createAdditiveBasicMaterial({ color: hdr(baseColor, 0.6), side: DoubleSide });
  const haloMesh = new Mesh(haloGeom, haloMaterial);
  group.add(haloMesh);

  group.userData.visualState = {
    kind: 'boss-shard',
    colorName,
    baseColor,
    coreMesh: glassMesh,
    haloMesh,
  } satisfies VespersEnemyVisualState;
  group.userData.accent = baseColor.clone();
  group.userData.raildIgnoreOcclusion = true;

  return group;
}

// 6. Boss Core: The Oculus Eater (Arch-Umbra nested in the Rose Window)
export function createBossCoreMesh(): Group {
  const group = new Group();

  // Sprawling black gothic shadow tendrils reaching into the tracery
  const tendrilGeometries: BufferGeometry[] = [];
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2;
    const tendril = new ConeGeometry(0.35, 4.2, 4);
    tendril.rotateZ(angle + Math.PI / 2);
    tendril.translate(Math.cos(angle) * 3.2, Math.sin(angle) * 3.2, 0);
    tendrilGeometries.push(tendril);
  }
  const mergedTendrils = mergeGeometries(tendrilGeometries);
  const tendrilMesh = new Mesh(mergedTendrils, SHADOW_BODY_MATERIAL);
  const tendrilEdges = new LineSegments(new EdgesGeometry(mergedTendrils), SHADOW_EDGE_MATERIAL);
  group.add(tendrilMesh, tendrilEdges);

  for (const g of tendrilGeometries) g.dispose();

  // Massive multifaceted black crystalline heart
  const heartGeom = new IcosahedronGeometry(2.0, 1);
  const heartMesh = new Mesh(heartGeom, SHADOW_BODY_MATERIAL);
  group.add(heartMesh);

  // Burning chromatic stolen core (holding all colors)
  const coreGeom = new OctahedronGeometry(1.6, 2);
  const coreMaterial = createAdditiveBasicMaterial({ color: hdr(PURE_LIGHT, 2.5) });
  const coreMesh = new Mesh(coreGeom, coreMaterial);
  group.add(coreMesh);

  const coreEdges = new LineSegments(new EdgesGeometry(coreGeom), new LineBasicMaterial(additiveMaterialParameters({ color: hdr(GOLD, 1.8) })));
  group.add(coreEdges);

  // Massive radiant corona
  const coronaGeom = new RingGeometry(2.4, 3.8, 32);
  const coronaMaterial = createAdditiveBasicMaterial({ color: hdr(GOLD, 0.8), side: DoubleSide });
  const coronaMesh = new Mesh(coronaGeom, coronaMaterial);
  group.add(coronaMesh);

  group.userData.visualState = {
    kind: 'boss-core',
    colorName: 'gold',
    baseColor: GOLD,
    coreMesh,
    haloMesh: coronaMesh,
  } satisfies VespersEnemyVisualState;
  group.userData.accent = GOLD.clone();
  group.userData.raildIgnoreOcclusion = true;

  return group;
}

export function updateEnemyVisualLock(group: Group, locked: boolean) {
  const state = group.userData.visualState as VespersEnemyVisualState | undefined;
  if (!state) return;

  const coreMat = state.coreMesh.material as MeshBasicMaterial;
  if (locked) {
    coreMat.color.copy(hdr(PURE_LIGHT, 2.8));
    if (state.haloMesh) {
      (state.haloMesh.material as MeshBasicMaterial).color.copy(hdr(state.baseColor, 1.6));
    }
    group.scale.setScalar(1.22);
  } else {
    coreMat.color.copy(hdr(state.baseColor, 1.8));
    if (state.haloMesh) {
      (state.haloMesh.material as MeshBasicMaterial).color.copy(hdr(state.baseColor, 0.5));
    }
    group.scale.setScalar(1.0);
  }
}

export function updateEnemyVisualDenied(group: Group) {
  const state = group.userData.visualState as VespersEnemyVisualState | undefined;
  if (!state) return;

  const coreMat = state.coreMesh.material as MeshBasicMaterial;
  coreMat.color.copy(hdr(CRIMSON, 2.2));
  if (state.haloMesh) {
    (state.haloMesh.material as MeshBasicMaterial).color.copy(hdr(CRIMSON, 1.2));
  }
  group.scale.setScalar(0.8);
}
