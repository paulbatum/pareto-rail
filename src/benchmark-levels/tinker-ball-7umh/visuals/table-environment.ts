import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import type { CatmullRomCurve3 } from 'three';
import {
  BRASS_METAL,
  BUTTON_CYAN,
  BUTTON_LIME,
  BUTTON_MAGENTA,
  BUTTON_ORANGE,
  BUTTON_PURPLE,
  BUTTON_YELLOW,
  CARDBOARD_DARK,
  CARDBOARD_KRAFT,
  CUTTING_MAT_GREEN,
  CUTTING_MAT_LINE,
  ERASER_PINK,
  hdr,
  LAMP_BEAM,
  LAMP_WARM,
  mulberry32,
  PENCIL_LEAD,
  PENCIL_WOOD,
  PENCIL_YELLOW,
  SPOOL_WOOD,
  STEEL_METAL,
  TABLE_DARK,
  WOOD_BASE,
  WOOD_GRAIN,
  WOOD_PLANK,
  type Rng,
} from './palette';

export type TableEnvironment = {
  root: Group;
  tableGroup: Group;
  lampGroup: Group;
  propsGroup: Group;
  scatterField: ScatterField;
  update(cameraRailU: number, dt: number): void;
  dispose(): void;
};

export function createTableEnvironment(scene: Scene, curve: CatmullRomCurve3): TableEnvironment {
  scene.background = TABLE_DARK.clone().multiplyScalar(0.7);
  const root = new Group();
  root.userData.raildIgnoreOcclusion = true;

  const rng = mulberry32(1048576);

  // 1. Tabletop surface and cutting mat
  const tableGroup = createTableMesh(rng);
  root.add(tableGroup);

  // 2. Desk Lamp and warm lighting fixtures
  const lampGroup = createDeskLamp(rng);
  root.add(lampGroup);

  // 3. Landmark workshop props (Ruler bridges, Jars, Scissors, Sketchbooks, Tape)
  const propsGroup = createLandmarkProps(rng);
  root.add(propsGroup);

  // 4. Scatter items along the rail (Pins, beads, buttons, clips, shavings)
  const scatterField = createRailScatterField(curve, rng);
  root.add(scatterField.group);

  scene.add(root);

  return {
    root,
    tableGroup,
    lampGroup,
    propsGroup,
    scatterField,
    update(cameraRailU, dt) {
      scatterField.update(cameraRailU, dt);
    },
    dispose() {
      scatterField.dispose();
      scene.remove(root);
    },
  };
}

// ---- Table Surface ----
function createTableMesh(rng: Rng): Group {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;

  // Giant main table surface
  const tablePlane = new PlaneGeometry(260, 260, 32, 32);
  const tableMat = new MeshBasicMaterial({
    color: WOOD_BASE,
    side: DoubleSide,
  });
  const tableMesh = new Mesh(tablePlane, tableMat);
  tableMesh.rotation.x = -Math.PI / 2;
  tableMesh.position.y = -0.5;
  group.add(tableMesh);

  // Wood planks & scratch lines
  const scratchGeoms: BufferGeometry[] = [];
  for (let i = 0; i < 48; i += 1) {
    const x = (rng() - 0.5) * 200;
    const z = (rng() - 0.5) * 200;
    const len = 8 + rng() * 32;
    const angle = rng() * Math.PI * 2;
    const lineGeom = new CylinderGeometry(0.06, 0.06, len, 4);
    lineGeom.rotateZ(angle);
    lineGeom.translate(x, 0.02, z);
    scratchGeoms.push(lineGeom);
  }
  const scratchMat = new MeshBasicMaterial({ color: WOOD_GRAIN.clone().multiplyScalar(0.7) });
  const scratches = new Mesh(mergeGeometries(scratchGeoms), scratchMat);
  scratches.rotation.x = -Math.PI / 2;
  group.add(scratches);
  for (const g of scratchGeoms) g.dispose();

  // Green self-healing cutting mat
  const matPlane = new PlaneGeometry(80, 50);
  const matMaterial = new MeshBasicMaterial({ color: CUTTING_MAT_GREEN, side: DoubleSide });
  const matMesh = new Mesh(matPlane, matMaterial);
  matMesh.rotation.x = -Math.PI / 2;
  matMesh.position.set(-15, -0.42, 10);
  group.add(matMesh);

  // Cutting mat grid lines
  const gridGeoms: BufferGeometry[] = [];
  for (let gx = -38; gx <= 38; gx += 4) {
    const line = new CylinderGeometry(0.04, 0.04, 48, 3);
    line.translate(gx, 0, 0);
    gridGeoms.push(line);
  }
  for (let gz = -23; gz <= 23; gz += 4) {
    const line = new CylinderGeometry(0.04, 0.04, 76, 3);
    line.rotateZ(Math.PI / 2);
    line.translate(0, gz, 0);
    gridGeoms.push(line);
  }
  const gridMat = new MeshBasicMaterial({ color: CUTTING_MAT_LINE });
  const gridMesh = new Mesh(mergeGeometries(gridGeoms), gridMat);
  gridMesh.rotation.x = -Math.PI / 2;
  gridMesh.position.set(-15, -0.38, 10);
  group.add(gridMesh);
  for (const g of gridGeoms) g.dispose();

  return group;
}

