import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  CatmullRomCurve3,
  Vector3,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import type { StrandlineEnemyKind } from '../gameplay';

export type StrandlinePalette = {
  deep: Color;
  water: Color;
  jade: Color;
  gold: Color;
  sun: Color;
  parasite: Color;
  sour: Color;
  shadow: Color;
};

function material(color: Color, intensity = 1, additive = false, opacity = 1) {
  const base = color.clone().multiplyScalar(intensity);
  const result = new MeshBasicMaterial({
    color: base,
    side: DoubleSide,
    transparent: additive || opacity < 1,
    opacity,
    depthWrite: !additive && opacity >= 1,
    blending: additive ? AdditiveBlending : undefined,
  });
  result.userData.baseColor = base.clone();
  return result;
}

function remember(group: Group, ...materials: Array<MeshBasicMaterial | LineBasicMaterial>) {
  group.userData.materials = materials;
  return group;
}

export function createParasite(kind: StrandlineEnemyKind, palette: StrandlinePalette) {
  if (kind === 'clasper') return createClasper(palette);
  if (kind === 'skater') return createSkater(palette);
  if (kind === 'nurse') return createNurse(palette);
  if (kind === 'venom') return createVenom(palette);
  if (kind === 'brood') return createBrood(palette);
  return createParent(palette);
}

function createVenom(palette: StrandlinePalette) {
  const group = new Group();
  const shell = material(palette.parasite, 1.2);
  const sour = material(palette.sour, 2.35, true);
  const core = material(palette.sun, 1.9, true);
  const pod = new Mesh(new IcosahedronGeometry(0.42, 1), shell);
  const hotCore = new Mesh(new SphereGeometry(0.16, 8, 6), core);
  group.add(pod, hotCore);
  const rotors: Mesh[] = [];
  for (let i = 0; i < 3; i += 1) {
    const ring = new Mesh(new TorusGeometry(0.62 + i * 0.12, 0.032, 4, 18), sour);
    ring.rotation.x = i * Math.PI / 3;
    ring.rotation.y = i * Math.PI / 4;
    group.add(ring);
    rotors.push(ring);
  }
  group.userData.rotors = rotors;
  group.userData.accent = palette.sour;
  group.userData.isVenom = true;
  return remember(group, shell, sour, core);
}

function createClasper(palette: StrandlinePalette) {
  const group = new Group();
  const shell = material(palette.parasite, 0.75);
  const sour = material(palette.sour, 1.7, true);
  const dark = material(palette.shadow, 1.1);
  const anchor = material(palette.jade, 0.9, true, 0.78);
  const body = new Mesh(new IcosahedronGeometry(0.72, 1), shell);
  body.scale.set(1.15, 0.72, 0.78);
  const eye = new Mesh(new SphereGeometry(0.17, 8, 6), sour);
  eye.position.z = 0.68;
  group.add(body, eye);
  const jaws: Mesh[] = [];
  for (let i = 0; i < 4; i += 1) {
    const angle = i / 4 * Math.PI * 2;
    const jaw = new Mesh(new ConeGeometry(0.19, 1.25, 4), dark);
    jaw.position.set(Math.cos(angle) * 0.72, Math.sin(angle) * 0.5, -0.08);
    jaw.rotation.z = -angle + Math.PI * 0.5;
    jaw.rotation.x = Math.PI * 0.5;
    group.add(jaw);
    jaws.push(jaw);
  }
  const clamp = new Mesh(new TorusGeometry(0.86, 0.1, 5, 24, Math.PI * 1.55), sour);
  clamp.rotation.z = -Math.PI * 0.78;
  const anchorStalk = new Mesh(new CylinderGeometry(0.07, 0.16, 1.9, 5), anchor);
  anchorStalk.rotation.x = Math.PI * 0.5;
  anchorStalk.position.z = -1.15;
  group.add(clamp, anchorStalk);
  group.userData.animatedParts = jaws;
  group.userData.anchorPart = anchorStalk;
  group.userData.accent = palette.sour;
  return remember(group, shell, sour, dark, anchor);
}

