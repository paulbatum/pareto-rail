import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import {
  ALLY_ACCENT_BLUE,
  CRIMSON_FIRE,
  CRIMSON_GLOW,
  CYAN_FIRE,
  CYAN_GLOW,
  ICE_WHITE_HULL,
  ICE_WHITE_PLATE,
  MOLTEN_ORANGE,
  OBSIDIAN_ARMOR,
  OBSIDIAN_HULL,
} from './palette';

// Materials
const friendlyHullMat = new MeshBasicMaterial({ color: ICE_WHITE_HULL });
const friendlyPlateMat = new MeshBasicMaterial({ color: ICE_WHITE_PLATE });
const friendlyBlueMat = new MeshBasicMaterial({ color: ALLY_ACCENT_BLUE });
const friendlyCyanMat = new MeshBasicMaterial(additiveMaterialParameters({ color: CYAN_FIRE, depthWrite: false }));

const enemyHullMat = new MeshBasicMaterial({ color: OBSIDIAN_HULL });
const enemyArmorMat = new MeshBasicMaterial({ color: OBSIDIAN_ARMOR });
const enemyOrangeMat = new MeshBasicMaterial({ color: MOLTEN_ORANGE });
const enemyCrimsonMat = new MeshBasicMaterial(additiveMaterialParameters({ color: CRIMSON_FIRE, depthWrite: false }));

/**
 * The Launch Deck of the Friendly Flagship (Aegis Prime).
 * Located at the beginning of the rail.
 */
export function createLaunchDeck(): Group {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;

  const plates: BufferGeometry[] = [];

  // Main flight deck runway (length 240, width 18)
  const deckPlate = new BoxGeometry(18, 3, 240);
  deckPlate.translate(0, -3.5, -40);
  plates.push(deckPlate);

  // Runway side curbs
  const leftCurb = new BoxGeometry(1.2, 0.8, 240);
  leftCurb.translate(-8.5, -1.6, -40);
  const rightCurb = new BoxGeometry(1.2, 0.8, 240);
  rightCurb.translate(8.5, -1.6, -40);
  plates.push(leftCurb, rightCurb);

  // Flight control island tower (offset to port side)
  const towerBase = new BoxGeometry(10, 20, 45);
  towerBase.translate(-19, 6.5, -30);
  const bridgeSpire = new BoxGeometry(6, 12, 20);
  bridgeSpire.translate(-19, 21, -38);
  plates.push(towerBase, bridgeSpire);

  // Catapult launch side pylons (no overhead crossbar to preserve clear sky)
  for (let z = 20; z >= -140; z -= 40) {
    const pylonL = new BoxGeometry(1.5, 6, 2);
    pylonL.translate(-10, 0, z);
    const pylonR = new BoxGeometry(1.5, 6, 2);
    pylonR.translate(10, 0, z);
    plates.push(pylonL, pylonR);
  }

  const mergedDeck = mergeGeometries(plates);
  for (const p of plates) p.dispose();
  group.add(new Mesh(mergedDeck, friendlyHullMat));

  // Catapult guide light strips
  const lights: BufferGeometry[] = [];
  const leftLight = new BoxGeometry(0.2, 0.05, 230);
  leftLight.translate(-2.0, -1.9, -40);
  const rightLight = new BoxGeometry(0.2, 0.05, 230);
  rightLight.translate(2.0, -1.9, -40);
  lights.push(leftLight, rightLight);

  const mergedLights = mergeGeometries(lights);
  for (const l of lights) l.dispose();
  group.add(new Mesh(mergedLights, friendlyCyanMat));

  return group;
}

/**
 * Friendly Battlecruiser (Valiant) - kilometer-class hull flanking the rail in Act 2.
 * Equipped with broadside turrets that emit synchronized cyan salvoes.
 */
export function createFriendlyCruiser(): Group {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;

  const parts: BufferGeometry[] = [];

  // Main wedge hull (600m long, 100m wide)
  const mainSpine = new BoxGeometry(55, 35, 420);
  mainSpine.translate(0, 0, 0);
  parts.push(mainSpine);

  // Wedge bow
  const bow = new ConeGeometry(50, 180, 4);
  bow.rotateY(Math.PI / 4);
  bow.rotateX(-Math.PI / 2);
  bow.translate(0, 0, -280);
  parts.push(bow);

  // Flank armor sponsons
  const leftFlank = new BoxGeometry(25, 20, 280);
  leftFlank.translate(-35, -4, 30);
  const rightFlank = new BoxGeometry(25, 20, 280);
  rightFlank.translate(35, -4, 30);
  parts.push(leftFlank, rightFlank);

  // Dorsal superstructure
  const superstructure = new BoxGeometry(32, 16, 180);
  superstructure.translate(0, 22, 20);
  parts.push(superstructure);

  const mergedHull = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  group.add(new Mesh(mergedHull, friendlyHullMat));

  // Secondary armor plates
  const plates: BufferGeometry[] = [];
  const dorsalRidge = new BoxGeometry(12, 6, 240);
  dorsalRidge.translate(0, 32, 0);
  plates.push(dorsalRidge);

  const mergedPlates = mergeGeometries(plates);
  for (const p of plates) p.dispose();
  group.add(new Mesh(mergedPlates, friendlyPlateMat));

  // Stern engine array (3 huge cyan thrusters)
  const engines: BufferGeometry[] = [];
  for (let i = -1; i <= 1; i += 1) {
    const eng = new CylinderGeometry(9, 11, 24, 8);
    eng.rotateX(Math.PI / 2);
    eng.translate(i * 20, -2, 215);
    engines.push(eng);
  }
  const mergedEngines = mergeGeometries(engines);
  for (const e of engines) e.dispose();
  group.add(new Mesh(mergedEngines, friendlyCyanMat));

  // Broadside triple-turret batteries along port flank
  const turretMounts: BufferGeometry[] = [];
  for (let z = -100; z <= 100; z += 50) {
    const mount = new CylinderGeometry(7, 8, 4, 8);
    mount.translate(-22, 22, z);
    turretMounts.push(mount);
  }
  const mergedMounts = mergeGeometries(turretMounts);
  for (const m of turretMounts) m.dispose();
  group.add(new Mesh(mergedMounts, friendlyBlueMat));

  return group;
}

