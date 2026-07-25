import {
  Color,
  DoubleSide,
  FrontSide,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointsMaterial,
  type Material,
} from 'three';
import {
  CHARCOAL,
  COLD_METAL,
  DIRTY_CREAM,
  INK,
  LAMP,
  SIGNAL_RED,
  THERMAL_WHITE,
  UI_CREAM,
  UI_RED,
} from './palette';

export type ThermalMaterialRole =
  | 'world'
  | 'rust'
  | 'cream'
  | 'water'
  | 'lamp'
  | 'hot'
  | 'core'
  | 'ink'
  | 'ui'
  | 'ui-red';

type AdaptiveMaterial = Material & {
  color?: Color;
  emissive?: Color;
  emissiveIntensity?: number;
  opacity: number;
  transparent: boolean;
};

type ThermalMetadata = {
  role: ThermalMaterialRole;
  normalColor: Color;
  thermalColor: Color;
  normalEmissive: Color;
  thermalEmissive: Color;
  normalEmissiveIntensity: number;
  thermalEmissiveIntensity: number;
  baseOpacity: number;
};

const adaptiveMaterials = new Set<AdaptiveMaterial>();
let currentInfrared = 0;
let currentInk = 0;

const thermalColorFor = (role: ThermalMaterialRole) => {
  switch (role) {
    case 'hot':
      return THERMAL_WHITE;
    case 'core':
    case 'ui-red':
      return SIGNAL_RED;
    case 'lamp':
      return COLD_METAL;
    case 'cream':
      return new Color(0x393731);
    case 'rust':
      return new Color(0x252321);
    case 'water':
    case 'ink':
      return INK;
    case 'ui':
      return UI_CREAM;
    case 'world':
      return CHARCOAL;
  }
};

function register<T extends AdaptiveMaterial>(
  material: T,
  role: ThermalMaterialRole,
  normalColor: Color | number,
  options: {
    emissive?: Color | number;
    emissiveIntensity?: number;
    thermalEmissiveIntensity?: number;
    opacity?: number;
  } = {},
) {
  const color = normalColor instanceof Color ? normalColor.clone() : new Color(normalColor);
  const normalEmissive = options.emissive instanceof Color
    ? options.emissive.clone()
    : new Color(options.emissive ?? 0x000000);
  const thermalColor = thermalColorFor(role).clone();
  const thermalEmissive = role === 'hot'
    ? THERMAL_WHITE.clone()
    : role === 'core' || role === 'ui-red'
      ? SIGNAL_RED.clone()
      : role === 'ui'
        ? UI_CREAM.clone()
        : new Color(0x000000);
  material.userData.thermal = {
    role,
    normalColor: color,
    thermalColor,
    normalEmissive,
    thermalEmissive,
    normalEmissiveIntensity: options.emissiveIntensity ?? 0,
    thermalEmissiveIntensity: options.thermalEmissiveIntensity
      ?? (role === 'hot' ? 0.42 : role === 'core' || role.startsWith('ui') ? 1.25 : 0),
    baseOpacity: options.opacity ?? 1,
  } satisfies ThermalMetadata;
  material.opacity = options.opacity ?? 1;
  material.transparent = material.opacity < 1 || role === 'ink' || role === 'water';
  adaptiveMaterials.add(material);
  applyMaterial(material, currentInfrared, currentInk);
  return material;
}

export function resetThermalMaterials() {
  adaptiveMaterials.clear();
  currentInfrared = 0;
  currentInk = 0;
}

export function thermalStandard(
  role: ThermalMaterialRole,
  color: Color | number,
  options: {
    roughness?: number;
    metalness?: number;
    emissive?: Color | number;
    emissiveIntensity?: number;
    thermalEmissiveIntensity?: number;
    opacity?: number;
    side?: typeof DoubleSide;
    depthWrite?: boolean;
  } = {},
) {
  const material = new MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.72,
    metalness: options.metalness ?? 0.16,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    opacity: options.opacity ?? 1,
    transparent: (options.opacity ?? 1) < 1,
    side: options.side ?? FrontSide,
    depthWrite: options.depthWrite ?? true,
  }) as AdaptiveMaterial & MeshStandardMaterial;
  return register(material, role, color, options);
}

