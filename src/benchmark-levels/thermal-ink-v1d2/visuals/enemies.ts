import type { BufferGeometry } from 'three';
import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { CREAM, hdr, IR_HOT, IR_METAL, IR_WARM, OCHRE, OIL, OIL_EDGE, RUST, RUST_DARK, SEA_GLASS, SODIUM, SIGNAL_RED } from './palette';
import type { DebrisSpec } from './effects';

// Harbor scavengers are flesh and debris: broken machinery lashed together
// with cable and gristle, all of it wearing the same oily dark as their maker.
// Silhouette and motion carry identity — drifters are wide crossing barges,
// hatchlings are jetting squid-things, buoys are armored mine-spheres.
// All geometries are cached at module level and shared across instances; only
// materials are per-mesh so the tint pass can grade every enemy on its own.

export type TintKind = 'fill' | 'edge' | 'core';
export type TintPart = {
  material: MeshBasicMaterial | LineBasicMaterial;
  /** Color under sodium murk (pre-HDR). */
  murk: Color;
  /** Color under the thermal display (pre-HDR). */
  ir: Color;
  murkIntensity: number;
  irIntensity: number;
  kind: TintKind;
};

export function tintable(group: Group): TintPart[] {
  return (group.userData.parts ??= []) as TintPart[];
}

// ---- shared geometry cache ---------------------------------------------------