/**
 * Enemy Dreadnought (Oblivion) - colossal obsidian warship for the belly run in Act 3.
 */
export function createEnemyWarship(): Group {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;

  const parts: BufferGeometry[] = [];

  // Vast obsidian predator hull (500m long, 100m wide)
  const spine = new BoxGeometry(65, 38, 380);
  parts.push(spine);

  // Angular predator prow
  const bow = new ConeGeometry(55, 160, 4);
  bow.rotateY(Math.PI / 4);
  bow.rotateX(-Math.PI / 2);
  bow.translate(0, 0, -260);
  parts.push(bow);

  // Underbelly armor ribs
  for (let z = -140; z <= 140; z += 35) {
    const rib = new BoxGeometry(80, 5, 12);
    rib.translate(0, -20, z);
    parts.push(rib);
  }

  const mergedHull = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  group.add(new Mesh(mergedHull, enemyHullMat));

  // Molten orange radiator seams along underbelly
  const seams: BufferGeometry[] = [];
  const centerSeam = new BoxGeometry(4, 1.2, 320);
  centerSeam.translate(0, -20.5, 0);
  seams.push(centerSeam);

  const mergedSeams = mergeGeometries(seams);
  for (const s of seams) s.dispose();
  group.add(new Mesh(mergedSeams, enemyOrangeMat));

  // Crimson stern engines
  const engines: BufferGeometry[] = [];
  for (let i = -1; i <= 1; i += 1) {
    const eng = new CylinderGeometry(10, 12, 20, 6);
    eng.rotateX(Math.PI / 2);
    eng.translate(i * 24, 0, 195);
    engines.push(eng);
  }
  const mergedEng = mergeGeometries(engines);
  for (const e of engines) e.dispose();
  group.add(new Mesh(mergedEng, enemyCrimsonMat));

  return group;
}

/**
 * Enemy Flagship (The Leviathan) - Boss structure in Acts 4, 5, 6.
 * Features upper deck shield generator mounts and the central trenchwork.
 */
export function createEnemyFlagship(): Group {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;

  const parts: BufferGeometry[] = [];

  // Command dreadnought (900m long, 180m wide)
  // Trench canyon walls (left & right)
  const leftWing = new BoxGeometry(70, 50, 580);
  leftWing.translate(-55, 0, 0);
  const rightWing = new BoxGeometry(70, 50, 580);
  rightWing.translate(55, 0, 0);
  parts.push(leftWing, rightWing);

  // Trench floor
  const trenchFloor = new BoxGeometry(42, 14, 580);
  trenchFloor.translate(0, -22, 0);
  parts.push(trenchFloor);

  // Towering stern bridge citadel
  const citadel = new BoxGeometry(100, 60, 120);
  citadel.translate(0, 35, 200);
  parts.push(citadel);

  // Serrated forward prow strakes
  const leftProw = new ConeGeometry(30, 140, 4);
  leftProw.rotateX(-Math.PI / 2);
  leftProw.translate(-55, 0, -350);
  const rightProw = new ConeGeometry(30, 140, 4);
  rightProw.rotateX(-Math.PI / 2);
  rightProw.translate(55, 0, -350);
  parts.push(leftProw, rightProw);

  const mergedHull = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  group.add(new Mesh(mergedHull, enemyArmorMat));

  // Molten orange energy conduits running along trench walls (thin glowing strips)
  const conduits: BufferGeometry[] = [];
  const leftConduit = new BoxGeometry(0.8, 3, 520);
  leftConduit.translate(-20.5, -12, 0);
  const rightConduit = new BoxGeometry(0.8, 3, 520);
  rightConduit.translate(20.5, -12, 0);
  conduits.push(leftConduit, rightConduit);

  const mergedConduits = mergeGeometries(conduits);
  for (const c of conduits) c.dispose();
  group.add(new Mesh(mergedConduits, enemyOrangeMat));

  // Crimson engine exhausts (6 engines)
  const engines: BufferGeometry[] = [];
  for (let x = -2; x <= 2; x += 1) {
    const eng = new CylinderGeometry(12, 15, 30, 8);
    eng.rotateX(Math.PI / 2);
    eng.translate(x * 28, -6, 290);
    engines.push(eng);
  }
  const mergedEng = mergeGeometries(engines);
  for (const e of engines) e.dispose();
  group.add(new Mesh(mergedEng, enemyCrimsonMat));

  return group;
}
