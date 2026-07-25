import { AdditiveBlending, Color } from 'three';
import type { Material } from 'three';
import { LineBasicNodeMaterial, MeshBasicNodeMaterial, PointsNodeMaterial } from 'three/webgpu';
import { float, mix, normalView, positionView, uniform, vec3 } from 'three/tsl';
import { INK, VOID } from './palette';

// The imager, the cloud, and the pulse are three numbers the whole level reads.
// Keeping them at module scope (written once per frame by the runtime) means a
// mode switch is a single uniform ramp rather than a material swap.
export const thermalUniform = uniform(0);
export const inkUniform = uniform(0);
export const beatUniform = uniform(0);
/** Murk haze density: grit in the water, thickened by ink. */
export const murkHazeUniform = uniform(0.0104);
/** Infrared falloff: the imager sees further, but cold things read as nothing. */
export const thermalHazeUniform = uniform(0.0088);

export type ModalOptions = {
  /** How completely ink swallows this surface in normal sight, 0..1. */
  swallow?: number;
  /** Lamp shading strength: 0 is flat, 1 is full half-lambert off the lamp line. */
  shade?: number;
  /** Wet rim light on silhouette edges — what makes an oily mass read as a mass. */
  rim?: number;
  /** Extra brightness while the imager is up. */
  thermalGain?: number;
  additive?: boolean;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
  side?: Material['side'];
};

type ModalHandles = {
  murk: { value: Color };
  thermal: { value: Color };
};

type ModalMaterial = Material & { userData: { modal?: ModalHandles } };

// The harbour is lit by one thing: the lamp line hanging above and to the left
// of the rail. Everything unlit is drawn with a cheap half-lambert off that
// direction plus a wet rim, which is what keeps a basic-material world from
// reading as flat paper cut-outs. Infrared keeps a weaker version: a thermal
// imager still shows shape, it just does not show light.
const LAMP_DIRECTION = vec3(-0.42, 0.82, 0.38).normalize();
// Wet surfaces in a lamp-lit harbour take the sodium colour on their edges, not
// their own. One shared tint is what makes flesh, steel, and paint feel lit by
// the same lamps.
const RIM_TINT = vec3(1.0, 0.585, 0.185);
const THERMAL_RIM_TINT = vec3(0.72, 0.76, 0.86);

function modalColorNode(murk: Color, thermal: Color, options: ModalOptions) {
  const murkColor = uniform(murk.clone());
  const thermalColor = uniform(thermal.clone());
  const depth = positionView.z.negate().max(float(0));
  const murkFade = depth.mul(murkHazeUniform).negate().exp();
  const thermalFade = depth.mul(thermalHazeUniform).negate().exp();
  const swallow = inkUniform.mul(float(options.swallow ?? 0.92)).oneMinus().max(float(0));

  const shadeAmount = float(options.shade ?? 0);
  const rimAmount = float(options.rim ?? 0);
  const lambert = normalView.normalize().dot(LAMP_DIRECTION).mul(0.5).add(0.5);
  const shading = float(1).sub(shadeAmount).add(shadeAmount.mul(lambert.mul(lambert).mul(0.9).add(0.34)));
  const rim = float(1).sub(normalView.normalize().z.abs()).pow(4.2).mul(rimAmount);

  const murkTerm = murkColor.mul(shading).add(RIM_TINT.mul(rim.mul(0.42))).mul(murkFade).mul(swallow);
  const thermalTerm = thermalColor
    .mul(shading.mul(0.72).add(0.32))
    .add(THERMAL_RIM_TINT.mul(rim.mul(0.35)))
    .mul(thermalFade)
    .mul(float(options.thermalGain ?? 1));
  return { node: mix(murkTerm, thermalTerm, thermalUniform), murkColor, thermalColor };
}

function applyCommon(material: Material, options: ModalOptions) {
  if (options.additive) {
    material.transparent = true;
    material.blending = AdditiveBlending;
    material.depthWrite = false;
  }
  if (options.transparent) material.transparent = true;
  if (options.opacity !== undefined) material.opacity = options.opacity;
  if (options.depthWrite !== undefined) material.depthWrite = options.depthWrite;
  if (options.side !== undefined) material.side = options.side;
}

/** Surface material that repaints itself when the imager comes up. */
export function modalMesh(murk: Color, thermal: Color, options: ModalOptions = {}): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const { node, murkColor, thermalColor } = modalColorNode(murk, thermal, options);
  material.colorNode = node;
  material.userData.modal = { murk: murkColor, thermal: thermalColor };
  applyCommon(material, options);
  return material;
}

export function modalLine(murk: Color, thermal: Color, options: ModalOptions = {}): LineBasicNodeMaterial {
  const material = new LineBasicNodeMaterial();
  const { node, murkColor, thermalColor } = modalColorNode(murk, thermal, options);
  material.colorNode = node;
  material.userData.modal = { murk: murkColor, thermal: thermalColor };
  applyCommon(material, options);
  return material;
}

export function modalPoints(murk: Color, thermal: Color, size: number, options: ModalOptions = {}): PointsNodeMaterial {
  const material = new PointsNodeMaterial();
  const { node, murkColor, thermalColor } = modalColorNode(murk, thermal, options);
  material.colorNode = node;
  material.size = size;
  material.sizeAttenuation = true;
  material.userData.modal = { murk: murkColor, thermal: thermalColor };
  applyCommon(material, options);
  return material;
}

/**
 * Drifting ink. In normal sight the cloud is what actually takes the harbour
 * away: dozens of these stack in front of the camera and multiply the frame
 * down to nothing. The imager sees straight through it, so the same cloud drops
 * to a faint cold veil the moment infrared comes up — that transparency swap is
 * the whole reason the second sense is worth having.
 */
export function inkMesh(opacity: number): MeshBasicNodeMaterial {
  const material = modalMesh(INK, VOID, {
    swallow: 0,
    transparent: true,
    depthWrite: false,
    opacity,
  });
  material.opacityNode = float(opacity).mul(thermalUniform.mul(0.88).oneMinus());
  return material;
}

export function setModalMurk(material: Material, color: Color) {
  const modal = (material as ModalMaterial).userData.modal;
  if (modal) modal.murk.value.copy(color);
}

export function setModalThermal(material: Material, color: Color) {
  const modal = (material as ModalMaterial).userData.modal;
  if (modal) modal.thermal.value.copy(color);
}

export function setModalColors(material: Material, murk: Color, thermal: Color) {
  setModalMurk(material, murk);
  setModalThermal(material, thermal);
}
