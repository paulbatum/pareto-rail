import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { GRAPHITE, HAZARD_DARK, ORANGE, PANEL, PANEL_SHADE, SUN_WHITE, TETHER } from './palette';

export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; base: Color; kind: 'panel' | 'edge' | 'accent' };

const GEO = {
  kiteBody: new ConeGeometry(0.72, 3.8, 3),
  kiteWing: new ConeGeometry(1.55, 4.6, 3),
  kiteStripe: new BoxGeometry(2.8, 0.1, 0.12),
  skimmerSpine: new BoxGeometry(3.5, 0.48, 0.5),
  skimmerBlade: new ConeGeometry(0.7, 3.2, 3),
  skimmerTip: new BoxGeometry(0.55, 0.18, 0.65),
  raiderCore: new IcosahedronGeometry(1.05, 0),
  raiderRingA: new TorusGeometry(1.55, 0.18, 5, 18),
  raiderRingB: new TorusGeometry(1.55, 0.12, 5, 18),
  raiderEye: new RingGeometry(0.22, 0.48, 8),
  saboteurBody: new SphereGeometry(1.15, 8, 6),
  saboteurShaft: new BoxGeometry(0.22, 2.1, 0.22),
  saboteurHook: new ConeGeometry(0.38, 1.15, 4),
  shard: new OctahedronGeometry(0.72, 0),
  shardStripe: new RingGeometry(0.28, 0.42, 6),
  clawHub: new CylinderGeometry(0.72, 0.9, 0.7, 8),
  clawJaw: new BoxGeometry(0.55, 2.8, 0.8),
  crawlerFrame: new BoxGeometry(7.5, 5.4, 5.2),
  crawlerArmor: new OctahedronGeometry(4.5, 0),
  crawlerFace: new RingGeometry(1.0, 1.8, 8),
  crawlerIris: new CylinderGeometry(0.78, 0.78, 0.3, 12),
  crawlerLeg: new BoxGeometry(0.65, 6.5, 0.85),
  crawlerPad: new BoxGeometry(1.2, 1.8, 1.1),
} as const;

const EDGE_GEOMETRIES = new WeakMap<BufferGeometry, EdgesGeometry>();

function edgeGeometry(geometry: BufferGeometry) {
  let edges = EDGE_GEOMETRIES.get(geometry);
  if (!edges) {
    edges = new EdgesGeometry(geometry);
    EDGE_GEOMETRIES.set(geometry, edges);
  }
  return edges;
}

function part(group: Group, geometry: BufferGeometry, color: Color, kind: TintPart['kind']) {
  const material = new MeshBasicMaterial({ color: color.clone(), side: DoubleSide });
  const mesh = new Mesh(geometry, material);
  group.add(mesh);
  (group.userData.parts as TintPart[]).push({ material, base: color.clone(), kind });
  return mesh;
}

function edged(group: Group, geometry: BufferGeometry, color = PANEL, accent = GRAPHITE) {
  const mesh = part(group, geometry, color, 'panel');
  const edgeMaterial = new LineBasicMaterial({ color: accent.clone() });
  mesh.add(new LineSegments(edgeGeometry(geometry), edgeMaterial));
  (group.userData.parts as TintPart[]).push({ material: edgeMaterial, base: accent.clone(), kind: 'edge' });
  return mesh;
}

function enemyGroup(kind: string) {
  const group = new Group();
  group.userData.kind = kind;
  group.userData.parts = [] as TintPart[];
  return group;
}

export function createKiteMesh() {
  const group = enemyGroup('kite');
  const body = edged(group, GEO.kiteBody, PANEL_SHADE, GRAPHITE);
  body.rotation.z = Math.PI / 2;
  body.scale.set(0.45, 1.25, 0.18);
  const left = part(group, GEO.kiteWing, new Color(0x68747a), 'panel');
  left.position.x = -1.65;
  left.rotation.z = -Math.PI / 2;
  left.scale.z = 0.12;
  const right = left.clone();
  right.position.x = 1.65;
  right.rotation.z = Math.PI / 2;
  group.add(right);
  const orange = part(group, GEO.kiteStripe, ORANGE, 'accent');
  orange.position.y = -0.25;
  group.scale.setScalar(0.9);
  return group;
}

