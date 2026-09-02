import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  CRIMSON_FIRE,
  CYAN_BOLT,
  DENIED_RED,
  ENEMY_DARK_METAL,
  ENEMY_OBSIDIAN,
  FRIENDLY_CYAN,
  FRIENDLY_WHITE,
  hdr,
  LOCK_COLOR,
  MOLTEN_ORANGE,
  MOLTEN_ORANGE_HOT,
  SHIELD_CYAN,
} from './palette';

// Reusable shared materials and geometries for high performance and low draw calls
const obsidianMaterial = new MeshBasicMaterial({ color: ENEMY_OBSIDIAN });
const darkMetalMaterial = new MeshBasicMaterial({ color: ENEMY_DARK_METAL });
const orangeTrimMaterial = new MeshBasicMaterial({ color: hdr(MOLTEN_ORANGE, 1.4) });
const orangeHotMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN_ORANGE_HOT, 2.0) });
const crimsonFireMaterial = createAdditiveBasicMaterial({ color: hdr(CRIMSON_FIRE, 2.2) });
const shieldGlowMaterial = createAdditiveBasicMaterial({ color: hdr(SHIELD_CYAN, 1.8), opacity: 0.85 });
const cyanEngineMaterial = createAdditiveBasicMaterial({ color: hdr(FRIENDLY_CYAN, 2.0) });

export function createDartMesh(): Group {
  const root = new Group();

  // Forward-swept delta fighter fuselage
  const bodyGeo = new ConeGeometry(0.55, 2.4, 4);
  bodyGeo.rotateX(Math.PI / 2);
  const body = new Mesh(bodyGeo, obsidianMaterial);

  // Delta wings
  const wingLeftGeo = new BoxGeometry(1.6, 0.08, 0.9);
  wingLeftGeo.translate(-0.9, 0, -0.2);
  const wingLeft = new Mesh(wingLeftGeo, obsidianMaterial);

  const wingRightGeo = new BoxGeometry(1.6, 0.08, 0.9);
  wingRightGeo.translate(0.9, 0, -0.2);
  const wingRight = new Mesh(wingRightGeo, obsidianMaterial);

  // Twin molten-orange engines
  const engineGeo = new CylinderGeometry(0.16, 0.16, 0.5, 6);
  engineGeo.rotateX(Math.PI / 2);

  const engL = new Mesh(engineGeo, orangeHotMaterial);
  engL.position.set(-0.55, 0, 1.0);

  const engR = new Mesh(engineGeo, orangeHotMaterial);
  engR.position.set(0.55, 0, 1.0);

  // Wingtip molten fins
  const finGeo = new BoxGeometry(0.08, 0.6, 0.4);
  const finL = new Mesh(finGeo, orangeTrimMaterial);
  finL.position.set(-1.6, 0.15, -0.2);
  const finR = new Mesh(finGeo, orangeTrimMaterial);
  finR.position.set(1.6, 0.15, -0.2);

  // Crimson sensor visor
  const visorGeo = new BoxGeometry(0.3, 0.12, 0.6);
  const visor = new Mesh(visorGeo, crimsonFireMaterial);
  visor.position.set(0, 0.22, -0.4);

  root.add(body, wingLeft, wingRight, engL, engR, finL, finR, visor);
  root.scale.setScalar(1.2);

  root.userData.raildRole = 'target';
  root.userData.kind = 'dart';
  root.userData.accent = MOLTEN_ORANGE_HOT.clone();
  root.userData.hitFlash = 0;

  return root;
}

export function createBomberMesh(): Group {
  const root = new Group();

  // Heavy hexagonal hull
  const mainHullGeo = new BoxGeometry(1.8, 0.9, 3.2);
  const mainHull = new Mesh(mainHullGeo, obsidianMaterial);

  // Heavy wing pods
  const wingLGeo = new BoxGeometry(1.4, 0.4, 1.8);
  wingLGeo.translate(-1.4, -0.1, 0.2);
  const wingL = new Mesh(wingLGeo, darkMetalMaterial);

  const wingRGeo = new BoxGeometry(1.4, 0.4, 1.8);
  wingRGeo.translate(1.4, -0.1, 0.2);
  const wingR = new Mesh(wingRGeo, darkMetalMaterial);

  // Glowing orange radiator ribs along dorsal spine
  const radiatorGeo = new BoxGeometry(0.4, 0.25, 2.2);
  radiatorGeo.translate(0, 0.5, 0);
  const radiator = new Mesh(radiatorGeo, orangeHotMaterial);

  // Heavy twin thruster bells
  const bellGeo = new CylinderGeometry(0.35, 0.45, 0.6, 8);
  bellGeo.rotateX(Math.PI / 2);

  const bellL = new Mesh(bellGeo, orangeHotMaterial);
  bellL.position.set(-0.7, 0, 1.6);

  const bellR = new Mesh(bellGeo, orangeHotMaterial);
  bellR.position.set(0.7, 0, 1.6);

  // Crimson bombardier sensor eye
  const sensorGeo = new SphereGeometry(0.3, 8, 8);
  const sensor = new Mesh(sensorGeo, crimsonFireMaterial);
  sensor.position.set(0, 0, -1.7);

  root.add(mainHull, wingL, wingR, radiator, bellL, bellR, sensor);
  root.scale.setScalar(1.4);

  root.userData.raildRole = 'target';
  root.userData.kind = 'bomber';
  root.userData.accent = MOLTEN_ORANGE.clone();
  root.userData.hitFlash = 0;

  return root;
}

