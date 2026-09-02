import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  COSMIC_PURPLE,
  CRIMSON_FIRE,
  CYAN_BOLT,
  ENEMY_DARK_METAL,
  ENEMY_OBSIDIAN,
  FRIENDLY_CYAN,
  FRIENDLY_CYAN_HOT,
  FRIENDLY_STEEL,
  FRIENDLY_WHITE,
  hdr,
  MOLTEN_ORANGE,
  MOLTEN_ORANGE_HOT,
  NEBULA_AMBER,
  NEBULA_GOLD,
  NEBULA_MAGENTA,
  NEBULA_VIOLET,
  SHIELD_CYAN,
  VOID_BLACK,
} from './palette';

export type BroadsideEnvironment = {
  root: Group;
  update(dt: number, runTime: number, speedFactor: number): void;
  triggerBroadsideSalvo(time: number): void;
  triggerBossExplosion(intensity: number): void;
};

export function createEnvironmentInternal(scene: Scene): BroadsideEnvironment {
  scene.background = VOID_BLACK.clone();
  const root = new Group();
  root.userData.raildIgnoreOcclusion = true;

  // 1. Starfield and colossal nebula
  const starsGroup = createStarfieldAndNebula();
  root.add(starsGroup);

  // 2. Launch flagship "Aegis" (friendly flight deck carrier)
  const aegisGroup = createLaunchFlagship();
  root.add(aegisGroup);

  // 3. Friendly battlecruiser "Resolute" (flank run, dorsal broadside turrets)
  const { resoluteGroup, broadsideBarrels } = createFriendlyCruiser();
  root.add(resoluteGroup);

  // 4. Enemy battlecruiser "Obsidian Dread" (belly pass)
  const enemyCruiserGroup = createEnemyCruiser();
  root.add(enemyCruiserGroup);

  // 5. Enemy Super-Flagship "Behemoth" (Boss arena)
  const { behemothGroup, flagshipExplosionNodes } = createEnemyFlagship();
  root.add(behemothGroup);

  // 6. Distant battle fleet silhouettes & ambient crossfire
  const distantFleet = createDistantFleet();
  root.add(distantFleet);

  // 7. Speed streaks
  const speedStreaks = createSpeedStreaks();
  root.add(speedStreaks.mesh);

  scene.add(root);

  // Crossfire beam simulation timers
  let nextSalvoTime = 0;
  let bossBreaking = false;
  let bossBreakTimer = 0;

  function triggerBroadsideSalvo(time: number) {
    // Animate recoil on Resolute's broadside barrels
    for (const b of broadsideBarrels) {
      b.position.z = 1.8; // recoil back
    }
  }

  function triggerBossExplosion(intensity: number) {
    bossBreaking = true;
    bossBreakTimer = 0;
  }

  function update(dt: number, runTime: number, speedFactor: number) {
    // Restore broadside barrel recoil
    for (const b of broadsideBarrels) {
      b.position.z = Math.max(0, b.position.z - dt * 3.5);
    }

    // Update speed streaks
    speedStreaks.update(dt, speedFactor);

    // If boss is breaking, animate expanding damage
    if (bossBreaking) {
      bossBreakTimer += dt;
      for (let i = 0; i < flagshipExplosionNodes.length; i += 1) {
        const node = flagshipExplosionNodes[i];
        const scale = 1 + Math.sin(bossBreakTimer * 8 + i) * 0.4;
        node.scale.setScalar(scale);
      }
    }
  }

  return {
    root,
    update,
    triggerBroadsideSalvo,
    triggerBossExplosion,
  };
}

