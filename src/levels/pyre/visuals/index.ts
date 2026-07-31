import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, Scene, SphereGeometry, TorusGeometry } from 'three';
import type { Object3D } from 'three';
import type { EventBus } from '../../../events';
import { glyphOnCells } from '../../../engine/glyphs';
import { EnvironmentSink, type EnvironmentBuild } from './kit';
import { addGround } from './terrain';
import { PYRE_COLORS } from './world';

/**
 * Outline styling. The masses are flat-shaded placeholders, so an edge is what
 * separates one mass from the next where their values are close; these lines are
 * part of the level's look rather than a review aid. The default is a contrast
 * step from the face — darker on light masses, lighter on dark.
 */
export const PYRE_EDGE = {
  threshold: 16,
  style(faceColor: number) {
    const r = (faceColor >> 16) & 0xff;
    const g = (faceColor >> 8) & 0xff;
    const b = faceColor & 0xff;
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const step = (channel: number) =>
      Math.round(luminance > 0.46 ? channel * 0.66 : channel + (255 - channel) * 0.34);
    return {
      color: (step(r) << 16) | (step(g) << 8) | step(b),
      threshold: PYRE_EDGE.threshold,
    };
  },
};

/**
 * The single switch for the outline overlay. Pyre is unlit, so the lines are
 * what make two masses read apart; a later lighting pass will do that job
 * instead and should set this to null.
 */
const PYRE_EDGE_STYLE: ((faceColor: number) => ReturnType<typeof PYRE_EDGE.style>) | null = PYRE_EDGE.style;

/** The ground and the cut in it. Nothing else is built yet. */
export function createEnvironment(scene: Scene): EnvironmentBuild {
  const sink = new EnvironmentSink(PYRE_EDGE_STYLE);
  addGround(sink);

  const build = sink.build();
  scene.add(build.group);
  return build;
}

export function installVisualEventHandlers(_bus: EventBus, _scene: Scene) {
  // Empty by design: this level is being blocked out for its geometry.
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
