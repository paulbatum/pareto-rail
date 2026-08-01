import {
  BoxGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
} from 'three';
import type { Object3D } from 'three';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { BLOOD, hdr, STONE, STONE_DARK, STONE_EDGE, STONE_LINE, WHITE_HOT, WINDOW_PALETTE } from './palette';

// Enemies are flat black shapes with a stolen pane's colour burning in the
// chest — the colour is the only reason you can see them at all. Every shape
// keeps that language: a dark stone body with a bright colour core, and a
// dim edge so the silhouette reads against the void even with bloom off.

export type TintPart = { material: MeshBasicMaterial | LineBasicMaterial; kind: 'edge' | 'fill' | 'core' };

export type CoreGem = { mesh: Mesh; colour: Color };

const PANE_EDGE = new Color(0.16, 0.17, 0.24);

export function createPaneMesh(accent: Color): Group {
  const group = new Group();
  const body = new Mesh(
    new PlaneGeometry(1.5, 2.0),
    new MeshBasicMaterial({ color: STONE_DARK, side: DoubleSide }),
  );
  group.add(body);

  // A dim outline so the pane's silhouette reads against the black.
  const outline = new LineSegments(
    new EdgesGeometry(new PlaneGeometry(1.5, 2.0)),
    new LineBasicMaterial({ color: PANE_EDGE }),
  );
  group.add(outline);

  // The stolen pane's colour, burning in the chest.
  const core = new Mesh(
    new OctahedronGeometry(0.42, 0),
    new MeshBasicMaterial({ color: hdr(accent, 2.0) }),
  );
  core.scale.set(1, 1.4, 0.5);
  core.position.z = 0.06;
  group.add(core);

  const coreGlow = new Mesh(
    new OctahedronGeometry(0.55, 0),
    createAdditiveBasicMaterial({ color: hdr(accent, 0.7) }),
  );
  coreGlow.scale.set(1, 1.4, 0.5);
  coreGlow.position.z = 0.04;
  group.add(coreGlow);

  group.userData.accent = accent.clone();
  group.userData.parts = [
    { material: body.material as MeshBasicMaterial, kind: 'fill' },
    { material: core.material as MeshBasicMaterial, kind: 'core' },
    { material: outline.material as LineBasicMaterial, kind: 'edge' },
  ] satisfies TintPart[];
  group.userData.lockRingScale = 1.3;
  return group;
}

export function createCenserMesh(accent: Color): Group {
  const group = new Group();

  // The cage: a pierced metal sphere — the light is inside, held.
  const cageGeometry = new SphereGeometry(0.95, 10, 7);
  const cage = new LineSegments(
    new EdgesGeometry(cageGeometry),
    new LineBasicMaterial({ color: STONE_EDGE }),
  );
  group.add(cage);

  const core = new Mesh(
    new OctahedronGeometry(0.55, 0),
    new MeshBasicMaterial({ color: hdr(accent, 2.1) }),
  );
  group.add(core);

  const coreGlow = new Mesh(
    new OctahedronGeometry(0.72, 0),
    createAdditiveBasicMaterial({ color: hdr(accent, 0.75) }),
  );
  group.add(coreGlow);

  // The chain, up to the gallery bracket it hangs from.
  const chain = new LineSegments(
    new EdgesGeometry(new BoxGeometry(0.05, 4.6, 0.05)),
    new LineBasicMaterial({ color: STONE_LINE }),
  );
  chain.position.y = 2.8;
  group.add(chain);

  group.userData.accent = accent.clone();
  group.userData.parts = [
    { material: cage.material as LineBasicMaterial, kind: 'edge' },
    { material: core.material as MeshBasicMaterial, kind: 'core' },
  ] satisfies TintPart[];
  group.userData.lockRingScale = 1.15;
  return group;
}

