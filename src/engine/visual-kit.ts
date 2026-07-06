import {
  AdditiveBlending,
  Color,
  MeshBasicMaterial,
} from 'three';
import type {
  Blending,
  ColorRepresentation,
  Material,
  MeshBasicMaterialParameters,
  Object3D,
  Side,
} from 'three';

export type PendingVisualRecords<TPending, TRecord, TClaimArgs extends unknown[]> = {
  readonly size: number;
  readonly pendingCount: number;
  enqueue(pending: TPending): TPending;
  claim(id: number, ...args: TClaimArgs): TRecord | undefined;
  get(id: number): TRecord | undefined;
  has(id: number): boolean;
  delete(id: number, options?: { dispose?: boolean }): boolean;
  clear(options?: { dispose?: boolean; pending?: boolean }): void;
  values(): IterableIterator<TRecord>;
  entries(): IterableIterator<[number, TRecord]>;
};

export type PendingVisualRecordsOptions<TPending, TRecord, TClaimArgs extends unknown[]> = {
  createRecord(pending: TPending, ...args: TClaimArgs): TRecord;
  disposeRecord?(record: TRecord): void;
};

export function createPendingVisualRecords<TPending, TRecord, TClaimArgs extends unknown[] = []>(
  options: PendingVisualRecordsOptions<TPending, TRecord, TClaimArgs>,
): PendingVisualRecords<TPending, TRecord, TClaimArgs> {
  const pending: TPending[] = [];
  const records = new Map<number, TRecord>();

  const disposeRecord = (record: TRecord) => options.disposeRecord?.(record);

  return {
    get size() {
      return records.size;
    },
    get pendingCount() {
      return pending.length;
    },
    enqueue(item) {
      pending.push(item);
      return item;
    },
    claim(id, ...args) {
      const item = pending.shift();
      if (item === undefined) return undefined;
      const record = options.createRecord(item, ...args);
      records.set(id, record);
      return record;
    },
    get(id) {
      return records.get(id);
    },
    has(id) {
      return records.has(id);
    },
    delete(id, deleteOptions) {
      const record = records.get(id);
      if (!record) return false;
      if (deleteOptions?.dispose) disposeRecord(record);
      return records.delete(id);
    },
    clear(clearOptions) {
      if (clearOptions?.dispose) for (const record of records.values()) disposeRecord(record);
      records.clear();
      if (clearOptions?.pending) pending.length = 0;
    },
    values() {
      return records.values();
    },
    entries() {
      return records.entries();
    },
  };
}

export type TransientEffectPool<TEffect extends { age: number; life: number }, TContext> = {
  readonly size: number;
  add(effect: TEffect): TEffect;
  update(dt: number, context: TContext): void;
  clear(context: TContext): void;
  values(): readonly TEffect[];
};

export type TransientEffectPoolOptions<TEffect extends { age: number; life: number }, TContext> = {
  update(effect: TEffect, progress: number, dt: number, context: TContext): void;
  dispose?(effect: TEffect, context: TContext): void;
};

export function createTransientEffectPool<TEffect extends { age: number; life: number }, TContext = undefined>(
  options: TransientEffectPoolOptions<TEffect, TContext>,
): TransientEffectPool<TEffect, TContext> {
  const effects: TEffect[] = [];

  return {
    get size() {
      return effects.length;
    },
    add(effect) {
      effects.push(effect);
      return effect;
    },
    update(dt, context) {
      for (let i = effects.length - 1; i >= 0; i -= 1) {
        const effect = effects[i];
        effect.age += dt;
        if (effect.age >= effect.life) {
          options.dispose?.(effect, context);
          effects.splice(i, 1);
          continue;
        }
        options.update(effect, effect.age / effect.life, dt, context);
      }
    },
    clear(context) {
      for (const effect of effects) options.dispose?.(effect, context);
      effects.length = 0;
    },
    values() {
      return effects;
    },
  };
}

export type AdditiveMaterialFlags = {
  transparent: true;
  blending: typeof AdditiveBlending;
  depthWrite: false;
};

export type AdditiveMaterialOptions = {
  color?: ColorRepresentation;
  opacity?: number;
  side?: Side;
};

export type AdditiveBasicMaterialParameters = Omit<MeshBasicMaterialParameters, 'transparent' | 'blending' | 'depthWrite'> & {
  color: ColorRepresentation;
};

export function additiveMaterialParameters<T extends object>(parameters: T): T & AdditiveMaterialFlags {
  return {
    ...parameters,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  };
}

export function createAdditiveBasicMaterial(parameters: AdditiveBasicMaterialParameters): MeshBasicMaterial {
  return new MeshBasicMaterial(additiveMaterialParameters(parameters));
}

export function configureAdditiveMaterial<T extends Material & {
  transparent: boolean;
  blending: Blending;
  depthWrite: boolean;
  color?: Color;
  opacity?: number;
  side?: Side;
}>(material: T, options: AdditiveMaterialOptions = {}): T {
  material.transparent = true;
  material.blending = AdditiveBlending;
  material.depthWrite = false;
  if (options.color !== undefined && material.color) material.color.set(options.color);
  if (options.opacity !== undefined) material.opacity = options.opacity;
  if (options.side !== undefined) material.side = options.side;
  return material;
}

export type AdornmentSlot<TRecord, TAdornment extends Object3D> = {
  attach(record: TRecord, adornment: TAdornment, parent: Object3D): TAdornment;
  detach(record: TRecord): void;
  clear(records: Iterable<TRecord>): void;
};

export type AdornmentSlotOptions<TRecord, TAdornment extends Object3D> = {
  get(record: TRecord): TAdornment | null | undefined;
  set(record: TRecord, adornment: TAdornment | null): void;
  disposeAdornment?(adornment: TAdornment): void;
};

export function createAdornmentSlot<TRecord, TAdornment extends Object3D>(
  options: AdornmentSlotOptions<TRecord, TAdornment>,
): AdornmentSlot<TRecord, TAdornment> {
  const disposeAdornment = options.disposeAdornment ?? disposeObject3D;

  const detach = (record: TRecord) => {
    const adornment = options.get(record);
    if (!adornment) return;
    adornment.removeFromParent();
    disposeAdornment(adornment);
    options.set(record, null);
  };

  return {
    attach(record, adornment, parent) {
      detach(record);
      parent.add(adornment);
      options.set(record, adornment);
      return adornment;
    },
    detach,
    clear(records) {
      for (const record of records) detach(record);
    },
  };
}

type ObjectWithDisposableResources = Object3D & {
  geometry?: { dispose(): void };
  material?: Material | Material[];
};

export function disposeObject3D(object: Object3D) {
  object.traverse((child) => {
    const disposable = child as ObjectWithDisposableResources;
    disposable.geometry?.dispose();
    const materials = disposable.material === undefined
      ? []
      : Array.isArray(disposable.material)
        ? disposable.material
        : [disposable.material];
    for (const material of materials) material.dispose();
  });
}
