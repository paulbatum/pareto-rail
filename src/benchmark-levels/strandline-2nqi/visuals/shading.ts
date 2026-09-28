import type { Color } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { cameraPosition, float, normalWorld, positionWorld, vec3 } from 'three/tsl';

// A cheap form-shading model for hero geometry (the parent, big set pieces):
// one fixed light from above and a fresnel rim. Everything else in the level
// is unlit, so this gives the few things that need volume their volume.

const LIGHT = vec3(0.32, 0.86, 0.4).normalize();

export type ShadedOptions = {
  /** Fraction of the base colour kept in shadow. */
  ambient?: number;
  rim?: Color;
  rimPower?: number;
  rimStrength?: number;
  /** Flat emissive added on top (HDR colour). */
  emissive?: Color;
};

export function shadedMaterial(color: Color, options: ShadedOptions = {}) {
  const material = new MeshBasicNodeMaterial({ fog: true });
  const ambient = options.ambient ?? 0.32;
  const lambert = normalWorld.dot(LIGHT).max(0);
  const view = cameraPosition.sub(positionWorld).normalize();
  const fresnel = float(1).sub(normalWorld.dot(view).abs()).max(0).pow(options.rimPower ?? 2.2);
  let node = vec3(color.r, color.g, color.b).mul(lambert.mul(1 - ambient).add(ambient));
  if (options.rim) node = node.add(vec3(options.rim.r, options.rim.g, options.rim.b).mul(fresnel).mul(options.rimStrength ?? 1));
  if (options.emissive) node = node.add(vec3(options.emissive.r, options.emissive.g, options.emissive.b));
  material.colorNode = node;
  return material;
}
