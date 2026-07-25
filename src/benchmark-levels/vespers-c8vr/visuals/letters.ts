import { BoxGeometry, Group, Mesh, MeshBasicMaterial, TorusGeometry } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';

// Gothic Stained-Glass Glyph Renderer
const STONE_FRAME_MAT = new MeshBasicMaterial({ color: 0x14161c });
const GLASS_COLORS = [0x0033ff, 0xff0d33, 0x00cc66, 0xffaa00]; // Cobalt, Crimson, Emerald, Amber

export function createLetterMesh(character: string): Group {
  const group = new Group();
  const cells = glyphOnCells(character);

  const blockGeo = new BoxGeometry(0.24, 0.24, 0.08);

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const glassColor = GLASS_COLORS[i % GLASS_COLORS.length];
    const glassMat = new MeshBasicMaterial({ color: glassColor, transparent: true, opacity: 0.9 });

    const block = new Mesh(blockGeo, glassMat);
    block.position.set((cell.x - 2) * 0.3, (3 - cell.y) * 0.3, 0);
    group.add(block);
  }

  // Gothic Traceried Arch Outer Ring
  const ringMat = STONE_FRAME_MAT;
  const ringGeo = new TorusGeometry(0.95, 0.04, 8, 24);
  const ring = new Mesh(ringGeo, ringMat);
  group.add(ring);

  return group;
}
