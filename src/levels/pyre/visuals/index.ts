import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, Scene, SphereGeometry, TorusGeometry } from 'three';
import type { Object3D } from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';
import {
  PYRE_BACKDROP,
  PYRE_BEAMS,
  PYRE_CENTRE_MONOLITH,
  PYRE_COLORS,
  PYRE_EDGE,
  PYRE_FRAME_SLAB,
  PYRE_GATEWAY,
  PYRE_LEFT_MONOLITH,
  PYRE_MEGASTRUCTURE,
  PYRE_PYRAMIDS,
  PYRE_RIGHT_MONOLITHS,
  PYRE_RIGHT_WALL,
  PYRE_SLOTS,
  PYRE_TRENCH_STRUCTURES,
} from './composition';
import {
  addBeams,
  addBlockField,
  addDunes,
  addPyramid,
  addRockField,
  addSlabs,
  addTerrain,
  EnvironmentSink,
  type EnvironmentBuild,
} from './environment';

const FIELD_SEED = 20260730;

/**
 * The single switch for the outline overlay. Pyre is unlit, so the lines are
 * what make two faces of one mass read apart; a later lighting pass will do that
 * job instead and should set this to null.
 */
const PYRE_EDGE_STYLE: ((faceColor: number) => ReturnType<typeof PYRE_EDGE.style>) | null = PYRE_EDGE.style;

/**
 * Environment build order runs back to front, which is also the order the
 * picture reads: sky panels, overhead planes, distant masses, the block field,
 * then the ground the camera stands on.
 */
export function createEnvironment(scene: Scene): EnvironmentBuild {
  const sink = new EnvironmentSink(PYRE_EDGE_STYLE);
  addSlabs(sink, PYRE_BACKDROP, { outline: false });
  addSlabs(sink, PYRE_MEGASTRUCTURE, { outline: false });
  for (const pyramid of PYRE_PYRAMIDS) addPyramid(sink, pyramid);
  addSlabs(sink, PYRE_RIGHT_WALL);
  addBeams(sink, PYRE_BEAMS);
  addTerrain(sink);
  addBlockField(sink, FIELD_SEED);
  addSlabs(sink, PYRE_TRENCH_STRUCTURES);
  addSlabs(sink, PYRE_GATEWAY);
  addSlabs(sink, PYRE_SLOTS);
  addSlabs(sink, PYRE_CENTRE_MONOLITH);
  addSlabs(sink, PYRE_LEFT_MONOLITH);
  addSlabs(sink, PYRE_RIGHT_MONOLITHS);
  addSlabs(sink, PYRE_FRAME_SLAB);
  addDunes(sink, FIELD_SEED + 2);
  addRockField(sink, FIELD_SEED + 1);

  const build = sink.build();
  scene.add(build.group);
  return build;
}

export function installVisualEventHandlers(_bus: EventBus, _scene: Scene) {
  // Empty by design: this level is being blocked out for its composition.
}

// Placeholder target and reticle language, kept legible against the vista.
const emberMaterial = () => new MeshBasicMaterial({ color: PYRE_COLORS.slot, side: DoubleSide });
const paleMaterial = () => new MeshBasicMaterial({ color: PYRE_COLORS.paleStone, side: DoubleSide });

export function createEnemyMesh(kind: string, letter?: string) {
  if (kind === 'letter' || letter) return createLetterMesh(letter ?? 'A');
  return new Mesh(new SphereGeometry(0.75, 8, 6), emberMaterial());
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.scale.setScalar(locked ? 1.25 : 1);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.scale.setScalar(0.75);
}

export function createProjectileMesh() {
  return new Mesh(new SphereGeometry(0.16, 8, 4), emberMaterial());
}

export function createReticle() {
  return new Mesh(new RingGeometry(0.5, 0.56, 24), paleMaterial());
}

export function setReticleActive(reticle: Object3D, active: boolean, lockCount: number) {
  reticle.visible = true;
  reticle.scale.setScalar(1 + lockCount * 0.05 + (active ? 0.1 : 0));
}

function createLetterMesh(character: string) {
  const group = new Group();
  const cells = glyphOnCells(character);
  const geometry = new BoxGeometry(0.24, 0.24, 0.08);
  for (const cell of cells) {
    const block = new Mesh(geometry, paleMaterial());
    block.position.set((cell.x - 2) * 0.3, (3 - cell.y) * 0.3, 0);
    group.add(block);
  }
  group.add(new Mesh(new TorusGeometry(0.95, 0.025, 6, 24), emberMaterial()));
  return group;
}
