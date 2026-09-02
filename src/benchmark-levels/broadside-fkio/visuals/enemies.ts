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
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import {
  CRIMSON_FIRE,
  CRIMSON_GLOW,
  CYAN_FIRE,
  DENY_CRIMSON,
  hdr,
  MOLTEN_ORANGE,
  MOLTEN_ORANGE_DIM,
  OBSIDIAN_ARMOR,
  OBSIDIAN_HULL,
  RETICLE_LOCKED,
} from './palette';

// Reusable base materials
const obsidianHullMat = new MeshBasicMaterial({ color: OBSIDIAN_HULL });
const obsidianArmorMat = new MeshBasicMaterial({ color: OBSIDIAN_ARMOR });
const moltenOrangeMat = new MeshBasicMaterial({ color: MOLTEN_ORANGE });
const crimsonGlowMat = new MeshBasicMaterial(additiveMaterialParameters({ color: CRIMSON_GLOW, depthWrite: false }));
const crimsonFireMat = new MeshBasicMaterial(additiveMaterialParameters({ color: CRIMSON_FIRE, depthWrite: false }));

export function createSkiffMesh(): Group {
  const group = new Group();

  // Swept delta-wing interceptor
  const bodyGeom = new ConeGeometry(0.55, 2.2, 4);
  bodyGeom.rotateX(Math.PI / 2);
  bodyGeom.scale(1.2, 0.4, 1);
  const bodyMesh = new Mesh(bodyGeom, obsidianArmorMat);
  group.add(bodyMesh);

  // Wing strakes with molten orange leading edges
  const wingFills: BufferGeometry[] = [];
  const leftWing = new BoxGeometry(1.6, 0.08, 0.8);
  leftWing.translate(-0.9, 0, -0.2);
  const rightWing = new BoxGeometry(1.6, 0.08, 0.8);
  rightWing.translate(0.9, 0, -0.2);
  wingFills.push(leftWing, rightWing);

  const wingsMesh = new Mesh(mergeGeometries(wingFills), obsidianHullMat);
  group.add(wingsMesh);
  leftWing.dispose();
  rightWing.dispose();

  // Molten wing edges
  const edgeFills: BufferGeometry[] = [];
  const leftEdge = new BoxGeometry(1.5, 0.1, 0.1);
  leftEdge.translate(-0.9, 0, 0.2);
  const rightEdge = new BoxGeometry(1.5, 0.1, 0.1);
  rightEdge.translate(0.9, 0, 0.2);
  edgeFills.push(leftEdge, rightEdge);

  const edgeMesh = new Mesh(mergeGeometries(edgeFills), moltenOrangeMat);
  group.add(edgeMesh);
  leftEdge.dispose();
  rightEdge.dispose();

  // Crimson thruster cone
  const thrusterGeom = new ConeGeometry(0.3, 0.7, 8);
  thrusterGeom.rotateX(-Math.PI / 2);
  thrusterGeom.translate(0, 0, -1.2);
  const thrusterMesh = new Mesh(thrusterGeom, crimsonFireMat);
  group.add(thrusterMesh);

  group.userData.kind = 'skiff';
  group.userData.thruster = thrusterMesh;
  return group;
}

export function createBomberMesh(): Group {
  const group = new Group();

  // Heavy hammerhead fuselage
  const cockpitGeom = new BoxGeometry(1.8, 0.7, 1.4);
  cockpitGeom.translate(0, 0, 0.6);
  const spineGeom = new BoxGeometry(1.0, 0.8, 2.4);
  spineGeom.translate(0, 0, -0.6);

  const mainGeom = mergeGeometries([cockpitGeom, spineGeom]);
  cockpitGeom.dispose();
  spineGeom.dispose();
  group.add(new Mesh(mainGeom, obsidianArmorMat));

  // Twin heavy engine nacelles
  const nacelles: BufferGeometry[] = [];
  const leftNacelle = new CylinderGeometry(0.45, 0.45, 2.6, 6);
  leftNacelle.rotateX(Math.PI / 2);
  leftNacelle.translate(-1.4, 0, -0.4);
  const rightNacelle = new CylinderGeometry(0.45, 0.45, 2.6, 6);
  rightNacelle.rotateX(Math.PI / 2);
  rightNacelle.translate(1.4, 0, -0.4);
  nacelles.push(leftNacelle, rightNacelle);

  const nacellesMesh = new Mesh(mergeGeometries(nacelles), obsidianHullMat);
  group.add(nacellesMesh);
  leftNacelle.dispose();
  rightNacelle.dispose();

  // Molten orange radiator / bomb bay belly
  const bellyGeom = new BoxGeometry(0.7, 0.2, 1.8);
  bellyGeom.translate(0, -0.4, -0.5);
  group.add(new Mesh(bellyGeom, moltenOrangeMat));

  // Twin crimson thruster exhausts
  const thrusters: BufferGeometry[] = [];
  const leftT = new ConeGeometry(0.35, 0.9, 6);
  leftT.rotateX(-Math.PI / 2);
  leftT.translate(-1.4, 0, -1.8);
  const rightT = new ConeGeometry(0.35, 0.9, 6);
  rightT.rotateX(-Math.PI / 2);
  rightT.translate(1.4, 0, -1.8);
  thrusters.push(leftT, rightT);

  const thrustersMesh = new Mesh(mergeGeometries(thrusters), crimsonFireMat);
  group.add(thrustersMesh);
  leftT.dispose();
  rightT.dispose();

  group.userData.kind = 'bomber';
  group.userData.thruster = thrustersMesh;
  return group;
}

