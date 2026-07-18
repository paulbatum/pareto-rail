import {
  AdditiveBlending, BackSide, BoxGeometry, BufferGeometry, CircleGeometry, Color, CylinderGeometry, Float32BufferAttribute,
  Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, Points, PointsMaterial, Scene, SphereGeometry, TorusGeometry, Vector3,
} from 'three';
import { sampleRailFrame } from '../../../engine/rail';
import { createBroadsideB6ejRail } from '../gameplay';
import { BROADSIDE_B6EJ_TIME } from '../timing';
import {
  CRIMSON, CYAN, ENEMY_HULL, ENEMY_PLATE, FRIENDLY_EDGE, FRIENDLY_HULL, GOLD,
  hdr, mulberry32, NEBULA_GOLD, NEBULA_MAGENTA, ORANGE, VOID, WHITE,
} from './palette';

type Gun = { muzzle: Mesh; flash: Mesh; beam: Mesh; phase: number };
type Engine = { mesh: Mesh; base: number; phase: number; color: Color };
type BreakPiece = { mesh: Mesh; origin: Vector3; phase: number };
type Crossfire = { mesh: Mesh; phase: number };
export type BroadsideEnvironment = { root: Group; guns: Gun[]; engines: Engine[]; breakPieces: BreakPiece[]; crossfire: Crossfire[]; flagship: Group };

function placeAlong(root: Group, u: number, offset: Vector3) {
  const curve = createBroadsideB6ejRail(); const frame = sampleRailFrame(curve, u);
  root.position.copy(frame.position).addScaledVector(frame.right, offset.x).addScaledVector(frame.up, offset.y).addScaledVector(frame.tangent, offset.z);
  root.lookAt(root.position.clone().add(frame.tangent));
}

function capitalShip(friendly: boolean, scale = 1) {
  const root = new Group(); const hullColor = friendly ? FRIENDLY_HULL : ENEMY_HULL; const panelColor = friendly ? FRIENDLY_EDGE : ENEMY_PLATE;
  const hull = new Mesh(new BoxGeometry(36, 12, 180), new MeshBasicMaterial({ color: hullColor })); hull.scale.set(scale, scale, scale); root.add(hull);
  const prow = new Mesh(new CylinderGeometry(1, 18, 62, 4), new MeshBasicMaterial({ color: hullColor })); prow.rotation.x = Math.PI / 2; prow.rotation.z = Math.PI / 4; prow.scale.set(scale, scale, scale); prow.position.z = -118 * scale; root.add(prow);
  const dorsal = new Mesh(new BoxGeometry(18, 12, 44), new MeshBasicMaterial({ color: panelColor })); dorsal.position.set(0, 10 * scale, -8 * scale); dorsal.scale.set(scale, scale, scale); root.add(dorsal);
  for (const side of [-1, 1]) {
    const flank = new Mesh(new BoxGeometry(3.2, 7, 142), new MeshBasicMaterial({ color: panelColor })); flank.position.set(side * 19.4 * scale, -1 * scale, 2); flank.scale.set(scale, scale, scale); root.add(flank);
    for (let i = -3; i <= 3; i += 1) {
      const strip = new Mesh(new BoxGeometry(0.28, 0.32, 14), new MeshBasicMaterial({ color: hdr(friendly ? CYAN : ORANGE, 0.72) }));
      strip.position.set(side * 21.1 * scale, (i % 2) * 2.4 * scale, i * 20 * scale); strip.scale.set(scale, scale, scale); root.add(strip);
    }
  }
  for (let i = -4; i <= 4; i += 1) {
    const spine = new Mesh(new BoxGeometry(0.38, 0.42, 14), new MeshBasicMaterial({ color: hdr(friendly ? FRIENDLY_EDGE : ORANGE, friendly ? 0.82 : 0.58) }));
    spine.position.set(0, 6.25 * scale, i * 18 * scale); spine.scale.set(scale, scale, scale); root.add(spine);
  }
  for (const x of [-10, 0, 10]) {
    const engine = new Mesh(new CircleGeometry(3.5 * scale, 16), new MeshBasicMaterial({ color: hdr(friendly ? CYAN : ORANGE, 1.75) }));
    engine.position.set(x * scale, 0, 91 * scale); engine.rotation.y = Math.PI; root.add(engine);
  }
  return root;
}

