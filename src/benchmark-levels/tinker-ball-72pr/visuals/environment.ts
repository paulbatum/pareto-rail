import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Fog,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Points,
  PointsMaterial,
  Scene,
  TorusGeometry,
  Vector3,
} from 'three';
import { mulberry32 } from '../../../engine/rng';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  AMBER,
  BACKGROUND,
  BEAD_BLUE,
  BUTTON_RED,
  BUTTON_TEAL,
  BUTTON_YELLOW,
  CARDBOARD,
  CREAM,
  ERASER_PINK,
  hdr,
  LAMP,
  PENCIL,
  WOOD,
  WOOD_DARK,
} from './palette';

export type Environment = {
  root: Group;
  update(dt: number, beat: number): void;
};

// One oversized cluttered worktable, marble-scale at the start and
// melon-scale by the finale. The tabletop is honey wood under two warm
// desk-lamp pools; scratches read as roads. Supplies scale up along the
// route: buttons/pins/beads/paperclips early, spools/erasers/paint pots
// mid-route, rulers/jars/cardboard late.
export function createEnvironmentInternal(scene: Scene): Environment {
  scene.background = BACKGROUND.clone();
  scene.fog = new Fog(BACKGROUND.clone(), 70, 250);
  const root = new Group();
  const rng = mulberry32(0x72aa11);

  // --- Tabletop -------------------------------------------------------------
  const table = new Mesh(new BoxGeometry(170, 2, 370), new MeshBasicMaterial({ color: WOOD.clone() }));
  table.position.set(0, -1.02, -160);
  root.add(table);
  // Wood grain: long darker streaks just above the surface.
  const grainPositions: number[] = [];
  const grainColors: number[] = [];
  const grain = new Color(0.26, 0.16, 0.08);
  for (let i = 0; i < 90; i += 1) {
    const x = (rng() - 0.5) * 160;
    const z = 20 - rng() * 360;
    const len = 20 + rng() * 60;
    grainPositions.push(x, 0.015, z, x + (rng() - 0.5) * 3, 0.015, z - len);
    for (let k = 0; k < 2; k += 1) grainColors.push(grain.r, grain.g, grain.b);
  }
  // Scratches: short bright nicks that read as roads at marble scale.
  const scratch = new Color(0.6, 0.48, 0.32);
  for (let i = 0; i < 150; i += 1) {
    const nearRail = rng() < 0.6;
    const x = nearRail ? (rng() - 0.5) * 44 : (rng() - 0.5) * 150;
    const z = 15 - rng() * 330;
    const angle = rng() * Math.PI;
    const len = 1 + rng() * 5;
    grainPositions.push(
      x, 0.02, z,
      x + Math.cos(angle) * len, 0.02, z + Math.sin(angle) * len,
    );
    const bright = 0.35 + rng() * 0.65;
    for (let k = 0; k < 2; k += 1) grainColors.push(scratch.r * bright, scratch.g * bright, scratch.b * bright);
  }
  const grainGeometry = new BufferGeometry();
  grainGeometry.setAttribute('position', new Float32BufferAttribute(grainPositions, 3));
  grainGeometry.setAttribute('color', new Float32BufferAttribute(grainColors, 3));
  const grainLines = new LineSegments(grainGeometry, new LineBasicMaterial(additiveMaterialParameters({ vertexColors: true })));
  grainLines.frustumCulled = false;
  root.add(grainLines);

  // --- Lamp pools + cones ----------------------------------------------------
  const glowMats: Array<{ material: MeshBasicMaterial; base: number }> = [];
  const pool = (x: number, z: number, radius: number, opacity: number) => {
    // Three stacked discs fake a soft radial falloff (no textures allowed).
    const steps: Array<[number, number]> = [[1, 0.45], [0.68, 0.75], [0.38, 1.4]];
    for (const [radiusScale, opacityScale] of steps) {
      const material = createAdditiveBasicMaterial({ color: hdr(LAMP, 0.85), opacity: opacity * opacityScale });
      const disc = new Mesh(new CircleGeometry(radius * radiusScale, 40), material);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(x, 0.04, z);
      root.add(disc);
      glowMats.push({ material, base: opacity * opacityScale });
    }
  };
  pool(-6, -60, 26, 0.1);
  pool(8, -170, 30, 0.09);
  pool(-2, -262, 22, 0.1);
  // Spotless finale patch: a clean pale disc where the run coasts out.
  const clean = new Mesh(
    new CircleGeometry(12, 40),
    new MeshBasicMaterial({ color: new Color(0.55, 0.42, 0.27) }),
  );
  clean.rotation.x = -Math.PI / 2;
  clean.position.set(0, 0.03, -272);
  root.add(clean);

  // Lamp heads hunch low over the table at the frame edges: dark
  // silhouettes with a hot bulb. (No volumetric cones: additive slabs
  // read as solid geometry from gameplay angles.)
  for (const [x, z, lean] of [[-40, -60, 0.9], [42, -170, -0.9]] as const) {
    const arm = new Mesh(new BoxGeometry(1.6, 15, 1.6), new MeshBasicMaterial({ color: WOOD_DARK.clone() }));
    arm.position.set(x * 1.12, 12, z - 4);
    arm.rotation.z = lean * 0.35;
    const shade = new Mesh(new CylinderGeometry(2.6, 4, 5, 14), new MeshBasicMaterial({ color: WOOD_DARK.clone() }));
    shade.position.set(x, 9, z);
    shade.rotation.z = lean * 0.55;
    const bulb = new Mesh(new CylinderGeometry(1, 1, 0.7, 10), new MeshBasicMaterial({ color: hdr(LAMP, 2.4) }));
    bulb.position.set(x - lean * 1.8, 7.6, z);
    root.add(arm, shade, bulb);
  }

  // --- Small supplies (instanced): buttons, beads, pins, clips ---------------
  const dummy = new Object3D();
  const scatter = (mesh: InstancedMesh, count: number, place: (i: number) => void) => {
    for (let i = 0; i < count; i += 1) {
      place(i);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    root.add(mesh);
  };

  const corridorX = () => (rng() - 0.5) * 76;
  const corridorZ = () => 15 - rng() * 320;

  // Buttons with per-instance colors.
  const buttonMesh = new InstancedMesh(
    new CylinderGeometry(0.5, 0.54, 0.18, 14),
    new MeshBasicMaterial({ color: new Color(1, 1, 1) }),
    130,
  );
  const buttonPalette = [BUTTON_RED, BUTTON_TEAL, BUTTON_YELLOW, BEAD_BLUE, ERASER_PINK, CREAM];
  scatter(buttonMesh, 130, (i) => {
    dummy.position.set(corridorX(), 0.1, corridorZ());
    dummy.rotation.set(0, rng() * Math.PI, 0);
    const s = 0.7 + rng() * (i < 30 ? 1.6 : 0.7);
    dummy.scale.set(s, 1, s);
    buttonMesh.setColorAt(i, buttonPalette[(rng() * buttonPalette.length) | 0]);
  });

  // Beads.
  const beadMesh = new InstancedMesh(new CylinderGeometry(0.22, 0.22, 0.5, 8), new MeshBasicMaterial({ color: new Color(1, 1, 1) }), 110);
  const beadPalette = [BUTTON_RED, BUTTON_TEAL, BUTTON_YELLOW, BEAD_BLUE, CREAM];
  scatter(beadMesh, 110, (i) => {
    dummy.position.set(corridorX(), 0.22, corridorZ());
    dummy.rotation.set(Math.PI / 2, 0, rng() * Math.PI);
    dummy.scale.setScalar(0.7 + rng() * 0.9);
    beadMesh.setColorAt(i, beadPalette[(rng() * beadPalette.length) | 0]);
  });

  // Pins: needle shafts lying flat.
  const pinMesh = new InstancedMesh(new CylinderGeometry(0.045, 0.045, 2.2, 6), new MeshBasicMaterial({ color: CREAM.clone() }), 90);
  scatter(pinMesh, 90, () => {
    dummy.position.set(corridorX(), 0.06, corridorZ());
    dummy.rotation.set(Math.PI / 2, 0, rng() * Math.PI);
    dummy.scale.setScalar(0.8 + rng() * 0.8);
  });

  // Paperclips: small flat tori.
  const clipMesh = new InstancedMesh(new TorusGeometry(0.3, 0.055, 6, 12), new MeshBasicMaterial({ color: new Color(0.75, 0.78, 0.85) }), 60);
  scatter(clipMesh, 60, () => {
    dummy.position.set(corridorX(), 0.07, corridorZ());
    dummy.rotation.set(-Math.PI / 2, 0, rng() * Math.PI);
    dummy.scale.setScalar(0.8 + rng() * 1.2);
  });

  // --- Hero props, growing along the route ------------------------------------
  const prop = (m: Mesh, x: number, z: number, ry = 0) => {
    m.position.x += x;
    m.position.z += z;
    m.rotation.y = ry;
    root.add(m);
    return m;
  };
  const spoolAt = (x: number, z: number, thread: Color) => {
    const g = new Group();
    const top = new Mesh(new CylinderGeometry(1.3, 1.3, 0.3, 16), new MeshBasicMaterial({ color: WOOD.clone() }));
    top.position.y = 1.0;
    const bottom = top.clone();
    bottom.position.y = -1.0;
    const core = new Mesh(new CylinderGeometry(0.7, 0.7, 2.0, 12), new MeshBasicMaterial({ color: WOOD_DARK.clone() }));
    const windings = new Mesh(new CylinderGeometry(0.95, 0.95, 1.5, 14), new MeshBasicMaterial({ color: thread.clone() }));
    g.add(top, bottom, core, windings);
    g.position.set(x, 1.2, z);
    g.rotation.y = rng() * Math.PI;
    root.add(g);
  };
  const paintPotAt = (x: number, z: number, paint: Color) => {
    const g = new Group();
    const pot = new Mesh(new CylinderGeometry(1.1, 1.0, 1.6, 14), new MeshBasicMaterial({ color: CREAM.clone() }));
    pot.position.y = 0.8;
    const lid = new Mesh(new CylinderGeometry(1.15, 1.15, 0.2, 14), new MeshBasicMaterial({ color: BUTTON_RED.clone() }));
    lid.position.set(0.5, 0.25, 0.7);
    lid.rotation.z = 0.4;
    const surface = new Mesh(new CylinderGeometry(0.95, 0.95, 0.1, 14), new MeshBasicMaterial({ color: paint.clone() }));
    surface.position.y = 1.55;
    g.add(pot, lid, surface);
    g.position.set(x, 0, z);
    root.add(g);
  };
  const jarAt = (x: number, z: number) => {
    const g = new Group();
    const glass = new Mesh(new CylinderGeometry(1.6, 1.5, 3.2, 14), new MeshBasicMaterial({ color: new Color(0.55, 0.75, 0.85) }));
    glass.position.y = 1.6;
    const lid = new Mesh(new CylinderGeometry(1.65, 1.65, 0.35, 14), new MeshBasicMaterial({ color: BUTTON_RED.clone() }));
    lid.position.y = 3.3;
    const contents = new Mesh(new CylinderGeometry(1.3, 1.3, 0.8, 12), new MeshBasicMaterial({ color: BUTTON_YELLOW.clone() }));
    contents.position.y = 0.7;
    g.add(glass, lid, contents);
    g.position.set(x, 0, z);
    root.add(g);
  };

  // Early: oversized buttons + scattered pins near the start.
  for (const [x, z] of [[-5, -14], [5.5, -18], [0, -26]] as const) {
    const big = new Mesh(new CylinderGeometry(1.1, 1.15, 0.3, 16), new MeshBasicMaterial({ color: BUTTON_TEAL.clone() }));
    prop(big, x, z, rng());
  }
  spoolAt(-13, -52, BUTTON_RED);
  spoolAt(13, -66, BUTTON_TEAL);
  prop(new Mesh(new BoxGeometry(1.4, 0.6, 0.9), new MeshBasicMaterial({ color: ERASER_PINK.clone() })), 10, -84, 0.4);
  prop(new Mesh(new BoxGeometry(1.2, 0.5, 0.8), new MeshBasicMaterial({ color: CREAM.clone() })), -11, -96, 1.1);
  paintPotAt(-9, -118, BEAD_BLUE);
  paintPotAt(11, -132, BUTTON_RED);
  spoolAt(15, -152, BUTTON_YELLOW);
  prop(new Mesh(new BoxGeometry(1.8, 1.8, 1.8), new MeshBasicMaterial({ color: WOOD.clone() })), -12, -166, 0.3);
  prop(new Mesh(new BoxGeometry(1.6, 1.6, 1.6), new MeshBasicMaterial({ color: BUTTON_TEAL.clone() })), 9, -178, 0.9);
  jarAt(-21, -196);
  jarAt(21, -148);
  // Late: long rulers + cardboard structures for the melon finale.
  for (const [x, z, ry] of [[-17, -216, 0.25], [17, -232, -0.3], [-8, -252, 0.1]] as const) {
    const ruler = new Mesh(new BoxGeometry(9, 0.25, 1.2), new MeshBasicMaterial({ color: PENCIL.clone() }));
    prop(ruler, x, z, ry);
  }
  for (const [x, z, ry] of [[12, -222, 0.5], [-14, -244, 1.2], [6, -262, 0.2]] as const) {
    const card = new Mesh(new BoxGeometry(4.5, 2.6, 0.25), new MeshBasicMaterial({ color: CARDBOARD.clone() }));
    card.position.y = 1.3;
    prop(card, x, z, ry);
  }

  // --- Dust motes in the lamplight ---------------------------------------------
  const dustCount = 380;
  const dustPositions = new Float32Array(dustCount * 3);
  const dustColors = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i += 1) {
    dustPositions[i * 3] = (rng() - 0.5) * 60;
    dustPositions[i * 3 + 1] = 0.5 + rng() * 14;
    dustPositions[i * 3 + 2] = 10 - rng() * 300;
    const intensity = 0.1 + rng() * 0.35;
    dustColors[i * 3] = AMBER.r * intensity;
    dustColors[i * 3 + 1] = AMBER.g * intensity;
    dustColors[i * 3 + 2] = AMBER.b * intensity;
  }
  const dustGeometry = new BufferGeometry();
  dustGeometry.setAttribute('position', new Float32BufferAttribute(dustPositions, 3));
  dustGeometry.setAttribute('color', new Float32BufferAttribute(dustColors, 3));
  const dust = new Points(dustGeometry, new PointsMaterial(additiveMaterialParameters({ size: 0.14, vertexColors: true, sizeAttenuation: true })));
  dust.frustumCulled = false;
  root.add(dust);

  // --- Distant shelf silhouettes --------------------------------------------------
  for (const [x, z, w, h] of [[-70, -120, 18, 26], [72, -200, 22, 32], [-74, -260, 16, 22]] as const) {
    const shelf = new Mesh(new BoxGeometry(w, h, 10), new MeshBasicMaterial({ color: new Color(0.09, 0.06, 0.05) }));
    shelf.position.set(x, h / 2, z);
    root.add(shelf);
  }

  scene.add(root);

  return {
    root,
    update(_dt: number, beat: number) {
      const pulse = 1 + beat * 0.35;
      for (const glow of glowMats) glow.material.opacity = glow.base * pulse;
    },
  };
}
