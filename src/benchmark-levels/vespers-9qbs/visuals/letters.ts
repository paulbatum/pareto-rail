import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RingGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { glyphOnCells } from '../../../engine/glyphs';
import { mulberry32 } from '../../../engine/rng';

// Leaf: START/REPLAY as stained glass. Each lit cell of the 5×7 grid is a
// pane of jewel glass set in black lead, so the words read as little windows
// hung in the nave. The spine picks each letter's jewel and drives the
// lock/deny tint through the pane material's colour multiplier.

const CELL = 0.36;
const PANE = 0.29;

export type LetterParts = {
  glass: MeshBasicMaterial;
  frame: MeshBasicMaterial;
  halo: MeshBasicMaterial;
};

export function createStainedLetter(character: string, jewel: Color, accent: Color, seed: number) {
  const group = new Group();
  const rng = mulberry32(seed);
  const cells = glyphOnCells(character.length ? character : 'A');
  const panes: BufferGeometry[] = [];
  const leads: BufferGeometry[] = [];
  for (const cell of cells) {
    const x = (cell.x - 2) * CELL;
    const y = (3 - cell.y) * CELL;
    const pane = new PlaneGeometry(PANE, PANE).toNonIndexed();
    pane.translate(x, y, 0);
    const tint = rng() < 0.2 ? accent : jewel;
    const shade = 0.65 + rng() * 0.35;
    const colors: number[] = [];
    for (let i = 0; i < pane.getAttribute('position').count; i += 1) colors.push(tint.r * shade, tint.g * shade, tint.b * shade);
    pane.setAttribute('color', new Float32BufferAttribute(colors, 3));
    pane.deleteAttribute('uv');
    pane.deleteAttribute('normal');
    panes.push(pane);
    const lead = new PlaneGeometry(CELL + 0.07, CELL + 0.07).toNonIndexed();
    lead.translate(x, y, -0.03);
    lead.deleteAttribute('uv');
    lead.deleteAttribute('normal');
    leads.push(lead);
  }
  const glass = new MeshBasicMaterial({ vertexColors: true, color: new Color(1.5, 1.5, 1.5), side: DoubleSide });
  const lead = new MeshBasicMaterial({ color: new Color(0.01, 0.009, 0.008), side: DoubleSide });
  const frame = new MeshBasicMaterial({ color: new Color(0, 0, 0), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  const halo = new MeshBasicMaterial({ color: jewel.clone().multiplyScalar(0.3), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, vertexColors: true });

  group.add(new Mesh(mergeGeometries(leads)!, lead));
  group.add(new Mesh(mergeGeometries(panes)!, glass));

  // A gold lock ring — dark until the letter is locked.
  const ring = new Mesh(new RingGeometry(1.52, 1.64, 48), frame);
  ring.position.z = -0.05;
  group.add(ring);

  const glowGeometry = new CircleGeometry(2.1, 32);
  const positions = glowGeometry.getAttribute('position');
  const glow: number[] = [];
  for (let i = 0; i < positions.count; i += 1) {
    const r = Math.hypot(positions.getX(i), positions.getY(i)) / 2.1;
    const v = Math.pow(Math.max(0, 1 - r), 2);
    glow.push(v, v, v);
  }
  glowGeometry.setAttribute('color', new Float32BufferAttribute(glow, 3));
  const haloMesh = new Mesh(glowGeometry, halo);
  haloMesh.position.z = -0.1;
  group.add(haloMesh);

  const parts: LetterParts = { glass, frame, halo };
  group.userData.letterParts = parts;
  group.userData.isLetter = true;
  return group;
}
