import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { cameraPosition, float, fract, normalWorld, positionLocal, positionWorld, time, uniform, vec3 } from 'three/tsl';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import {
  CRIMSON_FIRE,
  CRIMSON_WINDOW,
  CYAN_ENGINE,
  CYAN_WINDOW,
  ICE_HULL,
  ICE_SHADOW,
  MOLTEN_ORANGE,
  NEBULA_GOLD,
  OBSIDIAN,
  OBSIDIAN_LIT,
  hdr,
  mulberry32,
  type Rng,
} from './palette';

// The fleets. Every capital ship is one idea read at three scales: a dark
// hull silhouette against the nebula, a rim of faction light on its edges,
// and a scatter of lit windows that gives it kilometer scale. Friendly hulls
// are pale ice with cyan engines and windows; enemy hulls are obsidian with
// molten-orange seams and crimson light. Meshes are merged hard — a cruiser
// is a handful of draw calls.

export type Faction = 'friendly' | 'enemy';

export type ShipMaterials = {
  hull: MeshBasicMaterial;
  shadow: MeshBasicMaterial;
  glow: MeshBasicNodeMaterial;
  rim: MeshBasicMaterial;
};

export type CruiserMesh = {
  group: Group;
  engineMaterials: MeshBasicMaterial[];
  glowMaterial: MeshBasicNodeMaterial;
};

function factionColors(faction: Faction) {
  return faction === 'friendly'
    ? {
      hull: ICE_HULL.clone().multiplyScalar(0.4),
      shadow: ICE_SHADOW.clone().multiplyScalar(0.7),
      engine: CYAN_ENGINE,
      window: CYAN_WINDOW,
      rim: new Color(0.7, 0.95, 1.0),
      seam: CYAN_ENGINE,
    }
    : {
      hull: OBSIDIAN.clone(),
      shadow: OBSIDIAN_LIT.clone().multiplyScalar(0.8),
      engine: CRIMSON_FIRE,
      window: CRIMSON_WINDOW,
      rim: MOLTEN_ORANGE,
      seam: MOLTEN_ORANGE,
    };
}

// Windows and running lights: one merged additive mesh whose TSL shader
// dashes the local z axis into lit rows that wander with time — the hull
// reads inhabited and enormous for one draw call.
function makeGlowMaterial(color: Color, intensity: number) {
  const material = new MeshBasicNodeMaterial(additiveMaterialParameters({}));
  const dash = fract(positionLocal.z.mul(0.021).add(fract(positionLocal.y.mul(0.37)).mul(0.5))).pow(3.5);
  const wander = float(0.55).add(time.mul(0.35).sin().mul(0.2));
  material.colorNode = vec3(color.r, color.g, color.b).mul(dash.mul(intensity).add(0.12)).mul(wander.add(0.6));
  return material;
}

type BoxSpec = [w: number, h: number, d: number, x: number, y: number, z: number, ry?: number];

function mergeBoxes(specs: readonly BoxSpec[]): BufferGeometry {
  const geometries = specs.map(([w, h, d, x, y, z, ry]) => {
    const geometry = new BoxGeometry(w, h, d);
    const matrix = new Matrix4();
    if (ry) matrix.makeRotationY(ry);
    matrix.setPosition(x, y, z);
    geometry.applyMatrix4(matrix);
    return geometry;
  });
  const merged = mergeGeometries(geometries);
  for (const geometry of geometries) geometry.dispose();
  return merged;
}

