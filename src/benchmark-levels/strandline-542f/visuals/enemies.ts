import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
} from 'three';
import {
  JELLY_GOLD,
  PARASITE_DARK,
  PARASITE_SOUR,
  PARASITE_VIOLET,
  PLAYER_CYAN,
  fleshMat,
  strandMat,
} from './palette';

// Geometry is immutable after construction, so every spawned parasite can
// share this small procedural kit. Mesh transforms still give each component
// its authored placement, while the renderer sees a stable geometry set across
// the full run and across replays.
const GEO = {
  latcherShell: new IcosahedronGeometry(0.82, 1),
  latcherSeam: new TorusGeometry(0.72, 0.075, 5, 18),
  latcherMouth: new SphereGeometry(0.25, 10, 7),
  latcherLeg: new ConeGeometry(0.13, 1.25, 4),
  skimmerSpine: new ConeGeometry(0.42, 2.5, 5),
  skimmerWing: new TetrahedronGeometry(1.15, 0),
  skimmerTip: new ConeGeometry(0.09, 1.35, 4),
  skimmerEye: new RingGeometry(0.19, 0.31, 10),
  cystCore: new SphereGeometry(0.55, 12, 8),
  cystCage: new TorusGeometry(0.92, 0.2, 6, 16),
  cystCross: new TorusGeometry(0.92, 0.13, 6, 16),
  cystBarb: new ConeGeometry(0.11, 0.74, 4),
  drifterHead: new OctahedronGeometry(0.68, 1),
  drifterCore: new SphereGeometry(0.22, 9, 6),
  drifterTail: new ConeGeometry(0.11, 2.0, 5),
  broodSac: new SphereGeometry(0.52, 10, 7),
  broodEgg: new SphereGeometry(0.2, 8, 5),
  broodFeed: new CylinderGeometry(0.025, 0.045, 0.48, 4),
  broodHalo: new RingGeometry(0.86, 0.92, 18),
  stingerCore: new IcosahedronGeometry(0.28, 1),
  stingerThorn: new ConeGeometry(0.045, 0.54, 4),
  parentAbdomen: new SphereGeometry(0.92, 16, 10),
  parentCrown: new IcosahedronGeometry(0.62, 1),
  parentCore: new SphereGeometry(0.31, 12, 8),
  parentRoot: new ConeGeometry(0.1, 1.65, 5),
  parentWebRings: [
    new TorusGeometry(1.55, 0.045, 5, 24),
    new TorusGeometry(2.05, 0.057, 5, 24),
    new TorusGeometry(2.55, 0.069, 5, 24),
  ],
  parentWebLines: [
    new BoxGeometry(1.55 * 1.78, 0.035, 0.025),
    new BoxGeometry(2.05 * 1.78, 0.035, 0.025),
    new BoxGeometry(2.55 * 1.78, 0.035, 0.025),
  ],
  parentHalo: new RingGeometry(0.42, 0.5, 16),
};

export function createEnemyModel(kind: string) {
  switch (kind) {
    case 'latcher': return createLatcher();
    case 'skimmer': return createSkimmer();
    case 'cyst': return createCyst();
    case 'drifter': return createDrifter();
    case 'brood': return createBrood();
    case 'stinger': return createStinger();
    case 'parent': return createParent();
    default: return createDrifter();
  }
}

/** A flattened clamp with hooked legs: readable as attached even before it peels away. */
function createLatcher() {
  const outer = new Group();
  const body = new Group();
  outer.add(body);

  const shell = new Mesh(GEO.latcherShell, fleshMat(PARASITE_VIOLET));
  shell.scale.set(1.25, 0.62, 0.55);
  body.add(shell);

  const seam = new Mesh(GEO.latcherSeam, strandMat(PARASITE_SOUR));
  seam.scale.set(1.15, 0.62, 1);
  body.add(seam);

  const mouth = new Mesh(GEO.latcherMouth, strandMat(PARASITE_SOUR));
  mouth.position.z = 0.52;
  body.add(mouth);

  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    const leg = new Mesh(GEO.latcherLeg, fleshMat(PARASITE_DARK));
    leg.position.set(Math.cos(angle) * 0.88, Math.sin(angle) * 0.5, -0.02);
    leg.rotation.z = -angle + Math.PI * 0.5;
    leg.rotation.x = index % 2 ? 0.5 : -0.5;
    body.add(leg);
  }
  outer.userData.core = mouth;
  return outer;
}

