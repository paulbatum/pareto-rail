import { AdditiveBlending, BackSide, DoubleSide, Vector3 } from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  attribute,
  mx_cell_noise_float,
  mx_fractal_noise_float,
  normalize,
  step,
  cameraPosition,
  exp,
  float,
  mix,
  mx_noise_float,
  mx_worley_noise_vec2,
  normalWorld,
  positionLocal,
  positionWorld,
  smoothstep,
  time,
  uniform,
  vec3,
} from 'three/tsl';
import type { Color } from 'three';
import type { Node } from 'three/webgpu';

// Leaf: shader construction. Every knob that the spine animates is a module
// uniform written by visuals/index.ts; colors arrive as parameters.

/** Direction from the battle toward the nebula's bright core. */
export const NEBULA_DIRECTION = new Vector3(0.28, 0.16, -1).normalize();
export const nebulaDirection = uniform(NEBULA_DIRECTION.clone());
/** Enemy line burning after the flagship falls: 0 → 1. */
export const enemyBurnUniform = uniform(0);
/** A frame-wide light pulse from big explosions and broadside salvos. */
export const battleLightUniform = uniform(0);
/** Shield state: visibility 0..1 and collapse progress 0..1. */
export const shieldUniform = uniform(1);
export const shieldCollapseUniform = uniform(0);
export const shieldHitUniform = uniform(0);
/** 1 while the camera is inside the shield: from inside it is a faint web, not a wall of color. */
export const shieldInsideUniform = uniform(0);

const FOG_DENSITY = 0.00017;

export type HullPalette = {
  rimLow: Color;
  rimHigh: Color;
  sheen: Color;
  ambient: number;
  topLight: number;
  rim: number;
  veinColor: Color;
  hazeNear: Color;
  hazeFar: Color;
};

function v3(color: Color) {
  return vec3(color.r, color.g, color.b);
}

/**
 * Hull shading: flat faces lit by the nebula behind the battle. Faces that
 * turn toward the nebula catch its glow, grazing faces burn a magenta→gold
 * rim, and distance pulls everything into the nebula haze so kilometer-long
 * hulls read at their true scale. Vertex attributes carry albedo, window and
 * engine emissive, and the molten-vein mask.
 */
export function createHullMaterial(palette: HullPalette, options: { burn?: boolean } = {}) {
  const material = new MeshBasicNodeMaterial();
  const albedo = attribute<'vec3'>('color', 'vec3');
  const emissive = attribute<'vec3'>('emissive', 'vec3');
  const vein = attribute<'float'>('vein', 'float');

  const toCamera = cameraPosition.sub(positionWorld);
  const distance = toCamera.length();
  const viewDir = toCamera.div(distance);
  const n = normalWorld;
  const facing = n.dot(viewDir).abs();
  // Rim light belongs to silhouettes: broad faces seen edge-on up close (a
  // flight deck, a trench wall) must not light up, so rim fades in with
  // distance and away from upward-facing plating.
  const rimReach = smoothstep(float(25), float(260), distance).mul(0.85).add(0.15);
  const rimAmount = float(1).sub(facing).pow(4.5).mul(rimReach).mul(float(1).sub(normalWorld.y.max(0).mul(0.8)));
  const toNebula = n.dot(nebulaDirection).max(0);
  const up = n.y.max(0);

  const rimColor = mix(v3(palette.rimLow), v3(palette.rimHigh), smoothstep(-0.35, 0.75, n.y.add(n.dot(nebulaDirection).mul(0.45))));
  const light = float(palette.ambient)
    .add(up.mul(palette.topLight))
    .add(battleLightUniform.mul(0.35));
  let color = albedo.mul(light).add(albedo.mul(v3(palette.sheen)).mul(toNebula.pow(1.4)).mul(1.15));
  // Backlight: only faces turned toward the nebula catch a rim.
  color = color.add(rimColor.mul(rimAmount).mul(palette.rim).mul(toNebula.pow(0.6).mul(1.4).add(0.04)));

  // Molten veins: a ridged noise line pattern in ship space.
  const veinField = mx_noise_float(positionLocal.mul(vec3(0.05, 0.11, 0.012))).abs();
  const veinLine = float(1).sub(smoothstep(0.0, 0.014, veinField)).mul(vein);
  const burn = options.burn ? enemyBurnUniform : float(0);
  const flicker = mx_noise_float(positionLocal.mul(0.02).add(vec3(0, time.mul(0.9), 0))).mul(0.35).add(0.85);
  color = color.add(v3(palette.veinColor).mul(veinLine).mul(flicker).mul(float(0.9).add(burn.mul(2.2))));
  if (options.burn) {
    const scorch = smoothstep(0.15, 0.7, mx_noise_float(positionLocal.mul(0.012).add(vec3(time.mul(0.25), 0, 0))));
    color = color.add(v3(palette.veinColor).mul(scorch).mul(burn).mul(0.5));
  }

  const glow = emissive.mul(float(1).add(battleLightUniform.mul(0.2)));
  const haze = mix(v3(palette.hazeFar), v3(palette.hazeNear), viewDir.negate().dot(nebulaDirection).max(0).pow(3));
  const fog = float(1).sub(exp(distance.mul(-FOG_DENSITY)));
  const shaded = mix(color, haze, fog.mul(0.82));
  material.colorNode = shaded.add(glow.mul(float(1).sub(fog.mul(0.55))));
  return material;
}

