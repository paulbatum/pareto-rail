import { Matrix4, Quaternion, Vector3 } from 'three';
import { frameAtTime } from './flight';
import { bar } from './timing';

// SET PIECES. The four hulls the rail is flown against, placed from the
// flight plan so hull, rail, and music agree. Gameplay mounts its hull-bound
// targets (belly turrets, shield generators, power cores) at the points
// exported here; the visuals build the hulls around the same numbers.
//
// Ship-local space: x = starboard, y = up, z = aft (bows face local −z).

export type Placement = {
  position: Vector3;
  quaternion: Quaternion;
  right: Vector3;
  up: Vector3;
  forward: Vector3;
};

const WORLD_UP = new Vector3(0, 1, 0);

function placement(position: Vector3, forward: Vector3, up = WORLD_UP): Placement {
  const f = forward.clone().normalize();
  const right = new Vector3().crossVectors(f, up).normalize();
  const trueUp = new Vector3().crossVectors(right, f).normalize();
  const back = f.clone().negate();
  const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, trueUp, back));
  return { position: position.clone(), quaternion, right, up: trueUp, forward: f };
}

/** Ship-local (x starboard, y up, z aft) → world. */
export function toWorld(p: Placement, x: number, y: number, z: number, target = new Vector3()) {
  return target.copy(p.position)
    .addScaledVector(p.right, x)
    .addScaledVector(p.up, y)
    .addScaledVector(p.forward, -z);
}

/** World → ship-local. */
export function toLocal(p: Placement, world: Vector3, target = new Vector3()) {
  const d = world.clone().sub(p.position);
  return target.set(d.dot(p.right), d.dot(p.up), -d.dot(p.forward));
}

const railAt = (barValue: number) => frameAtTime(bar(barValue));

// ---- THE CARRIER: our flagship. The run begins on its flight deck. ----------------

export const CARRIER = (() => {
  const length = 860;
  const bowZ = railAt(1.86).position.z;
  const deckY = -3.2;
  const place = placement(new Vector3(0, deckY, bowZ + length / 2), new Vector3(0, 0, -1));
  return { place, length, beam: 74, deckY, bowLocalZ: -length / 2 };
})();

// ---- VALIANT: the friendly cruiser whose flank you run while it fires. -------------

export const VALIANT = (() => {
  const mid = railAt(11);
  const forward = mid.forward.clone().setY(0).normalize();
  // The camera runs 40 units starboard of the centerline and 30 below it,
  // tucked under the overhanging gun deck.
  const center = mid.position.clone()
    .addScaledVector(mid.right, -40)
    .addScaledVector(mid.up, 30);
  const place = placement(center, forward);
  const sternZ = toLocal(place, railAt(7.9).position).z + 30;
  const bowZ = toLocal(place, railAt(13.95).position).z - 80;
  return { place, sternZ, bowZ, length: sternZ - bowZ, camera: { x: 40, y: -30 } };
})();

/** Broadside batteries: the gun houses under the overhang, stern to bow. */
export const VALIANT_BATTERIES = (() => {
  const count = 22;
  const batteries: Array<{ local: Vector3; world: Vector3; muzzle: Vector3; direction: Vector3 }> = [];
  const span = VALIANT.sternZ - VALIANT.bowZ;
  for (let i = 0; i < count; i += 1) {
    const z = VALIANT.sternZ - 70 - (i / (count - 1)) * (span - 170);
    const upper = i % 2 === 0;
    const local = new Vector3(upper ? 49 : 36, upper ? 17 : 4, z);
    const world = toWorld(VALIANT.place, local.x, local.y, local.z);
    const muzzle = toWorld(VALIANT.place, local.x + 9, local.y + 1.5, local.z);
    const direction = VALIANT.place.right.clone().multiplyScalar(0.94).addScaledVector(VALIANT.place.up, 0.24).addScaledVector(VALIANT.place.forward, 0.22).normalize();
    batteries.push({ local, world, muzzle, direction });
  }
  return batteries;
})();

// ---- THE KEEL: an enemy warship; the rail runs along its belly. --------------------

export const KEEL = (() => {
  const mid = railAt(18);
  const forward = mid.forward.clone().setY(0).normalize();
  // Belly plane sits 17 units over the camera.
  const center = mid.position.clone()
    .addScaledVector(mid.right, -6)
    .addScaledVector(WORLD_UP, 17 + 34);
  const place = placement(center, forward);
  const sternZ = toLocal(place, railAt(16.55).position).z + 22;
  const bowZ = toLocal(place, railAt(19.7).position).z - 70;
  return { place, sternZ, bowZ, bellyY: -34 };
})();