export function createTurretMesh(): Group {
  const group = new Group();

  // Octagonal base mount
  const baseGeom = new CylinderGeometry(0.9, 1.1, 0.4, 8);
  group.add(new Mesh(baseGeom, obsidianArmorMat));

  // Swiveling turret housing
  const turretHousing = new Group();
  const domeGeom = new SphereGeometry(0.65, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  domeGeom.translate(0, 0.2, 0);
  turretHousing.add(new Mesh(domeGeom, obsidianHullMat));

  // Twin crimson laser barrels
  const barrels: BufferGeometry[] = [];
  const leftB = new CylinderGeometry(0.1, 0.1, 1.4, 6);
  leftB.rotateX(Math.PI / 2);
  leftB.translate(-0.28, 0.35, 0.8);
  const rightB = new CylinderGeometry(0.1, 0.1, 1.4, 6);
  rightB.rotateX(Math.PI / 2);
  rightB.translate(0.28, 0.35, 0.8);
  barrels.push(leftB, rightB);

  const barrelsMesh = new Mesh(mergeGeometries(barrels), moltenOrangeMat);
  turretHousing.add(barrelsMesh);
  leftB.dispose();
  rightB.dispose();

  // Muzzle glows
  const muzzles: BufferGeometry[] = [];
  const leftM = new SphereGeometry(0.14, 6, 4);
  leftM.translate(-0.28, 0.35, 1.5);
  const rightM = new SphereGeometry(0.14, 6, 4);
  rightM.translate(0.28, 0.35, 1.5);
  muzzles.push(leftM, rightM);

  const muzzlesMesh = new Mesh(mergeGeometries(muzzles), crimsonFireMat);
  turretHousing.add(muzzlesMesh);
  leftM.dispose();
  rightM.dispose();

  group.add(turretHousing);

  group.userData.kind = 'turret';
  group.userData.turretHousing = turretHousing;
  return group;
}

export function createShieldGenMesh(): Group {
  const group = new Group();

  // Tall hexagonal generator pylon
  const pylonGeom = new CylinderGeometry(0.8, 1.2, 2.6, 6);
  pylonGeom.translate(0, 1.3, 0);
  group.add(new Mesh(pylonGeom, obsidianArmorMat));

  // Glowing energy dome on top
  const domeGeom = new SphereGeometry(0.75, 12, 8);
  domeGeom.translate(0, 2.7, 0);
  const domeMesh = new Mesh(domeGeom, moltenOrangeMat);
  group.add(domeMesh);

  // Rotating toroidal shield projector ring
  const ringGeom = new TorusGeometry(1.5, 0.15, 6, 16);
  ringGeom.rotateX(Math.PI / 2);
  ringGeom.translate(0, 2.5, 0);
  const ringMesh = new Mesh(ringGeom, crimsonFireMat);
  group.add(ringMesh);

  // Pulsing energy forcefield sphere
  const shieldGeom = new SphereGeometry(2.0, 12, 8);
  shieldGeom.translate(0, 2.4, 0);
  const shieldMesh = new Mesh(
    shieldGeom,
    new MeshBasicMaterial(additiveMaterialParameters({
      color: CRIMSON_GLOW,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    })),
  );
  group.add(shieldMesh);

  group.userData.kind = 'shield-gen';
  group.userData.ringMesh = ringMesh;
  group.userData.shieldMesh = shieldMesh;
  group.userData.domeMesh = domeMesh;
  return group;
}

export function createCorePowerMesh(): Group {
  const group = new Group();

  // Base trench reactor socket
  const socketGeom = new CylinderGeometry(1.6, 1.8, 0.6, 8);
  group.add(new Mesh(socketGeom, obsidianArmorMat));

  // Glowing molten fusion sphere
  const coreGeom = new SphereGeometry(1.2, 12, 10);
  coreGeom.translate(0, 0.9, 0);
  const coreMesh = new Mesh(coreGeom, moltenOrangeMat);
  group.add(coreMesh);

  // 4 curved magnetic containment arms
  const arms: BufferGeometry[] = [];
  for (let i = 0; i < 4; i += 1) {
    const angle = (i * Math.PI) / 2;
    const arm = new BoxGeometry(0.35, 1.8, 0.35);
    arm.rotateZ(0.25);
    arm.translate(1.2, 0.9, 0);
    arm.rotateY(angle);
    arms.push(arm);
  }
  const armsMesh = new Mesh(mergeGeometries(arms), obsidianHullMat);
  group.add(armsMesh);
  for (const a of arms) a.dispose();

  // Energy field shell
  const auraGeom = new SphereGeometry(1.6, 10, 8);
  auraGeom.translate(0, 0.9, 0);
  const auraMesh = new Mesh(
    auraGeom,
    new MeshBasicMaterial(additiveMaterialParameters({
      color: CRIMSON_FIRE,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    })),
  );
  group.add(auraMesh);

  group.userData.kind = 'core-power';
  group.userData.coreMesh = coreMesh;
  group.userData.auraMesh = auraMesh;
  return group;
}

export function createBoltMesh(): Group {
  const group = new Group();

  // Crimson plasma bolt (hostile projectile)
  const coreGeom = new SphereGeometry(0.28, 8, 6);
  const coreMesh = new Mesh(coreGeom, crimsonFireMat);
  group.add(coreMesh);

  const auraGeom = new SphereGeometry(0.55, 8, 6);
  const auraMesh = new Mesh(
    auraGeom,
    new MeshBasicMaterial(additiveMaterialParameters({
      color: CRIMSON_GLOW,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    })),
  );
  group.add(auraMesh);

  group.userData.kind = 'bolt';
  return group;
}