const geo = {
  drifterHull: new BoxGeometry(2.7, 0.55, 1.3),
  drifterPatch: new BoxGeometry(0.9, 0.58, 1.1),
  drifterCabin: new BoxGeometry(0.7, 0.6, 0.8),
  drifterArm: (() => {
    const arm = new TetrahedronGeometry(0.62, 0);
    arm.scale(1.6, 0.3, 0.4);
    return arm;
  })(),
  drifterLamp: new SphereGeometry(0.16, 8, 6),
  hatchMantle: (() => {
    const mantle = new OctahedronGeometry(0.8, 0);
    mantle.scale(0.85, 0.85, 1.5);
    return mantle;
  })(),
  hatchFin: (() => {
    const fin = new TetrahedronGeometry(0.5, 0);
    fin.scale(0.35, 0.9, 0.7);
    return fin;
  })(),
  hatchRibbons: mergeGeometries(
    [0, 1, 2, 3].map((i) => {
      const cone = new ConeGeometry(0.09, 1.7 + (i % 2) * 0.7, 5, 1, true);
      cone.rotateX(-Math.PI / 2);
      cone.translate((i - 1.5) * 0.28, -0.1 - (i % 2) * 0.15, -1.3);
      return cone;
    }),
  ),
  hatchEye: new OctahedronGeometry(0.2, 1),
  hatchGlow: new OctahedronGeometry(0.31, 1),
  buoyDome: new SphereGeometry(1.05, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  buoyBand: new CylinderGeometry(1.12, 1.12, 0.34, 12),
  buoySpikes: mergeGeometries(
    Array.from({ length: 6 }, (_, i) => {
      const angle = (i / 6) * Math.PI * 2;
      const spike = new ConeGeometry(0.16, 0.75, 5);
      spike.rotateZ(-Math.PI / 2);
      spike.rotateY(-angle);
      spike.translate(Math.cos(angle) * 1.25, 0, Math.sin(angle) * 1.25);
      return spike;
    }),
  ),
  buoyHeart: new OctahedronGeometry(0.62, 1),
  buoyGlow: new OctahedronGeometry(1.0, 1),
  buoyChain: new CylinderGeometry(0.05, 0.05, 2.4, 5),
  gobBlob: new SphereGeometry(0.42, 9, 7),
  gobTail: new ConeGeometry(0.3, 1.6, 7, 1, true),
  inkCloud: mergeGeometries(
    [
      [0, 0, 0, 5.2],
      [3.4, 1.4, -1.2, 3.8],
      [-3.2, -1, 1, 3.4],
      [0.6, 2.4, 1.8, 2.6],
      [-1.4, -2.2, -1.6, 2.8],
    ].map(([x, y, z, radius]) => {
      const sphere = new SphereGeometry(radius, 8, 6);
      sphere.translate(x, y, z);
      return sphere;
    }),
  ),
  sucker: new RingGeometry(0.16, 0.3, 8),
};

export const SUCKER_GEOMETRY = geo.sucker;

function addPart(
  group: Group,
  geometry: import('three').BufferGeometry,
  murk: Color,
  ir: Color,
  murkIntensity: number,
  irIntensity: number,
  kind: TintKind,
  edge?: { color: Color; irColor: Color; intensity: number },
) {
  const fillMaterial = new MeshBasicMaterial({ color: murk.clone().multiplyScalar(murkIntensity) });
  const mesh = new Mesh(geometry, fillMaterial);
  group.add(mesh);
  tintable(group).push({
    material: fillMaterial,
    murk: murk.clone(),
    ir: ir.clone(),
    murkIntensity,
    irIntensity,
    kind,
  });
  if (edge) {
    const edgeMaterial = new LineBasicMaterial(additiveMaterialParameters({
      color: hdr(edge.color, edge.intensity),
    }));
    const lines = new LineSegments(new EdgesGeometry(geometry), edgeMaterial);
    mesh.add(lines);
    tintable(group).push({
      material: edgeMaterial,
      murk: edge.color.clone(),
      ir: edge.irColor.clone(),
      murkIntensity: edge.intensity,
      irIntensity: 1.5,
      kind: 'edge',
    });
  }
  return mesh;
}

function addCore(group: Group, geometry: BufferGeometry, glowGeometry: BufferGeometry, murkColor: Color, murkIntensity: number, irIntensity = 2.4) {
  const coreMaterial = new MeshBasicMaterial({ color: hdr(murkColor, murkIntensity) });
  const core = new Mesh(geometry, coreMaterial);
  const glowMaterial = createAdditiveBasicMaterial({
    color: hdr(murkColor, murkIntensity * 0.4),
    opacity: 0.26,
  });
  core.add(new Mesh(glowGeometry, glowMaterial));
  group.add(core);
  tintable(group).push(
    { material: coreMaterial, murk: murkColor.clone(), ir: SIGNAL_RED.clone(), murkIntensity, irIntensity, kind: 'core' },
    { material: glowMaterial, murk: murkColor.clone(), ir: SIGNAL_RED.clone(), murkIntensity: murkIntensity * 0.4, irIntensity: irIntensity * 0.5, kind: 'core' },
  );
  return core;
}

// ---- drifter: a scavenger barge of flesh and harbor debris --------------------

export function createDrifterMesh() {
  const group = new Group();
  const shardSpecs: DebrisSpec[] = [];

  // Rust hull with a cream paint patch — a dead work barge.
  addPart(group, geo.drifterHull, RUST, IR_METAL, 0.85, 0.9, 'fill', { color: OCHRE, irColor: IR_WARM, intensity: 1.0 });
  const patch = addPart(group, geo.drifterPatch, CREAM, IR_METAL, 0.55, 0.7, 'fill');
  patch.position.set(0.7, 0.02, 0);

  // Cabin slab and a grasping cable arm at the bow.
  const cabin = addPart(group, geo.drifterCabin, RUST_DARK, IR_METAL, 0.9, 0.8, 'fill');
  cabin.position.set(-0.8, 0.5, 0);
  const arm = addPart(group, geo.drifterArm, OIL, IR_HOT, 1.0, 1.0, 'fill');
  arm.position.set(1.5, 0.1, 0);
  arm.rotation.z = -0.35;

  // One sodium lamp still burning on a stalk.
  const lampMaterial = new MeshBasicMaterial({ color: hdr(SODIUM, 1.6) });
  const lamp = new Mesh(geo.drifterLamp, lampMaterial);
  lamp.position.set(-0.2, 0.95, 0);
  group.add(lamp);
  tintable(group).push({ material: lampMaterial, murk: SODIUM.clone(), ir: IR_HOT.clone(), murkIntensity: 1.6, irIntensity: 2.0, kind: 'core' });

  group.userData.accent = OCHRE.clone();
  group.userData.shardSpecs = shardSpecs;
  group.userData.lockRingScale = 1.0;
  return group;
}

// ---- hatchling: a jetting squid-thing spat from the broken machinery ----------

export function createHatchlingMesh() {
  const group = new Group();

  addPart(group, geo.hatchMantle, OIL, IR_HOT, 1.05, 1.05, 'fill', { color: OIL_EDGE, irColor: IR_HOT, intensity: 1.15 });

  // Fins.
  for (const side of [-1, 1]) {
    const fin = addPart(group, geo.hatchFin, OIL, IR_HOT, 0.9, 0.95, 'fill');
    fin.position.set(side * 0.7, 0.15, -0.3);
    fin.rotation.z = side * 0.7;
  }

  // Trailing tentacle ribbons, merged into one mesh.
  const ribbonMaterial = createAdditiveBasicMaterial({ color: hdr(OIL_EDGE, 0.7), opacity: 0.6 });
  group.add(new Mesh(geo.hatchRibbons, ribbonMaterial));
  tintable(group).push({ material: ribbonMaterial, murk: OIL_EDGE.clone(), ir: IR_WARM.clone(), murkIntensity: 0.7, irIntensity: 1.1, kind: 'edge' });

  // The eye: a hot ember that reads as a signal core in thermal.
  addCore(group, geo.hatchEye, geo.hatchGlow, SODIUM, 1.7, 2.6);

  group.userData.accent = OIL_EDGE.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(0.7, 0.3, 0.4).normalize(), color: OIL_EDGE.clone(), size: 0.5 },
    { direction: new Vector3(-0.7, 0.3, 0.4).normalize(), color: OIL_EDGE.clone(), size: 0.5 },
    { direction: new Vector3(0, -0.6, -0.6).normalize(), color: OCHRE.clone(), size: 0.4 },
  ];
  group.userData.lockRingScale = 1.05;
  return group;
}

