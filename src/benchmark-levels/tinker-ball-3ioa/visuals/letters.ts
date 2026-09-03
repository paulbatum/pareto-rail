import { Color, CylinderGeometry, Group, Mesh } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, mix, uniform, vec3 } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Float32BufferAttribute } from 'three';
import { glyphOnCells } from '../../../engine/glyphs';
import { CANDY, DENY, DENY_DIM, MINT, hdr } from './palette';

// START!/REPLAY spelled in buttons: every on-cell of the 5×7 glyph is a small
// candy-colored button with four dark thread holes. Locking a letter tints its
// buttons mint and lights them; a rejected release stains them glue-dark.

const CELL = 0.34;
const LETTER_TINTS = [CANDY[0], CANDY[1], CANDY[2], CANDY[4], CANDY[6], CANDY[5], CANDY[3], CANDY[7]];
let letterCounter = 0;

type LetterUserData = {
  isLetter: true;
  letter: string;
  baseTint: Color;
  tint: { value: Color };
  emissive: { value: Color };
  locked?: boolean;
};

export function createLetterMesh(character: string) {
  const group = new Group();
  const cells = glyphOnCells(character);
  const width = 4 * CELL;
  const height = 6 * CELL;
  const geometries = cells.map((cell) => {
    const face = new CylinderGeometry(0.15, 0.15, 0.07, 16).toNonIndexed();
    face.rotateX(Math.PI / 2);
    face.translate(cell.x * CELL - width / 2, height / 2 - cell.y * CELL, 0);
    paint(face, 1, 1, 1, 1);
    const holes = [[-0.05, -0.05], [0.05, -0.05], [-0.05, 0.05], [0.05, 0.05]].map(([hx, hy]) => {
      const hole = new CylinderGeometry(0.02, 0.02, 0.09, 6).toNonIndexed();
      hole.rotateX(Math.PI / 2);
      hole.translate(cell.x * CELL - width / 2 + hx, height / 2 - cell.y * CELL + hy, 0);
      paint(hole, 0.12, 0.1, 0.1, 0);
      return hole;
    });
    return mergeGeometries([face, ...holes], false);
  });
  const geometry = mergeGeometries(geometries, false);
  for (const cell of geometries) cell.dispose();
  geometry.deleteAttribute('uv');

  const baseTint = LETTER_TINTS[letterCounter % LETTER_TINTS.length].clone();
  letterCounter += 1;
  const tint = uniform(baseTint.clone());
  const emissive = uniform(new Color(0, 0, 0));
  const material = new MeshStandardNodeMaterial({ roughness: 0.3, metalness: 0.04 });
  material.colorNode = attribute<'vec3'>('color', 'vec3').mul(mix(vec3(1, 1, 1), tint, attribute<'float'>('tintMask', 'float')));
  material.emissiveNode = emissive;
  const mesh = new Mesh(geometry, material);
  group.add(mesh);
  group.scale.setScalar(1.3);

  const data: LetterUserData = { isLetter: true, letter: character.toUpperCase(), baseTint, tint, emissive };
  group.userData = data;
  return group;
}

function paint(geometry: ReturnType<CylinderGeometry['toNonIndexed']>, r: number, g: number, b: number, mask: number) {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  const masks = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = r;
    colors[i * 3 + 1] = g;
    colors[i * 3 + 2] = b;
    masks[i] = mask;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setAttribute('tintMask', new Float32BufferAttribute(masks, 1));
  geometry.deleteAttribute('uv');
}

export function setLetterLocked(group: Group, locked: boolean) {
  const data = group.userData as LetterUserData;
  if (!data.isLetter) return;
  data.locked = locked;
  data.tint.value.copy(locked ? MINT : data.baseTint);
  data.emissive.value.copy(locked ? hdr(MINT, 0.9) : hdr(data.baseTint, 0.18));
}

export function setLetterDenied(group: Group, denied: boolean) {
  const data = group.userData as LetterUserData;
  if (!data.isLetter) return;
  if (denied) {
    data.tint.value.copy(DENY_DIM);
    data.emissive.value.copy(hdr(DENY, 0.8));
  } else {
    setLetterLocked(group, data.locked === true);
  }
}
