import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { CELL_PITCH, CUBE_HALF, FACE_LIFT } from '../timing';
import type { SolveRig } from '../solve-state';
import { createAdditiveBasicMaterial } from '../../../engine/visual-kit';
import { mulberry32, faceColor, hdr, MACH_DARK, MACH_WHITE, MARK_HOT, SOLVE_COLORS } from './palette';

// The puzzle cube itself: six faces of nine scrambled candy tiles over
// white-and-grey machinery. Solving a cell snaps its tile to the face colour;
// clearing a face drops the whole panel as loose cubies and exposes the
// machinery (and the weakpoint) behind it.

const TILE_SIZE = 5.15;
const TILE_DEPTH = 0.55;

export const FACE_NORMALS = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];

type TileState = {
  mesh: Mesh;
  material: MeshBasicMaterial;
  homePosition: Vector3;
  homeRotation: EulerLike;
  baseColor: Color;
  solvedColor: Color;
  flashAt: number;
  punchAt: number;
  drop: null | { velocity: Vector3; spinAxis: Vector3; spinRate: number };
};

type EulerLike = { x: number; y: number; z: number };

let clockNow = 0;

export function createCubeShell() {
  const root = new Group();
  const rng = mulberry32(0xc0be);
  const tileGeometry = new BoxGeometry(TILE_SIZE, TILE_SIZE, TILE_DEPTH);

  // Dark interior so the gaps between tiles read as seams, plus the white
  // machinery that shows through once panels fall away.
  const interior = new Mesh(new BoxGeometry(CUBE_HALF * 2 - 0.9, CUBE_HALF * 2 - 0.9, CUBE_HALF * 2 - 0.9), new MeshBasicMaterial({ color: MACH_DARK }));
  root.add(interior);

  const machinery: Mesh[] = [interior];
  const strutMaterial = new MeshBasicMaterial({ color: MACH_WHITE.clone().multiplyScalar(0.55) });
  for (const axis of [0, 1, 2]) {
    const strut = new Mesh(new BoxGeometry(axis === 0 ? CUBE_HALF * 1.9 : 0.5, axis === 1 ? CUBE_HALF * 1.9 : 0.5, axis === 2 ? CUBE_HALF * 1.9 : 0.5), strutMaterial);
    root.add(strut);
    machinery.push(strut);
  }
  let machineryDropping = false;

  const heartGlow = new Mesh(
    new SphereGeometry(1.35, 16, 12),
    createAdditiveBasicMaterial({ color: hdr(MARK_HOT, 0.9), opacity: 0.45 }),
  );
  root.add(heartGlow);

  // Six faces of nine tiles.
  const faces: TileState[][] = [];
  for (let face = 0; face < 6; face += 1) {
    const group = new Group();
    group.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), FACE_NORMALS[face]);
    root.add(group);

    const solvedColor = faceColor(face);
    const tiles: TileState[] = [];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const scrambleIndex = Math.floor(rng() * SOLVE_COLORS.length);
        const material = new MeshBasicMaterial({ color: SOLVE_COLORS[scrambleIndex].clone().multiplyScalar(0.92) });
        const mesh = new Mesh(tileGeometry, material);
        const home = new Vector3((col - 1) * CELL_PITCH, (1 - row) * CELL_PITCH, CUBE_HALF - TILE_DEPTH / 2 + 0.05);
        mesh.position.copy(home);
        group.add(mesh);
        tiles.push({
          mesh,
          material,
          homePosition: home.clone(),
          homeRotation: { x: 0, y: 0, z: 0 },
          baseColor: SOLVE_COLORS[scrambleIndex].clone().multiplyScalar(0.92),
          solvedColor,
          flashAt: -Infinity,
          punchAt: -Infinity,
          drop: null,
        });
      }
    }
    faces.push(tiles);
  }

  const allTiles = faces.flat();

  function update(dt: number, elapsed: number, conqueredCount: number) {
    clockNow = elapsed;
    for (const tile of allTiles) {
      if (tile.drop) continue;
      // Solved snap: hot white flash settling into the face colour.
      const sinceFlash = elapsed - tile.flashAt;
      if (sinceFlash >= 0 && sinceFlash < 0.32) {
        const t = sinceFlash / 0.32;
        tile.material.color.copy(hdr(MARK_HOT, 1.9)).lerp(tile.solvedColor, t * t);
      }
      const sincePunch = elapsed - tile.punchAt;
      if (sincePunch >= 0 && sincePunch < 0.26) {
        const t = sincePunch / 0.26;
        tile.mesh.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.13);
      } else {
        tile.mesh.scale.setScalar(1);
      }
    }

    for (const tile of allTiles) {
      const drop = tile.drop;
      if (!drop) continue;
      tile.mesh.position.addScaledVector(drop.velocity, dt);
      drop.velocity.multiplyScalar(Math.max(0, 1 - 0.9 * dt));
      tile.mesh.rotateOnAxis(drop.spinAxis, drop.spinRate * dt);
      tile.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 0.85));
      if (tile.mesh.scale.x < 0.04) {
        tile.mesh.visible = false;
        tile.drop = null;
      }
    }

    // The machinery box falls away with the last shell — the core hangs naked.
    if (machineryDropping) {
      for (const part of machinery) {
        part.scale.multiplyScalar(Math.max(0, 1 - dt * 2.6));
        if (part.scale.x < 0.02) part.visible = false;
      }
    }

    // The machinery heart brightens as the shell opens up.
    const reveal = conqueredCount / 6;
    heartGlow.material.opacity = 0.18 + reveal * 0.5;
    (heartGlow.material.color as Color).copy(hdr(MARK_HOT, 0.7 + reveal * 1.8));
    heartGlow.scale.setScalar(0.8 + Math.sin(elapsed * 3.2) * 0.06 + reveal * 0.5);
  }

  return {
    root,
    update,
    setSolvedSnap(face: number, row: number, col: number) {
      const tile = faces[face]?.[row * 3 + col];
      if (!tile || tile.drop) return;
      tile.flashAt = clockNow;
      tile.punchAt = clockNow;
    },
    dropFace(face: number) {
      const tiles = faces[face];
      if (!tiles) return;
      for (const tile of tiles) {
        if (tile.drop) continue;
        tile.drop = {
          velocity: new Vector3((Math.random() - 0.5) * 11, (Math.random() - 0.5) * 11, 4.5 + Math.random() * 4),
          spinAxis: new Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
          spinRate: 3 + Math.random() * 5,
        };
        tile.material.color.copy(tile.solvedColor);
      }
    },
    dropEverything() {
      for (let face = 0; face < 6; face += 1) this.dropFace(face);
      machineryDropping = true;
    },
    reset() {
      machineryDropping = false;
      for (const part of machinery) {
        part.visible = true;
        part.scale.setScalar(1);
      }
      for (const tile of allTiles) {
        tile.drop = null;
        tile.flashAt = -Infinity;
        tile.punchAt = -Infinity;
        tile.mesh.visible = true;
        tile.mesh.scale.setScalar(1);
        tile.mesh.position.copy(tile.homePosition);
        tile.mesh.rotation.set(tile.homeRotation.x, tile.homeRotation.y, tile.homeRotation.z);
        tile.material.color.copy(tile.baseColor);
      }
    },
  };
}

export type CubeShell = ReturnType<typeof createCubeShell>;

/** World position of a face slot, using the shared rig basis. */
export function faceSlotWorldPos(row: number, col: number): Vector3 {
  const rig = getSharedRig()?.state;
  if (!rig) return new Vector3();
  return rig.pos.clone()
    .addScaledVector(rig.right, (col - 1) * CELL_PITCH)
    .addScaledVector(rig.up, (1 - row) * CELL_PITCH)
    .addScaledVector(rig.normal, CUBE_HALF + FACE_LIFT);
}

export function cubeCenterWorldPos(lift = 0): Vector3 {
  const rig = getSharedRig()?.state;
  if (!rig) return new Vector3();
  return rig.pos.clone().addScaledVector(rig.normal, lift);
}

// Avoids a circular import: gameplay owns the rig instance, visuals read it
// through this lazy accessor wired by visuals/index.ts.
let sharedRig: SolveRig | null = null;
export function wireSharedRig(rig: SolveRig) {
  sharedRig = rig;
}
function getSharedRig() {
  return sharedRig;
}
