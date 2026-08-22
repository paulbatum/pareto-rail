import {
  BoxGeometry,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Fog,
  Matrix4,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import type { CatmullRomCurve3 } from 'three';
import { scatterAlongRail, type ScatterField } from '../../../engine/environment-kit';
import { mulberry32 } from '../../../engine/rng';
import { sampleRailFrame, type RailFrame } from '../../../engine/rail';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { createBroadsideRail, progressAt } from '../gameplay';
import { CYAN, EMBER, FOE_HULL, FRIEND_HULL, GOLD, hdr, ICE, MAGENTA, VOID } from './palette';

// The two fleets. Every capital ship is a lofted run of octagonal ribs
// following the rail at a fixed lateral offset — kilometer-long silhouettes
// that read by their rim light: ice-white edges and cyan engines for the
// friendly fleet, molten-orange rims and engines for the enemy. Near-black
// hull panels occlude the nebula so the shapes feel solid; windows and
// running lights carry the color.

const BAR_SECONDS = 1.875;
const TRENCH_FROM = 54.8;
const TRENCH_TO = 59.45;
const TRENCH_TOP = 11;
const TRENCH_BOTTOM = -2.6;
const TRENCH_WALL_X = 5.4;

export type ShipHandle = {
  group: Group;
  faction: 'friend' | 'foe';
  /** Running lights that pulse in the environment update. */
  lights: MeshBasicMaterial[];
  /** Window material that ignites when the flagship burns. */
  burnable: MeshBasicMaterial | null;
};

type ShipSpec = {
  fromTime: number;
  toTime: number;
  right: number;
  up: number;
  halfW: number;
  halfH: number;
  faction: 'friend' | 'foe';
  seed: number;
  frames?: number;
  bowTaper?: boolean;
  dim?: number;
};

function panelGeometry(rings: Vector3[][]): BufferGeometry {
  const positions: number[] = [];
  for (let i = 0; i < rings.length - 1; i += 1) {
    const a = rings[i];
    const b = rings[i + 1];
    for (let k = 0; k < a.length; k += 1) {
      const k2 = (k + 1) % a.length;
      positions.push(
        a[k].x, a[k].y, a[k].z,
        a[k2].x, a[k2].y, a[k2].z,
        b[k2].x, b[k2].y, b[k2].z,
        a[k].x, a[k].y, a[k].z,
        b[k2].x, b[k2].y, b[k2].z,
        b[k].x, b[k].y, b[k].z,
      );
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

function stripGeometry(a: Vector3[], b: Vector3[]): BufferGeometry {
  return panelGeometry(a.map((point, i) => [point, b[i]]));
}

function segmentGeometry(points: Vector3[]): BufferGeometry {
  const positions = new Float32Array(Math.max(0, points.length - 1) * 6);
  for (let i = 0; i < points.length - 1; i += 1) {
    positions.set([points[i].x, points[i].y, points[i].z, points[i + 1].x, points[i + 1].y, points[i + 1].z], i * 6);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(Array.from(positions), 3));
  return geometry;
}

function lineMaterial(color: Color) {
  return new LineBasicMaterial(additiveMaterialParameters({ color }));
}

export function createCapitalShip(curve: CatmullRomCurve3, spec: ShipSpec): ShipHandle {
  const rng = mulberry32(spec.seed);
  const frameCount = spec.frames ?? 20;
  const progressStart = progressAt(Math.max(0, spec.fromTime));
  const progressEnd = Math.min(0.9999, progressAt(spec.toTime));
  const group = new Group();
  const friend = spec.faction === 'friend';
  const dim = spec.dim ?? 1;

  // Sampled rail frames plus taper, shared by every subsystem below.
  const samples: Array<{ frame: RailFrame; scale: number }> = [];
  for (let i = 0; i < frameCount; i += 1) {
    const t = i / (frameCount - 1);
    let scale = 1;
    if (spec.bowTaper && t > 0.72) scale = 1 - ((t - 0.72) / 0.28) ** 1.6 * 0.72;
    samples.push({
      frame: sampleRailFrame(curve, Math.min(0.9999, progressStart + (progressEnd - progressStart) * t)),
      scale,
    });
  }

  const octagonRings = samples.map(({ frame, scale }) =>
    [
      [0.55, 1], [1, 0.55], [1, -0.55], [0.55, -1],
      [-0.55, -1], [-1, -0.55], [-1, 0.55], [-0.55, 1],
    ].map(([fx, fy]) =>
      frame.position.clone()
        .addScaledVector(frame.right, spec.right + fx * spec.halfW * scale)
        .addScaledVector(frame.up, spec.up + fy * spec.halfH * scale),
    ),
  );

  const hullMesh = new Mesh(panelGeometry(octagonRings), new MeshBasicMaterial({
    color: friend ? FRIEND_HULL : FOE_HULL,
  }));
  group.add(hullMesh);

  // Rim light: longitudinal lines down every octagon corner plus rib hoops.
  const rimPoints: Vector3[] = [];
  const corners = octagonRings[0].length;
  for (let k = 0; k < corners; k += 1) {
    for (let i = 0; i < octagonRings.length - 1; i += 1) {
      rimPoints.push(octagonRings[i][k], octagonRings[i + 1][k]);
    }
  }
  for (let i = 2; i < octagonRings.length - 1; i += 4) {
    for (let k = 0; k < corners; k += 1) {
      rimPoints.push(octagonRings[i][k], octagonRings[i][(k + 1) % corners]);
    }
  }
  group.add(new LineSegments(segmentGeometry(rimPoints), lineMaterial(hdr(friend ? ICE : EMBER, 0.42 * dim))));

  // Windows: sparse dots scattered over both flanks, a few hot enough to bloom.
  const windowPositions: number[] = [];
  const windowColors: number[] = [];
  for (let i = 1; i < samples.length - 1; i += 2) {
    const { frame, scale } = samples[i];
    const count = 2 + Math.floor(rng() * 4);
    for (let w = 0; w < count; w += 1) {
      const side = rng() < 0.5 ? -1 : 1;
      const point = frame.position.clone()
        .addScaledVector(frame.right, spec.right + side * spec.halfW * scale)
        .addScaledVector(frame.up, spec.up + (rng() - 0.35) * spec.halfH * scale * 1.5);
      windowPositions.push(point.x, point.y, point.z);
      const hot = rng() < 0.08;
      const color = hdr(friend ? ICE : EMBER, hot ? 1.8 * dim : (0.25 + rng() * 0.3) * dim);
      windowColors.push(color.r, color.g, color.b);
    }
  }
  const windowGeometry = new BufferGeometry();
  windowGeometry.setAttribute('position', new Float32BufferAttribute(windowPositions, 3));
  windowGeometry.setAttribute('color', new Float32BufferAttribute(windowColors, 3));
  const windowMaterial = new PointsMaterial(additiveMaterialParameters({
    size: 0.65,
    vertexColors: true,
    sizeAttenuation: true,
    opacity: 0.95,
  }));
  const windows = new Points(windowGeometry, windowMaterial);
  windows.frustumCulled = false;
  group.add(windows);

  // Engines at the stern: bright discs facing backward with soft halos.
  const sternSample = samples[0];
  const engineColor = friend ? CYAN : EMBER;
  let burnable: MeshBasicMaterial | null = null;
  for (const offset of [-0.5, 0, 0.5]) {
    const discMaterial = createAdditiveBasicMaterial({ color: hdr(engineColor, 1.7 * dim), side: DoubleSide });
    const disc = new Mesh(new CircleGeometry(spec.halfH * 0.45, 14), discMaterial);
    disc.position.copy(sternSample.frame.position)
      .addScaledVector(sternSample.frame.right, spec.right + offset * spec.halfW)
      .addScaledVector(sternSample.frame.up, spec.up)
      .addScaledVector(sternSample.frame.tangent, -spec.halfH * 0.2);
    disc.quaternion.copy(discLookQuaternion(sternSample.frame));
    group.add(disc);
    const halo = new Mesh(new CircleGeometry(spec.halfH * 1.05, 14), createAdditiveBasicMaterial({
      color: hdr(engineColor, 0.32 * dim),
      side: DoubleSide,
      opacity: 0.5,
    }));
    halo.position.copy(disc.position);
    halo.quaternion.copy(disc.quaternion);
    halo.translateZ(-0.5);
    group.add(halo);
    if (offset === 0) burnable = discMaterial;
  }

  // Running lights along the spine.
  const lights: MeshBasicMaterial[] = [];
  const lampColor = friend ? ICE : CRIMSON_LAMP;
  for (let i = 3; i < samples.length - 2; i += 5) {
    const lampMaterial = new MeshBasicMaterial({ color: hdr(lampColor, 0.4 * dim) });
    const lamp = new Mesh(LAMP_GEOMETRY, lampMaterial);
    lamp.scale.set(0.34, 0.34, 1.8);
    const { frame, scale } = samples[i];
    lamp.position.copy(frame.position)
      .addScaledVector(frame.right, spec.right)
      .addScaledVector(frame.up, spec.up + spec.halfH * scale * 1.04);
    group.add(lamp);
    lights.push(lampMaterial);
  }

  return { group, faction: spec.faction, lights, burnable };
}

const CRIMSON_LAMP = new Color(1.0, 0.12, 0.08);
const LAMP_GEOMETRY = new BoxGeometry(1, 1, 1);

function discLookQuaternion(frame: RailFrame) {
  const basis = new Matrix4().makeBasis(frame.right.clone(), frame.up.clone(), frame.tangent.clone());
  return new Quaternion().setFromRotationMatrix(basis);
}

// --- the trench ---------------------------------------------------------------

export function createTrench(curve: CatmullRomCurve3): { group: Group; conductorMaterials: Array<{ color: Color }> } {
  const group = new Group();
  const conductorMaterials: Array<{ color: Color }> = [];
  const frameCount = 26;
  const progressStart = progressAt(TRENCH_FROM);
  const progressEnd = progressAt(TRENCH_TO);
  const frames: RailFrame[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    frames.push(sampleRailFrame(curve, progressStart + (progressEnd - progressStart) * (i / (frameCount - 1))));
  }

  const slabMaterial = new MeshBasicMaterial({ color: 0x0d0910, side: DoubleSide });

  // Two walls flanking the flight channel, plus a floor plate under the rail.
  for (const side of [-1, 1]) {
    const top: Vector3[] = [];
    const bottom: Vector3[] = [];
    for (const frame of frames) {
      top.push(frame.position.clone()
        .addScaledVector(frame.right, side * TRENCH_WALL_X)
        .addScaledVector(frame.up, TRENCH_TOP));
      bottom.push(frame.position.clone()
        .addScaledVector(frame.right, side * TRENCH_WALL_X)
        .addScaledVector(frame.up, TRENCH_BOTTOM));
    }
    group.add(new Mesh(stripGeometry(top, bottom), slabMaterial));
    group.add(new LineSegments(segmentGeometry(top), lineMaterial(hdr(EMBER, 0.5))));

    // Gold conductor mains running each wall's length: the power system the
    // conduits tap, lighting the dive.
    for (const height of [1.2, 4.6]) {
      const conductorMaterial = lineMaterial(hdr(GOLD, 0.7));
      conductorMaterials.push(conductorMaterial);
      const conductorPoints = frames.map((frame) =>
        frame.position.clone()
          .addScaledVector(frame.right, side * (TRENCH_WALL_X - 0.18))
          .addScaledVector(frame.up, height),
      );
      group.add(new Line(conductorGeometry(conductorPoints), conductorMaterial));
    }
  }
  const floorLeft: Vector3[] = [];
  const floorRight: Vector3[] = [];
  for (const frame of frames) {
    floorLeft.push(frame.position.clone()
      .addScaledVector(frame.right, -TRENCH_WALL_X)
      .addScaledVector(frame.up, TRENCH_BOTTOM));
    floorRight.push(frame.position.clone()
      .addScaledVector(frame.right, TRENCH_WALL_X)
      .addScaledVector(frame.up, TRENCH_BOTTOM));
  }
  group.add(new Mesh(stripGeometry(floorLeft, floorRight), slabMaterial));

  // Mouth gantry framing the entrance dive, gold-lit.
  const mouth = frames[1];
  for (const side of [-1, 1]) {
    const post = new Mesh(new BoxGeometry(1.2, TRENCH_TOP - TRENCH_BOTTOM + 3.2, 1.2), slabMaterial);
    post.position.copy(mouth.position)
      .addScaledVector(mouth.right, side * (TRENCH_WALL_X + 2.2))
      .addScaledVector(mouth.up, (TRENCH_TOP + TRENCH_BOTTOM) / 2);
    group.add(post);
    const lampMaterial = createAdditiveBasicMaterial({ color: hdr(GOLD, 1.3), side: DoubleSide });
    const lamp = new Mesh(new CircleGeometry(0.36, 10), lampMaterial);
    lamp.position.copy(post.position).addScaledVector(mouth.up, (TRENCH_TOP - TRENCH_BOTTOM) / 2 + 1.2);
    lamp.lookAt(lamp.position.clone().sub(mouth.right));
    group.add(lamp);
    conductorMaterials.push(lampMaterial);
  }

  return { group, conductorMaterials };
}

function conductorGeometry(points: Vector3[]): BufferGeometry {
  const positions: number[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    positions.push(points[i].x, points[i].y, points[i].z, points[i + 1].x, points[i + 1].y, points[i + 1].z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

// --- nebula, stars, debris -----------------------------------------------------

export function createNebula(scene: Scene, curve: CatmullRomCurve3) {
  const rng = mulberry32(0xb40ad);
  // Linear fog dissolves hulls into haze at ~78 units; the backdrop opts out
  // via material.fog = false so the nebula stays vivid behind the fade.
  scene.fog = new Fog(VOID.getHex(), 30, 78);

  const cloud = (count: number, color: Color, center: Vector3, radius: number, size: number, bias: number) => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const direction = new Vector3(rng() - 0.5, (rng() - 0.5) * 0.6, rng() - 0.5).normalize();
      const distance = radius * (0.45 + rng() * 0.55);
      positions[i * 3] = center.x + direction.x * distance;
      positions[i * 3 + 1] = center.y + direction.y * distance + bias;
      positions[i * 3 + 2] = center.z + direction.z * distance;
      const intensity = 0.05 + rng() * rng() * 0.22;
      colors[i * 3] = color.r * intensity;
      colors[i * 3 + 1] = color.g * intensity;
      colors[i * 3 + 2] = color.b * intensity;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const material = new PointsMaterial(additiveMaterialParameters({
      size,
      vertexColors: true,
      sizeAttenuation: true,
      fog: false,
      depthWrite: false,
    }));
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
  };

  cloud(1000, MAGENTA, curve.getPointAt(progressAt(46)).clone().add(new Vector3(-60, 30, -120)), 300, 26, 10);
  cloud(700, GOLD, curve.getPointAt(0.985).clone().add(new Vector3(80, -10, -60)), 260, 20, -12);
  cloud(500, MAGENTA, curve.getPointAt(0.25).clone().add(new Vector3(120, 60, -40)), 240, 22, 24);

  // Starfield: fine points through the whole corridor volume.
  const starCount = 1500;
  const starPositions = new Float32Array(starCount * 3);
  const starColors = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i += 1) {
    const base = curve.getPointAt(rng());
    const direction = new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).normalize();
    const distance = 90 + rng() * 320;
    starPositions[i * 3] = base.x + direction.x * distance;
    starPositions[i * 3 + 1] = base.y + direction.y * distance;
    starPositions[i * 3 + 2] = base.z + direction.z * distance;
    const roll = rng();
    const tint = roll < 0.62 ? ICE : roll < 0.86 ? GOLD : MAGENTA;
    const intensity = rng() < 0.06 ? 1.5 : 0.16 + rng() * 0.3;
    starColors[i * 3] = tint.r * intensity;
    starColors[i * 3 + 1] = tint.g * intensity;
    starColors[i * 3 + 2] = tint.b * intensity;
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('position', new Float32BufferAttribute(starPositions, 3));
  starGeometry.setAttribute('color', new Float32BufferAttribute(starColors, 3));
  const stars = new Points(starGeometry, new PointsMaterial(additiveMaterialParameters({
    size: 1.4,
    vertexColors: true,
    sizeAttenuation: true,
    fog: false,
    depthWrite: false,
  })));
  stars.frustumCulled = false;
  scene.add(stars);
}

export function createDebrisField(curve: CatmullRomCurve3): ScatterField {
  const rng = mulberry32(0xdebf);
  return scatterAlongRail(curve, {
    count: 16,
    seed: 77,
    rng,
    window: { behind: 40, ahead: 90 },
    alignToRail: false,
    make(makeIndex, makeRng) {
      void makeIndex;
      const group = new Group();
      const chunk = new Mesh(
        new BoxGeometry(2 + makeRng() * 5, 1 + makeRng() * 2.4, 2 + makeRng() * 6),
        new MeshBasicMaterial({ color: 0x0b0709 }),
      );
      chunk.name = 'debris';
      group.add(chunk);
      const wire = new LineSegments(
        new BoxGeometry(2.1 + makeRng() * 5, 1.1 + makeRng() * 2.4, 2.1 + makeRng() * 6),
        createAdditiveBasicMaterial({ color: hdr(makeRng() < 0.5 ? EMBER : MAGENTA, 0.4), opacity: 0.8 }),
      );
      wire.name = 'debris';
      group.add(wire);
      group.rotation.set(makeRng() * Math.PI, makeRng() * Math.PI, makeRng() * Math.PI);
      group.userData.spin = (makeRng() - 0.5) * 0.4;
      return group;
    },
    place(_placeIndex, placeRng) {
      const angle = placeRng() * Math.PI * 2;
      const distance = 24 + placeRng() * 22;
      return {
        u: placeRng(),
        offset: new Vector3(Math.cos(angle) * distance, Math.sin(angle) * distance * 0.6, (placeRng() - 0.5) * 20),
      };
    },
    onUpdate(item, dt) {
      item.object.rotation.y += item.object.userData.spin * dt;
      item.object.rotation.x += item.object.userData.spin * 0.6 * dt;
    },
  });
}

// --- assembly -------------------------------------------------------------------

export type BroadsideEnvironment = {
  root: Group;
  ships: ShipHandle[];
  trenchConductors: Array<{ color: Color }>;
  debris: ScatterField;
  /** World-space anchors along the friendly cruiser's flank for broadside flashes. */
  muzzleAnchors: Vector3[];
};

export function createBroadsideEnvironment(scene: Scene): BroadsideEnvironment {
  scene.background = VOID.clone();
  const root = new Group();
  const curve = createBroadsideRail();

  createNebula(scene, curve);

  const ships: ShipHandle[] = [];
  const push = (spec: ShipSpec) => ships.push(createCapitalShip(curve, spec));

  // Friendly flagship under the launch: the deck the player peels off of.
  push({ fromTime: -4, toTime: 3.6, right: 0, up: -11, halfW: 27, halfH: 5.5, faction: 'friend', seed: 101, frames: 16 });

  // The gap: opposing ship lines forming the canyon (bars 4-8).
  push({ fromTime: 6.6, toTime: 15.9, right: -32, up: 6, halfW: 13, halfH: 9, faction: 'foe', seed: 202, frames: 16 });
  push({ fromTime: 7.5, toTime: 16.9, right: 31, up: -5, halfW: 14, halfH: 8, faction: 'friend', seed: 303, frames: 16 });

  // The broadside cruiser flanking bars 12-16; its guns fire with the beat.
  push({ fromTime: 21.6, toTime: 30.9, right: 19, up: -1, halfW: 9, halfH: 5.5, faction: 'friend', seed: 404, frames: 18, bowTaper: true });

  // Distant enemy line on the far side of the broadside.
  push({ fromTime: 22.5, toTime: 30.75, right: -58, up: 16, halfW: 9, halfH: 4, faction: 'foe', seed: 505, frames: 10, dim: 0.7 });
  push({ fromTime: 23.3, toTime: 30.4, right: -66, up: -12, halfW: 8, halfH: 3.5, faction: 'foe', seed: 606, frames: 10, dim: 0.6 });

  // The belly warship over bars 18-22 (the rail skims under its keel).
  push({ fromTime: 32.8, toTime: 42.2, right: -2, up: 16, halfW: 15, halfH: 6.5, faction: 'foe', seed: 707, frames: 18 });

  // The enemy flagship: vast, parallel to the rail, trench cut into its keel.
  push({ fromTime: 44, toTime: 59.25, right: 10, up: 22, halfW: 24, halfH: 8, faction: 'foe', seed: 808, frames: 26 });

  // Burning escorts in the pull-out vista.
  push({ fromTime: 57, toTime: 59.9, right: -38, up: 20, halfW: 9, halfH: 4, faction: 'foe', seed: 909, frames: 10, dim: 0.8 });
  push({ fromTime: 57.6, toTime: 59.95, right: -52, up: -8, halfW: 8, halfH: 3.5, faction: 'foe', seed: 910, frames: 10, dim: 0.7 });

  const trench = createTrench(curve);
  trench.group.name = 'trench';
  trench.group.traverse((child) => { if ((child as Mesh).isMesh && !child.name) child.name = 'trench'; });

  const debris = createDebrisField(curve);
  root.add(debris.group, trench.group);

  // Muzzle anchors along the cruiser's left flank, aimed across the rail.
  const muzzleAnchors: Vector3[] = [];
  for (let i = 0; i < 8; i += 1) {
    const seconds = 22.5 + (i / 7) * 7;
    const frame = sampleRailFrame(curve, progressAt(seconds));
    muzzleAnchors.push(
      frame.position.clone()
        .addScaledVector(frame.right, 17 - 9.6)
        .addScaledVector(frame.up, -1 + (i % 2 === 0 ? 1.4 : -1.2)),
    );
  }

  ships.forEach((ship, i) => {
    ship.group.name = `ship-${i}-${ship.faction}`;
    ship.group.traverse((child) => {
      if (child instanceof Mesh && !child.name) child.name = ship.group.name;
    });
  });
  for (const ship of ships) root.add(ship.group);
  scene.add(root);
  return { root, ships, trenchConductors: trench.conductorMaterials, debris, muzzleAnchors };
}
