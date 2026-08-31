import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  FogExp2,
  Group,
  IcosahedronGeometry,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
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
import type { Camera, CatmullRomCurve3, Object3D } from 'three';
import { offsetFromRail, sampleRailFrame } from '../../../engine/rail';
import { disposeObject3D } from '../../../engine/visual-kit';
import { broadside806fRunProgress } from '../gameplay';
import { BROADSIDE_806F_MARKERS, BROADSIDE_806F_RUN_DURATION, BROADSIDE_806F_TIME } from '../timing';
import {
  CRIMSON,
  CYAN,
  ENEMY_EDGE,
  ENEMY_HULL,
  FRIENDLY_HULL,
  FRIENDLY_SHADOW,
  ICE,
  MOLTEN,
  NEBULA_DEEP,
  NEBULA_GOLD,
  NEBULA_MAGENTA,
  SHIELD,
  STAR_WHITE,
  VOID,
  hdr,
} from './palette';

type Faction = 'friendly' | 'enemy';

type CapitalShip = {
  root: Group;
  basePosition: Vector3;
  engines: MeshBasicMaterial[];
  signal: MeshBasicMaterial[];
  segments: Group[];
  phase: number;
  faction: Faction;
};

type BattleBeam = {
  line: Line;
  material: LineBasicMaterial;
  flash: Mesh;
  flashMaterial: MeshBasicMaterial;
  fireAt: number;
  duration: number;
  strength: number;
};

// Capital ships contain hundreds of panels, but those panels only need a
// handful of silhouettes. Reusing unit geometries and shaping them with mesh
// scale keeps the renderer's geometry registry flat as new ships enter view.
const CAPITAL_BOX = new BoxGeometry(1, 1, 1);
const CAPITAL_PROW = new ConeGeometry(1, 1, 6);
const CAPITAL_ENGINE = new CircleGeometry(1, 18);
const CAPITAL_PLUME = new ConeGeometry(1, 1, 10, 1, true);
const CAPITAL_BATTERY = new CylinderGeometry(0.625, 1, 1, 6);
const CAPITAL_SIGNAL = new SphereGeometry(1, 7, 5);
const DEBRIS_SHARD = new BoxGeometry(1, 1, 1);

function seeded(index: number, salt = 0) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function ignoreOcclusion(root: Object3D) {
  root.userData.raildIgnoreOcclusion = true;
  root.traverse((child) => { child.raycast = () => {}; });
  return root;
}

function basic(color: Color, intensity = 1) {
  return new MeshBasicMaterial({ color: hdr(color, intensity) });
}