export function createBroadsideEnvironment(scene: Scene): BroadsideEnvironment {
  scene.background = VOID.clone(); const root = new Group(); root.userData.raildIgnoreOcclusion = true;
  const rng = mulberry32(0xb60ad51); const guns: Gun[] = []; const engines: Engine[] = []; const breakPieces: BreakPiece[] = []; const crossfire: Crossfire[] = [];

  // A layered, procedural magenta-and-gold sky dome keeps the battle backlit throughout the rail.
  const nebula = new Mesh(new SphereGeometry(4200, 32, 18), new MeshBasicMaterial({ color: 0x26082f, side: BackSide }));
  nebula.position.set(0, -400, -1250); root.add(nebula);
  const goldHeart = new Mesh(new SphereGeometry(360, 20, 14), new MeshBasicMaterial({ color: hdr(NEBULA_GOLD, 0.82) })); goldHeart.position.set(-1180, 520, -3560); root.add(goldHeart);
  const starPositions: number[] = [];
  for (let i = 0; i < 1100; i += 1) starPositions.push((rng() - 0.5) * 3800, (rng() - 0.5) * 2200, 200 - rng() * 3900);
  const starGeometry = new BufferGeometry(); starGeometry.setAttribute('position', new Float32BufferAttribute(starPositions, 3));
  root.add(new Points(starGeometry, new PointsMaterial({ color: WHITE, size: 1.2, sizeAttenuation: true })));
  const dustPositions: number[] = []; const dustColors: number[] = [];
  for (let i = 0; i < 720; i += 1) {
    const t = rng(); const band = Math.sin(t * Math.PI * 3) * 520;
    dustPositions.push((rng() - 0.5) * 3000, band + (rng() - 0.5) * 720, 100 - rng() * 3700);
    const color = (rng() > 0.72 ? NEBULA_GOLD : NEBULA_MAGENTA).clone().multiplyScalar(0.85 + rng() * 0.35);
    dustColors.push(color.r, color.g, color.b);
  }
  const dustGeometry = new BufferGeometry(); dustGeometry.setAttribute('position', new Float32BufferAttribute(dustPositions, 3)); dustGeometry.setAttribute('color', new Float32BufferAttribute(dustColors, 3));
  root.add(new Points(dustGeometry, new PointsMaterial({ vertexColors: true, size: 105, sizeAttenuation: true, transparent: true, opacity: 0.26, depthWrite: false, blending: AdditiveBlending })));

  // Launch deck below the opening camera.
  const deck = new Group(); placeAlong(deck, 0.018, new Vector3(0, -10, 0));
  const deckHull = new Mesh(new BoxGeometry(78, 5, 170), new MeshBasicMaterial({ color: FRIENDLY_HULL })); deck.add(deckHull);
  for (let i = -4; i <= 4; i += 1) {
    const guide = new Mesh(new BoxGeometry(0.6, 0.14, 18), new MeshBasicMaterial({ color: hdr(CYAN, 1.1) })); guide.position.set(i * 7.5, 2.6, i % 2 ? -24 : 18); deck.add(guide);
  }
  const catapult = new Mesh(new BoxGeometry(4, 0.22, 130), new MeshBasicMaterial({ color: hdr(FRIENDLY_EDGE, 1.15) })); catapult.position.y = 2.7; deck.add(catapult); root.add(deck);

  // Fleet silhouettes: deliberately irregular rather than a tidy formation.
  const fleet: Array<[number, Vector3, boolean, number, number]> = [
    [0.12, new Vector3(-90, 36, -15), true, 0.75, 0.12], [0.18, new Vector3(112, -20, 8), false, 0.92, -0.2],
    [0.25, new Vector3(-130, -34, -4), false, 0.62, 0.26], [0.34, new Vector3(-112, 26, 0), false, 0.72, -0.05],
    [0.43, new Vector3(-124, 42, 16), true, 0.8, 0.18], [0.51, new Vector3(10, 28, 5), false, 1.15, 0.06],
    [0.61, new Vector3(115, -45, -8), true, 0.72, -0.24], [0.69, new Vector3(-120, 20, 5), false, 0.88, 0.15],
    [0.75, new Vector3(145, 65, 4), true, 0.68, -0.08],
  ];
  for (const [u, offset, friendly, scale, yaw] of fleet) {
    const ship = capitalShip(friendly, scale); placeAlong(ship, u, offset); ship.rotateY(yaw); root.add(ship);
  }
  for (let i = 0; i < 18; i += 1) {
    const rig = new Group(); placeAlong(rig, 0.08 + i * 0.041, new Vector3((i % 2 ? -1 : 1) * (36 + rng() * 34), (rng() - 0.5) * 52, 0));
    const friendly = i % 3 !== 1; const beam = new Mesh(new CylinderGeometry(0.12, 0.26, 58 + rng() * 65, 6), new MeshBasicMaterial({ color: hdr(friendly ? CYAN : CRIMSON, 1.25) }));
    beam.rotation.z = Math.PI / 2; rig.add(beam); root.add(rig); crossfire.push({ mesh: beam, phase: i * 0.73 });
  }

  // Signature friendly flank: six batteries fire over the player, one per bar.
  const flank = capitalShip(true, 1.12); placeAlong(flank, 0.43, new Vector3(61, -9, 0)); root.add(flank);
  for (let i = 0; i < 6; i += 1) {
    const gunRoot = new Group(); gunRoot.position.set(-30, 8 + (i % 2) * 3, -86 + i * 31); flank.add(gunRoot);
    const muzzle = new Mesh(new CylinderGeometry(0.7, 1.05, 18, 9), new MeshBasicMaterial({ color: FRIENDLY_HULL })); muzzle.rotation.z = Math.PI / 2; gunRoot.add(muzzle);
    const flash = new Mesh(new IcosahedronGeometry(3.2, 1), new MeshBasicMaterial({ color: hdr(CYAN, 2) })); flash.position.x = -11; flash.visible = false; gunRoot.add(flash);
    const beam = new Mesh(new CylinderGeometry(0.45, 0.75, 175, 8), new MeshBasicMaterial({ color: hdr(CYAN, 1.65) })); beam.rotation.z = Math.PI / 2; beam.position.x = -98; beam.visible = false; gunRoot.add(beam);
    guns.push({ muzzle, flash, beam, phase: i });
  }

  // Flagship hull and trench occupy the far side of the engagement.
  const flagship = capitalShip(false, 2.1); placeAlong(flagship, 0.91, new Vector3(0, -20, 10)); root.add(flagship);
  const trench = new Mesh(new BoxGeometry(25, 9, 245), new MeshBasicMaterial({ color: 0x030207 })); trench.position.set(0, 17, -22); flagship.add(trench);
  for (const side of [-1, 1]) {
    const rail = new Mesh(new BoxGeometry(0.65, 0.5, 238), new MeshBasicMaterial({ color: hdr(ORANGE, 1.15) })); rail.position.set(side * 13.2, 21.8, -22); flagship.add(rail);
    const inner = new Mesh(new BoxGeometry(0.22, 0.25, 238), new MeshBasicMaterial({ color: hdr(CRIMSON, 1.25) })); inner.position.set(side * 7.2, 21.9, -22); flagship.add(inner);
  }
  for (let i = -5; i <= 5; i += 1) {
    const rib = new Mesh(new BoxGeometry(30, 1.3, 2.4), new MeshBasicMaterial({ color: ENEMY_PLATE })); rib.position.set(0, 21, i * 20); flagship.add(rib);
    const vent = new Mesh(new BoxGeometry(6, 0.5, 1.1), new MeshBasicMaterial({ color: hdr(ORANGE, 0.7) })); vent.position.set(i % 2 ? -8 : 8, 21.8, i * 20); flagship.add(vent);
  }
  for (let i = 0; i < 18; i += 1) {
    const panel = new Mesh(new BoxGeometry(8 + rng() * 14, 2 + rng() * 5, 10 + rng() * 24), new MeshBasicMaterial({ color: i % 3 ? ENEMY_HULL : ENEMY_PLATE }));
    panel.position.set((rng() - 0.5) * 68, (rng() - 0.5) * 22, (rng() - 0.5) * 330); flagship.add(panel);
    breakPieces.push({ mesh: panel, origin: panel.position.clone(), phase: rng() * 10 });
  }
  // Engine glows are animated without relying on bloom for base readability.
  root.traverse((child) => {
    if (!(child instanceof Mesh) || !(child.material instanceof MeshBasicMaterial)) return;
    const color = child.material.color;
    if (color.r > 0.4 && (color.b > 0.5 || color.g < 0.55)) engines.push({ mesh: child, base: 1, phase: rng() * 8, color: color.clone() });
  });
  scene.add(root); return { root, guns, engines, breakPieces, crossfire, flagship };
}