// ============================================================================
// 1. Nebula & Starfield
// ============================================================================
function createStarfieldAndNebula(): Group {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;

  // Star points in deep background
  const starCount = 1500;
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount; i += 1) {
    const r = 1800 + Math.random() * 1200;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 2 - 1);

    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    const isCyan = Math.random() < 0.35;
    const col = isCyan ? FRIENDLY_CYAN_HOT : NEBULA_GOLD;
    const bright = 0.5 + Math.random() * 0.5;

    colors[i * 3] = col.r * bright;
    colors[i * 3 + 1] = col.g * bright;
    colors[i * 3 + 2] = col.b * bright;
  }

  const starGeo = new BufferGeometry();
  starGeo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  starGeo.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const starMat = new PointsMaterial({
    size: 2.5,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });

  const starPoints = new Points(starGeo, starMat);
  starPoints.userData.raildIgnoreOcclusion = true;
  group.add(starPoints);

  // Colossal backlit magenta-and-gold nebula planes in the deep horizon
  const nebulaColors = [
    { color: NEBULA_MAGENTA, pos: new Vector3(-600, 350, -3200), size: 2800, opacity: 0.28 },
    { color: NEBULA_GOLD, pos: new Vector3(700, -250, -3400), size: 3000, opacity: 0.24 },
    { color: NEBULA_VIOLET, pos: new Vector3(0, 600, -3100), size: 3200, opacity: 0.25 },
    { color: NEBULA_AMBER, pos: new Vector3(-500, -450, -3300), size: 2600, opacity: 0.22 },
    { color: NEBULA_MAGENTA, pos: new Vector3(250, 180, -2900), size: 2800, opacity: 0.3 },
    { color: NEBULA_GOLD, pos: new Vector3(-250, 120, -3000), size: 2600, opacity: 0.26 },
  ];

  const cloudGeo = new PlaneGeometry(1, 1);
  for (const n of nebulaColors) {
    const mat = createAdditiveBasicMaterial({
      color: hdr(n.color, 1.6),
      opacity: n.opacity,
    });
    const mesh = new Mesh(cloudGeo, mat);
    mesh.position.copy(n.pos);
    mesh.scale.set(n.size, n.size, 1);
    mesh.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.random() * 0.4 - 0.2);
    mesh.userData.raildIgnoreOcclusion = true;
    group.add(mesh);
  }

  return group;
}

// ============================================================================
// 2. Launch Flagship "Aegis" (Friendly Flight Deck Carrier)
// ============================================================================
function createLaunchFlagship(): Group {
  const ship = new Group();
  ship.userData.raildIgnoreOcclusion = true;
  ship.position.set(0, -22, -140);

  const deckPlateMat = new MeshBasicMaterial({ color: 0x141a26 }); // Dark military armored deck
  const steelMat = new MeshBasicMaterial({ color: FRIENDLY_STEEL });
  const cyanGlowMat = createAdditiveBasicMaterial({ color: hdr(FRIENDLY_CYAN, 2.0) });

  // Kilometer-long flight deck hull
  const deckGeo = new BoxGeometry(54, 8, 360);
  const deck = new Mesh(deckGeo, deckPlateMat);
  deck.position.set(0, 0, 0);

  // Runway recessed catapult slot
  const slotGeo = new BoxGeometry(2.4, 0.4, 340);
  const slot = new Mesh(slotGeo, cyanGlowMat);
  slot.position.set(0, 4.1, 0);

  // Runway edge guide stripes
  const stripeGeo = new BoxGeometry(0.8, 0.2, 340);
  const leftStripe = new Mesh(stripeGeo, cyanGlowMat);
  leftStripe.position.set(-18, 4.1, 0);
  const rightStripe = new Mesh(stripeGeo, cyanGlowMat);
  rightStripe.position.set(18, 4.1, 0);

  // Island superstructure on starboard side
  const islandGeo = new BoxGeometry(14, 24, 44);
  islandGeo.translate(36, 12, -60);
  const island = new Mesh(islandGeo, steelMat);

  // Command deck illuminated visor slit
  const visorGeo = new BoxGeometry(14.4, 2.2, 28);
  visorGeo.translate(36, 20, -60);
  const visor = new Mesh(visorGeo, cyanGlowMat);

  // Massive stern sublight engine bells
  const engineGeo = new CylinderGeometry(4.5, 6.0, 12, 12);
  engineGeo.rotateX(Math.PI / 2);

  const eng1 = new Mesh(engineGeo, cyanGlowMat);
  eng1.position.set(-14, 0, 185);

  const eng2 = new Mesh(engineGeo, cyanGlowMat);
  eng2.position.set(0, 0, 185);

  const eng3 = new Mesh(engineGeo, cyanGlowMat);
  eng3.position.set(14, 0, 185);

  ship.add(deck, slot, leftStripe, rightStripe, island, visor, eng1, eng2, eng3);
  return ship;
}