/** A detached ray-like defender whose blade wings make lateral crossing obvious. */
function createSkimmer() {
  const outer = new Group();
  const body = new Group();
  outer.add(body);

  const spine = new Mesh(GEO.skimmerSpine, fleshMat(PARASITE_VIOLET));
  spine.rotation.x = Math.PI * 0.5;
  body.add(spine);

  for (const side of [-1, 1]) {
    const wing = new Mesh(GEO.skimmerWing, fleshMat(side < 0 ? PARASITE_DARK : PARASITE_VIOLET));
    wing.position.x = side * 1.05;
    wing.scale.set(1.35, 0.32, 0.7);
    wing.rotation.z = side * 0.2;
    body.add(wing);
    const tip = new Mesh(GEO.skimmerTip, strandMat(PARASITE_SOUR));
    tip.position.set(side * 1.82, 0, 0);
    tip.rotation.z = side * -Math.PI * 0.5;
    body.add(tip);
  }

  const eye = new Mesh(GEO.skimmerEye, strandMat(PARASITE_SOUR));
  eye.position.z = 0.61;
  body.add(eye);
  outer.userData.core = eye;
  return outer;
}

/** Armored radial cyst; the broken ring silhouette advertises repeat locks. */
function createCyst() {
  const outer = new Group();
  const body = new Group();
  outer.add(body);

  const core = new Mesh(GEO.cystCore, fleshMat(PARASITE_SOUR));
  body.add(core);
  const cage = new Mesh(GEO.cystCage, fleshMat(PARASITE_DARK));
  body.add(cage);
  const crossCage = new Mesh(GEO.cystCross, fleshMat(PARASITE_VIOLET));
  crossCage.rotation.y = Math.PI * 0.5;
  body.add(crossCage);

  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    const barb = new Mesh(GEO.cystBarb, fleshMat(PARASITE_VIOLET));
    barb.position.set(Math.cos(angle) * 1.23, Math.sin(angle) * 1.23, 0);
    barb.rotation.z = -angle + Math.PI * 0.5;
    body.add(barb);
  }
  outer.userData.core = core;
  outer.userData.cage = cage;
  return outer;
}

/** A soft corkscrew parasite, deliberately asymmetric against the rigid cyst. */
function createDrifter() {
  const outer = new Group();
  const body = new Group();
  outer.add(body);

  const head = new Mesh(GEO.drifterHead, fleshMat(PARASITE_VIOLET));
  head.scale.set(0.72, 1.15, 0.72);
  body.add(head);
  const core = new Mesh(GEO.drifterCore, strandMat(PARASITE_SOUR));
  core.position.z = 0.58;
  body.add(core);

  for (let index = 0; index < 3; index += 1) {
    const angle = (index / 3) * Math.PI * 2;
    const tail = new Mesh(GEO.drifterTail, fleshMat(index === 1 ? PARASITE_DARK : PARASITE_VIOLET));
    tail.position.set(Math.cos(angle) * 0.55, Math.sin(angle) * 0.55, 0.85);
    tail.rotation.x = -0.35;
    tail.rotation.z = angle;
    body.add(tail);
  }
  outer.userData.core = core;
  return outer;
}

