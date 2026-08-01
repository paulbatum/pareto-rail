import { BoxGeometry, Mesh } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { clamp, float, positionWorld } from 'three/tsl';
import { colorRamp, fractalNoise, seams, voronoiCells } from '../../../engine/tsl-surface';
import type { EnvironmentSink } from './kit';
import { PYRE_MOLTEN } from './world';

/**
 * The molten field at the bottom of the pit, seen mostly from above: a plan of
 * city blocks, not vertical ribs. The whole surface glows; what breaks it up is
 * dark structure — per-block heat, cool seams between blocks, fine grain — so it
 * reads architectural rather than like flame. A regular grid on an emissive
 * surface reads as an LED billboard; the voronoi randomness keeps courses offset.
 */
function moltenMaterial() {
  const { blockScale, heatScale, grainScale, gamma, strength } = PYRE_MOLTEN;
  const pos = positionWorld;

  const heat = fractalNoise(pos, { scale: heatScale, octaves: 5 }).remap(0, 1, 0.05, 1);
  const blocks = voronoiCells(pos, blockScale).remap(0, 1, 0.32, 1);
  const seamMask = seams(pos, blockScale, 1, 0.08).remap(0, 1, 0.3, 1);
  const grain = fractalNoise(pos, { scale: grainScale, octaves: 4 }).remap(0, 1, 0.35, 1);

  // Bend the field down: most of the floor sits deep red, yellow stays reserved
  // for the hottest slivers instead of the whole field clipping to one salmon.
  const field = heat.mul(blocks).mul(seamMask).mul(grain).pow(gamma);

  const ember = colorRamp(PYRE_MOLTEN.ramp);
  const material = new MeshBasicNodeMaterial();
  material.colorNode = ember(clamp(field.mul(1.4), float(0), float(1))).mul(field.mul(strength));
  return material;
}

/** One slab spanning the pit footprint; its top face is the molten field. */
export function addMoltenFloor(sink: EnvironmentSink) {
  const { x0, x1, nearZ, farZ } = PYRE_MOLTEN.footprint;
  const geometry = new BoxGeometry(x1 - x0, PYRE_MOLTEN.thickness, Math.abs(farZ - nearZ));
  const material = moltenMaterial();
  const mesh = new Mesh(geometry, material);
  mesh.position.set((x0 + x1) / 2, PYRE_MOLTEN.top - PYRE_MOLTEN.thickness / 2, (nearZ + farZ) / 2);
  sink.track(geometry, material);
  sink.add(mesh);
  return mesh;
}