// ---- Desk Lamp ----
function createDeskLamp(_rng: Rng): Group {
  const lamp = new Group();
  lamp.userData.raildIgnoreOcclusion = true;
  lamp.position.set(25, 0, -35);

  // Lamp Heavy Cast-Iron Base
  const baseGeom = new CylinderGeometry(4.5, 5.2, 1.2, 16);
  const baseMat = new MeshBasicMaterial({ color: BRASS_METAL.clone().multiplyScalar(0.6) });
  const baseMesh = new Mesh(baseGeom, baseMat);
  baseMesh.position.y = 0.6;
  lamp.add(baseMesh);

  // Articulated Steel Arm Segments
  const arm1Geom = new CylinderGeometry(0.35, 0.35, 22, 8);
  const armMat = new MeshBasicMaterial({ color: STEEL_METAL });
  const arm1 = new Mesh(arm1Geom, armMat);
  arm1.position.set(-2, 10, 2);
  arm1.rotation.z = 0.25;
  lamp.add(arm1);

  const arm2 = new Mesh(arm1Geom, armMat);
  arm2.position.set(-8, 26, 4);
  arm2.rotation.z = -0.45;
  lamp.add(arm2);

  // Big Enamel Shade
  const shadeGeom = new CylinderGeometry(2.0, 7.5, 6.0, 16, 1, true);
  const shadeMat = new MeshBasicMaterial({ color: new Color(0x194d33), side: DoubleSide });
  const shade = new Mesh(shadeGeom, shadeMat);
  shade.position.set(-16, 30, 6);
  shade.rotation.z = 0.55;
  lamp.add(shade);

  // Bulb & Light Cone
  const bulbGeom = new SphereGeometry(1.8, 12, 12);
  const bulbMat = createAdditiveBasicMaterial({ color: hdr(LAMP_WARM, 2.4) });
  const bulb = new Mesh(bulbGeom, bulbMat);
  bulb.position.set(-16, 29, 6);
  lamp.add(bulb);

  // Translucent volumetric light cone
  const coneGeom = new CylinderGeometry(3.0, 38, 48, 16, 1, true);
  const coneMat = createAdditiveBasicMaterial({
    color: LAMP_BEAM.clone().multiplyScalar(0.09),
    side: DoubleSide,
    opacity: 0.22,
  });
  const cone = new Mesh(coneGeom, coneMat);
  cone.position.set(-16, 8, 6);
  cone.rotation.z = 0.22;
  lamp.add(cone);

  return lamp;
}