/**
 * The enemy flagship's shield: a Voronoi energy lattice on an ellipsoid,
 * brightest at grazing angles so it outlines the ship from outside and stays
 * a faint web when the player is flying inside it.
 */
export function createShieldMaterial(color: Color, hot: Color) {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = AdditiveBlending;
  material.side = DoubleSide;
  const toCamera = cameraPosition.sub(positionWorld).normalize();
  const facing = normalWorld.dot(toCamera).abs();
  const fresnel = float(1).sub(facing).pow(2.2);
  const cells = mx_worley_noise_vec2(positionLocal.mul(0.045).add(vec3(0, time.mul(0.05), 0)));
  const edge = float(1).sub(smoothstep(0.0, 0.07, cells.y.sub(cells.x)));
  const sweep = positionLocal.z.mul(0.006).add(time.mul(1.4)).sin().mul(0.5).add(0.5);
  const collapse = shieldCollapseUniform;
  // Collapse eats the lattice from the stern forward in a hot front.
  const front = smoothstep(collapse.mul(2.4).sub(1.2), collapse.mul(2.4).sub(1.0), positionLocal.z.mul(-0.0013).add(0.5));
  const alive = float(1).sub(front);
  const lattice = edge.mul(0.55).add(fresnel.mul(0.8)).mul(sweep.mul(0.35).add(0.65));
  const inside = float(1).sub(shieldInsideUniform.mul(0.8));
  const intensity = lattice.mul(alive).mul(shieldUniform).mul(float(0.07).mul(inside).add(shieldHitUniform.mul(0.16)));
  const burnFront = front.mul(float(1).sub(front)).mul(4).mul(collapse.greaterThan(0.001).select(float(1), float(0)));
  material.colorNode = v3(color).mul(intensity).add(v3(hot).mul(burnFront).mul(edge.add(0.3)).mul(0.9));
  return material;
}

export function createInnerShieldMaterial(color: Color) {
  const material = createShieldMaterial(color, color);
  material.side = BackSide;
  return material;
}

export type NebulaColors = {
  deep: Color;
  magenta: Color;
  rose: Color;
  gold: Color;
  dust: Color;
};

/** Brightness of the nebula backdrop — the finale lifts it; the eye dims it. */
export const nebulaGainUniform = uniform(1);

