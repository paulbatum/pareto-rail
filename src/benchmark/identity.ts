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
