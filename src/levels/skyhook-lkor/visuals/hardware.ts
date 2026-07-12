import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { sampleRailFrame } from '../../../engine/rail';
import { tetherPointAt } from '../gameplay';
import { TETHER_OFFSET_Y } from '../timing';
import { BAY_WARM, GUNMETAL, HAZARD_ORANGE, hdr, MARKER_WHITE, PANEL_SHADE, PANEL_WHITE } from './palette';
import type { TintPart } from './enemies';

// The friendly hardware: the tether the car climbs, the climber car itself, and
// the station that swallows it at the top. All utilitarian — white paneling and
// hazard orange, HDR only on thin strips and marker lights. The tether's guide
// rails are `Line` objects (never occluders) and the collar rings are additive
// (never occluders); only the small, low-centre car is solid, by design.

const COLLAR_COUNT = 52;
const COLLAR_SPACING_UNITS = 6.5;
const GUIDE_HALF_WIDTH = 0.4;

// Car hull kept below the bloom threshold so paneling reads as white plating
// rather than blooming to a white blob; the HDR marker lights carry the glow.
const CAR_PANEL = PANEL_WHITE.clone().multiplyScalar(0.62);

export type TetherRig = {
  root: Group;
  update(cameraU: number, beatEnergy: number): void;
};

export function createTether(curve: CatmullRomCurve3): TetherRig {
  const root = new Group();
  const length = curve.getLength();

  // Paired white guide-rails running the length of the tether. Slightly hot so
  // the CABLE itself reads as the line; the collars are just markers on it.
  const guideMaterial = new LineBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(1.5) });
  const samples = 420;
  for (const side of [-1, 1]) {
    const points: Vector3[] = [];
    for (let i = 0; i <= samples; i += 1) {
      const frame = sampleRailFrame(curve, i / samples);
      points.push(
        frame.position
          .clone()
          .addScaledVector(frame.up, TETHER_OFFSET_Y)
          .addScaledVector(frame.right, side * GUIDE_HALF_WIDTH),
      );
    }
    root.add(new Line(new BufferGeometry().setFromPoints(points), guideMaterial));
  }

  // Hazard-orange collar beads, world-anchored on a grid so the camera rushes
  // through them — the primary speed read. Bead scale: clearly smaller than the
  // car so the tether reads as a taut line with small markers, never a coil.
  const collarMaterial = createAdditiveBasicMaterial({ color: hdr(HAZARD_ORANGE, 1.2), side: DoubleSide });
  const collars = new InstancedMesh(new TorusGeometry(0.3, 0.045, 6, 16), collarMaterial, COLLAR_COUNT);
  collars.frustumCulled = false;
  root.add(collars);

  const du = COLLAR_SPACING_UNITS / length;
  const behindU = 2 / length;
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  const basis = new Matrix4();
  const scale = new Vector3(1, 1, 1);
  const hidden = new Vector3(0, 0, 0);
  const fadeColor = new Color();

  const update = (cameraU: number, beatEnergy: number) => {
    const startU = Math.max(0, Math.ceil((cameraU - behindU) / du) * du);
    for (let i = 0; i < COLLAR_COUNT; i += 1) {
      const u = startU + i * du;
      if (u > 1) {
        matrix.compose(hidden, quaternion, hidden);
        collars.setMatrixAt(i, matrix);
        collars.setColorAt(i, fadeColor.setScalar(0));
        continue;
      }
      const frame = sampleRailFrame(curve, u);
      const position = frame.position.clone().addScaledVector(frame.up, TETHER_OFFSET_Y);
      basis.makeBasis(frame.right, frame.up, frame.tangent);
      quaternion.setFromRotationMatrix(basis);
      matrix.compose(position, quaternion, scale);
      collars.setMatrixAt(i, matrix);
      // Distance dimming: the nearest bead never dwarfs the car, and far beads
      // fall off so the stacked markers can't bloom into a bright rope.
      const distance = (u - cameraU) * length;
      const nearFade = Math.min(1, Math.max(0, (distance + 1) / 8));
      const farFade = 1 - 0.9 * Math.min(1, Math.max(0, (distance - 18) / 70));
      collars.setColorAt(i, fadeColor.setScalar(nearFade * farFade));
    }
    collars.instanceMatrix.needsUpdate = true;
    if (collars.instanceColor) collars.instanceColor.needsUpdate = true;
    // Faint downbeat pulse — most noticeable up top where the music thins out.
    collarMaterial.color.copy(hdr(HAZARD_ORANGE, 1.1 + beatEnergy * 0.35));
  };

  return { root, update };
}