// ============================================================================
// 3. Friendly Battlecruiser "Resolute" (Flank Run, Broadsides Overhead)
// ============================================================================
function createFriendlyCruiser(): { resoluteGroup: Group; broadsideBarrels: Mesh[] } {
  const ship = new Group();
  ship.userData.raildIgnoreOcclusion = true;
  // Positioned along the flank run (Z = -550 to -1150), alongside player starboard
  ship.position.set(120, 36, -920);

  const whiteMat = new MeshBasicMaterial({ color: FRIENDLY_WHITE });
  const steelMat = new MeshBasicMaterial({ color: FRIENDLY_STEEL });
  const cyanGlowMat = createAdditiveBasicMaterial({ color: hdr(FRIENDLY_CYAN, 2.0) });

  // Main hull: sleek kilometer-long wedge with layered armor terraces
  const hullGeo = new BoxGeometry(42, 28, 600);
  const hull = new Mesh(hullGeo, whiteMat);

  // Bow wedge
  const bowGeo = new ConeGeometry(24, 120, 4);
  bowGeo.rotateX(-Math.PI / 2);
  bowGeo.translate(0, 0, -360);
  const bow = new Mesh(bowGeo, whiteMat);

  // Layered armor citadel
  const citadelGeo = new BoxGeometry(32, 16, 380);
  citadelGeo.translate(0, 18, 20);
  const citadel = new Mesh(citadelGeo, steelMat);

  // 4 Colossal broadside turrets with recoilable heavy barrels
  const broadsideBarrels: Mesh[] = [];
  const turretBaseGeo = new CylinderGeometry(6, 7.5, 4, 12);
  const barrelGeo = new CylinderGeometry(0.9, 1.2, 26, 8);
  barrelGeo.rotateX(Math.PI / 2);
  barrelGeo.rotateY(Math.PI / 2); // pointing port toward player and enemy line!

  const turretZ = [-140, -60, 20, 100];
  for (const z of turretZ) {
    const base = new Mesh(turretBaseGeo, steelMat);
    base.position.set(0, 28, z);

    // Twin heavy barrels pointing port (negative X)
    const barrelPair = new Group();
    barrelPair.position.set(-2, 29, z);

    const b1 = new Mesh(barrelGeo, whiteMat);
    b1.position.set(-10, 0, -2.5);
    const b2 = new Mesh(barrelGeo, whiteMat);
    b2.position.set(-10, 0, 2.5);

    // Glowing muzzle lips
    const muzGeo = new TorusGeometry(1.3, 0.3, 6, 12);
    muzGeo.rotateY(Math.PI / 2);
    const muz1 = new Mesh(muzGeo, cyanGlowMat);
    muz1.position.set(-23, 0, -2.5);
    const muz2 = new Mesh(muzGeo, cyanGlowMat);
    muz2.position.set(-23, 0, 2.5);

    barrelPair.add(b1, b2, muz1, muz2);
    ship.add(base, barrelPair);
    broadsideBarrels.push(b1, b2);
  }

  // Giant stern engine manifold
  const engineGeo = new CylinderGeometry(6, 8, 18, 14);
  engineGeo.rotateX(Math.PI / 2);
  for (let x = -14; x <= 14; x += 14) {
    const eng = new Mesh(engineGeo, cyanGlowMat);
    eng.position.set(x, 4, 305);
    ship.add(eng);
  }

  ship.add(hull, bow, citadel);
  return { resoluteGroup: ship, broadsideBarrels };
}

// ============================================================================
// 4. Enemy Battlecruiser "Obsidian Dread" (Belly Pass)
// ============================================================================
function createEnemyCruiser(): Group {
  const ship = new Group();
  ship.userData.raildIgnoreOcclusion = true;
  // Positioned overhead during the belly run (Z = -1180 to -1550)
  ship.position.set(-60, 42, -1400);
  ship.rotation.y = Math.PI;

  const obsidianMat = new MeshBasicMaterial({ color: ENEMY_OBSIDIAN });
  const darkMetalMat = new MeshBasicMaterial({ color: ENEMY_DARK_METAL });
  const moltenOrangeMat = createAdditiveBasicMaterial({ color: hdr(MOLTEN_ORANGE_HOT, 2.2) });

  // Main jagged obsidian hull
  const hullGeo = new BoxGeometry(52, 24, 450);
  const hull = new Mesh(hullGeo, obsidianMat);

  // Ventral keel ridge
  const keelGeo = new BoxGeometry(12, 14, 380);
  keelGeo.translate(0, -14, 0);
  const keel = new Mesh(keelGeo, darkMetalMat);

  // Molten orange circuit seams along underbelly
  const seamGeo = new BoxGeometry(1.2, 0.4, 360);
  const seam1 = new Mesh(seamGeo, moltenOrangeMat);
  seam1.position.set(-14, -12.2, 0);
  const seam2 = new Mesh(seamGeo, moltenOrangeMat);
  seam2.position.set(14, -12.2, 0);

  // Ventral hangar bays (recessed dark cavities)
  const hangarGeo = new BoxGeometry(20, 6, 80);
  hangarGeo.translate(0, -12, 40);
  const hangar = new Mesh(hangarGeo, new MeshBasicMaterial({ color: 0x020205 }));

  // Stern crimson thrusters
  const thrusterGeo = new CylinderGeometry(5, 7, 16, 12);
  thrusterGeo.rotateX(Math.PI / 2);
  const th1 = new Mesh(thrusterGeo, moltenOrangeMat);
  th1.position.set(-16, 0, 230);
  const th2 = new Mesh(thrusterGeo, moltenOrangeMat);
  th2.position.set(16, 0, 230);

  ship.add(hull, keel, seam1, seam2, hangar, th1, th2);
  return ship;
}

