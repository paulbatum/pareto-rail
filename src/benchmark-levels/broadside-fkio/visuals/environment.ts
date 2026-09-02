import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
  type Camera,
} from 'three';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import {
  createEnemyFlagship,
  createEnemyWarship,
  createFriendlyCruiser,
  createLaunchDeck,
} from './capital-ships';
import {
  CRIMSON_FIRE,
  CYAN_BEAM,
  NEBULA_GOLD,
  NEBULA_GOLD_DEEP,
  NEBULA_MAGENTA,
  NEBULA_MAGENTA_DEEP,
  SPACE_VOID,
  STAR_WHITE,
} from './palette';

export type Environment = {
  group: Group;
  launchDeck: Group;
  friendlyCruiser: Group;
  enemyDreadnought: Group;
  enemyFlagship: Group;
  update(camera: Camera, time: number, dt: number): void;
  dispose(): void;
};

export function createEnvironment(scene: Scene): Environment {
  scene.background = SPACE_VOID.clone();

  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;
  scene.add(group);

  // ---- 1. Celestial Backdrop (Follows camera within camera.far = 500) -----
  const celestialGroup = new Group();
  celestialGroup.userData.raildIgnoreOcclusion = true;
  group.add(celestialGroup);

  // Starfield Sphere (radius 390 around camera)
  const STAR_COUNT = 2200;
  const starPositions = new Float32Array(STAR_COUNT * 3);
  const starColors = new Float32Array(STAR_COUNT * 3);

  for (let i = 0; i < STAR_COUNT; i += 1) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);
    const r = 380 + Math.random() * 20;

    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starPositions[i * 3 + 2] = r * Math.cos(phi);

    const tint = Math.random();
    let col = STAR_WHITE;
    if (tint < 0.25) col = NEBULA_GOLD;
    else if (tint < 0.55) col = NEBULA_MAGENTA;

    starColors[i * 3] = col.r;
    starColors[i * 3 + 1] = col.g;
    starColors[i * 3 + 2] = col.b;
  }

  const starGeom = new BufferGeometry();
  starGeom.setAttribute('position', new BufferAttribute(starPositions, 3));
  starGeom.setAttribute('color', new BufferAttribute(starColors, 3));

  const starMat = new PointsMaterial({
    size: 2.2,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const starPoints = new Points(starGeom, starMat);
  celestialGroup.add(starPoints);

  // Luminous Organic Nebula Wings:
  // Port: Radiant Magenta cloud cluster. Starboard: Luminous Gold cloud cluster.
  // Separated across the perimeter to frame the central dark starry combat lane.
  const nebulaClouds = [
    // Magenta Wing (Port)
    { pos: new Vector3(-180, 40, -325), radius: 220, color: NEBULA_MAGENTA_DEEP, opacity: 0.30 },
    { pos: new Vector3(-160, 20, -320), radius: 170, color: NEBULA_MAGENTA, opacity: 0.22 },
    { pos: new Vector3(-130, -35, -315), radius: 130, color: NEBULA_MAGENTA, opacity: 0.18 },
    { pos: new Vector3(-200, 75, -320), radius: 150, color: NEBULA_MAGENTA_DEEP, opacity: 0.20 },

    // Gold Wing (Starboard)
    { pos: new Vector3(180, 40, -325), radius: 220, color: NEBULA_GOLD_DEEP, opacity: 0.30 },
    { pos: new Vector3(160, 20, -320), radius: 170, color: NEBULA_GOLD, opacity: 0.22 },
    { pos: new Vector3(130, -35, -315), radius: 130, color: NEBULA_GOLD, opacity: 0.18 },
    { pos: new Vector3(200, 75, -320), radius: 150, color: NEBULA_GOLD_DEEP, opacity: 0.20 },

    // High Celestial Crown Arch
    { pos: new Vector3(0, 190, -330), radius: 180, color: new Color(0.6, 0.2, 0.35), opacity: 0.15 },
  ];

  const discGeom = new CircleGeometry(1, 36);
  for (const cloud of nebulaClouds) {
    const mat = new MeshBasicMaterial(additiveMaterialParameters({
      color: cloud.color,
      side: DoubleSide,
      transparent: true,
      opacity: cloud.opacity,
      depthWrite: false,
    }));
    const mesh = new Mesh(discGeom, mat);
    mesh.position.copy(cloud.pos);
    mesh.scale.setScalar(cloud.radius);
    celestialGroup.add(mesh);
  }

  // ---- 2. World Capital Ships Deployment -----------------------------------

  // A. Friendly Flight Deck on carrier Aegis Prime (start platform)
  const launchDeck = createLaunchDeck();
  launchDeck.position.set(0, 0, 0);
  group.add(launchDeck);

  // B. Friendly Battlecruiser (Valiant) flanking rail on the right in Act 2
  const friendlyCruiser = createFriendlyCruiser();
  friendlyCruiser.position.set(70, 16, -620);
  friendlyCruiser.rotation.y = -0.05;
  group.add(friendlyCruiser);

  // C. Distant Allied Cruiser in upper left
  const friendlyCruiser2 = createFriendlyCruiser();
  friendlyCruiser2.position.set(-160, 90, -850);
  friendlyCruiser2.scale.setScalar(0.75);
  friendlyCruiser2.rotation.y = 0.2;
  group.add(friendlyCruiser2);

  // D. Enemy Warship (Oblivion) - overhead dreadnought for belly run in Act 3
  const enemyDreadnought = createEnemyWarship();
  enemyDreadnought.position.set(10, 48, -1380);
  enemyDreadnought.rotation.y = Math.PI - 0.04;
  group.add(enemyDreadnought);

  // E. Distant Enemy Cruiser across the gap
  const enemyCruiserBkg = createEnemyWarship();
  enemyCruiserBkg.position.set(180, -60, -1550);
  enemyCruiserBkg.scale.setScalar(0.7);
  enemyCruiserBkg.rotation.y = Math.PI + 0.25;
  group.add(enemyCruiserBkg);

  // F. Enemy Flagship (The Leviathan) - Boss in Acts 4, 5, 6
  const enemyFlagship = createEnemyFlagship();
  enemyFlagship.position.set(0, -10, -2380);
  enemyFlagship.rotation.y = Math.PI;
  group.add(enemyFlagship);

  function update(camera: Camera, time: number, _dt: number) {
    celestialGroup.position.copy(camera.position);
    celestialGroup.rotation.z = Math.sin(time * 0.1) * 0.02;
  }

  function dispose() {
    starGeom.dispose();
    starMat.dispose();
    discGeom.dispose();
    scene.remove(group);
  }

  return {
    group,
    launchDeck,
    friendlyCruiser,
    enemyDreadnought,
    enemyFlagship,
    update,
    dispose,
  };
}
