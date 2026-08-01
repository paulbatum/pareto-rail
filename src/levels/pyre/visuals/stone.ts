import { attribute, clamp, float, mix, normalWorld, positionWorld, vec3 } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { colorRamp, fractalNoise } from '../../../engine/tsl-surface';

/**
 * Weathered icy stone for the crag towers: world-space noise so no two towers
 * repeat, horizontal strata as on sedimentary rock, long vertical run-off
 * streaks, and a face key. The face key is the Blender scene's hard-won lesson:
 * at depth, haze lifts a shadowed face to the level of a lit one — light cannot
 * widen that gap, but an albedo multiplier keyed on the normal survives where a
 * lamp does not. Faces turned up-and-left run bright, right-and-camera run dark.
 *
 * Multiplies the baked grayscale facet level from `shadeGeometry`, so the
 * blockout's solid-mass read survives under the surface.
 */
export function stoneMaterial() {
  const pos = positionWorld;

  const broad = fractalNoise(pos, { scale: 0.011, octaves: 6 });
  const fine = fractalNoise(pos, { scale: 0.077, octaves: 5 });
  let fac = mix(broad, fine, 0.4);
  // strata: variation along height only
  fac = mix(fac, fractalNoise(pos.mul(vec3(0.03, 1, 0.03)), { scale: 0.066, octaves: 4 }), 0.3);
  // streaks: stretched hard along the vertical
  fac = mix(fac, fractalNoise(pos.mul(vec3(1, 0.06, 1)), { scale: 0.25, octaves: 5 }), 0.32);

  const stone = colorRamp([
    [0.0, [0.045, 0.055, 0.072]],
    [0.3, [0.125, 0.145, 0.175]],
    [0.5, [0.26, 0.29, 0.33]],
    [0.72, [0.42, 0.455, 0.50]],
    [1.0, [0.185, 0.21, 0.25]],
  ])(fac);

  // Bright toward up-left-away, dark toward right-and-camera: the z component
  // is negative because "toward the camera" is +z on this stage.
  const facing = clamp(
    normalWorld.dot(vec3(-0.32, 0.66, -0.55)).remap(-0.7, 0.7, 0.34, 1.3),
    float(0.34),
    float(1.3),
  );

  const material = new MeshBasicNodeMaterial();
  material.colorNode = stone.mul(facing).mul(attribute('color', 'vec3'));
  return material;
}