export function createChoirMesh(accent: Color): Group {
  const group = new Group();
  // A row of three small dark panes curving like stalls processing down the
  // nave; the middle one carries the stolen colour.
  const specs: Array<[number, number, number, boolean]> = [
    [-1.05, -0.35, 0.25, false],
    [0, 0, 0, true],
    [1.05, -0.35, 0.25, false],
  ];
  const parts: TintPart[] = [];
  for (const [x, y, z, main] of specs) {
    const unit = new Group();
    const body = new Mesh(
      new PlaneGeometry(0.95, 1.3),
      new MeshBasicMaterial({ color: STONE_DARK, side: DoubleSide }),
    );
    unit.add(body);
    const outline = new LineSegments(
      new EdgesGeometry(new PlaneGeometry(0.95, 1.3)),
      new LineBasicMaterial({ color: PANE_EDGE }),
    );
    unit.add(outline);
    if (main) {
      const core = new Mesh(
        new OctahedronGeometry(0.3, 0),
        new MeshBasicMaterial({ color: hdr(accent, 2.0) }),
      );
      core.scale.set(1, 1.35, 0.5);
      core.position.z = 0.06;
      unit.add(core);
      parts.push({ material: core.material as MeshBasicMaterial, kind: 'core' });
    }
    unit.position.set(x, y, z);
    unit.rotation.z = x * 0.22;
    group.add(unit);
    parts.push({ material: body.material as MeshBasicMaterial, kind: 'fill' });
    parts.push({ material: outline.material as LineBasicMaterial, kind: 'edge' });
  }
  group.userData.accent = accent.clone();
  group.userData.parts = parts;
  group.userData.lockRingScale = 1.5;
  return group;
}

export function createHeraldMesh(accent: Color): Group {
  const group = new Group();

  // A tall dark pulpit: a tapering reading desk of black stone.
  const body = new Mesh(
    new BoxGeometry(1.7, 3.3, 1.3),
    new MeshBasicMaterial({ color: STONE }),
  );
  body.position.y = 0.4;
  group.add(body);

  const desk = new Mesh(
    new BoxGeometry(2.1, 0.55, 1.7),
    new MeshBasicMaterial({ color: STONE }),
  );
  desk.position.y = 2.15;
  group.add(desk);

  const outline = new LineSegments(
    new EdgesGeometry(new BoxGeometry(1.7, 3.3, 1.3)),
    new LineBasicMaterial({ color: STONE_EDGE }),
  );
  outline.position.y = 0.4;
  group.add(outline);

  // The stolen light, held in a vertical seam down the front. Dim until the
  // armour breaks; then it blazes.
  const seam = new Mesh(
    new PlaneGeometry(0.26, 2.6),
    new MeshBasicMaterial({ color: hdr(accent, 0.55) }),
  );
  seam.position.set(0, 0.3, 0.68);
  group.add(seam);
  const seamGlow = new Mesh(
    new PlaneGeometry(0.34, 2.7),
    createAdditiveBasicMaterial({ color: hdr(accent, 0.25) }),
  );
  seamGlow.position.set(0, 0.3, 0.66);
  group.add(seamGlow);

  group.userData.accent = accent.clone();
  group.userData.parts = [
    { material: body.material as MeshBasicMaterial, kind: 'fill' },
    { material: desk.material as MeshBasicMaterial, kind: 'fill' },
    { material: outline.material as LineBasicMaterial, kind: 'edge' },
    { material: seam.material as MeshBasicMaterial, kind: 'core' },
    { material: seamGlow.material as MeshBasicMaterial, kind: 'core' },
  ] satisfies TintPart[];
  group.userData.lockRingScale = 1.7;
  return group;
}

export function createWispMesh(): Group {
  const group = new Group();
  const shell = new Mesh(
    new OctahedronGeometry(0.42, 0),
    new MeshBasicMaterial({ color: STONE_DARK }),
  );
  group.add(shell);
  const core = new Mesh(
    new OctahedronGeometry(0.2, 0),
    new MeshBasicMaterial({ color: hdr(BLOOD, 2.6) }),
  );
  group.add(core);
  group.userData.accent = BLOOD.clone();
  group.userData.parts = [
    { material: shell.material as MeshBasicMaterial, kind: 'fill' },
    { material: core.material as MeshBasicMaterial, kind: 'core' },
  ] satisfies TintPart[];
  return group;
}

