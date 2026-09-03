import {
  BoxGeometry,
  Color,
  Group,
  LineBasicMaterial,
  LineSegments,
  EdgesGeometry,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { CRIMSON, CYAN_GLOW, hdr, ICE, MOLTEN, OBSIDIAN } from './palette';

export type CapitalShip = {
  group: Group;
  engines: Mesh[];
  engineBase: Color[];
  gunPorts: Vector3[];
  hullLength: number;
};

function edgeLines(geometry: THREE.BufferGeometry, color: Color): LineSegments {
  return new LineSegments(new EdgesGeometry(geometry), new LineBasicMaterial({ color }));
}

// Import type only.
import type * as THREE from 'three';

function engineGlow(color: Color, size: number, intensity: number): Mesh {
  const mesh = new Mesh(
    new SphereGeometry(size, 10, 8),
    createAdditiveBasicMaterial({ color: hdr(color, intensity) }),
  );
  mesh.scale.z = 0.4;
  mesh.userData.raildIgnoreOcclusion = true;
  return mesh;
}

// Friendly cruiser: ice-white slab hull, stepped superstructure, cyan
// engines and a cyan running-light strip. Reads as a pale silhouette.
export function createFriendlyCruiser(length: number, seed: number): CapitalShip {
  const group = new Group();
  const engines: Mesh[] = [];
  const engineBase: Color[] = [];
  const gunPorts: Vector3[] = [];

  const hullGeo = new BoxGeometry(11, 6.5, length);
  const hull = new Mesh(hullGeo, new MeshBasicMaterial({ color: ICE.clone().multiplyScalar(0.3) }));
  const hullEdges = edgeLines(hullGeo, hdr(CYAN_GLOW, 0.5));
  group.add(hull, hullEdges);

  const deckGeo = new BoxGeometry(6, 2.6, length * 0.45);
  const deck = new Mesh(deckGeo, new MeshBasicMaterial({ color: ICE.clone().multiplyScalar(0.22) }));
  deck.position.set(0, 4.4, length * 0.08);
  const deckEdges = edgeLines(deckGeo, hdr(CYAN_GLOW, 0.4));
  deck.add(deckEdges);
  group.add(deck);

  const bridgeGeo = new BoxGeometry(3.2, 2.2, 6);
  const bridge = new Mesh(bridgeGeo, new MeshBasicMaterial({ color: ICE.clone().multiplyScalar(0.26) }));
  bridge.position.set(0, 6.6, length * 0.22);
  group.add(bridge);

  // Cyan running-light strip along the flank facing the battle.
  const strip = new Mesh(
    new BoxGeometry(0.3, 0.35, length * 0.7),
    createAdditiveBasicMaterial({ color: hdr(CYAN_GLOW, 1.2) }),
  );
  strip.position.set(-5.6, 0.5, 0);
  group.add(strip);

  // Engine block: three cyan drives.
  for (let i = -1; i <= 1; i += 1) {
    const engine = engineGlow(CYAN_GLOW, 1.5, 1.6);
    engine.position.set(i * 3.1, 0, length / 2 + 0.6);
    engines.push(engine);
    engineBase.push((engine.material as MeshBasicMaterial).color.clone());
    group.add(engine);
  }

  // Broadside turrets along the flank: small teeth that light off overhead.
  const turretCount = Math.floor(length / 14);
  for (let i = 0; i < turretCount; i += 1) {
    const z = -length / 2 + 8 + (i / Math.max(1, turretCount - 1)) * (length - 16);
    const turret = new Mesh(
      new BoxGeometry(1.4, 1.0, 2.2),
      new MeshBasicMaterial({ color: ICE.clone().multiplyScalar(0.24) }),
    );
    turret.position.set(-6, 1.4 + (seed % 3) * 0.3, z);
    group.add(turret);
    gunPorts.push(new Vector3(-6.8, 1.8, z));
  }

  return { group, engines, engineBase, gunPorts, hullLength: length };
}

// Enemy warship: obsidian dagger hull, molten view-slits, crimson drives.
export function createEnemyWarship(length: number, seed: number): CapitalShip {
  const group = new Group();
  const engines: Mesh[] = [];
  const engineBase: Color[] = [];
  const gunPorts: Vector3[] = [];

  const hullGeo = new BoxGeometry(13, 7, length);
  const hull = new Mesh(hullGeo, new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.35) }));
  const hullEdges = edgeLines(hullGeo, hdr(MOLTEN, 0.55));
  group.add(hull, hullEdges);

  // Forward dagger prow.
  const prowGeo = new OctahedronGeometry(6, 0);
  const prow = new Mesh(prowGeo, new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.35) }));
  prow.scale.set(1.1, 0.55, 2.6);
  prow.position.z = -length / 2 - 12;
  group.add(prow);

  // Molten slits: thin hot gashes along the hull.
  for (let i = 0; i < 5; i += 1) {
    const slit = new Mesh(
      new BoxGeometry(0.25, 0.5, 7 + (seed % 4)),
      createAdditiveBasicMaterial({ color: hdr(MOLTEN, 1.5) }),
    );
    slit.position.set(6.6, -1 + i * 1.1, -length * 0.2 + i * 6);
    group.add(slit);
  }

  // Dorsal spires.
  for (let i = 0; i < 3; i += 1) {
    const spireGeo = new BoxGeometry(1.2, 6 + i * 2, 1.2);
    const spire = new Mesh(spireGeo, new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.4) }));
    spire.position.set(2 - i * 2, 6 + i, length * 0.15 - i * 10);
    group.add(spire);
    const tip = engineGlow(CRIMSON, 0.5, 1.6);
    tip.position.set(2 - i * 2, 9.4 + i, length * 0.15 - i * 10);
    group.add(tip);
  }

  for (let i = -1; i <= 1; i += 1) {
    const engine = engineGlow(CRIMSON, 1.8, 1.7);
    engine.position.set(i * 3.6, 0, length / 2 + 0.8);
    engines.push(engine);
    engineBase.push((engine.material as MeshBasicMaterial).color.clone());
    group.add(engine);
  }

  const turretCount = Math.floor(length / 12);
  for (let i = 0; i < turretCount; i += 1) {
    const z = -length / 2 + 7 + (i / Math.max(1, turretCount - 1)) * (length - 14);
    const turret = new Mesh(
      new OctahedronGeometry(1.0, 0),
      new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.5) }),
    );
    turret.position.set(6.8, -0.6, z);
    turret.scale.z = 1.8;
    group.add(turret);
    gunPorts.push(new Vector3(7.6, -0.4, z));
  }

  return { group, engines, engineBase, gunPorts, hullLength: length };
}