/**
 * The sky: a huge magenta-and-gold nebula centered ahead of the battle,
 * domain-warped cloud mass with gold filaments, dark dust lanes, a hot core,
 * and a procedural star field. Used as scene.backgroundNode, so it sits
 * behind everything at infinite distance.
 */
export function createNebulaNode(colors: NebulaColors) {
  const d = normalize(positionLocal);
  const core = d.dot(nebulaDirection).max(0);
  const p = d.mul(2.1);
  const warp = vec3(
    mx_noise_float(p.mul(1.4).add(vec3(3.1, 0, 0))),
    mx_noise_float(p.mul(1.4).add(vec3(0, 7.3, 0))),
    mx_noise_float(p.mul(1.4).add(vec3(0, 0, 11.7))),
  );
  const q = p.add(warp.mul(0.7));
  const mass = mx_fractal_noise_float(q.mul(1.3), 4, 2.0, 0.55);
  const cloud = smoothstep(float(-0.1), float(0.65), mass.add(core.pow(1.2).mul(0.95)).sub(0.3));
  const filamentField = mx_fractal_noise_float(q.mul(3.2).add(vec3(5, 1, 2)), 3, 2.1, 0.5);
  const filaments = float(1).sub(filamentField.abs()).pow(7);
  const dustField = mx_fractal_noise_float(q.mul(2.3).add(vec3(40, 3, 9)), 3, 2.0, 0.5);
  const dust = smoothstep(float(0.05), float(0.5), dustField).mul(0.82);

  let color: Node<'vec3'> = v3(colors.deep);
  color = color.add(v3(colors.magenta).mul(cloud).mul(core.pow(2.2).mul(0.3).add(0.05)));
  color = color.add(v3(colors.rose).mul(cloud.mul(cloud)).mul(core.pow(4).mul(0.16)));
  color = color.add(v3(colors.gold).mul(filaments).mul(cloud).mul(core.pow(3).mul(0.55).add(0.03)));
  color = color.add(v3(colors.gold).mul(core.pow(60).mul(0.7)));
  color = color.add(v3(colors.rose).mul(core.pow(9).mul(0.1)));
  color = color.mul(float(1).sub(dust.mul(smoothstep(float(0.15), float(0.9), core).mul(0.6).add(0.4))));
  color = color.add(v3(colors.dust).mul(dust.mul(0.2)));

  // Stars: one candidate per 3D cell; a few become stars, gated by dust.
  const sp = d.mul(165);
  const cell = sp.floor();
  const f = sp.fract();
  const pick = mx_cell_noise_float(cell);
  const jitter = vec3(mx_cell_noise_float(cell.add(vec3(17.1, 0, 0))), mx_cell_noise_float(cell.add(vec3(0, 31.7, 0))), mx_cell_noise_float(cell.add(vec3(0, 0, 47.3))));
  const starDistance = f.sub(jitter.mul(0.6).add(0.2)).length();
  const starShape = smoothstep(float(0.2), float(0.0), starDistance);
  const starOn = step(float(0.955), pick);
  const starBright = mx_cell_noise_float(cell.add(vec3(5.5, 5.5, 5.5))).pow(4).mul(1.6).add(0.25);
  const stars = starShape.mul(starOn).mul(starBright).mul(float(1).sub(dust.mul(0.8)));
  color = color.add(vec3(0.85, 0.88, 1.0).mul(stars));
  return color.mul(nebulaGainUniform);
}

/** Flight-deck launch lights: chevrons that chase toward the bow. */
export const launchChaseUniform = uniform(0);
export const launchIntensityUniform = uniform(0.4);

export function createDeckLightMaterial(color: Color) {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.blending = AdditiveBlending;
  material.depthWrite = false;
  const phase = positionWorld.z.mul(0.045).add(launchChaseUniform);
  const pulse = phase.fract().oneMinus().pow(3);
  material.colorNode = v3(color).mul(pulse.mul(0.85).add(0.15)).mul(launchIntensityUniform);
  return material;
}