export function createTurretMesh(): Group {
  const root = new Group();

  // Armored hemisphere base
  const baseGeo = new CylinderGeometry(1.2, 1.6, 0.6, 10);
  const base = new Mesh(baseGeo, darkMetalMaterial);

  // Turret dome
  const domeGeo = new SphereGeometry(1.0, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const dome = new Mesh(domeGeo, obsidianMaterial);
  dome.position.y = 0.25;

  // Twin cannon barrels
  const barrelPivot = new Group();
  barrelPivot.position.set(0, 0.5, 0);

  const barrelGeo = new CylinderGeometry(0.14, 0.16, 2.6, 6);
  barrelGeo.rotateX(Math.PI / 2);
  barrelGeo.translate(0, 0, -1.1);

  const barrelL = new Mesh(barrelGeo, darkMetalMaterial);
  barrelL.position.x = -0.4;

  const barrelR = new Mesh(barrelGeo, darkMetalMaterial);
  barrelR.position.x = 0.4;

  // Glowing muzzle rings
  const muzzleGeo = new TorusGeometry(0.18, 0.05, 4, 8);
  const muzL = new Mesh(muzzleGeo, orangeHotMaterial);
  muzL.position.set(-0.4, 0.5, -2.4);
  const muzR = new Mesh(muzzleGeo, orangeHotMaterial);
  muzR.position.set(0.4, 0.5, -2.4);

  // Sensor eye
  const eyeGeo = new BoxGeometry(0.3, 0.2, 0.2);
  const eye = new Mesh(eyeGeo, crimsonFireMaterial);
  eye.position.set(0, 0.35, -0.9);

  barrelPivot.add(barrelL, barrelR, muzL, muzR, eye);

  root.add(base, dome, barrelPivot);
  root.scale.setScalar(1.3);

  root.userData.raildRole = 'target';
  root.userData.kind = 'turret';
  root.userData.barrelPivot = barrelPivot;
  root.userData.accent = CRIMSON_FIRE.clone();
  root.userData.hitFlash = 0;

  return root;
}

export function createShieldGenMesh(): Group {
  const root = new Group();

  // Heavy armored mounting pylon
  const pylonGeo = new CylinderGeometry(0.9, 1.4, 1.2, 8);
  const pylon = new Mesh(pylonGeo, obsidianMaterial);

  // Glowing central energy sphere
  const coreGeo = new SphereGeometry(0.9, 14, 10);
  const core = new Mesh(coreGeo, shieldGlowMaterial);
  core.position.y = 1.2;

  // Concentric rotating energy rings
  const ring1Geo = new TorusGeometry(1.6, 0.1, 6, 24);
  const ring1 = new Mesh(ring1Geo, orangeHotMaterial);
  ring1.position.y = 1.2;

  const ring2Geo = new TorusGeometry(2.1, 0.08, 6, 24);
  const ring2 = new Mesh(ring2Geo, createAdditiveBasicMaterial({ color: hdr(SHIELD_CYAN, 2.0) }));
  ring2.position.y = 1.2;

  root.add(pylon, core, ring1, ring2);
  root.scale.setScalar(1.5);

  root.userData.raildRole = 'target';
  root.userData.kind = 'shield';
  root.userData.ring1 = ring1;
  root.userData.ring2 = ring2;
  root.userData.core = core;
  root.userData.accent = SHIELD_CYAN.clone();
  root.userData.hitFlash = 0;

  return root;
}

export function createReactorCoreMesh(): Group {
  const root = new Group();

  // Massive reactor containment cylinder
  const cylinderGeo = new CylinderGeometry(1.6, 1.6, 3.2, 12, 1, true);
  const cylinder = new Mesh(cylinderGeo, darkMetalMaterial);

  // Internal molten plasma column
  const plasmaGeo = new CylinderGeometry(1.3, 1.3, 3.0, 10);
  const plasma = new Mesh(plasmaGeo, orangeHotMaterial);

  // Outer protective cooling ribs
  const ribGeo = new BoxGeometry(3.8, 0.35, 0.4);
  const ribs: Mesh[] = [];
  for (let i = -1.2; i <= 1.2; i += 0.8) {
    const r1 = new Mesh(ribGeo, obsidianMaterial);
    r1.position.y = i;
    const r2 = new Mesh(ribGeo, obsidianMaterial);
    r2.position.y = i;
    r2.rotation.y = Math.PI / 2;
    ribs.push(r1, r2);
  }

  // Radiating conduits
  const conduitGeo = new TorusGeometry(2.2, 0.14, 6, 16);
  const cond1 = new Mesh(conduitGeo, orangeHotMaterial);
  const cond2 = new Mesh(conduitGeo, orangeHotMaterial);
  cond1.position.y = -0.9;
  cond2.position.y = 0.9;

  root.add(cylinder, plasma, ...ribs, cond1, cond2);
  root.scale.setScalar(1.8);

  root.userData.raildRole = 'target';
  root.userData.kind = 'core';
  root.userData.plasma = plasma;
  root.userData.cond1 = cond1;
  root.userData.cond2 = cond2;
  root.userData.accent = MOLTEN_ORANGE_HOT.clone();
  root.userData.hitFlash = 0;

  return root;
}

export function createPlasmaMesh(): Group {
  const root = new Group();

  // Glowing spinning diamond
  const boltGeo = new ConeGeometry(0.35, 1.2, 4);
  boltGeo.rotateX(Math.PI / 2);
  const bolt1 = new Mesh(boltGeo, crimsonFireMaterial);

  const bolt2 = new Mesh(boltGeo, crimsonFireMaterial);
  bolt2.rotation.z = Math.PI;

  root.add(bolt1, bolt2);
  root.scale.setScalar(1.0);

  root.userData.raildRole = 'target';
  root.userData.kind = 'plasma';
  root.userData.accent = CRIMSON_FIRE.clone();
  root.userData.hitFlash = 0;

  return root;
}