// ---- buoy: an armored harbor mine drifting in on its chain ---------------------

export function createBuoyMesh() {
  const group = new Group();

  // Ember heart, hidden until the shell strips.
  const heart = addCore(group, geo.buoyHeart, geo.buoyGlow, SODIUM, 1.1, 2.6);
  heart.position.y = 0;

  // Riveted shell: two hemispheres + equator ring, rust with cream stripes.
  const shell = new Group();
  const shardSpecs: DebrisSpec[] = [];
  for (const [y, flip] of [[0.32, false], [-0.32, true]] as const) {
    const dome = addPart(group, geo.buoyDome, RUST, IR_METAL, 0.9, 0.85, 'fill');
    dome.removeFromParent();
    dome.position.y = y;
    if (flip) dome.rotation.x = Math.PI;
    shell.add(dome);
    shardSpecs.push({ direction: new Vector3(0, flip ? -1 : 1, 0.2).normalize(), color: OCHRE.clone(), size: 0.9 });
  }
  const band = addPart(group, geo.buoyBand, CREAM, IR_METAL, 0.6, 0.7, 'fill');
  band.removeFromParent();
  shell.add(band);

  // Spike ring: mine teeth, one merged mesh.
  const spikes = addPart(group, geo.buoySpikes, RUST_DARK, IR_METAL, 1.0, 0.9, 'fill');
  spikes.removeFromParent();
  shell.add(spikes);
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    shardSpecs.push({ direction: new Vector3(Math.cos(angle), 0, Math.sin(angle)).normalize(), color: OCHRE.clone(), size: 0.5 });
  }
  group.add(shell);
  group.userData.shell = shell;

  // Chain dangling below.
  const chainMaterial = new MeshBasicMaterial({ color: RUST_DARK.clone().multiplyScalar(0.9) });
  const chain = new Mesh(geo.buoyChain, chainMaterial);
  chain.position.y = -1.9;
  group.add(chain);
  tintable(group).push({ material: chainMaterial, murk: RUST_DARK.clone(), ir: IR_METAL.clone(), murkIntensity: 0.9, irIntensity: 0.8, kind: 'fill' });

  group.userData.accent = CREAM.clone();
  group.userData.shardSpecs = [...shardSpecs, { direction: new Vector3(0, -1, 0), color: OCHRE.clone(), size: 0.8 }];
  group.userData.lockRingScale = 1.7;
  return group;
}