// ============================================================================
// 5. Enemy Super-Flagship "Behemoth" (Boss Arena)
// ============================================================================
function createEnemyFlagship(): { behemothGroup: Group; flagshipExplosionNodes: Mesh[] } {
  const ship = new Group();
  ship.userData.raildIgnoreOcclusion = true;
  // Colossal flagship sitting at Z = -1600 to -2400
  ship.position.set(0, 0, -2000);

  const obsidianMat = new MeshBasicMaterial({ color: ENEMY_OBSIDIAN });
  const darkMetalMat = new MeshBasicMaterial({ color: ENEMY_DARK_METAL });
  const orangeGlowMat = createAdditiveBasicMaterial({ color: hdr(MOLTEN_ORANGE_HOT, 2.2) });
  const shieldAuraMat = createAdditiveBasicMaterial({ color: hdr(SHIELD_CYAN, 1.4), opacity: 0.35 });

  // Main colossal dreadnought hull: 140m wide, 50m tall, 800m long!
  const hullGeo = new BoxGeometry(120, 48, 750);
  const hull = new Mesh(hullGeo, obsidianMat);

  // Massive angled prow
  const prowGeo = new ConeGeometry(65, 240, 4);
  prowGeo.rotateX(-Math.PI / 2);
  prowGeo.translate(0, 0, -480);
  const prow = new Mesh(prowGeo, obsidianMat);

  // Central Trenchwork: canyon running down the spine for Boss Phase 2!
  // Width: 18m, Depth: 16m, Length: 500m
  const trenchWallGeo = new BoxGeometry(10, 16, 500);
  const leftWall = new Mesh(trenchWallGeo, darkMetalMat);
  leftWall.position.set(-12, 28, 0);

  const rightWall = new Mesh(trenchWallGeo, darkMetalMat);
  rightWall.position.set(12, 28, 0);

  // Trench glowing molten conduit lines
  const trenchConduitGeo = new BoxGeometry(1.5, 1.5, 480);
  const leftConduit = new Mesh(trenchConduitGeo, orangeGlowMat);
  leftConduit.position.set(-6, 21, 0);

  const rightConduit = new Mesh(trenchConduitGeo, orangeGlowMat);
  rightConduit.position.set(6, 21, 0);

  // Starboard Shield Generator Mounting Shelf (Boss Phase 1)
  const shelfGeo = new BoxGeometry(24, 6, 260);
  shelfGeo.translate(62, 4, -80);
  const shelf = new Mesh(shelfGeo, darkMetalMat);

  // Massive Stern Thruster Array
  const thGeo = new CylinderGeometry(4.5, 6.5, 14, 12);
  thGeo.rotateX(Math.PI / 2);

  for (let x = -30; x <= 30; x += 20) {
    for (let y = -8; y <= 8; y += 16) {
      const th = new Mesh(thGeo, orangeGlowMat);
      th.position.set(x, y, 370);
      ship.add(th);
    }
  }

  // Explosion nodes on the flagship that expand when destroyed
  const flagshipExplosionNodes: Mesh[] = [];
  const explGeo = new SphereGeometry(12, 10, 8);
  const explZ = [-300, -150, 0, 150];
  for (const z of explZ) {
    const expl = new Mesh(explGeo, orangeGlowMat);
    expl.position.set((Math.random() - 0.5) * 40, 10, z);
    expl.scale.setScalar(0.01);
    ship.add(expl);
    flagshipExplosionNodes.push(expl);
  }

  ship.add(hull, prow, leftWall, rightWall, leftConduit, rightConduit, shelf);
  return { behemothGroup: ship, flagshipExplosionNodes };
}