/** Belly turret mounts, fore of the camera's entry, in the order the camera meets them. */
export const KEEL_TURRETS = (() => {
  const layout: Array<[barValue: number, x: number]> = [
    [17.05, -22],
    [17.1, 16],
    [17.55, -4],
    [17.95, 25],
    [18.0, -27],
    [18.4, 8],
    [18.75, -15],
    [18.8, 21],
    [19.2, -24],
    [19.25, 3],
    [19.3, 27],
  ];
  return layout.map(([barValue, x]) => {
    const z = toLocal(KEEL.place, railAt(barValue).position).z;
    const local = new Vector3(x, KEEL.bellyY - 3.2, z);
    return { passBar: barValue, local, world: toWorld(KEEL.place, local.x, local.y, local.z) };
  });
})();

// ---- THE ENEMY FLAGSHIP. -------------------------------------------------------------
// Pass one runs down its starboard flank bow-to-stern (shield generators);
// the rail turns hard around its stern and the second pass runs the dorsal
// trench stern-to-bow (power cores).

export const FLAGSHIP = (() => {
  const trenchIn = railAt(26.5).position;
  const trenchOut = railAt(29.5).position;
  const axis = trenchOut.clone().sub(trenchIn).setY(0).normalize();
  const deckY = trenchIn.y + 18;
  // Local origin: on the centerline at deck height, at the trench entry.
  const origin = new Vector3(trenchIn.x, deckY, trenchIn.z);
  const base = placement(origin, axis);
  const sternZ = toLocal(base, railAt(25.3).position).z + 12;
  const length = 1520;
  const bowZ = sternZ - length;
  return {
    place: base,
    length,
    sternZ,
    bowZ,
    deckY,
    trench: { halfWidth: 20, floorY: -30, fromZ: sternZ + 1, toZ: toLocal(base, railAt(30.5).position).z },
    beam: 200,
    keelY: -176,
    sections: [
      { name: 'stern', fromZ: sternZ, toZ: sternZ - 400 },
      { name: 'waist', fromZ: sternZ - 400, toZ: sternZ - 790 },
      { name: 'bow', fromZ: sternZ - 790, toZ: bowZ },
    ],
  };
})();

export const FLAGSHIP_CENTER = toWorld(FLAGSHIP.place, 0, -70, (FLAGSHIP.sternZ + FLAGSHIP.bowZ) / 2);
export const SHIELD_RADII = new Vector3(FLAGSHIP.beam / 2 + 118, 190, FLAGSHIP.length / 2 + 130);

/** Shield generators on the starboard shoulder, in the order pass one meets them. */
export const GENERATOR_MOUNTS = (() => {
  const layout: Array<[barValue: number, y: number]> = [
    [21.0, -22],
    [21.85, -38],
    [22.7, -18],
    [23.5, -34],
  ];
  return layout.map(([barValue, y], index) => {
    const z = toLocal(FLAGSHIP.place, railAt(barValue).position).z;
    const local = new Vector3(FLAGSHIP.beam / 2 + 12, y, z);
    return { index, passBar: barValue, local, world: toWorld(FLAGSHIP.place, local.x, local.y, local.z) };
  });
})();

/** Exposed power cores on the trench floor, in the order the dive meets them. */
export const CORE_MOUNTS = (() => {
  const layout: Array<[barValue: number, x: number]> = [
    [27.45, -8],
    [28.4, 8],
    [29.35, 0],
  ];
  return layout.map(([barValue, x], index) => {
    const z = toLocal(FLAGSHIP.place, railAt(barValue).position).z;
    const local = new Vector3(x, FLAGSHIP.trench.floorY + 4.5, z);
    return { index, passBar: barValue, local, world: toWorld(FLAGSHIP.place, local.x, local.y, local.z) };
  });
})();

/** Point-defense mounts on the flank; they fill pass one with flak. */
export const POINT_DEFENSE_MOUNTS = (() => {
  const mounts: Vector3[] = [];
  for (let i = 0; i < 9; i += 1) {
    const z = FLAGSHIP.sternZ - 20 - i * 50;
    const y = i % 2 === 0 ? -8 : -52;
    mounts.push(toWorld(FLAGSHIP.place, FLAGSHIP.beam / 2 + (i % 2 === 0 ? -8 : 1), y, z));
  }
  return mounts;
})();