// The shared cruiser grammar: spearhead bow, long armored midsection,
// superstructure amidships, engine block astern. Scale and dressing vary by
// variant; the silhouette stays naval.
export function createCruiserMesh(options: { faction: Faction; length: number; variant: 'carrier' | 'cruiser' | 'wreck' | 'distant'; rng?: Rng }): CruiserMesh {
  const { faction, length, variant, rng = mulberry32(90210) } = options;
  const colors = factionColors(faction);
  const group = new Group();
  const L = length;
  const beam = L * 0.11;
  const tall = L * 0.085;

  const hullSpecs: BoxSpec[] = [];
  const shadowSpecs: BoxSpec[] = [];
  const glowSpecs: BoxSpec[] = [];
  const rimSpecs: BoxSpec[] = [];

  if (variant === 'distant') {
    hullSpecs.push([beam, tall, L * 0.8, 0, 0, 0]);
    hullSpecs.push([beam * 0.7, tall * 0.7, L * 0.3, 0, tall * 0.5, -L * 0.15]);
    rimSpecs.push([1.6, 1.6, L * 0.8, 0, tall * 0.55, 0]);
  } else if (variant === 'wreck') {
    // A mid-section with the bow torn off; jagged plates cant outward.
    hullSpecs.push([beam, tall, L * 0.42, 0, 0, -L * 0.1]);
    hullSpecs.push([beam * 0.8, tall * 0.7, L * 0.2, beam * 0.1, tall * 0.2, L * 0.16, 0.22]);
    hullSpecs.push([beam * 0.5, tall * 0.4, L * 0.16, -beam * 0.3, -tall * 0.3, L * 0.2, -0.3]);
    shadowSpecs.push([beam * 1.02, tall * 0.3, L * 0.3, 0, -tall * 0.4, -L * 0.12]);
  } else if (variant === 'carrier') {
    // The launch deck: a long flat-top with an island to starboard.
    hullSpecs.push([beam * 1.5, tall * 0.55, L, 0, 0, 0]); // main deck slab
    hullSpecs.push([beam * 0.9, tall * 0.9, L * 0.92, 0, -tall * 0.72, 0]); // hangar body
    hullSpecs.push([beam * 0.28, tall * 0.5, L * 0.24, beam * 0.62, tall * 0.62, -L * 0.1]); // island
    shadowSpecs.push([beam * 0.2, tall * 0.4, L * 0.5, -beam * 0.5, -tall * 0.3, L * 0.1]);
    // Catapult groove and deck-edge lights: the launch run the camera rides.
    rimSpecs.push([1.2, 0.5, L * 0.9, 0, tall * 0.3, 0]);
    rimSpecs.push([0.8, 0.4, L * 0.9, -beam * 0.72, tall * 0.3, 0]);
    rimSpecs.push([0.8, 0.4, L * 0.9, beam * 0.72, tall * 0.3, 0]);
    for (let i = 0; i < 30; i += 1) {
      const z = -L * 0.44 + (i / 29) * L * 0.88;
      glowSpecs.push([1.6, 0.3, 3.2, (i % 2 === 0 ? -1 : 1) * beam * 0.5, tall * 0.32, z]);
    }
  } else {
    // cruiser: the workhorse hull.
    hullSpecs.push([beam, tall, L * 0.62, 0, 0, -L * 0.1]); // midsection
    hullSpecs.push([beam * 0.86, tall * 0.8, L * 0.2, 0, tall * 0.1, L * 0.26]); // forward section
    hullSpecs.push([beam * 0.6, tall * 0.62, L * 0.12, 0, tall * 0.24, -L * 0.32]); // engine block
    hullSpecs.push([beam * 0.42, tall * 0.8, L * 0.12, 0, tall * 0.72, -L * 0.06]); // bridge tower
    shadowSpecs.push([beam * 1.04, tall * 0.28, L * 0.5, 0, -tall * 0.42, -L * 0.06]); // belly armor
    shadowSpecs.push([beam * 0.5, tall * 0.3, L * 0.2, beam * 0.6, -tall * 0.1, L * 0.05]); // sponsons
    shadowSpecs.push([beam * 0.5, tall * 0.3, L * 0.2, -beam * 0.6, -tall * 0.1, L * 0.05]);
    // Dorsal rim and bow streaks.
    rimSpecs.push([1.4, 0.9, L * 0.58, 0, tall * 0.52, -L * 0.1]);
    rimSpecs.push([0.8, 0.8, L * 0.18, beam * 0.3, tall * 0.3, L * 0.3]);
    rimSpecs.push([0.8, 0.8, L * 0.18, -beam * 0.3, tall * 0.3, L * 0.3]);
    // Keel line: a molten seam under the belly armor so the hull's mass
    // still reads when the rail runs beneath her.
    rimSpecs.push([1.0, 0.7, L * 0.5, 0, -tall * 0.58, -L * 0.06]);
    // Window rows along the flanks: two bands so a broadside flank reads
    // inhabited rather than a flat slab.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 26; i += 1) {
        const z = -L * 0.36 + (i / 25) * L * 0.66;
        const y = (rng() - 0.5) * tall * 0.4;
        glowSpecs.push([0.7, 1.0 + rng() * 1.4, 2.6, side * (beam * 0.51), y, z]);
        if (i % 2 === 0) {
          glowSpecs.push([0.6, 0.8 + rng() * 0.9, 2.2, side * (beam * 0.51), y + tall * 0.26, z + 1.4]);
        }
      }
      // Armor ribs: vertical shadow plates breaking up the slab.
      for (let i = 0; i < 9; i += 1) {
        const z = -L * 0.34 + (i / 8) * L * 0.6;
        shadowSpecs.push([0.9, tall * 0.7, 3.5 + rng() * 3, side * (beam * 0.505), -tall * 0.04, z]);
      }
    }
    // Turret clusters: dark boxes along the dorsal line.
    for (let i = 0; i < 6; i += 1) {
      const z = -L * 0.3 + (i / 5) * L * 0.5;
      shadowSpecs.push([beam * 0.14, tall * 0.2, L * 0.03, beam * 0.3, tall * 0.55, z]);
      shadowSpecs.push([beam * 0.14, tall * 0.2, L * 0.03, -beam * 0.3, tall * 0.55, z]);
    }
    // Engine mouths.
    for (const side of [-1, 0, 1]) {
      glowSpecs.push([beam * 0.2, tall * 0.18, 2.2, side * beam * 0.3, 0, -L * 0.385]);
    }
  }

  const hull = new Mesh(mergeBoxes(hullSpecs), new MeshBasicMaterial({ color: colors.hull }));
  group.add(hull);
  if (shadowSpecs.length > 0) group.add(new Mesh(mergeBoxes(shadowSpecs), new MeshBasicMaterial({ color: colors.shadow })));
  if (rimSpecs.length > 0) {
    // Friendly rims run dimmer: the ice hull is already bright, and a hot
    // cyan rim blooms into a halo that washes her panels out.
    const rimIntensity = variant === 'distant' ? 0.5 : faction === 'friendly' ? 0.5 : 0.85;
    group.add(new Mesh(mergeBoxes(rimSpecs), createAdditiveBasicMaterial({ color: hdr(colors.rim, rimIntensity) })));
  }

  const engineMaterials: MeshBasicMaterial[] = [];
  let glowMaterial: MeshBasicNodeMaterial;
  if (variant !== 'distant') {
    glowMaterial = makeGlowMaterial(colors.window, faction === 'friendly' ? 0.8 : 0.9);
    if (glowSpecs.length > 0) group.add(new Mesh(mergeBoxes(glowSpecs), glowMaterial));
    // Engines: additive cones at the stern, color-coded by fleet.
    if (variant === 'cruiser') {
      for (const side of [-1, 0, 1]) {
        const material = createAdditiveBasicMaterial({ color: hdr(colors.engine, 1.3) });
        const engine = new Mesh(new ConeGeometry(beam * 0.1, L * 0.06, 8), material);
        engine.rotation.x = -Math.PI / 2;
        engine.position.set(side * beam * 0.3, 0, -L * 0.41);
        group.add(engine);
        engineMaterials.push(material);
      }
    }
  } else {
    glowMaterial = makeGlowMaterial(colors.window, 0.4);
  }

  group.userData.engineMaterials = engineMaterials;
  return { group, engineMaterials, glowMaterial };
}

