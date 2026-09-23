import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  PlaneGeometry,
  RingGeometry,
} from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { mix, uniform, vec3 } from 'three/tsl';
import { senseUniforms } from './materials';

// The player's instruments: mercury-vapor light in a sodium yard. The sight,
// the lock brackets, and the harpoon shots. Everything here is flat and
// additive, and carries a `boost` so it survives the ink darkening the frame.

/** Brightness compensation for the ink pass (written by the spine each frame). */
export const sightBoost = uniform(1);

const colorUniform = (value: Color) => uniform(value);
export type SightPart = { color: ReturnType<typeof colorUniform>; base: Color };

function sightMaterial(color: Color, thermalColor?: Color) {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: DoubleSide,
    fog: false,
  });
  const tint = colorUniform(color.clone());
  const thermal = thermalColor ? vec3(thermalColor.r, thermalColor.g, thermalColor.b) : tint;
  material.colorNode = mix(tint, thermal, senseUniforms.thermal).mul(sightBoost);
  return { material, part: { color: tint, base: color.clone() } satisfies SightPart };
}

export type ReticleParts = {
  parts: SightPart[];
  pips: SightPart[];
  spinner: Group;
  brackets: Group;
};

/** The sight: a lock-radius ring, four crane-hook brackets, and six lock pips. */
export function createSight(ringColor: Color, accent: Color, radius: number) {
  const group = new Group();
  const parts: SightPart[] = [];
  const add = (mesh: Mesh, part: SightPart, parent: Group = group) => {
    parent.add(mesh);
    parts.push(part);
    return mesh;
  };

  const ring = sightMaterial(ringColor);
  add(new Mesh(new RingGeometry(radius * 0.965, radius, 64), ring.material), ring.part);
  const inner = sightMaterial(accent.clone().multiplyScalar(0.7));
  add(new Mesh(new RingGeometry(radius * 0.36, radius * 0.39, 32), inner.material), inner.part);
  const dot = sightMaterial(accent.clone().multiplyScalar(1.6));
  add(new Mesh(new CircleGeometry(radius * 0.045, 12), dot.material), dot.part);

  const brackets = new Group();
  for (let i = 0; i < 4; i += 1) {
    const corner = new Group();
    const bracket = sightMaterial(ringColor.clone().multiplyScalar(1.2));
    const a = new Mesh(new PlaneGeometry(radius * 0.28, radius * 0.045), bracket.material);
    const b = new Mesh(new PlaneGeometry(radius * 0.045, radius * 0.28), bracket.material);
    a.position.set(radius * 0.12, 0, 0);
    b.position.set(0, radius * 0.12, 0);
    corner.add(a, b);
    parts.push(bracket.part);
    corner.position.set(radius * 1.12, radius * 1.12, 0);
    const pivot = new Group();
    pivot.rotation.z = (i * Math.PI) / 2;
    corner.rotation.z = Math.PI;
    pivot.add(corner);
    brackets.add(pivot);
  }
  group.add(brackets);

  // Six lock pips spaced around the ring: they fill as the volley charges.
  const spinner = new Group();
  const pips: SightPart[] = [];
  for (let i = 0; i < 6; i += 1) {
    const pip = sightMaterial(ringColor.clone().multiplyScalar(0.25));
    const mesh = new Mesh(new PlaneGeometry(radius * 0.16, radius * 0.07), pip.material);
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 2;
    mesh.position.set(Math.cos(angle) * radius * 0.8, Math.sin(angle) * radius * 0.8, 0);
    mesh.rotation.z = angle;
    spinner.add(mesh);
    pips.push(pip.part);
  }
  group.add(spinner);
  group.userData.sight = { parts, pips, spinner, brackets } satisfies ReticleParts;
  return group;
}

// Lock brackets share one material; each marker's color rides on the drawn
// object's `userData.sightColor`.
type ObjectFrame = { object?: { userData: Record<string, unknown> } };
const markerColor = colorUniform(new Color(1, 1, 1)).onObjectUpdate(((frame: ObjectFrame) => frame.object?.userData.sightColor as Color | undefined) as never);
let markerMaterial: MeshBasicNodeMaterial | null = null;
const bracketA = new PlaneGeometry(0.5, 0.08);
const bracketB = new PlaneGeometry(0.08, 0.5);
const markerRing = new RingGeometry(0.72, 0.76, 32);

/** Lock brackets that clamp around a locked target. Recolor via `userData.sightColor`. */
export function createLockMarker(color: Color) {
  if (!markerMaterial) {
    markerMaterial = new MeshBasicNodeMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, depthTest: false, side: DoubleSide, fog: false });
    // In thermal every lock burns signal red, the display's only color.
    markerMaterial.colorNode = mix(markerColor, vec3(2.6, 0.22, 0.1), senseUniforms.thermal.mul(0.85)).mul(sightBoost);
  }
  const group = new Group();
  const shared = color.clone();
  for (let i = 0; i < 4; i += 1) {
    const corner = new Group();
    const a = new Mesh(bracketA, markerMaterial);
    const b = new Mesh(bracketB, markerMaterial);
    a.position.set(0.21, 0, 0);
    b.position.set(0, 0.21, 0);
    corner.add(a, b);
    corner.position.set(-1, -1, 0);
    const pivot = new Group();
    pivot.rotation.z = (i * Math.PI) / 2;
    pivot.add(corner);
    group.add(pivot);
  }
  group.add(new Mesh(markerRing, markerMaterial));
  group.traverse((object) => {
    object.userData.sightColor = shared;
    object.renderOrder = 900;
  });
  group.userData.sightColor = shared;
  return group;
}

let harpoonParts: { shaft: CylinderGeometry; head: ConeGeometry; barbs: ConeGeometry; shaftMaterial: MeshBasicNodeMaterial; headMaterial: MeshBasicNodeMaterial } | null = null;

/** The harpoon: a mercury-bright barbed spear. All shots share one build. */
export function createHarpoon(color: Color) {
  harpoonParts ??= {
    shaft: new CylinderGeometry(0.06, 0.06, 2.4, 5),
    head: new ConeGeometry(0.2, 0.8, 5),
    barbs: new ConeGeometry(0.16, 0.5, 3),
    shaftMaterial: sightMaterial(color.clone().multiplyScalar(1.4)).material,
    headMaterial: sightMaterial(color.clone().multiplyScalar(3)).material,
  };
  const group = new Group();
  const shaftMesh = new Mesh(harpoonParts.shaft, harpoonParts.shaftMaterial);
  shaftMesh.rotation.x = Math.PI / 2;
  shaftMesh.position.z = -0.6;
  const headMesh = new Mesh(harpoonParts.head, harpoonParts.headMaterial);
  headMesh.rotation.x = Math.PI / 2;
  headMesh.position.z = 0.9;
  const barbs = new Mesh(harpoonParts.barbs, harpoonParts.headMaterial);
  barbs.rotation.x = -Math.PI / 2;
  barbs.position.z = 0.45;
  group.add(shaftMesh, headMesh, barbs);
  return group;
}
