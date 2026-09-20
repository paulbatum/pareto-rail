import type { Material, Mesh, Object3D, Scene } from 'three';
import type { SweepConfig } from '../ui/perf-overlay';

/* Configurations a perf sweep cycles through, so one capture prices each part of the
   frame instead of needing a run per URL knob. Every config restores the world first
   and then removes exactly one thing, so its cost is the difference from the baseline.

   Two axes, because a slow frame is one or the other. Named groups are how the level's
   author organised the world, and are the granularity a geometry or culling fix is made
   at. Named materials are the shaders, and are the granularity a fragment-cost fix is
   made at. Both come from the scene, so this works for any level without a list. */

/** A named group holding this much of the scene is a container; the sweep prices its parts instead. */
const CONTAINER_SHARE = 0.6;
/** Below this share of the scene, removing something cannot explain a slow frame. */
const MIN_SHARE = 0.02;
/** How deep a named group may sit and still count as structure rather than detail. */
const GROUP_DEPTH = 3;
/** Entries priced per axis, heaviest first. Beyond this the sweep gets too long to sit through. */
const MAX_PER_AXIS = 4;

export type SweepWorld = {
  scene: Scene;
  /** Whether the post chain runs; false renders the scene straight to the canvas. */
  setPostEnabled(enabled: boolean): void;
  hasPost: boolean;
};

type ShadowLight = { shadow: { autoUpdate: boolean; needsUpdate: boolean } };
type Part = {
  name: string;
  /** Set invisible to remove this part. */
  objects: Object3D[];
  triangles: number;
  /** The meshes this part covers, so two axes that name the same set are not both priced. */
  coverage: string;
};

export function buildSweepConfigs(world: SweepWorld): SweepConfig[] {
  const total = countTriangles(world.scene);
  const groups = heaviestGroups(world.scene, total);
  const covered = new Set(groups.map((group) => group.coverage));
  /* A group and a material often name the same meshes — a terrain group drawn entirely
     with the ground material. Pricing both twice costs sweep time and says nothing new. */
  const materials = heaviestMaterials(world.scene, total).filter((part) => !covered.has(part.coverage));
  const shadowLights = findShadowLights(world.scene);
  const everything = [...groups, ...materials].flatMap((part) => part.objects);

  const restore = () => {
    world.setPostEnabled(world.hasPost);
    for (const object of everything) object.visible = true;
    for (const light of shadowLights) light.shadow.autoUpdate = true;
  };
  const config = (name: string, apply: () => void): SweepConfig => ({
    name,
    apply() {
      restore();
      apply();
    },
  });
  const hide = (part: Part, label: string) => config(`hide ${label} ${part.name}`, () => {
    for (const object of part.objects) object.visible = false;
  });

  const configs: SweepConfig[] = [config('baseline', () => {})];
  if (world.hasPost) configs.push(config('post off', () => world.setPostEnabled(false)));
  if (shadowLights.length > 0) {
    /* Freezing the shadow map leaves every material still sampling it, so this prices
       the shadow render pass — a second pass over the scene — and not the lookup. */
    configs.push(config('shadow pass frozen', () => {
      for (const light of shadowLights) {
        light.shadow.autoUpdate = false;
        light.shadow.needsUpdate = false;
      }
    }));
  }
  for (const group of groups) configs.push(hide(group, 'group'));
  for (const material of materials) configs.push(hide(material, 'material'));
  return configs;
}

/** Named groups, skipping containers that hold most of the scene and parts too small to matter. */
function heaviestGroups(scene: Scene, total: number) {
  const parts: Part[] = [];
  const walk = (object: Object3D, depth: number) => {
    if (depth > GROUP_DEPTH) return;
    if (depth > 0 && object.name) {
      const triangles = countTriangles(object);
      if (triangles > 0 && triangles <= total * CONTAINER_SHARE) {
        if (triangles >= total * MIN_SHARE) {
          parts.push({ name: object.name, objects: [object], triangles, coverage: coverageOf(meshesIn(object)) });
        }
        /* Priced as a whole; its named children are the detail inside it, not separate parts. */
        return;
      }
    }
    for (const child of object.children) walk(child, depth + 1);
  };
  walk(scene, 0);
  return rank(parts, total);
}

/** Meshes grouped by material name, which is the axis a fragment-cost fix is made on. */
function heaviestMaterials(scene: Scene, total: number) {
  const byName = new Map<string, Part>();
  scene.traverse((object) => {
    const triangles = meshTriangles(object);
    if (triangles === 0) return;
    for (const name of materialNames(object as Mesh)) {
      const part = byName.get(name) ?? { name, objects: [], triangles: 0, coverage: '' };
      part.objects.push(object);
      part.triangles += triangles;
      byName.set(name, part);
    }
  });
  for (const part of byName.values()) part.coverage = coverageOf(part.objects);
  return rank([...byName.values()], total);
}

/** Identifies the set of meshes a part covers, whichever axis named it. */
function coverageOf(meshes: Object3D[]) {
  return meshes.map((mesh) => mesh.uuid).sort().join(',');
}

function meshesIn(root: Object3D) {
  const meshes: Object3D[] = [];
  root.traverse((object) => { if (meshTriangles(object) > 0) meshes.push(object); });
  return meshes;
}

function rank(parts: Part[], total: number) {
  return parts
    .filter((part) => part.triangles >= total * MIN_SHARE)
    .sort((a, b) => b.triangles - a.triangles)
    .slice(0, MAX_PER_AXIS);
}

function materialNames(mesh: Mesh) {
  const material = mesh.material as Material | Material[] | undefined;
  if (!material) return [];
  const list = Array.isArray(material) ? material : [material];
  return [...new Set(list.map((entry) => entry.name).filter(Boolean))];
}

function countTriangles(root: Object3D) {
  let total = 0;
  root.traverse((object) => { total += meshTriangles(object); });
  return total;
}

function meshTriangles(object: Object3D) {
  const mesh = object as Object3D & {
    isMesh?: boolean;
    isInstancedMesh?: boolean;
    count?: number;
    geometry?: { index?: { count: number } | null; getAttribute(name: string): { count: number } | undefined };
  };
  if (!mesh.isMesh || !mesh.geometry) return 0;
  const vertices = mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position')?.count ?? 0;
  return (vertices / 3) * (mesh.isInstancedMesh ? mesh.count ?? 1 : 1);
}

function findShadowLights(scene: Scene) {
  const lights: ShadowLight[] = [];
  scene.traverse((object) => {
    const light = object as Object3D & { isLight?: boolean; castShadow?: boolean; shadow?: ShadowLight['shadow'] };
    if (light.isLight && light.castShadow && light.shadow) lights.push(light as unknown as ShadowLight);
  });
  return lights;
}