// Strip the buoy's shell at its stage break: the ember heart burns naked.
export function breakBuoyShell(group: Group) {
  const shell = group.userData.shell as Group | undefined;
  if (!shell || shell.visible === false) return;
  shell.visible = false;
  for (const part of (group.userData.parts as TintPart[])) {
    if (part.kind === 'core') part.murkIntensity *= 2.0;
  }
}

// ---- gob: a homing blob of ink -------------------------------------------------

export function createGobMesh() {
  const group = new Group();
  const blobMaterial = new MeshBasicMaterial({
    color: new Color(0.012, 0.01, 0.014),
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  const blob = new Mesh(geo.gobBlob, blobMaterial);
  group.add(blob);

  // Faint warm rim so the gob reads against dark water in normal sight.
  const rimMaterial = new LineBasicMaterial(additiveMaterialParameters({ color: hdr(OCHRE, 0.9) }));
  const rim = new LineSegments(new EdgesGeometry(geo.gobBlob, 25), rimMaterial);
  blob.add(rim);

  const tailMaterial = createAdditiveBasicMaterial({ color: hdr(OCHRE, 0.5), opacity: 0.4 });
  const tail = new Mesh(geo.gobTail, tailMaterial);
  tail.rotation.x = -Math.PI / 2;
  tail.position.z = -1.0;
  group.add(tail);

  tintable(group).push(
    { material: rimMaterial, murk: OCHRE.clone(), ir: IR_HOT.clone(), murkIntensity: 0.9, irIntensity: 1.8, kind: 'edge' },
    { material: tailMaterial, murk: OCHRE.clone(), ir: IR_WARM.clone(), murkIntensity: 0.5, irIntensity: 1.0, kind: 'core' },
  );
  group.userData.isHostileShot = true;
  group.userData.trailInk = true;
  group.userData.accent = OIL_EDGE.clone();
  group.userData.shardSpecs = [
    { direction: new Vector3(0, 0, 1), color: OCHRE.clone(), size: 0.35 },
    { direction: new Vector3(0, 0, -1), color: OCHRE.clone(), size: 0.35 },
  ];
  group.userData.lockRingScale = 0.8;
  return group;
}

// ---- inkcloud: a drifting wall of oil-black smoke ------------------------------
// One merged mesh, shared geometry. Never tinted: ink stays cold black in both
// displays. Transparent, so the occlusion checker ignores it and targets
// behind stay honest.

const INK_COLOR = new Color(0.006, 0.006, 0.008);

export function createInkCloudMesh() {
  const material = new MeshBasicMaterial({
    color: INK_COLOR.clone(),
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });
  const group = new Group();
  group.add(new Mesh(geo.inkCloud, material));
  group.userData.isInk = true;
  return group;
}

// Shared helpers for arms (built in octopus-mesh).

export function suckerMaterial() {
  return createAdditiveBasicMaterial({ color: hdr(SODIUM, 0.55), opacity: 0.5, side: 2 });
}

export function signalNodeMaterial() {
  return new MeshBasicMaterial({ color: hdr(SIGNAL_RED, 0.8) });
}

export function seaGlassMaterial(intensity: number, opacity = 1) {
  if (opacity >= 1) return new MeshBasicMaterial({ color: hdr(SEA_GLASS, intensity) });
  return createAdditiveBasicMaterial({ color: hdr(SEA_GLASS, intensity), opacity });
}

export function circleGeometry(radius: number) {
  return new CircleGeometry(radius, 10);
}

export function torusGeometry(radius: number, tube: number, segments = 8) {
  return new TorusGeometry(radius, tube, 6, segments);
}
