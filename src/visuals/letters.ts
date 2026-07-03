import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from 'three';
import { CYAN, hdr } from './palette';

const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
};

const boxGeometry = new BoxGeometry(0.28, 0.28, 0.08);
const letterMaterial = new MeshBasicMaterial({
  color: hdr(CYAN, 1.5),
  transparent: true,
  opacity: 0.9,
  blending: AdditiveBlending,
  depthWrite: false,
});

export type LetterShardSpec = {
  direction: Vector3;
  color: Color;
  size: number;
};

export function createLetterMesh(char: string) {
  const glyph = GLYPHS[char.toUpperCase()] ?? GLYPHS.A;
  const group = new Group();
  const shardSpecs: LetterShardSpec[] = [];
  const color = hdr(CYAN, 1.2);
  const cell = 0.34;
  const width = 4 * cell;
  const height = 6 * cell;

  for (let y = 0; y < glyph.length; y += 1) {
    for (let x = 0; x < glyph[y].length; x += 1) {
      if (glyph[y][x] !== '1') continue;
      const offset = new Vector3(x * cell - width / 2, height / 2 - y * cell, 0);
      const box = new Mesh(boxGeometry, letterMaterial);
      box.position.copy(offset);
      group.add(box);
      const direction = offset.lengthSq() > 0.0001 ? offset.clone().normalize() : new Vector3(0, 0, 1);
      shardSpecs.push({ direction, color: color.clone(), size: 0.32 });
    }
  }

  group.userData.isLetter = true;
  group.userData.letter = char.toUpperCase();
  group.userData.shardSpecs = shardSpecs;
  group.userData.accent = CYAN.clone();
  return group;
}