function glow(color: Color, intensity = 1, opacity = 0.85) {
  return new MeshBasicMaterial({
    color: hdr(color, intensity),
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

function createSky(camera: Camera) {
  const root = new Group();
  root.renderOrder = -1000;

  const base = new Mesh(
    new PlaneGeometry(2300, 1450),
    new MeshBasicMaterial({ color: hdr(NEBULA_DEEP, 0.75), depthTest: false, depthWrite: false }),
  );
  base.position.z = -940;
  base.renderOrder = -1000;
  root.add(base);

  const cloudGeometry = new CircleGeometry(1, 30);
  for (let index = 0; index < 34; index += 1) {
    const gold = index % 4 === 0 || index % 11 === 0;
    const material = glow(gold ? NEBULA_GOLD : NEBULA_MAGENTA, gold ? 0.82 : 0.72, gold ? 0.075 : 0.09);
    material.depthTest = false;
    const cloud = new Mesh(cloudGeometry, material);
    const angle = seeded(index, 1) * Math.PI * 2;
    const radius = 80 + seeded(index, 2) * 650;
    cloud.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.58, -920 + seeded(index, 3) * 18);
    const size = 130 + seeded(index, 4) * 360;
    cloud.scale.set(size * (0.65 + seeded(index, 5)), size * (0.32 + seeded(index, 6) * 0.55), 1);
    cloud.rotation.z = seeded(index, 7) * Math.PI;
    cloud.renderOrder = -990 + index;
    root.add(cloud);
  }

  for (let index = 0; index < 5; index += 1) {
    const arc = new Mesh(
      new TorusGeometry(250 + index * 75, 1.2 + index * 0.25, 5, 96, Math.PI * (0.55 + index * 0.08)),
      glow(index % 2 ? NEBULA_GOLD : NEBULA_MAGENTA, 1.1, 0.14),
    );
    arc.position.set(-370 + index * 190, 100 - index * 78, -895 + index * 2);
    arc.rotation.z = -0.7 + index * 0.38;
    arc.renderOrder = -900 + index;
    root.add(arc);
  }

  const starCount = 1800;
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);
  for (let index = 0; index < starCount; index += 1) {
    const depth = -70 - seeded(index, 8) * 800;
    positions.set([
      (seeded(index, 9) - 0.5) * 1250,
      (seeded(index, 10) - 0.5) * 720,
      depth,
    ], index * 3);
    const color = index % 19 === 0 ? NEBULA_GOLD : index % 11 === 0 ? CYAN : STAR_WHITE;
    const intensity = index % 37 === 0 ? 2.1 : 0.65 + seeded(index, 12) * 0.55;
    colors.set([color.r * intensity, color.g * intensity, color.b * intensity], index * 3);
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  starGeometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  const stars = new Points(starGeometry, new PointsMaterial({
    size: 0.85,
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  }));
  stars.renderOrder = -800;
  root.add(stars);
  root.position.copy(camera.position);
  root.quaternion.copy(camera.quaternion);
  return { root, stars };
}

function addPanel(group: Group, geometry: BufferGeometry, material: MeshBasicMaterial | MeshStandardMaterial, position: Vector3, rotation = new Vector3()) {
  const mesh = new Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.rotation.set(rotation.x, rotation.y, rotation.z);
  group.add(mesh);
  return mesh;
}

function addScaledPanel(
  group: Group,
  geometry: BufferGeometry,
  material: MeshBasicMaterial | MeshStandardMaterial,
  position: Vector3,
  scale: Vector3,
  rotation = new Vector3(),
) {
  const mesh = addPanel(group, geometry, material, position, rotation);
  mesh.scale.copy(scale);
  return mesh;
}

function createCapitalShip(faction: Faction, length: number, width: number, phase: number, flagship = false): CapitalShip {
  const root = new Group();
  const hullColor = faction === 'friendly' ? FRIENDLY_HULL : ENEMY_HULL;
  const shadowColor = faction === 'friendly' ? FRIENDLY_SHADOW : ENEMY_EDGE;
  const lightColor = faction === 'friendly' ? CYAN : MOLTEN;
  const fireColor = faction === 'friendly' ? ICE : CRIMSON;
  const hull = new MeshStandardMaterial({ color: hdr(hullColor, faction === 'friendly' ? 0.68 : 0.52), roughness: 0.72, metalness: 0.35 });
  const shadow = new MeshStandardMaterial({ color: hdr(shadowColor, 0.72), roughness: 0.82, metalness: 0.42 });
  const seam = glow(lightColor, faction === 'friendly' ? 1.3 : 1.5, 0.86);
  const signalMaterial = glow(fireColor, 1.6, 0.82);
  const engines: MeshBasicMaterial[] = [];
  const signal: MeshBasicMaterial[] = [signalMaterial];
  const segments: Group[] = [];
  const segmentCount = flagship ? 9 : 5;
  const segmentLength = length / segmentCount;

  for (let index = 0; index < segmentCount; index += 1) {
    const segment = new Group();
    const taper = 0.62 + Math.sin((index + 0.5) / segmentCount * Math.PI) * 0.42;
    const sectionWidth = width * taper;
    const body = addScaledPanel(
      segment,
      CAPITAL_BOX,
      index % 2 ? hull : shadow,
      new Vector3(0, 0, 0),
      new Vector3(sectionWidth, width * (flagship ? 0.28 : 0.22), segmentLength * 0.94),
    );
    body.rotation.z = (index % 2 ? 1 : -1) * 0.018;
    const dorsal = addScaledPanel(
      segment,
      CAPITAL_BOX,
      hull,
      new Vector3(0, width * 0.2, -segmentLength * 0.05),
      new Vector3(sectionWidth * 0.48, width * 0.2, segmentLength * 0.62),
    );
    dorsal.rotation.z = (index % 3 - 1) * 0.025;
    for (const side of [-1, 1]) {
      const armor = addScaledPanel(
        segment,
        CAPITAL_BOX,
        shadow,
        new Vector3(side * sectionWidth * 0.52, -width * 0.02, 0),
        new Vector3(sectionWidth * 0.17, width * 0.11, segmentLength * 0.8),
        new Vector3(0, 0, side * 0.12),
      );
      armor.scale.y *= 0.7 + (index % 2) * 0.25;
      const strip = addScaledPanel(
        segment,
        CAPITAL_BOX,
        seam,
        new Vector3(side * sectionWidth * 0.58, width * 0.08, 0),
        new Vector3(0.12, 0.1, segmentLength * 0.72),
      );
      strip.renderOrder = 2;
    }
    segment.position.z = (index - (segmentCount - 1) / 2) * segmentLength;
    root.add(segment);
    segments.push(segment);
  }

  addScaledPanel(
    root,
    CAPITAL_PROW,
    hull,
    new Vector3(0, 0, -length * 0.56),
    new Vector3(width * 0.48, length * 0.16 * 0.7, width * 0.48),
    new Vector3(-Math.PI / 2, 0, 0),
  );
  addScaledPanel(root, CAPITAL_BOX, shadow, new Vector3(0, width * 0.31, -length * 0.16), new Vector3(width * 0.27, width * 0.24, length * 0.08));
  const bridgeLight = addScaledPanel(root, CAPITAL_BOX, signalMaterial, new Vector3(0, width * 0.45, -length * 0.19), new Vector3(width * 0.19, 0.16, length * 0.05));
  bridgeLight.renderOrder = 3;

  const engineCount = flagship ? 7 : 4;
  for (let index = 0; index < engineCount; index += 1) {
    const x = (index - (engineCount - 1) / 2) * width * 0.19;
    const engineMaterial = glow(faction === 'friendly' ? CYAN : MOLTEN, 1.9, 0.92);
    engines.push(engineMaterial);
    const engineRadius = width * (flagship ? 0.055 : 0.07);
    const engine = addScaledPanel(root, CAPITAL_ENGINE, engineMaterial, new Vector3(x, 0, length * 0.53), new Vector3(engineRadius, engineRadius, 1));
    engine.rotation.y = Math.PI;
    addScaledPanel(
      root,
      CAPITAL_PLUME,
      engineMaterial,
      new Vector3(x, 0, length * 0.59),
      new Vector3(width * 0.05, length * 0.12, width * 0.025),
      new Vector3(Math.PI / 2, 0, 0),
    );
  }

  const batteryCount = flagship ? 14 : 7;
  for (let index = 0; index < batteryCount; index += 1) {
    const side = index % 2 ? 1 : -1;
    const z = -length * 0.39 + index / Math.max(1, batteryCount - 1) * length * 0.78;
    const base = addScaledPanel(root, CAPITAL_BATTERY, shadow, new Vector3(side * width * 0.45, width * 0.18, z), new Vector3(width * 0.04, width * 0.05, width * 0.04));
    base.rotation.x = Math.PI / 2;
    const barrel = addScaledPanel(root, CAPITAL_BOX, shadow, new Vector3(side * width * 0.53, width * 0.21, z - width * 0.04), new Vector3(width * 0.018, width * 0.018, width * 0.2));
    barrel.rotation.y = side * 0.42;
    addScaledPanel(root, CAPITAL_SIGNAL, signalMaterial, new Vector3(side * width * 0.59, width * 0.21, z - width * 0.09), new Vector3(width * 0.017, width * 0.017, width * 0.017));
  }

  if (flagship) {
    // A recessed incandescent trench gives the second pass an unmistakable
    // destination even with bloom fully disabled.
    const trench = addScaledPanel(root, CAPITAL_BOX, basic(ENEMY_HULL, 0.22), new Vector3(0, -width * 0.17, -length * 0.02), new Vector3(width * 0.28, width * 0.025, length * 0.76));
    trench.position.y -= width * 0.12;
    for (let index = 0; index < 34; index += 1) {
      const z = -length * 0.37 + index / 33 * length * 0.74;
      const rib = addScaledPanel(root, CAPITAL_BOX, index % 5 === 0 ? signalMaterial : seam, new Vector3(0, -width * 0.31, z), new Vector3(width * 0.31, width * 0.035, width * 0.035));
      rib.rotation.z = (index % 2 ? 1 : -1) * 0.06;
    }
  }

  ignoreOcclusion(root);
  return { root, basePosition: new Vector3(), engines, signal, segments, phase, faction };
}

function placeShip(ship: CapitalShip, rail: CatmullRomCurve3, u: number, x: number, y: number, roll: number) {
  const frame = sampleRailFrame(rail, Math.max(0, Math.min(1, u)));
  const basis = new Matrix4().makeBasis(frame.right, frame.up, frame.tangent);
  ship.root.quaternion.copy(new Quaternion().setFromRotationMatrix(basis));
  ship.root.rotateZ(roll);
  ship.root.position.copy(offsetFromRail(rail, u, new Vector3(x, y, 0)));
  ship.basePosition.copy(ship.root.position);
  return ship;
}

function createBeam(start: Vector3, end: Vector3, color: Color, fireAt: number, duration: number, strength: number): BattleBeam {
  const geometry = new BufferGeometry().setFromPoints([start, end]);
  const material = new LineBasicMaterial({
    color: hdr(color, 1.6),
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const line = new Line(geometry, material);
  line.frustumCulled = false;
  line.raycast = () => {};
  const flashMaterial = glow(color, 2.4, 0);
  const flash = new Mesh(new SphereGeometry(2.8 + strength * 2.2, 10, 7), flashMaterial);
  flash.position.copy(start);
  flash.raycast = () => {};
  return { line, material, flash, flashMaterial, fireAt, duration, strength };
}

function buildBattleBeams(root: Group, rail: CatmullRomCurve3) {
  const beams: BattleBeam[] = [];
  const add = (start: Vector3, end: Vector3, color: Color, fireAt: number, duration = 0.42, strength = 1) => {
    const beam = createBeam(start, end, color, fireAt, duration, strength);
    beams.push(beam);
    root.add(beam.line, beam.flash);
  };

  // Friendly cruiser broadside: eight barrels light in a rising cascade and
  // draw long cyan lances over the player's canopy.
  for (let index = 0; index < 8; index += 1) {
    const time = BROADSIDE_806F_MARKERS.broadside + 2.0 + index * BROADSIDE_806F_TIME.beatSeconds * 0.5;
    const u = broadside806fRunProgress(time, BROADSIDE_806F_RUN_DURATION);
    const start = offsetFromRail(rail, u, new Vector3(-46, 20 + (index % 3) * 5, -8 + index * 2));
    const end = offsetFromRail(rail, Math.min(0.98, u + 0.12), new Vector3(210, 72 - index * 6, -60));
    add(start, end, CYAN, time, 0.58, 1.6);
  }

  // Unordered ship-to-ship fire makes the scale readable well before the
  // signature broadside. Cyan and crimson always preserve faction identity.
  for (let index = 0; index < 28; index += 1) {
    const friendly = index % 2 === 0;
    const time = 5.5 + seeded(index, 18) * 46;
    const u = broadside806fRunProgress(time, BROADSIDE_806F_RUN_DURATION);
    const start = offsetFromRail(rail, Math.max(0.02, u - 0.035), new Vector3(friendly ? -120 : 115, -35 + seeded(index, 19) * 100, -40));
    const end = offsetFromRail(rail, Math.min(0.98, u + 0.1), new Vector3(friendly ? 165 : -170, -50 + seeded(index, 20) * 130, -60));
    add(start, end, friendly ? CYAN : CRIMSON, time, 0.24 + seeded(index, 21) * 0.38, 0.55 + seeded(index, 22) * 0.7);
  }
  return beams;
}

function createDebrisField(rail: CatmullRomCurve3) {
  const root = new Group();
  const hullMaterial = basic(ENEMY_EDGE, 0.72);
  const edgeMaterial = glow(MOLTEN, 0.9, 0.36);
  for (let index = 0; index < 90; index += 1) {
    const u = 0.08 + seeded(index, 31) * 0.82;
    const x = (seeded(index, 32) - 0.5) * 280;
    const y = (seeded(index, 33) - 0.5) * 170;
    const group = new Group();
    const shard = new Mesh(DEBRIS_SHARD, index % 7 === 0 ? edgeMaterial : hullMaterial);
    shard.scale.set(1 + seeded(index, 34) * 5, 0.4 + seeded(index, 35) * 2.5, 2 + seeded(index, 36) * 9);
    shard.rotation.set(seeded(index, 37) * Math.PI, seeded(index, 38) * Math.PI, seeded(index, 39) * Math.PI);
    group.add(shard);
    group.position.copy(offsetFromRail(rail, u, new Vector3(x, y, (seeded(index, 40) - 0.5) * 80)));
    group.userData.spin = new Vector3((seeded(index, 41) - 0.5) * 0.25, (seeded(index, 42) - 0.5) * 0.3, (seeded(index, 43) - 0.5) * 0.2);
    root.add(group);
  }
  ignoreOcclusion(root);
  return root;
}

export function createFleetEnvironment(scene: Scene, rail: CatmullRomCurve3) {
  const root = new Group();
  const battleRoot = new Group();
  root.add(battleRoot);
  scene.add(root);
  scene.background = VOID.clone();
  scene.fog = new FogExp2(0x100619, 0.00052);

  const ambient = new AmbientLight(0x706082, 1.45);
  const goldLight = new DirectionalLight(0xffaa55, 2.15);
  goldLight.position.set(-320, 240, 120);
  const cyanLight = new DirectionalLight(0x7cefff, 1.05);
  cyanLight.position.set(260, -80, -240);
  root.add(ambient, goldLight, cyanLight);

  const sky = createSky({ position: new Vector3(), quaternion: new Quaternion() } as Camera);
  root.add(sky.root);

  const ships: CapitalShip[] = [];
  const addShip = (ship: CapitalShip) => { ships.push(ship); battleRoot.add(ship.root); return ship; };
  const launchU = broadside806fRunProgress(BROADSIDE_806F_TIME.bar(0.8), BROADSIDE_806F_RUN_DURATION);
  addShip(placeShip(createCapitalShip('friendly', 310, 62, 0.2), rail, launchU, 0, -22, 0.01));

  addShip(placeShip(createCapitalShip('friendly', 410, 68, 1.2), rail, broadside806fRunProgress(BROADSIDE_806F_TIME.bar(5)), -145, 38, -0.28));
  addShip(placeShip(createCapitalShip('enemy', 360, 58, 2.1), rail, broadside806fRunProgress(BROADSIDE_806F_TIME.bar(6.2)), 132, 70, 0.42));
  addShip(placeShip(createCapitalShip('friendly', 560, 82, 3.0), rail, broadside806fRunProgress(BROADSIDE_806F_TIME.bar(10.5)), -58, 20, -0.05));
  addShip(placeShip(createCapitalShip('enemy', 470, 74, 4.1), rail, broadside806fRunProgress(BROADSIDE_806F_TIME.bar(15.0)), 6, 44, Math.PI * 0.94));
  addShip(placeShip(createCapitalShip('friendly', 380, 63, 5.0), rail, broadside806fRunProgress(BROADSIDE_806F_TIME.bar(17)), 150, -42, 0.5));
  addShip(placeShip(createCapitalShip('enemy', 420, 66, 5.7), rail, broadside806fRunProgress(BROADSIDE_806F_TIME.bar(18.5)), -175, 58, -0.34));
  addShip(placeShip(createCapitalShip('friendly', 520, 75, 6.4), rail, broadside806fRunProgress(BROADSIDE_806F_TIME.bar(22)), -188, -40, 0.22));

  const flagship = addShip(placeShip(
    createCapitalShip('enemy', 940, 116, 7.6, true),
    rail,
    broadside806fRunProgress(BROADSIDE_806F_TIME.bar(25.8), BROADSIDE_806F_RUN_DURATION),
    34,
    22,
    Math.PI * 0.04,
  ));

  const shieldMaterial = new MeshBasicMaterial({
    color: hdr(SHIELD, 1.28),
    transparent: true,
    opacity: 0.12,
    wireframe: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const shield = new Mesh(new SphereGeometry(1, 28, 16), shieldMaterial);
  shield.scale.set(92, 57, 510);
  shield.position.copy(flagship.root.position);
  shield.quaternion.copy(flagship.root.quaternion);
  shield.raycast = () => {};
  battleRoot.add(shield);

  const debris = createDebrisField(rail);
  battleRoot.add(debris);
  const beams = buildBattleBeams(battleRoot, rail);

  const victoryFires: Array<{ mesh: Mesh; material: MeshBasicMaterial; phase: number }> = [];
  for (let index = 0; index < 18; index += 1) {
    const material = glow(index % 3 === 0 ? CRIMSON : MOLTEN, 1.9, 0);
    const fire = new Mesh(index % 2 ? new IcosahedronGeometry(5 + index % 5, 1) : new SphereGeometry(4 + index % 4, 8, 6), material);
    fire.position.copy(flagship.root.position).add(new Vector3((seeded(index, 51) - 0.5) * 92, (seeded(index, 52) - 0.5) * 58, (seeded(index, 53) - 0.5) * 620).applyQuaternion(flagship.root.quaternion));
    fire.raycast = () => {};
    battleRoot.add(fire);
    victoryFires.push({ mesh: fire, material, phase: seeded(index, 54) * Math.PI * 2 });
  }

  let shieldDown = false;
  let flagshipDestroyed = false;
  let destroyAge = 0;
  let impactEnergy = 0;
  let damageFlash = 0;

  return {
    root,
    shield,
    flagship,
    resetRun() {
      shieldDown = false;
      flagshipDestroyed = false;
      destroyAge = 0;
      impactEnergy = 0;
      damageFlash = 0;
      shield.visible = true;
      shieldMaterial.opacity = 0.12;
      flagship.segments.forEach((segment) => {
        segment.position.x = 0;
        segment.position.y = 0;
        segment.rotation.set(0, 0, 0);
        segment.visible = true;
      });
      victoryFires.forEach(({ material }) => { material.opacity = 0; });
    },
    setShieldDown() {
      shieldDown = true;
      impactEnergy = Math.max(impactEnergy, 1.2);
    },
    setFlagshipDestroyed() {
      if (!flagshipDestroyed) destroyAge = 0;
      flagshipDestroyed = true;
      impactEnergy = Math.max(impactEnergy, 1.6);
    },
    impact(amount = 0.5) { impactEnergy = Math.max(impactEnergy, amount); },
    playerDamage() { damageFlash = 1; },
    update(dt: number, context: { camera: Camera; runTime: number; runProgress: number; running: boolean; beatEnergy: number }) {
      sky.root.position.copy(context.camera.position);
      sky.root.quaternion.copy(context.camera.quaternion);
      sky.stars.rotation.z += dt * 0.002;
      impactEnergy *= Math.exp(-dt * 4.2);
      damageFlash *= Math.exp(-dt * 5.5);

      for (const ship of ships) {
        const drift = Math.sin(context.runTime * 0.06 + ship.phase) * 1.8;
        ship.root.position.copy(ship.basePosition).add(new Vector3(0, drift, 0));
        for (const material of ship.engines) material.opacity = 0.72 + context.beatEnergy * 0.18 + Math.sin(context.runTime * 4 + ship.phase) * 0.08;
        for (const material of ship.signal) material.opacity = 0.54 + context.beatEnergy * 0.24;
      }

      for (const child of debris.children) {
        const spin = child.userData.spin as Vector3;
        child.rotation.x += spin.x * dt;
        child.rotation.y += spin.y * dt;
        child.rotation.z += spin.z * dt;
      }

      for (const beam of beams) {
        const age = context.runTime - beam.fireAt;
        const active = context.running && age >= 0 && age <= beam.duration;
        const envelope = active ? Math.sin(Math.min(1, age / beam.duration) * Math.PI) : 0;
        beam.material.opacity = envelope * (0.34 + beam.strength * 0.32);
        beam.flashMaterial.opacity = envelope * 0.88;
        beam.flash.scale.setScalar(0.6 + envelope * (1.4 + beam.strength));
      }

      if (shieldDown) {
        shieldMaterial.opacity = Math.max(0, shieldMaterial.opacity - dt * 0.15);
        shield.rotation.z += dt * 0.7;
        shield.scale.multiplyScalar(1 + dt * 0.035);
        if (shieldMaterial.opacity <= 0.002) shield.visible = false;
      } else {
        shieldMaterial.opacity = 0.08 + context.beatEnergy * 0.045 + impactEnergy * 0.05;
        shield.rotation.z += dt * 0.035;
      }

      if (flagshipDestroyed) {
        destroyAge += dt;
        flagship.segments.forEach((segment, index) => {
          const direction = index - (flagship.segments.length - 1) / 2;
          segment.position.x += direction * dt * (0.8 + destroyAge * 0.5);
          segment.position.y += Math.sin(index * 2.2) * dt * (1.2 + destroyAge * 0.7);
          segment.rotation.x += dt * direction * 0.013;
          segment.rotation.z += dt * (index % 2 ? 0.045 : -0.045);
        });
        victoryFires.forEach(({ mesh, material, phase }, index) => {
          const reveal = MathUtilsClamp((destroyAge - index * 0.055) / 0.5);
          material.opacity = reveal * (0.45 + Math.sin(destroyAge * 8 + phase) * 0.22);
          mesh.scale.setScalar(0.6 + reveal * (1.4 + Math.sin(destroyAge * 5 + phase) * 0.35));
        });
      }

      const fog = scene.fog as FogExp2;
      const eyeDistance = Math.abs(context.runTime - (BROADSIDE_806F_MARKERS.eye + 1.6));
      const eye = 1 - MathUtilsClamp(eyeDistance / 2.5);
      fog.density = 0.00052 - eye * 0.00018;
      const base = VOID.clone().lerp(NEBULA_DEEP, 0.18 + eye * 0.16);
      if (damageFlash > 0) base.lerp(CRIMSON, damageFlash * 0.28);
      if (impactEnergy > 0) base.lerp(NEBULA_GOLD, Math.min(0.24, impactEnergy * 0.12));
      (scene.background as Color).copy(base);
    },
    dispose() {
      root.removeFromParent();
      disposeObject3D(root);
      scene.fog = null;
    },
  };
}

function MathUtilsClamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

export type FleetEnvironment = ReturnType<typeof createFleetEnvironment>;