// ---- SOVEREIGN, the enemy flagship ------------------------------------------------
//
// Built in world-local space: the mesh origin is her center and the axes are
// world axes (bow toward +Z, port toward -X), because the rail wraps around
// her. Sections are separate groups so she can break apart when her heart
// goes.

export type FlagshipMesh = {
  group: Group;
  sections: { bow: Group; mid: Group; stern: Group };
  seamMaterials: MeshBasicMaterial[];
  engineMaterials: MeshBasicMaterial[];
  bayMaterials: MeshBasicMaterial[];
  windowMaterial: MeshBasicNodeMaterial;
};

export type FlagshipLayout = {
  beam: number;
  height: number;
  dorsalY: number; // world
  trenchFloorY: number; // world
  trenchHalfWidth: number;
  trenchZFrom: number; // world
  trenchZTo: number; // world
  center: Vector3;
};

export function createFlagshipMesh(layout: FlagshipLayout) {
  const group = new Group();
  group.position.copy(layout.center);
  const L = 620;
  const beam = layout.beam;
  const tall = layout.height;
  const toLocal = (worldY: number) => worldY - layout.center.y;
  const toLocalZ = (worldZ: number) => worldZ - layout.center.z;

  const seamMaterials: MeshBasicMaterial[] = [];
  const engineMaterials: MeshBasicMaterial[] = [];
  const bayMaterials: MeshBasicMaterial[] = [];

  const seam = (intensity: number) => {
    const material = createAdditiveBasicMaterial({ color: hdr(MOLTEN_ORANGE, intensity) });
    seamMaterials.push(material);
    return material;
  };

  // -- stern section: engine block, bay, astern armor -------------------------------
  const stern = new Group();
  const sternHull = new Mesh(mergeBoxes([
    [beam, tall * 0.8, L * 0.3, 0, toLocal(26), toLocalZ(layout.center.z - L * 0.36)],
    [beam * 0.8, tall * 0.5, L * 0.12, 0, toLocal(34), toLocalZ(layout.center.z - L * 0.47)],
    [beam * 0.7, tall * 0.42, L * 0.1, 0, toLocal(14), toLocalZ(layout.center.z - L * 0.44)],
  ]), new MeshBasicMaterial({ color: OBSIDIAN }));
  sternHull.name = 'sov-stern-hull';
  stern.add(sternHull);
  // Engine mouths: a bank of crimson cones.
  for (let i = 0; i < 5; i += 1) {
    const x = (i - 2) * beam * 0.18;
    const material = createAdditiveBasicMaterial({ color: hdr(CRIMSON_FIRE, 1.4) });
    const engine = new Mesh(new ConeGeometry(beam * 0.07, 26, 8), material);
    engine.rotation.x = -Math.PI / 2;
    engine.position.set(x, toLocal(26), toLocalZ(layout.center.z - L * 0.5) - 12);
    stern.add(engine);
    engineMaterials.push(material);
  }
  // Stern hangar bay: a glowing mouth the screen-phase escorts pour from.
  const sternBayMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN_ORANGE, 1.2) });
  const sternBay = new Mesh(new BoxGeometry(beam * 0.4, tall * 0.16, 2.5), sternBayMaterial);
  sternBay.position.set(0, toLocal(22), toLocalZ(layout.center.z - L * 0.5) + 1);
  stern.add(sternBay);
  bayMaterials.push(sternBayMaterial);
  const sternBayFrame = new Mesh(mergeBoxes([
    [beam * 0.46, 2, 6, 0, toLocal(22) + tall * 0.1, toLocalZ(layout.center.z - L * 0.5) + 2],
    [beam * 0.46, 2, 6, 0, toLocal(22) - tall * 0.1, toLocalZ(layout.center.z - L * 0.5) + 2],
  ]), new MeshBasicMaterial({ color: OBSIDIAN_LIT }));
  stern.add(sternBayFrame);
  // Stern-quarter dressing: the rail wraps this face during the swing, so
  // it needs the same inhabited read as the port flank — window rows,
  // quarter seams, transom facets.
  const sternWindows: BoxSpec[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 10; i += 1) {
      sternWindows.push([
        0.8, 1.0 + (i % 3) * 0.5, 2.8,
        side * (beam / 2 + 0.6), toLocal(18 + (i % 3) * 9), -L * 0.47 + i * L * 0.024,
      ]);
    }
    const quarterSeam = new Mesh(new BoxGeometry(0.9, 0.9, L * 0.22), seam(0.5));
    quarterSeam.position.set(side * (beam / 2 + 1.2), toLocal(42), -L * 0.37);
    stern.add(quarterSeam);
  }
  const sternGlow = new Mesh(mergeBoxes(sternWindows), makeGlowMaterial(CRIMSON_WINDOW, 0.9));
  stern.add(sternGlow);
  const transomFacets = new Mesh(mergeBoxes([
    [beam * 0.22, tall * 0.16, 2, -beam * 0.26, toLocal(34), -L * 0.505],
    [beam * 0.18, tall * 0.2, 2, beam * 0.28, toLocal(24), -L * 0.505],
    [beam * 0.16, tall * 0.12, 2, beam * 0.02, toLocal(44), -L * 0.505],
  ]), new MeshBasicMaterial({ color: OBSIDIAN_LIT }));
  stern.add(transomFacets);
  group.add(stern);

  // -- mid section: the long armored flank, trenches, and the port face -------------
  const mid = new Group();
  // The spine trench is a genuine cut through the mid hull: an aft cap plus
  // port/starboard slabs that flank the corridor. (The former third "upper"
  // box was fully enclosed by the main one — dead geometry.) Sightlines down
  // the cut now cross no hull faces, which the trench targets rely on.
  const midMainLen = L * 0.46;
  const midMainZ = toLocalZ(layout.center.z - L * 0.05);
  const midAftZ = midMainZ - midMainLen / 2;
  const cutLocalFrom = toLocalZ(layout.trenchZFrom);
  const slabHalf = layout.trenchHalfWidth + 5.3; // wall box + clearance
  const slabWidth = beam / 2 - slabHalf;
  const slabCenterX = slabHalf + slabWidth / 2;
  const slabLen = midMainZ + midMainLen / 2 - cutLocalFrom;
  const slabMidZ = (cutLocalFrom + midMainZ + midMainLen / 2) / 2;
  const midHull = new Mesh(mergeBoxes([
    [beam, tall * 0.85, cutLocalFrom - midAftZ, 0, toLocal(28), (midAftZ + cutLocalFrom) / 2],
    [slabWidth, tall * 0.85, slabLen, slabCenterX, toLocal(28), slabMidZ],
    [slabWidth, tall * 0.85, slabLen, -slabCenterX, toLocal(28), slabMidZ],
    [beam * 0.85, tall * 0.5, L * 0.4, 0, toLocal(8), toLocalZ(layout.center.z - L * 0.02)],
  ]), new MeshBasicMaterial({ color: OBSIDIAN }));
  midHull.name = 'sov-mid-hull';
  mid.add(midHull);
  // Dorsal ridge plates flanking the trench.
  const trenchFrom = toLocalZ(layout.trenchZFrom);
  const trenchTo = toLocalZ(layout.trenchZTo);
  const trenchLength = layout.trenchZTo - layout.trenchZFrom;
  const trenchMid = (trenchFrom + trenchTo) / 2;
  const rimY = toLocal(layout.dorsalY);
  const floorY = toLocal(layout.trenchFloorY);
  for (const side of [-1, 1]) {
    const wall = new Mesh(
      new BoxGeometry(5, rimY - floorY + 8, trenchLength),
      new MeshBasicMaterial({ color: OBSIDIAN_LIT }),
    );
    wall.name = 'sov-trench-wall';
    wall.position.set(side * (layout.trenchHalfWidth + 2.5), (rimY + floorY) / 2, trenchMid);
    mid.add(wall);
    // Wall cap rim: molten light along the trench lip.
    const lip = new Mesh(new BoxGeometry(1.4, 1.2, trenchLength), seam(0.8));
    lip.position.set(side * (layout.trenchHalfWidth + 2.5), rimY + 1, trenchMid);
    mid.add(lip);
    // Buttresses across the trench every ~40 units: the dive threads them.
    for (let i = 0; i < 4; i += 1) {
      const z = layout.trenchZFrom + 24 + i * 44;
      const buttress = new Mesh(new BoxGeometry(layout.trenchHalfWidth * 2 + 10, 1.6, 3.2), new MeshBasicMaterial({ color: OBSIDIAN }));
      buttress.name = 'sov-buttress';
      buttress.position.set(0, rimY + 2.5, toLocalZ(z));
      mid.add(buttress);
    }
  }
  // Trench floor glow: reactor light seeping up through the deck seams — a
  // guide line down the cut, not a floor.
  const trenchGlow = new Mesh(new BoxGeometry(3, 0.8, trenchLength), seam(0.38));
  trenchGlow.position.set(0, floorY - 0.5, trenchMid);
  mid.add(trenchGlow);

  // Port-flank dressing: armor facets, seams, PD mounts, the hangar bay.
  const portX = -beam / 2;
  const facets: BoxSpec[] = [];
  for (let i = 0; i < 9; i += 1) {
    const z = -L * 0.32 + i * L * 0.075;
    facets.push([3, tall * (0.2 + (i % 3) * 0.08), L * 0.05, portX - 1.5, toLocal(30 + (i % 2) * 12), z, 0.08 * (i % 2 === 0 ? 1 : -1)]);
  }
  mid.add(new Mesh(mergeBoxes(facets), new MeshBasicMaterial({ color: OBSIDIAN_LIT })));
  for (let i = 0; i < 4; i += 1) {
    const strip = new Mesh(new BoxGeometry(0.9, 0.9, L * 0.3), seam(0.5));
    strip.position.set(portX - 2.4, toLocal(18 + i * 12), toLocalZ(layout.center.z - L * 0.08 + (i % 2) * 20));
    mid.add(strip);
  }
  // Point-defense mounts along the port flank.
  for (let i = 0; i < 6; i += 1) {
    const z = -L * 0.3 + i * L * 0.1;
    const mount = new Mesh(new CylinderGeometry(1.4, 1.9, 2.2, 6), new MeshBasicMaterial({ color: OBSIDIAN_LIT }));
    mount.position.set(portX - 2, toLocal(i % 2 === 0 ? 52 : 30), z);
    mid.add(mount);
    const tip = new Mesh(new SphereGeometry(0.7, 6, 5), seam(0.9));
    tip.position.set(portX - 2.6, toLocal(i % 2 === 0 ? 54 : 32), z);
    mid.add(tip);
  }
  // Port hangar bay: phase-1 escorts launch here.
  const portBayMaterial = createAdditiveBasicMaterial({ color: hdr(MOLTEN_ORANGE, 1.15) });
  const portBay = new Mesh(new BoxGeometry(2.5, tall * 0.14, beam * 0.4), portBayMaterial);
  portBay.position.set(portX - 2.2, toLocal(30), toLocalZ(layout.center.z + L * 0.18));
  mid.add(portBay);
  bayMaterials.push(portBayMaterial);

  // -- bow section: the spearhead and command towers the pull-out climbs over ------
  const bow = new Group();
  const bowHull = new Mesh(mergeBoxes([
    [beam * 0.9, tall * 0.75, L * 0.24, 0, toLocal(28), toLocalZ(layout.center.z + L * 0.36)],
    [beam * 0.6, tall * 0.5, L * 0.12, 0, toLocal(30), toLocalZ(layout.center.z + L * 0.47)],
  ]), new MeshBasicMaterial({ color: OBSIDIAN }));
  bowHull.name = 'sov-bow-hull';
  bow.add(bowHull);
  const spear = new Mesh(new ConeGeometry(beam * 0.3, L * 0.14, 4), new MeshBasicMaterial({ color: OBSIDIAN_LIT }));
  spear.rotation.x = Math.PI / 2;
  spear.scale.set(1, 0.55, 1);
  spear.position.set(0, toLocal(30), toLocalZ(layout.center.z + L * 0.55));
  bow.add(spear);
  // Command towers amidships-forward.
  const towers = new Mesh(mergeBoxes([
    [beam * 0.3, tall * 0.55, L * 0.06, 0, toLocal(66), toLocalZ(layout.center.z + L * 0.16)],
    [beam * 0.2, tall * 0.4, L * 0.045, beam * 0.2, toLocal(60), toLocalZ(layout.center.z + L * 0.22)],
    [beam * 0.2, tall * 0.34, L * 0.05, -beam * 0.22, toLocal(58), toLocalZ(layout.center.z + L * 0.1)],
  ]), new MeshBasicMaterial({ color: OBSIDIAN }));
  towers.name = 'sov-towers';
  bow.add(towers);
  const towerRim = new Mesh(new BoxGeometry(1.2, tall * 0.5, 1.2), seam(0.85));
  towerRim.position.set(beam * 0.15, toLocal(70), toLocalZ(layout.center.z + L * 0.16));
  bow.add(towerRim);
  // Bow running lights.
  for (let i = 0; i < 3; i += 1) {
    const lamp = new Mesh(new BoxGeometry(1.4, 1.4, 6), seam(0.8));
    lamp.position.set((i - 1) * beam * 0.25, toLocal(40), toLocalZ(layout.center.z + L * 0.44));
    bow.add(lamp);
  }
  group.add(bow);
  group.add(mid);

  // Crimson window band running her full length.
  const windowMaterial = makeGlowMaterial(CRIMSON_WINDOW, 0.8);
  const windowSpecs: BoxSpec[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 40; i += 1) {
      const z = -L * 0.44 + (i / 39) * L * 0.86;
      windowSpecs.push([0.9, 1.2 + (i % 3), 3.4, side * (beam * 0.51), toLocal(26 + ((i * 7) % 18)), z]);
    }
  }
  group.add(new Mesh(mergeBoxes(windowSpecs), windowMaterial));

  // The keel seam: one long molten line so she reads from beneath.
  const keel = new Mesh(new BoxGeometry(1.4, 1.2, L * 0.8), seam(0.7));
  keel.position.set(0, toLocal(2), toLocalZ(layout.center.z - L * 0.02));
  group.add(keel);

  return { group, sections: { bow, mid, stern }, seamMaterials, engineMaterials, bayMaterials, windowMaterial } satisfies FlagshipMesh;
}

