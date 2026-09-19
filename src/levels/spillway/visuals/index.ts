import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, Scene, SphereGeometry, TorusGeometry } from 'three';
import type { Object3D } from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';

// Spine: keep palette and event choreography decisions here. Move mesh
// construction to leaf files as this level grows. These flat magenta primitive
// placeholders are intentionally unshippable.
const MAGENTA = 0xff00ff;
const material = () => new MeshBasicMaterial({ color: MAGENTA, side: DoubleSide });

export function createEnvironment(_scene: Scene) {
  // Empty by design: replace with authored environment geometry.
}

export function installVisualEventHandlers(_bus: EventBus, _scene: Scene) {
  // Empty by design: replace with authored event choreography.
}

export function createEnemyMesh(kind: string, letter?: string) {
  if (kind === 'letter' || letter) return createLetterMesh(letter ?? 'A');
  return new Mesh(new SphereGeometry(0.75, 8, 6), material());
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.scale.setScalar(locked ? 1.25 : 1);
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.scale.setScalar(0.75);
}

export function createProjectileMesh() {
  return new Mesh(new SphereGeometry(0.16, 8, 4), material());
}

export function createReticle() {
  return new Mesh(new RingGeometry(0.5, 0.56, 24), material());
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
    const block = new Mesh(geometry, material());
    block.position.set((cell.x - 2) * 0.3, (3 - cell.y) * 0.3, 0);
    group.add(block);
  }
  group.add(new Mesh(new TorusGeometry(0.95, 0.025, 6, 24), material()));
  return group;
}