export function createSkimmerMesh() {
  const group = enemyGroup('skimmer');
  const spine = edged(group, GEO.skimmerSpine, PANEL, GRAPHITE);
  spine.rotation.z = 0.12;
  for (const side of [-1, 1]) {
    const blade = part(group, GEO.skimmerBlade, GRAPHITE, 'panel');
    blade.position.set(side * 2.1, side * 0.45, 0);
    blade.rotation.z = side * -1.05;
    blade.scale.z = 0.22;
    const tip = part(group, GEO.skimmerTip, ORANGE, 'accent');
    tip.position.set(side * 3.0, side * 0.8, 0);
  }
  return group;
}

export function createRaiderMesh() {
  const group = enemyGroup('raider');
  part(group, GEO.raiderCore, GRAPHITE, 'panel');
  const ringA = part(group, GEO.raiderRingA, PANEL, 'panel');
  ringA.rotation.x = Math.PI / 2;
  const ringB = part(group, GEO.raiderRingB, PANEL_SHADE, 'edge');
  ringB.rotation.y = Math.PI / 2;
  const eye = part(group, GEO.raiderEye, ORANGE, 'accent');
  eye.position.z = 1.02;
  group.userData.signalEye = eye;
  return group;
}

export function createSaboteurMesh() {
  const group = enemyGroup('saboteur');
  const hooks: Mesh[] = [];
  const body = edged(group, GEO.saboteurBody, PANEL_SHADE, GRAPHITE);
  body.scale.z = 0.65;
  for (let i = 0; i < 4; i += 1) {
    const arm = new Group();
    const shaft = part(group, GEO.saboteurShaft, TETHER, 'edge');
    shaft.position.y = 1.65;
    const hook = part(group, GEO.saboteurHook, ORANGE, 'accent');
    hook.position.set(0.45, 2.5, 0);
    hook.rotation.z = -0.7;
    hooks.push(hook);
    arm.add(shaft, hook);
    arm.rotation.z = i * Math.PI / 2;
    group.add(arm);
  }
  group.userData.carThreat = true;
  group.userData.signalHooks = hooks;
  return group;
}

export function createShardMesh() {
  const group = enemyGroup('shard');
  const shard = part(group, GEO.shard, PANEL_SHADE, 'panel');
  shard.scale.set(0.45, 0.45, 2.4);
  const stripe = part(group, GEO.shardStripe, ORANGE, 'accent');
  stripe.position.z = 0.75;
  group.userData.isHostileShot = true;
  group.userData.signalStripe = stripe;
  return group;
}

export function createClawMesh() {
  const group = enemyGroup('claw');
  const hub = part(group, GEO.clawHub, HAZARD_DARK, 'panel');
  hub.rotation.x = Math.PI / 2;
  for (const side of [-1, 1]) {
    const jaw = edged(group, GEO.clawJaw, ORANGE, GRAPHITE);
    jaw.position.x = side * 0.82;
    jaw.rotation.z = side * 0.34;
  }
  group.userData.bossPart = true;
  return group;
}

export function createCrawlerMesh() {
  const group = enemyGroup('crawler');
  const core = edged(group, GEO.crawlerFrame, GRAPHITE, PANEL_SHADE);
  core.rotation.z = Math.PI / 4;
  const armored = part(group, GEO.crawlerArmor, PANEL_SHADE, 'panel');
  armored.scale.set(1.15, 0.8, 0.7);
  const face = part(group, GEO.crawlerFace, HAZARD_DARK, 'accent');
  face.position.z = 3.35;
  const iris = part(group, GEO.crawlerIris, ORANGE, 'accent');
  iris.rotation.x = Math.PI / 2;
  iris.position.z = 3.45;
  const legs: Mesh[] = [];
  const pads: Mesh[] = [];
  const padBases: Vector3[] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = i / 6 * Math.PI * 2;
    const leg = edged(group, GEO.crawlerLeg, GRAPHITE, PANEL_SHADE);
    leg.position.set(Math.cos(angle) * 5.2, Math.sin(angle) * 4.2, -0.8);
    leg.rotation.z = angle - Math.PI / 2;
    leg.userData.baseRotation = leg.rotation.z;
    const pad = part(group, GEO.crawlerPad, ORANGE, 'accent');
    pad.position.set(Math.cos(angle) * 7.7, Math.sin(angle) * 6.2, -1.1);
    pad.rotation.z = angle;
    legs.push(leg);
    pads.push(pad);
    padBases.push(pad.position.clone());
  }
  group.userData.isCrawler = true;
  group.userData.core = iris;
  group.userData.armor = armored;
  group.userData.legs = legs;
  group.userData.pads = pads;
  group.userData.padBases = padBases;
  group.scale.setScalar(1.05);
  return group;
}