// ============================================================================
// 6. Distant Fleet Silhouettes & Crossfire
// ============================================================================
function createDistantFleet(): Group {
  const fleet = new Group();
  fleet.userData.raildIgnoreOcclusion = true;

  const whiteMat = new MeshBasicMaterial({ color: FRIENDLY_WHITE });
  const obsidianMat = new MeshBasicMaterial({ color: ENEMY_OBSIDIAN });
  const cyanEngineMat = createAdditiveBasicMaterial({ color: hdr(FRIENDLY_CYAN, 1.8) });
  const orangeEngineMat = createAdditiveBasicMaterial({ color: hdr(MOLTEN_ORANGE_HOT, 1.8) });

  // Cruiser silhouette mesh
  const cruiserGeo = new BoxGeometry(14, 8, 90);
  const prowGeo = new ConeGeometry(8, 30, 4);
  prowGeo.rotateX(-Math.PI / 2);
  prowGeo.translate(0, 0, -55);

  const engGeo = new CylinderGeometry(3, 4, 8, 8);
  engGeo.rotateX(Math.PI / 2);
  engGeo.translate(0, 0, 48);

  // Scatter 6 friendly cruisers and 6 enemy cruisers in distant backdrop
  const friendlyCoords = [
    new Vector3(-180, 80, -450),
    new Vector3(-240, -60, -750),
    new Vector3(-120, 140, -1100),
    new Vector3(-300, 40, -1350),
    new Vector3(-160, -90, -1650),
    new Vector3(-220, 110, -1950),
  ];

  for (const pos of friendlyCoords) {
    const c = new Group();
    c.position.copy(pos);
    c.add(new Mesh(cruiserGeo, whiteMat));
    c.add(new Mesh(prowGeo, whiteMat));
    c.add(new Mesh(engGeo, cyanEngineMat));
    c.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), (Math.random() - 0.5) * 0.4);
    fleet.add(c);
  }

  const enemyCoords = [
    new Vector3(220, -70, -400),
    new Vector3(180, 120, -700),
    new Vector3(260, -40, -1050),
    new Vector3(140, 160, -1400),
    new Vector3(280, -80, -1700),
    new Vector3(190, 90, -2100),
  ];

  for (const pos of enemyCoords) {
    const c = new Group();
    c.position.copy(pos);
    c.add(new Mesh(cruiserGeo, obsidianMat));
    c.add(new Mesh(prowGeo, obsidianMat));
    c.add(new Mesh(engGeo, orangeEngineMat));
    c.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI + (Math.random() - 0.5) * 0.4);
    fleet.add(c);
  }

  return fleet;
}

// ============================================================================
// 7. Speed Streaks
// ============================================================================
function createSpeedStreaks(): { mesh: LineSegments; update(dt: number, speed: number): void } {
  const count = 120;
  const positions = new Float32Array(count * 6);
  const colors = new Float32Array(count * 6);

  const streakData: Array<{ x: number; y: number; z: number; len: number; spd: number }> = [];

  for (let i = 0; i < count; i += 1) {
    const x = (Math.random() - 0.5) * 70;
    const y = (Math.random() - 0.5) * 50;
    const z = -Math.random() * 120;
    const len = 4 + Math.random() * 8;
    const spd = 60 + Math.random() * 40;
    streakData.push({ x, y, z, len, spd });

    const isCyan = Math.random() < 0.7;
    const c = isCyan ? FRIENDLY_CYAN : NEBULA_GOLD;
    colors[i * 6] = c.r;
    colors[i * 6 + 1] = c.g;
    colors[i * 6 + 2] = c.b;
    colors[i * 6 + 3] = c.r * 0.2;
    colors[i * 6 + 4] = c.g * 0.2;
    colors[i * 6 + 5] = c.b * 0.2;
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));

  const mat = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.65,
    blending: AdditiveBlending,
    depthWrite: false,
  });

  const mesh = new LineSegments(geo, mat);
  mesh.frustumCulled = false;
  mesh.userData.raildIgnoreOcclusion = true;

  function update(dt: number, speed: number) {
    const posAttr = geo.attributes.position as Float32BufferAttribute;
    const arr = posAttr.array as Float32Array;

    for (let i = 0; i < count; i += 1) {
      const s = streakData[i];
      s.z += s.spd * speed * dt;
      if (s.z > 20) {
        s.z = -140;
        s.x = (Math.random() - 0.5) * 70;
        s.y = (Math.random() - 0.5) * 50;
      }
      const idx = i * 6;
      arr[idx] = s.x;
      arr[idx + 1] = s.y;
      arr[idx + 2] = s.z;

      arr[idx + 3] = s.x;
      arr[idx + 4] = s.y;
      arr[idx + 5] = s.z - s.len * speed;
    }
    posAttr.needsUpdate = true;
  }

  return { mesh, update };
}