export function updateBroadsideEnvironment(environment: BroadsideEnvironment, runTime: number, elapsed: number, running: boolean) {
  for (const engine of environment.engines) engine.mesh.material instanceof MeshBasicMaterial && engine.mesh.material.color.copy(engine.color).multiplyScalar(0.82 + Math.sin(elapsed * 6 + engine.phase) * 0.16);
  for (const beam of environment.crossfire) beam.mesh.visible = Math.sin(elapsed * 5.2 + beam.phase) > 0.25;
  const broadsideTime = BROADSIDE_B6EJ_TIME.bar(10);
  for (const gun of environment.guns) {
    const shotTime = broadsideTime + gun.phase * BROADSIDE_B6EJ_TIME.bar(1);
    const age = runTime - shotTime; const active = running && age >= 0 && age < 0.34;
    gun.flash.visible = active; gun.beam.visible = active && age < 0.16;
    if (active) gun.flash.scale.setScalar(Math.max(0.1, 1.7 - age * 4.5));
  }
  const breaking = Math.max(0, runTime - BROADSIDE_B6EJ_TIME.bar(35));
  for (const piece of environment.breakPieces) {
    if (!breaking) { piece.mesh.position.copy(piece.origin); continue; }
    piece.mesh.position.copy(piece.origin).add(new Vector3(Math.sin(piece.phase) * breaking * 8, Math.cos(piece.phase * 1.7) * breaking * 6, Math.sin(piece.phase * 0.7) * breaking * 5));
    piece.mesh.rotation.x += 0.012; piece.mesh.rotation.z += 0.018;
  }
  environment.flagship.rotation.z = breaking ? Math.min(0.18, breaking * 0.08) : 0;
}
