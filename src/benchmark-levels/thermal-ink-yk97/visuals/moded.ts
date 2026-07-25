import { Color, MathUtils } from 'three';
import type { Material, Object3D } from 'three';

// Every material that should read differently under infrared registers a
// moded spec: its murk color, its infrared color, and how hard the blind beat
// (ink swallowing the view before the lens snaps in) dims it. The mode driver
// in visuals/index lerps all registered materials once per frame.

export type ModedTarget = Material & { color: Color; opacity: number };

export type ModedSpec = {
  murk: Color;
  ir: Color;
  murkOpacity?: number;
  irOpacity?: number;
  /** 0 = unaffected by the blind beat, 1 = fully swallowed. Defaults to 0.85. */
  blindDim?: number;
};

export type ModedEntry = { material: ModedTarget; spec: ModedSpec };

export function modeMaterial<T extends ModedTarget>(material: T, spec: ModedSpec): T {
  material.userData.moded = spec;
  return material;
}

export function collectModed(root: Object3D): ModedEntry[] {
  const seen = new Set<Material>();
  const entries: ModedEntry[] = [];
  root.traverse((child) => {
    const withMaterial = child as Object3D & { material?: Material | Material[] };
    const materials = withMaterial.material === undefined
      ? []
      : Array.isArray(withMaterial.material)
        ? withMaterial.material
        : [withMaterial.material];
    for (const material of materials) {
      if (seen.has(material)) continue;
      seen.add(material);
      const spec = material.userData.moded as ModedSpec | undefined;
      if (spec) entries.push({ material: material as ModedTarget, spec });
    }
  });
  return entries;
}

export function applyModeList(entries: readonly ModedEntry[], ir: number, blind: number) {
  for (const { material, spec } of entries) {
    const dim = 1 - blind * (spec.blindDim ?? 0.85);
    material.color.copy(spec.murk).lerp(spec.ir, ir).multiplyScalar(dim);
    if (spec.murkOpacity !== undefined) {
      material.opacity = MathUtils.lerp(spec.murkOpacity, spec.irOpacity ?? spec.murkOpacity, ir);
    }
  }
}