// Enemy flagship: a vast obsidian wall with a glowing trench along its
// belly — the dive target for the finale.
export function createEnemyFlagship(): CapitalShip {
  const group = new Group();
  const engines: Mesh[] = [];
  const engineBase: Color[] = [];
  const gunPorts: Vector3[] = [];
  const length = 260;

  const hullGeo = new BoxGeometry(34, 18, length);
  const hull = new Mesh(hullGeo, new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.3) }));
  const hullEdges = edgeLines(hullGeo, hdr(MOLTEN, 0.4));
  group.add(hull, hullEdges);

  // Trench: a dark inset channel along the belly with molten conduit light.
  const trenchGeo = new BoxGeometry(10, 2.2, length * 0.8);
  const trench = new Mesh(trenchGeo, new MeshBasicMaterial({ color: new Color(0.008, 0.006, 0.012) }));
  trench.position.set(0, -9.4, -6);
  group.add(trench);
  const conduit = new Mesh(
    new BoxGeometry(1.2, 0.5, length * 0.78),
    createAdditiveBasicMaterial({ color: hdr(MOLTEN, 1.7) }),
  );
  conduit.position.set(0, -8.6, -6);
  group.add(conduit);
  group.userData.conduit = conduit;

  // Command crown: clustered spires with crimson beacons.
  for (let i = 0; i < 5; i += 1) {
    const height = 12 + (i % 3) * 5;
    const spireGeo = new BoxGeometry(2.2, height, 2.2);
    const spire = new Mesh(spireGeo, new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.4) }));
    spire.position.set(-10 + i * 5, 9 + height / 2, length * 0.3);
    group.add(spire);
    const beacon = engineGlow(CRIMSON, 0.8, 2.0);
    beacon.position.set(-10 + i * 5, 9 + height + 0.6, length * 0.3);
    group.add(beacon);
  }

  for (let i = -2; i <= 2; i += 1) {
    const engine = engineGlow(CRIMSON, 2.6, 1.8);
    engine.position.set(i * 5.4, 0, length / 2 + 1);
    engines.push(engine);
    engineBase.push((engine.material as MeshBasicMaterial).color.clone());
    group.add(engine);
  }

  for (let i = 0; i < 16; i += 1) {
    const z = -length / 2 + 12 + (i / 15) * (length - 24);
    gunPorts.push(new Vector3(i % 2 === 0 ? -17.6 : 17.6, -3, z));
  }

  return { group, engines, engineBase, gunPorts, hullLength: length };
}