// ---- climber car -------------------------------------------------------------

export type ClimberCar = {
  root: Group;
  update(opts: { dt: number; elapsed: number; healthFrac: number; speed: number }): void;
};

export function createClimberCar(): ClimberCar {
  const root = new Group();
  const bob = new Group();
  root.add(bob);

  const panelMaterials: MeshBasicMaterial[] = [];
  const chevronMaterials: MeshBasicMaterial[] = [];
  const markers: Array<{ material: MeshBasicMaterial; phase: number }> = [];

  const panel = (w: number, h: number, d: number, z: number) => {
    const material = new MeshBasicMaterial({ color: CAR_PANEL.clone() });
    const box = new Mesh(new BoxGeometry(w, h, d), material);
    box.position.z = z;
    // Recessed shaded frame so panels read at bloom 0.
    const frame = new Mesh(
      new BoxGeometry(w * 1.02, h * 1.02, d * 0.92),
      new MeshBasicMaterial({ color: PANEL_SHADE.clone() }),
    );
    frame.position.z = z;
    bob.add(frame, box);
    panelMaterials.push(material);
    return box;
  };

  // Two-segment box-train.
  panel(1.3, 0.9, 1.5, 0.85);
  panel(1.15, 0.8, 1.4, -0.85);

  // Hazard chevrons banding the hull.
  for (const z of [0.85, -0.85]) {
    for (const side of [-1, 1]) {
      const material = new MeshBasicMaterial({ color: hdr(HAZARD_ORANGE, 1.4), side: DoubleSide });
      const chevron = new Mesh(new BoxGeometry(0.06, 0.5, 0.9), material);
      chevron.position.set(side * 0.68, 0, z);
      bob.add(chevron);
      chevronMaterials.push(material);
    }
  }

  // Blinking marker lights on the corners.
  const markerPositions: Array<[number, number, number]> = [
    [0.6, 0.5, 1.5],
    [-0.6, 0.5, 1.5],
    [0.6, -0.45, -1.5],
    [-0.6, -0.45, -1.5],
  ];
  for (const [x, y, z] of markerPositions) {
    const material = createAdditiveBasicMaterial({ color: hdr(MARKER_WHITE, 1.8) });
    const light = new Mesh(new CircleGeometry(0.09, 12), material);
    light.position.set(x, y, z);
    bob.add(light);
    markers.push({ material, phase: Math.random() * 6.28 });
  }

  // Stabilizer thruster glow at the underside rear.
  const stabilizerMaterial = createAdditiveBasicMaterial({ color: hdr(MARKER_WHITE, 1.2), opacity: 0.7, side: DoubleSide });
  const stabilizer = new Mesh(new RingGeometry(0.12, 0.34, 16), stabilizerMaterial);
  stabilizer.position.set(0, -0.55, -1.6);
  stabilizer.rotation.x = Math.PI / 2;
  bob.add(stabilizer);

  root.userData.panelMaterials = panelMaterials;
  root.userData.chevronMaterials = chevronMaterials;
  root.userData.markers = markers;
  root.userData.stabilizerMaterial = stabilizerMaterial;

  const update: ClimberCar['update'] = ({ dt: _dt, elapsed, healthFrac, speed }) => {
    bob.position.y = Math.sin(elapsed * 1.6) * 0.05;
    bob.rotation.z = Math.sin(elapsed * 1.1) * 0.02;

    const wounded = healthFrac < 0.999;
    const faultFlicker = wounded ? 0.6 + 0.4 * Math.sin(elapsed * (18 + (1 - healthFrac) * 30)) : 1;
    for (const material of panelMaterials) {
      const dim = wounded && Math.random() < (1 - healthFrac) * 0.25 ? 0.35 : 1;
      material.color.copy(CAR_PANEL).multiplyScalar(dim * (wounded ? faultFlicker : 1));
    }

    for (const marker of markers) {
      const blink = 0.5 + 0.5 * Math.sin(elapsed * 5 + marker.phase);
      marker.material.color.copy(hdr(wounded ? HAZARD_ORANGE : MARKER_WHITE, 0.6 + blink * 1.6));
    }

    stabilizerMaterial.color.copy(hdr(MARKER_WHITE, 0.5 + speed * 1.1));
    stabilizerMaterial.opacity = 0.4 + speed * 0.4;
  };

  return { root, update };
}

// ---- station -----------------------------------------------------------------