/** A brood is a grapelike packet: small bodies visibly feed one larger sac. */
function createBrood() {
  const outer = new Group();
  const body = new Group();
  outer.add(body);

  const sac = new Mesh(GEO.broodSac, fleshMat(PARASITE_SOUR));
  sac.scale.set(1, 0.8, 0.72);
  body.add(sac);
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    const egg = new Mesh(GEO.broodEgg, fleshMat(index % 2 ? PARASITE_VIOLET : PARASITE_DARK));
    egg.position.set(Math.cos(angle) * 0.78, Math.sin(angle) * 0.58, Math.sin(angle * 2) * 0.18);
    body.add(egg);
    const feed = new Mesh(GEO.broodFeed, strandMat(PARASITE_SOUR, 0.72));
    feed.position.set(Math.cos(angle) * 0.38, Math.sin(angle) * 0.28, 0);
    feed.rotation.z = -angle + Math.PI * 0.5;
    body.add(feed);
  }
  const halo = new Mesh(GEO.broodHalo, strandMat(PARASITE_SOUR, 0.82));
  body.add(halo);
  outer.userData.core = sac;
  return outer;
}

function createStinger() {
  const outer = new Group();
  const body = new Group();
  outer.add(body);
  const core = new Mesh(GEO.stingerCore, strandMat(PARASITE_SOUR));
  body.add(core);
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    const thorn = new Mesh(GEO.stingerThorn, strandMat(PARASITE_VIOLET));
    thorn.position.set(Math.cos(angle) * 0.35, Math.sin(angle) * 0.35, 0);
    thorn.rotation.z = -angle + Math.PI * 0.5;
    body.add(thorn);
  }
  outer.userData.core = core;
  return outer;
}

/**
 * The parent is kept inside an unscaled outer group because runner lock pulses
 * own that outer scale. Three named web layers are peeled by the visual spine.
 */
function createParent() {
  const outer = new Group();
  const body = new Group();
  body.scale.setScalar(2.7);
  outer.add(body);

  const abdomen = new Mesh(GEO.parentAbdomen, fleshMat(PARASITE_DARK));
  abdomen.scale.set(1.2, 0.78, 0.65);
  body.add(abdomen);
  const crown = new Mesh(GEO.parentCrown, fleshMat(PARASITE_VIOLET));
  crown.position.z = 0.68;
  body.add(crown);
  const core = new Mesh(GEO.parentCore, strandMat(PARASITE_SOUR));
  core.position.z = 1.22;
  body.add(core);

  for (let index = 0; index < 7; index += 1) {
    const angle = (index / 7) * Math.PI * 2;
    const root = new Mesh(GEO.parentRoot, fleshMat(PARASITE_VIOLET));
    root.position.set(Math.cos(angle) * 0.9, Math.sin(angle) * 0.62, 0.05);
    root.rotation.z = -angle + Math.PI * 0.5;
    root.rotation.x = 0.55;
    body.add(root);
  }

  const webLayers: Group[] = [];
  for (let layer = 0; layer < 3; layer += 1) {
    const web = new Group();
    const ring = new Mesh(GEO.parentWebRings[layer], strandMat(PARASITE_SOUR, 0.68));
    web.add(ring);
    for (let spoke = 0; spoke < 8; spoke += 1) {
      const angle = (spoke / 8) * Math.PI * 2 + layer * 0.19;
      const line = new Mesh(GEO.parentWebLines[layer], strandMat(PARASITE_VIOLET, 0.62));
      line.rotation.z = angle;
      web.add(line);
    }
    web.position.z = 0.42 - layer * 0.18;
    web.rotation.x = layer * 0.22;
    body.add(web);
    webLayers.push(web);
  }

  const targetHalo = new Mesh(GEO.parentHalo, strandMat(PLAYER_CYAN, 0.74));
  targetHalo.position.z = 1.25;
  targetHalo.visible = false;
  body.add(targetHalo);

  outer.userData.body = body;
  outer.userData.core = core;
  outer.userData.webLayers = webLayers;
  outer.userData.targetHalo = targetHalo;
  outer.userData.pulseColor = JELLY_GOLD;
  return outer;
}
