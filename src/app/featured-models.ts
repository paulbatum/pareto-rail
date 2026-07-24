import featuredModelsDoc from './featured-models.md?raw';

export interface FeaturedModel {
  name: string;
  isNew: boolean;
}

/** Reads the bullet list out of `featured-models.md`. The format is deliberately
 * minimal — one model per bullet, an optional trailing `(new)` — so the file
 * stays readable as prose and `benchmark:export-rank-catalog` can reconcile it
 * against the published catalog with the same three lines. */
export function parseFeaturedModels(source: string): FeaturedModel[] {
  return source.split('\n')
    .map((line) => /^-\s+(.*\S)\s*$/.exec(line.trim())?.[1])
    .filter((entry): entry is string => entry !== undefined)
    .map((entry) => ({
      name: entry.replace(/\s*\(new\)$/i, ''),
      isNew: /\(new\)$/i.test(entry),
    }));
}

export const featuredModels: readonly FeaturedModel[] = parseFeaturedModels(featuredModelsDoc);