function createSkater(palette: StrandlinePalette) {
  const group = new Group();
  const wing = material(palette.parasite, 0.72);
  const vein = material(palette.sour, 1.85, true);
  const core = material(palette.sour, 2.25, true);
  const body = new Mesh(new ConeGeometry(0.42, 2.25, 5), wing);
  body.rotation.x = Math.PI * 0.5;
  const wingGeometry = new BufferGeometry();
  wingGeometry.setAttribute('position', new Float32BufferAttribute([
    0, 0.15, 0, -3.1, 0.18, -0.28, -1.25, -0.55, 0.1,
    0, 0.15, 0, 3.1, 0.18, -0.28, 1.25, -0.55, 0.1,
  ], 3));
  wingGeometry.computeVertexNormals();
  const wings = new Mesh(wingGeometry, wing);
  const edge = new Mesh(new BoxGeometry(6.1, 0.045, 0.05), vein);
  edge.position.y = 0.18;
  const hotCore = new Mesh(new OctahedronGeometry(0.22, 0), core);
  hotCore.position.z = 0.62;
  group.add(wings, body, edge, hotCore);
  const filaments: Line[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 2; i += 1) {
      const points = [
        new Vector3(side * (1.25 + i * 0.75), -0.12, -0.15),
        new Vector3(side * (1.5 + i * 0.6), -0.35, 1.2),
        new Vector3(side * (1.2 + i * 0.55), -0.5, 2.5),
      ];
      const line = new Line(
        new BufferGeometry().setFromPoints(points),
        new LineBasicMaterial({ color: palette.sour.clone().multiplyScalar(1.4), transparent: true, opacity: 0.75, blending: AdditiveBlending }),
      );
      filaments.push(line);
      group.add(line);
    }
  }
  group.userData.animatedParts = [wings, ...filaments];
  group.userData.accent = palette.sour;
  return remember(group, wing, vein, core, ...(filaments.map((line) => line.material as LineBasicMaterial)));
}

function createNurse(palette: StrandlinePalette) {
  const group = new Group();
  const shell = material(palette.parasite, 0.62, false, 0.92);
  const sour = material(palette.sour, 1.8, true);
  const dark = material(palette.shadow, 0.9);
  const bulb = new Mesh(new SphereGeometry(0.78, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.68), shell);
  bulb.scale.y = 0.72;
  const rim = new Mesh(new TorusGeometry(0.71, 0.1, 5, 24), sour);
  rim.rotation.x = Math.PI * 0.5;
  rim.position.y = -0.22;
  group.add(bulb, rim);
  const rotors: Group[] = [];
  for (let i = 0; i < 3; i += 1) {
    const orbit = new Group();
    orbit.rotation.z = i / 3 * Math.PI * 2;
    const claw = new Mesh(new ConeGeometry(0.18, 1.05, 4), dark);
    claw.position.set(1.12, 0, 0);
    claw.rotation.z = -Math.PI * 0.5;
    const node = new Mesh(new SphereGeometry(0.16, 7, 5), sour);
    node.position.set(0.75, 0, 0);
    orbit.add(claw, node);
    group.add(orbit);
    rotors.push(orbit);
  }
  for (let i = 0; i < 5; i += 1) {
    const tendril = new Mesh(new CylinderGeometry(0.025, 0.05, 1.9 + i * 0.18, 4), sour);
    tendril.position.set((i - 2) * 0.28, -1.18 - i % 2 * 0.2, 0);
    tendril.rotation.z = (i - 2) * 0.1;
    group.add(tendril);
  }
  group.userData.rotors = rotors;
  group.userData.accent = palette.sour;
  return remember(group, shell, sour, dark);
}

function createBrood(palette: StrandlinePalette) {
  const group = new Group();
  const sac = material(palette.parasite, 0.68, false, 0.9);
  const sour = material(palette.sour, 2.05, true);
  const web = material(palette.parasite, 1.15, true, 0.8);
  const eggs: Mesh[] = [];
  for (let i = 0; i < 7; i += 1) {
    const angle = i / 7 * Math.PI * 2;
    const egg = new Mesh(new SphereGeometry(i === 0 ? 0.62 : 0.36, 9, 7), i % 2 ? sac : sour);
    egg.position.set(i === 0 ? 0 : Math.cos(angle) * 0.78, i === 0 ? 0 : Math.sin(angle) * 0.78, (i % 3) * 0.12);
    egg.scale.y = 1.25;
    eggs.push(egg);
    group.add(egg);
  }
  const cageA = new Mesh(new TorusGeometry(1.25, 0.055, 4, 18), web);
  const cageB = cageA.clone();
  cageB.rotation.x = Math.PI * 0.5;
  group.add(cageA, cageB);
  group.userData.rotors = [cageA, cageB];
  group.userData.animatedParts = eggs;
  group.userData.accent = palette.sour;
  group.userData.isBrood = true;
  return remember(group, sac, sour, web);
}

