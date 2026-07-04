import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OctahedronGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { BLOOD, EMBER, GOLD, hdr, OBSIDIAN, WHITE_HOT } from './palette';
import type { EmberSpec } from './effects';
import type { TintPart } from './enemies';

// The Suneater: a colossal obsidian serpent coiled around the dying star.
// Its distant coils arc out of the photosphere for the whole run; at the end
// the head breaches and holds the sky. The head is the lockable `heart`
// enemy; the trailing body is environment-owned and follows the head.

function facet(
  group: Group,
  geometry: IcosahedronGeometry | TetrahedronGeometry | BoxGeometry | CylinderGeometry | OctahedronGeometry,
  fillColor: Color,
  edgeColor: Color,
  edgeIntensity: number,
) {
  const parts = (group.userData.parts ??= []) as TintPart[];
  const fillMaterial = new MeshBasicMaterial({ color: fillColor.clone() });
  const fill = new Mesh(geometry, fillMaterial);
  const edgeMaterial = new LineBasicMaterial({
    color: hdr(edgeColor, edgeIntensity),
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  fill.add(new LineSegments(new EdgesGeometry(geometry), edgeMaterial));
  group.add(fill);
  parts.push(
    { material: fillMaterial, base: fillColor.clone(), kind: 'fill' },
    { material: edgeMaterial, base: hdr(edgeColor, edgeIntensity), kind: 'edge' },
  );
  return fill;
}

// ---- fang: a curved obsidian tooth the size of a house -------------------------

export function createFangMesh() {
  const group = new Group();
  const segments: Array<[number, number, number, number]> = [
    [1.05, 0, 0, 0],
    [0.78, 0.28, 1.15, 0.28],
    [0.5, 0.62, 2.1, 0.55],
    [0.26, 1.05, 2.85, 0.85],
  ];
  for (const [size, x, y, tilt] of segments) {
    const tooth = new TetrahedronGeometry(size, 0);
    tooth.scale(0.85, 1.7, 0.85);
    const mesh = facet(group, tooth, OBSIDIAN.clone().multiplyScalar(1.5), GOLD, 1.15);
    mesh.position.set(x, y, 0);
    mesh.rotation.set(0, 0.6, -tilt);
  }
  // Molten root socket.
  const socketMaterial = new MeshBasicMaterial({ color: hdr(EMBER, 1.5) });
  const socket = new Mesh(new CylinderGeometry(0.5, 0.72, 0.5, 6), socketMaterial);
  socket.position.y = -1.1;
  group.add(socket);
  ((group.userData.parts ??= []) as TintPart[]).push({ material: socketMaterial, base: hdr(EMBER, 1.5), kind: 'core' });
  // White-hot tip.
  const tipMaterial = new MeshBasicMaterial({ color: hdr(WHITE_HOT, 2.2) });
  const tip = new Mesh(new OctahedronGeometry(0.24, 0), tipMaterial);
  tip.position.set(1.35, 3.6, 0);
  group.add(tip);
  ((group.userData.parts ??= []) as TintPart[]).push({ material: tipMaterial, base: hdr(WHITE_HOT, 2.2), kind: 'core' });

  group.scale.setScalar(1.35);
  group.userData.accent = GOLD.clone();
  group.userData.shardSpecs = segments.map(([size, x, y]) => ({
    direction: new Vector3(x, y + 0.5, 0.2).normalize(),
    color: GOLD.clone(),
    size: size * 1.4,
  })) as EmberSpec[];
  group.userData.lockRingScale = 2.6;
  return group;
}

// ---- the head (the `heart` enemy) ----------------------------------------------

export function createHeadMesh() {
  const group = new Group();

  // Skull: a huge faceted wedge.
  const skullGeometry = new IcosahedronGeometry(5.2, 0);
  skullGeometry.scale(1.3, 0.95, 1.2);
  facet(group, skullGeometry, OBSIDIAN.clone().multiplyScalar(1.3), EMBER, 0.85);

  // Brow crown: a fan of horns over the top rim.
  for (let i = 0; i < 5; i += 1) {
    const angle = (i / 4 - 0.5) * Math.PI * 0.9;
    const horn = new TetrahedronGeometry(1.5, 0);
    horn.scale(0.55, 2.4, 0.55);
    const mesh = facet(group, horn, OBSIDIAN.clone().multiplyScalar(1.15), GOLD, 1.1);
    mesh.position.set(Math.sin(angle) * 5.4, 3.4 + Math.cos(angle) * 2.4, -0.8);
    mesh.rotation.z = -angle * 0.9;
  }

  // Jaw: a split lower wedge.
  for (const side of [-1, 1]) {
    const jawGeometry = new TetrahedronGeometry(2.6, 0);
    jawGeometry.scale(1.15, 0.6, 1.6);
    const jaw = facet(group, jawGeometry, OBSIDIAN.clone().multiplyScalar(1.2), EMBER, 0.9);
    jaw.position.set(side * 2.2, -4.2, 1.4);
    jaw.rotation.set(0.35, side * 0.4, side * 0.2);
  }

  // Eyes.
  for (const side of [-1, 1]) {
    const eyeMaterial = new MeshBasicMaterial({ color: hdr(WHITE_HOT, 2.4) });
    const eye = new Mesh(new OctahedronGeometry(0.55, 0), eyeMaterial);
    eye.position.set(side * 2.9, 1.7, 3.6);
    group.add(eye);
    ((group.userData.parts ??= []) as TintPart[]).push({ material: eyeMaterial, base: hdr(WHITE_HOT, 2.4), kind: 'core' });
  }

  // The heart: a molten orb behind four rib bars. Sealed = dim behind closed
  // ribs; exposed = the ribs hinge open and the orb runs white-hot.
  const heartMaterial = new MeshBasicMaterial({ color: hdr(GOLD, 0.55) });
  const heart = new Mesh(new OctahedronGeometry(1.75, 1), heartMaterial);
  heart.position.set(0, -0.6, 3.4);
  group.add(heart);
  const heartGlowMaterial = new MeshBasicMaterial({
    color: hdr(GOLD, 0.25),
    transparent: true,
    opacity: 0.4,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const heartGlow = new Mesh(new OctahedronGeometry(2.6, 1), heartGlowMaterial);
  heart.add(heartGlow);

  const ribs = new Group();
  ribs.position.copy(heart.position);
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const hinge = new Group();
    hinge.rotation.z = angle;
    const ribGeometry = new BoxGeometry(0.55, 4.6, 0.5);
    const rib = facet(group, ribGeometry, OBSIDIAN.clone().multiplyScalar(1.35), EMBER, 1.0);
    rib.removeFromParent();
    rib.position.y = 0;
    rib.position.z = 1.1;
    hinge.add(rib);
    hinge.userData.baseAngle = angle;
    ribs.add(hinge);
  }
  group.add(ribs);

  group.userData.heart = heart;
  group.userData.heartMaterial = heartMaterial;
  group.userData.heartGlowMaterial = heartGlowMaterial;
  group.userData.ribs = ribs;
  group.userData.accent = GOLD.clone();
  group.userData.isSerpentHead = true;
  group.userData.shardSpecs = Array.from({ length: 14 }, (_, i) => {
    const angle = (i / 14) * Math.PI * 2;
    return {
      direction: new Vector3(Math.cos(angle), Math.sin(angle) * 0.8, 0.3).normalize(),
      color: (i % 3 === 0 ? WHITE_HOT : i % 2 === 0 ? GOLD : EMBER).clone(),
      size: 1.6,
    };
  }) as EmberSpec[];
  group.userData.lockRingScale = 3.4;
  return group;
}

// Per-frame head dressing: seal state, breach/submerge shudder.
export function updateHeadMesh(head: Object3D, elapsed: number) {
  const exposed = head.userData.exposed === true;
  const heartMaterial = head.userData.heartMaterial as MeshBasicMaterial | undefined;
  const heartGlowMaterial = head.userData.heartGlowMaterial as MeshBasicMaterial | undefined;
  const ribs = head.userData.ribs as Group | undefined;
  if (!heartMaterial || !heartGlowMaterial || !ribs) return;

  const pulse = exposed ? 1.9 + Math.sin(elapsed * 7.5) * 0.7 : 0.55 + Math.sin(elapsed * 2.2) * 0.1;
  heartMaterial.color.copy(hdr(GOLD, pulse));
  heartGlowMaterial.color.copy(hdr(exposed ? WHITE_HOT : GOLD, pulse * 0.35));

  let spread = (head.userData.ribSpread as number | undefined) ?? 0;
  spread += ((exposed ? 1 : 0) - spread) * 0.06;
  head.userData.ribSpread = spread;
  for (const hinge of ribs.children) {
    const baseAngle = hinge.userData.baseAngle as number;
    hinge.rotation.z = baseAngle + spread * 0.95;
  }
}

// ---- the body: neck chain + colossal background coils ---------------------------

const NECK_SEGMENTS = 11;
const NECK_SPACING = 11;

export type SerpentBody = {
  root: Group;
  neck: Group[];
  coils: Array<{ pivot: Group; speed: number; phase: number }>;
  state: 'idle' | 'following' | 'dying';
  dyingFor: number;
};

function createNeckSegment(index: number): Group {
  const group = new Group();
  const t = index / (NECK_SEGMENTS - 1);
  const radius = 5.4 * (1 - t * 0.55);
  const ringGeometry = new CylinderGeometry(radius, radius * 0.92, radius * 1.15, 7);
  facet(group, ringGeometry, OBSIDIAN.clone().multiplyScalar(1.25 - t * 0.3), EMBER, 0.75 - t * 0.25);
  // Dorsal fin.
  const finGeometry = new TetrahedronGeometry(radius * 0.55, 0);
  finGeometry.scale(0.4, 2.1, 0.7);
  const fin = facet(group, finGeometry, OBSIDIAN.clone().multiplyScalar(1.1), GOLD, 0.9);
  fin.position.y = radius * 1.15;
  group.rotation.x = Math.PI / 2; // cylinder axis along z — travel direction
  const wrap = new Group();
  wrap.add(group);
  return wrap;
}

export function createSerpentBody(starCenter: Vector3, starRadius: number): SerpentBody {
  const root = new Group();

  const neck: Group[] = [];
  for (let i = 0; i < NECK_SEGMENTS; i += 1) {
    const segment = createNeckSegment(i);
    segment.visible = false;
    root.add(segment);
    neck.push(segment);
  }

  // Colossal distant coils breaching the star's surface. Visible from the
  // first second of the run as slow-moving silhouettes against the fire.
  const coils: SerpentBody['coils'] = [];
  const placements: Array<{ angle: number; tilt: number; major: number; tube: number; arc: number; speed: number }> = [
    { angle: -0.55, tilt: 0.35, major: 420, tube: 44, arc: 2.4, speed: 0.021 },
    { angle: 0.4, tilt: -0.2, major: 300, tube: 34, arc: 2.0, speed: -0.03 },
    { angle: 0.05, tilt: 0.1, major: 520, tube: 56, arc: 1.7, speed: 0.014 },
  ];
  for (const placement of placements) {
    const pivot = new Group();
    // Place the coil's pivot on the star's surface, ahead and to the side.
    const surface = starCenter
      .clone()
      .add(new Vector3(Math.sin(placement.angle) * starRadius * 0.8, starRadius * 0.55, Math.cos(placement.angle) * -starRadius * 0.62));
    pivot.position.copy(surface);
    pivot.rotation.z = placement.tilt;

    const coilGroup = new Group();
    const torus = new TorusGeometry(placement.major, placement.tube, 9, 64, placement.arc);
    const fillMaterial = new MeshBasicMaterial({ color: OBSIDIAN.clone().multiplyScalar(0.85) });
    coilGroup.add(new Mesh(torus, fillMaterial));
    // Dorsal seam: a glowing line along the coil's spine.
    const seam = new TorusGeometry(placement.major + placement.tube * 0.92, placement.tube * 0.08, 5, 64, placement.arc);
    const seamMaterial = new MeshBasicMaterial({
      color: hdr(EMBER, 0.9),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    coilGroup.add(new Mesh(seam, seamMaterial));
    // Spine fins along the arc.
    for (let i = 0; i < 7; i += 1) {
      const angle = (i / 6) * placement.arc;
      const finGeometry = new TetrahedronGeometry(placement.tube * 0.9, 0);
      finGeometry.scale(0.35, 2.4, 0.6);
      const fin = new Mesh(finGeometry, fillMaterial);
      const r = placement.major + placement.tube * 1.4;
      fin.position.set(Math.cos(angle) * r, Math.sin(angle) * r, 0);
      fin.rotation.z = angle - Math.PI / 2;
      coilGroup.add(fin);
    }
    coilGroup.rotation.x = 0.35;
    pivot.add(coilGroup);
    root.add(pivot);
    coils.push({ pivot: coilGroup as unknown as Group, speed: placement.speed, phase: Math.random() * Math.PI * 2 });
    coilGroup.userData.pivotBaseY = 0;
  }

  return { root, neck, coils, state: 'idle', dyingFor: 0 };
}

// Follow-chain: each neck segment pursues the one ahead at fixed spacing.
export function updateSerpentBody(body: SerpentBody, headPosition: Vector3 | null, dt: number, elapsed: number) {
  for (const coil of body.coils) {
    // Coils "swim": slow roll around their arc plus a surface bob.
    coil.pivot.rotation.z += coil.speed * dt;
    coil.pivot.position.y = Math.sin(elapsed * 0.16 + coil.phase) * 26 - (body.state === 'dying' ? body.dyingFor * 30 : 0);
  }

  if (body.state === 'dying') {
    body.dyingFor += dt;
    const sink = body.dyingFor * 26;
    for (const [index, segment] of body.neck.entries()) {
      segment.position.y -= dt * (14 + index * 2.5);
      segment.rotation.z += dt * 0.12;
      segment.visible = segment.position.y > -260 - sink;
    }
    return;
  }

  if (!headPosition) {
    for (const segment of body.neck) segment.visible = false;
    body.state = 'idle';
    return;
  }

  body.state = 'following';
  let leader = headPosition;
  for (const segment of body.neck) {
    if (!segment.visible) {
      segment.position.copy(leader).add(new Vector3(0, -NECK_SPACING, 6));
      segment.visible = true;
    }
    const toLeader = leader.clone().sub(segment.position);
    const distance = toLeader.length();
    if (distance > NECK_SPACING) {
      segment.position.addScaledVector(toLeader.normalize(), Math.min(distance - NECK_SPACING, distance * Math.min(1, dt * 4.5)));
    }
    segment.lookAt(leader);
    leader = segment.position;
  }
}

export function killSerpentBody(body: SerpentBody) {
  body.state = 'dying';
  body.dyingFor = 0;
}

export const SERPENT_DEATH_COLOR = BLOOD;