export function thermalBasic(
  role: ThermalMaterialRole,
  color: Color | number,
  options: {
    opacity?: number;
    side?: typeof DoubleSide;
    depthWrite?: boolean;
  } = {},
) {
  const material = new MeshBasicMaterial({
    color,
    opacity: options.opacity ?? 1,
    transparent: (options.opacity ?? 1) < 1,
    side: options.side ?? FrontSide,
    depthWrite: options.depthWrite ?? true,
  }) as AdaptiveMaterial & MeshBasicMaterial;
  return register(material, role, color, options);
}

export function thermalLine(
  role: ThermalMaterialRole,
  color: Color | number,
  options: { opacity?: number } = {},
) {
  const material = new LineBasicMaterial({
    color,
    opacity: options.opacity ?? 1,
    transparent: (options.opacity ?? 1) < 1,
  }) as AdaptiveMaterial & LineBasicMaterial;
  return register(material, role, color, options);
}

export function thermalPoints(
  role: ThermalMaterialRole,
  color: Color | number,
  options: { opacity?: number; size?: number; depthWrite?: boolean } = {},
) {
  const material = new PointsMaterial({
    color,
    opacity: options.opacity ?? 1,
    transparent: true,
    size: options.size ?? 0.16,
    sizeAttenuation: true,
    depthWrite: options.depthWrite ?? false,
  }) as AdaptiveMaterial & PointsMaterial;
  return register(material, role, color, options);
}

export function updateThermalMaterials(infrared: number, inkDensity: number) {
  currentInfrared = Math.min(1, Math.max(0, infrared));
  currentInk = Math.min(1, Math.max(0, inkDensity));
  for (const material of adaptiveMaterials) applyMaterial(material, currentInfrared, currentInk);
}

function applyMaterial(material: AdaptiveMaterial, infrared: number, inkDensity: number) {
  const metadata = material.userData.thermal as ThermalMetadata | undefined;
  if (!metadata) return;
  const {
    role,
    normalColor,
    thermalColor,
    normalEmissive,
    thermalEmissive,
    normalEmissiveIntensity,
    thermalEmissiveIntensity,
    baseOpacity,
  } = metadata;

  if (material.color) {
    material.color.lerpColors(normalColor, thermalColor, infrared);
    const normalVision = 1 - infrared;
    const blackout = role === 'hot' || role === 'core'
      ? 1 - inkDensity * 0.97 * normalVision
      : role === 'lamp'
        ? 1 - inkDensity * 0.68 * normalVision
        : role === 'world' || role === 'rust' || role === 'cream'
          ? 1 - inkDensity * 0.52 * normalVision
          : 1;
    material.color.multiplyScalar(blackout);
  }

  if (material.emissive) {
    material.emissive.lerpColors(normalEmissive, thermalEmissive, infrared);
    if (role === 'hot' || role === 'core') {
      material.emissive.multiplyScalar(1 - inkDensity * 0.97 * (1 - infrared));
    }
    material.emissiveIntensity = MathUtilsLerp(
      normalEmissiveIntensity,
      thermalEmissiveIntensity,
      infrared,
    );
  }

  if (role === 'ink') {
    material.opacity = baseOpacity * (0.82 + inkDensity * 0.42) * (1 - infrared * 0.28);
  } else if (role === 'water') {
    material.opacity = baseOpacity * (1 - infrared * 0.52);
  } else {
    material.opacity = baseOpacity;
  }
  material.needsUpdate = true;
}

function MathUtilsLerp(from: number, to: number, amount: number) {
  return from + (to - from) * amount;
}

export function isThermalMaterial(material: Material) {
  return adaptiveMaterials.has(material as AdaptiveMaterial);
}
