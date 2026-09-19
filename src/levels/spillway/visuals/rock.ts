import type { Color } from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import { attribute, cameraViewMatrix, float, mix, normalWorld, positionWorld, smoothstep, vec3, vec4 } from 'three/tsl';
import { fractal, noise1, noise4 } from './noise';

type Vec3Node = Node<'vec3'>;

const rgb = (color: Color) => vec3(color.r, color.g, color.b);

export type GraniteColors = {
  warm: Color;
  cool: Color;
  pale: Color;
  dark: Color;
  lichen: Color;
  moss: Color;
  soil: Color;
};

export type GroundColors = {
  meadow: Color;
  forestFloor: Color;
  canopy: Color;
};

export type GraniteOptions = {
  colors: GraniteColors;
  /** Gentle slopes become grass, forest floor and distant canopy instead of rock. */
  ground?: GroundColors;
  /** Height below which the valley floor turns to meadow. */
  meadowBelow?: number;
  /** Cut joint columns into the rock: everywhere, nowhere, or only on steep faces (the terrain's cliffs). */
  joints?: boolean | 'steep';
  /** Bleached band left on the rock above the drawn-down reservoir, where `waterY` is `level`. */
  bathtub?: Bathtub;
};

export type Bathtub = { level: number; height: number; color: Color };

/** Blend factor of the reservoir's bathtub ring at world height `y` for a surface whose local water level is `waterY`. */
export function bathtubRing(bathtub: Bathtub, y: Node<'float'>, waterY: Node<'float'>) {
  const onLake = smoothstep(1.5, 0.5, waterY.sub(bathtub.level).abs());
  const band = smoothstep(bathtub.level - 0.2, bathtub.level + 0.6, y).mul(smoothstep(bathtub.level + bathtub.height + 0.4, bathtub.level + bathtub.height - 0.6, y));
  // A ragged top edge, and a darker scum line along it.
  const edge = noise1(vec3(positionWorld.x.mul(0.3), 0, positionWorld.z.mul(0.3))).mul(0.8);
  const top = smoothstep(1.2, 0, y.sub(bathtub.level + bathtub.height).add(edge).abs());
  return { ring: band.mul(onLake), scum: top.mul(onLake).mul(0.5) };
}

/**
 * Lit granite for the gorge walls, boulders and the terrain's rock. Geometry
 * supplies two float attributes: `waterY`, the local water level that darkens
 * and glosses the rock near the waterline, and `sky`, the share of sky the
 * surface sees, which occludes the image-based light at the foot of the gorge.
 *
 * The rock is warm grey with tilted banding, pale feldspar mottling, lichen on
 * ledges and tall joint lines from stretched noise. All noise is fetched from
 * the baked volume in noise.ts. Albedo stays below
 * about 0.4 so sunlit rock never outshines painted machinery.
 */
export function createGraniteMaterial(options: GraniteOptions) {
  const { colors } = options;
  const material = new MeshStandardNodeMaterial({ metalness: 0 });
  const p = positionWorld;
  const up = normalWorld.y;

  const banding = fractal(vec3(p.x.mul(0.18), p.y.add(p.x.mul(0.14)).add(p.z.mul(0.06)), p.z.mul(0.18)).mul(0.07), 2);
  const mottle = fractal(p.mul(0.38), 2);
  const speckle = noise1(p.mul(2.9)).mul(0.5).add(0.5);
  // Joints: the zero crossings of two noises stretched upright read as tall fracture lines.
  // Cheaper than a voronoi pass, which the shader compiler unrolls over 27 cells.
  const jointLines = () => {
    // Long, nearly vertical joints: the noise barely changes with height, so its zero
    // crossings run up the face instead of closing into cells.
    const columns = noise4(vec3(p.x.mul(0.045), p.y.mul(0.006), p.z.mul(0.045)));
    const main = smoothstep(0, 0.035, columns.x.abs());
    // Sparse horizontal sheeting joints, only where a second channel allows them.
    const sheeting = smoothstep(0, 0.02, noise1(vec3(p.x.mul(0.01), p.y.mul(0.09), p.z.mul(0.01))).abs()).max(smoothstep(0.2, 0.5, columns.y));
    return main.mul(sheeting);
  };

  const crack = options.joints === false ? float(1) : options.joints === 'steep' ? mix(jointLines(), float(1), smoothstep(0.55, 0.8, up)) : jointLines();
  const streaks = smoothstep(0.55, 0.8, fractal(vec3(p.x.mul(0.35), p.y.mul(0.018), p.z.mul(0.35)), 2));

  let rock: Vec3Node = mix(rgb(colors.cool), rgb(colors.warm), smoothstep(0.3, 0.7, banding));
  rock = mix(rock, rgb(colors.pale), smoothstep(0.55, 0.85, mottle).mul(0.55));
  rock = rock.mul(speckle.mul(0.24).add(0.88));
  rock = mix(rock, rgb(colors.dark), streaks.mul(0.45));
  const ledge = smoothstep(0.55, 0.85, up);
  const growth = smoothstep(0.35, 0.65, noise4(p.mul(0.11)).z.mul(0.5).add(0.5));
  rock = mix(rock, mix(rgb(colors.lichen), rgb(colors.moss), growth), ledge.mul(0.8));
  rock = mix(rgb(colors.dark), rock, crack.mul(0.75).add(0.25));

  let albedo: Vec3Node = rock;
  let roughness: Node<'float'> = float(0.9);
  if (options.ground) {
    const g = options.ground;
    const gentle = smoothstep(0.66, 0.84, up);
    const forest = smoothstep(0.42, 0.56, fractal(p.mul(0.0045), 2));
    const meadowZone = options.meadowBelow === undefined ? float(0) : smoothstep(options.meadowBelow + 30, options.meadowBelow, p.y);
    let cover: Vec3Node = mix(rgb(g.forestFloor), rgb(g.canopy), forest.mul(meadowZone.oneMinus()));
    cover = mix(cover, rgb(g.meadow), meadowZone.mul(forest.oneMinus().mul(0.7).add(0.3)));
    cover = cover.mul(speckle.mul(0.3).add(0.82));
    albedo = mix(rock, cover, gentle);
    roughness = mix(float(0.9), float(0.95), gentle);
  }

  const waterY = attribute<'float'>('waterY', 'float');
  const wet = smoothstep(4.5, 0.2, p.y.sub(waterY));
  if (options.bathtub) {
    const { ring, scum } = bathtubRing(options.bathtub, p.y, waterY);
    albedo = mix(albedo, rgb(options.bathtub.color).mul(speckle.mul(0.2).add(0.9)), ring.mul(0.85));
    albedo = mix(albedo, rgb(colors.dark), scum);
  }
  material.colorNode = albedo.mul(mix(float(1), float(0.42), wet));
  material.roughnessNode = mix(roughness, float(0.32), wet);
  material.aoNode = attribute<'float'>('sky', 'float').mul(crack.mul(0.35).add(0.65));

  // Three scales of relief: the mid scale breaks up the mesh's facets close to the rail.
  const bump = noise4(p.mul(0.3)).xyz.mul(0.3).add(noise4(p.mul(0.9)).xyz.mul(0.24)).add(noise4(p.mul(2.6)).xyz.mul(0.1));
  const worldNormal = normalWorld.add(bump).normalize();
  material.normalNode = cameraViewMatrix.mul(vec4(worldNormal, 0)).xyz.normalize();
  return material;
}
