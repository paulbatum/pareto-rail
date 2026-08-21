/** Visitor-facing entrant labels omit the default solo workflow and retain informative qualifiers. */
export function workflowQualifier(workflowName: string): string | null {
  const qualifier = workflowName.replace(/^solo(?:,\s*|$)/, '');
  return qualifier || null;
}

export function entrantLabel(parts: { modelName: string; snapshotLabel?: string; workflowName: string }): string {
  const qualifier = workflowQualifier(parts.workflowName);
  return [parts.modelName, parts.snapshotLabel, qualifier]
    .filter((part): part is string => part !== null && part !== undefined && part !== '')
    .join(' · ');
}

export interface ConfigurationIdentity {
  modelName: string;
  workflowName: string;
  effort: string;
}

/** Judgment groups configurations that a visitor has no way to tell apart: the
 * same model, at the same reasoning effort, under the same workflow. Two such
 * configurations differ only in which provider served the model, which changes
 * what the run was billed and nothing a voter sees, so a vote for one is
 * evidence about the other and they share a rating and a chart point.
 *
 * Effort is part of the key rather than folded away, because two efforts of one
 * model are a comparison the benchmark is built to make. */
export function configurationGroupKey(configuration: ConfigurationIdentity): string {
  return [configuration.modelName, configuration.effort, configuration.workflowName].join('::');
}

/** Resolves a configuration id to the group it is rated under. A configuration
 * the catalog does not carry resolves to itself, so callers with their own
 * fixtures keep one point per configuration. */
export function configurationGroupResolver(configurations: readonly (ConfigurationIdentity & { id: string })[] | undefined): (configurationId: string) => string {
  const groups = new Map((configurations ?? []).map((configuration) => [configuration.id, configurationGroupKey(configuration)]));
  return (configurationId) => groups.get(configurationId) ?? configurationId;
}

/** The reasoning effort behind a rating group, for labelling its chart point. */
export function configurationGroupEfforts(configurations: readonly ConfigurationIdentity[] | undefined): ReadonlyMap<string, string> {
  return new Map((configurations ?? []).map((configuration) => [configurationGroupKey(configuration), configuration.effort]));
}