// ---- shield dome -------------------------------------------------------------------

export const shieldStrengthUniform = uniform(1);
export const shieldFlickerUniform = uniform(0);

// The flagship's shield bubble: an ellipsoid shell seen from inside, all
// fresnel rim in angry orange-crimson. `strength` fades it as the generators
// die; `flicker` is the impact shimmer.
export function createShieldDomeMesh() {
  const material = new MeshBasicNodeMaterial(additiveMaterialParameters({ side: BackSide, fog: false }));
  const view = cameraPosition.sub(positionWorld).normalize();
  // Tight rim: the bubble reads at its edge, and the interior view through
  // the shell keeps only a whisper of tint.
  const fresnel = float(1).sub(normalWorld.dot(view).abs()).pow(3.2);
  const scan = fract(positionLocal.y.mul(0.012).sub(time.mul(0.11))).pow(8).mul(0.5).add(0.75);
  const base = vec3(MOLTEN_ORANGE.r, MOLTEN_ORANGE.g, MOLTEN_ORANGE.b).mul(0.6)
    .add(vec3(CRIMSON_FIRE.r, CRIMSON_FIRE.g, CRIMSON_FIRE.b).mul(0.4));
  material.colorNode = base
    .mul(fresnel.mul(0.55).add(shieldFlickerUniform.mul(0.6)))
    .mul(scan)
    .mul(shieldStrengthUniform);
  const dome = new Mesh(new SphereGeometry(1, 42, 26), material);
  dome.scale.set(120, 105, 375);
  dome.frustumCulled = false;
  dome.userData.raildIgnoreOcclusion = true;
  return dome;
}

// A molten glow color for wreck fires.
export const WRECK_FIRE = hdr(NEBULA_GOLD, 0.9);