export type Station = {
  root: Group;
  update(opts: { open: number; elapsed: number; dt: number }): void;
  /** Momentary brightening of the guide lights and rim — a beacon just lit up. */
  flare(): void;
};

export function createStation(): Station {
  const root = new Group();
  // Background-scale finale object: never an occluder.
  root.userData.raildIgnoreOcclusion = true;
  root.visible = false;

  // Outer ring aperture.
  const ringMaterial = new MeshBasicMaterial({ color: GUNMETAL.clone().multiplyScalar(1.2) });
  root.add(new Mesh(new TorusGeometry(9, 1.4, 10, 40), ringMaterial));

  // Hazard band on the rim.
  const bandMaterial = createAdditiveBasicMaterial({ color: hdr(HAZARD_ORANGE, 1.6) });
  root.add(new Mesh(new TorusGeometry(9, 0.28, 8, 40), bandMaterial));

  // Guide lights around the aperture.
  const guideMaterials: Array<{ material: MeshBasicMaterial; phase: number }> = [];
  for (let i = 0; i < 16; i += 1) {
    const angle = (i / 16) * Math.PI * 2;
    const material = createAdditiveBasicMaterial({ color: hdr(MARKER_WHITE, 1.6) });
    const light = new Mesh(new CircleGeometry(0.3, 10), material);
    light.position.set(Math.cos(angle) * 9, Math.sin(angle) * 9, 0.4);
    root.add(light);
    guideMaterials.push({ material, phase: (i / 16) * Math.PI * 2 });
  }

  // Iris blades that retract to open the bay.
  const blades: Group[] = [];
  for (let i = 0; i < 8; i += 1) {
    const arrange = new Group();
    arrange.rotation.z = (i / 8) * Math.PI * 2;
    const blade = new Mesh(
      new BoxGeometry(4.4, 2.6, 0.5),
      new MeshBasicMaterial({ color: PANEL_WHITE.clone().multiplyScalar(0.7), side: DoubleSide }),
    );
    blade.position.set(0, 4.2, 0.2);
    arrange.add(blade);
    root.add(arrange);
    blades.push(arrange);
  }

  // Warm interior bay glow behind the iris.
  const bayMaterial = createAdditiveBasicMaterial({ color: hdr(BAY_WARM, 1.2), opacity: 0.85, side: DoubleSide });
  const bay = new Mesh(new CircleGeometry(8, 40), bayMaterial);
  bay.position.z = -2;
  root.add(bay);

  // Beacon-kill flare: each lit beacon pumps the ring's lights for a beat.
  let flareEnergy = 0;

  const update: Station['update'] = ({ open, elapsed, dt }) => {
    flareEnergy = Math.max(0, flareEnergy - dt * 1.8);
    root.visible = open > 0.001;
    const iris = Math.min(1, open);
    for (const arrange of blades) {
      const blade = arrange.children[0] as Mesh;
      blade.position.y = 4.2 + iris * 3.4; // retract outward
      blade.rotation.z = iris * 0.4;
    }
    bayMaterial.color.copy(hdr(BAY_WARM, 0.6 + iris * 1.4 + flareEnergy * 0.6));
    bayMaterial.opacity = 0.5 + iris * 0.45;
    bandMaterial.color.copy(hdr(HAZARD_ORANGE, 1.2 + iris * 0.8 + flareEnergy * 0.7));
    for (const guide of guideMaterials) {
      const blink = 0.5 + 0.5 * Math.sin(elapsed * 4 + guide.phase - open * 6);
      guide.material.color.copy(hdr(MARKER_WHITE, 0.8 + blink * 1.4 + flareEnergy * 1.2));
    }
  };

  return {
    root,
    update,
    flare() {
      flareEnergy = Math.min(1.4, flareEnergy + 0.7);
    },
  };
}

// ---- docking-ring beacon (lockable kind 'beacon') ------------------------------

