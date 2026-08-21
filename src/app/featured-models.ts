import featuredModelsDoc from './featured-models.md?raw';

export interface FeaturedModel {
  name: string;
  isNew: boolean;
  href?: string;
  note?: string;
}

/** Reads the bullet list out of `featured-models.md`. The format is deliberately
 * minimal — one model per bullet, an optional trailing `(new)`, a name that may be
 * written as a markdown link, and an optional note after an em dash — so the file
 * stays readable as prose. `benchmark:export-rank-catalog` reconciles the same file
 * against the published catalog and strips the same decorations to recover each name. */
export function parseFeaturedModels(source: string): FeaturedModel[] {
  return source.split('\n')
    .map((line) => /^-\s+(.*\S)\s*$/.exec(line.trim())?.[1])
    .filter((entry): entry is string => entry !== undefined)
    .map((entry) => {
      const isNew = /\(new\)$/i.test(entry);
      const labelled = entry.replace(/\s*\(new\)$/i, '');
      const noted = /^(.*?)\s+—\s+(.*\S)$/.exec(labelled);
      const subject = noted ? noted[1] : labelled;
      const link = /^\[(.+)\]\((\S+)\)$/.exec(subject);
      return {
        name: link ? link[1] : subject,
        isNew,
        ...(link ? { href: link[2] } : {}),
        ...(noted ? { note: noted[2] } : {}),
      };
    });
}

export const featuredModels: readonly FeaturedModel[] = parseFeaturedModels(featuredModelsDoc);
