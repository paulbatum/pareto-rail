import { Color, DoubleSide, MeshBasicMaterial, Vector3 } from 'three';
import type { Side } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { normalWorld, uniform } from 'three/tsl';
import { hdr } from './palette';

// The engine renders unlit, so the white hardware would read as flat cutouts.
// A tiny hemisphere-plus-key shading term gives panels form; the runtime writes
// the lighting uniforms from the sky phase so the same paneling is flat and
// grey in the storm, sunlit above the deck, and hard-lit in vacuum.
export const sunDirectionUniform = uniform(new Vector3(-0.45, 0.78, 0.43).normalize());
// Light colours ride as vec3 uniforms so the TSL arithmetic stays typed.
export const sunLightUniform = uniform(new Vector3(0.5, 0.5, 0.52));
export const skyLightUniform = uniform(new Vector3(0.42, 0.44, 0.48));
export const groundLightUniform = uniform(new Vector3(0.2, 0.2, 0.22));

export function setColorUniform(target: { value: Vector3 }, color: Color) {
  target.value.set(color.r, color.g, color.b);
}

export type PanelMaterial = MeshBasicNodeMaterial & { userData: { base: { value: Vector3 } } };

export function createPanelMaterial(base: Color, options: { opacity?: number; side?: Side; transparent?: boolean } = {}) {
  const material = new MeshBasicNodeMaterial() as PanelMaterial;
  const baseUniform = uniform(new Vector3(base.r, base.g, base.b));
  const key = normalWorld.dot(sunDirectionUniform).max(0);
  const hemisphere = normalWorld.y.mul(0.5).add(0.5);
  const ambient = groundLightUniform.add(skyLightUniform.sub(groundLightUniform).mul(hemisphere));
  const light = ambient.add(sunLightUniform.mul(key));
  material.colorNode = baseUniform.mul(light);
  if (options.opacity !== undefined) {
    material.transparent = true;
    material.opacity = options.opacity;
  }
  if (options.transparent) material.transparent = true;
  if (options.side !== undefined) material.side = options.side;
  material.userData.base = baseUniform as unknown as { value: Vector3 };
  return material;
}

export function setPanelBase(material: PanelMaterial, color: Color) {
  material.userData.base.value.set(color.r, color.g, color.b);
}

/** Self-lit hardware: marker lights, hazard stripes, cores. HDR above 1 blooms. */
export function createLightMaterial(color: Color, intensity = 1, options: { side?: Side } = {}) {
  return new MeshBasicMaterial({ color: hdr(color, intensity), side: options.side ?? DoubleSide });
}
