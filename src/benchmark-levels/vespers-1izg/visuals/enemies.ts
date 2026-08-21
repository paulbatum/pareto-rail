import {
  BufferGeometry,
  DoubleSide,
  CircleGeometry,
  Color,
  CylinderGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three';
import { additiveMaterialParameters, createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { BODY_BLACK, GLOOM, MOON, jewelForWindow } from './palette';

// Enemy meshes for Vespers. The things that eat the light come off the glass
// as flat black shapes with a stolen pane's colour burning in their chest —
// that ember is the only reason you can see them. Every factory honors the
// shared userData contract (emberMaterial/glowMaterial/emberBase/glowBase/
// accent/shardColor) so the spine's lock tint, distance falloff, and kill
// bursts work on all of them unchanged.

export type EnemyVisuals = Group & {
  userData: {
    emberMaterial?: MeshBasicMaterial;
    glowMaterial?: MeshBasicMaterial;
    emberBase?: Color;
    glowBase?: Color;
    accent?: Color;
    shardColor?: Color;
    wings?: [Mesh, Mesh];
    irisMaterial?: MeshBasicMaterial;
    irisBase?: Color;
    orbs?: Mesh[];
    orbAngle?: number;
    voidMaterial?: MeshBasicMaterial;
    lockRingScale?: number;
    isBolt?: boolean;
    [key: string]: unknown;
  };
};

function ember(color: Color, coreRadius = 0.3, glowRadius = 0.62, glowGain = 0.55) {
  const emberBase = color.clone().multiplyScalar(1.7);
  const glowBase = color.clone().multiplyScalar(0.6);
  const emberMaterial = new MeshBasicMaterial({ color: emberBase.clone() });
  const glowMaterial = createAdditiveBasicMaterial({ color: glowBase.clone(), opacity: 0.5 });
  const core = new Mesh(new OctahedronGeometry(coreRadius, 1), emberMaterial);
  const glow = new Mesh(new OctahedronGeometry(glowRadius, 1), glowMaterial);
  return { core, glow, emberMaterial, glowMaterial, emberBase, glowBase };
}

function finish(group: EnemyVisuals, parts: ReturnType<typeof ember>, accent: Color, lockRingScale = 1) {
  group.userData.emberMaterial = parts.emberMaterial;
  group.userData.glowMaterial = parts.glowMaterial;
  group.userData.emberBase = parts.emberBase;
  group.userData.glowBase = parts.glowBase;
  group.userData.accent = accent;
  group.userData.shardColor = accent;
  group.userData.lockRingScale = lockRingScale;
  return group;
}

function rimMaterial(intensity = 0.4) {
  return new LineBasicMaterial(additiveMaterialParameters({
    color: MOON.clone().multiplyScalar(intensity),
  }));
}

function asEnemy(group: Group): EnemyVisuals {
  return group as EnemyVisuals;
}

// --- The shade: a flat black gargoyle silhouette with wings that slowly
// beat. The chest ember is its stolen pane.
export function createShadeMesh(windowIndex: number): EnemyVisuals {
  const group = asEnemy(new Group());
  const accent = jewelForWindow(windowIndex);

  const wingShape = (side: -1 | 1) => {
    const shape = new Shape();
    shape.moveTo(0, 0.35);
    shape.quadraticCurveTo(side * 0.9, 0.75, side * 2.3, 0.55);
    shape.quadraticCurveTo(side * 1.7, 0.05, side * 1.9, -0.55);
    shape.quadraticCurveTo(side * 1.1, -0.15, side * 0.75, -0.7);
    shape.quadraticCurveTo(side * 0.35, -0.3, 0, -0.25);
    shape.closePath();
    return shape;
  };
  const bodyMaterial = new MeshBasicMaterial({ color: BODY_BLACK, side: DoubleSide });

  const body = new Mesh(new ShapeGeometry(torsoShape()), bodyMaterial);
  body.position.z = 0.001;
  const wingL = new Mesh(new ShapeGeometry(wingShape(-1)), bodyMaterial);
  const wingR = new Mesh(new ShapeGeometry(wingShape(1)), bodyMaterial);

  // Faint cold rim so the silhouette reads even against black stone.
  const rim = new LineSegments(
    mergeEdgeGeometries([torsoShape(), wingShape(-1), wingShape(1)]),
    rimMaterial(0.34),
  );

  const parts = ember(accent, 0.26, 0.55);
  parts.core.position.set(0, 0.1, 0.06);
  parts.glow.position.set(0, 0.1, 0.06);

  group.add(body, wingL, wingR, rim, parts.core, parts.glow);
  group.userData.wings = [wingL, wingR];
  return finish(group, parts, accent);
}

function torsoShape(): Shape {
  const shape = new Shape();
  shape.moveTo(0, 0.95); // head
  shape.lineTo(0.28, 0.55);
  shape.lineTo(0.34, -0.5);
  shape.lineTo(0.16, -1.05); // tail tip
  shape.lineTo(0, -0.6);
  shape.lineTo(-0.16, -1.05);
  shape.lineTo(-0.34, -0.5);
  shape.lineTo(-0.28, 0.55);
  shape.closePath();
  return shape;
}

function mergeEdgeGeometries(shapes: Shape[]): BufferGeometry {
  const positions: number[] = [];
  for (const shape of shapes) {
    const points = shape.getPoints(10);
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      positions.push(a.x, a.y, 0.002, b.x, b.y, 0.002);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

// --- The censer: a dark thurible hanging from an invisible chain, swinging
// on its pendulum. The chain is part of the mesh; gameplay swings the group.
export function createCenserMesh(windowIndex: number): EnemyVisuals {
  const group = asEnemy(new Group());
  const accent = jewelForWindow(windowIndex);
  const CHAIN_LENGTH = 6.2;

  const chainGeometry = new BufferGeometry().setFromPoints([
    new Vector3(0, CHAIN_LENGTH, 0),
    new Vector3(0, 0.62, 0),
  ]);
  group.add(new Line(chainGeometry, rimMaterial(0.3)));

  // Lantern cage: two stacked octahedron wireframes, dark metal.
  const cageMaterial = new LineBasicMaterial(additiveMaterialParameters({
    color: MOON.clone().multiplyScalar(0.42),
  }));
  const cage = new LineSegments(new EdgesGeometry(new OctahedronGeometry(0.62, 0)), cageMaterial);
  const cage2 = new LineSegments(new EdgesGeometry(new OctahedronGeometry(0.42, 0).rotateZ(Math.PI / 4)), cageMaterial);
  cage2.position.y = 0.02;
  group.add(cage, cage2);

  const parts = ember(accent, 0.24, 0.5);
  group.add(parts.core, parts.glow);
  return finish(group, parts, accent, 0.9);
}

// --- The watcher: a ring-eye that holds position, flares its iris, and spits
// gloom. The iris is the stolen pane.
export function createWatcherMesh(windowIndex: number): EnemyVisuals {
  const group = asEnemy(new Group());
  const accent = jewelForWindow(windowIndex);

  const outer = new Mesh(
    new RingGeometry(1.05, 1.3, 32),
    new MeshBasicMaterial({ color: BODY_BLACK, side: DoubleSide }),
  );
  const rim = new LineSegments(
    new EdgesGeometry(new RingGeometry(1.05, 1.3, 32).toNonIndexed()),
    rimMaterial(0.4),
  );

  const irisBase = accent.clone().multiplyScalar(1.5);
  const irisMaterial = new MeshBasicMaterial({ color: irisBase.clone() });
  const iris = new Mesh(new CircleGeometry(0.62, 24), irisMaterial);
  iris.position.z = 0.02;

  const pupil = new Mesh(new CircleGeometry(0.24, 16), new MeshBasicMaterial({ color: 0x000000 }));
  pupil.position.z = 0.03;

  // Four lashes: the "this one shoots back" read.
  const lashGeometry = new BufferGeometry();
  const lashPositions: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
    lashPositions.push(
      Math.cos(angle) * 1.32, Math.sin(angle) * 1.32, 0,
      Math.cos(angle) * 1.72, Math.sin(angle) * 1.72, 0,
    );
  }
  lashGeometry.setAttribute('position', new Float32BufferAttribute(lashPositions, 3));
  const lashes = new LineSegments(lashGeometry, rimMaterial(0.55));

  const glowMaterial = createAdditiveBasicMaterial({
    color: accent.clone().multiplyScalar(0.4),
    opacity: 0.3,
  });
  const glow = new Mesh(new RingGeometry(0.7, 1.0, 24), glowMaterial);
  glow.position.z = 0.01;

  group.add(outer, rim, iris, pupil, lashes, glow);
  group.userData.emberMaterial = irisMaterial;
  group.userData.emberBase = irisBase;
  group.userData.glowMaterial = glowMaterial;
  group.userData.glowBase = accent.clone().multiplyScalar(0.4);
  group.userData.irisMaterial = irisMaterial;
  group.userData.irisBase = irisBase;
  group.userData.accent = accent;
  group.userData.shardColor = accent;
  group.userData.lockRingScale = 1.15;
  return group;
}

// --- Gloom: the watcher's spit. A dark dart with a cold violet wake —
// deliberately not a jewel color, so danger never reads as treasure.
export function createGloomMesh(): EnemyVisuals {
  const group = asEnemy(new Group());
  const body = new Mesh(
    new OctahedronGeometry(0.3, 0).scale(0.55, 0.55, 1.9),
    new MeshBasicMaterial({ color: 0x0a0812 }),
  );
  const glowMaterial = createAdditiveBasicMaterial({ color: GLOOM.clone().multiplyScalar(0.9), opacity: 0.6 });
  const glow = new Mesh(new OctahedronGeometry(0.42, 0).scale(0.6, 0.6, 2.0), glowMaterial);
  const coreMaterial = new MeshBasicMaterial({ color: GLOOM.clone().multiplyScalar(1.8) });
  const core = new Mesh(new OctahedronGeometry(0.16, 0), coreMaterial);
  const ring = new LineSegments(
    new EdgesGeometry(new RingGeometry(0.72, 0.8, 3)),
    new LineBasicMaterial(additiveMaterialParameters({ color: GLOOM.clone().multiplyScalar(1.2) })),
  );
  group.add(body, glow, core, ring);
  group.userData.isBolt = true;
  group.userData.emberMaterial = coreMaterial;
  group.userData.emberBase = coreMaterial.color.clone();
  group.userData.glowMaterial = glowMaterial;
  group.userData.glowBase = glowMaterial.color.clone();
  group.userData.accent = GLOOM;
  group.userData.shardColor = GLOOM;
  group.userData.lockRingScale = 0.8;
  return group;
}

// --- Devourer parts -------------------------------------------------------

// One spoke of the crown: a long dark rod with a stolen jewel at its tip.
export function createSpokeMesh(windowIndex: number): EnemyVisuals {
  const group = asEnemy(new Group());
  const accent = jewelForWindow(windowIndex);
  const rod = new Mesh(
    new CylinderGeometry(0.14, 0.14, 4.4, 6).rotateZ(Math.PI / 2),
    new MeshBasicMaterial({ color: BODY_BLACK }),
  );
  const rim = new LineSegments(new EdgesGeometry(rod.geometry as BufferGeometry, 12), rimMaterial(0.4));
  const parts = ember(accent, 0.3, 0.62);
  parts.core.position.x = 1.9;
  parts.glow.position.x = 1.9;
  group.add(rod, rim, parts.core, parts.glow);
  return finish(group, parts, accent, 1.05);
}

// One petal pane of the rose: a flat hex slab, dark, with a jewel rim.
export function createPetalMesh(windowIndex: number): EnemyVisuals {
  const group = asEnemy(new Group());
  const accent = jewelForWindow(windowIndex + 1);
  const plate = new Mesh(
    new CylinderGeometry(1.6, 1.6, 0.24, 6).rotateX(Math.PI / 2),
    new MeshBasicMaterial({ color: BODY_BLACK, side: DoubleSide }),
  );
  const rim = new LineSegments(new EdgesGeometry(plate.geometry as BufferGeometry, 12), new LineBasicMaterial(
    additiveMaterialParameters({ color: accent.clone().multiplyScalar(1.1) }),
  ));
  const parts = ember(accent, 0.3, 0.6, 0.45);
  parts.core.position.z = 0.2;
  parts.glow.position.z = 0.2;
  group.add(plate, rim, parts.core, parts.glow);
  return finish(group, parts, accent, 1.35);
}

// The heart of the Devourer: a dark rose mandala with the four stolen jewel
// colours orbiting its void. When the shell breaks, the void opens.
export function createHeartMesh(): EnemyVisuals {
  const group = asEnemy(new Group());
  const shellMaterial = new LineBasicMaterial(additiveMaterialParameters({
    color: MOON.clone().multiplyScalar(0.5),
  }));
  for (const [radius, segments, twist] of [
    [1.3, 24, 0],
    [2.2, 6, Math.PI / 6],
    [3.2, 12, 0],
  ] as const) {
    const geometry = segments === 6 || segments === 12
      ? polygonRing(radius, segments, twist)
      : new EdgesGeometry(new RingGeometry(radius - 0.03, radius, segments).toNonIndexed());
    group.add(new LineSegments(geometry, shellMaterial));
  }

  const voidMaterial = new MeshBasicMaterial({ color: 0x050508 });
  const voidDisc = new Mesh(new CircleGeometry(1.15, 24), voidMaterial);
  voidDisc.position.z = 0.02;
  const voidGlowMaterial = createAdditiveBasicMaterial({ color: new Color(0.5, 0.2, 0.6), opacity: 0.25 });
  const voidGlow = new Mesh(new CircleGeometry(2.0, 24), voidGlowMaterial);
  voidGlow.position.z = 0.01;
  group.add(voidDisc, voidGlow);

  // The stolen colours, orbiting the void: one orb per jewel.
  const orbs: Mesh[] = [];
  for (let i = 0; i < 4; i += 1) {
    const jewel = jewelForWindow(i);
    const orb = new Mesh(
      new OctahedronGeometry(0.24, 0),
      new MeshBasicMaterial({ color: jewel.clone().multiplyScalar(1.6) }),
    );
    const orbGlow = new Mesh(
      new OctahedronGeometry(0.4, 0),
      createAdditiveBasicMaterial({ color: jewel.clone().multiplyScalar(0.55), opacity: 0.5 }),
    );
    orb.add(orbGlow);
    orbs.push(orb);
    group.add(orb);
  }

  group.userData.emberMaterial = voidGlowMaterial;
  group.userData.emberBase = voidGlowMaterial.color.clone();
  group.userData.glowMaterial = voidGlowMaterial;
  group.userData.glowBase = voidGlowMaterial.color.clone();
  group.userData.accent = new Color(0.7, 0.3, 0.8);
  group.userData.shardColor = new Color(0.8, 0.6, 1.0);
  group.userData.voidMaterial = voidMaterial;
  group.userData.orbs = orbs;
  group.userData.orbAngle = 0;
  group.userData.lockRingScale = 2.2;
  return group;
}

function polygonRing(radius: number, segments: number, twist: number): BufferGeometry {
  const positions: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a0 = twist + (i / segments) * Math.PI * 2;
    const a1 = twist + ((i + 1) / segments) * Math.PI * 2;
    positions.push(
      Math.cos(a0) * radius, Math.sin(a0) * radius, 0,
      Math.cos(a1) * radius, Math.sin(a1) * radius, 0,
    );
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}
