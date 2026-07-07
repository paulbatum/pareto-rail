import type { Object3D, Scene } from 'three';

export type PerfCounters = {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number | null;
  sceneObjects: number;
  visibleObjects: number;
};

type RendererInfoLike = {
  render?: {
    calls?: number;
    drawCalls?: number;
    triangles?: number;
  };
  memory?: {
    geometries?: number;
    textures?: number;
    programs?: number;
  };
  programs?: unknown;
};

export type RendererWithInfo = {
  info?: RendererInfoLike;
};

export function collectPerfCounters(renderer: RendererWithInfo, scene: Scene): PerfCounters {
  const info = renderer.info;
  const objectCounts = countSceneObjects(scene);
  return {
    calls: finiteNumber(info?.render?.drawCalls ?? info?.render?.calls),
    triangles: finiteNumber(info?.render?.triangles),
    geometries: finiteNumber(info?.memory?.geometries),
    textures: finiteNumber(info?.memory?.textures),
    programs: readProgramCount(info),
    sceneObjects: objectCounts.sceneObjects,
    visibleObjects: objectCounts.visibleObjects,
  };
}

function countSceneObjects(scene: Scene) {
  let sceneObjects = 0;
  let visibleObjects = 0;
  scene.traverse((object: Object3D) => {
    sceneObjects += 1;
    if (object.visible === true) visibleObjects += 1;
  });
  return { sceneObjects, visibleObjects };
}

function readProgramCount(info: RendererInfoLike | undefined): number | null {
  const memoryPrograms = info?.memory?.programs;
  if (Number.isFinite(memoryPrograms)) return memoryPrograms as number;
  const programs = info?.programs;
  if (Array.isArray(programs)) return programs.length;
  return null;
}

function finiteNumber(value: unknown) {
  return Number.isFinite(value) ? (value as number) : 0;
}