export function createThornMesh(accent: Color): Group {
  const group = new Group();
  // A long dark spike — a rose thorn pulled off the window's stonework.
  const spike = new Mesh(
    new ConeGeometry(0.62, 3.4, 5),
    new MeshBasicMaterial({ color: STONE }),
  );
  spike.rotation.x = Math.PI / 2;
  group.add(spike);

  const outline = new LineSegments(
    new EdgesGeometry(new ConeGeometry(0.62, 3.4, 5)),
    new LineBasicMaterial({ color: STONE_EDGE }),
  );
  outline.rotation.x = Math.PI / 2;
  group.add(outline);

  const eye = new Mesh(
    new OctahedronGeometry(0.3, 0),
    new MeshBasicMaterial({ color: hdr(accent, 2.0) }),
  );
  eye.position.z = -0.9;
  group.add(eye);

  group.userData.accent = accent.clone();
  group.userData.parts = [
    { material: spike.material as MeshBasicMaterial, kind: 'fill' },
    { material: outline.material as LineBasicMaterial, kind: 'edge' },
    { material: eye.material as MeshBasicMaterial, kind: 'core' },
  ] satisfies TintPart[];
  group.userData.lockRingScale = 1.5;
  return group;
}

export function createCoreMesh(): Group {
  const group = new Group();

  // The Devourer: a black mass nested in the rose window's dead heart,
  // holding every colour it has taken. A cage of dark stone, a ring of
  // stolen colour gems, and a dark shell that bursts when exposed.
  const body = new Mesh(
    new IcosahedronGeometry(2.5, 1),
    new MeshBasicMaterial({ color: STONE_DARK }),
  );
  group.add(body);

  const cage = new LineSegments(
    new EdgesGeometry(new IcosahedronGeometry(2.5, 1)),
    new LineBasicMaterial({ color: STONE_EDGE }),
  );
  group.add(cage);

  // The shell: the dark heart of the rose it nests in. Bursts when exposed.
  const shell = new Mesh(
    new RingGeometry(3.4, 5.2, 6),
    new MeshBasicMaterial({ color: STONE, side: DoubleSide }),
  );
  shell.userData.shell = true;
  group.add(shell);

  // The stolen colours, swirling in its chest.
  const gems: CoreGem[] = [];
  const gemGeometry = new OctahedronGeometry(0.42, 0);
  for (let i = 0; i < 10; i += 1) {
    const colour = WINDOW_PALETTE[i % WINDOW_PALETTE.length];
    const gem = new Mesh(gemGeometry, new MeshBasicMaterial({ color: hdr(colour, 1.9) }));
    gem.position.z = 0.3;
    group.add(gem);
    gems.push({ mesh: gem, colour: colour.clone() });
  }

  const bodyGlow = new Mesh(
    new IcosahedronGeometry(2.8, 1),
    createAdditiveBasicMaterial({ color: hdr(WHITE_HOT, 0.1) }),
  );
  group.add(bodyGlow);

  group.userData.accent = WHITE_HOT.clone();
  group.userData.parts = [
    { material: body.material as MeshBasicMaterial, kind: 'fill' },
    { material: cage.material as LineBasicMaterial, kind: 'edge' },
  ] satisfies TintPart[];
  group.userData.shell = shell;
  group.userData.gems = gems;
  group.userData.lockRingScale = 2.6;
  return group;
}

// The player's shot: a golden dart — the player shoots light back into the
// dark. The one warm projectile in the level.
export function createProjectileMesh(): Object3D {
  const group = new Group();
  const coreGeometry = new OctahedronGeometry(0.32, 0);
  coreGeometry.scale(0.42, 0.42, 2.3);
  group.add(new Mesh(coreGeometry, new MeshBasicMaterial({ color: hdr(WHITE_HOT, 2.6) })));
  const shellGeometry = new OctahedronGeometry(0.48, 0);
  shellGeometry.scale(0.5, 0.5, 2.0);
  group.add(
    new Mesh(
      shellGeometry,
      createAdditiveBasicMaterial({ color: hdr(new Color(1.0, 0.68, 0.14), 0.9) }),
    ),
  );
  return group;
}
