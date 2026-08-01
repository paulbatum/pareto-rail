import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import { additiveMaterialParameters } from '../../../engine/visual-kit';
import { GOLD, hdr, WHITE_HOT } from './palette';

// START/REPLAY words in the level's own language: leaded glass — each glyph
// is a row of bright glass panes held in a dark lead frame, like the lancet
// windows that line the nave. Locking a letter charges it toward the deep
// cobalt the Devourer drinks; denial flashes it red-grey.

const CELL = 0.34;
const GLASS = hdr(WHITE_HOT, 1.05);
const GLASS_LOCKED = new Color(0.2, 0.5, 1.45);
const GLASS_DENIED = new Color(0.8, 0.12, 0.1);

export type LetterMaterials = {
  fill: MeshBasicMaterial;
  glow: MeshBasicMaterial;
  lead: LineBasicMaterial;
};

export function createLetterMesh(char: string): Group {
  const cells = glyphOnCells(char);
  const group = new Group();

  // Glass panes: one bright quad per cell, slightly inset so the dark gaps
  // read as lead cames. The additive glow sits just in front; the lead cames
  // sit nearest the camera so they draw over the glass.
  const fillGeometry = new PlaneGeometry(CELL * 0.78, CELL * 0.78);
  const glowGeometry = new PlaneGeometry(CELL * 0.9, CELL * 0.9);

  for (const cell of cells) {
    const x = (cell.x - 2) * CELL;
    const y = (3 - cell.y) * CELL;
    const fill = new Mesh(fillGeometry, new MeshBasicMaterial({ color: GLASS.clone() }));
    fill.position.set(x, y, 0);
    group.add(fill);
    const glow = new Mesh(
      glowGeometry,
      new MeshBasicMaterial(additiveMaterialParameters({ color: hdr(GOLD, 0.45) })),
    );
    glow.position.set(x, y, -0.012);
    group.add(glow);
  }

  const lead = buildLeadFrame();
  group.add(lead);

  const firstFill = cells.length > 0 ? group.children[0] as Mesh : null;
  const fillMaterial = (firstFill?.material as MeshBasicMaterial | undefined) ?? new MeshBasicMaterial({ color: GLASS.clone() });
  const glowMesh = group.children[1] as Mesh | undefined;
  const glowMaterial = (glowMesh?.material as MeshBasicMaterial | undefined) ?? new MeshBasicMaterial(additiveMaterialParameters({ color: hdr(GOLD, 0.45) }));
  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.letterMaterials = {
    fill: fillMaterial,
    glow: glowMaterial,
    lead: lead.material as LineBasicMaterial,
  } satisfies LetterMaterials;
  return group;
}

function buildLeadFrame(): LineSegments {
  const halfW = 2 * CELL + CELL * 0.4;
  const halfH = 3 * CELL + CELL * 0.4;
  const step = CELL;
  const positions: number[] = [];
  for (let x = -halfW + step; x < halfW; x += step) {
    positions.push(x, -halfH, -0.03, x, halfH, -0.03);
  }
  for (let y = -halfH + step; y < halfH; y += step) {
    positions.push(-halfW, y, -0.03, halfW, y, -0.03);
  }
  positions.push(-halfW, -halfH, -0.03, halfW, -halfH, -0.03);
  positions.push(halfW, -halfH, -0.03, halfW, halfH, -0.03);
  positions.push(halfW, halfH, -0.03, -halfW, halfH, -0.03);
  positions.push(-halfW, halfH, -0.03, -halfW, -halfH, -0.03);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({ color: new Color(0.015, 0.016, 0.03) });
  return new LineSegments(geometry, material);
}

export function setLetterLocked(group: Group, locked: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  materials.fill.color.copy(locked ? GLASS_LOCKED : GLASS);
  materials.glow.color.copy(locked ? hdr(GOLD, 0.85) : hdr(GOLD, 0.45));
  materials.lead.color.copy(locked ? hdr(GOLD, 0.4) : new Color(0.015, 0.016, 0.03));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const materials = group.userData.letterMaterials as LetterMaterials | undefined;
  if (!materials) return;
  if (denied) {
    materials.fill.color.copy(GLASS_DENIED);
    materials.glow.color.copy(hdr(GOLD, 0.75));
  } else {
    materials.fill.color.copy(GLASS);
    materials.glow.color.copy(hdr(GOLD, 0.45));
  }
}