export function pulseCrawler(mesh: Group, elapsed: number) {
  const core = mesh.userData.core as Mesh | undefined;
  const armor = mesh.userData.armor as Mesh | undefined;
  const exposed = mesh.userData.exposed === true;
  const stage = Number(mesh.userData.stage ?? 0);
  if (core) {
    core.scale.setScalar((exposed ? 1.02 : 0.72) + Math.sin(elapsed * (exposed ? 6.2 : 2.2)) * (exposed ? 0.14 : 0.04));
    (core.material as MeshBasicMaterial).color.copy(!exposed ? HAZARD_DARK : stage > 0 ? SUN_WHITE : ORANGE);
  }
  if (armor) {
    armor.rotation.z = elapsed * (exposed ? 0.36 : 0.06);
    armor.scale.set(1.15 + (exposed ? 0.08 : 0), 0.8 + (exposed ? 0.05 : 0), 0.7);
  }
  const legs = mesh.userData.legs as Mesh[] | undefined;
  const pads = mesh.userData.pads as Mesh[] | undefined;
  const padBases = mesh.userData.padBases as Vector3[] | undefined;
  const approach = Number(mesh.userData.approach ?? 0);
  legs?.forEach((leg, index) => {
    const stroke = Math.sin(elapsed * (1.8 + approach * 1.7) + index * Math.PI / 3);
    leg.rotation.z = Number(leg.userData.baseRotation) + stroke * (0.06 + approach * 0.11);
    leg.scale.y = 1 + Math.max(0, stroke) * (0.08 + approach * 0.12);
  });
  pads?.forEach((pad, index) => {
    const base = padBases?.[index];
    if (!base) return;
    const grip = Math.max(0, Math.sin(elapsed * (1.8 + approach * 1.7) + index * Math.PI / 3));
    pad.position.copy(base).multiplyScalar(1 + grip * 0.045);
    pad.scale.setScalar(1 + grip * 0.13);
  });
}

export function animateEnemySignals(mesh: Group, elapsed: number) {
  const eye = mesh.userData.signalEye as Mesh | undefined;
  if (eye) {
    const charge = Number(mesh.userData.fireCharge ?? 0);
    const pulse = charge > 0 ? 0.75 + Math.sin(elapsed * (8 + charge * 10)) * 0.25 : 0;
    eye.scale.setScalar(1 + charge * (0.35 + pulse * 0.25));
    if (charge > 0) (eye.material as MeshBasicMaterial).color.copy(ORANGE).lerp(SUN_WHITE, charge * (0.45 + pulse * 0.45));
  }

  const hooks = mesh.userData.signalHooks as Mesh[] | undefined;
  if (hooks) {
    const dive = Number(mesh.userData.dive ?? 0);
    const urgency = MathUtils.clamp((dive - 0.35) / 0.65, 0, 1);
    const pulse = 0.5 + Math.sin(elapsed * (6 + urgency * 14)) * 0.5;
    hooks.forEach((hook, index) => {
      hook.scale.setScalar(1 + urgency * (0.1 + pulse * 0.22));
      if (urgency > 0) (hook.material as MeshBasicMaterial).color.copy(ORANGE).lerp(SUN_WHITE, urgency * pulse * 0.72);
      hook.rotation.y = Math.sin(elapsed * 3 + index) * urgency * 0.35;
    });
  }

  const stripe = mesh.userData.signalStripe as Mesh | undefined;
  if (stripe) {
    const brake = Number(mesh.userData.impactBrake ?? 0);
    const pulse = 0.5 + Math.sin(elapsed * 34) * 0.5;
    stripe.scale.setScalar(1 + brake * (0.5 + pulse * 0.8));
    if (brake > 0) (stripe.material as MeshBasicMaterial).color.copy(ORANGE).lerp(SUN_WHITE, brake * (0.55 + pulse * 0.45));
  }
}