// Station hardware, not an enemy: a small white ring-lamp housing with a warm
// marker core and a thin hazard-orange rim — the same family as the aperture's
// guide lights. Gameplay writes `userData.pulse` (1 on the beat, decaying,
// synchronized across all six); locking flips it to the player's mark tint.
export function createBeaconMesh(): Group {
  const group = new Group();
  const parts = (group.userData.parts ??= []) as TintPart[];

  // Lamp housing: a white ring, kept below the bloom threshold like the car hull.
  const housingMaterial = new MeshBasicMaterial({ color: CAR_PANEL.clone() });
  const housing = new Mesh(new TorusGeometry(0.62, 0.18, 8, 24), housingMaterial);
  group.add(housing);
  parts.push({ material: housingMaterial, base: CAR_PANEL.clone(), kind: 'fill' });

  // Thin hazard-orange rim strip.
  const rimMaterial = createAdditiveBasicMaterial({ color: hdr(HAZARD_ORANGE, 1.5), side: DoubleSide });
  const rim = new Mesh(new RingGeometry(0.86, 0.94, 24), rimMaterial);
  group.add(rim);
  parts.push({ material: rimMaterial, base: hdr(HAZARD_ORANGE, 1.5), kind: 'edge' });

  // Warm marker core, driven by the shared pulse.
  const coreMaterial = new MeshBasicMaterial({ color: hdr(BAY_WARM, 1.2) });
  const core = new Mesh(new CircleGeometry(0.34, 18), coreMaterial);
  core.position.z = 0.12;
  group.add(core);
  parts.push({ material: coreMaterial, base: hdr(BAY_WARM, 1.2), kind: 'core' });
  const coreGlowMaterial = createAdditiveBasicMaterial({ color: hdr(BAY_WARM, 0.5), opacity: 0.4, side: DoubleSide });
  const coreGlow = new Mesh(new CircleGeometry(0.55, 18), coreGlowMaterial);
  coreGlow.position.z = 0.1;
  group.add(coreGlow);
  parts.push({ material: coreGlowMaterial, base: hdr(BAY_WARM, 0.5), kind: 'core' });

  // Four mounting lugs so the housing reads as bolted hardware, not a ring FX.
  // Same shaded material and static, so they merge into a single mesh/part.
  const lugGeometries = [];
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    lugGeometries.push(
      new BoxGeometry(0.2, 0.12, 0.12).applyMatrix4(
        new Matrix4().makeRotationZ(angle).setPosition(Math.cos(angle) * 0.82, Math.sin(angle) * 0.82, 0),
      ),
    );
  }
  const lugMaterial = new MeshBasicMaterial({ color: PANEL_SHADE.clone() });
  group.add(new Mesh(mergeGeometries(lugGeometries), lugMaterial));
  for (const geometry of lugGeometries) geometry.dispose();
  parts.push({ material: lugMaterial, base: PANEL_SHADE.clone(), kind: 'fill' });

  group.userData.beaconCore = coreMaterial;
  group.userData.beaconCoreGlow = coreGlowMaterial;
  group.userData.beaconRim = rimMaterial;
  group.userData.accent = BAY_WARM.clone();
  // Igniting, not exploding: warm white-orange motes, no gunmetal slag.
  group.userData.shardSpecs = Array.from({ length: 6 }, (_, i) => {
    const angle = (i / 6) * Math.PI * 2;
    return {
      direction: new Vector3(Math.cos(angle), Math.sin(angle), 0.4).normalize(),
      color: (i % 2 === 0 ? MARKER_WHITE : BAY_WARM).clone(),
      size: 0.25,
    };
  });
  group.userData.lockRingScale = 1.0;
  return group;
}

// Unison blink from the gameplay-synchronized pulse. Skipped while the tint
// system owns the colours (locked or denied).
export function animateBeacon(mesh: Object3D, elapsed: number) {
  if (mesh.userData.locked === true) return;
  if (((mesh.userData.deniedUntil as number | undefined) ?? -Infinity) > elapsed) return;
  const pulse = Math.min(1, Math.max(0, (mesh.userData.pulse as number | undefined) ?? 0));
  const core = mesh.userData.beaconCore as MeshBasicMaterial | undefined;
  const coreGlow = mesh.userData.beaconCoreGlow as MeshBasicMaterial | undefined;
  const rim = mesh.userData.beaconRim as MeshBasicMaterial | undefined;
  if (core) core.color.copy(hdr(BAY_WARM, 0.9 + pulse * 1.4));
  if (coreGlow) coreGlow.color.copy(hdr(BAY_WARM, 0.35 + pulse * 0.8));
  if (rim) rim.color.copy(hdr(HAZARD_ORANGE, 1.3 + pulse * 0.9));
}

// Convenience for callers wiring the car onto the tether.
export function tetherFrameQuaternion(curve: CatmullRomCurve3, u: number, out = new Quaternion()): Quaternion {
  const frame = sampleRailFrame(curve, u);
  return out.setFromRotationMatrix(new Matrix4().makeBasis(frame.right, frame.up, frame.tangent));
}

export function tetherPoint(curve: CatmullRomCurve3, u: number, out = new Vector3()): Vector3 {
  return tetherPointAt(curve, u, out);
}
