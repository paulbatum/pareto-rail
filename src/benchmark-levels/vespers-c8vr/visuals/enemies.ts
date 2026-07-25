import {
  BoxGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import type { Object3D } from 'three';
import { createRoseBossMesh } from '../rose-boss';

const BLACK_STONE_MAT = new MeshBasicMaterial({ color: 0x08090c });
const JEWEL_COLORS = [0xff0d33, 0x0033ff, 0x00cc66, 0xffaa00]; // Crimson, Cobalt, Emerald, Amber

export function createEnemyMesh(kind: string, letter?: string): Object3D {
  if (kind === 'letter' || letter) {
    // Handled in letters.ts
    return new Group();
  }

  if (kind === 'rose-boss') {
    return createRoseBossMesh();
  }

  if (kind === 'panestealer') {
    // Seraph: 4 flat black wings + multi-pane core
    const group = new Group();
    group.name = 'enemy-panestealer';

    // Body & Wings
    const wingGeo = new ConeGeometry(0.8, 3.2, 4);
    for (let i = 0; i < 4; i++) {
      const wing = new Mesh(wingGeo, BLACK_STONE_MAT);
      wing.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
      wing.position.set(Math.cos(wing.rotation.z) * 0.8, Math.sin(wing.rotation.z) * 0.8, 0);
      group.add(wing);
    }

    // Stolen Stained Facets in chest
    const facetGeo = new OctahedronGeometry(0.65);
    const facetMat = new MeshBasicMaterial({ color: 0x0033ff, transparent: true, opacity: 0.9 });
    const facet = new Mesh(facetGeo, facetMat);
    facet.name = 'chest-pane';
    group.add(facet);

    return group;
  }

  if (kind === 'triforium') {
    // Archon Shard: Rotating gothic diamond frame carrying an emerald/amber core
    const group = new Group();
    group.name = 'enemy-triforium';

    const frameGeo = new TorusGeometry(1.2, 0.12, 4, 4);
    const frame = new Mesh(frameGeo, BLACK_STONE_MAT);
    frame.rotation.z = Math.PI / 4;
    group.add(frame);

    const gemGeo = new OctahedronGeometry(0.55);
    const gemMat = new MeshBasicMaterial({ color: 0x00cc66, transparent: true, opacity: 0.95 });
    const gem = new Mesh(gemGeo, gemMat);
    gem.name = 'chest-pane';
    group.add(gem);

    return group;
  }

  // Default 'gargoyle' / Vane: Flat black slate silhouette with a stolen ruby pane in chest
  const group = new Group();
  group.name = 'enemy-gargoyle';

  // Flat angular silhouette wing body
  const bodyGeo = new BoxGeometry(1.6, 0.4, 0.1);
  const body = new Mesh(bodyGeo, BLACK_STONE_MAT);
  group.add(body);

  const headGeo = new ConeGeometry(0.4, 0.8, 3);
  const head = new Mesh(headGeo, BLACK_STONE_MAT);
  head.rotation.x = Math.PI;
  head.position.set(0, -0.4, 0);
  group.add(head);

  // Stolen pane burning in chest
  const paneGeo = new SphereGeometry(0.35, 8, 8);
  const paneMat = new MeshBasicMaterial({ color: 0xff0d33, transparent: true, opacity: 0.9 });
  const pane = new Mesh(paneGeo, paneMat);
  pane.name = 'chest-pane';
  group.add(pane);

  return group;
}

export function setEnemyLocked(mesh: Object3D, locked: boolean) {
  mesh.scale.setScalar(locked ? 1.25 : 1.0);

  // Highlight chest pane on lock
  const chestPane = mesh.getObjectByName('chest-pane') as Mesh | undefined;
  if (chestPane && chestPane.material instanceof MeshBasicMaterial) {
    chestPane.material.opacity = locked ? 1.0 : 0.85;
  }
}

export function setEnemyDenied(mesh: Object3D) {
  mesh.scale.setScalar(0.75);
}