function createParent(palette: StrandlinePalette) {
  const group = new Group();
  const carapace = material(palette.parasite, 0.62);
  const sour = material(palette.sour, 2.2, true);
  const webMaterial = material(palette.parasite, 1.4, true, 0.85);
  const dark = material(palette.shadow, 1.2);
  const body = new Mesh(new IcosahedronGeometry(1.75, 1), carapace);
  body.scale.set(1.35, 0.95, 0.72);
  const maw = new Mesh(new TorusGeometry(0.72, 0.22, 5, 14), sour);
  maw.position.z = 1.18;
  const pupil = new Mesh(new SphereGeometry(0.32, 10, 7), dark);
  pupil.position.z = 1.36;
  group.add(body, maw, pupil);
  const arms: Mesh[] = [];
  for (let i = 0; i < 8; i += 1) {
    const angle = i / 8 * Math.PI * 2;
    const arm = new Mesh(new ConeGeometry(0.3, 2.6, 5), carapace);
    arm.position.set(Math.cos(angle) * 1.55, Math.sin(angle) * 1.1, -0.15);
    arm.rotation.z = -angle + Math.PI * 0.5;
    arm.rotation.x = Math.PI * 0.5;
    arms.push(arm);
    group.add(arm);
  }
  const webSectors: Group[] = [];
  const sectorAngles = [150, 30, 270].map((degrees) => degrees / 180 * Math.PI);
  for (let sector = 0; sector < 3; sector += 1) {
    const webGroup = new Group();
    const baseAngle = sectorAngles[sector];
    for (let strand = -2; strand <= 2; strand += 1) {
      const a = baseAngle + strand * 0.16;
      const curve = new CatmullRomCurve3([
        new Vector3(Math.cos(a) * 1.4, Math.sin(a) * 1.1, 0.7),
        new Vector3(Math.cos(a + 0.32) * 2.5, Math.sin(a + 0.32) * 2.1, 0.4),
        new Vector3(Math.cos(a - 0.18) * 4.1, Math.sin(a - 0.18) * 3.4, 0),
      ]);
      const thread = new Mesh(new TubeGeometry(curve, 10, 0.035, 3, false), webMaterial);
      thread.raycast = () => {};
      webGroup.add(thread);
    }
    group.add(webGroup);
    webSectors.push(webGroup);
  }
  group.userData.animatedParts = arms;
  group.userData.rotors = [maw];
  group.userData.webSectors = webSectors;
  group.userData.accent = palette.sour;
  group.userData.isParent = true;
  return remember(group, carapace, sour, webMaterial, dark);
}

export function createStrandGlyph(character: string, palette: StrandlinePalette) {
  const group = new Group();
  const jade = material(palette.jade, 1.45);
  const gold = material(palette.gold, 1.75, true);
  const frame = material(palette.sun, 1.18, true, 0.82);
  const cellGeometry = new SphereGeometry(0.11, 7, 5);
  const haloGeometry = new RingGeometry(0.14, 0.18, 10);
  for (const cell of glyphOnCells(character)) {
    const bead = new Mesh(cellGeometry, jade);
    const halo = new Mesh(haloGeometry, gold);
    bead.position.set((cell.x - 2) * 0.3, (3 - cell.y) * 0.3, 0);
    halo.position.copy(bead.position);
    halo.position.z = 0.01;
    group.add(bead, halo);
  }
  const outer = new Mesh(new TorusGeometry(1.16, 0.035, 5, 48), frame);
  const crossA = new Mesh(new BoxGeometry(2.25, 0.025, 0.025), frame);
  const crossB = crossA.clone();
  crossA.position.y = 1.05;
  crossB.position.y = -1.05;
  group.add(outer, crossA, crossB);
  group.userData.rotors = [outer];
  group.userData.accent = palette.gold;
  group.userData.isLetter = true;
  return remember(group, jade, gold, frame);
}

export function createStrandProjectile(palette: StrandlinePalette) {
  const group = new Group();
  const gold = material(palette.gold, 2.25, true);
  const jade = material(palette.jade, 1.8, true);
  const core = new Mesh(new SphereGeometry(0.16, 8, 6), gold);
  core.scale.z = 2.8;
  const ringA = new Mesh(new RingGeometry(0.28, 0.32, 14), jade);
  const ringB = ringA.clone();
  ringA.position.z = -0.3;
  ringB.position.z = -0.62;
  ringB.scale.setScalar(0.7);
  group.add(core, ringA, ringB);
  group.userData.rotors = [ringA, ringB];
  return remember(group, gold, jade);
}

export function createStrandReticle(palette: StrandlinePalette) {
  const group = new Group();
  const jade = material(palette.jade, 1.42);
  const gold = material(palette.gold, 1.45);
  const inner = new Mesh(new RingGeometry(0.42, 0.47, 32, 1, Math.PI * 0.12, Math.PI * 1.76), jade);
  const outerA = new Mesh(new RingGeometry(0.68, 0.71, 40, 1, 0, Math.PI * 0.72), gold);
  const outerB = outerA.clone();
  outerB.rotation.z = Math.PI;
  const pipH = new Mesh(new PlaneGeometry(0.24, 0.026), gold);
  const pipV = new Mesh(new PlaneGeometry(0.026, 0.24), gold);
  group.add(inner, outerA, outerB, pipH, pipV);
  group.userData.rotors = [inner, outerA, outerB];
  group.userData.materials = [jade, gold];
  return group;
}