// ---- Landmark Workshop Props ----
function createLandmarkProps(rng: Rng): Group {
  const group = new Group();
  group.userData.raildIgnoreOcclusion = true;

  // 1. Towering Wooden Rulers (Bridges & Ramps)
  const rulerMat = new MeshBasicMaterial({ color: PENCIL_WOOD });
  const rulerGeom = new BoxGeometry(3.2, 0.4, 45);
  const ruler1 = new Mesh(rulerGeom, rulerMat);
  ruler1.position.set(-30, 4, -10);
  ruler1.rotation.set(0.15, 0.4, 0.1);
  group.add(ruler1);

  // Ruler 2
  const ruler2 = new Mesh(rulerGeom, rulerMat);
  ruler2.position.set(20, 3, 25);
  ruler2.rotation.set(-0.1, -0.6, 0.05);
  group.add(ruler2);

  // 2. Glass Jar filled with buttons and marbles
  const jarGroup = new Group();
  jarGroup.position.set(32, 0, -15);
  const jarGlassGeom = new CylinderGeometry(6, 6, 16, 16, 1, true);
  const jarGlassMat = createAdditiveBasicMaterial({
    color: new Color(0x64b5f6).multiplyScalar(0.3),
    opacity: 0.4,
    side: DoubleSide,
  });
  const jarGlass = new Mesh(jarGlassGeom, jarGlassMat);
  jarGlass.position.y = 8;
  jarGroup.add(jarGlass);

  // Marbles inside jar
  const marbleColors = [BUTTON_CYAN, BUTTON_MAGENTA, BUTTON_YELLOW, BUTTON_LIME, BUTTON_ORANGE];
  const marbleGeom = new SphereGeometry(1.4, 8, 8);
  for (let m = 0; m < 18; m += 1) {
    const c = marbleColors[m % marbleColors.length];
    const mMat = new MeshBasicMaterial({ color: c });
    const marble = new Mesh(marbleGeom, mMat);
    const ang = rng() * Math.PI * 2;
    const rad = rng() * 4.2;
    marble.position.set(Math.cos(ang) * rad, 1.6 + rng() * 11, Math.sin(ang) * rad);
    jarGroup.add(marble);
  }
  group.add(jarGroup);

  // 3. Giant Scissors stuck into an eraser
  const scissorGroup = new Group();
  scissorGroup.position.set(-42, 0, 30);
  const eraserBlockGeom = new BoxGeometry(10, 4, 16);
  const eraserMat = new MeshBasicMaterial({ color: ERASER_PINK });
  const eraser = new Mesh(eraserBlockGeom, eraserMat);
  eraser.position.y = 2;
  scissorGroup.add(eraser);

  // Scissor blades
  const bladeGeom = new BoxGeometry(0.8, 28, 2.5);
  const bladeMat = new MeshBasicMaterial({ color: STEEL_METAL });
  const blade1 = new Mesh(bladeGeom, bladeMat);
  blade1.position.set(0, 14, 0);
  blade1.rotation.z = 0.15;
  const blade2 = new Mesh(bladeGeom, bladeMat);
  blade2.position.set(0, 14, 0);
  blade2.rotation.z = -0.15;
  scissorGroup.add(blade1, blade2);
  group.add(scissorGroup);

  // 4. Sketchbooks & Blueprints
  const bookGeom = new BoxGeometry(24, 2.5, 32);
  const bookMat = new MeshBasicMaterial({ color: CARDBOARD_DARK });
  const book = new Mesh(bookGeom, bookMat);
  book.position.set(-10, 1.25, -42);
  book.rotation.y = 0.3;
  group.add(book);

  // 5. Spools of colored thread standing tall
  const spoolColors = [BUTTON_CYAN, BUTTON_MAGENTA, BUTTON_ORANGE, BUTTON_PURPLE];
  for (let s = 0; s < 4; s += 1) {
    const spoolGroup = new Group();
    const rimGeom = new CylinderGeometry(3.2, 3.2, 0.8, 12);
    const rimMat = new MeshBasicMaterial({ color: SPOOL_WOOD });
    const topRim = new Mesh(rimGeom, rimMat);
    topRim.position.y = 7.6;
    const botRim = new Mesh(rimGeom, rimMat);
    botRim.position.y = 0.4;
    const coreGeom = new CylinderGeometry(2.4, 2.4, 6.8, 12);
    const coreMat = new MeshBasicMaterial({ color: spoolColors[s] });
    const core = new Mesh(coreGeom, coreMat);
    spoolGroup.add(topRim, botRim, core);
    spoolGroup.position.set(24 + s * 7, 0, 8 - s * 10);
    group.add(spoolGroup);
  }

  return group;
}

// ---- Rail Scatter Field ----
function createRailScatterField(curve: CatmullRomCurve3, rng: Rng): ScatterField {
  const buttonColors = [BUTTON_CYAN, BUTTON_MAGENTA, BUTTON_YELLOW, BUTTON_LIME, BUTTON_ORANGE, BUTTON_PURPLE];

  // Pre-created geometries for scatter items
  const buttonGeom = new CylinderGeometry(0.65, 0.65, 0.2, 10);
  const pinGeom = new CylinderGeometry(0.08, 0.08, 1.8, 6);
  const clipGeom = new TorusGeometry(0.6, 0.1, 6, 12, Math.PI * 1.6);
  const shavingGeom = new BoxGeometry(1.2, 0.1, 0.8);
  const blockGeom = new BoxGeometry(1.4, 1.4, 1.4);

  const field = scatterAlongRail(curve, {
    count: 72,
    window: { behind: 25, ahead: 140 },
    seed: 98765,
    place(index, placeRng) {
      const u = index / 72;
      const x = (placeRng() - 0.5) * 18 + (placeRng() > 0.5 ? 4 : -4);
      const y = (placeRng() - 0.5) * 8 - 1.5;
      const z = (placeRng() - 0.5) * 12;
      return { u, offset: new Vector3(x, y, z) };
    },
    make(index, makeRng) {
      const type = index % 5;
      const color = buttonColors[Math.floor(makeRng() * buttonColors.length)];
      let mesh: Mesh;

      if (type === 0) {
        mesh = new Mesh(buttonGeom, new MeshBasicMaterial({ color }));
      } else if (type === 1) {
        mesh = new Mesh(pinGeom, new MeshBasicMaterial({ color: makeRng() > 0.5 ? BRASS_METAL : STEEL_METAL }));
      } else if (type === 2) {
        mesh = new Mesh(clipGeom, new MeshBasicMaterial({ color: STEEL_METAL }));
      } else if (type === 3) {
        mesh = new Mesh(shavingGeom, new MeshBasicMaterial({ color: PENCIL_WOOD }));
      } else {
        mesh = new Mesh(blockGeom, new MeshBasicMaterial({ color: makeRng() > 0.5 ? CARDBOARD_KRAFT : PENCIL_YELLOW }));
      }

      mesh.userData.raildIgnoreOcclusion = true;
      mesh.rotation.set(makeRng() * Math.PI, makeRng() * Math.PI, makeRng() * Math.PI);
      return mesh;
    },
  });

  field.group.userData.raildIgnoreOcclusion = true;
  return field;
}
